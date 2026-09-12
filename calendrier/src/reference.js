/* Données de référence du calendrier : lieux, créneaux horaires et statuts.
   Ce sont les seules valeurs acceptées par l'API — toute autre valeur est rejetée. */

/** Les 5 lieux d'entraînement possibles. */
const LOCATIONS = [
  { id: 'antibes-fort-carre-stade', name: 'Antibes Fort Carré Stade', city: 'Antibes' },
  { id: 'valbonne-stadium', name: 'Valbonne Stadium', city: 'Valbonne' },
  { id: 'grasse-stadium', name: 'Grasse Stadium', city: 'Grasse' },
  { id: 'valbonne-hill', name: 'Valbonne Hill', city: 'Valbonne' },
  { id: 'valbonne-city-workout', name: 'Valbonne City Workout', city: 'Valbonne' }
];

/** Les heures possibles, dans l'ordre d'affichage de la colonne « Heure ». */
const TIMES = ['10:30', '18:00', '18:30'];

/** États d'une séance, alimentés par le menu déroulant de chaque séance. */
const STATUTS = [
  { id: 'prevue', label: 'Prévue' },
  { id: 'effectuee', label: 'Effectuée' },
  { id: 'annulee', label: 'Annulée' }
];
const STATUT_PAR_DEFAUT = 'prevue';

/** Fuseau de référence : les dates « aujourd'hui » sont calculées ici. */
const TIMEZONE = 'Europe/Paris';

/** La planification couvre un an ; les utilisateurs n'en voient qu'une semaine. */
const DAYS_IN_VIEW = 7;
const MOIS_HORIZON = 12;

const LOCATIONS_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));
const STATUTS_BY_ID = new Map(STATUTS.map((s) => [s.id, s]));

/** @returns {{id: string, name: string, city: string}|undefined} */
function findLocation(id) {
  return LOCATIONS_BY_ID.get(String(id ?? '').trim());
}

/** @returns {{id: string, label: string}|undefined} */
function findStatut(id) {
  return STATUTS_BY_ID.get(String(id ?? '').trim());
}

function isValidTime(time) {
  return TIMES.includes(String(time ?? '').trim());
}

/**
 * « 10:30, 18:00 ou 18:30 » — une énumération lisible, quel que soit le
 * nombre de valeurs. `join(' ou ')` donnerait « a ou b ou c ».
 */
function enumerer(valeurs) {
  if (valeurs.length <= 1) return valeurs.join('');
  return `${valeurs.slice(0, -1).join(', ')} ou ${valeurs[valeurs.length - 1]}`;
}

module.exports = {
  LOCATIONS,
  TIMES,
  STATUTS,
  STATUT_PAR_DEFAUT,
  TIMEZONE,
  DAYS_IN_VIEW,
  MOIS_HORIZON,
  findLocation,
  findStatut,
  isValidTime,
  enumerer
};
