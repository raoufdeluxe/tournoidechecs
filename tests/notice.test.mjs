// Les messages de la page : ce qui remplace les alert() du navigateur.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

const notices = (app) => app.json(`
    (document.getElementById('notices').children || []).map(n => ({
        classe: n.className,
        texte: n.children[0] ? n.children[0].textContent : ''
    }))
`);

describe('notify', () => {
    test('le message s\'affiche dans la page, pas dans une boîte', () => {
        const app = chargerApp();
        app.ev('notify("Bonjour")');
        assert.deepEqual(notices(app), [{ classe: 'notice notice--info', texte: 'Bonjour' }]);
    });

    test('les messages s\'empilent au lieu de se remplacer', () => {
        const app = chargerApp();
        app.ev('notify("un"); notify("deux");');
        assert.deepEqual(notices(app).map(n => n.texte), ['un', 'deux']);
    });

    test('information et succès s\'effacent seuls, une erreur reste', () => {
        const app = chargerApp();
        app.ev('notify("passager"); notifySucces("aussi");');
        assert.equal(app.delaisEnAttente().length, 2, 'leur disparition est programmée');

        app.ev('notifyErreur("2 en échec :\\nabc\\ndef")');
        assert.equal(app.delaisEnAttente().length, 2, 'l\'erreur, elle, ne s\'efface pas');
        assert.match(app.alertes.at(-1), /abc\ndef/, 'les retours à la ligne sont gardés');
    });

    test('le texte est posé, jamais interprété comme du HTML', () => {
        const app = chargerApp();
        app.ev('notify("<img src=x onerror=1>")');
        // textContent : la balise reste du texte, quoi qu'on lui donne.
        assert.equal(notices(app)[0].texte, '<img src=x onerror=1>');
    });

});
