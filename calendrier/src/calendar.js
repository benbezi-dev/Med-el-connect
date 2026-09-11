/* Construction de la vue calendrier sur 7 jours.

   La réponse est déjà structurée comme le tableau affiché : une ligne par
   heure (colonne « Heure » à gauche), une cellule par jour. Le client n'a
   donc aucun regroupement à refaire. */

const { isValidDateISO, todayISO, addDays, dateRange, describeDay } = require('./dates');
const { LOCATIONS, TIMES, TIMEZONE, DAYS_IN_VIEW } = require('./reference');
const { badRequest } = require('./errors');

const MAX_DAYS = 31;

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
  for (const session of sessions) {
    const key = `${session.date}|${session.time}`;
    const bucket = byCell.get(key);
    if (bucket) bucket.push(session);
    else byCell.set(key, [session]);
  }

  const rows = TIMES.map((time) => ({
    time,
    cells: dates.map((date) => {
      const cellSessions = byCell.get(`${date}|${time}`) ?? [];
      const taken = new Set(cellSessions.map((s) => s.locationId));
      return {
        date,
        time,
        sessions: cellSessions,
        lieuxLibres: LOCATIONS.filter((l) => !taken.has(l.id)).map((l) => l.id),
        complet: taken.size === LOCATIONS.length
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
    locations: LOCATIONS,
    days: dates.map((date) => describeDay(date, today)),
    rows,
    total: sessions.length
  };
}

module.exports = { buildCalendar, MAX_DAYS };
