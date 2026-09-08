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

    test('le résumé d\'une partie chess.com', async () => {
        // Ce nom-là ne vient même pas d'une fiche : c'est un pseudo choisi sur
        // chess.com, que le Worker nous rapporte tel quel.
        const app = pouleGeneree(noms(4));
        app.bac.fetch = async () => ({
            ok: true,
            json: async () => ({ analyse: { resultat: '1-0', blancs: PIEGE, coups: 3 } }),
        });
        const duel = app.json('tournoi.matches.filter(m => m.round === tournoi.currentRound)')[0];
        await app.ev(`setLienManche("poule:${duel.id}", "https://www.chess.com/game/live/1")`);
        app.ev('document.getElementById("matches-container").children.length = 0; renderParties()');
        assertEchappe(app.ev('document.getElementById("matches-container").children[0].innerHTML'),
            'résumé de la partie');
    });

    test('la matrice des matchs, en-têtes et infobulles comprises', () => {
        const app = pouleGeneree(noms(4));
        app.ev('renderVoletMatchs()');
        assertEchappe(app.ev('document.getElementById("matrice-matchs").innerHTML'), 'matrice des matchs');
    });

    test('la légende du graphe de progression', () => {
        const app = pouleGeneree(noms(4));
        app.ev('renderGrapheProgression()');
        const conteneur = app.ev('document.getElementById("progress-chart-container").innerHTML');
        if (conteneur) assertEchappe(conteneur, 'légende du graphe');
    });
});

describe('phases finales', () => {
    // Tous piégés : sur le podium, la marche qui reçoit le nom n'est pas la même
    // selon les résultats — un seul nom piégé laisserait passer les deux autres.
    function pouleTerminee(nbJoueurs = 6, tous = false) {
        const app = pouleGeneree(tous ? Array(nbJoueurs).fill(PIEGE) : noms(nbJoueurs));
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
        app.ev('setResultatManche("demie:0:0", "p1"); setResultatManche("demie:0:1", "p1");');
        assertEchappe(app.ev('document.getElementById("semi1-content").innerHTML'), 'annonce du qualifié');
    });

    test('la Grande Finale', () => {
        const app = pouleTerminee();
        app.ev(`
            setResultatManche("demie:0:0", "p1"); setResultatManche("demie:0:1", "p1");
            setResultatManche("demie:1:0", "p1"); setResultatManche("demie:1:1", "p1");
            startFinale();
        `);
        assertEchappe(app.ev('document.getElementById("final-matches-container").children[0].innerHTML'), 'finale');
        assertEchappe(app.ev('document.getElementById("finalistes-list").innerHTML'), 'tableau des finalistes');

        app.ev('setResultatManche("finale:0", "p1"); setResultatManche("finale:1", "p1");');
        assertEchappe(app.ev('document.getElementById("final-result-placeholder").innerHTML'),
            'annonce du champion');
    });

    test('le podium et le classement final', () => {
        const app = pouleTerminee(6, true);
        app.ev(`
            setResultatManche("demie:0:0", "p1"); setResultatManche("demie:0:1", "p1");
            setResultatManche("demie:1:0", "p1"); setResultatManche("demie:1:1", "p1");
            startFinale();
            setResultatManche("finale:0", "p1"); setResultatManche("finale:1", "p1"); finalizeFinale();
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
