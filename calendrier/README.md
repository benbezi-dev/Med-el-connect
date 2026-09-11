# API Calendrier — présentation sur 7 jours

Calendrier de réservation de créneaux d'entraînement : une grille de 7 jours,
une **colonne « Heure »** à gauche, deux créneaux possibles (**18:00** et
**18:30**) et cinq lieux.

Le module est autonome : il ne dépend d'aucun paquet npm et n'a aucun lien avec
le reste de l'application MED-EL Connect à la racine du dépôt.

```
calendrier/
├── src/          API HTTP (node:http) + logique calendrier
├── public/       Présentation 7 jours (HTML/CSS/JS, sans framework)
├── test/         36 tests (node:test)
└── data/         Séances persistées (fichier JSON, ignoré par git)
```

## Démarrer

```bash
cd calendrier
npm start                 # http://localhost:3000 — page + API sous /api
npm test                  # lance la suite de tests
```

Variables d'environnement : `PORT` (3000), `HOST` (0.0.0.0),
`CALENDAR_DATA_FILE` (`data/sessions.json`).

La page peut aussi être hébergée séparément de l'API : ouvrez-la avec
`?api=https://mon-serveur/api`.

## Référentiels

Les seules valeurs acceptées par l'API — toute autre valeur est refusée en 400.

| Heures possibles | Lieux possibles (`locationId`) | Nom |
|---|---|---|
| `18:00` | `antibes-fort-carre-stade` | Antibes Fort Carré Stade |
| `18:30` | `valbonne-stadium` | Valbonne Stadium |
| | `grasse-stadium` | Grasse Stadium |
| | `valbonne-hill` | Valbonne Hill |
| | `valbonne-city-workout` | Valbonne City Workout |

Les dates sont des chaînes `YYYY-MM-DD` sans fuseau ; le jour courant est
calculé sur `Europe/Paris`.

## Endpoints

| Méthode | Chemin | Rôle |
|---|---|---|
| `GET` | `/api` | Index des endpoints, heures et lieux |
| `GET` | `/api/health` | État du service |
| `GET` | `/api/locations` | Les 5 lieux |
| `GET` | `/api/times` | Les heures possibles |
| `GET` | `/api/calendar?start=&days=` | **Grille 7 jours prête à afficher** |
| `GET` | `/api/sessions?from=&to=&location=&time=` | Liste filtrable |
| `POST` | `/api/sessions` | Crée une séance |
| `GET` | `/api/sessions/:id` | Détail |
| `PATCH` | `/api/sessions/:id` | Modification partielle |
| `DELETE` | `/api/sessions/:id` | Suppression |

CORS est ouvert (`*`) sur toutes les routes `/api`.

### `GET /api/calendar`

`start` (défaut : aujourd'hui) et `days` (défaut : 7, max 31). La réponse est
déjà structurée comme le tableau affiché — **une ligne par heure, une cellule
par jour** — le client n'a aucun regroupement à refaire.

```bash
curl "http://localhost:3000/api/calendar?start=2026-09-11"
```

```jsonc
{
  "start": "2026-09-11", "end": "2026-09-17", "today": "2026-09-11",
  "timezone": "Europe/Paris",
  "previousStart": "2026-09-04", "nextStart": "2026-09-18",
  "times": ["18:00", "18:30"],
  "locations": [ { "id": "antibes-fort-carre-stade", "name": "Antibes Fort Carré Stade", "city": "Antibes" } ],
  "days": [
    { "date": "2026-09-11", "weekday": "vendredi", "dayLabel": "11 sept.",
      "shortLabel": "ven. 11 sept.", "dayOfMonth": 11,
      "isWeekend": false, "isToday": true, "isPast": false }
  ],
  "rows": [
    {
      "time": "18:00",                       // ← la colonne « Heure »
      "cells": [                             // ← une cellule par jour, dans l'ordre de days
        {
          "date": "2026-09-11", "time": "18:00",
          "sessions": [ /* séances de ce jour à cette heure */ ],
          "lieuxLibres": ["valbonne-stadium", "grasse-stadium"],
          "complet": false                   // true quand les 5 lieux sont pris
        }
      ]
    }
  ],
  "total": 5
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
| `title` | non | ≤ 120 caractères (défaut « Entraînement ») |
| `coach` | non | ≤ 80 caractères |
| `capacity` | non | entier 1–200 (défaut 20) |
| `participants` | non | tableau de noms (≤ 200) |
| `notes` | non | ≤ 500 caractères |

La réponse ajoute deux champs dérivés, jamais stockés : `location` (le lieu
complet) et `placesRestantes` (`capacity` − `participants`).

**Un lieu ne peut accueillir qu'une séance par créneau** : un doublon
`date` + `time` + `locationId` répond 409. Les 5 lieux peuvent en revanche
tourner en parallèle sur le même créneau.

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

`400` saisie invalide · `404` séance ou route inconnue · `405` méthode non
autorisée · `409` créneau déjà pris · `413` corps > 64 Ko · `500` erreur interne.

## Persistance

Les séances sont écrites dans `data/sessions.json` (écriture via fichier
temporaire puis renommage, pour ne jamais laisser un JSON tronqué). Le fichier
est ignoré par git ; il suffit de le supprimer pour repartir d'un calendrier
vide. Passer `dataFile: null` à `createApp()` garde tout en mémoire — c'est ce
que font les tests.
