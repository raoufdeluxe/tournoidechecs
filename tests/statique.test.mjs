// Garde-fous sur les fichiers eux-mêmes : ce que le navigateur charge doit tenir
// debout avant même qu'une règle du tournoi soit calculée.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerApp, lireScript, lireFichier, PAGES, scriptsDeLaPage } from './aide/app.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const html = lireFichier('public/index.html');
const fichiersJs = readdirSync(racine + 'public/js').filter(f => f.endsWith('.js')).sort();

describe('les scripts de la page', () => {
    for (const nom of fichiersJs) {
        test(`${nom} est un script valide pour le navigateur`, () => {
            // new vm.Script parse comme le fait une balise <script> : même verdict.
            assert.doesNotThrow(() => new vm.Script(lireScript(nom), { filename: nom }));
        });
    }

    test('chaque page ne charge que des fichiers qui existent', () => {
        for (const page of PAGES) {
            for (const script of scriptsDeLaPage(page)) {
                assert.ok(fichiersJs.includes(script), `${page} charge js/${script}, qui n'existe pas`);
            }
        }
    });

    test('chaque page commence par core.js puis api.js', () => {
        // core.js définit l'état et l'échappement, api.js les adresses :
        // tout le reste s'appuie dessus.
        for (const page of PAGES) {
            assert.deepEqual(scriptsDeLaPage(page).slice(0, 2), ['core.js', 'api.js'], page);
        }
    });

    test('aucun fichier de public/js n\'est laissé de côté', () => {
        const charges = new Set(PAGES.flatMap(scriptsDeLaPage));
        assert.deepEqual([...charges].sort(), fichiersJs, 'fichier orphelin ou script fantôme');
    });

    test('les pages dédiées ne chargent pas la machinerie du tournoi', () => {
        // sync.js ouvre et enregistre le tournoi courant : sur /joueurs ou
        // /tournois, il créerait un tournoi qu'on n'a pas demandé.
        for (const page of ['joueurs.html', 'tournois.html']) {
            const scripts = scriptsDeLaPage(page);
            for (const interdit of ['sync.js', 'poule.js', 'finales.js', 'tournois.js']) {
                assert.ok(!scripts.includes(interdit), `${page} ne devrait pas charger ${interdit}`);
            }
        }
    });

    test('les feuilles de style locales existent', () => {
        const locales = [...PAGES.map(p => lireFichier('public/' + p)).join('\n').matchAll(/<link[^>]+href="([^"]+\.css)"/g)]
            .map(m => m[1])
            .filter(href => !/^https?:/.test(href)); // les CDN ne se vérifient pas ici
        assert.ok(locales.length > 0);
        for (const href of new Set(locales)) {
            assert.ok(existsSync(racine + 'public/' + href), `${href} est introuvable`);
        }
    });
});

describe('les liaisons entre la page et le code', () => {
    // Gabarits HTML écrits dans le JS compris : les lignes de liste et les
    // cartes de duel posent aussi des onclick.
    const sources = [
        ...PAGES.map(page => lireFichier('public/' + page)),
        ...fichiersJs.map(lireScript),
    ].join('\n');

    test('chaque gestionnaire inline (onclick, onchange…) désigne une fonction existante', () => {
        const noms = new Set([...sources.matchAll(/\bon(?:click|change|input|submit|keyup)="\s*([A-Za-z_$][\w$]*)\s*\(/g)]
            .map(m => m[1]));
        assert.ok(noms.size > 5, 'le relevé a bien trouvé des gestionnaires');

        // Une fonction peut vivre sur une autre page : on cherche sur les trois.
        const apps = PAGES.map(page => chargerApp({ page }));
        for (const nom of noms) {
            const trouvee = apps.some(app => app.ev(`typeof ${nom}`) === 'function');
            assert.ok(trouvee, `${nom}() est appelée depuis le HTML mais n'existe sur aucune page`);
        }
    });

    test('chaque getElementById vise un élément de la page (ou un gabarit du code)', () => {
        const idsDisponibles = new Set([...sources.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
        const idsCherches = new Set([...sources.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
        assert.ok(idsCherches.size > 10, 'le relevé a bien trouvé des identifiants');
        for (const id of idsCherches) {
            assert.ok(idsDisponibles.has(id), `#${id} est cherché par le code mais n'existe nulle part`);
        }
    });

    test('chaque écran visé par switchScreen existe dans la page', () => {
        const ecrans = new Set([...sources.matchAll(/switchScreen\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
        const idsHtml = new Set(PAGES.flatMap(page =>
            [...lireFichier('public/' + page).matchAll(/\bid="([^"]+)"/g)].map(m => m[1])));
        assert.equal(ecrans.size, 5, 'les 5 écrans du tournoi');
        for (const ecran of ecrans) {
            assert.ok(idsHtml.has(ecran), `l'écran #${ecran} manque dans index.html`);
        }
    });

    test('aucun identifiant d\'élément n\'est déclaré deux fois dans une page', () => {
        for (const page of PAGES) {
            const ids = [...lireFichier('public/' + page).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
            const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
            assert.deepEqual(doublons, [], `${page} : getElementById ne verrait que le premier`);
        }
    });
});

describe('le Worker et sa configuration', () => {
    test('worker.js expose un gestionnaire fetch', async () => {
        const worker = (await import('../worker.js')).default;
        assert.equal(typeof worker.fetch, 'function');
    });

    test('le front et le Worker partagent le même motif d\'identifiant', () => {
        const app = chargerApp();
        const motifFront = app.ev('ID_PATTERN.source');
        const motifWorker = lireFichier('worker.js').match(/ID_PATTERN = \/(.+)\/;/)[1];
        assert.equal(motifFront, motifWorker,
            'un identifiant accepté à la création doit l\'être à l\'écriture');
    });

    test('wrangler.toml pointe sur des fichiers qui existent', () => {
        const toml = lireFichier('wrangler.toml');
        const main = toml.match(/^main\s*=\s*"([^"]+)"/m)[1];
        const assets = toml.match(/^directory\s*=\s*"([^"]+)"/m)[1];
        assert.ok(existsSync(racine + main), `main = ${main}`);
        assert.ok(existsSync(racine + assets), `[assets].directory = ${assets}`);
    });

    test('la table [assets] reste la dernière de wrangler.toml', () => {
        // En TOML, toute clé écrite après [assets] lui appartient : le binding KV
        // déplacé sous cette table disparaîtrait silencieusement du Worker.
        const toml = lireFichier('wrangler.toml');
        const tables = [...toml.matchAll(/^\s*\[([^\]]+)\]/gm)].map(m => m[1]);
        assert.equal(tables.at(-1), 'assets');
    });

    test('le binding KV attendu par le Worker est bien déclaré', () => {
        const toml = lireFichier('wrangler.toml');
        const bindings = [...lireFichier('worker.js').matchAll(/env\.([A-Z_][A-Z0-9_]*)/g)].map(m => m[1]);
        assert.ok(bindings.length > 0);
        for (const binding of new Set(bindings)) {
            assert.match(toml, new RegExp(`binding\\s*=\\s*"${binding}"`),
                `${binding} est utilisé par le Worker mais absent de wrangler.toml`);
        }
    });
});
