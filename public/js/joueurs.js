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

function joueurParId(ref) {
    return joueurs.find(j => j.id === ref) || null;
}

// --- Résolution dans un tournoi ---------------------------------------------

// Recopie nom et Elo depuis les fiches dans les partants du tournoi courant.
// Les tournois d'avant cette version n'ont pas de `ref` : on les laisse tels
// quels, leurs noms sont la seule source qui existe pour eux.
function resoudreJoueursDuTournoi() {
    let change = false;
    for (const partant of tournament.players || []) {
        if (!partant.ref) continue;
        const fiche = joueurParId(partant.ref);
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

async function chargerJoueurs() {
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
async function messageErreur(res, defaut) {
    const data = await res.json().catch(() => null);
    return (data && data.error) || defaut;
}

// --- Créer, modifier, supprimer une fiche ------------------------------------

// Le serveur attribue l'identifiant et refuse les homonymes : deux appareils
// qui ajoutent en même temps ne peuvent ni se marcher dessus ni créer un doublon.
async function ajouterJoueur(nom, elo) {
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
        notifierErreur('Ajout impossible : le serveur est injoignable.');
        return null;
    }

    if (res.status === 409) {
        notifier('« ' + propre + ' » est déjà dans la liste.');
        await chargerJoueurs();
        return null;
    }
    if (!res.ok) {
        notifierErreur('Ajout refusé : ' + await messageErreur(res, 'erreur ' + res.status));
        return null;
    }

    const data = await res.json();
    joueurs.push(data.joueur);
    joueursVersion = data.version;
    return data.joueur;
}

// Modifie une fiche. `champs` peut porter `nom`, `elo`, ou les deux.
async function modifierJoueur(id, champs) {
    let res;
    try {
        res = await fetch(urlJoueur(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(champs)
        });
    } catch (e) {
        notifierErreur('Modification impossible : le serveur est injoignable.');
        return null;
    }

    if (res.status === 404) {
        notifierErreur('Ce joueur n\'existe plus : la liste vient d\'être rechargée.');
        await chargerJoueurs();
        return null;
    }
    if (!res.ok) {
        notifierErreur('Modification refusée : ' + await messageErreur(res, 'erreur ' + res.status));
        return null;
    }

    const data = await res.json();
    const i = joueurs.findIndex(j => j.id === id);
    if (i !== -1) joueurs[i] = data.joueur;
    joueursVersion = data.version;
    return data.joueur;
}

// Supprime une fiche. La confirmation appartient à la page qui appelle.
async function supprimerFiche(id) {
    const fiche = joueurParId(id);
    if (!fiche) return false;

    let res;
    try {
        res = await fetch(urlJoueur(id), { method: 'DELETE' });
    } catch (e) {
        notifierErreur('Suppression impossible : le serveur est injoignable.');
        return false;
    }

    if (!res.ok && res.status !== 404) {
        notifierErreur('Suppression refusée : ' + await messageErreur(res, 'erreur ' + res.status));
        return false;
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data.version === 'number') joueursVersion = data.version;
    joueurs = joueurs.filter(j => j.id !== id);
    return true;
}

// Applique plusieurs modifications d'un coup (le bouton « Enregistrer » du
// panneau). Seules les fiches réellement changées partent au serveur.
async function enregistrerFiches(modifications) {
    let touche = false;

    for (const { id, nom, elo } of modifications) {
        const fiche = joueurParId(id);
        if (!fiche) continue;
        const nouveauNom = nom == null ? fiche.nom : nom;
        if (fiche.nom === nouveauNom && fiche.elo === elo) continue;
        if (!await modifierJoueur(id, { nom: nouveauNom, elo })) return false;
        touche = true;
    }
    return touche ? 'modifie' : 'inchange';
}

// Remplace toute la liste : sert à la restauration d'une sauvegarde.
async function remplacerJoueurs(liste) {
    let res;
    try {
        res = await fetch(URL_JOUEURS, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ baseVersion: joueursVersion, joueurs: liste })
        });
    } catch (e) {
        notifierErreur('Enregistrement impossible : le serveur est injoignable.');
        return false;
    }

    if (res.status === 409) {
        await chargerJoueurs();
        notifierErreur('La liste des joueurs a été modifiée sur un autre appareil.\n\n' +
              'Elle vient d\'être rechargée — recommence.');
        return false;
    }
    if (!res.ok) {
        notifierErreur('Enregistrement refusé : ' + await messageErreur(res, 'erreur ' + res.status));
        return false;
    }

    const data = await res.json().catch(() => null);
    if (data && typeof data.version === 'number') joueursVersion = data.version;
    joueurs = liste;
    return true;
}
