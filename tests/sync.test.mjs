// Sauvegarde partagée : envois sérialisés, réessai hors-ligne, conflits.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';
import { joueurs } from './aide/tournoi.mjs';

/** Réponse HTTP factice, à la façon de fetch. */
const reponse = (status, corps) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
});

/**
 * Monte l'app avec un faux réseau scriptable.
 * `reponses.get` sert le chargement initial, `reponses.post` chaque envoi.
 */
async function appReseau({ get = reponse(200, { version: 0, updatedAt: null, state: null }), post } = {}) {
    let prochaines = Array.isArray(post) ? [...post] : null;
    const app = chargerApp({
        fetch: async (url, init) => {
            if (!init || init.method !== 'POST') {
                if (get instanceof Error) throw get;
                return get;
            }
            const suivante = prochaines ? prochaines.shift() : post;
            if (suivante instanceof Error) throw suivante;
            return suivante ?? reponse(200, { version: 1, updatedAt: '2026-01-01T00:00:00.000Z' });
        },
    });
    await app.pret();
    app.set('tournoi.players', joueurs(['A', 'B']));
    app.oublierAppels();
    return app;
}

const envois = (app) => app.appelsFetch.filter(a => a.init && a.init.method === 'POST');
const corpsEnvoye = (appel) => JSON.parse(appel.init.body);

describe('saveEtat', () => {
    test('écrit une copie locale immédiate, même sans réseau', async () => {
        const app = await appReseau({ post: new Error('hors ligne') });
        app.ev('saveEtat()');
        await app.attendreSync();
        const cle = app.ev('storageKey(idTournoi)');
        const local = JSON.parse(app.stockage.get(cle));
        assert.deepEqual(local.tournament.players.map(p => p.name), ['A', 'B']);
    });

    test('l\'envoi porte la version connue du serveur', async () => {
        const app = await appReseau({ post: reponse(200, { version: 4 }) });
        app.ev('remoteVersion = 3; saveEtat();');
        await app.attendreSync();
        assert.equal(corpsEnvoye(envois(app)[0]).baseVersion, 3);
        assert.equal(app.ev('remoteVersion'), 4, 'la version du serveur fait foi ensuite');
    });

    test('le statut passe à « enregistré » quand l\'envoi aboutit', async () => {
        const app = await appReseau();
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'saved');
    });
});

describe('envois sérialisés', () => {
    test('les saisies faites pendant un envoi sont fusionnées en un seul suivant', async () => {
        let debloquer;
        const enAttente = new Promise(res => { debloquer = res; });
        const app = chargerApp({
            fetch: async (url, init) => {
                if (!init || init.method !== 'POST') return reponse(200, { version: 0, state: null });
                await enAttente;
                return reponse(200, { version: 1 });
            },
        });
        await app.pret();
        app.set('tournoi.players', joueurs(['A', 'B']));
        app.oublierAppels();

        app.ev('saveEtat()');          // part tout de suite
        app.ev('saveEtat(); saveEtat(); saveEtat();'); // s'accumulent pendant le vol
        debloquer();
        await app.attendreSync();

        assert.equal(envois(app).length, 2, 'un envoi en vol + un seul rattrapage');
    });

    test('l\'état poussé est relu au moment de l\'envoi, jamais figé', async () => {
        const app = await appReseau();
        app.ev('saveEtat()');
        await app.attendreSync();
        app.ev('tournoi.name = "Renommé"; saveEtat();');
        await app.attendreSync();
        assert.equal(corpsEnvoye(envois(app).at(-1)).state.tournament.name, 'Renommé');
    });
});

describe('hors ligne', () => {
    test('réseau injoignable : statut « hors ligne » et réessai programmé', async () => {
        const app = await appReseau({ post: new Error('hors ligne') });
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'offline');
        assert.deepEqual(app.delaisEnAttente(), [1000]);
    });

    test('le back-off double à chaque échec, plafonné à 30 s', async () => {
        const app = await appReseau({ post: new Error('hors ligne') });
        const observes = [];
        app.ev('saveEtat()');
        await app.attendreSync();
        for (let i = 0; i < 8; i++) {
            observes.push(app.delaisEnAttente()[0]);
            app.avancerTemps();
            await app.attendreSync();
        }
        assert.deepEqual(observes.slice(0, 5), [1000, 2000, 4000, 8000, 16000]);
        assert.ok(observes.every(d => d <= 30000), 'jamais au-delà de 30 s');
        assert.equal(observes.at(-1), 30000, 'le plafond finit par être atteint');
    });

    test('un seul réessai est armé à la fois', async () => {
        const app = await appReseau({ post: new Error('hors ligne') });
        app.ev('saveEtat(); saveEtat(); saveEtat();');
        await app.attendreSync();
        assert.equal(app.delaisEnAttente().length, 1);
    });

    test('une erreur HTTP (5xx) déclenche aussi le réessai', async () => {
        const app = await appReseau({ post: reponse(500, {}) });
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'offline');
        assert.deepEqual(app.delaisEnAttente(), [1000]);
    });

    test('le retour du réseau relance l\'envoi et remet le délai à 1 s', async () => {
        const app = await appReseau({ post: [new Error('hors ligne'), reponse(200, { version: 1 })] });
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(envois(app).length, 1);

        app.emettre('online');
        await app.attendreSync();
        assert.equal(envois(app).length, 2);
        assert.equal(app.ev('retryDelay'), 1000);
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'saved');
    });

    test('fermer l\'onglet avec des saisies en attente déclenche l\'avertissement', async () => {
        const app = await appReseau({ post: new Error('hors ligne') });
        app.ev('saveEtat()');
        await app.attendreSync();
        let prevenu = false;
        app.emettre('beforeunload', { preventDefault: () => { prevenu = true; } });
        assert.equal(prevenu, true);
    });
});

describe('conflit (409)', () => {
    test('le bandeau s\'ouvre au lieu d\'écraser silencieusement', async () => {
        const distant = { version: 9, state: { tournament: { name: 'Autre appareil', players: [{ id: 0, name: 'X', elo: null }] }, screen: 'screen-config' } };
        const app = await appReseau({ post: reponse(409, distant) });
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'conflict');
        assert.equal(app.ev('document.getElementById("sync-conflict").hidden'), false);
    });

    test('un conflit n\'arme pas de réessai : c\'est à l\'utilisateur de trancher', async () => {
        const distant = { version: 9, state: { tournament: { name: 'Autre', players: [{ id: 0, name: 'X', elo: null }] } } };
        const app = await appReseau({ post: reponse(409, distant) });
        app.ev('saveEtat()');
        await app.attendreSync();
        assert.deepEqual(app.delaisEnAttente(), []);
    });
});

describe('loadEtat', () => {
    test('reprend l\'état partagé et retient sa version', async () => {
        const distant = {
            version: 12,
            updatedAt: '2026-01-01T00:00:00.000Z',
            state: { screen: 'screen-config', tournament: { name: 'Repris', players: joueurs(['A', 'B']) } },
        };
        const app = chargerApp({ fetch: async () => reponse(200, distant) });
        assert.equal(await app.ev('loadEtat()'), true);
        assert.equal(app.ev('tournoi.name'), 'Repris');
        assert.equal(app.ev('remoteVersion'), 12);
    });

    test('serveur injoignable : repli sur la copie locale', async () => {
        const app = chargerApp({ fetch: async () => { throw new Error('hors ligne'); } });
        const cle = app.ev('storageKey(idTournoi)');
        app.stockage.set(cle, JSON.stringify({
            screen: 'screen-config',
            tournament: { name: 'Copie locale', players: joueurs(['A', 'B']) },
        }));
        assert.equal(await app.ev('loadEtat()'), true);
        assert.equal(app.ev('tournoi.name'), 'Copie locale');
        assert.equal(app.ev('document.getElementById("sync-status").dataset.state'), 'offline');
    });

    test('rien nulle part : l\'app reste sur l\'écran d\'inscription', async () => {
        const app = chargerApp({ fetch: async () => reponse(200, { version: 0, updatedAt: null, state: null }) });
        assert.equal(await app.ev('loadEtat()'), false);
        assert.deepEqual(app.json('tournoi.players'), []);
    });

    test('un état sans partant n\'écrase pas l\'app', async () => {
        const app = chargerApp({ fetch: async () => reponse(200, { version: 3, state: { tournament: { players: [] } } }) });
        assert.equal(await app.ev('loadEtat()'), false);
    });

    test('ancien format sans enveloppe : encore accepté', async () => {
        const brut = { screen: 'screen-config', tournament: { name: 'Ancien', players: joueurs(['A', 'B']) } };
        const app = chargerApp({ fetch: async () => reponse(200, brut) });
        assert.equal(await app.ev('loadEtat()'), true);
        assert.equal(app.ev('tournoi.name'), 'Ancien');
    });
});
