/* Serveur HTTP du calendrier — sans dépendance externe.

   Cette coquille ne fait que traduire : elle transforme une requête node:http
   en requête « simple », la confie au routeur (src/routeur.js, partagé avec
   la version Cloudflare Workers), et réécrit la réponse. Le routage lui-même
   n'est pas ici.

   Elle sert aussi la présentation 7 jours (fichiers de public/).
   Lancement : `node calendrier/src/server.js`. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { creerDepot } = require('./stockage');
const { creerApplication } = require('./application');
const { ApiError, badRequest, notFound } = require('./errors');
const { MAX_BODY_BYTES } = require('./routeur');

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
  const app = await creerApplication({
    depot: stockage,
    nomFichier: dataFile ? path.basename(dataFile) : undefined,
    cleCoach,
    dataFile
  });

  const handler = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return serveStatic(req, res, url);
    }

    let reponse;
    try {
      reponse = await app.routeur({
        methode: req.method,
        url,
        entetes: req.headers,
        lireJson: (limite) => readJsonBody(req, limite)
      });
    } catch (erreur) {
      // Le routeur attrape déjà les ApiError ; ceci couvre l'imprévu.
      reponse = {
        statut: 500,
        entetes: { 'Content-Type': 'application/json; charset=utf-8' },
        corps: JSON.stringify({ error: { code: 'internal_error', message: 'Erreur interne du serveur.' } })
      };
      console.error('[calendrier] erreur inattendue :', erreur);
    }
    ecrire(req, res, reponse);
  };

  handler.sessions = app.sessions;
  handler.voix = app.voix;
  handler.store = app.store;
  handler.depot = app.depot;
  handler.acces = app.acces;
  handler.routeur = app.routeur;
  return handler;
}

/** Écrit la réponse du routeur sur la socket. */
function ecrire(req, res, reponse) {
  const corps = typeof reponse.corps === 'string' ? Buffer.from(reponse.corps, 'utf8') : Buffer.from(reponse.corps);

  if (reponse.fermerConnexion) {
    // Un corps trop gros laisse des octets en vol : on ferme, mais seulement
    // une fois la réponse écrite — détruire avant priverait le client du 413.
    res.setHeader('Connection', 'close');
    res.on('finish', () => req.destroy());
  }

  res.writeHead(reponse.statut, { ...reponse.entetes, 'Content-Length': corps.length });
  res.end(req.method === 'HEAD' ? undefined : corps);
}

function readJsonBody(req, limite = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limite) {
        // On met le flux en pause plutôt que de le détruire : détruire ici
        // couperait la connexion avant que le 413 n'ait été envoyé.
        req.pause();
        reject(new ApiError(413, 'payload_too_large', 'Corps de requête trop volumineux.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(badRequest('Le corps de la requête n’est pas du JSON valide.'));
      }
    });
  });
}

/* ---------- Fichiers de public/ ---------- */

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return envoyerErreur(res, methodNotAllowed(req.method, ['GET', 'HEAD']));
  }

  const relative = decodeURIComponent(url.pathname) === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
  const target = path.resolve(PUBLIC_DIR, relative);
  // path.resolve neutralise « .. » : on vérifie qu'on reste bien sous public/.
  if (target !== PUBLIC_DIR && !target.startsWith(PUBLIC_DIR + path.sep)) {
    return envoyerErreur(res, notFound('Ressource introuvable.'));
  }

  fs.readFile(target, (error, content) => {
    if (error) return envoyerErreur(res, notFound('Ressource introuvable.'));
    const corps = target.endsWith('.html') ? absolutiser(content, req) : content;
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(target).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(req.method === 'HEAD' ? undefined : corps);
  });
}

/* WhatsApp (comme la plupart des aperçus de lien) exige une adresse absolue
   pour l'image de partage : une adresse relative est ignorée, et la carte
   s'affiche sans vignette. On ne connaît pas le domaine à l'avance, alors on
   le déduit de la requête — ou de CALENDAR_PUBLIC_URL si l'hébergeur est
   derrière un intermédiaire qui brouille l'en-tête Host. */
function absolutiser(contenu, req) {
  const texte = contenu.toString('utf8');
  if (!texte.includes('{{origine}}')) return contenu;
  return Buffer.from(texte.replaceAll('{{origine}}', origineDe(req.headers)), 'utf8');
}

function origineDe(entetes) {
  const configuree = process.env.CALENDAR_PUBLIC_URL;
  if (configuree) return configuree.replace(/\/$/, '');

  // Render et Cloudflare terminent le TLS en amont : l'en-tête dit le vrai schéma.
  const protocole = (entetes['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  const hote = (entetes['x-forwarded-host'] ?? entetes.host ?? 'localhost').split(',')[0].trim();
  return `${protocole}://${hote}`;
}

function envoyerErreur(res, erreur) {
  const corps = JSON.stringify(erreur.toJSON(), null, 2);
  res.writeHead(erreur.status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(corps)
  });
  res.end(corps);
}

function methodNotAllowed(method, allowed) {
  return new ApiError(405, 'method_not_allowed', `Méthode ${method} non autorisée.`, { autorisees: allowed });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Cle-Coach, X-Athlete');
  res.setHeader('Access-Control-Max-Age', '86400');
}

/* ---------- Démarrage ---------- */

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

module.exports = { createApp, start, DEFAULT_DATA_FILE, PUBLIC_DIR, MIME_TYPES, origineDe };

if (require.main === module) {
  start({ dataFile: process.env.CALENDAR_DATA_FILE || DEFAULT_DATA_FILE }).catch((erreur) => {
    // Mieux vaut ne pas démarrer que servir un calendrier vide parce que le
    // dépôt était injoignable.
    console.error(`Démarrage impossible : ${erreur.message}`);
    process.exitCode = 1;
  });
}
