// Le panneau de confirmation, à la place de confirm() et prompt().

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

/** Une app avec le vrai panneau, pas la réponse automatique des tests. */
const appAvecDialogue = () => chargerApp({ page: 'joueurs.html', dialogueReel: true });

/** Le faux DOM ne sait pas chercher dans le HTML : on capture les gestionnaires. */
function instrumenter(app) {
    app.ev(`
        __capture = {};
        const vraiCreate = document.createElement;
        document.createElement = (tag) => {
            const el = vraiCreate(tag);
            el.querySelector = (sel) => {
                if (!__capture[sel]) __capture[sel] = { value: '', focus() {}, set onclick(f) { this._f = f; }, get onclick() { return this._f; } };
                return __capture[sel];
            };
            return el;
        };
    `);
}

const cliquer = (app, selecteur) => app.ev(`__capture['${selecteur}'].onclick({ target: null })`);

describe('askConfirmation', () => {
    test('valider répond vrai', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?', action: 'Supprimer' })`);
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, true);
    });

    test('annuler répond null : rien ne doit se passer ensuite', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        cliquer(app, '.dialogue-annuler');
        assert.equal(await promesse, null);
    });

    test('un mot à recopier : le bon mot valide', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        const promesse = app.ev(`askConfirmation({ titre: 'Tout effacer ?', mot: 'EFFACER' })`);
        app.ev(`__capture['.dialogue-saisie'].value = '  effacer  '`);
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, true, 'la casse et les espaces sont tolérés');
    });

    test('un mot approchant ne valide pas, et le panneau reste ouvert', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        app.ev(`askConfirmation({ titre: 'Tout effacer ?', mot: 'EFFACER' })`);
        app.ev(`__capture['.dialogue-saisie'].value = 'efface'`);
        cliquer(app, '.dialogue-valider');

        assert.match(app.alertes.at(-1), /le mot ne correspond pas/);
        assert.equal(app.ev('dialogueOuvert !== null'), true, 'on peut corriger sa saisie');
    });

    test('une saisie libre rend le texte tapé', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        const promesse = app.ev(`askConfirmation({ titre: 'Nouveau joueur', saisie: '' })`);
        app.ev(`__capture['.dialogue-saisie'].value = 'Vincent'`);
        cliquer(app, '.dialogue-valider');
        assert.equal(await promesse, 'Vincent');
    });

    test('Échap referme sans valider', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        const promesse = app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        app.emettre('keydown', { key: 'Escape' });
        assert.equal(await promesse, null);
    });

    test('une autre touche ne referme pas', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        app.ev(`askConfirmation({ titre: 'Supprimer ?' })`);
        app.emettre('keydown', { key: 'a' });
        assert.equal(app.ev('dialogueOuvert !== null'), true);
    });

    test('un titre piégé ne s\'injecte pas dans la page', async () => {
        const app = appAvecDialogue();
        instrumenter(app);
        app.ev(`askConfirmation({ titre: '<img src=x onerror="window.__XSS=1">' })`);
        // Le panneau est le second élément créé (le fond, puis lui).
        const html = app.ev('document.body.children[0].children[0].innerHTML');
        assert.doesNotMatch(html, /<img/);
        assert.match(html, /&lt;img/);
    });
});
