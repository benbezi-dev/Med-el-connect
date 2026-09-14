/* Le socle des dépôts : la validation des chemins et le dépôt en mémoire.

   Ce module ne dépend de rien — ni système de fichiers, ni réseau. C'est ce
   qui permet aux dépôts distants (Google Drive, Cloudflare KV) et au reste de
   l'application de tourner là où node:fs n'existe pas. */

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

module.exports = { DepotMemoire, segments };
