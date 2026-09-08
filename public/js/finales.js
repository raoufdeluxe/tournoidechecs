// Demi-finales, Grande Finale, podium et navigation entre ecrans

function renderDemies() {
    renderDemie(0, 'semi1');
    renderDemie(1, 'semi2');
    renderBarreProgression('progress-fill-semis', tournoi.semifinalMatches.flatMap(s => s.matches));
    saveEtat();
}

function renderDemie(index, elemPrefix) {
    const semifinal = tournoi.semifinalMatches[index];
    const contentId = elemPrefix + '-content';
    const contentDiv = document.getElementById(contentId);
    const p1Idx = semifinal.players[0];
    const p2Idx = semifinal.players[1];
    const p1Obj = tournoi.players[p1Idx];
    const p2Obj = tournoi.players[p2Idx];

    // Le départage compte déjà les manches gagnées : on lit son décompte.
    const outcome = resolveDuel(semifinal.matches, p1Obj, p2Obj);
    semifinal.winner = outcome.winner;

    let html = `
        <div class="demie">
            <div class="demie-affiche">${buildCasaque(p1Idx)}${buildNomPartant(p1Idx)} <span class="texte-attenue">vs</span> ${buildCasaque(p2Idx)}${buildNomPartant(p2Idx)}</div>
    `;
    
    semifinal.matches.forEach((match, mIdx) => {
        html += `
            <div class="demie-manche">
                <div class="demie-manche-titre">Match ${match.num}</div>
                ${buildCarteDuel(match, `demie:${index}:${mIdx}`, { modifieur: 'carte-duel--compact' })}
            </div>
        `;
    });
    
    html += `
        <div class="demie-score">
            ${buildNomPartant(p1Idx)}: ${outcome.scores[0]} pt | ${buildNomPartant(p2Idx)}: ${outcome.scores[1]} pt
        </div>
    `;

    if (outcome.winner !== null) {
        const via = outcome.reason ? ` (${outcome.reason})` : '';
        html += `<div class="verdict verdict--qualifie">${outcome.reason ? '⚖️' : '✓'} ${buildNomPartant(outcome.winner)} qualifié${via}</div>`;
    } else if (semifinal.matches.length > 2) {
        html += `<div class="verdict verdict--egalite">Égalité — manche décisive à jouer</div>`;
    }
    
    contentDiv.innerHTML = html;
}

// La barre se redessine avec les demies, à la fin : une belle ajoutée juste
// au-dessus compterait dans le total.
function checkDemiesTerminees() {
    tournoi.semifinalMatches.forEach(semifinal => {
        const p1Obj = tournoi.players[semifinal.players[0]];
        const p2Obj = tournoi.players[semifinal.players[1]];
        if (resolveDuel(semifinal.matches, p1Obj, p2Obj).needsDecider) {
            addBelle(semifinal.matches);
        }
    });
    
    renderDemies();
    
    document.getElementById('start-finals-btn').disabled =
        !(tournoi.semifinalMatches[0].winner !== null && tournoi.semifinalMatches[1].winner !== null);
}

function startFinale() {
    const finalist1 = tournoi.players[tournoi.semifinalMatches[0].winner];
    const finalist2 = tournoi.players[tournoi.semifinalMatches[1].winner];
    
    tournoi.finalMatches = [
        { player1: finalist1.id, player2: finalist2.id, player1Score: null, player2Score: null, played: false, num: 1, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT },
        { player1: finalist1.id, player2: finalist2.id, player1Score: null, player2Score: null, played: false, num: 2, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT }
    ];
    
    checkFinaleTerminee();
    showEcran('screen-finals');
}

function renderFinale() {
    const finalist1 = tournoi.players[tournoi.semifinalMatches[0].winner];
    const finalist2 = tournoi.players[tournoi.semifinalMatches[1].winner];
    
    document.getElementById('finalistes-list').innerHTML = `
        <div class="bracket-player finaliste-premier">
            <span class="finaliste-nom">${buildCasaque(finalist1.id)}${buildNomPartant(finalist1.id)}</span>
        </div>
        <div class="finaliste-vs">VS</div>
        <div class="bracket-player">
            <span class="finaliste-nom">${buildCasaque(finalist2.id)}${buildNomPartant(finalist2.id)}</span>
        </div>
    `;
    
    const container = document.getElementById('final-matches-container');
    container.innerHTML = '';
    
    tournoi.finalMatches.forEach((match, idx) => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div class="finale-manche">
                <div class="finale-manche-titre">Match ${match.num}</div>
                ${buildCarteDuel(match, `finale:${idx}`)}
            </div>
        `;
        
        container.appendChild(div);
    });

    const outcome = resolveDuel(tournoi.finalMatches, finalist1, finalist2);
    const placeholder = document.getElementById('final-result-placeholder');
    if (outcome.winner !== null) {
        placeholder.innerHTML = `<span class="verdict-champion">🏆 ${buildNomPartant(outcome.winner)}</span>` +
            (outcome.reason ? `<br><span class="verdict-detail">départagé — ${outcome.reason}</span>` : '');
    } else if (tournoi.finalMatches.length > 2) {
        placeholder.innerHTML = '<span class="verdict-egalite">Égalité — manche décisive à jouer</span>';
    } else {
        placeholder.textContent = 'En attente du résultat...';
    }

    saveEtat();
}

function checkFinaleTerminee() {
    const f1 = tournoi.players[tournoi.semifinalMatches[0].winner];
    const f2 = tournoi.players[tournoi.semifinalMatches[1].winner];

    // Une belle est ajoutee si les 2 manches ne departagent pas et qu'aucun Elo ne tranche.
    if (resolveDuel(tournoi.finalMatches, f1, f2).needsDecider) {
        addBelle(tournoi.finalMatches);
    }

    renderFinale();

    document.getElementById('finalize-finals-btn').disabled =
        resolveDuel(tournoi.finalMatches, f1, f2).winner === null;
}

function finalizeFinale() {
    const finalist1 = tournoi.players[tournoi.semifinalMatches[0].winner];
    const finalist2 = tournoi.players[tournoi.semifinalMatches[1].winner];
    const outcome = resolveDuel(tournoi.finalMatches, finalist1, finalist2);

    if (outcome.winner === null) {
        notifyErreur(outcome.needsDecider
            ? 'Égalité : la manche décisive doit être jouée avant de proclamer le vainqueur.'
            : 'Toutes les manches de la finale doivent être jouées.');
        return;
    }

    const champion = tournoi.players[outcome.winner];
    const runner = outcome.winner === finalist1.id ? finalist2 : finalist1;

    tournoi.championId = champion.id;
    tournoi.thirdId = resolveTroisiemePlace();
    tournoi.runnerId = runner.id;
    
    showResultats(champion, runner);
    showEcran('screen-results');
}

function showResultats(champion, runner) {
    // Repli sur un calcul a la volee : les tournois sauvegardes avant l'ajout
    // du bronze n'ont pas de thirdId enregistre.
    const thirdId = tournoi.thirdId != null ? tournoi.thirdId : resolveTroisiemePlace();
    const third = thirdId != null ? tournoi.players[thirdId] : null;
    const podium = document.getElementById('podium');
    podium.innerHTML = `
        <div class="podium-titre">📣 Photo-finish confirmée</div>
        <div class="podium-marches">
            <div class="podium-place">
                <div class="medal medal-silver podium-medaille">2</div>
                <div class="podium-nom">${buildCasaque(runner.id)}${buildNomPartant(runner.id)}</div>
                <div class="podium-rang">Dauphin</div>
                <div class="podium-emoji">🥈</div>
            </div>
            <div class="podium-place podium-place--or">
                <div class="medal medal-gold podium-medaille">1</div>
                <div class="podium-nom">${buildCasaque(champion.id)}${buildNomPartant(champion.id)}</div>
                <div class="podium-rang">Champion</div>
                <div class="podium-emoji">🏆</div>
            </div>
            <div class="podium-place">
                <div class="medal medal-bronze podium-medaille">3</div>
                <div class="podium-nom">${third ? buildCasaque(third.id) + buildNomPartant(third.id) : 'Demi-finalistes'}</div>
                <div class="podium-rang">${third ? 'Troisième' : ''}</div>
                <div class="podium-emoji">🥉</div>
            </div>
        </div>
    `;
    
    const allStandings = computeClassement();
    const body = document.getElementById('final-standings-body');
    body.innerHTML = allStandings.map((p, idx) => `
        <tr>
            <td>
                <strong>${idx + 1}</strong>
                ${p.id === champion.id ? ' 🏆' : p.id === runner.id ? ' 🥈' : (third && p.id === third.id) ? ' 🥉' : ''}
            </td>
            <td>${buildCasaque(p.id)}${buildNomPartant(p.id)}</td>
            <td class="cell-points">${p.points.toFixed(1)}</td>
            <td class="cell-nombre">${p.matches}</td>
        </tr>
    `).join('');
}

function showEcran(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    // L'encart des matchs est commun à tous les écrans : il suit le tournoi,
    // pas l'écran qu'on regarde.
    renderVoletMatchs();
    // Rien a remettre a zero tant qu'aucun tournoi n'est lance.
    saveEtat();
}

// Ouvre un tournoi neuf sous un nouvel identifiant. Le tournoi courant n'est
// pas supprimé : il reste accessible par son propre lien.
async function startNouveauTournoi() {
    if (tournoi.players.length) {
        const suite = await askConfirmation({
            titre: 'Créer un nouveau tournoi ?',
            message: 'Le tournoi en cours n\'est pas supprimé : il reste accessible par son lien, ' +
                'et se retrouve dans la liste des tournois.',
            action: 'Nouveau tournoi'
        });
        if (!suite) return;
    }

    // Aucun identifiant tant qu'on n'a pas donné le départ : sinon un simple
    // « Nouveau tournoi » laisserait une adresse vide dans la liste partagée.
    forgetTournoiCourant();

    // On repart sur un état de synchronisation vierge : nouvelle clé, nouvelle version.
    remoteVersion = 0;
    syncPending = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryDelay = 1000;

    tournoi = { name: null, players: [], matches: [], semifinalMatches: [], finalMatches: [], winners: [], totalRounds: 0, currentRound: 1 };
    document.getElementById('tournament-name').value = '';
    document.getElementById('player-count').value = 4;
    renderTitreTournoi();
    renderPartants();
    showEcran('screen-config');
}
