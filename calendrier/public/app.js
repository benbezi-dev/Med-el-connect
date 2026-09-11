/* Présentation 7 jours du calendrier, branchée sur l'API /api.

   Le DOM est construit nœud par nœud (textContent) plutôt qu'en innerHTML :
   les intitulés et noms d'encadrants viennent de l'API et ne doivent jamais
   pouvoir injecter du balisage. */
(function () {
  'use strict';

  // ?api=https://mon-serveur/api permet d'héberger la page et l'API séparément.
  var API = new URLSearchParams(location.search).get('api') || './api';

  var etat = { start: new URLSearchParams(location.search).get('start') || null, calendrier: null, edition: null };

  var els = {
    periode: document.getElementById('periode'),
    alerte: document.getElementById('alerte'),
    etatTable: document.getElementById('etat'),
    enteteJours: document.getElementById('entete-jours'),
    corps: document.getElementById('corps'),
    legende: document.getElementById('legende'),
    dialogue: document.getElementById('dialogue'),
    formulaire: document.getElementById('formulaire'),
    dialogueTitre: document.getElementById('dialogue-titre'),
    dialogueContexte: document.getElementById('dialogue-contexte'),
    dialogueAlerte: document.getElementById('dialogue-alerte'),
    lieu: document.getElementById('champ-lieu'),
    heure: document.getElementById('champ-heure'),
    titre: document.getElementById('champ-titre'),
    coach: document.getElementById('champ-coach'),
    capacite: document.getElementById('champ-capacite'),
    notes: document.getElementById('champ-notes'),
    supprimer: document.getElementById('supprimer'),
    enregistrer: document.getElementById('enregistrer')
  };

  /* ---------- Appels API ---------- */

  function appeler(chemin, options) {
    var config = options || {};
    return fetch(API + chemin, {
      method: config.method || 'GET',
      headers: config.body ? { 'Content-Type': 'application/json' } : undefined,
      body: config.body ? JSON.stringify(config.body) : undefined
    }).then(function (reponse) {
      return reponse.json().catch(function () { return {}; }).then(function (donnees) {
        if (!reponse.ok) {
          throw new Error((donnees.error && donnees.error.message) || 'Erreur ' + reponse.status);
        }
        return donnees;
      });
    });
  }

  function charger() {
    afficherAlerte(null);
    return appeler('/calendar' + (etat.start ? '?start=' + encodeURIComponent(etat.start) : ''))
      .then(function (calendrier) {
        etat.calendrier = calendrier;
        etat.start = calendrier.start;
        dessiner(calendrier);
      })
      .catch(function (erreur) {
        els.etatTable.textContent = 'Calendrier indisponible.';
        afficherAlerte(erreur.message + ' — le serveur de l’API est-il démarré ?');
      });
  }

  /* ---------- Rendu ---------- */

  function dessiner(calendrier) {
    els.periode.textContent =
      'Du ' + formaterDate(calendrier.start) + ' au ' + formaterDate(calendrier.end) +
      ' · créneaux ' + calendrier.times.join(' et ') + ' · ' + calendrier.total +
      (calendrier.total > 1 ? ' séances' : ' séance');
    els.etatTable.textContent = '';
    els.etatTable.hidden = true;

    dessinerEntete(calendrier);
    dessinerCorps(calendrier);
    dessinerLegende(calendrier);
  }

  function dessinerEntete(calendrier) {
    vider(els.enteteJours);
    els.enteteJours.appendChild(creer('th', { className: 'col-heure', scope: 'col', textContent: 'Heure' }));

    calendrier.days.forEach(function (jour) {
      var cellule = creer('th', { scope: 'col' });
      if (jour.isToday) cellule.classList.add('aujourdhui');
      else if (jour.isWeekend) cellule.classList.add('weekend');
      cellule.appendChild(creer('span', { className: 'jour', textContent: jour.weekday }));
      cellule.appendChild(creer('span', { className: 'date', textContent: jour.dayLabel }));
      els.enteteJours.appendChild(cellule);
    });
  }

  function dessinerCorps(calendrier) {
    vider(els.corps);

    calendrier.rows.forEach(function (ligne) {
      var tr = creer('tr');
      tr.appendChild(creer('th', { className: 'col-heure', scope: 'row', textContent: ligne.time }));

      ligne.cells.forEach(function (cellule, index) {
        tr.appendChild(dessinerCellule(cellule, calendrier.days[index]));
      });
      els.corps.appendChild(tr);
    });
  }

  function dessinerCellule(cellule, jour) {
    var td = creer('td', { className: 'creneau' });
    if (jour.isPast) td.classList.add('passe');

    cellule.sessions.forEach(function (seance) {
      var bouton = creer('button', { type: 'button', className: 'seance', 'data-lieu': seance.locationId });
      bouton.appendChild(creer('span', {
        className: 'lieu',
        textContent: seance.location ? seance.location.name : seance.locationId
      }));
      if (seance.title) bouton.appendChild(creer('span', { className: 'titre', textContent: seance.title }));
      var places = creer('span', {
        className: 'places' + (seance.placesRestantes === 0 ? ' complet' : ''),
        textContent: seance.placesRestantes === 0
          ? 'Complet'
          : seance.placesRestantes + ' place' + (seance.placesRestantes > 1 ? 's' : '') + ' libres'
      });
      bouton.appendChild(places);
      bouton.addEventListener('click', function () { ouvrirEdition(seance); });
      td.appendChild(bouton);
    });

    if (cellule.complet) {
      td.appendChild(creer('p', { className: 'cellule-vide', textContent: 'Tous les lieux occupés' }));
    } else {
      var ajout = creer('button', {
        type: 'button',
        className: 'ajouter',
        textContent: '+ Ajouter',
        title: 'Ajouter une séance le ' + formaterDate(cellule.date) + ' à ' + cellule.time
      });
      ajout.addEventListener('click', function () { ouvrirCreation(cellule); });
      td.appendChild(ajout);
    }
    return td;
  }

  function dessinerLegende(calendrier) {
    vider(els.legende);
    calendrier.locations.forEach(function (lieu) {
      var item = creer('li', { className: 'puce', 'data-lieu': lieu.id });
      item.appendChild(creer('b', { textContent: lieu.name }));
      item.appendChild(document.createTextNode(' · ' + lieu.city));
      els.legende.appendChild(item);
    });
  }

  /* ---------- Boîte de dialogue ---------- */

  function remplirSelects(lieuxAutorises, lieuChoisi, heureChoisie) {
    vider(els.lieu);
    etat.calendrier.locations.forEach(function (lieu) {
      var libre = !lieuxAutorises || lieuxAutorises.indexOf(lieu.id) !== -1 || lieu.id === lieuChoisi;
      var option = creer('option', { value: lieu.id, textContent: lieu.name + ' (' + lieu.city + ')' });
      option.disabled = !libre;
      if (lieu.id === lieuChoisi) option.selected = true;
      els.lieu.appendChild(option);
    });
    if (!lieuChoisi) {
      var premierLibre = els.lieu.querySelector('option:not([disabled])');
      if (premierLibre) premierLibre.selected = true;
    }

    vider(els.heure);
    etat.calendrier.times.forEach(function (heure) {
      var option = creer('option', { value: heure, textContent: heure });
      if (heure === heureChoisie) option.selected = true;
      els.heure.appendChild(option);
    });
  }

  function ouvrirCreation(cellule) {
    etat.edition = { mode: 'creation', date: cellule.date };
    els.dialogueTitre.textContent = 'Nouvelle séance';
    els.dialogueContexte.textContent = formaterDate(cellule.date, true) + ' à ' + cellule.time;
    remplirSelects(cellule.lieuxLibres, null, cellule.time);
    els.titre.value = '';
    els.coach.value = '';
    els.capacite.value = '20';
    els.notes.value = '';
    els.supprimer.hidden = true;
    ouvrirDialogue();
  }

  function ouvrirEdition(seance) {
    etat.edition = { mode: 'edition', date: seance.date, id: seance.id };
    els.dialogueTitre.textContent = 'Modifier la séance';
    els.dialogueContexte.textContent = formaterDate(seance.date, true) + ' à ' + seance.time;
    // Les lieux déjà pris sur ce créneau sont grisés ; celui de la séance reste choisi.
    remplirSelects(lieuxLibresDe(seance.date, seance.time), seance.locationId, seance.time);
    els.titre.value = seance.title || '';
    els.coach.value = seance.coach || '';
    els.capacite.value = String(seance.capacity);
    els.notes.value = seance.notes || '';
    els.supprimer.hidden = false;
    ouvrirDialogue();
  }

  /** Lieux encore libres sur une cellule de la grille courante. */
  function lieuxLibresDe(date, heure) {
    var ligne = etat.calendrier.rows.filter(function (r) { return r.time === heure; })[0];
    var cellule = ligne && ligne.cells.filter(function (c) { return c.date === date; })[0];
    return cellule ? cellule.lieuxLibres : null;
  }

  function ouvrirDialogue() {
    afficherAlerte(null, els.dialogueAlerte);
    els.dialogue.showModal();
    els.lieu.focus();
  }

  function enregistrer(evenement) {
    evenement.preventDefault();
    var corps = {
      date: etat.edition.date,
      time: els.heure.value,
      locationId: els.lieu.value,
      title: els.titre.value.trim() || 'Entraînement',
      coach: els.coach.value.trim(),
      notes: els.notes.value.trim(),
      capacity: Number(els.capacite.value)
    };

    var requete = etat.edition.mode === 'creation'
      ? appeler('/sessions', { method: 'POST', body: corps })
      : appeler('/sessions/' + etat.edition.id, { method: 'PATCH', body: corps });

    basculerChargement(true);
    requete
      .then(function () { els.dialogue.close(); return charger(); })
      .catch(function (erreur) { afficherAlerte(erreur.message, els.dialogueAlerte); })
      .then(function () { basculerChargement(false); });
  }

  function supprimer() {
    if (!etat.edition || etat.edition.mode !== 'edition') return;
    if (!confirm('Supprimer définitivement cette séance ?')) return;
    basculerChargement(true);
    appeler('/sessions/' + etat.edition.id, { method: 'DELETE' })
      .then(function () { els.dialogue.close(); return charger(); })
      .catch(function (erreur) { afficherAlerte(erreur.message, els.dialogueAlerte); })
      .then(function () { basculerChargement(false); });
  }

  /* ---------- Utilitaires ---------- */

  function creer(balise, proprietes) {
    var element = document.createElement(balise);
    Object.keys(proprietes || {}).forEach(function (cle) {
      if (cle === 'scope' || cle === 'title' || cle === 'value' || cle.slice(0, 5) === 'data-') {
        element.setAttribute(cle, proprietes[cle]);
      } else {
        element[cle] = proprietes[cle];
      }
    });
    return element;
  }

  function vider(element) {
    while (element.firstChild) element.removeChild(element.firstChild);
  }

  function formaterDate(iso, complet) {
    var date = new Date(iso + 'T00:00:00Z');
    return date.toLocaleDateString('fr-FR', {
      timeZone: 'UTC',
      weekday: complet ? 'long' : undefined,
      day: 'numeric',
      month: complet ? 'long' : 'short',
      year: complet ? 'numeric' : undefined
    });
  }

  function afficherAlerte(message, cible) {
    var element = cible || els.alerte;
    element.textContent = message || '';
    element.hidden = !message;
  }

  function basculerChargement(actif) {
    els.enregistrer.disabled = actif;
    els.supprimer.disabled = actif;
  }

  /* ---------- Branchements ---------- */

  document.getElementById('precedent').addEventListener('click', function () {
    etat.start = etat.calendrier ? etat.calendrier.previousStart : null;
    charger();
  });
  document.getElementById('suivant').addEventListener('click', function () {
    etat.start = etat.calendrier ? etat.calendrier.nextStart : null;
    charger();
  });
  document.getElementById('aujourdhui').addEventListener('click', function () {
    etat.start = null;
    charger();
  });
  document.getElementById('annuler').addEventListener('click', function () { els.dialogue.close(); });
  els.supprimer.addEventListener('click', supprimer);
  els.formulaire.addEventListener('submit', enregistrer);

  charger();
})();
