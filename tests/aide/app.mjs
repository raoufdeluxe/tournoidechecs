// Charge les scripts de public/js/ dans un contexte isolé, comme le ferait le navigateur.
//
// Les scripts sont écrits pour la page : variables globales, pas d'export, effets de
// bord au chargement (écouteurs, premier rendu, loadState()). Plutôt que de les
// refactorer pour les tester, on leur fournit un faux DOM : ils s'exécutent tels
// quels et on interroge ensuite leurs fonctions.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const racine = fileURLToPath(new URL('../..', import.meta.url));

// Ordre de chargement de public/index.html
export const SCRIPTS = ['core.js', 'poule.js', 'finales.js', 'tournois.js', 'sync.js'];

export function lireScript(nom) {
    return readFileSync(racine + 'public/js/' + nom, 'utf8');
}

export function lireFichier(chemin) {
    return readFileSync(racine + chemin, 'utf8');
}

// Élément DOM factice : accepte tout ce que le code de rendu lui demande.
function element() {
    const el = {
        style: {},
        dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        children: [],
        innerHTML: '',
        textContent: '',
        value: '',
        checked: false,
        hidden: false,
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
 * @param {string[]} options.scripts   scripts à charger (par défaut : tous)
 */
export function chargerApp(options = {}) {
    const hash = options.hash ?? '#test-tournoi';
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
        JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
        Uint8Array, Intl, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN,
        alert(message) { bac.__alerts.push(message); },
        confirm() { return bac.__confirmReponse; },
        prompt() { return null; },
        __ecouteurs: {},
        addEventListener(type, handler) { (bac.__ecouteurs[type] ||= []).push(handler); },
        removeEventListener() {},
        dispatchEvent() { return true; },
        __alerts: [],
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
        hash,
        href: 'https://echecs.test/' + hash,
        reload() {},
        assign() {},
    };

    bac.history = {
        replaceState(_a, _b, url) { if (url) bac.location.hash = String(url); },
        pushState() {},
    };

    bac.navigator = { clipboard: { writeText: async () => {} }, onLine: true };

    const cacheElements = new Map();
    bac.document = {
        getElementById(id) {
            if (!cacheElements.has(id)) cacheElements.set(id, element());
            return cacheElements.get(id);
        },
        createElement: () => element(),
        createElementNS: () => element(),
        querySelector: () => element(),
        querySelectorAll: () => [],
        addEventListener() {},
        removeEventListener() {},
        get body() { return element(); },
        get documentElement() { return element(); },
    };

    bac.window = bac;
    bac.globalThis = bac;
    bac.self = bac;

    const contexte = vm.createContext(bac);
    const scripts = options.scripts ?? SCRIPTS;
    for (const nom of scripts) {
        vm.runInContext(lireScript(nom), contexte, { filename: 'public/js/' + nom });
    }

    return {
        contexte,
        bac,
        appelsFetch,
        stockage,
        alertes: bac.__alerts,
        /** Évalue une expression dans l'app et renvoie la valeur telle quelle (objet du contexte). */
        ev(expression) {
            return vm.runInContext(expression, contexte);
        },
        /** Évalue une expression et la rapatrie en objet JS ordinaire (comparable avec assert). */
        json(expression) {
            const brut = vm.runInContext(`JSON.stringify(${expression})`, contexte);
            return brut === undefined ? undefined : JSON.parse(brut);
        },
        /** Injecte une valeur dans l'app : app.set('tournament.players', [...]). */
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
        /**
         * Attend que le chargement initial (loadState au bas de sync.js) soit retombé.
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
