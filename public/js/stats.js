// Statistiques : pourcentage de victoire par cadence et par type de partie.
//
// Les parties sont comptées par fiche de joueur, jamais par nom : deux
// homonymes seraient confondus, et un renommage ferait disparaître un historique.
// Les partants sans fiche — les tournois d'avant leur existence — sont donc
// laissés de côté, et la page le dit plutôt que de fausser les comptes.

function nouveauBilan() {
    return { victoires: 0, nulles: 0, defaites: 0 };
}

const partiesJouees = (bilan) => bilan.victoires + bilan.nulles + bilan.defaites;

// Sans partie jouée il n'y a pas de pourcentage : null se distingue de 0 %.
function tauxVictoire(bilan) {
    const jouees = partiesJouees(bilan);
    return jouees ? bilan.victoires / jouees : null;
}

function nouvellesStats() {
    const parCadence = {};
    for (const c of CADENCES) parCadence[c.valeur] = nouveauBilan();
    const parVariante = {};
    for (const v of VARIANTES) parVariante[v.valeur] = nouveauBilan();
    return { total: nouveauBilan(), parCadence, parVariante };
}

// Toutes les parties d'un tournoi, poule et phases finales confondues.
function partiesDuTournoi(etat) {
    const t = (etat && etat.tournament) || {};
    return [
        ...(t.matches || []),
        ...(t.semifinalMatches || []).flatMap(s => s.matches || []),
        ...(t.finalMatches || [])
    ];
}

function ajouterPartie(stats, partie, issue) {
    const champ = issue === 'victoire' ? 'victoires' : issue === 'nulle' ? 'nulles' : 'defaites';
    stats.total[champ]++;
    stats.parCadence[getCadence(partie)][champ]++;
    stats.parVariante[getVariante(partie)][champ]++;
}

/**
 * Dépouille tous les tournois.
 * @param {Array<{id, enveloppe}>} tournois
 * @returns {{ parRef: Object, ignorees: number }} ignorees : parties dont au
 *          moins un partant n'a pas de fiche, donc non attribuables.
 */
function computeStats(tournois) {
    const parRef = {};
    let ignorees = 0;

    const statsDe = (ref) => (parRef[ref] = parRef[ref] || nouvellesStats());

    for (const { enveloppe } of tournois) {
        const etat = enveloppe && enveloppe.state;
        const partants = (etat && etat.tournament && etat.tournament.players) || [];

        for (const partie of partiesDuTournoi(etat)) {
            if (!partie.played) continue;

            const ref1 = (partants[partie.player1] || {}).ref;
            const ref2 = (partants[partie.player2] || {}).ref;
            if (!ref1 || !ref2) {
                ignorees++;
                continue;
            }

            const s1 = partie.player1Score;
            const s2 = partie.player2Score;
            const issue1 = s1 > s2 ? 'victoire' : s1 < s2 ? 'defaite' : 'nulle';
            const issue2 = s1 > s2 ? 'defaite' : s1 < s2 ? 'victoire' : 'nulle';

            ajouterPartie(statsDe(ref1), partie, issue1);
            ajouterPartie(statsDe(ref2), partie, issue2);
        }
    }

    return { parRef, ignorees };
}
