// Etat partage du tournoi, couleurs, helpers de resultat et regles de departage

let tournament = {
    players: [],
    matches: [],
    semifinalMatches: [],
    finalMatches: [],
    winners: [],
    totalRounds: 0,
    currentRound: 1
};

// Palette des "casaques" (couleurs de course) attribuées à chaque partant
const SILK_COLORS = ['#6B2D8C', '#1B8A5A', '#D4A017', '#C1272D', '#B8860B', '#8E44AD', '#2E8B57', '#A0522D'];
function silkColor(id) {
    return SILK_COLORS[id % SILK_COLORS.length];
}
function silkDot(id) {
    return `<span class="silk-dot" style="background:${silkColor(id)};"></span>`;
}

// Classe et icône à appliquer à un joueur pour un match donné : victoire, défaite ou match nul
function resultClass(match, isPlayer1) {
    if (!match.played) return '';
    const won = isPlayer1 ? match.player1Score > match.player2Score : match.player2Score > match.player1Score;
    const lost = isPlayer1 ? match.player1Score < match.player2Score : match.player2Score < match.player1Score;
    if (won) return 'winner';
    if (lost) return 'loser';
    return 'draw';
}

function resultIcon(match, isPlayer1) {
    const cls = resultClass(match, isPlayer1);
    if (cls === 'winner') return '<span class="result-icon">👍</span>';
    if (cls === 'loser') return '<span class="result-icon">👎</span>';
    if (cls === 'draw') return '<span class="result-icon">🤝</span>';
    return '';
}

// Applique un résultat ('p1', 'draw', 'p2', ou '' pour effacer) à un match
function applyResultToMatch(match, value) {
    if (value === 'p1') {
        match.player1Score = 1;
        match.player2Score = 0;
        match.played = true;
    } else if (value === 'p2') {
        match.player1Score = 0;
        match.player2Score = 1;
        match.played = true;
    } else if (value === 'draw') {
        match.player1Score = 0.5;
        match.player2Score = 0.5;
        match.played = true;
    } else {
        match.player1Score = null;
        match.player2Score = null;
        match.played = false;
    }
}

// En cas d'égalité, le partant au plus bas Elo l'emporte (pas de replay nécessaire).
// Retourne 'p1', 'p2', ou null si le départage est impossible (Elo manquant ou identique).
function resolveEloWinner(p1, p2) {
    if (p1.elo == null || p2.elo == null || p1.elo === p2.elo) return null;
    return p1.elo < p2.elo ? 'p1' : 'p2';
}

// Départage commun aux demi-finales et à la Grande Finale.
// Ordre : 1) score des manches  2) Elo le plus bas  3) manche décisive (belle)
// 4) meilleur classement en poule — ce dernier recours garantit qu'un duel
// finit toujours par désigner un vainqueur, même après une belle nulle.
function resolveDuel(matches, p1Obj, p2Obj) {
    let s1 = 0, s2 = 0;
    matches.forEach(m => {
        if (!m.played) return;
        if (m.player1Score > m.player2Score) s1 += 1;
        else if (m.player2Score > m.player1Score) s2 += 1;
        else { s1 += 0.5; s2 += 0.5; }
    });

    const base = { scores: [s1, s2], winner: null, reason: null, needsDecider: false };
    if (!matches.every(m => m.played)) return base;

    if (s1 !== s2) {
        return { ...base, winner: s1 > s2 ? p1Obj.id : p2Obj.id };
    }

    const eloWinner = resolveEloWinner(p1Obj, p2Obj);
    if (eloWinner) {
        return { ...base, winner: eloWinner === 'p1' ? p1Obj.id : p2Obj.id, reason: 'Elo le plus bas' };
    }

    if (matches.length < 3) {
        return { ...base, needsDecider: true };
    }

    const standings = calculateStandings();
    const r1 = standings.findIndex(x => x.id === p1Obj.id);
    const r2 = standings.findIndex(x => x.id === p2Obj.id);
    return { ...base, winner: r1 < r2 ? p1Obj.id : p2Obj.id, reason: 'meilleur classement en poule' };
}

// 3e place : le mieux classé en poule parmi les deux perdants des demi-finales.
// Pas de petite finale — le bronze se déduit du classement de la poule.
function resolveThirdPlace() {
    const losers = tournament.semifinalMatches
        .map(s => s.winner == null ? null : s.players.find(id => id !== s.winner))
        .filter(id => id != null);
    if (losers.length === 0) return null;
    if (losers.length === 1) return losers[0];
    const standings = calculateStandings();
    const rank = id => standings.findIndex(p => p.id === id);
    return rank(losers[0]) < rank(losers[1]) ? losers[0] : losers[1];
}

// Ajoute une manche décisive (belle) à un duel resté à égalité.
function addDecider(matches) {
    const first = matches[0];
    matches.push({
        player1: first.player1,
        player2: first.player2,
        player1Score: null,
        player2Score: null,
        played: false,
        num: matches.length + 1
    });
}

// Génère les <option> du menu déroulant de résultat, avec la sélection courante
function resultOptionsHtml(match, p1Name, p2Name) {
    let selected = '';
    if (match.played) {
        if (match.player1Score > match.player2Score) selected = 'p1';
        else if (match.player2Score > match.player1Score) selected = 'p2';
        else selected = 'draw';
    }
    return `
        <option value="" ${selected === '' ? 'selected' : ''}>Résultat à définir…</option>
        <option value="p1" ${selected === 'p1' ? 'selected' : ''}>🏆 Victoire — ${p1Name}</option>
        <option value="draw" ${selected === 'draw' ? 'selected' : ''}>🤝 Match nul</option>
        <option value="p2" ${selected === 'p2' ? 'selected' : ''}>🏆 Victoire — ${p2Name}</option>
    `;
}
