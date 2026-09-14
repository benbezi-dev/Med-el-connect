/* Dépôt local : un fichier par chemin, écrit puis renommé.

   Séparé du reste parce qu'il est le seul à dépendre de node:fs — les
   runtimes sans système de fichiers (un Worker, par exemple) importent
   `stockage.js` sans jamais charger ce module. */

const fsp = require('node:fs/promises');
const path = require('node:path');
const { segments } = require('./depot-base');

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

module.exports = { DepotFichier };
