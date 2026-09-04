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

describe('ce que l\'accueil ouvre', () => {
    const serveurVide = async () => ({ ok: true, status: 200, json: async () => ({ version: 0, state: null }) });

    test('un lien partagé ouvre le tournoi correspondant', async () => {
        const app = chargerApp({ hash: '#tournoi-des-potes', fetch: serveurVide });
        await app.pret();
        assert.equal(app.ev('idTournoi'), 'tournoi-des-potes');
        assert.match(app.ev('urlEtatCourant()'), /\?id=tournoi-des-potes$/);
    });

    test('sans lien, on rouvre le dernier tournoi consulté', async () => {
        const etat = {
            version: 3,
            state: {
                screen: 'screen-tournament',
                tournament: { name: 'Coupe du Dimanche', players: [{ id: 0, name: 'A', elo: null }], matches: [] },
            },
        };
        const app = chargerApp({
            hash: '',
            fetch: async (url) => ({
                ok: true, status: 200,
                json: async () => (url.includes('/api/etat') ? etat : { version: 0, joueurs: [] }),
            }),
        });
        app.stockage.set('tournoi_echecs_courant', 'coupe-du-dimanche');
        await app.pret();

        assert.equal(app.ev('idTournoi'), 'coupe-du-dimanche');
        assert.equal(app.ev('location.hash'), '#coupe-du-dimanche');
        assert.equal(app.ev('tournoi.name'), 'Coupe du Dimanche', 'et son contenu est chargé');
    });

    test('sans lien ni tournoi précédent, aucun identifiant n\'est inventé', async () => {
        // Une simple visite ne doit pas créer de tournoi fantôme dans la liste
        // partagée : l'adresse n'apparaît qu'au premier « Donner le départ ».
        const app = chargerApp({ hash: '', fetch: serveurVide });
        await app.pret();
        assert.equal(app.ev('idTournoi'), '');
        assert.equal(app.ev('location.hash'), '');
        assert.deepEqual(app.appelsFetch.filter(a => a.url.includes('/api/etat')), []);
    });

    test('sans tournoi, le titre annonce celui qui reste à créer', async () => {
        const app = chargerApp({ hash: '', fetch: serveurVide });
        await app.pret();
        assert.equal(app.ev('document.getElementById("tournament-name-display").textContent'),
            'Nouveau tournoi');
    });

    test('une visite sans tournoi n\'écrit rien, ni en local ni sur le serveur', async () => {
        const app = chargerApp({ hash: '', fetch: serveurVide });
        await app.pret();
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(app.stockage.size, 0);
        assert.deepEqual(app.appelsFetch.filter(a => a.init && a.init.method === 'POST'), []);
    });

    test('un identifiant invalide dans l\'URL est ignoré, jamais transmis', async () => {
        const app = chargerApp({ hash: '#PAS/VALIDE', fetch: serveurVide });
        await app.pret();
        assert.equal(app.ev('idTournoi'), '');
        assert.deepEqual(app.appelsFetch.filter(a => a.url.includes('PAS')), []);
    });

    test('un repère qui ne mène à rien est oublié', async () => {
        const app = chargerApp({ hash: '', fetch: serveurVide });
        app.stockage.set('tournoi_echecs_courant', 'disparu');
        await app.pret();
        assert.equal(app.stockage.has('tournoi_echecs_courant'), false);
        assert.equal(app.ev('idTournoi'), '');
        assert.equal(app.ev('location.hash'), '', 'plus d\'adresse morte dans la barre');
    });

    test('un lien partagé vers un tournoi pas encore créé reste valable', async () => {
        // Quelqu'un partage …/#tournoi-des-potes avant de donner le départ :
        // le lien doit tenir, sinon le nom convenu est perdu.
        const app = chargerApp({ hash: '#tournoi-des-potes', fetch: serveurVide });
        await app.pret();
        assert.equal(app.ev('idTournoi'), 'tournoi-des-potes');
        assert.equal(app.ev('location.hash'), '#tournoi-des-potes');
    });

    test('la clé locale est propre à chaque tournoi', () => {
        const app = chargerApp();
        assert.notEqual(app.ev('storageKey("un")'), app.ev('storageKey("deux")'));
        assert.equal(app.ev('storageKey("meme")'), app.ev('storageKey("meme")'));
    });
});

describe('le tournoi courant est noté pour la page /tournois', () => {
    test('dès qu\'un tournoi est ouvert', async () => {
        const app = chargerApp({ hash: '#tournoi-des-potes',
            fetch: async () => ({ ok: true, status: 200, json: async () => ({ version: 0, state: null }) }) });
        await app.pret();
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
