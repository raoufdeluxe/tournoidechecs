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

// Palette des "casaques" (couleurs de course) attribuées à chaque partant.
// Huit teintes tenues à l'écart les unes des autres : chaque paire reste
// séparée sur le fond crème, y compris pour un œil daltonien (ΔE OKLab ≥ 8 en
// protanopie et deutéranopie, ≥ 15 en vision normale, contraste ≥ 3:1).
// L'ordre est fixe — une casaque appartient au partant, pas à son rang.
// Au-delà de huit, la palette se répète : aucune neuvième teinte ne tiendrait
// l'écart, c'est le trait du graphe qui départage les jumeaux de couleur.
const COULEURS_CASAQUE = [
    '#862C92', // violet
    '#0E8050', // vert
    '#BF860C', // or
    '#C23E16', // rouge
    '#0062C7', // bleu
    '#159CB7', // turquoise
    '#E85E8D', // rose
    '#9077F1'  // lavande
];
function getCouleurCasaque(id) {
    return COULEURS_CASAQUE[id % COULEURS_CASAQUE.length];
}
// Vrai pour les partants du second tour de palette : ceux qui partagent leur
// couleur avec un autre et ont besoin d'un second signe pour s'en distinguer.
function isCasaqueRepetee(id) {
    return id >= COULEURS_CASAQUE.length;
}
function buildCasaque(id) {
    return `<span class="silk-dot" style="background:${getCouleurCasaque(id)};"></span>`;
}

// Classe et icône à appliquer à un joueur pour un match donné : victoire, défaite ou match nul
// Le sort d'un partant dans une manche, porté par la couleur de sa case :
// vert pour la victoire, rouge pour la défaite, or pour la nulle.
function getClasseResultat(match, isPlayer1) {
    if (!match.played) return '';
    const won = isPlayer1 ? match.player1Score > match.player2Score : match.player2Score > match.player1Score;
    const lost = isPlayer1 ? match.player1Score < match.player2Score : match.player2Score < match.player1Score;
    if (won) return 'winner';
    if (lost) return 'loser';
    return 'draw';
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
    { valeur: '24h', libelle: '24 h' },
    // Le format d'une partie relue sur chess.com qui ne tombe dans aucun des
    // quatre : trois jours par coup, un 15|10. Mieux vaut le dire qu'afficher
    // une cadence qui n'a pas été jouée.
    { valeur: 'autre', libelle: 'Autre' }
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

// Le lien vers la partie jouée en ligne (chess.com et consorts). Il finit dans
// un href, et l'état d'un tournoi s'écrit depuis n'importe quel appareil ayant
// l'adresse : on ne retient qu'une vraie adresse http(s) — un « javascript: »
// glissé là s'exécuterait au clic. Le contrôle vaut à l'écriture comme à la
// lecture, pour ne pas poser dans la page ce qu'un état ancien contiendrait.
const MOTIF_LIEN = /^https?:\/\/\S+$/i;

const getLien = (match) => (MOTIF_LIEN.test(match.lien || '') ? match.lien : '');

// Un champ vidé efface le lien ; une adresse qui n'en est pas une est refusée,
// et la partie garde celui qu'elle avait.
function setLien(match, valeur) {
    const propre = String(valeur == null ? '' : valeur).trim();
    if (propre === '') {
        delete match.lien;
        delete match.analyse;
        return true;
    }
    if (!MOTIF_LIEN.test(propre)) return false;
    match.lien = propre;
    return true;
}

function buildOptions(choix, courant) {
    return choix.map(c =>
        '<option value="' + c.valeur + '"' + (c.valeur === courant ? ' selected' : '') + '>' +
        c.libelle + '</option>').join('');
}

// Toutes les manches d'un tournoi, quelle que soit la phase : la poule, les
// deux demi-finales, la finale.
function getManches(tournoi) {
    return [
        ...(tournoi.matches || []),
        ...(tournoi.semifinalMatches || []).flatMap(s => s.matches || []),
        ...(tournoi.finalMatches || []),
    ];
}

// Les champs d'un résumé que l'application lit encore. Un tournoi enregistré
// par une version antérieure en porte d'autres — l'Elo chess.com, la date, le
// code d'ouverture — que plus personne n'affiche. On ne les garde pas en
// mémoire : le prochain enregistrement du tournoi s'en débarrasse, et celui
// qu'on n'ouvre jamais n'est pas réécrit pour autant.
const CHAMPS_ANALYSE = ['blancs', 'noirs', 'resultat', 'fin', 'coups'];

function nettoieAnalyse(manche) {
    if (!manche.analyse) return;
    for (const champ of Object.keys(manche.analyse)) {
        if (!CHAMPS_ANALYSE.includes(champ)) delete manche.analyse[champ];
    }
}

function nettoieAnalyses(tournoi) {
    getManches(tournoi).forEach(nettoieAnalyse);
}

// --- Une manche, où qu'elle soit ------------------------------------------
//
// La poule désigne ses duels par leur identifiant, une demie par sa manche, la
// finale par son rang. Un seul chemin dit les trois — 'poule:0-1-leg1',
// 'demie:0:1', 'finale:1' — et les cartes n'ont plus qu'à le porter.
// Le résolveur rend la manche visée et ce qu'il faut faire après l'avoir
// touchée : la poule se redessine, une demie vérifie s'il faut une belle, la
// finale si le titre est joué. Ces fonctions-là vivent dans poule.js et
// finales.js, que seul l'accueil charge — seul endroit où une carte existe.
function resolveManche(chemin) {
    const [phase, a, b] = String(chemin).split(':');
    if (phase === 'demie') {
        return { match: tournoi.semifinalMatches[a].matches[b], render: renderDemies, apresResultat: checkDemiesTerminees };
    }
    if (phase === 'finale') {
        return { match: tournoi.finalMatches[a], render: renderFinale, apresResultat: checkFinaleTerminee };
    }
    return { match: tournoi.matches.find(m => m.id === a), render: renderPoule, apresResultat: renderPoule };
}

// Cadence et type : le menu montre déjà la valeur choisie, rien à redessiner.
function setCadenceManche(chemin, valeur) {
    if (setCadence(resolveManche(chemin).match, valeur)) saveEtat();
}

function setVarianteManche(chemin, valeur) {
    if (setVariante(resolveManche(chemin).match, valeur)) saveEtat();
}

// Relit la partie en ligne et en tire tout ce qu'elle apprend. Rend faux si
// chess.com n'a rien à dire — lien d'un autre site, partie privée, réseau coupé.
async function updateAnalyseManche(chemin) {
    const { match, render, apresResultat } = resolveManche(chemin);
    const lien = getLien(match);
    if (!lien) return false;

    const analyse = await fetchAnalyse(lien);
    // Le lien a pu changer pendant l'aller-retour : on ne colle pas le résumé
    // d'une partie sur une autre.
    if (!analyse || getLien(match) !== lien) return false;

    match.analyse = analyse;

    // La cadence et le type ne se devinent plus : la partie a été jouée, on sait
    // à quel format. Le réglage d'avance cède devant ce qui s'est passé — une
    // valeur que le tournoi ne sait pas nommer est refusée par setCadence.
    setCadence(match, analyse.cadence);
    setVariante(match, analyse.variante);
    nettoieAnalyse(match);

    // Les pseudos des fiches disent lequel des deux partants a gagné : autant
    // remplir le résultat s'il ne l'est pas encore. Déjà saisi, on n'y touche
    // pas — c'est la ligne du résumé qui signalera un désaccord.
    const reconnu = resolveResultatAnalyse(match, analyse);
    if (reconnu && !match.played) {
        applyResultat(match, reconnu);
        apresResultat();
        return true;
    }

    render();
    return true;
}

// Le bouton de la carte : on redemande à chess.com où en est la partie, et on
// le dit — c'est un geste volontaire, il mérite une réponse. Le redessin qui
// suit enregistre le tournoi comme n'importe quelle autre saisie.
async function syncManche(chemin) {
    if (await updateAnalyseManche(chemin)) notifySucces('Partie relue sur chess.com.');
    else notifyErreur('chess.com ne dit rien de cette partie.');
}

// Le lien accepté, la carte se redessine aussitôt : c'est ainsi qu'apparaît
// « Ouvrir ». Le résumé de la partie arrive après, si chess.com en a un à
// donner — on ne fait pas attendre la saisie pour ça, et on ne se plaint pas
// d'un lien qui mène ailleurs.
async function setLienManche(chemin, valeur) {
    const { match, render } = resolveManche(chemin);
    if (!setLien(match, valeur)) {
        notifyErreur('Le lien doit être une adresse commençant par http:// ou https://');
        return;
    }

    delete match.analyse;
    render();
    await updateAnalyseManche(chemin);
}

function setResultatManche(chemin, valeur) {
    const { match, apresResultat } = resolveManche(chemin);
    applyResultat(match, valeur);
    apresResultat();
}

// Le pseudo chess.com d'un partant, tel que sa fiche le porte. Il ne sort jamais
// d'ici : il sert à reconnaître les joueurs d'une partie en ligne, pas à les
// nommer — seule la page Joueurs affiche un pseudo.
function getPseudoPartant(partantId) {
    const partant = (tournoi.players || [])[partantId];
    if (!partant || !partant.ref || typeof getJoueur !== 'function') return '';
    const fiche = getJoueur(partant.ref);
    return (fiche && fiche.pseudo) || '';
}

// Ce que le résumé dit du résultat de CETTE manche : 'p1', 'p2', 'draw'. Rien si
// les pseudos de la partie ne sont pas ceux des deux partants — c'est alors une
// partie entre d'autres joueurs, ou des fiches sans pseudo.
function resolveResultatAnalyse(match, analyse) {
    if (!analyse) return '';
    const meme = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();
    const p1 = getPseudoPartant(match.player1);
    const p2 = getPseudoPartant(match.player2);

    let premierEnBlanc;
    if (meme(p1, analyse.blancs) && meme(p2, analyse.noirs)) premierEnBlanc = true;
    else if (meme(p1, analyse.noirs) && meme(p2, analyse.blancs)) premierEnBlanc = false;
    else return '';

    if (analyse.resultat === '1/2-1/2') return 'draw';
    if (analyse.resultat === '1-0') return premierEnBlanc ? 'p1' : 'p2';
    if (analyse.resultat === '0-1') return premierEnBlanc ? 'p2' : 'p1';
    return '';
}

// Ce que chess.com dit de la partie, en une ligne — ce que la carte ne dit pas
// déjà : la cadence et le type sont réglés juste au-dessus. Le vainqueur porte le nom de
// ton partant quand les pseudos le désignent ; sinon la partie se dit par ses
// couleurs, faute de savoir qui est qui. Tout ce qui vient de là-bas est
// échappé : le résumé transite par l'état partagé.
function buildPhraseAnalyse(match, analyse) {
    const dit = (valeur) => escapeHtml(String(valeur));
    const reconnu = resolveResultatAnalyse(match, analyse);

    let issue;
    if (reconnu === 'draw' || analyse.resultat === '1/2-1/2') issue = 'partie nulle';
    else if (reconnu) issue = `${buildNomPartant(reconnu === 'p1' ? match.player1 : match.player2)} l'emporte`;
    else if (analyse.resultat === '1-0') issue = 'victoire des blancs';
    else if (analyse.resultat === '0-1') issue = 'victoire des noirs';
    else issue = null;
    if (issue && analyse.fin) issue += ` par ${dit(analyse.fin)}`;

    // Le menu fait foi : si le résumé le contredit, on le dit plutôt que de
    // changer le résultat dans le dos de qui l'a saisi.
    const saisi = getResultatManche(match);
    const desaccord = reconnu && saisi && reconnu !== saisi;

    return [
        analyse.coups ? `${dit(analyse.coups)} coups` : null,
        issue,
        desaccord ? '<strong>en désaccord avec le résultat saisi</strong>' : null,
    ].filter(Boolean).join(' · ');
}

// Le lien de la partie en ligne, sous le résultat : le champ pour l'écrire, et
// de quoi l'ouvrir dès qu'il y en a un.
function buildLienPartie(match, chemin) {
    const lien = getLien(match);
    return `
        <div class="partie-lien">
            <label class="partie-reglage">
                <span class="partie-reglage-titre">Lien de la partie</span>
                <input type="url" value="${escapeHtml(lien)}"
                       onchange="setLienManche('${chemin}', this.value)"
                       placeholder="https://www.chess.com/game/live/…">
            </label>
            ${lien ? `<div class="partie-lien-actions">
                <a class="partie-lien-ouvrir" href="${escapeHtml(lien)}"
                   target="_blank" rel="noopener">Ouvrir ↗</a>
                ${buildBoutonPicto('synchroniser', 'Relire la partie sur chess.com',
                                   `syncManche('${chemin}')`)}
            </div>` : ''}
        </div>
        ${lien && match.analyse ? `<p class="partie-analyse">${buildPhraseAnalyse(match, match.analyse)}</p>` : ''}
    `;
}

// Les deux menus d'une partie.
function buildReglagesPartie(match, chemin) {
    return `
        <div class="partie-reglages">
            <label class="partie-reglage">
                <span class="partie-reglage-titre">Cadence</span>
                <select onchange="setCadenceManche('${chemin}', this.value)">${buildOptions(CADENCES, getCadence(match))}</select>
            </label>
            <label class="partie-reglage">
                <span class="partie-reglage-titre">Type</span>
                <select onchange="setVarianteManche('${chemin}', this.value)">${buildOptions(VARIANTES, getVariante(match))}</select>
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
    // Les deux flèches en cercle de la synchronisation.
    synchroniser:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'
              + '<path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    supprimer:'<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/>'
              + '<path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"/><path d="M10 11v6"/><path d="M14 11v6"/>'
};

// Un bouton sans texte doit se nommer autrement : `aria-label` pour qui écoute,
// `title` pour l'infobulle de qui survole.
function buildBoutonPicto(picto, libelle, action, classe = '') {
    return `<button type="button" class="${['bouton-picto', classe].filter(Boolean).join(' ')}" onclick="${action}"
                aria-label="${escapeHtml(libelle)}" title="${escapeHtml(libelle)}">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
                     focusable="false">${PICTOS[picto]}</svg>
            </button>`;
}

// Ce qu'on sait d'un partant en plus de son nom : son pseudo chess.com et son
// classement, « Raf_Deluxe - 1431 ». La fiche fait foi — le tournoi n'en garde
// qu'une copie de repli.
function buildInfobullePartant(partant) {
    const fiche = (partant.ref && typeof getJoueur === 'function') ? getJoueur(partant.ref) : null;
    const elo = fiche && fiche.elo != null ? fiche.elo : partant.elo;
    const pseudo = fiche && fiche.pseudo;
    return [pseudo || null, elo != null ? elo : null].filter(v => v != null).join(' - ');
}

// Le nom d'un partant, partout où il s'affiche : au survol, l'infobulle dit son
// pseudo et son Elo. Sans rien à dire de plus, le nom reste un nom — une
// infobulle vide se remarquerait pour rien.
function buildNomPartant(partantId) {
    const partant = (tournoi.players || [])[partantId];
    if (!partant) return '';
    const infobulle = buildInfobullePartant(partant);
    return infobulle
        ? `<span title="${escapeHtml(infobulle)}">${escapeHtml(partant.name)}</span>`
        : escapeHtml(partant.name);
}

function buildTagFicheAbsente() {
    return '<span class="etiquette tag-absent" title="Ce joueur n\'est plus dans la liste : son nom ne suivra plus les renommages.">fiche supprimée</span>';
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

// La carte d'un duel. Repliée, elle ne montre que l'affiche : les deux partants,
// leur sort et leur terrain — de quoi lire une journée entière d'un coup d'œil.
// Ouverte, elle donne la cadence, le type et le résultat. Poule, demi-finales et
// finale s'en servent ; ne changent que le serrage de la carte, la casaque à
// côté des noms et les gestionnaires, que chaque phase écrit à sa façon.
function buildCarteDuel(match, chemin, { modifieur = '', casaques = false } = {}) {
    const partants = [tournoi.players[match.player1], tournoi.players[match.player2]];

    const cote = (premier) => {
        const p = partants[premier ? 0 : 1];
        return `<div class="player-result ${getClasseResultat(match, premier)}">
                    ${casaques ? buildCasaque(p.id) : ''}${buildNomPartant(p.id)}
                    ${buildBadgeTerrain(match, premier)}
                </div>`;
    };

    return `
        <details class="surface carte-duel${modifieur ? ' ' + modifieur : ''}">
            <summary>
                <div class="match-card">
                    ${cote(true)}
                    <div class="vs-indicator">vs</div>
                    ${cote(false)}
                </div>
                <span class="carte-duel-chevron" aria-hidden="true">▾</span>
            </summary>
            <div class="carte-duel-corps">
                ${buildReglagesPartie(match, chemin)}
                <select class="result-select" onchange="setResultatManche('${chemin}', this.value)">
                    ${buildOptionsResultat(match, escapeHtml(partants[0].name), escapeHtml(partants[1].name))}
                </select>
                ${buildLienPartie(match, chemin)}
            </div>
        </details>
    `;
}

// La part des duels déjà joués d'une phase, portée par sa barre d'avancement.
function renderBarreProgression(elementId, duels) {
    const joues = duels.filter(m => m.played).length;
    document.getElementById(elementId).style.width =
        (duels.length ? (joues / duels.length) * 100 : 0) + '%';
}

// Le résultat d'une manche dans la langue du menu : 'p1', 'p2', 'draw', ou rien
// tant qu'elle n'est pas jouée.
function getResultatManche(match) {
    if (!match.played) return '';
    if (match.player1Score > match.player2Score) return 'p1';
    if (match.player2Score > match.player1Score) return 'p2';
    return 'draw';
}

// Génère les <option> du menu déroulant de résultat, avec la sélection courante.
// `p1Name` et `p2Name` sont insérés tels quels : à l'appelant de les échapper,
// comme il le fait déjà pour les afficher ailleurs dans la même carte.
function buildOptionsResultat(match, p1Name, p2Name) {
    const selected = getResultatManche(match);
    return `
        <option value="" ${selected === '' ? 'selected' : ''}>Résultat à définir…</option>
        <option value="p1" ${selected === 'p1' ? 'selected' : ''}>🏆 Victoire — ${p1Name}</option>
        <option value="draw" ${selected === 'draw' ? 'selected' : ''}>🤝 Match nul</option>
        <option value="p2" ${selected === 'p2' ? 'selected' : ''}>🏆 Victoire — ${p2Name}</option>
    `;
}
