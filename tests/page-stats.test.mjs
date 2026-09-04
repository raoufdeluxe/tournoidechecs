// Page /stats : sélection des joueurs et lecture des tableaux.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

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

/** Page Stats branchée sur un faux serveur. */
async function pageStats({ fiches = [], tournois = {} } = {}) {
    const app = chargerApp({
        page: 'stats.html',
        fetch: async (url) => {
            const chemin = String(url).replace(/^https?:\/\/[^/]*/, '');
            const ok = (p) => ({ ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(p)) });
            if (chemin.startsWith('/api/joueurs')) return ok({ version: 1, joueurs: fiches });
            if (chemin.startsWith('/api/tournois')) {
                return ok({ tournaments: Object.keys(tournois).map(id => ({ id })), complete: true });
            }
            const id = decodeURIComponent((chemin.match(/[?&]id=([^&]*)/) || [])[1] || '');
            return ok(tournois[id] || { version: 0, state: null });
        },
    });
    await app.pret();
    return app;
}

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
function filtrer(app, { joueurs = [], cadences = ['10', '5', '3', '24h'], variantes = ['classique', '960'] }) {
    const cases = (liste) => liste.map(valeur => ({ checked: true, dataset: { valeur } }));
    app.definirElements('.stats-case-joueur', cases(joueurs));
    app.definirElements('.stats-case-cadence', cases(cadences));
    app.definirElements('.stats-case-variante', cases(variantes));
    app.ev('renderGrapheStats()');
}

describe('les filtres proposés', () => {
    test('une case par joueur, avec son nombre de parties', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        const html = selecteur(app);
        assert.match(html, /Alice[\s\S]*?4 parties/);
        assert.match(html, /Bob[\s\S]*?4 parties/);
    });

    test('les quatre cadences et les deux types, tous cochés', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        const cadences = app.ev('document.getElementById("stats-cadences").innerHTML');
        const variantes = app.ev('document.getElementById("stats-variantes").innerHTML');
        for (const libelle of ['10 min', '5 min', '3 min', '24 h']) {
            assert.match(cadences, new RegExp(libelle.replace(' ', '\\s')), libelle);
        }
        assert.match(variantes, /Classique/);
        assert.match(variantes, /Chess960/);
        assert.equal((cadences.match(/checked/g) || []).length, 4, 'tout est coché au départ');
        assert.equal((variantes.match(/checked/g) || []).length, 2);
    });

    test('les joueurs qui ont joué sont cochés d\'emblée', async () => {
        const app = await pageStats({
            fiches: [...DEUX_JOUEURS, { id: 'j-neuf', nom: 'Jamais joué', elo: null }],
            tournois: UN_TOURNOI,
        });
        const html = selecteur(app);
        assert.match(html, /data-valeur="j-a"[^>]*checked/);
        assert.doesNotMatch(html, /data-valeur="j-neuf"[^>]*checked/);
        assert.match(html, /Jamais joué/, 'mais reste proposé');
    });

    test('aucun joueur : on renvoie vers la page Joueurs', async () => {
        const app = await pageStats({ fiches: [], tournois: {} });
        assert.match(selecteur(app), /Aucun joueur enregistré/);
        assert.match(selecteur(app), /href="\.\/joueurs"/);
    });

    test('un nom piégé ne s\'injecte pas dans la page', async () => {
        const app = await pageStats({
            fiches: [{ id: 'j-a', nom: '<img src=x onerror="window.__XSS=1">', elo: null }],
            tournois: {},
        });
        assert.doesNotMatch(selecteur(app), /<img/);
        assert.match(selecteur(app), /&lt;img/);
    });
});

describe('le graphe', () => {
    test('une barre par joueur coché, avec son taux et son nombre de parties', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        const html = graphe(app);

        assert.match(html, /<svg/);
        assert.equal((html.match(/<rect/g) || []).length, 1, 'une barre');
        // Alice : 2 victoires, 1 nulle, 1 défaite sur 4 parties -> 50 %
        assert.match(html, />50 %</);
        assert.match(html, />4 parties</);
        assert.match(html, /<title>Alice — 2 V, 1 N, 1 D sur 4 parties<\/title>/);
    });

    test('filtrer sur une cadence ne garde que ces parties', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['3'] });
        // 3 min : 1 victoire, 1 défaite, 1 nulle -> 33 %
        assert.match(graphe(app), />33 %</);
        assert.match(graphe(app), />3 parties</);
    });

    test('filtrer sur un type croise avec la cadence', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['10'], variantes: ['classique'] });
        assert.match(graphe(app), />100 %</);
        assert.match(graphe(app), />1 partie</);
    });

    test('le filtre actif est rappelé en toutes lettres', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        assert.match(graphe(app), /Cadences : toutes · Types : toutes/);

        filtrer(app, { joueurs: ['j-a'], cadences: ['3', '5'], variantes: ['960'] });
        assert.match(graphe(app), /Cadences : 3 min, 5 min · Types : Chess960/);
    });

    test('un joueur sans partie à ce format est dit tel quel, sans barre', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: ['5'] });
        assert.match(graphe(app), /aucune partie à ce format/);
        assert.equal((graphe(app).match(/<rect/g) || []).length, 0);
    });

    test('les joueurs sont classés du meilleur au moins bon', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a', 'j-b'], cadences: ['10'] });
        const html = graphe(app);
        // Alice a gagné la partie en 10 min, Bob l'a perdue.
        assert.ok(html.indexOf('>Alice<') < html.indexOf('>Bob<'));
    });

    test('comparer un seul joueur, ou plusieurs', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'] });
        assert.doesNotMatch(graphe(app), />Bob</);
        filtrer(app, { joueurs: ['j-a', 'j-b'] });
        assert.match(graphe(app), />Bob</);
    });

    test('rien de coché : on le dit', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: [] });
        assert.match(graphe(app), /Coche au moins un joueur/);
    });

    test('aucune cadence ou aucun type : on le dit aussi', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        filtrer(app, { joueurs: ['j-a'], cadences: [] });
        assert.match(graphe(app), /au moins une cadence et un type/);

        filtrer(app, { joueurs: ['j-a'], variantes: [] });
        assert.match(graphe(app), /au moins une cadence et un type/);
    });

    test('les parties non attribuables sont signalées, pas cachées', async () => {
        const app = await pageStats({
            fiches: DEUX_JOUEURS,
            tournois: { coupe: etatTournoi(['j-a', undefined], [partie(0, 1, 'p1')]) },
        });
        filtrer(app, { joueurs: ['j-a'] });
        assert.match(graphe(app), /1 partie\(s\) ne sont pas comptées/);
    });

    test('serveur injoignable : message, pas de page blanche', async () => {
        const app = chargerApp({ page: 'stats.html', fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        assert.match(graphe(app), /indisponibles/);
    });
});
