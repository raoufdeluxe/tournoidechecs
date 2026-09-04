// Demi-finales, Grande Finale, podium et navigation entre ecrans

function renderDemies() {
    renderDemie(0, 'semi1');
    renderDemie(1, 'semi2');
    updateProgressionDemies();
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
    // Les noms viennent des fiches, que n'importe qui ayant le lien peut
    // modifier : ils ne sont jamais injectés bruts dans la page.
    const p1Name = escapeHtml(p1Obj.name);
    const p2Name = escapeHtml(p2Obj.name);
    
    const scores = computeScoresDemie(semifinal);
    
    let html = `
        <div style="margin-bottom: 15px;">
            <div style="font-weight: 600; margin-bottom: 10px;">${buildCasaque(p1Idx)}${p1Name} <span style="color: var(--text-secondary); font-weight: 400;">vs</span> ${buildCasaque(p2Idx)}${p2Name}</div>
    `;
    
    semifinal.matches.forEach((match, mIdx) => {
        html += `
            <div style="margin-bottom: 14px;">
                <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Match ${match.num}</div>
                <div class="match-card match-card--compact" style="margin-bottom: 8px;">
                    <div class="player-result ${getClasseResultat(match, true)}">
                        ${getIconeResultat(match, true)}${p1Name}
                        ${buildBadgeTerrain(match, true)}
                    </div>
                    <div class="vs-indicator">vs</div>
                    <div class="player-result ${getClasseResultat(match, false)}">
                        ${getIconeResultat(match, false)}${p2Name}
                        ${buildBadgeTerrain(match, false)}
                    </div>
                </div>
                ${buildReglagesPartie(match,
                    `setCadenceDemie(${index}, ${mIdx}, this.value)`,
                    `setVarianteDemie(${index}, ${mIdx}, this.value)`)}
                <select class="result-select" style="font-size: 13px; padding: 8px;" onchange="setResultatDemie(${index}, ${mIdx}, this.value)">
                    ${buildOptionsResultat(match, p1Name, p2Name)}
                </select>
            </div>
        `;
    });
    
    html += `
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--border); font-weight: 600;">
            ${p1Name}: ${scores.player1} pt | ${p2Name}: ${scores.player2} pt
        </div>
    `;
    
    const outcome = resolveDuel(semifinal.matches, p1Obj, p2Obj);
    semifinal.winner = outcome.winner;

    if (outcome.winner !== null) {
        const winnerName = escapeHtml(tournoi.players[outcome.winner].name);
        const via = outcome.reason ? ` (${outcome.reason})` : '';
        html += `<div style="margin-top: 10px; padding: 10px; background: var(--accent-light); border-radius: 6px; text-align: center; font-weight: 600; color: var(--success);">${outcome.reason ? '⚖️' : '✓'} ${winnerName} qualifié${via}</div>`;
    } else if (semifinal.matches.length > 2) {
        html += `<div style="margin-top: 10px; padding: 10px; background: #FBF1DA; border-radius: 6px; text-align: center; font-weight: 600; color: var(--warning);">Égalité — manche décisive à jouer</div>`;
    }
    
    contentDiv.innerHTML = html;
}

function computeScoresDemie(semifinal) {
    let p1Total = 0, p2Total = 0;
    
    semifinal.matches.forEach(match => {
        if (match.played) {
            if (match.player1Score > match.player2Score) {
                p1Total += 1;
            } else if (match.player2Score > match.player1Score) {
                p2Total += 1;
            } else {
                p1Total += 0.5;
                p2Total += 0.5;
            }
        }
    });
    
    return {
        player1: p1Total,
        player2: p2Total,
        allPlayed: semifinal.matches.every(m => m.played)
    };
}

function setResultatDemie(semiIdx, matchIdx, value) {
    const semifinal = tournoi.semifinalMatches[semiIdx];
    const match = semifinal.matches[matchIdx];
    
    applyResultat(match, value);
    checkDemiesTerminees();
}

function setCadenceDemie(semiIdx, matchIdx, valeur) {
    if (setCadence(tournoi.semifinalMatches[semiIdx].matches[matchIdx], valeur)) saveEtat();
}

function setVarianteDemie(semiIdx, matchIdx, valeur) {
    if (setVariante(tournoi.semifinalMatches[semiIdx].matches[matchIdx], valeur)) saveEtat();
}

function updateProgressionDemies() {
    const allMatches = tournoi.semifinalMatches.flatMap(s => s.matches);
    const played = allMatches.filter(m => m.played).length;
    const total = allMatches.length;
    document.getElementById('progress-fill-semis').style.width = ((played / total) * 100) + '%';
}

function checkDemiesTerminees() {
    updateProgressionDemies();
    
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
        <div class="bracket-player" style="margin-bottom: 20px;">
            <span style="font-weight: 600;">${buildCasaque(finalist1.id)}${escapeHtml(finalist1.name)}</span>
        </div>
        <div style="text-align: center; margin: 15px 0; color: var(--text-secondary); font-size: 14px;">VS</div>
        <div class="bracket-player">
            <span style="font-weight: 600;">${buildCasaque(finalist2.id)}${escapeHtml(finalist2.name)}</span>
        </div>
    `;
    
    const container = document.getElementById('final-matches-container');
    container.innerHTML = '';
    
    tournoi.finalMatches.forEach((match, idx) => {
        const div = document.createElement('div');
        div.innerHTML = `
            <div style="margin-bottom: 20px;">
                <div style="font-weight: 700; margin-bottom: 12px; color: var(--text-primary); font-family: var(--font-sport);">Match ${match.num}</div>
                <div class="match-card" style="margin-bottom: 12px;">
                    <div class="player-result ${getClasseResultat(match, true)}">
                        ${getIconeResultat(match, true)}${escapeHtml(finalist1.name)}
                        ${buildBadgeTerrain(match, true)}
                    </div>
                    <div class="vs-indicator">vs</div>
                    <div class="player-result ${getClasseResultat(match, false)}">
                        ${getIconeResultat(match, false)}${escapeHtml(finalist2.name)}
                        ${buildBadgeTerrain(match, false)}
                    </div>
                </div>
                ${buildReglagesPartie(match,
                    `setCadenceFinale(${idx}, this.value)`,
                    `setVarianteFinale(${idx}, this.value)`)}
                <select class="result-select" onchange="setResultatFinale(${idx}, this.value)">
                    ${buildOptionsResultat(match, escapeHtml(finalist1.name), escapeHtml(finalist2.name))}
                </select>
                ${match.played ? '<div class="result-hint">✓ Résultat enregistré — modifiable à tout moment</div>' : ''}
            </div>
        `;
        
        container.appendChild(div);
    });

    const outcome = resolveDuel(tournoi.finalMatches, finalist1, finalist2);
    const placeholder = document.getElementById('final-result-placeholder');
    if (outcome.winner !== null) {
        const champName = tournoi.players[outcome.winner].name;
        placeholder.innerHTML = `<span style="font-weight: 700; color: var(--success);">🏆 ${champName}</span>` +
            (outcome.reason ? `<br><span style="font-size: 12px;">départagé — ${outcome.reason}</span>` : '');
    } else if (tournoi.finalMatches.length > 2) {
        placeholder.innerHTML = '<span style="font-weight: 600; color: var(--warning);">Égalité — manche décisive à jouer</span>';
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

function setResultatFinale(idx, value) {
    applyResultat(tournoi.finalMatches[idx], value);
    checkFinaleTerminee();
}

function setCadenceFinale(idx, valeur) {
    if (setCadence(tournoi.finalMatches[idx], valeur)) saveEtat();
}

function setVarianteFinale(idx, valeur) {
    if (setVariante(tournoi.finalMatches[idx], valeur)) saveEtat();
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
        <div style="font-family: var(--font-sport); color: var(--accent); font-weight: 700; margin-bottom: 20px;">📣 Photo-finish confirmée</div>
        <div style="display: flex; justify-content: center; align-items: flex-end; gap: 30px; margin-bottom: 40px;">
            <div style="text-align: center; animation: podium-pop 0.5s ease-out 0.15s both;">
                <div class="medal medal-silver" style="width: 80px; height: 80px; font-size: 36px; margin: 0 auto 10px;">2</div>
                <div style="font-weight: 600; color: var(--text-secondary);">${buildCasaque(runner.id)}${escapeHtml(runner.name)}</div>
                <div style="font-size: 13px; color: var(--text-secondary); font-family: var(--font-sport); font-weight: 600;">Dauphin</div>
                <div style="font-size: 24px;">🥈</div>
            </div>
            <div style="text-align: center; transform: translateY(-20px); animation: podium-pop 0.55s ease-out both;">
                <div class="medal medal-gold" style="width: 100px; height: 100px; font-size: 48px; margin: 0 auto 10px;">1</div>
                <div style="font-weight: 600; font-size: 24px; color: var(--primary-dark);">${buildCasaque(champion.id)}${escapeHtml(champion.name)}</div>
                <div style="font-size: 13px; color: var(--gold); font-family: var(--font-sport); font-weight: 700;">Champion</div>
                <div style="font-size: 32px;">🏆</div>
            </div>
            <div style="text-align: center; animation: podium-pop 0.5s ease-out 0.25s both;">
                <div class="medal medal-bronze" style="width: 70px; height: 70px; font-size: 32px; margin: 0 auto 10px;">3</div>
                <div style="font-weight: 600; color: var(--text-secondary);">${third ? buildCasaque(third.id) + third.name : 'Demi-finalistes'}</div>
                <div style="font-size: 13px; color: var(--text-secondary); font-family: var(--font-sport); font-weight: 600;">${third ? 'Troisième' : ''}</div>
                <div style="font-size: 24px;">🥉</div>
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
            <td>${buildCasaque(p.id)}${escapeHtml(p.name)}</td>
            <td style="text-align: center; font-weight: 600; font-size: 18px;">${p.points.toFixed(1)}</td>
            <td style="text-align: center;">${p.matches}</td>
        </tr>
    `).join('');
}

function showEcran(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
    // Rien a remettre a zero tant qu'aucun tournoi n'est lance.
    saveEtat();
}

function backToPoule() {
    showEcran('screen-tournament');
}

function backToDemies() {
    showEcran('screen-semifinals');
}

// Ouvre un tournoi neuf sous un nouvel identifiant. Le tournoi courant n'est
// pas supprimé : il reste accessible par son propre lien.
function startNouveauTournoi() {
    if (tournoi.players.length && !confirm(
        'Créer un nouveau tournoi ?\n\n' +
        'Le tournoi en cours n\'est pas supprimé : il reste accessible par son lien, ' +
        'que tu peux copier avant de continuer.')) {
        return;
    }

    idTournoi = newIdTournoi();
    saveTournoiCourant();
    history.replaceState(null, '', '#' + idTournoi);

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
