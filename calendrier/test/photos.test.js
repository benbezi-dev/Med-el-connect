/* Les photos, et surtout : qui a le droit de les voir.

   Une photo arrive cachée. Tant que le coach ne l'a pas montrée, elle ne doit
   apparaître ni dans les listes, ni dans la grille, ni à son adresse propre —
   même devinée. C'est ce que vérifie l'essentiel de ce fichier. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');
const { PhotoStore, TAILLE_MAX } = require('../src/photos');

const CLE_COACH = 'cle-de-test';

// Un PNG 1×1 valide : assez pour traverser tout le circuit de stockage.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function demarrer() {
  const serveur = http.createServer(await createApp({ dataFile: null, cleCoach: CLE_COACH }));
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const appeler = async (chemin, options = {}) => {
    const corps = options.body ? JSON.stringify(options.body) : undefined;
    const entetes = {};
    if (corps !== undefined) entetes['Content-Type'] = 'application/json';
    if (options.coach) entetes['X-Cle-Coach'] = CLE_COACH;
    const reponse = await fetch(base + chemin, {
      method: options.method ?? 'GET',
      headers: Object.keys(entetes).length ? entetes : undefined,
      body: corps
    });
    const octets = Buffer.from(await reponse.arrayBuffer());
    const json = reponse.headers.get('content-type')?.includes('json');
    return {
      status: reponse.status,
      headers: reponse.headers,
      octets,
      body: json && octets.length ? JSON.parse(octets.toString('utf8')) : octets.toString('utf8')
    };
  };

  /** Une séance et une photo dessus, toutes deux posées par le coach. */
  const seanceAvecPhoto = async (legende = 'Fractionné du mardi') => {
    const { body: creee } = await appeler('/api/sessions', {
      method: 'POST',
      coach: true,
      body: { date: '2026-09-14', time: '18:30', locationId: 'valbonne-city-workout' }
    });
    const { body: ajoutee } = await appeler(`/api/sessions/${creee.session.id}/photos`, {
      method: 'POST',
      coach: true,
      body: { image: PNG.toString('base64'), mimeType: 'image/png', legende }
    });
    return { sessionId: creee.session.id, photo: ajoutee.photo };
  };

  return { appeler, seanceAvecPhoto, fermer: () => new Promise((resolve) => serveur.close(resolve)) };
}

test('une photo arrive cachée, jamais visible d’elle-même', async (t) => {
  const { seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { photo } = await seanceAvecPhoto();
  assert.equal(photo.visible, false, 'le coach doit décider, pas l’envoi');
  assert.equal(photo.legende, 'Fractionné du mardi');
  assert.equal(photo.mimeType, 'image/png');
  assert.equal(photo.taille, PNG.length);
});

test('l’équipe ne voit pas une photo cachée, où qu’elle la cherche', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();

  const liste = await appeler(`/api/sessions/${sessionId}/photos`);
  assert.deepEqual(liste.body.photos, [], 'ni dans la liste des photos');

  const seance = await appeler(`/api/sessions/${sessionId}`);
  assert.deepEqual(seance.body.session.photos, [], 'ni dans le détail de la séance');

  const toutes = await appeler('/api/sessions');
  assert.deepEqual(toutes.body.sessions[0].photos, [], 'ni dans la liste des séances');

  const grille = await appeler('/api/calendar?start=2026-09-14&days=7');
  const trouvees = JSON.stringify(grille.body).includes(photo.id);
  assert.equal(trouvees, false, 'ni au fond de la grille');

  const exporte = await appeler('/api/export');
  assert.equal(JSON.stringify(exporte.body).includes(photo.id), false, 'ni dans l’export');
});

test('l’adresse d’une photo cachée ne la livre pas, même devinée', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();

  const anonyme = await appeler(`/api/sessions/${sessionId}/photos/${photo.id}`);
  assert.equal(anonyme.status, 404, 'une photo cachée est introuvable pour l’équipe');

  const duCoach = await appeler(`/api/sessions/${sessionId}/photos/${photo.id}`, { coach: true });
  assert.equal(duCoach.status, 200);
  assert.deepEqual(duCoach.octets, PNG, 'le coach, lui, récupère bien l’image');
  assert.equal(duCoach.headers.get('cache-control'), 'private, max-age=3600', 'et sans cache partagé');
});

test('le coach la montre, et l’équipe la voit enfin', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();

  const montree = await appeler(`/api/sessions/${sessionId}/photos/${photo.id}`, {
    method: 'PATCH',
    coach: true,
    body: { visible: true }
  });
  assert.equal(montree.status, 200);
  assert.equal(montree.body.session.photos[0].visible, true);

  const liste = await appeler(`/api/sessions/${sessionId}/photos`);
  assert.equal(liste.body.photos.length, 1, 'elle apparaît maintenant à l’équipe');
  assert.equal(liste.body.photos[0].legende, 'Fractionné du mardi');

  const image = await appeler(`/api/sessions/${sessionId}/photos/${photo.id}`);
  assert.equal(image.status, 200);
  assert.deepEqual(image.octets, PNG);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal(image.headers.get('cache-control'), 'public, max-age=86400');
});

test('le coach peut la recacher, et elle redisparaît', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();
  const chemin = `/api/sessions/${sessionId}/photos/${photo.id}`;

  await appeler(chemin, { method: 'PATCH', coach: true, body: { visible: true } });
  assert.equal((await appeler(chemin)).status, 200);

  await appeler(chemin, { method: 'PATCH', coach: true, body: { visible: false } });
  assert.equal((await appeler(chemin)).status, 404, 'recachée, elle redevient introuvable');
  assert.deepEqual((await appeler(`/api/sessions/${sessionId}/photos`)).body.photos, []);
});

test('seul le coach ajoute, montre ou supprime une photo', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();
  const chemin = `/api/sessions/${sessionId}/photos/${photo.id}`;

  const ajout = await appeler(`/api/sessions/${sessionId}/photos`, {
    method: 'POST',
    body: { image: PNG.toString('base64'), mimeType: 'image/png' }
  });
  assert.equal(ajout.status, 401);

  const bascule = await appeler(chemin, { method: 'PATCH', body: { visible: true } });
  assert.equal(bascule.status, 401, 'un athlète ne se donne pas le droit de publier');

  assert.equal((await appeler(chemin, { method: 'DELETE' })).status, 401);
  assert.equal((await appeler(chemin, { coach: true })).status, 200, 'la photo est intacte');
});

test('la légende se corrige sans toucher à la visibilité', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();
  const chemin = `/api/sessions/${sessionId}/photos/${photo.id}`;

  await appeler(chemin, { method: 'PATCH', coach: true, body: { visible: true } });
  const { body } = await appeler(chemin, { method: 'PATCH', coach: true, body: { legende: '400 m en 58"' } });

  assert.equal(body.session.photos[0].legende, '400 m en 58"');
  assert.equal(body.session.photos[0].visible, true, 'la visibilité ne bouge pas toute seule');
});

test('supprimer une photo la retire de la séance et du dépôt', async (t) => {
  const { appeler, seanceAvecPhoto, fermer } = await demarrer();
  t.after(fermer);

  const { sessionId, photo } = await seanceAvecPhoto();
  const chemin = `/api/sessions/${sessionId}/photos/${photo.id}`;

  const { status, body } = await appeler(chemin, { method: 'DELETE', coach: true });
  assert.equal(status, 200);
  assert.equal(body.deleted, true);
  assert.deepEqual(body.session.photos, []);
  assert.equal((await appeler(chemin, { coach: true })).status, 404);
});

test('les envois mal formés sont refusés avant d’écrire', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { body: creee } = await appeler('/api/sessions', {
    method: 'POST',
    coach: true,
    body: { date: '2026-09-14', time: '18:30', locationId: 'valbonne-city-workout' }
  });
  const chemin = `/api/sessions/${creee.session.id}/photos`;

  const sansImage = await appeler(chemin, { method: 'POST', coach: true, body: { legende: 'rien' } });
  assert.equal(sansImage.status, 400);

  const mauvaisType = await appeler(chemin, {
    method: 'POST',
    coach: true,
    body: { image: PNG.toString('base64'), mimeType: 'application/pdf' }
  });
  assert.equal(mauvaisType.status, 400);
  assert.ok(mauvaisType.body.error.details.formatsAcceptes.includes('image/jpeg'));

  const legendeTropLongue = await appeler(chemin, {
    method: 'POST',
    coach: true,
    body: { image: PNG.toString('base64'), mimeType: 'image/png', legende: 'x'.repeat(201) }
  });
  assert.equal(legendeTropLongue.status, 400);

  assert.deepEqual((await appeler(chemin, { coach: true })).body.photos, [], 'rien n’a été écrit');
});

test('une photo sur une séance inconnue est un 404, sans rien stocker', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status } = await appeler('/api/sessions/ses_inexistante/photos', {
    method: 'POST',
    coach: true,
    body: { image: PNG.toString('base64'), mimeType: 'image/png' }
  });
  assert.equal(status, 404);
});

test('une data URL complète est acceptée telle quelle', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { body: creee } = await appeler('/api/sessions', {
    method: 'POST',
    coach: true,
    body: { date: '2026-09-14', time: '18:30', locationId: 'valbonne-city-workout' }
  });
  const { status, body } = await appeler(`/api/sessions/${creee.session.id}/photos`, {
    method: 'POST',
    coach: true,
    body: { image: `data:image/png;base64,${PNG.toString('base64')}`, mimeType: 'image/png' }
  });
  assert.equal(status, 201);
  assert.equal(body.photo.taille, PNG.length);
});

test('PhotoStore refuse une image trop lourde sans rien écrire', async () => {
  const depot = {
    ecrits: 0,
    async lire() { return null; },
    async ecrire() { this.ecrits += 1; },
    async supprimer() {}
  };
  const photos = new PhotoStore(depot);

  await assert.rejects(
    () => photos.enregistrer('ses_1', {
      image: Buffer.alloc(TAILLE_MAX + 1).toString('base64'),
      mimeType: 'image/jpeg'
    }),
    (erreur) => erreur.status === 400
  );
  assert.equal(depot.ecrits, 0, 'le dépôt n’a pas été touché');
});
