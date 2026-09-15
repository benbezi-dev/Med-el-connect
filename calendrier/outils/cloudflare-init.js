#!/usr/bin/env node
/* Prépare le déploiement Cloudflare : trouve l'espace KV et inscrit son
   identifiant dans wrangler.toml, pour n'avoir aucun fichier à éditer.

   À relancer après chaque mise à jour du dossier : décompresser une nouvelle
   version écrase wrangler.toml, donc l'identifiant. L'outil commence par
   chercher l'espace KV existant et ne crée le sien que s'il n'en trouve pas
   — le relancer ne fabrique jamais de doublon.

   À lancer depuis le dossier du calendrier :  npm run cloudflare:init  */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.join(__dirname, '..', 'wrangler.toml');
const PLACEHOLDER = 'REMPLACER_PAR_L_ID_RENVOYE_PAR_WRANGLER';
const BINDING = 'CALENDRIER';

// Appelé tout seul par « npm run deploy » : on se tait si tout va bien, et on
// n'affiche pas la marche à suivre, puisque le déploiement enchaîne.
const avantDeploiement = process.argv.includes('--avant-deploiement');

function main() {
  if (!fs.existsSync(CONFIG)) {
    echouer(
      'wrangler.toml est introuvable.',
      'Lancez cette commande depuis le dossier « calendrier » :',
      '  cd ~/Downloads/calendrier && npm run cloudflare:init'
    );
  }

  const config = fs.readFileSync(CONFIG, 'utf8');
  if (!config.includes(PLACEHOLDER)) {
    if (!avantDeploiement) {
      console.log('L’espace KV est déjà inscrit dans wrangler.toml — rien à faire.');
      suite();
    }
    return;
  }

  // Wrangler nomme l'espace « <worker>-<binding> » : c'est ainsi qu'on
  // retrouve celui d'un déploiement précédent.
  const nomWorker = (config.match(/^\s*name\s*=\s*"([^"]+)"/m) ?? [])[1] ?? 'calendrier';
  const titre = `${nomWorker}-${BINDING}`;

  const existant = chercherEspace(titre);
  const id = existant ?? creerEspace(titre);

  fs.writeFileSync(CONFIG, config.replace(PLACEHOLDER, id));
  console.log(`✓ Espace KV ${id} inscrit dans wrangler.toml\n`);
  if (existant) console.log('(C’était celui de votre déploiement précédent : vos données sont intactes.)\n');
  if (!avantDeploiement) suite();
}

/** Cherche l'espace KV d'un déploiement précédent.
    @returns {string|undefined} son identifiant, ou rien si le compte n'en a pas. */
function chercherEspace(titre) {
  console.log('Recherche d’un espace KV existant…');
  let sortie;
  try {
    sortie = wrangler(['kv', 'namespace', 'list']);
  } catch (erreur) {
    echouer(
      'Impossible d’interroger Cloudflare.',
      'Si une identification est demandée, lancez d’abord :',
      '  npx wrangler login'
    );
  }

  // La réponse peut être précédée d'avertissements : on ne garde que le JSON.
  const espaces = extraireEspaces(sortie);
  // Illisible : on s'arrête plutôt que d'en créer un second, qui donnerait un
  // calendrier vide à côté des données existantes.
  if (!espaces) {
    echouer(
      'La liste des espaces KV est illisible ; voici ce qu’a répondu Cloudflare :',
      '',
      sortie.trim(),
      '',
      `Repérez la ligne « ${titre} », copiez son identifiant dans wrangler.toml`,
      `à la place de ${PLACEHOLDER}, puis relancez « npm run deploy ».`
    );
  }

  const trouve = espaces.find((espace) => espace && espace.title === titre);
  return trouve ? trouve.id : undefined;
}

/** Isole le tableau JSON dans la sortie de wrangler.

    Des avertissements entourent le JSON et contiennent eux-mêmes des crochets
    (« ▲ [WARNING] », bannière de mise à jour…). On repère donc chaque crochet
    ouvrant, on cherche son crochet fermant, et on garde le premier morceau qui
    est vraiment un tableau.

    @returns {Array|undefined} les espaces listés, ou rien si la sortie n'est pas du JSON. */
function extraireEspaces(sortie) {
  for (let debut = sortie.indexOf('['); debut !== -1; debut = sortie.indexOf('[', debut + 1)) {
    const fin = crochetFermant(sortie, debut);
    if (fin === -1) continue;
    try {
      const espaces = JSON.parse(sortie.slice(debut, fin + 1));
      if (Array.isArray(espaces)) return espaces;
    } catch (erreur) {
      // Ce crochet-là appartenait à un avertissement : on passe au suivant.
    }
  }
  return undefined;
}

/** @returns {number} la position du crochet fermant apparié, ou -1. */
function crochetFermant(texte, debut) {
  let profondeur = 0;
  let dansUnTexte = false;
  for (let i = debut; i < texte.length; i += 1) {
    const caractere = texte[i];
    if (dansUnTexte) {
      if (caractere === '\\') i += 1; // échappement : le caractère suivant ne compte pas
      else if (caractere === '"') dansUnTexte = false;
      continue;
    }
    if (caractere === '"') dansUnTexte = true;
    else if (caractere === '[') profondeur += 1;
    else if (caractere === ']') {
      profondeur -= 1;
      if (profondeur === 0) return i;
    }
  }
  return -1;
}

function creerEspace(titre) {
  console.log(`Aucun espace « ${titre} » : création…\n`);
  let sortie;
  try {
    sortie = wrangler(['kv', 'namespace', 'create', BINDING]);
  } catch (erreur) {
    echouer('La création de l’espace KV a échoué.', 'Lancez « npx wrangler login » puis réessayez.');
  }

  console.log(sortie);
  const trouve = sortie.match(/[0-9a-f]{32}/i);
  if (!trouve) {
    echouer(
      'L’identifiant de l’espace KV n’a pas pu être lu dans la réponse ci-dessus.',
      `Copiez-le à la main dans wrangler.toml, à la place de ${PLACEHOLDER}.`
    );
  }
  return trouve[0];
}

function wrangler(arguments_) {
  return execFileSync('npx', ['--yes', 'wrangler@4', ...arguments_], {
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit']
  });
}

function suite() {
  console.log('Il reste deux commandes :\n');
  console.log('  npx wrangler secret put CALENDAR_COACH_KEY   # votre clé coach');
  console.log('  npm run deploy                               # publie le calendrier\n');
  console.log('Le déploiement affichera l’adresse à donner à votre équipe.');
}

function echouer(...lignes) {
  console.error(`\n${lignes.join('\n')}\n`);
  process.exit(1);
}

// Lancé à la main : on exécute. Importé par un test : on expose seulement.
if (require.main === module) main();

module.exports = { extraireEspaces };
