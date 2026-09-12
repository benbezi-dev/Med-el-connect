/* Les notes dictées du coach. Le micro sert à écrire vite : la dictée est
   transcrite dans le navigateur, et seul le texte arrive jusqu'ici. */

const test = require('node:test');
const assert = require('node:assert/strict');
const { preparerNote, corrigerNote, MAX_TRANSCRIPTION, DUREE_MAX } = require('../src/voix');

test('une note dictée ne garde que son texte', async () => {
  const note = preparerNote({ transcription: '  Penser aux plots  ', duree: 7.44 });

  assert.match(note.id, /^voc_/);
  assert.equal(note.transcription, 'Penser aux plots', 'les blancs de bord sont retirés');
  assert.equal(note.duree, 7.4, 'la durée est arrondie au dixième');
  assert.equal(note.source, 'dictee');
  assert.ok(note.createdAt && note.updatedAt);

  // Ce qui a disparu compte autant que ce qui reste : aucun son n'est conservé.
  assert.ok(!('audio' in note));
  assert.ok(!('fichier' in note));
  assert.ok(!('mimeType' in note));
  assert.ok(!('taille' in note));
});

test('la transcription est la note : sans elle, rien à garder', async () => {
  assert.throws(() => preparerNote({ duree: 3 }), /transcription/);
  assert.throws(() => preparerNote({ transcription: '' }), /transcription/);
  assert.throws(() => preparerNote({ transcription: '   \n  ' }), /vide/);
  assert.throws(() => preparerNote({ transcription: 42 }), /transcription/);
  assert.throws(() => preparerNote({ transcription: 'x'.repeat(MAX_TRANSCRIPTION + 1) }), /5000/);
  assert.throws(() => preparerNote(null), /objet JSON/);
  assert.throws(() => preparerNote([]), /objet JSON/);

  // Le maximum lui-même passe.
  assert.equal(preparerNote({ transcription: 'x'.repeat(MAX_TRANSCRIPTION) }).transcription.length, MAX_TRANSCRIPTION);
});

test('la durée reste indicative, et bornée', async () => {
  assert.equal(preparerNote({ transcription: 'Bon' }).duree, null, 'absente quand on a tapé');
  assert.equal(preparerNote({ transcription: 'Bon', duree: null }).duree, null);
  assert.equal(preparerNote({ transcription: 'Bon', duree: 0 }).duree, 0);
  assert.equal(preparerNote({ transcription: 'Bon', duree: DUREE_MAX }).duree, DUREE_MAX);

  assert.throws(() => preparerNote({ transcription: 'Bon', duree: -1 }), /duree/);
  assert.throws(() => preparerNote({ transcription: 'Bon', duree: DUREE_MAX + 1 }), /duree/);
  assert.throws(() => preparerNote({ transcription: 'Bon', duree: 'longtemps' }), /duree/);
});

test('la source dit si le texte a été dicté ou tapé', async () => {
  assert.equal(preparerNote({ transcription: 'Bon' }).source, 'dictee');
  assert.equal(preparerNote({ transcription: 'Bon', source: 'saisie' }).source, 'saisie');
  assert.equal(preparerNote({ transcription: 'Bon', source: 'DICTEE' }).source, 'dictee');
  assert.throws(() => preparerNote({ transcription: 'Bon', source: 'telepathie' }), /dictee/);
});

test('la reconnaissance vocale se trompe : une note se corrige', async () => {
  const note = preparerNote({ transcription: 'Penser aux plots', duree: 6 });

  const corrigee = corrigerNote(note, { transcription: 'Penser aux plots et aux haies', source: 'saisie' });
  assert.equal(corrigee.id, note.id, 'la même note');
  assert.equal(corrigee.createdAt, note.createdAt, 'créée au même moment');
  assert.equal(corrigee.transcription, 'Penser aux plots et aux haies');
  assert.equal(corrigee.source, 'saisie');
  assert.equal(corrigee.duree, null, 'une correction au clavier prive la durée de sens');
  assert.ok(corrigee.updatedAt >= note.updatedAt);

  // Une nouvelle dictée, elle, garde sa durée.
  const redictee = corrigerNote(note, { transcription: 'Autre chose', duree: 3.2 });
  assert.equal(redictee.duree, 3.2);
  assert.equal(redictee.source, 'dictee');

  // Et une correction vide est refusée comme à la création.
  assert.throws(() => corrigerNote(note, { transcription: '  ' }), /vide/);
});
