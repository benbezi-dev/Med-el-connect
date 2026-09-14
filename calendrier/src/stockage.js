/* Le choix du dépôt, côté serveur Node.

   Drive si l'identification Google est présente, le disque sinon, la mémoire
   quand aucune racine n'est donnée. Les dépôts eux-mêmes vivent dans leurs
   propres modules, chargés seulement si on les utilise. */

const { DepotMemoire, segments } = require('./depot-base');

/**
 * Choisit le dépôt : Drive si la configuration Google est présente (ou si
 * CALENDAR_STORAGE=drive), le disque sinon, la mémoire quand `racine` est nulle.
 *
 * @param {{racine?: string|null, env?: object, depot?: object}} options
 */
function creerDepot({ racine, env = process.env, depot } = {}) {
  if (depot) return depot;                       // dépôt fourni (tests)
  if (racine === null || racine === undefined) return new DepotMemoire();

  const { DepotFichier } = require('./depot-fichier');

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

module.exports = { creerDepot, DepotMemoire, segments };
