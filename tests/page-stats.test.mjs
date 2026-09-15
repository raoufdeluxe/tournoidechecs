// Page /stats : sélection des joueurs et lecture des tableaux.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { appAvecServeur } from './aide/serveur.mjs';

const partie = (p1, p2, issue, cadence = '10', variante = 'classique') => ({
    id: `${p1}-${p2}-${issue}-${cadence}`,
    player1: p1, player2: p2,
    player1Score: issue === 'p1' ? 1 : issue === 'p2' ? 0 : 0.5,
    player2Score: issue === 'p1' ? 0 : issue === 'p2' ? 1 : 0.5,
    played: true, round: 1, cadence, variante,
});

const etatTournoi = (refs, parties) => ({
    version: 1,
    state: {
        screen: 'screen-tournament',
        tournament: {
            name: 'Tournoi',
            players: refs.map((ref, i) => ({ id: i, ref, name: 'J' + i, elo: null })),
            matches: parties,
        },
    },
});

/** Page Stats branchée sur le vrai Worker. */
const pageStats = (options) => appAvecServeur({ page: 'stats.html', ...options });

const graphe = (app) => app.ev('document.getElementById("stats-graphe").innerHTML');
const selecteur = (app) => app.ev('document.getElementById("stats-joueurs").innerHTML');

const DEUX_JOUEURS = [{ id: 'j-a', nom: 'Alice', elo: null }, { id: 'j-b', nom: 'Bob', elo: null }];
const UN_TOURNOI = {
    coupe: etatTournoi(['j-a', 'j-b'], [
        partie(0, 1, 'p1', '10', 'classique'),
        partie(0, 1, 'p1', '3', '960'),
        partie(0, 1, 'p2', '3', '960'),
        partie(0, 1, 'nulle', '3', '960'),
    ]),
};

/** Coche les filtres comme le ferait l'utilisateur. */
function filtrer(app, { joueurs = [], cadences = ['10', '5', '3', '24h', 'autre'], variantes = ['classique', '960'] }) {
    const cases = (liste) => liste.map(valeur => ({ checked: true, dataset: { valeur } }));
    app.definirElements('.stats-case-joueur', cases(joueurs));
    app.definirElements('.stats-case-cadence', cases(cadences));
    app.definirElements('.stats-case-variante', cases(variantes));
    app.ev('renderGrapheStats()');
}

describe('les filtres proposés', () => {
    test('une case par joueur, avec son nombre de parties', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        const html = selecteur(app);
        assert.match(html, /Alice[\s\S]*?4 parties/);
        assert.match(html, /Bob[\s\S]*?4 parties/);
    });

    test('les joueurs qui ont joué sont cochés d\'emblée', async () => {
        const app = await pageStats({
            joueurs: [...DEUX_JOUEURS, { id: 'j-neuf', nom: 'Jamais joué', elo: null }],
            tournois: UN_TOURNOI,
        });
        const html = selecteur(app);
        assert.match(html, /data-valeur="j-a"[^>]*checked/);
        assert.doesNotMatch(html, /data-valeur="j-neuf"[^>]*checked/);
        assert.match(html, /Jamais joué/, 'mais reste proposé');
    });

    test('aucun joueur : on renvoie vers la page Joueurs', async () => {
        const app = await pageStats();
        assert.match(selecteur(app), /Aucun joueur enregistré/);
        assert.match(selecteur(app), /href="\.\/joueurs"/);
    });

    test('la page ne fait pas tourner de tournoi', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        // Elle lit les tournois pour compter les parties, mais n'en ouvre aucun
        // et n'écrit jamais : une visite des stats ne crée rien.
        assert.equal(app.ev('typeof saveEtat'), 'undefined');
        assert.deepEqual(app.requetes.filter(r => r.methode !== 'GET'), []);
    });
});

describe('le graphe', () => {
    test('une barre par joueur coché, avec son taux et son nombre de parties', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        const html = graphe(app);

        // Alice : 2 victoires, 1 nulle, 1 défaite sur 4 parties -> 50 %
        assert.match(html, />50 %</);
        assert.match(html, />4 parties</);
        assert.match(html, /<title>Alice — 2 V, 1 N, 1 D sur 4 parties<\/title>/);
    });

    test('filtrer sur une cadence ne garde que ces parties', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['3'] });
        // 3 min : 1 victoire, 1 défaite, 1 nulle -> 33 %
        assert.match(graphe(app), />33 %</);
        assert.match(graphe(app), />3 parties</);
    });

    test('filtrer sur un type croise avec la cadence', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['10'], variantes: ['classique'] });
        assert.match(graphe(app), />100 %</);
        assert.match(graphe(app), />1 partie</);
    });

    test('le filtre actif est rappelé en toutes lettres', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        assert.match(graphe(app), /Cadences : toutes · Types : toutes/);

        filtrer(app, { joueurs: ['j-a'], cadences: ['3', '5'], variantes: ['960'] });
        assert.match(graphe(app), /Cadences : 3 min, 5 min · Types : Chess960/);
    });

    test('un joueur sans partie à ce format est dit tel quel, sans barre', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['5'] });
        assert.match(graphe(app), /aucune partie à ce format/);
        assert.doesNotMatch(graphe(app), /\d+ partie/, 'et aucune barre chiffrée');
    });

    test('les joueurs sont classés du meilleur au moins bon', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a', 'j-b'], cadences: ['10'] });
        const html = graphe(app);
        // Alice a gagné la partie en 10 min, Bob l'a perdue.
        assert.ok(html.indexOf('>Alice<') < html.indexOf('>Bob<'));
    });

    test('comparer un seul joueur, ou plusieurs', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        assert.doesNotMatch(graphe(app), />Bob</);
        filtrer(app, { joueurs: ['j-a', 'j-b'] });
        assert.match(graphe(app), />Bob</);
    });

    test('rien de coché : on le dit', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: [] });
        assert.match(graphe(app), /Coche au moins un joueur/);
    });

    test('aucune cadence ou aucun type : on le dit aussi', async () => {
        const app = await pageStats({ joueurs: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: [] });
        assert.match(graphe(app), /au moins une cadence et un type/);

        filtrer(app, { joueurs: ['j-a'], variantes: [] });
        assert.match(graphe(app), /au moins une cadence et un type/);
    });

    test('les parties non attribuables sont signalées, pas cachées', async () => {
        const app = await pageStats({
            joueurs: DEUX_JOUEURS,
            tournois: { coupe: etatTournoi(['j-a', undefined], [partie(0, 1, 'p1')]) },
        });
        filtrer(app, { joueurs: ['j-a'] });
        assert.match(graphe(app), /1 partie\(s\) ne sont pas comptées/);
    });

    test('serveur injoignable : message, pas de page blanche', async () => {
        const app = await pageStats({ panne: () => 'hors-ligne' });
        assert.match(graphe(app), /indisponibles/);
    });
});
