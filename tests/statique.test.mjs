// Garde-fous sur les fichiers eux-mêmes : ce que le navigateur charge doit tenir
// debout avant même qu'une règle du tournoi soit calculée.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerApp, lireScript, lireFichier, PAGES, scriptsDeLaPage } from './aide/app.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const fichiersJs = readdirSync(racine + 'public/js').filter(f => f.endsWith('.js')).sort();

describe('ce que la page charge', () => {
    test('chaque fichier appelé par la feuille de style existe', () => {
        // Une adresse fausse ne fait rien échouer : l'image ne s'affiche pas,
        // sans un mot. C'est le genre de panne qu'on ne voit jamais.
        const appels = [...lireFichier('public/styles.css').matchAll(/url\(["']?([^"')]+)["']?\)/g)]
            .map(m => m[1])
            .filter(chemin => !/^(data:|https?:|\/\/)/.test(chemin));
        assert.ok(appels.length > 0, 'le relevé a bien trouvé des fichiers');
        for (const chemin of appels) {
            assert.ok(existsSync(racine + 'public/' + chemin), `styles.css appelle ${chemin}, qui n'existe pas`);
        }
    });

    test('chaque page ne charge que des fichiers qui existent', () => {
        for (const page of PAGES) {
            for (const script of scriptsDeLaPage(page)) {
                assert.ok(fichiersJs.includes(script), `${page} charge js/${script}, qui n'existe pas`);
            }
        }
    });

    test('les pages dédiées ne chargent pas la machinerie du tournoi', () => {
        // sync.js ouvre et enregistre le tournoi courant : sur /joueurs ou
        // /tournois, il créerait un tournoi qu'on n'a pas demandé.
        for (const page of ['joueurs.html', 'tournois.html', 'stats.html']) {
            const scripts = scriptsDeLaPage(page);
            for (const interdit of ['sync.js', 'poule.js', 'finales.js', 'tournois.js']) {
                assert.ok(!scripts.includes(interdit), `${page} ne devrait pas charger ${interdit}`);
            }
        }
    });

    test('le même menu de navigation sur toutes les pages, et rien d\'autre dedans', () => {
        const attendu = './ ./tournois ./joueurs ./stats ./sauvegarde';
        for (const page of PAGES) {
            const menu = lireFichier('public/' + page).match(/<nav id="main-menu"[\s\S]*?<\/nav>/)[0];
            const liens = [...menu.matchAll(/<a class="menu-item" href="([^"]+)"/g)].map(m => m[1]).join(' ');
            assert.equal(liens, attendu, page);
            assert.doesNotMatch(menu, /<button[^>]*class="menu-item"/,
                `${page} : le menu ne porte que la navigation`);
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
        // Les identifiants viennent du HTML, des gabarits du code, ou d'un
        // élément que le code crée lui-même (elem.id = '…').
        const idsDisponibles = new Set([
            ...[...sources.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]),
            ...[...sources.matchAll(/\.id = '([^']+)'/g)].map(m => m[1]),
        ]);
        const idsCherches = new Set([...sources.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
        assert.ok(idsCherches.size > 10, 'le relevé a bien trouvé des identifiants');
        for (const id of idsCherches) {
            assert.ok(idsDisponibles.has(id), `#${id} est cherché par le code mais n'existe nulle part`);
        }
    });

    test('chaque écran visé par showEcran existe dans la page', () => {
        const ecrans = new Set([...sources.matchAll(/showEcran\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
        const idsHtml = new Set(PAGES.flatMap(page =>
            [...lireFichier('public/' + page).matchAll(/\bid="([^"]+)"/g)].map(m => m[1])));
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

describe('les messages restent dans la page', () => {
    const sourcesJs = readdirSync(racine + 'public/js')
        .filter(f => f.endsWith('.js'))
        .map(f => [f, lireScript(f)]);

    test('aucune boîte du navigateur : tout se dit et se demande dans la page', () => {
        // alert, confirm et prompt bloquent l'onglet, s'affichent hors de la page
        // et ne peuvent rien mettre en forme. notice.js et dialogue.js les remplacent.
        for (const [nom, source] of sourcesJs) {
            if (nom === 'dialogue.js') continue; // c'est lui qui les remplace
            assert.doesNotMatch(source, /(^|[^.\w])(alert|confirm|prompt)\s*\(/,
                `${nom} ouvre encore une boîte du navigateur`);
        }
    });

});

describe('le manifeste de l\'application installable', () => {
    const manifeste = JSON.parse(lireFichier('public/manifest.json'));

    test('il déclare ce qu\'il faut pour être installé', () => {
        assert.ok(manifeste.name, 'sans nom, rien à installer');
        assert.equal(manifeste.display, 'standalone');
        assert.ok(manifeste.start_url, 'sans point de départ, l\'application s\'ouvre n\'importe où');
    });

    test('les tailles d\'icône attendues sont présentes, dont une masquable', () => {
        const tailles = manifeste.icons.map(i => i.sizes);
        assert.ok(tailles.includes('192x192'));
        assert.ok(tailles.includes('512x512'));
        assert.ok(manifeste.icons.some(i => i.purpose === 'maskable'),
            'sans elle, Android rogne le motif dans un cercle');
    });

    test('chaque icône annoncée existe vraiment', () => {
        // Un chemin faux ne fait rien échouer : l'installation est simplement
        // refusée, sans un mot. C'est le genre de panne qu'on ne voit jamais.
        for (const icone of manifeste.icons) {
            assert.ok(existsSync(racine + 'public/' + icone.src), `icône absente : ${icone.src}`);
        }
    });

    test('chaque page annonce le manifeste et la couleur de la barre', () => {
        for (const page of PAGES) {
            const source = lireFichier('public/' + page);
            assert.match(source, /rel="manifest"/, `${page} n'annonce pas le manifeste`);
            assert.match(source, /name="theme-color"/, `${page} ne pose pas la couleur de barre`);
        }
    });

    test('les raccourcis mènent à des pages existantes', () => {
        for (const raccourci of manifeste.shortcuts || []) {
            assert.ok(PAGES.includes(raccourci.url + '.html'), `raccourci mort : ${raccourci.url}`);
        }
    });
});
