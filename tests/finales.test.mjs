// Demi-finales et Grande Finale : qualification, belles, podium.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pouleGeneree, completerPoule } from './aide/tournoi.mjs';

const noms = (n) => Array.from({ length: n }, (_, i) => `J${i}`);

/** Poule terminée, demi-finales dressées. Renvoie l'app et le classement final. */
function pouleTerminee(nbJoueurs = 6, elos = []) {
    const app = pouleGeneree(noms(nbJoueurs), elos);
    completerPoule(app);
    app.ev('finalizeTournament()');
    return { app, classement: app.json('calculateStandings().map(p => p.id)') };
}

describe('finalizeTournament — la qualification', () => {
    test('les 4 premiers de la poule sont opposés 1er-4e et 2e-3e', () => {
        const { app, classement } = pouleTerminee(6);
        const demies = app.json('tournament.semifinalMatches');
        assert.equal(demies.length, 2);
        assert.deepEqual(demies[0].players, [classement[0], classement[3]]);
        assert.deepEqual(demies[1].players, [classement[1], classement[2]]);
    });

    test('chaque demie se joue en 2 manches, une chez chacun', () => {
        const { app } = pouleTerminee(6);
        for (const demie of app.json('tournament.semifinalMatches')) {
            assert.equal(demie.matches.length, 2);
            assert.deepEqual(demie.matches.map(m => m.num), [1, 2]);
            assert.ok(demie.matches.every(m => !m.played));
            assert.equal(demie.winner, null);
        }
    });

    test('une poule inachevée ne qualifie personne', () => {
        const app = pouleGeneree(noms(4));
        app.ev('finalizeTournament()');
        assert.deepEqual(app.json('tournament.semifinalMatches'), []);
        assert.equal(app.alertes.length, 1);
    });
});

describe('demi-finales', () => {
    test('2-0 : le vainqueur des manches est qualifié', () => {
        const { app, classement } = pouleTerminee(6);
        app.ev('setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p1");');
        assert.equal(app.json('tournament.semifinalMatches')[0].winner, classement[0]);
    });

    test('1-1 sans Elo : une belle est ajoutée, personne n\'est encore qualifié', () => {
        const { app } = pouleTerminee(6);
        app.ev('setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p2");');
        const demie = app.json('tournament.semifinalMatches')[0];
        assert.equal(demie.matches.length, 3);
        assert.equal(demie.matches[2].num, 3);
        assert.equal(demie.winner, null);
    });

    test('la belle n\'est ajoutée qu\'une seule fois', () => {
        const { app } = pouleTerminee(6);
        app.ev('setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p2");');
        app.ev('checkSemifinalsComplete(); checkSemifinalsComplete();');
        assert.equal(app.json('tournament.semifinalMatches')[0].matches.length, 3);
    });

    test('1-1 avec Elos : le moins bien classé passe, sans belle', () => {
        // Elos décroissants : le 1er de la poule aura toujours un Elo plus haut que le 4e.
        const elos = [2000, 1900, 1800, 1700, 1600, 1500];
        const { app, classement } = pouleTerminee(6, elos);
        app.ev('setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p2");');
        const demie = app.json('tournament.semifinalMatches')[0];
        assert.equal(demie.matches.length, 2, 'pas de belle quand l\'Elo tranche');
        const [a, b] = demie.players;
        assert.equal(demie.winner, elos[a] < elos[b] ? a : b);
        assert.equal(demie.winner, classement[3], 'l\'outsider passe');
    });

    test('effacer un résultat déqualifie', () => {
        const { app } = pouleTerminee(6);
        app.ev('setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p1");');
        assert.notEqual(app.json('tournament.semifinalMatches')[0].winner, null);
        app.ev('setSemifinalResult(0, 1, "")');
        assert.equal(app.json('tournament.semifinalMatches')[0].winner, null);
    });
});

describe('calculateSemifinalScores', () => {
    test('victoire 1, nulle 0,5, et l\'état « tout joué »', () => {
        const { app } = pouleTerminee(6);
        app.ev('setSemifinalResult(0, 0, "draw")');
        let scores = app.json('calculateSemifinalScores(tournament.semifinalMatches[0])');
        assert.deepEqual([scores.player1, scores.player2], [0.5, 0.5]);
        assert.equal(scores.allPlayed, false);
        app.ev('setSemifinalResult(0, 1, "p1")');
        scores = app.json('calculateSemifinalScores(tournament.semifinalMatches[0])');
        assert.deepEqual([scores.player1, scores.player2], [1.5, 0.5]);
        assert.equal(scores.allPlayed, true);
    });
});

/** Qualifie les deux têtes de série et lance la Grande Finale. */
function finaleLancee(elos = []) {
    const { app, classement } = pouleTerminee(6, elos);
    app.ev(`
        setSemifinalResult(0, 0, "p1"); setSemifinalResult(0, 1, "p1");
        setSemifinalResult(1, 0, "p1"); setSemifinalResult(1, 1, "p1");
        startFinals();
    `);
    return { app, classement };
}

describe('Grande Finale', () => {
    test('elle oppose les deux vainqueurs des demies, en 2 manches', () => {
        const { app, classement } = finaleLancee();
        const finale = app.json('tournament.finalMatches');
        assert.equal(finale.length, 2);
        assert.deepEqual([finale[0].player1, finale[0].player2], [classement[0], classement[1]]);
        assert.deepEqual(finale.map(m => m.num), [1, 2]);
    });

    test('2-0 : le champion est proclamé, le finaliste est vice-champion', () => {
        const { app, classement } = finaleLancee();
        app.ev('setFinalResult(0, "p1"); setFinalResult(1, "p1"); finalizeFinals();');
        assert.equal(app.ev('tournament.championId'), classement[0]);
        assert.equal(app.ev('tournament.runnerId'), classement[1]);
    });

    test('1-1 sans Elo : belle ajoutée, pas de champion tant qu\'elle n\'est pas jouée', () => {
        const { app } = finaleLancee();
        app.ev('setFinalResult(0, "p1"); setFinalResult(1, "p2");');
        assert.equal(app.json('tournament.finalMatches').length, 3);
        app.ev('finalizeFinals()');
        assert.equal(app.ev('tournament.championId ?? null'), null);
        // La belle ajoutée n'étant pas jouée, c'est le message « manches non jouées »
        // qui sort (la branche « manche décisive » de finalizeFinals est inatteignable).
        assert.match(app.alertes.at(-1), /doivent être jouées/);
    });

    test('1-1 avec Elos : l\'outsider est sacré sans belle', () => {
        const elos = [2000, 1900, 1800, 1700, 1600, 1500];
        const { app, classement } = finaleLancee(elos);
        app.ev('setFinalResult(0, "p1"); setFinalResult(1, "p2"); finalizeFinals();');
        assert.equal(app.json('tournament.finalMatches').length, 2);
        assert.equal(app.ev('tournament.championId'), classement[1], 'le moins bien classé Elo');
    });

    test('le podium est complet : champion, vice-champion et 3e distincts', () => {
        const { app } = finaleLancee();
        app.ev('setFinalResult(0, "p1"); setFinalResult(1, "p1"); finalizeFinals();');
        const podium = app.json('[tournament.championId, tournament.runnerId, tournament.thirdId]');
        assert.equal(new Set(podium).size, 3);
        assert.ok(podium.every(id => id != null));
    });

    test('la 3e place revient au mieux classé des deux perdants de demies', () => {
        const { app, classement } = finaleLancee();
        app.ev('setFinalResult(0, "p1"); setFinalResult(1, "p1"); finalizeFinals();');
        // Perdants des demies : le 4e (contre le 1er) et le 3e (contre le 2e).
        assert.equal(app.ev('tournament.thirdId'), classement[2]);
    });
});
