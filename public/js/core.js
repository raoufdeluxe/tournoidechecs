// Etat partage du tournoi, couleurs, helpers de resultat et regles de departage

// Copie locale d'un tournoi, par identifiant : elle sert de repli hors ligne.
const storageKey = (id) => 'tournoi_echecs_state_v1:' + id;

// La copie locale d'un tournoi supprimé n'a plus de raison d'être.
function removeCopieLocale(id) {
    try {
        localStorage.removeItem(storageKey(id));
    } catch (e) {
        console.warn('Copie locale non effacée :', e);
    }
}

// Dernier tournoi ouvert sur l'accueil : la page /tournois s'en sert pour
// marquer lequel est « en cours », qu'elle n'a aucun autre moyen de connaître.
const CLE_TOURNOI_COURANT = 'tournoi_echecs_courant';

let tournoi = {
    players: [],
    matches: [],
    semifinalMatches: [],
    finalMatches: [],
    winners: [],
    totalRounds: 0,
    currentRound: 1
};

// Les noms viennent d'autres personnes via la liste partagée : jamais injectés bruts.
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Palette des "casaques" (couleurs de course) attribuées à chaque partant
const COULEURS_CASAQUE = ['#6B2D8C', '#1B8A5A', '#D4A017', '#C1272D', '#B8860B', '#8E44AD', '#2E8B57', '#A0522D'];
function getCouleurCasaque(id) {
    return COULEURS_CASAQUE[id % COULEURS_CASAQUE.length];
}
function buildCasaque(id) {
    return `<span class="silk-dot" style="background:${getCouleurCasaque(id)};"></span>`;
}

// Classe et icône à appliquer à un joueur pour un match donné : victoire, défaite ou match nul
function getClasseResultat(match, isPlayer1) {
    if (!match.played) return '';
    const won = isPlayer1 ? match.player1Score > match.player2Score : match.player2Score > match.player1Score;
    const lost = isPlayer1 ? match.player1Score < match.player2Score : match.player2Score < match.player1Score;
    if (won) return 'winner';
    if (lost) return 'loser';
    return 'draw';
}

function getIconeResultat(match, isPlayer1) {
    const cls = getClasseResultat(match, isPlayer1);
    if (cls === 'winner') return '<span class="result-icon">👍</span>';
    if (cls === 'loser') return '<span class="result-icon">👎</span>';
    if (cls === 'draw') return '<span class="result-icon">🤝</span>';
    return '';
}

// --- Réglages d'une partie : cadence et variante ---------------------------
//
// Chaque partie se joue à sa propre cadence et dans sa propre variante : une
// poule peut mêler des blitz et des parties par correspondance. Les parties
// créées avant cet ajout n'ont pas ces champs — les valeurs par défaut
// s'appliquent alors, sans rien réécrire.

const CADENCES = [
    { valeur: '10', libelle: '10 min' },
    { valeur: '5', libelle: '5 min' },
    { valeur: '3', libelle: '3 min' },
    { valeur: '24h', libelle: '24 h' }
];
const CADENCE_DEFAUT = '10';

const VARIANTES = [
    { valeur: 'classique', libelle: 'Classique' },
    { valeur: '960', libelle: 'Chess960' }
];
const VARIANTE_DEFAUT = 'classique';

const getCadence = (match) => (CADENCES.some(c => c.valeur === match.cadence) ? match.cadence : CADENCE_DEFAUT);
const getVariante = (match) => (VARIANTES.some(v => v.valeur === match.variante) ? match.variante : VARIANTE_DEFAUT);

// Une valeur inconnue (page d'une autre version, saisie forcée) est ignorée :
// la partie garde son réglage plutôt que d'en prendre un que rien ne définit.
function setCadence(match, valeur) {
    if (!CADENCES.some(c => c.valeur === valeur)) return false;
    match.cadence = valeur;
    return true;
}

function setVariante(match, valeur) {
    if (!VARIANTES.some(v => v.valeur === valeur)) return false;
    match.variante = valeur;
    return true;
}

function buildOptions(choix, courant) {
    return choix.map(c =>
        '<option value="' + c.valeur + '"' + (c.valeur === courant ? ' selected' : '') + '>' +
        c.libelle + '</option>').join('');
}

// Les deux menus d'une partie. `onCadence` et `onVariante` sont le corps des
// gestionnaires : chaque phase désigne sa partie à sa façon.
function buildReglagesPartie(match, onCadence, onVariante) {
    return `
        <div class="partie-reglages">
            <label class="partie-reglage">
                <span class="partie-reglage-titre">Cadence</span>
                <select class="partie-cadence" onchange="${onCadence}">${buildOptions(CADENCES, getCadence(match))}</select>
            </label>
            <label class="partie-reglage">
                <span class="partie-reglage-titre">Type</span>
                <select class="partie-variante" onchange="${onVariante}">${buildOptions(VARIANTES, getVariante(match))}</select>
            </label>
        </div>
    `;
}

// Un partant dont la fiche a été supprimée garde le nom recopié à son
// inscription, mais il n'est plus rattaché à rien : le renommer depuis la page
// Joueurs n'aurait aucun effet sur lui. Autant le dire.
// Pictogrammes tracés dans la page : ni police d'icônes à charger, ni image à
// aller chercher. Ils prennent la couleur du bouton (`currentColor`) et suivent
// sa taille, donc ils ne peuvent pas se désaccorder de lui.
const PICTOS = {
    renommer: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    ouvrir:   '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    supprimer:'<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>'
              + '<path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
};

// Un bouton sans texte doit se nommer autrement : `aria-label` pour qui écoute,
// `title` pour l'infobulle de qui survole.
function buildBoutonPicto(picto, libelle, action, classe) {
    return `<button type="button" class="bouton-picto ${classe}" onclick="${action}"
                aria-label="${escapeHtml(libelle)}" title="${escapeHtml(libelle)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                     focusable="false">${PICTOS[picto]}</svg>
            </button>`;
}

function buildTagFicheAbsente() {
    return '<span class="tag-absent" title="Ce joueur n\'est plus dans la liste : son nom ne suivra plus les renommages.">fiche supprimée</span>';
}

// Applique un résultat ('p1', 'draw', 'p2', ou '' pour effacer) à un match
function applyResultat(match, value) {
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
function resolveVainqueurElo(p1, p2) {
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

    const eloWinner = resolveVainqueurElo(p1Obj, p2Obj);
    if (eloWinner) {
        return { ...base, winner: eloWinner === 'p1' ? p1Obj.id : p2Obj.id, reason: 'Elo le plus bas' };
    }

    if (matches.length < 3) {
        return { ...base, needsDecider: true };
    }

    const standings = computeClassement();
    const r1 = standings.findIndex(x => x.id === p1Obj.id);
    const r2 = standings.findIndex(x => x.id === p2Obj.id);
    return { ...base, winner: r1 < r2 ? p1Obj.id : p2Obj.id, reason: 'meilleur classement en poule' };
}

// 3e place : le mieux classé en poule parmi les deux perdants des demi-finales.
// Pas de petite finale — le bronze se déduit du classement de la poule.
function resolveTroisiemePlace() {
    const losers = tournoi.semifinalMatches
        .map(s => s.winner == null ? null : s.players.find(id => id !== s.winner))
        .filter(id => id != null);
    if (losers.length === 0) return null;
    if (losers.length === 1) return losers[0];
    const standings = computeClassement();
    const rank = id => standings.findIndex(p => p.id === id);
    return rank(losers[0]) < rank(losers[1]) ? losers[0] : losers[1];
}

// Ajoute une manche décisive (belle) à un duel resté à égalité.
function addBelle(matches) {
    const first = matches[0];
    matches.push({
        player1: first.player1,
        player2: first.player2,
        player1Score: null,
        player2Score: null,
        played: false,
        num: matches.length + 1,
        // La belle prolonge le duel : elle en reprend le format.
        cadence: getCadence(first),
        variante: getVariante(first)
    });
}

// Génère les <option> du menu déroulant de résultat, avec la sélection courante.
// `p1Name` et `p2Name` sont insérés tels quels : à l'appelant de les échapper,
// comme il le fait déjà pour les afficher ailleurs dans la même carte.
function buildOptionsResultat(match, p1Name, p2Name) {
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
