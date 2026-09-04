// Page /joueurs : la liste et son édition.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

/** Page Joueurs branchée sur un faux serveur qui tient vraiment la liste. */
async function pageJoueurs(fiches = [], { panne = null } = {}) {
    const etat = { joueurs: fiches.map(f => ({ ...f })), version: 1 };
    const requetes = [];
    let compteur = 0;

    const app = chargerApp({
        page: 'joueurs.html',
        fetch: async (url, init) => {
            const methode = (init && init.method) || 'GET';
            const chemin = String(url).replace(/^https?:\/\/[^/]*/, '');
            const corps = init && init.body ? JSON.parse(init.body) : null;
            const copie = (p) => JSON.parse(JSON.stringify(p));
            const ok = (p, status = 200) => ({ ok: true, status, json: async () => copie(p) });
            const erreur = (status, p = {}) => ({ ok: false, status, json: async () => copie(p) });

            requetes.push({ methode, chemin, corps });
            if (panne === 'liste') throw new Error('hors ligne');
            if (panne && methode !== 'GET') return erreur(panne, { error: 'panne simulée' });

            const id = chemin.split('/')[3];
            if (methode === 'GET') return ok({ version: etat.version, updatedAt: null, joueurs: etat.joueurs });
            if (methode === 'POST') {
                const nom = String(corps.nom || '').trim();
                if (etat.joueurs.some(j => j.nom.toLowerCase() === nom.toLowerCase())) {
                    return erreur(409, { error: 'Ce joueur existe déjà' });
                }
                const joueur = { id: 'j-' + (++compteur), nom, elo: corps.elo ?? null };
                etat.joueurs.push(joueur);
                return ok({ version: ++etat.version, joueur }, 201);
            }
            if (methode === 'PATCH') {
                const i = etat.joueurs.findIndex(j => j.id === id);
                if (i === -1) return erreur(404, {});
                if (corps.nom !== undefined) etat.joueurs[i].nom = corps.nom;
                if (corps.elo !== undefined) etat.joueurs[i].elo = corps.elo;
                return ok({ version: ++etat.version, joueur: etat.joueurs[i] });
            }
            if (methode === 'DELETE') {
                etat.joueurs = etat.joueurs.filter(j => j.id !== id);
                return ok({ version: ++etat.version, deleted: true });
            }
            return erreur(405);
        },
    });

    await app.pret();
    app.requetes = requetes;
    app.serveur = etat;
    return app;
}

const editeur = (app) => app.ev('document.getElementById("joueurs-editor").innerHTML');

describe('affichage de la liste', () => {
    test('une ligne modifiable par joueur, avec son Elo', async () => {
        const app = await pageJoueurs([
            { id: 'j-aa', nom: 'Alice', elo: 1500 },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]);
        const html = editeur(app);
        // Chaque joueur est modifiable : son nom, son Elo, et un moyen de le retirer.
        assert.match(html, /value="Alice"[^>]*data-id="j-aa"/);
        assert.match(html, /value="1500"/, 'son Elo est là, prêt à être modifié');
        assert.equal((html.match(/removeJoueur/g) || []).length, 2, 'un retrait par joueur');
    });

    test('liste vide : on invite à ajouter le premier', async () => {
        const app = await pageJoueurs([]);
        assert.match(editeur(app), /Aucun joueur pour l'instant/);
    });

    test('serveur injoignable : on le dit, sans page blanche', async () => {
        const app = await pageJoueurs([], { panne: 'liste' });
        assert.match(editeur(app), /indisponible/);
    });

    test('un nom piégé ne s\'injecte pas dans la page', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: '<img src=x onerror="window.__XSS=1">', elo: null }]);
        const html = editeur(app);
        assert.doesNotMatch(html, /<img/);
        assert.match(html, /&lt;img/);
    });

    test('la page ne fait pas tourner de tournoi', async () => {
        const app = await pageJoueurs([]);
        // Aucun appel à l'état d'un tournoi : cette page n'en ouvre aucun.
        assert.deepEqual(app.requetes.filter(r => r.chemin.startsWith('/api/etat')), []);
        assert.equal(app.ev('typeof saveEtat'), 'undefined');
    });
});

describe('ajouter un joueur', () => {
    async function avecChamps(app, nom, elo) {
        app.ev(`document.getElementById('joueur-nouveau-nom').value = ${JSON.stringify(nom)};`);
        app.ev(`document.getElementById('joueur-nouveau-elo').value = ${JSON.stringify(elo)};`);
        await app.ev('addJoueurFromForm()');
    }

    test('la fiche est créée et la liste réaffichée', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince', '1450');
        assert.deepEqual(app.serveur.joueurs.map(j => ({ nom: j.nom, elo: j.elo })), [{ nom: 'Vince', elo: 1450 }]);
        assert.match(editeur(app), /value="Vince"/);
    });

    test('les champs sont vidés pour enchaîner', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince', '1450');
        assert.equal(app.ev('document.getElementById("joueur-nouveau-nom").value'), '');
        assert.equal(app.ev('document.getElementById("joueur-nouveau-elo").value'), '');
    });

    test('sans Elo, la fiche part quand même', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince', '');
        assert.equal(app.serveur.joueurs[0].elo, null);
    });

    test('un homonyme est refusé et rien n\'est vidé', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Vince', elo: null }]);
        await avecChamps(app, 'vince', '');
        assert.equal(app.serveur.joueurs.length, 1);
        assert.match(app.alertes.at(-1), /déjà dans la liste/);
        assert.equal(app.ev('document.getElementById("joueur-nouveau-nom").value'), 'vince');
    });

    test('un nom vide ne part pas au serveur', async () => {
        const app = await pageJoueurs([]);
        app.oublierAppels();
        await avecChamps(app, '   ', '');
        assert.equal(app.serveur.joueurs.length, 0);
    });
});

describe('enregistrer les modifications', () => {
    function champs(app, valeurs) {
        app.definirElements('.joueur-nom', valeurs.map(v => ({ value: v.nom, dataset: { id: v.id } })));
        app.definirElements('.joueur-elo', valeurs.map(v => ({ value: v.elo })));
    }

    test('seules les fiches réellement changées partent au serveur', async () => {
        const app = await pageJoueurs([
            { id: 'j-aa', nom: 'Alice', elo: 1500 },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', elo: '1500' }, { id: 'j-bb', nom: 'Robert', elo: '1200' }]);
        await app.ev('saveJoueursFromForm()');

        const patchs = app.requetes.filter(r => r.methode === 'PATCH');
        assert.deepEqual(patchs.map(r => r.chemin), ['/api/joueurs/j-bb']);
        assert.deepEqual(app.serveur.joueurs.map(j => j.nom), ['Alice', 'Robert']);
        assert.equal(app.serveur.joueurs[1].elo, 1200);
    });

    test('effacer le champ Elo enlève le classement', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', elo: '' }]);
        await app.ev('saveJoueursFromForm()');
        assert.equal(app.serveur.joueurs[0].elo, null);
    });

    test('un nom vidé bloque tout l\'enregistrement', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        champs(app, [{ id: 'j-aa', nom: '  ', elo: '' }]);
        await app.ev('saveJoueursFromForm()');
        assert.match(app.alertes.at(-1), /noms doivent être remplis/);
        assert.deepEqual(app.requetes.filter(r => r.methode === 'PATCH'), []);
    });

    test('rien à enregistrer : on le dit sans appeler le serveur', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', elo: '1500' }]);
        await app.ev('saveJoueursFromForm()');
        assert.deepEqual(app.requetes.filter(r => r.methode === 'PATCH'), []);
        assert.match(app.alertes.at(-1), /Rien à enregistrer/);
    });
});

describe('supprimer un joueur', () => {
    test('la confirmation refusée n\'appelle pas le serveur', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        app.repondreConfirm(false);
        await app.ev('removeJoueur("j-aa")');
        assert.equal(app.serveur.joueurs.length, 1);
    });

    test('confirmée, la fiche disparaît de la liste affichée', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null }, { id: 'j-bb', nom: 'Bob', elo: null }]);
        app.repondreConfirm(true);
        await app.ev('removeJoueur("j-aa")');
        assert.deepEqual(app.serveur.joueurs.map(j => j.nom), ['Bob']);
        assert.doesNotMatch(editeur(app), /value="Alice"/);
        assert.match(app.alertes.at(-1), /Alice.*supprimé/);
    });
});
