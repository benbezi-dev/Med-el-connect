/* Accès coach.

   Les notes vocales n'appartiennent qu'au coach : les athlètes voient la
   grille, les statuts et les séances, mais jamais les notes vocales.

   L'accès tient à une clé partagée, envoyée dans l'en-tête « X-Cle-Coach »
   (ou, à défaut, en paramètre « cle= » pour les appels en ligne de commande).
   La clé vient de CALENDAR_COACH_KEY, sinon d'un fichier à côté des données,
   sinon elle est tirée au sort au premier démarrage. */

const crypto = require('node:crypto');

const ENTETE = 'x-cle-coach';
const PARAMETRE = 'cle';
const FICHIER_CLE = 'cle-coach.txt';

/* L'athlète se déclare, il ne s'authentifie pas : cet en-tête dit « je suis
   Zoé », rien de plus. C'est un confort d'affichage — chacun retrouve ses
   notes — et non une barrière : n'importe qui peut se déclarer n'importe qui.
   Seule la clé coach protège vraiment quelque chose. */
const ENTETE_ATHLETE = 'x-athlete';
const PARAMETRE_ATHLETE = 'athlete';

/**
 * @param {{cleCoach?: string|null, dataFile?: string|null}} options
 * @returns {{cle: string, origine: 'explicite'|'env'|'fichier'|'generee'|'memoire'}}
 */
function resoudreCle({ cleCoach, dataFile } = {}) {
  if (cleCoach !== undefined && cleCoach !== null) return { cle: String(cleCoach), origine: 'explicite' };
  if (process.env.CALENDAR_COACH_KEY) return { cle: process.env.CALENDAR_COACH_KEY, origine: 'env' };
  if (!dataFile) return { cle: tirerCle(), origine: 'memoire' };

  // Chargés ici seulement : hors de Node — sur Cloudflare Workers, par
  // exemple — il n'y a pas de disque, et la clé vient de l'environnement.
  const fs = require('node:fs');
  const path = require('node:path');

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

/** @returns {string|null} l'athlète tel qu'il se déclare, sans vérification. */
function athleteDeclare(req, url) {
  const entete = req.headers[ENTETE_ATHLETE];
  const valeur = entete !== undefined ? entete : url.searchParams.get(PARAMETRE_ATHLETE);
  const id = String(valeur ?? '').trim();
  return id || null;
}

/** Comparaison à temps constant : deux clés de longueurs différentes sont refusées. */
function comparer(fournie, attendue) {
  const a = Buffer.from(fournie);
  const b = Buffer.from(attendue);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Retire d'un payload ce qui ne regarde pas son destinataire :
 *   - les notes vocales, réservées au coach, disparaissent toujours ;
 *   - les notes d'athlètes sont réduites à celles de `athleteId` (aucune si
 *     personne ne s'est identifié).
 * La copie est profonde : rien de ce qui est renvoyé ne partage d'objet avec
 * le stockage.
 *
 * @param {string|null} athleteId l'athlète qui regarde, tel qu'il se déclare.
 */
function masquerNotesVocales(valeur, athleteId = null) {
  if (Array.isArray(valeur)) return valeur.map((v) => masquerNotesVocales(v, athleteId));
  if (valeur && typeof valeur === 'object') {
    const copie = {};
    for (const cle of Object.keys(valeur)) {
      if (cle === 'notesVocales' && Array.isArray(valeur[cle])) {
        copie[cle] = [];
      } else if (cle === 'notesAthletes' && Array.isArray(valeur[cle])) {
        copie[cle] = valeur[cle]
          .filter((note) => athleteId !== null && note && note.athleteId === athleteId)
          .map((note) => masquerNotesVocales(note, athleteId));
      } else {
        copie[cle] = masquerNotesVocales(valeur[cle], athleteId);
      }
    }
    return copie;
  }
  return valeur;
}

/**
 * Laisse passer le payload pour le coach, le masque pour les athlètes.
 * @param {string|null} athleteId l'athlète qui regarde ; ses notes lui restent visibles.
 */
function protege(payload, coach, athleteId = null) {
  return coach ? payload : masquerNotesVocales(payload, athleteId);
}

module.exports = {
  resoudreCle,
  estCoach,
  athleteDeclare,
  masquerNotesVocales,
  protege,
  ENTETE,
  PARAMETRE,
  ENTETE_ATHLETE,
  PARAMETRE_ATHLETE,
  FICHIER_CLE
};
