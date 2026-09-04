// Export et import de tous les tournois, depuis la page.
//
// Aucune route dédiée côté Worker : on se sert de celles qui existent déjà
// (/tournaments, /state?id=…). Rien de nouveau n'est donc exposé publiquement.

const FORMAT_SAUVEGARDE = 'grand-prix-des-echecs/sauvegarde';
const VERSION_SAUVEGARDE = 1;

// Sauvegarde relue et validée, en attente de confirmation dans le panneau.
let sauvegardeEnAttente = null;

// --- Le format ---------------------------------------------------------------

// Les tournois sont écrits décodés (et non en chaînes échappées) et triés par
// identifiant : le fichier se lit à l'œil, et deux exports d'un contenu
// inchangé donnent le même fichier — donc pas de diff parasite si on l'archive.
function construireSauvegarde(tournois, date) {
    const contenu = {};
    for (const { id, enveloppe } of [...tournois].sort((a, b) => a.id.localeCompare(b.id))) {
        contenu[id] = enveloppe;
    }
    return {
        format: FORMAT_SAUVEGARDE,
        version: VERSION_SAUVEGARDE,
        exporteLe: (date || new Date()).toISOString(),
        tournois: contenu
    };
}

// Un fichier douteux ne doit jamais atteindre le serveur : on refuse tôt et
// avec un message qui dit quoi.
function lireSauvegarde(texte) {
    let data;
    try {
        data = JSON.parse(texte);
    } catch (e) {
        throw new Error('Ce fichier n\'est pas du JSON.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Fichier invalide : un objet est attendu à la racine.');
    }
    if (data.format !== FORMAT_SAUVEGARDE) {
        throw new Error('Ce fichier n\'est pas une sauvegarde de tournois.');
    }
    if (data.version !== VERSION_SAUVEGARDE) {
        throw new Error('Sauvegarde en version ' + data.version + ', cette page attend la version ' + VERSION_SAUVEGARDE + '.');
    }
    if (!data.tournois || typeof data.tournois !== 'object' || Array.isArray(data.tournois)) {
        throw new Error('Fichier invalide : aucun tournoi dedans.');
    }
    for (const [id, enveloppe] of Object.entries(data.tournois)) {
        if (!ID_PATTERN.test(id)) {
            throw new Error('Identifiant de tournoi invalide dans le fichier : « ' + id +' ».');
        }
        const etat = enveloppe && enveloppe.state;
        if (!etat || !etat.tournament || !Array.isArray(etat.tournament.players)) {
            throw new Error('Le tournoi « ' + id + ' » est incomplet dans le fichier.');
        }
    }
    return data;
}

// Ce que la restauration ferait, avant de le faire.
function planifierRestauration(sauvegarde, idsDistants) {
    const presents = new Set(idsDistants);
    const entrees = Object.entries(sauvegarde.tournois).map(([id, enveloppe]) => ({
        id,
        enveloppe,
        nom: (enveloppe.state.tournament.name) || id,
        partants: enveloppe.state.tournament.players.length
    }));
    return {
        creations: entrees.filter(e => !presents.has(e.id)),
        ecrasements: entrees.filter(e => presents.has(e.id))
    };
}

// --- Export ------------------------------------------------------------------

// L'API ne sait lister que les tournois ayant au moins un partant : ce sont
// exactement ceux que la page affiche, et les seuls qui valent d'être gardés.
async function collecterTournois() {
    const res = await fetch(TOURNAMENTS_URL);
    if (!res.ok) throw new Error('Liste indisponible (' + res.status + ')');
    const data = await res.json();
    const ids = ((data && data.tournaments) || []).map(t => t.id);

    const tournois = [];
    for (const id of ids) {
        const reponse = await fetch(API_BASE + '?id=' + encodeURIComponent(id));
        if (!reponse.ok) throw new Error('Lecture impossible pour « ' + id + ' »');
        const enveloppe = await reponse.json();
        if (enveloppe && enveloppe.state) {
            tournois.push({ id, enveloppe });
        }
    }
    return tournois;
}

function nomFichierSauvegarde(date) {
    const horodatage = (date || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return 'tournois-' + horodatage + '.json';
}

function telechargerFichier(nom, texte) {
    const url = URL.createObjectURL(new Blob([texte], { type: 'application/json' }));
    const lien = document.createElement('a');
    lien.href = url;
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    URL.revokeObjectURL(url);
}

async function exporterTournois() {
    const bouton = document.getElementById('btn-export');
    const libelle = bouton ? bouton.textContent : '';
    if (bouton) { bouton.disabled = true; bouton.textContent = '⏳ Export en cours…'; }

    try {
        const tournois = await collecterTournois();
        if (!tournois.length) {
            alert('Aucun tournoi à exporter.');
            return;
        }
        const sauvegarde = construireSauvegarde(tournois);
        telechargerFichier(nomFichierSauvegarde(), JSON.stringify(sauvegarde, null, 2) + '\n');
        closeMainMenu();
    } catch (e) {
        alert('Export impossible : ' + e.message);
    } finally {
        if (bouton) { bouton.disabled = false; bouton.textContent = libelle; }
    }
}

// --- Import ------------------------------------------------------------------

function declencherImport() {
    const champ = document.getElementById('import-file');
    champ.value = ''; // pour que rechoisir le même fichier redéclenche l'évènement
    champ.click();
}

// Le fichier est relu et confronté à ce qui existe : on montre le plan et on
// attend une confirmation. Rien n'est écrit à ce stade.
async function preparerRestauration(fichier) {
    if (!fichier) return;
    closeMainMenu();

    let sauvegarde;
    try {
        sauvegarde = lireSauvegarde(await fichier.text());
    } catch (e) {
        alert('Import impossible : ' + e.message);
        return;
    }

    let idsDistants = [];
    try {
        const res = await fetch(TOURNAMENTS_URL);
        if (res.ok) {
            const data = await res.json();
            idsDistants = ((data && data.tournaments) || []).map(t => t.id);
        }
    } catch (e) {
        // Liste injoignable : tout sera présenté comme une création. L'écriture
        // reste correcte, elle se cale sur la version lue tournoi par tournoi.
        console.warn('Liste des tournois indisponible :', e);
    }

    sauvegardeEnAttente = sauvegarde;
    afficherPlanRestauration(planifierRestauration(sauvegarde, idsDistants), sauvegarde);
}

function afficherPlanRestauration(plan, sauvegarde) {
    const ligne = (e, signe) =>
        '<div class="tournament-row"><div class="tournament-row-name">' + signe + ' ' +
        escapeHtml(e.nom) + '</div><div class="tournament-row-meta">' +
        escapeHtml(e.id) + ' · ' + e.partants + ' partants</div></div>';

    let html = '<div class="tournaments-empty">Sauvegarde du ' +
        escapeHtml(new Date(sauvegarde.exporteLe).toLocaleString('fr-FR')) + '</div>';
    html += plan.creations.map(e => ligne(e, '+')).join('');
    html += plan.ecrasements.map(e => ligne(e, '↻')).join('');
    if (plan.ecrasements.length) {
        html += '<div class="tournaments-empty">↻ : ces tournois existent déjà et seront' +
            ' remplacés par la version du fichier. Leur contenu actuel sera perdu.</div>';
    }

    document.getElementById('import-plan').innerHTML = html;
    document.getElementById('btn-import-confirm').disabled =
        !(plan.creations.length + plan.ecrasements.length);
    document.getElementById('import-panel').hidden = false;
}

function fermerImport() {
    sauvegardeEnAttente = null;
    document.getElementById('import-panel').hidden = true;
    document.getElementById('import-progress').textContent = '';
}

// Chaque tournoi est écrit avec la version que le serveur annonce à l'instant :
// l'écriture est acceptée, et le tournoi restauré repart sur une version propre.
async function appliquerRestauration() {
    if (!sauvegardeEnAttente) return;

    const entrees = Object.entries(sauvegardeEnAttente.tournois);
    const bouton = document.getElementById('btn-import-confirm');
    const avancement = document.getElementById('import-progress');
    bouton.disabled = true;

    const echecs = [];
    let faits = 0;

    for (const [id, enveloppe] of entrees) {
        avancement.textContent = 'Restauration ' + (faits + 1) + '/' + entrees.length + ' — ' + id;
        try {
            const url = API_BASE + '?id=' + encodeURIComponent(id);
            const actuel = await fetch(url);
            const distant = actuel.ok ? await actuel.json() : { version: 0 };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseVersion: distant.version || 0, state: enveloppe.state })
            });
            if (!res.ok) throw new Error('réponse ' + res.status);
            faits++;
        } catch (e) {
            echecs.push(id + ' (' + e.message + ')');
        }
    }

    avancement.textContent = '';
    fermerImport();

    if (echecs.length) {
        alert(faits + ' tournoi(s) restauré(s), ' + echecs.length + ' en échec :\n' + echecs.join('\n'));
    } else {
        alert(faits + ' tournoi(s) restauré(s).');
    }

    // Le tournoi ouvert vient peut-être d'être remplacé : on repart de l'état serveur.
    await loadState();
    if (!document.getElementById('tournaments-panel').hidden) loadTournamentsList();
}
