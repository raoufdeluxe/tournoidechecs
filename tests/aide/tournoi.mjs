// Fabriques de tournois pour les tests : évite de rejouer l'écran d'inscription.

import { chargerApp } from './app.mjs';

/** Joueurs prêts à l'emploi. `elos` est optionnel (null = Elo non renseigné). */
export function joueurs(noms, elos = []) {
    return noms.map((name, id) => ({ id, name, elo: elos[id] ?? null }));
}

/**
 * Monte une app avec une poule déjà générée (calendrier aller/retour complet).
 * @returns l'app, avec `tournoi.players` et `tournoi.matches` remplis.
 */
export function pouleGeneree(noms, elos = []) {
    const app = chargerApp();
    app.set('tournoi.players', joueurs(noms, elos));
    app.ev('generateCalendrier()');
    app.ev('tournoi.currentRound = tournoi.totalRounds');
    return app;
}

/**
 * Joue les duels de la poule selon `resultats` : { 'i-j': 'p1' | 'p2' | 'draw' }.
 * La clé vise les deux manches (aller et retour) sauf suffixe explicite `-leg1`/`-leg2`.
 */
export function jouerPoule(app, resultats) {
    for (const [cle, valeur] of Object.entries(resultats)) {
        const ids = /leg[12]$/.test(cle) ? [cle] : [`${cle}-leg1`, `${cle}-leg2`];
        for (const id of ids) app.appel('setResultatPartie', id, valeur);
    }
}

/** Joue tout ce qui reste de la poule en victoire du premier nommé. */
export function completerPoule(app) {
    const restants = app.json('tournoi.matches.filter(m => !m.played).map(m => m.id)');
    for (const id of restants) app.appel('setResultatPartie', id, 'p1');
}
