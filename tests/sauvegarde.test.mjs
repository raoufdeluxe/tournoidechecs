// Export et import de tous les tournois depuis la page.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';
import { joueurs } from './aide/tournoi.mjs';

const enveloppe = (nom, nbJoueurs = 2, version = 3) => ({
    version,
    updatedAt: '2026-09-01T10:00:00.000Z',
    state: {
        screen: 'screen-tournament',
        tournament: { name: nom, players: joueurs(Array.from({ length: nbJoueurs }, (_, i) => `J${i}`)), matches: [] },
    },
});

// Un tournoi dont chaque partie a ses propres réglages, dans les trois phases.
const enveloppeReglee = () => ({
    version: 4,
    updatedAt: '2026-09-01T10:00:00.000Z',
    state: {
        screen: 'screen-tournament',
        tournament: {
            name: 'Poule mixte',
            players: [{ id: 0, name: 'A', elo: null }, { id: 1, name: 'B', elo: null }],
            matches: [
                { id: '0-1-leg1', player1: 0, player2: 1, played: false, round: 1, cadence: '3', variante: '960' },
                { id: '0-1-leg2', player1: 0, player2: 1, played: false, round: 2, cadence: '24h', variante: 'classique' },
            ],
            semifinalMatches: [{
                id: 'semi-1', players: [0, 1], winner: null,
                matches: [{ player1: 0, player2: 1, num: 1, played: false, cadence: '5', variante: '960' }],
            }],
            finalMatches: [{ player1: 0, player2: 1, num: 1, played: false, cadence: '24h', variante: '960' }],
        },
    },
});

const enveloppeAvecRefs = (nom, refs) => ({
    version: 3,
    updatedAt: '2026-09-01T10:00:00.000Z',
    state: {
        screen: 'screen-tournament',
        tournament: {
            name: nom,
            players: refs.map((ref, i) => ({ id: i, ref, name: 'J' + i, elo: null })),
            matches: [],
        },
    },
});

const reponse = (status, corps) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
});

/**
 * Monte l'app avec un faux serveur : `tournois` est l'état distant, indexé par id.
 * Les POST sont enregistrés dans `app.ecritures`.
 */
async function appServeur(tournois = {}, { echouerSur = [] } = {}) {
    const ecritures = [];
    const roster = { joueurs: [], version: 0 };
    const app = chargerApp({ page: 'sauvegarde.html',
        fetch: async (url, init) => {
            const id = (url.match(/[?&]id=([^&]*)/) || [])[1];
            if (url.includes('/api/joueurs')) {
                if (init && ['POST', 'PUT'].includes(init.method)) {
                    roster.joueurs = JSON.parse(init.body).joueurs;
                    return reponse(200, { version: ++roster.version });
                }
                return reponse(200, { version: roster.version, joueurs: roster.joueurs });
            }
            if (url.includes('/api/tournois')) {
                return reponse(200, {
                    tournaments: Object.entries(tournois).map(([id, env]) => ({
                        id, name: env.state.tournament.name, screen: env.state.screen,
                        players: env.state.tournament.players.length, updatedAt: env.updatedAt,
                    })),
                    complete: true,
                });
            }
            if (init && init.method === 'POST') {
                if (echouerSur.includes(id)) return reponse(500, {});
                const corps = JSON.parse(init.body);
                ecritures.push({ id, ...corps });
                return reponse(200, { version: (corps.baseVersion || 0) + 1 });
            }
            const existant = tournois[decodeURIComponent(id || '')];
            return reponse(200, existant || { version: 0, updatedAt: null, state: null });
        },
    });
    await app.pret();
    app.ecritures = ecritures;
    app.roster = roster;
    // On capture le fichier plutôt que de le télécharger.
    app.ev('downloadFichier = function (nom, texte) { __fichier = { nom, texte }; };');
    app.oublierAppels();
    return app;
}

const fichierProduit = (app) => {
    const f = app.json('typeof __fichier !== "undefined" ? __fichier : null');
    return f && { nom: f.nom, contenu: JSON.parse(f.texte) };
};

describe('buildSauvegarde — le format', () => {
    test('en-tête : format, version et date ISO', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes') }]);
        const s = app.json('buildSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.equal(s.format, 'grand-prix-des-echecs/sauvegarde');
        assert.equal(s.version, 2);
        assert.equal(s.exporteLe, '2026-09-04T09:00:00.000Z');
    });

    test('les tournois sont décodés, pas des chaînes échappées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes', 4) }]);
        const s = app.json('buildSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.equal(s.tournois.abc.state.tournament.name, 'Les potes');
        assert.equal(s.tournois.abc.state.tournament.players.length, 4);
    });

    test('tri par identifiant : deux exports du même contenu donnent le même fichier', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const liste = [
            { id: 'zebre', enveloppe: enveloppe('Zèbre') },
            { id: 'abc', enveloppe: enveloppe('Les potes') },
        ];
        const date = 'new Date("2026-09-04T09:00:00Z")';
        app.set('globalThis.__t', liste);
        app.set('globalThis.__tInverse', [...liste].reverse());
        const a = JSON.stringify(app.json(`buildSauvegarde(__t, ${date})`));
        const b = JSON.stringify(app.json(`buildSauvegarde(__tInverse, ${date})`));
        assert.equal(a, b);
        assert.deepEqual(Object.keys(app.json(`buildSauvegarde(__t, ${date})`).tournois), ['abc', 'zebre']);
    });
});

describe('les fiches de joueurs voyagent avec la sauvegarde', () => {
    const fiches = [{ id: 'j-zz', nom: 'Zoé', elo: null }, { id: 'j-aa', nom: 'Alice', elo: 1500 }];

    test('l\'export embarque les fiches, triées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('joueurs', fiches);
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes') }]);
        const s = app.json('buildSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.deepEqual(s.joueurs.map(j => j.id), ['j-aa', 'j-zz']);
        assert.equal(s.joueurs.find(j => j.id === 'j-aa').elo, 1500);
    });

    test('fusion : le fichier fait foi, les fiches absentes sont conservées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__actuelles', [
            { id: 'j-aa', nom: 'Alice', elo: 1500 },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]);
        app.set('globalThis.__fichier', [
            { id: 'j-aa', nom: 'Alice Renommée', elo: 1600 },
            { id: 'j-cc', nom: 'Chloé', elo: null },
        ]);
        const r = app.json('mergeJoueurs(__fichier, __actuelles)');
        assert.deepEqual(r.fusion.map(j => j.id).sort(), ['j-aa', 'j-bb', 'j-cc']);
        assert.equal(r.fusion.find(j => j.id === 'j-aa').nom, 'Alice Renommée');
        assert.equal(r.fusion.find(j => j.id === 'j-bb').nom, 'Bob', 'la fiche absente du fichier survit');
        assert.deepEqual(r.nouveaux.map(j => j.id), ['j-cc']);
        assert.deepEqual(r.misAJour.map(j => j.id), ['j-aa']);
    });

    test('une fiche identique n\'est pas comptée comme mise à jour', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__f', [{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        const r = app.json('mergeJoueurs(__f, __f)');
        assert.deepEqual(r.nouveaux, []);
        assert.deepEqual(r.misAJour, []);
    });

    test('un fichier v1, sans fiches, reste lisible', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const v1 = {
            format: 'grand-prix-des-echecs/sauvegarde', version: 1,
            exporteLe: '2026-09-04T09:00:00.000Z', tournois: { abc: enveloppe('Les potes') },
        };
        assert.deepEqual(app.appel('readSauvegarde', JSON.stringify(v1)), v1);
    });

    test('une fiche incomplète fait rejeter le fichier', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const mauvais = {
            format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
            joueurs: [{ id: 'j-aa' }], tournois: {},
        };
        app.set('globalThis.__texte', JSON.stringify(mauvais));
        assert.throws(() => app.ev('readSauvegarde(__texte)'), /fiche de joueur est incomplète/);
    });
});

describe('la cadence et le type des parties voyagent avec la sauvegarde', () => {
    const reglages = (matches) => matches.map(m => [m.cadence, m.variante]);

    test('l\'export les garde, dans les trois phases', async () => {
        const app = await appServeur({ 'poule-mixte': enveloppeReglee() });
        await app.ev('exportTout()');
        const t = fichierProduit(app).contenu.tournois['poule-mixte'].state.tournament;

        assert.deepEqual(reglages(t.matches), [['3', '960'], ['24h', 'classique']]);
        assert.deepEqual(reglages(t.semifinalMatches[0].matches), [['5', '960']]);
        assert.deepEqual(reglages(t.finalMatches), [['24h', '960']]);
    });

    test('la restauration les réécrit tels quels', async () => {
        const app = await appServeur({});
        app.set('globalThis.__s', {
            format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
            joueurs: [], tournois: { 'poule-mixte': enveloppeReglee() },
        });
        app.ev('sauvegardeEnAttente = __s; planEnCours = planRestauration(__s, []);');
        app.definirElements('.restaure-tournoi', [{ checked: true, dataset: { id: 'poule-mixte' } }]);
        app.definirElements('.restaure-joueur', []);
        await app.ev('applyRestauration()');

        const ecrit = app.ecritures[0].state.tournament;
        assert.deepEqual(reglages(ecrit.matches), [['3', '960'], ['24h', 'classique']]);
        assert.deepEqual(reglages(ecrit.semifinalMatches[0].matches), [['5', '960']]);
        assert.deepEqual(reglages(ecrit.finalMatches), [['24h', '960']]);
    });

    test('un tournoi d\'avant cet ajout traverse l\'export sans gagner de champs', async () => {
        const app = await appServeur({ ancien: enveloppe('Ancien', 4) });
        await app.ev('exportTout()');
        const t = fichierProduit(app).contenu.tournois.ancien.state.tournament;
        assert.deepEqual(t.matches, [], 'rien n\'est inventé à l\'export');
    });
});

describe('readSauvegarde — un fichier douteux n\'atteint jamais le serveur', () => {
    const valide = {
        format: 'grand-prix-des-echecs/sauvegarde',
        version: 1,
        exporteLe: '2026-09-04T09:00:00.000Z',
        tournois: { abc: enveloppe('Les potes') },
    };

    const refus = [
        ['un fichier qui n\'est pas du JSON', 'nawak', /pas du JSON/],
        ['un tableau', '[]', /objet est attendu/],
        ['null', 'null', /objet est attendu/],
        ['un autre format', JSON.stringify({ ...valide, format: 'autre' }), /pas une sauvegarde/],
        ['une version inconnue', JSON.stringify({ ...valide, version: 99 }), /version 99/],
        ['aucun tournoi dedans', JSON.stringify({ ...valide, tournois: undefined }), /aucun tournoi/],
        ['un identifiant invalide', JSON.stringify({ ...valide, tournois: { 'PAS VALIDE': enveloppe('X') } }), /Identifiant de tournoi invalide/],
        ['un tournoi sans partants', JSON.stringify({ ...valide, tournois: { abc: { version: 1, state: { tournament: {} } } } }), /incomplet/],
        ['un tournoi sans état', JSON.stringify({ ...valide, tournois: { abc: { version: 1 } } }), /incomplet/],
    ];

    for (const [nom, texte, motif] of refus) {
        test(`refuse ${nom}`, () => {
            const app = chargerApp({ page: 'sauvegarde.html' });
            app.set('globalThis.__texte', texte);
            assert.throws(() => app.ev('readSauvegarde(__texte)'), motif);
        });
    }

    test('accepte un fichier produit par l\'export', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        assert.deepEqual(app.appel('readSauvegarde', JSON.stringify(valide)), valide);
    });
});

describe('planRestauration — une ligne par tournoi, une par fiche', () => {
    const sauvegarde = {
        format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
        joueurs: [{ id: 'j-aa', nom: 'Alice', elo: 1500 }, { id: 'j-bb', nom: 'Bob', elo: null }],
        tournois: { abc: enveloppe('Les potes', 4), zebre: enveloppe('Zèbre', 2) },
    };

    test('serveur vide : tous les tournois sont neufs', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const plan = app.appel('planRestauration', sauvegarde, []);
        assert.deepEqual(plan.tournois.map(t => [t.id, t.etat]), [['abc', 'nouveau'], ['zebre', 'nouveau']]);
    });

    test('un tournoi déjà présent sera remplacé', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const plan = app.appel('planRestauration', sauvegarde, ['abc']);
        assert.deepEqual(plan.tournois.map(t => [t.id, t.etat]), [['abc', 'remplacé'], ['zebre', 'nouveau']]);
    });

    test('un tournoi sans nom retombe sur son identifiant', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const sansNom = { ...sauvegarde, tournois: { gesphmww4k: enveloppe(null) } };
        assert.equal(app.appel('planRestauration', sansNom, []).tournois[0].nom, 'gesphmww4k');
    });

    test('l\'état de chaque fiche : nouvelle, mise à jour ou inchangée', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('joueurs', [{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        const fiches = app.appel('planRestauration', sauvegarde, []).joueurs;
        assert.deepEqual(fiches.map(j => [j.nom, j.etat]), [['Alice', 'inchangé'], ['Bob', 'nouveau']]);
    });

    test('une fiche dont le nom ou l\'Elo change est « mis à jour »', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('joueurs', [{ id: 'j-aa', nom: 'Alice', elo: 1200 }]);
        const fiches = app.appel('planRestauration', sauvegarde, []).joueurs;
        assert.equal(fiches.find(j => j.id === 'j-aa').etat, 'mis à jour');
    });

    test('les fiches que chaque tournoi réclame sont relevées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const avecRefs = { ...sauvegarde, tournois: { abc: enveloppeAvecRefs('Les potes', ['j-aa', 'j-bb', 'j-aa']) } };
        assert.deepEqual(app.appel('planRestauration', avecRefs, []).tournois[0].refs, ['j-aa', 'j-bb']);
    });

    test('un tournoi d\'avant les fiches ne réclame personne', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        assert.deepEqual(app.appel('planRestauration', sauvegarde, []).tournois[0].refs, []);
    });
});

describe('exportTout — le bouton', () => {
    test('les fiches sont relues au moment de l\'export, pas prises telles quelles', async () => {
        // Un clic rapide ne doit pas produire un fichier sans joueurs.
        const app = await appServeur({ abc: enveloppe('Les potes', 4) });
        app.roster.joueurs = [
            { id: 'j-aa', nom: 'Dans un tournoi', elo: null },
            { id: 'j-libre', nom: 'Jamais inscrit', elo: 1200 },
        ];
        app.ev('joueurs = [];'); // la page n'a pas encore reçu la liste
        await app.ev('exportTout()');
        assert.deepEqual(fichierProduit(app).contenu.joueurs.map(j => j.nom),
            ['Dans un tournoi', 'Jamais inscrit']);
    });

    test('un joueur qu\'aucun tournoi ne cite est exporté comme les autres', async () => {
        const app = await appServeur({ abc: enveloppe('Les potes', 4) });
        app.roster.joueurs = [{ id: 'j-libre', nom: 'Jamais inscrit', elo: 1200 }];
        await app.ev('exportTout()');
        assert.deepEqual(fichierProduit(app).contenu.joueurs.map(j => j.nom), ['Jamais inscrit']);
    });

    test('liste des joueurs injoignable : on refuse plutôt que d\'exporter sans elle', async () => {
        const app = chargerApp({
            page: 'sauvegarde.html',
            fetch: async (url) => {
                if (url.includes('/api/joueurs')) throw new Error('hors ligne');
                if (url.includes('/api/tournois')) return reponse(200, { tournaments: [], complete: true });
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        app.ev('downloadFichier = function (nom, texte) { __fichier = { nom, texte }; };');
        await app.ev('exportTout()');
        assert.match(app.alertes.at(-1), /Export impossible.*injoignable/s);
        assert.equal(app.json('typeof __fichier !== "undefined" ? __fichier : null'), null);
    });

    test('rassemble tous les tournois listés et produit un fichier daté', async () => {
        const app = await appServeur({ abc: enveloppe('Les potes', 4), zebre: enveloppe('Zèbre') });
        await app.ev('exportTout()');
        const fichier = fichierProduit(app);
        assert.match(fichier.nom, /^sauvegarde-\d{4}-\d{2}-\d{2}T[\d-]+\.json$/);
        assert.deepEqual(Object.keys(fichier.contenu.tournois), ['abc', 'zebre']);
        assert.equal(fichier.contenu.tournois.abc.state.tournament.name, 'Les potes');
    });

    test('l\'état complet est conservé, pas seulement le résumé de la liste', async () => {
        const app = await appServeur({ abc: enveloppe('Les potes', 4) });
        await app.ev('exportTout()');
        const tournoi = fichierProduit(app).contenu.tournois.abc;
        assert.equal(tournoi.version, 3);
        assert.equal(tournoi.state.screen, 'screen-tournament');
        assert.ok(Array.isArray(tournoi.state.tournament.matches));
    });

    test('ni tournoi ni joueur : on prévient et on n\'écrit pas de fichier vide', async () => {
        const app = await appServeur({});
        await app.ev('exportTout()');
        assert.equal(fichierProduit(app), null);
        assert.match(app.alertes.at(-1), /Rien à exporter/);
    });

    test('des joueurs sans aucun tournoi méritent quand même une sauvegarde', async () => {
        const app = await appServeur({});
        app.roster.joueurs = [{ id: 'j-aa', nom: 'Alice', elo: null }];
        await app.ev('exportTout()');
        const fichier = fichierProduit(app);
        assert.ok(fichier, 'un fichier est bien produit');
        assert.deepEqual(fichier.contenu.joueurs.map(j => j.nom), ['Alice']);
        assert.deepEqual(fichier.contenu.tournois, {});
    });

    test('serveur injoignable : message d\'erreur, pas de fichier', async () => {
        const app = chargerApp({ page: 'sauvegarde.html', fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        app.ev('downloadFichier = function (nom, texte) { __fichier = { nom, texte }; };');
        await app.ev('exportTout()');
        assert.match(app.alertes.at(-1), /Export impossible/);
    });

});

describe('prepareRestauration — le plan avant l\'écriture', () => {
    test('un fichier valide ouvre le panneau sans rien écrire', async () => {
        const app = await appServeur({ abc: enveloppe('Version serveur') });
        app.set('globalThis.__f', {});
        app.ev(`__f = { text: async () => ${JSON.stringify(JSON.stringify({
            format: 'grand-prix-des-echecs/sauvegarde', version: 1, exporteLe: '2026-09-04T09:00:00.000Z',
            tournois: { abc: enveloppe('Version fichier'), neuf: enveloppe('Nouveau') },
        }))} };`);
        await app.ev('prepareRestauration(__f)');

        assert.equal(app.ev('document.getElementById("import-panel").hidden'), false);
        assert.equal(app.ecritures.length, 0, 'rien n\'est écrit avant confirmation');
        const plan = app.ev('document.getElementById("import-plan").innerHTML');
        assert.match(plan, /Nouveau/);
        assert.match(plan, /Version fichier/);
        assert.match(plan, /Version fichier[\s\S]{0,60}remplacé/, 'l\'écrasement est annoncé');
        assert.match(plan, /Rien n'est encore écrit/, 'le panneau dit qu\'il n\'a rien fait');
    });

    test('liste du serveur illisible : le panneau le dit au lieu de tout annoncer comme neuf', async () => {
        const app = chargerApp({
            page: 'sauvegarde.html',
            fetch: async (url, init) => {
                if (url.includes('/api/tournois')) throw new Error('hors ligne');
                if (url.includes('/api/joueurs')) return reponse(200, { version: 0, joueurs: [] });
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        app.ev(`__f = { text: async () => ${JSON.stringify(JSON.stringify({
            format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
            tournois: { abc: enveloppe('Un') },
        }))} };`);
        await app.ev('prepareRestauration(__f)');
        const plan = app.ev('document.getElementById("import-plan").innerHTML');
        assert.match(plan, /n'a pas pu être lue/);
        assert.match(plan, /à écrire<\/span>/, 'on n\'annonce pas « nouveau » sans le savoir');
    });

    test('un fichier invalide prévient et laisse le panneau fermé', async () => {
        const app = await appServeur({});
        app.ev('__f = { text: async () => "nawak" };');
        await app.ev('prepareRestauration(__f)');
        assert.match(app.alertes.at(-1), /Import impossible/);
        assert.equal(app.ev('document.getElementById("import-panel").hidden'), true);
        assert.equal(app.ecritures.length, 0);
    });

    test('aucun fichier choisi : il ne se passe rien', async () => {
        const app = await appServeur({});
        await app.ev('prepareRestauration(undefined)');
        assert.deepEqual(app.alertes, []);
    });
});

describe('applyRestauration — seule la sélection est écrite', () => {
    /** Coche (ou non) les lignes du panneau, comme le ferait l'utilisateur. */
    function selectionner(app, { tournois = [], joueurs = [] }) {
        app.definirElements('.restaure-tournoi',
            tournois.map(t => ({ checked: t.coche !== false, dataset: { id: t.id } })));
        app.definirElements('.restaure-joueur',
            joueurs.map(j => ({ checked: j.coche !== false, dataset: { id: j.id } })));
    }

    async function appAvecPlan(distants, sauvegarde, selection) {
        const app = await appServeur(distants);
        app.set('globalThis.__s', sauvegarde);
        app.ev('sauvegardeEnAttente = __s; planEnCours = planRestauration(__s, []);');
        selectionner(app, selection);
        return app;
    }

    const sauvegarde = (tournois, fiches = []) => ({
        format: 'grand-prix-des-echecs/sauvegarde', version: 2,
        exporteLe: '2026-09-04T09:00:00.000Z', joueurs: fiches, tournois,
    });

    test('les tournois cochés sont écrits, les autres non', async () => {
        const app = await appAvecPlan({}, sauvegarde({ abc: enveloppe('Un'), zebre: enveloppe('Deux') }),
            { tournois: [{ id: 'abc' }, { id: 'zebre', coche: false }] });
        await app.ev('applyRestauration()');
        assert.deepEqual(app.ecritures.map(e => e.id), ['abc']);
    });

    test('chaque tournoi est écrit avec la version que le serveur annonce', async () => {
        const app = await appAvecPlan({ abc: enveloppe('Serveur', 2, 7) },
            sauvegarde({ abc: enveloppe('Fichier', 4) }), { tournois: [{ id: 'abc' }] });
        await app.ev('applyRestauration()');
        assert.equal(app.ecritures[0].baseVersion, 7, 'pas de 409');
        assert.equal(app.ecritures[0].state.tournament.name, 'Fichier');
    });

    test('les fiches cochées sont enregistrées, et nommées dans le compte rendu', async () => {
        const app = await appAvecPlan({}, sauvegarde({}, [
            { id: 'j-aa', nom: 'Alice', elo: 1500 },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]), { joueurs: [{ id: 'j-aa' }, { id: 'j-bb', coche: false }] });
        await app.ev('applyRestauration()');
        assert.deepEqual(app.roster.joueurs.map(j => j.nom), ['Alice'], 'Bob n\'était pas coché');
        assert.match(app.alertes.at(-1), /1 fiche\(s\) : Alice/);
    });

    test('le compte rendu nomme les joueurs restaurés', async () => {
        const app = await appAvecPlan({}, sauvegarde({ abc: enveloppe('Un') }, [
            { id: 'j-aa', nom: 'Alice', elo: null },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]), { tournois: [{ id: 'abc' }], joueurs: [{ id: 'j-aa' }, { id: 'j-bb' }] });
        await app.ev('applyRestauration()');
        assert.match(app.alertes.at(-1), /1 tournoi\(s\) restauré\(s\), 2 fiche\(s\) : Alice, Bob/);
    });

    test('aucune fiche modifiée : le compte rendu le dit', async () => {
        const app = await appAvecPlan({}, sauvegarde({ abc: enveloppe('Un') }), { tournois: [{ id: 'abc' }] });
        await app.ev('applyRestauration()');
        assert.match(app.alertes.at(-1), /aucune fiche modifiée/);
    });

    test('rien de coché : on prévient et on n\'écrit pas', async () => {
        const app = await appAvecPlan({}, sauvegarde({ abc: enveloppe('Un') }),
            { tournois: [{ id: 'abc', coche: false }] });
        await app.ev('applyRestauration()');
        assert.match(app.alertes.at(-1), /Rien de coché/);
        assert.deepEqual(app.ecritures, []);
    });

    test('les fiches partent avant les tournois', async () => {
        const ordre = [];
        const app = chargerApp({
            page: 'sauvegarde.html',
            fetch: async (url, init) => {
                if (init && ['POST', 'PUT'].includes(init.method)) {
                    ordre.push(url.includes('/api/joueurs') ? 'joueurs' : 'tournoi');
                }
                if (url.includes('/api/joueurs')) return reponse(200, { version: 1, joueurs: [] });
                if (url.includes('/api/tournois')) return reponse(200, { tournaments: [], complete: true });
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        app.set('globalThis.__s', sauvegarde({ abc: enveloppe('Un') }, [{ id: 'j-aa', nom: 'Alice', elo: null }]));
        app.ev('sauvegardeEnAttente = __s; planEnCours = planRestauration(__s, []);');
        selectionner(app, { tournois: [{ id: 'abc' }], joueurs: [{ id: 'j-aa' }] });
        await app.ev('applyRestauration()');
        assert.deepEqual(ordre, ['joueurs', 'tournoi']);
    });

    test('un échec sur un tournoi n\'arrête pas les autres et le nomme', async () => {
        const app = await appServeur({}, { echouerSur: ['casse'] });
        app.set('globalThis.__s', sauvegarde({
            casse: enveloppe('Cassé'), bon: enveloppe('Bon'), autre: enveloppe('Autre'),
        }));
        app.ev('sauvegardeEnAttente = __s; planEnCours = planRestauration(__s, []);');
        selectionner(app, { tournois: [{ id: 'casse' }, { id: 'bon' }, { id: 'autre' }] });
        await app.ev('applyRestauration()');

        assert.deepEqual(app.ecritures.map(e => e.id).sort(), ['autre', 'bon']);
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) restauré\(s\)/);
        assert.match(app.alertes.at(-1), /Cassé \(casse\)/);
    });

    test('le panneau se referme et le plan est oublié', async () => {
        const app = await appAvecPlan({}, sauvegarde({ abc: enveloppe('Un') }), { tournois: [{ id: 'abc' }] });
        await app.ev('applyRestauration()');
        assert.equal(app.ev('document.getElementById("import-panel").hidden'), true);
        assert.equal(app.ev('sauvegardeEnAttente'), null);
        assert.deepEqual(app.json('planEnCours.tournois'), []);
    });

    test('sans plan en attente, le bouton ne fait rien', async () => {
        const app = await appServeur({});
        await app.ev('applyRestauration()');
        assert.deepEqual(app.ecritures, []);
        assert.deepEqual(app.alertes, []);
    });
});

describe('une fiche réclamée par un tournoi coché ne se décoche pas', () => {
    /** Panneau rendu, avec de vraies cases interrogeables. */
    async function panneau(sauvegarde, readCoches = {}) {
        const app = await appServeur({});
        app.set('globalThis.__s', sauvegarde);
        app.ev('sauvegardeEnAttente = __s; planEnCours = planRestauration(__s, []);');

        const cases = { tournois: [], joueurs: [] };
        for (const t of app.json('planEnCours.tournois')) {
            cases.tournois.push({ checked: readCoches[t.id] !== false, dataset: { id: t.id }, disabled: false });
        }
        for (const j of app.json('planEnCours.joueurs')) {
            cases.joueurs.push({ checked: true, dataset: { id: j.id }, disabled: false });
        }
        app.definirElements('.restaure-tournoi', cases.tournois);
        app.definirElements('.restaure-joueur', cases.joueurs);
        app.ev('updateFichesRequises()');
        return { app, cases };
    }

    const avecRefs = (tournois, fiches) => ({
        format: 'grand-prix-des-echecs/sauvegarde', version: 2,
        exporteLe: '2026-09-04T09:00:00.000Z', joueurs: fiches, tournois,
    });

    test('la case du joueur est verrouillée et cochée', async () => {
        const { app } = await panneau(avecRefs(
            { abc: enveloppeAvecRefs('Les potes', ['j-aa']) },
            [{ id: 'j-aa', nom: 'Alice', elo: null }, { id: 'j-bb', nom: 'Bob', elo: null }]));

        const [alice, bob] = app.ev('__selecteurs[".restaure-joueur"]');
        assert.equal(alice.disabled, true, 'Alice est réclamée par le tournoi');
        assert.equal(alice.checked, true);
        assert.equal(bob.disabled, false, 'Bob ne l\'est pas');
    });

    test('décocher le tournoi libère ses joueurs', async () => {
        const { app, cases } = await panneau(avecRefs(
            { abc: enveloppeAvecRefs('Les potes', ['j-aa']) },
            [{ id: 'j-aa', nom: 'Alice', elo: null }]));
        assert.equal(app.ev('__selecteurs[".restaure-joueur"][0].disabled'), true);

        app.ev('__selecteurs[".restaure-tournoi"][0].checked = false; updateFichesRequises();');
        assert.equal(app.ev('__selecteurs[".restaure-joueur"][0].disabled'), false);
    });

    test('un joueur réclamé par deux tournois reste verrouillé si l\'un reste coché', async () => {
        const { app } = await panneau(avecRefs({
            abc: enveloppeAvecRefs('Les potes', ['j-aa']),
            zebre: enveloppeAvecRefs('Zèbre', ['j-aa']),
        }, [{ id: 'j-aa', nom: 'Alice', elo: null }]));

        app.ev('__selecteurs[".restaure-tournoi"][0].checked = false; updateFichesRequises();');
        assert.equal(app.ev('__selecteurs[".restaure-joueur"][0].disabled'), true, 'Zèbre la réclame encore');
    });
});
