const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { VoiceStore } = require('../src/voix');

const SON = Buffer.from('un petit bout de son');
const base64 = SON.toString('base64');

function dossierTemporaire(t) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'voix-'));
  t.after(() => fs.rmSync(dossier, { recursive: true, force: true }));
  return dossier;
}

function attendreErreur(fn, status) {
  try {
    fn();
  } catch (error) {
    assert.equal(error.status, status, `attendu ${status}, reçu ${error.status} (${error.message})`);
    return error;
  }
  assert.fail(`aucune erreur levée (attendu ${status})`);
}

test('le son est écrit sur disque et relu à l’identique', (t) => {
  const dossier = dossierTemporaire(t);
  const store = new VoiceStore(dossier);

  const note = store.enregistrer('ses_1', { audio: base64, mimeType: 'audio/webm;codecs=opus', duree: 4.27 });
  assert.match(note.id, /^voc_/);
  assert.equal(note.mimeType, 'audio/webm', 'le codec est retiré du type');
  assert.equal(note.fichier, `${note.id}.webm`);
  assert.equal(note.taille, SON.length);
  assert.equal(note.duree, 4.3, 'la durée est arrondie au dixième');

  assert.deepEqual(store.lire('ses_1', note), SON);
  assert.deepEqual(fs.readdirSync(path.join(dossier, 'ses_1')), [note.fichier], 'aucun fichier temporaire');

  store.supprimer('ses_1', note);
  attendreErreur(() => store.lire('ses_1', note), 404);
});

test('les formats acceptés couvrent ce que produisent les navigateurs', (t) => {
  const store = new VoiceStore(dossierTemporaire(t));
  for (const [mimeType, extension] of Object.entries({
    'audio/webm': '.webm',
    'audio/ogg': '.ogg',
    'audio/mp4': '.m4a',
    'audio/mpeg': '.mp3',
    'audio/wav': '.wav'
  })) {
    assert.ok(store.enregistrer('ses_1', { audio: base64, mimeType }).fichier.endsWith(extension));
  }
  // Sans type déclaré, on suppose du webm (Chrome, Firefox).
  assert.equal(store.enregistrer('ses_1', { audio: base64 }).mimeType, 'audio/webm');
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, mimeType: 'audio/aiff' }), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, mimeType: 'video/mp4' }), 400);
});

test('une data URL est acceptée telle que la produit le navigateur', (t) => {
  const store = new VoiceStore(dossierTemporaire(t));
  const note = store.enregistrer('ses_1', { audio: `data:audio/webm;base64,${base64}`, mimeType: 'audio/webm' });
  assert.deepEqual(store.lire('ses_1', note), SON);
});

test('les payloads invalides sont refusés en 400', (t) => {
  const store = new VoiceStore(dossierTemporaire(t));
  attendreErreur(() => store.enregistrer('ses_1', {}), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: '' }), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: '!!!' }), 400);
  attendreErreur(() => store.enregistrer('ses_1', null), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, duree: -1 }), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, duree: 99999 }), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, transcription: 42 }), 400);
  attendreErreur(() => store.enregistrer('ses_1', { audio: base64, transcription: 'x'.repeat(5001) }), 400);

  // 5 Mo maximum de son décodé.
  const tropGros = Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64');
  attendreErreur(() => store.enregistrer('ses_1', { audio: tropGros }), 400);
});

test('un identifiant piégé ne peut pas sortir du dossier', (t) => {
  const store = new VoiceStore(dossierTemporaire(t));
  const note = { fichier: '../evasion.webm', mimeType: 'audio/webm' };
  attendreErreur(() => store.lire('ses_1', note), 400);
  attendreErreur(() => store.lire('../..', { fichier: 'a.webm' }), 400);
});

test('sans dossier, le son reste en mémoire', () => {
  const store = new VoiceStore(null);
  const note = store.enregistrer('ses_1', { audio: base64 });
  assert.deepEqual(store.lire('ses_1', note), SON);
  store.supprimer('ses_1', note);
  attendreErreur(() => store.lire('ses_1', note), 404);
});
