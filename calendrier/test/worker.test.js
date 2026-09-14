const test = require('node:test');
const assert = require('node:assert/strict');

const CLE = 'cle-de-test';

/** Un espace KV en mémoire, avec l'interface de celui de Cloudflare. */
function fauxKv() {
  const contenu = new Map();
  return {
    contenu,
    async get(cle, options) {
      const valeur = contenu.get(cle);
      if (valeur === undefined) return null;
      if (options && options.type === 'arrayBuffer') {
        return valeur.buffer.slice(valeur.byteOffset, valeur.byteOffset + valeur.byteLength);
      }
      return valeur.toString('utf8');
    },
    async put(cle, valeur) { contenu.set(cle, Buffer.from(valeur)); },
    async delete(cle) { contenu.delete(cle); }
  };
}

/** Monte le Worker sur un environnement de test et renvoie de quoi l'interroger. */
async function monterWorker(options = {}) {
  const { default: worker } = await import('../cloudflare/worker.mjs');
  const env = {
    CALENDRIER: options.kv ?? fauxKv(),
    CALENDAR_COACH_KEY: 'CALENDAR_COACH_KEY' in options ? options.CALENDAR_COACH_KEY : CLE,
    ASSETS: { fetch: async () => new Response('<!doctype html>la page', { headers: { 'Content-Type': 'text/html' } }) }
  };

  const appeler = async (chemin, config = {}) => {
    const entetes = {};
    if (config.body !== undefined) entetes['Content-Type'] = 'application/json';
    if (config.coach) entetes['X-Cle-Coach'] = CLE;

    const reponse = await worker.fetch(
      new Request('https://calendrier.test' + chemin, {
        method: config.method ?? 'GET',
        headers: entetes,
        body: config.body === undefined ? undefined : JSON.stringify(config.body)
      }),
      env
    );

    // Le corps n'est lu qu'une fois, puis servi sous les deux formes.
    const type = reponse.headers.get('content-type') ?? '';
    const octets = Buffer.from(await reponse.arrayBuffer());
    return {
      status: reponse.status,
      headers: reponse.headers,
      octets,
      body: type.includes('json') ? JSON.parse(octets.toString('utf8')) : octets.toString('utf8')
    };
  };

  return { appeler, env, kv: env.CALENDRIER };
}

const base = { date: '2026-09-14', time: '10:30', locationId: 'valbonne-hill' };

test('le Worker sert la page et répond à l’API', async () => {
  const { appeler } = await monterWorker();

  const page = await appeler('/');
  assert.equal(page.status, 200);
  assert.match(page.body, /la page/, 'les fichiers passent par le binding ASSETS');

  const index = await appeler('/api');
  assert.equal(index.status, 200);
  assert.deepEqual(index.body.heuresPossibles, ['10:30', '18:00', '18:30']);
  assert.equal(index.body.athletes.length, 9);

  const sante = await appeler('/api/health', { coach: true });
  assert.equal(sante.body.stockage.type, 'kv');
});

test('une séance créée survit d’une requête à l’autre', async () => {
  const { appeler, kv } = await monterWorker();

  const creation = await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, title: 'Sortie longue' } });
  assert.equal(creation.status, 201);
  const id = creation.body.session.id;

  // Le document est bien dans KV, pas seulement en mémoire.
  assert.deepEqual([...kv.contenu.keys()], ['sessions.json']);
  assert.equal(JSON.parse(kv.contenu.get('sessions.json').toString()).sessions.length, 1);

  // Une requête suivante repart de KV : rien n'est gardé entre deux appels.
  const grille = await appeler('/api/calendar?start=2026-09-14');
  const cellule = grille.body.rows.find((r) => r.time === '10:30').cells[0];
  assert.equal(cellule.sessions[0].id, id);
  assert.equal(cellule.sessions[0].title, 'Sortie longue');
});

test('l’équipe s’inscrit et s’exprime, le coach garde la grille', async () => {
  const { appeler } = await monterWorker();
  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;

  assert.equal((await appeler(`/api/sessions/${id}/participants`, { method: 'POST', body: { athleteId: 'kaila' } })).status, 200);
  const mot = await appeler(`/api/sessions/${id}/messages`, { method: 'POST', body: { athleteId: 'ludo', texte: 'Présent' } });
  assert.equal(mot.status, 201);
  assert.equal(mot.body.message.athlete.nom, 'Ludo');

  // Sans clé, la grille est en lecture seule.
  const refus = await appeler(`/api/sessions/${id}`, { method: 'PATCH', body: { statut: 'effectuee' } });
  assert.equal(refus.status, 401);
  assert.equal(refus.body.error.code, 'cle_coach_requise');
  assert.equal((await appeler(`/api/sessions/${id}`, { coach: true, method: 'PATCH', body: { statut: 'effectuee' } })).status, 200);
});

test('une note vocale fait l’aller-retour binaire par KV', async () => {
  const { appeler } = await monterWorker();
  const id = (await appeler('/api/sessions', { coach: true, method: 'POST', body: base })).body.session.id;

  const son = Buffer.from([0, 1, 2, 250, 255, 128, 64]);
  const ajout = await appeler(`/api/sessions/${id}/notes-vocales`, {
    coach: true,
    method: 'POST',
    body: { audio: son.toString('base64'), mimeType: 'audio/webm', duree: 3, transcription: 'Pour moi seul' }
  });
  assert.equal(ajout.status, 201);
  const note = ajout.body.noteVocale;

  const lecture = await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`, { coach: true });
  assert.equal(lecture.status, 200);
  assert.equal(lecture.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(lecture.octets, son, 'le son revient octet pour octet');

  // Et un athlète n'en voit pas la trace.
  const vueAthlete = await appeler(`/api/sessions/${id}`);
  assert.deepEqual(vueAthlete.body.session.notesVocales, []);
  assert.equal((await appeler(`/api/sessions/${id}/notes-vocales/${note.id}`)).status, 401);
});

test('les préflights et les erreurs passent aussi par l’adaptateur', async () => {
  const { appeler } = await monterWorker();

  const preflight = await appeler('/api/sessions', { method: 'OPTIONS' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');

  assert.equal((await appeler('/api/inconnu')).status, 404);
  const invalide = await appeler('/api/sessions', { coach: true, method: 'POST', body: { ...base, time: '19:00' } });
  assert.equal(invalide.status, 400);
  assert.deepEqual(invalide.body.error.details.heuresPossibles, ['10:30', '18:00', '18:30']);
});

test('sans clé coach configurée, le Worker le dit au lieu d’en inventer une', async () => {
  const { appeler } = await monterWorker({ CALENDAR_COACH_KEY: '' });
  const reponse = await appeler('/api/health');
  assert.equal(reponse.status, 500);
  assert.equal(reponse.body.error.code, 'configuration_incomplete');
  assert.match(reponse.body.error.message, /wrangler secret put/);
});
