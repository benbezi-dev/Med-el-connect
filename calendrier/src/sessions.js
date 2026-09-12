/* Séances du calendrier : validation, unicité, statuts et CRUD.

   Une séance = un lieu, un jour, une heure (18:00 ou 18:30). Deux séances ne
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
const { isValidDateISO, todayISO } = require('./dates');
const {
  findLocation,
  findStatut,
  isValidTime,
  TIMES,
  LOCATIONS,
  STATUTS,
  STATUT_PAR_DEFAUT,
  TIMEZONE
} = require('./reference');
const { ATHLETES, findAthlete } = require('./athletes');
const { ApiError, badRequest, notFound, conflict } = require('./errors');

const MAX_TITLE = 120;
const MAX_COACH = 80;
const MAX_NOTES = 2000;
const MAX_CAPACITY = 200;
const MAX_PARTICIPANTS = 200;
const MAX_NOTE_ATHLETE = 1000;
const DEFAULT_TITLE = 'Entraînement';
const DEFAULT_CAPACITY = 20;

/** Une séance annulée ou archivée libère son créneau. */
function occupeLeCreneau(session) {
  return !session.archivee && session.statut !== 'annulee';
}

class SessionService {
  constructor(store) {
    this.store = store;
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
      .map(decorate)
      .sort(compareSessions);
  }

  /** Une séance archivée reste accessible par son identifiant. */
  get(id) {
    const session = this.store.find(id);
    if (!session) throw notFound(`Aucune séance avec l'identifiant « ${id} ».`);
    return decorate(session);
  }

  async create(payload) {
    const input = validate(payload, { partial: false });
    this.verifierCreneauLibre(input, null);

    const now = new Date().toISOString();
    const session = {
      id: `ses_${crypto.randomUUID()}`,
      ...input,
      notesVocales: [],
      notesAthletes: [],
      historique: [{ statut: input.statut, at: now }],
      archivee: false,
      archiveeLe: null,
      createdAt: now,
      updatedAt: now
    };
    await this.store.remplacer([...this.store.all(), session]);
    return decorate(session);
  }

  async update(id, payload) {
    const existing = this.mustFind(id);
    const changes = validate(payload, { partial: true });
    const now = new Date().toISOString();
    const updated = { ...existing, ...changes, updatedAt: now };

    this.verifierCreneauLibre(updated, id);

    // Chaque passage « prévue → effectuée » (ou autre) est daté et conservé.
    if (changes.statut && changes.statut !== existing.statut) {
      updated.historique = [...(existing.historique ?? []), { statut: changes.statut, at: now }];
    }

    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated);
  }

  /** Retire la séance de la grille sans rien perdre. */
  async archive(id) {
    const existing = this.mustFind(id);
    if (existing.archivee) return decorate(existing);

    const now = new Date().toISOString();
    const archivee = { ...existing, archivee: true, archiveeLe: now, updatedAt: now };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? archivee : s)));
    return decorate(archivee);
  }

  /** Remet une séance archivée dans la grille, si son créneau est resté libre. */
  async restore(id) {
    const existing = this.mustFind(id);
    if (!existing.archivee) return decorate(existing);

    const now = new Date().toISOString();
    const restauree = { ...existing, archivee: false, archiveeLe: null, updatedAt: now };
    this.verifierCreneauLibre(restauree, id);

    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? restauree : s)));
    return decorate(restauree);
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
    return decorate(updated);
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
    return decorate(updated);
  }

  /* ---------- Notes d'athlètes ----------

     Chaque athlète écrit son propre compte rendu sur une séance qui a eu
     lieu. Il ne touche qu'à ses notes : l'athlète est comparé à l'auteur
     avant toute modification. */

  /** @param {{athleteId: string, texte: string}} entree */
  async ajouterNoteAthlete(id, entree) {
    const existing = this.mustFind(id);
    const { athlete, texte } = validerNoteAthlete(entree);
    this.verifierSeanceCommentable(existing);

    const now = new Date().toISOString();
    const note = { id: `note_${crypto.randomUUID()}`, athleteId: athlete.id, texte, createdAt: now, updatedAt: now };
    const updated = {
      ...existing,
      notesAthletes: [...(existing.notesAthletes ?? []), note],
      updatedAt: now
    };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return { note: decorerNoteAthlete(note), session: decorate(updated) };
  }

  async modifierNoteAthlete(id, noteId, entree) {
    const existing = this.mustFind(id);
    const note = this.trouverNoteAthlete(id, noteId);
    const { athlete, texte } = validerNoteAthlete(entree);
    this.verifierAuteur(note, athlete);

    const now = new Date().toISOString();
    const modifiee = { ...note, texte, updatedAt: now };
    const updated = {
      ...existing,
      notesAthletes: (existing.notesAthletes ?? []).map((n) => (n.id === noteId ? modifiee : n)),
      updatedAt: now
    };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return { note: decorerNoteAthlete(modifiee), session: decorate(updated) };
  }

  /** @param {string|null} athleteId l'athlète qui demande ; null pour le coach. */
  async supprimerNoteAthlete(id, noteId, athleteId) {
    const existing = this.mustFind(id);
    const note = this.trouverNoteAthlete(id, noteId);
    if (athleteId !== null) this.verifierAuteur(note, exigerAthlete(athleteId));

    const updated = {
      ...existing,
      notesAthletes: (existing.notesAthletes ?? []).filter((n) => n.id !== noteId),
      updatedAt: new Date().toISOString()
    };
    await this.store.remplacer(this.store.all().map((s) => (s.id === id ? updated : s)));
    return decorate(updated);
  }

  trouverNoteAthlete(id, noteId) {
    const session = this.mustFind(id);
    const note = (session.notesAthletes ?? []).find((n) => n.id === noteId);
    if (!note) throw notFound(`Aucune note « ${noteId} » sur cette séance.`);
    return note;
  }

  /** On commente ce qui a eu lieu, pas ce qui est à venir. */
  verifierSeanceCommentable(session) {
    if (session.archivee) {
      throw conflict('Cette séance est archivée : elle ne reçoit plus de notes.');
    }
    if (session.date > todayISO(TIMEZONE)) {
      throw badRequest('Cette séance n’a pas encore eu lieu : elle ne peut pas encore recevoir de note.', {
        dateSeance: session.date,
        aujourdhui: todayISO(TIMEZONE)
      });
    }
  }

  verifierAuteur(note, athlete) {
    if (note.athleteId !== athlete.id) {
      throw new ApiError(403, 'note_d_un_autre', 'Cette note appartient à un autre athlète.', {
        auteur: findAthlete(note.athleteId)?.nom ?? note.athleteId
      });
    }
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

/** Vérifie l'athlète et le texte d'une note. */
function validerNoteAthlete(entree) {
  const source = entree && typeof entree === 'object' ? entree : {};
  const athlete = exigerAthlete(source.athleteId);

  const texte = String(source.texte ?? '').trim();
  if (!texte) throw badRequest('Le champ « texte » est obligatoire et ne peut pas être vide.');
  if (texte.length > MAX_NOTE_ATHLETE) {
    throw badRequest(`Le champ « texte » ne peut pas dépasser ${MAX_NOTE_ATHLETE} caractères.`);
  }
  return { athlete, texte };
}

function exigerAthlete(athleteId) {
  const athlete = findAthlete(athleteId);
  if (!athlete) {
    throw badRequest('Le champ « athleteId » ne correspond à aucun athlète connu.', {
      athletesPossibles: ATHLETES.map((a) => a.id)
    });
  }
  return athlete;
}

/** La note porte son auteur au complet : le nom accompagne toujours la couleur. */
function decorerNoteAthlete(note) {
  const athlete = findAthlete(note.athleteId);
  return { ...note, athlete: athlete ?? null };
}

/** Ajoute les champs dérivés — jamais stockés, toujours recalculés. */
function decorate(session) {
  const participants = session.participants ?? [];
  const statut = session.statut ?? STATUT_PAR_DEFAUT;
  const notesAthletes = (session.notesAthletes ?? []).map(decorerNoteAthlete);
  return {
    ...session,
    participants,
    statut,
    statutLabel: findStatut(statut)?.label ?? statut,
    notesVocales: session.notesVocales ?? [],
    notesAthletes,
    historique: session.historique ?? [],
    archivee: Boolean(session.archivee),
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

module.exports = { SessionService, occupeLeCreneau, MAX_NOTES };
