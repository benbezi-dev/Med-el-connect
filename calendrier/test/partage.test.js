/* La semaine envoyée : le texte à coller et la page que lisent les messageries.

   Deux exigences tiennent tout ce fichier : l'aperçu doit renseigner sans
   qu'on ouvre quoi que ce soit, et la page étant publique, rien de privé —
   note vocale ou photo cachée — ne doit y transparaître. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createApp } = require('../src/server');
const { resumeSemaine, texteSemaine, descriptionSemaine, pageSemaine, MAX_DESCRIPTION } = require('../src/partage');

const CLE_COACH = 'cle-de-test';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function demarrer() {
  const serveur = http.createServer(await createApp({ dataFile: null, cleCoach: CLE_COACH }));
  await new Promise((resolve) => serveur.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${serveur.address().port}`;

  const appeler = async (chemin, options = {}) => {
    const corps = options.body ? JSON.stringify(options.body) : undefined;
    const entetes = {};
    if (corps !== undefined) entetes['Content-Type'] = 'application/json';
    if (options.coach) entetes['X-Cle-Coach'] = CLE_COACH;
    const reponse = await fetch(base + chemin, {
      method: options.method ?? 'GET',
      headers: Object.keys(entetes).length ? entetes : undefined,
      body: corps
    });
    const texte = await reponse.text();
    return {
      status: reponse.status,
      headers: reponse.headers,
      texte,
      body: reponse.headers.get('content-type')?.includes('json') ? JSON.parse(texte) : texte
    };
  };

  const creer = (champs) => appeler('/api/sessions', { method: 'POST', coach: true, body: champs });
  return { appeler, creer, base, fermer: () => new Promise((resolve) => serveur.close(resolve)) };
}

const LUNDI = '2026-09-14';

test('le texte donne la semaine séance par séance, sans lien obligatoire', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  await creer({ date: LUNDI, time: '18:00', locationId: 'antibes-fort-carre-stade' });
  await creer({ date: '2026-09-16', time: '10:30', locationId: 'valbonne-stadium' });

  const { body } = await appeler(`/api/semaine?start=${LUNDI}`);
  const lignes = body.texte.split('\n');

  assert.match(lignes[0], /^Entraînements — du 14 septembre au 20 septembre$/);
  assert.ok(body.texte.includes('Lun 14 · 18h00 · Antibes Fort Carré Stade'), body.texte);
  assert.ok(body.texte.includes('Mer 16 · 10h30 · Valbonne Stadium'), body.texte);
  assert.equal(body.total, 2);
});

test('une séance annulée est marquée, une séance faite aussi', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  const { body: une } = await creer({ date: LUNDI, time: '18:00', locationId: 'antibes-fort-carre-stade' });
  const { body: deux } = await creer({ date: LUNDI, time: '18:30', locationId: 'grasse-stadium' });
  await appeler(`/api/sessions/${une.session.id}`, { method: 'PATCH', coach: true, body: { statut: 'annulee' } });
  await appeler(`/api/sessions/${deux.session.id}`, { method: 'PATCH', coach: true, body: { statut: 'effectuee' } });

  const { body } = await appeler(`/api/semaine?start=${LUNDI}`);
  assert.ok(body.texte.includes('— ANNULÉE'), body.texte);
  assert.ok(body.texte.includes('✓'), body.texte);

  // L'aperçu annonce ce qui a lieu : une séance annulée n'y a pas sa place.
  assert.ok(!body.description.includes('Antibes'), body.description);
  assert.ok(body.description.includes('Grasse Stadium'), body.description);
});

test('l’adresse donnée est ajoutée en dernière ligne', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  await creer({ date: LUNDI, time: '18:00', locationId: 'valbonne-hill' });
  const { body } = await appeler(`/api/semaine?start=${LUNDI}&adresse=${encodeURIComponent('https://exemple.test/semaine')}`);
  assert.equal(body.texte.split('\n').pop(), 'https://exemple.test/semaine');
});

test('GET /semaine rend une page lisible sans script ni appel', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  await creer({ date: LUNDI, time: '18:00', locationId: 'antibes-fort-carre-stade', title: 'Fractionné court' });

  const { status, headers, texte } = await appeler(`/semaine?start=${LUNDI}`);
  assert.equal(status, 200);
  assert.match(headers.get('content-type'), /text\/html/);
  assert.ok(!texte.includes('<script'), 'aucun script : la page s’affiche telle quelle');
  assert.ok(texte.includes('Antibes Fort Carré Stade'), 'le lieu est déjà dans le HTML');
  assert.ok(texte.includes('18h00'));
  assert.ok(texte.includes('Fractionné court'));
});

test('les balises d’aperçu portent la semaine, pas un titre générique', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  await creer({ date: LUNDI, time: '18:00', locationId: 'grasse-stadium' });
  const { texte } = await appeler(`/semaine?start=${LUNDI}`);

  const titre = /<meta property="og:title" content="([^"]+)"/.exec(texte);
  const description = /<meta property="og:description" content="([^"]+)"/.exec(texte);
  assert.ok(titre, 'og:title manquant');
  assert.match(titre[1], /Entraînements — du 14 septembre/);
  assert.ok(description, 'og:description manquant');
  assert.match(description[1], /Lun 14 18h00 Grasse Stadium/);
});

test('la page publique ne laisse filtrer ni note vocale ni photo cachée', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  const { body: creee } = await creer({ date: LUNDI, time: '18:00', locationId: 'valbonne-stadium' });
  const id = creee.session.id;

  await appeler(`/api/sessions/${id}/notes-vocales`, {
    method: 'POST',
    coach: true,
    body: { audio: Buffer.from('son').toString('base64'), mimeType: 'audio/webm', transcription: 'SECRET VOCAL' }
  });
  const { body: cachee } = await appeler(`/api/sessions/${id}/photos`, {
    method: 'POST', coach: true,
    body: { image: PNG.toString('base64'), mimeType: 'image/png', legende: 'SECRET PHOTO' }
  });
  const { body: montree } = await appeler(`/api/sessions/${id}/photos`, {
    method: 'POST', coach: true,
    body: { image: PNG.toString('base64'), mimeType: 'image/png', legende: 'Le groupe' }
  });
  await appeler(`/api/sessions/${id}/photos/${montree.photo.id}`, {
    method: 'PATCH', coach: true, body: { visible: true }
  });

  const { texte } = await appeler(`/semaine?start=${LUNDI}`);
  assert.ok(!texte.includes('SECRET VOCAL'), 'la transcription n’a rien à faire là');
  assert.ok(!texte.includes('SECRET PHOTO'), 'la légende d’une photo cachée non plus');
  assert.ok(!texte.includes(cachee.photo.id), 'ni son identifiant');
  assert.ok(texte.includes('1 photo'), 'seule la photo publiée est comptée');
});

test('les intitulés ne peuvent pas injecter de balisage dans la page', async (t) => {
  const { appeler, creer, fermer } = await demarrer();
  t.after(fermer);

  await creer({
    date: LUNDI,
    time: '18:00',
    locationId: 'valbonne-city-workout',
    title: '<script>alert(1)</script>"bis"'
  });

  const { texte } = await appeler(`/semaine?start=${LUNDI}`);
  assert.ok(!texte.includes('<script>alert(1)</script>'), 'le balisage est échappé');
  assert.ok(texte.includes('&lt;script&gt;'), 'et bien présent, mais inerte');
});

test('une semaine vide le dit plutôt que de mentir', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);

  const { body } = await appeler(`/api/semaine?start=${LUNDI}`);
  assert.equal(body.total, 0);
  assert.ok(body.texte.includes('Aucune séance cette semaine.'));
  assert.equal(body.description, 'Aucune séance cette semaine.');

  const { texte } = await appeler(`/semaine?start=${LUNDI}`);
  assert.ok(texte.includes('Aucune séance cette semaine.'));
});

test('une date de départ invalide est refusée', async (t) => {
  const { appeler, fermer } = await demarrer();
  t.after(fermer);
  assert.equal((await appeler('/api/semaine?start=pas-une-date')).status, 400);
});

test('l’aperçu se coupe sur une séance entière, jamais au milieu d’un nom', () => {
  const journees = Array.from({ length: 12 }, (_, index) => ({
    date: `2026-09-${14 + index}`,
    seances: [{ heureLisible: '18h00', lieu: 'Antibes Fort Carré Stade', annulee: false, effectuee: false }]
  }));
  const description = descriptionSemaine({ journees, total: 12 });

  assert.ok(description.length <= MAX_DESCRIPTION + 3, `longueur ${description.length}`);
  assert.ok(description.endsWith('…'), description);
  assert.ok(!/Antibes Fort Car$|Antibes Fo$/.test(description), 'aucun nom tronqué');
});

test('resumeSemaine écarte les jours sans séance', () => {
  const service = {
    list: () => [
      {
        date: '2026-09-16', time: '18:00', statut: 'prevue', statutLabel: 'Prévue',
        title: 'Entraînement', location: { name: 'Valbonne Stadium' }, locationId: 'valbonne-stadium', photos: []
      }
    ]
  };
  const resume = resumeSemaine(service, { start: LUNDI });
  assert.equal(resume.journees.length, 1, 'un seul jour porte une séance');
  assert.equal(resume.journees[0].date, '2026-09-16');
  assert.equal(resume.total, 1);

  assert.ok(texteSemaine(resume).includes('Mer 16 · 18h00 · Valbonne Stadium'));
  assert.ok(pageSemaine(resume).includes('Valbonne Stadium'));
});
