const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { DepotDrive, TYPE_DOSSIER } = require('../src/drive');
const { FournisseurJeton } = require('../src/google-jeton');
const { createApp } = require('../src/server');

/**
 * Faux Google Drive : arbre de fichiers en mémoire, servi par les routes
 * réellement appelées par le dépôt. Il enregistre chaque requête reçue, ce
 * qui permet de vérifier la forme des appels autant que le résultat.
 */
async function faussegoogle({ jetonAttendu = 'jeton-valide' } = {}) {
  const fichiers = new Map(); // id -> { id, name, parent, mimeType, contenu }
  const appels = [];
  let compteur = 0;
  let refuser401 = 0;

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://drive.test');
    const corps = await lireCorps(req);
    appels.push({ methode: req.method, chemin: url.pathname, requete: url.searchParams.get('q'), autorisation: req.headers.authorization });

    const repondre = (code, donnees) => {
      const texte = typeof donnees === 'string' || Buffer.isBuffer(donnees) ? donnees : JSON.stringify(donnees);
      res.writeHead(code, { 'Content-Type': Buffer.isBuffer(donnees) ? 'application/octet-stream' : 'application/json' });
      res.end(texte);
    };

    if (url.pathname === '/token') {
      return repondre(200, { access_token: jetonAttendu, expires_in: 3600 });
    }

    if (req.headers.authorization !== `Bearer ${jetonAttendu}` || refuser401 > 0) {
      if (refuser401 > 0) refuser401 -= 1;
      return repondre(401, { error: 'jeton invalide' });
    }

    // Recherche : name = '…' and '<parent>' in parents and trashed = false
    if (req.method === 'GET' && url.pathname === '/drive/v3/files') {
      const requete = url.searchParams.get('q') ?? '';
      const nom = (requete.match(/name = '((?:[^'\\]|\\.)*)'/) ?? [])[1]?.replace(/\\'/g, "'");
      const parent = (requete.match(/'([^']+)' in parents/) ?? [])[1];
      const type = (requete.match(/mimeType = '([^']+)'/) ?? [])[1];
      const trouves = [...fichiers.values()].filter(
        (f) => f.name === nom && f.parent === parent && (!type || f.mimeType === type)
      );
      return repondre(200, { files: trouves.map((f) => ({ id: f.id, name: f.name })) });
    }

    // Téléchargement
    const media = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (req.method === 'GET' && media) {
      const fichier = fichiers.get(media[1]);
      if (!fichier) return repondre(404, { error: 'absent' });
      return repondre(200, fichier.contenu);
    }

    // Création de dossier (JSON)
    if (req.method === 'POST' && url.pathname === '/drive/v3/files') {
      const metadonnees = JSON.parse(corps.toString());
      const id = `id-${++compteur}`;
      fichiers.set(id, { id, name: metadonnees.name, parent: metadonnees.parents[0], mimeType: metadonnees.mimeType, contenu: Buffer.alloc(0) });
      return repondre(200, { id });
    }

    // Création de fichier (multipart)
    if (req.method === 'POST' && url.pathname === '/upload/drive/v3/files') {
      const { metadonnees, contenu } = decouperMultipart(req.headers['content-type'], corps);
      const id = `id-${++compteur}`;
      fichiers.set(id, { id, name: metadonnees.name, parent: metadonnees.parents[0], mimeType: 'fichier', contenu });
      return repondre(200, { id });
    }

    // Mise à jour du contenu
    const majo = url.pathname.match(/^\/upload\/drive\/v3\/files\/([^/]+)$/);
    if (req.method === 'PATCH' && majo) {
      const fichier = fichiers.get(majo[1]);
      if (!fichier) return repondre(404, { error: 'absent' });
      fichier.contenu = corps;
      return repondre(200, { id: fichier.id });
    }

    if (req.method === 'DELETE' && media) {
      if (!fichiers.delete(media[1])) return repondre(404, { error: 'absent' });
      return repondre(204, '');
    }

    return repondre(404, { error: 'route inconnue' });
  });

  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const racine = `http://127.0.0.1:${serveur.address().port}`;

  return {
    racine,
    fichiers,
    appels,
    forcer401: (combien) => { refuser401 = combien; },
    depot: (options = {}) =>
      new DepotDrive({
        jeton: new FournisseurJeton(
          { type: 'oauth', clientId: 'a', clientSecret: 'b', jetonRafraichissement: 'c' },
          { urlJeton: `${racine}/token` }
        ),
        base: `${racine}/drive/v3`,
        baseUpload: `${racine}/upload/drive/v3`,
        ...options
      }),
    fermer: () => new Promise((resolve) => serveur.close(resolve))
  };
}

function lireCorps(req) {
  return new Promise((resolve) => {
    const morceaux = [];
    req.on('data', (m) => morceaux.push(m));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
  });
}

function decouperMultipart(contentType, corps) {
  const frontiere = `--${/boundary=(.+)$/.exec(contentType)[1]}`;
  const texte = corps.toString('latin1');
  const debutMeta = texte.indexOf('\r\n\r\n') + 4;
  const finMeta = texte.indexOf(frontiere, debutMeta) - 2;
  const debutContenu = texte.indexOf('\r\n\r\n', finMeta) + 4;
  const finContenu = texte.lastIndexOf(`\r\n${frontiere}--`);
  return {
    metadonnees: JSON.parse(texte.slice(debutMeta, finMeta)),
    contenu: corps.subarray(debutContenu, finContenu)
  };
}

test('le dossier est créé au premier usage, puis réutilisé', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot({ dossier: 'Calendrier entraînements' });

  await depot.ecrire('sessions.json', Buffer.from('{"sessions":[]}'), 'application/json');
  const dossiers = [...google.fichiers.values()].filter((f) => f.mimeType === TYPE_DOSSIER);
  assert.deepEqual(dossiers.map((d) => d.name), ['Calendrier entraînements']);
  assert.equal(dossiers[0].parent, 'root');

  // Deuxième écriture : plus aucune création de dossier.
  const avant = google.appels.filter((a) => a.methode === 'POST' && a.chemin === '/drive/v3/files').length;
  await depot.ecrire('sessions.json', Buffer.from('{"sessions":[1]}'), 'application/json');
  const apres = google.appels.filter((a) => a.methode === 'POST' && a.chemin === '/drive/v3/files').length;
  assert.equal(apres, avant, 'le dossier est mémorisé');
});

test('écrire deux fois met à jour le même fichier', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();

  await depot.ecrire('sessions.json', Buffer.from('un'), 'application/json');
  await depot.ecrire('sessions.json', Buffer.from('deux'), 'application/json');

  const documents = [...google.fichiers.values()].filter((f) => f.name === 'sessions.json');
  assert.equal(documents.length, 1, 'pas de doublon dans le dossier Drive');
  assert.equal(documents[0].contenu.toString(), 'deux');
  assert.equal((await depot.lire('sessions.json')).toString(), 'deux');
  assert.ok(google.appels.some((a) => a.methode === 'PATCH'), 'la seconde écriture est un PATCH');
});

test('les notes vocales créent leurs sous-dossiers', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();
  const son = Buffer.from([0, 1, 2, 250, 255]);

  await depot.ecrire('notes-vocales/ses_1/voc_1.webm', son, 'audio/webm');
  await depot.ecrire('notes-vocales/ses_1/voc_2.webm', Buffer.from('autre'), 'audio/webm');

  const dossiers = [...google.fichiers.values()].filter((f) => f.mimeType === TYPE_DOSSIER);
  assert.deepEqual(dossiers.map((d) => d.name), ['Calendrier entraînements', 'notes-vocales', 'ses_1']);

  // Le binaire revient octet pour octet.
  assert.deepEqual(await depot.lire('notes-vocales/ses_1/voc_1.webm'), son);
  assert.equal((await depot.lire('notes-vocales/ses_1/voc_2.webm')).toString(), 'autre');
});

test('lire un fichier absent renvoie null, le supprimer ne fait rien', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();

  assert.equal(await depot.lire('sessions.json'), null);
  await depot.supprimer('sessions.json'); // ne doit pas lever

  await depot.ecrire('sessions.json', Buffer.from('x'), 'application/json');
  await depot.supprimer('sessions.json');
  assert.equal(await depot.lire('sessions.json'), null);
  assert.equal([...google.fichiers.values()].filter((f) => f.name === 'sessions.json').length, 0);
});

test('un dossier imposé sert de racine, sans recherche par nom', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  google.fichiers.set('dossier-partage', { id: 'dossier-partage', name: 'Partagé', parent: 'root', mimeType: TYPE_DOSSIER, contenu: Buffer.alloc(0) });

  const depot = google.depot({ dossierId: 'dossier-partage' });
  await depot.ecrire('sessions.json', Buffer.from('x'), 'application/json');

  const document = [...google.fichiers.values()].find((f) => f.name === 'sessions.json');
  assert.equal(document.parent, 'dossier-partage');
  assert.deepEqual(depot.decrire(), { type: 'drive', emplacement: 'dossier dossier-partage' });
});

test('chaque appel porte le jeton, et un 401 déclenche un seul nouvel essai', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();

  await depot.ecrire('sessions.json', Buffer.from('x'), 'application/json');
  const appelsDrive = google.appels.filter((a) => a.chemin !== '/token');
  assert.ok(appelsDrive.length > 0);
  assert.ok(appelsDrive.every((a) => a.autorisation === 'Bearer jeton-valide'), 'toutes les requêtes sont signées');

  // Google renvoie une fois 401 : le dépôt renouvelle son jeton et réessaie.
  google.forcer401(1);
  assert.equal((await depot.lire('sessions.json')).toString(), 'x');
});

test('une erreur Drive remonte avec son code et son message', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();

  google.forcer401(5); // le nouvel essai échoue aussi
  await assert.rejects(
    () => depot.lire('sessions.json'),
    (erreur) => /Google Drive a refusé.*401/s.test(erreur.message)
  );
});

test('les noms à apostrophe sont échappés dans la recherche', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot({ dossier: "Calendrier d'Antibes" });

  await depot.ecrire('sessions.json', Buffer.from('x'), 'application/json');
  const recherche = google.appels.find((a) => a.requete && a.requete.includes('Calendrier'));
  assert.match(recherche.requete, /name = 'Calendrier d\\'Antibes'/);
  assert.equal([...google.fichiers.values()].filter((f) => f.mimeType === TYPE_DOSSIER).length, 1);
});

test('l’application complète tourne sur Drive, et retrouve tout au redémarrage', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();

  const premier = await createApp({ dataFile: null, depot, cleCoach: 'cle' });
  const seance = await premier.sessions.create({
    date: '2026-09-14',
    time: '18:30',
    locationId: 'valbonne-hill',
    title: 'Côtes'
  });
  await premier.sessions.update(seance.id, { statut: 'effectuee' });
  const note = await premier.voix.enregistrer(seance.id, {
    audio: Buffer.from('son de démonstration').toString('base64'),
    duree: 4,
    transcription: 'Penser aux plots'
  });
  await premier.sessions.ajouterNoteVocale(seance.id, note);

  // Tout est bien parti sur Drive, et nulle part ailleurs.
  const noms = [...google.fichiers.values()].map((f) => f.name).sort();
  assert.deepEqual(noms, ['Calendrier entraînements', 'notes-vocales', seance.id, 'sessions.json', note.fichier].sort());

  // Un second démarrage ne lit que Drive : les données doivent revenir entières.
  const second = await createApp({ dataFile: null, depot: google.depot(), cleCoach: 'cle' });
  const rechargee = second.sessions.get(seance.id);
  assert.equal(rechargee.title, 'Côtes');
  assert.equal(rechargee.statut, 'effectuee');
  assert.deepEqual(rechargee.historique.map((h) => h.statut), ['prevue', 'effectuee']);
  assert.equal(rechargee.notesVocales.length, 1);
  assert.equal(rechargee.notesVocales[0].transcription, 'Penser aux plots');
  assert.equal(
    (await second.voix.lire(seance.id, rechargee.notesVocales[0])).toString(),
    'son de démonstration',
    'le son se relit depuis Drive'
  );
});

test('Drive injoignable : le démarrage échoue au lieu de servir un calendrier vide', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);

  const depot = google.depot();
  await depot.ecrire('sessions.json', Buffer.from('{"sessions":[{"id":"ses_1"}]}'), 'application/json');

  const casse = google.depot();
  casse.lire = async () => { throw new Error('Google Drive injoignable'); };
  await assert.rejects(() => createApp({ dataFile: null, depot: casse, cleCoach: 'cle' }), /injoignable/);
});

test('une écriture refusée par Drive remonte et ne change rien', async (t) => {
  const google = await faussegoogle();
  t.after(google.fermer);
  const depot = google.depot();
  const app = await createApp({ dataFile: null, depot, cleCoach: 'cle' });

  await app.sessions.create({ date: '2026-09-14', time: '18:00', locationId: 'valbonne-hill' });
  google.forcer401(10); // Drive refuse tout

  await assert.rejects(
    () => app.sessions.create({ date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium' }),
    /Google Drive a refusé/
  );
  assert.equal(app.sessions.list().length, 1, 'la séance refusée n’est pas restée en mémoire');
});
