// Page /tournois : la liste des tournois, renommage et suppression.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

const etatTournoi = (nom, nbJoueurs = 4) => ({
    screen: 'screen-tournament',
    tournament: {
        name: nom,
        players: Array.from({ length: nbJoueurs }, (_, i) => ({ id: i, name: 'J' + i, elo: null })),
        matches: [],
    },
});

/**
 * Page Tournois branchée sur un faux serveur.
 * `tournois` : { id: { version, state } }.
 */
async function pageTournois(tournois = {}, { courant = null, listeEnPanne = false } = {}) {
    const serveur = { tournois: JSON.parse(JSON.stringify(tournois)) };
    const requetes = [];

    const app = chargerApp({
        page: 'tournois.html',
        fetch: async (url, init) => {
            const methode = (init && init.method) || 'GET';
            const chemin = String(url).replace(/^https?:\/\/[^/]*/, '');
            const corps = init && init.body ? JSON.parse(init.body) : null;
            const copie = (p) => JSON.parse(JSON.stringify(p));
            const ok = (p) => ({ ok: true, status: 200, json: async () => copie(p) });
            requetes.push({ methode, chemin, corps });

            if (chemin.startsWith('/api/joueurs')) return ok({ version: 1, joueurs: [] });
            if (chemin.startsWith('/api/tournois')) {
                if (listeEnPanne) throw new Error('hors ligne');
                return ok({
                    tournaments: Object.entries(serveur.tournois).map(([id, t]) => ({
                        id,
                        name: t.state.tournament.name,
                        screen: t.state.screen,
                        players: t.state.tournament.players.length,
                        updatedAt: '2026-09-01T10:00:00.000Z',
                    })),
                    complete: true,
                });
            }

            const id = decodeURIComponent((chemin.match(/[?&]id=([^&]*)/) || [])[1] || '');
            if (methode === 'DELETE') {
                delete serveur.tournois[id];
                return ok({ deleted: true });
            }
            if (methode === 'POST') {
                serveur.tournois[id] = { version: (corps.baseVersion || 0) + 1, state: corps.state };
                return ok({ version: serveur.tournois[id].version });
            }
            const t = serveur.tournois[id];
            return ok(t ? { version: t.version, state: t.state } : { version: 0, state: null });
        },
    });

    if (courant) app.stockage.set('tournoi_echecs_courant', courant);
    await app.pret();
    app.requetes = requetes;
    app.serveur = serveur;
    return app;
}

const liste = (app) => app.ev('document.getElementById("tournois-liste").innerHTML');

describe('affichage de la liste', () => {
    test('une ligne par tournoi, avec son nom modifiable et son étape', async () => {
        const app = await pageTournois({
            'coupe-du-dimanche': { version: 3, state: etatTournoi('Coupe du Dimanche', 6) },
        });
        const html = liste(app);
        assert.match(html, /value="Coupe du Dimanche"[^>]*/);
        assert.match(html, /class="tournoi-nom"/);
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

    test('sans tournoi, on renvoie vers l\'accueil', async () => {
        const app = await pageTournois({});
        assert.match(liste(app), /Aucun tournoi enregistré/);
        assert.match(liste(app), /href="\.\/"/);
    });

    test('liste injoignable : message, pas de page blanche', async () => {
        const app = await pageTournois({}, { listeEnPanne: true });
        assert.match(liste(app), /indisponible/);
    });

    test('un nom piégé ne s\'injecte pas dans la page', async () => {
        const app = await pageTournois({ a: { version: 1, state: etatTournoi('<img src=x onerror="window.__XSS=1">') } });
        assert.doesNotMatch(liste(app), /<img/);
        assert.match(liste(app), /&lt;img/);
    });

    test('la page n\'ouvre aucun tournoi au chargement', async () => {
        const app = await pageTournois({ a: { version: 1, state: etatTournoi('A') } });
        assert.deepEqual(app.requetes.filter(r => r.chemin.startsWith('/api/etat')), []);
        assert.equal(app.ev('typeof saveState'), 'undefined');
    });
});

describe('renommer un tournoi', () => {
    function saisir(app, id, nom) {
        app.ev(`__champ = { value: ${JSON.stringify(nom)}, dataset: { id: ${JSON.stringify(id)} } };
                document.querySelector = () => __champ;`);
    }

    test('renommer met à jour le nom, et l\'adresse suit le nom', async () => {
        const app = await pageTournois({ 'coupe-du-dimanche': { version: 3, state: etatTournoi('Coupe du Dimanche') } });
        saisir(app, 'coupe-du-dimanche', 'Coupe du Dimanche 2026');
        await app.ev('renommerTournoi("coupe-du-dimanche")');

        // Le slug « coupe-du-dimanche-2026 » diffère : c'est un déplacement.
        assert.ok(app.serveur.tournois['coupe-du-dimanche-2026']);
        assert.equal(app.serveur.tournois['coupe-du-dimanche-2026'].state.tournament.name, 'Coupe du Dimanche 2026');
    });

    test('changer le nom déplace le tournoi et efface l\'ancienne adresse', async () => {
        const app = await pageTournois({ ancien: { version: 2, state: etatTournoi('Ancien') } });
        app.repondreConfirm(true);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renommerTournoi("ancien")');

        assert.ok(app.serveur.tournois['tout-neuf'], 'écrit à la nouvelle adresse');
        assert.ok(!app.serveur.tournois.ancien, 'ancienne adresse supprimée');
        const ordre = app.requetes.filter(r => ['POST', 'DELETE'].includes(r.methode)).map(r => r.methode);
        assert.deepEqual(ordre, ['POST', 'DELETE'], 'on écrit avant d\'effacer, jamais l\'inverse');
    });

    test('refuser le changement de lien annule tout', async () => {
        const app = await pageTournois({ ancien: { version: 2, state: etatTournoi('Ancien') } });
        app.repondreConfirm(false);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renommerTournoi("ancien")');
        assert.ok(app.serveur.tournois.ancien);
        assert.ok(!app.serveur.tournois['tout-neuf']);
    });

    test('un nom déjà pris est refusé', async () => {
        const app = await pageTournois({
            ancien: { version: 1, state: etatTournoi('Ancien') },
            'tout-neuf': { version: 1, state: etatTournoi('Tout neuf') },
        });
        app.repondreConfirm(true);
        saisir(app, 'ancien', 'Tout neuf');
        await app.ev('renommerTournoi("ancien")');
        assert.match(app.alertes.at(-1), /existe déjà/);
        assert.ok(app.serveur.tournois.ancien, 'rien n\'a bougé');
    });

    test('vider le nom garde l\'adresse actuelle', async () => {
        const app = await pageTournois({ abc: { version: 2, state: etatTournoi('Un nom') } });
        saisir(app, 'abc', '');
        await app.ev('renommerTournoi("abc")');
        assert.equal(app.serveur.tournois.abc.state.tournament.name, null);
        assert.equal(app.serveur.tournois.abc.version, 3, 'écrit sur la version lue');
    });

    test('un tournoi disparu entre-temps est signalé', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('Un nom') } });
        delete app.serveur.tournois.abc;
        saisir(app, 'abc', 'Autre');
        await app.ev('renommerTournoi("abc")');
        assert.match(app.alertes.at(-1), /n'existe plus/);
    });
});

describe('supprimer un tournoi', () => {
    test('la confirmation refusée n\'appelle pas le serveur', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.repondreConfirm(false);
        await app.ev('supprimerTournoi("abc")');
        assert.ok(app.serveur.tournois.abc);
    });

    test('confirmée, le tournoi part et disparaît de la liste', async () => {
        const app = await pageTournois({
            abc: { version: 1, state: etatTournoi('A') },
            def: { version: 1, state: etatTournoi('B') },
        });
        app.repondreConfirm(true);
        await app.ev('supprimerTournoi("abc")');
        assert.deepEqual(Object.keys(app.serveur.tournois), ['def']);
        assert.doesNotMatch(liste(app), /data-id="abc"/);
    });

    test('la copie locale du tournoi supprimé est oubliée', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.stockage.set('tournoi_echecs_state_v1:abc', '{}');
        app.repondreConfirm(true);
        await app.ev('supprimerTournoi("abc")');
        assert.equal(app.stockage.has('tournoi_echecs_state_v1:abc'), false);
    });
});

describe('ouvrir un tournoi', () => {
    test('renvoie à l\'accueil, sur le lien du tournoi', async () => {
        const app = await pageTournois({ abc: { version: 1, state: etatTournoi('A') } });
        app.ev('ouvrirTournoi("abc")');
        assert.match(app.ev('location.href'), /#abc$/);
    });
});
