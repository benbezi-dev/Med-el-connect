/* Construction de la vue calendrier.

   La réponse est déjà structurée comme le tableau affiché : une ligne par
   heure (colonne « Heure » à gauche), une cellule par jour. Le client n'a
   donc aucun regroupement à refaire.

   La planification couvre l'année (`days` jusqu'à 366), mais la page n'en
   montre que 7 jours à la fois. */

const { isValidDateISO, todayISO, addDays, dateRange, describeDay } = require('./dates');
const { LOCATIONS, TIMES, TIMEZONE, DAYS_IN_VIEW, STATUTS } = require('./reference');
const { occupeLeCreneau } = require('./sessions');
const { badRequest } = require('./errors');

const MAX_DAYS = 366;

/** Compte les séances par statut : { prevue, effectuee, annulee, total }. */
function compter(sessions) {
  const totaux = { total: sessions.length };
  for (const statut of STATUTS) {
    totaux[statut.id] = sessions.filter((s) => s.statut === statut.id).length;
  }
  return totaux;
}

/**
 * @param {import('./sessions').SessionService} sessionService
 * @param {{start?: string, days?: number|string}} options
 */
function buildCalendar(sessionService, { start, days } = {}) {
  const today = todayISO(TIMEZONE);

  if (start !== undefined && !isValidDateISO(start)) {
    throw badRequest('Le paramètre « start » doit être une date au format YYYY-MM-DD.');
  }
  const startDate = start ?? today;

  const dayCount = days === undefined ? DAYS_IN_VIEW : Number(days);
  if (!Number.isInteger(dayCount) || dayCount < 1 || dayCount > MAX_DAYS) {
    throw badRequest(`Le paramètre « days » doit être un entier entre 1 et ${MAX_DAYS}.`);
  }

  const dates = dateRange(startDate, dayCount);
  const endDate = dates[dates.length - 1];
  const sessions = sessionService.list({ from: startDate, to: endDate });

  // Index (date|heure) -> séances, pour remplir les cellules en une passe.
  const byCell = new Map();
  const byDay = new Map();
  for (const session of sessions) {
    const cellKey = `${session.date}|${session.time}`;
    if (byCell.has(cellKey)) byCell.get(cellKey).push(session);
    else byCell.set(cellKey, [session]);

    if (byDay.has(session.date)) byDay.get(session.date).push(session);
    else byDay.set(session.date, [session]);
  }

  const rows = TIMES.map((time) => ({
    time,
    cells: dates.map((date) => {
      const cellSessions = byCell.get(`${date}|${time}`) ?? [];
      const occupes = new Set(cellSessions.filter(occupeLeCreneau).map((s) => s.locationId));
      return {
        date,
        time,
        sessions: cellSessions,
        totaux: compter(cellSessions),
        lieuxLibres: LOCATIONS.filter((l) => !occupes.has(l.id)).map((l) => l.id),
        complet: occupes.size === LOCATIONS.length
      };
    })
  }));

  return {
    start: startDate,
    end: endDate,
    today,
    timezone: TIMEZONE,
    previousStart: addDays(startDate, -dayCount),
    nextStart: addDays(startDate, dayCount),
    times: TIMES,
    statuts: STATUTS,
    locations: LOCATIONS,
    days: dates.map((date) => ({
      ...describeDay(date, today),
      totaux: compter(byDay.get(date) ?? [])
    })),
    rows,
    totaux: compter(sessions),
    total: sessions.length
  };
}

module.exports = { buildCalendar, compter, MAX_DAYS };
