/* Séances du calendrier : validation, unicité et CRUD.

   Une séance = un lieu, un jour, une heure (18:00 ou 18:30). Deux séances ne
   peuvent pas occuper le même lieu au même créneau ; en revanche les 5 lieux
   peuvent tourner en parallèle sur le même créneau. */

const crypto = require('node:crypto');
const { isValidDateISO } = require('./dates');
const { findLocation, isValidTime, TIMES, LOCATIONS } = require('./reference');
const { badRequest, notFound, conflict } = require('./errors');

const MAX_TITLE = 120;
const MAX_COACH = 80;
const MAX_NOTES = 500;
const MAX_CAPACITY = 200;
const MAX_PARTICIPANTS = 200;
const DEFAULT_TITLE = 'Entraînement';
const DEFAULT_CAPACITY = 20;

class SessionService {
  constructor(store) {
    this.store = store;
  }

  /** Liste filtrée et triée (date, heure, lieu). */
  list({ from, to, locationId, time } = {}) {
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
        locationsDisponibles: LOCATIONS.map((l) => l.id)
      });
    }

    return this.store
      .all()
      .filter((session) => {
        if (from && session.date < from) return false;
        if (to && session.date > to) return false;
        if (locationId && session.locationId !== locationId) return false;
        if (time && session.time !== time) return false;
        return true;
      })
      .map(decorate)
      .sort(compareSessions);
  }

  get(id) {
    const session = this.store.find(id);
    if (!session) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);
    return decorate(session);
  }

  create(payload) {
    const input = validate(payload, { partial: false });
    const clash = this.store
      .all()
      .find((s) => s.date === input.date && s.time === input.time && s.locationId === input.locationId);
    if (clash) {
      throw conflict('Ce lieu est déjà occupé sur ce créneau.', { sessionExistante: clash.id });
    }

    const now = new Date().toISOString();
    const session = { id: `ses_${crypto.randomUUID()}`, ...input, createdAt: now, updatedAt: now };
    this.store.replaceAll([...this.store.all(), session]);
    return decorate(session);
  }

  update(id, payload) {
    const existing = this.store.find(id);
    if (!existing) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);

    const changes = validate(payload, { partial: true });
    const updated = { ...existing, ...changes, updatedAt: new Date().toISOString() };

    const clash = this.store
      .all()
      .find(
        (s) =>
          s.id !== id &&
          s.date === updated.date &&
          s.time === updated.time &&
          s.locationId === updated.locationId
      );
    if (clash) {
      throw conflict('Ce lieu est déjà occupé sur ce créneau.', { sessionExistante: clash.id });
    }

    this.store.replaceAll(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated);
  }

  remove(id) {
    const existing = this.store.find(id);
    if (!existing) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);
    this.store.replaceAll(this.store.all().filter((s) => s.id !== id));
    return decorate(existing);
  }
}

/** Ajoute le lieu complet et les places restantes — jamais stockés, toujours dérivés. */
function decorate(session) {
  const participants = session.participants ?? [];
  return {
    ...session,
    participants,
    location: findLocation(session.locationId) ?? null,
    placesRestantes: Math.max(0, session.capacity - participants.length)
  };
}

function compareSessions(a, b) {
  return (
    a.date.localeCompare(b.date) ||
    a.time.localeCompare(b.time) ||
    a.locationId.localeCompare(b.locationId)
  );
}

/** Valide et normalise un payload. En mode `partial`, seuls les champs présents sont traités. */
function validate(payload, { partial }) {
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
      throw badRequest(`Le champ « participants » doit être un tableau d'au plus ${MAX_PARTICIPANTS} noms.`);
    }
    result.participants = list.map((name, index) => text(name, `participants[${index}]`, MAX_COACH));
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

module.exports = { SessionService };
