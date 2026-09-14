/* Persistance des séances : un seul document JSON dans le dépôt choisi
   (mémoire, fichier local ou Google Drive).

   Le volume attendu (quelques créneaux x 5 lieux x quelques semaines) tient largement
   en mémoire : on garde tout chargé et on réécrit le document à chaque
   mutation. L'écriture est faite AVANT de basculer la mémoire — si le dépôt
   refuse, l'appelant reçoit l'erreur et rien n'a changé nulle part. */

const { DepotMemoire } = require('./depot-base');

const NOM = 'sessions.json';

class Store {
  /** @param {object|null} depot dépôt de stockage ; null garde tout en mémoire. */
  constructor(depot, nom = NOM) {
    this.depot = depot ?? new DepotMemoire();
    this.nom = nom;
    this.sessions = [];
  }

  /** Charge le contenu du dépôt. À appeler une fois, au démarrage. */
  async charger() {
    const brut = await this.depot.lire(this.nom);
    this.sessions = analyser(brut, this.emplacement());
    return this;
  }

  all() {
    return this.sessions;
  }

  find(id) {
    return this.sessions.find((session) => session.id === id);
  }

  /** Persiste la nouvelle liste, puis l'adopte. */
  async remplacer(sessions) {
    const document = `${JSON.stringify({ sessions }, null, 2)}\n`;
    await this.depot.ecrire(this.nom, Buffer.from(document), 'application/json');
    this.sessions = sessions;
  }

  emplacement() {
    const { type, emplacement } = this.depot.decrire();
    return emplacement ? `${type} (${emplacement})` : type;
  }
}

function analyser(brut, emplacement) {
  if (!brut) return [];
  const texte = brut.toString('utf8').trim();
  if (!texte) return [];

  let contenu;
  try {
    contenu = JSON.parse(texte);
  } catch (erreur) {
    // Mieux vaut refuser de démarrer que repartir d'un calendrier vide :
    // le document existe, il est simplement illisible.
    throw new Error(`Le document des séances est illisible (${emplacement}) : ${erreur.message}`);
  }
  return Array.isArray(contenu?.sessions) ? contenu.sessions : [];
}

module.exports = { Store, NOM };
