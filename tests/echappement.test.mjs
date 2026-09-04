// Un nom de joueur vient d'une fiche que toute personne ayant le lien peut
// modifier. Il ne doit jamais être injecté brut dans la page, sur aucun écran.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';
import { pouleGeneree, completerPoule } from './aide/tournoi.mjs';

const PIEGE = '<img src=x onerror="window.__XSS=1">';
const noms = (n) => [PIEGE, ...Array.from({ length: n - 1 }, (_, i) => `J${i}`)];

/** Le HTML rendu ne doit contenir la charge que sous forme échappée. */
function assertEchappe(html, ou) {
    assert.doesNotMatch(html, /<img/, `${ou} : balise injectée telle quelle`);
    assert.ok(html.includes('&lt;img'), `${ou} : le nom devrait apparaître échappé`);
}

describe('phase de poule', () => {
    test('le classement', () => {
        const app = pouleGeneree(noms(4));
        app.ev('renderClassement()');
        assertEchappe(app.ev('document.getElementById("standings-body").innerHTML'), 'classement');
    });

    test('les cartes de duel, menu de résultat compris', () => {
        const app = pouleGeneree(noms(4));
        app.ev('renderParties()');
        const carte = app.ev('document.getElementById("matches-container").children[0].innerHTML');
        assertEchappe(carte, 'carte de duel');
        assert.match(carte, /Victoire — &lt;img/, 'le menu de résultat aussi');
    });

    test('la légende du graphe de progression', () => {
        const app = pouleGeneree(noms(4));
        app.ev('renderGrapheProgression()');
        const conteneur = app.ev('document.getElementById("progress-chart-container").innerHTML');
        if (conteneur) assertEchappe(conteneur, 'légende du graphe');
    });
});

describe('phases finales', () => {
    function pouleTerminee(nbJoueurs = 6) {
        const app = pouleGeneree(noms(nbJoueurs));
        completerPoule(app);
        app.ev('finalizePoule()');
        return app;
    }

    test('une demi-finale', () => {
        const app = pouleTerminee();
        app.ev('renderDemies()');
        assertEchappe(app.ev('document.getElementById("semi1-content").innerHTML'), 'demi-finale');
    });

    test('le nom du qualifié annoncé', () => {
        const app = pouleTerminee();
        app.ev('setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");');
        assertEchappe(app.ev('document.getElementById("semi1-content").innerHTML'), 'annonce du qualifié');
    });

    test('la Grande Finale', () => {
        const app = pouleTerminee();
        app.ev(`
            setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");
            setResultatDemie(1, 0, "p1"); setResultatDemie(1, 1, "p1");
            startFinale();
        `);
        assertEchappe(app.ev('document.getElementById("final-matches-container").children[0].innerHTML'), 'finale');
        assertEchappe(app.ev('document.getElementById("finalistes-list").innerHTML'), 'tableau des finalistes');
    });

    test('le podium et le classement final', () => {
        const app = pouleTerminee();
        app.ev(`
            setResultatDemie(0, 0, "p1"); setResultatDemie(0, 1, "p1");
            setResultatDemie(1, 0, "p1"); setResultatDemie(1, 1, "p1");
            startFinale();
            setResultatFinale(0, "p1"); setResultatFinale(1, "p1"); finalizeFinale();
        `);
        assertEchappe(app.ev('document.getElementById("final-standings-body").innerHTML'), 'classement final');
        assertEchappe(app.ev('document.getElementById("podium").innerHTML'), 'podium');
    });
});

describe('listes et menus', () => {
    test('le menu de choix d\'un joueur à l\'inscription', () => {
        const app = chargerApp();
        app.set('joueurs', [{ id: 'j-aa', nom: PIEGE, elo: null }]);
        assertEchappe(app.appel('buildOptionsJoueurs', ''), 'menu d\'inscription');
    });

    test('la page Joueurs', async () => {
        const app = chargerApp({ page: 'joueurs.html' });
        app.set('joueurs', [{ id: 'j-aa', nom: PIEGE, elo: null }]);
        app.ev('renderJoueurs()');
        assertEchappe(app.ev('document.getElementById("joueurs-editor").innerHTML'), 'page Joueurs');
    });
});
