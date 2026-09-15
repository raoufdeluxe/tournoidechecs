// Garde-fous sur les fichiers eux-mêmes : ce que le navigateur charge doit tenir
// debout avant même qu'une règle du tournoi soit calculée.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chargerApp, lireScript, lireFichier, PAGES } from './aide/app.mjs';

const racine = fileURLToPath(new URL('..', import.meta.url));
const fichiersJs = readdirSync(racine + 'public/js').filter(f => f.endsWith('.js')).sort();

describe('ce que la page annonce', () => {
    test('chaque chemin écrit quelque part désigne un fichier qui existe', () => {
        // Trois pannes silencieuses, et aucune ne se voit au déploiement, qui
        // copie les fichiers sans suivre leurs références : l'image ne s'affiche
        // pas, l'installation est refusée, le raccourci ouvre un 404.
        const manifeste = JSON.parse(lireFichier('public/manifest.json'));
        const chemins = [
            ...[...lireFichier('public/styles.css').matchAll(/url\(["']?([^"')]+)["']?\)/g)]
                .map(m => ['styles.css', m[1]])
                .filter(([, chemin]) => !/^(data:|https?:|\/\/)/.test(chemin)),
            ...manifeste.icons.map(icone => ['manifest.json (icons)', icone.src]),
            ...(manifeste.shortcuts || []).map(r => ['manifest.json (shortcuts)', r.url + '.html']),
        ];
        assert.ok(chemins.length > 0, 'le relevé a bien trouvé des chemins');
        for (const [source, chemin] of chemins) {
            assert.ok(existsSync(racine + 'public/' + chemin), `${source} appelle ${chemin}, qui n'existe pas`);
        }
    });

    test('le même menu de navigation sur toutes les pages, et rien d\'autre dedans', () => {
        const attendu = './ ./tournois ./joueurs ./stats ./sauvegarde';
        for (const page of PAGES) {
            const menu = lireFichier('public/' + page).match(/<nav id="main-menu"[\s\S]*?<\/nav>/)[0];
            const liens = [...menu.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)].map(m => m[1]).join(' ');
            assert.equal(liens, attendu, page);
            assert.doesNotMatch(menu, /<button/, `${page} : le menu ne porte que la navigation`);
        }
    });
});

describe('les liaisons entre la page et le code', () => {
    // Toutes les pages du dossier public, pas seulement les cinq de
    // l'application : un widget est une page comme une autre, et ses
    // identifiants doivent exister comme les autres.
    const pagesHtml = readdirSync(racine + 'public', { recursive: true })
        .filter(f => f.endsWith('.html')).sort();

    // Gabarits HTML écrits dans le JS compris : les lignes de liste et les
    // cartes de duel posent aussi des onclick.
    const sources = [
        ...pagesHtml.map(page => lireFichier('public/' + page)),
        ...fichiersJs.map(lireScript),
    ].join('\n');

    test('chaque gestionnaire inline (onclick, onchange…) désigne une fonction existante', () => {
        const noms = new Set([...sources.matchAll(/\bon(?:click|change|input|submit|keyup)="\s*([A-Za-z_$][\w$]*)\s*\(/g)]
            .map(m => m[1]));
        assert.ok(noms.size > 5, 'le relevé a bien trouvé des gestionnaires');

        // Une fonction peut vivre sur une autre page : on les charge toutes.
        const apps = pagesHtml.map(page => chargerApp({ page }));
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
        // Pas un sous-cas du test précédent : celui-là ne relève que des
        // littéraux, or finales.js appelle getElementById(screenId).
        const ecrans = new Set([...sources.matchAll(/showEcran\(['"]([^'"]+)['"]\)/g)].map(m => m[1]));
        const idsHtml = new Set(PAGES.flatMap(page =>
            [...lireFichier('public/' + page).matchAll(/\bid="([^"]+)"/g)].map(m => m[1])));
        for (const ecran of ecrans) {
            assert.ok(idsHtml.has(ecran), `l'écran #${ecran} manque dans index.html`);
        }
    });

    test('aucun identifiant d\'élément n\'est déclaré deux fois dans une page', () => {
        for (const page of pagesHtml) {
            const ids = [...lireFichier('public/' + page).matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
            const doublons = ids.filter((id, i) => ids.indexOf(id) !== i);
            assert.deepEqual(doublons, [], `${page} : getElementById ne verrait que le premier`);
        }
    });
});

describe('le Worker et sa configuration', () => {
    test('le front et le Worker partagent le même motif d\'identifiant', () => {
        const app = chargerApp();
        const motifFront = app.ev('ID_PATTERN.source');
        const motifWorker = lireFichier('worker.js').match(/ID_PATTERN = \/(.+)\/;/)[1];
        assert.equal(motifFront, motifWorker,
            'un identifiant accepté à la création doit l\'être à l\'écriture');
    });

    test('le Worker a de quoi tourner : chaque réglage déclaré, et hors de [assets]', () => {
        // En TOML, toute clé écrite après [assets] appartient à cette table : le
        // binding KV passé sous elle disparaît du Worker sans un mot, et
        // `wrangler deploy` part quand même, avec un simple avertissement.
        const toml = lireFichier('wrangler.toml');
        const avantAssets = toml.split(/^\s*\[assets\]/m)[0];
        assert.notEqual(avantAssets, toml, 'wrangler.toml déclare bien une table [assets]');

        const reglages = new Set([...lireFichier('worker.js').matchAll(/env\.([A-Z_][A-Z0-9_]*)/g)].map(m => m[1]));
        assert.ok(reglages.size > 0, 'le relevé a bien trouvé des réglages');
        for (const reglage of reglages) {
            assert.match(avantAssets, new RegExp(`binding\\s*=\\s*"${reglage}"|^\\s*${reglage}\\s*=`, 'm'),
                `${reglage} est lu par le Worker mais n'est pas déclaré avant [assets] dans wrangler.toml`);
        }
    });
});

describe('les messages restent dans la page', () => {
    const sourcesJs = readdirSync(racine + 'public', { recursive: true })
        .filter(f => f.endsWith('.js'))
        .map(f => [f, lireScript(f)]);

    test('aucune boîte du navigateur : tout se dit et se demande dans la page', () => {
        // alert, confirm et prompt bloquent l'onglet, s'affichent hors de la page
        // et ne peuvent rien mettre en forme. notice.js et dialogue.js les remplacent.
        // Le bac de test les définit lui-même : aucun test de comportement ne
        // verrait un confirm() réintroduit.
        for (const [nom, source] of sourcesJs) {
            // Le nom du fichier, pas la fin du chemin : le relevé est récursif.
            if (nom.split('/').pop() === 'dialogue.js') continue; // c'est lui qui les remplace
            assert.doesNotMatch(source, /(^|[^.\w])(alert|confirm|prompt)\s*\(/,
                `${nom} ouvre encore une boîte du navigateur`);
        }
    });
});
