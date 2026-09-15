/* Séances du calendrier : validation, unicité, statuts et CRUD.

   Une séance = un lieu, un jour, l'une des heures possibles. Deux séances ne
   peuvent pas occuper le même lieu au même créneau ; en revanche les 5 lieux
   peuvent tourner en parallèle sur le même créneau.

   Rien n'est jamais effacé : une séance supprimée est archivée (elle sort de
   la grille mais reste dans le dépôt, avec son historique de statuts et ses
   notes vocales), et chaque changement de statut est daté.

   Les lectures sont synchrones (tout est en mémoire) ; les écritures sont
   asynchrones : elles attendent que le dépôt ait accepté avant de rendre la
   main, pour qu'un refus (Drive injoignable, par exemple) remonte à
   l'appelant au lieu d'être perdu. */

const crypto = require('node:crypto');
const { isValidDateISO } = require('./dates');
const {
  findLocation,
  findStatut,
  isValidTime,
  TIMES,
  LOCATIONS,
  STATUTS,
  STATUT_PAR_DEFAUT
} = require('./reference');
const { badRequest, notFound, conflict } = require('./errors');

const MAX_TITLE = 120;
const MAX_COACH = 80;
const MAX_NOTES = 2000;
const MAX_CAPACITY = 200;
const MAX_PARTICIPANTS = 200;
const MAX_MESSAGE = 500;
const MAX_MESSAGES = 200;
const DEFAULT_TITLE = 'Entraînement';
const DEFAULT_CAPACITY = 20;

/** Une séance annulée ou archivée libère son créneau. */
function occupeLeCreneau(session) {
  return !session.archivee && session.statut !== 'annulee';
}

class SessionService {
  /** @param {object} athletes l'équipe vivante, seule à savoir qui en fait partie. */
  constructor(store, athletes) {
    this.store = store;
    this.athletes = athletes;
  }

  /** Liste filtrée et triée (date, heure, lieu). Les archives sont exclues par défaut. */
  list({ from, to, locationId, time, statut, archivees = false } = {}) {
    if (from !== undefined && !isValidDateISO(from)) {
      throw badRequest('Le paramètre « from » doit être une date au format YYYY-MM-DD.');
    }
    if (to !== undefined && !isValidDateISO(to)) {
      throw badRequest('Le paramètre « to » doit être une date au format YYYY-MM-DD.');
    }
    if (time !== undefined && !isValidTime(time)) {
      throw badRequest(`Le paramètre « time » doit valoir ${TIMES.join(' ou ')}.`);
    }
    if (locationId !== undefined && !findLocation(locationId)) {
      throw badRequest('Le paramètre « location » ne correspond à aucun lieu connu.', {
        lieuxPossibles: LOCATIONS.map((l) => l.id)
      });
    }
    if (statut !== undefined && !findStatut(statut)) {
      throw badRequest('Le paramètre « statut » ne correspond à aucun statut connu.', {
        statutsPossibles: STATUTS.map((s) => s.id)
      });
    }

    return this.store
      .all()
      .filter((session) => {
        if (!archivees && session.archivee) return false;
        if (from && session.date < from) return false;
        if (to && session.date > to) return false;
        if (locationId && session.locationId !== locationId) return false;
        if (time && session.time !== time) return false;
        if (statut && session.statut !== statut) return false;
        return true;
      })
      .map((session) => decorate(session, this.athletes))
      .sort(compareSessions);
  }

  /** Une séance archivée reste accessible par son identifiant. */
  get(id) {
    const session = this.store.find(id);
    if (!session) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);
    return decorate(session, this.athletes);
  }

  async create(payload) {
    const input = validate(payload, { partial: false, athletes: this.athletes });
    this.verifierCreneauLibre(input, null);

    const now = new Date().toISOString();
    const session = {
      id: `ses_${crypto.randomUUID()}`,
      ...input,
      notesVocales: [],
      messages: [],
      historique: [{ statut: input.statut, at: now }],
      archivee: false,
      archiveeLe: null,
      createdAt: now,
      updatedAt: now
    };
    await this.store.remplacer([...this.store.all(), session]);
    return decorate(session, this.athletes);
  }

  async update(id, payload) {
    const existing = this.mustFind(id);
    const changes = validate(payload, { partial: true, athletes: this.athletes });
    const now = new Date().toISOString();
    const updated = { ...existing, ...changes, updatedAt: now };

    this.verifierCreneauLibre(updated, id);

    // Chaque passage « prévue → effectuée » (ou autre) est daté et conservé.
    if (changes.statut && changes.statut !== existing.statut) {
      updated.historique = [...(existing.historique ?? []), { statut: changes.statut, at: now }];
    }

    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated, this.athletes);
  }

  /** Retire la séance de la grille sans rien perdre. */
  async archive(id) {
    const existing = this.mustFind(id);
    if (existing.archivee) return decorate(existing, this.athletes);

    const now = new Date().toISOString();
    const archivee = { ...existing, archivee: true, archiveeLe: now, updatedAt: now };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? archivee : s)));
    return decorate(archivee, this.athletes);
  }

  /** Remet une séance archivée dans la grille, si son créneau est resté libre. */
  async restore(id) {
    const existing = this.mustFind(id);
    if (!existing.archivee) return decorate(existing, this.athletes);

    const now = new Date().toISOString();
    const restauree = { ...existing, archivee: false, archiveeLe: null, updatedAt: now };
    this.verifierCreneauLibre(restauree, id);

    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? restauree : s)));
    return decorate(restauree, this.athletes);
  }

  /* ---------- ce que disent les athlètes ---------- */

  /** L'athlète annonce sa venue. Deux fois de suite ne change rien. */
  async inscrire(id, athleteId) {
    const existing = this.mustFind(id);
    const athlete = athleteConnu(this.athletes, athleteId);

    if (existing.statut === 'annulee') throw conflict('Cette séance est annulée.');
    const participants = existing.participants ?? [];
    if (participants.includes(athlete.id)) return decorate(existing, this.athletes);
    if (participants.length >= existing.capacity) {
      throw conflict('Cette séance est complète.', { capacity: existing.capacity });
    }

    return this.remplacerSeance(id, {
      ...existing,
      participants: [...participants, athlete.id],
      updatedAt: new Date().toISOString()
    });
  }

  /** L'athlète se retire. Absent de la liste, la demande passe quand même. */
  async desinscrire(id, athleteId) {
    const existing = this.mustFind(id);
    const athlete = athleteConnu(this.athletes, athleteId);
    const participants = (existing.participants ?? []).filter((inscrit) => inscrit !== athlete.id);
    if (participants.length === (existing.participants ?? []).length) return decorate(existing, this.athletes);

    return this.remplacerSeance(id, { ...existing, participants, updatedAt: new Date().toISOString() });
  }

  /** Un mot laissé sur la séance, signé du nom choisi dans l'équipe. */
  async ajouterMessage(id, payload) {
    const existing = this.mustFind(id);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('Le corps de la requête doit être un objet JSON.');
    }
    const athlete = athleteConnu(this.athletes, payload.athleteId);
    const texte = text(payload.texte, 'texte', MAX_MESSAGE);

    const messages = existing.messages ?? [];
    if (messages.length >= MAX_MESSAGES) {
      throw conflict(`Cette séance porte déjà ${MAX_MESSAGES} messages.`);
    }

    const message = {
      id: `msg_${crypto.randomUUID()}`,
      athleteId: athlete.id,
      texte,
      createdAt: new Date().toISOString()
    };
    return this.remplacerSeance(id, {
      ...existing,
      messages: [...messages, message],
      updatedAt: new Date().toISOString()
    });
  }

  async supprimerMessage(id, messageId) {
    const existing = this.mustFind(id);
    const messages = existing.messages ?? [];
    if (!messages.some((m) => m.id === messageId)) {
      throw notFound(`Aucun message « ${messageId} » sur cette séance.`);
    }
    return this.remplacerSeance(id, {
      ...existing,
      messages: messages.filter((m) => m.id !== messageId),
      updatedAt: new Date().toISOString()
    });
  }

  /** Persiste une séance modifiée à la place de l'ancienne. */
  async remplacerSeance(id, seance) {
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? seance : s)));
    return decorate(seance, this.athletes);
  }

  /** Attache les métadonnées d'une note vocale (le son est stocké par VoiceStore). */
  async ajouterNoteVocale(id, note) {
    const existing = this.mustFind(id);
    const updated = {
      ...existing,
      notesVocales: [...(existing.notesVocales ?? []), note],
      updatedAt: new Date().toISOString()
    };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated, this.athletes);
  }

  trouverNoteVocale(id, noteId) {
    const session = this.mustFind(id);
    const note = (session.notesVocales ?? []).find((n) => n.id === noteId);
    if (!note) throw notFound(`Aucune note vocale « ${noteId} » sur cette séance.`);
    return note;
  }

  async supprimerNoteVocale(id, noteId) {
    const existing = this.mustFind(id);
    this.trouverNoteVocale(id, noteId);
    const updated = {
      ...existing,
      notesVocales: (existing.notesVocales ?? []).filter((n) => n.id !== noteId),
      updatedAt: new Date().toISOString()
    };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated, this.athletes);
  }

  mustFind(id) {
    const session = this.store.find(id);
    if (!session) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);
    return session;
  }

  /** @param {string|null} idIgnore identifiant à ne pas considérer (mise à jour). */
  verifierCreneauLibre(session, idIgnore) {
    if (!occupeLeCreneau(session)) return;
    const clash = this.store
      .all()
      .find(
        (s) =>
          s.id !== idIgnore &&
          occupeLeCreneau(s) &&
          s.date === session.date &&
          s.time === session.time &&
          s.locationId === session.locationId
      );
    if (clash) throw conflict('Ce lieu est déjà occupé sur ce créneau.', { sessionExistante: clash.id });
  }
}

/** Ajoute les champs dérivés — jamais stockés, toujours recalculés. */
function decorate(session, athletes) {
  const participants = session.participants ?? [];
  const statut = session.statut ?? STATUT_PAR_DEFAUT;
  return {
    ...session,
    participants,
    inscrits: participants.map((id) => nommer(athletes, id)),
    messages: (session.messages ?? []).map((message) => ({
      ...message,
      athlete: nommer(athletes, message.athleteId)
    })),
    statut,
    statutLabel: findStatut(statut)?.label ?? statut,
    notesVocales: session.notesVocales ?? [],
    historique: session.historique ?? [],
    archivee: Boolean(session.archivee),
    location: findLocation(session.locationId) ?? null,
    placesRestantes: Math.max(0, session.capacity - participants.length)
  };
}

/** Un athlète vu d'une séance : son identité, sans l'état de son appartenance
    à l'équipe — qui ne regarde que la gestion de l'équipe elle-même. */
function nommer(athletes, id) {
  const athlete = athletes.trouver(id);
  return athlete ? { id: athlete.id, nom: athlete.nom } : { id, nom: id };
}

function compareSessions(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    a.locationId.localeCompare(b.locationId)
  );
}

/** Valide et normalise un payload. En mode `partial`, seuls les champs présents sont traités. */
function validate(payload, { partial, athletes }) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('Le corps de la requête doit être un objet JSON.');
  }

  const result = {};
  const has = (key) => payload[key] !== undefined;
  const required = (key, label) => {
    if (!partial && !has(key)) throw badRequest(`Le champ « ${label} » est obligatoire.`);
  };

  required('date', 'date');
  if (has('date')) {
    if (!isValidDateISO(payload.date)) {
      throw badRequest('Le champ « date » doit être une date valide au format YYYY-MM-DD.');
    }
    result.date = payload.date;
  }

  required('time', 'time');
  if (has('time')) {
    if (!isValidTime(payload.time)) {
      throw badRequest(`Le champ « time » doit valoir ${TIMES.join(' ou ')}.`, { heuresPossibles: TIMES });
    }
    result.time = String(payload.time).trim();
  }

  required('locationId', 'locationId');
  if (has('locationId')) {
    const location = findLocation(payload.locationId);
    if (!location) {
      throw badRequest('Le champ « locationId » ne correspond à aucun lieu connu.', {
        lieuxPossibles: LOCATIONS.map((l) => ({ id: l.id, name: l.name }))
      });
    }
    result.locationId = location.id;
  }

  if (has('statut')) {
    const statut = findStatut(payload.statut);
    if (!statut) {
      throw badRequest('Le champ « statut » ne correspond à aucun statut connu.', {
        statutsPossibles: STATUTS.map((s) => ({ id: s.id, label: s.label }))
      });
    }
    result.statut = statut.id;
  } else if (!partial) {
    result.statut = STATUT_PAR_DEFAUT;
  }

  if (has('title')) result.title = text(payload.title, 'title', MAX_TITLE);
  else if (!partial) result.title = DEFAULT_TITLE;

  if (has('coach')) result.coach = text(payload.coach, 'coach', MAX_COACH, { allowEmpty: true });
  else if (!partial) result.coach = '';

  if (has('notes')) result.notes = text(payload.notes, 'notes', MAX_NOTES, { allowEmpty: true });
  else if (!partial) result.notes = '';

  if (has('capacity')) {
    const capacity = payload.capacity;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      throw badRequest(`Le champ « capacity » doit être un entier entre 1 et ${MAX_CAPACITY}.`);
    }
    result.capacity = capacity;
  } else if (!partial) {
    result.capacity = DEFAULT_CAPACITY;
  }

  if (has('participants')) {
    const list = payload.participants;
    if (!Array.isArray(list) || list.length > MAX_PARTICIPANTS) {
      throw badRequest(`Le champ « participants » doit être un tableau d'au plus ${MAX_PARTICIPANTS} athlètes.`);
    }
    // Des identifiants d'athlètes, pas des noms libres : deux orthographes du
    // même prénom compteraient pour deux inscrits.
    result.participants = [...new Set(list.map((valeur, index) => {
      const athlete = athletes.trouverActif(valeur);
      if (!athlete) {
        throw badRequest(`« participants[${index}] » ne correspond à aucun athlète de l'équipe.`, {
          athletes: athletes.liste().map((a) => a.id)
        });
      }
      return athlete.id;
    }))];
  } else if (!partial) {
    result.participants = [];
  }

  if (partial && Object.keys(result).length === 0) {
    throw badRequest('Aucun champ modifiable fourni.');
  }
  return result;
}

function text(value, label, max, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') throw badRequest(`Le champ « ${label} » doit être une chaîne de caractères.`);
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) throw badRequest(`Le champ « ${label} » ne peut pas être vide.`);
  if (trimmed.length > max) throw badRequest(`Le champ « ${label} » dépasse ${max} caractères.`);
  return trimmed;
}

/** @returns {{id: string, nom: string}} l'athlète actif, ou une 400 sinon. */
function athleteConnu(athletes, athleteId) {
  const athlete = athletes.trouverActif(athleteId);
  if (!athlete) {
    throw badRequest('Le champ « athleteId » ne correspond à aucun athlète de l’équipe.', {
      athletes: athletes.liste().map((a) => ({ id: a.id, nom: a.nom }))
    });
  }
  return athlete;
}

module.exports = { SessionService, occupeLeCreneau, MAX_NOTES, MAX_MESSAGE };
