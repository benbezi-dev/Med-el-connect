/* Photos des séances : l'image va dans le dépôt, les métadonnées dans la séance.

   Même principe que les notes vocales — base64 dans du JSON, fichier rangé
   sous `photos/<séance>/<photo>.<ext>` quel que soit le dépôt — avec une
   différence qui change tout : une photo peut être montrée à l'équipe.

   Elle ne l'est jamais d'elle-même. `visible` vaut faux à l'arrivée ; seul le
   coach le bascule. Tant qu'il ne l'a pas fait, la photo n'apparaît ni dans
   les listes des athlètes ni à son adresse propre. */

const crypto = require('node:crypto');
const { DepotMemoire } = require('./depot-base');
const { badRequest, notFound } = require('./errors');

const TAILLE_MAX = 4 * 1024 * 1024; // 4 Mo d'image décodée
const MAX_LEGENDE = 200;

/** Types acceptés, et extension du fichier écrit. */
const TYPES = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif'
};

class PhotoStore {
  /**
   * @param {object|null} depot dépôt de stockage ; null garde tout en mémoire.
   * @param {string} prefixe dossier des photos, dans le dépôt.
   */
  constructor(depot, prefixe = 'photos') {
    this.depot = depot ?? new DepotMemoire();
    this.prefixe = prefixe;
  }

  /**
   * Valide le payload, écrit l'image et renvoie les métadonnées à ranger
   * dans la séance.
   */
  async enregistrer(sessionId, payload) {
    const { bytes, mimeType, extension } = decoder(payload);
    const photo = {
      id: `pho_${crypto.randomUUID()}`,
      fichier: '',
      mimeType,
      taille: bytes.length,
      legende: legende(payload.legende),
      // Le coach décide. Une photo arrivée n'est pas une photo publiée.
      visible: false,
      createdAt: new Date().toISOString()
    };
    photo.fichier = `${photo.id}${extension}`;

    await this.depot.ecrire(this.chemin(sessionId, photo), bytes, mimeType);
    return photo;
  }

  /** @returns {Promise<Buffer>} l'image. */
  async lire(sessionId, photo) {
    const bytes = await this.depot.lire(this.chemin(sessionId, photo));
    if (!bytes) throw notFound('Cette photo est introuvable.');
    return bytes;
  }

  async supprimer(sessionId, photo) {
    await this.depot.supprimer(this.chemin(sessionId, photo));
  }

  /** Le dépôt refuse déjà les segments douteux ; ceci ne fait que les composer. */
  chemin(sessionId, photo) {
    return `${this.prefixe}/${sessionId}/${photo.fichier}`;
  }
}

function decoder(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('Le corps de la requête doit être un objet JSON.');
  }
  if (typeof payload.image !== 'string' || !payload.image.trim()) {
    throw badRequest('Le champ « image » (base64) est obligatoire.');
  }

  const brut = String(payload.mimeType ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
  const extension = TYPES[brut];
  if (!extension) {
    throw badRequest('Format d’image non pris en charge.', { formatsAcceptes: Object.keys(TYPES) });
  }

  // Accepte aussi une data URL « data:image/jpeg;base64,… ».
  const base64 = payload.image.includes(',') ? payload.image.slice(payload.image.indexOf(',') + 1) : payload.image;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw badRequest('Le champ « image » ne contient pas d’image décodable.');
  if (bytes.length > TAILLE_MAX) {
    throw badRequest(`La photo dépasse ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo.`, {
      conseil: 'La page réduit les photos avant l’envoi ; en appel direct, réduisez-la vous-même.'
    });
  }
  return { bytes, mimeType: brut, extension };
}

function legende(valeur) {
  if (valeur === undefined || valeur === null) return '';
  if (typeof valeur !== 'string') throw badRequest('Le champ « legende » doit être une chaîne.');
  const propre = valeur.trim();
  if (propre.length > MAX_LEGENDE) {
    throw badRequest(`Le champ « legende » dépasse ${MAX_LEGENDE} caractères.`);
  }
  return propre;
}

module.exports = { PhotoStore, TAILLE_MAX, MAX_LEGENDE, TYPES, legende };
