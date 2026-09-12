# API Calendrier — planification sur un an, présentation sur 7 jours

Calendrier de réservation de créneaux d'entraînement : une grille de 7 jours,
une **colonne « Heure »** à gauche, trois créneaux possibles (**10:30**,
**18:00** et **18:30**) et cinq lieux.

La planification court sur **12 mois**, mais la page n'affiche jamais qu'une
**semaine** ; la vue année, repliée en bas de page, sert au suivi. Chaque
séance porte un **statut** (prévue, effectuée, annulée) réglable depuis un
menu déroulant posé sur sa carte, et peut recevoir les **notes du coach —
dictées puis relues, jamais conservées en son** : les athlètes ne les voient
nulle part. Rien n'est jamais effacé : supprimer une séance l'archive.

Le lien se partage : chaque athlète se déclare dans un menu déroulant et
écrit son **compte rendu** sur les séances qui ont eu lieu. Il ne voit que
les siens ; le coach les retrouve tous, groupés par auteur, dans le panneau
de suivi. **Le planning, lui, appartient au coach** : créer, modifier,
archiver ou restaurer une séance demande la clé coach.

Le module est autonome : il ne dépend d'aucun paquet npm et n'a aucun lien avec
le reste de l'application MED-EL Connect à la racine du dépôt.

```
calendrier/
├── src/
│   ├── routeur.js      Les routes — la seule implémentation, partagée
│   ├── server.js       Coquille Node (node:http) + fichiers de public/
│   ├── worker.mjs      Coquille Cloudflare Workers (fetch) + D1 ou R2
│   ├── application.js  Assemblage des services, sans transport ni disque
│   └── …               Calendrier, séances, athlètes, suivi, dépôts
├── public/       Présentation 7 jours (HTML/CSS/JS, sans framework)
├── outils/       jeton-google.js (Drive) et icones.js (icônes, image de partage)
├── test/         109 tests (node:test)
└── data/         Le document des séances, en stockage local
```

Le routage ne vit qu'à un endroit : `routeur.js` reçoit une requête décrite
simplement et rend une réponse décrite simplement. `server.js` et `worker.mjs`
ne font que traduire — ce sont deux coquilles autour du même cœur.

Les données vivent **sur le disque ou sur Google Drive**, au choix : le code
ne connaît qu'un dépôt (`lire` / `ecrire` / `supprimer`), voir « Où vivent les
données ».

La présentation suit un thème sport : fond nuit, vert fluo pour l'interface
(colonne « Heure », jour courant, bouton principal) et une couleur de couloir
par lieu, reprise sur les séances et la légende. Les couloirs sont définis en
un seul endroit, en haut de `public/styles.css` :

| Lieu | Couloir |
|---|---|
| Antibes Fort Carré Stade | orange `#FF6B3D` |
| Valbonne Stadium | bleu ciel `#38BDF8` |
| Grasse Stadium | rose `#F472B6` |
| Valbonne Hill | violet `#A78BFA` |
| Valbonne City Workout | ambre `#FBBF24` |

## Démarrer

```bash
cd calendrier
npm start                 # http://localhost:3000 — page + API sous /api
npm test                  # 109 tests, aucun réseau nécessaire
```

## Mettre en ligne sur Cloudflare Workers

Le Worker ne dort jamais : un athlète qui ouvre le lien depuis WhatsApp
n'attend pas de réveil, même après des jours sans visite.

**Sans ordinateur**, tout se fait au navigateur : fusionnez la branche, puis
dans le tableau de bord Cloudflare, **Workers & Pages → Create → Import a
repository**, en réglant **Root directory** sur `calendrier`. Le détail
pas à pas est dans [`GUIDE.md`](GUIDE.md), section 6.

**Depuis un ordinateur** :

```bash
npx wrangler secret put CALENDAR_COACH_KEY     # notez-la : rien ne la réaffichera
npx wrangler deploy
```

Tout est déclaré dans `wrangler.toml` : la base **D1** pour les données, les
fichiers de `public/` pour la page. Deux points y méritent attention.

`run_worker_first = ["/", "/index.html"]` — sans lui, Cloudflare sert les
fichiers **avant** d'appeler le Worker, la page part avec son gabarit
`{{origine}}` intact, et l'aperçu du lien n'affiche aucune vignette.

`CALENDAR_COACH_KEY` est un **secret**, pas une variable. Sans lui, le Worker
répond `503` en le disant : un Worker ne gardant rien entre deux requêtes, la
clé serait tirée au sort à chaque appel et le mode coach deviendrait
inatteignable — en silence, si l'on n'y prenait garde.

> **Écritures simultanées.** Un serveur Node garde les séances en mémoire ;
> un Worker recharge tout à chaque requête. Deux écritures simultanées
> liraient donc la même version, et la seconde écraserait la première. Les
> dépôts D1 et R2 retiennent la version (numéro de révision, ou ETag) de leur
> lecture et n'écrivent qu'à condition qu'elle n'ait pas bougé : en cas de
> collision, l'API répond `409` et la page — qui recharge après chaque
> enregistrement — représente l'état à jour. Rien n'est perdu silencieusement.
> Pour un groupe de neuf, cela suffit ; au-delà, un Durable Object
> sérialiserait proprement les écritures.

**D1 ou R2 ?** Les deux conviennent, et le code prend les deux sans rien
changer d'autre : c'est le binding présent qui décide. D1 est le choix par
défaut ici parce qu'il ne demande aucune activation préalable. R2 serait plus
naturel pour des fichiers — mais il n'y en a plus : les notes dictées sont du
texte.

Google Drive reste possible sur Workers **par OAuth** (un simple échange de
jeton). Le compte de service, lui, signe un JWT avec `node:crypto` : ce
chemin n'a pas été porté sur WebCrypto.

Variables d'environnement : `PORT` (3000), `HOST` (0.0.0.0),
`CALENDAR_DATA_FILE` (`data/sessions.json`), `CALENDAR_COACH_KEY` (voir
« Accès coach »), `CALENDAR_STORAGE` et les variables Google (voir « Où vivent
les données »).

La page peut aussi être hébergée séparément de l'API : ouvrez-la avec
`?api=https://mon-serveur/api`.

## Référentiels

Les seules valeurs acceptées par l'API — toute autre valeur est refusée en 400.

| Heures possibles | Lieux possibles (`locationId`) | Nom | Statuts (`statut`) |
|---|---|---|---|
| `10:30` | `antibes-fort-carre-stade` | Antibes Fort Carré Stade | `prevue` (défaut) |
| `18:00` | `valbonne-stadium` | Valbonne Stadium | `effectuee` |
| `18:30` | `grasse-stadium` | Grasse Stadium | `annulee` |
| | `valbonne-hill` | Valbonne Hill | |
| | `valbonne-city-workout` | Valbonne City Workout | |

Les dates sont des chaînes `YYYY-MM-DD` sans fuseau ; le jour courant est
calculé sur `Europe/Paris`.

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/api` | Index des endpoints, heures et lieux |
| `GET` | `/api/health` | État du service |
| `GET` | `/api/locations` | Les 5 lieux |
| `GET` | `/api/times` | Les heures possibles |
| `GET` | `/api/statuts` | Prévue, effectuée, annulée |
| `GET` | `/api/athletes` | Les 9 athlètes, avec leurs initiales et leur couleur |
| `GET` | `/api/suivi?from=&to=&jours=` | **Les comptes rendus, groupés par athlète** — coach |
| `GET` | `/api/calendar?start=&days=` | **Grille prête à afficher** (7 jours par défaut, 366 au plus) |
| `GET` | `/api/annee?start=&mois=` | **Suivi sur 12 mois** : totaux par mois et jours occupés |
| `GET` | `/api/export` | Toutes les séances, archives comprises |
| `GET` | `/api/sessions?from=&to=&location=&time=&statut=&archivees=` | Liste filtrable |
| `POST` | `/api/sessions` | Crée une séance |
| `GET` | `/api/sessions/:id` | Détail |
| `PATCH` | `/api/sessions/:id` | Modification partielle (dont le statut) |
| `DELETE` | `/api/sessions/:id` | **Archive** la séance (rien n'est effacé) |
| `POST` | `/api/sessions/:id/restaurer` | Sort une séance des archives |
| `POST` | `/api/sessions/:id/notes-athlete` | Un athlète écrit son compte rendu |
| `PATCH` | `/api/sessions/:id/notes-athlete/:noteId` | Un athlète corrige **sa** note |
| `DELETE` | `/api/sessions/:id/notes-athlete/:noteId` | Un athlète supprime **sa** note ; le coach, n'importe laquelle |
| `GET` | `/api/sessions/:id/notes-vocales` | Notes dictées de la séance — **coach** |
| `POST` | `/api/sessions/:id/notes-vocales` | Ajoute une note dictée — **coach** |
| `PATCH` | `/api/sessions/:id/notes-vocales/:noteId` | Corrige le texte d'une note — **coach** |
| `DELETE` | `/api/sessions/:id/notes-vocales/:noteId` | Supprime une note dictée — **coach** |

CORS est ouvert (`*`) sur toutes les routes `/api`.

## Athlètes

Neuf athlètes, chacun avec sa couleur. La couleur ne porte **jamais seule**
l'information : elle accompagne toujours les initiales, et le nom dès qu'il y
a la place. Neuf teintes ne se distinguent pas de façon fiable — l'écart le
plus faible entre deux voisins de la liste vaut ΔE 23,7 en vision normale
(seuil 15) mais retombe à 5,9 en deutéranopie (cible 8), d'où les initiales
sur chaque pastille. Elles se distinguent aussi **par la forme** des couleurs
de couloir des lieux : un lieu se lit sur le liseré gauche d'une séance, un
athlète sur un rond.

| Athlète | `athleteId` | Couleur |
|---|---|---|
| Eliot | `eliot` | rose `#D16E8F` |
| Autumn | `autumn` | cyan `#02A6AD` |
| Scarlett | `scarlett` | terracotta `#D47452` |
| Zoé | `zoe` | bleu `#359BD9` |
| Yvon | `yvon` | ocre `#BB881A` |
| Alex L | `alex-l` | indigo `#8388E0` |
| Alex P | `alex-p` | olive `#889D37` |
| Ludo | `ludo` | mauve `#B576C3` |
| Mélina | `melina` | vert `#35AA76` |

Elles sont déclarées en un seul endroit, dans `src/athletes.js`. Ajouter ou
retirer un athlète y tient en une ligne.

### Comptes rendus

Un athlète se déclare dans l'en-tête `X-Athlete` (ou le paramètre `athlete=`)
et écrit sur les séances **qui ont eu lieu** — une séance à venir part en
`400`, une séance archivée en `409`. Il ne modifie et ne supprime que ses
propres notes (`403` sinon), et ne voit que les siennes dans la grille,
`/api/sessions` et `/api/export`.

```bash
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-athlete \
  -H 'Content-Type: application/json' \
  -d '{"athleteId":"zoe","texte":"Jambes lourdes, 6×400 en 72."}'
```

> **Se déclarer n'est pas s'authentifier.** Le menu déroulant dit « je suis
> Zoé », rien de plus : n'importe qui peut se déclarer n'importe qui. C'est un
> confort d'affichage — chacun retrouve ses notes — et non une barrière. Seule
> la clé coach protège vraiment quelque chose. Pour une vraie séparation, il
> faudrait un code par athlète.

Le coach retrouve tout dans `/api/suivi`, groupé par auteur, avec les neuf
athlètes présents même sans note : le silence de quelqu'un est justement ce
qu'on cherche à voir.

## Accès coach

Deux choses tiennent à la clé coach :

- **le planning** — créer, modifier, archiver et restaurer une séance
  répondent `401` sans elle. Le lien circule ; le calendrier reste le vôtre ;
- **les notes vocales** — elles n'apparaissent ni dans la grille, ni dans
  `/api/sessions`, ni dans `/api/export` sans la clé, et leurs quatre routes
  répondent `401`. Le suivi des athlètes est réservé de la même façon.

Tout le reste — lire la grille, les statuts, les séances, la vue année, et
écrire son propre compte rendu — reste ouvert à vos athlètes.

La clé vient, dans l'ordre : de `CALENDAR_COACH_KEY`, du fichier
`data/cle-coach.txt`, ou d'un tirage au sort au premier démarrage (le serveur
l'affiche alors une fois et l'écrit dans ce fichier, en `0600`).

```bash
# En ligne de commande
curl -H "X-Cle-Coach: $(cat calendrier/data/cle-coach.txt)" \
  http://localhost:3000/api/sessions
```

Dans la page, le bouton **Mode athlète / Mode coach** (en haut à droite) ouvre
la saisie de la clé. Elle est gardée dans le `localStorage` de ce navigateur —
donc sur votre appareil seulement — et accompagne chaque requête ; le son des
notes est chargé par `fetch` authentifié, jamais par une URL contenant la clé.
« Oublier la clé » revient à la vue athlète.

En mode athlète, la section « Notes vocales » du formulaire n'existe pas et
aucune séance n'indique qu'elle en porte.

En mode athlète, la page n'affiche ni « + Ajouter », ni les menus de statut :
ce sont des gestes qui se feraient refuser. Elle propose à la place, sur
chaque séance passée, « Ma note ».

### `GET /api/calendar`

`start` (défaut : aujourd'hui) et `days` (défaut : 7, max 366). La réponse est
déjà structurée comme le tableau affiché — **une ligne par heure, une cellule
par jour** — le client n'a aucun regroupement à refaire. La page demande 7
jours ; les valeurs supérieures servent aux extractions.

```bash
curl "http://localhost:3000/api/calendar?start=2026-09-11"
```

```jsonc
{
  "start": "2026-09-11", "end": "2026-09-17", "today": "2026-09-11",
  "timezone": "Europe/Paris",
  "previousStart": "2026-09-04", "nextStart": "2026-09-18",
  "times": ["10:30", "18:00", "18:30"],
  "statuts": [ { "id": "prevue", "label": "Prévue" } ],
  "locations": [ { "id": "antibes-fort-carre-stade", "name": "Antibes Fort Carré Stade", "city": "Antibes" } ],
  "days": [
    { "date": "2026-09-11", "weekday": "vendredi", "dayLabel": "11 sept.",
      "shortLabel": "ven. 11 sept.", "dayOfMonth": 11,
      "isWeekend": false, "isToday": true, "isPast": false,
      "totaux": { "total": 1, "prevue": 0, "effectuee": 1, "annulee": 0 } }
  ],
  "rows": [
    {
      "time": "18:00",                       // ← la colonne « Heure »
      "cells": [                             // ← une cellule par jour, dans l'ordre de days
        {
          "date": "2026-09-11", "time": "18:00",
          "sessions": [ /* séances de ce jour à cette heure */ ],
          "totaux": { "total": 1, "prevue": 0, "effectuee": 1, "annulee": 0 },
          "lieuxLibres": ["valbonne-stadium", "grasse-stadium"],
          "complet": false                   // true quand les 5 lieux sont pris
        }
      ]
    }
  ],
  "totaux": { "total": 5, "prevue": 2, "effectuee": 2, "annulee": 1 },
  "total": 5
}
```

Une séance **annulée** ou **archivée** libère son lieu : elle n'apparaît plus
dans `lieuxLibres` comme occupante, mais reste affichée dans la cellule.

### `GET /api/annee`

Le suivi sur 12 mois — ce que la semaine visible ne montre pas. `start`
(défaut : le mois courant) et `mois` (défaut : 12, max 24).

```jsonc
{
  "debut": "2026-09-01", "fin": "2027-08-31", "today": "2026-09-11",
  "moisHorizon": 12,
  "joursVisibles": 7,                        // ce que voient les utilisateurs
  "totaux": { "total": 7, "prevue": 4, "effectuee": 2, "annulee": 1 },
  "mois": [
    {
      "mois": "2026-09", "label": "septembre 2026",
      "debut": "2026-09-01", "fin": "2026-09-30", "estMoisCourant": true,
      "totaux": { "total": 5, "prevue": 2, "effectuee": 2, "annulee": 1 },
      "jours": [                             // seuls les jours occupés
        { "date": "2026-09-11", "totaux": { "total": 1, "prevue": 0, "effectuee": 1, "annulee": 0 } }
      ]
    }
  ]
}
```

### `POST /api/sessions`

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-11","time":"18:00","locationId":"antibes-fort-carre-stade",
       "title":"Fractionné 400m","coach":"Karim","capacity":18}'
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `date` | oui | `YYYY-MM-DD` existante |
| `time` | oui | `10:30`, `18:00` ou `18:30` |
| `locationId` | oui | un des 5 identifiants |
| `statut` | non | `prevue` (défaut), `effectuee` ou `annulee` |
| `title` | non | ≤ 120 caractères (défaut « Entraînement ») |
| `coach` | non | ≤ 80 caractères |
| `capacity` | non | entier 1–200 (défaut 20) |
| `participants` | non | tableau de noms (≤ 200) |
| `notes` | non | ≤ 2000 caractères |

La réponse ajoute des champs dérivés, jamais stockés : `location` (le lieu
complet), `statutLabel` et `placesRestantes` (`capacity` − `participants`).
La séance porte aussi `historique` (chaque changement de statut, daté),
`notesVocales` et `archivee`.

**Un lieu ne peut accueillir qu'une séance par créneau** : un doublon
`date` + `time` + `locationId` répond 409. Les 5 lieux peuvent en revanche
tourner en parallèle sur le même créneau.

### Statuts et archivage

Le statut se change d'un `PATCH` — c'est ce que fait le menu déroulant posé
sur chaque séance :

```bash
curl -X PATCH http://localhost:3000/api/sessions/ses_… \
  -H 'Content-Type: application/json' -d '{"statut":"effectuee"}'
```

Chaque transition est ajoutée à `historique` avec sa date. `DELETE` n'efface
rien : la séance passe `archivee: true`, quitte la grille et reste lisible par
son identifiant, dans `/api/sessions?archivees=true` et dans `/api/export` ;
`POST /api/sessions/:id/restaurer` la remet en place si son créneau est resté
libre (sinon 409).

### Notes dictées du coach

Le micro sert à **écrire vite, pas à archiver du son**. La parole est
transcrite par le navigateur, et seul le texte arrive au serveur : aucun
enregistrement audio n'est conservé, nulle part.

```bash
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-vocales \
  -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"transcription":"Penser à apporter les plots","duree":7.4}'
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `transcription` | oui | 1 à 5000 caractères — c'est la note elle-même |
| `duree` | non | secondes de dictée, 0 à 1800 ; absente quand le texte a été tapé |
| `source` | non | `dictee` (défaut) ou `saisie` |

La reconnaissance vocale se trompe : une note **se corrige**, d'où le `PATCH`.
Une correction au clavier passe `source` à `saisie` et remet `duree` à `null`,
qui n'aurait plus de sens.

```bash
curl -X PATCH http://localhost:3000/api/sessions/ses_…/notes-vocales/voc_… \
  -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"transcription":"Penser aux plots et aux haies","source":"saisie"}'
```

Ces quatre routes exigent la clé coach (voir « Accès coach ») ; sans elle,
`401 cle_coach_requise`.

Dans la page — **en mode coach uniquement** — le bouton **Dicter** lance la
reconnaissance vocale du navigateur (`SpeechRecognition`, disponible sur Chrome
et Safari) et le texte s'écrit dans un champ que le coach relit avant
d'envoyer. Sur un navigateur qui ne sait pas transcrire — Firefox, notamment —
le bouton est désactivé avec l'explication, et la note s'écrit au clavier :
rien n'est perdu, puisque c'est le texte qui compte.

## Où vivent les données

Deux fichiers, quel que soit le dépôt :

| Chemin | Contenu |
|---|---|
| `sessions.json` | toutes les séances, statuts, historiques et archives |
| `notes-vocales/<séance>/<note>.<ext>` | le son de chaque note vocale |

Le serveur charge `sessions.json` **au démarrage** et le réécrit à chaque
modification. L'écriture est faite **avant** de basculer la mémoire : si le
dépôt refuse (Drive injoignable, quota, jeton expiré), la requête échoue, rien
n'a changé, et le créneau reste libre pour un nouvel essai. Si le document est
illisible au démarrage, le serveur **refuse de démarrer** plutôt que de servir
un calendrier vide.

### Sur le disque (par défaut)

Rien à configurer : tout va sous `data/`, via un fichier temporaire renommé
pour ne jamais laisser un fichier tronqué. `CALENDAR_DATA_FILE` déplace le
dossier. Si ce dossier est synchronisé par Google Drive pour ordinateur, les
données remontent dans votre Drive sans autre réglage — à réserver à **un
seul** serveur, sinon deux machines écrivent le même fichier et Drive crée des
copies en conflit.

### Sur Google Drive (API)

Le serveur parle directement à l'API Drive : `sessions.json` et le dossier
`notes-vocales` sont créés dans un dossier Drive, et plus rien n'est écrit en
local (sauf la clé coach). Aucune bibliothèque à installer.

**1. Côté Google Cloud** — créez un projet et activez « Google Drive API ».
Puis, au choix :

*Compte de service* (le plus simple pour un serveur) : créez-le, téléchargez
sa clé JSON, créez un dossier dans votre Drive, partagez-le avec l'adresse du
compte de service (`…@….iam.gserviceaccount.com`) en **Éditeur**, et relevez
l'identifiant du dossier dans son URL.

```bash
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/chemin/cle.json \
GOOGLE_DRIVE_FOLDER_ID=1AbCdEf…  \
npm start
```

*OAuth* (les fichiers appartiennent à votre compte Google) : créez un
identifiant OAuth de type « Application de bureau », puis obtenez le jeton de
rafraîchissement avec l'outil fourni :

```bash
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… node outils/jeton-google.js
```

Il ouvre la page de consentement, récupère le code et affiche les trois
variables à donner au serveur :

```bash
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… npm start
```

**2. Réglages complémentaires**

| Variable | Rôle |
|---|---|
| `GOOGLE_DRIVE_FOLDER_ID` | dossier Drive à utiliser (obligatoire pour un compte de service) |
| `GOOGLE_DRIVE_FOLDER_NAME` | nom du dossier créé si aucun identifiant n'est donné (défaut : « Calendrier entraînements ») |
| `GOOGLE_DRIVE_SCOPE` | portée demandée — `drive.file` en OAuth (l'application ne voit que ses propres fichiers), `drive` pour un compte de service |
| `CALENDAR_STORAGE` | `drive`, `fichier` ou `memoire` pour forcer le dépôt |

Au démarrage, le serveur annonce où il écrit :

```
Calendrier prêt sur http://localhost:3000 (API sous /api)
Données : drive — dossier 1AbCdEf…
```

`GET /api/health` le confirme (le chemin détaillé n'est montré qu'au coach), et
`GET /api/export` renvoie toutes les séances, archives comprises, pour une
sauvegarde ou une reprise ailleurs.

**Ce qui reste local** : la clé coach (`data/cle-coach.txt`) — c'est un secret
de serveur, pas une donnée du calendrier. Ces fichiers sont ignorés par git.
Passer `dataFile: null` à `createApp()` garde tout en mémoire, c'est ce que
font les tests.

### Vérification

Les 87 tests couvrent les trois dépôts. Le dépôt Drive est exercé contre un
faux Google local — création du dossier, mise à jour d'un fichier existant,
sous-dossiers des notes vocales, aller-retour binaire, renouvellement du jeton
sur 401, échappement des apostrophes — et l'application entière est démarrée
deux fois sur ce dépôt pour vérifier qu'elle retrouve tout. La signature du
JWT du compte de service est vérifiée avec la clé publique correspondante.
**Ces tests ne joignent pas les serveurs de Google** : la première connexion
réelle demandera de valider les identifiants.
