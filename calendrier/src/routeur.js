/* Routage de l'API, indépendant du transport.

   Ce module ne connaît ni node:http ni fetch : il reçoit une requête décrite
   simplement et rend une réponse décrite simplement. Deux coquilles
   l'utilisent — `server.js` pour Node, `worker.mjs` pour Cloudflare Workers —
   et il n'existe donc qu'une seule implémentation des routes.

   La requête :
     { methode, url: URL, entetes: {…}, lireJson: (limiteOctets) => Promise }

   `lireJson` est paresseux à dessein : on ne lit le corps que si la route en
   veut un, et jamais au-delà de la limite. */

const { buildCalendar } = require('./calendar');
const { buildAnnee } = require('./annee');
const { buildSuivi } = require('./suivi');
const { LOCATIONS, TIMES, STATUTS, TIMEZONE, DAYS_IN_VIEW, MOIS_HORIZON } = require('./reference');
const { ATHLETES } = require('./athletes');
const { estCoach, athleteDeclare, protege, ENTETE, ENTETE_ATHLETE } = require('./acces');
const { preparerNote, corrigerNote } = require('./voix');
const { ApiError, notFound } = require('./errors');

const MAX_BODY_BYTES = 64 * 1024;

/**
 * @param {{sessions: object, acces: object, stockage: object}} services
 * @returns {(requete: object) => Promise<{statut: number, entetes: object, corps: string|Uint8Array}>}
 */
function creerRouteur({ sessions, acces, stockage }) {
  return async function routeur(requete) {
    // acces.js lit les en-têtes d'un objet façon node:http.
    const porteur = { headers: requete.entetes };
    const qui = {
      coach: estCoach(porteur, requete.url, acces.cle),
      athleteId: athleteDeclare(porteur, requete.url)
    };

    try {
      return await distribuer(requete, qui, { sessions, stockage });
    } catch (erreur) {
      return erreurEnReponse(erreur);
    }
  };
}

async function distribuer(requete, qui, services) {
  const { url, methode } = requete;
  const { coach, athleteId } = qui;
  const { sessions, stockage } = services;

  const route = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const segments = route ? route.split('/') : [];

  if (segments.length === 0) {
    if (methode !== 'GET') throw methodNotAllowed(methode, ['GET']);
    return json(200, apiIndex());
  }

  const [resource] = segments;

  // Les séances ont leur propre routeur : POST /api/sessions ne doit pas
  // tomber dans le garde « lecture seule » des ressources ci-dessous.
  if (resource === 'sessions') return routerSeances(requete, segments, qui, services);

  if (segments.length === 1) {
    if (methode !== 'GET') throw methodNotAllowed(methode, ['GET']);

    if (resource === 'health') {
      return json(200, {
        status: 'ok',
        timezone: TIMEZONE,
        coach,
        // Le chemin exact ne regarde que le coach.
        stockage: coach ? stockage.decrire() : { type: stockage.decrire().type },
        now: new Date().toISOString()
      });
    }
    if (resource === 'locations') return json(200, { locations: LOCATIONS, total: LOCATIONS.length });
    if (resource === 'times') return json(200, { times: TIMES, timezone: TIMEZONE });
    if (resource === 'statuts') return json(200, { statuts: STATUTS });
    if (resource === 'athletes') return json(200, { athletes: ATHLETES, total: ATHLETES.length });

    if (resource === 'suivi') {
      // Le suivi rassemble les notes de tout le monde : il n'appartient qu'au coach.
      if (!coach) throw suiviReserve();
      return json(200, buildSuivi(sessions, {
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        jours: url.searchParams.get('jours') ?? undefined
      }));
    }
    if (resource === 'calendar') {
      const grille = buildCalendar(sessions, {
        start: url.searchParams.get('start') ?? undefined,
        days: url.searchParams.get('days') ?? undefined
      });
      // `coach` dit à la page si elle doit proposer la dictée,
      // `athlete` qui elle doit laisser écrire.
      return json(200, protege({ ...grille, coach, athlete: athleteId }, coach, athleteId));
    }
    if (resource === 'annee') {
      return json(200, buildAnnee(sessions, {
        start: url.searchParams.get('start') ?? undefined,
        mois: url.searchParams.get('mois') ?? undefined
      }));
    }
    if (resource === 'export') {
      // Tout, archives comprises : rien de ce qui a été saisi n'est perdu.
      const toutes = sessions.list({ archivees: true });
      return json(
        200,
        protege({ exporteLe: new Date().toISOString(), total: toutes.length, sessions: toutes }, coach, athleteId)
      );
    }
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

async function routerSeances(requete, segments, qui, services) {
  const { url, methode } = requete;
  const { coach, athleteId } = qui;
  const { sessions } = services;
  const [, id, sub, subId] = segments;

  if (!id) {
    if (methode === 'GET') {
      const list = sessions.list({
        from: url.searchParams.get('from') ?? undefined,
        to: url.searchParams.get('to') ?? undefined,
        locationId: url.searchParams.get('location') ?? undefined,
        time: url.searchParams.get('time') ?? undefined,
        statut: url.searchParams.get('statut') ?? undefined,
        archivees: url.searchParams.get('archivees') === 'true'
      });
      return json(200, protege({ sessions: list, total: list.length }, coach, athleteId));
    }
    if (methode === 'POST') {
      // Le calendrier est fixé par le coach : un athlète ne crée pas de séance.
      if (!coach) throw ecritureReservee('créer une séance');
      const created = await sessions.create(await requete.lireJson(MAX_BODY_BYTES));
      return json(201, protege({ session: created }, coach, athleteId), {
        Location: `/api/sessions/${created.id}`
      });
    }
    throw methodNotAllowed(methode, ['GET', 'POST']);
  }

  if (!sub) {
    if (methode === 'GET') return json(200, protege({ session: sessions.get(id) }, coach, athleteId));
    if (methode === 'PATCH' || methode === 'PUT') {
      if (!coach) throw ecritureReservee('modifier une séance');
      const maj = await sessions.update(id, await requete.lireJson(MAX_BODY_BYTES));
      return json(200, protege({ session: maj }, coach, athleteId));
    }
    if (methode === 'DELETE') {
      // Archivage, pas suppression : la séance reste dans le fichier.
      if (!coach) throw ecritureReservee('archiver une séance');
      return json(200, protege({ session: await sessions.archive(id), archivee: true }, coach, athleteId));
    }
    throw methodNotAllowed(methode, ['GET', 'PATCH', 'DELETE']);
  }

  if (sub === 'restaurer' && !subId) {
    if (methode !== 'POST') throw methodNotAllowed(methode, ['POST']);
    if (!coach) throw ecritureReservee('restaurer une séance');
    return json(200, protege({ session: await sessions.restore(id) }, coach, athleteId));
  }

  if (sub === 'notes-athlete') return routerNotesAthlete(requete, { id, noteId: subId }, qui, sessions);

  if (sub === 'notes-vocales') {
    // Les notes du coach sont réservées au coach, en lecture comme en écriture.
    if (!coach) throw cleCoachRequise();

    if (!subId) {
      if (methode === 'GET') return json(200, { notesVocales: sessions.get(id).notesVocales });
      if (methode === 'POST') {
        sessions.get(id); // 404 avant d'écrire quoi que ce soit
        const note = preparerNote(await requete.lireJson(MAX_BODY_BYTES));
        const session = await sessions.ajouterNoteVocale(id, note);
        return json(201, { noteVocale: note, session }, {
          Location: `/api/sessions/${id}/notes-vocales/${note.id}`
        });
      }
      throw methodNotAllowed(methode, ['GET', 'POST']);
    }

    const note = sessions.trouverNoteVocale(id, subId);
    // La reconnaissance vocale se trompe : une note se relit et se corrige.
    if (methode === 'PATCH' || methode === 'PUT') {
      const corrigee = corrigerNote(note, await requete.lireJson(MAX_BODY_BYTES));
      const session = await sessions.remplacerNoteVocale(id, subId, corrigee);
      return json(200, { noteVocale: corrigee, session });
    }
    if (methode === 'DELETE') {
      return json(200, { session: await sessions.supprimerNoteVocale(id, subId), deleted: true });
    }
    throw methodNotAllowed(methode, ['PATCH', 'DELETE']);
  }

  throw notFound(`Route inconnue : ${url.pathname}`);
}

/* Notes d'athlètes : chacun écrit son compte rendu sur une séance qui a eu
   lieu, et ne touche qu'aux siennes. Le coach, lui, lit et supprime tout. */
async function routerNotesAthlete(requete, { id, noteId }, qui, sessions) {
  const { methode } = requete;
  const { coach, athleteId } = qui;

  if (!noteId) {
    if (methode === 'GET') {
      const notes = sessions.get(id).notesAthletes;
      return json(200, { notesAthletes: coach ? notes : notes.filter((n) => n.athleteId === athleteId) });
    }
    if (methode === 'POST') {
      const corps = await requete.lireJson(MAX_BODY_BYTES);
      const { note, session } = await sessions.ajouterNoteAthlete(id, {
        athleteId: corps.athleteId ?? athleteId,
        texte: corps.texte
      });
      return json(201, { note, session: protege({ session }, coach, athleteId).session }, {
        Location: `/api/sessions/${id}/notes-athlete/${note.id}`
      });
    }
    throw methodNotAllowed(methode, ['GET', 'POST']);
  }

  if (methode === 'PATCH' || methode === 'PUT') {
    const corps = await requete.lireJson(MAX_BODY_BYTES);
    const { note, session } = await sessions.modifierNoteAthlete(id, noteId, {
      athleteId: corps.athleteId ?? athleteId,
      texte: corps.texte
    });
    return json(200, { note, session: protege({ session }, coach, athleteId).session });
  }
  if (methode === 'DELETE') {
    // Le coach fait le ménage partout ; un athlète, seulement chez lui.
    const session = await sessions.supprimerNoteAthlete(id, noteId, coach ? null : athleteId);
    return json(200, { session: protege({ session }, coach, athleteId).session, deleted: true });
  }
  throw methodNotAllowed(methode, ['PATCH', 'DELETE']);
}

/* ---------- Réponses ---------- */

function json(statut, payload, entetes) {
  return {
    statut,
    entetes: { 'Content-Type': 'application/json; charset=utf-8', ...entetes },
    corps: JSON.stringify(payload, null, 2)
  };
}

function erreurEnReponse(erreur) {
  if (erreur instanceof ApiError) {
    const reponse = json(erreur.status, erreur.toJSON());
    // Un corps trop gros laisse des octets en vol : la coquille doit fermer
    // la connexion, mais seulement après avoir écrit cette réponse.
    if (erreur.status === 413) reponse.fermerConnexion = true;
    return reponse;
  }
  console.error('[calendrier] erreur inattendue :', erreur);
  return json(500, { error: { code: 'internal_error', message: 'Erreur interne du serveur.' } });
}

function cleCoachRequise() {
  return new ApiError(401, 'cle_coach_requise', 'Les notes vocales sont réservées au coach.', {
    entete: ENTETE,
    indice: `Envoyez la clé dans l'en-tête « ${ENTETE} » (ou en paramètre « cle= »).`
  });
}

/* Le lien du calendrier circule : le planning appartient au coach, et lui
   seul. Les athlètes gardent la lecture et leurs propres notes. */
function ecritureReservee(action) {
  return new ApiError(401, 'cle_coach_requise', `Seul le coach peut ${action}.`, {
    entete: ENTETE,
    indice: `Passez en mode coach, ou envoyez la clé dans l'en-tête « ${ENTETE} ».`
  });
}

function suiviReserve() {
  return new ApiError(401, 'cle_coach_requise', 'Le suivi des athlètes est réservé au coach.', {
    entete: ENTETE,
    indice: `Chaque athlète retrouve ses propres notes en se déclarant dans l'en-tête « ${ENTETE_ATHLETE} ».`
  });
}

function methodNotAllowed(method, allowed) {
  return new ApiError(405, 'method_not_allowed', `Méthode ${method} non autorisée.`, { autorisees: allowed });
}

function apiIndex() {
  return {
    name: 'API Calendrier — planification sur un an, présentation sur 7 jours',
    timezone: TIMEZONE,
    notesVocales: {
      acces: 'coach',
      entete: ENTETE,
      description:
        'Dictées dans le navigateur : seul le texte est conservé, jamais le son. ' +
        'Ni listées ni lisibles sans la clé coach.'
    },
    notesAthletes: {
      acces: 'athlète déclaré',
      entete: ENTETE_ATHLETE,
      description:
        'Chaque athlète écrit ses comptes rendus et ne voit que les siens ; ' +
        'le coach les voit tous, regroupés dans /api/suivi.'
    },
    ecriture: {
      acces: 'coach',
      description: 'Créer, modifier, archiver et restaurer une séance demandent la clé coach.'
    },
    joursVisibles: DAYS_IN_VIEW,
    moisHorizon: MOIS_HORIZON,
    heuresPossibles: TIMES,
    statuts: STATUTS.map((s) => s.id),
    lieux: LOCATIONS.map((l) => l.id),
    athletes: ATHLETES.map((a) => a.id),
    endpoints: [
      { method: 'GET', path: '/api/health', description: 'État du service.' },
      { method: 'GET', path: '/api/locations', description: 'Les 5 lieux possibles.' },
      { method: 'GET', path: '/api/times', description: 'Les heures possibles (18:00, 18:30).' },
      { method: 'GET', path: '/api/statuts', description: 'Statuts : prévue, effectuée, annulée.' },
      { method: 'GET', path: '/api/athletes', description: 'Les athlètes du groupe, avec leur couleur.' },
      {
        method: 'GET',
        path: '/api/suivi?from=&to=&jours=30',
        description: 'Les notes des athlètes, groupées par auteur. Coach uniquement.'
      },
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
      { method: 'POST', path: '/api/sessions', description: 'Crée une séance (date, time, locationId). Coach.' },
      { method: 'GET', path: '/api/sessions/:id', description: 'Détail d’une séance.' },
      { method: 'PATCH', path: '/api/sessions/:id', description: 'Modifie une séance (dont son statut). Coach.' },
      { method: 'DELETE', path: '/api/sessions/:id', description: 'Archive une séance (rien n’est effacé). Coach.' },
      { method: 'POST', path: '/api/sessions/:id/restaurer', description: 'Sort une séance des archives. Coach.' },
      {
        method: 'POST',
        path: '/api/sessions/:id/notes-athlete',
        description: 'Un athlète écrit son compte rendu ({ athleteId, texte }) sur une séance passée.'
      },
      {
        method: 'PATCH',
        path: '/api/sessions/:id/notes-athlete/:noteId',
        description: 'Un athlète corrige sa propre note.'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/notes-athlete/:noteId',
        description: 'Un athlète supprime sa propre note ; le coach, n’importe laquelle.'
      },
      {
        method: 'POST',
        path: '/api/sessions/:id/notes-vocales',
        description: 'Ajoute une note dictée ({ transcription, duree, source }). Coach uniquement.'
      },
      {
        method: 'PATCH',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Corrige le texte d’une note dictée. Coach uniquement.'
      },
      {
        method: 'DELETE',
        path: '/api/sessions/:id/notes-vocales/:noteId',
        description: 'Supprime une note dictée. Coach uniquement.'
      }
    ]
  };
}

module.exports = { creerRouteur, MAX_BODY_BYTES };
