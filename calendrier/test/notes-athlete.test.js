/* Les notes que les athlètes écrivent sur leurs séances : qui peut écrire,
   qui peut lire, et ce que le coach retrouve dans son suivi. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');
const { ATHLETES } = require('../src/athletes');
const { todayISO, addDays } = require('../src/dates');
const { TIMEZONE } = require('../src/reference');

const CLE_COACH = 'cle-de-test';

/* Les dates sont calculées à partir d'aujourd'hui : une note se pose sur une
   séance qui a eu lieu, pas sur une séance à venir. */
const AUJOURDHUI = todayISO(TIMEZONE);
const HIER = addDays(AUJOURDHUI, -1);
const DEMAIN = addDays(AUJOURDHUI, 1);

async function demarrer() {
  const serveur = http.createServer(await createApp({ dataFile: null, cleCoach: CLE_COACH }));
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const appeler = async (chemin, options = {}) => {
    const corps = options.body ? JSON.stringify(options.body) : undefined;
    const entetes = {};
    if (corps !== undefined) entetes['Content-Type'] = 'application/json';
    if (options.coach) entetes['X-Cle-Coach'] = CLE_COACH;
    if (options.athlete) entetes['X-Athlete'] = options.athlete;
    const reponse = await fetch(base + chemin, {
      method: options.method ?? 'GET',
      headers: Object.keys(entetes).length ? entetes : undefined,
      body: corps
    });
    const texte = await reponse.text();
    return {
      status: reponse.status,
      body: texte && reponse.headers.get('content-type')?.includes('json') ? JSON.parse(texte) : texte
    };
  };

  /** Crée une séance (le coach seul en a le droit) et rend son identifiant. */
  const creerSeance = async (date = HIER, reste = {}) => {
    const { status, body } = await appeler('/api/sessions', {
      coach: true,
      method: 'POST',
      body: { date, time: '18:00', locationId: 'valbonne-stadium', ...reste }
    });
    assert.equal(status, 201, 'la séance de départ doit être créée');
    return body.session.id;
  };

  return { appeler, creerSeance, fermer: () => new Promise((resolve) => serveur.close(resolve)) };
}

test('les neuf athlètes ont un identifiant et une couleur qui leur sont propres', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { status, body } = await appeler('/api/athletes');
  assert.equal(status, 200);
  assert.equal(body.total, 9);
  assert.deepEqual(
    body.athletes.map((a) => a.nom),
    ['Eliot', 'Autumn', 'Scarlett', 'Zoé', 'Yvon', 'Alex L', 'Alex P', 'Ludo', 'Mélina']
  );

  assert.equal(new Set(ATHLETES.map((a) => a.id)).size, 9, 'des identifiants distincts');
  assert.equal(new Set(ATHLETES.map((a) => a.couleur)).size, 9, 'des couleurs distinctes');
  assert.equal(new Set(ATHLETES.map((a) => a.initiales)).size, 9, 'des initiales distinctes');
  for (const athlete of ATHLETES) {
    assert.match(athlete.couleur, /^#[0-9A-F]{6}$/, `${athlete.nom} : couleur en hexadécimal`);
    assert.ok(athlete.nom.length > 0, 'le nom accompagne toujours la couleur');
  }
});

test('un athlète écrit, corrige et supprime sa note sur une séance passée', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);
  const id = await creerSeance();

  const ajout = await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'zoe',
    method: 'POST',
    body: { texte: 'Jambes lourdes, 6×400 en 72.' }
  });
  assert.equal(ajout.status, 201);
  assert.equal(ajout.body.note.athleteId, 'zoe');
  assert.equal(ajout.body.note.athlete.nom, 'Zoé');
  assert.equal(ajout.body.note.athlete.couleur, '#359BD9');
  assert.equal(ajout.body.note.texte, 'Jambes lourdes, 6×400 en 72.');
  const noteId = ajout.body.note.id;

  const correction = await appeler(`/api/sessions/${id}/notes-athlete/${noteId}`, {
    athlete: 'zoe',
    method: 'PATCH',
    body: { texte: 'Jambes lourdes, 6×400 en 70.' }
  });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.note.texte, 'Jambes lourdes, 6×400 en 70.');
  assert.ok(correction.body.note.updatedAt >= correction.body.note.createdAt);

  const suppression = await appeler(`/api/sessions/${id}/notes-athlete/${noteId}`, {
    athlete: 'zoe',
    method: 'DELETE'
  });
  assert.equal(suppression.status, 200);
  assert.equal(suppression.body.session.notesAthletes.length, 0);
});

test('une note ne se pose ni sur une séance à venir ni sur une séance archivée', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);

  const futur = await creerSeance(DEMAIN);
  const aVenir = await appeler(`/api/sessions/${futur}/notes-athlete`, {
    athlete: 'ludo',
    method: 'POST',
    body: { texte: 'Séance parfaite.' }
  });
  assert.equal(aVenir.status, 400, 'on ne raconte pas une séance qui n’a pas eu lieu');
  assert.match(aVenir.body.error.message, /pas encore eu lieu/);

  const passe = await creerSeance(HIER, { locationId: 'grasse-stadium' });
  await appeler(`/api/sessions/${passe}`, { coach: true, method: 'DELETE' });
  const archivee = await appeler(`/api/sessions/${passe}/notes-athlete`, {
    athlete: 'ludo',
    method: 'POST',
    body: { texte: 'Trop tard.' }
  });
  assert.equal(archivee.status, 409);

  // Une séance du jour, elle, se commente : c'est le cas normal du soir.
  const dujour = await creerSeance(AUJOURDHUI, { locationId: 'valbonne-hill' });
  const cesoir = await appeler(`/api/sessions/${dujour}/notes-athlete`, {
    athlete: 'ludo',
    method: 'POST',
    body: { texte: 'Bonnes sensations.' }
  });
  assert.equal(cesoir.status, 201);
});

test('l’athlète et le texte d’une note sont vérifiés', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);
  const id = await creerSeance();

  const inconnu = await appeler(`/api/sessions/${id}/notes-athlete`, {
    method: 'POST',
    body: { athleteId: 'kevin', texte: 'Bonjour.' }
  });
  assert.equal(inconnu.status, 400);
  assert.ok(inconnu.body.error.details.athletesPossibles.includes('eliot'));

  const anonyme = await appeler(`/api/sessions/${id}/notes-athlete`, {
    method: 'POST',
    body: { texte: 'Sans dire qui je suis.' }
  });
  assert.equal(anonyme.status, 400, 'une note sans auteur n’a pas de sens');

  const vide = await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'yvon',
    method: 'POST',
    body: { texte: '   ' }
  });
  assert.equal(vide.status, 400);

  const tropLong = await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'yvon',
    method: 'POST',
    body: { texte: 'x'.repeat(1001) }
  });
  assert.equal(tropLong.status, 400);
  assert.match(tropLong.body.error.message, /1000 caractères/);
});

test('un athlète ne touche jamais à la note d’un autre', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);
  const id = await creerSeance();

  const ajout = await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'scarlett',
    method: 'POST',
    body: { texte: 'Sortie longue, tout va bien.' }
  });
  const noteId = ajout.body.note.id;

  const vol = await appeler(`/api/sessions/${id}/notes-athlete/${noteId}`, {
    athlete: 'alex-p',
    method: 'PATCH',
    body: { texte: 'N’importe quoi.' }
  });
  assert.equal(vol.status, 403);
  assert.equal(vol.body.error.details.auteur, 'Scarlett');

  const effacement = await appeler(`/api/sessions/${id}/notes-athlete/${noteId}`, {
    athlete: 'alex-p',
    method: 'DELETE'
  });
  assert.equal(effacement.status, 403);

  // Le coach, lui, fait le ménage partout.
  const parLeCoach = await appeler(`/api/sessions/${id}/notes-athlete/${noteId}`, {
    coach: true,
    method: 'DELETE'
  });
  assert.equal(parLeCoach.status, 200);
});

test('chacun ne voit que ses notes dans la grille ; le coach les voit toutes', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);
  const id = await creerSeance();

  await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'eliot',
    method: 'POST',
    body: { texte: 'Note d’Eliot.' }
  });
  await appeler(`/api/sessions/${id}/notes-athlete`, {
    athlete: 'melina',
    method: 'POST',
    body: { texte: 'Note de Mélina.' }
  });

  const vueEliot = await appeler(`/api/calendar?start=${HIER}`, { athlete: 'eliot' });
  const texteEliot = JSON.stringify(vueEliot.body);
  assert.ok(texteEliot.includes('Note d’Eliot.'), 'Eliot retrouve sa note');
  assert.ok(!texteEliot.includes('Note de Mélina.'), 'et pas celle de Mélina');
  assert.equal(vueEliot.body.athlete, 'eliot');

  const vueAnonyme = await appeler(`/api/calendar?start=${HIER}`);
  const texteAnonyme = JSON.stringify(vueAnonyme.body);
  assert.ok(!texteAnonyme.includes('Note d’Eliot.'));
  assert.ok(!texteAnonyme.includes('Note de Mélina.'));

  const vueCoach = await appeler(`/api/calendar?start=${HIER}`, { coach: true });
  const texteCoach = JSON.stringify(vueCoach.body);
  assert.ok(texteCoach.includes('Note d’Eliot.'));
  assert.ok(texteCoach.includes('Note de Mélina.'));

  // L'export suit la même règle.
  const exportAthlete = await appeler('/api/export', { athlete: 'eliot' });
  assert.ok(!JSON.stringify(exportAthlete.body).includes('Note de Mélina.'));
});

test('le suivi rassemble les notes par athlète et nomme les silencieux', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);

  const refuse = await appeler('/api/suivi');
  assert.equal(refuse.status, 401, 'le suivi n’appartient qu’au coach');

  const hier = await creerSeance(HIER);
  const aujourdhui = await creerSeance(AUJOURDHUI, { locationId: 'grasse-stadium' });

  await appeler(`/api/sessions/${hier}/notes-athlete`, {
    athlete: 'autumn',
    method: 'POST',
    body: { texte: 'Côtes, jambes cuites.' }
  });
  await appeler(`/api/sessions/${aujourdhui}/notes-athlete`, {
    athlete: 'autumn',
    method: 'POST',
    body: { texte: 'Récupération tranquille.' }
  });
  await appeler(`/api/sessions/${aujourdhui}/notes-athlete`, {
    athlete: 'alex-l',
    method: 'POST',
    body: { texte: 'Bien récupéré.' }
  });

  const { status, body } = await appeler('/api/suivi', { coach: true });
  assert.equal(status, 200);
  assert.equal(body.total, 3);
  assert.equal(body.athletes.length, 9, 'les neuf sont là, même sans note');

  const autumn = body.athletes.find((a) => a.id === 'autumn');
  assert.equal(autumn.totalNotes, 2);
  assert.equal(autumn.seancesCommentees, 2);
  assert.equal(autumn.couleur, '#02A6AD');
  assert.equal(autumn.notes[0].texte, 'Récupération tranquille.', 'la plus récente d’abord');
  assert.equal(autumn.notes[0].seance.location.name, 'Grasse Stadium');

  const alexL = body.athletes.find((a) => a.id === 'alex-l');
  assert.equal(alexL.totalNotes, 1);

  // Ce que le coach cherche vraiment : qui n'a rien écrit.
  assert.equal(body.sansNote.length, 7);
  assert.ok(body.sansNote.includes('ludo'));
  assert.ok(!body.sansNote.includes('autumn'));
});

test('le suivi se borne à une période', async (t) => {
  const { appeler, creerSeance, fermer } = await demarrer();
  t.after(fermer);

  const vieille = await creerSeance(addDays(AUJOURDHUI, -40));
  await appeler(`/api/sessions/${vieille}/notes-athlete`, {
    athlete: 'yvon',
    method: 'POST',
    body: { texte: 'Il y a longtemps.' }
  });

  // 30 jours par défaut : la note d'il y a 40 jours sort du cadre.
  const parDefaut = await appeler('/api/suivi', { coach: true });
  assert.equal(parDefaut.body.total, 0);

  const large = await appeler('/api/suivi?jours=60', { coach: true });
  assert.equal(large.body.total, 1);

  assert.equal((await appeler('/api/suivi?jours=0', { coach: true })).status, 400);
  assert.equal((await appeler('/api/suivi?from=pas-une-date', { coach: true })).status, 400);
});

test('les notes d’athlètes survivent au redémarrage', async (t) => {
  const { DepotMemoire } = require('../src/stockage');
  const depot = new DepotMemoire();

  const premier = await createApp({ dataFile: 'data/sessions.json', depot, cleCoach: CLE_COACH });
  const seance = await premier.sessions.create({ date: HIER, time: '18:30', locationId: 'valbonne-hill' });
  await premier.sessions.ajouterNoteAthlete(seance.id, { athleteId: 'ludo', texte: 'Bien passé.' });

  // Même dépôt, application neuve : tout doit revenir.
  const second = await createApp({ dataFile: 'data/sessions.json', depot, cleCoach: CLE_COACH });
  const relue = second.sessions.get(seance.id);
  assert.equal(relue.notesAthletes.length, 1);
  assert.equal(relue.notesAthletes[0].texte, 'Bien passé.');
  assert.equal(relue.notesAthletes[0].athlete.nom, 'Ludo');
});
