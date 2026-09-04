// Page /tournois : la liste des tournois enregistrés, avec renommage et
// suppression. Ouvrir un tournoi renvoie à l'accueil, qui le fait tourner.

const SCREEN_LABELS = {
    'screen-config':     'Inscription',
    'screen-tournament': 'Phase de poule',
    'screen-semifinals': 'Demi-finales',
    'screen-finals':     'Grande finale',
    'screen-results':    'Terminé'
};

// L'index du serveur met quelques secondes à refléter une suppression : on
// masque en attendant ce qu'on vient de supprimer, pour que la liste
// corresponde à ce qu'on vient de faire.
const supprimesCetteSession = new Set();

// L'accueil note le tournoi qu'il fait tourner : c'est le seul moyen, depuis
// cette page, de savoir lequel est en cours.
function tournoiCourant() {
    try {
        return localStorage.getItem(CLE_TOURNOI_COURANT);
    } catch (e) {
        return null;
    }
}

async function chargerListe() {
    const liste = document.getElementById('tournois-liste');
    liste.innerHTML = '<div class="tournaments-empty">Chargement…</div>';

    let data;
    try {
        const res = await fetch(URL_TOURNOIS);
        if (!res.ok) throw new Error(res.status);
        data = await res.json();
    } catch (e) {
        liste.innerHTML = '<div class="tournaments-empty">Liste indisponible — hors ligne ?</div>';
        return;
    }

    const items = ((data && data.tournaments) || []).filter(t => !supprimesCetteSession.has(t.id));

    if (!items.length) {
        liste.innerHTML = '<div class="tournaments-empty">Aucun tournoi enregistré pour l\'instant. ' +
            '<a href="./">Ouvre l\'accueil</a> pour en lancer un.</div>';
        return;
    }

    const courant = tournoiCourant();
    liste.innerHTML = items.map(t => ligneTournoi(t, courant)).join('') +
        (data.complete === false
            ? '<div class="tournaments-empty">Seuls les 100 tournois les plus récents sont affichés.</div>'
            : '');
}

function ligneTournoi(t, courant) {
    const estCourant = t.id === courant;
    const etape = SCREEN_LABELS[t.screen] || '—';
    const quand = t.updatedAt
        ? new Date(t.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : null;

    return `
        <div class="tournament-row${estCourant ? ' is-current' : ''}">
            <div class="tournoi-edition">
                <input type="text" class="tournoi-nom" maxlength="64" data-id="${escapeHtml(t.id)}"
                       placeholder="Sans nom" value="${escapeHtml(t.name || '')}">
                <div class="tournament-row-meta">${escapeHtml(t.id)}${estCourant ? '<span class="tournament-badge">en cours</span>' : ''} · ${etape} · ${t.players} partant${t.players > 1 ? 's' : ''}${quand ? ' · ' + quand : ''}</div>
            </div>
            <div class="tournament-row-actions">
                <button class="secondary" onclick="renommerTournoi('${escapeHtml(t.id)}')">Renommer</button>
                <button class="secondary" onclick="ouvrirTournoi('${escapeHtml(t.id)}')">Ouvrir</button>
                <button class="danger" onclick="supprimerTournoi('${escapeHtml(t.id)}')">Supprimer</button>
            </div>
        </div>
    `;
}

function ouvrirTournoi(id) {
    location.href = PAGE_ACCUEIL + '#' + encodeURIComponent(id);
}

// Le nom du tournoi lui sert d'adresse : le changer déplace le tournoi vers un
// nouveau lien. On écrit à la nouvelle adresse avant d'effacer l'ancienne —
// jamais l'inverse, sous peine de perdre le tournoi si l'écriture échoue.
async function renommerTournoi(id) {
    const champ = document.querySelector('.tournoi-nom[data-id="' + id + '"]');
    if (!champ) return;

    const nouveauNom = champ.value.trim();
    const slug = slugify(nouveauNom);
    const deplacement = Boolean(slug) && slug !== id;

    let enveloppe;
    try {
        const res = await fetch(urlEtat(id));
        if (!res.ok) throw new Error(res.status);
        enveloppe = await res.json();
    } catch (e) {
        alert('Tournoi illisible : ' + e.message);
        return;
    }
    if (!enveloppe.state) {
        alert('Ce tournoi n\'existe plus.');
        chargerListe();
        return;
    }

    if (deplacement) {
        if (await isIdTaken(slug)) {
            alert('Un tournoi nommé « ' + nouveauNom + ' » existe déjà.');
            return;
        }
        if (!confirm('Le lien du tournoi va devenir :\n…/#' + slug + '\n\n' +
                     'L\'ancien lien (…/#' + id + ') cessera de fonctionner. ' +
                     'Préviens les personnes à qui tu l\'as partagé.\n\nContinuer ?')) {
            return;
        }
    }

    enveloppe.state.tournament.name = nouveauNom || null;
    const cible = deplacement ? slug : id;
    const baseVersion = deplacement ? 0 : enveloppe.version;

    try {
        const res = await fetch(urlEtat(cible), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion, state: enveloppe.state })
        });
        if (!res.ok) throw new Error('réponse ' + res.status);
    } catch (e) {
        alert('Renommage impossible : ' + e.message);
        return;
    }

    if (deplacement) {
        try {
            await fetch(urlEtat(id), { method: 'DELETE' });
        } catch (e) {
            console.warn('Ancienne adresse non supprimée :', e);
        }
        supprimesCetteSession.add(id);
        oublierCopieLocale(id);
        if (tournoiCourant() === id) {
            try { localStorage.setItem(CLE_TOURNOI_COURANT, slug); } catch (e) { /* stockage refusé */ }
        }
    }

    await chargerListe();
}

function oublierCopieLocale(id) {
    try {
        localStorage.removeItem(storageKey(id));
    } catch (e) {
        console.warn('Copie locale non effacée :', e);
    }
}

async function supprimerTournoi(id) {
    if (!confirm('Supprimer définitivement ce tournoi ?\n\n' +
                 'Son lien (…/#' + id + ') cessera de fonctionner, pour tout le monde.')) {
        return;
    }

    try {
        const res = await fetch(urlEtat(id), { method: 'DELETE' });
        if (!res.ok) throw new Error('réponse ' + res.status);
    } catch (e) {
        alert('Suppression impossible : ' + e.message);
        return;
    }

    supprimesCetteSession.add(id);
    oublierCopieLocale(id);
    await chargerListe();
}

// Après une restauration : la liste des tournois a changé.
async function rafraichirApresRestauration() {
    await chargerJoueurs();
    await chargerListe();
}

// La liste des joueurs est nécessaire à l'export : une sauvegarde embarque les
// fiches, sans quoi les tournois qui n'ont que des renvois seraient illisibles.
async function demarrerPageTournois() {
    await chargerJoueurs();
    await chargerListe();
}

demarrerPageTournois();
