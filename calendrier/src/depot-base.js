/* Le socle commun des dépôts : le contrôle des chemins et le dépôt mémoire.

   Ce module n'utilise aucun module Node : il est chargé aussi bien par le
   serveur que par le Worker Cloudflare, qui n'a ni disque ni node:fs. */

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

module.exports = { segments, DepotMemoire, SEGMENT };
