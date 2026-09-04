// API du Worker : routage, écriture versionnée, liste des tournois.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import { fauxKV, appeler } from './aide/kv.mjs';

const etat = (nom, nbJoueurs = 2) => ({
    screen: 'screen-tournament',
    tournament: {
        name: nom,
        players: Array.from({ length: nbJoueurs }, (_, i) => ({ id: i, name: `J${i}`, elo: null })),
        matches: [],
    },
});

const enveloppe = (version, state, updatedAt = '2026-01-01T00:00:00.000Z') =>
    JSON.stringify({ version, updatedAt, state });

describe('routage', () => {
    test('une route inconnue répond 404', async () => {
        const r = await appeler(worker, fauxKV(), 'GET', '/nawak');
        assert.equal(r.status, 404);
    });

    test('les anciens chemins restent servis pour les onglets déjà ouverts', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(3, etat('Les potes', 4)) });
        assert.equal((await appeler(worker, kv, 'GET', '/state?id=abc')).body.version, 3);
        assert.deepEqual(
            (await appeler(worker, kv, 'GET', '/tournaments')).body,
            (await appeler(worker, kv, 'GET', '/api/tournois')).body);
    });

    test('/joueurs et /tournois ne sont pas des routes du Worker : ce sont des pages', async () => {
        // Les fichiers statiques sont servis avant le Worker ; s'il répondait ici,
        // il masquerait public/joueurs.html et public/tournois.html.
        for (const chemin of ['/joueurs', '/tournois']) {
            assert.equal((await appeler(worker, fauxKV(), 'GET', chemin)).status, 404, chemin);
        }
    });

    test('une méthode non gérée sur /state répond 405', async () => {
        const r = await appeler(worker, fauxKV(), 'PUT', '/api/etat?id=abc');
        assert.equal(r.status, 405);
    });

    test('la pré-requête CORS est acceptée et annonce les méthodes', async () => {
        const r = await appeler(worker, fauxKV(), 'OPTIONS', '/api/etat?id=abc');
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
        for (const m of ['GET', 'POST', 'DELETE']) {
            assert.match(r.headers.get('Access-Control-Allow-Methods'), new RegExp(m));
        }
    });

    test('toute réponse porte les en-têtes CORS', async () => {
        for (const [methode, chemin] of [['GET', '/api/etat?id=abc'], ['GET', '/nawak'], ['PUT', '/api/etat?id=abc']]) {
            const r = await appeler(worker, fauxKV(), methode, chemin);
            assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*', `${methode} ${chemin}`);
        }
    });
});

describe('validation de l\'identifiant', () => {
    const invalides = ['MAJUSCULES', 'avec espace', 'accentué', 'point.virgule', 'a'.repeat(65), 'slash/dedans'];
    for (const id of invalides) {
        test(`« ${id.slice(0, 20)} » est refusé (400)`, async () => {
            const r = await appeler(worker, fauxKV(), 'GET', '/api/etat?id=' + encodeURIComponent(id));
            assert.equal(r.status, 400);
        });
    }

    for (const id of ['abc', 'tournoi-des-potes', 'a', '0', 'a'.repeat(64)]) {
        test(`« ${id.slice(0, 20)} » est accepté`, async () => {
            const r = await appeler(worker, fauxKV(), 'GET', '/api/etat?id=' + id);
            assert.equal(r.status, 200);
        });
    }

    test('une requête sans id retombe sur la clé historique', async () => {
        const kv = fauxKV({ tournament: enveloppe(7, etat('Ancien')) });
        const r = await appeler(worker, kv, 'GET', '/api/etat');
        assert.equal(r.body.version, 7);
        assert.equal(r.body.state.tournament.name, 'Ancien');
    });
});

describe('GET /state', () => {
    test('tournoi inexistant : version 0 et état nul', async () => {
        const r = await appeler(worker, fauxKV(), 'GET', '/api/etat?id=inconnu');
        assert.deepEqual(r.body, { version: 0, updatedAt: null, state: null });
    });

    test('tournoi existant : version, date et état', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(3, etat('Les potes')) });
        const r = await appeler(worker, kv, 'GET', '/api/etat?id=abc');
        assert.equal(r.body.version, 3);
        assert.equal(r.body.state.tournament.name, 'Les potes');
    });

    test('ancien format (état nu, sans enveloppe) : relu en version 0', async () => {
        const kv = fauxKV({ 'tournament:abc': JSON.stringify(etat('Avant versionnage')) });
        const r = await appeler(worker, kv, 'GET', '/api/etat?id=abc');
        assert.equal(r.body.version, 0);
        assert.equal(r.body.state.tournament.name, 'Avant versionnage');
    });

    test('valeur illisible en base : traitée comme un tournoi vide, pas comme une erreur', async () => {
        const kv = fauxKV({ 'tournament:abc': '{ceci n\'est pas du json' });
        const r = await appeler(worker, kv, 'GET', '/api/etat?id=abc');
        assert.deepEqual(r.body, { version: 0, updatedAt: null, state: null });
    });
});

describe('POST /state — écriture versionnée', () => {
    test('première écriture : version 1 et date d\'enregistrement', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/api/etat?id=abc',
            { baseVersion: 0, state: etat('Les potes') });
        assert.equal(r.status, 200);
        assert.equal(r.body.version, 1);
        assert.ok(Date.parse(r.body.updatedAt), 'updatedAt est une date ISO');
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Les potes');
    });

    test('écritures successives : la version s\'incrémente', async () => {
        const kv = fauxKV();
        for (const attendue of [1, 2, 3]) {
            const r = await appeler(worker, kv, 'POST', '/api/etat?id=abc',
                { baseVersion: attendue - 1, state: etat('T') });
            assert.equal(r.body.version, attendue);
        }
    });

    test('version périmée : 409 avec l\'état courant, et rien n\'est écrasé', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(5, etat('Version serveur')) });
        const r = await appeler(worker, kv, 'POST', '/api/etat?id=abc',
            { baseVersion: 2, state: etat('Ma version') });
        assert.equal(r.status, 409);
        assert.equal(r.body.version, 5);
        assert.equal(r.body.state.tournament.name, 'Version serveur',
            'le client reçoit de quoi arbitrer');
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Version serveur');
    });

    test('deux appareils partis de la même version : le second est refusé', async () => {
        const kv = fauxKV();
        await appeler(worker, kv, 'POST', '/api/etat?id=abc', { baseVersion: 0, state: etat('A') });
        const second = await appeler(worker, kv, 'POST', '/api/etat?id=abc', { baseVersion: 0, state: etat('B') });
        assert.equal(second.status, 409);
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'A');
    });

    test('corps sans baseVersion (ancien onglet) : accepté tel quel', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(5, etat('Serveur')) });
        const r = await appeler(worker, kv, 'POST', '/api/etat?id=abc', etat('Ancien onglet'));
        assert.equal(r.status, 200);
        assert.equal(r.body.version, 6);
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Ancien onglet');
    });

    test('corps illisible : 400, rien n\'est écrit', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/api/etat?id=abc', 'pas du json');
        assert.equal(r.status, 400);
        assert.equal(kv.donnees.size, 0);
    });

    test('identifiant invalide : refusé avant toute écriture', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/api/etat?id=NOPE', { baseVersion: 0, state: etat('X') });
        assert.equal(r.status, 400);
        assert.equal(kv.donnees.size, 0);
    });

    test('chaque tournoi vit sous sa propre clé', async () => {
        const kv = fauxKV();
        await appeler(worker, kv, 'POST', '/api/etat?id=un', { baseVersion: 0, state: etat('Un') });
        await appeler(worker, kv, 'POST', '/api/etat?id=deux', { baseVersion: 0, state: etat('Deux') });
        assert.deepEqual([...kv.donnees.keys()].sort(), ['tournament:deux', 'tournament:un']);
        const r = await appeler(worker, kv, 'GET', '/api/etat?id=un');
        assert.equal(r.body.state.tournament.name, 'Un');
    });
});

describe('DELETE /state', () => {
    test('supprime le tournoi ; la relecture repart de zéro', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(2, etat('À jeter')) });
        const r = await appeler(worker, kv, 'DELETE', '/api/etat?id=abc');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, { deleted: true });
        assert.equal((await appeler(worker, kv, 'GET', '/api/etat?id=abc')).body.state, null);
    });

    test('supprimer un tournoi inexistant n\'est pas une erreur', async () => {
        assert.equal((await appeler(worker, fauxKV(), 'DELETE', '/api/etat?id=fantome')).status, 200);
    });

    test('ne touche pas aux autres tournois', async () => {
        const kv = fauxKV({
            'tournament:abc': enveloppe(1, etat('À jeter')),
            'tournament:def': enveloppe(1, etat('À garder')),
        });
        await appeler(worker, kv, 'DELETE', '/api/etat?id=abc');
        assert.deepEqual([...kv.donnees.keys()], ['tournament:def']);
    });
});

describe('/joueurs — administration des joueurs', () => {
    /** Crée une fiche et renvoie le corps de la réponse. */
    async function creer(kv, nom, elo) {
        return (await appeler(worker, kv, 'POST', '/api/joueurs', elo === undefined ? { nom } : { nom, elo })).body;
    }

    describe('GET /joueurs', () => {
        test('liste inexistante : version 0 et aucun joueur', async () => {
            const r = await appeler(worker, fauxKV(), 'GET', '/api/joueurs');
            assert.deepEqual(r.body, { version: 0, updatedAt: null, joueurs: [] });
        });

        test('renvoie les fiches créées, dans l\'ordre d\'ajout', async () => {
            const kv = fauxKV();
            await creer(kv, 'Vince', 1500);
            await creer(kv, 'Raf');
            const r = await appeler(worker, kv, 'GET', '/api/joueurs');
            assert.deepEqual(r.body.joueurs.map(j => j.nom), ['Vince', 'Raf']);
            assert.deepEqual(r.body.joueurs.map(j => j.elo), [1500, null]);
            assert.equal(r.body.version, 2);
        });
    });

    describe('POST /joueurs — création', () => {
        test('répond 201 avec la fiche et son identifiant', async () => {
            const kv = fauxKV();
            const r = await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'Vince', elo: 1500 });
            assert.equal(r.status, 201);
            assert.equal(r.body.joueur.nom, 'Vince');
            assert.equal(r.body.joueur.elo, 1500);
            assert.match(r.body.joueur.id, /^[a-z0-9-]{1,64}$/, 'utilisable comme renvoi');
            assert.equal(r.body.version, 1);
        });

        test('l\'identifiant est attribué par le serveur, jamais par le client', async () => {
            const kv = fauxKV();
            const r = await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'Vince', id: 'j-choisi' });
            assert.notEqual(r.body.joueur.id, 'j-choisi');
        });

        test('deux créations donnent deux identifiants différents', async () => {
            const kv = fauxKV();
            const a = await creer(kv, 'Vince');
            const b = await creer(kv, 'Raf');
            assert.notEqual(a.joueur.id, b.joueur.id);
        });

        test('deux appareils qui ajoutent en même temps n\'entrent pas en conflit', async () => {
            // Pas de baseVersion à la création : chacun repart de la liste courante.
            const kv = fauxKV();
            assert.equal((await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'Vince' })).status, 201);
            assert.equal((await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'Raf' })).status, 201);
            const r = await appeler(worker, kv, 'GET', '/api/joueurs');
            assert.deepEqual(r.body.joueurs.map(j => j.nom), ['Vince', 'Raf'], 'aucun ajout perdu');
        });

        test('le nom est nettoyé', async () => {
            const kv = fauxKV();
            assert.equal((await creer(kv, '  Vince  ')).joueur.nom, 'Vince');
        });

        test('un homonyme est refusé (409), quelle que soit la casse', async () => {
            const kv = fauxKV();
            await creer(kv, 'Vince');
            const r = await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'vince' });
            assert.equal(r.status, 409);
            assert.equal(r.body.joueur.nom, 'Vince', 'la fiche existante est renvoyée');
            assert.equal((await appeler(worker, kv, 'GET', '/api/joueurs')).body.joueurs.length, 1);
        });

        for (const [nom, corps] of [
            ['un nom vide', { nom: '   ' }],
            ['un nom absent', {}],
            ['un nom non textuel', { nom: 42 }],
            ['un nom trop long', { nom: 'x'.repeat(65) }],
            ['un Elo non numérique', { nom: 'Vince', elo: 'fort' }],
        ]) {
            test(`refuse ${nom} (400)`, async () => {
                const kv = fauxKV();
                const r = await appeler(worker, kv, 'POST', '/api/joueurs', corps);
                assert.equal(r.status, 400);
                assert.equal(kv.donnees.size, 0, 'rien n\'est écrit');
            });
        }

        test('corps illisible : 400', async () => {
            assert.equal((await appeler(worker, fauxKV(), 'POST', '/api/joueurs', 'pas du json')).status, 400);
        });

        test('liste pleine : 409', async () => {
            const kv = fauxKV({ players: JSON.stringify({
                version: 1, updatedAt: null,
                joueurs: Array.from({ length: 200 }, (_, i) => ({ id: 'j-' + i, nom: 'J' + i, elo: null })),
            }) });
            assert.equal((await appeler(worker, kv, 'POST', '/api/joueurs', { nom: 'Un de trop' })).status, 409);
        });
    });

    describe('PATCH /joueurs/<id> — nom et Elo', () => {
        test('renomme sans toucher à l\'Elo', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf', 1200);
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { nom: 'Raphael' });
            assert.equal(r.status, 200);
            assert.deepEqual(r.body.joueur, { id: joueur.id, nom: 'Raphael', elo: 1200 });
            assert.equal(r.body.version, 2);
        });

        test('modifie l\'Elo sans toucher au nom', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf', 1200);
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { elo: 1610 });
            assert.deepEqual(r.body.joueur, { id: joueur.id, nom: 'Raf', elo: 1610 });
        });

        test('efface l\'Elo avec null', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf', 1200);
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { elo: null });
            assert.equal(r.body.joueur.elo, null);
        });

        test('les deux à la fois', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf');
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { nom: 'Raphael', elo: 1610 });
            assert.deepEqual(r.body.joueur, { id: joueur.id, nom: 'Raphael', elo: 1610 });
        });

        test('l\'identifiant ne change jamais : les renvois des tournois restent valides', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf');
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { nom: 'Raphael', id: 'j-autre' });
            assert.equal(r.body.joueur.id, joueur.id);
        });

        test('fiche inconnue : 404', async () => {
            assert.equal((await appeler(worker, fauxKV(), 'PATCH', '/api/joueurs/j-fantome', { nom: 'X' })).status, 404);
        });

        test('prendre le nom d\'un autre est refusé (409)', async () => {
            const kv = fauxKV();
            await creer(kv, 'Vince');
            const { joueur } = await creer(kv, 'Raf');
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { nom: 'VINCE' });
            assert.equal(r.status, 409);
            assert.equal((await appeler(worker, kv, 'GET', '/api/joueurs')).body.joueurs[1].nom, 'Raf');
        });

        test('garder son propre nom n\'est pas un doublon', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf');
            const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, { nom: 'Raf', elo: 1500 });
            assert.equal(r.status, 200);
        });

        for (const [nom, corps] of [['un nom vide', { nom: '' }], ['un Elo non numérique', { elo: 'fort' }]]) {
            test(`refuse ${nom} (400)`, async () => {
                const kv = fauxKV();
                const { joueur } = await creer(kv, 'Raf', 1200);
                const r = await appeler(worker, kv, 'PATCH', '/api/joueurs/' + joueur.id, corps);
                assert.equal(r.status, 400);
                assert.deepEqual((await appeler(worker, kv, 'GET', '/api/joueurs')).body.joueurs[0],
                    { id: joueur.id, nom: 'Raf', elo: 1200 }, 'la fiche est intacte');
            });
        }
    });

    describe('DELETE /joueurs/<id>', () => {
        test('supprime la fiche et laisse les autres', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf');
            await creer(kv, 'Vince');
            const r = await appeler(worker, kv, 'DELETE', '/api/joueurs/' + joueur.id);
            assert.equal(r.status, 200);
            assert.equal(r.body.deleted, true);
            assert.deepEqual((await appeler(worker, kv, 'GET', '/api/joueurs')).body.joueurs.map(j => j.nom), ['Vince']);
        });

        test('fiche inconnue : 404', async () => {
            assert.equal((await appeler(worker, fauxKV(), 'DELETE', '/api/joueurs/j-fantome')).status, 404);
        });

        test('les tournois ne sont pas touchés', async () => {
            const kv = fauxKV({ 'tournament:abc': enveloppe(1, etat('Les potes', 4)) });
            const { joueur } = await creer(kv, 'Raf');
            await appeler(worker, kv, 'DELETE', '/api/joueurs/' + joueur.id);
            assert.equal((await appeler(worker, kv, 'GET', '/api/etat?id=abc')).body.state.tournament.name, 'Les potes');
        });
    });

    describe('PUT /joueurs — remplacement de toute la liste', () => {
        const fiches = [{ id: 'j-aa', nom: 'Alice', elo: 1500 }, { id: 'j-bb', nom: 'Bob', elo: null }];

        test('remplace la liste (restauration d\'une sauvegarde)', async () => {
            const kv = fauxKV();
            const r = await appeler(worker, kv, 'PUT', '/api/joueurs', { baseVersion: 0, joueurs: fiches });
            assert.equal(r.status, 200);
            assert.deepEqual((await appeler(worker, kv, 'GET', '/api/joueurs')).body.joueurs, fiches);
        });

        test('version périmée : 409 avec la liste courante', async () => {
            const kv = fauxKV();
            await creer(kv, 'Vince');
            const r = await appeler(worker, kv, 'PUT', '/api/joueurs', { baseVersion: 0, joueurs: fiches });
            assert.equal(r.status, 409);
            assert.equal(r.body.joueurs[0].nom, 'Vince');
        });

        const invalides = [
            ['pas un tableau', { joueurs: { j: 1 } }],
            ['une fiche sans identifiant', { joueurs: [{ nom: 'A' }] }],
            ['un identifiant hors motif', { joueurs: [{ id: 'MAJUSCULE', nom: 'A' }] }],
            ['deux fiches sous le même renvoi', { joueurs: [{ id: 'j-a', nom: 'A' }, { id: 'j-a', nom: 'B' }] }],
            ['un nom vide', { joueurs: [{ id: 'j-a', nom: '  ' }] }],
            ['un Elo non numérique', { joueurs: [{ id: 'j-a', nom: 'A', elo: 'fort' }] }],
        ];
        for (const [nom, corps] of invalides) {
            test(`refuse ${nom} (400)`, async () => {
                const kv = fauxKV();
                const r = await appeler(worker, kv, 'PUT', '/api/joueurs', { baseVersion: 0, ...corps });
                assert.equal(r.status, 400);
                assert.equal(kv.donnees.size, 0);
            });
        }
    });

    describe('routage', () => {
        test('GET /joueurs/<id> renvoie une seule fiche', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf', 1200);
            const r = await appeler(worker, kv, 'GET', '/api/joueurs/' + joueur.id);
            assert.deepEqual(r.body.joueur, { id: joueur.id, nom: 'Raf', elo: 1200 });
        });

        test('une méthode non gérée répond 405', async () => {
            const kv = fauxKV();
            const { joueur } = await creer(kv, 'Raf');
            assert.equal((await appeler(worker, kv, 'DELETE', '/api/joueurs')).status, 405);
            assert.equal((await appeler(worker, kv, 'POST', '/api/joueurs/' + joueur.id, {})).status, 405);
        });

        test('un chemin plus profond n\'existe pas', async () => {
            assert.equal((await appeler(worker, fauxKV(), 'GET', '/api/joueurs/j-aa/elo')).status, 404);
        });

        test('la pré-requête CORS annonce PATCH et DELETE', async () => {
            const r = await appeler(worker, fauxKV(), 'OPTIONS', '/api/joueurs/j-aa');
            for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
                assert.match(r.headers.get('Access-Control-Allow-Methods'), new RegExp(m));
            }
        });

        test('les joueurs vivent hors des tournois : la clé n\'apparaît pas dans /tournois', async () => {
            const kv = fauxKV({ 'tournament:abc': enveloppe(1, etat('Les potes', 4)) });
            await creer(kv, 'Raf');
            assert.deepEqual([...kv.donnees.keys()].sort(), ['players', 'tournament:abc']);
            assert.equal((await appeler(worker, kv, 'GET', '/api/tournois')).body.tournaments.length, 1);
        });
    });
});

describe('GET /tournois — la liste', () => {
    test('résume chaque tournoi : id, nom, écran, nombre de partants', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(1, etat('Les potes', 4)) });
        const r = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body.tournaments, [{
            id: 'abc',
            name: 'Les potes',
            screen: 'screen-tournament',
            players: 4,
            updatedAt: '2026-01-01T00:00:00.000Z',
        }]);
        assert.equal(r.body.complete, true);
    });

    test('les tournois sans partant inscrit sont masqués', async () => {
        const kv = fauxKV({
            'tournament:vide': enveloppe(1, etat('Abandonné', 0)),
            'tournament:plein': enveloppe(1, etat('Vivant', 3)),
        });
        const r = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['plein']);
    });

    test('les plus récemment modifiés en premier', async () => {
        const kv = fauxKV({
            'tournament:vieux': enveloppe(1, etat('Vieux', 2), '2026-01-01T00:00:00.000Z'),
            'tournament:recent': enveloppe(1, etat('Récent', 2), '2026-06-01T00:00:00.000Z'),
            'tournament:moyen': enveloppe(1, etat('Moyen', 2), '2026-03-01T00:00:00.000Z'),
        });
        const r = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['recent', 'moyen', 'vieux']);
    });

    test('une clé encore listée mais déjà supprimée ne réapparaît pas', async () => {
        // list() est mis en cache jusqu'à 60 s côté Cloudflare.
        const kv = fauxKV({ 'tournament:present': enveloppe(1, etat('Là', 2)) });
        kv.clesFantomes.add('tournament:supprime');
        const r = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['present']);
    });

    test('la clé historique sans préfixe n\'est pas listée', async () => {
        const kv = fauxKV({
            tournament: enveloppe(1, etat('Historique', 2)),
            'tournament:abc': enveloppe(1, etat('Moderne', 2)),
        });
        const r = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['abc']);
    });

    test('aucun tournoi : liste vide, pas d\'erreur', async () => {
        const r = await appeler(worker, fauxKV(), 'GET', '/api/tournois');
        assert.deepEqual(r.body.tournaments, []);
    });

    test('POST sur /tournois n\'est pas une écriture d\'état (404)', async () => {
        const r = await appeler(worker, fauxKV(), 'POST', '/api/tournois', { baseVersion: 0, state: etat('X') });
        assert.equal(r.status, 404);
    });

    test('/tournaments reste servi : un onglet resté sur l\'ancienne page l\'appelle', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(1, etat('Les potes', 4)) });
        const ancienne = await appeler(worker, kv, 'GET', '/tournaments');
        const nouvelle = await appeler(worker, kv, 'GET', '/api/tournois');
        assert.equal(ancienne.status, 200);
        assert.deepEqual(ancienne.body, nouvelle.body);
    });
});
