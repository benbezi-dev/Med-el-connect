# Prise en main

Installer le calendrier, le démarrer, et savoir s'en servir. Toutes les commandes
de ce guide ont été exécutées telles quelles sur une installation neuve.

La **référence** complète de l'API (toutes les routes, tous les champs, toutes les
réponses) vit dans [`README.md`](README.md), à côté du code. Ce guide-ci est le
chemin d'entrée.

---

## 1. Installer

Le module n'installe rien : aucun paquet npm, aucune base de données. Il lui faut
Node 18 ou plus, et c'est tout.

```bash
node --version            # 1. vérifier Node (≥ 18)

tar xzf calendrier-api.tar.gz
cd calendrier             # 2. extraire l'archive

npm test                  # 3. vérifier : 103 tests, aucun réseau nécessaire
npm start                 # 4. démarrer
```

`npm test` doit afficher :

```
# tests 103
# pass 103
# fail 0
```

Au premier démarrage :

```
Calendrier prêt sur http://localhost:3000 (API sous /api)
Données : fichier — /…/calendrier/data
Clé coach générée : 3H_ZBKZh-GiH-qCI5Q3KvSPWg3shZl0P
  → notez-la : elle seule ouvre les notes vocales (copie dans /…/data/cle-coach.txt).
```

> **La clé coach n'apparaît qu'une fois.** Elle est tirée au sort au premier
> démarrage, puis écrite dans `data/cle-coach.txt` en `0600`. Aux démarrages
> suivants, le serveur se contente de rappeler où la relire. Pour la choisir
> vous-même : `CALENDAR_COACH_KEY=ma-cle npm start`.

Ouvrez <http://localhost:3000> : la semaine en cours s'affiche. `Ctrl+C` arrête le
serveur.

## 2. La page

La grille tient sur sept jours, colonne **Heure** figée à gauche, jour courant en
vert. Tout se fait au clic dans une cellule : **+ Ajouter** crée une séance, un
clic sur une séance existante la modifie.

Chaque séance porte un menu **Prévue · Effectuée · Annulée**. Une séance effectuée
passe en vert ; une séance annulée est grisée, son titre barré, et **elle libère
son lieu** — le créneau redevient réservable. L'en-tête de chaque jour affiche le
compte « effectuées / total ».

En bas de page, un panneau replié ouvre la **vue année** : douze mois, les totaux
par statut, les jours occupés. « Voir la semaine » saute à la semaine concernée.

### Je suis…

Le menu **« Je suis »**, en haut à droite, liste les neuf athlètes : Eliot, Autumn,
Scarlett, Zoé, Yvon, Alex L, Alex P, Ludo, Mélina. Chacun s'y choisit une fois ; le
choix reste dans son téléphone.

Une fois déclaré, un athlète voit apparaître **« + Ma note »** sur chaque séance qui
a eu lieu — pas sur celles à venir. Il y écrit son compte rendu, le corrige, le
supprime. **Il ne voit que les siens.** Chaque athlète a une couleur, reprise sur
la pastille portant ses initiales ; le nom est toujours écrit à côté, parce que neuf
couleurs ne se distinguent pas de façon fiable.

Vous, en mode coach, retrouvez tout dans le panneau **« Suivi des athlètes »** en bas
de page : un bloc par athlète, à sa couleur, ses comptes rendus du plus récent au plus
ancien. Les neuf y figurent, même sans note — ceux qui n'ont rien écrit apparaissent
en grisé, ce qui est souvent l'information la plus utile.

### Mode athlète et mode coach

Le bouton en haut à droite bascule entre les deux. En **mode athlète** — l'état par
défaut, celui que voient vos athlètes — la section « Notes vocales » n'existe pas
et rien n'indique qu'une séance en porte. La page n'affiche pas non plus « + Ajouter »
ni les menus de statut : **le planning n'appartient qu'à vous**, et proposer ces
boutons ne ferait que provoquer un refus.

En **mode coach**, vous saisissez la clé une fois : elle reste dans le
`localStorage` de ce navigateur, sur votre appareil seulement, et accompagne chaque
requête. « Oublier la clé » revient à la vue athlète.

> **Le micro exige une connexion sécurisée.** L'enregistrement marche sur
> `localhost`, mais en ligne il faudra du HTTPS — sinon le bouton se désactive en
> l'expliquant. La transcription automatique existe sur Chrome et Safari ; sur
> Firefox, seul le son est enregistré.

La page peut aussi être hébergée ailleurs que l'API : ouvrez-la avec
`?api=https://mon-serveur/api`.

## 3. Les règles

Elles sont tenues par l'API, pas par la page : toute autre valeur part en `400`
avec un message en français.

- **Deux créneaux, et deux seulement** : `18:00` et `18:30`.
- **Cinq lieux** : `antibes-fort-carre-stade`, `valbonne-stadium`,
  `grasse-stadium`, `valbonne-hill`, `valbonne-city-workout`.
- **Un lieu, un créneau, une séance** : un doublon part en `409`. Les cinq lieux
  tournent en revanche en parallèle sur le même créneau.
- **Le planning appartient au coach** : créer, modifier, archiver et restaurer une
  séance répondent `401` sans la clé coach. Les athlètes lisent tout, et écrivent
  leurs propres comptes rendus.
- **Un compte rendu se pose sur une séance qui a eu lieu** : une séance à venir part
  en `400`, une séance archivée en `409`. Un athlète ne touche qu'à ses notes
  (`403` sinon).
- **Rien n'est jamais effacé** : `DELETE` *archive* la séance. Elle quitte la
  grille, reste lisible par son identifiant, apparaît dans
  `/api/sessions?archivees=true` et dans `/api/export` ;
  `POST /api/sessions/:id/restaurer` la remet en place si son créneau est resté
  libre. Chaque changement de statut est daté dans un `historique` gardé avec la
  séance.

## 4. L’API en sept gestes

Serveur démarré sur le port 3000.

**1 · Créer une séance**

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-14","time":"18:00","locationId":"valbonne-stadium",
       "title":"Fractionné 400m","coach":"Karim","capacity":18}'
```

Notez l'`id` renvoyé : il sert à tout le reste. `statutLabel`, `location` et
`placesRestantes` sont calculés à la volée, jamais stockés.

**2 · Se heurter aux règles**

```bash
CLE="X-Cle-Coach: $(cat data/cle-coach.txt)"

# même lieu, même créneau → 409
curl -X POST http://localhost:3000/api/sessions -H "$CLE" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-14","time":"18:00","locationId":"valbonne-stadium"}'

# une heure qui n'existe pas → 400
curl -X POST http://localhost:3000/api/sessions -H "$CLE" \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-14","time":"19:00","locationId":"valbonne-stadium"}'

# et sans la clé du tout → 401, quelle que soit la saisie
curl -X POST http://localhost:3000/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-09-14","time":"18:00","locationId":"grasse-stadium"}'
```

```jsonc
{ "error": { "code": "invalid_request",
             "message": "Le champ « time » doit valoir 18:00 ou 18:30.",
             "details": { "heuresPossibles": ["18:00", "18:30"] } } }
```

**3 · Changer le statut** — ce que fait le menu déroulant de la page.

```bash
curl -X PATCH http://localhost:3000/api/sessions/ses_… \
  -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  -H 'Content-Type: application/json' -d '{"statut":"effectuee"}'
```

**4 · Lire la grille**

```bash
curl "http://localhost:3000/api/calendar?start=2026-09-14&days=7"
```

La réponse est déjà structurée comme le tableau affiché — **une ligne par heure,
une cellule par jour** — aucun regroupement à refaire. `days` vaut 7 par défaut,
366 au plus pour les extractions.

**5 · Un compte rendu d'athlète**

```bash
# sur une séance qui a eu lieu
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-athlete \
  -H 'Content-Type: application/json' \
  -d '{"athleteId":"zoe","texte":"Jambes lourdes, 6×400 en 72."}'

# ce que le coach en fait : tout, groupé par athlète
curl -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  "http://localhost:3000/api/suivi?jours=30"
```

**6 · Une note vocale — coach uniquement**

```bash
# sans la clé → 401
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-vocales \
  -H 'Content-Type: application/json' \
  -d '{"audio":"AAECAwQ=","transcription":"Apporter les plots"}'

# avec la clé → 201
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-vocales \
  -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  -H 'Content-Type: application/json' \
  -d '{"audio":"AAECAwQ=","mimeType":"audio/webm","duree":3.2,
       "transcription":"Apporter les plots"}'
```

**7 · Vérifier que rien ne fuit** — la même requête, avec et sans la clé :

```bash
curl -s "http://localhost:3000/api/calendar" | grep -c "Apporter les plots"
# → 0   (vue athlète)

curl -s -H "X-Cle-Coach: $(cat data/cle-coach.txt)" \
  "http://localhost:3000/api/calendar" | grep -c "Apporter les plots"
# → 1   (vue coach)
```

Ni le son, ni la transcription, ni même l'existence d'une note ne filtrent vers vos
athlètes.

## 5. Où vivent les données

Le code ne connaît pas « un fichier » mais un **dépôt** — lire, écrire, supprimer un
chemin. Le choix se fait par l'environnement, rien d'autre ne change. Deux fichiers,
quel que soit le dépôt : `sessions.json` et
`notes-vocales/<séance>/<note>.webm`.

- **Par défaut, le disque** : `data/sessions.json`, écrit puis renommé — une coupure
  ne laisse jamais un fichier à moitié écrit. Rien à configurer.
- **Google Drive, façon simple** : pointez `CALENDAR_DATA_FILE` vers un dossier suivi
  par Google Drive pour ordinateur. Zéro configuration, mais **un seul serveur** :
  deux machines sur le même fichier et Drive fabrique des copies en conflit.
- **Google Drive, par l'API** : le serveur parle directement à Drive. Aucune
  bibliothèque à installer.

```bash
# Compte de service : partagez-lui le dossier Drive
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/chemin/cle.json npm start

# OAuth : les fichiers restent dans votre Drive
node outils/jeton-google.js      # une fois : affiche les trois variables
GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… npm start
```

Au démarrage, le serveur annonce toujours où il écrit :
`Données : drive — dossier 1AbC…`

> **Une écriture qui échoue ne change rien.** Sur Drive, écrire est un appel réseau.
> La mémoire ne bascule qu'une fois le dépôt d'accord : un refus remonte à
> l'appelant, rien n'a changé nulle part, et le créneau reste libre pour un nouvel
> essai. De même, un `sessions.json` illisible empêche le serveur de démarrer plutôt
> que de servir un calendrier vide.

### Variables d'environnement

| Variable | Défaut | Rôle |
|---|---|---|
| `PORT` | 3000 | Port d'écoute |
| `HOST` | 0.0.0.0 | Interface d'écoute |
| `CALENDAR_DATA_FILE` | `data/sessions.json` | Emplacement des séances |
| `CALENDAR_COACH_KEY` | tirée au sort | Clé qui ouvre les notes vocales |
| `CALENDAR_STORAGE` | auto | `fichier`, `drive` ou `memoire` |
| `GOOGLE_SERVICE_ACCOUNT_KEY_FILE` | — | Clé JSON du compte de service |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` | — | OAuth |
| `GOOGLE_DRIVE_FOLDER_NAME` | Calendrier entraînements | Dossier Drive à créer ou réutiliser |
| `GOOGLE_DRIVE_FOLDER_ID` | — | Dossier Drive existant, par son identifiant |

## 6. Mettre en ligne sur Cloudflare Workers

C'est le chemin recommandé pour un lien qui circule sur WhatsApp : le Worker ne
dort pas. Un athlète qui ouvre le lien après trois jours de silence n'attend rien —
là où un plan gratuit classique met une trentaine de secondes à se réveiller, le
temps que la plupart des gens referment la page.

```bash
cd calendrier
npx wrangler r2 bucket create calendrier-entrainements
npx wrangler secret put CALENDAR_COACH_KEY   # notez-la : rien ne la réaffichera
npx wrangler deploy
```

Wrangler affiche l'adresse du Worker à la fin. C'est **celle-là** que vous collez
dans WhatsApp.

Tout est déjà déclaré dans `wrangler.toml` : le bucket R2 pour les données, les
fichiers de `public/` pour la page, et la règle qui fait passer la page par le
Worker — sans elle, l'aperçu du lien s'afficherait sans vignette.

Vérifiez après déploiement :

```bash
curl https://votre-worker.workers.dev/api/health     # doit annoncer "type": "r2"
```

### Ce qu'il faut savoir

- **HTTPS est fourni** par Cloudflare, donc le micro des notes vocales fonctionne.
- **La clé coach est un secret**, pas une variable : `wrangler secret put`. Elle
  n'est plus jamais affichée — gardez-la ailleurs.
- **Deux enregistrements au même instant** : le second reçoit un `409` et la page
  se recharge, plutôt que d'écraser le premier. Rien n'est perdu sans le dire.
- **Ajouter un athlète** se fait dans `src/athletes.js`, puis `npx wrangler deploy`.

### Si vous préférez un serveur Node

Il vous faut un hébergeur qui **exécute Node** — la PWA MED-EL Connect à la racine
du dépôt est un site statique et ne peut pas l'héberger. Fixez alors
`CALENDAR_COACH_KEY` dans l'environnement, et si le disque ne survit pas aux
redémarrages, passez les données sur Google Drive (section 5).

## 7. Limites et dépannage

> **Se déclarer n'est pas s'authentifier.** Le menu « Je suis » dit « je suis Zoé »,
> rien de plus : quelqu'un de mal intentionné peut se déclarer quelqu'un d'autre et
> lire ou écrire ses comptes rendus. C'est un confort d'affichage, pas une barrière.
> Le planning et les notes vocales, eux, sont bien protégés par la clé coach. Pour
> une vraie séparation entre athlètes, il faudrait un code par personne.

| Symptôme | Cause et remède |
|---|---|
| `EADDRINUSE` | Le port est déjà pris — un serveur tourne encore. Arrêtez-le, ou démarrez ailleurs : `PORT=3100 npm start`. |
| `401` sur les notes vocales | Clé absente ou fausse. Relisez `data/cle-coach.txt`, ou repassez en mode coach dans la page. |
| `409` à la création | Ce lieu est déjà pris sur ce créneau. Annulez la séance existante — elle libère son lieu — ou choisissez un autre lieu. |
| Bouton d'enregistrement désactivé | Le micro exige `localhost` ou HTTPS. L'explication est affichée sous le bouton. |
| `Démarrage impossible : …` | Dépôt injoignable ou `sessions.json` illisible. Le serveur refuse de démarrer plutôt que de servir un calendrier vide ; le message dit lequel des deux. |
| Pas de transcription automatique | Firefox ne la fournit pas. Le son est bien enregistré ; la transcription peut être saisie à la main. |

**Se remettre à zéro** : tout l'état tient dans `data/`. En supprimer le contenu
efface les séances, les notes vocales et la clé coach — le prochain démarrage repart
de zéro et en tire une nouvelle.
