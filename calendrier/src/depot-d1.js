/* Dépôt D1 — le stockage SQL d'un Worker Cloudflare.

   Même interface que les autres dépôts (lire / ecrire / supprimer / decrire),
   posée sur une base D1. Une seule table, qui imite un système de fichiers :
   un chemin, un contenu, une version.

   Pourquoi la version : un Worker recharge tout à chaque requête et réécrit
   le document entier. Deux écritures simultanées liraient donc la même
   version, et la seconde écraserait la première — un compte rendu perdu sans
   bruit. L'écriture est donc conditionnée à la version lue : si quelqu'un est
   passé entre-temps, elle est refusée en 409 plutôt que d'effacer son
   travail, et la page — qui recharge après chaque enregistrement —
   représente l'état à jour.

   D1 plafonne une valeur à quelques mégaoctets. Cela ne gêne pas ici : les
   notes dictées ne sont que du texte, et aucun son n'est conservé. */

const { segments } = require('./depot-base');
const { conflict } = require('./errors');

const TABLE = 'documents';
const CREATION = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  chemin TEXT PRIMARY KEY,
  contenu BLOB NOT NULL,
  type TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  modifie_le TEXT NOT NULL
)`;

class DepotD1 {
  /**
   * @param {object} base le binding D1 du Worker
   * @param {{prefixe?: string}} options préfixe commun, si la base est partagée
   */
  constructor(base, { prefixe = '' } = {}) {
    this.base = base;
    this.prefixe = prefixe.replace(/^\/+|\/+$/g, '');
    this.versions = new Map(); // chemin -> version lue
    this.tablePrete = false;
  }

  cle(chemin) {
    const parts = segments(chemin);
    return this.prefixe ? `${this.prefixe}/${parts.join('/')}` : parts.join('/');
  }

  /** Crée la table à la première rencontre, puis n'y revient plus. */
  async preparer() {
    if (this.tablePrete) return;
    await this.base.prepare(CREATION).run();
    this.tablePrete = true;
  }

  /**
   * Exécute, et ne crée la table que si elle manquait vraiment : le cas normal
   * ne paie donc aucun aller-retour supplémentaire.
   */
  async avecTable(action) {
    try {
      return await action();
    } catch (erreur) {
      if (!/no such table/i.test(String(erreur && erreur.message))) throw erreur;
      this.tablePrete = false;
      await this.preparer();
      return action();
    }
  }

  async lire(chemin) {
    const cle = this.cle(chemin);
    const ligne = await this.avecTable(() =>
      this.base.prepare(`SELECT contenu, version FROM ${TABLE} WHERE chemin = ?`).bind(cle).first()
    );

    if (!ligne) {
      // Absent : on le note, pour n'écrire que si personne ne l'a créé entre-temps.
      this.versions.set(cle, 0);
      return null;
    }
    this.versions.set(cle, ligne.version);
    return enBuffer(ligne.contenu);
  }

  async ecrire(chemin, bytes, type) {
    const cle = this.cle(chemin);
    const contenu = enArrayBuffer(bytes);
    const maintenant = new Date().toISOString();
    const attendue = this.versions.get(cle);

    await this.preparer();

    // Chemin jamais lu dans cette requête : on écrit sans condition. C'est le
    // cas des créations dont l'identifiant est neuf et unique.
    if (attendue === undefined) {
      await this.base
        .prepare(
          `INSERT INTO ${TABLE} (chemin, contenu, type, version, modifie_le) VALUES (?, ?, ?, 1, ?)
           ON CONFLICT(chemin) DO UPDATE SET contenu = excluded.contenu, type = excluded.type,
             version = ${TABLE}.version + 1, modifie_le = excluded.modifie_le`
        )
        .bind(cle, contenu, type ?? null, maintenant)
        .run();
      this.versions.delete(cle);
      return;
    }

    const resultat =
      attendue === 0
        ? // On l'a lu absent : il ne doit toujours pas exister.
          await this.base
            .prepare(
              `INSERT INTO ${TABLE} (chemin, contenu, type, version, modifie_le)
               SELECT ?, ?, ?, 1, ?
               WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE chemin = ?)`
            )
            .bind(cle, contenu, type ?? null, maintenant, cle)
            .run()
        : await this.base
            .prepare(
              `UPDATE ${TABLE} SET contenu = ?, type = ?, version = version + 1, modifie_le = ?
               WHERE chemin = ? AND version = ?`
            )
            .bind(contenu, type ?? null, maintenant, cle, attendue)
            .run();

    if (!lignesTouchees(resultat)) {
      throw conflict(
        'Quelqu’un a modifié le calendrier pendant votre saisie : rien n’a été écrit. Rechargez et réessayez.',
        { chemin }
      );
    }
    this.versions.set(cle, attendue + 1);
  }

  async supprimer(chemin) {
    const cle = this.cle(chemin);
    await this.avecTable(() => this.base.prepare(`DELETE FROM ${TABLE} WHERE chemin = ?`).bind(cle).run());
    this.versions.delete(cle);
  }

  decrire() {
    return { type: 'd1', emplacement: this.prefixe || null };
  }
}

/** D1 rend un BLOB en ArrayBuffer ; certains pilotes rendent un tableau. */
function enBuffer(valeur) {
  if (valeur === null || valeur === undefined) return null;
  if (typeof valeur === 'string') return Buffer.from(valeur, 'utf8');
  return Buffer.from(valeur instanceof ArrayBuffer ? new Uint8Array(valeur) : valeur);
}

function enArrayBuffer(bytes) {
  const vue = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return vue.buffer.slice(vue.byteOffset, vue.byteOffset + vue.byteLength);
}

function lignesTouchees(resultat) {
  const meta = resultat && resultat.meta;
  // `changes` est la réponse de D1 ; les autres noms couvrent les variantes.
  const nombre = meta ? meta.changes ?? meta.rows_written ?? meta.changed_db : undefined;
  return nombre === undefined ? true : Number(nombre) > 0;
}

module.exports = { DepotD1, TABLE, CREATION };
