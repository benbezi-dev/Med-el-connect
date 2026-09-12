/* Suivi des athlètes — la vue du coach.

   Les notes que les athlètes écrivent sur leurs séances, regroupées par
   auteur. Les neuf athlètes sont toujours présents, même sans note : le
   silence de quelqu'un est justement ce que le coach cherche à voir. */

const { isValidDateISO, todayISO, addDays } = require('./dates');
const { TIMEZONE } = require('./reference');
const { ATHLETES } = require('./athletes');
const { badRequest } = require('./errors');

const JOURS_PAR_DEFAUT = 30;
const JOURS_MAX = 366;

/**
 * @param {{list: Function}} sessions le service des séances
 * @param {{from?: string, to?: string, jours?: string|number}} options
 */
function buildSuivi(sessions, { from, to, jours } = {}) {
  const today = todayISO(TIMEZONE);

  const fin = to === undefined ? today : to;
  if (!isValidDateISO(fin)) {
    throw badRequest('Le paramètre « to » doit être une date au format YYYY-MM-DD.');
  }

  let debut;
  if (from !== undefined) {
    if (!isValidDateISO(from)) {
      throw badRequest('Le paramètre « from » doit être une date au format YYYY-MM-DD.');
    }
    debut = from;
  } else {
    debut = addDays(fin, -(lireJours(jours) - 1));
  }

  if (debut > fin) throw badRequest('Le début de la période doit précéder sa fin.');

  // Les archives comptent : une séance archivée garde les notes écrites sur elle.
  const seances = sessions.list({ from: debut, to: fin, archivees: true });

  const parAthlete = new Map(ATHLETES.map((a) => [a.id, []]));
  let total = 0;

  for (const seance of seances) {
    for (const note of seance.notesAthletes ?? []) {
      const panier = parAthlete.get(note.athleteId);
      if (!panier) continue; // athlète retiré du référentiel : la note reste dans le dépôt
      panier.push({
        ...note,
        seance: {
          id: seance.id,
          date: seance.date,
          time: seance.time,
          title: seance.title,
          statut: seance.statut,
          statutLabel: seance.statutLabel,
          location: seance.location,
          archivee: seance.archivee
        }
      });
      total += 1;
    }
  }

  const athletes = ATHLETES.map((athlete) => {
    // La plus récente d'abord : c'est ce que le coach lit en premier.
    const notes = parAthlete.get(athlete.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const seancesCommentees = new Set(notes.map((n) => n.seance.id));
    return {
      ...athlete,
      notes,
      totalNotes: notes.length,
      seancesCommentees: seancesCommentees.size,
      derniereNote: notes.length ? notes[0].createdAt : null
    };
  });

  return {
    debut,
    fin,
    today,
    timezone: TIMEZONE,
    total,
    sansNote: athletes.filter((a) => a.totalNotes === 0).map((a) => a.id),
    athletes
  };
}

function lireJours(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return JOURS_PAR_DEFAUT;
  const jours = Number(valeur);
  if (!Number.isInteger(jours) || jours < 1 || jours > JOURS_MAX) {
    throw badRequest(`Le paramètre « jours » doit être un entier entre 1 et ${JOURS_MAX}.`);
  }
  return jours;
}

module.exports = { buildSuivi, JOURS_PAR_DEFAUT, JOURS_MAX };
