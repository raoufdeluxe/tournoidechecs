// Phase de poule : calendrier aller/retour, classement et départages.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';
import { pouleGeneree, jouerPoule } from './aide/tournoi.mjs';

const noms = (n) => Array.from({ length: n }, (_, i) => `J${i}`);

describe('generateJournees — méthode du cercle', () => {
    for (const n of [4, 5, 6, 7, 8, 16]) {
        describe(`${n} partants`, () => {
            const app = chargerApp();
            const rounds = app.json(`generateJournees([${[...Array(n).keys()]}])`);

            test('nombre de journées : n-1, ou n si le nombre de partants est impair', () => {
                assert.equal(rounds.length, n % 2 === 0 ? n - 1 : n);
            });

            test('chaque paire de partants se rencontre exactement une fois', () => {
                const vus = new Map();
                for (const pairs of rounds) {
                    for (const [a, b] of pairs) {
                        const cle = [a, b].sort((x, y) => x - y).join('-');
                        vus.set(cle, (vus.get(cle) || 0) + 1);
                    }
                }
                assert.equal(vus.size, (n * (n - 1)) / 2, 'toutes les paires possibles');
                assert.ok([...vus.values()].every(v => v === 1), 'aucune paire en double');
            });

            test('personne ne joue deux fois dans la même journée', () => {
                for (const pairs of rounds) {
                    const joueursDuJour = pairs.flat();
                    assert.equal(new Set(joueursDuJour).size, joueursDuJour.length);
                }
            });

            test(`chaque journée compte ${Math.floor(n / 2)} duels (le partant au repos si impair)`, () => {
                for (const pairs of rounds) assert.equal(pairs.length, Math.floor(n / 2));
            });

            test('aucun duel contre le repos (null) ne se glisse dans le calendrier', () => {
                for (const pairs of rounds) {
                    for (const [a, b] of pairs) {
                        assert.notEqual(a, null);
                        assert.notEqual(b, null);
                    }
                }
            });
        });
    }

    test('nombre impair : chaque partant est au repos exactement une journée', () => {
        const app = chargerApp();
        const rounds = app.json('generateJournees([0,1,2,3,4])');
        const repos = rounds.map(pairs => {
            const joue = new Set(pairs.flat());
            return [0, 1, 2, 3, 4].filter(id => !joue.has(id));
        });
        assert.deepEqual(repos.map(r => r.length), [1, 1, 1, 1, 1]);
        assert.deepEqual(new Set(repos.flat()), new Set([0, 1, 2, 3, 4]));
    });
});

describe('generateCalendrier — aller/retour', () => {
    test('chaque paire se rencontre deux fois, une par manche', () => {
        const app = pouleGeneree(noms(6));
        const matches = app.json('tournoi.matches');
        assert.equal(matches.length, 6 * 5); // n(n-1) duels
        assert.equal(new Set(matches.map(m => m.id)).size, matches.length, 'identifiants uniques');

        const parPaire = new Map();
        for (const m of matches) {
            const cle = `${m.player1}-${m.player2}`;
            parPaire.set(cle, (parPaire.get(cle) || 0) + 1);
        }
        assert.equal(parPaire.size, 15);
        assert.ok([...parPaire.values()].every(v => v === 2));
    });

    test('les journées vont de 1 au total annoncé, le retour après l\'aller', () => {
        const app = pouleGeneree(noms(6));
        const matches = app.json('tournoi.matches');
        const total = app.ev('tournoi.totalRounds');
        assert.equal(total, 10); // 2 × (6-1)
        assert.deepEqual(
            [...new Set(matches.map(m => m.round))].sort((a, b) => a - b),
            Array.from({ length: total }, (_, i) => i + 1));
        assert.ok(matches.filter(m => m.id.endsWith('leg1')).every(m => m.round <= 5));
        assert.ok(matches.filter(m => m.id.endsWith('leg2')).every(m => m.round > 5));
    });

    test('regénérer la poule efface les phases finales devenues incohérentes', () => {
        const app = pouleGeneree(noms(4));
        app.set('tournoi.semifinalMatches', [{ id: 'semi-1' }]);
        app.set('tournoi.finalMatches', [{ num: 1 }]);
        app.ev('tournoi.players = tournoi.players.slice(0, 4); tournoi.semifinalMatches = []; tournoi.finalMatches = []; generateCalendrier();');
        assert.deepEqual(app.json('tournoi.semifinalMatches'), []);
        assert.deepEqual(app.json('tournoi.finalMatches'), []);
    });

    test('un nombre impair de partants ne produit aucun duel fantôme', () => {
        const app = pouleGeneree(noms(5));
        const matches = app.json('tournoi.matches');
        assert.equal(matches.length, 5 * 4);
        assert.ok(matches.every(m => m.player1 !== m.player2));
        assert.ok(matches.every(m => m.player1 < m.player2), 'le plus petit id est toujours player1');
    });
});

describe('computeClassement', () => {
    test('barème : victoire 1 pt, nulle 0,5 pt, défaite 0', () => {
        const app = pouleGeneree(noms(4));
        jouerPoule(app, { '0-1': 'p1', '0-2': 'draw' });
        const classement = app.json('computeClassement()');
        const par = (id) => classement.find(p => p.id === id);
        assert.deepEqual(
            { points: par(0).points, wins: par(0).wins, matches: par(0).matches },
            { points: 3, wins: 2, matches: 4 }); // 2 victoires + 2 nulles
        assert.equal(par(1).points, 0);
        assert.equal(par(2).points, 1);
    });

    test('les duels non joués ne comptent pas', () => {
        const app = pouleGeneree(noms(4));
        const classement = app.json('computeClassement()');
        assert.ok(classement.every(p => p.points === 0 && p.matches === 0));
    });

    test('à points égaux, le nombre de victoires départage', () => {
        const app = pouleGeneree(noms(4));
        // J0 : 2 victoires (2 pts) ; J1 : 4 nulles (2 pts) -> J0 devant.
        jouerPoule(app, { '0-1': 'p1', '1-2': 'draw', '1-3': 'draw' });
        const classement = app.json('computeClassement()');
        const rang = (id) => classement.findIndex(p => p.id === id);
        assert.equal(classement.find(p => p.id === 0).points, 2);
        assert.equal(classement.find(p => p.id === 1).points, 2);
        assert.ok(rang(0) < rang(1), 'le joueur aux 2 victoires passe devant celui qui a 4 nulles');
    });

    test('à points et victoires égaux, la confrontation directe tranche', () => {
        const app = pouleGeneree(noms(4));
        // J0 et J1 finissent à 3 points et 3 victoires, mais J0 a gagné leurs deux face-à-face.
        jouerPoule(app, {
            '0-1': 'p1',
            '0-2-leg1': 'p1', '0-2-leg2': 'p2',
            '0-3': 'p2',
            '1-2': 'p1',
            '1-3-leg1': 'p1', '1-3-leg2': 'p2',
            '2-3': 'draw',
        });
        const classement = app.json('computeClassement()');
        const j0 = classement.find(p => p.id === 0);
        const j1 = classement.find(p => p.id === 1);
        assert.equal(j0.points, j1.points);
        assert.equal(j0.wins, j1.wins);
        assert.ok(classement.findIndex(p => p.id === 0) < classement.findIndex(p => p.id === 1),
            'vainqueur de la confrontation directe devant');
    });

    test('classement arrêté à une journée : il ignore les journées suivantes', () => {
        const app = pouleGeneree(noms(4));
        jouerPoule(app, { '0-1': 'p1', '0-2': 'p1', '0-3': 'p1' });
        const jusqua1 = app.json('computeClassement(1)');
        const total = app.json('computeClassement()');
        assert.ok(jusqua1.find(p => p.id === 0).points < total.find(p => p.id === 0).points);
        assert.ok(jusqua1.every(p => p.matches <= 1), 'une journée = un duel par partant au plus');
    });

    test('le classement contient tous les partants, une seule fois chacun', () => {
        const app = pouleGeneree(noms(7));
        const classement = app.json('computeClassement()');
        assert.equal(classement.length, 7);
        assert.equal(new Set(classement.map(p => p.id)).size, 7);
    });
});

describe('countPartiesEnRetard — duels en retard', () => {
    test('compte les duels dus jusqu\'à la journée affichée, non joués', () => {
        const app = pouleGeneree(noms(4));
        app.ev('tournoi.currentRound = 1');
        assert.equal(app.appel('countPartiesEnRetard', 0), 1);
        const duJour = app.json('tournoi.matches.filter(m => m.round === 1 && (m.player1 === 0 || m.player2 === 0)).map(m => m.id)')[0];
        app.appel('setResultatPartie', duJour, 'p1');
        app.ev('tournoi.currentRound = 1');
        assert.equal(app.appel('countPartiesEnRetard', 0), 0);
    });
});

describe('getCoteDomicile — domicile / extérieur', () => {
    test('poule : le premier nommé reçoit à l\'aller, l\'autre au retour', () => {
        const app = chargerApp();
        assert.equal(app.appel('getCoteDomicile', { id: '0-1-leg1' }), 'p1');
        assert.equal(app.appel('getCoteDomicile', { id: '0-1-leg2' }), 'p2');
    });

    test('demies et finale : manche 1 chez l\'un, manche 2 chez l\'autre', () => {
        const app = chargerApp();
        assert.equal(app.appel('getCoteDomicile', { num: 1 }), 'p1');
        assert.equal(app.appel('getCoteDomicile', { num: 2 }), 'p2');
    });

    test('la belle se joue sur terrain neutre', () => {
        const app = chargerApp();
        assert.equal(app.appel('getCoteDomicile', { num: 3 }), null);
        assert.match(app.appel('buildBadgeTerrain', { num: 3 }, true), /neutre/);
    });
});

describe('computeProgression — le graphe journée après journée', () => {
    test('une série par partant, un point par journée, jamais décroissante', () => {
        const app = pouleGeneree(noms(4));
        jouerPoule(app, { '0-1': 'p1', '0-2': 'p1', '2-3': 'draw' });
        const data = app.json('computeProgression()');
        const total = app.ev('tournoi.totalRounds');
        assert.equal(data.length, 4);
        for (const serie of data) {
            assert.equal(serie.series.length, total);
            for (let i = 1; i < serie.series.length; i++) {
                assert.ok(serie.series[i] >= serie.series[i - 1], 'les points ne se perdent pas');
            }
        }
    });

    test('le dernier point de chaque série vaut les points du classement final', () => {
        const app = pouleGeneree(noms(4));
        jouerPoule(app, { '0-1': 'p1', '0-2': 'draw', '1-3': 'p2' });
        const data = app.json('computeProgression()');
        const classement = app.json('computeClassement()');
        for (const serie of data) {
            assert.equal(serie.series.at(-1), classement.find(p => p.id === serie.id).points);
        }
    });
});

describe('cadence et type des parties de la poule', () => {
    test('chaque duel naît en 10 min et classique', () => {
        const app = pouleGeneree(noms(4));
        const matches = app.json('tournoi.matches');
        assert.ok(matches.every(m => m.cadence === '10' && m.variante === 'classique'));
    });

    test('le réglage d\'un duel n\'affecte pas les autres', () => {
        const app = pouleGeneree(noms(4));
        const [premier, second] = app.json('tournoi.matches').map(m => m.id);
        app.appel('setCadencePartie', premier, '3');
        app.appel('setVariantePartie', premier, '960');

        const matches = app.json('tournoi.matches');
        assert.deepEqual(
            matches.filter(m => m.id === premier).map(m => [m.cadence, m.variante]),
            [['3', '960']]);
        assert.deepEqual(
            matches.filter(m => m.id === second).map(m => [m.cadence, m.variante]),
            [['10', 'classique']]);
    });

    test('un réglage inconnu ne change rien', () => {
        const app = pouleGeneree(noms(4));
        const id = app.json('tournoi.matches')[0].id;
        app.appel('setCadencePartie', id, '1h');
        assert.equal(app.json('tournoi.matches')[0].cadence, '10');
    });

    test('le réglage survit à la saisie d\'un résultat', () => {
        const app = pouleGeneree(noms(4));
        const id = app.json('tournoi.matches')[0].id;
        app.appel('setCadencePartie', id, '24h');
        app.appel('setResultatPartie', id, 'p1');
        const match = app.json('tournoi.matches').find(m => m.id === id);
        assert.equal(match.cadence, '24h');
        assert.equal(match.played, true);
    });

    test('un tournoi d\'avant cet ajout s\'affiche avec les valeurs par défaut', () => {
        const app = pouleGeneree(noms(4));
        app.ev('tournoi.matches.forEach(m => { delete m.cadence; delete m.variante; });');
        const matches = app.json('tournoi.matches');
        assert.ok(matches.every(m => m.cadence === undefined), 'rien n\'est réécrit en base');
        assert.equal(app.ev('getCadence(tournoi.matches[0])'), '10');
        assert.equal(app.ev('getVariante(tournoi.matches[0])'), 'classique');
    });
});
