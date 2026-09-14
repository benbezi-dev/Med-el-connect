/* Accès coach.

   Les notes vocales n'appartiennent qu'au coach : les athlètes voient la
   grille, les statuts et les séances, mais jamais les notes vocales.

   L'accès tient à une clé partagée, envoyée dans l'en-tête « X-Cle-Coach »
   (ou, à défaut, en paramètre « cle= » pour les appels en ligne de commande).
   Elle est donnée à la construction, ou vient de CALENDAR_COACH_KEY ;
   la variante rangée dans un fichier local vit dans cle-fichier.js. */

const crypto = require('node:crypto');

const ENTETE = 'x-cle-coach';
const PARAMETRE = 'cle';
const FICHIER_CLE = 'cle-coach.txt';

/**
 * @param {{cleCoach?: string|null, dataFile?: string|null}} options
 * @returns {{cle: string, origine: 'explicite'|'env'|'fichier'|'generee'|'memoire'}}
 */
/**
 * Lit l'identification connue sans toucher au disque.
 * @param {{cleCoach?: string, tirerSiAbsente?: boolean}} options
 * @returns {{cle: string, origine: string}|null} null si rien n'est configuré
 *   et qu'on ne veut pas de tirage (le serveur ira voir son fichier).
 */
function resoudreCle({ cleCoach, tirerSiAbsente = true } = {}) {
  if (cleCoach !== undefined && cleCoach !== null && cleCoach !== '') {
    return { cle: String(cleCoach), origine: 'explicite' };
  }
  if (process.env.CALENDAR_COACH_KEY) return { cle: process.env.CALENDAR_COACH_KEY, origine: 'env' };
  return tirerSiAbsente ? { cle: tirerCle(), origine: 'memoire' } : null;
}

function tirerCle() {
  return crypto.randomBytes(24).toString('base64url');
}

/** @returns {boolean} vrai si la requête présente la bonne clé coach. */
function estCoach(req, url, cle) {
  if (!cle) return false;
  const entete = req.headers[ENTETE];
  const fournie = entete !== undefined ? entete : url.searchParams.get(PARAMETRE);
  return comparer(String(fournie ?? ''), cle);
}

/** Comparaison à temps constant : deux clés de longueurs différentes sont refusées. */
function comparer(fournie, attendue) {
  const a = Buffer.from(fournie);
  const b = Buffer.from(attendue);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Retire les notes vocales d'un payload destiné à un athlète. La copie est
 * profonde : rien de ce qui est renvoyé ne partage d'objet avec le stockage.
 */
function masquerNotesVocales(valeur) {
  if (Array.isArray(valeur)) return valeur.map(masquerNotesVocales);
  if (valeur && typeof valeur === 'object') {
    const copie = {};
    for (const cle of Object.keys(valeur)) {
      copie[cle] = cle === 'notesVocales' && Array.isArray(valeur[cle]) ? [] : masquerNotesVocales(valeur[cle]);
    }
    return copie;
  }
  return valeur;
}

/** Laisse passer le payload pour le coach, le masque pour les athlètes. */
function protege(payload, coach) {
  return coach ? payload : masquerNotesVocales(payload);
}

module.exports = { resoudreCle, tirerCle, estCoach, masquerNotesVocales, protege, ENTETE, PARAMETRE, FICHIER_CLE };
