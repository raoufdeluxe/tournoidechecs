// Page /sauvegarde : état, export, import et effacement total.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

/** Page Sauvegarde branchée sur un faux serveur qui tient tournois et fiches. */
async function pageSauvegarde({ tournois = [], fiches = [], panne = null } = {}) {
    const serveur = { tournois: [...tournois], joueurs: fiches.map(f => ({ ...f })), version: 1 };
    const requetes = [];

    const app = chargerApp({
        page: 'sauvegarde.html',
        fetch: async (url, init) => {
            const methode = (init && init.method) || 'GET';
            const chemin = String(url).replace(/^https?:\/\/[^/]*/, '');
            const corps = init && init.body ? JSON.parse(init.body) : null;
            const copie = (p) => JSON.parse(JSON.stringify(p));
            const ok = (p) => ({ ok: true, status: 200, json: async () => copie(p) });
            requetes.push({ methode, chemin });

            if (chemin.startsWith('/api/joueurs')) {
                if (methode === 'PUT') {
                    if (panne === 'joueurs') return { ok: false, status: 500, json: async () => ({}) };
                    serveur.joueurs = corps.joueurs;
                    return ok({ version: ++serveur.version });
                }
                return ok({ version: serveur.version, joueurs: serveur.joueurs });
            }
            if (chemin.startsWith('/api/tournois')) {
                if (panne === 'liste') throw new Error('hors ligne');
                return ok({ tournaments: serveur.tournois.map(id => ({ id, name: id, screen: null, players: 4 })), complete: true });
            }
            const id = decodeURIComponent((chemin.match(/[?&]id=([^&]*)/) || [])[1] || '');
            if (methode === 'DELETE') {
                if (panne === id) return { ok: false, status: 500, json: async () => ({}) };
                serveur.tournois = serveur.tournois.filter(t => t !== id);
                return ok({ deleted: true });
            }
            return ok({ version: 0, state: null });
        },
    });

    await app.pret();
    app.requetes = requetes;
    app.serveur = serveur;
    return app;
}

const resume = (app) => app.ev('document.getElementById("sauvegarde-resume").textContent');

describe('état affiché', () => {
    test('compte les tournois et les fiches', async () => {
        const app = await pageSauvegarde({ tournois: ['a', 'b', 'c'], fiches: [{ id: 'j-aa', nom: 'Alice', elo: null }] });
        assert.match(resume(app), /3 tournois et 1 fiche de joueur/);
    });

    test('accorde le singulier', async () => {
        const app = await pageSauvegarde({ tournois: ['a'], fiches: [] });
        assert.match(resume(app), /1 tournoi et 0 fiche de joueur/);
    });

    test('serveur injoignable : on le dit', async () => {
        const app = await pageSauvegarde({ panne: 'liste' });
        assert.match(resume(app), /indisponible/);
    });
});

describe('tout effacer', () => {
    const contenu = { tournois: ['abc', 'def'], fiches: [{ id: 'j-aa', nom: 'Alice', elo: null }] };

    test('annuler la saisie ne touche à rien', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt(null);
        await app.ev('toutEffacer()');
        assert.deepEqual(app.serveur.tournois, ['abc', 'def']);
        assert.equal(app.serveur.joueurs.length, 1);
    });

    test('un mot approximatif ne suffit pas', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('oui');
        await app.ev('toutEffacer()');
        assert.match(app.alertes.at(-1), /Rien n'a été effacé/);
        assert.deepEqual(app.serveur.tournois, ['abc', 'def']);
    });

    test('le mot exact efface tournois et fiches', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.deepEqual(app.serveur.tournois, []);
        assert.deepEqual(app.serveur.joueurs, []);
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) et 1 fiche\(s\) effacés/);
    });

    test('le mot est accepté en minuscules et avec des espaces', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('  effacer ');
        await app.ev('toutEffacer()');
        assert.deepEqual(app.serveur.tournois, []);
    });

    test('chaque tournoi part par une suppression distincte', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        const suppressions = app.requetes.filter(r => r.methode === 'DELETE').map(r => r.chemin);
        assert.equal(suppressions.length, 2);
        assert.ok(suppressions.every(c => c.startsWith('/api/etat?id=')));
    });

    test('les copies locales et le tournoi courant sont oubliés', async () => {
        const app = await pageSauvegarde(contenu);
        app.stockage.set('tournoi_echecs_state_v1:abc', '{}');
        app.stockage.set('tournoi_echecs_courant', 'abc');
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.equal(app.stockage.has('tournoi_echecs_state_v1:abc'), false);
        assert.equal(app.stockage.has('tournoi_echecs_courant'), false);
    });

    test('un tournoi récalcitrant n\'empêche pas les autres, et est signalé', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: 'abc' });
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.deepEqual(app.serveur.tournois, ['abc'], 'seul celui en échec reste');
        assert.match(app.alertes.at(-1), /1 tournoi\(s\) et 1 fiche\(s\) effacés/);
        assert.match(app.alertes.at(-1), /En échec[\s\S]*abc/);
    });

    test('un échec sur les fiches est signalé sans être compté', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: 'joueurs' });
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) et 0 fiche\(s\) effacés/);
        assert.match(app.alertes.at(-1), /liste des joueurs/);
    });

    test('rien à effacer : on le dit sans rien demander', async () => {
        const app = await pageSauvegarde({ tournois: [], fiches: [] });
        await app.ev('toutEffacer()');
        assert.match(app.alertes.at(-1), /rien à effacer/i);
        assert.deepEqual(app.requetes.filter(r => r.methode === 'DELETE'), []);
    });

    test('le résumé est remis à jour après coup', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.match(resume(app), /0 tournoi et 0 fiche/);
    });

    test('le bouton est rendu, même après un échec', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: 'abc' });
        app.repondrePrompt('EFFACER');
        await app.ev('toutEffacer()');
        assert.equal(app.ev('document.getElementById("btn-raz").disabled'), false);
    });
});
