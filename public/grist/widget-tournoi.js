// Widget Grist : un tournoi en entier, lu depuis les tables du document.
//
// Le widget ne rejoue aucune règle. Il rebâtit le tournoi de ses lignes, puis
// appelle le code de l'application — même barème, mêmes départages, même
// podium. S'ils changent, le widget suit.

// --- Des lignes de Grist à un tournoi ----------------------------------------
//
// Grist envoie des lignes de tables ; le code de l'application veut un tournoi.
// Cette section fait la traduction, et elle vit ici parce que le widget est le
// seul à en avoir besoin — core.js est chargé par les cinq pages, dont aucune
// n'a à savoir qu'un tableur existe.
//
// outils/vers-grist.py dit les mêmes règles à l'envers, pour écrire ces lignes.
// Deux langages, deux sens : qu'ils restent d'accord se vérifie par
// l'aller-retour de outils/test_vers_grist.py.


// Le rang de la manche dans son duel, quelle que soit la phase : l'aller et le
// retour d'une poule sont la même notion que les manches 1 et 2 d'une demie — et
// la belle en est la troisième. Sans cela, la colonne serait vide pour la moitié
// du tableau, et l'aller/retour resterait caché dans la clé.
const rang = (m) => (m.num != null ? m.num : (String(m.id).endsWith("leg2") ? 2 : 1));

// Les couleurs alternent d'une manche à l'autre : le premier nommé a les blancs
// aux manches impaires, le second aux paires. Aux manches 1 et 2, cela revient à
// dire que les blancs sont ceux qui reçoivent — la règle qu'affichent les pions
// ♙/♟ des cartes ; la belle repart sur le même pied que l'aller.
// Le Worker s'en sert pour écrire les lignes, le widget pour les afficher.
const cotes = (m) => (rang(m) % 2 === 1 ? [m.player1, m.player2] : [m.player2, m.player1]);

// Les quatre tables suffisent : ce qu'on lit dans Grist est tout ce que
// l'application a besoin de savoir, et un instantané de l'historique repart vers
// le Worker.
//
// Ce qui ne s'enregistre pas, parce que rien ne le fixe :
//   · le nombre de journées      — c'est la dernière journée de la poule ;
//   · la journée feuilletée      — un point de vue, pas un fait du tournoi ;
//   · le vainqueur d'une demie   — il se rejoue des manches à chaque affichage,
//     et quand la finale existe, ses deux finalistes le disent ;
//   · le podium                  — il se recalcule des manches ; un tournoi
//     terminé rouvre sur sa finale, et le clic qui proclame redonne le même ;
//   · l'écran ouvert             — il se déduit de l'avancement ;
//   · l'ordre des duels d'une journée — deux duels du même jour n'ont pas de
//     rang entre eux ; ils reviennent triés, ce qui peut changer l'ordre des
//     cartes à l'écran, et rien d'autre.
function etatDepuisLignes(tournoi, partants, manches, joueurs = []) {
  // Le nom et l'Elo d'un partant viennent de sa fiche, et de nulle part ailleurs.
  const fiches = new Map(joueurs.filter((j) => j.Ref).map((j) => [j.Ref, j]));
  const indice = new Map();
  const players = [...partants]
    .sort((a, b) => (a.Indice || 0) - (b.Indice || 0))
    .map((p) => {
      indice.set(p.Cle, p.Indice);
      const fiche = p.Ref ? fiches.get(p.Ref) : null;
      return { id: p.Indice, ref: p.Ref || null,
               name: fiche ? (fiche.Nom || null) : null,
               elo: (fiche && fiche.Elo != null) ? fiche.Elo : null };
    });

// Le résultat est écrit du point de vue des blancs ; la manche, elle, nomme
  // ses joueurs dans l'ordre du duel. Le rang dit lequel des deux avait les
  // blancs — c'est l'inverse exact de `cotes`.
  const POINTS = { B: [1, 0], N: [0, 1], E: [0.5, 0.5] };

  function refaisManche(l) {
    const [b, n] = [indice.get(l.Blancs), indice.get(l.Noirs)];
    const droit = l.Manche % 2 === 1;
    const [player1, player2] = droit ? [b, n] : [n, b];
    const points = POINTS[l.Resultat];
    const [player1Score, player2Score] = !points ? [null, null]
      : (droit ? points : [points[1], points[0]]);

    const m = { player1, player2, player1Score, player2Score, played: !!points };
    if (l.Cadence) m.cadence = l.Cadence;
    if (l.Variante) m.variante = l.Variante;
    if (l.Lien) m.lien = l.Lien;
    if (l.CC_Blancs || l.CC_Noirs || l.CC_Issue || l.CC_Fin || l.CC_Coups != null) {
      m.analyse = { blancs: l.CC_Blancs || null, noirs: l.CC_Noirs || null,
                    resultat: l.CC_Issue || null, fin: l.CC_Fin || null,
                    coups: l.CC_Coups == null ? null : l.CC_Coups };
    }
    return m;
  }

  const parPhase = (phase) => manches.filter((l) => l.Phase === phase);
  const parRang = (a, b) => a.Manche - b.Manche;

  // La poule : l'identifiant d'un duel y nomme la paire et l'aller ou le retour,
  // et c'est lui que les cartes et le calendrier désignent.
  const matches = parPhase("poule").map((l) => ({
    id: `${l.Duel}-leg${l.Manche}`, ...refaisManche(l), round: l.Journee || 1,
  })).sort((a, b) => a.round - b.round || a.id.localeCompare(b.id));

  const demies = parPhase("demie");
  const semifinalMatches = [...new Set(demies.map((l) => l.Duel))].sort().map((duel) => {
    const lignes = demies.filter((l) => l.Duel === duel).sort(parRang);
    const manchesDuDuel = lignes.map((l) => ({ ...refaisManche(l), num: l.Manche }));
    return {
      players: [manchesDuDuel[0].player1, manchesDuDuel[0].player2],
      matches: manchesDuDuel,
      winner: null,
    };
  });

  const finalMatches = parPhase("finale").sort(parRang)
    .map((l) => ({ ...refaisManche(l), num: l.Manche }));

  // Les finalistes sont les vainqueurs des demies : la finale, quand elle
  // existe, les nomme. Sinon l'affichage des demies les recalcule.
  if (finalMatches.length && semifinalMatches.length === 2) {
    semifinalMatches[0].winner = finalMatches[0].player1;
    semifinalMatches[1].winner = finalMatches[0].player2;
  }

  const t = {
    name: tournoi.Nom || null,
    players, matches, semifinalMatches, finalMatches,
    totalRounds: matches.reduce((max, m) => Math.max(max, m.round), 0),
    currentRound: 1,
    // Le podium ne s'enregistre pas : il se recalcule des manches. Un tournoi
    // terminé rouvre donc sur sa finale, et le clic qui proclame le vainqueur
    // redonne le même podium.
    championId: null, runnerId: null, thirdId: null,
  };

  return {
    version: tournoi.Version,
    updatedAt: tournoi.Maj || null,
    state: { tournament: t, screen: ecranDuTournoi(t) },
  };
}

// L'écran où rouvrir un tournoi se lit de son avancement : la finale lancée, la
// finale ; les demies tirées, les demies ; le calendrier posé, la poule. Rien de
// tout cela, il reste à inscrire.
function ecranDuTournoi(t) {
  if (t.finalMatches.length) return "screen-finals";
  if (t.semifinalMatches.length) return "screen-semifinals";
  if (t.matches.length) return "screen-tournament";
  return "screen-config";
}

// --- Le widget ---------------------------------------------------------------

// Les lignes des trois tables, rangées par tournoi : le document en porte
// plusieurs, le widget n'en montre qu'un.
let lignesParTournoi = { manches: new Map(), partants: new Map(), tournois: new Map() };
let fiches = [];
let tournoiChoisi = null;

function parTournoi(lignes) {
    const rangees = new Map();
    for (const ligne of lignes) {
        const id = ligne.Tournoi || '—';
        if (!rangees.has(id)) rangees.set(id, []);
        rangees.get(id).push(ligne);
    }
    return rangees;
}

// Les tournois connus : ceux qui ont une ligne, et ceux dont on n'a encore que
// des partants — un tournoi inscrit mais pas commencé existe aussi.
function tournoisConnus() {
    return [...new Set([...lignesParTournoi.tournois.keys(),
                        ...lignesParTournoi.partants.keys(),
                        ...lignesParTournoi.manches.keys()])].sort();
}

// --- Ce qui se dessine -------------------------------------------------------

// Le bandeau : le nom du tournoi est l'information principale, comme sur
// l'accueil de l'application. L'étape et l'avancement l'accompagnent.
function buildBandeau(nom, etape, joues, total) {
    const part = total ? Math.round((joues / total) * 100) : 0;
    return `
        <div class="tw-bandeau">
            <div class="tw-titre">${escapeHtml(nom)}</div>
            <div class="tw-etape"><span class="etiquette tw-badge">${escapeHtml(etape)}</span></div>
            <div class="tw-jauge" role="img"
                 aria-label="${joues} manches jouées sur ${total}">
                <div class="tw-jauge-remplie" style="width: ${part}%"></div>
            </div>
            <div class="tw-compte">${joues} <span>/ ${total} manches</span></div>
        </div>
    `;
}

// Le podium, une fois la finale jouée. Le champion occupe la marche haute ;
// l'or, l'argent et le bronze se lisent d'un coup d'œil.
const MARCHES = [
    { rang: 1, classe: 'or', emoji: '🥇', libelle: 'Champion' },
    { rang: 2, classe: 'argent', emoji: '🥈', libelle: 'Dauphin' },
    { rang: 3, classe: 'bronze', emoji: '🥉', libelle: 'Troisième' },
];

function buildPodium(places) {
    // L'argent à gauche, l'or au centre, le bronze à droite : la forme d'un podium.
    const ordre = [2, 1, 3];
    const marches = ordre.map(rang => {
        const marche = MARCHES.find(m => m.rang === rang);
        const id = places[rang];
        if (id == null) return '';
        return `
            <div class="tw-marche tw-marche--${marche.classe}">
                <div class="tw-medaille">${marche.emoji}</div>
                <div class="tw-marche-nom">${buildCasaque(id)}${escapeHtml(tournoi.players[id].name || '—')}</div>
                <div class="tw-marche-rang">${marche.libelle}</div>
            </div>
        `;
    }).join('');
    return `<div class="surface tw-podium"><div class="tw-marches">${marches}</div></div>`;
}

// Le classement de la poule. Les quatre premiers se qualifient : la ligne le dit.
function buildClassement(standings, qualifies) {
    const lignes = standings.map((p, rang) => `
        <tr class="${rang < qualifies ? 'tw-qualifie' : ''}">
            <td class="tw-rang">${rang + 1}</td>
            <td>${buildCasaque(p.id)}${escapeHtml(p.name || '—')}</td>
            <td class="cell-points">${p.points.toFixed(1)}</td>
            <td class="cell-nombre">${p.matches}</td>
        </tr>
    `).join('');
    return `
        <div class="surface tw-bloc">
            <h3 class="tw-section">Classement</h3>
            <div class="table-scroll">
                <table class="standings-table">
                    <thead><tr><th>Rang</th><th>Partant</th><th>Pts</th><th>Manches</th></tr></thead>
                    <tbody>${lignes}</tbody>
                </table>
            </div>
        </div>
    `;
}

// Un duel du tableau final : les deux partants, le score des manches, et le
// vainqueur quand il est désigné.
function buildDuel(titre, duel) {
    const [p1, p2] = duel.players.map(id => tournoi.players[id]);
    const issue = resolveDuel(duel.matches, p1, p2);
    const cote = (p, score, gagne) => `
        <div class="tw-cote ${gagne ? 'tw-cote--gagne' : ''}">
            <span class="tw-cote-nom">${buildCasaque(p.id)}${escapeHtml(p.name || '—')}</span>
            <span class="tw-cote-score">${score}</span>
        </div>`;
    return `
        <div class="surface tw-duel">
            <div class="tw-duel-titre">${escapeHtml(titre)}</div>
            ${cote(p1, issue.scores[0], issue.winner === p1.id)}
            ${cote(p2, issue.scores[1], issue.winner === p2.id)}
            ${issue.reason ? `<div class="tw-duel-note">départagé — ${escapeHtml(issue.reason)}</div>` : ''}
        </div>
    `;
}

// Les coups par partie, d'après ce que chess.com rapporte. Une manche n'y entre
// que si elle a été relue en ligne : les autres ne disent rien de leur longueur,
// et une moyenne tirée de rien ne dirait rien non plus.
function buildCoupsParPartie(bilans, parties) {
    const plafond = Math.max(...bilans.map(b => b.moyenne));
    const lignes = bilans.map(b => {
        const nom = tournoi.players[b.id].name || '—';
        return `
        <div class="tw-coups-ligne" title="${escapeHtml(nom)} — ${b.coups} coups en ${b.parties} partie${b.parties > 1 ? 's' : ''}">
            <span class="tw-coups-nom">${buildCasaque(b.id)}${escapeHtml(nom)}</span>
            <span class="tw-coups-barre">
                <span style="width: ${(b.moyenne / plafond) * 100}%; background: ${getCouleurCasaque(b.id)}"></span>
            </span>
            <span class="tw-coups-valeur">${Math.round(b.moyenne)}</span>
        </div>`;
    }).join('');
    return `
        <div class="surface tw-bloc">
            <h3 class="tw-section">Coups par partie</h3>
            ${lignes}
            <div class="tw-coups-note">
                Moyenne sur ${parties} partie${parties > 1 ? 's' : ''} relue${parties > 1 ? 's' : ''} sur chess.com.
            </div>
        </div>
    `;
}

// Chaque ligne dit quand la partie s'est jouée et qui avait quelle couleur : le
// pion blanc suit les blancs, le noir les noirs.
function buildSansLien(manches) {
    const lignes = manches.map(({ quand, m }) => {
        const [blancs, noirs] = cotes(m);
        const cote = (id, pion, titre) =>
            `${escapeHtml(tournoi.players[id].name || '—')}<span class="venue" title="${titre}">${pion}</span>`;
        return `
            <div class="tw-sans-lien-ligne">
                <span class="tw-sans-lien-quand">${escapeHtml(quand)}</span>
                <span>${cote(blancs, '♙︎', 'Blancs')} <span class="texte-attenue">vs</span> ${cote(noirs, '♟︎', 'Noirs')}</span>
            </div>`;
    }).join('');
    return `
        <div class="surface tw-bloc">
            <h3 class="tw-section">Jouées sans lien chess.com — ${manches.length}</h3>
            ${lignes}
        </div>
    `;
}

function buildTableauFinal(duels) {
    return `
        <div class="tw-bloc">
            <h3 class="tw-section">Tableau final</h3>
            <div class="tw-tableau">${duels.map(d => buildDuel(d.titre, d)).join('')}</div>
        </div>
    `;
}

// --- L'assemblage ------------------------------------------------------------

// Les duels des phases finales, dans l'ordre où on les lit : les deux demies,
// puis la finale. Le vainqueur de chaque demie y est déjà posé.
function getDuelsFinaux() {
    const duels = (tournoi.semifinalMatches || [])
        .map((demie, i) => ({ ...demie, titre: `Demi-finale ${i + 1}` }));
    if ((tournoi.finalMatches || []).length) {
        const finale = tournoi.finalMatches;
        duels.push({ titre: 'Grande finale', players: [finale[0].player1, finale[0].player2],
                     matches: finale });
    }
    return duels;
}

// Les parties jouées qui n'ont pas encore leur lien chess.com — celles qu'il
// reste à relier. Une partie non jouée n'a pas de lien non plus, mais il n'y a
// rien à y faire : ce serait le calendrier, pas une liste de tâches. Chacune est
// située par sa journée en poule, par le nom de son duel en phase finale.
function getSansLien() {
    const sansLien = [];
    const aRelier = (m) => m.played && !m.lien;
    for (const m of tournoi.matches || []) {
        if (aRelier(m)) sansLien.push({ quand: `Journée ${m.round}`, rang: [1, m.round], m });
    }
    (tournoi.semifinalMatches || []).forEach((demie, i) => {
        for (const m of demie.matches || []) {
            if (aRelier(m)) sansLien.push({ quand: `Demi-finale ${i + 1} — manche ${m.num}`, rang: [2, i], m });
        }
    });
    for (const m of tournoi.finalMatches || []) {
        if (aRelier(m)) sansLien.push({ quand: `Grande finale — manche ${m.num}`, rang: [3, m.num], m });
    }
    return sansLien.sort((a, b) => a.rang[0] - b.rang[0] || a.rang[1] - b.rang[1]);
}

// Ce que chaque partant a joué de coups, et en combien de parties. Une manche
// compte pour ses deux joueurs : ils y ont joué la même partie.
function getCoupsParJoueur() {
    const bilans = new Map();
    let parties = 0;
    for (const manche of getManches(tournoi)) {
        const coups = manche.analyse && manche.analyse.coups;
        if (coups == null) continue;
        parties++;
        for (const id of [manche.player1, manche.player2]) {
            const bilan = bilans.get(id) || { id, parties: 0, coups: 0 };
            bilan.parties++;
            bilan.coups += coups;
            bilans.set(id, bilan);
        }
    }
    return {
        parties,
        bilans: [...bilans.values()]
            .map(b => ({ ...b, moyenne: b.coups / b.parties }))
            .sort((a, b) => b.moyenne - a.moyenne),
    };
}

// Le podium : le champion et son dauphin sortent de la finale, le bronze du
// classement de la poule. Rien n'est enregistré, tout se recalcule.
function getPodium() {
    const finale = tournoi.finalMatches || [];
    if (!finale.length) return null;
    const [p1, p2] = [tournoi.players[finale[0].player1], tournoi.players[finale[0].player2]];
    const issue = resolveDuel(finale, p1, p2);
    if (issue.winner == null) return null;
    return { 1: issue.winner, 2: issue.winner === p1.id ? p2.id : p1.id, 3: resolveTroisiemePlace() };
}

function renderTournoiWidget() {
    const corps = document.getElementById('tournoi');
    if (!tournoi.players.length) {
        corps.innerHTML = '<div class="surface tw-bloc liste-vide">' +
            (tournoiChoisi ? 'Aucun partant pour ce tournoi.' : 'Aucun tournoi dans ce document.') +
            '</div>';
        return;
    }

    const manches = getManches(tournoi);
    const ligne = (lignesParTournoi.tournois.get(tournoiChoisi) || [])[0] || {};
    const podium = getPodium();
    const duels = getDuelsFinaux();

    // L'étape se lit de l'avancement, comme à la restauration — sauf que le
    // widget, lui, sait départager : un podium dressé, c'est un tournoi fini.
    const etape = podium ? SCREEN_LABELS['screen-results']
                         : (SCREEN_LABELS[ecranDuTournoi(tournoi)] || '—');

    const coups = getCoupsParJoueur();
    const sansLien = getSansLien();

    corps.innerHTML = [
        buildBandeau(ligne.Nom || tournoiChoisi, etape,
                     manches.filter(m => m.played).length, manches.length),
        podium ? buildPodium(podium) : '',
        buildClassement(computeClassement(), tournoi.players.length > 4 ? 4 : 0),
        coups.parties ? buildCoupsParPartie(coups.bilans, coups.parties) : '',
        duels.length ? buildTableauFinal(duels) : '',
        sansLien.length ? buildSansLien(sansLien) : '',
    ].join('');
}

function renderChoixTournoi() {
    const menu = document.getElementById('choix-tournoi');
    const ids = tournoisConnus();
    // Un seul tournoi dans le document : le menu n'a rien à proposer.
    menu.hidden = ids.length < 2;
    menu.innerHTML = ids.map(id => {
        const nom = ((lignesParTournoi.tournois.get(id) || [])[0] || {}).Nom || id;
        return `<option value="${escapeHtml(id)}"${id === tournoiChoisi ? ' selected' : ''}>${escapeHtml(nom)}</option>`;
    }).join('');
    // Un <select> déjà rendu ignore l'attribut `selected` de ses nouvelles
    // options : il faut lui dire son choix, sinon il annonce le tournoi
    // précédent pendant que la page en montre un autre.
    menu.value = tournoiChoisi || '';
}

function afficheTournoiChoisi(id) {
    tournoiChoisi = id;
    // Le menu suit, qu'on ait changé de tournoi par lui ou par l'adresse.
    renderChoixTournoi();
    const dedans = (table) => lignesParTournoi[table].get(id) || [];
    tournoi = etatDepuisLignes(dedans('tournois')[0] || {}, dedans('partants'),
                               dedans('manches'), fiches).state.tournament;
    renderTournoiWidget();
}

function appliqueTournoi(manches, partants = [], tournois = [], listeJoueurs = []) {
    lignesParTournoi = { manches: parTournoi(manches), partants: parTournoi(partants),
                         tournois: parTournoi(tournois) };
    fiches = listeJoueurs;

    // Le tournoi regardé disparaît si les lignes changent : on retombe sur le premier.
    const ids = tournoisConnus();
    if (!ids.includes(tournoiChoisi)) tournoiChoisi = ids[0] || null;

    afficheTournoiChoisi(tournoiChoisi);
}
