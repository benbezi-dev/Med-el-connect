/* Dépôt R2 — le stockage natif d'un Worker Cloudflare.

   Même interface que les autres dépôts (lire / ecrire / supprimer / decrire),
   posée sur un bucket R2.

   Le point délicat n'est pas R2, c'est le modèle d'exécution. Un serveur Node
   garde les séances en mémoire d'un bout à l'autre de sa vie ; un Worker,
   lui, recharge tout à chaque requête et réécrit le document entier. Deux
   écritures simultanées liraient donc la même version et la seconde écraserait
   la première — un compte rendu perdu sans que personne ne s'en aperçoive.

   D'où l'ETag : on retient celui de la lecture et on n'écrit qu'à condition
   que l'objet n'ait pas bougé depuis. Si quelqu'un est passé entre-temps,
   l'écriture est refusée en 409 plutôt que d'effacer son travail, et la page
   — qui recharge après chaque enregistrement — représente l'état à jour. */

const { segments } = require('./depot-base');
const { conflict } = require('./errors');

class DepotR2 {
  /**
   * @param {object} bucket le binding R2 du Worker
   * @param {{prefixe?: string}} options préfixe commun, si le bucket est partagé
   */
  constructor(bucket, { prefixe = '' } = {}) {
    this.bucket = bucket;
    this.prefixe = prefixe.replace(/^\/+|\/+$/g, '');
    this.etags = new Map(); // chemin -> ETag de la dernière lecture
  }

  cle(chemin) {
    const parts = segments(chemin);
    return this.prefixe ? `${this.prefixe}/${parts.join('/')}` : parts.join('/');
  }

  async lire(chemin) {
    const objet = await this.bucket.get(this.cle(chemin));
    if (!objet) {
      // Absent : on le note, pour n'écrire que si personne ne l'a créé entre-temps.
      this.etags.set(this.cle(chemin), null);
      return null;
    }
    this.etags.set(this.cle(chemin), objet.etag);
    return Buffer.from(await objet.arrayBuffer());
  }

  async ecrire(chemin, bytes, type) {
    const cle = this.cle(chemin);
    const options = type ? { httpMetadata: { contentType: type } } : {};

    // La condition ne s'applique qu'aux chemins qu'on a lus dans cette requête ;
    // les sons de notes vocales, eux, portent un identifiant unique et neuf.
    if (this.etags.has(cle)) {
      const attendu = this.etags.get(cle);
      options.onlyIf = attendu === null ? { etagDoesNotMatch: '*' } : { etagMatches: attendu };
    }

    const ecrit = await this.bucket.put(cle, bytes, options);
    if (!ecrit) {
      throw conflict(
        'Quelqu’un a modifié le calendrier pendant votre saisie : rien n’a été écrit. Rechargez et réessayez.',
        { chemin }
      );
    }
    this.etags.set(cle, ecrit.etag);
  }

  async supprimer(chemin) {
    const cle = this.cle(chemin);
    await this.bucket.delete(cle);
    this.etags.delete(cle);
  }

  decrire() {
    return { type: 'r2', emplacement: this.prefixe || null };
  }
}

module.exports = { DepotR2 };
