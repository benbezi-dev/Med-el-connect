/* L'équipe, devenue une donnée.

   La liste de départ vit dans reference.js, mais le coach peut y ajouter,
   renommer et retirer : elle est donc rangée dans le dépôt, à côté des
   séances. Tant qu'il n'y a rien touché, rien n'est écrit — la liste de
   départ tient lieu de contenu.

   « Retirer » n'efface pas : l'athlète devient inactif. Il disparaît des
   listes où l'on s'inscrit, mais les séances passées continuent d'afficher
   son nom sur ses inscriptions et ses messages. */

const { ATHLETES_INITIAUX } = require('./reference');
const { badRequest, notFound, conflict } = require('./errors');

const NOM = 'athletes.json';
const MAX_NOM = 60;
const MAX_ATHLETES = 200;

class AthleteService {
  constructor(depot, nom = NOM) {
    this.depot = depot;
    this.nom = nom;
    this.athletes = ATHLETES_INITIAUX.map((a) => ({ ...a, actif: true }));
  }

  async charger() {
    const brut = await this.depot.lire(this.nom);
    if (!brut) return this;                       // jamais modifiée : liste de départ

    const texte = brut.toString('utf8').trim();
    if (!texte) return this;
    let contenu;
    try {
      contenu = JSON.parse(texte);
    } catch (erreur) {
      throw new Error(`La liste des athlètes est illisible : ${erreur.message}`);
    }
    if (Array.isArray(contenu?.athletes)) this.athletes = contenu.athletes;
    return this;
  }

  /** Les athlètes à qui l'on peut s'inscrire. */
  liste({ inactifs = false } = {}) {
    return this.athletes.filter((a) => inactifs || a.actif !== false);
  }

  /** Retrouve un athlète, actif ou non : les archives doivent rester lisibles. */
  trouver(id) {
    const cherche = String(id ?? '').trim();
    return this.athletes.find((a) => a.id === cherche);
  }

  /** Comme trouver(), mais refuse un athlète retiré de l'équipe. */
  trouverActif(id) {
    const athlete = this.trouver(id);
    return athlete && athlete.actif !== false ? athlete : undefined;
  }

  async ajouter(payload) {
    const nom = texte(payload && payload.nom, 'nom');
    if (this.athletes.length >= MAX_ATHLETES) {
      throw conflict(`L'équipe ne peut pas dépasser ${MAX_ATHLETES} athlètes.`);
    }
    if (this.athletes.some((a) => a.nom.toLowerCase() === nom.toLowerCase())) {
      throw conflict(`« ${nom} » fait déjà partie de l'équipe.`);
    }

    const athlete = { id: identifiant(nom, this.athletes), nom, actif: true };
    return this.remplacer([...this.athletes, athlete], athlete);
  }

  async modifier(id, payload) {
    const existant = this.mustFind(id);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      throw badRequest('Le corps de la requête doit être un objet JSON.');
    }

    const change = { ...existant };
    if (payload.nom !== undefined) {
      const nom = texte(payload.nom, 'nom');
      const double = this.athletes.some((a) => a.id !== id && a.nom.toLowerCase() === nom.toLowerCase());
      if (double) throw conflict(`« ${nom} » fait déjà partie de l'équipe.`);
      change.nom = nom;
    }
    if (payload.actif !== undefined) {
      if (typeof payload.actif !== 'boolean') throw badRequest('Le champ « actif » doit être vrai ou faux.');
      change.actif = payload.actif;
    }
    if (change.nom === existant.nom && change.actif === existant.actif) {
      throw badRequest('Aucun changement demandé.');
    }

    return this.remplacer(this.athletes.map((a) => (a.id === id ? change : a)), change);
  }

  /** Sort l'athlète de l'équipe sans effacer son passé. */
  async retirer(id) {
    const existant = this.mustFind(id);
    if (existant.actif === false) return existant;
    return this.modifier(id, { actif: false });
  }

  mustFind(id) {
    const athlete = this.trouver(id);
    if (!athlete) throw notFound(`Aucun athlète « ${id} » dans l'équipe.`);
    return athlete;
  }

  /** Persiste la liste entière, puis l'adopte — comme pour les séances. */
  async remplacer(athletes, resultat) {
    const document = `${JSON.stringify({ athletes }, null, 2)}\n`;
    await this.depot.ecrire(this.nom, Buffer.from(document), 'application/json');
    this.athletes = athletes;
    return resultat;
  }
}

/** « Jean-Luc » devient « jean-luc », et deux homonymes ne se marchent pas dessus. */
function identifiant(nom, existants) {
  const base = nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'athlete';

  let candidat = base;
  let suffixe = 2;
  while (existants.some((a) => a.id === candidat)) candidat = `${base}-${suffixe++}`;
  return candidat;
}

function texte(valeur, champ) {
  if (typeof valeur !== 'string') throw badRequest(`Le champ « ${champ} » doit être une chaîne de caractères.`);
  const propre = valeur.trim().replace(/\s+/g, ' ');
  if (!propre) throw badRequest(`Le champ « ${champ} » ne peut pas être vide.`);
  if (propre.length > MAX_NOM) throw badRequest(`Le champ « ${champ} » dépasse ${MAX_NOM} caractères.`);
  return propre;
}

module.exports = { AthleteService, NOM, MAX_NOM };
