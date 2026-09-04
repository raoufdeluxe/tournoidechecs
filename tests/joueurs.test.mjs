// Liste de joueurs réutilisables, stockée hors des tournois.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chargerApp } from './aide/app.mjs';

const MOTIF_ID = /^[a-z0-9-]{1,64}$/; // celui qu'exige le Worker

const reponse = (status, corps) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => corps,
});

/**
 * Faux serveur de fiches : il tient réellement la liste et applique création,
 * modification et suppression comme le Worker. `app.requetes` garde la trace
 * des appels, `app.serveur` l'état vu du serveur.
 */
async function appAvecFiches(fiches = [], { version = 1, panne = null } = {}) {
    const etat = { joueurs: fiches.map(f => ({ ...f })), version };
    const requetes = [];
    let compteur = 0;

    const app = chargerApp({
        fetch: async (url, init) => {
            const methode = (init && init.method) || 'GET';
            const chemin = String(url).replace(/^https?:\/\/[^/]*/, '');
            const corps = init && init.body ? JSON.parse(init.body) : null;
            // Un vrai fetch re-parse du JSON : sans cette copie, l'app partagerait
            // les tableaux du serveur et les tests mentiraient.
            const copie = (payload) => JSON.parse(JSON.stringify(payload));
            const ok = (payload, status = 200) => ({ ok: true, status, json: async () => copie(payload) });
            const erreur = (status, payload = {}) => ({ ok: false, status, json: async () => copie(payload) });

            if (chemin.startsWith('/api/joueurs')) {
                requetes.push({ methode, chemin, corps });
                // La panne ne frappe que les écritures : la liste se charge quand même.
                if (panne && methode !== 'GET') return erreur(panne, { error: 'panne simulée' });

                const id = chemin.split('/')[3];

                if (methode === 'GET' && !id) {
                    return ok({ version: etat.version, updatedAt: null, joueurs: etat.joueurs });
                }
                if (methode === 'POST') {
                    const nom = String(corps.nom || '').trim();
                    if (etat.joueurs.some(j => j.nom.toLowerCase() === nom.toLowerCase())) {
                        return erreur(409, { error: 'Ce joueur existe déjà' });
                    }
                    const joueur = { id: 'j-serveur' + (++compteur), nom, elo: corps.elo == null ? null : corps.elo };
                    etat.joueurs.push(joueur);
                    etat.version++;
                    return ok({ version: etat.version, joueur }, 201);
                }
                if (methode === 'PATCH') {
                    const i = etat.joueurs.findIndex(j => j.id === id);
                    if (i === -1) return erreur(404, { error: 'Joueur introuvable' });
                    const joueur = { ...etat.joueurs[i] };
                    if (corps.nom !== undefined) joueur.nom = corps.nom;
                    if (corps.elo !== undefined) joueur.elo = corps.elo;
                    etat.joueurs[i] = joueur;
                    etat.version++;
                    return ok({ version: etat.version, joueur });
                }
                if (methode === 'DELETE') {
                    const i = etat.joueurs.findIndex(j => j.id === id);
                    if (i === -1) return erreur(404, { error: 'Joueur introuvable' });
                    etat.joueurs.splice(i, 1);
                    etat.version++;
                    return ok({ version: etat.version, deleted: true });
                }
                if (methode === 'PUT') {
                    if (corps.baseVersion !== etat.version) {
                        return erreur(409, { version: etat.version, joueurs: etat.joueurs });
                    }
                    etat.joueurs = corps.joueurs;
                    etat.version++;
                    return ok({ version: etat.version });
                }
                return erreur(405);
            }

            if (chemin.startsWith('/api/tournois')) return ok({ tournaments: [], complete: true });
            return ok({ version: 0, state: null });
        },
    });

    await app.pret();
    app.requetes = requetes;
    app.serveur = etat;
    return app;
}

describe('resolveJoueursDuTournoi — le nom suit partout', () => {
    function appAvec(fiches, partants) {
        const app = chargerApp();
        app.set('joueurs', fiches);
        app.set('tournoi.players', partants);
        return app;
    }

    test('le nom et l\'Elo viennent de la fiche, pas du tournoi', () => {
        const app = appAvec(
            [{ id: 'j-aa', nom: 'Raphael', elo: 1520 }],
            [{ id: 0, ref: 'j-aa', name: 'RAF', elo: 1200 }]);
        app.ev('resolveJoueursDuTournoi()');
        const partant = app.json('tournoi.players')[0];
        assert.equal(partant.name, 'Raphael', 'un renommage se voit dans les tournois passés');
        assert.equal(partant.elo, 1520);
        assert.equal(partant.absent, false);
    });

    test('renommer la fiche puis résoudre met à jour le tournoi', () => {
        const app = appAvec(
            [{ id: 'j-aa', nom: 'RAF', elo: null }],
            [{ id: 0, ref: 'j-aa', name: 'RAF', elo: null }]);
        app.ev('joueurs[0].nom = "Raphael"; resolveJoueursDuTournoi();');
        assert.equal(app.json('tournoi.players')[0].name, 'Raphael');
    });

    test('fiche supprimée : le nom recopié sert de repli, et le partant est signalé', () => {
        const app = appAvec([], [{ id: 0, ref: 'j-disparu', name: 'RAF', elo: null }]);
        app.ev('resolveJoueursDuTournoi()');
        const partant = app.json('tournoi.players')[0];
        assert.equal(partant.name, 'RAF', 'on n\'efface pas un nom qu\'on a encore');
        assert.equal(partant.absent, true);
    });

    test('fiche supprimée et aucun nom recopié : mention explicite', () => {
        const app = appAvec([], [{ id: 0, ref: 'j-disparu', name: '', elo: null }]);
        app.ev('resolveJoueursDuTournoi()');
        assert.equal(app.json('tournoi.players')[0].name, 'Joueur supprimé');
    });

    test('un tournoi d\'avant les fiches n\'est pas touché', () => {
        const app = appAvec([{ id: 'j-aa', nom: 'Raphael', elo: 1520 }],
            [{ id: 0, name: 'Ancien partant', elo: 1000 }]);
        app.ev('resolveJoueursDuTournoi()');
        const partant = app.json('tournoi.players')[0];
        assert.equal(partant.name, 'Ancien partant');
        assert.equal(partant.elo, 1000);
    });

    test('renvoie true seulement quand quelque chose a changé', () => {
        const app = appAvec([{ id: 'j-aa', nom: 'RAF', elo: null }],
            [{ id: 0, ref: 'j-aa', name: 'RAF', elo: null }]);
        assert.equal(app.ev('resolveJoueursDuTournoi()'), false);
        app.ev('joueurs[0].nom = "Raphael";');
        assert.equal(app.ev('resolveJoueursDuTournoi()'), true);
    });
});

describe('loadJoueurs', () => {
    test('récupère la liste et retient sa version', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: 1500 }], { version: 4 });
        assert.equal(app.json('joueurs').length, 1);
        assert.equal(app.ev('joueursVersion'), 4);
    });

    test('serveur injoignable : liste vide, l\'app continue', async () => {
        const app = chargerApp({ fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        assert.equal(await app.ev('loadJoueurs()'), false);
        assert.deepEqual(app.json('joueurs'), []);
    });

    test('les menus d\'inscription sont redessinés une fois les fiches arrivées', async () => {
        // Sans cela, l'écran d'inscription resterait sur la liste vide dessinée
        // au chargement de la page, avant la réponse du serveur.
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: 1500 }]);
        app.ev('document.getElementById("player-count").value = "4";');
        app.ev('document.getElementById("player-inputs").children.length = 0;');
        await app.ev('loadEtat()');

        const emplacements = app.ev('document.getElementById("player-inputs").children');
        assert.equal(app.ev('document.getElementById("player-inputs").children.length'), 4);
        assert.match(app.ev('document.getElementById("player-inputs").children[0].innerHTML'), /Alice/);
    });

    test('les fiches sont chargées avant le tournoi', async () => {
        const ordre = [];
        const app = chargerApp({
            fetch: async (url) => {
                ordre.push(url.includes('/api/joueurs') ? 'joueurs' : 'tournoi');
                if (url.includes('/api/joueurs')) return reponse(200, { version: 1, joueurs: [] });
                return reponse(200, { version: 0, state: null });
            },
        });
        await app.pret();
        assert.equal(ordre[0], 'joueurs', 'sinon le tournoi s\'afficherait avec des noms périmés');
    });
});

describe('addJoueur — POST /joueurs', () => {
    test('la fiche est créée par le serveur, qui lui donne son identifiant', async () => {
        const app = await appAvecFiches([], { version: 2 });
        const fiche = await app.ev('addJoueur("Vince", 1450)');
        const requete = app.requetes.at(-1);
        assert.equal(requete.methode, 'POST');
        assert.equal(requete.chemin, '/api/joueurs');
        assert.deepEqual(requete.corps, { nom: 'Vince', elo: 1450 });
        assert.deepEqual(app.json('joueurs'), [{ id: 'j-serveur1', nom: 'Vince', elo: 1450 }]);
        assert.equal(app.ev('joueursVersion'), 3, 'la version renvoyée fait foi');
    });

    test('le nom est nettoyé et l\'Elo optionnel', async () => {
        const app = await appAvecFiches([]);
        await app.ev('addJoueur("  Vince  ")');
        assert.deepEqual(app.requetes.at(-1).corps, { nom: 'Vince', elo: null });
        assert.equal(app.json('joueurs')[0].elo, null);
    });

    test('un nom vide ne part même pas au serveur', async () => {
        const app = await appAvecFiches([]);
        assert.equal(await app.ev('addJoueur("   ")'), null);
        assert.deepEqual(app.requetes.filter(r => r.methode === 'POST'), []);
    });

    test('homonyme refusé par le serveur : message et aucune fiche locale', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Vince', elo: null }]);
        assert.equal(await app.ev('addJoueur("vince")'), null);
        assert.match(app.alertes.at(-1), /déjà dans la liste/);
        assert.equal(app.json('joueurs').length, 1);
    });

    test('serveur en panne : rien n\'est gardé en local', async () => {
        const app = await appAvecFiches([], { panne: 500 });
        assert.equal(await app.ev('addJoueur("Vince")'), null);
        assert.deepEqual(app.json('joueurs'), [], 'pas de fiche fantôme côté navigateur');
        assert.match(app.alertes.at(-1), /Ajout refusé/);
    });

    test('serveur injoignable : prévenu, rien de gardé', async () => {
        const app = chargerApp({ fetch: async () => { throw new Error('hors ligne'); } });
        await app.pret();
        assert.equal(await app.ev('addJoueur("Vince")'), null);
        assert.match(app.alertes.at(-1), /injoignable/);
    });
});

describe('updateJoueur — PATCH /joueurs/<id>', () => {
    test('le nom part seul, l\'Elo est préservé', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Raf', elo: 1200 }]);
        await app.ev('updateJoueur("j-aa", { nom: "Raphael" })');
        const requete = app.requetes.at(-1);
        assert.equal(requete.methode, 'PATCH');
        assert.equal(requete.chemin, '/api/joueurs/j-aa');
        assert.deepEqual(app.json('joueurs')[0], { id: 'j-aa', nom: 'Raphael', elo: 1200 });
    });

    test('l\'Elo se modifie et s\'efface', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Raf', elo: 1200 }]);
        await app.ev('updateJoueur("j-aa", { elo: 1610 })');
        assert.equal(app.json('joueurs')[0].elo, 1610);
        await app.ev('updateJoueur("j-aa", { elo: null })');
        assert.equal(app.json('joueurs')[0].elo, null);
    });

    test('fiche disparue entre-temps : la liste est rechargée', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Raf', elo: null }]);
        app.serveur.joueurs = [];
        assert.equal(await app.ev('updateJoueur("j-aa", { nom: "Raphael" })'), null);
        assert.match(app.alertes.at(-1), /n'existe plus/);
        assert.deepEqual(app.json('joueurs'), []);
    });

    test('refus du serveur : la fiche locale n\'est pas modifiée', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Raf', elo: null }], { panne: 409 });
        assert.equal(await app.ev('updateJoueur("j-aa", { nom: "Vince" })'), null);
        assert.equal(app.json('joueurs')[0].nom, 'Raf');
    });
});

describe('replaceJoueurs — PUT /joueurs (restauration)', () => {
    test('envoie la liste entière avec la version connue', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }], { version: 3 });
        app.set('globalThis.__liste', [{ id: 'j-aa', nom: 'Alice', elo: 1500 }, { id: 'j-bb', nom: 'Bob', elo: null }]);
        assert.equal(await app.ev('replaceJoueurs(__liste)'), true);
        const requete = app.requetes.at(-1);
        assert.equal(requete.methode, 'PUT');
        assert.equal(requete.corps.baseVersion, 3);
        assert.deepEqual(app.serveur.joueurs.map(j => j.nom), ['Alice', 'Bob']);
    });

    test('409 : la liste est rechargée et l\'utilisateur prévenu, sans écrasement', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }], { version: 1 });
        app.ev('joueursVersion = 0;'); // le serveur a bougé depuis
        app.set('globalThis.__liste', [{ id: 'j-bb', nom: 'Bob', elo: null }]);
        assert.equal(await app.ev('replaceJoueurs(__liste)'), false);
        assert.match(app.alertes.at(-1), /modifiée sur un autre appareil/);
        assert.deepEqual(app.json('joueurs').map(j => j.nom), ['Alice'], 'on repart de la liste du serveur');
    });
});

describe('removeFiche — DELETE /api/joueurs/<id>', () => {
    test('la fiche part du serveur et de la liste locale', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        assert.equal(await app.ev('removeFiche("j-aa")'), true);
        assert.equal(app.requetes.at(-1).chemin, '/api/joueurs/j-aa');
        assert.deepEqual(app.json('joueurs'), []);
        assert.deepEqual(app.serveur.joueurs, []);
    });

    test('le tournoi ouvert garde le nom du partant, marqué absent', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        app.set('tournoi.players', [{ id: 0, ref: 'j-aa', name: 'Alice', elo: null }]);
        await app.ev('removeFiche("j-aa")');
        app.ev('resolveJoueursDuTournoi()');
        const partant = app.json('tournoi.players')[0];
        assert.equal(partant.name, 'Alice');
        assert.equal(partant.absent, true);
    });

    test('échec serveur : la fiche reste dans la liste', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }], { panne: 500 });
        assert.equal(await app.ev('removeFiche("j-aa")'), false);
        assert.deepEqual(app.json('joueurs').map(j => j.nom), ['Alice']);
        assert.match(app.alertes.at(-1), /Suppression refusée/);
    });

    test('fiche inconnue : rien à faire', async () => {
        const app = await appAvecFiches([]);
        assert.equal(await app.ev('removeFiche("j-fantome")'), false);
        assert.deepEqual(app.requetes.filter(r => r.methode === 'DELETE'), []);
    });
});

describe('buildOptionsJoueurs — le menu d\'un emplacement', () => {
    test('liste les fiches, avec l\'Elo entre parenthèses', () => {
        const app = chargerApp();
        app.set('joueurs', [{ id: 'j-aa', nom: 'Alice', elo: 1500 }, { id: 'j-bb', nom: 'Bob', elo: null }]);
        const html = app.appel('buildOptionsJoueurs', '');
        assert.match(html, /value="j-aa"[^>]*>Alice \(1500\)/);
        assert.match(html, /value="j-bb"[^>]*>Bob</);
        assert.doesNotMatch(html, /Bob \(/);
    });

    test('marque le joueur déjà choisi', () => {
        const app = chargerApp();
        app.set('joueurs', [{ id: 'j-aa', nom: 'Alice', elo: null }, { id: 'j-bb', nom: 'Bob', elo: null }]);
        const html = app.appel('buildOptionsJoueurs', 'j-bb');
        assert.match(html, /value="j-bb" selected/);
        assert.doesNotMatch(html, /value="j-aa" selected/);
    });

    test('propose toujours de créer un joueur', () => {
        const app = chargerApp();
        assert.match(app.appel('buildOptionsJoueurs', ''), /Nouveau joueur/);
    });

    test('un nom piégé ne s\'injecte pas dans la page', () => {
        const app = chargerApp();
        app.set('joueurs', [{ id: 'j-aa', nom: '<img src=x onerror="window.__XSS=1">', elo: null }]);
        const html = app.appel('buildOptionsJoueurs', '');
        assert.doesNotMatch(html, /<img/);
        assert.match(html, /&lt;img/);
    });
});

describe('inscription d\'un tournoi à partir des fiches', () => {
    async function appInscription(fiches, refsChoisies) {
        const app = await appAvecFiches(fiches);
        app.definirElements('.player-ref', refsChoisies.map((value, i) => ({ value, dataset: { index: String(i) } })));
        return app;
    }

    const quatreFiches = [
        { id: 'j-aa', nom: 'Vince', elo: 1500 },
        { id: 'j-bb', nom: 'Raf', elo: null },
        { id: 'j-cc', nom: 'Waloo', elo: 1300 },
        { id: 'j-dd', nom: 'Damien', elo: null },
    ];

    test('les partants ne gardent qu\'un renvoi, plus le nom en repli', async () => {
        const app = await appInscription(quatreFiches, ['j-aa', 'j-bb', 'j-cc', 'j-dd']);
        await app.ev('startTournoi()');
        const partants = app.json('tournoi.players');
        assert.deepEqual(partants.map(p => p.ref), ['j-aa', 'j-bb', 'j-cc', 'j-dd']);
        assert.deepEqual(partants.map(p => p.name), ['Vince', 'Raf', 'Waloo', 'Damien']);
        assert.deepEqual(partants.map(p => p.elo), [1500, null, 1300, null]);
        assert.deepEqual(partants.map(p => p.id), [0, 1, 2, 3], 'l\'index reste la clé des matchs');
    });

    test('le calendrier est bien généré derrière', async () => {
        const app = await appInscription(quatreFiches, ['j-aa', 'j-bb', 'j-cc', 'j-dd']);
        await app.ev('startTournoi()');
        assert.equal(app.json('tournoi.matches').length, 12);
    });

    test('un emplacement vide bloque le départ', async () => {
        const app = await appInscription(quatreFiches, ['j-aa', '', 'j-cc', 'j-dd']);
        await app.ev('startTournoi()');
        assert.match(app.alertes.at(-1), /Choisis un joueur/);
        assert.deepEqual(app.json('tournoi.players'), []);
    });

    test('le même joueur deux fois est refusé, avec son nom', async () => {
        const app = await appInscription(quatreFiches, ['j-aa', 'j-aa', 'j-cc', 'j-dd']);
        await app.ev('startTournoi()');
        assert.match(app.alertes.at(-1), /Vince.*deux places/s);
        assert.deepEqual(app.json('tournoi.players'), []);
    });
});


describe('un partant dont la fiche a disparu est signalé', () => {
    test('le classement le marque, sans perdre son nom', async () => {
        const app = await appAvecFiches([{ id: 'j-aa', nom: 'Alice', elo: null }]);
        app.set('tournoi.players', [
            { id: 0, ref: 'j-aa', name: 'Alice', elo: null },
            { id: 1, ref: 'j-partie', name: 'Bob', elo: null },
        ]);
        app.ev('resolveJoueursDuTournoi(); renderClassement();');

        // Le classement doit dire que Bob n'a plus de fiche, et pourquoi ça compte.
        const html = app.ev('document.getElementById("standings-body").innerHTML');
        assert.match(html, /Bob[\s\S]{0,200}fiche supprimée/, 'Bob est signalé');
        assert.doesNotMatch(html, /Alice[\s\S]{0,200}fiche supprimée/, 'Alice en a toujours une');
        assert.match(html, /ne suivra plus les renommages/, 'et on explique pourquoi');
    });

    test('un tournoi d\'avant les fiches n\'est pas marqué', async () => {
        const app = await appAvecFiches([]);
        app.set('tournoi.players', [{ id: 0, name: 'Ancien', elo: null }]);
        app.ev('resolveJoueursDuTournoi(); renderClassement();');
        assert.doesNotMatch(app.ev('document.getElementById("standings-body").innerHTML'), /fiche supprimée/);
    });
});
