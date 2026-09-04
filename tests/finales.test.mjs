// Demi-finales et Grande Finale : qualification, belles, podium.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pouleGeneree, completerPoule } from './aide/tournoi.mjs';

const noms = (n) => Array.from({ length: n }, (_, i) => `J${i}`);

/** Poule terminée, demi-finales dressées. Renvoie l'app et le classement final. */
function pouleTerminee(nbJoueurs = 6, elos = []) {
    const app = pouleGeneree(noms(nbJoueurs), elos);
    completerPoule(app);
    app.ev('finalizePoule()');
    return { app, classement: app.json('computeClassement().map(p => p.id)') };
}

describe('finalizePoule — la qualification', () => {
    test('les 4 premiers de la poule sont opposés 1er-4e et 2e-3e', () => {
        const { app, classement } = pouleTerminee(6);
        const demies = app.json('tournoi.semifinalMatches');
        assert.equal(demies.length, 2);
        assert.deepEqual(demies[0].players, [classement[0], classement[3]]);
        assert.deepEqual(demies[1].players, [classement[1], classement[2]]);
    });

    test('chaque demie se joue en 2 manches, une chez chacun', () => {
        const { app } = pouleTerminee(6);
        for (const demie of app.json('tournoi.semifinalMatches')) {
            assert.equal(demie.matches.length, 2);
            assert.deepEqual(demie.matches.map(m => m.num), [1, 2]);
            assert.ok(demie.matches.every(m => !m.played));
            assert.equal(demie.winner, null);
        }
    });

    test('une poule inachevée ne qualifie personne', () => {
        const app = pouleGeneree(noms(4));
        app.ev('finalizePoule()');
        assert.deepEqual(app.json('tournoi.semifinalMatches'), []);
        assert.equal(app.alertes.length, 1);
    });
});

describe('demi-finales', () => {
    test('2-0 : le vainqueur des manches est qualifié', () => {
        const { app, classement } = pouleTerminee(6);
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");');
        assert.equal(app.json('tournoi.semifinalMatches')[0].winner, classement[0]);
    });

    test('1-1 sans Elo : une belle est ajoutée, personne n\'est encore qualifié', () => {
        const { app } = pouleTerminee(6);
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p2");');
        const demie = app.json('tournoi.semifinalMatches')[0];
        assert.equal(demie.matches.length, 3);
        assert.equal(demie.matches[2].num, 3);
        assert.equal(demie.winner, null);
    });

    test('la belle n\'est ajoutée qu\'une seule fois', () => {
        const { app } = pouleTerminee(6);
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p2");');
        app.ev('checkDemiesTerminees(); checkDemiesTerminees();');
        assert.equal(app.json('tournoi.semifinalMatches')[0].matches.length, 3);
    });

    test('1-1 avec Elos : le moins bien classé passe, sans belle', () => {
        // Elos décroissants : le 1er de la poule aura toujours un Elo plus haut que le 4e.
        const elos = [2000, 1900, 1800, 1700, 1600, 1500];
        const { app, classement } = pouleTerminee(6, elos);
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p2");');
        const demie = app.json('tournoi.semifinalMatches')[0];
        assert.equal(demie.matches.length, 2, 'pas de belle quand l\'Elo tranche');
        const [a, b] = demie.players;
        assert.equal(demie.winner, elos[a] < elos[b] ? a : b);
        assert.equal(demie.winner, classement[3], 'l\'outsider passe');
    });

    test('effacer un résultat déqualifie', () => {
        const { app } = pouleTerminee(6);
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");');
        assert.notEqual(app.json('tournoi.semifinalMatches')[0].winner, null);
        app.ev('setResultatDemie(0, 1, "")');
        assert.equal(app.json('tournoi.semifinalMatches')[0].winner, null);
    });
});

describe('computeScoresDemie', () => {
    test('victoire 1, nulle 0,5, et l\'état « tout joué »', () => {
        const { app } = pouleTerminee(6);
        app.ev('setResultatDemie(0, 0, "draw")');
        let scores = app.json('computeScoresDemie(tournoi.semifinalMatches[0])');
        assert.deepEqual([scores.player1, scores.player2], [0.5, 0.5]);
        assert.equal(scores.allPlayed, false);
        app.ev('setResultatDemie(0, 1, "p1")');
        scores = app.json('computeScoresDemie(tournoi.semifinalMatches[0])');
        assert.deepEqual([scores.player1, scores.player2], [1.5, 0.5]);
        assert.equal(scores.allPlayed, true);
    });
});

/** Qualifie les deux têtes de série et lance la Grande Finale. */
function finaleLancee(elos = []) {
    const { app, classement } = pouleTerminee(6, elos);
    app.ev(`
        setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");
        setResultatDemie(1, 0, "p1"); setResultatDemie(1, 1, "p1");
        startFinale();
    `);
    return { app, classement };
}

describe('Grande Finale', () => {
    test('elle oppose les deux vainqueurs des demies, en 2 manches', () => {
        const { app, classement } = finaleLancee();
        const finale = app.json('tournoi.finalMatches');
        assert.equal(finale.length, 2);
        assert.deepEqual([finale[0].player1, finale[0].player2], [classement[0], classement[1]]);
        assert.deepEqual(finale.map(m => m.num), [1, 2]);
    });

    test('2-0 : le champion est proclamé, le finaliste est vice-champion', () => {
        const { app, classement } = finaleLancee();
        app.ev('setResultatFinale(0, "p1"); setResultatFinale(1, "p1"); finalizeFinale();');
        assert.equal(app.ev('tournoi.championId'), classement[0]);
        assert.equal(app.ev('tournoi.runnerId'), classement[1]);
    });

    test('1-1 sans Elo : belle ajoutée, pas de champion tant qu\'elle n\'est pas jouée', () => {
        const { app } = finaleLancee();
        app.ev('setResultatFinale(0, "p1"); setResultatFinale(1, "p2");');
        assert.equal(app.json('tournoi.finalMatches').length, 3);
        app.ev('finalizeFinale()');
        assert.equal(app.ev('tournoi.championId ?? null'), null);
        // La belle ajoutée n'étant pas jouée, c'est le message « manches non jouées »
        // qui sort (la branche « manche décisive » de finalizeFinale est inatteignable).
        assert.match(app.alertes.at(-1), /doivent être jouées/);
    });

    test('1-1 avec Elos : l\'outsider est sacré sans belle', () => {
        const elos = [2000, 1900, 1800, 1700, 1600, 1500];
        const { app, classement } = finaleLancee(elos);
        app.ev('setResultatFinale(0, "p1"); setResultatFinale(1, "p2"); finalizeFinale();');
        assert.equal(app.json('tournoi.finalMatches').length, 2);
        assert.equal(app.ev('tournoi.championId'), classement[1], 'le moins bien classé Elo');
    });

    test('le podium est complet : champion, vice-champion et 3e distincts', () => {
        const { app } = finaleLancee();
        app.ev('setResultatFinale(0, "p1"); setResultatFinale(1, "p1"); finalizeFinale();');
        const podium = app.json('[tournoi.championId, tournoi.runnerId, tournoi.thirdId]');
        assert.equal(new Set(podium).size, 3);
        assert.ok(podium.every(id => id != null));
    });

    test('la 3e place revient au mieux classé des deux perdants de demies', () => {
        const { app, classement } = finaleLancee();
        app.ev('setResultatFinale(0, "p1"); setResultatFinale(1, "p1"); finalizeFinale();');
        // Perdants des demies : le 4e (contre le 1er) et le 3e (contre le 2e).
        assert.equal(app.ev('tournoi.thirdId'), classement[2]);
    });
});

describe('cadence et type en phase finale', () => {
    test('les manches de demi-finale naissent avec les valeurs par défaut', () => {
        const { app } = pouleTerminee(6);
        for (const demie of app.json('tournoi.semifinalMatches')) {
            assert.ok(demie.matches.every(m => m.cadence === '10' && m.variante === 'classique'));
        }
    });

    test('régler une manche de demie n\'affecte pas l\'autre', () => {
        const { app } = pouleTerminee(6);
        app.appel('setCadenceDemie', 0, 0, '5');
        app.appel('setVarianteDemie', 0, 0, '960');
        const demie = app.json('tournoi.semifinalMatches')[0];
        assert.deepEqual([demie.matches[0].cadence, demie.matches[0].variante], ['5', '960']);
        assert.deepEqual([demie.matches[1].cadence, demie.matches[1].variante], ['10', 'classique']);
    });

    test('la belle d\'une demie reprend le format de la manche 1', () => {
        const { app } = pouleTerminee(6);
        app.appel('setCadenceDemie', 0, 0, '3');
        app.appel('setVarianteDemie', 0, 0, '960');
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p2");');
        const manches = app.json('tournoi.semifinalMatches')[0].matches;
        assert.equal(manches.length, 3);
        assert.deepEqual([manches[2].cadence, manches[2].variante], ['3', '960']);
    });

    test('la Grande Finale naît avec les valeurs par défaut, réglables', () => {
        const { app } = finaleLancee();
        assert.ok(app.json('tournoi.finalMatches').every(m => m.cadence === '10' && m.variante === 'classique'));
        app.appel('setCadenceFinale', 1, '24h');
        app.appel('setVarianteFinale', 1, '960');
        const finale = app.json('tournoi.finalMatches');
        assert.deepEqual([finale[1].cadence, finale[1].variante], ['24h', '960']);
        assert.deepEqual([finale[0].cadence, finale[0].variante], ['10', 'classique']);
    });

    test('un réglage inconnu ne change rien', () => {
        const { app } = finaleLancee();
        app.appel('setCadenceFinale', 0, 'blitz');
        assert.equal(app.json('tournoi.finalMatches')[0].cadence, '10');
    });
});
