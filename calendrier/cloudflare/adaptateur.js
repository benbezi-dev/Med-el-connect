/* Traduction entre le monde des Workers et celui de node:http.

   L'API du calendrier est écrite pour le couple (req, res) de Node. Plutôt
   que d'en tenir une seconde version pour Cloudflare, on présente à ce même
   code une requête et une réponse déguisées : la Request du Worker entre
   d'un côté, une Response en ressort de l'autre. */

/** Requête façon node:http, alimentée par le corps déjà lu. */
class RequeteAdaptee {
  constructor(request, corps) {
    const url = new URL(request.url);
    this.method = request.method;
    this.url = url.pathname + url.search;
    this.headers = {};
    request.headers.forEach((valeur, nom) => { this.headers[nom.toLowerCase()] = valeur; });

    this.corps = corps;
    this.ecouteurs = {};
    this.enPause = false;
    this.livre = false;
  }

  on(evenement, rappel) {
    this.ecouteurs[evenement] = rappel;
    // Le lecteur attache « data », « error » puis « end » : à ce moment-là,
    // tout est en place pour recevoir le corps.
    if (evenement === 'end' && !this.livre) {
      this.livre = true;
      queueMicrotask(() => this.livrer());
    }
    return this;
  }

  livrer() {
    if (this.corps && this.corps.length && this.ecouteurs.data) this.ecouteurs.data(this.corps);
    if (this.enPause) return;                     // corps refusé : on s'arrête là
    if (this.ecouteurs.end) this.ecouteurs.end();
  }

  pause() { this.enPause = true; }
  destroy() { this.enPause = true; }
}

/** Réponse façon node:http, qui se termine en Response du Worker. */
class ReponseAdaptee {
  constructor() {
    this.statusCode = 200;
    this.entetes = new Headers();
    this.termine = null;
    this.fin = new Promise((resoudre) => { this.termine = resoudre; });
    this.rappelFinish = null;
  }

  setHeader(nom, valeur) {
    this.entetes.set(nom, String(valeur));
    return this;
  }

  writeHead(statut, entetes) {
    this.statusCode = statut;
    for (const [nom, valeur] of Object.entries(entetes ?? {})) this.entetes.set(nom, String(valeur));
    return this;
  }

  on(evenement, rappel) {
    if (evenement === 'finish') this.rappelFinish = rappel;
    return this;
  }

  end(corps) {
    // Content-Length est calculé par le runtime : le garder fausserait les
    // réponses dont le corps est réencodé.
    this.entetes.delete('Content-Length');
    this.termine(new Response(corps ?? null, { status: this.statusCode, headers: this.entetes }));
    if (this.rappelFinish) this.rappelFinish();
    return this;
  }
}

/**
 * Fait traiter une Request par un gestionnaire écrit pour node:http.
 * @param {Request} request
 * @param {(req, res) => Promise<void>} gestionnaire
 * @returns {Promise<Response>}
 */
async function adapter(request, gestionnaire) {
  const corps = ['GET', 'HEAD'].includes(request.method)
    ? null
    : Buffer.from(await request.arrayBuffer());

  const req = new RequeteAdaptee(request, corps);
  const res = new ReponseAdaptee();
  gestionnaire(req, res);
  return res.fin;
}

module.exports = { adapter, RequeteAdaptee, ReponseAdaptee };
