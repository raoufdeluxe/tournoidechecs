// Le vrai Worker sous les tests de page.
//
// `chargerApp` injecte un `fetch` dans le bac : on lui donne celui-ci, qui
// délègue à `worker.js` par-dessus un KV en mémoire — le mécanisme que
// `worker.test.mjs` emploie déjà (`kv.mjs`). Un test de page éprouve ainsi le
// contrat que le serveur tient vraiment, au lieu d'une imitation écrite à côté :
// les refus, les 409 et les identifiants attribués par le serveur sont les siens.

import worker from '../../worker.js';
import { fauxKV } from './kv.mjs';
import { chargerApp } from './app.mjs';

// À savoir en écrivant les assertions : ce que le Worker rend traverse la
// frontière sans dommage (app.mjs:134-135 injecte les intrinsèques de l'hôte
// dans le bac, `res.ok` et `await res.json()` se lisent donc normalement), mais
// un tableau ou un objet **fabriqué dans la vm** garde la forme de la vm et
// n'est pas comparable avec `deepStrictEqual`. D'où `app.json(…)` plutôt que
// `app.ev(…)` dès qu'on compare une structure.

// L'origine du bac (voir `location` dans app.mjs). Le front appelle l'API en
// chemin relatif ; `Request` veut une URL entière.
const ORIGINE = 'https://echecs.test';

const CLE_JOUEURS = 'players';
const PREFIXE_TOURNOI = 'tournament:';

/**
 * Monte une page branchée sur le vrai Worker.
 *
 * @param {object} options
 * @param {string} options.page       page à instancier (par défaut : index.html)
 * @param {string} options.hash       fragment d'URL, comme chargerApp
 * @param {object[]} options.joueurs  fiches initiales ; absent = pas de liste enregistrée
 * @param {number} options.version    version initiale de la liste (défaut 1)
 * @param {object} options.tournois   { id: enveloppe }, posée telle quelle dans le KV
 * @param {string} options.courant    identifiant du tournoi ouvert (graine de localStorage)
 * @param {function} options.panne    (methode, chemin) => code HTTP | 'hors-ligne' | null
 * @param {object} options.routes     ce qui ne va pas au Worker : par hôte ('api.chess.com')
 *                                    pour une adresse entière, par chemin ('/api/analyse') sinon
 */
export async function appAvecServeur({
    page, hash, joueurs, version = 1, tournois = {}, courant, panne, routes = {},
} = {}) {
    const kv = fauxKV({
        ...(joueurs ? { [CLE_JOUEURS]: { version, updatedAt: null, joueurs } } : {}),
        ...Object.fromEntries(Object.entries(tournois).map(([id, env]) => [PREFIXE_TOURNOI + id, env])),
    });
    const requetes = [];

    const app = chargerApp({
        page,
        hash,
        fetch: async (url, init = {}) => {
            const cible = new URL(url, ORIGINE);
            const externe = cible.origin !== ORIGINE;
            // Le journal nomme l'hôte quand il y en a un, comme `routes` l'indexe.
            const chemin = externe ? cible.href : cible.pathname + cible.search;
            requetes.push({
                methode: init.method || 'GET',
                chemin,
                corps: init.body ? JSON.parse(init.body) : null,
            });

            const route = routes[externe ? cible.host : cible.pathname];
            if (route) return route(String(url), init);
            if (externe) throw new Error(`Aucune route pour ${cible.host} : voir l'option routes.`);
            // Le Worker sert /api/analyse en allant lui-même lire chess.com
            // (worker.js:409) : déléguer ferait partir un appel réseau réel
            // depuis la CI. Un oubli casse ici, bruyamment.
            if (cible.pathname === '/api/analyse') {
                throw new Error("/api/analyse demande une route : sans elle, le Worker appellerait chess.com.");
            }

            // Le vrai Worker ne rend jamais 500 et ne tombe jamais hors ligne :
            // c'est ce qui fait de ce module un adaptateur et non un alias de
            // worker.fetch. La panne est évaluée après le journal — un appel qui
            // échoue reste un appel qui a eu lieu.
            const arret = panne && panne(init.method || 'GET', chemin);
            if (arret === 'hors-ligne') throw new Error('réseau indisponible');
            if (arret) {
                return new Response(JSON.stringify({ error: 'panne simulée' }),
                    { status: arret, headers: { 'Content-Type': 'application/json' } });
            }

            return worker.fetch(new Request(cible.href, init), { CHESS_TOURNAMENT: kv });
        },
    });

    if (courant) app.stockage.set('tournoi_echecs_courant', courant);
    await app.pret();

    // Ce que le serveur garde, vu du test. `kv.donnees` est la Map que sert
    // fauxKV, d'où une lecture synchrone : une assertion n'a pas à s'écrire avec
    // await. Écrire dans le KV en cours de test passe par `app.serveur.kv` tant
    // qu'une passe n'a pas montré la forme qu'il lui faut (poser une enveloppe,
    // en retirer une, bousculer une version : ce n'est pas le même geste).
    const relire = (cle) => (kv.donnees.has(cle) ? JSON.parse(kv.donnees.get(cle)) : null);

    app.requetes = requetes;
    app.serveur = {
        kv,
        joueurs: () => (relire(CLE_JOUEURS) || { joueurs: [] }).joueurs,
        tournoi: (id) => relire(PREFIXE_TOURNOI + id),
        ids: () => [...kv.donnees.keys()]
            .filter(cle => cle.startsWith(PREFIXE_TOURNOI))
            .map(cle => cle.slice(PREFIXE_TOURNOI.length)),
    };
    return app;
}
