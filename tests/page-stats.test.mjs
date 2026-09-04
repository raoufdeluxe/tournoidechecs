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

const tableaux = (app) => app.ev('document.getElementById("stats-tables").innerHTML');
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

describe('sélection des joueurs', () => {
    test('une case par joueur, avec son nombre de parties', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        const html = selecteur(app);
        assert.match(html, /Alice[\s\S]*?4 parties/);
        assert.match(html, /Bob[\s\S]*?4 parties/);
    });

    test('les joueurs qui ont joué sont cochés d\'emblée', async () => {
        const app = await pageStats({
            fiches: [...DEUX_JOUEURS, { id: 'j-neuf', nom: 'Jamais joué', elo: null }],
            tournois: UN_TOURNOI,
        });
        const html = selecteur(app);
        assert.match(html, /data-id="j-a"[^>]*checked/);
        assert.doesNotMatch(html, /data-id="j-neuf"[^>]*checked/, 'celui sans partie reste décoché');
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

describe('tableaux comparatifs', () => {
    function cocher(app, ids) {
        app.definirElements('.stats-case', ids.map(id => ({ checked: true, dataset: { id } })));
        app.ev('renderStats()');
    }

    test('un tableau par axe : total, cadence, type', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        cocher(app, ['j-a', 'j-b']);
        const html = tableaux(app);
        assert.match(html, /Toutes parties confondues/);
        assert.match(html, /Par cadence/);
        assert.match(html, /Par type de partie/);
        for (const libelle of ['10 min', '5 min', '3 min', '24 h', 'Classique', 'Chess960']) {
            assert.match(html, new RegExp(libelle.replace(' ', '\\s')), libelle);
        }
    });

    test('le pourcentage et le nombre de parties, avec le bilan en infobulle', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        cocher(app, ['j-a']);
        const html = tableaux(app);
        // Alice : 2 victoires, 1 nulle, 1 défaite sur 4 parties -> 50 %
        assert.match(html, /<strong>50 %<\/strong>/);
        assert.match(html, /4 parties/);
        assert.match(html, /title="2 victoires, 1 nulle, 1 défaite"/);
    });

    test('un format jamais joué affiche un tiret, pas 0 %', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        cocher(app, ['j-a']);
        const html = tableaux(app);
        assert.match(html, /class="stats-vide"[^>]*>—</);
        assert.match(html, /Aucune partie à ce format/);
    });

    test('comparer un seul joueur, ou plusieurs', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });

        cocher(app, ['j-a']);
        assert.equal((tableaux(app).match(/<th>Alice<\/th>/g) || []).length, 3, 'une colonne par tableau');
        assert.doesNotMatch(tableaux(app), /<th>Bob<\/th>/);

        cocher(app, ['j-a', 'j-b']);
        assert.match(tableaux(app), /<th>Alice<\/th><th>Bob<\/th>/);
    });

    test('rien de coché : on le dit', async () => {
        const app = await pageStats({ fiches: DEUX_JOUEURS, tournois: UN_TOURNOI });
        cocher(app, []);
        assert.match(tableaux(app), /Coche au moins un joueur/);
    });

    test('les parties non attribuables sont signalées, pas cachées', async () => {
        const app = await pageStats({
            fiches: DEUX_JOUEURS,
            tournois: {
                coupe: etatTournoi(['j-a', undefined], [partie(0, 1, 'p1')]),
            },
        });
        app.definirElements('.stats-case', [{ checked: true, dataset: { id: 'j-a' } }]);
        app.ev('renderStats()');
        assert.match(tableaux(app), /1 partie\(s\) ne sont pas comptées/);
    });

    test('serveur injoignable : message, pas de page blanche', async () => {
        const app = chargerApp({ page: 'stats.html', fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        assert.match(tableaux(app), /indisponibles/);
    });
});
