// Page /sauvegarde : état, export, import et effacement total.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { appAvecServeur } from './aide/serveur.mjs';

/** Un tournoi enregistré. La liste du serveur ne montre que ceux qui ont au
    moins un partant (`worker.js:382-383`) : un identifiant nu n'y paraîtrait pas. */
const enveloppe = (nom) => ({
    version: 1,
    updatedAt: '2026-09-01T10:00:00.000Z',
    state: {
        screen: 'screen-tournament',
        tournament: { name: nom, players: [{ id: 0, name: 'J0', elo: null }], matches: [] },
    },
});

/** Page Sauvegarde branchée sur le vrai Worker. `tournois` : des identifiants. */
const pageSauvegarde = ({ tournois = [], joueurs = [], panne } = {}) => appAvecServeur({
    page: 'sauvegarde.html',
    joueurs,
    panne,
    tournois: Object.fromEntries(tournois.map(id => [id, enveloppe(id)])),
});

// Les trois pannes que ce fichier éprouve. Le vrai Worker ne tombe jamais : ce
// sont elles qui mettent la page devant un serveur qui ne répond pas.
const LISTE_INJOIGNABLE = (_methode, chemin) => chemin.startsWith('/api/tournois') && 'hors-ligne';
const FICHES_REFUSEES = (methode, chemin) => methode === 'PUT' && chemin.startsWith('/api/joueurs') && 500;
const suppressionRefusee = (id) => (methode, chemin) => methode === 'DELETE' && chemin.includes('id=' + id) && 500;

const resume = (app) => app.ev('document.getElementById("sauvegarde-resume").textContent');

describe('état affiché', () => {
    test('compte les tournois et les fiches', async () => {
        const app = await pageSauvegarde({ tournois: ['a', 'b', 'c'], joueurs: [{ id: 'j-aa', nom: 'Alice', elo: null }] });
        assert.match(resume(app), /3 tournois et 1 fiche de joueur/);
    });

    test('accorde le singulier', async () => {
        const app = await pageSauvegarde({ tournois: ['a'], joueurs: [] });
        assert.match(resume(app), /1 tournoi et 0 fiche de joueur/);
    });

    test('serveur injoignable : on le dit', async () => {
        const app = await pageSauvegarde({ panne: LISTE_INJOIGNABLE });
        assert.match(resume(app), /indisponible/);
    });
});

describe('tout effacer', () => {
    const contenu = { tournois: ['abc', 'def'], joueurs: [{ id: 'j-aa', nom: 'Alice', elo: null }] };

    test('annuler la saisie ne touche à rien', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt(null);
        await app.ev('eraseTout()');
        assert.deepEqual(app.serveur.ids(), ['abc', 'def']);
        assert.equal(app.serveur.joueurs().length, 1);
    });

    test('un mot approximatif n\'efface rien', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('oui');
        await app.ev('eraseTout()');
        assert.deepEqual(app.serveur.ids(), ['abc', 'def']);
        assert.equal(app.serveur.joueurs().length, 1);
    });

    test('la demande annonce ce qui va disparaître et réclame le mot', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        const demande = app.dernierDialogue();
        assert.match(demande.titre, /2 tournoi\(s\) et 1 fiche\(s\)/);
        assert.equal(demande.mot, 'EFFACER');
        assert.equal(demande.danger, true);
    });

    test('le mot exact efface tournois et fiches', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.deepEqual(app.serveur.ids(), []);
        assert.deepEqual(app.serveur.joueurs(), []);
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) et 1 fiche\(s\) effacés/);
    });

    test('le mot est accepté en minuscules et avec des espaces', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('  effacer ');
        await app.ev('eraseTout()');
        assert.deepEqual(app.serveur.ids(), []);
    });

    test('chaque tournoi part par une suppression distincte', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        const suppressions = app.requetes.filter(r => r.methode === 'DELETE').map(r => r.chemin);
        assert.equal(suppressions.length, 2);
        assert.ok(suppressions.every(c => c.startsWith('/api/etat?id=')));
    });

    test('les copies locales et le tournoi courant sont oubliés', async () => {
        const app = await pageSauvegarde(contenu);
        app.stockage.set('tournoi_echecs_state_v1:abc', '{}');
        app.stockage.set('tournoi_echecs_courant', 'abc');
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.equal(app.stockage.has('tournoi_echecs_state_v1:abc'), false);
        assert.equal(app.stockage.has('tournoi_echecs_courant'), false);
    });

    test('un tournoi récalcitrant n\'empêche pas les autres, et est signalé', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: suppressionRefusee('abc') });
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.deepEqual(app.serveur.ids(), ['abc'], 'seul celui en échec reste');
        assert.match(app.alertes.at(-1), /1 tournoi\(s\) et 1 fiche\(s\) effacés/);
        assert.match(app.alertes.at(-1), /En échec[\s\S]*abc/);
    });

    test('un échec sur les fiches est signalé sans être compté', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: FICHES_REFUSEES });
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.match(app.alertes.at(-1), /2 tournoi\(s\) et 0 fiche\(s\) effacés/);
        assert.match(app.alertes.at(-1), /liste des joueurs/);
    });

    test('rien à effacer : on le dit sans rien demander', async () => {
        const app = await pageSauvegarde({ tournois: [], joueurs: [] });
        await app.ev('eraseTout()');
        assert.match(app.alertes.at(-1), /rien à effacer/i);
        assert.deepEqual(app.requetes.filter(r => r.methode === 'DELETE'), []);
    });

    test('le résumé est remis à jour après coup', async () => {
        const app = await pageSauvegarde(contenu);
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.match(resume(app), /0 tournoi et 0 fiche/);
    });

    test('le bouton est rendu, même après un échec', async () => {
        const app = await pageSauvegarde({ ...contenu, panne: suppressionRefusee('abc') });
        app.repondrePrompt('EFFACER');
        await app.ev('eraseTout()');
        assert.equal(app.ev('document.getElementById("btn-raz").disabled'), false);
    });
});
