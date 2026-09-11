/* Serveur HTTP du calendrier — sans dépendance externe.

   Il sert à la fois l'API JSON sous /api et la présentation 7 jours
   (fichiers de public/). Lancement : `node calendrier/src/server.js`. */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Store } = require('./store');
const { SessionService } = require('./sessions');
const { VoiceStore } = require('./voix');
const { buildCalendar } = require('./calendar');
const { buildAnnee } = require('./annee');
const { LOCATIONS, TIMES, STATUTS, TIMEZONE, DAYS_IN_VIEW, MOIS_HORIZON } = require('./reference');
const { ApiError, badRequest, notFound } = require('./errors');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(__dirname, '..', 'data');
const DEFAULT_DATA_FILE = path.join(DATA_DIR, 'sessions.json');
const MAX_BODY_BYTES = 64 * 1024;
const MAX_AUDIO_BODY_BYTES = 8 * 1024 * 1024; // base64 d'une note vocale de 5 Mo

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
 * @param {{dataFile?: string|null, voiceDir?: string|null}} options
 *   `dataFile: null` garde tout en mémoire (tests).
 */
function createApp({ dataFile = DEFAULT_DATA_FILE, voiceDir } = {}) {
  const store = new Store(dataFile);
  const sessions = new SessionService(store);
  const voix = new VoiceStore(
    voiceDir !== undefined ? voiceDir : dataFile && path.join(path.dirname(dataFile), 'notes-vocales')
  );

  const handler = async (req, res) => {
    setCorsHeaders(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
    try {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url, sessions, voix);
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
  return handler;
}

async function handleApi(req, res, url, sessions, voix) {
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const segments = route ? route.split('/') : [];
  const { method } = req;

  if (segments.length === 0) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);
    return sendJson(res, 200, apiIndex());
  }

  const [resource] = segments;

  // Les séances ont leur propre routeur : POST /api/sessions ne doit pas
  // tomber dans le garde « lecture seule » des ressources ci-dessous.
  if (resource === 'sessions') return handleSessions(req, res, url, segments, sessions, voix);

  if (segments.length === 1) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);

    if (resource === 'health') {
      return sendJson(res, 200, { status: 'ok', timezone: TIMEZONE, now: new Date().toISOString() });
    }
    if (resource === 'locations') return sendJson(res, 200, { locations: LOCATIONS, total: LOCATIONS.length });
    if (resource === 'times') return sendJson(res, 200, { times: TIMES, timezone: TIMEZONE });
    if (resource === 'statuts') return sendJson(res, 200, { statuts: STATUTS });
    if (resource === 'calendar') {
      return sendJson(
        res,
        200,
        buildCalendar(sessions, {
          start: url.searchParams.get('start') ?? undefined,
          days: url.searchParams.get('days') ?? undefined
        })
      );
    }
    if (resource === 'annee') {
      return sendJson(
        res,
        200,
        buildAnnee(sessions, {
          start: url.searchParams.get('start') ?? undefined,
          mois: url.searchParams.get('mois') ?? undefined
        })
      );
    }
    if (resource === 'export') {
      // Tout, archives comprises : rien de ce qui a été saisi n'est perdu.
      const toutes = sessions.list({ archivees: true });
      return sendJson(res, 200, { exporteLe: new Date().toISOString(), total: toutes.length, sessions: toutes });
    }
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

async function handleSessions(req, res, url, segments, sessions, voix) {
  const { method } = req;
  const [, id, sub, subId] = segments;

  if (!id) {
    if (method === 'GET') {
      const list = sessions.list({
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        locationId: url.searchParams.get('location') ?? undefined,
        time: url.searchParams.get('time') ?? undefined,
        statut: url.searchParams.get('statut') ?? undefined,
        archivees: url.searchParams.get('archivees') === 'true'
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

  if (!sub) {
    if (method === 'GET') return sendJson(res, 200, { session: sessions.get(id) });
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { session: sessions.update(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') {
      // Archivage, pas suppression : la séance reste dans le fichier.
      return sendJson(res, 200, { session: sessions.archive(id), archivee: true });
    }
    throw methodNotAllowed(method, ['GET', 'PATCH', 'DELETE']);
  }

  if (sub === 'restaurer' && !subId) {
    if (method !== 'POST') throw methodNotAllowed(method, ['POST']);
    return sendJson(res, 200, { session: sessions.restore(id) });
  }

  if (sub === 'notes-vocales') {
    if (!subId) {
      if (method === 'GET') {
        return sendJson(res, 200, { notesVocales: sessions.get(id).notesVocales });
      }
      if (method === 'POST') {
        sessions.get(id); // 404 avant d'écrire quoi que ce soit
        const note = voix.enregistrer(id, await readJsonBody(req, MAX_AUDIO_BODY_BYTES));
        const session = sessions.ajouterNoteVocale(id, note);
        res.setHeader('Location', `/api/sessions/${id}/notes-vocales/${note.id}`);
        return sendJson(res, 201, { noteVocale: note, session });
      }
      throw methodNotAllowed(method, ['GET', 'POST']);
    }

    const note = sessions.trouverNoteVocale(id, subId);
    if (method === 'GET') return sendAudio(res, voix.lire(id, note), note);
    if (method === 'DELETE') {
      const session = sessions.supprimerNoteVocale(id, subId);
      voix.supprimer(id, note);
      return sendJson(res, 200, { session, deleted: true });
    }
    throw methodNotAllowed(method, ['GET', 'DELETE']);
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

function apiIndex() {
  return {
    name: 'API Calendrier — planification sur un an, présentation sur 7 jours',
    timezone: TIMEZONE,
    joursVisibles: DAYS_IN_VIEW,
    moisHorizon: MOIS_HORIZON,
    heuresPossibles: TIMES,
    statuts: STATUTS.map((s) => s.id),
    lieux: LOCATIONS.map((l) => l.id),
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'État du service.' },
      { method: 'GET', path: '/api/locations', description: 'Les 5 lieux possibles.' },
      { method: 'GET', path: '/api/times', description: 'Les heures possibles (18:00, 18:30).' },
      { method: 'GET', path: '/api/statuts', description: 'Statuts : prévue, effectuée, annulée.' },
      {
        method: 'GET',
        path: '/api/calendar?start=YYYY-MM-DD&days=7',
        description: 'Grille : une ligne par heure, une cellule par jour (jusqu’à 366 jours).'
      },
      {
        method: 'GET',
        path: '/api/annee?start=YYYY-MM-DD&mois=12',
        description: 'Suivi sur 12 mois : totaux par mois et jours occupés.'
      },
      { method: 'GET', path: '/api/export', description: 'Toutes les séances, archives comprises.' },
      {
        method: 'GET',
        path: '/api/sessions?from=&to=&location=&time=&statut=&archivees=',
        description: 'Liste des séances, filtrable.'
      },
      { method: 'POST', path: '/api/sessions', description: 'Crée une séance (date, time, locationId).' },
      { method: 'GET', path: '/api/sessions/:id', description: 'Détail d’une séance.' },
      { method: 'PATCH', path: '/api/sessions/:id', description: 'Modifie une séance (dont son statut).' },
      { method: 'DELETE', path: '/api/sessions/:id', description: 'Archive une séance (rien n’est effacé).' },
      { method: 'POST', path: '/api/sessions/:id/restaurer', description: 'Sort une séance des archives.' },
      {
        method: 'POST',
        path: '/api/sessions/:id/notes-vocales',
        description: 'Ajoute une note vocale ({ audio: base64, mimeType, duree, transcription }).'
      },
      {
        method: 'GET',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Renvoie le son de la note vocale.'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Supprime une note vocale.'
      }
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

function readJsonBody(req, limite = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limite) {
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

function sendAudio(res, bytes, note) {
  res.writeHead(200, {
    'Content-Type': note.mimeType,
    'Content-Length': bytes.length,
    'Content-Disposition': `inline; filename="${note.fichier}"`,
    'Cache-Control': 'private, max-age=3600'
  });
  res.end(bytes);
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
