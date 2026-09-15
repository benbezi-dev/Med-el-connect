const test = require('node:test');
const assert = require('node:assert/strict');
const { AthleteService } = require('../src/athletes');
const { DepotMemoire } = require('../src/depot-base');

async function equipe(depot = new DepotMemoire()) {
  return { service: await new AthleteService(depot).charger(), depot };
}

async function attendreErreur(fn, status) {
  try {
    await fn();
  } catch (erreur) {
    assert.equal(erreur.status, status, `attendu ${status}, reçu ${erreur.status} (${erreur.message})`);
    return erreur;
  }
  assert.fail(`aucune erreur levée (attendu ${status})`);
}

test('l’équipe de départ est là sans rien avoir écrit', async () => {
  const { service, depot } = await equipe();
  assert.deepEqual(service.liste().map((a) => a.nom), [
    'Yvon', 'Kaila', 'Autumn', 'Scarlett', 'Elliot', 'Alex L', 'Ludo', 'Zoe', 'Melina'
  ]);
  assert.equal(depot.fichiers.size, 0, 'tant qu’on n’y touche pas, rien n’est enregistré');
});

test('le coach ajoute un athlète, et l’identifiant se déduit du nom', async () => {
  const { service, depot } = await equipe();

  const ajoute = await service.ajouter({ nom: '  Amélie Rousseau  ' });
  assert.deepEqual(ajoute, { id: 'amelie-rousseau', nom: 'Amélie Rousseau', actif: true });
  assert.equal(service.liste().length, 10);
  assert.deepEqual([...depot.fichiers.keys()], ['athletes.json'], 'la liste est désormais enregistrée');

  // Deux noms voisins ne se marchent pas dessus.
  assert.equal((await service.ajouter({ nom: 'Jean-Luc' })).id, 'jean-luc');
  assert.equal((await service.ajouter({ nom: 'jean luc!' })).id, 'jean-luc-2');

  await attendreErreur(() => service.ajouter({ nom: '   ' }), 400);
  await attendreErreur(() => service.ajouter({ nom: 42 }), 400);
  await attendreErreur(() => service.ajouter({ nom: 'x'.repeat(61) }), 400);
  await attendreErreur(() => service.ajouter({ nom: 'KAILA' }), 409);   // déjà dans l'équipe
});

test('la liste survit au redémarrage', async () => {
  const depot = new DepotMemoire();
  const { service } = await equipe(depot);
  await service.ajouter({ nom: 'Nadia' });

  const relue = (await equipe(depot)).service;
  assert.equal(relue.liste().length, 10);
  assert.equal(relue.trouver('nadia').nom, 'Nadia');
});

test('renommer garde l’identifiant, donc les inscriptions passées', async () => {
  const { service } = await equipe();
  const modifie = await service.modifier('zoe', { nom: 'Zoé Martin' });
  assert.deepEqual(modifie, { id: 'zoe', nom: 'Zoé Martin', actif: true });

  await attendreErreur(() => service.modifier('zoe', { nom: 'Ludo' }), 409);
  await attendreErreur(() => service.modifier('zoe', {}), 400);
  await attendreErreur(() => service.modifier('zoe', { actif: 'oui' }), 400);
  await attendreErreur(() => service.modifier('inconnu', { nom: 'X' }), 404);
});

test('retirer un athlète le sort des listes sans effacer son passé', async () => {
  const { service } = await equipe();

  const retire = await service.retirer('yvon');
  assert.equal(retire.actif, false);
  assert.equal(service.liste().length, 8, 'plus proposé à l’inscription');
  assert.equal(service.liste({ inactifs: true }).length, 9);
  assert.equal(service.trouver('yvon').nom, 'Yvon', 'son nom reste lisible');
  assert.equal(service.trouverActif('yvon'), undefined);

  // Retirer deux fois ne change rien ; le réintégrer le remet dans la liste.
  assert.equal((await service.retirer('yvon')).actif, false);
  assert.equal((await service.modifier('yvon', { actif: true })).actif, true);
  assert.equal(service.liste().length, 9);
});

test('un athlète retiré ne peut plus s’inscrire, mais ses mots gardent son nom', async () => {
  const { Store } = require('../src/store');
  const { SessionService } = require('../src/sessions');
  const depot = new DepotMemoire();
  const { service: athletes } = await equipe(depot);
  const sessions = new SessionService(await new Store(depot).charger(), athletes);

  const seance = await sessions.create({ date: '2026-09-14', time: '10:30', locationId: 'valbonne-hill' });
  await sessions.inscrire(seance.id, 'elliot');
  await sessions.ajouterMessage(seance.id, { athleteId: 'elliot', texte: 'Présent' });

  await athletes.retirer('elliot');

  const apres = sessions.get(seance.id);
  assert.deepEqual(apres.inscrits, [{ id: 'elliot', nom: 'Elliot' }], 'son inscription reste lisible');
  assert.equal(apres.messages[0].athlete.nom, 'Elliot');

  // Mais il ne peut plus rien ajouter.
  const autre = await sessions.create({ date: '2026-09-15', time: '10:30', locationId: 'valbonne-hill' });
  await attendreErreur(() => sessions.inscrire(autre.id, 'elliot'), 400);
  await attendreErreur(() => sessions.ajouterMessage(autre.id, { athleteId: 'elliot', texte: 'Coucou' }), 400);
});
