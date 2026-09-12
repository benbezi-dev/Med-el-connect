/* Jeton d'accès Google, sans dépendance.

   Deux façons de s'identifier, au choix :

   - compte de service : on signe un JWT (RS256) avec sa clé privée et on
     l'échange contre un jeton d'accès. Le dossier Drive doit être partagé
     avec l'adresse du compte de service ;
   - OAuth : on échange un jeton de rafraîchissement obtenu une fois pour
     toutes. Les fichiers vivent alors dans le Drive du coach.

   Le jeton obtenu est gardé jusqu'à une minute avant son expiration. */

const crypto = require('node:crypto');
const fs = require('node:fs');

const URL_JETON = 'https://oauth2.googleapis.com/token';
// Compte de service : il ne voit que ce qu'on lui partage, d'où le scope large.
const SCOPE_SERVICE = 'https://www.googleapis.com/auth/drive';
// OAuth sur un compte personnel : l'application ne touche qu'à ses fichiers.
const SCOPE_OAUTH = 'https://www.googleapis.com/auth/drive.file';

/**
 * Lit l'identification Google dans l'environnement.
 * @returns {{type: 'service'|'oauth'}|null} null si rien n'est configuré.
 */
function lireConfiguration(env = process.env) {
  if (env.GOOGLE_SERVICE_ACCOUNT_KEY || env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE) {
    const brut = env.GOOGLE_SERVICE_ACCOUNT_KEY || fs.readFileSync(env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE, 'utf8');
    let cle;
    try {
      cle = JSON.parse(brut);
    } catch (erreur) {
      throw new Error('La clé du compte de service Google n’est pas un JSON valide.');
    }
    if (!cle.client_email || !cle.private_key) {
      throw new Error('La clé du compte de service Google doit contenir « client_email » et « private_key ».');
    }
    return {
      type: 'service',
      email: cle.client_email,
      clePrivee: cle.private_key,
      scope: env.GOOGLE_DRIVE_SCOPE || SCOPE_SERVICE
    };
  }

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN) {
    return {
      type: 'oauth',
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      jetonRafraichissement: env.GOOGLE_REFRESH_TOKEN,
      scope: env.GOOGLE_DRIVE_SCOPE || SCOPE_OAUTH
    };
  }

  return null;
}

class FournisseurJeton {
  constructor(configuration, { urlJeton = URL_JETON, requete = fetch, horloge = Date.now } = {}) {
    this.configuration = configuration;
    this.urlJeton = urlJeton;
    this.requete = requete;
    this.horloge = horloge;
    this.cache = null;     // { jeton, expire }
    this.enCours = null;   // évite deux demandes simultanées
  }

  async jeton() {
    if (this.cache && this.cache.expire > this.horloge()) return this.cache.jeton;
    if (!this.enCours) {
      this.enCours = this.demander().finally(() => { this.enCours = null; });
    }
    return this.enCours;
  }

  async demander() {
    const corps = this.configuration.type === 'service' ? this.corpsService() : this.corpsOAuth();
    const reponse = await this.requete(this.urlJeton, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps.toString()
    });

    const texte = await reponse.text();
    if (!reponse.ok) {
      throw new Error(`Google refuse l’identification (${reponse.status}) : ${texte.slice(0, 300)}`);
    }

    let donnees;
    try {
      donnees = JSON.parse(texte);
    } catch (erreur) {
      throw new Error('Réponse inattendue du service de jetons Google.');
    }
    if (!donnees.access_token) throw new Error('Google n’a pas renvoyé de jeton d’accès.');

    const duree = Number(donnees.expires_in) || 3600;
    this.cache = { jeton: donnees.access_token, expire: this.horloge() + (duree - 60) * 1000 };
    return this.cache.jeton;
  }

  corpsOAuth() {
    return new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.configuration.clientId,
      client_secret: this.configuration.clientSecret,
      refresh_token: this.configuration.jetonRafraichissement
    });
  }

  corpsService() {
    return new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: this.signerJwt()
    });
  }

  signerJwt() {
    const maintenant = Math.floor(this.horloge() / 1000);
    const entete = { alg: 'RS256', typ: 'JWT' };
    const revendications = {
      iss: this.configuration.email,
      scope: this.configuration.scope,
      aud: this.urlJeton,
      iat: maintenant,
      exp: maintenant + 3600
    };

    const aSigner = `${base64url(JSON.stringify(entete))}.${base64url(JSON.stringify(revendications))}`;
    const signature = crypto.createSign('RSA-SHA256').update(aSigner).end()
      .sign(this.configuration.clePrivee)
      .toString('base64url');
    return `${aSigner}.${signature}`;
  }
}

function base64url(texte) {
  return Buffer.from(texte).toString('base64url');
}

module.exports = { lireConfiguration, FournisseurJeton, URL_JETON, SCOPE_SERVICE, SCOPE_OAUTH };
