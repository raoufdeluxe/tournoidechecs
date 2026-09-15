// Page /tournois : la liste des tournois, renommage et suppression.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { appAvecServeur } from './aide/serveur.mjs';

const etatTournoi = (nom, nbJoueurs = 4) => ({
    screen: 'screen-tournament',
    tournament: {
        name: nom,
        players: Array.from({ length: nbJoueurs }, (_, i) => ({ id: i, name: 'J' + i, elo: null })),
        matches: [],
    },
});

/**
 * Page Tournois branchée sur le vrai Worker.
 * `tournois` : { id: { version, state } } — l'horodatage est ajouté, le serveur
 * en pose un à chaque écriture et trie la liste là-dessus (`worker.js:387-388`).
 */
const pageTournois = (tournois = {}, { courant, listeEnPanne = false } = {}) => appAvecServeur({
    page: 'tournois.html',
    courant,
    panne: listeEnPanne ? LISTE_INJOIGNABLE : null,
    tournois: Object.fromEntries(Object.entries(tournois).map(
        ([id, env]) => [id, { updatedAt: '2026-09-01T10:00:00.000Z', ...env }])),
});

const LISTE_INJOIGNABLE = (_methode, chemin) => chemin.startsWith('/api/tournois') && 'hors-ligne';

const liste = (app) => app.ev('document.getElementById("tournois-liste").innerHTML');

/** Le bouton lit le champ de la ligne : on lui donne celui qu'un clic réel aurait visé. */
function saisir(app, id, nom) {
    app.ev(`__champ = { value: ${JSON.stringify(nom)}, dataset: { id: ${JSON.stringify(id)} } };
            document.querySelector = () => __champ;`);
}

describe('affichage de la liste', () => {
    test('une ligne par tournoi, avec son nom modifiable et son étape', async () => {
        const app = await pageTournois({
            'coupe-du-dimanche': { version: 3, state: etatTournoi('Coupe du Dimanche', 6) },
        });
        const html = liste(app);
        assert.match(html, /value="Coupe du Dimanche"[^>]*/);
        assert.match(html, /Phase de poule/);
        assert.match(html, /6 partants/);
    });

    test('le tournoi ouvert sur l\'accueil est marqué « en cours »', async () => {
        const app = await pageTournois({
            a: { version: 1, state: etatTournoi('A') },
            b: { version: 1, state: etatTournoi('B') },
        }, { courant: 'b' });
        const html = liste(app);
        assert.match(html, /b[\s\S]*?en cours/);
        assert.equal((html.match(/en cours/g) || []).length, 1);
    });

    test('sans tournoi, la liste le dit', async () => {
        const app = await pageTournois({});
        assert.match(liste(app), /Aucun tournoi enregistré/);
    });

    test('liste injoignable : message, pas de page blanche', async () => {
        const app = await pageTournois({}, { listeEnPanne: true });
        assert.match(liste(app), /indisponible/);
    });

    test('cliquer sur le repère déplace le tournoi vers l\'adresse de son nom', async () => {
        const app = await pageTournois({ 'red-indians-cup': { version: 2, state: etatTournoi('Big Chief Cup') } });
        assert.match(liste(app), /aligner l'adresse/, 'le décalage est signalé');
        app.repondreConfirm(true);
        saisir(app, 'red-indians-cup', 'Big Chief Cup');
        await app.ev(`renameTournoi('red-indians-cup')`);

        assert.ok(app.serveur.tournoi('big-chief-cup'), 'écrit à la nouvelle adresse');
        assert.ok(!app.serveur.tournoi('red-indians-cup'), 'ancienne adresse supprimée');
        assert.equal(app.serveur.tournoi('big-chief-cup').state.tournament.name, 'Big Chief Cup');
    });

    test('un tournoi sans nom n\'est pas marqué comme divergent', async () => {
        const app = await pageTournois({ xtzxfycn4h: { version: 1, state: etatTournoi(null) } });
        assert.doesNotMatch(liste(app), /aligner l'adresse/);
    });

    test('au-delà de 100 tournois, on ne prétend pas montrer les plus récents', async () => {
        const app = await pageTournois({ a: { version: 1, state: etatTournoi('A') } });
        // `complete: false` signale que le serveur en a laissé de côté.
        app.ev(`__vraiFetch = fetch; fetch = async (url, init) => {
            const res = await __vraiFetch(url, init);
            if (!String(url).includes('/api/tournois')) return res;
            const data = await res.json();
            return { ok: true, status: 200, json: async () => ({ ...data, complete: false }) };
        };`);
        await app.ev('loadListeTournois()');
        const html = liste(app);
        assert.match(html, /plus de 100 tournois/);
        assert.doesNotMatch(html, /récent/i, 'ce serait faux : list() rend les clés par ordre alphabétique');
    });

    test('la page n\'ouvre aucun tournoi au chargement', async () => {
        const app = await pageTournois({ a: { version: 1, state: etatTournoi('A') } });
        assert.deepEqual(app.requetes.filter(r => r.chemin.startsWith('/api/etat')), []);
        assert.equal(app.ev('typeof saveEtat'), 'undefined');
    });
});

describe('renommer un tournoi', () => {
    test('renommer met à jour le nom, et l\'adresse suit le nom', async () => {
        const app = await pageTournois({ 'coupe-du-dimanche': { version: 3, state: etatTournoi('Coupe du Dimanche') } });
        saisir(app, 'coupe-du-dimanche', 'Coupe du Dimanche 2026');
        await app.ev('renameTournoi("coupe-du-dimanche")');

        // Le slug « coupe-du-dimanche-2026 » diffère : c'est un déplacement.
        assert.ok(app.serveur.tournoi('coupe-du-dimanche-2026'));
        assert.equal(app.serveur.tournoi('coupe-du-dimanche-2026').state.tournament.name, 'Coupe du Dimanche 2026');
    });

    test('changer le nom déplace le tournoi et efface l\'ancienne adresse', async () => {
        const app = await pageTournois({ ancien: { version: 2, state: etatTournoi('Ancien') } });
        app.repondreConfirm(true);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renameTournoi("ancien")');

        assert.ok(app.serveur.tournoi('tout-neuf'), 'écrit à la nouvelle adresse');
        assert.ok(!app.serveur.tournoi('ancien'), 'ancienne adresse supprimée');
        const ordre = app.requetes.filter(r => ['POST', 'DELETE'].includes(r.methode)).map(r => r.methode);
        assert.deepEqual(ordre, ['POST', 'DELETE'], 'on écrit avant d\'effacer, jamais l\'inverse');
    });

    test('refuser le changement de lien annule tout', async () => {
        const app = await pageTournois({ ancien: { version: 2, state: etatTournoi('Ancien') } });
        app.repondreConfirm(false);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renameTournoi("ancien")');
        assert.ok(app.serveur.tournoi('ancien'));
        assert.ok(!app.serveur.tournoi('tout-neuf'));
    });

    test('un nom déjà pris est refusé', async () => {
        const app = await pageTournois({
            ancien: { version: 1, state: etatTournoi('Ancien') },
            'tout-neuf': { version: 1, state: etatTournoi('Tout neuf') },
        });
        app.repondreConfirm(true);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renameTournoi("ancien")');
        assert.match(app.alertes.at(-1), /existe déjà/);
        assert.ok(app.serveur.tournoi('ancien'), 'rien n\'a bougé');
    });

    test('vider le nom garde l\'adresse actuelle', async () => {
        const app = await pageTournois({ abc: { version: 2, state: etatTournoi('Un nom') } });
        saisir(app, 'abc', '');
        await app.ev('renameTournoi("abc")');
        assert.equal(app.serveur.tournoi('abc').state.tournament.name, null);
        assert.equal(app.serveur.tournoi('abc').version, 3, 'écrit sur la version lue');
    });

    test('un tournoi disparu entre-temps est signalé', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('Un nom') } });
        app.serveur.removeTournoi('abc');
        saisir(app, 'abc', 'Autre');
        await app.ev('renameTournoi("abc")');
        assert.match(app.alertes.at(-1), /n'existe plus/);
    });
});

describe('supprimer un tournoi', () => {
    test('la confirmation refusée n\'appelle pas le serveur', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.repondreConfirm(false);
        await app.ev('removeTournoi("abc")');
        assert.ok(app.serveur.tournoi('abc'));
    });

    test('confirmée, le tournoi part et disparaît de la liste', async () => {
        const app = await pageTournois({
            abc: { version: 1, state: etatTournoi('A') },
            def: { version: 1, state: etatTournoi('B') },
        });
        app.repondreConfirm(true);
        await app.ev('removeTournoi("abc")');
        assert.deepEqual(app.serveur.ids(), ['def']);
        assert.doesNotMatch(liste(app), /data-id="abc"/);
    });

    test('la copie locale du tournoi supprimé est oubliée', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.stockage.set('tournoi_echecs_state_v1:abc', '{}');
        app.repondreConfirm(true);
        await app.ev('removeTournoi("abc")');
        assert.equal(app.stockage.has('tournoi_echecs_state_v1:abc'), false);
    });
});

describe('ouvrir un tournoi', () => {
    test('renvoie à l\'accueil, sur le lien du tournoi', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.ev('openTournoi("abc")');
        assert.match(app.ev('location.href'), /#abc$/);
    });
});

describe('commencer un nouveau tournoi', () => {
    // Sans lien, l'accueil rouvre le dernier tournoi consulté : c'est d'ici, et
    // d'ici seulement, qu'on peut repartir d'une inscription vierge.
    const avecUnTournoiEnCours = () =>
        pageTournois({ abc: { version: 1, state: etatTournoi('A') } }, { courant: 'abc' });

    test('renvoie à l\'accueil, sans lien de tournoi', async () => {
        const app = await avecUnTournoiEnCours();
        app.ev('openNouveauTournoi()');
        assert.equal(app.ev('location.href'), './');
    });

    test('oublie le tournoi en cours, sinon l\'accueil le rouvrirait', async () => {
        const app = await avecUnTournoiEnCours();
        app.ev('openNouveauTournoi()');
        assert.equal(app.stockage.has('tournoi_echecs_courant'), false);
    });

    test('le tournoi quitté n\'est pas supprimé : il reste dans la liste', async () => {
        const app = await avecUnTournoiEnCours();
        app.ev('openNouveauTournoi()');
        assert.deepEqual(app.requetes.filter(r => r.methode === 'DELETE'), []);
        assert.ok(app.serveur.tournoi('abc'));
    });
});
