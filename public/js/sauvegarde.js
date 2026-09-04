// Export et import de tous les tournois, depuis la page.
//
// Aucune route dédiée côté Worker : on se sert de celles qui existent déjà
// (/tournaments, /state?id=…). Rien de nouveau n'est donc exposé publiquement.

const FORMAT_SAUVEGARDE = 'grand-prix-des-echecs/sauvegarde';
// v2 : la sauvegarde embarque les fiches des joueurs. Un tournoi ne stocke
// qu'un renvoi vers elles — sans les fiches, le fichier serait illisible.
// Les fichiers v1 restent acceptés : leurs tournois portaient les noms en dur.
const VERSION_SAUVEGARDE = 2;
const VERSIONS_LUES = [1, 2];

// Sauvegarde relue et validée, en attente de confirmation dans le panneau.
let sauvegardeEnAttente = null;

// --- Le format ---------------------------------------------------------------

// Les tournois sont écrits décodés (et non en chaînes échappées) et triés par
// identifiant : le fichier se lit à l'œil, et deux exports d'un contenu
// inchangé donnent le même fichier — donc pas de diff parasite si on l'archive.
function construireSauvegarde(tournois, date, listeJoueurs) {
    const contenu = {};
    for (const { id, enveloppe } of [...tournois].sort((a, b) => a.id.localeCompare(b.id))) {
        contenu[id] = enveloppe;
    }
    return {
        format: FORMAT_SAUVEGARDE,
        version: VERSION_SAUVEGARDE,
        exporteLe: (date || new Date()).toISOString(),
        joueurs: [...(listeJoueurs || joueurs)].sort((a, b) => a.id.localeCompare(b.id)),
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
    if (!VERSIONS_LUES.includes(data.version)) {
        throw new Error('Sauvegarde en version ' + data.version + ', cette page lit les versions ' + VERSIONS_LUES.join(' et ') + '.');
    }
    if (data.joueurs !== undefined) {
        if (!Array.isArray(data.joueurs)) {
            throw new Error('Fichier invalide : la liste des joueurs est illisible.');
        }
        for (const fiche of data.joueurs) {
            if (!fiche || !ID_PATTERN.test(String(fiche.id)) || !String(fiche.nom || '').trim()) {
                throw new Error('Fichier invalide : une fiche de joueur est incomplète.');
            }
        }
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
// Les fiches du fichier sont fusionnées : celles qu'il contient font foi, les
// autres restent en place. Une restauration ne doit pas effacer des joueurs
// ajoutés depuis la sauvegarde.
function fusionnerJoueurs(fichesDuFichier, fichesActuelles) {
    const fusion = [...fichesActuelles];
    const nouveaux = [];
    const misAJour = [];
    for (const fiche of fichesDuFichier || []) {
        const i = fusion.findIndex(j => j.id === fiche.id);
        if (i === -1) {
            fusion.push(fiche);
            nouveaux.push(fiche);
        } else {
            if (fusion[i].nom !== fiche.nom || fusion[i].elo !== fiche.elo) misAJour.push(fiche);
            fusion[i] = fiche;
        }
    }
    return { fusion, nouveaux, misAJour };
}

function planifierRestauration(sauvegarde, idsDistants) {
    const presents = new Set(idsDistants);
    const entrees = Object.entries(sauvegarde.tournois).map(([id, enveloppe]) => ({
        id,
        enveloppe,
        nom: (enveloppe.state.tournament.name) || id,
        partants: enveloppe.state.tournament.players.length
    }));
    const fiches = fusionnerJoueurs(sauvegarde.joueurs, joueurs);
    return {
        creations: entrees.filter(e => !presents.has(e.id)),
        ecrasements: entrees.filter(e => presents.has(e.id)),
        joueursNouveaux: fiches.nouveaux,
        joueursMisAJour: fiches.misAJour
    };
}

// --- Export ------------------------------------------------------------------

// L'API ne sait lister que les tournois ayant au moins un partant : ce sont
// exactement ceux que la page affiche, et les seuls qui valent d'être gardés.
async function collecterTournois() {
    const res = await fetch(URL_TOURNOIS);
    if (!res.ok) throw new Error('Liste indisponible (' + res.status + ')');
    const data = await res.json();
    const ids = ((data && data.tournaments) || []).map(t => t.id);

    const tournois = [];
    for (const id of ids) {
        const reponse = await fetch(urlEtat(id));
        if (!reponse.ok) throw new Error('Lecture impossible pour « ' + id + ' »');
        const enveloppe = await reponse.json();
        if (enveloppe && enveloppe.state) {
            tournois.push({ id, enveloppe });
        }
    }
    return tournois;
}

// Le fichier contient les tournois ET les fiches des joueurs : son nom le dit.
function nomFichierSauvegarde(date) {
    const horodatage = (date || new Date()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return 'sauvegarde-' + horodatage + '.json';
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
        if (!tournois.length && !joueurs.length) {
            alert('Rien à exporter : ni tournoi, ni joueur.');
            return;
        }
        const sauvegarde = construireSauvegarde(tournois, null, joueurs);
        telechargerFichier(nomFichierSauvegarde(), JSON.stringify(sauvegarde, null, 2) + '\n');
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

    let sauvegarde;
    try {
        sauvegarde = lireSauvegarde(await fichier.text());
    } catch (e) {
        alert('Import impossible : ' + e.message);
        return;
    }

    let idsDistants = [];
    let listeLue = false;
    try {
        const res = await fetch(URL_TOURNOIS);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        idsDistants = ((data && data.tournaments) || []).map(t => t.id);
        listeLue = true;
    } catch (e) {
        // Liste injoignable : on ne peut plus distinguer création et écrasement.
        // L'écriture, elle, reste correcte : elle se cale sur la version lue
        // tournoi par tournoi au moment de l'envoi.
        console.warn('Liste des tournois indisponible :', e);
    }

    sauvegardeEnAttente = sauvegarde;
    afficherPlanRestauration(planifierRestauration(sauvegarde, idsDistants), sauvegarde, listeLue);
}

function afficherPlanRestauration(plan, sauvegarde, listeLue) {
    // Le nom et l'identifiant sur la même ligne : séparés, on les lisait comme
    // deux tournois différents.
    const ligne = (e, etat) =>
        '<div class="tournament-row"><div>' +
        '<div class="tournament-row-name">' + escapeHtml(e.nom) +
        '<span class="tournament-badge">' + etat + '</span></div>' +
        '<div class="tournament-row-meta">' +
        (e.nom === e.id ? '' : escapeHtml(e.id) + ' · ') + e.partants + ' partants</div>' +
        '</div></div>';

    let html = '<div class="tournaments-empty">Sauvegarde du ' +
        escapeHtml(new Date(sauvegarde.exporteLe).toLocaleString('fr-FR')) + '</div>';

    // Sans la liste du serveur, impossible de savoir ce qui existe déjà : on le
    // dit, plutôt que de laisser croire que tout est nouveau.
    if (!listeLue) {
        html += '<div class="tournaments-empty">⚠ La liste des tournois n\'a pas pu être lue : ' +
            'impossible de dire lesquels existent déjà. Un tournoi portant le même identifiant ' +
            'sera remplacé.</div>';
    }

    html += plan.creations.map(e => ligne(e, listeLue ? 'nouveau' : 'à écrire')).join('');
    html += plan.ecrasements.map(e => ligne(e, 'remplacé')).join('');
    if (plan.ecrasements.length) {
        html += '<div class="tournaments-empty">↻ : ces tournois existent déjà et seront' +
            ' remplacés par la version du fichier. Leur contenu actuel sera perdu.</div>';
    }

    const fiches = plan.joueursNouveaux.length + plan.joueursMisAJour.length;
    html += '<div class="tournaments-empty">' + (fiches
        ? 'Joueurs : ' + plan.joueursNouveaux.length + ' à ajouter, ' +
          plan.joueursMisAJour.length + ' à mettre à jour. Les fiches absentes du fichier sont conservées.'
        : 'Aucun changement dans la liste des joueurs.') + '</div>';

    // Le panneau n'écrit rien : le bouton « Restaurer » reste à cliquer.
    html += '<div class="tournaments-empty">Rien n\'est encore écrit — ' +
        '« Restaurer » applique ce plan.</div>';

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

    // Les fiches d'abord : un tournoi restauré avant elles afficherait
    // « Joueur supprimé » le temps que la liste suive.
    const fusion = fusionnerJoueurs(sauvegardeEnAttente.joueurs, joueurs);
    const fichesTouchees = fusion.nouveaux.length + fusion.misAJour.length;
    if (fichesTouchees) {
        if (!await remplacerJoueurs(fusion.fusion)) {
            alert('La liste des joueurs n\'a pas pu être enregistrée : restauration abandonnée.');
            return;
        }
    }

    const entrees = Object.entries(sauvegardeEnAttente.tournois);
    const bouton = document.getElementById('btn-import-confirm');
    const avancement = document.getElementById('import-progress');
    bouton.disabled = true;

    const echecs = [];
    let faits = 0;

    for (const [id, enveloppe] of entrees) {
        avancement.textContent = 'Restauration ' + (faits + 1) + '/' + entrees.length + ' — ' + id;
        try {
            const url = urlEtat(id);
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

    // Une sauvegarde porte les deux : le compte rendu doit parler des deux.
    const compte = faits + ' tournoi(s) et ' + fichesTouchees + ' fiche(s) de joueur restaurés';
    alert(echecs.length
        ? compte + ', ' + echecs.length + ' en échec :\n' + echecs.join('\n')
        : compte + '.');

    // Le contenu de la page vient de changer sous ses pieds : chaque page dit
    // comment se relire (la liste des tournois, celle des joueurs, le tournoi
    // ouvert). Sans ce point d'accroche, la sauvegarde serait liée à une page.
    if (typeof rafraichirApresRestauration === 'function') {
        await rafraichirApresRestauration();
    }
}
