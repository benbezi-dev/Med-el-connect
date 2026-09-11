const test = require('node:test');
const assert = require('node:assert/strict');
const { isValidDateISO, todayISO, addDays, daysBetween, dateRange, describeDay } = require('../src/dates');

test('isValidDateISO refuse les formats et les jours inexistants', () => {
  assert.equal(isValidDateISO('2026-09-11'), true);
  assert.equal(isValidDateISO('2026-02-29'), false); // 2026 n'est pas bissextile
  assert.equal(isValidDateISO('2024-02-29'), true);
  assert.equal(isValidDateISO('2026-13-01'), false);
  assert.equal(isValidDateISO('11/09/2026'), false);
  assert.equal(isValidDateISO(''), false);
  assert.equal(isValidDateISO(undefined), false);
});

test('addDays traverse un changement d’heure sans décaler le jour', () => {
  // Fin d'heure d'été en Europe le 25 octobre 2026.
  assert.equal(addDays('2026-10-24', 3), '2026-10-27');
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('daysBetween compte les jours entiers, signe compris', () => {
  assert.equal(daysBetween('2026-09-11', '2026-09-18'), 7);
  assert.equal(daysBetween('2026-09-11', '2026-09-11'), 0);
  assert.equal(daysBetween('2026-09-11', '2026-09-08'), -3);
});

test('dateRange produit 7 jours consécutifs', () => {
  assert.deepEqual(dateRange('2026-12-29', 7), [
    '2026-12-29', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04'
  ]);
});

test('describeDay renvoie les libellés français attendus', () => {
  const jour = describeDay('2026-09-12', '2026-09-11');
  assert.equal(jour.weekday, 'samedi');
  assert.equal(jour.shortLabel, 'sam. 12 sept.');
  assert.equal(jour.dayLabel, '12 sept.', 'l’en-tête de colonne ne répète pas le jour de la semaine');
  assert.equal(jour.isWeekend, true);
  assert.equal(jour.isToday, false);
  assert.equal(jour.isPast, false);
  assert.equal(describeDay('2026-09-10', '2026-09-11').isPast, true);
  assert.equal(describeDay('2026-09-11', '2026-09-11').isToday, true);
});

test('todayISO suit le fuseau demandé', () => {
  // 23h00 UTC le 11 = déjà le 12 à Paris (UTC+2 en septembre).
  const instant = new Date('2026-09-11T23:00:00Z');
  assert.equal(todayISO('Europe/Paris', instant), '2026-09-12');
  assert.equal(todayISO('UTC', instant), '2026-09-11');
});
