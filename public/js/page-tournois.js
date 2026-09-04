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
const tournoisSupprimes = new Set();

// L'accueil note le tournoi qu'il fait tourner : c'est le seul moyen, depuis
// cette page, de savoir lequel est en cours.
function getTournoiCourant() {
    try {
        return localStorage.getItem(CLE_TOURNOI_COURANT);
    } catch (e) {
        return null;
    }
}

async function loadListeTournois() {
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

    const items = ((data && data.tournaments) || []).filter(t => !tournoisSupprimes.has(t.id));

    if (!items.length) {
        liste.innerHTML = '<div class="tournaments-empty">Aucun tournoi enregistré pour l\'instant : ' +
            'donne le départ au premier.</div>';
        return;
    }

    const courant = getTournoiCourant();
    liste.innerHTML = items.map(t => buildLigneTournoi(t, courant)).join('') +
        (data.complete === false
            // list() renvoie les 100 premières clés par ordre alphabétique ; le
            // tri par date ne porte que sur celles-là. Dire « les plus récents »
            // serait faux dès qu'il y en a davantage.
            ? '<div class="tournaments-empty">Il y a plus de 100 tournois : seuls 100 d\'entre eux sont affichés.</div>'
            : '');
}

function buildLigneTournoi(t, courant) {
    const estCourant = t.id === courant;
    const etape = SCREEN_LABELS[t.screen] || '—';
    const quand = t.updatedAt
        ? new Date(t.updatedAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
        : null;

    // Le nom sert d'adresse, mais les deux peuvent diverger : un tournoi renommé
    // avant que le déplacement existe garde son ancien lien. On propose de les
    // remettre d'accord, plutôt que de laisser deux libellés se contredire.
    const adresseSuitLeNom = !t.name || slugify(t.name) === t.id;
    const alignement = adresseSuitLeNom ? '' : `
        <button type="button" class="etiquette tournoi-ecart" onclick="renameTournoi('${escapeHtml(t.id)}')"
                title="L'adresse deviendra …/#${escapeHtml(slugify(t.name))}, pour suivre « ${escapeHtml(t.name)} ». L'ancien lien cessera de fonctionner.">
            ⇢ aligner l'adresse
        </button>`;

    return `
        <div class="tournament-row${estCourant ? ' is-current' : ''}">
            <div class="tournoi-edition">
                <input type="text" class="tournoi-nom" maxlength="64" data-id="${escapeHtml(t.id)}"
                       aria-label="Nom du tournoi" placeholder="Sans nom" value="${escapeHtml(t.name || '')}">
                <div class="tournament-row-meta">
                    <span class="tournoi-adresse">…/#${escapeHtml(t.id)}</span>${alignement}${estCourant ? '<span class="etiquette tournament-badge">en cours</span>' : ''}
                    · ${etape} · ${t.players} partant${t.players > 1 ? 's' : ''}${quand ? ' · ' + quand : ''}
                </div>
            </div>
            <div class="tournament-row-actions">
                ${buildBoutonPicto('renommer', 'Renommer', `renameTournoi('${escapeHtml(t.id)}')`, 'secondary')}
                ${buildBoutonPicto('ouvrir', 'Ouvrir', `openTournoi('${escapeHtml(t.id)}')`, 'secondary')}
                ${buildBoutonPicto('supprimer', 'Supprimer', `removeTournoi('${escapeHtml(t.id)}')`, 'danger')}
            </div>
        </div>
    `;
}

function openTournoi(id) {
    location.href = PAGE_ACCUEIL + '#' + encodeURIComponent(id);
}

// Sans lien explicite, l'accueil rouvre le dernier tournoi consulté. Y aller
// sans oublier ce repère d'abord rouvrirait justement celui qu'on quitte : on
// n'aurait aucun moyen d'atteindre une inscription vierge.
function openNouveauTournoi() {
    try {
        localStorage.removeItem(CLE_TOURNOI_COURANT);
    } catch (e) {
        console.warn('Repère du tournoi non effacé :', e);
    }
    location.href = PAGE_ACCUEIL;
}

// Le nom du tournoi lui sert d'adresse : le changer déplace le tournoi vers un
// nouveau lien. On écrit à la nouvelle adresse avant d'effacer l'ancienne —
// jamais l'inverse, sous peine de perdre le tournoi si l'écriture échoue.
async function renameTournoi(id) {
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
        notifyErreur('Tournoi illisible : ' + e.message);
        return;
    }
    if (!enveloppe.state) {
        notifyErreur('Ce tournoi n\'existe plus.');
        loadListeTournois();
        return;
    }

    if (deplacement) {
        if (await isIdTaken(slug)) {
            notifyErreur('Un tournoi nommé « ' + nouveauNom + ' » existe déjà.');
            return;
        }
        const suite = await askConfirmation({
            titre: 'Le lien du tournoi va devenir …/#' + slug,
            message: 'L\'ancien lien (…/#' + id + ') cessera de fonctionner. ' +
                'Préviens les personnes à qui tu l\'as partagé.',
            action: 'Déplacer le tournoi'
        });
        if (!suite) return;
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
        notifyErreur('Renommage impossible : ' + e.message);
        return;
    }

    if (deplacement) {
        try {
            await fetch(urlEtat(id), { method: 'DELETE' });
        } catch (e) {
            console.warn('Ancienne adresse non supprimée :', e);
        }
        tournoisSupprimes.add(id);
        removeCopieLocale(id);
        if (getTournoiCourant() === id) {
            try { localStorage.setItem(CLE_TOURNOI_COURANT, slug); } catch (e) { /* stockage refusé */ }
        }
    }

    await loadListeTournois();
}

async function removeTournoi(id) {
    const suite = await askConfirmation({
        titre: 'Supprimer définitivement ce tournoi ?',
        message: 'Son lien (…/#' + id + ') cessera de fonctionner, pour tout le monde.',
        action: 'Supprimer le tournoi',
        danger: true
    });
    if (!suite) return;

    try {
        const res = await fetch(urlEtat(id), { method: 'DELETE' });
        if (!res.ok) throw new Error('réponse ' + res.status);
    } catch (e) {
        notifyErreur('Suppression impossible : ' + e.message);
        return;
    }

    tournoisSupprimes.add(id);
    removeCopieLocale(id);
    await loadListeTournois();
}

// La liste des joueurs est nécessaire à l'export : une sauvegarde embarque les
// fiches, sans quoi les tournois qui n'ont que des renvois seraient illisibles.
async function startPageTournois() {
    await loadJoueurs();
    await loadListeTournois();
}

startPageTournois();
