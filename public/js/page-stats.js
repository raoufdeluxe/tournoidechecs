// Page /stats : comparer les joueurs sur les formats qu'on choisit.

let statsCalculees = { parRef: {}, ignorees: 0 };

async function startPageStats() {
    const zone = document.getElementById('stats-graphe');
    zone.innerHTML = '<div class="tournaments-empty">Lecture des tournois…</div>';

    try {
        await loadJoueurs();
        statsCalculees = computeStats(await fetchTournois());
    } catch (e) {
        zone.innerHTML = '<div class="tournaments-empty">Statistiques indisponibles — hors ligne ?</div>';
        return;
    }

    renderFiltres();
    renderGrapheStats();
}

// --- Les filtres --------------------------------------------------------------

function caseFiltre(classe, valeur, libelle, complement) {
    return `
        <label class="stats-filtre">
            <input type="checkbox" class="${classe}" data-valeur="${escapeHtml(valeur)}" checked
                   onchange="renderGrapheStats()">
            <span class="stats-filtre-nom">${escapeHtml(libelle)}</span>
            ${complement ? `<span class="stats-filtre-detail">${escapeHtml(complement)}</span>` : ''}
        </label>`;
}

function renderFiltres() {
    const zoneJoueurs = document.getElementById('stats-joueurs');

    if (!joueurs.length) {
        zoneJoueurs.innerHTML = '<div class="tournaments-empty">Aucun joueur enregistré. ' +
            '<a href="./joueurs">Ajoute-les</a> pour commencer à comparer.</div>';
    } else {
        // Un joueur qui n'a jamais joué est proposé, mais décoché : sinon la
        // comparaison s'ouvre sur des barres vides.
        zoneJoueurs.innerHTML = joueurs.map(j => {
            const jouees = partiesJouees(bilanTotal(statsCalculees.parRef[j.id]));
            return `
                <label class="stats-filtre">
                    <input type="checkbox" class="stats-case-joueur" data-valeur="${escapeHtml(j.id)}"
                           ${jouees ? 'checked' : ''} onchange="renderGrapheStats()">
                    <span class="stats-filtre-nom">${escapeHtml(j.nom)}</span>
                    <span class="stats-filtre-detail">${jouees} partie${jouees > 1 ? 's' : ''}</span>
                </label>`;
        }).join('');
    }

    document.getElementById('stats-cadences').innerHTML =
        CADENCES.map(c => caseFiltre('stats-case-cadence', c.valeur, c.libelle)).join('');
    document.getElementById('stats-variantes').innerHTML =
        VARIANTES.map(v => caseFiltre('stats-case-variante', v.valeur, v.libelle)).join('');
}

const valeursCochees = (classe) => Array.from(document.querySelectorAll('.' + classe))
    .filter(c => c.checked)
    .map(c => c.dataset.valeur);

// --- Le graphe ----------------------------------------------------------------

function libelleFiltres(cadences, variantes) {
    const nom = (liste, choix) => choix.length === liste.length
        ? 'toutes'
        : choix.map(v => liste.find(x => x.valeur === v).libelle).join(', ');
    return 'Cadences : ' + nom(CADENCES, cadences) + ' · Types : ' + nom(VARIANTES, variantes);
}

// Barres horizontales : les noms se lisent sans pencher la tête, et le nombre
// de joueurs comparés ne serre jamais les colonnes.
function buildGraphe(lignes) {
    const largeur = 640;
    const hauteurLigne = 34;
    const padL = 130, padR = 56, padT = 22, padB = 8;
    const hauteur = padT + lignes.length * hauteurLigne + padB;
    const plotL = largeur - padL - padR;
    const xPour = (taux) => padL + taux * plotL;

    let grille = '';
    for (const palier of [0, 0.25, 0.5, 0.75, 1]) {
        const x = xPour(palier);
        grille += `<line x1="${x}" y1="${padT - 6}" x2="${x}" y2="${hauteur - padB}" stroke="var(--border)" stroke-width="1"/>`;
        grille += `<text x="${x}" y="${padT - 10}" font-size="10" fill="var(--text-secondary)" text-anchor="middle">${palier * 100} %</text>`;
    }

    let barres = '';
    lignes.forEach((ligne, i) => {
        const y = padT + i * hauteurLigne;
        const milieu = y + hauteurLigne / 2;
        const couleur = COULEURS_CASAQUE[i % COULEURS_CASAQUE.length];

        barres += `<text x="${padL - 10}" y="${milieu + 4}" font-size="12" font-weight="600"
                         fill="var(--text-primary)" text-anchor="end">${escapeHtml(ligne.nom)}</text>`;

        if (ligne.taux === null) {
            barres += `<text x="${padL + 8}" y="${milieu + 4}" font-size="11"
                             fill="var(--text-secondary)">aucune partie à ce format</text>`;
            return;
        }

        const largeurBarre = Math.max(2, xPour(ligne.taux) - padL);
        barres += `
            <rect x="${padL}" y="${y + 7}" width="${largeurBarre}" height="${hauteurLigne - 16}"
                  rx="4" fill="${couleur}">
                <title>${escapeHtml(ligne.nom)} — ${ligne.detail}</title>
            </rect>
            <text x="${padL + largeurBarre + 8}" y="${milieu + 4}" font-size="12" font-weight="700"
                  fill="var(--text-primary)">${Math.round(ligne.taux * 100)} %</text>
            <text x="${padL + largeurBarre + 8}" y="${milieu + 15}" font-size="9"
                  fill="var(--text-secondary)">${ligne.jouees} partie${ligne.jouees > 1 ? 's' : ''}</text>`;
    });

    // Pas de hauteur en pixels : avec une largeur à 100 %, le viewBox serait
    // mis en boîte aux lettres et le graphe flotterait au milieu de la carte.
    return `<svg viewBox="0 0 ${largeur} ${hauteur}" class="graphe-svg" role="img"
                 aria-label="Pourcentage de victoire par joueur">${grille}${barres}</svg>`;
}

function renderGrapheStats() {
    const zone = document.getElementById('stats-graphe');
    const refs = valeursCochees('stats-case-joueur');
    const cadences = valeursCochees('stats-case-cadence');
    const variantes = valeursCochees('stats-case-variante');

    if (!refs.length) {
        zone.innerHTML = '<div class="tournaments-empty">Coche au moins un joueur à comparer.</div>';
        return;
    }
    if (!cadences.length || !variantes.length) {
        zone.innerHTML = '<div class="tournaments-empty">Coche au moins une cadence et un type de partie.</div>';
        return;
    }

    const lignes = refs
        .map(ref => {
            const fiche = getJoueur(ref);
            const bilan = bilanFiltre(statsCalculees.parRef[ref], cadences, variantes);
            const jouees = partiesJouees(bilan);
            return {
                nom: fiche ? fiche.nom : ref,
                taux: tauxVictoire(bilan),
                jouees,
                detail: `${bilan.victoires} V, ${bilan.nulles} N, ${bilan.defaites} D sur ${jouees} partie${jouees > 1 ? 's' : ''}`
            };
        })
        // Le meilleur en haut ; ceux qui n'ont pas joué ce format en bas.
        .sort((a, b) => (b.taux ?? -1) - (a.taux ?? -1));

    let html = `<div class="stats-resume">${escapeHtml(libelleFiltres(cadences, variantes))}</div>`;
    html += buildGraphe(lignes);

    if (statsCalculees.ignorees) {
        html += `<div class="tournaments-empty">${statsCalculees.ignorees} partie(s) ne sont pas comptées : ` +
            'leurs partants ne sont rattachés à aucune fiche de joueur, on ne peut donc pas savoir qui a joué.</div>';
    }

    zone.innerHTML = html;
}

startPageStats();
