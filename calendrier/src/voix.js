/* Notes dictées du coach.

   Le micro sert à écrire vite, pas à archiver du son : la dictée est
   transcrite dans le navigateur, et seul le texte arrive ici. Rien n'est
   stocké en audio — ni dans le dépôt, ni ailleurs.

   La conséquence pratique compte : la reconnaissance vocale se trompe, donc
   une note se corrige. `duree` ne garde que la longueur de la dictée, à titre
   indicatif ; elle est absente quand le coach a tapé son texte. */

const crypto = require('node:crypto');
const { badRequest } = require('./errors');

const DUREE_MAX = 60 * 30; // 30 minutes de dictée
const MAX_TRANSCRIPTION = 5000;
const SOURCES = ['dictee', 'saisie'];

/**
 * Valide le payload et construit la note à ranger dans la séance.
 * @param {{transcription: string, duree?: number, source?: string}} payload
 */
function preparerNote(payload) {
  const { texte, duree, source } = valider(payload);
  const maintenant = new Date().toISOString();
  return {
    id: `voc_${crypto.randomUUID()}`,
    transcription: texte,
    duree,
    source,
    createdAt: maintenant,
    updatedAt: maintenant
  };
}

/** Corrige une note existante : la dictée se trompe, le texte se reprend. */
function corrigerNote(note, payload) {
  const { texte, duree, source } = valider(payload);
  return {
    ...note,
    transcription: texte,
    // Une correction au clavier remplace la durée dictée : elle ne veut plus rien dire.
    duree: source === 'saisie' ? null : duree,
    source,
    updatedAt: new Date().toISOString()
  };
}

function valider(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw badRequest('Le corps de la requête doit être un objet JSON.');
  }
  return {
    texte: transcription(payload.transcription),
    duree: lireDuree(payload.duree),
    source: lireSource(payload.source)
  };
}

function transcription(valeur) {
  if (typeof valeur !== 'string') {
    throw badRequest('Le champ « transcription » est obligatoire : c’est la note elle-même.');
  }
  const propre = valeur.trim();
  if (!propre) {
    throw badRequest('Le champ « transcription » ne peut pas être vide.');
  }
  if (propre.length > MAX_TRANSCRIPTION) {
    throw badRequest(`Le champ « transcription » dépasse ${MAX_TRANSCRIPTION} caractères.`);
  }
  return propre;
}

function lireDuree(valeur) {
  if (valeur === undefined || valeur === null) return null;
  const secondes = Number(valeur);
  if (!Number.isFinite(secondes) || secondes < 0 || secondes > DUREE_MAX) {
    throw badRequest(`Le champ « duree » doit être un nombre de secondes entre 0 et ${DUREE_MAX}.`);
  }
  return Math.round(secondes * 10) / 10;
}

function lireSource(valeur) {
  if (valeur === undefined || valeur === null || valeur === '') return 'dictee';
  const propre = String(valeur).trim().toLowerCase();
  if (!SOURCES.includes(propre)) {
    throw badRequest('Le champ « source » doit valoir « dictee » ou « saisie ».', { sourcesPossibles: SOURCES });
  }
  return propre;
}

module.exports = { preparerNote, corrigerNote, DUREE_MAX, MAX_TRANSCRIPTION, SOURCES };
