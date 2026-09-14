const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');

const CLE_COACH = 'cle-de-test';

/** Démarre le serveur sur un port libre, avec un stockage en mémoire. */
async function demarrer() {
  const serveur = http.createServer(await createApp({ dataFile: null, cleCoach: CLE_COACH }));
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const appeler = async (chemin, options = {}) => {
    const corps = options.raw ?? (options.body ? JSON.stringify(options.body) : undefined);
    const entetes = {};
    if (corps !== undefined) entetes['Content-Type'] = 'application/json';
    if (options.coach) entetes['X-Cle-Coach'] = CLE_COACH;
    const reponse = await fetch(base + chemin, {
      method: options.method ?? 'GET',
      headers: Object.keys(entetes).length ? entetes : undefined,
      body: corps
    });
    const texte = await reponse.text();
    return {
      status: reponse.status,
      headers: reponse.headers,
      body: texte && reponse.headers.get('content-type')?.includes('json') ? JSON.parse(texte) : texte
    };
  };

  return { appeler, base, cle: CLE_COACH, fermer: () => new Promise((resolve) => serveur.close(resolve)) };
}

const base = { date: '2026-09-14', time: '18:30', locationId: 'valbonne-city-workout' };

test('GET /api décrit les endpoints, les heures et les lieux', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status, body } = await appeler('/api');
  assert.equal(status, 200);
  assert.deepEqual(body.heuresPossibles, ['10:30', '18:00', '18:30']);
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
  assert.deepEqual(heures.body.times, ['10:30', '18:00', '18:30']);
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
  assert.equal(body.rows.length, 3, 'une ligne par créneau possible');
  assert.deepEqual(body.rows.map((r) => r.time), ['10:30', '18:00', '18:30']);
  assert.equal(body.rows[0].cells.length, 7);

  const invalide = await appeler('/api/calendar?start=demain');
  assert.equal(invalide.status, 400);
  assert.equal(invalide.body.error.code, 'invalid_request');
});

test('cycle de vie complet d’une séance via l’API', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const creation = await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, title: 'Renfo' } });
  assert.equal(creation.status, 201);
  const id = creation.body.session.id;
  assert.equal(creation.headers.get('location'), `/api/sessions/${id}`);
  assert.equal(creation.body.session.location.name, 'Valbonne City Workout');

  const lecture = await appeler(`/api/sessions/${id}`);
  assert.equal(lecture.status, 200);
  assert.equal(lecture.body.session.title, 'Renfo');

  const modification = await appeler(`/api/sessions/${id}`, { coach: true, method: 'PATCH', body: { capacity: 8 } });
  assert.equal(modification.status, 200);
  assert.equal(modification.body.session.capacity, 8);
  assert.equal(modification.body.session.placesRestantes, 8);

  // La séance apparaît bien dans la grille, au bon créneau.
  const grille = await appeler('/api/calendar?start=2026-09-14');
  const ligne1830 = grille.body.rows.find((r) => r.time === '18:30');
  assert.equal(ligne1830.cells[0].sessions[0].id, id);
  assert.equal(ligne1830.cells[0].lieuxLibres.length, 4);

  // DELETE archive : la séance sort de la grille mais reste consultable.
  const archivage = await appeler(`/api/sessions/${id}`, { coach: true, method: 'DELETE' });
  assert.equal(archivage.status, 200);
  assert.equal(archivage.body.session.archivee, true);
  assert.equal((await appeler(`/api/sessions/${id}`)).status, 200, 'rien n’est effacé');
  assert.equal((await appeler('/api/sessions')).body.total, 0);
  assert.equal((await appeler('/api/sessions?archivees=true')).body.total, 1);
  assert.equal((await appeler('/api/export')).body.total, 1);

  const restauration = await appeler(`/api/sessions/${id}/restaurer`, { coach: true, method: 'POST' });
  assert.equal(restauration.status, 200);
  assert.equal(restauration.body.session.archivee, false);
  assert.equal((await appeler('/api/sessions')).body.total, 1);
});

test('POST /api/sessions valide l’entrée et signale les conflits', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const heureInterdite = await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, time: '19:00' } });
  assert.equal(heureInterdite.status, 400);
  assert.deepEqual(heureInterdite.body.error.details.heuresPossibles, ['10:30', '18:00', '18:30']);

  const lieuInconnu = await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, locationId: 'nice' } });
  assert.equal(lieuInconnu.status, 400);
  assert.equal(lieuInconnu.body.error.details.lieuxPossibles.length, 5);

  await appeler('/api/sessions', { coach: true, method: 'POST', body: base });
  const doublon = await appeler('/api/sessions', { coach: true, method: 'POST', body: base });
  assert.equal(doublon.status, 409);
  assert.equal(doublon.body.error.code, 'conflict');
});

test('GET /api/sessions filtre par période, lieu et heure', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  await appeler('/api/sessions', { coach: true, method: 'POST', body: { date: '2026-09-14', time: '18:00', locationId: 'grasse-stadium' } });
  await appeler('/api/sessions', { coach: true, method: 'POST', body: { date: '2026-09-16', time: '18:30', locationId: 'valbonne-hill' } });

  assert.equal((await appeler('/api/sessions')).body.total, 2);
  assert.equal((await appeler('/api/sessions?from=2026-09-15')).body.total, 1);
  assert.equal((await appeler('/api/sessions?location=grasse-stadium')).body.total, 1);
  assert.equal((await appeler('/api/sessions?time=18:30')).body.total, 1);
  assert.equal((await appeler('/api/sessions?time=17:00')).status, 400);
});

test('GET /api/annee suit la planification sur 12 mois', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  await appeler('/api/sessions', { coach: true, method: 'POST', body: { date: '2026-11-05', time: '18:00', locationId: 'valbonne-hill', statut: 'effectuee' } });

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

  const creation = await appeler('/api/sessions', { coach: true, method: 'POST', body: base });
  const id = creation.body.session.id;
  assert.equal(creation.body.session.statut, 'prevue');

  const maj = await appeler(`/api/sessions/${id}`, { coach: true, method: 'PATCH', body: { statut: 'effectuee' } });
  assert.equal(maj.status, 200);
  assert.equal(maj.body.session.statut, 'effectuee');
  assert.deepEqual(maj.body.session.historique.map((h) => h.statut), ['prevue', 'effectuee']);

  const grille = await appeler('/api/calendar?start=2026-09-14');
  assert.deepEqual(grille.body.days[0].totaux, { total: 1, prevue: 0, effectuee: 1, annulee: 0 });
  assert.deepEqual(grille.body.totaux, { total: 1, prevue: 0, effectuee: 1, annulee: 0 });

  assert.equal((await appeler('/api/sessions?statut=effectuee')).body.total, 1);
  assert.equal((await appeler('/api/sessions?statut=prevue')).body.total, 0);
  assert.equal((await appeler('/api/sessions?statut=reportee')).status, 400);
  assert.equal((await appeler(`/api/sessions/${id}`, { coach: true, method: 'PATCH', body: { statut: 'reportee' } })).status, 400);
});

test('cycle de vie d’une note vocale', async (t) => {
  const { appeler, fermer, base: racine } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;
  const son = Buffer.from('bip bip bip');

  const ajout = await appeler(`/api/sessions/${id}/notes-vocales`, {
    coach: true,
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
  assert.equal((await appeler(`/api/sessions/${id}/notes-vocales`, { coach: true })).body.notesVocales.length, 1);
  assert.equal((await appeler(`/api/sessions/${id}`, { coach: true })).body.session.notesVocales[0].id, note.id);

  // Le son se relit tel quel, avec son type.
  const lecture = await fetch(`${racine}/api/sessions/${id}/notes-vocales/${note.id}`, {
    headers: { 'X-Cle-Coach': CLE_COACH }
  });
  assert.equal(lecture.status, 200);
  assert.equal(lecture.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(Buffer.from(await lecture.arrayBuffer()), son);

  const suppression = await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`, { coach: true, method: 'DELETE' });
  assert.equal(suppression.status, 200);
  assert.equal(suppression.body.session.notesVocales.length, 0);
  assert.equal((await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`, { coach: true })).status, 404);
});

test('une note vocale invalide ou orpheline est refusée', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;

  assert.equal((await appeler('/api/sessions/ses_inconnu/notes-vocales', { coach: true, method: 'POST', body: { audio: 'AAAA' } })).status, 404);

  const sansAudio = await appeler(`/api/sessions/${id}/notes-vocales`, { coach: true, method: 'POST', body: { duree: 3 } });
  assert.equal(sansAudio.status, 400);

  const mauvaisFormat = await appeler(`/api/sessions/${id}/notes-vocales`, {
    coach: true,
    method: 'POST',
    body: { audio: Buffer.from('x').toString('base64'), mimeType: 'audio/aiff' }
  });
  assert.equal(mauvaisFormat.status, 400);
  assert.ok(mauvaisFormat.body.error.details.formatsAcceptes.includes('audio/webm'));

  // La séance reste propre après ces refus.
  assert.deepEqual((await appeler(`/api/sessions/${id}`, { coach: true })).body.session.notesVocales, []);
});

test('un athlète ne voit aucune note vocale, nulle part', async (t) => {
  const { appeler, base: racine, fermer } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;
  const ajout = await appeler(`/api/sessions/${id}/notes-vocales`, {
    coach: true,
    method: 'POST',
    body: { audio: Buffer.from('confidentiel').toString('base64'), transcription: 'Pour moi seul' }
  });
  const noteId = ajout.body.noteVocale.id;

  // Vue athlète : la séance est là, ses notes vocales non.
  const grille = await appeler('/api/calendar?start=2026-09-14');
  assert.equal(grille.body.coach, false);
  assert.equal(grille.body.rows[0].cells[0].sessions.length, 0, 'rien à 10:30');
  const seance = grille.body.rows.find((r) => r.time === base.time).cells[0].sessions[0];
  assert.equal(seance.id, id, 'la séance reste visible');
  assert.deepEqual(seance.notesVocales, [], 'mais sans ses notes vocales');

  assert.deepEqual((await appeler(`/api/sessions/${id}`)).body.session.notesVocales, []);
  assert.deepEqual((await appeler('/api/sessions')).body.sessions[0].notesVocales, []);
  assert.deepEqual((await appeler('/api/export')).body.sessions[0].notesVocales, []);

  // Aucune trace de la transcription dans ce que reçoit un athlète.
  for (const chemin of ['/api/calendar', '/api/sessions', '/api/export', `/api/sessions/${id}`]) {
    const reponse = await fetch(racine + chemin);
    assert.doesNotMatch(await reponse.text(), /Pour moi seul/, `transcription visible sur ${chemin}`);
  }

  // Et les routes des notes vocales lui sont fermées.
  for (const [methode, chemin] of [
    ['GET', `/api/sessions/${id}/notes-vocales`],
    ['POST', `/api/sessions/${id}/notes-vocales`],
    ['GET', `/api/sessions/${id}/notes-vocales/${noteId}`],
    ['DELETE', `/api/sessions/${id}/notes-vocales/${noteId}`]
  ]) {
    const reponse = await appeler(chemin, { method: methode, body: methode === 'POST' ? { audio: 'AAAA' } : undefined });
    assert.equal(reponse.status, 401, `${methode} ${chemin} devrait être refusé`);
    assert.equal(reponse.body.error.code, 'cle_coach_requise');
  }

  // Une mauvaise clé ne vaut pas mieux qu'aucune.
  const fausse = await fetch(`${racine}/api/sessions/${id}/notes-vocales`, { headers: { 'X-Cle-Coach': 'presque' } });
  assert.equal(fausse.status, 401);

  // Avec la clé, le coach retrouve tout.
  const vueCoach = await appeler(`/api/sessions/${id}`, { coach: true });
  assert.equal(vueCoach.body.session.notesVocales.length, 1);
  assert.equal(vueCoach.body.session.notesVocales[0].transcription, 'Pour moi seul');
  assert.equal((await appeler('/api/calendar?start=2026-09-14', { coach: true })).body.coach, true);
  assert.equal((await appeler('/api/health', { coach: true })).body.coach, true);
});

test('un athlète consulte la grille mais n’y touche pas', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;

  // Lecture : ouverte à tous.
  assert.equal((await appeler('/api/calendar')).status, 200);
  assert.equal((await appeler('/api/annee')).status, 200);
  assert.equal((await appeler('/api/sessions')).status, 200);
  assert.equal((await appeler(`/api/sessions/${id}`)).status, 200);

  // Écriture sur la séance : réservée au coach.
  for (const [methode, chemin, corps] of [
    ['POST', '/api/sessions', { ...base, locationId: 'grasse-stadium' }],
    ['PATCH', `/api/sessions/${id}`, { statut: 'effectuee' }],
    ['DELETE', `/api/sessions/${id}`, undefined],
    ['POST', `/api/sessions/${id}/restaurer`, undefined]
  ]) {
    const reponse = await appeler(chemin, { method: methode, body: corps });
    assert.equal(reponse.status, 401, `${methode} ${chemin} devrait demander la clé`);
    assert.equal(reponse.body.error.code, 'cle_coach_requise');
    assert.match(reponse.body.error.message, /coach/);
  }

  // Rien n'a bougé, et le coach passe toujours.
  assert.equal((await appeler('/api/sessions')).body.total, 1);
  assert.equal((await appeler(`/api/sessions/${id}`)).body.session.statut, 'prevue');
  assert.equal((await appeler(`/api/sessions/${id}`, { coach: true, method: 'PATCH', body: { statut: 'effectuee' } })).status, 200);

  // Ce qui appartient à l'équipe reste ouvert.
  assert.equal((await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'yvon' } })).status, 200);
  assert.equal((await appeler(`/api/sessions/${id}/messages`, { method: 'POST', body: { athleteId: 'yvon', texte: 'Présent' } })).status, 201);
  assert.equal((await appeler(`/api/sessions/${id}/participants/yvon`, { method: 'DELETE' })).status, 200);
});

test('l’équipe s’inscrit et s’exprime sans clé coach', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const equipe = await appeler('/api/athletes');
  assert.equal(equipe.status, 200);
  assert.equal(equipe.body.total, 9);
  assert.deepEqual(equipe.body.athletes.map((a) => a.nom), [
    'Yvon', 'Kaila', 'Autumn', 'Scarlett', 'Elliot', 'Alex L', 'Ludo', 'Zoe', 'Melina'
  ]);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, capacity: 2 } })).body.session.id;

  // Sans aucune clé : un athlète annonce sa venue.
  const venue = await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'kaila' } });
  assert.equal(venue.status, 200);
  assert.deepEqual(venue.body.session.inscrits.map((a) => a.nom), ['Kaila']);
  assert.equal(venue.body.session.placesRestantes, 1);

  // …et laisse un mot.
  const mot = await appeler(`/api/sessions/${id}/messages`, {
    method: 'POST',
    body: { athleteId: 'ludo', texte: 'J’amène les plots' }
  });
  assert.equal(mot.status, 201);
  assert.equal(mot.body.message.athlete.nom, 'Ludo');
  assert.equal(mot.headers.get('location'), `/api/sessions/${id}/messages/${mot.body.message.id}`);

  // Tout le monde voit les mots, y compris dans la grille.
  assert.equal((await appeler(`/api/sessions/${id}/messages`)).body.messages.length, 1);
  const grille = await appeler('/api/calendar?start=2026-09-14');
  const seance = grille.body.rows.find((r) => r.time === base.time).cells[0].sessions[0];
  assert.equal(seance.messages[0].texte, 'J’amène les plots');
  assert.deepEqual(seance.inscrits.map((a) => a.id), ['kaila']);

  // Les refus sont explicites.
  assert.equal((await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'personne' } })).status, 400);
  await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'zoe' } });
  const complet = await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'yvon' } });
  assert.equal(complet.status, 409);
  assert.match(complet.body.error.message, /complète/);

  // Se retirer libère la place.
  assert.equal((await appeler(`/api/sessions/${id}/participants/kaila`, { method: 'DELETE' })).body.session.placesRestantes, 1);
});

test('retirer le mot d’un athlète est réservé au coach', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;
  const mot = await appeler(`/api/sessions/${id}/messages`, {
    method: 'POST',
    body: { athleteId: 'melina', texte: 'Je ne pourrai pas venir' }
  });
  const messageId = mot.body.message.id;

  const refus = await appeler(`/api/sessions/${id}/messages/${messageId}`, { method: 'DELETE' });
  assert.equal(refus.status, 401);
  assert.equal(refus.body.error.code, 'cle_coach_requise');
  assert.equal((await appeler(`/api/sessions/${id}/messages`)).body.messages.length, 1, 'le mot est toujours là');

  const retrait = await appeler(`/api/sessions/${id}/messages/${messageId}`, { coach: true, method: 'DELETE' });
  assert.equal(retrait.status, 200);
  assert.deepEqual(retrait.body.session.messages, []);
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

  const casse = await appeler('/api/sessions', { coach: true, method: 'POST', raw: '{ date: 2026-09-14' });
  assert.equal(casse.status, 400);
  assert.equal(casse.body.error.code, 'invalid_request');

  // Un corps vide reste du JSON valide : c'est la validation métier qui répond.
  const vide = await appeler('/api/sessions', { coach: true, method: 'POST', raw: '' });
  assert.equal(vide.status, 400);
  assert.match(vide.body.error.message, /date/);

  // Un tableau n'est pas un objet de séance.
  const tableau = await appeler('/api/sessions', { coach: true, method: 'POST', raw: '[]' });
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

  const reponse = await appeler('/api/sessions', { coach: true, method: 'POST', raw: enorme });
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
