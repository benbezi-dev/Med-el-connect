/* Données de référence du calendrier : lieux et créneaux horaires.
   Ce sont les seules valeurs acceptées par l'API — toute autre valeur est rejetée. */

/** Les 5 lieux d'entraînement possibles. */
const LOCATIONS = [
  { id: 'antibes-fort-carre-stade', name: 'Antibes Fort Carré Stade', city: 'Antibes' },
  { id: 'valbonne-stadium', name: 'Valbonne Stadium', city: 'Valbonne' },
  { id: 'grasse-stadium', name: 'Grasse Stadium', city: 'Grasse' },
  { id: 'valbonne-hill', name: 'Valbonne Hill', city: 'Valbonne' },
  { id: 'valbonne-city-workout', name: 'Valbonne City Workout', city: 'Valbonne' }
];

/** Les 2 heures possibles, dans l'ordre d'affichage de la colonne « Heure ». */
const TIMES = ['18:00', '18:30'];

/** Fuseau de référence : les dates « aujourd'hui » sont calculées ici. */
const TIMEZONE = 'Europe/Paris';

/** Nombre de jours présentés par le calendrier. */
const DAYS_IN_VIEW = 7;

const LOCATIONS_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));

/** @returns {{id: string, name: string, city: string}|undefined} */
function findLocation(id) {
  return LOCATIONS_BY_ID.get(String(id ?? '').trim());
}

function isValidTime(time) {
  return TIMES.includes(String(time ?? '').trim());
}

module.exports = { LOCATIONS, TIMES, TIMEZONE, DAYS_IN_VIEW, findLocation, isValidTime };
