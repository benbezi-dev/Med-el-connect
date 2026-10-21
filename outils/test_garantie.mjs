// Vérifie etatGarantie() telle qu'écrite dans source/app.html :  node outils/test_garantie.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../source/app.html', import.meta.url), 'utf8');
const corps = src.match(/  etatGarantie\(debut, ans, auj=new Date\(\)\)\{([\s\S]*?)\n  \}/)[1];
const etat = new Function('debut', 'ans', 'auj', corps);
const auj = new Date(2026, 9, 21);                       // 21 octobre 2026
assert.equal(etat('2022-03', 5, auj).etat, 'sous');      // fin mars 2027
assert.equal(etat('2022-03', 5, auj).moisRestants, 5);
assert.equal(etat('2021-10', 5, auj).etat, 'limite');    // se termine ce mois-ci
assert.equal(etat('2021-09', 5, auj).etat, 'finie');
assert.equal(etat('2024-11', 2, auj).etat, 'sous');      // accessoire : fin nov. 2026
assert.equal(etat('2024-10', 2, auj).etat, 'limite');
assert.equal(etat('2024-09', 2, auj).finAn, 2026);
console.log('etatGarantie : ok');
