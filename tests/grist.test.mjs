// Le widget Grist : il affiche un tournoi entier à partir des tables du
// document, sans rejouer aucune règle.
//
// Qu'il relise fidèlement ce que l'outil a versé se vérifie ailleurs, dans
// outils/test_grist.py : l'écrivain est en Python, le lecteur ici.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

const widget = () => chargerApp({ page: 'grist/widget-tournoi.html' });

const ref = (nom) => 'j-' + nom.toLowerCase();
const INDICE = { Alice: 0, Bob: 1, Carl: 2, Dan: 3, Zoe: 0, Yann: 1 };
const cle = (nom, tournoi) => `${tournoi}:${INDICE[nom]}`;

const tournoi = (id, nom) => ({ Tournoi: id, Nom: nom, Version: 1, Maj: null });
const partant = (nom, t = 'coupe') =>
    ({ Cle: cle(nom, t), Tournoi: t, Indice: INDICE[nom], Ref: ref(nom) });
const fiche = (nom, elo = null) => ({ Ref: ref(nom), Nom: nom, Elo: elo, Pseudo: null });

/** Une manche : sa phase, son duel, son rang, ses deux partants et son résultat.
    `coups` est ce que chess.com rapporte quand la partie a été relue. */
const manche = (phase, duel, rang, blancs, noirs, resultat, t = 'coupe', journee = null, coups = null) =>
    ({ Cle: `${t}:${phase}:${duel}:${rang}`, Tournoi: t, Phase: phase, Duel: duel,
       Journee: journee, Manche: rang, Blancs: cle(blancs, t), Noirs: cle(noirs, t),
       Resultat: resultat, CC_Coups: coups });

const poule = (duel, rang, blancs, noirs, resultat, t = 'coupe', journee = 1) =>
    manche('poule', duel, rang, blancs, noirs, resultat, t, journee);

/** Pose des lignes dans le widget, avec les fiches que ses partants citent. */
const applique = (app, manches, partants, tournois = [tournoi('coupe', 'La Coupe')]) =>
    app.appel('appliqueTournoi', manches, partants, tournois,
              partants.map(p => fiche(Object.keys(INDICE).find(n => ref(n) === p.Ref))));

const vu = (app) => app.ev('document.getElementById("tournoi").innerHTML');
const texte = (app) => vu(app).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const QUATRE = ['Alice', 'Bob', 'Carl', 'Dan'].map(n => partant(n));

describe('le tournoi lu depuis le document', () => {
    test('le nom du tournoi est l\'affiche, avec son étape et son avancement', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'B')], QUATRE);
        const t = texte(app);
        assert.match(t, /La Coupe/);
        assert.match(t, /Phase de poule/);
        assert.match(t, /1 \/ 1 manches/);
    });

    test('les partants sont nommés par leur fiche, et classés au barème du tournoi', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'B'),
                       poule('2-3', 1, 'Carl', 'Dan', 'E')], QUATRE);
        assert.deepEqual(
            app.json('computeClassement().map(p => ({ nom: p.name, points: p.points }))'),
            [{ nom: 'Alice', points: 1 }, { nom: 'Carl', points: 0.5 },
             { nom: 'Dan', points: 0.5 }, { nom: 'Bob', points: 0 }]);
        assert.match(texte(app), /Alice/);
    });

    test('le point va au côté que la lettre désigne, pas au premier nommé', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'N')], QUATRE);
        assert.deepEqual(app.json('computeClassement().map(p => p.name)').slice(0, 1), ['Bob']);
    });

    test('tant qu\'il n\'y a pas de phase finale, ni tableau ni podium', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'B')], QUATRE);
        assert.doesNotMatch(texte(app), /Tableau final|Champion/);
    });

    test('les demies affichent leur score et désignent leur qualifié', () => {
        const app = widget();
        applique(app, [
            manche('demie', '1', 1, 'Alice', 'Dan', 'B'),
            manche('demie', '1', 2, 'Dan', 'Alice', 'N'),
            manche('demie', '2', 1, 'Bob', 'Carl', 'B'),
            manche('demie', '2', 2, 'Carl', 'Bob', 'N'),
        ], QUATRE);
        const t = texte(app);
        assert.match(t, /Demi-finale 1/);
        assert.match(t, /Demi-finale 2/);
        assert.match(t, /Demi-finales/, 'l\'étape suit l\'avancement');
        assert.match(t, /Tableau final/, 'le tableau est dressé');
        // Alice gagne ses deux manches : 2 à 0.
        assert.match(t, /Alice 2/);
    });

    test('la finale jouée dresse le podium, sans qu\'il soit enregistré nulle part', () => {
        const app = widget();
        applique(app, [
            poule('0-1', 1, 'Alice', 'Bob', 'B'),
            poule('2-3', 1, 'Carl', 'Dan', 'B'),
            manche('demie', '1', 1, 'Alice', 'Dan', 'B'),
            manche('demie', '1', 2, 'Dan', 'Alice', 'N'),
            manche('demie', '2', 1, 'Bob', 'Carl', 'B'),
            manche('demie', '2', 2, 'Carl', 'Bob', 'N'),
            manche('finale', '1', 1, 'Alice', 'Bob', 'B'),
            manche('finale', '1', 2, 'Bob', 'Alice', 'N'),
        ], QUATRE);
        const t = texte(app);
        assert.match(t, /Champion/);
        assert.match(t, /Dauphin/);
        assert.match(t, /Terminé/, 'le tournoi est allé au bout');
        // Alice gagne la finale ; Bob est dauphin ; le bronze sort de la poule.
        assert.match(t, /Alice Champion/);
    });

    test('les coups par partie ne comptent que les parties relues sur chess.com', () => {
        const app = widget();
        applique(app, [
            // Alice joue deux parties relues, de 40 et 20 coups : 30 en moyenne.
            manche('poule', '0-1', 1, 'Alice', 'Bob', 'B', 'coupe', 1, 40),
            manche('poule', '0-2', 1, 'Alice', 'Carl', 'B', 'coupe', 2, 20),
            // Celle-ci n'a pas de lien chess.com : elle ne dit rien de sa longueur.
            manche('poule', '2-3', 1, 'Carl', 'Dan', 'B', 'coupe', 1),
        ], QUATRE);

        // Bob n'a qu'une partie, de 40 coups : il mène la moyenne. Alice en a
        // deux, 40 et 20. Dan n'a aucune partie relue : il ne figure pas ici,
        // même s'il reste au classement.
        const bloc = texte(app).split('Coups par partie')[1];
        assert.match(bloc,
            /^ Bob 40 Alice 30 Carl 20 Moyenne sur 2 parties relues sur chess\.com\./);
    });

    test('aucune partie relue : pas de bloc de coups du tout', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'B')], QUATRE);
        assert.doesNotMatch(texte(app), /Coups par partie/);
    });

    test('seules les parties jouées sans lien sont listées, avec leurs couleurs', () => {
        const app = widget();
        applique(app, [
            // Reliée à chess.com : elle n'a rien à faire dans la liste.
            { ...poule('0-1', 1, 'Alice', 'Bob', 'B', 'coupe', 1),
              Lien: 'https://www.chess.com/game/live/1' },
            poule('2-3', 1, 'Carl', 'Dan', 'B', 'coupe', 1),
            // Le retour : les couleurs s'inversent, Alice passe aux noirs.
            poule('0-1', 2, 'Bob', 'Alice', 'N', 'coupe', 4),
            // Pas encore jouée : il n'y a rien à relier.
            poule('1-2', 1, 'Bob', 'Carl', null, 'coupe', 5),
        ], QUATRE);

        const bloc = texte(app).split('Jouées sans lien chess.com')[1];
        assert.match(bloc, /^ — 2 Journée 1 Carl ♙︎ vs Dan ♟︎ Journée 4 Bob ♙︎ vs Alice ♟︎/);
    });

    test('rien à relier : pas de bloc du tout', () => {
        const app = widget();
        applique(app, [
            { ...poule('0-1', 1, 'Alice', 'Bob', 'B'), Lien: 'https://www.chess.com/game/live/1' },
            poule('2-3', 1, 'Carl', 'Dan', null),
        ], QUATRE);
        assert.doesNotMatch(texte(app), /sans lien/i);
    });

    test('les tournois ne se mélangent pas : le menu en choisit un', () => {
        const app = widget();
        applique(app,
            [poule('0-1', 1, 'Alice', 'Bob', 'B'), poule('0-1', 1, 'Zoe', 'Yann', 'B', 'potes')],
            [...QUATRE, partant('Zoe', 'potes'), partant('Yann', 'potes')],
            [tournoi('coupe', 'La Coupe'), tournoi('potes', 'Chez les potes')]);
        assert.match(texte(app), /La Coupe/);

        app.appel('afficheTournoiChoisi', 'potes');
        const t = texte(app);
        assert.match(t, /Chez les potes/);
        assert.doesNotMatch(t, /Alice/);
    });

    test('le menu suit, qu\'on change de tournoi par lui ou par l\'adresse', () => {
        const app = widget();
        applique(app,
            [poule('0-1', 1, 'Alice', 'Bob', 'B'), poule('0-1', 1, 'Zoe', 'Yann', 'B', 'potes')],
            [...QUATRE, partant('Zoe', 'potes'), partant('Yann', 'potes')],
            [tournoi('coupe', 'La Coupe'), tournoi('potes', 'Chez les potes')]);

        app.appel('afficheTournoiChoisi', 'potes');
        const menu = app.ev('document.getElementById("choix-tournoi").innerHTML');
        assert.match(menu, /value="potes"[^>]*selected/,
            'sinon le menu annonce un tournoi et la page en montre un autre');
        assert.doesNotMatch(menu, /value="coupe"[^>]*selected/);
    });

    test('un seul tournoi : le menu n\'a rien à proposer et ne s\'affiche pas', () => {
        const app = widget();
        applique(app, [poule('0-1', 1, 'Alice', 'Bob', 'B')], QUATRE);
        assert.equal(app.ev('document.getElementById("choix-tournoi").hidden'), true);
    });

    test('un document vide le dit au lieu d\'un tableau vide', () => {
        const app = widget();
        app.appel('appliqueTournoi', [], [], [], []);
        assert.match(texte(app), /Aucun tournoi/);
    });
});
