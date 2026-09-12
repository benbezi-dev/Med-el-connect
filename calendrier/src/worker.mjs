/* Coquille Cloudflare Workers.

   Pendant de `server.js` : elle traduit une requête `fetch` en requête simple,
   la confie au routeur partagé, et réécrit la réponse. Aucune logique de
   calendrier ici.

   Deux différences avec Node :
   - il n'y a pas de disque, donc les données vivent dans un bucket R2 ou
     dans une base D1, selon ce qui est lié ;
   - il n'y a pas de processus qui dure, donc l'état est rechargé à chaque
     requête (voir depot-r2.js ou depot-d1.js pour ce que cela implique sur
     les écritures simultanées).

   Les fichiers de public/ sont servis par le binding ASSETS, déclaré dans
   wrangler.toml. */

import applicationModule from './application.js';
import depotR2Module from './depot-r2.js';
import depotD1Module from './depot-d1.js';
import erreursModule from './errors.js';

const { creerApplication } = applicationModule;
const { DepotR2 } = depotR2Module;
const { DepotD1 } = depotD1Module;
const { ApiError, badRequest } = erreursModule;

/* Le stockage suit ce qui est lié au Worker. R2 d'abord quand les deux le
   sont : c'est le dépôt fait pour des fichiers. D1 convient tout aussi bien
   ici, puisque seules des données textuelles sont conservées. */
function choisirDepot(env) {
  const prefixe = env.CALENDAR_R2_PREFIX ?? '';
  if (env.CALENDRIER) return new DepotR2(env.CALENDRIER, { prefixe });
  if (env.CALENDRIER_DB) return new DepotD1(env.CALENDRIER_DB, { prefixe });
  return null;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return servirFichier(request, url, env);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: entetesCors() });
    }

    const depot = choisirDepot(env);
    if (!depot) {
      return json(500, {
        error: {
          code: 'stockage_absent',
          message:
            'Aucun stockage n’est lié à ce Worker : il faut le bucket R2 « CALENDRIER » ' +
            'ou la base D1 « CALENDRIER_DB » (voir wrangler.toml).'
        }
      });
    }

    /* Sans secret, resoudreCle() tirerait une clé au sort — et une nouvelle à
       chaque requête, puisqu'un Worker ne garde rien. Le mode coach serait
       alors impossible, sans que rien ne le dise : rien que des 401. Mieux
       vaut refuser en l'expliquant que servir un calendrier que personne ne
       peut administrer. */
    if (!env.CALENDAR_COACH_KEY) {
      return json(503, {
        error: {
          code: 'cle_coach_absente',
          message:
            'Le secret CALENDAR_COACH_KEY n’est pas configuré : personne ne pourrait passer en mode coach.',
          details: {
            ligneDeCommande: 'npx wrangler secret put CALENDAR_COACH_KEY',
            tableauDeBord:
              'Cloudflare → Workers & Pages → ce Worker → Settings → Variables and Secrets → Add (type « Secret »)'
          }
        }
      });
    }

    try {
      const app = await creerApplication({ depot, cleCoach: env.CALENDAR_COACH_KEY });

      const reponse = await app.routeur({
        methode: request.method,
        url,
        entetes: entetesSimples(request.headers),
        lireJson: (limite) => lireJson(request, limite)
      });

      return new Response(reponse.corps, {
        status: reponse.statut,
        headers: { ...entetesCors(), ...reponse.entetes }
      });
    } catch (erreur) {
      console.error('[calendrier] erreur inattendue :', erreur && erreur.stack ? erreur.stack : erreur);
      return json(500, { error: { code: 'internal_error', message: 'Erreur interne du serveur.' } });
    }
  }
};

/* ---------- Fichiers de public/ ---------- */

async function servirFichier(request, url, env) {
  if (!env.ASSETS) {
    return new Response('Les fichiers de la page ne sont pas liés à ce Worker.', { status: 500 });
  }

  const reponse = await env.ASSETS.fetch(request);
  const type = reponse.headers.get('content-type') ?? '';
  if (!type.includes('text/html')) return reponse;

  // Même raison que côté Node : WhatsApp ignore une image de partage en
  // adresse relative, et on ne connaît le domaine qu'à la requête.
  const html = await reponse.text();
  if (!html.includes('{{origine}}')) return new Response(html, reponse);

  // Une variable déclarée mais vide vaut « non renseignée » : sans ce test,
  // l'adresse retomberait relative et WhatsApp n'afficherait plus de vignette.
  const origine = (env.CALENDAR_PUBLIC_URL || `${url.protocol}//${url.host}`).replace(/\/$/, '');
  return new Response(html.replaceAll('{{origine}}', origine), {
    status: reponse.status,
    headers: reponse.headers
  });
}

/* ---------- Traductions ---------- */

/** Les en-têtes en objet minuscule, comme node:http les présente. */
function entetesSimples(headers) {
  const resultat = {};
  for (const [nom, valeur] of headers) resultat[nom.toLowerCase()] = valeur;
  return resultat;
}

/**
 * Lit le corps JSON, en refusant au-delà de la limite. On mesure en lisant :
 * Content-Length peut mentir, ou manquer.
 */
async function lireJson(request, limite) {
  const declaree = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaree) && declaree > limite) throw tropVolumineux();

  const texte = await lireTexteBorne(request, limite);
  const brut = texte.trim();
  if (!brut) return {};
  try {
    return JSON.parse(brut);
  } catch {
    throw badRequest('Le corps de la requête n’est pas du JSON valide.');
  }
}

async function lireTexteBorne(request, limite) {
  if (!request.body) return '';
  const lecteur = request.body.getReader();
  const morceaux = [];
  let taille = 0;

  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.byteLength;
    if (taille > limite) {
      await lecteur.cancel();
      throw tropVolumineux();
    }
    morceaux.push(value);
  }
  return new TextDecoder().decode(concatener(morceaux, taille));
}

function concatener(morceaux, taille) {
  const tout = new Uint8Array(taille);
  let position = 0;
  for (const morceau of morceaux) {
    tout.set(morceau, position);
    position += morceau.byteLength;
  }
  return tout;
}

/* Une vraie ApiError, sans quoi le routeur la prendrait pour un bug et
   répondrait 500 au lieu de 413. */
function tropVolumineux() {
  return new ApiError(413, 'payload_too_large', 'Corps de requête trop volumineux.');
}

function entetesCors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Cle-Coach, X-Athlete',
    'Access-Control-Max-Age': '86400'
  };
}

function json(statut, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: statut,
    headers: { ...entetesCors(), 'Content-Type': 'application/json; charset=utf-8' }
  });
}
