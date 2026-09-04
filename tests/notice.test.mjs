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

    test('les trois tons ont leur classe', () => {
        const app = chargerApp();
        app.ev('notify("info"); notifySucces("ok"); notifyErreur("raté");');
        assert.deepEqual(notices(app).map(n => n.classe), [
            'notice notice--info', 'notice notice--succes', 'notice notice--erreur',
        ]);
    });

    test('les messages s\'empilent au lieu de se remplacer', () => {
        const app = chargerApp();
        app.ev('notify("un"); notify("deux");');
        assert.deepEqual(notices(app).map(n => n.texte), ['un', 'deux']);
    });

    test('information et succès s\'effacent seuls', () => {
        const app = chargerApp();
        app.ev('notify("passager"); notifySucces("aussi");');
        assert.deepEqual(app.delaisEnAttente(), [5000, 5000]);
    });

    test('une erreur reste : elle peut porter la liste de ce qui a échoué', () => {
        const app = chargerApp();
        app.ev('notifyErreur("2 en échec :\\nabc\\ndef")');
        assert.deepEqual(app.delaisEnAttente(), [], 'aucun effacement programmé');
        assert.match(notices(app)[0].texte, /abc\ndef/, 'les retours à la ligne sont gardés');
    });

    test('le texte est posé, jamais interprété comme du HTML', () => {
        const app = chargerApp();
        app.ev('notify("<img src=x onerror=1>")');
        // textContent : la balise reste du texte, quoi qu'on lui donne.
        assert.equal(notices(app)[0].texte, '<img src=x onerror=1>');
    });

    test('le journal des messages sert de trace', () => {
        const app = chargerApp();
        app.ev('notify("un"); notifyErreur("deux");');
        assert.deepEqual(app.alertes, ['un', 'deux']);
    });

    test('un seul conteneur, réutilisé', () => {
        const app = chargerApp();
        app.ev('notify("un"); notify("deux");');
        assert.equal(app.ev('document.getElementById("notices").children.length'), 2);
    });
});
