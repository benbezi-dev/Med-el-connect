// Guides pas à pas : connectivité pour chaque processeur et diagnostic du Rondo 2.
// L'arbre existant (tree.ts) n'est pas modifié ; un lien "diagnostic:<nœud>" y renvoie quand il couvre déjà le sujet.
// Chaque fiche cite sa source. "verifier" signale un contenu que les sources publiques ne confirment pas en entier.

import type { AideId, ProcesseurId, ProfilId } from "@/data/parcours";

export type IconeGuide =
  | "Bluetooth" | "Smartphone" | "Tv" | "Phone" | "Headphones" | "Mic" | "Radio"
  | "Battery" | "Magnet" | "Power" | "Volume2" | "AlertTriangle" | "Wrench" | "Stethoscope";

export type OptionGuide = { label: string; hint?: string; vers: string; icone?: IconeGuide };

type Base = { id: string; rubrique: string; surtitre: string; piece?: string };
export type NoeudGuide =
  | (Base & { type: "choix"; question: string; sous?: string; options: OptionGuide[] })
  | (Base & {
      type: "fiche";
      titre: string;
      resume?: string;
      gravite?: "info" | "warning" | "critical" | "success";
      // chaque étape peut désigner la pièce à allumer sur le modèle 3D
      etapes?: { texte: string; piece?: string }[];
      suites?: { label: string; vers: string }[];
      source?: string;
      verifier?: boolean;
    });

const SRC = {
  connectivite: "https://www.medel.com/en-us/hearing-solutions/accessories/connectivity",
  sonnet2Faq: "https://www.medel.com/en-us/support/product-support/audio-processors/sonnet2/frequently-asked-questions",
  sonnet3Pairing: "https://www.medel.com/en-au/support/product-support/audio-processors/sonnet3/connectivity/sonnet3_connectivity_pairing",
  adaptateurIos: "https://www.medel.com/en-gb/support/product-support/audio-processors/sonnet/audiostreamadapter_pairing_ios",
  adaptateurAndroid: "https://ais.southampton.ac.uk/wp-content/uploads/sites/336/2026/01/R3-ASA-Android-Digital.pdf",
  astuces: "https://blog.medel.pro/en-us/support/wireless-connectivity-tips-and-tricks/",
  rondo2Charge: "https://www.medel.com/en-au/support/product-support/audio-processors/rondo2/handling-and-basics/du_rondo2_handling_charging_batteries",
  rondo2Voyants: "https://www.medel.com/support/audio-processors/rondo2/handling-and-basics/du_rondo2_indicator_lights",
  rondo2Liaison: "https://www.medel.com/support/audio-processors/rondo2/handling-and-basics/du_link_check_function",
  rondo2Support: "https://www.medel.com/support/rondo2/handling-and-basics",
};

const CO = "Aide à la connectivité";
const DIAG = "Diagnostic Rondo 2";

const liste: NoeudGuide[] = [
  // ================= CONNECTIVITÉ : point d'entrée par processeur =================
  {
    id: "co_sonnet1", type: "choix", rubrique: CO, surtitre: "Connectivité · Sonnet 1",
    question: "Que voulez-vous connecter au Sonnet 1 ?",
    sous: "Le Sonnet 1 n'a pas de Bluetooth intégré : la connexion passe par un accessoire.",
    options: [
      { label: "Téléphone, tablette ou TV avec AudioLink", hint: "Boîtier de streaming Bluetooth", vers: "co_audiolink_sonnet", icone: "Smartphone" },
      { label: "Streaming avec AudioStream", hint: "Couvercle glissé sur le pack d'alimentation", vers: "co_audiostream", icone: "Headphones" },
      { label: "Ça ne fonctionne pas", hint: "Appairage impossible, son coupé", vers: "co_dep_sonnet", icone: "Wrench" },
    ],
  },
  {
    id: "co_sonnet2", type: "choix", rubrique: CO, surtitre: "Connectivité · Sonnet 2",
    question: "Que voulez-vous connecter au Sonnet 2 ?",
    options: [
      { label: "Smartphone en streaming avec AudioStream", hint: "Couvercle glissé sur le pack d'alimentation", vers: "co_audiostream", icone: "Smartphone" },
      { label: "Téléphone, tablette ou TV avec AudioLink", hint: "Boîtier de streaming Bluetooth", vers: "co_audiolink_sonnet", icone: "Tv" },
      { label: "Régler le processeur avec AudioKey 2", hint: "Application télécommande", vers: "co_audiokey", icone: "Bluetooth" },
      { label: "Ça ne fonctionne pas", hint: "Appairage impossible, son coupé", vers: "co_dep_sonnet", icone: "Wrench" },
    ],
  },
  {
    id: "co_sonnet3", type: "choix", rubrique: CO, surtitre: "Connectivité · Sonnet 3",
    question: "Que voulez-vous connecter au Sonnet 3 ?",
    sous: "Le Sonnet 3 a le Bluetooth intégré : il se connecte directement au téléphone.",
    options: [
      { label: "Mon smartphone en Bluetooth direct", hint: "iPhone ou Android, sans accessoire", vers: "co_s3_bluetooth", icone: "Bluetooth" },
      { label: "Micro distant, boucle magnétique, FM", hint: "Avec l'AudioLink XT", vers: "co_s3_audiolinkxt", icone: "Mic" },
      { label: "Régler le processeur avec l'application", hint: "AudioKey 3", vers: "co_audiokey", icone: "Smartphone" },
      { label: "Ça ne fonctionne pas", hint: "Appairage impossible, son coupé", vers: "co_s3_dep", icone: "Wrench" },
    ],
  },
  {
    id: "co_rondo2", type: "choix", rubrique: CO, surtitre: "Connectivité · Rondo 2",
    question: "Que voulez-vous connecter au Rondo 2 ?",
    sous: "MED-EL publie peu de procédures de connexion pour le Rondo 2. Ce guide résume ce qui est documenté.",
    options: [
      { label: "Les solutions compatibles", hint: "Télécommande, boucle magnétique, accessoires", vers: "co_r2_solutions", icone: "Radio" },
      { label: "Ça ne fonctionne pas", vers: "co_r2_dep", icone: "Wrench" },
    ],
  },
  {
    id: "co_rondo3", type: "choix", rubrique: CO, surtitre: "Connectivité · Rondo 3",
    question: "Que voulez-vous connecter au Rondo 3 ?",
    options: [
      { label: "Mon iPhone en streaming", hint: "Avec l'adaptateur AudioStream", vers: "co_r3_ios", icone: "Smartphone" },
      { label: "Mon téléphone Android en streaming", hint: "Avec l'adaptateur AudioStream", vers: "co_r3_android", icone: "Smartphone" },
      { label: "Téléphone, tablette ou TV avec AudioLink", hint: "Boîtier de streaming Bluetooth", vers: "co_audiolink_rondo", icone: "Tv" },
      { label: "Le streaming ne fonctionne pas", hint: "Ouvre le diagnostic AudioStream existant", vers: "diagnostic:q_as_1", icone: "Headphones" },
      { label: "AudioKey 2 ne trouve pas le processeur", hint: "Ouvre le diagnostic AudioKey existant", vers: "diagnostic:q_ak_1", icone: "Bluetooth" },
    ],
  },

  // ================= Sonnet 3 =================
  {
    id: "co_s3_bluetooth", type: "fiche", rubrique: CO, surtitre: "Bluetooth direct",
    titre: "Appairer le Sonnet 3 à votre téléphone",
    resume: "Chaque processeur ne s'appaire qu'une fois. En bilatéral, faites les deux processeurs en même temps.",
    etapes: [
      { texte: "Éteignez le processeur (les deux en bilatéral) et attendez au moins 2 secondes.", piece: "unite" },
      { texte: "Posez-le à moins de 3 cm du téléphone, puis rallumez-le.", piece: "unite" },
      { texte: "Activez le Bluetooth du téléphone." },
      { texte: "iPhone : Réglages › Accessibilité › Appareils auditifs › Appareils auditifs MFi. Android : restez dans le menu Bluetooth (Samsung : Accessibilité › Améliorations auditives › Prise en charge des aides auditives)." },
      { texte: "Sélectionnez votre ou vos Sonnet 3 dans la liste, puis touchez « Associer »." },
    ],
    suites: [{ label: "L'appairage ne marche pas", vers: "co_s3_dep" }],
    source: SRC.sonnet3Pairing,
  },
  {
    id: "co_s3_dep", type: "fiche", rubrique: CO, surtitre: "Dépannage Bluetooth", gravite: "info",
    titre: "Le Sonnet 3 ne s'appaire pas",
    etapes: [
      { texte: "Rapprochez le processeur à moins de 3 cm du téléphone.", piece: "unite" },
      { texte: "Éteignez-le, attendez au moins 2 secondes, rallumez-le.", piece: "unite" },
      { texte: "Sur iPhone, si « MED-EL Hearing Device » apparaît dans le menu Bluetooth, touchez « Oublier cet appareil » et repassez par Accessibilité › Appareils auditifs." },
      { texte: "En bilatéral, oubliez les deux processeurs et appairez-les de nouveau ensemble." },
      { texte: "Si rien ne change, notez le modèle de votre téléphone et contactez votre centre ou MED-EL." },
    ],
    source: SRC.sonnet3Pairing,
  },
  {
    id: "co_s3_audiolinkxt", type: "fiche", rubrique: CO, surtitre: "AudioLink XT",
    titre: "Micro distant, boucle magnétique et FM",
    resume: "L'AudioLink XT apporte au Sonnet 3 la télébobine, une entrée pour récepteur FM et un micro distant. La procédure d'appairage détaillée n'a pas encore été reprise ici : suivez la notice livrée avec l'AudioLink XT.",
    piece: "unite",
    source: SRC.connectivite,
    verifier: true,
  },

  // ================= Sonnet 1 et 2 =================
  {
    id: "co_audiostream", type: "fiche", rubrique: CO, surtitre: "AudioStream",
    titre: "Diffuser le son avec l'AudioStream",
    resume: "L'AudioStream est un couvercle qui se glisse sur le pack d'alimentation du Sonnet. Il fonctionne avec les iPhone (MFi) et les Android compatibles (ASHA).",
    etapes: [
      { texte: "Mettez des piles neuves pour la première utilisation.", piece: "pack" },
      { texte: "En bilatéral, configurez les deux côtés en même temps.", piece: "pack" },
      { texte: "Sur iPhone, passez par Réglages › Accessibilité › Appareils auditifs, pas par le menu Bluetooth." },
      { texte: "Laissez les notifications de l'application AudioKey actives : les mises à jour de l'AudioStream passent par elle." },
    ],
    suites: [{ label: "Ça ne fonctionne pas", vers: "co_dep_sonnet" }],
    source: SRC.astuces,
  },
  {
    id: "co_audiolink_sonnet", type: "fiche", rubrique: CO, surtitre: "AudioLink",
    titre: "Connecter l'AudioLink au Sonnet",
    resume: "Appairez toujours l'AudioLink au processeur d'abord, puis au téléphone, à la tablette ou à la TV.",
    etapes: [
      { texte: "Coupez le Bluetooth du téléphone pendant l'appairage avec le processeur." },
      { texte: "Lancez l'appairage : seul le voyant vert de l'AudioLink doit être allumé. Si le voyant bleu s'allume, le Bluetooth du téléphone est encore actif." },
      { texte: "Une fois le processeur appairé, rallumez le Bluetooth du téléphone et appairez-le à l'AudioLink." },
      { texte: "En bilatéral, la gauche et la droite doivent être correctement programmées dans Maestro par votre centre." },
    ],
    suites: [{ label: "Ça ne fonctionne pas", vers: "co_dep_sonnet" }],
    source: SRC.astuces,
  },
  {
    id: "co_dep_sonnet", type: "fiche", rubrique: CO, surtitre: "Dépannage", gravite: "info",
    titre: "La connexion ne fonctionne pas",
    etapes: [
      { texte: "Vérifiez les piles ou la batterie du processeur et de l'accessoire.", piece: "pack" },
      { texte: "Éteignez puis rallumez le processeur, l'accessoire et le téléphone.", piece: "unite" },
      { texte: "Sur iPhone, oubliez « MED-EL Hearing Device » dans le menu Bluetooth s'il y apparaît, puis reconfigurez depuis Accessibilité › Appareils auditifs." },
      { texte: "En bilatéral, si un second processeur a été ajouté après coup, oubliez le premier et reconfigurez les deux ensemble." },
      { texte: "Pour entendre aussi l'environnement pendant le streaming, demandez à votre centre le mode mixte." },
    ],
    source: SRC.astuces,
  },
  {
    id: "co_audiokey", type: "fiche", rubrique: CO, surtitre: "Application AudioKey",
    titre: "Régler le processeur depuis le téléphone",
    resume: "AudioKey 2 fonctionne avec le Sonnet 2 et le Rondo 3, AudioKey 3 avec le Sonnet 3. L'application change le volume, la sensibilité et le programme.",
    etapes: [
      { texte: "Installez l'application depuis l'App Store ou Google Play." },
      { texte: "Activez le Bluetooth et autorisez l'application à l'utiliser." },
      { texte: "Allumez le processeur, gardez-le près du téléphone et suivez l'appairage proposé par l'application.", piece: "unite" },
      { texte: "Si le processeur n'est pas trouvé : mettez l'application à jour, redémarrez le processeur et le téléphone, puis recommencez." },
    ],
    source: SRC.connectivite,
    verifier: true,
  },

  // ================= Rondo 3 =================
  {
    id: "co_r3_ios", type: "fiche", rubrique: CO, surtitre: "Adaptateur AudioStream · iPhone",
    titre: "Appairer l'adaptateur AudioStream à un iPhone",
    etapes: [
      { texte: "Installez la dernière version d'AudioKey et activez le Bluetooth." },
      { texte: "Retirez l'adaptateur du Rondo 3." },
      { texte: "Dans AudioKey : menu › Options de connectivité › AudioStream › Configuration, puis choisissez le côté." },
      { texte: "Rondo 3 allumé, branchez l'adaptateur, posez-le près du téléphone et touchez « Suivant »." },
      { texte: "En bilatéral, faites le second Rondo 3 en laissant le premier allumé." },
      { texte: "Donnez un nom de 7 lettres maximum, sans accents, puis « Enregistrer »." },
      { texte: "Acceptez la demande de jumelage, puis « OK »." },
      { texte: "Vérifiez dans Réglages › Accessibilité › Appareils auditifs que l'appareil est connecté." },
    ],
    suites: [{ label: "L'appairage échoue", vers: "co_r3_dep" }],
    source: SRC.adaptateurIos,
  },
  {
    id: "co_r3_android", type: "fiche", rubrique: CO, surtitre: "Adaptateur AudioStream · Android",
    titre: "Appairer l'adaptateur AudioStream à un Android",
    etapes: [
      { texte: "Installez AudioKey, activez le Bluetooth et la localisation." },
      { texte: "Dans AudioKey : Options de connectivité › AudioStream › Configurer." },
      { texte: "Choisissez l'oreille, branchez l'adaptateur sur le Rondo 3 et continuez." },
      { texte: "Donnez un nom de 7 caractères maximum et enregistrez." },
      { texte: "Acceptez la demande de jumelage, touchez « OK » et fermez l'application." },
      { texte: "Connectez l'adaptateur depuis le menu Bluetooth du téléphone (Samsung : Accessibilité › Améliorations auditives › Prise en charge des aides auditives)." },
    ],
    suites: [{ label: "L'appairage échoue", vers: "co_r3_dep" }],
    source: SRC.adaptateurAndroid,
  },
  {
    id: "co_r3_dep", type: "fiche", rubrique: CO, surtitre: "Dépannage adaptateur", gravite: "info",
    titre: "L'adaptateur ne s'appaire pas",
    etapes: [
      { texte: "Rapprochez le Rondo 3 du téléphone." },
      { texte: "Débranchez puis rebranchez l'adaptateur, et touchez « Réessayer »." },
      { texte: "Ensuite, l'adaptateur se reconnecte seul tant qu'il est branché, le Rondo 3 allumé et le Bluetooth actif." },
    ],
    suites: [{ label: "Toujours rien : diagnostic AudioStream", vers: "diagnostic:q_as_1" }],
    source: SRC.adaptateurIos,
  },
  {
    id: "co_audiolink_rondo", type: "fiche", rubrique: CO, surtitre: "AudioLink",
    titre: "Connecter l'AudioLink au Rondo 3",
    resume: "Appairez toujours l'AudioLink au processeur d'abord, puis au téléphone, à la tablette ou à la TV.",
    etapes: [
      { texte: "Posez le Rondo 3 au centre du clavier de l'AudioLink, un peu au-dessus de la touche de volume." },
      { texte: "Une fois le processeur appairé, appairez le téléphone ou la TV à l'AudioLink." },
      { texte: "En bilatéral, la gauche et la droite doivent être correctement programmées dans Maestro par votre centre." },
    ],
    source: SRC.astuces,
  },

  // ================= Rondo 2 : connectivité =================
  {
    id: "co_r2_solutions", type: "fiche", rubrique: CO, surtitre: "Solutions Rondo 2",
    titre: "Ce qui se connecte au Rondo 2",
    resume: "Les sources publiques indiquent les solutions ci-dessous, sans procédure détaillée. Votre centre peut confirmer celles qui sont réglées sur votre processeur.",
    etapes: [
      { texte: "Télécommande FineTuner Echo : le voyant du Rondo 2 confirme chaque commande reçue.", piece: "voyant" },
      { texte: "Télébobine intégrée, pour les boucles magnétiques des lieux publics." },
      { texte: "Boucles d'induction Bluetooth et récepteurs FM, avec le Mini Battery Pack." },
    ],
    source: SRC.connectivite,
    verifier: true,
  },
  {
    id: "co_r2_dep", type: "fiche", rubrique: CO, surtitre: "Dépannage", gravite: "info",
    titre: "La connexion ne fonctionne pas",
    etapes: [
      { texte: "Vérifiez que le Rondo 2 est chargé.", piece: "batterie" },
      { texte: "Si la télécommande ne fait rien, regardez le voyant : il clignote quand une commande est reçue.", piece: "voyant" },
      { texte: "Éteignez puis rallumez le processeur." },
      { texte: "Si rien ne change, contactez votre centre d'implantation." },
    ],
    suites: [{ label: "Lancer le diagnostic du Rondo 2", vers: "r2_patient_root" }],
    source: SRC.rondo2Voyants,
  },

  // ================= Rondo 2 : diagnostic =================
  {
    id: "r2_patient_root", type: "choix", rubrique: DIAG, surtitre: "Rondo 2 · Symptôme",
    question: "Quel problème observez-vous sur le Rondo 2 ?",
    options: [
      { label: "Aucun son", vers: "r2_son_1", icone: "Volume2" },
      { label: "Le processeur ne charge plus", vers: "r2_charge_1", icone: "Battery" },
      { label: "Le voyant fait quelque chose d'inhabituel", vers: "r2_voyant", icone: "AlertTriangle" },
      { label: "L'aimant ne tient pas", vers: "r2_aimant", icone: "Magnet" },
    ],
  },
  {
    id: "r2_pro_root", type: "choix", rubrique: DIAG, surtitre: "Rondo 2 · Symptôme · Pro",
    question: "Quel problème souhaitez-vous diagnostiquer ?",
    options: [
      { label: "Contrôle de la liaison avec l'implant", hint: "Lecture du voyant de liaison", vers: "r2_liaison", icone: "Stethoscope" },
      { label: "Aucun son", vers: "r2_son_1", icone: "Volume2" },
      { label: "Le processeur ne charge plus", vers: "r2_charge_1", icone: "Battery" },
      { label: "Le voyant fait quelque chose d'inhabituel", vers: "r2_voyant", icone: "AlertTriangle" },
      { label: "L'aimant ne tient pas", vers: "r2_aimant", icone: "Magnet" },
    ],
  },
  {
    id: "r2_son_1", type: "choix", rubrique: DIAG, surtitre: "Son absent", piece: "batterie",
    question: "Le Rondo 2 est-il chargé ?",
    options: [
      { label: "Non, ou je ne sais pas", vers: "r2_charge_faire", icone: "Battery" },
      { label: "Oui, il sort du chargeur", vers: "r2_son_2", icone: "Power" },
    ],
  },
  {
    id: "r2_son_2", type: "choix", rubrique: DIAG, surtitre: "Son absent", piece: "aimant",
    question: "Le voyant de liaison indique-t-il que le processeur est relié à l'implant ?",
    sous: "Au moment de la pose, le voyant peut signaler que la liaison est établie. Votre audioprothésiste a pu le désactiver.",
    options: [
      { label: "Non, ou motif d'alerte", vers: "r2_liaison" },
      { label: "Oui, la liaison est bonne", vers: "r2_son_fin" },
      { label: "Le voyant ne s'allume pas du tout", vers: "r2_liaison" },
    ],
  },
  {
    id: "r2_son_fin", type: "fiche", rubrique: DIAG, surtitre: "Son absent", gravite: "warning",
    titre: "Relancer le processeur et changer de programme",
    etapes: [
      { texte: "Éteignez puis rallumez le Rondo 2." },
      { texte: "Essayez un autre programme : un réglage non programmé ou en panne est signalé par le voyant.", piece: "voyant" },
      { texte: "Si le son ne revient pas, contactez votre centre d'implantation." },
    ],
    source: SRC.rondo2Voyants,
  },
  {
    id: "r2_charge_faire", type: "fiche", rubrique: DIAG, surtitre: "Charge",
    titre: "Charger le Rondo 2",
    etapes: [
      { texte: "Branchez le câble USB au chargeur, puis à la prise secteur." },
      { texte: "Éteignez le Rondo 2." },
      { texte: "Posez-le exactement au centre du chargeur, logo MED-EL vers le haut.", piece: "couvercle" },
      { texte: "Le voyant orange indique la charge. Quand il s'éteint, le processeur est chargé (environ 5 heures).", piece: "voyant" },
    ],
    suites: [{ label: "Le voyant orange ne s'allume pas", vers: "r2_charge_1" }],
    source: SRC.rondo2Charge,
  },
  {
    id: "r2_charge_1", type: "choix", rubrique: DIAG, surtitre: "Charge", piece: "batterie",
    question: "Le voyant orange s'allume-t-il quand le Rondo 2 est sur le chargeur ?",
    options: [
      { label: "Non", vers: "r2_charge_2" },
      { label: "Oui, mais il ne tient pas la charge", vers: "r2_charge_usure" },
    ],
  },
  {
    id: "r2_charge_2", type: "fiche", rubrique: DIAG, surtitre: "Charge", gravite: "warning",
    titre: "Vérifier le chargeur et la position",
    etapes: [
      { texte: "Vérifiez que le câble USB est bien branché au chargeur et à une prise qui fonctionne." },
      { texte: "Éteignez le Rondo 2 avant de le poser." },
      { texte: "Centrez-le exactement sur le chargeur, logo MED-EL vers le haut.", piece: "couvercle" },
      { texte: "Si le voyant ne s'allume toujours pas, contactez votre centre ou le SAV MED-EL." },
    ],
    source: SRC.rondo2Charge,
  },
  {
    id: "r2_charge_usure", type: "fiche", rubrique: DIAG, surtitre: "Charge", gravite: "warning",
    titre: "Autonomie réduite",
    resume: "Si le Rondo 2 se décharge bien plus vite qu'avant malgré des charges complètes, la batterie intégrée peut être usée.",
    etapes: [
      { texte: "Faites une charge complète, jusqu'à l'extinction du voyant orange.", piece: "voyant" },
      { texte: "Notez combien de temps il tient sur une journée normale." },
      { texte: "Signalez-le à votre centre ou au SAV MED-EL avec cette durée." },
    ],
    piece: "batterie",
    source: SRC.rondo2Charge,
    verifier: true,
  },
  {
    id: "r2_voyant", type: "fiche", rubrique: DIAG, surtitre: "Voyant",
    titre: "Ce que signale le voyant",
    resume: "Les couleurs et les clignotements exacts sont illustrés dans la notice MED-EL. Voici les messages possibles et quoi faire.",
    piece: "voyant",
    etapes: [
      { texte: "Batterie vide : rechargez le processeur.", piece: "batterie" },
      { texte: "Volume ou sensibilité au minimum ou au maximum : arrêtez de régler.", piece: "voyant" },
      { texte: "Erreur temporaire ou électronique : éteignez puis rallumez.", piece: "voyant" },
      { texte: "Réglage non programmé ou en panne : choisissez un autre programme.", piece: "voyant" },
      { texte: "Si l'alerte revient, contactez votre centre d'implantation.", piece: "voyant" },
    ],
    source: SRC.rondo2Voyants,
  },
  {
    id: "r2_liaison", type: "fiche", rubrique: DIAG, surtitre: "Liaison avec l'implant",
    titre: "Lire le contrôle de liaison",
    piece: "aimant",
    etapes: [
      { texte: "Signal « Connecté » ou « Fonctionne » : le processeur est relié à l'implant.", piece: "aimant" },
      { texte: "Motif d'alerte : le processeur n'est pas relié. Repositionnez-le et vérifiez que l'aimant est le bon.", piece: "aimant" },
      { texte: "Placé sur le mauvais implant (bilatéral) : changez-le de côté.", piece: "boitier" },
      { texte: "Aucune lumière : rechargez complètement. Le voyant peut aussi avoir été désactivé par l'audioprothésiste.", piece: "voyant" },
      { texte: "Avec le Mini Battery Pack éteint : rallumez-le, puis repositionnez le processeur." },
      { texte: "Si la liaison ne s'établit pas, contactez votre centre d'implantation." },
    ],
    suites: [{ label: "L'aimant ne tient pas", vers: "r2_aimant" }],
    source: SRC.rondo2Liaison,
  },
  {
    id: "r2_aimant", type: "fiche", rubrique: DIAG, surtitre: "Aimant", gravite: "warning",
    titre: "Le Rondo 2 ne tient pas sur la tête",
    resume: "La force de l'aimant est choisie par votre centre. La procédure de changement d'aimant est décrite dans la notice MED-EL.",
    piece: "aimant",
    etapes: [
      { texte: "Vérifiez que l'aimant est en place et qu'il n'y a pas de cheveux ou de saleté dessous.", piece: "aimant" },
      { texte: "Ne changez pas vous-même la force de l'aimant : un aimant trop fort peut blesser la peau." },
      { texte: "Prenez rendez-vous avec votre centre pour ajuster l'aimant." },
    ],
    source: SRC.rondo2Support,
    verifier: true,
  },
];

export const GUIDES: Record<string, NoeudGuide> = Object.fromEntries(liste.map((n) => [n.id, n]));

// Point d'entrée d'un guide ; null quand l'arbre existant (tree.ts) couvre déjà la demande.
export function departGuide(aide: AideId, profil: ProfilId, proc: ProcesseurId): string | null {
  if (aide === "connectivite") return `co_${proc}`;
  if (proc === "rondo2") return profil === "professionnel" ? "r2_pro_root" : "r2_patient_root";
  return null;
}
