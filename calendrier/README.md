# API Calendrier — planification sur un an, présentation sur 7 jours

Calendrier de réservation de créneaux d'entraînement : une grille de 7 jours,
une **colonne « Heure »** à gauche, deux créneaux possibles (**18:00** et
**18:30**) et cinq lieux.

La planification court sur **12 mois**, mais la page n'affiche jamais qu'une
**semaine** ; la vue année, repliée en bas de page, sert au suivi. Chaque
séance porte un **statut** (prévue, effectuée, annulée) réglable depuis un
menu déroulant posé sur sa carte, et peut recevoir des **notes vocales —
réservées au coach** : les athlètes ne les voient nulle part. Rien n'est
jamais effacé : supprimer une séance l'archive.

Le module est autonome : il ne dépend d'aucun paquet npm et n'a aucun lien avec
le reste de l'application MED-EL Connect à la racine du dépôt.

```
calendrier/
├── src/          API HTTP (node:http) + logique calendrier
├── public/       Présentation 7 jours (HTML/CSS/JS, sans framework)
├── test/         61 tests (node:test)
└── data/         Séances (JSON) et notes vocales (audio), ignorées par git
```

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
npm test                  # lance la suite de tests
```

Variables d'environnement : `PORT` (3000), `HOST` (0.0.0.0),
`CALENDAR_DATA_FILE` (`data/sessions.json`), `CALENDAR_COACH_KEY` (voir
« Accès coach »).

La page peut aussi être hébergée séparément de l'API : ouvrez-la avec
`?api=https://mon-serveur/api`.

## Référentiels

Les seules valeurs acceptées par l'API — toute autre valeur est refusée en 400.

| Heures possibles | Lieux possibles (`locationId`) | Nom | Statuts (`statut`) |
|---|---|---|---|
| `18:00` | `antibes-fort-carre-stade` | Antibes Fort Carré Stade | `prevue` (défaut) |
| `18:30` | `valbonne-stadium` | Valbonne Stadium | `effectuee` |
| | `grasse-stadium` | Grasse Stadium | `annulee` |
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
| `GET` | `/api/calendar?start=&days=` | **Grille prête à afficher** (7 jours par défaut, 366 au plus) |
| `GET` | `/api/annee?start=&mois=` | **Suivi sur 12 mois** : totaux par mois et jours occupés |
| `GET` | `/api/export` | Toutes les séances, archives comprises |
| `GET` | `/api/sessions?from=&to=&location=&time=&statut=&archivees=` | Liste filtrable |
| `POST` | `/api/sessions` | Crée une séance |
| `GET` | `/api/sessions/:id` | Détail |
| `PATCH` | `/api/sessions/:id` | Modification partielle (dont le statut) |
| `DELETE` | `/api/sessions/:id` | **Archive** la séance (rien n'est effacé) |
| `POST` | `/api/sessions/:id/restaurer` | Sort une séance des archives |
| `GET` | `/api/sessions/:id/notes-vocales` | Notes vocales de la séance — **coach** |
| `POST` | `/api/sessions/:id/notes-vocales` | Ajoute une note vocale — **coach** |
| `GET` | `/api/sessions/:id/notes-vocales/:noteId` | Renvoie le son — **coach** |
| `DELETE` | `/api/sessions/:id/notes-vocales/:noteId` | Supprime une note vocale — **coach** |

CORS est ouvert (`*`) sur toutes les routes `/api`.

## Accès coach

Les notes vocales sont privées : elles n'apparaissent **ni dans la grille, ni
dans `/api/sessions`, ni dans `/api/export`** sans la clé coach, et leurs
quatre routes répondent `401`. Tout le reste — grille, statuts, séances, vue
année — reste ouvert à vos athlètes.

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

> La clé protège les notes vocales, pas l'écriture : n'importe qui peut encore
> créer ou modifier une séance. Si le calendrier doit être ouvert en lecture
> seule aux athlètes, c'est une étape à ajouter.

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
  "times": ["18:00", "18:30"],
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
| `time` | oui | `18:00` ou `18:30` |
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

### Notes vocales

Le son part en base64 dans du JSON — rien à installer côté serveur :

```bash
curl -X POST http://localhost:3000/api/sessions/ses_…/notes-vocales \
  -H 'Content-Type: application/json' \
  -d '{"audio":"<base64>","mimeType":"audio/webm","duree":7.4,
       "transcription":"Penser à apporter les plots"}'
```

| Champ | Obligatoire | Règle |
|---|---|---|
| `audio` | oui | base64 (ou data URL), ≤ 5 Mo décodés |
| `mimeType` | non | `audio/webm` (défaut), `audio/ogg`, `audio/mp4`, `audio/mpeg`, `audio/wav` |
| `duree` | non | secondes, 0 à 1800 |
| `transcription` | non | ≤ 5000 caractères |

Le fichier est écrit sous `data/notes-vocales/<séance>/<note>.<ext>` et se
relit sur `GET /api/sessions/:id/notes-vocales/:noteId`, avec son type — de
quoi le passer directement à une balise `<audio src=…>`.

Ces quatre routes exigent la clé coach (voir « Accès coach ») ; sans elle,
`401 cle_coach_requise`.

Dans la page — **en mode coach uniquement** — le bouton **Enregistrer** capte le micro (`MediaRecorder`) et,
quand le navigateur sait le faire (Chrome, Safari), transcrit en direct via
l'API `SpeechRecognition` : le texte est attaché à la note. Sans micro
disponible — navigateur ancien, ou page servie en HTTP sur autre chose que
`localhost` — le bouton est désactivé et l'explication affichée. Une note
enregistrée avant que la séance n'existe est mise de côté et envoyée juste
après sa création.

### Erreurs

Toutes les erreurs partagent la même forme, avec un message en français :

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Le champ « time » doit valoir 18:00 ou 18:30.",
    "details": { "heuresPossibles": ["18:00", "18:30"] }
  }
}
```

`400` saisie invalide · `401` clé coach requise (notes vocales) · `404` séance,
note ou route inconnue · `405` méthode non autorisée · `409` créneau déjà pris ·
`413` corps trop volumineux (64 Ko, 8 Mo sur l'envoi d'une note vocale) · `500`
erreur interne.

## Persistance

Les séances sont écrites dans `data/sessions.json`, le son des notes vocales
sous `data/notes-vocales/` — dans les deux cas via un fichier temporaire
renommé, pour ne jamais laisser un fichier tronqué. Tout est rechargé au
démarrage : séances passées, historiques de statut, archives et notes vocales
restent disponibles d'une exécution à l'autre.

La clé coach vit dans `data/cle-coach.txt`. Ces fichiers sont ignorés par
git ; les supprimer repart d'un calendrier vide (et d'une nouvelle clé).
Passer `dataFile: null` à `createApp()` garde tout en mémoire — c'est ce que
font les tests.

`GET /api/export` renvoie l'ensemble des séances, archives comprises, pour une
sauvegarde ou une reprise ailleurs.
