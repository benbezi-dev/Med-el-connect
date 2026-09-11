/* Accès coach.

   Les notes vocales n'appartiennent qu'au coach : les athlètes voient la
   grille, les statuts et les séances, mais jamais les notes vocales.

   L'accès tient à une clé partagée, envoyée dans l'en-tête « X-Cle-Coach »
   (ou, à défaut, en paramètre « cle= » pour les appels en ligne de commande).
   La clé vient de CALENDAR_COACH_KEY, sinon d'un fichier à côté des données,
   sinon elle est tirée au sort au premier démarrage. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ENTETE = 'x-cle-coach';
const PARAMETRE = 'cle';
const FICHIER_CLE = 'cle-coach.txt';

/**
 * @param {{cleCoach?: string|null, dataFile?: string|null}} options
 * @returns {{cle: string, origine: 'explicite'|'env'|'fichier'|'generee'|'memoire'}}
 */
function resoudreCle({ cleCoach, dataFile } = {}) {
  if (cleCoach !== undefined && cleCoach !== null) return { cle: String(cleCoach), origine: 'explicite' };
  if (process.env.CALENDAR_COACH_KEY) return { cle: process.env.CALENDAR_COACH_KEY, origine: 'env' };
  if (!dataFile) return { cle: tirerCle(), origine: 'memoire' };

  const fichier = path.join(path.dirname(dataFile), FICHIER_CLE);
  try {
    const existante = fs.readFileSync(fichier, 'utf8').trim();
    if (existante) return { cle: existante, origine: 'fichier' };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const cle = tirerCle();
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, `${cle}\n`, { mode: 0o600 });
  return { cle, origine: 'generee', fichier };
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

module.exports = { resoudreCle, estCoach, masquerNotesVocales, protege, ENTETE, PARAMETRE, FICHIER_CLE };
