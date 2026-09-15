// Le panneau de confirmation, à la place de confirm() et prompt().

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

/** Une app avec le vrai panneau, pas la réponse automatique des tests. */
const appAvecDialogue = () => chargerApp({ page: 'joueurs.html', dialogueReel: true });

const PANNEAU = 'dialogueOuvert.fond.children[0]';
/** Un élément du panneau ouvert : le faux DOM rend le même pour un sélecteur donné. */
const dans = (selecteur) => `${PANNEAU}.querySelector('${selecteur}')`;

const cliquer = (app, selecteur) => app.ev(`${dans(selecteur)}.onclick({ target: null })`);
const saisir = (app, texte) => app.ev(`${dans('.dialogue-saisie')}.value = ${JSON.stringify(texte)}`);

describe('askConfirmation', () => {
    test('valider répond vrai', async () => {
        const app = appAvecDialogue();
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?', action: 'Supprimer' })`);
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, true);
    });

    test('annuler répond null : rien ne doit se passer ensuite', async () => {
        const app = appAvecDialogue();
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        cliquer(app, '.dialogue-annuler');
        assert.equal(await promesse, null);
    });

    test('un mot à recopier : le bon mot valide', async () => {
        const app = appAvecDialogue();
        const promesse = app.ev(`askConfirmation({ titre: 'Tout effacer ?', mot: 'EFFACER' })`);
        saisir(app, '  effacer  ');
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, true, 'la casse et les espaces sont tolérés');
    });

    test('un mot approchant ne valide pas, et le panneau reste ouvert', async () => {
        const app = appAvecDialogue();
        app.ev(`askConfirmation({ titre: 'Tout effacer ?', mot: 'EFFACER' })`);
        saisir(app, 'efface');
        cliquer(app, '.dialogue-valider');

        assert.match(app.alertes.at(-1), /le mot ne correspond pas/);
        assert.equal(app.ev('dialogueOuvert !== null'), true, 'on peut corriger sa saisie');
    });

    test('une saisie libre rend le texte tapé', async () => {
        const app = appAvecDialogue();
        const promesse = app.ev(`askConfirmation({ titre: 'Nouveau joueur', saisie: '' })`);
        saisir(app, 'Vincent');
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, 'Vincent');
    });

    test('Échap referme sans valider', async () => {
        const app = appAvecDialogue();
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        app.emettre('keydown', { key: 'Escape' });
        assert.equal(await promesse, null);
    });

    test('une autre touche ne referme pas', async () => {
        const app = appAvecDialogue();
        app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        app.emettre('keydown', { key: 'a' });
        assert.equal(app.ev('dialogueOuvert !== null'), true);
    });

    test('un titre piégé ne s\'injecte pas dans la page', async () => {
        const app = appAvecDialogue();
        app.ev(`askConfirmation({ titre: '<img src=x onerror="window.__XSS=1">' })`);
        const html = app.ev(`${PANNEAU}.innerHTML`);
        assert.doesNotMatch(html, /<img/);
        assert.match(html, /&lt;img/);
    });
});
