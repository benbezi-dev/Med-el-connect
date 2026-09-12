/* Assemblage des services, sans rien connaître du transport ni du disque.

   Node comme Cloudflare Workers passent par ici : on leur donne un dépôt
   (fichiers, mémoire, Google Drive ou R2) et une clé coach, on récupère un
   routeur prêt à répondre. */

const { Store } = require('./store');
const { SessionService } = require('./sessions');
const { VoiceStore } = require('./voix');
const { resoudreCle } = require('./acces');
const { creerRouteur } = require('./routeur');

/**
 * @param {{depot: object, nomFichier?: string, cleCoach?: string|null, dataFile?: string|null}} options
 *   `dataFile` ne sert qu'à retrouver le fichier de clé, côté Node.
 */
async function creerApplication({ depot, nomFichier, cleCoach, dataFile = null }) {
  const store = await new Store(depot, nomFichier).charger();
  const sessions = new SessionService(store);
  const voix = new VoiceStore(depot);
  const acces = resoudreCle({ cleCoach, dataFile });
  const routeur = creerRouteur({ sessions, voix, acces, stockage: depot });

  return { routeur, sessions, voix, store, depot, acces };
}

module.exports = { creerApplication };
