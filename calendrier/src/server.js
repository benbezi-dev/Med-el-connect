/* Serveur HTTP du calendrier — sans dépendance externe.

   Il sert à la fois l'API JSON sous /api et la présentation 7 jours
   (fichiers de public/). Lancement : `node calendrier/src/server.js`. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { creerDepot } = require('./stockage');
const { SessionService } = require('./sessions');
const { VoiceStore } = require('./voix');
const { estCoach } = require('./acces');
const { resoudreCleLocale } = require('./cle-fichier');
const { handleApi, sendError, setCorsHeaders, methodNotAllowed } = require('./api');
const { notFound } = require('./errors');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

/**
 * @param {{dataFile?: string|null, depot?: object, cleCoach?: string, env?: object}} options
 *   `dataFile: null` garde tout en mémoire (tests) ; `depot` impose un dépôt.
 *   Le dépôt réel (fichiers ou Google Drive) est choisi par l'environnement.
 * @returns {Promise<Function>} le gestionnaire de requêtes, données chargées.
 */
async function createApp({ dataFile = DEFAULT_DATA_FILE, depot, cleCoach, env = process.env } = {}) {
  const racine = dataFile ? path.dirname(dataFile) : null;
  const stockage = creerDepot({ racine, env, depot });
  const store = await new Store(stockage, dataFile ? path.basename(dataFile) : undefined).charger();
  const sessions = new SessionService(store);
  const voix = new VoiceStore(stockage);
  const acces = resoudreCleLocale({ cleCoach, dataFile });

  const handler = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, sessions, voix, estCoach(req, url, acces.cle), stockage.decrire());
      } else {
        serveStatic(req, res, url);
      }
    } catch (error) {
      sendError(res, error, req);
    }
  };

  handler.sessions = sessions;
  handler.voix = voix;
  handler.store = store;
  handler.depot = stockage;
  handler.acces = acces;
  return handler;
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, methodNotAllowed(req.method, ['GET', 'HEAD']), req);
  }

  const relative = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const target = path.resolve(PUBLIC_DIR, relative);
  // path.resolve neutralise « .. » : on vérifie qu'on reste bien sous public/.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return sendError(res, notFound('Ressource introuvable.'), req);
  }

  fs.readFile(target, (error, content) => {
    if (error) return sendError(res, notFound('Ressource introuvable.'), req);
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : content);
  });
}

async function start({ port = Number(process.env.PORT) || 3000, host = process.env.HOST || '0.0.0.0', dataFile } = {}) {
  const app = await createApp({ dataFile });
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(port, host, resolve));

  const { port: boundPort } = server.address();
  const { type, emplacement } = app.depot.decrire();
  console.log(`Calendrier prêt sur http://localhost:${boundPort} (API sous /api)`);
  console.log(`Données : ${type}${emplacement ? ` — ${emplacement}` : ''}`);
  annoncerCle(app.acces);
  return server;
}

/** La clé n'est affichée qu'au premier démarrage : ensuite, on dit où la relire. */
function annoncerCle(acces) {
  if (acces.origine === 'generee') {
    console.log(`Clé coach générée : ${acces.cle}`);
    console.log(`  → notez-la : elle seule ouvre les notes vocales (copie dans ${acces.fichier}).`);
  } else if (acces.origine === 'fichier') {
    console.log('Clé coach : voir data/cle-coach.txt (les notes vocales ne sont visibles qu’avec elle).');
  } else if (acces.origine === 'env') {
    console.log('Clé coach : CALENDAR_COACH_KEY.');
  }
}

module.exports = { createApp, start, DEFAULT_DATA_FILE, PUBLIC_DIR };

module.exports = { createApp, start, DEFAULT_DATA_FILE, PUBLIC_DIR };

if (require.main === module) {
  start({ dataFile: process.env.CALENDAR_DATA_FILE || DEFAULT_DATA_FILE }).catch((erreur) => {
    // Mieux vaut ne pas démarrer que servir un calendrier vide parce que le
    // dépôt était injoignable.
    console.error(`Démarrage impossible : ${erreur.message}`);
    process.exitCode = 1;
  });
}
