/* Les athlètes du groupe.

   Chacun a une couleur, qui sert à repérer ses notes d'un coup d'œil dans le
   suivi du coach. La couleur ne porte jamais seule l'information : le nom et
   les initiales accompagnent toujours la pastille.

   Pourquoi cette précaution — neuf couleurs, c'est au-delà de ce qu'un œil
   distingue de façon fiable. Les neuf teintes ci-dessous sont réparties
   régulièrement sur la roue OKLCH puis entrelacées, de sorte que deux athlètes
   voisins dans la liste soient les plus éloignés possible : l'écart le plus
   faible entre voisins vaut ΔE 23,7 en vision normale (seuil 15), mais retombe
   à 5,9 en deutéranopie (cible 8). D'où le nom, toujours écrit.

   Ces couleurs sont volontairement distinctes, par la forme, des couleurs de
   couloir des lieux : un lieu se lit sur le liseré gauche d'une séance, un
   athlète sur une pastille ronde portant ses initiales. */

const ATHLETES = [
  { id: 'eliot', nom: 'Eliot', initiales: 'EL', couleur: '#D16E8F' },
  { id: 'autumn', nom: 'Autumn', initiales: 'AU', couleur: '#02A6AD' },
  { id: 'scarlett', nom: 'Scarlett', initiales: 'SC', couleur: '#D47452' },
  { id: 'zoe', nom: 'Zoé', initiales: 'ZO', couleur: '#359BD9' },
  { id: 'yvon', nom: 'Yvon', initiales: 'YV', couleur: '#BB881A' },
  { id: 'alex-l', nom: 'Alex L', initiales: 'AL', couleur: '#8388E0' },
  { id: 'alex-p', nom: 'Alex P', initiales: 'AP', couleur: '#889D37' },
  { id: 'ludo', nom: 'Ludo', initiales: 'LU', couleur: '#B576C3' },
  { id: 'melina', nom: 'Mélina', initiales: 'MÉ', couleur: '#35AA76' }
];

const ATHLETES_BY_ID = new Map(ATHLETES.map((a) => [a.id, a]));

/** @returns {{id: string, nom: string, initiales: string, couleur: string}|undefined} */
function findAthlete(id) {
  return ATHLETES_BY_ID.get(String(id ?? '').trim());
}

module.exports = { ATHLETES, findAthlete };
