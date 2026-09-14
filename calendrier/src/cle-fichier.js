/* La clé coach rangée à côté des données, sur un disque local.

   Ce module est le seul du lot à toucher au système de fichiers pour la clé :
   un Worker reçoit la sienne par variable d'environnement et n'a rien à lire.
   Le garder à part évite d'entraîner node:fs dans le paquet déployé. */

const fs = require('node:fs');
const path = require('node:path');
const { resoudreCle, tirerCle, FICHIER_CLE } = require('./acces');

/**
 * Ordre de recherche : clé explicite, CALENDAR_COACH_KEY, fichier local,
 * puis tirage au sort mémorisé dans ce fichier.
 */
function resoudreCleLocale({ cleCoach, dataFile } = {}) {
  const connue = resoudreCle({ cleCoach, dataFile: null, tirerSiAbsente: false });
  if (connue) return connue;
  if (!dataFile) return { cle: tirerCle(), origine: 'memoire' };

  const fichier = path.join(path.dirname(dataFile), FICHIER_CLE);
  try {
    const existante = fs.readFileSync(fichier, 'utf8').trim();
    if (existante) return { cle: existante, origine: 'fichier' };
  } catch (erreur) {
    if (erreur.code !== 'ENOENT') throw erreur;
  }

  const cle = tirerCle();
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, `${cle}\n`, { mode: 0o600 });
  return { cle, origine: 'generee', fichier };
}

module.exports = { resoudreCleLocale };
