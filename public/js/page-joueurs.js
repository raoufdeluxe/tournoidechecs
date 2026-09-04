// Page /joueurs : la liste des joueurs et son édition, rien d'autre.
//
// Les fiches vivent hors des tournois ; cette page est le seul endroit où on
// les crée, les renomme, change leur Elo ou les supprime.

function renderJoueurs() {
    const conteneur = document.getElementById('joueurs-editor');
    if (!conteneur) return;

    if (!joueurs.length) {
        conteneur.innerHTML = '<div class="tournaments-empty">Aucun joueur pour l\'instant. ' +
            'Ajoute le premier ci-dessous — tu pourras ensuite l\'inscrire à un tournoi.</div>';
        return;
    }

    conteneur.innerHTML = joueurs.map(j => `
        <div class="joueur-row">
            <input type="text" class="joueur-nom" maxlength="64" value="${escapeHtml(j.nom)}" data-id="${escapeHtml(j.id)}">
            <input type="number" class="joueur-elo" placeholder="Elo" min="0" step="1" value="${j.elo == null ? '' : j.elo}">
            <button class="danger joueur-supprimer" onclick="supprimerJoueur('${escapeHtml(j.id)}')">Supprimer</button>
        </div>
    `).join('');
}

function eloSaisi(champ) {
    const brut = champ.value.trim();
    if (brut === '') return null;
    const valeur = parseInt(brut, 10);
    return Number.isFinite(valeur) ? valeur : null;
}

async function ajouterJoueurDepuisPage() {
    const champNom = document.getElementById('joueur-nouveau-nom');
    const champElo = document.getElementById('joueur-nouveau-elo');

    const fiche = await ajouterJoueur(champNom.value, eloSaisi(champElo));
    if (!fiche) return;

    champNom.value = '';
    champElo.value = '';
    renderJoueurs();
    champNom.focus();
}

async function enregistrerJoueursDepuisPage() {
    const noms = Array.from(document.querySelectorAll('.joueur-nom'));
    const elos = Array.from(document.querySelectorAll('.joueur-elo'));

    const modifications = [];
    for (let i = 0; i < noms.length; i++) {
        const nom = noms[i].value.trim();
        if (!nom) {
            notifierErreur('Tous les noms doivent être remplis.');
            return;
        }
        modifications.push({ id: noms[i].dataset.id, nom, elo: eloSaisi(elos[i]) });
    }

    const resultat = await enregistrerFiches(modifications);
    renderJoueurs();
    if (resultat === 'modifie') notifierSucces('Modifications enregistrées.');
    else if (resultat === 'inchange') notifier('Rien à enregistrer.');
}

async function supprimerJoueur(id) {
    const fiche = joueurParId(id);
    if (!fiche) return;
    if (!confirm('Supprimer « ' + fiche.nom + ' » de la liste ?\n\n' +
                 'Les tournois où il a joué gardent son nom, mais il ne sera plus proposé à l\'inscription.')) {
        return;
    }
    if (!await supprimerFiche(id)) return;
    renderJoueurs();
    notifierSucces('« ' + fiche.nom + ' » supprimé de la liste.');
}

async function demarrerPageJoueurs() {
    const conteneur = document.getElementById('joueurs-editor');
    conteneur.innerHTML = '<div class="tournaments-empty">Chargement…</div>';

    if (!await chargerJoueurs()) {
        conteneur.innerHTML = '<div class="tournaments-empty">Liste indisponible — hors ligne ?</div>';
        return;
    }
    renderJoueurs();
}

demarrerPageJoueurs();
