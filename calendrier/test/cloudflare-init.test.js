'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extraireEspaces } = require('../outils/cloudflare-init.js');

const ESPACES = [
  { id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', title: 'calendrier-entrainements-CALENDRIER' },
  { id: 'ffffffffffffffffffffffffffffffff', title: 'autre-projet-CACHE' }
];

test('lit la liste des espaces KV renvoyée par wrangler', () => {
  assert.deepEqual(extraireEspaces(JSON.stringify(ESPACES, null, 2)), ESPACES);
});

test('ignore un avertissement qui contient lui-même des crochets', () => {
  // Le piège : « [WARNING] » arrive avant le tableau, et un identifiant pris
  // là-dedans ferait créer un second espace KV — donc un calendrier vide.
  const sortie = `▲ [WARNING] Using vars defined in .dev.vars\n${JSON.stringify(ESPACES)}`;
  assert.deepEqual(extraireEspaces(sortie), ESPACES);
});

test('ignore aussi une bannière affichée après le tableau', () => {
  const sortie = `${JSON.stringify(ESPACES)}\nUpdate available [4.0.0] -> [4.1.0]`;
  assert.deepEqual(extraireEspaces(sortie), ESPACES);
});

test('supporte des crochets et des guillemets dans un titre', () => {
  const espaces = [{ id: 'a'.repeat(32), title: 'mon [projet] "test"' }];
  assert.deepEqual(extraireEspaces(JSON.stringify(espaces)), espaces);
});

test('une liste vide reste une liste vide, pas une absence de réponse', () => {
  // Distinction vitale : vide => on crée l'espace ; illisible => on s'arrête.
  assert.deepEqual(extraireEspaces('▲ [WARNING] rien\n[]'), []);
});

test('une sortie sans JSON ne donne rien plutôt qu’une liste vide', () => {
  for (const sortie of ['✘ [ERROR] A request to the Cloudflare API failed.', '', 'wrangler: command not found']) {
    assert.equal(extraireEspaces(sortie), undefined, `sortie : ${sortie}`);
  }
});

test('un objet JSON seul n’est pas confondu avec une liste', () => {
  assert.equal(extraireEspaces('{"error":"unauthorized"}'), undefined);
});
