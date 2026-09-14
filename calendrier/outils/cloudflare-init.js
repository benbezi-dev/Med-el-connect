#!/usr/bin/env node
/* Prépare le déploiement Cloudflare : crée l'espace KV et inscrit son
   identifiant dans wrangler.toml, pour n'avoir aucun fichier à éditer.

   À lancer depuis le dossier du calendrier :  npm run cloudflare:init  */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const CONFIG = path.join(__dirname, '..', 'wrangler.toml');
const PLACEHOLDER = 'REMPLACER_PAR_L_ID_RENVOYE_PAR_WRANGLER';
const BINDING = 'CALENDRIER';

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
    console.log('L’espace KV est déjà inscrit dans wrangler.toml — rien à faire.');
    suite();
    return;
  }

  console.log(`Création de l’espace KV « ${BINDING} »…\n`);
  let sortie;
  try {
    sortie = execFileSync('npx', ['--yes', 'wrangler@4', 'kv', 'namespace', 'create', BINDING], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'inherit']
    });
  } catch (erreur) {
    echouer(
      'La création de l’espace KV a échoué.',
      'Si Cloudflare demande une identification, lancez d’abord :',
      '  npx wrangler login'
    );
  }

  console.log(sortie);
  // Wrangler annonce l'identifiant sous forme d'une chaîne de 32 caractères.
  const trouve = sortie.match(/[0-9a-f]{32}/i);
  if (!trouve) {
    echouer(
      'L’identifiant de l’espace KV n’a pas pu être lu dans la réponse ci-dessus.',
      `Copiez-le à la main dans wrangler.toml, à la place de ${PLACEHOLDER}.`
    );
  }

  fs.writeFileSync(CONFIG, config.replace(PLACEHOLDER, trouve[0]));
  console.log(`✓ Espace KV ${trouve[0]} inscrit dans wrangler.toml\n`);
  suite();
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

main();
