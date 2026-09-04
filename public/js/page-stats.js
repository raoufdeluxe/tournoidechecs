// Page /stats : comparer les joueurs, cadence par cadence et type par type.

let statsCalculees = { parRef: {}, ignorees: 0 };

async function startPageStats() {
    const zone = document.getElementById('stats-tables');
    zone.innerHTML = '<div class="tournaments-empty">Lecture des tournois…</div>';

    try {
        await loadJoueurs();
        const tournois = await fetchTournois();
        statsCalculees = computeStats(tournois);
    } catch (e) {
        zone.innerHTML = '<div class="tournaments-empty">Statistiques indisponibles — hors ligne ?</div>';
        return;
    }

    renderSelecteurJoueurs();
    renderStats();
}

// Un joueur sans aucune partie jouée n'a rien à comparer : on le propose quand
// même, mais décoché, pour que la sélection par défaut soit lisible.
function renderSelecteurJoueurs() {
    const zone = document.getElementById('stats-joueurs');

    if (!joueurs.length) {
        zone.innerHTML = '<div class="tournaments-empty">Aucun joueur enregistré. ' +
            '<a href="./joueurs">Ajoute-les</a> pour commencer à comparer.</div>';
        return;
    }

    zone.innerHTML = joueurs.map(j => {
        const stats = statsCalculees.parRef[j.id];
        const jouees = stats ? partiesJouees(stats.total) : 0;
        return `
            <label class="stats-joueur">
                <input type="checkbox" class="stats-case" data-id="${escapeHtml(j.id)}"
                       ${jouees ? 'checked' : ''} onchange="renderStats()">
                <span class="stats-joueur-nom">${escapeHtml(j.nom)}</span>
                <span class="stats-joueur-parties">${jouees} partie${jouees > 1 ? 's' : ''}</span>
            </label>`;
    }).join('');
}

function joueursCoches() {
    return Array.from(document.querySelectorAll('.stats-case'))
        .filter(c => c.checked)
        .map(c => getJoueur(c.dataset.id))
        .filter(Boolean);
}

// « 62 % » seul ne dit pas sur combien de parties : le détail suit, et le
// survol donne le bilan complet.
function celluleTaux(bilan) {
    const jouees = partiesJouees(bilan);
    if (!jouees) return '<td class="stats-vide" title="Aucune partie à ce format">—</td>';

    const taux = Math.round(tauxVictoire(bilan) * 100);
    const detail = `${bilan.victoires} victoire${bilan.victoires > 1 ? 's' : ''}, ` +
        `${bilan.nulles} nulle${bilan.nulles > 1 ? 's' : ''}, ` +
        `${bilan.defaites} défaite${bilan.defaites > 1 ? 's' : ''}`;
    return `<td title="${detail}"><strong>${taux} %</strong>` +
        `<span class="stats-detail">${jouees} partie${jouees > 1 ? 's' : ''}</span></td>`;
}

function renderTableau(titre, lignes, selection) {
    const entetes = selection.map(j => `<th>${escapeHtml(j.nom)}</th>`).join('');
    const corps = lignes.map(({ libelle, bilanDe }) => `
        <tr>
            <th scope="row">${escapeHtml(libelle)}</th>
            ${selection.map(j => celluleTaux(bilanDe(j))).join('')}
        </tr>`).join('');

    return `
        <h3 class="stats-titre">${escapeHtml(titre)}</h3>
        <div class="stats-defilement">
            <table class="stats-table">
                <thead><tr><th></th>${entetes}</tr></thead>
                <tbody>${corps}</tbody>
            </table>
        </div>`;
}

function renderStats() {
    const zone = document.getElementById('stats-tables');
    const selection = joueursCoches();

    if (!selection.length) {
        zone.innerHTML = '<div class="tournaments-empty">Coche au moins un joueur à comparer.</div>';
        return;
    }

    const statsDe = (joueur) => statsCalculees.parRef[joueur.id] || nouvellesStats();
    const vide = nouveauBilan();

    let html = renderTableau('Toutes parties confondues',
        [{ libelle: 'Victoires', bilanDe: (j) => statsDe(j).total }], selection);

    html += renderTableau('Par cadence', CADENCES.map(c => ({
        libelle: c.libelle,
        bilanDe: (j) => statsDe(j).parCadence[c.valeur] || vide
    })), selection);

    html += renderTableau('Par type de partie', VARIANTES.map(v => ({
        libelle: v.libelle,
        bilanDe: (j) => statsDe(j).parVariante[v.valeur] || vide
    })), selection);

    if (statsCalculees.ignorees) {
        html += `<div class="tournaments-empty">${statsCalculees.ignorees} partie(s) ne sont pas comptées : ` +
            'leurs partants ne sont rattachés à aucune fiche de joueur, on ne peut donc pas savoir qui a joué.</div>';
    }

    zone.innerHTML = html;
}

startPageStats();
