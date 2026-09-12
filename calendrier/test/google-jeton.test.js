const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lireConfiguration, FournisseurJeton, SCOPE_SERVICE, SCOPE_OAUTH } = require('../src/google-jeton');

const paire = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});

const CLE_SERVICE = JSON.stringify({
  client_email: 'calendrier@projet.iam.gserviceaccount.com',
  private_key: paire.privateKey
});

/** Faux point d'accès aux jetons : mémorise ce qu'on lui envoie. */
function fauxJetons(reponses = [{ access_token: 'jeton-1', expires_in: 3600 }]) {
  const recus = [];
  const requete = async (url, options) => {
    recus.push(new URLSearchParams(options.body));
    const reponse = reponses.shift() ?? { access_token: 'jeton-n', expires_in: 3600 };
    if (reponse.erreur) {
      return { ok: false, status: reponse.erreur, text: async () => reponse.corps ?? 'refus' };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(reponse) };
  };
  return { requete, recus };
}

test('lireConfiguration reconnaît le compte de service et OAuth', () => {
  const service = lireConfiguration({ GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE });
  assert.equal(service.type, 'service');
  assert.equal(service.email, 'calendrier@projet.iam.gserviceaccount.com');
  assert.equal(service.scope, SCOPE_SERVICE);

  const oauth = lireConfiguration({
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'rafraichir'
  });
  assert.equal(oauth.type, 'oauth');
  assert.equal(oauth.scope, SCOPE_OAUTH, 'sur un compte personnel, l’application ne touche qu’à ses fichiers');

  assert.equal(lireConfiguration({}), null, 'sans configuration, pas de Drive');
  assert.equal(lireConfiguration({ GOOGLE_CLIENT_ID: 'id' }), null, 'une identification OAuth incomplète est ignorée');
});

test('la clé du compte de service peut venir d’un fichier, et est contrôlée', (t) => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-google-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));

  const fichier = path.join(dossier, 'cle.json');
  fs.writeFileSync(fichier, CLE_SERVICE);
  assert.equal(lireConfiguration({ GOOGLE_SERVICE_ACCOUNT_KEY_FILE: fichier }).type, 'service');

  assert.throws(() => lireConfiguration({ GOOGLE_SERVICE_ACCOUNT_KEY: 'pas du json' }), /JSON valide/);
  assert.throws(
    () => lireConfiguration({ GOOGLE_SERVICE_ACCOUNT_KEY: '{"client_email":"a@b.c"}' }),
    /client_email.*private_key/
  );
});

test('le compte de service signe un JWT vérifiable', async () => {
  const { requete, recus } = fauxJetons();
  const configuration = lireConfiguration({ GOOGLE_SERVICE_ACCOUNT_KEY: CLE_SERVICE });
  const fournisseur = new FournisseurJeton(configuration, {
    requete,
    urlJeton: 'https://oauth2.googleapis.com/token',
    horloge: () => 1_700_000_000_000
  });

  assert.equal(await fournisseur.jeton(), 'jeton-1');
  assert.equal(recus[0].get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');

  const [entete, revendications, signature] = recus[0].get('assertion').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(entete, 'base64url')), { alg: 'RS256', typ: 'JWT' });

  const contenu = JSON.parse(Buffer.from(revendications, 'base64url'));
  assert.equal(contenu.iss, 'calendrier@projet.iam.gserviceaccount.com');
  assert.equal(contenu.scope, SCOPE_SERVICE);
  assert.equal(contenu.aud, 'https://oauth2.googleapis.com/token');
  assert.equal(contenu.iat, 1_700_000_000);
  assert.equal(contenu.exp, 1_700_003_600);

  const valide = crypto
    .createVerify('RSA-SHA256')
    .update(`${entete}.${revendications}`)
    .end()
    .verify(paire.publicKey, Buffer.from(signature, 'base64url'));
  assert.equal(valide, true, 'Google doit pouvoir vérifier la signature');
});

test('OAuth échange le jeton de rafraîchissement', async () => {
  const { requete, recus } = fauxJetons();
  const configuration = lireConfiguration({
    GOOGLE_CLIENT_ID: 'id',
    GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REFRESH_TOKEN: 'rafraichir'
  });

  assert.equal(await new FournisseurJeton(configuration, { requete }).jeton(), 'jeton-1');
  assert.equal(recus[0].get('grant_type'), 'refresh_token');
  assert.equal(recus[0].get('refresh_token'), 'rafraichir');
  assert.equal(recus[0].get('client_secret'), 'secret');
});

test('le jeton est gardé jusqu’à une minute avant son expiration', async () => {
  const { requete, recus } = fauxJetons([
    { access_token: 'jeton-1', expires_in: 3600 },
    { access_token: 'jeton-2', expires_in: 3600 }
  ]);
  let instant = 0;
  const fournisseur = new FournisseurJeton(
    { type: 'oauth', clientId: 'a', clientSecret: 'b', jetonRafraichissement: 'c' },
    { requete, horloge: () => instant }
  );

  assert.equal(await fournisseur.jeton(), 'jeton-1');
  instant = 3500 * 1000;
  assert.equal(await fournisseur.jeton(), 'jeton-1', 'toujours valable');
  assert.equal(recus.length, 1, 'un seul échange');

  instant = 3541 * 1000; // passé expires_in - 60
  assert.equal(await fournisseur.jeton(), 'jeton-2');
  assert.equal(recus.length, 2);
});

test('deux demandes simultanées ne font qu’un échange', async () => {
  const { requete, recus } = fauxJetons();
  const fournisseur = new FournisseurJeton(
    { type: 'oauth', clientId: 'a', clientSecret: 'b', jetonRafraichissement: 'c' },
    { requete }
  );

  const [un, deux] = await Promise.all([fournisseur.jeton(), fournisseur.jeton()]);
  assert.equal(un, 'jeton-1');
  assert.equal(deux, 'jeton-1');
  assert.equal(recus.length, 1);
});

test('un refus de Google remonte clairement', async () => {
  const refus = fauxJetons([{ erreur: 400, corps: '{"error":"invalid_grant"}' }]);
  const fournisseur = new FournisseurJeton(
    { type: 'oauth', clientId: 'a', clientSecret: 'b', jetonRafraichissement: 'perime' },
    { requete: refus.requete }
  );
  await assert.rejects(() => fournisseur.jeton(), /refuse l’identification \(400\).*invalid_grant/s);

  const vide = fauxJetons([{ expires_in: 3600 }]);
  await assert.rejects(
    () => new FournisseurJeton({ type: 'oauth' }, { requete: vide.requete }).jeton(),
    /pas renvoyé de jeton/
  );
});
