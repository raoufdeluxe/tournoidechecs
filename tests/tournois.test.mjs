// Identité du tournoi : lien, nom lisible, échappement des noms.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

const MOTIF_ID = /^[a-z0-9-]{1,64}$/; // celui du Worker

describe('slugify — « Tournoi des potes » devient une adresse', () => {
    const cas = [
        ['Tournoi des potes', 'tournoi-des-potes'],
        ['Été à Noël', 'ete-a-noel'],
        ['  espaces   multiples  ', 'espaces-multiples'],
        ['Ponctuation !?#@', 'ponctuation'],
        ['MAJUSCULES', 'majuscules'],
        ['déjà-un-slug', 'deja-un-slug'],
        ['1000 & 1 nuits', '1000-1-nuits'],
        ['---bordé de tirets---', 'borde-de-tirets'],
    ];
    for (const [entree, attendu] of cas) {
        test(`« ${entree} » → « ${attendu} »`, () => {
            const app = chargerApp();
            assert.equal(app.appel('slugify', entree), attendu);
        });
    }

    test('un nom très long est coupé sans laisser de tiret en bout', () => {
        const app = chargerApp();
        const slug = app.appel('slugify', 'mot '.repeat(40));
        assert.ok(slug.length <= 64);
        assert.doesNotMatch(slug, /-$/);
    });

    test('tout slug non vide est un identifiant que le Worker accepte', () => {
        const app = chargerApp();
        const noms = ['Tournoi des potes', 'Été 2026 !', 'a', 'Ça passe ?', 'x'.repeat(200)];
        for (const nom of noms) {
            const slug = app.appel('slugify', nom);
            assert.match(slug, MOTIF_ID, `« ${nom} » produit « ${slug} »`);
        }
    });

    test('un nom sans aucun caractère utilisable donne une chaîne vide (à l\'appelant de trancher)', () => {
        const app = chargerApp();
        assert.equal(app.appel('slugify', '???'), '');
    });
});

describe('newIdTournoi', () => {
    test('identifiant accepté par le Worker, sans caractères ambigus', () => {
        const app = chargerApp();
        for (let i = 0; i < 50; i++) {
            const id = app.appel('newIdTournoi');
            assert.match(id, MOTIF_ID);
            assert.equal(id.length, 10);
            assert.doesNotMatch(id, /[lo01]/, 'ni l, ni o, ni 0, ni 1');
        }
    });

    test('deux appels ne donnent pas le même identifiant', () => {
        const app = chargerApp();
        const ids = new Set(Array.from({ length: 200 }, () => app.appel('newIdTournoi')));
        assert.equal(ids.size, 200);
    });
});

describe('identifiant porté par l\'URL', () => {
    test('un lien partagé ouvre le tournoi correspondant', () => {
        const app = chargerApp({ hash: '#tournoi-des-potes' });
        assert.equal(app.ev('idTournoi'), 'tournoi-des-potes');
        assert.match(app.ev('urlEtatCourant()'), /\?id=tournoi-des-potes$/);
    });

    test('sans identifiant dans l\'URL, un nouveau est tiré et inscrit dans le lien', () => {
        const app = chargerApp({ hash: '' });
        assert.match(app.ev('idTournoi'), MOTIF_ID);
        assert.equal(app.ev('location.hash'), '#' + app.ev('idTournoi'));
    });

    test('un identifiant invalide dans l\'URL est remplacé, jamais transmis tel quel', () => {
        const app = chargerApp({ hash: '#PAS/VALIDE' });
        assert.match(app.ev('idTournoi'), MOTIF_ID);
        assert.notEqual(app.ev('idTournoi'), 'PAS/VALIDE');
    });

    test('la clé locale est propre à chaque tournoi', () => {
        const a = chargerApp({ hash: '#un' });
        const b = chargerApp({ hash: '#deux' });
        assert.notEqual(a.ev('storageKey(idTournoi)'), b.ev('storageKey(idTournoi)'));
        assert.equal(a.ev('storageKey("autre")'), b.ev('storageKey("autre")'));
    });
});

describe('le tournoi courant est noté pour la page /tournois', () => {
    test('à l\'ouverture', () => {
        const app = chargerApp({ hash: '#tournoi-des-potes' });
        assert.equal(app.stockage.get('tournoi_echecs_courant'), 'tournoi-des-potes');
    });

    test('et quand le tournoi change d\'adresse', () => {
        const app = chargerApp({ hash: '#avant' });
        app.ev('idTournoi = "apres"; saveTournoiCourant();');
        assert.equal(app.stockage.get('tournoi_echecs_courant'), 'apres');
    });
});

describe('escapeHtml — les noms viennent d\'autres personnes', () => {
    test('les caractères dangereux sont neutralisés', () => {
        const app = chargerApp();
        assert.equal(app.appel('escapeHtml', '<script>alert(1)</script>'),
            '&lt;script&gt;alert(1)&lt;/script&gt;');
        assert.equal(app.appel('escapeHtml', `guillemets " et ' et &`),
            'guillemets &quot; et &#39; et &amp;');
    });

    test('un texte ordinaire n\'est pas abîmé', () => {
        const app = chargerApp();
        assert.equal(app.appel('escapeHtml', 'Tournoi des potes — été 2026'),
            'Tournoi des potes — été 2026');
    });

    test('une valeur non textuelle ne fait pas tomber la liste', () => {
        const app = chargerApp();
        assert.equal(app.appel('escapeHtml', null), 'null');
        assert.equal(app.appel('escapeHtml', 42), '42');
    });
});

describe('isIdTaken — un nom déjà pris pointerait sur le tournoi d\'un autre', () => {
    const reponse = (corps) => ({ ok: true, status: 200, json: async () => corps });

    test('un tournoi avec des partants est considéré comme pris', async () => {
        const app = chargerApp({ fetch: async () => reponse({ version: 2, state: { tournament: { players: [{ id: 0 }] } } }) });
        await app.pret();
        assert.equal(await app.ev('isIdTaken("abc")'), true);
    });

    test('un tournoi vide ou inexistant est libre', async () => {
        const vide = chargerApp({ fetch: async () => reponse({ version: 0, state: null }) });
        await vide.pret();
        assert.equal(await vide.ev('isIdTaken("abc")'), false);

        const sansJoueur = chargerApp({ fetch: async () => reponse({ version: 1, state: { tournament: { players: [] } } }) });
        await sansJoueur.pret();
        assert.equal(await sansJoueur.ev('isIdTaken("abc")'), false);
    });

    test('hors ligne : on ne bloque pas la création', async () => {
        const app = chargerApp({ fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        assert.equal(await app.ev('isIdTaken("abc")'), false);
    });
});
