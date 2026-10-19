# Travail SAV MED-EL récupéré depuis Replit (compte @bbzz76100), 19/10/2026

Aucun Repl ne s'appelle « SAV MED-EL » ; le travail est dans deux Repls.

## processor-viewer/ (Repl « Processor Viewer », le plus récent)
- `artifacts/med-el/` : diagnostic guidé React + Vite + Tailwind, avec vue 3D (three.js) du processeur et zones mises en évidence.
- Arbre de décision `src/data/tree.ts` (99 nœuds) : profil patient ou professionnel, puis appareil.
  - Rondo 3 : charge, aimant, fissure, pas de son, grésillements/sifflements, AudioStream, AudioKey, Maestro (pro).
  - Sonnet 1/2/3 : allumage (piles PR675, batterie, contacts), aimant, cache micro, coupure après 5 min, grésillements, larsen, AudioStream/AudioKey, Maestro (pro).
- Chaque résultat donne une gravité, la marche à suivre et le bouton d'appel MED-EL (01 41 06 81 06).
- `artifacts/medel-diagnostic/` : copie quasi identique (chemin /diagnostic/, attributs de test en plus).
- `artifacts/api-server/` : Express, seulement GET /api/healthz. La base Postgres/Drizzle est configurée mais vide.

## rondo3-diagnose/ (Repl « Rondo 3 Diagnose », version antérieure)
- Rondo 3 seul : accueil avec 9 catégories de problèmes, arbres dans `src/data/diagnostics.ts`, page « Processeur » avec photo et 4 zones cliquables.

## Ce qui manque pour la demande initiale
- Il n'y a pas encore de réception des demandes d'aide : pas de formulaire, pas de tables, pas d'API.
- Fichiers non copiés : voir `_SKIPPED.txt` dans chaque dossier (pnpm-lock.yaml, images, un HTML de plus de 100 Ko).
- Le dossier partagé modifie les `favicon.svg` (bloc C2PA ajouté) ; l'original est un carré orange de 3 lignes.
