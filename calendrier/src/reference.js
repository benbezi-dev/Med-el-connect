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

/** L'équipe. Un athlète s'identifie en choisissant son nom, pas en le tapant. */
const ATHLETES = [
  { id: 'yvon', nom: 'Yvon' },
  { id: 'kaila', nom: 'Kaila' },
  { id: 'autumn', nom: 'Autumn' },
  { id: 'scarlett', nom: 'Scarlett' },
  { id: 'elliot', nom: 'Elliot' },
  { id: 'alex-l', nom: 'Alex L' },
  { id: 'ludo', nom: 'Ludo' },
  { id: 'zoe', nom: 'Zoe' },
  { id: 'melina', nom: 'Melina' }
];

/** Fuseau de référence : les dates « aujourd'hui » sont calculées ici. */
const TIMEZONE = 'Europe/Paris';

/** La planification couvre un an ; les utilisateurs n'en voient qu'une semaine. */
const DAYS_IN_VIEW = 7;
const MOIS_HORIZON = 12;

const LOCATIONS_BY_ID = new Map(LOCATIONS.map((l) => [l.id, l]));
const STATUTS_BY_ID = new Map(STATUTS.map((s) => [s.id, s]));
const ATHLETES_BY_ID = new Map(ATHLETES.map((a) => [a.id, a]));

/** @returns {{id: string, name: string, city: string}|undefined} */
function findLocation(id) {
  return LOCATIONS_BY_ID.get(String(id ?? '').trim());
}

/** @returns {{id: string, label: string}|undefined} */
function findStatut(id) {
  return STATUTS_BY_ID.get(String(id ?? '').trim());
}

/** @returns {{id: string, nom: string}|undefined} */
function findAthlete(id) {
  return ATHLETES_BY_ID.get(String(id ?? '').trim());
}

function isValidTime(time) {
  return TIMES.includes(String(time ?? '').trim());
}

module.exports = {
  LOCATIONS,
  TIMES,
  STATUTS,
  ATHLETES,
  STATUT_PAR_DEFAUT,
  TIMEZONE,
  DAYS_IN_VIEW,
  MOIS_HORIZON,
  findLocation,
  findStatut,
  findAthlete,
  isValidTime
};
