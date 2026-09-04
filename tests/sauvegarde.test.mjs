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
    const app = chargerApp({ page: 'sauvegarde.html',
        fetch: async (url, init) => {
            const id = (url.match(/[?&]id=([^&]*)/) || [])[1];
            if (url.includes('/api/joueurs')) {
                if (init && ['POST', 'PUT'].includes(init.method)) return reponse(200, { version: 1 });
                return reponse(200, { version: 0, joueurs: [] });
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
    // On capture le fichier plutôt que de le télécharger.
    app.ev('telechargerFichier = function (nom, texte) { __fichier = { nom, texte }; };');
    app.oublierAppels();
    return app;
}

const fichierProduit = (app) => {
    const f = app.json('typeof __fichier !== "undefined" ? __fichier : null');
    return f && { nom: f.nom, contenu: JSON.parse(f.texte) };
};

describe('construireSauvegarde — le format', () => {
    test('en-tête : format, version et date ISO', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes') }]);
        const s = app.json('construireSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.equal(s.format, 'grand-prix-des-echecs/sauvegarde');
        assert.equal(s.version, 2);
        assert.equal(s.exporteLe, '2026-09-04T09:00:00.000Z');
    });

    test('les tournois sont décodés, pas des chaînes échappées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes', 4) }]);
        const s = app.json('construireSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
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
        const a = JSON.stringify(app.json(`construireSauvegarde(__t, ${date})`));
        const b = JSON.stringify(app.json(`construireSauvegarde(__tInverse, ${date})`));
        assert.equal(a, b);
        assert.deepEqual(Object.keys(app.json(`construireSauvegarde(__t, ${date})`).tournois), ['abc', 'zebre']);
    });
});

describe('les fiches de joueurs voyagent avec la sauvegarde', () => {
    const fiches = [{ id: 'j-zz', nom: 'Zoé', elo: null }, { id: 'j-aa', nom: 'Alice', elo: 1500 }];

    test('l\'export embarque les fiches, triées', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('joueurs', fiches);
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes') }]);
        const s = app.json('construireSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.deepEqual(s.joueurs.map(j => j.id), ['j-aa', 'j-zz']);
        assert.equal(s.joueurs.find(j => j.id === 'j-aa').elo, 1500);
    });

    test('sans les fiches, un tournoi qui ne stocke que des renvois serait illisible', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('joueurs', fiches);
        app.set('globalThis.__t', [{ id: 'abc', enveloppe: enveloppe('Les potes') }]);
        const s = app.json('construireSauvegarde(__t, new Date("2026-09-04T09:00:00Z"))');
        assert.ok(s.joueurs.length, 'la sauvegarde porte de quoi résoudre les renvois');
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
        const r = app.json('fusionnerJoueurs(__fichier, __actuelles)');
        assert.deepEqual(r.fusion.map(j => j.id).sort(), ['j-aa', 'j-bb', 'j-cc']);
        assert.equal(r.fusion.find(j => j.id === 'j-aa').nom, 'Alice Renommée');
        assert.equal(r.fusion.find(j => j.id === 'j-bb').nom, 'Bob', 'la fiche absente du fichier survit');
        assert.deepEqual(r.nouveaux.map(j => j.id), ['j-cc']);
        assert.deepEqual(r.misAJour.map(j => j.id), ['j-aa']);
    });

    test('une fiche identique n\'est pas comptée comme mise à jour', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        app.set('globalThis.__f', [{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        const r = app.json('fusionnerJoueurs(__f, __f)');
        assert.deepEqual(r.nouveaux, []);
        assert.deepEqual(r.misAJour, []);
    });

    test('la restauration écrit les fiches avant les tournois', async () => {
        const ordre = [];
        const app = chargerApp({ page: 'sauvegarde.html',
            fetch: async (url, init) => {
                if (init && ['POST', 'PUT'].includes(init.method)) {
                    ordre.push(url.includes('/api/joueurs') ? 'joueurs' : 'tournoi');
                }
                if (url.includes('/api/joueurs')) return reponse(200, { version: 0, joueurs: [] });
                if (url.includes('/api/tournois')) return reponse(200, { tournaments: [], complete: true });
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        app.set('globalThis.__s', {
            format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
            joueurs: [{ id: 'j-aa', nom: 'Alice', elo: null }],
            tournois: { abc: enveloppe('Les potes') },
        });
        app.ev('sauvegardeEnAttente = __s;');
        await app.ev('appliquerRestauration()');
        assert.deepEqual(ordre, ['joueurs', 'tournoi']);
    });

    test('un fichier v1, sans fiches, reste lisible', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const v1 = {
            format: 'grand-prix-des-echecs/sauvegarde', version: 1,
            exporteLe: '2026-09-04T09:00:00.000Z', tournois: { abc: enveloppe('Les potes') },
        };
        assert.deepEqual(app.appel('lireSauvegarde', JSON.stringify(v1)), v1);
    });

    test('une fiche incomplète fait rejeter le fichier', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const mauvais = {
            format: 'grand-prix-des-echecs/sauvegarde', version: 2, exporteLe: '2026-09-04T09:00:00.000Z',
            joueurs: [{ id: 'j-aa' }], tournois: {},
        };
        app.set('globalThis.__texte', JSON.stringify(mauvais));
        assert.throws(() => app.ev('lireSauvegarde(__texte)'), /fiche de joueur est incomplète/);
    });
});

describe('lireSauvegarde — un fichier douteux n\'atteint jamais le serveur', () => {
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
            assert.throws(() => app.ev('lireSauvegarde(__texte)'), motif);
        });
    }

    test('accepte un fichier produit par l\'export', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        assert.deepEqual(app.appel('lireSauvegarde', JSON.stringify(valide)), valide);
    });
});

describe('planifierRestauration — ce qui va se passer', () => {
    const sauvegarde = {
        format: 'grand-prix-des-echecs/sauvegarde', version: 1, exporteLe: '2026-09-04T09:00:00.000Z',
        tournois: { abc: enveloppe('Les potes', 4), zebre: enveloppe('Zèbre', 2) },
    };

    test('serveur vide : tout est création', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const plan = app.appel('planifierRestauration', sauvegarde, []);
        assert.deepEqual(plan.creations.map(e => e.id), ['abc', 'zebre']);
        assert.deepEqual(plan.ecrasements, []);
    });

    test('un tournoi déjà présent est annoncé comme écrasement', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const plan = app.appel('planifierRestauration', sauvegarde, ['abc']);
        assert.deepEqual(plan.ecrasements.map(e => e.id), ['abc']);
        assert.deepEqual(plan.creations.map(e => e.id), ['zebre']);
    });

    test('chaque ligne porte le nom et le nombre de partants', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const [entree] = app.appel('planifierRestauration', sauvegarde, []).creations;
        assert.equal(entree.nom, 'Les potes');
        assert.equal(entree.partants, 4);
    });

    test('un tournoi sans nom retombe sur son identifiant', () => {
        const app = chargerApp({ page: 'sauvegarde.html' });
        const sansNom = { ...sauvegarde, tournois: { abc: enveloppe(null) } };
        assert.equal(app.appel('planifierRestauration', sansNom, []).creations[0].nom, 'abc');
    });
});

describe('exporterTournois — le bouton', () => {
    test('rassemble tous les tournois listés et produit un fichier daté', async () => {
        const app = await appServeur({ abc: enveloppe('Les potes', 4), zebre: enveloppe('Zèbre') });
        await app.ev('exporterTournois()');
        const fichier = fichierProduit(app);
        assert.match(fichier.nom, /^sauvegarde-\d{4}-\d{2}-\d{2}T[\d-]+\.json$/);
        assert.deepEqual(Object.keys(fichier.contenu.tournois), ['abc', 'zebre']);
        assert.equal(fichier.contenu.tournois.abc.state.tournament.name, 'Les potes');
    });

    test('l\'état complet est conservé, pas seulement le résumé de la liste', async () => {
        const app = await appServeur({ abc: enveloppe('Les potes', 4) });
        await app.ev('exporterTournois()');
        const tournoi = fichierProduit(app).contenu.tournois.abc;
        assert.equal(tournoi.version, 3);
        assert.equal(tournoi.state.screen, 'screen-tournament');
        assert.ok(Array.isArray(tournoi.state.tournament.matches));
    });

    test('ni tournoi ni joueur : on prévient et on n\'écrit pas de fichier vide', async () => {
        const app = await appServeur({});
        await app.ev('exporterTournois()');
        assert.equal(fichierProduit(app), null);
        assert.match(app.alertes.at(-1), /Rien à exporter/);
    });

    test('des joueurs sans aucun tournoi méritent quand même une sauvegarde', async () => {
        const app = await appServeur({});
        app.set('joueurs', [{ id: 'j-aa', nom: 'Alice', elo: null }]);
        await app.ev('exporterTournois()');
        const fichier = fichierProduit(app);
        assert.ok(fichier, 'un fichier est bien produit');
        assert.deepEqual(fichier.contenu.joueurs.map(j => j.nom), ['Alice']);
        assert.deepEqual(fichier.contenu.tournois, {});
    });

    test('serveur injoignable : message d\'erreur, pas de fichier', async () => {
        const app = chargerApp({ page: 'sauvegarde.html', fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        app.ev('telechargerFichier = function (nom, texte) { __fichier = { nom, texte }; };');
        await app.ev('exporterTournois()');
        assert.match(app.alertes.at(-1), /Export impossible/);
    });

    test('le bouton est rendu à son état initial même après un échec', async () => {
        const app = chargerApp({ page: 'sauvegarde.html', fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        await app.ev('exporterTournois()');
        assert.equal(app.ev('document.getElementById("btn-export").disabled'), false);
    });
});

describe('preparerRestauration — le plan avant l\'écriture', () => {
    test('un fichier valide ouvre le panneau sans rien écrire', async () => {
        const app = await appServeur({ abc: enveloppe('Version serveur') });
        app.set('globalThis.__f', {});
        app.ev(`__f = { text: async () => ${JSON.stringify(JSON.stringify({
            format: 'grand-prix-des-echecs/sauvegarde', version: 1, exporteLe: '2026-09-04T09:00:00.000Z',
            tournois: { abc: enveloppe('Version fichier'), neuf: enveloppe('Nouveau') },
        }))} };`);
        await app.ev('preparerRestauration(__f)');

        assert.equal(app.ev('document.getElementById("import-panel").hidden'), false);
        assert.equal(app.ecritures.length, 0, 'rien n\'est écrit avant confirmation');
        const plan = app.ev('document.getElementById("import-plan").innerHTML');
        assert.match(plan, /Nouveau/);
        assert.match(plan, /Version fichier/);
        assert.match(plan, /seront.*remplacés/s, 'l\'écrasement est annoncé');
    });

    test('un fichier invalide prévient et laisse le panneau fermé', async () => {
        const app = await appServeur({});
        app.ev('__f = { text: async () => "nawak" };');
        await app.ev('preparerRestauration(__f)');
        assert.match(app.alertes.at(-1), /Import impossible/);
        assert.equal(app.ev('document.getElementById("import-panel").hidden'), true);
        assert.equal(app.ecritures.length, 0);
    });

    test('aucun fichier choisi : il ne se passe rien', async () => {
        const app = await appServeur({});
        await app.ev('preparerRestauration(undefined)');
        assert.deepEqual(app.alertes, []);
    });
});

describe('appliquerRestauration — l\'écriture', () => {
    async function appAvecSauvegardeEnAttente(distants, tournois) {
        const app = await appServeur(distants);
        app.set('globalThis.__s', {
            format: 'grand-prix-des-echecs/sauvegarde', version: 1,
            exporteLe: '2026-09-04T09:00:00.000Z', tournois,
        });
        app.ev('sauvegardeEnAttente = __s;');
        return app;
    }

    test('chaque tournoi est écrit avec la version que le serveur annonce', async () => {
        const app = await appAvecSauvegardeEnAttente(
            { abc: enveloppe('Serveur', 2, 7) },
            { abc: enveloppe('Fichier', 4), neuf: enveloppe('Neuf') });
        await app.ev('appliquerRestauration()');

        const abc = app.ecritures.find(e => e.id === 'abc');
        assert.equal(abc.baseVersion, 7, 'se cale sur la version distante, donc pas de 409');
        assert.equal(abc.state.tournament.name, 'Fichier');

        const neuf = app.ecritures.find(e => e.id === 'neuf');
        assert.equal(neuf.baseVersion, 0, 'un tournoi absent part de zéro');
    });

    test('tous les tournois du fichier sont écrits, et rien d\'autre', async () => {
        const app = await appAvecSauvegardeEnAttente(
            { autre: enveloppe('À ne pas toucher') },
            { abc: enveloppe('Un'), zebre: enveloppe('Deux') });
        await app.ev('appliquerRestauration()');
        assert.deepEqual(app.ecritures.map(e => e.id).sort(), ['abc', 'zebre']);
    });

    test('le compte rendu parle des tournois et des fiches', async () => {
        const app = await appAvecSauvegardeEnAttente({}, { abc: enveloppe('Un') });
        app.ev('__s.joueurs = [{ id: "j-neuf", nom: "Neuf", elo: null }];');
        await app.ev('appliquerRestauration()');
        assert.match(app.alertes.at(-1), /1 tournoi\(s\) et 1 fiche\(s\) de joueur restaurés/);
    });

    test('le panneau se referme et le compte est annoncé', async () => {
        const app = await appAvecSauvegardeEnAttente({}, { abc: enveloppe('Un') });
        await app.ev('appliquerRestauration()');
        assert.equal(app.ev('document.getElementById("import-panel").hidden'), true);
        assert.equal(app.ev('sauvegardeEnAttente'), null);
        assert.match(app.alertes.at(-1), /1 tournoi\(s\) et 0 fiche\(s\) de joueur restaurés/);
    });

    test('un échec sur un tournoi n\'arrête pas les autres et est signalé', async () => {
        const ecritures = [];
        const app = chargerApp({ page: 'sauvegarde.html',
            fetch: async (url, init) => {
                const id = (url.match(/[?&]id=([^&]*)/) || [])[1];
                if (url.includes('/api/tournois')) return reponse(200, { tournaments: [], complete: true });
                if (init && init.method === 'POST') {
                    if (id === 'casse') return reponse(500, {});
                    ecritures.push(id);
                    return reponse(200, { version: 1 });
                }
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        app.set('globalThis.__s', {
            format: 'grand-prix-des-echecs/sauvegarde', version: 1, exporteLe: '2026-09-04T09:00:00.000Z',
            tournois: { casse: enveloppe('Cassé'), bon: enveloppe('Bon'), autre: enveloppe('Autre') },
        });
        app.ev('sauvegardeEnAttente = __s; appliquerRestauration();');
        await app.pret();

        assert.deepEqual(ecritures.sort(), ['autre', 'bon'], 'les autres passent quand même');
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) et 0 fiche\(s\) de joueur restaurés, 1 en échec/);
        assert.match(app.alertes.at(-1), /casse/);
    });

    test('sans sauvegarde en attente, le bouton ne fait rien', async () => {
        const app = await appServeur({});
        await app.ev('appliquerRestauration()');
        assert.equal(app.ecritures.length, 0);
        assert.deepEqual(app.alertes, []);
    });
});
