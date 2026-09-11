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

test('remove supprime puis renvoie 404', () => {
  const svc = service();
  const seance = svc.create(base);
  assert.equal(svc.remove(seance.id).id, seance.id);
  assert.equal(svc.list().length, 0);
  attendreErreur(() => svc.remove(seance.id), 404);
  attendreErreur(() => svc.get(seance.id), 404);
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
