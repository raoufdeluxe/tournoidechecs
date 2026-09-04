// Identite du tournoi (lien, nom), liste des tournois, renommage des partants

// Plusieurs tournois peuvent tourner en parallèle : chacun vit sous son propre
// identifiant, porté par l'URL (…/#abc123). Partager un tournoi = partager son lien.
// L'identifiant n'est pas un secret : qui a le lien peut lire et modifier.

function newTournamentId() {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // sans caractères ambigus (l, o, 0, 1)
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

let tournamentId = (location.hash.replace(/^#/, '').trim() || '');
if (!ID_PATTERN.test(tournamentId)) {
    tournamentId = newTournamentId();
    history.replaceState(null, '', '#' + tournamentId);
}

const stateUrl = () => urlEtat(tournamentId);

// La page /tournois n'a aucun autre moyen de savoir lequel tourne ici.
function noterTournoiCourant() {
    try {
        localStorage.setItem(CLE_TOURNOI_COURANT, tournamentId);
    } catch (e) {
        console.warn('Tournoi courant non mémorisé :', e);
    }
}
noterTournoiCourant();

// Déplace le tournoi vers un nouvel identifiant : on écrit d'abord à la nouvelle
// adresse, et on ne supprime l'ancienne qu'une fois la copie confirmée — jamais
// l'inverse, sous peine de perdre le tournoi si l'écriture échoue.
// Oublie la copie hors-ligne d'un tournoi qui n'existe plus à cette adresse.

// Réaffiche l'écran courant après un changement de noms, quel qu'il soit.
function refreshCurrentScreen() {
    const active = document.querySelector('.screen.active');
    const id = active ? active.id : null;

    if (id === 'screen-config') {
        // Sur l'ecran d'inscription, ce sont les champs du formulaire qui font foi
        // au demarrage : sans cette resynchronisation, « Donner le depart » relirait
        // les anciens noms et annulerait le renommage.
        document.getElementById('tournament-name').value = tournament.name || '';
        const champs = document.querySelectorAll('.player-name');
        tournament.players.forEach((p, i) => { if (champs[i]) champs[i].value = p.name; });
    } else if (id === 'screen-tournament') {
        renderTournament();
    } else if (id === 'screen-semifinals') {
        checkSemifinalsComplete();
    } else if (id === 'screen-finals') {
        checkFinalsComplete();
    } else if (id === 'screen-results' && tournament.championId != null && tournament.runnerId != null) {
        displayResults(tournament.players[tournament.championId], tournament.players[tournament.runnerId]);
    }
    saveState();
}



function updateTournamentTitle() {
    const el = document.getElementById('tournament-name-display');
    el.textContent = tournament.name || '';
    el.hidden = !tournament.name;
}

// Coller le lien d'un autre tournoi dans la barre d'adresse ne recharge pas
// la page de lui-même : on force le rechargement pour repartir sur le bon état.
window.addEventListener('hashchange', () => location.reload());
