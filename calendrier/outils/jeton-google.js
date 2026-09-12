#!/usr/bin/env node
/* Obtenir un jeton de rafraîchissement Google, une fois pour toutes.

   À lancer sur votre machine (pas sur le serveur) :

     GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node outils/jeton-google.js

   L'outil ouvre une page de consentement Google, récupère le code sur une
   adresse locale, et affiche le GOOGLE_REFRESH_TOKEN à mettre dans la
   configuration du serveur. Le client OAuth doit être de type « Application
   de bureau » dans la console Google Cloud. */

const http = require('node:http');
const { SCOPE_OAUTH } = require('../src/google-jeton');

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const scope = process.env.GOOGLE_DRIVE_SCOPE || SCOPE_OAUTH;

if (!clientId || !clientSecret) {
  console.error('Renseignez GOOGLE_CLIENT_ID et GOOGLE_CLIENT_SECRET avant de lancer cet outil.');
  process.exit(1);
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/') {
    res.writeHead(404).end();
    return;
  }

  const code = url.searchParams.get('code');
  const erreur = url.searchParams.get('error');
  const repondre = (message) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px system-ui;padding:40px">${message}</body>`);
  };

  if (erreur || !code) {
    repondre(`Autorisation refusée : ${erreur ?? 'aucun code reçu'}. Vous pouvez fermer cet onglet.`);
    console.error(`\nAutorisation refusée : ${erreur ?? 'aucun code reçu'}`);
    serveur.close();
    process.exitCode = 1;
    return;
  }

  try {
    const jetons = await echanger(code, redirection());
    repondre('C’est bon : le jeton s’affiche dans votre terminal. Vous pouvez fermer cet onglet.');
    if (!jetons.refresh_token) {
      console.error(
        '\nGoogle n’a pas renvoyé de jeton de rafraîchissement.' +
          '\nRetirez l’accès de l’application sur https://myaccount.google.com/permissions puis recommencez.'
      );
      process.exitCode = 1;
    } else {
      console.log('\nÀ ajouter à la configuration du serveur :\n');
      console.log(`GOOGLE_CLIENT_ID=${clientId}`);
      console.log(`GOOGLE_CLIENT_SECRET=${clientSecret}`);
      console.log(`GOOGLE_REFRESH_TOKEN=${jetons.refresh_token}`);
    }
  } catch (echec) {
    repondre(`Échec de l’échange : ${echec.message}`);
    console.error(`\nÉchec de l’échange : ${echec.message}`);
    process.exitCode = 1;
  }
  serveur.close();
});

function redirection() {
  return `http://localhost:${serveur.address().port}`;
}

async function echanger(code, redirectUri) {
  const reponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    }).toString()
  });
  const texte = await reponse.text();
  if (!reponse.ok) throw new Error(`${reponse.status} ${texte.slice(0, 300)}`);
  return JSON.parse(texte);
}

serveur.listen(0, '127.0.0.1', () => {
  const consentement = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  consentement.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirection(),
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent'
  }).toString();

  console.log('Ouvrez cette adresse dans votre navigateur, puis autorisez l’accès :\n');
  console.log(consentement.toString());
  console.log('\nEn attente du retour de Google…');
});
