const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');

function service() {
  return new SessionService(new Store(null));
}

const base = { date: '2026-09-14', time: '18:00', locationId: 'valbonne-stadium' };

/** Les mutations sont asynchrones : l'erreur arrive en promesse rejetée. */
async function attendreErreur(fn, status) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.status, status, `attendu ${status}, reçu ${error.status} (${error.message})`);
    return error;
  }
  assert.fail(`aucune erreur levée (attendu ${status})`);
}

test('create applique les valeurs par défaut et dérive le lieu', async () => {
  const seance = await service().create(base);
  assert.match(seance.id, /^ses_/);
  assert.equal(seance.title, 'Entraînement');
  assert.equal(seance.capacity, 20);
  assert.deepEqual(seance.participants, []);
  assert.equal(seance.placesRestantes, 20);
  assert.equal(seance.location.name, 'Valbonne Stadium');
  assert.equal(seance.location.city, 'Valbonne');
});

test('create refuse une heure hors 18:00 / 18:30', async () => {
  const svc = service();
  for (const time of ['19:00', '18:15', '18h00', '', null]) {
    await attendreErreur(() => svc.create({ ...base, time }), 400);
  }
  assert.equal((await svc.create({ ...base, time: '18:30' })).time, '18:30');
});

test('create refuse un lieu inconnu et accepte les cinq lieux prévus', async () => {
  const svc = service();
  await attendreErreur(() => svc.create({ ...base, locationId: 'nice-stadium' }), 400);

  const lieux = [
    'antibes-fort-carre-stade',
    'valbonne-stadium',
    'grasse-stadium',
    'valbonne-hill',
    'valbonne-city-workout'
  ];
  for (const locationId of lieux) {
    assert.equal((await svc.create({ ...base, locationId })).locationId, locationId);
  }
  assert.equal(svc.list().length, 5); // les 5 lieux cohabitent sur le même créneau
});

test('create refuse les champs obligatoires manquants ou mal typés', async () => {
  const svc = service();
  await attendreErreur(() => svc.create({ time: '18:00', locationId: 'grasse-stadium' }), 400);
  await attendreErreur(() => svc.create({ date: '2026-09-14', locationId: 'grasse-stadium' }), 400);
  await attendreErreur(() => svc.create({ date: '2026-09-14', time: '18:00' }), 400);
  await attendreErreur(() => svc.create({ ...base, date: '2026-02-30' }), 400);
  await attendreErreur(() => svc.create({ ...base, capacity: 0 }), 400);
  await attendreErreur(() => svc.create({ ...base, capacity: 4.5 }), 400);
  await attendreErreur(() => svc.create({ ...base, title: 42 }), 400);
  await attendreErreur(() => svc.create(null), 400);
});

test('create rejette deux séances sur le même lieu au même créneau', async () => {
  const svc = service();
  await svc.create(base);
  const erreur = await attendreErreur(() => svc.create(base), 409);
  assert.ok(erreur.details.sessionExistante);

  // Même lieu, autre heure ou autre jour : autorisé.
  assert.ok(await svc.create({ ...base, time: '18:30' }));
  assert.ok(await svc.create({ ...base, date: '2026-09-15' }));
});

test('update modifie partiellement et contrôle les conflits', async () => {
  const svc = service();
  const seance = await svc.create(base);
  const autre = await svc.create({ ...base, locationId: 'grasse-stadium' });

  const modifiee = await svc.update(seance.id, { title: 'Fractionné', participants: ['Léa', 'Sam'] });
  assert.equal(modifiee.title, 'Fractionné');
  assert.equal(modifiee.placesRestantes, 18);
  assert.equal(modifiee.time, '18:00', 'les champs non fournis restent inchangés');
  assert.notEqual(modifiee.updatedAt, undefined);

  await attendreErreur(() => svc.update(seance.id, { locationId: autre.locationId }), 409);
  await attendreErreur(() => svc.update(seance.id, {}), 400);
  await attendreErreur(() => svc.update('ses_inconnu', { title: 'x' }), 404);

  // Déplacer sur un créneau libre reste possible.
  assert.equal((await svc.update(seance.id, { time: '18:30' })).time, '18:30');
});

test('archive sort la séance de la grille sans rien perdre', async () => {
  const svc = service();
  const seance = await svc.create({ ...base, title: 'Piste', notes: 'À refaire' });

  const archivee = await svc.archive(seance.id);
  assert.equal(archivee.archivee, true);
  assert.ok(archivee.archiveeLe);
  assert.equal(svc.list().length, 0, 'plus dans la grille');
  assert.equal(svc.list({ archivees: true }).length, 1, 'toujours dans les données');
  assert.equal(svc.get(seance.id).title, 'Piste', 'toujours lisible par identifiant');
  assert.equal(svc.get(seance.id).notes, 'À refaire');

  // Le créneau est de nouveau libre, et la restauration le vérifie.
  const remplacante = await svc.create(base);
  await attendreErreur(() => svc.restore(seance.id), 409);
  await svc.archive(remplacante.id);
  assert.equal((await svc.restore(seance.id)).archivee, false);
  assert.equal(svc.list().length, 1);

  await attendreErreur(() => svc.archive('ses_inconnu'), 404);
});

test('le statut par défaut est « prévue » et chaque changement est daté', async () => {
  const svc = service();
  const seance = await svc.create(base);
  assert.equal(seance.statut, 'prevue');
  assert.equal(seance.statutLabel, 'Prévue');
  assert.deepEqual(seance.historique.map((h) => h.statut), ['prevue']);

  const effectuee = await svc.update(seance.id, { statut: 'effectuee' });
  assert.equal(effectuee.statut, 'effectuee');
  assert.equal(effectuee.statutLabel, 'Effectuée');
  assert.deepEqual(effectuee.historique.map((h) => h.statut), ['prevue', 'effectuee']);
  assert.ok(effectuee.historique[1].at, 'le passage à « effectuée » est horodaté');

  // Repasser au même statut n'ajoute pas de ligne d'historique.
  assert.equal((await svc.update(seance.id, { statut: 'effectuee' })).historique.length, 2);
  await attendreErreur(() => svc.update(seance.id, { statut: 'reportee' }), 400);
  await attendreErreur(() => svc.create({ ...base, date: '2026-09-20', statut: 'faite' }), 400);
});

test('une séance annulée libère son créneau', async () => {
  const svc = service();
  const seance = await svc.create(base);
  await attendreErreur(() => svc.create(base), 409);

  await svc.update(seance.id, { statut: 'annulee' });
  const remplacante = await svc.create(base);
  assert.equal(remplacante.locationId, base.locationId);

  // La séance annulée reste visible dans la grille, elle n'est pas effacée.
  assert.equal(svc.list().length, 2);
  assert.equal(svc.list({ statut: 'annulee' }).length, 1);
  // Et elle ne peut pas redevenir « prévue » tant que le créneau est repris.
  await attendreErreur(() => svc.update(seance.id, { statut: 'prevue' }), 409);
});

test('les notes vocales sont attachées, listées puis retirées', async () => {
  const svc = service();
  const seance = await svc.create(base);
  assert.deepEqual(seance.notesVocales, []);

  const note = { id: 'voc_1', fichier: 'voc_1.webm', mimeType: 'audio/webm', taille: 42, duree: 3.2,
                 transcription: 'Séance de côtes', createdAt: new Date().toISOString() };
  const avec = await svc.ajouterNoteVocale(seance.id, note);
  assert.equal(avec.notesVocales.length, 1);
  assert.equal(svc.trouverNoteVocale(seance.id, 'voc_1').transcription, 'Séance de côtes');
  assert.throws(() => svc.trouverNoteVocale(seance.id, 'voc_absent'), (erreur) => erreur.status === 404);

  assert.equal((await svc.supprimerNoteVocale(seance.id, 'voc_1')).notesVocales.length, 0);
  await attendreErreur(() => svc.supprimerNoteVocale(seance.id, 'voc_1'), 404);
});

test('list filtre par statut et peut inclure les archives', async () => {
  const svc = service();
  const faite = await svc.create({ ...base, statut: 'effectuee' });
  await svc.create({ ...base, locationId: 'grasse-stadium' });
  const archivee = await svc.create({ ...base, locationId: 'valbonne-hill' });
  await svc.archive(archivee.id);

  assert.equal(svc.list().length, 2);
  assert.equal(svc.list({ statut: 'effectuee' })[0].id, faite.id);
  assert.equal(svc.list({ statut: 'prevue' }).length, 1);
  assert.equal(svc.list({ archivees: true }).length, 3);
  await attendreErreur(() => svc.list({ statut: 'inconnu' }), 400);
});

test('list filtre par période, lieu et heure, et trie le résultat', async () => {
  const svc = service();
  await svc.create({ date: '2026-09-16', time: '18:30', locationId: 'valbonne-hill' });
  await svc.create({ date: '2026-09-14', time: '18:30', locationId: 'grasse-stadium' });
  await svc.create({ date: '2026-09-14', time: '18:00', locationId: 'valbonne-hill' });

  assert.deepEqual(
    svc.list().map((s) => `${s.date} ${s.time}`),
    ['2026-09-14 18:00', '2026-09-14 18:30', '2026-09-16 18:30']
  );
  assert.equal(svc.list({ from: '2026-09-15' }).length, 1);
  assert.equal(svc.list({ to: '2026-09-15' }).length, 2);
  assert.equal(svc.list({ locationId: 'valbonne-hill' }).length, 2);
  assert.equal(svc.list({ time: '18:30' }).length, 2);
  assert.equal(svc.list({ from: '2026-09-14', to: '2026-09-14', time: '18:00' }).length, 1);

  await attendreErreur(() => svc.list({ from: 'hier' }), 400);
  await attendreErreur(() => svc.list({ time: '20:00' }), 400);
  await attendreErreur(() => svc.list({ locationId: 'monaco' }), 400);
});
