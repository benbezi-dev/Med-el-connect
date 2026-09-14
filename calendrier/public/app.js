/* Présentation 7 jours du calendrier, branchée sur l'API /api.

   Le DOM est construit nœud par nœud (textContent) plutôt qu'en innerHTML :
   les intitulés, noms d'encadrants et transcriptions viennent de l'API et ne
   doivent jamais pouvoir injecter du balisage. */
(function () {
  'use strict';

  // ?api=https://mon-serveur/api permet d'héberger la page et l'API séparément.
  var API = new URLSearchParams(location.search).get('api') || './api';

  var CLE_STOCKAGE = 'calendrier.cleCoach';
  var ETROIT = window.matchMedia('(max-width: 700px)');

  var etat = {
    start: new URLSearchParams(location.search).get('start') || null,
    calendrier: null,
    edition: null,
    noteEnAttente: null,   // note vocale enregistrée avant que la séance n'existe
    anneeChargee: false,
    cle: lireCle(),        // clé coach : les notes vocales n'existent qu'avec elle
    coach: false,
    athletes: [],          // l'équipe, chargée une fois
    auteur: lireAuteur(),  // le dernier athlète à avoir écrit, sur cet appareil
    sons: []               // URLs blob des sons chargés, à révoquer
  };

  /** localStorage peut être bloqué (navigation privée) : on n'en dépend jamais. */
  function lireCle() {
    try {
      return localStorage.getItem(CLE_STOCKAGE) || '';
    } catch (erreur) {
      return '';
    }
  }

  /** Le nom choisi pour écrire est retenu : on ne le resélectionne pas à chaque fois. */
  function lireAuteur() {
    try {
      return localStorage.getItem('calendrier.auteur') || '';
    } catch (erreur) {
      return '';
    }
  }

  function ecrireAuteur(id) {
    etat.auteur = id;
    try {
      if (id) localStorage.setItem('calendrier.auteur', id);
    } catch (erreur) { /* sans mémoire, tant pis */ }
  }

  function ecrireCle(cle) {
    etat.cle = cle;
    try {
      if (cle) localStorage.setItem(CLE_STOCKAGE, cle);
      else localStorage.removeItem(CLE_STOCKAGE);
    } catch (erreur) { /* la clé ne vaudra que pour cette page */ }
  }

  var els = {};
  [
    'periode', 'alerte', 'etat', 'entete-jours', 'corps', 'legende', 'calendrier', 'jours',
    'panneau-annee', 'annee-contenu',
    'dialogue', 'formulaire', 'dialogue-titre', 'dialogue-contexte', 'dialogue-alerte',
    'champ-statut', 'champ-lieu', 'champ-heure', 'champ-titre', 'champ-coach', 'champ-capacite', 'champ-notes',
    'enregistrer-voix', 'vocal-etat', 'vocal-aide', 'vocal-liste',
    'archiver', 'enregistrer', 'annuler', 'precedent', 'suivant', 'aujourdhui',
    'vocal', 'bouton-coach', 'dialogue-coach', 'formulaire-coach', 'coach-alerte', 'champ-cle',
    'oublier-cle', 'coach-annuler',
    'equipe', 'equipe-liste', 'mots-liste', 'champ-auteur', 'champ-mot', 'envoyer-mot'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  /* ---------- Appels API ---------- */

  function entetes(avecCorps) {
    var resultat = {};
    if (avecCorps) resultat['Content-Type'] = 'application/json';
    if (etat.cle) resultat['X-Cle-Coach'] = etat.cle;
    return resultat;
  }

  function appeler(chemin, options) {
    var config = options || {};
    return fetch(API + chemin, {
      method: config.method || 'GET',
      headers: entetes(Boolean(config.body)),
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

  function chargerEquipe() {
    if (etat.athletes.length) return Promise.resolve();
    return appeler('/athletes')
      .then(function (reponse) { etat.athletes = reponse.athletes; })
      .catch(function () { etat.athletes = []; });
  }

  function charger() {
    afficherAlerte(null);
    chargerEquipe();
    return appeler('/calendar' + (etat.start ? '?start=' + encodeURIComponent(etat.start) : ''))
      .then(function (calendrier) {
        etat.calendrier = calendrier;
        etat.start = calendrier.start;
        etat.coach = Boolean(calendrier.coach);
        majBoutonCoach();
        dessiner(calendrier);
        if (etat.cle && !etat.coach) afficherAlerte('Clé coach refusée : les notes vocales restent masquées.');
        if (etat.anneeChargee) chargerAnnee();
      })
      .catch(function (erreur) {
        els.etat.textContent = 'Calendrier indisponible.';
        afficherAlerte(erreur.message + ' — le serveur de l’API est-il démarré ?');
      });
  }

  /* ---------- Rendu de la semaine ---------- */

  function dessiner(calendrier) {
    var t = calendrier.totaux;
    els.periode.textContent =
      'Du ' + formaterDate(calendrier.start) + ' au ' + formaterDate(calendrier.end) +
      ' · créneaux ' + enumerer(calendrier.times) +
      ' · ' + pluriel(t.total, 'séance') +
      ' (' + pluriel(t.effectuee, 'effectuée') + ', ' + pluriel(t.prevue, 'prévue') + ')';
    els.etat.textContent = '';
    els.etat.hidden = true;

    // Sept colonnes ne tiennent pas sur un téléphone : on déroule les jours.
    var etroit = ETROIT.matches;
    els.calendrier.hidden = etroit;
    els.jours.hidden = !etroit;

    if (etroit) {
      dessinerJours(calendrier);
    } else {
      dessinerEntete(calendrier);
      dessinerCorps(calendrier);
    }
    dessinerLegende(calendrier);
  }

  /* ---------- Vue téléphone : un bloc par jour ---------- */

  function dessinerJours(calendrier) {
    vider(els.jours);

    calendrier.days.forEach(function (jour, index) {
      var carte = creer('li', { className: 'jour-carte' });
      if (jour.isToday) carte.classList.add('aujourdhui');
      if (jour.isPast) carte.classList.add('passe');

      var entete = creer('div', { className: 'jour-entete' });
      var titre = creer('div');
      titre.appendChild(creer('span', { className: 'jour-nom', textContent: jour.weekday }));
      titre.appendChild(creer('span', { className: 'jour-date', textContent: jour.dayLabel }));
      entete.appendChild(titre);
      if (jour.totaux.total) {
        entete.appendChild(creer('span', {
          className: 'compteur' + (jour.totaux.effectuee ? ' fait' : ''),
          textContent: jour.totaux.effectuee + '/' + jour.totaux.total + (jour.totaux.total > 1 ? ' effectuées' : ' effectuée')
        }));
      }
      carte.appendChild(entete);

      var creneauxLibres = [];
      calendrier.rows.forEach(function (ligne) {
        var cellule = ligne.cells[index];
        if (!cellule.sessions.length) {
          if (!cellule.complet) creneauxLibres.push(cellule);
          return;
        }
        var bloc = creer('div', { className: 'jour-creneau' });
        bloc.appendChild(creer('span', { className: 'jour-heure', textContent: ligne.time }));
        var pile = creer('div', { className: 'jour-seances' });
        cellule.sessions.forEach(function (seance) {
          pile.appendChild(dessinerSeance(seance, calendrier.statuts));
        });
        if (etat.coach && !cellule.complet) {
          var ajout = creer('button', { type: 'button', className: 'ajouter', textContent: '+ Ajouter' });
          ajout.addEventListener('click', function () { ouvrirCreation(cellule); });
          pile.appendChild(ajout);
        }
        bloc.appendChild(pile);
        carte.appendChild(bloc);
      });

      if (!jour.totaux.total) {
        carte.appendChild(creer('p', { className: 'jour-vide', textContent: 'Pas de séance.' }));
      }

      // Le coach ajoute d'un geste sur le créneau voulu.
      if (etat.coach && creneauxLibres.length) {
        var ligneAjout = creer('div', { className: 'jour-ajouts' });
        ligneAjout.appendChild(creer('span', { className: 'jour-ajouts-titre', textContent: 'Ajouter à' }));
        creneauxLibres.forEach(function (cellule) {
          var bouton = creer('button', { type: 'button', className: 'ajouter compact', textContent: '+ ' + cellule.time });
          bouton.addEventListener('click', function () { ouvrirCreation(cellule); });
          ligneAjout.appendChild(bouton);
        });
        carte.appendChild(ligneAjout);
      }

      els.jours.appendChild(carte);
    });
  }

  function dessinerEntete(calendrier) {
    vider(els['entete-jours']);
    els['entete-jours'].appendChild(creer('th', { className: 'col-heure', scope: 'col', textContent: 'Heure' }));

    calendrier.days.forEach(function (jour) {
      var cellule = creer('th', { scope: 'col' });
      if (jour.isToday) cellule.classList.add('aujourdhui');
      else if (jour.isWeekend) cellule.classList.add('weekend');
      cellule.appendChild(creer('span', { className: 'jour', textContent: jour.weekday }));
      cellule.appendChild(creer('span', { className: 'date', textContent: jour.dayLabel }));
      if (jour.totaux.total) {
        cellule.appendChild(creer('span', {
          // Le vert ne s'allume qu'à partir d'une séance faite.
          className: 'compteur' + (jour.totaux.effectuee ? ' fait' : ''),
          textContent: jour.totaux.effectuee + '/' + jour.totaux.total + (jour.totaux.total > 1 ? ' effectuées' : ' effectuée'),
          title: pluriel(jour.totaux.prevue, 'prévue') + ', ' + pluriel(jour.totaux.effectuee, 'effectuée') +
            ', ' + pluriel(jour.totaux.annulee, 'annulée')
        }));
      }
      els['entete-jours'].appendChild(cellule);
    });
  }

  function dessinerCorps(calendrier) {
    vider(els.corps);

    calendrier.rows.forEach(function (ligne) {
      var tr = creer('tr');
      tr.appendChild(creer('th', { className: 'col-heure', scope: 'row', textContent: ligne.time }));
      ligne.cells.forEach(function (cellule, index) {
        tr.appendChild(dessinerCellule(cellule, calendrier.days[index], calendrier.statuts));
      });
      els.corps.appendChild(tr);
    });
  }

  function dessinerCellule(cellule, jour, statuts) {
    var td = creer('td', { className: 'creneau' });
    if (jour.isPast) td.classList.add('passe');

    cellule.sessions.forEach(function (seance) {
      td.appendChild(dessinerSeance(seance, statuts));
    });

    if (!etat.coach) return td;          // un athlète consulte, il n'ajoute pas

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

  function dessinerSeance(seance, statuts) {
    var carte = creer('article', {
      className: 'seance',
      'data-lieu': seance.locationId,
      'data-statut': seance.statut
    });

    var ouvrir = creer('button', { type: 'button', className: 'seance-ouvrir' });
    ouvrir.appendChild(creer('span', {
      className: 'lieu',
      textContent: seance.location ? seance.location.name : seance.locationId
    }));
    if (seance.title) ouvrir.appendChild(creer('span', { className: 'titre', textContent: seance.title }));
    ouvrir.appendChild(creer('span', {
      className: 'places' + (seance.placesRestantes === 0 ? ' complet' : ''),
      textContent: seance.placesRestantes === 0
        ? 'Complet'
        : pluriel(seance.placesRestantes, 'place') + (seance.placesRestantes > 1 ? ' libres' : ' libre')
    }));
    if (seance.inscrits.length || seance.messages.length) {
      var echos = [];
      if (seance.inscrits.length) echos.push(pluriel(seance.inscrits.length, 'inscrit'));
      if (seance.messages.length) echos.push(pluriel(seance.messages.length, 'mot'));
      ouvrir.appendChild(creer('span', { className: 'echo', textContent: echos.join(' · ') }));
    }
    if (seance.notesVocales.length) {
      ouvrir.appendChild(creer('span', {
        className: 'vocal-indicateur',
        textContent: '♪ ' + pluriel(seance.notesVocales.length, 'note vocale', 'notes vocales')
      }));
    }
    ouvrir.addEventListener('click', function () { ouvrirEdition(seance); });
    carte.appendChild(ouvrir);

    // Le menu déroulant : indiquer d'un geste si la séance est faite ou prévue.
    var menu = creer('select', {
      className: 'statut-select',
      title: 'Statut de la séance'
    });
    menu.setAttribute('aria-label', 'Statut de la séance du ' + formaterDate(seance.date) + ' à ' + seance.time);
    menu.disabled = !etat.coach;
    statuts.forEach(function (statut) {
      var option = creer('option', { value: statut.id, textContent: statut.label });
      if (statut.id === seance.statut) option.selected = true;
      menu.appendChild(option);
    });
    menu.addEventListener('change', function () {
      menu.disabled = true;
      appeler('/sessions/' + seance.id, { method: 'PATCH', body: { statut: menu.value } })
        .then(charger)
        .catch(function (erreur) {
          afficherAlerte(erreur.message);
          return charger();
        });
    });
    carte.appendChild(menu);
    return carte;
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

  /* ---------- Vue année (repliée par défaut) ---------- */

  function chargerAnnee() {
    return Promise.all([appeler('/annee'), appeler('/sessions?archivees=true')])
      .then(function (reponses) { dessinerAnnee(reponses[0], reponses[1].sessions); })
      .catch(function (erreur) {
        vider(els['annee-contenu']);
        els['annee-contenu'].appendChild(creer('p', { className: 'etat', textContent: erreur.message }));
      });
  }

  function dessinerAnnee(annee, toutes) {
    var contenu = els['annee-contenu'];
    vider(contenu);

    contenu.appendChild(creer('p', {
      className: 'annee-resume',
      textContent: 'Du ' + formaterDateAnnee(annee.debut) + ' au ' + formaterDateAnnee(annee.fin) + ' · ' +
        pluriel(annee.totaux.total, 'séance') + ' : ' + pluriel(annee.totaux.effectuee, 'effectuée') + ', ' +
        pluriel(annee.totaux.prevue, 'prévue') + ', ' + pluriel(annee.totaux.annulee, 'annulée') + '.'
    }));

    var grille = creer('ul', { className: 'annee-mois' });
    annee.mois.forEach(function (mois) {
      var item = creer('li', { className: 'mois' + (mois.estMoisCourant ? ' courant' : '') });
      item.appendChild(creer('b', { textContent: mois.label }));
      item.appendChild(creer('span', {
        className: 'mois-total',
        textContent: mois.totaux.total ? pluriel(mois.totaux.total, 'séance') : '—'
      }));
      if (mois.totaux.total) {
        item.appendChild(creer('span', {
          className: 'mois-detail',
          textContent: pluriel(mois.totaux.effectuee, 'effectuée') + ' · ' + pluriel(mois.totaux.prevue, 'prévue') +
            (mois.totaux.annulee ? ' · ' + pluriel(mois.totaux.annulee, 'annulée') : '')
        }));
      }
      var aller = creer('button', { type: 'button', className: 'mois-aller', textContent: 'Voir la semaine' });
      aller.addEventListener('click', function () {
        etat.start = mois.jours.length ? mois.jours[0].date : mois.debut;
        charger();
        els['panneau-annee'].open = false;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      item.appendChild(aller);
      grille.appendChild(item);
    });
    contenu.appendChild(grille);

    var archivees = toutes.filter(function (s) { return s.archivee; });
    var bloc = creer('div', { className: 'archives' });
    bloc.appendChild(creer('h3', { textContent: 'Archives (' + archivees.length + ')' }));
    bloc.appendChild(creer('p', {
      className: 'archives-aide',
      textContent: 'Les séances archivées quittent la grille mais restent enregistrées, avec leur historique et leurs notes vocales.'
    }));

    if (archivees.length) {
      var liste = creer('ul', { className: 'archives-liste' });
      archivees.forEach(function (seance) {
        var item = creer('li', { 'data-lieu': seance.locationId });
        item.appendChild(creer('span', {
          textContent: formaterDateAnnee(seance.date) + ' · ' + seance.time + ' · ' +
            (seance.location ? seance.location.name : seance.locationId) + ' — ' + seance.title
        }));
        if (!etat.coach) {
          liste.appendChild(item);
          return;
        }
        var restaurer = creer('button', { type: 'button', textContent: 'Restaurer' });
        restaurer.addEventListener('click', function () {
          restaurer.disabled = true;
          appeler('/sessions/' + seance.id + '/restaurer', { method: 'POST' })
            .then(charger)
            .catch(function (erreur) {
              afficherAlerte(erreur.message);
              restaurer.disabled = false;
            });
        });
        item.appendChild(restaurer);
        liste.appendChild(item);
      });
      bloc.appendChild(liste);
    }
    contenu.appendChild(bloc);
  }

  /* ---------- Boîte de dialogue ---------- */

  function remplirSelects(lieuxAutorises, lieuChoisi, heureChoisie, statutChoisi) {
    vider(els['champ-lieu']);
    etat.calendrier.locations.forEach(function (lieu) {
      var libre = !lieuxAutorises || lieuxAutorises.indexOf(lieu.id) !== -1 || lieu.id === lieuChoisi;
      var option = creer('option', { value: lieu.id, textContent: lieu.name + ' (' + lieu.city + ')' });
      option.disabled = !libre;
      if (lieu.id === lieuChoisi) option.selected = true;
      els['champ-lieu'].appendChild(option);
    });
    if (!lieuChoisi) {
      var premierLibre = els['champ-lieu'].querySelector('option:not([disabled])');
      if (premierLibre) premierLibre.selected = true;
    }

    vider(els['champ-heure']);
    etat.calendrier.times.forEach(function (heure) {
      var option = creer('option', { value: heure, textContent: heure });
      if (heure === heureChoisie) option.selected = true;
      els['champ-heure'].appendChild(option);
    });

    vider(els['champ-statut']);
    etat.calendrier.statuts.forEach(function (statut) {
      var option = creer('option', { value: statut.id, textContent: statut.label });
      if (statut.id === statutChoisi) option.selected = true;
      els['champ-statut'].appendChild(option);
    });
  }

  /** Lieux encore libres sur une cellule de la grille courante. */
  function lieuxLibresDe(date, heure) {
    var ligne = etat.calendrier.rows.filter(function (r) { return r.time === heure; })[0];
    var cellule = ligne && ligne.cells.filter(function (c) { return c.date === date; })[0];
    return cellule ? cellule.lieuxLibres : null;
  }

  function ouvrirCreation(cellule) {
    etat.edition = { mode: 'creation', date: cellule.date, seance: null };
    els['dialogue-titre'].textContent = 'Nouvelle séance';
    els['dialogue-contexte'].textContent = formaterDate(cellule.date, true) + ' à ' + cellule.time;
    remplirSelects(cellule.lieuxLibres, null, cellule.time, 'prevue');
    els['champ-titre'].value = '';
    els['champ-coach'].value = '';
    els['champ-capacite'].value = '20';
    els['champ-notes'].value = '';
    els.archiver.hidden = true;
    ouvrirDialogue();
  }

  function ouvrirEdition(seance) {
    etat.edition = { mode: 'edition', date: seance.date, id: seance.id, seance: seance };
    els['dialogue-titre'].textContent = etat.coach ? 'Modifier la séance' : 'La séance';
    els['dialogue-contexte'].textContent = formaterDate(seance.date, true) + ' à ' + seance.time;
    // Les lieux déjà pris sur ce créneau sont grisés ; celui de la séance reste choisi.
    remplirSelects(lieuxLibresDe(seance.date, seance.time), seance.locationId, seance.time, seance.statut);
    els['champ-titre'].value = seance.title || '';
    els['champ-coach'].value = seance.coach || '';
    els['champ-capacite'].value = String(seance.capacity);
    els['champ-notes'].value = seance.notes || '';
    els.archiver.hidden = !etat.coach;
    ouvrirDialogue();
  }

  /** L'équipe consulte la séance ; seul le coach la modifie. */
  function verrouillerFormulaire() {
    ['champ-statut', 'champ-lieu', 'champ-heure', 'champ-titre', 'champ-coach', 'champ-capacite', 'champ-notes']
      .forEach(function (id) { els[id].disabled = !etat.coach; });
    els.enregistrer.hidden = !etat.coach;
  }

  /** Les lieux disponibles dépendent du créneau : on les recalcule au changement. */
  function majLieuxSelonHeure() {
    if (!etat.edition) return;
    var heure = els['champ-heure'].value;
    var libres = lieuxLibresDe(etat.edition.date, heure) || [];
    var sien = etat.edition.seance && etat.edition.seance.time === heure
      ? etat.edition.seance.locationId
      : null;
    var actuel = els['champ-lieu'].value;
    var garder = (libres.indexOf(actuel) !== -1 || actuel === sien) ? actuel : null;
    remplirSelects(libres, garder, heure, els['champ-statut'].value);
  }

  function ouvrirDialogue() {
    afficherAlerte(null, els['dialogue-alerte']);
    etat.noteEnAttente = null;
    els.vocal.hidden = !etat.coach;   // réservées au coach
    verrouillerFormulaire();
    els['champ-mot'].value = '';
    dessinerEquipe();
    dessinerNotesVocales();
    reinitialiserEnregistreur();
    els.dialogue.showModal();
    els['champ-statut'].focus();
  }

  function enregistrer(evenement) {
    evenement.preventDefault();
    var corps = {
      date: etat.edition.date,
      time: els['champ-heure'].value,
      locationId: els['champ-lieu'].value,
      statut: els['champ-statut'].value,
      title: els['champ-titre'].value.trim() || 'Entraînement',
      coach: els['champ-coach'].value.trim(),
      notes: els['champ-notes'].value.trim(),
      capacity: Number(els['champ-capacite'].value)
    };

    var requete = etat.edition.mode === 'creation'
      ? appeler('/sessions', { method: 'POST', body: corps })
      : appeler('/sessions/' + etat.edition.id, { method: 'PATCH', body: corps });

    basculerChargement(true);
    requete
      .then(function (reponse) { return televerserNoteEnAttente(reponse.session.id); })
      .then(function () { els.dialogue.close(); return charger(); })
      .catch(function (erreur) { afficherAlerte(erreur.message, els['dialogue-alerte']); })
      .then(function () { basculerChargement(false); });
  }

  function archiver() {
    if (!etat.edition || etat.edition.mode !== 'edition') return;
    if (!confirm('Archiver cette séance ? Elle quitte la grille mais reste enregistrée.')) return;
    basculerChargement(true);
    appeler('/sessions/' + etat.edition.id, { method: 'DELETE' })
      .then(function () { els.dialogue.close(); return charger(); })
      .catch(function (erreur) { afficherAlerte(erreur.message, els['dialogue-alerte']); })
      .then(function () { basculerChargement(false); });
  }

  /* ---------- L'équipe : qui vient, et ce qu'elle en dit ---------- */

  function dessinerEquipe() {
    var seance = etat.edition && etat.edition.seance;
    // Une séance qui n'existe pas encore n'a ni inscrits ni messages.
    els.equipe.hidden = !seance;
    if (!seance) return;

    dessinerPresences(seance);
    dessinerMots(seance);
    remplirAuteurs();
  }

  function dessinerPresences(seance) {
    var liste = els['equipe-liste'];
    vider(liste);

    var inscrits = seance.inscrits.map(function (a) { return a.id; });
    var complet = seance.placesRestantes === 0;

    etat.athletes.forEach(function (athlete) {
      var present = inscrits.indexOf(athlete.id) !== -1;
      var item = creer('li');
      var bouton = creer('button', {
        type: 'button',
        className: 'athlete' + (present ? ' present' : ''),
        textContent: athlete.nom,
        title: present ? athlete.nom + ' vient' : 'Inscrire ' + athlete.nom
      });
      bouton.setAttribute('aria-pressed', present ? 'true' : 'false');
      bouton.disabled = (!present && complet) || seance.statut === 'annulee';

      bouton.addEventListener('click', function () {
        bouton.disabled = true;
        var requete = present
          ? appeler('/sessions/' + seance.id + '/participants/' + athlete.id, { method: 'DELETE' })
          : appeler('/sessions/' + seance.id + '/participants', { method: 'POST', body: { athleteId: athlete.id } });

        requete
          .then(function (reponse) {
            etat.edition.seance = reponse.session;
            dessinerEquipe();
            return charger();
          })
          .catch(function (erreur) {
            afficherAlerte(erreur.message, els['dialogue-alerte']);
            bouton.disabled = false;
          });
      });
      item.appendChild(bouton);
      liste.appendChild(item);
    });

    if (complet) {
      liste.appendChild(creer('li', { className: 'equipe-note', textContent: 'Séance complète.' }));
    } else if (seance.statut === 'annulee') {
      liste.appendChild(creer('li', { className: 'equipe-note', textContent: 'Séance annulée : les inscriptions sont fermées.' }));
    }
  }

  function dessinerMots(seance) {
    var liste = els['mots-liste'];
    vider(liste);

    if (!seance.messages.length) {
      liste.appendChild(creer('li', { className: 'equipe-note', textContent: 'Aucun mot pour l’instant.' }));
      return;
    }

    seance.messages.forEach(function (message) {
      var item = creer('li', { className: 'mot' });
      var entete = creer('p', { className: 'mot-entete' });
      entete.appendChild(creer('b', { textContent: message.athlete.nom }));
      entete.appendChild(creer('span', { textContent: formaterHorodatage(message.createdAt) }));
      item.appendChild(entete);
      item.appendChild(creer('p', { className: 'mot-texte', textContent: message.texte }));

      if (etat.coach) {
        var retirer = creer('button', { type: 'button', className: 'danger', textContent: 'Retirer' });
        retirer.addEventListener('click', function () {
          if (!confirm('Retirer ce mot de ' + message.athlete.nom + ' ?')) return;
          retirer.disabled = true;
          appeler('/sessions/' + seance.id + '/messages/' + message.id, { method: 'DELETE' })
            .then(function (reponse) {
              etat.edition.seance = reponse.session;
              dessinerEquipe();
              return charger();
            })
            .catch(function (erreur) {
              afficherAlerte(erreur.message, els['dialogue-alerte']);
              retirer.disabled = false;
            });
        });
        item.appendChild(retirer);
      }
      liste.appendChild(item);
    });
  }

  function remplirAuteurs() {
    vider(els['champ-auteur']);
    els['champ-auteur'].appendChild(creer('option', { value: '', textContent: 'Qui écrit ?' }));
    etat.athletes.forEach(function (athlete) {
      var option = creer('option', { value: athlete.id, textContent: athlete.nom });
      if (athlete.id === etat.auteur) option.selected = true;
      els['champ-auteur'].appendChild(option);
    });
  }

  function envoyerMot() {
    var auteur = els['champ-auteur'].value;
    var texte = els['champ-mot'].value.trim();
    if (!auteur) return afficherAlerte('Choisissez votre nom avant d’écrire.', els['dialogue-alerte']);
    if (!texte) return afficherAlerte('Le message est vide.', els['dialogue-alerte']);

    els['envoyer-mot'].disabled = true;
    appeler('/sessions/' + etat.edition.id + '/messages', { method: 'POST', body: { athleteId: auteur, texte: texte } })
      .then(function (reponse) {
        ecrireAuteur(auteur);
        etat.edition.seance = reponse.session;
        els['champ-mot'].value = '';
        afficherAlerte(null, els['dialogue-alerte']);
        dessinerEquipe();
        return charger();
      })
      .catch(function (erreur) { afficherAlerte(erreur.message, els['dialogue-alerte']); })
      .then(function () { els['envoyer-mot'].disabled = false; });
  }

  /* ---------- Mode coach ---------- */

  function majBoutonCoach() {
    els['bouton-coach'].textContent = etat.coach ? 'Mode coach' : 'Mode athlète';
    els['bouton-coach'].classList.toggle('actif', etat.coach);
    els['bouton-coach'].title = etat.coach
      ? 'Notes vocales visibles. Cliquez pour changer ou retirer la clé.'
      : 'Notes vocales masquées. Cliquez pour saisir la clé coach.';
  }

  function ouvrirCoach() {
    afficherAlerte(null, els['coach-alerte']);
    els['champ-cle'].value = etat.cle;
    if (etat.cle && !etat.coach) afficherAlerte('Cette clé a été refusée par le serveur.', els['coach-alerte']);
    els['dialogue-coach'].showModal();
    els['champ-cle'].focus();
  }

  function validerCle(evenement) {
    evenement.preventDefault();
    ecrireCle(els['champ-cle'].value.trim());
    els['dialogue-coach'].close();
    charger();
  }

  function oublierCle() {
    ecrireCle('');
    els['dialogue-coach'].close();
    charger();
  }

  /* ---------- Notes vocales ---------- */

  var enregistreur = { media: null, flux: null, morceaux: [], debut: 0, minuteur: null, dictee: null, texte: '' };

  function micDisponible() {
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function reinitialiserEnregistreur() {
    arreterFlux();
    enregistreur.morceaux = [];
    enregistreur.texte = '';
    els['enregistrer-voix'].textContent = '● Enregistrer';
    els['enregistrer-voix'].classList.remove('actif');
    els['vocal-etat'].textContent = 'Prêt';

    if (!micDisponible()) {
      els['enregistrer-voix'].disabled = true;
      afficherAide('Ce navigateur ne permet pas l’enregistrement audio (il faut une connexion sécurisée ou localhost).');
    } else {
      els['enregistrer-voix'].disabled = false;
      afficherAide(reconnaissanceDisponible() ? '' : 'Transcription automatique indisponible sur ce navigateur : seul le son sera enregistré.');
    }
  }

  function afficherAide(message) {
    els['vocal-aide'].textContent = message || '';
    els['vocal-aide'].hidden = !message;
  }

  function reconnaissanceDisponible() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function basculerEnregistrement() {
    if (enregistreur.media && enregistreur.media.state === 'recording') {
      enregistreur.media.stop();
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(demarrerEnregistrement)
      .catch(function () {
        afficherAlerte('Micro inaccessible : autorisez l’accès au microphone.', els['dialogue-alerte']);
      });
  }

  function demarrerEnregistrement(flux) {
    enregistreur.flux = flux;
    enregistreur.morceaux = [];
    enregistreur.texte = '';
    enregistreur.media = new MediaRecorder(flux);
    enregistreur.debut = Date.now();

    enregistreur.media.addEventListener('dataavailable', function (evenement) {
      if (evenement.data && evenement.data.size) enregistreur.morceaux.push(evenement.data);
    });
    enregistreur.media.addEventListener('stop', function () {
      var duree = (Date.now() - enregistreur.debut) / 1000;
      var blob = new Blob(enregistreur.morceaux, { type: enregistreur.media.mimeType || 'audio/webm' });
      arreterFlux();
      els['enregistrer-voix'].textContent = '● Enregistrer';
      els['enregistrer-voix'].classList.remove('actif');
      els['vocal-etat'].textContent = 'Envoi…';
      conserverNote(blob, duree, enregistreur.texte.trim());
    });

    enregistreur.media.start();
    demarrerDictee();
    els['enregistrer-voix'].textContent = '■ Arrêter';
    els['enregistrer-voix'].classList.add('actif');
    enregistreur.minuteur = setInterval(function () {
      els['vocal-etat'].textContent = 'Enregistrement… ' + Math.round((Date.now() - enregistreur.debut) / 1000) + ' s';
    }, 250);
  }

  /** Transcription en direct quand le navigateur sait le faire (Chrome, Safari). */
  function demarrerDictee() {
    if (!reconnaissanceDisponible()) return;
    var Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
    var dictee = new Reconnaissance();
    dictee.lang = 'fr-FR';
    dictee.continuous = true;
    dictee.interimResults = false;
    dictee.addEventListener('result', function (evenement) {
      for (var i = evenement.resultIndex; i < evenement.results.length; i += 1) {
        if (evenement.results[i].isFinal) enregistreur.texte += evenement.results[i][0].transcript + ' ';
      }
    });
    dictee.addEventListener('error', function () { /* le son reste enregistré */ });
    try {
      dictee.start();
      enregistreur.dictee = dictee;
    } catch (erreur) {
      enregistreur.dictee = null;
    }
  }

  function arreterFlux() {
    if (enregistreur.minuteur) clearInterval(enregistreur.minuteur);
    enregistreur.minuteur = null;
    if (enregistreur.dictee) {
      try { enregistreur.dictee.stop(); } catch (erreur) { /* déjà arrêtée */ }
      enregistreur.dictee = null;
    }
    if (enregistreur.flux) {
      enregistreur.flux.getTracks().forEach(function (piste) { piste.stop(); });
      enregistreur.flux = null;
    }
  }

  /** Envoie la note si la séance existe, sinon la garde jusqu'à l'enregistrement. */
  function conserverNote(blob, duree, transcription) {
    return blobEnBase64(blob)
      .then(function (audio) {
        var note = { audio: audio, mimeType: blob.type || 'audio/webm', duree: duree, transcription: transcription };
        if (etat.edition && etat.edition.mode === 'edition') return televerser(etat.edition.id, note);

        etat.noteEnAttente = note;
        etat.noteEnAttente.apercu = URL.createObjectURL(blob);
        els['vocal-etat'].textContent = 'Note prête — elle partira avec la séance';
        dessinerNotesVocales();
      })
      .catch(function (erreur) {
        els['vocal-etat'].textContent = 'Prêt';
        afficherAlerte(erreur.message, els['dialogue-alerte']);
      });
  }

  function televerser(sessionId, note) {
    return appeler('/sessions/' + sessionId + '/notes-vocales', { method: 'POST', body: note })
      .then(function (reponse) {
        etat.edition.seance = reponse.session;
        els['vocal-etat'].textContent = 'Note ajoutée';
        dessinerNotesVocales();
        return reponse;
      });
  }

  function televerserNoteEnAttente(sessionId) {
    if (!etat.noteEnAttente) return Promise.resolve();
    var note = etat.noteEnAttente;
    etat.noteEnAttente = null;
    return appeler('/sessions/' + sessionId + '/notes-vocales', {
      method: 'POST',
      body: { audio: note.audio, mimeType: note.mimeType, duree: note.duree, transcription: note.transcription }
    });
  }

  function dessinerNotesVocales() {
    var liste = els['vocal-liste'];
    libererSons();
    vider(liste);

    var seance = etat.edition && etat.edition.seance;
    var notes = seance ? seance.notesVocales : [];

    notes.forEach(function (note) {
      liste.appendChild(dessinerNote(note, seance.id, false));
    });
    if (etat.noteEnAttente) {
      liste.appendChild(dessinerNote({
        id: 'en-attente',
        duree: etat.noteEnAttente.duree,
        transcription: etat.noteEnAttente.transcription,
        createdAt: new Date().toISOString(),
        apercu: etat.noteEnAttente.apercu
      }, null, true));
    }
    if (!liste.children.length) {
      liste.appendChild(creer('li', { className: 'vocal-vide', textContent: 'Aucune note vocale.' }));
    }
  }

  function dessinerNote(note, sessionId, enAttente) {
    var item = creer('li', { className: 'vocal-note' });

    var son = creer('audio', { controls: true });
    if (enAttente) {
      son.src = note.apercu;
    } else {
      chargerSon('/sessions/' + sessionId + '/notes-vocales/' + note.id)
        .then(function (lien) { son.src = lien; })
        .catch(function (erreur) {
          item.replaceChild(creer('p', { className: 'vocal-meta', textContent: erreur.message }), son);
        });
    }
    item.appendChild(son);

    item.appendChild(creer('span', {
      className: 'vocal-meta',
      textContent: (note.duree ? Math.round(note.duree) + ' s · ' : '') +
        formaterHorodatage(note.createdAt) + (enAttente ? ' · en attente' : '')
    }));

    if (note.transcription) {
      item.appendChild(creer('p', { className: 'vocal-transcription', textContent: '« ' + note.transcription + ' »' }));
    }

    if (!enAttente) {
      var supprimer = creer('button', { type: 'button', className: 'danger', textContent: 'Supprimer' });
      supprimer.addEventListener('click', function () {
        if (!confirm('Supprimer cette note vocale ?')) return;
        supprimer.disabled = true;
        appeler('/sessions/' + sessionId + '/notes-vocales/' + note.id, { method: 'DELETE' })
          .then(function (reponse) {
            etat.edition.seance = reponse.session;
            dessinerNotesVocales();
            return charger();
          })
          .catch(function (erreur) {
            afficherAlerte(erreur.message, els['dialogue-alerte']);
            supprimer.disabled = false;
          });
      });
      item.appendChild(supprimer);
    }
    return item;
  }

  /** Récupère le son avec la clé coach, puis le sert à la balise <audio>. */
  function chargerSon(chemin) {
    return fetch(API + chemin, { headers: entetes(false) })
      .then(function (reponse) {
        if (!reponse.ok) throw new Error('Note vocale illisible (clé coach ?).');
        return reponse.blob();
      })
      .then(function (blob) {
        var lien = URL.createObjectURL(blob);
        etat.sons.push(lien);
        return lien;
      });
  }

  function libererSons() {
    etat.sons.forEach(function (lien) { URL.revokeObjectURL(lien); });
    etat.sons = [];
  }

  function blobEnBase64(blob) {
    return new Promise(function (resoudre, rejeter) {
      var lecteur = new FileReader();
      lecteur.onload = function () { resoudre(String(lecteur.result).split(',')[1]); };
      lecteur.onerror = function () { rejeter(new Error('Lecture de l’enregistrement impossible.')); };
      lecteur.readAsDataURL(blob);
    });
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

  /** « 10:30, 18:00 et 18:30 » — une énumération lisible, quel que soit le nombre. */
  function enumerer(liste) {
    if (liste.length < 2) return liste.join('');
    return liste.slice(0, -1).join(', ') + ' et ' + liste[liste.length - 1];
  }

  /** « 1 séance », « 3 séances » — le pluriel irrégulier peut être passé. */
  function pluriel(nombre, singulier, pluriels) {
    return nombre + ' ' + (nombre > 1 ? (pluriels || singulier + 's') : singulier);
  }

  /** « 1 sept. 2026 » : la vue année traverse deux années civiles. */
  function formaterDateAnnee(iso) {
    return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', {
      timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric'
    });
  }

  function formaterHorodatage(iso) {
    var date = new Date(iso);
    return isNaN(date.getTime()) ? '' : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  function afficherAlerte(message, cible) {
    var element = cible || els.alerte;
    element.textContent = message || '';
    element.hidden = !message;
  }

  function basculerChargement(actif) {
    els.enregistrer.disabled = actif;
    els.archiver.disabled = actif;
  }

  /* ---------- Branchements ---------- */

  els.precedent.addEventListener('click', function () {
    etat.start = etat.calendrier ? etat.calendrier.previousStart : null;
    charger();
  });
  els.suivant.addEventListener('click', function () {
    etat.start = etat.calendrier ? etat.calendrier.nextStart : null;
    charger();
  });
  els.aujourdhui.addEventListener('click', function () {
    etat.start = null;
    charger();
  });
  els.annuler.addEventListener('click', function () { els.dialogue.close(); });
  els.archiver.addEventListener('click', archiver);
  els.formulaire.addEventListener('submit', enregistrer);
  els['enregistrer-voix'].addEventListener('click', basculerEnregistrement);
  els['champ-heure'].addEventListener('change', majLieuxSelonHeure);
  els['envoyer-mot'].addEventListener('click', envoyerMot);
  els['champ-mot'].addEventListener('keydown', function (evenement) {
    // Entrée envoie le mot sans valider tout le formulaire.
    if (evenement.key === 'Enter') {
      evenement.preventDefault();
      envoyerMot();
    }
  });
  els.dialogue.addEventListener('close', function () {
    arreterFlux();
    libererSons();
    if (etat.noteEnAttente && etat.noteEnAttente.apercu) URL.revokeObjectURL(etat.noteEnAttente.apercu);
    etat.noteEnAttente = null;
  });
  els['bouton-coach'].addEventListener('click', ouvrirCoach);
  els['formulaire-coach'].addEventListener('submit', validerCle);
  els['oublier-cle'].addEventListener('click', oublierCle);
  els['coach-annuler'].addEventListener('click', function () { els['dialogue-coach'].close(); });
  els['panneau-annee'].addEventListener('toggle', function () {
    if (els['panneau-annee'].open && !etat.anneeChargee) {
      etat.anneeChargee = true;
      chargerAnnee();
    }
  });

  ETROIT.addEventListener('change', function () {
    if (etat.calendrier) dessiner(etat.calendrier);
  });

  charger();
})();
