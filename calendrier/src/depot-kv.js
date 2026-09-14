/* Dépôt Cloudflare KV.

   Même interface que les autres dépôts : un chemin, des octets. Le document
   des séances et le son des notes vocales deviennent des clés d'un espace KV,
   qui survit aux redéploiements et n'a besoin d'aucun disque. */

const { segments } = require('./depot-base');

class DepotKV {
  /** @param {{get: Function, put: Function, delete: Function}} kv l'espace KV lié au Worker. */
  constructor(kv, nom = 'KV') {
    if (!kv) throw new Error('Aucun espace KV n’est lié au Worker (binding manquant).');
    this.kv = kv;
    this.nom = nom;
  }

  async lire(chemin) {
    const valeur = await this.kv.get(cle(chemin), { type: 'arrayBuffer' });
    return valeur ? Buffer.from(valeur) : null;
  }

  async ecrire(chemin, bytes, mimeType = 'application/octet-stream') {
    // Le type est rangé en métadonnée : utile pour relire un fichier isolé.
    await this.kv.put(cle(chemin), Buffer.from(bytes), { metadata: { mimeType } });
  }

  async supprimer(chemin) {
    await this.kv.delete(cle(chemin));
  }

  decrire() {
    return { type: 'kv', emplacement: this.nom };
  }
}

function cle(chemin) {
  return segments(chemin).join('/');
}

module.exports = { DepotKV };
