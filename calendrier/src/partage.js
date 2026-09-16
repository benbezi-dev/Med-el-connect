/* Partage de la semaine.

   Un lien envoyé dans une conversation n'est qu'un lien : personne ne sait
   ce qu'il y a derrière avant de l'ouvrir. Ce module produit les deux formes
   qui évitent ce détour :

   — `texteSemaine()` rend la semaine en texte, à coller directement dans un
     message. Là, il n'y a plus de lien du tout : le calendrier *est* le
     message.
   — `pageSemaine()` rend une page autonome (aucun script, aucun appel) munie
     des balises Open Graph. Les messageries lisent ces balises et affichent
     un aperçu : le titre de la semaine et ses séances apparaissent dans la
     conversation, sans que personne n'ait à ouvrir quoi que ce soit.

   Rien ici ne touche aux notes vocales ni aux photos cachées : la page est
   publique, elle ne montre que ce qu'un athlète voit déjà. */

const { dateRange, describeDay, todayISO } = require('./dates');
const { TIMEZONE, DAYS_IN_VIEW } = require('./reference');
const { isValidDateISO } = require('./dates');
const { badRequest } = require('./errors');

const MAX_DESCRIPTION = 280;

/**
 * La semaine telle qu'on la raconte : les jours vides sont écartés, seules
 * les séances qui tiennent encore comptent.
 * @param {import('./sessions').SessionService} sessionService
 */
function resumeSemaine(sessionService, { start, jours = DAYS_IN_VIEW } = {}) {
  if (start !== undefined && start !== null && !isValidDateISO(start)) {
    throw badRequest('Le paramètre « start » doit être une date au format YYYY-MM-DD.');
  }
  const aujourdhui = todayISO(TIMEZONE);
  const debut = start ?? aujourdhui;
  const dates = dateRange(debut, jours);
  const fin = dates[dates.length - 1];

  const parJour = new Map();
  for (const seance of sessionService.list({ from: debut, to: fin })) {
    if (!parJour.has(seance.date)) parJour.set(seance.date, []);
    parJour.get(seance.date).push(projeter(seance));
  }

  const journees = dates
    .map((date) => ({ ...describeDay(date, aujourdhui), seances: parJour.get(date) ?? [] }))
    .filter((journee) => journee.seances.length);

  const total = journees.reduce((somme, journee) => somme + journee.seances.length, 0);
  return { debut, fin, aujourdhui, titre: titreSemaine(debut, fin), journees, total };
}

/** Ce qu'un athlète a le droit de voir, et rien de plus. */
function projeter(seance) {
  return {
    heure: seance.time,
    heureLisible: String(seance.time).replace(':', 'h'),
    lieu: (seance.location && seance.location.name) || seance.locationId,
    titre: seance.title || 'Entraînement',
    statut: seance.statut,
    statutLabel: seance.statutLabel,
    annulee: seance.statut === 'annulee',
    effectuee: seance.statut === 'effectuee',
    photos: (seance.photos ?? []).filter((photo) => photo && photo.visible === true).length
  };
}

const JOUR_COURT = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'short', day: 'numeric' });
const BORNE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', day: 'numeric', month: 'long' });

function titreSemaine(debut, fin) {
  const du = BORNE.format(new Date(`${debut}T00:00:00Z`));
  const au = BORNE.format(new Date(`${fin}T00:00:00Z`));
  return `Entraînements — du ${du} au ${au}`;
}

function jourCourt(date) {
  return JOUR_COURT.format(new Date(`${date}T00:00:00Z`)).replace('.', '');
}

/**
 * La semaine en texte, prête à coller dans un message.
 * @param {string} [adresse] l'adresse du calendrier, ajoutée en dernière ligne.
 */
function texteSemaine(resume, adresse) {
  const lignes = [resume.titre, ''];

  if (!resume.journees.length) {
    lignes.push('Aucune séance cette semaine.');
  } else {
    for (const journee of resume.journees) {
      for (const seance of journee.seances) {
        const bouts = [majuscule(jourCourt(journee.date)), seance.heureLisible, seance.lieu];
        let ligne = bouts.join(' · ');
        if (seance.annulee) ligne += ' — ANNULÉE';
        else if (seance.effectuee) ligne += ' ✓';
        lignes.push(ligne);
      }
    }
  }

  if (adresse) {
    lignes.push('');
    lignes.push(adresse);
  }
  return lignes.join('\n');
}

/** Une ligne compacte pour l'aperçu des messageries : c'est elle qu'on lit sans ouvrir. */
function descriptionSemaine(resume) {
  if (!resume.journees.length) return 'Aucune séance cette semaine.';

  const bouts = [];
  for (const journee of resume.journees) {
    for (const seance of journee.seances) {
      if (seance.annulee) continue;
      bouts.push(`${majuscule(jourCourt(journee.date))} ${seance.heureLisible} ${seance.lieu}`);
    }
  }
  if (!bouts.length) return 'Toutes les séances de la semaine sont annulées.';

  let texte = '';
  for (const bout of bouts) {
    const essai = texte ? `${texte} · ${bout}` : bout;
    // On coupe sur une séance entière : une adresse tronquée en plein milieu
    // d'un nom de stade ne renseigne personne.
    if (essai.length > MAX_DESCRIPTION) return `${texte} · …`;
    texte = essai;
  }
  return texte;
}

function majuscule(texte) {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

function echapper(texte) {
  return String(texte).replace(/[&<>"']/g, (caractere) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[caractere]);
}

/**
 * La page autonome : aucun script, aucun appel, tout est déjà dans le HTML.
 * Elle s'affiche instantanément et se laisse lire par les messageries.
 *
 * @param {{url?: string, application?: string}} options `url` est l'adresse
 *   canonique de la page (pour les balises Open Graph), `application` celle
 *   du calendrier complet.
 */
function pageSemaine(resume, { url, application } = {}) {
  const description = descriptionSemaine(resume);
  const corps = resume.journees.length
    ? resume.journees.map(bloc).join('\n')
    : '<p class="vide">Aucune séance cette semaine.</p>';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${echapper(resume.titre)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0C0D0F">
<meta name="description" content="${echapper(description)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${echapper(resume.titre)}">
<meta property="og:description" content="${echapper(description)}">
<meta property="og:locale" content="fr_FR">
${url ? `<meta property="og:url" content="${echapper(url)}">\n<link rel="canonical" href="${echapper(url)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${echapper(resume.titre)}">
<meta name="twitter:description" content="${echapper(description)}">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0C0D0F;color:#F4F3F1;font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
padding:max(16px,env(safe-area-inset-top,0px)) 16px max(16px,env(safe-area-inset-bottom,0px))}
.feuille{max-width:640px;margin:0 auto}
h1{font-size:1.35rem;line-height:1.25;letter-spacing:-0.01em}
.sous{color:#9B9EA3;font-size:.9rem;margin-top:4px}
.jour{margin-top:20px;border:1px solid #26292E;border-radius:10px;background:#141619;overflow:hidden}
.jour.aujourdhui{border-color:#E4462A}
.jour h2{font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:#9B9EA3;
padding:10px 14px;background:#1C1F23;font-weight:700}
.jour.aujourdhui h2{color:#E4462A}
.seance{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;padding:11px 14px;border-top:1px solid #26292E}
.jour h2 + .seance{border-top:0}
.heure{font-weight:700;font-variant-numeric:tabular-nums;min-width:62px}
.lieu{font-weight:600}
.quoi{color:#9B9EA3;font-size:.9rem;flex-basis:100%}
.marque{font-size:.72rem;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.marque.annulee{color:#E4462A}
.marque.faite{color:#5F9E6B}
.vide{margin-top:20px;color:#9B9EA3}
.pied{margin-top:24px;padding-top:16px;border-top:1px solid #26292E;font-size:.9rem}
.pied a{color:#E4462A;font-weight:700}
</style>
</head>
<body>
<main class="feuille">
<h1>${echapper(resume.titre)}</h1>
<p class="sous">${resume.total} séance${resume.total > 1 ? 's' : ''} · Côte d’Azur</p>
${corps}
${application ? `<p class="pied"><a href="${echapper(application)}">Ouvrir le calendrier — s’inscrire, laisser un mot, voir les photos</a></p>` : ''}
</main>
</body>
</html>`;
}

function bloc(journee) {
  const seances = journee.seances.map((seance) => {
    const marque = seance.annulee
      ? '<span class="marque annulee">Annulée</span>'
      : seance.effectuee
        ? '<span class="marque faite">Effectuée</span>'
        : '';
    const extra = [];
    if (seance.titre && seance.titre !== 'Entraînement') extra.push(echapper(seance.titre));
    if (seance.photos) extra.push(`${seance.photos} photo${seance.photos > 1 ? 's' : ''}`);
    return `<div class="seance"><span class="heure">${echapper(seance.heureLisible)}</span>` +
      `<span class="lieu">${echapper(seance.lieu)}</span>${marque}` +
      (extra.length ? `<span class="quoi">${extra.join(' · ')}</span>` : '') +
      '</div>';
  }).join('');

  const titre = majuscule(`${journee.weekday} ${journee.dayLabel}`);
  return `<section class="jour${journee.isToday ? ' aujourdhui' : ''}">` +
    `<h2>${echapper(titre)}${journee.isToday ? ' · aujourd’hui' : ''}</h2>${seances}</section>`;
}

module.exports = { resumeSemaine, texteSemaine, descriptionSemaine, pageSemaine, MAX_DESCRIPTION };
