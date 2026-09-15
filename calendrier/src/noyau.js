/* Le noyau partagé par les deux runtimes : les données chargées, le service
   des séances, le stockage des notes vocales et la clé coach. Un serveur Node
   et un Worker Cloudflare construisent le même objet, chacun avec son dépôt. */

const { Store } = require('./store');
const { AthleteService } = require('./athletes');
const { SessionService } = require('./sessions');
const { VoiceStore } = require('./voix');
const { resoudreCle } = require('./acces');

/**
 * @param {{depot: object, cleCoach?: string, dataFile?: string|null, nomDocument?: string}} options
 * @returns {Promise<{store, sessions, voix, acces, depot}>}
 */
async function creerNoyau({ depot, cleCoach, dataFile = null, nomDocument }) {
  const store = await new Store(depot, nomDocument).charger();
  const athletes = await new AthleteService(depot).charger();
  return {
    depot,
    store,
    athletes,
    sessions: new SessionService(store, athletes),
    voix: new VoiceStore(depot),
    acces: resoudreCle({ cleCoach, dataFile })
  };
}

module.exports = { creerNoyau };
