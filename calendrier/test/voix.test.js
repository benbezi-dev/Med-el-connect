const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VoiceStore } = require('../src/voix');
const { DepotMemoire } = require('../src/stockage');
const { DepotFichier } = require('../src/depot-fichier');

const SON = Buffer.from('un petit bout de son');
const base64 = SON.toString('base64');

function dossierTemporaire(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'voix-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

function depotLocal(t) {
  return new DepotFichier(dossierTemporaire(t));
}

async function attendreErreur(fn, status) {
  try {
    await fn();
  } catch (error) {
    assert.equal(error.status, status, `attendu ${status}, reçu ${error.status} (${error.message})`);
    return error;
  }
  assert.fail(`aucune erreur levée (attendu ${status})`);
}

test('le son est écrit sur disque et relu à l’identique', async (t) => {
  const dossier = dossierTemporaire(t);
  const store = new VoiceStore(new DepotFichier(dossier));

  const note = await store.enregistrer('ses_1', { audio: base64, mimeType: 'audio/webm;codecs=opus', duree: 4.27 });
  assert.match(note.id, /^voc_/);
  assert.equal(note.mimeType, 'audio/webm', 'le codec est retiré du type');
  assert.equal(note.fichier, `${note.id}.webm`);
  assert.equal(note.taille, SON.length);
  assert.equal(note.duree, 4.3, 'la durée est arrondie au dixième');

  assert.deepEqual(await store.lire('ses_1', note), SON);
  assert.deepEqual(
    fs.readdirSync(path.join(dossier, 'notes-vocales', 'ses_1')),
    [note.fichier],
    'aucun fichier temporaire'
  );

  await store.supprimer('ses_1', note);
  await attendreErreur(() => store.lire('ses_1', note), 404);
});

test('les formats acceptés couvrent ce que produisent les navigateurs', async (t) => {
  const store = new VoiceStore(depotLocal(t));
  for (const [mimeType, extension] of Object.entries({
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav'
  })) {
    assert.ok((await store.enregistrer('ses_1', { audio: base64, mimeType })).fichier.endsWith(extension));
  }
  // Sans type déclaré, on suppose du webm (Chrome, Firefox).
  assert.equal((await store.enregistrer('ses_1', { audio: base64 })).mimeType, 'audio/webm');
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, mimeType: 'audio/aiff' }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, mimeType: 'video/mp4' }), 400);
});

test('une data URL est acceptée telle que la produit le navigateur', async (t) => {
  const store = new VoiceStore(depotLocal(t));
  const note = await store.enregistrer('ses_1', { audio: `data:audio/webm;base64,${base64}`, mimeType: 'audio/webm' });
  assert.deepEqual(await store.lire('ses_1', note), SON);
});

test('les payloads invalides sont refusés en 400', async (t) => {
  const store = new VoiceStore(depotLocal(t));
  await attendreErreur(() => store.enregistrer('ses_1', {}), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: '' }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: '!!!' }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', null), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, duree: -1 }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, duree: 99999 }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, transcription: 42 }), 400);
  await attendreErreur(() => store.enregistrer('ses_1', { audio: base64, transcription: 'x'.repeat(5001) }), 400);

  // 5 Mo maximum de son décodé.
  const tropGros = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
  await attendreErreur(() => store.enregistrer('ses_1', { audio: tropGros }), 400);
});

test('un identifiant piégé ne peut pas sortir du dossier', async (t) => {
  const store = new VoiceStore(depotLocal(t));
  await attendreErreur(() => store.lire('ses_1', { fichier: '../evasion.webm' }), 400);
  await attendreErreur(() => store.lire('../..', { fichier: 'a.webm' }), 400);
  await attendreErreur(() => store.supprimer('ses_1/../..', { fichier: 'a.webm' }), 400);
});

test('sans dépôt, le son reste en mémoire', async () => {
  const store = new VoiceStore(null);
  const note = await store.enregistrer('ses_1', { audio: base64 });
  assert.deepEqual(await store.lire('ses_1', note), SON);
  await store.supprimer('ses_1', note);
  await attendreErreur(() => store.lire('ses_1', note), 404);
});

test('le son suit le dépôt : mêmes chemins en mémoire et sur disque', async (t) => {
  const memoire = new DepotMemoire();
  const note = await new VoiceStore(memoire).enregistrer('ses_1', { audio: base64 });
  assert.deepEqual([...memoire.fichiers.keys()], [`notes-vocales/ses_1/${note.fichier}`]);
});
