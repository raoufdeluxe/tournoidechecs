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
let planEnCours = { tournois: [], joueurs: [] };

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

// Les fiches retenues sont fusionnées : celles du fichier font foi, les autres
// restent en place. Une restauration ne doit pas effacer des joueurs ajoutés
// depuis la sauvegarde.
function fusionnerJoueurs(fichesDuFichier, fichesActuelles) {
    const fusion = [...fichesActuelles];
    const nouveaux = [];
    const misAJour = [];
    for (const fiche of fichesDuFichier || []) {
        const propre = { id: fiche.id, nom: fiche.nom, elo: fiche.elo };
        const i = fusion.findIndex(j => j.id === fiche.id);
        if (i === -1) {
            fusion.push(propre);
            nouveaux.push(propre);
        } else {
            if (fusion[i].nom !== propre.nom || fusion[i].elo !== propre.elo) misAJour.push(propre);
            fusion[i] = propre;
        }
    }
    return { fusion, nouveaux, misAJour };
}

// Les fiches qu'un tournoi réclame : sans elles, ses partants s'afficheraient
// comme supprimés. C'est ce qui interdit de les décocher.
function refsDuTournoi(enveloppe) {
    const partants = (enveloppe.state && enveloppe.state.tournament && enveloppe.state.tournament.players) || [];
    return [...new Set(partants.map(p => p.ref).filter(Boolean))];
}

// Ce que la restauration ferait, avant de le faire : une ligne par tournoi et
// une par fiche, chacune cochable.
function planifierRestauration(sauvegarde, idsDistants) {
    const presents = new Set(idsDistants);

    const tournois = Object.entries(sauvegarde.tournois).map(([id, enveloppe]) => ({
        id,
        enveloppe,
        nom: enveloppe.state.tournament.name || id,
        partants: enveloppe.state.tournament.players.length,
        refs: refsDuTournoi(enveloppe),
        etat: presents.has(id) ? 'remplacé' : 'nouveau'
    }));

    const actuelles = new Map(joueurs.map(j => [j.id, j]));
    const fiches = (sauvegarde.joueurs || []).map(fiche => {
        const existante = actuelles.get(fiche.id);
        let etat = 'nouveau';
        if (existante) {
            etat = (existante.nom === fiche.nom && existante.elo === fiche.elo) ? 'inchangé' : 'mis à jour';
        }
        return { ...fiche, etat };
    });

    return { tournois, joueurs: fiches };
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
        // On relit les fiches plutôt que de se fier à celles que la page a pu
        // charger : sinon un clic rapide exporterait une liste encore vide, et
        // le fichier perdrait tous les joueurs qu'aucun tournoi ne cite.
        if (!await chargerJoueurs()) {
            throw new Error('la liste des joueurs est injoignable');
        }

        const tournois = await collecterTournois();
        if (!tournois.length && !joueurs.length) {
            notifier('Rien à exporter : ni tournoi, ni joueur.');
            return;
        }
        const sauvegarde = construireSauvegarde(tournois, null, joueurs);
        telechargerFichier(nomFichierSauvegarde(), JSON.stringify(sauvegarde, null, 2) + '\n');
    } catch (e) {
        notifierErreur('Export impossible : ' + e.message);
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
        notifierErreur('Import impossible : ' + e.message);
        return;
    }

    // Même raison qu'à l'export : sans les fiches à jour, le plan annoncerait
    // « nouveau » pour des joueurs qui existent déjà.
    await chargerJoueurs();

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
    planEnCours = planifierRestauration(sauvegarde, idsDistants);
    afficherPlanRestauration(planEnCours, sauvegarde, listeLue);
}

function afficherPlanRestauration(plan, sauvegarde, listeLue) {
    const badge = (texte) => '<span class="tournament-badge">' + texte + '</span>';

    let html = '<div class="tournaments-empty">Sauvegarde du ' +
        escapeHtml(new Date(sauvegarde.exporteLe).toLocaleString('fr-FR')) +
        ' — décoche ce que tu ne veux pas restaurer.</div>';

    // Sans la liste du serveur, impossible de savoir ce qui existe déjà : on le
    // dit, plutôt que de laisser croire que tout est nouveau.
    if (!listeLue) {
        html += '<div class="tournaments-empty">⚠ La liste des tournois n\'a pas pu être lue : ' +
            'impossible de dire lesquels existent déjà. Un tournoi portant le même identifiant ' +
            'sera remplacé.</div>';
    }

    html += '<div class="restaure-section">Tournois</div>';
    html += plan.tournois.length
        ? plan.tournois.map(t => `
            <label class="tournament-row restaure-ligne">
                <input type="checkbox" class="restaure-tournoi" data-id="${escapeHtml(t.id)}" checked
                       onchange="majFichesRequises()">
                <span>
                    <span class="tournament-row-name">${escapeHtml(t.nom)}${badge(listeLue ? t.etat : 'à écrire')}</span>
                    <span class="tournament-row-meta">${t.nom === t.id ? '' : escapeHtml(t.id) + ' · '}${t.partants} partants</span>
                </span>
            </label>`).join('')
        : '<div class="tournaments-empty">Aucun tournoi dans ce fichier.</div>';

    html += '<div class="restaure-section">Joueurs</div>';
    html += plan.joueurs.length
        ? plan.joueurs.map(j => `
            <label class="tournament-row restaure-ligne" data-fiche="${escapeHtml(j.id)}">
                <input type="checkbox" class="restaure-joueur" data-id="${escapeHtml(j.id)}" checked>
                <span>
                    <span class="tournament-row-name">${escapeHtml(j.nom)}${j.elo != null ? ' (' + j.elo + ')' : ''}${badge(j.etat)}</span>
                    <span class="tournament-row-meta restaure-requis"></span>
                </span>
            </label>`).join('')
        : '<div class="tournaments-empty">Aucune fiche de joueur dans ce fichier.</div>';

    html += '<div class="tournaments-empty">Les fiches absentes du fichier sont conservées. ' +
        'Rien n\'est encore écrit — « Restaurer » applique ce plan.</div>';

    document.getElementById('import-plan').innerHTML = html;
    majFichesRequises();
    document.getElementById('import-panel').hidden = false;
}

// Une fiche réclamée par un tournoi coché ne peut pas être décochée : sans elle,
// ses partants s'afficheraient comme supprimés.
function majFichesRequises() {
    if (!sauvegardeEnAttente) return;

    const parTournoi = new Map(planEnCours.tournois.map(t => [t.id, t.refs]));
    const requises = new Map(); // ref -> noms des tournois qui la réclament

    for (const caseTournoi of document.querySelectorAll('.restaure-tournoi')) {
        if (!caseTournoi.checked) continue;
        const tournoi = planEnCours.tournois.find(t => t.id === caseTournoi.dataset.id);
        for (const ref of parTournoi.get(caseTournoi.dataset.id) || []) {
            if (!requises.has(ref)) requises.set(ref, []);
            requises.get(ref).push(tournoi ? tournoi.nom : caseTournoi.dataset.id);
        }
    }

    for (const caseJoueur of document.querySelectorAll('.restaure-joueur')) {
        const reclamants = requises.get(caseJoueur.dataset.id);
        caseJoueur.disabled = Boolean(reclamants);
        if (reclamants) caseJoueur.checked = true;

        const ligne = document.querySelector('[data-fiche="' + caseJoueur.dataset.id + '"]');
        const mention = ligne && ligne.querySelector('.restaure-requis');
        if (mention) {
            mention.textContent = reclamants
                ? 'requis par ' + reclamants.join(', ')
                : '';
        }
    }
}

function coches(selecteur) {
    return Array.from(document.querySelectorAll(selecteur))
        .filter(c => c.checked)
        .map(c => c.dataset.id);
}

function fermerImport() {
    sauvegardeEnAttente = null;
    planEnCours = { tournois: [], joueurs: [] };
    document.getElementById('import-panel').hidden = true;
    document.getElementById('import-progress').textContent = '';
}

// Chaque tournoi est écrit avec la version que le serveur annonce à l'instant :
// l'écriture est acceptée, et le tournoi restauré repart sur une version propre.
async function appliquerRestauration() {
    if (!sauvegardeEnAttente) return;

    const tournoisRetenus = planEnCours.tournois.filter(t => coches('.restaure-tournoi').includes(t.id));
    const fichesRetenues = planEnCours.joueurs.filter(j => coches('.restaure-joueur').includes(j.id));

    if (!tournoisRetenus.length && !fichesRetenues.length) {
        notifier('Rien de coché : il n\'y a rien à restaurer.');
        return;
    }

    const bouton = document.getElementById('btn-import-confirm');
    const avancement = document.getElementById('import-progress');
    bouton.disabled = true;

    // Les fiches d'abord : un tournoi restauré avant elles afficherait
    // « Joueur supprimé » le temps que la liste suive.
    const fusion = fusionnerJoueurs(fichesRetenues, joueurs);
    const fichesTouchees = fusion.nouveaux.length + fusion.misAJour.length;
    if (fichesTouchees) {
        avancement.textContent = 'Restauration des fiches…';
        if (!await remplacerJoueurs(fusion.fusion)) {
            bouton.disabled = false;
            avancement.textContent = '';
            notifierErreur('La liste des joueurs n\'a pas pu être enregistrée : restauration abandonnée.');
            return;
        }
    }

    const echecs = [];
    let faits = 0;

    for (const tournoi of tournoisRetenus) {
        avancement.textContent = 'Restauration ' + (faits + echecs.length + 1) + '/' +
            tournoisRetenus.length + ' — ' + tournoi.nom;
        try {
            const url = urlEtat(tournoi.id);
            const actuel = await fetch(url);
            const distant = actuel.ok ? await actuel.json() : { version: 0 };

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ baseVersion: distant.version || 0, state: tournoi.enveloppe.state })
            });
            if (!res.ok) throw new Error('réponse ' + res.status);
            faits++;
        } catch (e) {
            echecs.push(tournoi.nom + ' (' + tournoi.id + ') : ' + e.message);
        }
    }

    const nomsRestaures = fusion.nouveaux.concat(fusion.misAJour).map(f => f.nom);
    avancement.textContent = '';
    fermerImport();

    // Nommer ce qui a été fait : un compte seul n'apprend rien.
    let compte = faits + ' tournoi(s) restauré(s)';
    compte += nomsRestaures.length
        ? ', ' + nomsRestaures.length + ' fiche(s) : ' + nomsRestaures.join(', ')
        : ', aucune fiche modifiée';
    if (echecs.length) {
        notifierErreur(compte + '.\n\nEn échec :\n' + echecs.join('\n'));
    } else {
        notifierSucces(compte + '.');
    }

    if (typeof rafraichirApresRestauration === 'function') {
        await rafraichirApresRestauration();
    }
}
