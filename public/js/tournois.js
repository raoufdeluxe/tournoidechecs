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

function closeMainMenu() {
    document.getElementById('main-menu').hidden = true;
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}

function toggleMainMenu() {
    const menu = document.getElementById('main-menu');
    const ouvert = menu.hidden;
    menu.hidden = !ouvert;
    document.getElementById('btn-menu').setAttribute('aria-expanded', String(ouvert));
}

// Le menu se referme dès qu'on choisit une entrée...
document.getElementById('main-menu').addEventListener('click', (e) => {
    if (e.target.closest('.menu-item')) closeMainMenu();
});

// ...qu'on clique ailleurs dans la page...
document.addEventListener('click', (e) => {
    if (document.getElementById('main-menu').hidden) return;
    if (e.target.closest('#main-menu') || e.target.closest('#btn-menu')) return;
    closeMainMenu();
});

// ...ou qu'on appuie sur Échap.
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMainMenu();
});

function togglePlayersPanel() {
    const panel = document.getElementById('players-panel');
    if (!panel.hidden) { panel.hidden = true; return; }

    // Le nom du tournoi détermine son adresse : le renommer déplace le tournoi
    // vers un nouveau lien, et l'ancien cesse de fonctionner.
    let html = `
        <div class="tournament-row">
            <div class="tournament-row-name">Nom du tournoi</div>
            <input type="text" id="rename-tournament" class="rename-input" maxlength="64"
                   placeholder="Sans nom" value="${escapeHtml(tournament.name || '')}">
        </div>
        <div class="tournaments-empty">Le lien suit le nom : le renommer remplacera <strong>…/#${escapeHtml(tournamentId)}</strong> par une nouvelle adresse, et l'ancienne cessera de fonctionner.</div>
    `;

    // Les partants rattachés à une fiche se renomment sur la page Joueurs :
    // leur nom appartient à la fiche, pas à ce tournoi.
    html += tournament.players.length
        ? tournament.players.map((p, i) => p.ref
            ? `
            <div class="tournament-row">
                <div class="tournament-row-name">${silkDot(p.id)}Partant n°${i + 1}</div>
                <div class="tournament-row-meta">${escapeHtml(p.name)} — <a href="./joueurs">modifier dans Joueurs</a></div>
            </div>
        ` : `
            <div class="tournament-row">
                <div class="tournament-row-name">${silkDot(p.id)}Partant n°${i + 1}</div>
                <input type="text" class="rename-input" data-player="${p.id}" maxlength="40" value="${escapeHtml(p.name)}">
            </div>
        `).join('')
        : '<div class="tournaments-empty">Aucun partant inscrit pour le moment.</div>';

    document.getElementById('players-editor').innerHTML = html;
    panel.hidden = false;
}

// Déplace le tournoi vers un nouvel identifiant : on écrit d'abord à la nouvelle
// adresse, et on ne supprime l'ancienne qu'une fois la copie confirmée — jamais
// l'inverse, sous peine de perdre le tournoi si l'écriture échoue.
// Oublie la copie hors-ligne d'un tournoi qui n'existe plus à cette adresse.

async function moveTournament(nouveauId) {
    const ancienId = tournamentId;

    let res;
    try {
        res = await fetch(urlEtat(nouveauId), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion: 0, state: currentState() })
        });
    } catch (e) {
        return false;
    }
    if (!res.ok) return false;

    const data = await res.json().catch(() => null);
    tournamentId = nouveauId;
    noterTournoiCourant();
    remoteVersion = (data && typeof data.version === 'number') ? data.version : 0;
    history.replaceState(null, '', '#' + nouveauId);

    // L'ancienne adresse n'a plus lieu d'être. Si la suppression échoue, le tournoi
    // reste accessible aux deux liens : gênant, mais sans perte de données.
    try {
        await fetch(urlEtat(ancienId), { method: 'DELETE' });
        deletedThisSession.add(ancienId);
    } catch (e) {
        console.warn('Ancienne adresse non supprimée :', e);
    }

    // Sans cela, rouvrir l'ancien lien depuis ce navigateur relirait la copie
    // locale et recréerait le tournoi à l'adresse qu'on vient d'abandonner.
    forgetLocalCopy(ancienId);
    return true;
}

async function savePlayerNames() {
    // [data-player] : on exclut le champ du nom du tournoi, qui peut rester vide.
    const inputs = Array.from(document.querySelectorAll('.rename-input[data-player]'));
    if (inputs.some(el => !el.value.trim())) {
        alert('Tous les noms doivent être remplis.');
        return;
    }

    const champNom = document.getElementById('rename-tournament');
    const nouveauNom = champNom ? champNom.value.trim() : '';
    const nouveauSlug = slugify(nouveauNom);
    const deplacement = Boolean(nouveauSlug) && nouveauSlug !== tournamentId;

    if (deplacement) {
        if (await isIdTaken(nouveauSlug)) {
            alert('Un tournoi nommé « ' + nouveauNom + ' » existe déjà.\n\n' +
                  'Choisis un autre nom, ou ouvre-le avec son lien (…/#' + nouveauSlug + ').');
            return;
        }
        if (!confirm('Le lien du tournoi va devenir :\n…/#' + nouveauSlug + '\n\n' +
                     'L\'ancien lien (…/#' + tournamentId + ') cessera de fonctionner. ' +
                     'Préviens les personnes à qui tu l\'as partagé.\n\nContinuer ?')) {
            return;
        }
    }

    tournament.name = nouveauNom || null;

    // Seuls les partants sans fiche se renomment ici (tournois d'avant les fiches).
    inputs.forEach(el => {
        tournament.players[Number(el.dataset.player)].name = el.value.trim();
    });

    if (deplacement && !await moveTournament(nouveauSlug)) {
        alert('Le tournoi n\'a pas pu être déplacé vers sa nouvelle adresse.\n\n' +
              'Il reste accessible par son lien actuel, avec les noms mis à jour.');
    }

    document.getElementById('players-panel').hidden = true;
    updateTournamentTitle();
    refreshCurrentScreen();
}

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

async function copyTournamentLink() {
    const btn = document.getElementById('btn-copy-link');
    try {
        await navigator.clipboard.writeText(location.href);
    } catch (e) {
        // Presse-papier refusé (permission, page non sécurisée) : on montre le lien.
        prompt('Copie ce lien pour retrouver ou partager ce tournoi :', location.href);
        return;
    }
    btn.textContent = '✓ Lien copié';
    setTimeout(() => { btn.textContent = '🔗 Copier le lien'; }, 2000);
}
