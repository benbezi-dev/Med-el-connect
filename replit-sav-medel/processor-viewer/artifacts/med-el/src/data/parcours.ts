// Nouveau parcours d'entrée : profil → processeur → type d'aide.
// L'arbre de diagnostic existant (tree.ts) n'est pas modifié : l'auto-diagnostic
// y renvoie, au nœud racine qui correspond au profil et au processeur choisis.

export type ProfilId = "utilisateur" | "professionnel";
export type ProcesseurId = "sonnet1" | "sonnet2" | "sonnet3" | "rondo2" | "rondo3";
export type AideId = "connectivite" | "diagnostic";
export type Modele3D = "sonnet" | "rondo";

export type Profil = {
  id: ProfilId;
  titre: string;
  sous: string;
  espace: string;
  question: string;
};

export const PROFILS: Profil[] = [
  {
    id: "utilisateur",
    titre: "Utilisateur",
    sous: "Je porte un implant MED-EL, ou j'accompagne un proche",
    espace: "Espace utilisateur",
    question: "Quel est votre processeur ?",
  },
  {
    id: "professionnel",
    titre: "Professionnel",
    sous: "Audioprothésiste, orthophoniste, centre d'implantation…",
    espace: "Espace professionnel",
    question: "Quel processeur équipe le patient ?",
  },
];

export type Processeur = {
  id: ProcesseurId;
  nom: string;
  gamme: "Sonnet" | "Rondo";
  modele: Modele3D;
  sous: string;
  // couleurs indicatives du modèle 3D, à ajuster sur les coloris réels
  couleur: string;
  secondaire: string;
};

export const PROCESSEURS: Record<ProcesseurId, Processeur> = {
  sonnet1: { id: "sonnet1", nom: "Sonnet 1", gamme: "Sonnet", modele: "sonnet", sous: "Contour d'oreille, antenne séparée", couleur: "#C8B79E", secondaire: "#C2B198" },
  sonnet2: { id: "sonnet2", nom: "Sonnet 2", gamme: "Sonnet", modele: "sonnet", sous: "Contour d'oreille, antenne séparée", couleur: "#8D9095", secondaire: "#86898E" },
  sonnet3: { id: "sonnet3", nom: "Sonnet 3", gamme: "Sonnet", modele: "sonnet", sous: "Contour d'oreille, Bluetooth intégré", couleur: "#2F3034", secondaire: "#35363A" },
  rondo2: { id: "rondo2", nom: "Rondo 2", gamme: "Rondo", modele: "rondo", sous: "Tout-en-un sur la tête, rechargeable", couleur: "#4E4F53", secondaire: "#6A6C70" },
  rondo3: { id: "rondo3", nom: "Rondo 3", gamme: "Rondo", modele: "rondo", sous: "Tout-en-un sur la tête, rechargeable", couleur: "#2A2B2E", secondaire: "#3A3B3F" },
};

export const GAMMES: { titre: string; processeurs: ProcesseurId[] }[] = [
  { titre: "Gamme Sonnet", processeurs: ["sonnet1", "sonnet2", "sonnet3"] },
  { titre: "Gamme Rondo", processeurs: ["rondo2", "rondo3"] },
];

export const AIDES: { id: AideId; titre: string; sous: string }[] = [
  { id: "connectivite", titre: "Aide à la connectivité", sous: "Smartphone, accessoires, télécommande, application" },
  { id: "diagnostic", titre: "Auto-diagnostic", sous: "Le processeur et ses composants, avec la vue 3D" },
];

// Nœud de départ dans l'arbre existant ; absent quand l'arbre ne couvre pas encore l'appareil.
export function departDiagnostic(profil: ProfilId, proc: ProcesseurId): string | null {
  const p = profil === "professionnel" ? "pro" : "patient";
  if (proc === "rondo3") return `${p}_rondo3_root`;
  if (proc.startsWith("sonnet")) return `${p}_sonnet_root`;
  return null;
}

// Composants nommés quand on touche une pièce du modèle 3D.
export const COMPOSANTS: Record<Modele3D, Record<string, string>> = {
  sonnet: {
    unite: "Unité de contrôle",
    pack: "Pack d'alimentation",
    micros: "Microphones",
    voyant: "Voyant de liaison",
    contour: "Coude",
    touche: "Touche tactile",
    cable: "Câble d'antenne",
    antenne: "Antenne",
    aimant: "Aimant",
  },
  rondo: {
    boitier: "Boîtier",
    couvercle: "Couvercle",
    bouton: "Bouton marche/arrêt",
    micros: "Microphones",
    voyant: "Voyants",
    batterie: "Batterie intégrée",
    aimant: "Aimant",
  },
};
