/* La coquille Cloudflare Workers, exercée contre un faux R2 et de faux
   assets. Rien ne sort d'ici : pas de réseau, pas de compte Cloudflare. */

import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.mjs';
import datesModule from '../src/dates.js';
import referenceModule from '../src/reference.js';

const { todayISO, addDays } = datesModule;
const { TIMEZONE } = referenceModule;

const AUJOURDHUI = todayISO(TIMEZONE);
const HIER = addDays(AUJOURDHUI, -1);
const CLE = 'cle-de-test';

/** Un bucket R2 en mémoire, ETags compris — c'est eux qu'on veut éprouver. */
class FauxBucket {
  constructor() {
    this.objets = new Map();
    this.compteur = 0;
    this.ecritures = 0;
  }

  async get(cle) {
    const objet = this.objets.get(cle);
    if (!objet) return null;
    return {
      etag: objet.etag,
      arrayBuffer: async () => objet.bytes.slice().buffer
    };
  }

  async put(cle, valeur, options = {}) {
    const actuel = this.objets.get(cle);
    if (options.onlyIf) {
      const { etagMatches, etagDoesNotMatch } = options.onlyIf;
      if (etagMatches !== undefined && (!actuel || actuel.etag !== etagMatches)) return null;
      if (etagDoesNotMatch === '*' && actuel) return null;
    }
    const bytes = valeur instanceof Uint8Array ? new Uint8Array(valeur) : new Uint8Array(valeur);
    const etag = `etag-${++this.compteur}`;
    this.objets.set(cle, { bytes, etag });
    this.ecritures += 1;
    return { etag };
  }

  async delete(cle) {
    this.objets.delete(cle);
  }

  /** Simule quelqu'un d'autre qui écrit entre la lecture et l'écriture. */
  bousculer(cle) {
    const actuel = this.objets.get(cle);
    this.objets.set(cle, { bytes: actuel ? actuel.bytes : new Uint8Array(), etag: `etag-${++this.compteur}` });
  }
}

const ASSETS_HTML = '<!DOCTYPE html><meta property="og:image" content="{{origine}}/partage.png"><h1>Calendrier</h1>';

function environnement(bucket, { html = ASSETS_HTML } = {}) {
  return {
    CALENDRIER: bucket,
    CALENDAR_COACH_KEY: CLE,
    ASSETS: {
      fetch: async (requete) => {
        const chemin = new URL(requete.url).pathname;
        if (chemin === '/' || chemin.endsWith('.html')) {
          return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
        }
        if (chemin === '/styles.css') {
          return new Response('body{}', { headers: { 'content-type': 'text/css' } });
        }
        return new Response('introuvable', { status: 404 });
      }
    }
  };
}

async function appeler(env, chemin, options = {}) {
  const entetes = {};
  if (options.body) entetes['Content-Type'] = 'application/json';
  if (options.coach) entetes['X-Cle-Coach'] = CLE;
  if (options.athlete) entetes['X-Athlete'] = options.athlete;

  const reponse = await worker.fetch(
    new Request('https://entrainements.exemple.fr' + chemin, {
      method: options.method ?? 'GET',
      headers: entetes,
      body: options.body ? JSON.stringify(options.body) : options.raw
    }),
    env
  );
  const texte = await reponse.text();
  const type = reponse.headers.get('content-type') ?? '';
  return { status: reponse.status, headers: reponse.headers, body: type.includes('json') ? JSON.parse(texte) : texte };
}

test('le Worker sert l’API depuis R2, de bout en bout', async () => {
  const bucket = new FauxBucket();
  const env = environnement(bucket);

  const index = await appeler(env, '/api');
  assert.equal(index.status, 200);
  assert.equal(index.body.heuresPossibles.length, 2);

  // Une séance, puis un compte rendu d'athlète : tout doit passer par R2.
  const creation = await appeler(env, '/api/sessions', {
    coach: true,
    method: 'POST',
    body: { date: HIER, time: '18:00', locationId: 'valbonne-stadium', title: 'Fractionné' }
  });
  assert.equal(creation.status, 201);
  const id = creation.body.session.id;
  assert.ok(bucket.objets.has('sessions.json'), 'les séances sont bien écrites dans le bucket');

  const note = await appeler(env, `/api/sessions/${id}/notes-athlete`, {
    athlete: 'zoe',
    method: 'POST',
    body: { texte: 'Bonnes sensations.' }
  });
  assert.equal(note.status, 201);
  assert.equal(note.body.note.athlete.nom, 'Zoé');

  // Une requête neuve relit tout depuis R2 : rien ne tient en mémoire.
  const suivi = await appeler(env, '/api/suivi', { coach: true });
  assert.equal(suivi.status, 200);
  assert.equal(suivi.body.total, 1);
  assert.equal(suivi.body.athletes.find((a) => a.id === 'zoe').notes[0].texte, 'Bonnes sensations.');

  // Et les règles d'accès tiennent, à l'identique de la version Node.
  assert.equal((await appeler(env, '/api/sessions', { method: 'POST', body: { date: HIER, time: '18:30', locationId: 'valbonne-hill' } })).status, 401);
  assert.equal((await appeler(env, '/api/suivi')).status, 401);
});

test('une écriture concurrente est refusée, jamais écrasée', async () => {
  const bucket = new FauxBucket();
  const env = environnement(bucket);

  await appeler(env, '/api/sessions', {
    coach: true,
    method: 'POST',
    body: { date: HIER, time: '18:00', locationId: 'valbonne-stadium' }
  });
  const avant = Buffer.from(bucket.objets.get('sessions.json').bytes).toString('utf8');

  // Quelqu'un d'autre écrit entre la lecture et l'écriture de la requête suivante.
  const bucketBouscule = Object.create(Object.getPrototypeOf(bucket));
  Object.assign(bucketBouscule, bucket);
  bucketBouscule.get = async (cle) => {
    const resultat = await FauxBucket.prototype.get.call(bucket, cle);
    bucket.bousculer(cle); // la version lue est déjà périmée
    return resultat;
  };
  bucketBouscule.put = (...args) => FauxBucket.prototype.put.apply(bucket, args);

  const conflit = await appeler(environnement(bucketBouscule), '/api/sessions', {
    coach: true,
    method: 'POST',
    body: { date: HIER, time: '18:30', locationId: 'grasse-stadium' }
  });

  assert.equal(conflit.status, 409, 'mieux vaut refuser que perdre la saisie de l’autre');
  assert.match(conflit.body.error.message, /Rechargez et réessayez/);
  assert.equal(
    Buffer.from(bucket.objets.get('sessions.json').bytes).toString('utf8'),
    avant,
    'le document n’a pas été réécrit'
  );
});

test('la page est servie par ASSETS, avec l’image de partage en adresse absolue', async () => {
  const env = environnement(new FauxBucket());

  const page = await appeler(env, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /content="https:\/\/entrainements\.exemple\.fr\/partage\.png"/);
  assert.ok(!page.body.includes('{{origine}}'));

  // CALENDAR_PUBLIC_URL l'emporte, si le domaine public diffère de celui vu par le Worker.
  const force = await appeler({ ...env, CALENDAR_PUBLIC_URL: 'https://coach.exemple.fr/' }, '/');
  assert.match(force.body, /content="https:\/\/coach\.exemple\.fr\/partage\.png"/);

  // Déclarée mais vide — le cas du wrangler.toml livré : on retombe sur la requête,
  // et surtout pas sur une adresse relative, que WhatsApp ignorerait.
  const vide = await appeler({ ...env, CALENDAR_PUBLIC_URL: '' }, '/');
  assert.match(vide.body, /content="https:\/\/entrainements\.exemple\.fr\/partage\.png"/);

  // Le reste passe sans être touché.
  const css = await appeler(env, '/styles.css');
  assert.equal(css.status, 200);
  assert.equal(css.body, 'body{}');
});

test('un corps trop volumineux part en 413, pas en 500', async () => {
  const env = environnement(new FauxBucket());
  const enorme = JSON.stringify({ texte: 'x'.repeat(70 * 1024) });

  const reponse = await appeler(env, '/api/sessions', { coach: true, method: 'POST', raw: enorme });
  assert.equal(reponse.status, 413);
  assert.equal(reponse.body.error.code, 'payload_too_large');
});

test('sans bucket lié, le Worker le dit clairement', async () => {
  const reponse = await appeler({ ASSETS: environnement(new FauxBucket()).ASSETS }, '/api/calendar');
  assert.equal(reponse.status, 500);
  assert.equal(reponse.body.error.code, 'stockage_absent');
  assert.match(reponse.body.error.message, /wrangler\.toml/);
});

test('sans secret de clé coach, le Worker refuse au lieu de tirer une clé au hasard', async () => {
  // Un Worker ne garde rien : une clé tirée au sort changerait à chaque
  // requête, et le mode coach deviendrait inatteignable en silence.
  const env = environnement(new FauxBucket());
  delete env.CALENDAR_COACH_KEY;

  const reponse = await appeler(env, '/api/calendar');
  assert.equal(reponse.status, 503);
  assert.equal(reponse.body.error.code, 'cle_coach_absente');
  assert.match(reponse.body.error.details.ligneDeCommande, /wrangler secret put/);
  assert.match(reponse.body.error.details.tableauDeBord, /Variables and Secrets/);

  // La page, elle, reste servie : le défaut est de configuration, pas de contenu.
  assert.equal((await appeler(env, '/')).status, 200);
});

test('le Worker sert aussi bien depuis D1 que depuis R2', async () => {
  const { DatabaseSync } = await import('node:sqlite');

  // Le binding D1, imité sur du vrai SQLite : le SQL est réellement exécuté.
  const sqlite = new DatabaseSync(':memory:');
  const base = {
    prepare(sql) {
      let liens = [];
      const lanceur = {
        bind(...args) {
          liens = args.map((v) => (v instanceof ArrayBuffer ? new Uint8Array(v) : v));
          return lanceur;
        },
        async first() {
          return sqlite.prepare(sql).get(...liens) ?? null;
        },
        async run() {
          return { success: true, meta: { changes: Number(sqlite.prepare(sql).run(...liens).changes) } };
        }
      };
      return lanceur;
    }
  };

  const env = { ...environnement(new FauxBucket()), CALENDRIER: undefined, CALENDRIER_DB: base };

  const creation = await appeler(env, '/api/sessions', {
    coach: true,
    method: 'POST',
    body: { date: HIER, time: '18:00', locationId: 'valbonne-stadium', title: 'Côtes' }
  });
  assert.equal(creation.status, 201);
  const id = creation.body.session.id;

  const note = await appeler(env, `/api/sessions/${id}/notes-athlete`, {
    athlete: 'yvon',
    method: 'POST',
    body: { texte: 'Bien passé.' }
  });
  assert.equal(note.status, 201);

  // Requête neuve : tout est relu depuis D1.
  const suivi = await appeler(env, '/api/suivi', { coach: true });
  assert.equal(suivi.body.total, 1);
  assert.equal(suivi.body.athletes.find((a) => a.id === 'yvon').notes[0].texte, 'Bien passé.');

  const sante = await appeler(env, '/api/health', { coach: true });
  assert.equal(sante.body.stockage.type, 'd1');

  // Une seule table, un seul document : les notes dictées sont du texte.
  const lignes = sqlite.prepare('SELECT chemin FROM documents').all();
  assert.deepEqual(lignes.map((l) => l.chemin), ['sessions.json']);
});

test('le préflight CORS laisse passer les en-têtes du calendrier', async () => {
  const env = environnement(new FauxBucket());
  const reponse = await worker.fetch(
    new Request('https://entrainements.exemple.fr/api/sessions', { method: 'OPTIONS' }),
    env
  );
  assert.equal(reponse.status, 204);
  assert.match(reponse.headers.get('access-control-allow-headers'), /X-Cle-Coach/);
  assert.match(reponse.headers.get('access-control-allow-headers'), /X-Athlete/);
});
