/* Présentation 7 jours du calendrier, branchée sur l'API /api.

   Le DOM est construit nœud par nœud (textContent) plutôt qu'en innerHTML :
   les intitulés, noms d'encadrants et transcriptions viennent de l'API et ne
   doivent jamais pouvoir injecter du balisage. */
(function () {
  'use strict';

  // ?api=https://mon-serveur/api permet d'héberger la page et l'API séparément.
  var API = new URLSearchParams(location.search).get('api') || './api';

  var CLE_STOCKAGE = 'calendrier.cleCoach';
  var CLE_ATHLETE = 'calendrier.athlete';
  var CLE_FILE = 'calendrier.fileAttente';

  var etat = {
    start: new URLSearchParams(location.search).get('start') || null,
    calendrier: null,
    edition: null,
    noteEnAttente: null,   // note dictée avant que la séance n'existe
    anneeChargee: false,
    suiviCharge: false,
    cle: lireCle(),        // clé coach : les notes du coach n'existent qu'avec elle
    coach: false,
    athletes: [],          // le référentiel, chargé une fois
    athlete: lireAthlete(),// « je suis » : une déclaration, pas une identification
    noteEdition: null,     // { seance, note } pendant l'édition d'un compte rendu
    jourChoisi: null,      // vue téléphone : le jour affiché, un seul à la fois
    dernierDepuisCache: false
  };

  /** localStorage peut être bloqué (navigation privée) : on n'en dépend jamais. */
  function lireCle() {
    try {
      return localStorage.getItem(CLE_STOCKAGE) || '';
    } catch (erreur) {
      return '';
    }
  }

  function ecrireCle(cle) {
    etat.cle = cle;
    try {
      if (cle) localStorage.setItem(CLE_STOCKAGE, cle);
      else localStorage.removeItem(CLE_STOCKAGE);
    } catch (erreur) { /* la clé ne vaudra que pour cette page */ }
  }

  function lireAthlete() {
    try {
      return localStorage.getItem(CLE_ATHLETE) || '';
    } catch (erreur) {
      return '';
    }
  }

  function ecrireAthlete(id) {
    etat.athlete = id;
    try {
      if (id) localStorage.setItem(CLE_ATHLETE, id);
      else localStorage.removeItem(CLE_ATHLETE);
    } catch (erreur) { /* le choix ne vaudra que pour cette page */ }
  }

  /** @returns {object|null} l'athlète déclaré, tel que le référentiel le décrit. */
  function athleteCourant() {
    return etat.athletes.filter(function (a) { return a.id === etat.athlete; })[0] || null;
  }

  var els = {};
  [
    'periode', 'alerte', 'bandeau-reseau', 'etat', 'entete-jours', 'corps', 'legende',
    'panneau-annee', 'annee-contenu', 'vue-jour', 'jours-barre', 'jour-contenu',
    'dialogue', 'formulaire', 'dialogue-titre', 'dialogue-contexte', 'dialogue-alerte',
    'champ-statut', 'champ-lieu', 'champ-heure', 'champ-titre', 'champ-coach', 'champ-capacite', 'champ-notes',
    'enregistrer-voix', 'ajouter-note', 'champ-dictee', 'vocal-etat', 'vocal-aide', 'vocal-liste',
    'archiver', 'enregistrer', 'annuler', 'precedent', 'suivant', 'aujourdhui',
    'vocal', 'bouton-coach', 'dialogue-coach', 'formulaire-coach', 'coach-alerte', 'champ-cle',
    'oublier-cle', 'coach-annuler',
    'champ-athlete', 'panneau-suivi', 'suivi-contenu',
    'dialogue-note', 'formulaire-note', 'note-titre', 'note-contexte', 'note-alerte',
    'champ-note', 'note-compteur', 'note-supprimer', 'note-annuler', 'note-enregistrer'
  ].forEach(function (id) {
    els[id] = document.getElementById(id);
  });

  /* ---------- Appels API ---------- */

  function entetes(avecCorps) {
    var resultat = {};
    if (avecCorps) resultat['Content-Type'] = 'application/json';
    if (etat.cle) resultat['X-Cle-Coach'] = etat.cle;
    if (etat.athlete) resultat['X-Athlete'] = etat.athlete;
    return resultat;
  }

  function appeler(chemin, options) {
    var config = options || {};
    return fetch(API + chemin, {
      method: config.method || 'GET',
      headers: entetes(Boolean(config.body)),
      body: config.body ? JSON.stringify(config.body) : undefined
    }).then(function (reponse) {
      // Le service worker signale ainsi qu'il a servi une copie gardée.
      etat.dernierDepuisCache = reponse.headers.get('X-Depuis-Cache') === '1';
      return reponse.json().catch(function () { return {}; }).then(function (donnees) {
        if (!reponse.ok) {
          throw new Error((donnees.error && donnees.error.message) || 'Erreur ' + reponse.status);
        }
        return donnees;
      });
    }, function (erreur) {
      // fetch ne rejette que sur panne réseau ; un refus du serveur passe par
      // la branche ci-dessus. La distinction décide de ce qui se rejoue.
      erreur.reseau = true;
      throw erreur;
    });
  }

  function charger() {
    afficherAlerte(null);
    return appeler('/calendar' + (etat.start ? '?start=' + encodeURIComponent(etat.start) : ''))
      .then(function (calendrier) {
        etat.calendrier = calendrier;
        etat.start = calendrier.start;
        etat.coach = Boolean(calendrier.coach);
        majBoutonCoach();
        majPanneauSuivi();
        dessiner(calendrier);
        majBandeauReseau();
        if (etat.cle && !etat.coach) afficherAlerte('Clé coach refusée : les notes vocales restent masquées.');
        if (etat.anneeChargee) chargerAnnee();
        if (etat.coach && etat.suiviCharge) chargerSuivi();
      })
      .catch(function (erreur) {
        els.etat.textContent = 'Calendrier indisponible.';
        afficherAlerte(erreur.message + ' — le serveur de l’API est-il démarré ?');
      });
  }

  /* ---------- Hors ligne : garder, puis rejouer ----------

     Au bord de la piste, le réseau va et vient. Une note écrite sans signal
     est gardée sur l'appareil et repart au retour du réseau.

     Ce qui se met en file est choisi : les notes et les changements de
     statut, gestes du terrain. Créer ou supprimer une séance, non — cela se
     fait au calme, avec du réseau, et rejouer une création à l'aveugle
     risquerait des doublons de planning.

     Le rejeu d'une création de note demande une précaution : si la réponse
     s'est perdue alors que le serveur avait bien écrit, la rejouer créerait
     un doublon. On vérifie donc d'abord si elle est déjà là. */

  function lireFile() {
    try {
      return JSON.parse(localStorage.getItem(CLE_FILE) || '[]');
    } catch (erreur) {
      return [];
    }
  }

  function ecrireFile(file) {
    try {
      localStorage.setItem(CLE_FILE, JSON.stringify(file));
    } catch (erreur) { /* stockage refusé : la file ne survivra pas au rechargement */ }
    majBandeauReseau();
  }

  function mettreEnFile(operation) {
    operation.id = 'op_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    var file = lireFile();
    file.push(operation);
    ecrireFile(file);
  }

  function retirerDeLaFile(id) {
    ecrireFile(lireFile().filter(function (op) { return op.id !== id; }));
  }

  /**
   * Envoie, ou garde pour plus tard si le réseau manque.
   * @returns {Promise<object>} `{ enFile: true }` quand l'envoi est différé.
   */
  function envoyer(chemin, options, type) {
    return appeler(chemin, options).catch(function (erreur) {
      if (!erreur.reseau) throw erreur;
      mettreEnFile({ chemin: chemin, methode: options.method, corps: options.body, type: type });
      return { enFile: true };
    });
  }

  function viderFile() {
    var file = lireFile();
    if (!file.length) return Promise.resolve(false);

    var aEnvoye = false;
    return file
      .reduce(function (chaine, operation) {
        return chaine.then(function (arrete) {
          if (arrete) return true;
          return rejouer(operation)
            .then(function () {
              retirerDeLaFile(operation.id);
              aEnvoye = true;
              return false;
            })
            .catch(function (erreur) {
              // Toujours hors ligne : on garde la file intacte pour plus tard.
              if (erreur.reseau) return true;
              // Refus du serveur : le rejouer indéfiniment ne servirait à rien.
              retirerDeLaFile(operation.id);
              afficherAlerte('Une note en attente a été refusée : ' + erreur.message);
              return false;
            });
        });
      }, Promise.resolve(false))
      .then(function () {
        majBandeauReseau();
        return aEnvoye;
      });
  }

  function rejouer(operation) {
    var options = { method: operation.methode, body: operation.corps };
    if (operation.type !== 'creation-note') return appeler(operation.chemin, options);

    return dejaArrivee(operation).then(function (presente) {
      return presente ? null : appeler(operation.chemin, options);
    });
  }

  /** Une note identique est-elle déjà sur la séance ? Alors l'envoi avait abouti. */
  function dejaArrivee(operation) {
    var seanceId = (operation.chemin.match(/\/sessions\/([^/]+)\//) || [])[1];
    if (!seanceId) return Promise.resolve(false);

    return appeler('/sessions/' + seanceId).then(function (reponse) {
      var seance = reponse.session;
      var corps = operation.corps || {};
      if (corps.texte !== undefined) {
        return (seance.notesAthletes || []).some(function (note) {
          return note.athleteId === corps.athleteId && note.texte === corps.texte;
        });
      }
      return (seance.notesVocales || []).some(function (note) {
        return note.transcription === corps.transcription;
      });
    }, function () {
      return false; // séance illisible : on laisse le rejeu tenter sa chance
    });
  }

  function majBandeauReseau() {
    var enAttente = lireFile().length;
    var horsLigne = navigator.onLine === false;

    if (!enAttente && !horsLigne && !etat.dernierDepuisCache) {
      els['bandeau-reseau'].hidden = true;
      return;
    }

    var morceaux = [];
    if (horsLigne) morceaux.push('Hors ligne');
    else if (etat.dernierDepuisCache) morceaux.push('Affichage de la dernière semaine connue');
    if (enAttente) morceaux.push(pluriel(enAttente, 'note') + ' en attente d’envoi');

    els['bandeau-reseau'].textContent = morceaux.join(' · ') + '.';
    els['bandeau-reseau'].hidden = false;
  }

  /* ---------- Athlètes ---------- */

  /** Le référentiel ne change pas : une seule lecture au démarrage. */
  function chargerAthletes() {
    return appeler('/athletes')
      .then(function (reponse) {
        etat.athletes = reponse.athletes || [];
        remplirAthletes();
      })
      .catch(function () {
        // Sans le référentiel, la page reste lisible : seul le choix disparaît.
        els['champ-athlete'].disabled = true;
      });
  }

  function remplirAthletes() {
    var select = els['champ-athlete'];
    vider(select);
    select.appendChild(creer('option', { value: '', textContent: 'personne' }));
    etat.athletes.forEach(function (athlete) {
      var option = creer('option', { value: athlete.id, textContent: athlete.nom });
      if (athlete.id === etat.athlete) option.selected = true;
      select.appendChild(option);
    });
    // Un choix gardé qui ne correspond plus à personne : on l'oublie.
    if (etat.athlete && !athleteCourant()) {
      ecrireAthlete('');
      select.value = '';
    }
    majCouleurAthlete();
  }

  /** La pastille du sélecteur prend la couleur de l'athlète choisi. */
  function majCouleurAthlete() {
    var athlete = athleteCourant();
    els['champ-athlete'].style.setProperty('--athlete', athlete ? athlete.couleur : 'transparent');
  }

  function dessinerPastille(athlete) {
    var pastille = creer('span', {
      className: 'pastille-athlete',
      textContent: athlete.initiales,
      title: athlete.nom
    });
    pastille.style.setProperty('--athlete', athlete.couleur);
    return pastille;
  }

  /* ---------- Quelle présentation ? ----------

     Les deux sont construites, mais une seule doit exister pour de bon :
     masquée en CSS, l'autre resterait atteignable au clavier et annoncée par
     un lecteur d'écran, avec ses boutons en double. L'attribut hidden la
     retire de l'arbre d'accessibilité et de l'ordre de tabulation. */

  var petitEcran = window.matchMedia('(max-width: 700px)');

  function majPresentation() {
    var cadre = document.querySelector('.cadre');
    els['vue-jour'].hidden = !petitEcran.matches;
    if (cadre) cadre.hidden = petitEcran.matches;
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

    dessinerEntete(calendrier);
    dessinerCorps(calendrier);
    dessinerJour(calendrier);
    dessinerLegende(calendrier);
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
          className: 'compteur',
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
    td.appendChild(contenuCreneau(cellule, statuts));
    return td;
  }

  /** Les séances d'un créneau, et le bouton d'ajout quand il a un sens. */
  function contenuCreneau(cellule, statuts) {
    var fragment = document.createDocumentFragment();

    cellule.sessions.forEach(function (seance) {
      fragment.appendChild(dessinerSeance(seance, statuts));
    });

    // Le planning appartient au coach : inutile de proposer un bouton qui
    // se ferait refuser.
    if (!etat.coach) return fragment;

    if (cellule.complet) {
      fragment.appendChild(creer('p', { className: 'cellule-vide', textContent: 'Tous les lieux occupés' }));
    } else {
      var ajout = creer('button', {
        type: 'button',
        className: 'ajouter',
        textContent: '+ Ajouter',
        title: 'Ajouter une séance le ' + formaterDate(cellule.date) + ' à ' + cellule.time
      });
      ajout.addEventListener('click', function () { ouvrirCreation(cellule); });
      fragment.appendChild(ajout);
    }
    return fragment;
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
    if (seance.notesVocales.length) {
      ouvrir.appendChild(creer('span', {
        className: 'vocal-indicateur',
        textContent: '✎ ' + pluriel(seance.notesVocales.length, 'note')
      }));
    }
    if (seance.notesAthletes && seance.notesAthletes.length) {
      ouvrir.appendChild(dessinerAuteurs(seance.notesAthletes));
    }
    // Seul le coach édite la séance ; l'athlète l'ouvre pour la lire.
    ouvrir.addEventListener('click', function () {
      if (etat.coach) ouvrirEdition(seance);
      else if (etat.athlete) ouvrirNote(seance);
    });
    if (!etat.coach && !etat.athlete) ouvrir.disabled = true;
    carte.appendChild(ouvrir);

    carte.appendChild(dessinerNotesAthletes(seance));

    // Le menu déroulant : indiquer d'un geste si la séance est faite ou prévue.
    if (!etat.coach) return carte;

    var menu = creer('select', {
      className: 'statut-select',
      title: 'Statut de la séance'
    });
    menu.setAttribute('aria-label', 'Statut de la séance du ' + formaterDate(seance.date) + ' à ' + seance.time);
    statuts.forEach(function (statut) {
      var option = creer('option', { value: statut.id, textContent: statut.label });
      if (statut.id === seance.statut) option.selected = true;
      menu.appendChild(option);
    });
    menu.addEventListener('change', function () {
      menu.disabled = true;
      envoyer('/sessions/' + seance.id, { method: 'PATCH', body: { statut: menu.value } }, 'statut')
        .then(function (reponse) {
          if (reponse && reponse.enFile) {
            afficherAlerte('Pas de réseau : le changement de statut partira au retour du réseau.');
            menu.disabled = false;
            return;
          }
          return charger();
        })
        .catch(function (erreur) {
          afficherAlerte(erreur.message);
          return charger();
        });
    });
    carte.appendChild(menu);
    return carte;
  }

  /** Les pastilles des auteurs, posées sur la carte de la séance. */
  function dessinerAuteurs(notes) {
    var groupe = creer('span', { className: 'auteurs' });
    notes.forEach(function (note) {
      if (note.athlete) groupe.appendChild(dessinerPastille(note.athlete));
    });
    return groupe;
  }

  /** On raconte une séance qui a eu lieu, et qui n'est pas archivée. */
  function commentable(seance) {
    return !seance.archivee && etat.calendrier && seance.date <= etat.calendrier.today;
  }

  /** Le bouton « mon compte rendu » — visible pour l'athlète qui s'est déclaré. */
  function dessinerNotesAthletes(seance) {
    var zone = creer('div', { className: 'notes-athlete' });
    var athlete = athleteCourant();
    if (!athlete || etat.coach || !commentable(seance)) return zone;

    var mienne = (seance.notesAthletes || []).filter(function (note) {
      return note.athleteId === athlete.id;
    })[0];

    var bouton = creer('button', {
      type: 'button',
      className: 'note-bouton' + (mienne ? ' remplie' : ''),
      // Court : la cellule d'un créneau est étroite sur un téléphone.
      textContent: mienne ? '✎ Ma note' : '+ Ma note'
    });
    bouton.style.setProperty('--athlete', athlete.couleur);
    bouton.addEventListener('click', function () { ouvrirNote(seance); });
    zone.appendChild(bouton);

    if (mienne) {
      zone.appendChild(creer('p', { className: 'note-apercu', textContent: mienne.texte }));
    }
    return zone;
  }

  /* ---------- Compte rendu d'un athlète ---------- */

  function ouvrirNote(seance) {
    var athlete = athleteCourant();
    if (!athlete) return;

    var mienne = (seance.notesAthletes || []).filter(function (note) {
      return note.athleteId === athlete.id;
    })[0] || null;

    etat.noteEdition = { seance: seance, note: mienne };
    afficherAlerte(null, els['note-alerte']);

    els['note-titre'].textContent = mienne ? 'Corriger mon compte rendu' : 'Mon compte rendu';
    els['note-contexte'].textContent = athlete.nom + ' · '
      + formaterDate(seance.date, true) + ' à ' + seance.time + ' · '
      + (seance.location ? seance.location.name : seance.locationId);
    els['champ-note'].value = mienne ? mienne.texte : '';
    els['note-supprimer'].hidden = !mienne;

    if (!commentable(seance)) {
      afficherAlerte('Cette séance n’a pas encore eu lieu.', els['note-alerte']);
      els['champ-note'].disabled = true;
      els['note-enregistrer'].disabled = true;
    } else {
      els['champ-note'].disabled = false;
      els['note-enregistrer'].disabled = false;
    }

    els['dialogue-note'].showModal();
    els['champ-note'].focus();
  }

  function enregistrerNote(evenement) {
    evenement.preventDefault();
    if (!etat.noteEdition) return;

    var athlete = athleteCourant();
    var seance = etat.noteEdition.seance;
    var existante = etat.noteEdition.note;
    var texte = els['champ-note'].value.trim();

    if (!texte) {
      afficherAlerte('Écrivez quelque chose, ou supprimez la note.', els['note-alerte']);
      return;
    }

    els['note-enregistrer'].disabled = true;
    var chemin = '/sessions/' + seance.id + '/notes-athlete' + (existante ? '/' + existante.id : '');
    envoyer(
      chemin,
      { method: existante ? 'PATCH' : 'POST', body: { athleteId: athlete.id, texte: texte } },
      existante ? 'correction-note' : 'creation-note'
    )
      .then(function (reponse) {
        els['dialogue-note'].close();
        if (reponse && reponse.enFile) {
          afficherAlerte('Pas de réseau : votre note est gardée sur l’appareil et partira toute seule.');
          return;
        }
        return charger();
      })
      .catch(function (erreur) {
        afficherAlerte(erreur.message, els['note-alerte']);
      })
      .then(function () { els['note-enregistrer'].disabled = false; });
  }

  function supprimerNote() {
    if (!etat.noteEdition || !etat.noteEdition.note) return;
    var seance = etat.noteEdition.seance;
    var note = etat.noteEdition.note;

    els['note-supprimer'].disabled = true;
    envoyer('/sessions/' + seance.id + '/notes-athlete/' + note.id, { method: 'DELETE' }, 'suppression-note')
      .then(function (reponse) {
        els['dialogue-note'].close();
        if (reponse && reponse.enFile) {
          afficherAlerte('Pas de réseau : la suppression partira au retour du réseau.');
          return;
        }
        return charger();
      })
      .catch(function (erreur) {
        afficherAlerte(erreur.message, els['note-alerte']);
      })
      .then(function () { els['note-supprimer'].disabled = false; });
  }

  /* ---------- Suivi des athlètes (coach) ---------- */

  function majPanneauSuivi() {
    els['panneau-suivi'].hidden = !etat.coach;
    if (!etat.coach) {
      els['panneau-suivi'].open = false;
      etat.suiviCharge = false;
    }
  }

  function chargerSuivi() {
    return appeler('/suivi')
      .then(dessinerSuivi)
      .catch(function (erreur) {
        vider(els['suivi-contenu']);
        els['suivi-contenu'].appendChild(creer('p', { className: 'etat', textContent: erreur.message }));
      });
  }

  function dessinerSuivi(suivi) {
    vider(els['suivi-contenu']);

    els['suivi-contenu'].appendChild(creer('p', {
      className: 'suivi-resume',
      textContent: pluriel(suivi.total, 'compte rendu', 'comptes rendus') + ' du '
        + formaterDateAnnee(suivi.debut) + ' au ' + formaterDateAnnee(suivi.fin)
        + (suivi.sansNote.length ? ' · ' + pluriel(suivi.sansNote.length, 'athlète') + ' sans note' : '')
    }));

    var liste = creer('div', { className: 'suivi-athletes' });
    suivi.athletes.forEach(function (athlete) {
      liste.appendChild(dessinerSuiviAthlete(athlete));
    });
    els['suivi-contenu'].appendChild(liste);
  }

  function dessinerSuiviAthlete(athlete) {
    var bloc = creer('section', { className: 'suivi-athlete' + (athlete.totalNotes ? '' : ' muet') });
    bloc.style.setProperty('--athlete', athlete.couleur);

    var entete = creer('h4', { className: 'suivi-nom' });
    entete.appendChild(dessinerPastille(athlete));
    entete.appendChild(creer('span', { textContent: athlete.nom }));
    entete.appendChild(creer('span', {
      className: 'suivi-compte',
      textContent: athlete.totalNotes
        ? pluriel(athlete.totalNotes, 'note') + ' · ' + pluriel(athlete.seancesCommentees, 'séance')
        : 'aucune note'
    }));
    bloc.appendChild(entete);

    athlete.notes.forEach(function (note) {
      var item = creer('article', { className: 'suivi-note' });
      item.appendChild(creer('p', {
        className: 'suivi-seance',
        textContent: formaterDateAnnee(note.seance.date) + ' · ' + note.seance.time + ' · '
          + (note.seance.location ? note.seance.location.name : '')
          + (note.seance.title ? ' — ' + note.seance.title : '')
      }));
      item.appendChild(creer('p', { className: 'suivi-texte', textContent: note.texte }));
      bloc.appendChild(item);
    });

    return bloc;
  }

  /* ---------- Vue téléphone : un jour à la fois ----------

     Sur 390 px, le tableau de la semaine demandait 1146 px de large : deux
     colonnes visibles sur huit, et 782 px à faire défiler de côté pour
     atteindre vendredi. Ici, la semaine tient dans une barre de sept
     pastilles, et le jour choisi occupe toute la largeur. */

  /** Le jour affiché : celui qu'on a choisi s'il est dans la semaine, sinon aujourd'hui. */
  function jourAffiche(calendrier) {
    var jours = calendrier.days;
    var choisi = jours.filter(function (j) { return j.date === etat.jourChoisi; })[0];
    if (choisi) return choisi;
    return jours.filter(function (j) { return j.isToday; })[0] || jours[0];
  }

  function dessinerJour(calendrier) {
    var jour = jourAffiche(calendrier);
    etat.jourChoisi = jour.date;

    dessinerBarreJours(calendrier, jour);
    dessinerSeancesDuJour(calendrier, jour);
  }

  function dessinerBarreJours(calendrier, jourActif) {
    vider(els['jours-barre']);

    calendrier.days.forEach(function (jour) {
      var puce = creer('button', { type: 'button', className: 'jour-puce' });
      if (jour.date === jourActif.date) puce.classList.add('actif');
      if (jour.isToday) puce.classList.add('aujourdhui');
      if (jour.isPast) puce.classList.add('passe');
      puce.setAttribute('aria-pressed', jour.date === jourActif.date ? 'true' : 'false');
      puce.setAttribute('aria-label', formaterDate(jour.date, true));

      puce.appendChild(creer('span', { className: 'jour-nom', textContent: jour.weekday.slice(0, 3) }));
      puce.appendChild(creer('span', { className: 'jour-num', textContent: String(jour.dayOfMonth) }));

      // Une pastille pleine dit « il y a quelque chose », sans chiffre à déchiffrer.
      var points = creer('span', { className: 'jour-points' });
      if (jour.totaux.total) {
        points.textContent = jour.totaux.effectuee
          ? jour.totaux.effectuee + '/' + jour.totaux.total
          : String(jour.totaux.total);
        if (jour.totaux.effectuee) points.classList.add('fait');
      }
      puce.appendChild(points);

      puce.addEventListener('click', function () {
        etat.jourChoisi = jour.date;
        dessinerJour(etat.calendrier);
      });
      els['jours-barre'].appendChild(puce);
    });
  }

  function dessinerSeancesDuJour(calendrier, jour) {
    var contenu = els['jour-contenu'];
    vider(contenu);

    var entete = creer('h2', { className: 'jour-titre' });
    entete.appendChild(creer('span', { className: 'jour-date', textContent: formaterDate(jour.date, true) }));
    entete.appendChild(creer('span', {
      className: 'jour-resume',
      textContent: jour.totaux.total
        ? pluriel(jour.totaux.total, 'séance') + ' · ' + jour.totaux.effectuee + ' effectuée' + (jour.totaux.effectuee > 1 ? 's' : '')
        : 'aucune séance'
    }));
    contenu.appendChild(entete);

    var index = calendrier.days.indexOf(jour);
    calendrier.rows.forEach(function (ligne) {
      var cellule = ligne.cells[index];
      var vide = !cellule.sessions.length;

      // Un créneau vide qu'on ne peut pas remplir n'a rien à dire : on le tait.
      if (vide && !etat.coach) return;

      var bloc = creer('section', { className: 'jour-creneau' });
      bloc.appendChild(creer('h3', { className: 'jour-heure', textContent: ligne.time }));
      bloc.appendChild(contenuCreneau(cellule, calendrier.statuts));
      contenu.appendChild(bloc);
    });

    if (!contenu.querySelector('.jour-creneau')) {
      contenu.appendChild(creer('p', {
        className: 'jour-rien',
        textContent: 'Rien de prévu ce jour-là.'
      }));
    }
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
      textContent: 'Les séances archivées quittent la grille mais restent enregistrées, avec leur historique et leurs notes.'
    }));

    if (archivees.length) {
      var liste = creer('ul', { className: 'archives-liste' });
      archivees.forEach(function (seance) {
        var item = creer('li', { 'data-lieu': seance.locationId });
        item.appendChild(creer('span', {
          textContent: formaterDateAnnee(seance.date) + ' · ' + seance.time + ' · ' +
            (seance.location ? seance.location.name : seance.locationId) + ' — ' + seance.title
        }));
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
    els['dialogue-titre'].textContent = 'Modifier la séance';
    els['dialogue-contexte'].textContent = formaterDate(seance.date, true) + ' à ' + seance.time;
    // Les lieux déjà pris sur ce créneau sont grisés ; celui de la séance reste choisi.
    remplirSelects(lieuxLibresDe(seance.date, seance.time), seance.locationId, seance.time, seance.statut);
    els['champ-titre'].value = seance.title || '';
    els['champ-coach'].value = seance.coach || '';
    els['champ-capacite'].value = String(seance.capacity);
    els['champ-notes'].value = seance.notes || '';
    els.archiver.hidden = false;
    ouvrirDialogue();
  }

  function ouvrirDialogue() {
    afficherAlerte(null, els['dialogue-alerte']);
    etat.noteEnAttente = null;
    els.vocal.hidden = !etat.coach;   // réservées au coach
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

  /* ---------- Notes du coach : dictées ou tapées ----------

     Le micro sert à écrire vite, pas à archiver du son. La parole est
     transcrite par le navigateur, et seul le texte part au serveur — rien
     n'est jamais conservé en audio. D'où deux conséquences visibles ici :
     la note se relit et se corrige avant d'être envoyée, et un navigateur
     sans reconnaissance vocale reste parfaitement utilisable au clavier. */

  var dictee = { reconnaissance: null, debut: 0, minuteur: null, secondes: 0, aDicte: false };

  function reconnaissanceDisponible() {
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function reinitialiserEnregistreur() {
    arreterDictee();
    dictee.secondes = 0;
    dictee.aDicte = false;
    els['champ-dictee'].value = '';
    els['vocal-etat'].textContent = 'Prêt';
    majBoutonDictee(false);

    if (reconnaissanceDisponible()) {
      els['enregistrer-voix'].disabled = false;
      afficherAide('');
    } else {
      els['enregistrer-voix'].disabled = true;
      afficherAide('Ce navigateur ne sait pas transcrire la parole — Firefox, notamment. Écrivez votre note au clavier.');
    }
  }

  function afficherAide(message) {
    els['vocal-aide'].textContent = message || '';
    els['vocal-aide'].hidden = !message;
  }

  function majBoutonDictee(actif) {
    els['enregistrer-voix'].textContent = actif ? '■ Arrêter' : '🎙 Dicter';
    els['enregistrer-voix'].classList.toggle('actif', actif);
  }

  function basculerEnregistrement() {
    if (dictee.reconnaissance) {
      arreterDictee();
      return;
    }
    demarrerDictee();
  }

  function demarrerDictee() {
    if (!reconnaissanceDisponible()) return;
    var Reconnaissance = window.SpeechRecognition || window.webkitSpeechRecognition;
    var reconnaissance = new Reconnaissance();
    reconnaissance.lang = 'fr-FR';
    reconnaissance.continuous = true;
    reconnaissance.interimResults = false;

    reconnaissance.addEventListener('result', function (evenement) {
      var ajout = '';
      for (var i = evenement.resultIndex; i < evenement.results.length; i += 1) {
        if (evenement.results[i].isFinal) ajout += evenement.results[i][0].transcript + ' ';
      }
      if (!ajout) return;
      var champ = els['champ-dictee'];
      champ.value = (champ.value ? champ.value.replace(/\s*$/, ' ') : '') + ajout;
      dictee.aDicte = true;
    });

    reconnaissance.addEventListener('error', function (evenement) {
      arreterDictee();
      afficherAide(evenement.error === 'not-allowed'
        ? 'Micro refusé. Autorisez le microphone, ou écrivez au clavier.'
        : 'La dictée s’est interrompue. Vous pouvez continuer au clavier.');
    });

    // La reconnaissance s'arrête d'elle-même après un silence : on referme
    // proprement plutôt que de laisser le bouton mentir.
    reconnaissance.addEventListener('end', function () {
      if (dictee.reconnaissance) arreterDictee();
    });

    try {
      reconnaissance.start();
    } catch (erreur) {
      afficherAide('La dictée n’a pas pu démarrer. Écrivez votre note au clavier.');
      return;
    }

    dictee.reconnaissance = reconnaissance;
    dictee.debut = Date.now();
    majBoutonDictee(true);
    dictee.minuteur = setInterval(function () {
      els['vocal-etat'].textContent = 'Dictée… ' + Math.round(dictee.secondes + (Date.now() - dictee.debut) / 1000) + ' s';
    }, 250);
  }

  function arreterDictee() {
    if (dictee.minuteur) clearInterval(dictee.minuteur);
    dictee.minuteur = null;
    if (dictee.reconnaissance) {
      dictee.secondes += (Date.now() - dictee.debut) / 1000;
      var reconnaissance = dictee.reconnaissance;
      dictee.reconnaissance = null;
      try { reconnaissance.stop(); } catch (erreur) { /* déjà arrêtée */ }
      els['vocal-etat'].textContent = els['champ-dictee'].value.trim() ? 'Relisez, puis « Ajouter »' : 'Prêt';
    }
    majBoutonDictee(false);
  }

  /** Envoie la note si la séance existe, sinon la garde jusqu'à l'enregistrement. */
  function ajouterNote() {
    arreterDictee();
    var texte = els['champ-dictee'].value.trim();
    if (!texte) {
      afficherAide('Écrivez ou dictez quelque chose avant d’ajouter.');
      return;
    }

    var note = {
      transcription: texte,
      duree: dictee.aDicte ? Math.round(dictee.secondes * 10) / 10 : null,
      source: dictee.aDicte ? 'dictee' : 'saisie'
    };

    if (etat.edition && etat.edition.mode === 'edition') {
      els['ajouter-note'].disabled = true;
      televerser(etat.edition.id, note)
        .catch(function (erreur) { afficherAlerte(erreur.message, els['dialogue-alerte']); })
        .then(function () { els['ajouter-note'].disabled = false; });
      return;
    }

    // La séance n'existe pas encore : la note partira juste après sa création.
    etat.noteEnAttente = note;
    els['champ-dictee'].value = '';
    dictee.secondes = 0;
    dictee.aDicte = false;
    els['vocal-etat'].textContent = 'Note prête — elle partira avec la séance';
    dessinerNotesVocales();
  }

  function televerser(sessionId, note) {
    return envoyer('/sessions/' + sessionId + '/notes-vocales', { method: 'POST', body: note }, 'creation-note')
      .then(function (reponse) {
        if (reponse && reponse.enFile) {
          els['vocal-etat'].textContent = 'Gardée — partira au retour du réseau';
          els['champ-dictee'].value = '';
          return reponse;
        }
        etat.edition.seance = reponse.session;
        els['champ-dictee'].value = '';
        dictee.secondes = 0;
        dictee.aDicte = false;
        els['vocal-etat'].textContent = 'Note ajoutée';
        dessinerNotesVocales();
        return reponse;
      });
  }

  function televerserNoteEnAttente(sessionId) {
    if (!etat.noteEnAttente) return Promise.resolve();
    var note = etat.noteEnAttente;
    etat.noteEnAttente = null;
    return appeler('/sessions/' + sessionId + '/notes-vocales', { method: 'POST', body: note });
  }

  function dessinerNotesVocales() {
    var liste = els['vocal-liste'];
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
        createdAt: new Date().toISOString()
      }, null, true));
    }
    if (!liste.children.length) {
      liste.appendChild(creer('li', { className: 'vocal-vide', textContent: 'Aucune note sur cette séance.' }));
    }
  }

  function dessinerNote(note, sessionId, enAttente) {
    var item = creer('li', { className: 'vocal-note' });

    item.appendChild(creer('p', { className: 'vocal-transcription', textContent: note.transcription }));
    item.appendChild(creer('span', {
      className: 'vocal-meta',
      textContent: (note.duree ? 'dictée, ' + Math.round(note.duree) + ' s · ' : '') +
        formaterHorodatage(note.createdAt) + (enAttente ? ' · en attente' : '')
    }));

    if (enAttente) return item;

    var actions = creer('div', { className: 'vocal-actions' });

    var corriger = creer('button', { type: 'button', textContent: 'Corriger' });
    corriger.addEventListener('click', function () { ouvrirCorrection(item, note, sessionId); });
    actions.appendChild(corriger);

    var supprimer = creer('button', { type: 'button', className: 'danger', textContent: 'Supprimer' });
    supprimer.addEventListener('click', function () {
      if (!confirm('Supprimer cette note ?')) return;
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
    actions.appendChild(supprimer);

    item.appendChild(actions);
    return item;
  }

  /** La reconnaissance vocale se trompe : la note se reprend sur place. */
  function ouvrirCorrection(item, note, sessionId) {
    vider(item);

    var champ = creer('textarea', { className: 'vocal-correction', rows: 3, value: note.transcription });
    champ.maxLength = 5000;
    item.appendChild(champ);

    var actions = creer('div', { className: 'vocal-actions' });
    var valider = creer('button', { type: 'button', className: 'principal', textContent: 'Enregistrer' });
    var annuler = creer('button', { type: 'button', textContent: 'Annuler' });

    valider.addEventListener('click', function () {
      var texte = champ.value.trim();
      if (!texte) {
        afficherAlerte('Une note vide n’a rien à conserver.', els['dialogue-alerte']);
        return;
      }
      valider.disabled = true;
      appeler('/sessions/' + sessionId + '/notes-vocales/' + note.id, {
        method: 'PATCH',
        body: { transcription: texte, source: 'saisie' }
      })
        .then(function (reponse) {
          etat.edition.seance = reponse.session;
          dessinerNotesVocales();
        })
        .catch(function (erreur) {
          afficherAlerte(erreur.message, els['dialogue-alerte']);
          valider.disabled = false;
        });
    });
    annuler.addEventListener('click', dessinerNotesVocales);

    actions.appendChild(annuler);
    actions.appendChild(valider);
    item.appendChild(actions);
    champ.focus();
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

  /** « 10:30, 18:00 ou 18:30 » — join(' et ') donnerait « a et b et c ». */
  function enumerer(valeurs, liaison) {
    if (valeurs.length <= 1) return valeurs.join('');
    return valeurs.slice(0, -1).join(', ') + ' ' + (liaison || 'et') + ' ' + valeurs[valeurs.length - 1];
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
    etat.jourChoisi = null;   // la semaine change : le jour choisi n'y est plus
    charger();
  });
  els.suivant.addEventListener('click', function () {
    etat.start = etat.calendrier ? etat.calendrier.nextStart : null;
    etat.jourChoisi = null;
    charger();
  });
  els.aujourdhui.addEventListener('click', function () {
    etat.start = null;
    etat.jourChoisi = null;
    charger();
  });
  els.annuler.addEventListener('click', function () { els.dialogue.close(); });
  els.archiver.addEventListener('click', archiver);
  els.formulaire.addEventListener('submit', enregistrer);
  els['enregistrer-voix'].addEventListener('click', basculerEnregistrement);
  els['ajouter-note'].addEventListener('click', ajouterNote);
  // Taper après avoir dicté reste de la dictée corrigée : c'est l'envoi qui tranche.
  els['champ-dictee'].addEventListener('keydown', function (evenement) {
    if (evenement.key === 'Enter' && (evenement.metaKey || evenement.ctrlKey)) ajouterNote();
  });
  els.dialogue.addEventListener('close', function () {
    arreterDictee();
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

  els['champ-athlete'].addEventListener('change', function () {
    ecrireAthlete(els['champ-athlete'].value);
    majCouleurAthlete();
    charger();
  });
  els['formulaire-note'].addEventListener('submit', enregistrerNote);
  els['note-annuler'].addEventListener('click', function () { els['dialogue-note'].close(); });
  els['note-supprimer'].addEventListener('click', supprimerNote);
  els['dialogue-note'].addEventListener('close', function () { etat.noteEdition = null; });
  els['panneau-suivi'].addEventListener('toggle', function () {
    if (els['panneau-suivi'].open && !etat.suiviCharge) {
      etat.suiviCharge = true;
      chargerSuivi();
    }
  });

  /* Le service worker garde la coquille et la dernière grille : l'application
     s'ouvre au bord de la piste, réseau ou pas. Son absence ne gêne rien —
     la page fonctionne comme avant, simplement sans hors ligne. */
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* tant pis */ });
    });
  }

  petitEcran.addEventListener('change', majPresentation);
  majPresentation();

  window.addEventListener('online', function () {
    majBandeauReseau();
    viderFile().then(function (aEnvoye) {
      if (aEnvoye) charger();
    });
  });
  window.addEventListener('offline', majBandeauReseau);

  // Le référentiel des athlètes d'abord : la grille en dépend pour les pastilles.
  chargerAthletes()
    .then(charger)
    // Ce qui attendait depuis la dernière fois part maintenant.
    .then(function () { return viderFile(); })
    .then(function (aEnvoye) { if (aEnvoye) return charger(); });
})();
