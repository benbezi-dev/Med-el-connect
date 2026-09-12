#!/usr/bin/env node
/* Génère les icônes et l'image de partage, sans dépendance.

   Le motif est une piste : un anneau en « stade » (deux demi-cercles reliés
   par deux droites), repris de l'emblème le plus évident du sujet. Le vert
   fluo est celui de l'interface, les couloirs reprennent les couleurs des
   cinq lieux.

   Usage : node outils/icones.js
   Les fichiers sont écrits dans public/. Ils sont versionnés : cette commande
   ne sert qu'à les régénérer si le motif change. */

const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');

const NUIT = [0x0a, 0x12, 0x20];
const FLUO = [0xc7, 0xfa, 0x3c];
const COULOIRS = [
  [0xff, 0x6b, 0x3d], // Antibes Fort Carré Stade
  [0x38, 0xbd, 0xf8], // Valbonne Stadium
  [0xf4, 0x72, 0xb6], // Grasse Stadium
  [0xa7, 0x8b, 0xfa], // Valbonne Hill
  [0xfb, 0xbf, 0x24]  // Valbonne City Workout
];

/** Encode des pixels RGB en PNG : signature, IHDR, IDAT, IEND. */
function encoderPng(largeur, hauteur, pixels) {
  const brut = Buffer.alloc(hauteur * (1 + largeur * 3));
  for (let y = 0; y < hauteur; y++) {
    const ligne = y * (1 + largeur * 3);
    brut[ligne] = 0; // filtre « aucun »
    pixels.copy(brut, ligne + 1, y * largeur * 3, (y + 1) * largeur * 3);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;  // 8 bits par canal
  ihdr[9] = 2;  // couleur vraie, sans alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    morceau('IHDR', ihdr),
    morceau('IDAT', zlib.deflateSync(brut, { level: 9 })),
    morceau('IEND', Buffer.alloc(0))
  ]);
}

function morceau(type, donnees) {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length, 0);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps) >>> 0, 0);
  return Buffer.concat([longueur, corps, crc]);
}

const TABLE_CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = TABLE_CRC[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

/** Distance d'un point au segment horizontal centré : donne la forme « stade ». */
function distanceStade(x, y, cx, cy, demiLongueur) {
  const dx = Math.max(Math.abs(x - cx) - demiLongueur, 0);
  const dy = y - cy;
  return Math.hypot(dx, dy);
}

/**
 * Dessine la piste. `echelle` rapporte le motif à la taille de l'image, ce
 * qui permet à l'icône masquable de rester dans sa zone sûre.
 *
 * @param {(x: number, y: number) => number[]} chaque renvoie la couleur d'un point
 */
function dessiner(largeur, hauteur, chaque) {
  const pixels = Buffer.alloc(largeur * hauteur * 3);
  const ECHANTILLONS = 3; // 3×3 par pixel : des bords lisses sans bibliothèque

  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      let r = 0, v = 0, b = 0;
      for (let sy = 0; sy < ECHANTILLONS; sy++) {
        for (let sx = 0; sx < ECHANTILLONS; sx++) {
          const couleur = chaque(x + (sx + 0.5) / ECHANTILLONS, y + (sy + 0.5) / ECHANTILLONS);
          r += couleur[0]; v += couleur[1]; b += couleur[2];
        }
      }
      const total = ECHANTILLONS * ECHANTILLONS;
      const i = (y * largeur + x) * 3;
      pixels[i] = Math.round(r / total);
      pixels[i + 1] = Math.round(v / total);
      pixels[i + 2] = Math.round(b / total);
    }
  }
  return pixels;
}

/** L'emblème : trois couloirs concentriques, le plus intérieur en vert fluo. */
function piste({ largeur, hauteur, rayon, demiLongueur, epaisseur, cx, cy }) {
  const anneaux = [
    { rayon: rayon, couleur: COULOIRS[0] },
    { rayon: rayon - epaisseur * 1.9, couleur: COULOIRS[1] },
    { rayon: rayon - epaisseur * 3.8, couleur: FLUO }
  ];

  return (x, y) => {
    const d = distanceStade(x, y, cx, cy, demiLongueur);
    for (const anneau of anneaux) {
      if (d >= anneau.rayon - epaisseur / 2 && d <= anneau.rayon + epaisseur / 2) return anneau.couleur;
    }
    return NUIT;
  };
}

function ecrire(nom, largeur, hauteur, pixels) {
  const cible = path.join(__dirname, '..', 'public', nom);
  fs.writeFileSync(cible, encoderPng(largeur, hauteur, pixels));
  const taille = (fs.statSync(cible).size / 1024).toFixed(1);
  console.log(`${nom} — ${largeur}×${hauteur}, ${taille} ko`);
}

function icone(taille, proportion) {
  const rayon = taille * proportion;
  return dessiner(taille, taille, piste({
    largeur: taille,
    hauteur: taille,
    cx: taille / 2,
    cy: taille / 2,
    rayon,
    demiLongueur: taille * proportion * 0.42,
    epaisseur: Math.max(2, taille * 0.042)
  }));
}

// Icônes carrées. La masquable garde le motif dans les 80 % centraux, pour
// survivre au rognage rond d'Android.
ecrire('icone-192.png', 192, 192, icone(192, 0.36));
ecrire('icone-512.png', 512, 512, icone(512, 0.36));
ecrire('icone-maskable-512.png', 512, 512, icone(512, 0.28));

// Image de partage : ce que WhatsApp affiche à côté du titre du lien.
const OG_L = 1200, OG_H = 630;
ecrire('partage.png', OG_L, OG_H, dessiner(OG_L, OG_H, (() => {
  const fond = piste({
    largeur: OG_L,
    hauteur: OG_H,
    cx: OG_L * 0.30,
    cy: OG_H / 2,
    rayon: OG_H * 0.34,
    demiLongueur: OG_H * 0.17,
    epaisseur: OG_H * 0.045
  });
  // À droite, les cinq couleurs de couloir en barres : la signature du calendrier.
  const debut = OG_L * 0.52;
  const hauteurBarre = OG_H * 0.052;
  const ecart = OG_H * 0.085;
  const premier = OG_H / 2 - (ecart * (COULOIRS.length - 1)) / 2 - hauteurBarre / 2;

  return (x, y) => {
    if (x >= debut) {
      for (let i = 0; i < COULOIRS.length; i++) {
        const haut = premier + i * ecart;
        // Des barres de longueurs inégales : une semaine n'est jamais pleine.
        const longueur = OG_L * (0.20 + 0.06 * ((i * 3) % 5));
        if (y >= haut && y <= haut + hauteurBarre && x <= debut + longueur) return COULOIRS[i];
      }
      return NUIT;
    }
    return fond(x, y);
  };
})()));
