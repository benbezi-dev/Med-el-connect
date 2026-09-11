const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const { SessionService } = require('../src/sessions');

function fichierTemporaire(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'calendrier-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  return path.join(dossier, 'sous-dossier', 'sessions.json');
}

test('les séances survivent à un redémarrage', (t) => {
  const fichier = fichierTemporaire(t);

  const premier = new SessionService(new Store(fichier));
  const seance = premier.create({ date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium', title: 'Piste' });

  const second = new SessionService(new Store(fichier)); // relecture depuis le disque
  assert.equal(second.list().length, 1);
  assert.equal(second.get(seance.id).title, 'Piste');

  second.remove(seance.id);
  assert.equal(new SessionService(new Store(fichier)).list().length, 0);
});

test('un fichier absent, vide ou sans clé sessions démarre à vide', (t) => {
  const fichier = fichierTemporaire(t);
  assert.deepEqual(new Store(fichier).all(), []);

  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, '   ');
  assert.deepEqual(new Store(fichier).all(), []);

  fs.writeFileSync(fichier, '{}');
  assert.deepEqual(new Store(fichier).all(), []);
});

test('un JSON corrompu remonte en erreur plutôt que d’effacer silencieusement', (t) => {
  const fichier = fichierTemporaire(t);
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, '{ "sessions": [');
  assert.throws(() => new Store(fichier), SyntaxError);
});

test('l’écriture ne laisse aucun fichier temporaire derrière elle', (t) => {
  const fichier = fichierTemporaire(t);
  const service = new SessionService(new Store(fichier));
  service.create({ date: '2026-09-14', time: '18:30', locationId: 'valbonne-hill' });

  const restants = fs.readdirSync(path.dirname(fichier));
  assert.deepEqual(restants, ['sessions.json']);
  assert.ok(JSON.parse(fs.readFileSync(fichier, 'utf8')).sessions.length === 1);
});
