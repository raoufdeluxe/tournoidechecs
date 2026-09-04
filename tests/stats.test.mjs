// Statistiques : pourcentage de victoire par cadence et par type de partie.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

/**
 * Un tournoi dont on décrit les parties : [refBlanc, refNoir, issue, cadence, type].
 * `issue` vaut 'p1', 'p2' ou 'nulle' ; null pour une partie non jouée.
 */
function tournoi(id, refs, parties) {
    const index = new Map(refs.map((ref, i) => [ref, i]));
    return {
        id,
        enveloppe: {
            version: 1,
            state: {
                screen: 'screen-tournament',
                tournament: {
                    name: id,
                    players: refs.map((ref, i) => (ref
                        ? { id: i, ref, name: 'J' + i, elo: null }
                        : { id: i, name: 'Sans fiche', elo: null })),
                    matches: parties.map(([a, b, issue, cadence, variante], n) => ({
                        id: 'p' + n,
                        player1: index.get(a),
                        player2: index.get(b),
                        player1Score: issue === null ? null : issue === 'p1' ? 1 : issue === 'p2' ? 0 : 0.5,
                        player2Score: issue === null ? null : issue === 'p1' ? 0 : issue === 'p2' ? 1 : 0.5,
                        played: issue !== null,
                        round: 1,
                        cadence, variante,
                    })),
                },
            },
        },
    };
}

const stats = (app, tournois) => app.appel('computeStats', tournois);

describe('computeStats', () => {
    test('victoires, nulles et défaites sont attribuées aux deux joueurs', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, [tournoi('t', ['j-a', 'j-b'], [
            ['j-a', 'j-b', 'p1', '10', 'classique'],
            ['j-a', 'j-b', 'p2', '10', 'classique'],
            ['j-a', 'j-b', 'nulle', '10', 'classique'],
        ])]);
        assert.deepEqual(app.appel('bilanTotal', r.parRef['j-a']), { victoires: 1, nulles: 1, defaites: 1 });
        assert.deepEqual(app.appel('bilanTotal', r.parRef['j-b']), { victoires: 1, nulles: 1, defaites: 1 });
    });

    test('les parties non jouées ne comptent pas', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, [tournoi('t', ['j-a', 'j-b'], [
            ['j-a', 'j-b', 'p1', '10', 'classique'],
            ['j-a', 'j-b', null, '10', 'classique'],
        ])]);
        assert.deepEqual(app.appel('bilanTotal', r.parRef['j-a']), { victoires: 1, nulles: 0, defaites: 0 });
    });

    test('le bilan est tenu par couple cadence + type', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, [tournoi('t', ['j-a', 'j-b'], [
            ['j-a', 'j-b', 'p1', '3', '960'],
            ['j-a', 'j-b', 'p2', '3', 'classique'],
        ])]);
        assert.deepEqual(r.parRef['j-a'].parFormat['3|960'], { victoires: 1, nulles: 0, defaites: 0 });
        assert.deepEqual(r.parRef['j-a'].parFormat['3|classique'], { victoires: 0, nulles: 0, defaites: 1 });
        assert.deepEqual(r.parRef['j-a'].parFormat['10|960'], { victoires: 0, nulles: 0, defaites: 0 });
    });

    test('une partie sans réglage compte dans les valeurs par défaut', () => {
        const app = chargerApp({ page: 'stats.html' });
        const t = tournoi('t', ['j-a', 'j-b'], [['j-a', 'j-b', 'p1', undefined, undefined]]);
        const r = stats(app, [t]);
        assert.equal(r.parRef['j-a'].parFormat['10|classique'].victoires, 1);
    });

    test('les parties de plusieurs tournois s\'additionnent', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, [
            tournoi('un', ['j-a', 'j-b'], [['j-a', 'j-b', 'p1', '10', 'classique']]),
            tournoi('deux', ['j-a', 'j-c'], [['j-a', 'j-c', 'p1', '10', 'classique']]),
        ]);
        assert.equal(app.appel('bilanTotal', r.parRef['j-a']).victoires, 2);
        assert.equal(app.appel('bilanTotal', r.parRef['j-b']).defaites, 1);
        assert.equal(app.appel('bilanTotal', r.parRef['j-c']).defaites, 1);
    });

    test('les demi-finales et la finale comptent comme la poule', () => {
        const app = chargerApp({ page: 'stats.html' });
        const t = tournoi('t', ['j-a', 'j-b'], []);
        t.enveloppe.state.tournament.semifinalMatches = [{
            matches: [{ player1: 0, player2: 1, player1Score: 1, player2Score: 0, played: true, cadence: '5', variante: 'classique' }],
        }];
        t.enveloppe.state.tournament.finalMatches = [
            { player1: 0, player2: 1, player1Score: 0, player2Score: 1, played: true, cadence: '5', variante: '960' },
        ];
        const r = stats(app, [t]);
        assert.deepEqual(app.appel('bilanTotal', r.parRef['j-a']), { victoires: 1, nulles: 0, defaites: 1 });
        assert.deepEqual(r.parRef['j-a'].parFormat['5|classique'], { victoires: 1, nulles: 0, defaites: 0 });
        assert.deepEqual(r.parRef['j-a'].parFormat['5|960'], { victoires: 0, nulles: 0, defaites: 1 });
    });

    test('une partie dont un partant n\'a pas de fiche est écartée et comptée', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, [tournoi('t', ['j-a', null], [
            ['j-a', null, 'p1', '10', 'classique'],
        ])]);
        assert.deepEqual(r.parRef, {}, 'on n\'attribue rien à personne');
        assert.equal(r.ignorees, 1, 'mais on sait combien manquent');
    });

    test('aucun tournoi : des statistiques vides, pas une erreur', () => {
        const app = chargerApp({ page: 'stats.html' });
        const r = stats(app, []);
        assert.deepEqual(r, { parRef: {}, ignorees: 0 });
    });
});

describe('tauxVictoire', () => {
    test('le taux porte sur les parties jouées, nulles comprises', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.equal(app.appel('tauxVictoire', { victoires: 1, nulles: 1, defaites: 2 }), 0.25);
    });

    test('sans partie jouée, il n\'y a pas de taux — et 0 % serait un mensonge', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.equal(app.appel('tauxVictoire', { victoires: 0, nulles: 0, defaites: 0 }), null);
    });
});


describe('bilanFiltre — n\'importe quelle combinaison de formats', () => {
    function statsDeDeux(app) {
        return stats(app, [tournoi('t', ['j-a', 'j-b'], [
            ['j-a', 'j-b', 'p1', '3', '960'],
            ['j-a', 'j-b', 'p1', '3', 'classique'],
            ['j-a', 'j-b', 'p2', '10', '960'],
            ['j-a', 'j-b', 'nulle', '24h', 'classique'],
        ])]).parRef['j-a'];
    }

    test('tout coché : le bilan complet', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(
            app.appel('bilanFiltre', statsDeDeux(app), ['10', '5', '3', '24h'], ['classique', '960']),
            { victoires: 2, nulles: 1, defaites: 1 });
    });

    test('une seule cadence', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(app.appel('bilanFiltre', statsDeDeux(app), ['3'], ['classique', '960']),
            { victoires: 2, nulles: 0, defaites: 0 });
    });

    test('un seul type', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(app.appel('bilanFiltre', statsDeDeux(app), ['10', '5', '3', '24h'], ['960']),
            { victoires: 1, nulles: 0, defaites: 1 });
    });

    test('le croisement des deux : 3 min en Chess960 seulement', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(app.appel('bilanFiltre', statsDeDeux(app), ['3'], ['960']),
            { victoires: 1, nulles: 0, defaites: 0 });
    });

    test('un format jamais joué donne un bilan vide, pas une erreur', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(app.appel('bilanFiltre', statsDeDeux(app), ['5'], ['960']),
            { victoires: 0, nulles: 0, defaites: 0 });
    });

    test('un joueur inconnu ne fait pas tomber le calcul', () => {
        const app = chargerApp({ page: 'stats.html' });
        assert.deepEqual(app.appel('bilanFiltre', null, ['3'], ['960']),
            { victoires: 0, nulles: 0, defaites: 0 });
    });
});
