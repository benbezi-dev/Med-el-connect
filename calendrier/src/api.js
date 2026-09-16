/* Le cœur de l'API : le routage et les réponses.

   Ce module ne connaît ni le disque ni le serveur HTTP de Node. Il travaille
   sur le couple (req, res) tel que le décrit node:http — méthode, en-têtes,
   corps en flux — et c'est tout ce que l'appelant doit lui fournir. Un
   serveur Node le nourrit directement ; un Worker Cloudflare lui présente
   une requête déguisée. Une seule implémentation de l'API pour les deux. */

const { buildCalendar } = require('./calendar');
const { buildAnnee } = require('./annee');
const { resumeSemaine, texteSemaine, descriptionSemaine, pageSemaine } = require('./partage');
const { LOCATIONS, TIMES, STATUTS, TIMEZONE, DAYS_IN_VIEW, MOIS_HORIZON } = require('./reference');
const { protege, estVisible, ENTETE } = require('./acces');
const { ApiError, badRequest, notFound } = require('./errors');
// Sert à répondre en une requête à « ma mise en ligne a-t-elle pris ? ».
const { version } = require('../package.json');

const MAX_BODY_BYTES = 64 * 1024;
const MAX_AUDIO_BODY_BYTES = 8 * 1024 * 1024; // base64 d'une note vocale de 5 Mo
const MAX_IMAGE_BODY_BYTES = 6 * 1024 * 1024; // base64 d'une photo de 4 Mo

async function handleApi(req, res, url, noyau, coach, stockageDecrit) {
  const { sessions, voix, photos, athletes } = noyau;
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
  if (resource === 'sessions') return handleSessions(req, res, url, segments, sessions, voix, photos, coach);
  if (resource === 'athletes') return handleAthletes(req, res, url, segments, athletes, coach);

  if (segments.length === 1) {
    if (method !== 'GET') throw methodNotAllowed(method, ['GET']);

    if (resource === 'health') {
      return sendJson(res, 200, {
        status: 'ok',
        version,
        timezone: TIMEZONE,
        coach,
        // Le chemin exact ne regarde que le coach.
        stockage: coach ? stockageDecrit : { type: stockageDecrit.type },
        now: new Date().toISOString()
      });
    }
    if (resource === 'locations') return sendJson(res, 200, { locations: LOCATIONS, total: LOCATIONS.length });
    if (resource === 'times') return sendJson(res, 200, { times: TIMES, timezone: TIMEZONE });
    if (resource === 'statuts') return sendJson(res, 200, { statuts: STATUTS });
    if (resource === 'calendar') {
      const grille = buildCalendar(sessions, {
        start: url.searchParams.get('start') ?? undefined,
        days: url.searchParams.get('days') ?? undefined
      });
      // `coach` dit à la page si elle doit proposer les notes vocales.
      return sendJson(res, 200, protege({ ...grille, coach }, coach));
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
    if (resource === 'semaine') {
      const resume = resumeSemaine(sessions, { start: url.searchParams.get('start') ?? undefined });
      const adresse = url.searchParams.get('adresse') ?? undefined;
      return sendJson(res, 200, {
        ...resume,
        description: descriptionSemaine(resume),
        texte: texteSemaine(resume, adresse)
      });
    }
    if (resource === 'export') {
      // Tout, archives comprises : rien de ce qui a été saisi n'est perdu.
      const toutes = sessions.list({ archivees: true });
      return sendJson(
        res,
        200,
        protege({ exporteLe: new Date().toISOString(), total: toutes.length, sessions: toutes }, coach)
      );
    }
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

async function handleSessions(req, res, url, segments, sessions, voix, photos, coach) {
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
      return sendJson(res, 200, protege({ sessions: list, total: list.length }, coach));
    }
    if (method === 'POST') {
      if (!coach) throw cleCoachRequise('Seul le coach peut créer une séance.');
      const created = await sessions.create(await readJsonBody(req));
      res.setHeader('Location', `/api/sessions/${created.id}`);
      return sendJson(res, 201, protege({ session: created }, coach));
    }
    throw methodNotAllowed(method, ['GET', 'POST']);
  }

  if (!sub) {
    if (method === 'GET') return sendJson(res, 200, protege({ session: sessions.get(id) }, coach));
    if (method === 'PATCH' || method === 'PUT') {
      if (!coach) throw cleCoachRequise('Seul le coach peut modifier une séance.');
      return sendJson(res, 200, protege({ session: await sessions.update(id, await readJsonBody(req)) }, coach));
    }
    if (method === 'DELETE') {
      // Archivage, pas suppression : la séance reste dans le fichier.
      if (!coach) throw cleCoachRequise('Seul le coach peut archiver une séance.');
      return sendJson(res, 200, protege({ session: await sessions.archive(id), archivee: true }, coach));
    }
    throw methodNotAllowed(method, ['GET', 'PATCH', 'DELETE']);
  }

  if (sub === 'restaurer' && !subId) {
    if (method !== 'POST') throw methodNotAllowed(method, ['POST']);
    if (!coach) throw cleCoachRequise('Seul le coach peut restaurer une séance.');
    return sendJson(res, 200, protege({ session: await sessions.restore(id) }, coach));
  }

  if (sub === 'participants') {
    // Chacun annonce sa venue lui-même : pas de clé coach ici.
    if (!subId) {
      if (method !== 'POST') throw methodNotAllowed(method, ['POST']);
      const corps = await readJsonBody(req);
      return sendJson(res, 200, protege({ session: await sessions.inscrire(id, corps.athleteId) }, coach));
    }
    if (method !== 'DELETE') throw methodNotAllowed(method, ['DELETE']);
    return sendJson(res, 200, protege({ session: await sessions.desinscrire(id, subId) }, coach));
  }

  if (sub === 'messages') {
    if (!subId) {
      if (method === 'GET') return sendJson(res, 200, { messages: sessions.get(id).messages });
      if (method === 'POST') {
        const session = await sessions.ajouterMessage(id, await readJsonBody(req));
        const dernier = session.messages[session.messages.length - 1];
        res.setHeader('Location', `/api/sessions/${id}/messages/${dernier.id}`);
        return sendJson(res, 201, protege({ message: dernier, session }, coach));
      }
      throw methodNotAllowed(method, ['GET', 'POST']);
    }
    if (method !== 'DELETE') throw methodNotAllowed(method, ['DELETE']);
    // Retirer le mot d'un autre relève de la modération : réservé au coach.
    if (!coach) throw cleCoachRequise('Seul le coach peut retirer un message.');
    return sendJson(res, 200, protege({ session: await sessions.supprimerMessage(id, subId) }, coach));
  }

  if (sub === 'photos') {
    if (!subId) {
      if (method === 'GET') {
        // La liste passe par le même filtre que le reste : un athlète ne voit
        // que les photos rendues visibles.
        return sendJson(res, 200, protege({ photos: sessions.get(id).photos }, coach));
      }
      if (method === 'POST') {
        if (!coach) throw cleCoachRequise('Seul le coach peut ajouter une photo.');
        sessions.get(id); // 404 avant d'écrire quoi que ce soit
        const photo = await photos.enregistrer(id, await readJsonBody(req, MAX_IMAGE_BODY_BYTES));
        const session = await sessions.ajouterPhoto(id, photo).catch(async (erreur) => {
          // L'image est arrivée mais la séance n'a pas pu être mise à jour :
          // on retire l'image plutôt que de laisser un orphelin dans le dépôt.
          await photos.supprimer(id, photo).catch(() => {});
          throw erreur;
        });
        res.setHeader('Location', `/api/sessions/${id}/photos/${photo.id}`);
        return sendJson(res, 201, { photo, session });
      }
      throw methodNotAllowed(method, ['GET', 'POST']);
    }

    const photo = sessions.trouverPhoto(id, subId);
    if (method === 'GET') {
      // L'adresse d'une photo cachée ne doit rien révéler, même devinée.
      if (!coach && !estVisible(photo)) {
        throw notFound(`Aucune photo « ${subId} » sur cette séance.`);
      }
      return sendImage(res, await photos.lire(id, photo), photo, coach);
    }
    if (method === 'PATCH' || method === 'PUT') {
      if (!coach) throw cleCoachRequise('Seul le coach peut montrer ou cacher une photo.');
      return sendJson(res, 200, {
        session: await sessions.modifierPhoto(id, subId, await readJsonBody(req))
      });
    }
    if (method === 'DELETE') {
      if (!coach) throw cleCoachRequise('Seul le coach peut supprimer une photo.');
      const session = await sessions.supprimerPhoto(id, subId);
      await photos.supprimer(id, photo);
      return sendJson(res, 200, { session, deleted: true });
    }
    throw methodNotAllowed(method, ['GET', 'PATCH', 'DELETE']);
  }

  if (sub === 'notes-vocales') {
    // Les notes vocales sont réservées au coach, en lecture comme en écriture.
    if (!coach) throw cleCoachRequise();

    if (!subId) {
      if (method === 'GET') {
        return sendJson(res, 200, { notesVocales: sessions.get(id).notesVocales });
      }
      if (method === 'POST') {
        sessions.get(id); // 404 avant d'écrire quoi que ce soit
        const note = await voix.enregistrer(id, await readJsonBody(req, MAX_AUDIO_BODY_BYTES));
        const session = await sessions.ajouterNoteVocale(id, note).catch(async (erreur) => {
          // Le son est arrivé mais la séance n'a pas pu être mise à jour :
          // on retire le son plutôt que de laisser un orphelin dans le dépôt.
          await voix.supprimer(id, note).catch(() => {});
          throw erreur;
        });
        res.setHeader('Location', `/api/sessions/${id}/notes-vocales/${note.id}`);
        return sendJson(res, 201, { noteVocale: note, session });
      }
      throw methodNotAllowed(method, ['GET', 'POST']);
    }

    const note = sessions.trouverNoteVocale(id, subId);
    if (method === 'GET') return sendAudio(res, await voix.lire(id, note), note);
    if (method === 'DELETE') {
      const session = await sessions.supprimerNoteVocale(id, subId);
      await voix.supprimer(id, note);
      return sendJson(res, 200, { session, deleted: true });
    }
    throw methodNotAllowed(method, ['GET', 'DELETE']);
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

/** L'équipe : lecture ouverte, modifications réservées au coach. */
async function handleAthletes(req, res, url, segments, athletes, coach) {
  const { method } = req;
  const [, id, ...reste] = segments;
  if (reste.length) throw notFound(`Route inconnue : ${url.pathname}`);

  if (!id) {
    if (method === 'GET') {
      const liste = athletes.liste({ inactifs: url.searchParams.get('inactifs') === 'true' });
      return sendJson(res, 200, { athletes: liste, total: liste.length });
    }
    if (method === 'POST') {
      if (!coach) throw cleCoachRequise('Seul le coach peut ajouter un athlète.');
      const athlete = await athletes.ajouter(await readJsonBody(req));
      res.setHeader('Location', `/api/athletes/${athlete.id}`);
      return sendJson(res, 201, { athlete });
    }
    throw methodNotAllowed(method, ['GET', 'POST']);
  }

  if (method === 'GET') return sendJson(res, 200, { athlete: athletes.mustFind(id) });
  if (method === 'PATCH' || method === 'PUT') {
    if (!coach) throw cleCoachRequise('Seul le coach peut modifier l’équipe.');
    return sendJson(res, 200, { athlete: await athletes.modifier(id, await readJsonBody(req)) });
  }
  if (method === 'DELETE') {
    // Retrait, pas suppression : ses inscriptions et ses mots gardent son nom.
    if (!coach) throw cleCoachRequise('Seul le coach peut retirer un athlète.');
    return sendJson(res, 200, { athlete: await athletes.retirer(id), retire: true });
  }
  throw methodNotAllowed(method, ['GET', 'PATCH', 'DELETE']);
}

function apiIndex() {
  return {
    name: 'API Calendrier — planification sur un an, présentation sur 7 jours',
    version,
    timezone: TIMEZONE,
    acces: {
      entete: ENTETE,
      coach: 'Créer, modifier, archiver et restaurer une séance ; les notes vocales ; les photos et leur visibilité ; retirer un message.',
      equipe: 'Consulter le calendrier, s’inscrire à une séance, s’en retirer, laisser un mot, voir les photos publiées.'
    },
    joursVisibles: DAYS_IN_VIEW,
    moisHorizon: MOIS_HORIZON,
    heuresPossibles: TIMES,
    statuts: STATUTS.map((s) => s.id),
    lieux: LOCATIONS.map((l) => l.id),
    athletes: 'voir /api/athletes',
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'État du service.' },
      { method: 'GET', path: '/api/locations', description: 'Les 5 lieux possibles.' },
      { method: 'GET', path: '/api/times', description: 'Les heures possibles (10:30, 18:00, 18:30).' },
      { method: 'GET', path: '/api/statuts', description: 'Statuts : prévue, effectuée, annulée.' },
      { method: 'GET', path: '/api/athletes?inactifs=', description: 'L’équipe : les athlètes qui peuvent s’inscrire et écrire.' },
      { method: 'POST', path: '/api/athletes', description: 'Ajoute un athlète ({ nom }). Coach uniquement.' },
      { method: 'PATCH', path: '/api/athletes/:id', description: 'Renomme ou réactive un athlète. Coach uniquement.' },
      { method: 'DELETE', path: '/api/athletes/:id', description: 'Retire un athlète de l’équipe. Coach uniquement.' },
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
      {
        method: 'GET',
        path: '/api/semaine?start=YYYY-MM-DD&adresse=',
        description: 'La semaine résumée, avec son texte prêt à coller dans un message.'
      },
      { method: 'GET', path: '/api/export', description: 'Toutes les séances, archives comprises.' },
      {
        method: 'GET',
        path: '/api/sessions?from=&to=&location=&time=&statut=&archivees=',
        description: 'Liste des séances, filtrable.'
      },
      { method: 'POST', path: '/api/sessions', description: 'Crée une séance (date, time, locationId). Coach uniquement.' },
      { method: 'GET', path: '/api/sessions/:id', description: 'Détail d’une séance.' },
      { method: 'PATCH', path: '/api/sessions/:id', description: 'Modifie une séance (dont son statut). Coach uniquement.' },
      { method: 'DELETE', path: '/api/sessions/:id', description: 'Archive une séance (rien n’est effacé). Coach uniquement.' },
      { method: 'POST', path: '/api/sessions/:id/restaurer', description: 'Sort une séance des archives. Coach uniquement.' },
      {
        method: 'POST',
        path: '/api/sessions/:id/participants',
        description: 'Un athlète annonce sa venue ({ athleteId }).'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/participants/:athleteId',
        description: 'Un athlète se retire.'
      },
      { method: 'GET', path: '/api/sessions/:id/messages', description: 'Les mots laissés sur la séance.' },
      {
        method: 'POST',
        path: '/api/sessions/:id/messages',
        description: 'Un athlète laisse un mot ({ athleteId, texte }).'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/messages/:messageId',
        description: 'Retire un message. Coach uniquement.'
      },
      {
        method: 'GET',
        path: '/api/sessions/:id/photos',
        description: 'Les photos de la séance. L’équipe ne voit que celles rendues visibles.'
      },
      {
        method: 'POST',
        path: '/api/sessions/:id/photos',
        description: 'Ajoute une photo ({ image: base64, mimeType, legende }). Cachée à l’arrivée. Coach uniquement.'
      },
      {
        method: 'GET',
        path: '/api/sessions/:id/photos/:photoId',
        description: 'Renvoie l’image. 404 pour l’équipe tant qu’elle n’est pas visible.'
      },
      {
        method: 'PATCH',
        path: '/api/sessions/:id/photos/:photoId',
        description: 'Montre ou cache la photo ({ visible }), corrige sa légende. Coach uniquement.'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/photos/:photoId',
        description: 'Supprime une photo. Coach uniquement.'
      },
      {
        method: 'POST',
        path: '/api/sessions/:id/notes-vocales',
        description: 'Ajoute une note vocale ({ audio: base64, mimeType, duree, transcription }). Coach uniquement.'
      },
      {
        method: 'GET',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Renvoie le son de la note vocale. Coach uniquement.'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Supprime une note vocale. Coach uniquement.'
      }
    ]
  };
}

/**
 * La page publique de la semaine, hors /api : c'est elle qu'on envoie à
 * l'équipe. Elle ne demande aucune clé et ne montre que du public.
 * @returns {{status: number, headers: object, body: string}}
 */
function reponsePartage(sessions, url, application) {
  const resume = resumeSemaine(sessions, { start: url.searchParams.get('start') ?? undefined });
  const corps = pageSemaine(resume, { url: url.href, application });
  return {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': Buffer.byteLength(corps),
      // Cinq minutes : assez pour qu'une messagerie lise l'aperçu sans
      // rappeler le serveur à chaque partage, assez court pour qu'une séance
      // ajoutée apparaisse vite.
      'Cache-Control': 'public, max-age=300'
    },
    body: corps
  };
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

function cleCoachRequise(message = 'Les notes vocales sont réservées au coach.') {
  return new ApiError(401, 'cle_coach_requise', message, {
    entete: ENTETE,
    indice: `Envoyez la clé dans l'en-tête « ${ENTETE} » (ou en paramètre « cle= »).`
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

/** Une photo visible peut être mise en cache par le navigateur ; une photo
    encore privée ne doit l'être que par celui du coach. */
function sendImage(res, bytes, photo, coach) {
  res.writeHead(200, {
    'Content-Type': photo.mimeType,
    'Content-Length': bytes.length,
    'Content-Disposition': `inline; filename="${photo.fichier}"`,
    'Cache-Control': estVisible(photo) ? 'public, max-age=86400' : 'private, max-age=3600',
    ...(coach && !estVisible(photo) ? { 'X-Photo-Visible': 'false' } : {})
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

module.exports = {
  handleApi,
  handleAthletes,
  reponsePartage,
  readJsonBody,
  sendJson,
  sendAudio,
  sendImage,
  sendError,
  setCorsHeaders,
  methodNotAllowed,
  cleCoachRequise,
  MAX_BODY_BYTES,
  MAX_AUDIO_BODY_BYTES,
  MAX_IMAGE_BODY_BYTES
};
