const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');
const { DepotMemoire } = require('../src/stockage');
const { DepotFichier } = require('../src/depot-fichier');

function dossierTemporaire(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'calendrier-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

async function service(depot) {
  return new SessionService(await new Store(depot).charger());
}

test('les séances survivent à un redémarrage', async (t) => {
  const depot = new DepotFichier(path.join(dossierTemporaire(t), 'sous-dossier'));

  const premier = await service(depot);
  const seance = await premier.create({ date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium', title: 'Piste' });

  const second = await service(depot); // relecture depuis le disque
  assert.equal(second.list().length, 1);
  assert.equal(second.get(seance.id).title, 'Piste');

  // Archivée, la séance reste sur le disque après un nouveau redémarrage.
  await second.archive(seance.id);
  const troisieme = await service(depot);
  assert.equal(troisieme.list().length, 0);
  assert.equal(troisieme.list({ archivees: true }).length, 1);
  assert.equal(troisieme.get(seance.id).title, 'Piste');
});

test('un document absent, vide ou sans clé sessions démarre à vide', async (t) => {
  const dossier = dossierTemporaire(t);
  const depot = new DepotFichier(dossier);
  assert.deepEqual((await new Store(depot).charger()).all(), []);

  fs.writeFileSync(path.join(dossier, 'sessions.json'), '   ');
  assert.deepEqual((await new Store(depot).charger()).all(), []);

  fs.writeFileSync(path.join(dossier, 'sessions.json'), '{}');
  assert.deepEqual((await new Store(depot).charger()).all(), []);
});

test('un document corrompu refuse de démarrer plutôt que d’effacer', async (t) => {
  const dossier = dossierTemporaire(t);
  fs.writeFileSync(path.join(dossier, 'sessions.json'), '{ "sessions": [');

  await assert.rejects(
    () => new Store(new DepotFichier(dossier)).charger(),
    (erreur) => /illisible/.test(erreur.message)
  );
});

test('l’écriture ne laisse aucun fichier temporaire derrière elle', async (t) => {
  const dossier = dossierTemporaire(t);
  const svc = await service(new DepotFichier(dossier));
  await svc.create({ date: '2026-09-14', time: '18:30', locationId: 'valbonne-hill' });

  assert.deepEqual(fs.readdirSync(dossier), ['sessions.json']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dossier, 'sessions.json'), 'utf8')).sessions.length, 1);
});

test('un dépôt qui refuse l’écriture laisse la mémoire intacte', async () => {
  const depot = new DepotMemoire();
  const svc = await service(depot);
  await svc.create({ date: '2026-09-14', time: '18:00', locationId: 'valbonne-hill' });

  // Le dépôt tombe : la séance suivante ne doit apparaître nulle part.
  depot.ecrire = async () => { throw new Error('dépôt injoignable'); };
  await assert.rejects(
    () => svc.create({ date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium' }),
    /injoignable/
  );
  assert.equal(svc.list().length, 1, 'la mémoire n’a pas bougé');

  // Le créneau reste donc libre pour un nouvel essai, une fois le dépôt revenu.
  depot.ecrire = DepotMemoire.prototype.ecrire.bind(depot);
  assert.ok(await svc.create({ date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium' }));
  assert.equal(svc.list().length, 2);
});
