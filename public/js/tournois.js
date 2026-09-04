// Identite du tournoi (lien, nom), liste des tournois, renommage des partants

// Plusieurs tournois peuvent tourner en parallèle : chacun vit sous son propre
// identifiant, porté par l'URL (…/#abc123). Partager un tournoi = partager son lien.
// L'identifiant n'est pas un secret : qui a le lien peut lire et modifier.

function newIdTournoi() {
    const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // sans caractères ambigus (l, o, 0, 1)
    const bytes = new Uint8Array(10);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
}

let idTournoi = (location.hash.replace(/^#/, '').trim() || '');
if (!ID_PATTERN.test(idTournoi)) {
    idTournoi = newIdTournoi();
    history.replaceState(null, '', '#' + idTournoi);
}

const urlEtatCourant = () => urlEtat(idTournoi);

// La page /tournois n'a aucun autre moyen de savoir lequel tourne ici.
function saveTournoiCourant() {
    try {
        localStorage.setItem(CLE_TOURNOI_COURANT, idTournoi);
    } catch (e) {
        console.warn('Tournoi courant non mémorisé :', e);
    }
}
saveTournoiCourant();



function renderTitreTournoi() {
    const el = document.getElementById('tournament-name-display');
    el.textContent = tournoi.name || '';
    el.hidden = !tournoi.name;
}

// Coller le lien d'un autre tournoi dans la barre d'adresse ne recharge pas
// la page de lui-même : on force le rechargement pour repartir sur le bon état.
window.addEventListener('hashchange', () => location.reload());
