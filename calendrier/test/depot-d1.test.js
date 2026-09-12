/* Le dépôt D1, exercé contre du vrai SQLite : le SQL est réellement exécuté,
   pas imité. Rien ne sort d'ici — aucun compte Cloudflare n'est joint. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { DepotD1 } = require('../src/depot-d1');

/** Imite l'API du binding D1 (prepare / bind / first / run) sur SQLite. */
class FausseD1 {
  constructor() {
    this.base = new DatabaseSync(':memory:');
    this.requetes = 0;
  }

  prepare(sql) {
    const fausse = this;
    let liens = [];
    const lanceur = {
      bind(...args) {
        liens = args;
        return lanceur;
      },
      async first() {
        fausse.requetes += 1;
        return fausse.base.prepare(sql).get(...normaliser(liens)) ?? null;
      },
      async run() {
        fausse.requetes += 1;
        const resultat = fausse.base.prepare(sql).run(...normaliser(liens));
        return { success: true, meta: { changes: Number(resultat.changes) } };
      }
    };
    return lanceur;
  }

  /** Ce que voit quelqu'un d'autre, en dehors du dépôt testé. */
  contenu(chemin) {
    const ligne = this.base.prepare('SELECT contenu, version FROM documents WHERE chemin = ?').get(chemin);
    return ligne ? { texte: Buffer.from(ligne.contenu).toString('utf8'), version: ligne.version } : null;
  }
}

/* D1 accepte un ArrayBuffer ; node:sqlite veut une vue. Le pilote réel fait
   la même conversion — c'est de la plomberie, pas du comportement testé. */
function normaliser(liens) {
  return liens.map((valeur) => (valeur instanceof ArrayBuffer ? new Uint8Array(valeur) : valeur));
}

test('un document s’écrit, se relit à l’identique et se supprime', async () => {
  const base = new FausseD1();
  const depot = new DepotD1(base);

  assert.equal(await depot.lire('sessions.json'), null, 'rien au départ');

  const contenu = Buffer.from('{"sessions":[]}\n', 'utf8');
  await depot.ecrire('sessions.json', contenu, 'application/json');

  const relu = await depot.lire('sessions.json');
  assert.deepEqual(relu, contenu, 'les octets reviennent tels quels');
  assert.equal(base.contenu('sessions.json').version, 1);

  await depot.supprimer('sessions.json');
  assert.equal(await depot.lire('sessions.json'), null);
});

test('la table se crée d’elle-même, et une seule fois', async () => {
  const base = new FausseD1();
  const depot = new DepotD1(base);

  // Première lecture sur une base vide : la table n'existe pas encore.
  assert.equal(await depot.lire('sessions.json'), null);
  assert.ok(base.base.prepare("SELECT name FROM sqlite_master WHERE name = 'documents'").get());

  const apres = base.requetes;
  await depot.lire('sessions.json');
  assert.equal(base.requetes - apres, 1, 'le cas normal ne paie pas de création supplémentaire');
});

test('une écriture concurrente est refusée, jamais écrasée', async () => {
  const base = new FausseD1();
  const premier = new DepotD1(base);
  await premier.ecrire('sessions.json', Buffer.from('version A'), 'application/json');

  // Deux requêtes lisent la même version…
  const lecteurA = new DepotD1(base);
  const lecteurB = new DepotD1(base);
  await lecteurA.lire('sessions.json');
  await lecteurB.lire('sessions.json');

  // …la première écrit…
  await lecteurA.ecrire('sessions.json', Buffer.from('version B'), 'application/json');
  assert.equal(base.contenu('sessions.json').texte, 'version B');

  // …et la seconde est refusée plutôt que d'effacer le travail de la première.
  await assert.rejects(
    () => lecteurB.ecrire('sessions.json', Buffer.from('version C'), 'application/json'),
    (erreur) => {
      assert.equal(erreur.status, 409);
      assert.match(erreur.message, /Rechargez et réessayez/);
      return true;
    }
  );
  assert.equal(base.contenu('sessions.json').texte, 'version B', 'rien n’a été écrasé');
});

test('deux créations simultanées : la seconde est refusée', async () => {
  const base = new FausseD1();
  const premier = new DepotD1(base);
  const second = new DepotD1(base);

  // Les deux constatent l'absence du document…
  assert.equal(await premier.lire('sessions.json'), null);
  assert.equal(await second.lire('sessions.json'), null);

  await premier.ecrire('sessions.json', Buffer.from('créé par A'), 'application/json');
  await assert.rejects(
    () => second.ecrire('sessions.json', Buffer.from('créé par B'), 'application/json'),
    (erreur) => erreur.status === 409
  );
  assert.equal(base.contenu('sessions.json').texte, 'créé par A');
});

test('un chemin jamais lu s’écrit sans condition', async () => {
  const base = new FausseD1();
  const depot = new DepotD1(base);

  // Cas d'une création dont l'identifiant est neuf : aucune lecture préalable,
  // donc aucune version à confronter.
  await depot.ecrire('notes/ses_1/a.txt', Buffer.from('un'), 'text/plain');
  await depot.ecrire('notes/ses_1/a.txt', Buffer.from('deux'), 'text/plain');
  assert.equal(base.contenu('notes/ses_1/a.txt').texte, 'deux');
  assert.equal(base.contenu('notes/ses_1/a.txt').version, 2, 'la version suit quand même');
});

test('les chemins douteux sont refusés, et le préfixe est respecté', async () => {
  const base = new FausseD1();
  const depot = new DepotD1(base);

  await assert.rejects(() => depot.lire('../secrets'), /Chemin de stockage invalide/);
  await assert.rejects(() => depot.ecrire('a/../../b', Buffer.from('x')), /Chemin de stockage invalide/);
  await assert.rejects(() => depot.lire(''), /Chemin de stockage invalide/);

  const prefixe = new DepotD1(base, { prefixe: '/equipe-2026/' });
  await prefixe.ecrire('sessions.json', Buffer.from('rangé'), 'application/json');
  assert.equal(base.contenu('equipe-2026/sessions.json').texte, 'rangé');
  assert.equal(base.contenu('sessions.json'), null, 'et pas à la racine');
  assert.deepEqual(prefixe.decrire(), { type: 'd1', emplacement: 'equipe-2026' });
});
