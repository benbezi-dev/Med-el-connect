const test = require('node:test');
const assert = require('node:assert/strict');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');
const { buildAnnee } = require('../src/annee');

function service() {
  return new SessionService(new Store(null));
}

test('la vue couvre 12 mois pleins à partir du mois de départ', async () => {
  const annee = buildAnnee(service(), { start: '2026-09-11' });

  assert.equal(annee.debut, '2026-09-01', 'le mois de départ commence au 1er');
  assert.equal(annee.fin, '2027-08-31', 'et l’horizon se termine en fin de mois');
  assert.equal(annee.mois.length, 12);
  assert.equal(annee.moisHorizon, 12);
  assert.equal(annee.joursVisibles, 7, 'les utilisateurs n’en voient qu’une semaine');
  assert.equal(annee.mois[0].label, 'septembre 2026');
  assert.equal(annee.mois[11].label, 'août 2027');
});

test('les totaux sont ventilés par statut, par mois et par jour occupé', async () => {
  const svc = service();
  await svc.create({ date: '2026-09-12', time: '18:00', locationId: 'grasse-stadium', statut: 'effectuee' });
  await svc.create({ date: '2026-09-12', time: '18:30', locationId: 'grasse-stadium' });
  await svc.create({ date: '2026-12-24', time: '18:30', locationId: 'valbonne-hill', statut: 'annulee' });
  await svc.create({ date: '2027-07-01', time: '18:00', locationId: 'valbonne-stadium' });

  const annee = buildAnnee(svc, { start: '2026-09-11' });
  assert.deepEqual(annee.totaux, { total: 4, prevue: 2, effectuee: 1, annulee: 1 });

  const septembre = annee.mois[0];
  assert.deepEqual(septembre.totaux, { total: 2, prevue: 1, effectuee: 1, annulee: 0 });
  assert.deepEqual(septembre.jours.map((j) => j.date), ['2026-09-12'], 'seuls les jours occupés sont listés');
  assert.equal(septembre.jours[0].totaux.total, 2);

  assert.equal(annee.mois[1].totaux.total, 0, 'octobre est vide');
  assert.deepEqual(annee.mois[1].jours, []);
  assert.equal(annee.mois[3].totaux.annulee, 1, 'décembre porte l’annulation');
});

test('les séances hors horizon et les archives sont exclues', async () => {
  const svc = service();
  await svc.create({ date: '2026-08-31', time: '18:00', locationId: 'valbonne-hill' }); // avant l'horizon
  await svc.create({ date: '2027-09-01', time: '18:00', locationId: 'valbonne-hill' }); // après
  const archivee = await svc.create({ date: '2026-10-05', time: '18:00', locationId: 'valbonne-hill' });
  await svc.archive(archivee.id);

  const annee = buildAnnee(svc, { start: '2026-09-11' });
  assert.equal(annee.totaux.total, 0);
});

test('l’horizon est réglable et validé', async () => {
  const svc = service();
  assert.equal(buildAnnee(svc, { start: '2026-09-11', mois: 3 }).mois.length, 3);
  assert.equal(buildAnnee(svc, { start: '2026-09-11', mois: 3 }).fin, '2026-11-30');

  for (const options of [{ start: 'janvier' }, { mois: 0 }, { mois: 30 }, { mois: 'douze' }]) {
    assert.throws(() => buildAnnee(svc, options), (error) => error.status === 400);
  }
});

test('sans start, l’horizon démarre au mois courant', async () => {
  const annee = buildAnnee(service());
  assert.equal(annee.debut, `${annee.today.slice(0, 7)}-01`);
  assert.equal(annee.mois[0].estMoisCourant, true);
});
