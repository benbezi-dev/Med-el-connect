/* Le calendrier en Worker Cloudflare.

   Rien de l'API n'est réécrit ici : le Worker construit le même noyau que le
   serveur Node, le branche sur un dépôt Cloudflare KV, et lui présente la
   requête à travers l'adaptateur. Les fichiers de la page sont servis par
   Cloudflare lui-même (binding ASSETS). */

import adaptateurModule from './adaptateur.js';
import noyauModule from '../src/noyau.js';
import apiModule from '../src/api.js';
import accesModule from '../src/acces.js';
import depotModule from '../src/depot-kv.js';

const { adapter } = adaptateurModule;
const { creerNoyau } = noyauModule;
const { handleApi, sendError, setCorsHeaders } = apiModule;
const { estCoach } = accesModule;
const { DepotKV } = depotModule;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Tout ce qui n'est pas l'API est un fichier de la page.
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response('Page introuvable.', { status: 404 });
    }

    if (!env.CALENDAR_COACH_KEY) {
      // Sans clé configurée, personne ne pourrait être coach et une clé
      // tirée au sort changerait à chaque requête : mieux vaut le dire.
      return erreurJson(
        500,
        'configuration_incomplete',
        'La clé coach n’est pas configurée. Exécutez : npx wrangler secret put CALENDAR_COACH_KEY'
      );
    }

    try {
      const noyau = await creerNoyau({
        depot: new DepotKV(env.CALENDRIER, 'Cloudflare KV'),
        cleCoach: env.CALENDAR_COACH_KEY
      });

      return await adapter(request, async (req, res) => {
        setCorsHeaders(res);
        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }
        try {
          const coach = estCoach(req, url, noyau.acces.cle);
          await handleApi(req, res, url, noyau, coach, noyau.depot.decrire());
        } catch (erreur) {
          sendError(res, erreur, req);
        }
      });
    } catch (erreur) {
      return erreurJson(500, 'internal_error', erreur.message);
    }
  }
};

function erreurJson(status, code, message) {
  return new Response(JSON.stringify({ error: { code, message } }, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}
