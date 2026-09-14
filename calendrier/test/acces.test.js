const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resoudreCle, estCoach, masquerNotesVocales, FICHIER_CLE } = require('../src/acces');
const { resoudreCleLocale } = require('../src/cle-fichier');

function requete(entetes) {
  return { headers: entetes || {} };
}
function lien(query) {
  return { searchParams: new URLSearchParams(query || '') };
}

test('la clé explicite l’emporte, sinon l’environnement', () => {
  assert.deepEqual(resoudreCle({ cleCoach: 'abc' }), { cle: 'abc', origine: 'explicite' });

  process.env.CALENDAR_COACH_KEY = 'depuis-env';
  try {
    assert.deepEqual(resoudreCle({}), { cle: 'depuis-env', origine: 'env' });
  } finally {
    delete process.env.CALENDAR_COACH_KEY;
  }

  // Sans rien, une clé est tirée — sauf si l'appelant veut aller voir ailleurs.
  assert.equal(resoudreCle({}).origine, 'memoire');
  assert.equal(resoudreCle({ tirerSiAbsente: false }), null);
});

test('sans clé configurée, elle est tirée au sort puis relue du fichier', (t) => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'cle-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  const dataFile = path.join(dossier, 'sessions.json');

  const premiere = resoudreCleLocale({ dataFile });
  assert.equal(premiere.origine, 'generee');
  assert.ok(premiere.cle.length >= 24, 'la clé tirée est longue');

  const fichier = path.join(dossier, FICHIER_CLE);
  assert.equal(fs.readFileSync(fichier, 'utf8').trim(), premiere.cle);
  assert.equal(fs.statSync(fichier).mode & 0o777, 0o600, 'le fichier n’est lisible que par son propriétaire');

  // Au redémarrage, la même clé est reprise : le coach ne la ressaisit pas.
  const seconde = resoudreCleLocale({ dataFile });
  assert.deepEqual(seconde, { cle: premiere.cle, origine: 'fichier' });
});

test('estCoach n’accepte que la bonne clé', () => {
  const cle = 'la-bonne-cle';
  assert.equal(estCoach(requete({ 'x-cle-coach': cle }), lien(), cle), true);
  assert.equal(estCoach(requete(), lien('cle=' + cle), cle), true, 'le paramètre d’URL dépanne en ligne de commande');

  assert.equal(estCoach(requete(), lien(), cle), false);
  assert.equal(estCoach(requete({ 'x-cle-coach': '' }), lien(), cle), false);
  assert.equal(estCoach(requete({ 'x-cle-coach': 'la-bonne-cl' }), lien(), cle), false, 'clé trop courte');
  assert.equal(estCoach(requete({ 'x-cle-coach': 'la-bonne-clé' }), lien(), cle), false);
  assert.equal(estCoach(requete({ 'x-cle-coach': cle }), lien(), ''), false, 'sans clé configurée, personne n’est coach');

  // L'en-tête fourni, même faux, n'est pas rattrapé par le paramètre d'URL.
  assert.equal(estCoach(requete({ 'x-cle-coach': 'faux' }), lien('cle=' + cle), cle), false);
});

test('masquerNotesVocales vide les notes partout et ne touche à rien d’autre', () => {
  const grille = {
    total: 1,
    rows: [{ time: '18:00', cells: [{ sessions: [{ id: 'a', title: 'Piste', notesVocales: [{ id: 'v1' }] }] }] }],
    session: { id: 'b', notesVocales: [{ id: 'v2', transcription: 'secret' }], notes: 'texte visible' }
  };
  const masquee = masquerNotesVocales(grille);

  assert.deepEqual(masquee.rows[0].cells[0].sessions[0].notesVocales, []);
  assert.deepEqual(masquee.session.notesVocales, []);
  assert.equal(masquee.session.notes, 'texte visible', 'les notes écrites restent visibles');
  assert.equal(masquee.rows[0].cells[0].sessions[0].title, 'Piste');
  assert.equal(masquee.total, 1);

  // L'original n'est pas modifié : le stockage garde ses notes.
  assert.equal(grille.session.notesVocales.length, 1);
  assert.notEqual(masquee.session, grille.session, 'la copie est profonde');
});
