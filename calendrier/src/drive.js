/* Dépôt Google Drive.

   Même interface que les dépôts locaux (lire / ecrire / supprimer), mais les
   fichiers vivent dans un dossier Drive : `sessions.json` à la racine du
   dossier, les notes vocales dans `notes-vocales/<séance>/`.

   Tout passe par fetch et l'API Drive v3 — aucune bibliothèque à installer. */

const { FournisseurJeton } = require('./google-jeton');
const { segments } = require('./depot-base');

const BASE = 'https://www.googleapis.com/drive/v3';
const BASE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TYPE_DOSSIER = 'application/vnd.google-apps.folder';

class DepotDrive {
  /**
   * @param {{configuration: object, dossier?: string, dossierId?: string|null,
   *          jeton?: object, base?: string, baseUpload?: string, requete?: Function}} options
   */
  constructor({
    configuration,
    dossier = 'Calendrier entraînements',
    dossierId = null,
    jeton,
    base = BASE,
    baseUpload = BASE_UPLOAD,
    requete = fetch
  }) {
    this.jeton = jeton ?? new FournisseurJeton(configuration, { requete });
    this.nomDossier = dossier;
    this.dossierId = dossierId;
    this.base = base;
    this.baseUpload = baseUpload;
    this.requete = requete;
    this.dossiers = new Map();   // chemin -> id, pour ne pas re-chercher à chaque écriture
    this.fichiers = new Map();   // chemin complet -> id
  }

  async lire(chemin) {
    const id = await this.idDuFichier(chemin);
    if (!id) return null;

    const reponse = await this.appeler(`${this.base}/files/${id}?alt=media&supportsAllDrives=true`);
    if (reponse.status === 404) {
      this.fichiers.delete(cle(chemin));
      return null;
    }
    await this.verifier(reponse, `lecture de ${chemin}`);
    return Buffer.from(await reponse.arrayBuffer());
  }

  async ecrire(chemin, bytes, mimeType = 'application/octet-stream') {
    const parts = segments(chemin);
    const nom = parts[parts.length - 1];
    const contenu = Buffer.from(bytes);
    const existant = await this.idDuFichier(chemin);

    if (existant) {
      const reponse = await this.appeler(
        `${this.baseUpload}/files/${existant}?uploadType=media&supportsAllDrives=true`,
        { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: contenu }
      );
      if (reponse.status !== 404) {
        await this.verifier(reponse, `écriture de ${chemin}`);
        return;
      }
      // Le fichier a disparu de Drive entre-temps : on le recrée.
      this.fichiers.delete(cle(chemin));
    }

    const parent = await this.idDuDossier(parts.slice(0, -1));
    const reponse = await this.appeler(
      `${this.baseUpload}/files?uploadType=multipart&supportsAllDrives=true&fields=id`,
      multipart({ name: nom, parents: [parent] }, contenu, mimeType)
    );
    await this.verifier(reponse, `création de ${chemin}`);
    const cree = await reponse.json();
    this.fichiers.set(cle(chemin), cree.id);
  }

  async supprimer(chemin) {
    const id = await this.idDuFichier(chemin);
    if (!id) return;
    const reponse = await this.appeler(`${this.base}/files/${id}?supportsAllDrives=true`, { method: 'DELETE' });
    if (reponse.status !== 404) await this.verifier(reponse, `suppression de ${chemin}`);
    this.fichiers.delete(cle(chemin));
  }

  decrire() {
    return {
      type: 'drive',
      emplacement: this.dossierId ? `dossier ${this.dossierId}` : this.nomDossier
    };
  }

  /* ---------- résolution des identifiants Drive ---------- */

  async idDuFichier(chemin) {
    const parts = segments(chemin);
    const memorise = this.fichiers.get(cle(chemin));
    if (memorise) return memorise;

    const parent = await this.idDuDossier(parts.slice(0, -1));
    const id = await this.chercher(parent, parts[parts.length - 1], null);
    if (id) this.fichiers.set(cle(chemin), id);
    return id;
  }

  /** Identifiant du dossier, créé au besoin, pour un chemin de dossiers. */
  async idDuDossier(parts) {
    let courant = await this.racine();
    let chemin = '';
    for (const nom of parts) {
      chemin = chemin ? `${chemin}/${nom}` : nom;
      const memorise = this.dossiers.get(chemin);
      if (memorise) {
        courant = memorise;
        continue;
      }
      courant = (await this.chercher(courant, nom, TYPE_DOSSIER)) ?? (await this.creerDossier(courant, nom));
      this.dossiers.set(chemin, courant);
    }
    return courant;
  }

  async racine() {
    if (this.dossierId) return this.dossierId;
    if (this.racineId) return this.racineId;

    // Avec le scope « drive.file », la recherche ne voit que les fichiers de
    // l'application : elle retrouve donc le dossier qu'elle a elle-même créé.
    this.racineId =
      (await this.chercher('root', this.nomDossier, TYPE_DOSSIER)) ??
      (await this.creerDossier('root', this.nomDossier));
    return this.racineId;
  }

  async chercher(parentId, nom, mimeType) {
    const filtres = [
      `name = '${echapper(nom)}'`,
      `'${echapper(parentId)}' in parents`,
      'trashed = false',
      ...(mimeType ? [`mimeType = '${mimeType}'`] : [])
    ];
    const url =
      `${this.base}/files?q=${encodeURIComponent(filtres.join(' and '))}` +
      '&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true';

    const reponse = await this.appeler(url);
    await this.verifier(reponse, `recherche de ${nom}`);
    const donnees = await reponse.json();
    return donnees.files && donnees.files.length ? donnees.files[0].id : null;
  }

  async creerDossier(parentId, nom) {
    const reponse = await this.appeler(`${this.base}/files?fields=id&supportsAllDrives=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: nom, mimeType: TYPE_DOSSIER, parents: [parentId] })
    });
    await this.verifier(reponse, `création du dossier ${nom}`);
    return (await reponse.json()).id;
  }

  /* ---------- appel HTTP ---------- */

  /** Ajoute le jeton ; un 401 déclenche un renouvellement et un seul nouvel essai. */
  async appeler(url, options = {}, reessai = true) {
    const jeton = await this.jeton.jeton();
    const reponse = await this.requete(url, {
      ...options,
      headers: { ...(options.headers ?? {}), Authorization: `Bearer ${jeton}` }
    });

    if (reponse.status === 401 && reessai) {
      this.jeton.cache = null;
      return this.appeler(url, options, false);
    }
    return reponse;
  }

  async verifier(reponse, action) {
    if (reponse.ok) return;
    const details = await reponse.text().catch(() => '');
    throw new Error(`Google Drive a refusé la ${action} (${reponse.status}) : ${details.slice(0, 300)}`);
  }
}

/** Corps multipart « métadonnées + contenu » attendu par l'upload Drive. */
function multipart(metadonnees, contenu, mimeType) {
  const frontiere = `calendrier-${Math.random().toString(36).slice(2)}`;
  const corps = Buffer.concat([
    Buffer.from(
      `--${frontiere}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${JSON.stringify(metadonnees)}\r\n--${frontiere}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    contenu,
    Buffer.from(`\r\n--${frontiere}--\r\n`)
  ]);
  return { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${frontiere}` }, body: corps };
}

/** Les apostrophes doivent être échappées dans une requête Drive. */
function echapper(valeur) {
  return String(valeur).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function cle(chemin) {
  return segments(chemin).join('/');
}

module.exports = { DepotDrive, BASE, BASE_UPLOAD, TYPE_DOSSIER };
