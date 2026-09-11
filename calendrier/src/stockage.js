/* Stockage : où vivent les données.

   Trois dépôts derrière la même interface — mémoire (tests), fichiers locaux
   et Google Drive. Chacun sait lire, écrire et supprimer un chemin relatif
   (« sessions.json », « notes-vocales/ses_x/voc_y.webm ») :

     lire(chemin)                 -> Buffer, ou null si absent
     ecrire(chemin, bytes, type)  -> écrit (ou remplace)
     supprimer(chemin)            -> efface si présent
     decrire()                    -> { type, emplacement } pour /api/health

   Tout est asynchrone : sur Drive, une écriture est un appel réseau, et
   l'appelant doit pouvoir échouer proprement plutôt que perdre une saisie. */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { badRequest } = require('./errors');

const SEGMENT = /^[A-Za-z0-9_.@+-]+$/;

/** Découpe et contrôle un chemin : rien ne doit pouvoir sortir du dépôt. */
function segments(chemin) {
  const parts = String(chemin ?? '').split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => !SEGMENT.test(p) || p === '.' || p === '..')) {
    throw badRequest(`Chemin de stockage invalide : « ${chemin} ».`);
  }
  return parts;
}

/** Dépôt en mémoire : ne survit pas au processus, sert aux tests. */
class DepotMemoire {
  constructor() {
    this.fichiers = new Map();
  }

  async lire(chemin) {
    return this.fichiers.get(segments(chemin).join('/')) ?? null;
  }

  async ecrire(chemin, bytes) {
    this.fichiers.set(segments(chemin).join('/'), Buffer.from(bytes));
  }

  async supprimer(chemin) {
    this.fichiers.delete(segments(chemin).join('/'));
  }

  decrire() {
    return { type: 'memoire', emplacement: null };
  }
}

/** Dépôt local : un fichier par chemin, écrit puis renommé. */
class DepotFichier {
  constructor(racine) {
    this.racine = path.resolve(racine);
  }

  chemin(relatif) {
    return path.join(this.racine, ...segments(relatif));
  }

  async lire(relatif) {
    try {
      return await fsp.readFile(this.chemin(relatif));
    } catch (erreur) {
      if (erreur.code === 'ENOENT') return null;
      throw erreur;
    }
  }

  async ecrire(relatif, bytes) {
    const cible = this.chemin(relatif);
    await fsp.mkdir(path.dirname(cible), { recursive: true });
    // Écriture puis renommage : une coupure ne laisse jamais un fichier
    // à moitié écrit à la place de l'ancien.
    const temporaire = `${cible}.${process.pid}.tmp`;
    await fsp.writeFile(temporaire, bytes);
    await fsp.rename(temporaire, cible);
  }

  async supprimer(relatif) {
    await fsp.rm(this.chemin(relatif), { force: true });
  }

  decrire() {
    return { type: 'fichier', emplacement: this.racine };
  }
}

/**
 * Choisit le dépôt : Drive si la configuration Google est présente (ou si
 * CALENDAR_STORAGE=drive), le disque sinon, la mémoire quand `racine` est nulle.
 *
 * @param {{racine?: string|null, env?: object, depot?: object}} options
 */
function creerDepot({ racine, env = process.env, depot } = {}) {
  if (depot) return depot;                       // dépôt fourni (tests)
  if (racine === null || racine === undefined) return new DepotMemoire();

  const demande = String(env.CALENDAR_STORAGE ?? '').toLowerCase();
  if (demande === 'memoire') return new DepotMemoire();
  if (demande === 'fichier') return new DepotFichier(racine);

  // Chargé à la demande : le module Drive n'est pas nécessaire en local.
  const { lireConfiguration } = require('./google-jeton');
  const configuration = lireConfiguration(env);
  if (demande === 'drive' && !configuration) {
    throw new Error(
      'CALENDAR_STORAGE=drive, mais aucune identification Google trouvée ' +
        '(GOOGLE_SERVICE_ACCOUNT_KEY_FILE, ou GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN).'
    );
  }
  if (!configuration) return new DepotFichier(racine);

  const { DepotDrive } = require('./drive');
  return new DepotDrive({
    configuration,
    dossier: env.GOOGLE_DRIVE_FOLDER_NAME || 'Calendrier entraînements',
    dossierId: env.GOOGLE_DRIVE_FOLDER_ID || null
  });
}

module.exports = { DepotMemoire, DepotFichier, creerDepot, segments };
