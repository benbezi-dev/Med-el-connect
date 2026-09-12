/* Service worker : l'application s'ouvre au bord de la piste, réseau ou pas.

   Deux stratégies, pour deux natures de contenu.

   La coquille — page, style, script, icônes — est servie depuis le cache et
   rafraîchie en arrière-plan : elle s'affiche instantanément, et la version
   suivante arrive au chargement d'après.

   Les données — la grille, les athlètes — passent par le réseau d'abord, et
   ne retombent sur le cache que s'il est injoignable. On ne montre donc
   jamais une semaine périmée alors qu'une fraîche était disponible ; la page,
   elle, prévient quand ce qu'elle affiche vient du cache.

   Les écritures ne sont pas touchées ici : la page les met elle-même en file
   et les rejoue au retour du réseau, parce qu'elle seule sait ce qu'il est
   prudent de rejouer. */

const VERSION = 'calendrier-v1';
const COQUILLE = `coquille-${VERSION}`;
const DONNEES = `donnees-${VERSION}`;

const FICHIERS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icone-192.png',
  './icone-512.png',
  './icone-maskable-512.png',
  './partage.png'
];

self.addEventListener('install', (evenement) => {
  evenement.waitUntil(
    caches
      .open(COQUILLE)
      // Chaque fichier séparément : un seul manquant ne doit pas faire échouer
      // l'installation entière et laisser l'application sans cache du tout.
      .then((cache) => Promise.all(FICHIERS.map((f) => cache.add(f).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (evenement) => {
  evenement.waitUntil(
    caches
      .keys()
      .then((noms) =>
        Promise.all(noms.filter((nom) => nom !== COQUILLE && nom !== DONNEES).map((nom) => caches.delete(nom)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (evenement) => {
  const requete = evenement.request;
  if (requete.method !== 'GET') return; // les écritures sont l'affaire de la page

  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return; // API hébergée ailleurs : on ne s'en mêle pas

  if (requete.mode === 'navigate') {
    evenement.respondWith(reseauPuisCoquille(requete));
    return;
  }
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    evenement.respondWith(reseauPuisCache(requete, url));
    return;
  }
  evenement.respondWith(cachePuisReseau(requete));
});

/** La page : le réseau si possible, la coquille sinon. */
async function reseauPuisCoquille(requete) {
  try {
    return await fetch(requete);
  } catch (erreur) {
    const cache = await caches.open(COQUILLE);
    return (await cache.match('./index.html')) || (await cache.match('./')) || Response.error();
  }
}

/**
 * Les données : réseau d'abord, cache en secours.
 *
 * La clé de cache porte qui regarde. Sans cela, la grille mise en cache pour
 * le coach — notes comprises — serait resservie à l'athlète hors ligne, alors
 * que l'API la lui refuse. Le cache ne doit pas ouvrir ce que l'API ferme.
 */
async function reseauPuisCache(requete, url) {
  const cle = cleDeCache(requete, url);

  try {
    const reponse = await fetch(requete);
    if (reponse.ok) {
      const cache = await caches.open(DONNEES);
      cache.put(cle, reponse.clone());
    }
    return reponse;
  } catch (erreur) {
    const cache = await caches.open(DONNEES);
    const gardee = await cache.match(cle);
    if (gardee) {
      // La page lit cet en-tête pour dire honnêtement d'où vient ce qu'elle affiche.
      const entetes = new Headers(gardee.headers);
      entetes.set('X-Depuis-Cache', '1');
      return new Response(gardee.body, { status: gardee.status, headers: entetes });
    }
    throw erreur;
  }
}

function cleDeCache(requete, url) {
  const identite = requete.headers.get('X-Cle-Coach')
    ? 'coach'
    : requete.headers.get('X-Athlete') || 'anonyme';
  const cle = new URL(url.href);
  cle.searchParams.set('_pour', identite);
  return cle.href;
}

/** La coquille : le cache d'abord, et on rafraîchit pour la prochaine fois. */
async function cachePuisReseau(requete) {
  const cache = await caches.open(COQUILLE);
  const gardee = await cache.match(requete);

  const reseau = fetch(requete)
    .then((reponse) => {
      if (reponse.ok) cache.put(requete, reponse.clone());
      return reponse;
    })
    .catch(() => gardee || Response.error());

  return gardee || reseau;
}
