// Sauvegarde partagee versionnee : envois serialises, reessai, conflits

// Version de l'état côté serveur telle que ce navigateur la connaît.
// Elle accompagne chaque écriture : le Worker la refuse (409) si un autre
// appareil a modifié le tournoi entre-temps.
let remoteVersion = 0;

// Les envois sont sérialisés : une seule requête en vol à la fois, et les
// enregistrements qui surviennent pendant sont fusionnés en un seul suivant.
// Sans cela, deux sauvegardes rapprochées peuvent arriver dans le désordre
// et un état ancien écrase le plus récent.
let syncInFlight = null;
let syncPending = false;
let retryTimer = null;
let retryDelay = 1000;

const SYNC_LABELS = {
    saving:   '⟳ Enregistrement…',
    saved:    '✓ Enregistré',
    offline:  '⚠ Hors ligne — nouvelle tentative…',
    conflict: '⚠ Conflit à arbitrer'
};

function setSyncStatus(state) {
    const el = document.getElementById('sync-status');
    if (!el) return;
    el.dataset.state = state;
    el.textContent = SYNC_LABELS[state] || '';
}

function currentState() {
    const activeScreen = document.querySelector('.screen.active');
    return {
        tournament: tournament,
        screen: activeScreen ? activeScreen.id : 'screen-config'
    };
}

function saveState() {
    // Copie locale immédiate (fonctionne même hors-ligne)
    try {
        localStorage.setItem(storageKey(tournamentId), JSON.stringify(currentState()));
    } catch (e) {
        console.warn('Sauvegarde locale impossible :', e);
    }
    queueSync();
}

function queueSync() {
    syncPending = true;
    if (syncInFlight) return; // la boucle en cours repartira pour un tour
    syncInFlight = (async () => {
        try {
            while (syncPending) {
                syncPending = false;
                await pushState();
            }
        } finally {
            syncInFlight = null;
        }
    })();
}

async function pushState() {
    setSyncStatus('saving');

    let res;
    try {
        res = await fetch(stateUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            // L'état est relu au moment de l'envoi : on pousse toujours le plus récent.
            body: JSON.stringify({ baseVersion: remoteVersion, state: currentState() })
        });
    } catch (e) {
        scheduleRetry(); // hors ligne ou Worker injoignable
        return;
    }

    if (res.status === 409) {
        const remote = await res.json().catch(() => null);
        showConflict(remote);
        return;
    }

    if (!res.ok) {
        scheduleRetry();
        return;
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data.version === 'number') remoteVersion = data.version;
    retryDelay = 1000;
    setSyncStatus('saved');
}

function scheduleRetry() {
    setSyncStatus('offline');
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        queueSync();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30000); // paliers 1s, 2s, 4s… plafonnés à 30s
}

window.addEventListener('online', () => { retryDelay = 1000; queueSync(); });

// Un autre appareil a modifié le tournoi : on ne tranche pas à sa place,
// les deux versions sont légitimes et l'une va disparaître.
function showConflict(remote) {
    setSyncStatus('conflict');
    const banner = document.getElementById('sync-conflict');
    if (!banner) return;
    banner.hidden = false;

    banner.querySelector('[data-action="pull"]').onclick = () => {
        banner.hidden = true;
        if (remote && typeof remote.version === 'number' && remote.state) {
            remoteVersion = remote.version;
            applyState(remote.state);
        } else {
            location.reload();
        }
    };

    banner.querySelector('[data-action="push"]').onclick = () => {
        banner.hidden = true;
        // On se recale sur la version du serveur pour que l'écriture passe.
        if (remote && typeof remote.version === 'number') remoteVersion = remote.version;
        queueSync();
    };
}

// Fermer l'onglet avec des saisies non transmises les perdrait : on prévient.
window.addEventListener('beforeunload', (e) => {
    if (syncPending || retryTimer) {
        e.preventDefault();
        e.returnValue = '';
    }
});

function applyState(state) {
    if (!state || !state.tournament || !Array.isArray(state.tournament.players) || state.tournament.players.length === 0) {
        return false;
    }

    tournament = state.tournament;
    // Les noms viennent des fiches : un renommage fait ailleurs apparaît ici.
    resoudreJoueursDuTournoi();
    updateTournamentTitle();
    document.getElementById('tournament-name').value = tournament.name || '';

    try {
        if (state.screen === 'screen-tournament') {
            document.getElementById('player-count').value = tournament.players.length;
            renderTournament();
            switchScreen('screen-tournament');
        } else if (state.screen === 'screen-semifinals' && tournament.semifinalMatches.length) {
            // checkSemifinalsComplete (et non renderSemifinals) : lui seul reactive
            // le bouton « Vers la Grande Finale » apres un rechargement de page.
            checkSemifinalsComplete();
            switchScreen('screen-semifinals');
        } else if (state.screen === 'screen-finals' && tournament.finalMatches.length) {
            checkFinalsComplete();
            switchScreen('screen-finals');
        } else if (state.screen === 'screen-results' && tournament.championId != null && tournament.runnerId != null) {
            const champion = tournament.players[tournament.championId];
            const runner = tournament.players[tournament.runnerId];
            displayResults(champion, runner);
            switchScreen('screen-results');
        } else {
            document.getElementById('player-count').value = tournament.players.length;
            switchScreen('screen-config');
        }
        return true;
    } catch (e) {
        console.warn('Restauration de l\'état impossible :', e);
        return false;
    }
}

async function loadState() {
    // Les fiches d'abord : sans elles, un tournoi s'afficherait avec les noms
    // recopiés lors de son inscription, pas avec les noms à jour.
    await chargerJoueurs();

    // L'écran d'inscription a été dessiné avant l'arrivée des fiches : ses
    // menus déroulants seraient vides. On les redessine, choix conservés.
    updatePlayerInputs();

    // 1) On tente d'abord la version partagée sur Cloudflare (la plus à jour, tous appareils confondus)
    try {
        const res = await fetch(stateUrl());
        if (res.ok) {
            const remote = await res.json();
            // Nouveau format : { version, updatedAt, state }
            if (remote && typeof remote.version === 'number') {
                remoteVersion = remote.version;
                if (remote.state && applyState(remote.state)) return true;
            } else if (remote && applyState(remote)) {
                return true; // ancien format, si le Worker n'est pas encore à jour
            }
        }
    } catch (e) {
        console.warn('Impossible de joindre le Worker Cloudflare, repli sur la sauvegarde locale :', e);
        setSyncStatus('offline');
    }

    // 2) Repli sur la copie locale (mode hors-ligne, ou Worker injoignable)
    try {
        const raw = localStorage.getItem(storageKey(tournamentId));
        if (!raw) return false;
        return applyState(JSON.parse(raw));
    } catch (e) {
        console.warn('Lecture de la sauvegarde locale impossible :', e);
        return false;
    }
}

// Après une restauration : le tournoi ouvert vient peut-être d'être remplacé.
async function rafraichirApresRestauration() {
    await loadState();
}

// Au chargement de la page, on tente de reprendre là où le tournoi en était
loadState();
