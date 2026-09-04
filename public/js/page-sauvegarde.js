// Page /sauvegarde : exporter, importer, et tout effacer.
//
// Ces trois actions portent sur l'application entière — tournois et fiches de
// joueurs à la fois. Elles ne sont donc chez aucune des deux listes.

const MOT_DE_CONFIRMATION = 'EFFACER';

async function chargerResume() {
    const el = document.getElementById('sauvegarde-resume');

    let nbTournois;
    try {
        const res = await fetch(URL_TOURNOIS);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        nbTournois = ((data && data.tournaments) || []).length;
    } catch (e) {
        el.textContent = 'État indisponible — hors ligne ?';
        return;
    }

    await chargerJoueurs();
    const pluriel = (n, mot) => n + ' ' + mot + (n > 1 ? 's' : '');
    el.textContent = 'Actuellement : ' + pluriel(nbTournois, 'tournoi') +
        ' et ' + pluriel(joueurs.length, 'fiche') + ' de joueur.';
}

// Après une restauration : les compteurs ont bougé.
async function rafraichirApresRestauration() {
    await chargerResume();
}

// Suppression de masse : irréversible, et visible par tous ceux qui ont un lien.
// Une confirmation ordinaire ne suffit pas — on fait écrire le mot.
async function toutEffacer() {
    const bouton = document.getElementById('btn-raz');
    const avancement = document.getElementById('raz-progress');

    let ids;
    try {
        const res = await fetch(URL_TOURNOIS);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        ids = ((data && data.tournaments) || []).map(t => t.id);
    } catch (e) {
        alert('Impossible de lire la liste des tournois : ' + e.message);
        return;
    }

    if (!ids.length && !joueurs.length) {
        alert('Il n\'y a rien à effacer.');
        return;
    }

    const quoi = ids.length + ' tournoi(s) et ' + joueurs.length + ' fiche(s) de joueur';
    const reponse = prompt(
        'Effacer ' + quoi + ' ?\n\n' +
        'C\'est définitif, pour tout le monde : les liens déjà partagés cesseront de fonctionner.\n\n' +
        'Écris ' + MOT_DE_CONFIRMATION + ' pour confirmer.');

    if (reponse == null) return;
    if (reponse.trim().toUpperCase() !== MOT_DE_CONFIRMATION) {
        alert('Rien n\'a été effacé.');
        return;
    }

    bouton.disabled = true;
    const echecs = [];
    let effaces = 0;

    for (const id of ids) {
        avancement.textContent = 'Suppression ' + (effaces + echecs.length + 1) + '/' + ids.length + ' — ' + id;
        try {
            const res = await fetch(urlEtat(id), { method: 'DELETE' });
            if (!res.ok) throw new Error('réponse ' + res.status);
            effaces++;
            oublierCopieLocale(id);
        } catch (e) {
            echecs.push(id + ' (' + e.message + ')');
        }
    }

    let fiches = 0;
    if (joueurs.length) {
        avancement.textContent = 'Suppression des fiches…';
        fiches = joueurs.length;
        if (!await remplacerJoueurs([])) {
            echecs.push('la liste des joueurs');
            fiches = 0;
        }
    }

    try {
        localStorage.removeItem(CLE_TOURNOI_COURANT);
    } catch (e) {
        console.warn('Tournoi courant non oublié :', e);
    }

    avancement.textContent = '';
    bouton.disabled = false;
    await chargerResume();

    alert(effaces + ' tournoi(s) et ' + fiches + ' fiche(s) effacés' +
        (echecs.length ? '.\n\nEn échec :\n' + echecs.join('\n') : '.'));
}

// La copie locale d'un tournoi supprimé n'a plus de raison d'être.
function oublierCopieLocale(id) {
    try {
        localStorage.removeItem(storageKey(id));
    } catch (e) {
        console.warn('Copie locale non effacée :', e);
    }
}

chargerResume();
