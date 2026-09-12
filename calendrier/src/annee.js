/* Vue annuelle : ce que la planification couvre au-delà de la semaine visible.

   La page n'affiche que 7 jours ; cette vue sert au suivi sur 12 mois
   (séances prévues, effectuées, annulées) sans charger toute la grille. */

const {
  isValidDateISO,
  todayISO,
  premierJourDuMois,
  dernierJourDuMois,
  ajouterMois,
  libelleMois
} = require('./dates');
const { TIMEZONE, MOIS_HORIZON, DAYS_IN_VIEW, STATUTS } = require('./reference');
const { compter } = require('./calendar');
const { badRequest } = require('./errors');

const MAX_MOIS = 24;

/**
 * @param {import('./sessions').SessionService} sessionService
 * @param {{start?: string, mois?: number|string}} options
 */
function buildAnnee(sessionService, { start, mois } = {}) {
  const today = todayISO(TIMEZONE);

  if (start !== undefined && !isValidDateISO(start)) {
    throw badRequest('Le paramètre « start » doit être une date au format YYYY-MM-DD.');
  }
  const moisCount = mois === undefined ? MOIS_HORIZON : Number(mois);
  if (!Number.isInteger(moisCount) || moisCount < 1 || moisCount > MAX_MOIS) {
    throw badRequest(`Le paramètre « mois » doit être un entier entre 1 et ${MAX_MOIS}.`);
  }

  const debut = premierJourDuMois(start ?? today);
  const fin = dernierJourDuMois(ajouterMois(debut, moisCount - 1));
  const sessions = sessionService.list({ from: debut, to: fin });

  const parMois = new Map();
  const parJour = new Map();
  for (const session of sessions) {
    const cle = session.date.slice(0, 7);
    if (parMois.has(cle)) parMois.get(cle).push(session);
    else parMois.set(cle, [session]);

    if (parJour.has(session.date)) parJour.get(session.date).push(session);
    else parJour.set(session.date, [session]);
  }

  const moisListe = Array.from({ length: moisCount }, (_, index) => {
    const premier = ajouterMois(debut, index);
    const cle = premier.slice(0, 7);
    const duMois = parMois.get(cle) ?? [];
    return {
      mois: cle,
      label: libelleMois(premier),
      debut: premier,
      fin: dernierJourDuMois(premier),
      estMoisCourant: cle === today.slice(0, 7),
      totaux: compter(duMois),
      // Uniquement les jours occupés : une année entière reste compacte.
      jours: Array.from(new Set(duMois.map((s) => s.date)))
        .sort()
        .map((date) => ({ date, totaux: compter(parJour.get(date)) }))
    };
  });

  return {
    debut,
    fin,
    today,
    timezone: TIMEZONE,
    moisHorizon: moisCount,
    joursVisibles: DAYS_IN_VIEW,
    statuts: STATUTS,
    totaux: compter(sessions),
    mois: moisListe
  };
}

module.exports = { buildAnnee, MAX_MOIS };
