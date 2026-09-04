// Règles de départage : le cœur des règles du tournoi, indépendant de l'affichage.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';
import { joueurs, pouleGeneree, completerPoule } from './aide/tournoi.mjs';

const manche = (num, p1, p2, joue = true) => ({
    player1: 0, player2: 1, player1Score: p1, player2Score: p2, played: joue, num,
});

describe('applyResultat', () => {
    for (const [valeur, attendu] of [
        ['p1', { player1Score: 1, player2Score: 0, played: true }],
        ['p2', { player1Score: 0, player2Score: 1, played: true }],
        ['draw', { player1Score: 0.5, player2Score: 0.5, played: true }],
        ['', { player1Score: null, player2Score: null, played: false }],
    ]) {
        test(`« ${valeur || 'vide'} » donne ${JSON.stringify(attendu)}`, () => {
            const app = chargerApp();
            app.set('globalThis.m', { player1Score: 9, player2Score: 9, played: true });
            app.ev(`applyResultat(m, ${JSON.stringify(valeur)})`);
            assert.deepEqual(app.json('m'), attendu);
        });
    }
});

describe('resolveVainqueurElo — le plus bas Elo l\'emporte', () => {
    const cas = [
        ['Elo plus bas côté p1', 1200, 1800, 'p1'],
        ['Elo plus bas côté p2', 1800, 1200, 'p2'],
        ['Elos identiques', 1500, 1500, null],
        ['Elo manquant chez p1', null, 1500, null],
        ['Elo manquant chez p2', 1500, null, null],
        ['Elo manquant des deux côtés', null, null, null],
    ];
    for (const [nom, e1, e2, attendu] of cas) {
        test(nom, () => {
            const app = chargerApp();
            assert.equal(app.appel('resolveVainqueurElo', { id: 0, elo: e1 }, { id: 1, elo: e2 }), attendu);
        });
    }

    test('un Elo de 0 est une valeur, pas une absence', () => {
        const app = chargerApp();
        assert.equal(app.appel('resolveVainqueurElo', { id: 0, elo: 0 }, { id: 1, elo: 1500 }), 'p1');
    });
});

describe('resolveDuel — départage d\'un duel en 2 manches', () => {
    const p1 = { id: 0, name: 'A', elo: null };
    const p2 = { id: 1, name: 'B', elo: null };

    test('duel inachevé : aucun vainqueur, pas de belle', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel', [manche(1, 1, 0), manche(2, null, null, false)], p1, p2);
        assert.equal(r.winner, null);
        assert.equal(r.needsDecider, false);
        assert.deepEqual(r.scores, [1, 0]);
    });

    test('2-0 : le vainqueur des manches passe', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel', [manche(1, 1, 0), manche(2, 1, 0)], p1, p2);
        assert.equal(r.winner, p1.id);
        assert.equal(r.reason, null);
    });

    test('les nulles comptent une demi-manche chacune', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel', [manche(1, 0.5, 0.5), manche(2, 0, 1)], p1, p2);
        assert.deepEqual(r.scores, [0.5, 1.5]);
        assert.equal(r.winner, p2.id);
    });

    test('1-1 avec Elos : le moins bien classé est qualifié, motif à l\'appui', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel',
            [manche(1, 1, 0), manche(2, 0, 1)],
            { id: 0, name: 'A', elo: 1900 }, { id: 1, name: 'B', elo: 1400 });
        assert.equal(r.winner, 1);
        assert.equal(r.reason, 'Elo le plus bas');
        assert.equal(r.needsDecider, false);
    });

    test('1-1 sans Elo pour trancher : belle réclamée', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel', [manche(1, 1, 0), manche(2, 0, 1)], p1, p2);
        assert.equal(r.winner, null);
        assert.equal(r.needsDecider, true);
    });

    test('belle décisive : elle départage comme une manche ordinaire', () => {
        const app = chargerApp();
        const r = app.appel('resolveDuel',
            [manche(1, 1, 0), manche(2, 0, 1), manche(3, 1, 0)], p1, p2);
        assert.equal(r.winner, p1.id);
    });

    test('belle nulle : le mieux classé en poule l\'emporte, jamais de match sans vainqueur', () => {
        const app = pouleGeneree(['A', 'B', 'C', 'D']);
        completerPoule(app); // le joueur 0 gagne tout : il est 1er
        const r = app.appel('resolveDuel',
            [manche(1, 1, 0), manche(2, 0, 1), manche(3, 0.5, 0.5)],
            { id: 0, name: 'A', elo: null }, { id: 1, name: 'B', elo: null });
        assert.equal(r.winner, 0);
        assert.equal(r.reason, 'meilleur classement en poule');
        assert.equal(r.needsDecider, false);
    });
});

describe('addBelle', () => {
    test('ajoute une 3e manche entre les mêmes joueurs, non jouée', () => {
        const app = chargerApp();
        app.set('globalThis.duel', [manche(1, 1, 0), manche(2, 0, 1)]);
        app.ev('addBelle(duel)');
        const duel = app.json('duel');
        assert.equal(duel.length, 3);
        assert.deepEqual(duel[2], {
            player1: 0, player2: 1, player1Score: null, player2Score: null, played: false, num: 3,
            cadence: '10', variante: 'classique',
        });
    });
});

describe('resolveTroisiemePlace — la 3e place ne se joue pas', () => {
    function appAvecDemies(app, demies) {
        app.set('tournoi.semifinalMatches', demies);
        return app.appel('resolveTroisiemePlace');
    }

    test('le mieux classé en poule des deux perdants prend le bronze', () => {
        const app = pouleGeneree(['A', 'B', 'C', 'D']);
        completerPoule(app);
        const classement = app.json('computeClassement().map(p => p.id)');
        const [, second, troisieme] = classement;
        // Les deux perdants des demies : 2e et 3e de la poule -> le 2e est bronze.
        const bronze = appAvecDemies(app, [
            { players: [classement[0], second], winner: classement[0] },
            { players: [classement[3], troisieme], winner: classement[3] },
        ]);
        assert.equal(bronze, second);
    });

    test('aucune demie tranchée : pas de 3e place', () => {
        const app = pouleGeneree(['A', 'B', 'C', 'D']);
        completerPoule(app);
        assert.equal(appAvecDemies(app, [
            { players: [0, 1], winner: null },
            { players: [2, 3], winner: null },
        ]), null);
    });

    test('une seule demie tranchée : son perdant est provisoirement 3e', () => {
        const app = pouleGeneree(['A', 'B', 'C', 'D']);
        completerPoule(app);
        assert.equal(appAvecDemies(app, [
            { players: [0, 3], winner: 0 },
            { players: [1, 2], winner: null },
        ]), 3);
    });
});

describe('getClasseResultat / getIconeResultat', () => {
    test('un match non joué n\'affiche rien', () => {
        const app = chargerApp();
        assert.equal(app.appel('getClasseResultat', manche(1, null, null, false), true), '');
        assert.equal(app.appel('getIconeResultat', manche(1, null, null, false), true), '');
    });

    test('victoire, défaite et nulle vues des deux côtés', () => {
        const app = chargerApp();
        const m = manche(1, 1, 0);
        assert.equal(app.appel('getClasseResultat', m, true), 'winner');
        assert.equal(app.appel('getClasseResultat', m, false), 'loser');
        assert.equal(app.appel('getClasseResultat', manche(1, 0.5, 0.5), true), 'draw');
    });
});

describe('getCouleurCasaque — une casaque par partant', () => {
    test('la couleur est stable et la palette boucle', () => {
        const app = chargerApp();
        const taille = app.ev('COULEURS_CASAQUE.length');
        assert.equal(app.appel('getCouleurCasaque', 0), app.appel('getCouleurCasaque', taille));
        assert.notEqual(app.appel('getCouleurCasaque', 0), app.appel('getCouleurCasaque', 1));
    });
});


describe('cadence et variante d\'une partie', () => {
    test('sans réglage, une partie est en 10 min et classique', () => {
        const app = chargerApp();
        app.set('globalThis.m', { player1: 0, player2: 1 });
        assert.equal(app.ev('getCadence(m)'), '10');
        assert.equal(app.ev('getVariante(m)'), 'classique');
    });

    test('les quatre cadences proposées', () => {
        const app = chargerApp();
        assert.deepEqual(app.json('CADENCES.map(c => c.valeur)'), ['10', '5', '3', '24h']);
        assert.deepEqual(app.json('CADENCES.map(c => c.libelle)'), ['10 min', '5 min', '3 min', '24 h']);
    });

    test('les deux types de partie', () => {
        const app = chargerApp();
        assert.deepEqual(app.json('VARIANTES.map(v => v.valeur)'), ['classique', '960']);
        assert.deepEqual(app.json('VARIANTES.map(v => v.libelle)'), ['Classique', 'Chess960']);
    });

    test('les cadences et les types annoncés sont acceptés', () => {
        const app = chargerApp();
        app.set('globalThis.m', {});
        for (const valeur of ['10', '5', '3', '24h']) {
            assert.equal(app.ev(`setCadence(m, ${JSON.stringify(valeur)})`), true, valeur);
            assert.equal(app.ev('m.cadence'), valeur);
        }
        for (const valeur of ['classique', '960']) {
            assert.equal(app.ev(`setVariante(m, ${JSON.stringify(valeur)})`), true, valeur);
            assert.equal(app.ev('m.variante'), valeur);
        }
    });

    test('une valeur inconnue est ignorée, le réglage en place est gardé', () => {
        const app = chargerApp();
        app.set('globalThis.m', { cadence: '5', variante: '960' });
        assert.equal(app.ev('setCadence(m, "1h")'), false);
        assert.equal(app.ev('setVariante(m, "bughouse")'), false);
        assert.deepEqual(app.json('m'), { cadence: '5', variante: '960' });
    });

    test('une valeur abîmée en base retombe sur le défaut sans être réécrite', () => {
        const app = chargerApp();
        app.set('globalThis.m', { cadence: 'n\'importe quoi', variante: 42 });
        assert.equal(app.ev('getCadence(m)'), '10');
        assert.equal(app.ev('getVariante(m)'), 'classique');
        assert.equal(app.ev('m.cadence'), 'n\'importe quoi', 'le champ n\'est pas touché');
    });

    test('les menus marquent le réglage courant', () => {
        const app = chargerApp();
        app.set('globalThis.m', { cadence: '3', variante: '960' });
        const html = app.ev('buildReglagesPartie(m, "a()", "b()")');
        assert.match(html, /value="3" selected/);
        assert.match(html, /value="960" selected/);
        assert.doesNotMatch(html, /value="10" selected/);
        assert.match(html, /onchange="a\(\)"/);
        assert.match(html, /onchange="b\(\)"/);
    });

    test('la belle reprend le format du duel', () => {
        const app = chargerApp();
        app.set('globalThis.duel', [
            { player1: 0, player2: 1, num: 1, cadence: '3', variante: '960', played: true, player1Score: 1, player2Score: 0 },
            { player1: 0, player2: 1, num: 2, cadence: '3', variante: '960', played: true, player1Score: 0, player2Score: 1 },
        ]);
        app.ev('addBelle(duel)');
        const belle = app.json('duel')[2];
        assert.equal(belle.cadence, '3');
        assert.equal(belle.variante, '960');
    });
});
