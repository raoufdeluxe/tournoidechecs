// Liste de joueurs réutilisables, stockée hors des tournois.
//
// Un tournoi ne retient qu'un renvoi (`ref`) vers la fiche : renommer un joueur
// se répercute partout, y compris sur les tournois déjà joués. Le nom est tout
// de même recopié dans le tournoi, mais uniquement comme repli — la fiche fait
// foi dès qu'elle est joignable. Sans ce repli, un tournoi ouvert hors ligne,
// ou dont la fiche a été supprimée, n'afficherait plus que des cases vides.

let joueurs = [];        // [{ id, nom, elo }]
let joueursVersion = 0;
let joueursCharges = false;


const REF_NOUVEAU = '__nouveau__';
const NOM_JOUEUR_ABSENT = 'Joueur supprimé';

function getJoueur(ref) {
    return joueurs.find(j => j.id === ref) || null;
}

// --- Résolution dans un tournoi ---------------------------------------------

// Recopie nom et Elo depuis les fiches dans les partants du tournoi courant.
// Les tournois d'avant cette version n'ont pas de `ref` : on les laisse tels
// quels, leurs noms sont la seule source qui existe pour eux.
function resolveJoueursDuTournoi() {
    let change = false;
    for (const partant of tournoi.players || []) {
        if (!partant.ref) continue;
        const fiche = getJoueur(partant.ref);
        if (fiche) {
            if (partant.name !== fiche.nom || partant.elo !== fiche.elo) change = true;
            partant.name = fiche.nom;
            partant.elo = fiche.elo;
            partant.absent = false;
        } else if (!partant.name) {
            partant.name = NOM_JOUEUR_ABSENT;
            partant.absent = true;
            change = true;
        } else {
            partant.absent = true;
        }
    }
    return change;
}

// --- Serveur -----------------------------------------------------------------

async function loadJoueurs() {
    try {
        const res = await fetch(URL_JOUEURS);
        if (!res.ok) throw new Error(res.status);
        const data = await res.json();
        joueurs = Array.isArray(data.joueurs) ? data.joueurs : [];
        joueursVersion = typeof data.version === 'number' ? data.version : 0;
        joueursCharges = true;
        return true;
    } catch (e) {
        console.warn('Liste des joueurs indisponible :', e);
        return false;
    }
}

// Le corps d'erreur du Worker porte un message utilisable tel quel.
async function readMessageErreur(res, defaut) {
    const data = await res.json().catch(() => null);
    return (data && data.error) || defaut;
}

// --- Créer, modifier, supprimer une fiche ------------------------------------

// Le serveur attribue l'identifiant et refuse les homonymes : deux appareils
// qui ajoutent en même temps ne peuvent ni se marcher dessus ni créer un doublon.
async function addJoueur(nom, elo) {
    const propre = String(nom || '').trim();
    if (!propre) return null;

    let res;
    try {
        res = await fetch(URL_JOUEURS, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nom: propre, elo: elo == null ? null : elo })
        });
    } catch (e) {
        notifyErreur('Ajout impossible : le serveur est injoignable.');
        return null;
    }

    if (res.status === 409) {
        notify('« ' + propre + ' » est déjà dans la liste.');
        await loadJoueurs();
        return null;
    }
    if (!res.ok) {
        notifyErreur('Ajout refusé : ' + await readMessageErreur(res, 'erreur ' + res.status));
        return null;
    }

    const data = await res.json();
    joueurs.push(data.joueur);
    joueursVersion = data.version;
    return data.joueur;
}

// Modifie une fiche. `champs` peut porter `nom`, `elo`, ou les deux.
async function updateJoueur(id, champs) {
    let res;
    try {
        res = await fetch(urlJoueur(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(champs)
        });
    } catch (e) {
        notifyErreur('Modification impossible : le serveur est injoignable.');
        return null;
    }

    if (res.status === 404) {
        notifyErreur('Ce joueur n\'existe plus : la liste vient d\'être rechargée.');
        await loadJoueurs();
        return null;
    }
    if (!res.ok) {
        notifyErreur('Modification refusée : ' + await readMessageErreur(res, 'erreur ' + res.status));
        return null;
    }

    const data = await res.json();
    const i = joueurs.findIndex(j => j.id === id);
    if (i !== -1) joueurs[i] = data.joueur;
    joueursVersion = data.version;
    return data.joueur;
}

// Supprime une fiche. La confirmation appartient à la page qui appelle.
async function removeFiche(id) {
    const fiche = getJoueur(id);
    if (!fiche) return false;

    let res;
    try {
        res = await fetch(urlJoueur(id), { method: 'DELETE' });
    } catch (e) {
        notifyErreur('Suppression impossible : le serveur est injoignable.');
        return false;
    }

    if (!res.ok && res.status !== 404) {
        notifyErreur('Suppression refusée : ' + await readMessageErreur(res, 'erreur ' + res.status));
        return false;
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data.version === 'number') joueursVersion = data.version;
    joueurs = joueurs.filter(j => j.id !== id);
    return true;
}

// Applique plusieurs modifications d'un coup (le bouton « Enregistrer » du
// panneau). Seules les fiches réellement changées partent au serveur.
async function saveFiches(modifications) {
    let touche = false;

    for (const { id, nom, elo } of modifications) {
        const fiche = getJoueur(id);
        if (!fiche) continue;
        const nouveauNom = nom == null ? fiche.nom : nom;
        if (fiche.nom === nouveauNom && fiche.elo === elo) continue;
        if (!await updateJoueur(id, { nom: nouveauNom, elo })) return false;
        touche = true;
    }
    return touche ? 'modifie' : 'inchange';
}

// Remplace toute la liste : sert à la restauration d'une sauvegarde.
async function replaceJoueurs(liste) {
    let res;
    try {
        res = await fetch(URL_JOUEURS, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion: joueursVersion, joueurs: liste })
        });
    } catch (e) {
        notifyErreur('Enregistrement impossible : le serveur est injoignable.');
        return false;
    }

    if (res.status === 409) {
        await loadJoueurs();
        notifyErreur('La liste des joueurs a été modifiée sur un autre appareil.\n\n' +
              'Elle vient d\'être rechargée — recommence.');
        return false;
    }
    if (!res.ok) {
        notifyErreur('Enregistrement refusé : ' + await readMessageErreur(res, 'erreur ' + res.status));
        return false;
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data.version === 'number') joueursVersion = data.version;
    joueurs = liste;
    return true;
}
