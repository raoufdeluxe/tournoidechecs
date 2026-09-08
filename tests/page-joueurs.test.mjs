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
                const joueur = { id: 'j-' + (++compteur), nom, elo: corps.elo ?? null, pseudo: corps.pseudo || null };
                etat.joueurs.push(joueur);
                return ok({ version: ++etat.version, joueur }, 201);
            }
            if (methode === 'PATCH') {
                const i = etat.joueurs.findIndex(j => j.id === id);
                if (i === -1) return erreur(404, {});
                if (corps.nom !== undefined) etat.joueurs[i].nom = corps.nom;
                if (corps.elo !== undefined) etat.joueurs[i].elo = corps.elo;
                if (corps.pseudo !== undefined) etat.joueurs[i].pseudo = corps.pseudo || null;
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
    test('une ligne par joueur : nom et pseudo modifiables, Elo affiché', async () => {
        const app = await pageJoueurs([
            { id: 'j-aa', nom: 'Alice', elo: 1500, pseudo: 'Alice_CC' },
            { id: 'j-bb', nom: 'Bob', elo: null, pseudo: null },
        ]);
        const html = editeur(app);
        assert.match(html, /value="Alice"[^>]*data-id="j-aa"/);
        assert.match(html, /value="Alice_CC"/, 'son pseudo est modifiable');
        // Le classement se lit, il ne se tape pas : il vient de chess.com.
        assert.match(html, />1500</, 'son Elo est affiché');
        assert.doesNotMatch(html, /<input[^>]*value="1500"/, 'et n\'est pas un champ de saisie');
        assert.match(html, />—</, 'sans classement, un tiret');
        assert.equal((html.match(/removeJoueur/g) || []).length, 2, 'un retrait par joueur');
        assert.equal((html.match(/synchroniserFiche/g) || []).length, 2, 'une synchro par joueur');
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
    async function avecChamps(app, nom, pseudo = '') {
        app.ev(`document.getElementById('joueur-nouveau-nom').value = ${JSON.stringify(nom)};`);
        app.ev(`document.getElementById('joueur-nouveau-pseudo').value = ${JSON.stringify(pseudo)};`);
        await app.ev('addJoueurFromForm()');
    }

    test('la fiche est créée et la liste réaffichée', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince');
        assert.deepEqual(app.serveur.joueurs.map(j => j.nom), ['Vince']);
        assert.match(editeur(app), /value="Vince"/);
    });

    test('les champs sont vidés pour enchaîner', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince', 'Vince_Deluxe');
        for (const champ of ['nom', 'pseudo']) {
            assert.equal(app.ev(`document.getElementById("joueur-nouveau-${champ}").value`), '', champ);
        }
    });

    test('le pseudo chess.com saisi accompagne la fiche', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince', 'Vince_Deluxe');
        assert.equal(app.serveur.joueurs[0].pseudo, 'Vince_Deluxe');
        assert.match(editeur(app), /value="Vince_Deluxe"/, 'et se retrouve dans la liste');
    });

    test('une fiche naît sans classement : il viendra de chess.com', async () => {
        const app = await pageJoueurs([]);
        await avecChamps(app, 'Vince');
        assert.equal(app.serveur.joueurs[0].elo, null);
    });

    test('un homonyme est refusé et rien n\'est vidé', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Vince', elo: null }]);
        await avecChamps(app, 'vince');
        assert.equal(app.serveur.joueurs.length, 1);
        assert.match(app.alertes.at(-1), /déjà dans la liste/);
        assert.equal(app.ev('document.getElementById("joueur-nouveau-nom").value'), 'vince');
    });

    test('un nom vide ne part pas au serveur', async () => {
        const app = await pageJoueurs([]);
        app.oublierAppels();
        await avecChamps(app, '   ');
        assert.equal(app.serveur.joueurs.length, 0);
    });
});

describe('synchroniser une fiche avec chess.com', () => {
    // La page interroge chess.com directement : cette API-là autorise le
    // navigateur, contrairement à la page d'une partie.
    async function pageAvecChessCom(reponse, pseudo = 'Raf_Deluxe') {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Raf', elo: null, pseudo }]);
        app.definirElements('.joueur-pseudo', [{ value: pseudo, dataset: { id: 'j-aa' } }]);
        const vrai = app.bac.fetch;
        app.bac.fetch = async (url, init) => (String(url).includes('api.chess.com') ? reponse(url) : vrai(url, init));
        return app;
    }
    const stats = (corps) => () => ({ ok: true, status: 200, json: async () => corps });

    test('le classement rapide est enregistré sur la fiche', async () => {
        const app = await pageAvecChessCom(stats({ chess_rapid: { last: { rating: 1904 } } }));
        app.oublierAppels();
        await app.ev('synchroniserFiche("j-aa")');
        assert.equal(app.serveur.joueurs[0].elo, 1904);
        assert.equal(app.serveur.joueurs[0].pseudo, 'Raf_Deluxe');
        assert.match(app.alertes.at(-1), /Raf_Deluxe — Elo rapide : 1904/);
        assert.match(editeur(app), />1904</, 'et la ligne l\'affiche');
    });

    test('à défaut de rapide, le blitz, puis le bullet', async () => {
        const app = await pageAvecChessCom(stats({
            chess_bullet: { last: { rating: 1500 } }, chess_blitz: { last: { rating: 1700 } },
        }));
        await app.ev('synchroniserFiche("j-aa")');
        assert.equal(app.serveur.joueurs[0].elo, 1700);
        assert.match(app.alertes.at(-1), /Elo blitz/);
    });

    test('le pseudo tapé à l\'instant est celui qu\'on synchronise', async () => {
        const app = await pageAvecChessCom(stats({ chess_rapid: { last: { rating: 1800 } } }));
        app.definirElements('.joueur-pseudo', [{ value: 'Autre_CC', dataset: { id: 'j-aa' } }]);
        await app.ev('synchroniserFiche("j-aa")');
        assert.equal(app.serveur.joueurs[0].pseudo, 'Autre_CC');
    });

    test('sans pseudo saisi, on le dit et chess.com n\'est pas dérangé', async () => {
        let appele = false;
        const app = await pageAvecChessCom(() => { appele = true; return stats({})(); }, '');
        await app.ev('synchroniserFiche("j-aa")');
        assert.match(app.alertes.at(-1), /Renseigne d'abord le pseudo/);
        assert.equal(appele, false);
    });

    test('pseudo inconnu ou joueur sans classement : rien n\'est enregistré', async () => {
        for (const reponse of [() => ({ ok: false, status: 404, json: async () => ({}) }), stats({ tactics: {} })]) {
            const app = await pageAvecChessCom(reponse);
            app.oublierAppels();
            await app.ev('synchroniserFiche("j-aa")');
            assert.equal(app.serveur.joueurs[0].elo, null);
            assert.deepEqual(app.requetes.filter(r => r.methode === 'PATCH'), []);
            assert.match(app.alertes.at(-1), /aucun classement/);
        }
    });
});

describe('enregistrer les modifications', () => {
    // Chaque champ porte l'identifiant de sa fiche : c'est par lui que la page
    // les rassemble, et que les champs du formulaire d'ajout restent dehors.
    function champs(app, valeurs) {
        for (const [classe, cle] of [['.joueur-nom', 'nom'], ['.joueur-pseudo', 'pseudo']]) {
            app.definirElements(classe, valeurs.map(v => ({ value: v[cle] ?? '', dataset: { id: v.id } })));
        }
    }

    test('seules les fiches réellement changées partent au serveur', async () => {
        const app = await pageJoueurs([
            { id: 'j-aa', nom: 'Alice', elo: 1500 },
            { id: 'j-bb', nom: 'Bob', elo: null },
        ]);
        champs(app, [{ id: 'j-aa', nom: 'Alice' }, { id: 'j-bb', nom: 'Robert' }]);
        await app.ev('saveJoueursFromForm()');

        const patchs = app.requetes.filter(r => r.methode === 'PATCH');
        assert.deepEqual(patchs.map(r => r.chemin), ['/api/joueurs/j-bb']);
        assert.deepEqual(app.serveur.joueurs.map(j => j.nom), ['Alice', 'Robert']);
    });

    test('un pseudo saisi seul est bien une modification', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: 1500, pseudo: null }]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', pseudo: 'Alice_CC' }]);
        await app.ev('saveJoueursFromForm()');

        const patchs = app.requetes.filter(r => r.methode === 'PATCH');
        assert.deepEqual(patchs.map(r => r.chemin), ['/api/joueurs/j-aa'], 'la fiche part au serveur');
        assert.equal(patchs[0].corps.pseudo, 'Alice_CC');
        assert.equal(app.serveur.joueurs[0].pseudo, 'Alice_CC');
    });

    test('effacer le pseudo l\'enlève de la fiche', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null, pseudo: 'Alice_CC' }]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', pseudo: '' }]);
        await app.ev('saveJoueursFromForm()');
        assert.equal(app.serveur.joueurs[0].pseudo, null);
    });

    test('un pseudo inchangé ne renvoie rien au serveur', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null, pseudo: 'Alice_CC' }]);
        champs(app, [{ id: 'j-aa', nom: 'Alice', pseudo: 'Alice_CC' }]);
        await app.ev('saveJoueursFromForm()');
        assert.deepEqual(app.requetes.filter(r => r.methode === 'PATCH'), []);
    });

    test('enregistrer ne touche pas au classement, qui ne se tape pas', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        champs(app, [{ id: 'j-aa', nom: 'Alicia' }]);
        await app.ev('saveJoueursFromForm()');
        assert.equal(app.serveur.joueurs[0].elo, 1500, 'l\'Elo survit au renommage');
        assert.equal(app.requetes.at(-1).corps.elo, undefined, 'et n\'est même pas envoyé');
    });

    test('un nom vidé bloque tout l\'enregistrement', async () => {
        const app = await pageJoueurs([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        champs(app, [{ id: 'j-aa', nom: '  ' }]);
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
