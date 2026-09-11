const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');

/** Démarre le serveur sur un port libre, avec un stockage en mémoire. */
async function demarrer() {
  const serveur = http.createServer(createApp({ dataFile: null }));
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const appeler = async (chemin, options = {}) => {
    const corps = options.raw ?? (options.body ? JSON.stringify(options.body) : undefined);
    const reponse = await fetch(base + chemin, {
      method: options.method ?? 'GET',
      headers: corps === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corps
    });
    const texte = await reponse.text();
    return {
      status: reponse.status,
      headers: reponse.headers,
      body: texte && reponse.headers.get('content-type')?.includes('json') ? JSON.parse(texte) : texte
    };
  };

  return { appeler, base, fermer: () => new Promise((resolve) => serveur.close(resolve)) };
}

const base = { date: '2026-09-14', time: '18:30', locationId: 'valbonne-city-workout' };

test('GET /api décrit les endpoints, les heures et les lieux', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status, body } = await appeler('/api');
  assert.equal(status, 200);
  assert.deepEqual(body.heuresPossibles, ['18:00', '18:30']);
  assert.equal(body.joursVisibles, 7, 'les utilisateurs ne voient qu’une semaine');
  assert.equal(body.moisHorizon, 12, 'la planification couvre un an');
  assert.deepEqual(body.statuts, ['prevue', 'effectuee', 'annulee']);
  assert.equal(body.lieux.length, 5);
  assert.ok(body.endpoints.some((e) => e.path.startsWith('/api/calendar')));
});

test('GET /api/locations et /api/times renvoient les référentiels', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const lieux = await appeler('/api/locations');
  assert.equal(lieux.status, 200);
  assert.equal(lieux.body.total, 5);
  assert.deepEqual(lieux.body.locations.map((l) => l.name), [
    'Antibes Fort Carré Stade',
    'Valbonne Stadium',
    'Grasse Stadium',
    'Valbonne Hill',
    'Valbonne City Workout'
  ]);

  const heures = await appeler('/api/times');
  assert.deepEqual(heures.body.times, ['18:00', '18:30']);
  assert.equal(heures.body.timezone, 'Europe/Paris');

  const sante = await appeler('/api/health');
  assert.equal(sante.body.status, 'ok');
});

test('GET /api/calendar renvoie la grille 7 jours', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status, body } = await appeler('/api/calendar?start=2026-09-11');
  assert.equal(status, 200);
  assert.equal(body.days.length, 7);
  assert.equal(body.rows.length, 2);
  assert.equal(body.rows[0].cells.length, 7);

  const invalide = await appeler('/api/calendar?start=demain');
  assert.equal(invalide.status, 400);
  assert.equal(invalide.body.error.code, 'invalid_request');
});

test('cycle de vie complet d’une séance via l’API', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const creation = await appeler('/api/sessions', { method: 'POST', body: { ...base, title: 'Renfo' } });
  assert.equal(creation.status, 201);
  const id = creation.body.session.id;
  assert.equal(creation.headers.get('location'), `/api/sessions/${id}`);
  assert.equal(creation.body.session.location.name, 'Valbonne City Workout');

  const lecture = await appeler(`/api/sessions/${id}`);
  assert.equal(lecture.status, 200);
  assert.equal(lecture.body.session.title, 'Renfo');

  const modification = await appeler(`/api/sessions/${id}`, { method: 'PATCH', body: { capacity: 8 } });
  assert.equal(modification.status, 200);
  assert.equal(modification.body.session.capacity, 8);
  assert.equal(modification.body.session.placesRestantes, 8);

  // La séance apparaît bien dans la grille, au bon créneau.
  const grille = await appeler('/api/calendar?start=2026-09-14');
  assert.equal(grille.body.rows[1].cells[0].sessions[0].id, id);
  assert.equal(grille.body.rows[1].cells[0].lieuxLibres.length, 4);

  // DELETE archive : la séance sort de la grille mais reste consultable.
  const archivage = await appeler(`/api/sessions/${id}`, { method: 'DELETE' });
  assert.equal(archivage.status, 200);
  assert.equal(archivage.body.session.archivee, true);
  assert.equal((await appeler(`/api/sessions/${id}`)).status, 200, 'rien n’est effacé');
  assert.equal((await appeler('/api/sessions')).body.total, 0);
  assert.equal((await appeler('/api/sessions?archivees=true')).body.total, 1);
  assert.equal((await appeler('/api/export')).body.total, 1);

  const restauration = await appeler(`/api/sessions/${id}/restaurer`, { method: 'POST' });
  assert.equal(restauration.status, 200);
  assert.equal(restauration.body.session.archivee, false);
  assert.equal((await appeler('/api/sessions')).body.total, 1);
});

test('POST /api/sessions valide l’entrée et signale les conflits', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const heureInterdite = await appeler('/api/sessions', { method: 'POST', body: { ...base, time: '19:00' } });
  assert.equal(heureInterdite.status, 400);
  assert.deepEqual(heureInterdite.body.error.details.heuresPossibles, ['18:00', '18:30']);

  const lieuInconnu = await appeler('/api/sessions', { method: 'POST', body: { ...base, locationId: 'nice' } });
  assert.equal(lieuInconnu.status, 400);
  assert.equal(lieuInconnu.body.error.details.lieuxPossibles.length, 5);

  await appeler('/api/sessions', { method: 'POST', body: base });
  const doublon = await appeler('/api/sessions', { method: 'POST', body: base });
  assert.equal(doublon.status, 409);
  assert.equal(doublon.body.error.code, 'conflict');
});

test('GET /api/sessions filtre par période, lieu et heure', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  await appeler('/api/sessions', { method: 'POST', body: { date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium' } });
  await appeler('/api/sessions', { method: 'POST', body: { date: '2026-09-16', time: '18:30', locationId: 'valbonne-hill' } });

  assert.equal((await appeler('/api/sessions')).body.total, 2);
  assert.equal((await appeler('/api/sessions?from=2026-09-15')).body.total, 1);
  assert.equal((await appeler('/api/sessions?location=grasse-stadium')).body.total, 1);
  assert.equal((await appeler('/api/sessions?time=18:30')).body.total, 1);
  assert.equal((await appeler('/api/sessions?time=17:00')).status, 400);
});

test('GET /api/annee suit la planification sur 12 mois', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  await appeler('/api/sessions', { method: 'POST', body: { date: '2026-11-05', time: '18:00', locationId: 'valbonne-hill', statut: 'effectuee' } });

  const { status, body } = await appeler('/api/annee?start=2026-09-11');
  assert.equal(status, 200);
  assert.equal(body.mois.length, 12);
  assert.equal(body.joursVisibles, 7);
  assert.equal(body.totaux.effectuee, 1);
  assert.equal(body.mois[2].totaux.total, 1, 'novembre porte la séance');

  assert.equal((await appeler('/api/annee?mois=40')).status, 400);
  assert.deepEqual((await appeler('/api/statuts')).body.statuts.map((s) => s.id), ['prevue', 'effectuee', 'annulee']);
});

test('le statut se change par PATCH et se filtre dans la grille', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const creation = await appeler('/api/sessions', { method: 'POST', body: base });
  const id = creation.body.session.id;
  assert.equal(creation.body.session.statut, 'prevue');

  const maj = await appeler(`/api/sessions/${id}`, { method: 'PATCH', body: { statut: 'effectuee' } });
  assert.equal(maj.status, 200);
  assert.equal(maj.body.session.statut, 'effectuee');
  assert.deepEqual(maj.body.session.historique.map((h) => h.statut), ['prevue', 'effectuee']);

  const grille = await appeler('/api/calendar?start=2026-09-14');
  assert.deepEqual(grille.body.days[0].totaux, { total: 1, prevue: 0, effectuee: 1, annulee: 0 });
  assert.deepEqual(grille.body.totaux, { total: 1, prevue: 0, effectuee: 1, annulee: 0 });

  assert.equal((await appeler('/api/sessions?statut=effectuee')).body.total, 1);
  assert.equal((await appeler('/api/sessions?statut=prevue')).body.total, 0);
  assert.equal((await appeler('/api/sessions?statut=reportee')).status, 400);
  assert.equal((await appeler(`/api/sessions/${id}`, { method: 'PATCH', body: { statut: 'reportee' } })).status, 400);
});

test('cycle de vie d’une note vocale', async (t) => {
  const { appeler, fermer, base: racine } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { method: 'POST', body: base })).body.session.id;
  const son = Buffer.from('bip bip bip');

  const ajout = await appeler(`/api/sessions/${id}/notes-vocales`, {
    method: 'POST',
    body: { audio: son.toString('base64'), mimeType: 'audio/webm', duree: 5.5, transcription: 'Penser aux plots' }
  });
  assert.equal(ajout.status, 201);
  const note = ajout.body.noteVocale;
  assert.equal(note.duree, 5.5);
  assert.equal(note.transcription, 'Penser aux plots');
  assert.equal(ajout.body.session.notesVocales.length, 1);
  assert.equal(ajout.headers.get('location'), `/api/sessions/${id}/notes-vocales/${note.id}`);

  // La liste et la séance portent la note.
  assert.equal((await appeler(`/api/sessions/${id}/notes-vocales`)).body.notesVocales.length, 1);
  assert.equal((await appeler(`/api/sessions/${id}`)).body.session.notesVocales[0].id, note.id);

  // Le son se relit tel quel, avec son type.
  const lecture = await fetch(`${racine}/api/sessions/${id}/notes-vocales/${note.id}`);
  assert.equal(lecture.status, 200);
  assert.equal(lecture.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(Buffer.from(await lecture.arrayBuffer()), son);

  const suppression = await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`, { method: 'DELETE' });
  assert.equal(suppression.status, 200);
  assert.equal(suppression.body.session.notesVocales.length, 0);
  assert.equal((await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`)).status, 404);
});

test('une note vocale invalide ou orpheline est refusée', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { method: 'POST', body: base })).body.session.id;

  assert.equal((await appeler('/api/sessions/ses_inconnu/notes-vocales', { method: 'POST', body: { audio: 'AAAA' } })).status, 404);

  const sansAudio = await appeler(`/api/sessions/${id}/notes-vocales`, { method: 'POST', body: { duree: 3 } });
  assert.equal(sansAudio.status, 400);

  const mauvaisFormat = await appeler(`/api/sessions/${id}/notes-vocales`, {
    method: 'POST',
    body: { audio: Buffer.from('x').toString('base64'), mimeType: 'audio/aiff' }
  });
  assert.equal(mauvaisFormat.status, 400);
  assert.ok(mauvaisFormat.body.error.details.formatsAcceptes.includes('audio/webm'));

  // La séance reste propre après ces refus.
  assert.deepEqual((await appeler(`/api/sessions/${id}`)).body.session.notesVocales, []);
});

test('route inconnue et méthode interdite', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  assert.equal((await appeler('/api/inconnu')).status, 404);
  assert.equal((await appeler('/api/sessions/abc/def')).status, 404);

  const interdite = await appeler('/api/locations', { method: 'POST', body: {} });
  assert.equal(interdite.status, 405);
  assert.deepEqual(interdite.body.error.details.autorisees, ['GET']);
});

test('un corps non-JSON est refusé en 400', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const casse = await appeler('/api/sessions', { method: 'POST', raw: '{ date: 2026-09-14' });
  assert.equal(casse.status, 400);
  assert.equal(casse.body.error.code, 'invalid_request');

  // Un corps vide reste du JSON valide : c'est la validation métier qui répond.
  const vide = await appeler('/api/sessions', { method: 'POST', raw: '' });
  assert.equal(vide.status, 400);
  assert.match(vide.body.error.message, /date/);

  // Un tableau n'est pas un objet de séance.
  const tableau = await appeler('/api/sessions', { method: 'POST', raw: '[]' });
  assert.equal(tableau.status, 400);
});

test('un corps trop volumineux est refusé en 413, réponse comprise', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const enorme = JSON.stringify({
    date: '2026-09-14',
    time: '18:00',
    locationId: 'valbonne-hill',
    notes: 'x'.repeat(70 * 1024)
  });

  const reponse = await appeler('/api/sessions', { method: 'POST', raw: enorme });
  assert.equal(reponse.status, 413, 'la réponse doit parvenir au client, pas une connexion coupée');
  assert.equal(reponse.body.error.code, 'payload_too_large');

  // Le serveur reste utilisable derrière une nouvelle connexion.
  assert.equal((await appeler('/api/health')).status, 200);
});

test('les préflights CORS sont acceptés', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status, headers } = await appeler('/api/sessions', { method: 'OPTIONS' });
  assert.equal(status, 204);
  assert.equal(headers.get('access-control-allow-origin'), '*');
  assert.match(headers.get('access-control-allow-methods'), /POST/);
});

test('la page 7 jours est servie et la traversée de chemin bloquée', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const page = await appeler('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /Calendrier des entraînements/);

  assert.equal((await appeler('/styles.css')).status, 200);
  assert.equal((await appeler('/app.js')).status, 200);
  assert.equal((await appeler('/%2e%2e/package.json')).status, 404);
  assert.equal((await appeler('/nexistepas.html')).status, 404);
});
