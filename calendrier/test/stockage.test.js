const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { creerDepot, DepotMemoire, segments } = require('../src/stockage');
const { DepotFichier } = require('../src/depot-fichier');

const CLE_SERVICE = JSON.stringify({
  client_email: 'calendrier@projet.iam.gserviceaccount.com',
  private_key: crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' }
  }).privateKey
});

test('sans identification Google, les données restent sur le disque', () => {
  const depot = creerDepot({ racine: '/tmp/calendrier-essai', env: {} });
  assert.equal(depot.decrire().type, 'fichier');
  assert.ok(depot instanceof DepotFichier);
});

test('avec une identification Google, les données partent sur Drive', () => {
  const service = creerDepot({ racine: '/tmp/x', env: { GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE } });
  assert.deepEqual(service.decrire(), { type: 'drive', emplacement: 'Calendrier entraînements' });

  const oauth = creerDepot({
    racine: '/tmp/x',
    env: {
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
      GOOGLE_REFRESH_TOKEN: 'rafraichir',
      GOOGLE_DRIVE_FOLDER_ID: 'dossier-42'
    }
  });
  assert.deepEqual(oauth.decrire(), { type: 'drive', emplacement: 'dossier dossier-42' });

  const nomme = creerDepot({
    racine: '/tmp/x',
    env: { GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE, GOOGLE_DRIVE_FOLDER_NAME: 'Entraînements 2026' }
  });
  assert.equal(nomme.decrire().emplacement, 'Entraînements 2026');
});

test('CALENDAR_STORAGE force le dépôt', () => {
  // Rester en local même si Google est configuré.
  const local = creerDepot({ racine: '/tmp/x', env: { CALENDAR_STORAGE: 'fichier', GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE } });
  assert.equal(local.decrire().type, 'fichier');

  assert.equal(creerDepot({ racine: '/tmp/x', env: { CALENDAR_STORAGE: 'memoire' } }).decrire().type, 'memoire');

  // Demander Drive sans identification est une erreur de configuration, pas
  // un repli silencieux sur le disque.
  assert.throws(
    () => creerDepot({ racine: '/tmp/x', env: { CALENDAR_STORAGE: 'drive' } }),
    /aucune identification Google/
  );
});

test('sans racine, tout reste en mémoire ; un dépôt fourni l’emporte', () => {
  assert.ok(creerDepot({ racine: null, env: {} }) instanceof DepotMemoire);
  assert.ok(creerDepot({ env: {} }) instanceof DepotMemoire);

  const impose = new DepotMemoire();
  assert.equal(creerDepot({ racine: '/tmp/x', env: { GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE }, depot: impose }), impose);
});

test('les chemins de stockage sont contrôlés', () => {
  assert.deepEqual(segments('notes-vocales/ses_1/voc_2.webm'), ['notes-vocales', 'ses_1', 'voc_2.webm']);
  for (const mauvais of ['', '/', '..', 'a/../b', 'a/b/../../../etc/passwd', 'dossier/sous dossier/x', null]) {
    assert.throws(() => segments(mauvais), (erreur) => erreur.status === 400, `accepté à tort : ${mauvais}`);
  }
});

test('le dépôt fichier range les données sous sa racine', async (t) => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'depot-'));
  t.after(() => fs.rmSync(racine, { recursive: true, force: true }));

  const depot = new DepotFichier(racine);
  await depot.ecrire('notes-vocales/ses_1/voc_1.webm', Buffer.from([1, 2, 3]), 'audio/webm');
  assert.deepEqual(await depot.lire('notes-vocales/ses_1/voc_1.webm'), Buffer.from([1, 2, 3]));
  assert.ok(fs.existsSync(path.join(racine, 'notes-vocales', 'ses_1', 'voc_1.webm')));
  assert.equal(await depot.lire('sessions.json'), null);
  assert.equal(depot.decrire().emplacement, racine);
});
