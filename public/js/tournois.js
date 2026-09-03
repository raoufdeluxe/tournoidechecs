// Identite du tournoi (lien, nom), liste des tournois, renommage des partants

// --- Sauvegarde partagée (Cloudflare Worker + KV), avec repli localStorage hors-ligne ---
// Le Worker sert cette page ET l'API : un chemin relatif suffit et survit
// à un renommage du Worker ou à l'ajout d'un domaine perso.
// Seul le cas « fichier ouvert en double-clic » (file://) a besoin de l'URL complète.
const API_BASE = location.protocol === 'file:'
    ? 'https://echecs.vodkafunk.workers.dev/state'
    : '/state';

// Plusieurs tournois peuvent tourner en parallèle : chacun vit sous son propre
// identifiant, porté par l'URL (…/#abc123). Partager un tournoi = partager son lien.
// L'identifiant n'est pas un secret : qui a le lien peut lire et modifier.
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

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

const stateUrl = () => API_BASE + '?id=' + encodeURIComponent(tournamentId);

// « Tournoi des potes » -> « tournoi-des-potes », pour servir d'adresse lisible.
function slugify(name) {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '');
}

// Un nom déjà utilisé pointerait sur le tournoi de quelqu'un d'autre : on vérifie.
async function isIdTaken(id) {
    try {
        const res = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
        if (!res.ok) return false;
        const data = await res.json();
        const t = data && data.state && data.state.tournament;
        return !!(t && Array.isArray(t.players) && t.players.length > 0);
    } catch (e) {
        return false; // hors ligne : on ne bloque pas la création
    }
}

const TOURNAMENTS_URL = API_BASE.replace(/\/state$/, '/tournaments');

// Dernière liste affichée : évite de faire transiter les noms par des attributs HTML.
let lastTournamentsList = [];

// Tournois supprimés depuis cet onglet. L'index du serveur peut mettre
// quelques secondes à refléter une suppression : on les masque en attendant,
// pour que la liste corresponde à ce que l'on vient de faire.
const deletedThisSession = new Set();

const SCREEN_LABELS = {
    'screen-config':     'Inscription',
    'screen-tournament': 'Phase de poule',
    'screen-semifinals': 'Demi-finales',
    'screen-finals':     'Grande finale',
    'screen-results':    'Terminé'
};

// Les noms viennent d'autres personnes via la liste partagée : jamais injectés bruts.
function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Menu hamburger ---
// Les entrées appellent les mêmes fonctions qu'avant : seul l'emballage change.

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

function toggleTournamentsPanel() {
    const panel = document.getElementById('tournaments-panel');
    if (!panel.hidden) { panel.hidden = true; return; }
    panel.hidden = false;
    loadTournamentsList();
}

async function loadTournamentsList() {
    const list = document.getElementById('tournaments-list');
    list.innerHTML = '<div class="tournaments-empty">Chargement…</div>';

    let data;
    try {
        const res = await fetch(TOURNAMENTS_URL);
        if (!res.ok) throw new Error(res.status);
        data = await res.json();
    } catch (e) {
        list.innerHTML = '<div class="tournaments-empty">Liste indisponible — hors ligne ?</div>';
        return;
    }

    const items = ((data && data.tournaments) || [])
        .filter(t => !deletedThisSession.has(t.id));

    // L'index du serveur met quelques secondes à référencer un tournoi tout
    // juste créé. On ajoute le tournoi courant s'il n'y figure pas encore,
    // pour ne pas donner l'impression qu'il n'a pas été enregistré.
    if (tournament.players.length && !items.some(t => t.id === tournamentId)) {
        const ecran = document.querySelector('.screen.active');
        items.unshift({
            id: tournamentId,
            name: tournament.name || null,
            screen: ecran ? ecran.id : null,
            players: tournament.players.length,
            updatedAt: new Date().toISOString()
        });
    }

    lastTournamentsList = items;
    if (!items.length) {
        list.innerHTML = '<div class="tournaments-empty">Aucun tournoi enregistré pour l\'instant.</div>';
        return;
    }

    list.innerHTML = items.map(renderTournamentRow).join('') +
        (data.complete === false
            ? '<div class="tournaments-empty">Seuls les 100 tournois les plus récents sont affichés.</div>'
            : '');
}

function renderTournamentRow(t) {
    const courant = t.id === tournamentId;
    const nom = escapeHtml(t.name || t.id);
    const etape = SCREEN_LABELS[t.screen] || '—';
    const quand = t.updatedAt
        ? new Date(t.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : null;

    return `
        <div class="tournament-row${courant ? ' is-current' : ''}">
            <div>
                <div class="tournament-row-name">${nom}${courant ? '<span class="tournament-badge">en cours</span>' : ''}</div>
                <div class="tournament-row-meta">${etape} · ${t.players} partant${t.players > 1 ? 's' : ''}${quand ? ' · ' + quand : ''}</div>
            </div>
            <div class="tournament-row-actions">
                <button class="secondary" onclick="openTournament('${encodeURIComponent(t.id)}')" ${courant ? 'disabled' : ''}>Ouvrir</button>
                <button class="danger" onclick="deleteTournament('${encodeURIComponent(t.id)}')"
                        ${courant ? 'disabled title="Ouvre un autre tournoi pour pouvoir supprimer celui-ci"' : ''}>Supprimer</button>
            </div>
        </div>
    `;
}

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

    html += tournament.players.length
        ? tournament.players.map((p, i) => `
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
function forgetLocalCopy(id) {
    try {
        localStorage.removeItem(storageKey(id));
    } catch (e) {
        console.warn('Copie locale non nettoyée :', e);
    }
}

async function moveTournament(nouveauId) {
    const ancienId = tournamentId;

    let res;
    try {
        res = await fetch(API_BASE + '?id=' + encodeURIComponent(nouveauId), {
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
    remoteVersion = (data && typeof data.version === 'number') ? data.version : 0;
    history.replaceState(null, '', '#' + nouveauId);

    // L'ancienne adresse n'a plus lieu d'être. Si la suppression échoue, le tournoi
    // reste accessible aux deux liens : gênant, mais sans perte de données.
    try {
        await fetch(API_BASE + '?id=' + encodeURIComponent(ancienId), { method: 'DELETE' });
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

    // Seul le libellé change : matchs et classements référencent les joueurs
    // par leur identifiant, jamais par leur nom.
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

async function deleteTournament(id) {
    const cible = decodeURIComponent(id);

    // Le tournoi affiché n'est pas supprimable : la page continuerait de
    // l'enregistrer et le ferait réapparaître aussitôt.
    if (cible === tournamentId) {
        alert('Impossible de supprimer le tournoi actuellement ouvert.\n\n' +
              'Ouvre un autre tournoi (ou crée-en un nouveau), puis reviens le supprimer.');
        return;
    }

    const connu = lastTournamentsList.find(t => t.id === cible);
    const libelle = (connu && connu.name) || cible;

    if (!confirm('Supprimer définitivement « ' + libelle + ' » ?\n\n' +
                 'Le tournoi et ses résultats disparaîtront pour tout le monde, ' +
                 'et son lien ne fonctionnera plus. Cette action est irréversible.')) {
        return;
    }

    try {
        const res = await fetch(API_BASE + '?id=' + encodeURIComponent(cible), { method: 'DELETE' });
        if (!res.ok) throw new Error(res.status);
    } catch (e) {
        alert('Suppression impossible — hors ligne ?');
        return;
    }

    deletedThisSession.add(cible);
    // Même piège qu'au renommage : sans ça, rouvrir le lien d'un tournoi supprimé
    // le ferait revenir depuis la copie locale de ce navigateur.
    forgetLocalCopy(cible);
    loadTournamentsList();
}

function openTournament(id) {
    const cible = decodeURIComponent(id);
    if (cible === tournamentId) return;
    location.hash = '#' + cible; // déclenche hashchange -> rechargement sur le bon tournoi
}

function updateTournamentTitle() {
    const el = document.getElementById('tournament-name-display');
    el.textContent = tournament.name || '';
    el.hidden = !tournament.name;
}
const storageKey = (id) => 'tournoi_echecs_state_v1:' + (id || tournamentId);

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
