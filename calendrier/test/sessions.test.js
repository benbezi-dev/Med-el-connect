const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');

function service() {
  return new SessionService(new Store(null));
}

const base = { date: '2026-09-14', time: '18:00', locationId: 'valbonne-stadium' };

function attendreErreur(fn, status) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.status, status, `attendu ${status}, reçu ${error.status} (${error.message})`);
    return error;
  }
  assert.fail(`aucune erreur levée (attendu ${status})`);
}

test('create applique les valeurs par défaut et dérive le lieu', () => {
  const seance = service().create(base);
  assert.match(seance.id, /^ses_/);
  assert.equal(seance.title, 'Entraînement');
  assert.equal(seance.capacity, 20);
  assert.deepEqual(seance.participants, []);
  assert.equal(seance.placesRestantes, 20);
  assert.equal(seance.location.name, 'Valbonne Stadium');
  assert.equal(seance.location.city, 'Valbonne');
});

test('create refuse une heure hors 18:00 / 18:30', () => {
  const svc = service();
  for (const time of ['19:00', '18:15', '18h00', '', null]) {
    attendreErreur(() => svc.create({ ...base, time }), 400);
  }
  assert.equal(svc.create({ ...base, time: '18:30' }).time, '18:30');
});

test('create refuse un lieu inconnu et accepte les cinq lieux prévus', () => {
  const svc = service();
  attendreErreur(() => svc.create({ ...base, locationId: 'nice-stadium' }), 400);

  const lieux = [
    'antibes-fort-carre-stade',
    'valbonne-stadium',
    'grasse-stadium',
    'valbonne-hill',
    'valbonne-city-workout'
  ];
  for (const locationId of lieux) {
    assert.equal(svc.create({ ...base, locationId }).locationId, locationId);
  }
  assert.equal(svc.list().length, 5); // les 5 lieux cohabitent sur le même créneau
});

test('create refuse les champs obligatoires manquants ou mal typés', () => {
  const svc = service();
  attendreErreur(() => svc.create({ time: '18:00', locationId: 'grasse-stadium' }), 400);
  attendreErreur(() => svc.create({ date: '2026-09-14', locationId: 'grasse-stadium' }), 400);
  attendreErreur(() => svc.create({ date: '2026-09-14', time: '18:00' }), 400);
  attendreErreur(() => svc.create({ ...base, date: '2026-02-30' }), 400);
  attendreErreur(() => svc.create({ ...base, capacity: 0 }), 400);
  attendreErreur(() => svc.create({ ...base, capacity: 4.5 }), 400);
  attendreErreur(() => svc.create({ ...base, title: 42 }), 400);
  attendreErreur(() => svc.create(null), 400);
});

test('create rejette deux séances sur le même lieu au même créneau', () => {
  const svc = service();
  svc.create(base);
  const erreur = attendreErreur(() => svc.create(base), 409);
  assert.ok(erreur.details.sessionExistante);

  // Même lieu, autre heure ou autre jour : autorisé.
  assert.ok(svc.create({ ...base, time: '18:30' }));
  assert.ok(svc.create({ ...base, date: '2026-09-15' }));
});

test('update modifie partiellement et contrôle les conflits', () => {
  const svc = service();
  const seance = svc.create(base);
  const autre = svc.create({ ...base, locationId: 'grasse-stadium' });

  const modifiee = svc.update(seance.id, { title: 'Fractionné', participants: ['Léa', 'Sam'] });
  assert.equal(modifiee.title, 'Fractionné');
  assert.equal(modifiee.placesRestantes, 18);
  assert.equal(modifiee.time, '18:00', 'les champs non fournis restent inchangés');
  assert.notEqual(modifiee.updatedAt, undefined);

  attendreErreur(() => svc.update(seance.id, { locationId: autre.locationId }), 409);
  attendreErreur(() => svc.update(seance.id, {}), 400);
  attendreErreur(() => svc.update('ses_inconnu', { title: 'x' }), 404);

  // Déplacer sur un créneau libre reste possible.
  assert.equal(svc.update(seance.id, { time: '18:30' }).time, '18:30');
});

test('archive sort la séance de la grille sans rien perdre', () => {
  const svc = service();
  const seance = svc.create({ ...base, title: 'Piste', notes: 'À refaire' });

  const archivee = svc.archive(seance.id);
  assert.equal(archivee.archivee, true);
  assert.ok(archivee.archiveeLe);
  assert.equal(svc.list().length, 0, 'plus dans la grille');
  assert.equal(svc.list({ archivees: true }).length, 1, 'toujours dans les données');
  assert.equal(svc.get(seance.id).title, 'Piste', 'toujours lisible par identifiant');
  assert.equal(svc.get(seance.id).notes, 'À refaire');

  // Le créneau est de nouveau libre, et la restauration le vérifie.
  const remplacante = svc.create(base);
  attendreErreur(() => svc.restore(seance.id), 409);
  svc.archive(remplacante.id);
  assert.equal(svc.restore(seance.id).archivee, false);
  assert.equal(svc.list().length, 1);

  attendreErreur(() => svc.archive('ses_inconnu'), 404);
});

test('le statut par défaut est « prévue » et chaque changement est daté', () => {
  const svc = service();
  const seance = svc.create(base);
  assert.equal(seance.statut, 'prevue');
  assert.equal(seance.statutLabel, 'Prévue');
  assert.deepEqual(seance.historique.map((h) => h.statut), ['prevue']);

  const effectuee = svc.update(seance.id, { statut: 'effectuee' });
  assert.equal(effectuee.statut, 'effectuee');
  assert.equal(effectuee.statutLabel, 'Effectuée');
  assert.deepEqual(effectuee.historique.map((h) => h.statut), ['prevue', 'effectuee']);
  assert.ok(effectuee.historique[1].at, 'le passage à « effectuée » est horodaté');

  // Repasser au même statut n'ajoute pas de ligne d'historique.
  assert.equal(svc.update(seance.id, { statut: 'effectuee' }).historique.length, 2);
  attendreErreur(() => svc.update(seance.id, { statut: 'reportee' }), 400);
  attendreErreur(() => svc.create({ ...base, date: '2026-09-20', statut: 'faite' }), 400);
});

test('une séance annulée libère son créneau', () => {
  const svc = service();
  const seance = svc.create(base);
  attendreErreur(() => svc.create(base), 409);

  svc.update(seance.id, { statut: 'annulee' });
  const remplacante = svc.create(base);
  assert.equal(remplacante.locationId, base.locationId);

  // La séance annulée reste visible dans la grille, elle n'est pas effacée.
  assert.equal(svc.list().length, 2);
  assert.equal(svc.list({ statut: 'annulee' }).length, 1);
  // Et elle ne peut pas redevenir « prévue » tant que le créneau est repris.
  attendreErreur(() => svc.update(seance.id, { statut: 'prevue' }), 409);
});

test('les notes vocales sont attachées, listées puis retirées', () => {
  const svc = service();
  const seance = svc.create(base);
  assert.deepEqual(seance.notesVocales, []);

  const note = { id: 'voc_1', fichier: 'voc_1.webm', mimeType: 'audio/webm', taille: 42, duree: 3.2,
                 transcription: 'Séance de côtes', createdAt: new Date().toISOString() };
  const avec = svc.ajouterNoteVocale(seance.id, note);
  assert.equal(avec.notesVocales.length, 1);
  assert.equal(svc.trouverNoteVocale(seance.id, 'voc_1').transcription, 'Séance de côtes');
  attendreErreur(() => svc.trouverNoteVocale(seance.id, 'voc_absent'), 404);

  assert.equal(svc.supprimerNoteVocale(seance.id, 'voc_1').notesVocales.length, 0);
  attendreErreur(() => svc.supprimerNoteVocale(seance.id, 'voc_1'), 404);
});

test('list filtre par statut et peut inclure les archives', () => {
  const svc = service();
  const faite = svc.create({ ...base, statut: 'effectuee' });
  svc.create({ ...base, locationId: 'grasse-stadium' });
  const archivee = svc.create({ ...base, locationId: 'valbonne-hill' });
  svc.archive(archivee.id);

  assert.equal(svc.list().length, 2);
  assert.equal(svc.list({ statut: 'effectuee' })[0].id, faite.id);
  assert.equal(svc.list({ statut: 'prevue' }).length, 1);
  assert.equal(svc.list({ archivees: true }).length, 3);
  attendreErreur(() => svc.list({ statut: 'inconnu' }), 400);
});

test('list filtre par période, lieu et heure, et trie le résultat', () => {
  const svc = service();
  svc.create({ date: '2026-09-16', time: '18:30', locationId: 'valbonne-hill' });
  svc.create({ date: '2026-09-14', time: '18:30', locationId: 'grasse-stadium' });
  svc.create({ date: '2026-09-14', time: '18:00', locationId: 'valbonne-hill' });

  assert.deepEqual(
    svc.list().map((s) => `${s.date} ${s.time}`),
    ['2026-09-14 18:00', '2026-09-14 18:30', '2026-09-16 18:30']
  );
  assert.equal(svc.list({ from: '2026-09-15' }).length, 1);
  assert.equal(svc.list({ to: '2026-09-15' }).length, 2);
  assert.equal(svc.list({ locationId: 'valbonne-hill' }).length, 2);
  assert.equal(svc.list({ time: '18:30' }).length, 2);
  assert.equal(svc.list({ from: '2026-09-14', to: '2026-09-14', time: '18:00' }).length, 1);

  attendreErreur(() => svc.list({ from: 'hier' }), 400);
  attendreErreur(() => svc.list({ time: '20:00' }), 400);
  attendreErreur(() => svc.list({ locationId: 'monaco' }), 400);
});
