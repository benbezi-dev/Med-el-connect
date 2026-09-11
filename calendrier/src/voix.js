/* Notes vocales : stockage du son sur disque, métadonnées dans la séance.

   Le client envoie l'audio en base64 dans du JSON — pas de multipart à
   analyser — et le fichier est écrit à côté des séances, sous
   `data/notes-vocales/<séance>/<note>.<ext>`. */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { badRequest, notFound } = require('./errors');

const TAILLE_MAX = 5 * 1024 * 1024; // 5 Mo de son décodé
const DUREE_MAX = 60 * 30; // 30 minutes
const MAX_TRANSCRIPTION = 5000;

/** Types acceptés, et extension du fichier écrit. */
const TYPES = {
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav'
};

class VoiceStore {
  /** @param {string|null} dossier répertoire de stockage, ou null pour rester en mémoire. */
  constructor(dossier) {
    this.dossier = dossier;
    this.memoire = new Map();
  }

  /**
   * Valide le payload, écrit le son et renvoie les métadonnées à ranger
   * dans la séance.
   */
  enregistrer(sessionId, payload) {
    const { bytes, mimeType, extension } = decoder(payload);
    const note = {
      id: `voc_${crypto.randomUUID()}`,
      fichier: '',
      mimeType,
      taille: bytes.length,
      duree: duree(payload.duree),
      transcription: transcription(payload.transcription),
      createdAt: new Date().toISOString()
    };
    note.fichier = `${note.id}${extension}`;

    if (this.dossier) {
      const cible = this.chemin(sessionId, note);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      const temp = `${cible}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, cible);
    } else {
      this.memoire.set(`${sessionId}/${note.fichier}`, bytes);
    }
    return note;
  }

  /** @returns {Buffer} le son de la note. */
  lire(sessionId, note) {
    if (!this.dossier) {
      const bytes = this.memoire.get(`${sessionId}/${note.fichier}`);
      if (!bytes) throw notFound('Le son de cette note vocale est introuvable.');
      return bytes;
    }
    try {
      return fs.readFileSync(this.chemin(sessionId, note));
    } catch (error) {
      if (error.code === 'ENOENT') throw notFound('Le son de cette note vocale est introuvable.');
      throw error;
    }
  }

  supprimer(sessionId, note) {
    if (!this.dossier) {
      this.memoire.delete(`${sessionId}/${note.fichier}`);
      return;
    }
    fs.rmSync(this.chemin(sessionId, note), { force: true });
  }

  chemin(sessionId, note) {
    // sessionId et note.fichier sont produits par le serveur (uuid préfixé),
    // mais on refuse tout de même ce qui pourrait sortir du dossier.
    for (const segment of [sessionId, note.fichier]) {
      if (!/^[A-Za-z0-9_.-]+$/.test(segment) || segment.includes('..')) {
        throw badRequest('Identifiant de note vocale invalide.');
      }
    }
    return path.join(this.dossier, sessionId, note.fichier);
  }
}

function decoder(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('Le corps de la requête doit être un objet JSON.');
  }
  if (typeof payload.audio !== 'string' || !payload.audio.trim()) {
    throw badRequest('Le champ « audio » (base64) est obligatoire.');
  }

  const brut = String(payload.mimeType ?? 'audio/webm').split(';')[0].trim().toLowerCase();
  const extension = TYPES[brut];
  if (!extension) {
    throw badRequest('Format audio non pris en charge.', { formatsAcceptes: Object.keys(TYPES) });
  }

  // Accepte aussi une data URL « data:audio/webm;base64,… ».
  const base64 = payload.audio.includes(',') ? payload.audio.slice(payload.audio.indexOf(',') + 1) : payload.audio;
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) throw badRequest('Le champ « audio » ne contient pas de son décodable.');
  if (bytes.length > TAILLE_MAX) {
    throw badRequest(`La note vocale dépasse ${Math.round(TAILLE_MAX / 1024 / 1024)} Mo.`);
  }
  return { bytes, mimeType: brut, extension };
}

function duree(valeur) {
  if (valeur === undefined || valeur === null) return null;
  const secondes = Number(valeur);
  if (!Number.isFinite(secondes) || secondes < 0 || secondes > DUREE_MAX) {
    throw badRequest(`Le champ « duree » doit être un nombre de secondes entre 0 et ${DUREE_MAX}.`);
  }
  return Math.round(secondes * 10) / 10;
}

function transcription(valeur) {
  if (valeur === undefined || valeur === null) return '';
  if (typeof valeur !== 'string') throw badRequest('Le champ « transcription » doit être une chaîne.');
  const propre = valeur.trim();
  if (propre.length > MAX_TRANSCRIPTION) {
    throw badRequest(`Le champ « transcription » dépasse ${MAX_TRANSCRIPTION} caractères.`);
  }
  return propre;
}

module.exports = { VoiceStore, TAILLE_MAX, TYPES };
