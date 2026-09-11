/* Serveur HTTP du calendrier — sans dépendance externe.

   Il sert à la fois l'API JSON sous /api et la présentation 7 jours
   (fichiers de public/). Lancement : `node calendrier/src/server.js`. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { SessionService } = require('./sessions');
const { buildCalendar } = require('./calendar');
const { LOCATIONS, TIMES, TIMEZONE, DAYS_IN_VIEW } = require('./reference');
const { ApiError, badRequest, notFound } = require('./errors');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DEFAULT_DATA_FILE = path.join(__dirname, '..', 'data', 'sessions.json');
const MAX_BODY_BYTES = 64 * 1024;

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
 * @param {{dataFile?: string|null}} options `null` garde les données en mémoire (tests).
 */
function createApp({ dataFile = DEFAULT_DATA_FILE } = {}) {
  const store = new Store(dataFile);
  const sessions = new SessionService(store);

  const handler = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, sessions);
      } else {
        serveStatic(req, res, url);
      }
    } catch (error) {
      sendError(res, error, req);
    }
  };

  handler.sessions = sessions;
  handler.store = store;
  return handler;
}

async function handleApi(req, res, url, sessions) {
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const [resource, id, ...rest] = route ? route.split('/') : [];
  const { method } = req;

  if (rest.length > 0) throw notFound(`Route inconnue : ${url.pathname}`);

  if (!resource) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(res, 200, apiIndex());
  }

  if (resource === 'health' && !id) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(res, 200, { status: 'ok', timezone: TIMEZONE, now: new Date().toISOString() });
  }

  if (resource === 'locations' && !id) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(res, 200, { locations: LOCATIONS, total: LOCATIONS.length });
  }

  if (resource === 'times' && !id) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(res, 200, { times: TIMES, timezone: TIMEZONE });
  }

  if (resource === 'calendar' && !id) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(
      res,
      200,
      buildCalendar(sessions, {
        start: url.searchParams.get('start') ?? undefined,
        days: url.searchParams.get('days') ?? undefined
      })
    );
  }

  if (resource === 'sessions') {
    if (!id) {
      if (method === 'GET') {
        const list = sessions.list({
          from: url.searchParams.get('from') ?? undefined,
          to: url.searchParams.get('to') ?? undefined,
          locationId: url.searchParams.get('location') ?? undefined,
          time: url.searchParams.get('time') ?? undefined
        });
        return sendJson(res, 200, { sessions: list, total: list.length });
      }
      if (method === 'POST') {
        const created = sessions.create(await readJsonBody(req));
        res.setHeader('Location', `/api/sessions/${created.id}`);
        return sendJson(res, 201, { session: created });
      }
      throw methodNotAllowed(method, ['GET', 'POST']);
    }

    if (method === 'GET') return sendJson(res, 200, { session: sessions.get(id) });
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { session: sessions.update(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') return sendJson(res, 200, { session: sessions.remove(id), deleted: true });
    throw methodNotAllowed(method, ['GET', 'PATCH', 'DELETE']);
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

function apiIndex() {
  return {
    name: 'API Calendrier — présentation 7 jours',
    timezone: TIMEZONE,
    joursAffiches: DAYS_IN_VIEW,
    heuresPossibles: TIMES,
    lieux: LOCATIONS.map((l) => l.id),
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'État du service.' },
      { method: 'GET', path: '/api/locations', description: 'Les 5 lieux possibles.' },
      { method: 'GET', path: '/api/times', description: 'Les heures possibles (18:00, 18:30).' },
      {
        method: 'GET',
        path: '/api/calendar?start=YYYY-MM-DD&days=7',
        description: 'Grille 7 jours : une ligne par heure, une cellule par jour.'
      },
      {
        method: 'GET',
        path: '/api/sessions?from=&to=&location=&time=',
        description: 'Liste des séances, filtrable.'
      },
      { method: 'POST', path: '/api/sessions', description: 'Crée une séance (date, time, locationId).' },
      { method: 'GET', path: '/api/sessions/:id', description: 'Détail d’une séance.' },
      { method: 'PATCH', path: '/api/sessions/:id', description: 'Modifie une séance.' },
      { method: 'DELETE', path: '/api/sessions/:id', description: 'Supprime une séance.' }
    ]
  };
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        // On met le flux en pause plutôt que de le détruire : détruire ici
        // couperait la connexion avant que le 413 n'ait été envoyé. La socket
        // est fermée par sendError(), une fois la réponse écrite.
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

function methodNotAllowed(method, allowed) {
  return new ApiError(405, 'method_not_allowed', `Méthode ${method} non autorisée.`, { autorisees: allowed });
}

function setCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, error, req) {
  if (error instanceof ApiError) {
    if (error.status === 413 && req) {
      res.setHeader('Connection', 'close');
      res.on('finish', () => req.destroy());
    }
    return sendJson(res, error.status, error.toJSON());
  }
  console.error('[calendrier] erreur inattendue :', error);
  sendJson(res, 500, { error: { code: 'internal_error', message: 'Erreur interne du serveur.' } });
}

function start({ port = Number(process.env.PORT) || 3000, host = process.env.HOST || '0.0.0.0', dataFile } = {}) {
  const server = http.createServer(createApp({ dataFile }));
  server.listen(port, host, () => {
    const { port: boundPort } = server.address();
    console.log(`Calendrier prêt sur http://localhost:${boundPort} (API sous /api)`);
  });
  return server;
}

module.exports = { createApp, start, DEFAULT_DATA_FILE, PUBLIC_DIR };

if (require.main === module) {
  start({ dataFile: process.env.CALENDAR_DATA_FILE || DEFAULT_DATA_FILE });
}
