/* Utilitaires de dates.

   Toutes les dates de l'API sont des chaînes « YYYY-MM-DD » sans heure ni
   fuseau. Les calculs se font sur minuit UTC de ce jour-là : ça évite qu'un
   changement d'heure (DST) décale un jour lors d'un addDays(). Seul
   todayISO() consulte un vrai fuseau, pour savoir quel jour on est. */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86400000;

/** Valide le format ET l'existence de la date (2025-02-30 est refusé). */
function isValidDateISO(value) {
  const match = DATE_RE.exec(String(value ?? ''));
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && toISO(date) === `${year}-${month}-${day}`;
}

/** @returns {string} la date « YYYY-MM-DD » de l'instant UTC donné. */
function toISO(date) {
  return date.toISOString().slice(0, 10);
}

/** @returns {Date} minuit UTC du jour « YYYY-MM-DD ». */
function toDate(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

/** Le jour courant dans le fuseau donné, au format « YYYY-MM-DD ». */
function todayISO(timeZone, now = new Date()) {
  // en-CA formate en YYYY-MM-DD, ce qui évite un réassemblage manuel.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now);
}

function addDays(iso, count) {
  return toISO(new Date(toDate(iso).getTime() + count * MS_PER_DAY));
}

/** Nombre de jours entiers de `from` à `to` (négatif si `to` est avant). */
function daysBetween(from, to) {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / MS_PER_DAY);
}

/** Génère les `count` jours consécutifs à partir de `startISO` inclus. */
function dateRange(startISO, count) {
  return Array.from({ length: count }, (_, index) => addDays(startISO, index));
}

const WEEKDAY_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long' });
const SHORT_FMT = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'UTC',
  weekday: 'short',
  day: 'numeric',
  month: 'short'
});
// Sans jour de la semaine : l'en-tête de colonne l'affiche déjà au-dessus.
const DAY_FMT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'short' });

/** Libellés français d'un jour, prêts pour l'en-tête de colonne. */
function describeDay(iso, todayIso) {
  const date = toDate(iso);
  return {
    date: iso,
    weekday: WEEKDAY_FMT.format(date),
    dayLabel: DAY_FMT.format(date),
    shortLabel: SHORT_FMT.format(date),
    dayOfMonth: date.getUTCDate(),
    isWeekend: [0, 6].includes(date.getUTCDay()),
    isToday: iso === todayIso,
    isPast: daysBetween(todayIso, iso) < 0
  };
}

module.exports = {
  isValidDateISO,
  toISO,
  toDate,
  todayISO,
  addDays,
  daysBetween,
  dateRange,
  describeDay
};
