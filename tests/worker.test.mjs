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

    test('une méthode non gérée sur /state répond 405', async () => {
        const r = await appeler(worker, fauxKV(), 'PUT', '/state?id=abc');
        assert.equal(r.status, 405);
    });

    test('la pré-requête CORS est acceptée et annonce les méthodes', async () => {
        const r = await appeler(worker, fauxKV(), 'OPTIONS', '/state?id=abc');
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*');
        for (const m of ['GET', 'POST', 'DELETE']) {
            assert.match(r.headers.get('Access-Control-Allow-Methods'), new RegExp(m));
        }
    });

    test('toute réponse porte les en-têtes CORS', async () => {
        for (const [methode, chemin] of [['GET', '/state?id=abc'], ['GET', '/nawak'], ['PUT', '/state?id=abc']]) {
            const r = await appeler(worker, fauxKV(), methode, chemin);
            assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*', `${methode} ${chemin}`);
        }
    });
});

describe('validation de l\'identifiant', () => {
    const invalides = ['MAJUSCULES', 'avec espace', 'accentué', 'point.virgule', 'a'.repeat(65), 'slash/dedans'];
    for (const id of invalides) {
        test(`« ${id.slice(0, 20)} » est refusé (400)`, async () => {
            const r = await appeler(worker, fauxKV(), 'GET', '/state?id=' + encodeURIComponent(id));
            assert.equal(r.status, 400);
        });
    }

    for (const id of ['abc', 'tournoi-des-potes', 'a', '0', 'a'.repeat(64)]) {
        test(`« ${id.slice(0, 20)} » est accepté`, async () => {
            const r = await appeler(worker, fauxKV(), 'GET', '/state?id=' + id);
            assert.equal(r.status, 200);
        });
    }

    test('une requête sans id retombe sur la clé historique', async () => {
        const kv = fauxKV({ tournament: enveloppe(7, etat('Ancien')) });
        const r = await appeler(worker, kv, 'GET', '/state');
        assert.equal(r.body.version, 7);
        assert.equal(r.body.state.tournament.name, 'Ancien');
    });
});

describe('GET /state', () => {
    test('tournoi inexistant : version 0 et état nul', async () => {
        const r = await appeler(worker, fauxKV(), 'GET', '/state?id=inconnu');
        assert.deepEqual(r.body, { version: 0, updatedAt: null, state: null });
    });

    test('tournoi existant : version, date et état', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(3, etat('Les potes')) });
        const r = await appeler(worker, kv, 'GET', '/state?id=abc');
        assert.equal(r.body.version, 3);
        assert.equal(r.body.state.tournament.name, 'Les potes');
    });

    test('ancien format (état nu, sans enveloppe) : relu en version 0', async () => {
        const kv = fauxKV({ 'tournament:abc': JSON.stringify(etat('Avant versionnage')) });
        const r = await appeler(worker, kv, 'GET', '/state?id=abc');
        assert.equal(r.body.version, 0);
        assert.equal(r.body.state.tournament.name, 'Avant versionnage');
    });

    test('valeur illisible en base : traitée comme un tournoi vide, pas comme une erreur', async () => {
        const kv = fauxKV({ 'tournament:abc': '{ceci n\'est pas du json' });
        const r = await appeler(worker, kv, 'GET', '/state?id=abc');
        assert.deepEqual(r.body, { version: 0, updatedAt: null, state: null });
    });
});

describe('POST /state — écriture versionnée', () => {
    test('première écriture : version 1 et date d\'enregistrement', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/state?id=abc',
            { baseVersion: 0, state: etat('Les potes') });
        assert.equal(r.status, 200);
        assert.equal(r.body.version, 1);
        assert.ok(Date.parse(r.body.updatedAt), 'updatedAt est une date ISO');
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Les potes');
    });

    test('écritures successives : la version s\'incrémente', async () => {
        const kv = fauxKV();
        for (const attendue of [1, 2, 3]) {
            const r = await appeler(worker, kv, 'POST', '/state?id=abc',
                { baseVersion: attendue - 1, state: etat('T') });
            assert.equal(r.body.version, attendue);
        }
    });

    test('version périmée : 409 avec l\'état courant, et rien n\'est écrasé', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(5, etat('Version serveur')) });
        const r = await appeler(worker, kv, 'POST', '/state?id=abc',
            { baseVersion: 2, state: etat('Ma version') });
        assert.equal(r.status, 409);
        assert.equal(r.body.version, 5);
        assert.equal(r.body.state.tournament.name, 'Version serveur',
            'le client reçoit de quoi arbitrer');
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Version serveur');
    });

    test('deux appareils partis de la même version : le second est refusé', async () => {
        const kv = fauxKV();
        await appeler(worker, kv, 'POST', '/state?id=abc', { baseVersion: 0, state: etat('A') });
        const second = await appeler(worker, kv, 'POST', '/state?id=abc', { baseVersion: 0, state: etat('B') });
        assert.equal(second.status, 409);
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'A');
    });

    test('corps sans baseVersion (ancien onglet) : accepté tel quel', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(5, etat('Serveur')) });
        const r = await appeler(worker, kv, 'POST', '/state?id=abc', etat('Ancien onglet'));
        assert.equal(r.status, 200);
        assert.equal(r.body.version, 6);
        assert.equal(JSON.parse(kv.donnees.get('tournament:abc')).state.tournament.name, 'Ancien onglet');
    });

    test('corps illisible : 400, rien n\'est écrit', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/state?id=abc', 'pas du json');
        assert.equal(r.status, 400);
        assert.equal(kv.donnees.size, 0);
    });

    test('identifiant invalide : refusé avant toute écriture', async () => {
        const kv = fauxKV();
        const r = await appeler(worker, kv, 'POST', '/state?id=NOPE', { baseVersion: 0, state: etat('X') });
        assert.equal(r.status, 400);
        assert.equal(kv.donnees.size, 0);
    });

    test('chaque tournoi vit sous sa propre clé', async () => {
        const kv = fauxKV();
        await appeler(worker, kv, 'POST', '/state?id=un', { baseVersion: 0, state: etat('Un') });
        await appeler(worker, kv, 'POST', '/state?id=deux', { baseVersion: 0, state: etat('Deux') });
        assert.deepEqual([...kv.donnees.keys()].sort(), ['tournament:deux', 'tournament:un']);
        const r = await appeler(worker, kv, 'GET', '/state?id=un');
        assert.equal(r.body.state.tournament.name, 'Un');
    });
});

describe('DELETE /state', () => {
    test('supprime le tournoi ; la relecture repart de zéro', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(2, etat('À jeter')) });
        const r = await appeler(worker, kv, 'DELETE', '/state?id=abc');
        assert.equal(r.status, 200);
        assert.deepEqual(r.body, { deleted: true });
        assert.equal((await appeler(worker, kv, 'GET', '/state?id=abc')).body.state, null);
    });

    test('supprimer un tournoi inexistant n\'est pas une erreur', async () => {
        assert.equal((await appeler(worker, fauxKV(), 'DELETE', '/state?id=fantome')).status, 200);
    });

    test('ne touche pas aux autres tournois', async () => {
        const kv = fauxKV({
            'tournament:abc': enveloppe(1, etat('À jeter')),
            'tournament:def': enveloppe(1, etat('À garder')),
        });
        await appeler(worker, kv, 'DELETE', '/state?id=abc');
        assert.deepEqual([...kv.donnees.keys()], ['tournament:def']);
    });
});

describe('GET /tournaments — la liste', () => {
    test('résume chaque tournoi : id, nom, écran, nombre de partants', async () => {
        const kv = fauxKV({ 'tournament:abc': enveloppe(1, etat('Les potes', 4)) });
        const r = await appeler(worker, kv, 'GET', '/tournaments');
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
        const r = await appeler(worker, kv, 'GET', '/tournaments');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['plein']);
    });

    test('les plus récemment modifiés en premier', async () => {
        const kv = fauxKV({
            'tournament:vieux': enveloppe(1, etat('Vieux', 2), '2026-01-01T00:00:00.000Z'),
            'tournament:recent': enveloppe(1, etat('Récent', 2), '2026-06-01T00:00:00.000Z'),
            'tournament:moyen': enveloppe(1, etat('Moyen', 2), '2026-03-01T00:00:00.000Z'),
        });
        const r = await appeler(worker, kv, 'GET', '/tournaments');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['recent', 'moyen', 'vieux']);
    });

    test('une clé encore listée mais déjà supprimée ne réapparaît pas', async () => {
        // list() est mis en cache jusqu'à 60 s côté Cloudflare.
        const kv = fauxKV({ 'tournament:present': enveloppe(1, etat('Là', 2)) });
        kv.clesFantomes.add('tournament:supprime');
        const r = await appeler(worker, kv, 'GET', '/tournaments');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['present']);
    });

    test('la clé historique sans préfixe n\'est pas listée', async () => {
        const kv = fauxKV({
            tournament: enveloppe(1, etat('Historique', 2)),
            'tournament:abc': enveloppe(1, etat('Moderne', 2)),
        });
        const r = await appeler(worker, kv, 'GET', '/tournaments');
        assert.deepEqual(r.body.tournaments.map(t => t.id), ['abc']);
    });

    test('aucun tournoi : liste vide, pas d\'erreur', async () => {
        const r = await appeler(worker, fauxKV(), 'GET', '/tournaments');
        assert.deepEqual(r.body.tournaments, []);
    });

    test('POST sur /tournaments n\'est pas une écriture d\'état (404)', async () => {
        const r = await appeler(worker, fauxKV(), 'POST', '/tournaments', { baseVersion: 0, state: etat('X') });
        assert.equal(r.status, 404);
    });
});
