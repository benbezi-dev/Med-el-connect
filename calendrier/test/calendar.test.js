const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');
const { buildCalendar } = require('../src/calendar');
const { LOCATIONS, TIMES } = require('../src/reference');

function service() {
  return new SessionService(new Store(null));
}

test('la grille fait 7 jours et une ligne par heure possible', async () => {
  const grille = buildCalendar(service(), { start: '2026-09-11' });

  assert.equal(grille.start, '2026-09-11');
  assert.equal(grille.end, '2026-09-17');
  assert.equal(grille.days.length, 7);
  assert.deepEqual(grille.times, ['10:30', '18:00', '18:30']);
  assert.equal(grille.rows.length, TIMES.length);
  for (const ligne of grille.rows) {
    assert.equal(ligne.cells.length, 7, 'une cellule par jour');
  }
  assert.deepEqual(grille.rows.map((r) => r.time), ['10:30', '18:00', '18:30'],
    'les lignes suivent l’ordre de la journée');
  assert.equal(grille.locations.length, 5);
  assert.deepEqual(grille.locations.map((l) => l.name), LOCATIONS.map((l) => l.name));
});

test('le créneau de 10:30 vit sa propre ligne, indépendante du soir', async () => {
  const svc = service();
  const matin = await svc.create({ date: '2026-09-12', time: '10:30', locationId: 'valbonne-hill', title: 'Sortie longue' });
  // Le même lieu peut resservir le soir : ce sont deux créneaux distincts.
  await svc.create({ date: '2026-09-12', time: '18:00', locationId: 'valbonne-hill' });

  const grille = buildCalendar(svc, { start: '2026-09-12' });
  const [ligne1030, ligne1800, ligne1830] = grille.rows;

  assert.equal(ligne1030.cells[0].sessions[0].id, matin.id);
  assert.equal(ligne1030.cells[0].sessions[0].title, 'Sortie longue');
  assert.equal(ligne1030.cells[0].lieuxLibres.length, 4, 'le lieu du matin est pris, les autres non');
  assert.equal(ligne1800.cells[0].sessions.length, 1);
  assert.equal(ligne1830.cells[0].sessions.length, 0);
  assert.equal(grille.days[0].totaux.total, 2, 'les deux séances comptent pour le même jour');

  // Et le doublon reste interdit à l'intérieur du créneau du matin.
  await assert.rejects(
    () => svc.create({ date: '2026-09-12', time: '10:30', locationId: 'valbonne-hill' }),
    (erreur) => erreur.status === 409
  );
});

test('la navigation avance et recule de 7 jours', async () => {
  const grille = buildCalendar(service(), { start: '2026-09-11' });
  assert.equal(grille.previousStart, '2026-09-04');
  assert.equal(grille.nextStart, '2026-09-18');
});

test('chaque séance tombe dans la bonne cellule jour x heure', async () => {
  const svc = service();
  await svc.create({ date: '2026-09-13', time: '18:30', locationId: 'grasse-stadium', title: 'Côtes' });
  await svc.create({ date: '2026-09-13', time: '18:30', locationId: 'valbonne-hill' });
  await svc.create({ date: '2026-09-11', time: '18:00', locationId: 'antibes-fort-carre-stade' });

  const grille = buildCalendar(svc, { start: '2026-09-11' });
  const [ligne1030, ligne1800, ligne1830] = grille.rows;

  assert.equal(grille.total, 3);
  assert.equal(ligne1030.cells.every((c) => c.sessions.length === 0), true, 'rien à 10:30');
  assert.equal(ligne1800.cells[0].sessions.length, 1);
  assert.equal(ligne1800.cells[0].sessions[0].location.name, 'Antibes Fort Carré Stade');
  assert.equal(ligne1830.cells[0].sessions.length, 0);
  assert.equal(ligne1830.cells[2].sessions.length, 2, 'deux lieux en parallèle le 13 à 18:30');
  assert.equal(ligne1830.cells[2].lieuxLibres.length, 3);
  assert.equal(ligne1830.cells[2].complet, false);
});

test('une cellule est complète quand les 5 lieux sont pris', async () => {
  const svc = service();
  for (const lieu of LOCATIONS) {
    await svc.create({ date: '2026-09-12', time: '18:00', locationId: lieu.id });
  }
  const cellule = buildCalendar(svc, { start: '2026-09-12' }).rows
    .find((r) => r.time === '18:00').cells[0];
  assert.equal(cellule.sessions.length, 5);
  assert.deepEqual(cellule.lieuxLibres, []);
  assert.equal(cellule.complet, true);
});

test('les séances hors fenêtre sont ignorées', async () => {
  const svc = service();
  await svc.create({ date: '2026-09-10', time: '18:00', locationId: 'valbonne-hill' }); // veille
  await svc.create({ date: '2026-09-18', time: '18:00', locationId: 'valbonne-hill' }); // lendemain de fin
  await svc.create({ date: '2026-09-17', time: '18:00', locationId: 'valbonne-hill' }); // dernier jour inclus

  const grille = buildCalendar(svc, { start: '2026-09-11' });
  assert.equal(grille.total, 1);
  assert.equal(grille.rows.find((r) => r.time === '18:00').cells[6].sessions.length, 1);
});

test('les paramètres invalides sont rejetés en 400', async () => {
  const svc = service();
  for (const options of [{ start: 'lundi' }, { start: '2026-09-31' }, { days: 0 }, { days: 400 }, { days: 'sept' }]) {
    assert.throws(() => buildCalendar(svc, options), (error) => error.status === 400);
  }
  assert.equal(buildCalendar(svc, { days: 14 }).days.length, 14);
  assert.equal(buildCalendar(svc, { days: 366 }).days.length, 366, 'la grille peut couvrir une année');
});

test('sans start, la fenêtre démarre aujourd’hui', async () => {
  const grille = buildCalendar(service());
  assert.equal(grille.start, grille.today);
  assert.equal(grille.days[0].isToday, true);
  assert.equal(grille.timezone, 'Europe/Paris');
});
