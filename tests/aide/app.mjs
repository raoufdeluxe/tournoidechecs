// Charge les scripts de public/js/ dans un contexte isolé, comme le ferait le navigateur.
//
// Les scripts sont écrits pour la page : variables globales, pas d'export, effets de
// bord au chargement (écouteurs, premier rendu, loadEtat()). Plutôt que de les
// refactorer pour les tester, on leur fournit un faux DOM : ils s'exécutent tels
// quels et on interroge ensuite leurs fonctions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const racine = fileURLToPath(new URL('../..', import.meta.url));

// Ordre de chargement de public/index.html


// Les trois pages de l'application.
export const PAGES = ['index.html', 'joueurs.html', 'tournois.html', 'stats.html', 'sauvegarde.html'];

/** Les scripts que charge une page, dans son ordre à elle. */
export function scriptsDeLaPage(page = 'index.html') {
    return [...lireFichier('public/' + page).matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
}

export function lireScript(nom) {
    return readFileSync(racine + 'public/js/' + nom, 'utf8');
}

export function lireFichier(chemin) {
    return readFileSync(racine + chemin, 'utf8');
}

// Éléments qui portent l'attribut `hidden` dans index.html : le faux DOM doit
// partir du même état, sinon un test croit un panneau ouvert alors que la page
// le montre fermé.
function idsCaches(page) {
    return new Set(
        [...readFileSync(racine + 'public/' + page, 'utf8').matchAll(/<[a-z][^>]*>/gi)]
            .map(m => m[0])
            .filter(balise => /\shidden(\s|>|=)/.test(balise))
            .map(balise => (balise.match(/\bid="([^"]+)"/) || [])[1])
            .filter(Boolean));
}

// Élément DOM factice : accepte tout ce que le code de rendu lui demande.
function element(id, caches) {
    const el = {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        hidden: caches ? caches.has(id) : false,
        disabled: false,
        appendChild(enfant) { this.children.push(enfant); return enfant; },
        insertBefore(enfant) { this.children.push(enfant); return enfant; },
        removeChild() {},
        remove() {},
        addEventListener() {},
        removeEventListener() {},
        setAttribute() {},
        removeAttribute() {},
        getAttribute: () => null,
        focus() {},
        click() {},
        scrollIntoView() {},
        closest: () => null,
        contains: () => false,
        querySelector: () => element(),
        querySelectorAll: () => [],
        getContext: () => contexte2d(),
        getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400 }),
    };
    return el;
}

// Faux contexte canvas : toute méthode appelée ne fait rien.
function contexte2d() {
    return new Proxy({}, {
        get(cible, prop) {
            if (prop in cible) return cible[prop];
            if (prop === 'canvas') return element();
            if (prop === 'measureText') return () => ({ width: 10 });
            return () => {};
        },
        set(cible, prop, valeur) { cible[prop] = valeur; return true; },
    });
}

/**
 * Instancie l'application front dans un contexte neuf.
 *
 * @param {object} options
 * @param {string} options.hash        fragment d'URL (identifiant du tournoi)
 * @param {function} options.fetch     implémentation de fetch (par défaut : réseau injoignable)
 * @param {string} options.page        page à instancier (par défaut : index.html)
 * @param {string[]} options.scripts   scripts à charger (par défaut : ceux de la page)
 */
export function chargerApp(options = {}) {
    const hash = options.hash ?? '#test-tournoi';
    const page = options.page ?? 'index.html';
    const caches = idsCaches(page);
    const stockage = new Map();
    const appelsFetch = [];

    const faireFetch = options.fetch ?? (async () => { throw new Error('réseau indisponible'); });

    // Minuteries factices : rien ne part tout seul, les tests déclenchent
    // les rappels quand ils veulent (voir `avancerTemps`).
    const minuteries = new Map();
    let prochaineMinuterie = 1;

    const bac = {
        console: { log() {}, warn() {}, error() {}, info() {} },
        setTimeout(fn, delai = 0) {
            const id = prochaineMinuterie++;
            minuteries.set(id, { fn, delai });
            return id;
        },
        clearTimeout(id) { minuteries.delete(id); },
        setInterval() { return prochaineMinuterie++; },
        clearInterval(id) { minuteries.delete(id); },
        requestAnimationFrame: () => 0,
        crypto: globalThis.crypto,
        Blob: class { constructor(parties) { this.parties = parties; } },
        URL: { createObjectURL: () => 'blob:sauvegarde', revokeObjectURL() {} },
        JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
        Uint8Array, Intl, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,

        confirm() { return bac.__confirmReponse; },
        prompt() { return bac.__promptReponse; },
        __promptReponse: null,
        // Éléments que renverra document.querySelectorAll, par sélecteur.
        __selecteurs: {},
        __ecouteurs: {},
        addEventListener(type, handler) { (bac.__ecouteurs[type] ||= []).push(handler); },
        removeEventListener() {},
        dispatchEvent() { return true; },

        __confirmReponse: true,
        __appelsFetch: appelsFetch,
        __stockage: stockage,
    };

    bac.fetch = async (url, init) => {
        appelsFetch.push({ url: String(url), init });
        return faireFetch(String(url), init);
    };

    bac.localStorage = {
        getItem: (cle) => (stockage.has(cle) ? stockage.get(cle) : null),
        setItem: (cle, valeur) => { stockage.set(cle, String(valeur)); },
        removeItem: (cle) => { stockage.delete(cle); },
        clear: () => { stockage.clear(); },
        key: (i) => Array.from(stockage.keys())[i] ?? null,
        get length() { return stockage.size; },
    };

    bac.location = {
        protocol: 'https:',
        host: 'echecs.test',
        pathname: '/',
        hash,
        href: 'https://echecs.test/' + hash,
        reload() {},
        assign() {},
    };

    bac.history = {
        // Comme le navigateur : une URL sans fragment efface le fragment.
        replaceState(_a, _b, url) {
            if (url == null) return;
            const texte = String(url);
            bac.location.hash = texte.startsWith('#') ? texte : '';
            bac.location.href = 'https://echecs.test' + (texte.startsWith('#') ? '/' + texte : texte);
        },
        pushState() {},
    };

    bac.navigator = { clipboard: { writeText: async () => {} }, onLine: true };

    const cacheElements = new Map();
    // Un seul body, comme dans un navigateur : sinon ce qu'on y ajoute
    // disparaît aussitôt, et les tests ne peuvent rien y observer.
    const corps = element('body', caches);
    bac.document = {
        getElementById(id) {
            if (!cacheElements.has(id)) cacheElements.set(id, element(id, caches));
            return cacheElements.get(id);
        },
        createElement: () => element(),
        createElementNS: () => element(),
        querySelector: () => element(),
        querySelectorAll: (selecteur) => bac.__selecteurs[selecteur] || [],
        addEventListener() {},
        removeEventListener() {},
        get body() { return corps; },
        get documentElement() { return element(); },
    };

    bac.window = bac;
    bac.globalThis = bac;
    bac.self = bac;

    const contexte = vm.createContext(bac);
    const scripts = options.scripts ?? scriptsDeLaPage(page);
    for (const nom of scripts) {
        vm.runInContext(lireScript(nom), contexte, { filename: 'public/js/' + nom });
    }

    // La confirmation est un panneau dans la page : les tests répondent à sa
    // place, comme ils répondaient à confirm() et prompt(). Ceux qui veulent
    // éprouver le panneau lui-même appellent `dialogueReel()`.
    if (!options.dialogueReel && scripts.includes('dialogue.js')) {
        vm.runInContext(`
            __askReel = askConfirmation;
            askConfirmation = async function (options) {
                __dernierDialogue = options;
                if (!__confirmReponse) return null;
                if (options && options.mot) {
                    const saisi = String(__promptReponse == null ? '' : __promptReponse).trim().toUpperCase();
                    return saisi === options.mot.toUpperCase() ? true : null;
                }
                if (options && options.saisie !== undefined && options.saisie !== null) {
                    return __promptReponse;
                }
                return true;
            };
        `, contexte);
    }

    return {
        contexte,
        bac,
        appelsFetch,
        stockage,
        /** Messages affichés dans la page (ce que remplaçaient les alert()). */
        get alertes() {
            return JSON.parse(vm.runInContext(
                'JSON.stringify(typeof noticesEmises !== "undefined" ? noticesEmises : [])', contexte));
        },
        /** Évalue une expression dans l'app et renvoie la valeur telle quelle (objet du contexte). */
        ev(expression) {
            return vm.runInContext(expression, contexte);
        },
        /** Évalue une expression et la rapatrie en objet JS ordinaire (comparable avec assert). */
        json(expression) {
            const brut = vm.runInContext(`JSON.stringify(${expression})`, contexte);
            return brut === undefined ? undefined : JSON.parse(brut);
        },
        /** Injecte une valeur dans l'app : app.set('tournoi.players', [...]). */
        set(cible, valeur) {
            bac.__transfert = JSON.parse(JSON.stringify(valeur));
            vm.runInContext(`${cible} = __transfert;`, contexte);
        },
        /** Appelle une fonction de l'app avec des arguments sérialisables. */
        appel(nom, ...args) {
            bac.__args = JSON.parse(JSON.stringify(args));
            return this.json(`${nom}(...__args)`);
        },
        repondreConfirm(valeur) { bac.__confirmReponse = valeur; },
        repondrePrompt(valeur) { bac.__promptReponse = valeur; },
        /** Les options passées à la dernière demande de confirmation. */
        dernierDialogue() {
            return this.json('typeof __dernierDialogue !== "undefined" ? __dernierDialogue : null');
        },
        /** Rend la main au vrai panneau, pour l'éprouver lui-même. */
        dialogueReel() { vm.runInContext('askConfirmation = __askReel;', contexte); },
        /**
         * Ce que document.querySelectorAll(selecteur) renverra.
         * Les éléments sont de simples objets : { value, dataset… }.
         */
        definirElements(selecteur, elements) {
            bac.__transfert = elements;
            vm.runInContext(`__selecteurs[${JSON.stringify(selecteur)}] = __transfert;`, contexte);
        },
        /**
         * Attend que le chargement initial (loadEtat au bas de sync.js) soit retombé.
         * À appeler avant d'agir, sinon cette lecture asynchrone vient se mêler
         * aux envois déclenchés par le test.
         */
        async pret() {
            for (let i = 0; i < 5; i++) await new Promise(res => setImmediate(res));
            await this.attendreSync();
            return this;
        },
        /** Oublie les requêtes déjà enregistrées (pour repartir d'un compteur propre). */
        oublierAppels() { appelsFetch.length = 0; },
        /** Attend la fin des envois en cours (la boucle de queueSync). */
        async attendreSync() {
            for (let i = 0; i < 20; i++) {
                const enVol = vm.runInContext('typeof syncInFlight !== "undefined" ? syncInFlight : null', contexte);
                if (!enVol) return;
                await enVol;
            }
        },
        /** Déclenche un évènement window ('online', 'beforeunload'…). */
        emettre(type, evenement = {}) {
            for (const handler of bac.__ecouteurs[type] || []) handler(evenement);
        },
        /** Délais des rappels en attente, dans l'ordre de programmation. */
        delaisEnAttente() {
            return [...minuteries.values()].map(m => m.delai);
        },
        /** Déclenche tous les rappels programmés (un tour, sans récursion infinie). */
        avancerTemps() {
            const aExecuter = [...minuteries.entries()];
            minuteries.clear();
            for (const [, { fn }] of aExecuter) fn();
        },
    };
}
