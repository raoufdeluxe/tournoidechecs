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

// Vide tant qu'aucun tournoi n'est ouvert : l'accueil n'en invente pas un à
// chaque visite. Un identifiant n'apparaît qu'au premier « Donner le départ »,
// sinon la moindre visite laissait un tournoi fantôme dans la liste partagée.
let idTournoi = '';

function getDernierTournoi() {
    try {
        const id = localStorage.getItem(CLE_TOURNOI_COURANT);
        return ID_PATTERN.test(id || '') ? id : null;
    } catch (e) {
        return null;
    }
}

// Sans lien explicite, l'accueil reprend le dernier tournoi ouvert : c'est
// presque toujours celui qu'on vient consulter. La provenance compte : un lien
// qu'on nous a partagé reste valable même si le tournoi n'existe pas encore,
// alors qu'un repère local périmé n'a plus rien à désigner.
function resolveTournoiAOuvrir() {
    const depuisLien = location.hash.replace(/^#/, '').trim();
    if (ID_PATTERN.test(depuisLien)) return { id: depuisLien, source: 'lien' };

    const dernier = getDernierTournoi();
    return dernier ? { id: dernier, source: 'repere' } : null;
}

// Donne son identifiant au tournoi et l'inscrit dans l'adresse de la page.
function setIdTournoi(id) {
    idTournoi = id;
    history.replaceState(null, '', '#' + id);
    saveTournoiCourant();
}

// L'accueil s'était ouvert sur un tournoi qui n'existe plus : on oublie le
// repère plutôt que de laisser une adresse morte dans la barre.
function forgetTournoiCourant() {
    idTournoi = '';
    history.replaceState(null, '', location.pathname);
    try {
        localStorage.removeItem(CLE_TOURNOI_COURANT);
    } catch (e) {
        console.warn('Repère du tournoi non effacé :', e);
    }
}

const urlEtatCourant = () => urlEtat(idTournoi);

// La page /tournois n'a aucun autre moyen de savoir lequel tourne ici.
function saveTournoiCourant() {
    if (!idTournoi) return;
    try {
        localStorage.setItem(CLE_TOURNOI_COURANT, idTournoi);
    } catch (e) {
        console.warn('Tournoi courant non mémorisé :', e);
    }
}



// Le nom du tournoi est le titre de la page : c'est ce qu'on vient y lire.
// Sans tournoi ouvert, il dit ce qui s'apprête à en devenir un.
function renderTitreTournoi() {
    const nom = document.getElementById('tournament-name-display');
    if (!nom) return;

    const partants = (tournoi.players || []).length;
    nom.textContent = (!idTournoi && !partants)
        ? 'Nouveau tournoi'
        : (tournoi.name || 'Tournoi sans nom');
}

// Coller le lien d'un autre tournoi dans la barre d'adresse ne recharge pas
// la page de lui-même : on force le rechargement pour repartir sur le bon état.
window.addEventListener('hashchange', () => location.reload());
