// Page /joueurs : la liste des joueurs et son édition, rien d'autre.
//
// Les fiches vivent hors des tournois ; cette page est le seul endroit où on
// les crée, les renomme, change leur pseudo, ou les supprime.
//
// Le pseudo est celui de chess.com. Il sert deux fois : c'est par lui qu'une
// partie jouée en ligne se rattache à ses deux partants, et c'est de lui que
// vient l'Elo — le classement ne se tape pas, il se synchronise.

function renderJoueurs() {
    const conteneur = document.getElementById('joueurs-editor');
    if (!conteneur) return;

    if (!joueurs.length) {
        conteneur.innerHTML = '<div class="tournaments-empty">Aucun joueur pour l\'instant. ' +
            'Ajoute le premier ci-dessous — tu pourras ensuite l\'inscrire à un tournoi.</div>';
        return;
    }

    conteneur.innerHTML = joueurs.map(j => {
        const id = escapeHtml(j.id);
        return `
        <div class="joueur-row">
            <input type="text" class="joueur-nom" maxlength="64" value="${escapeHtml(j.nom)}" data-id="${id}">
            <input type="text" class="joueur-pseudo" maxlength="32" placeholder="Pseudo" data-id="${id}"
                   value="${escapeHtml(j.pseudo || '')}">
            <span class="joueur-elo">${j.elo == null ? '—' : j.elo}</span>
            ${buildBoutonPicto('synchroniser', 'Synchroniser avec chess.com', `synchroniserFiche('${id}')`)}
            ${buildBoutonPicto('supprimer', 'Supprimer', `removeJoueur('${id}')`, 'danger')}
        </div>
    `;
    }).join('');
}

async function addJoueurFromForm() {
    const champNom = document.getElementById('joueur-nouveau-nom');
    const champPseudo = document.getElementById('joueur-nouveau-pseudo');

    const fiche = await addJoueur(champNom.value, champPseudo.value);
    if (!fiche) return;

    champNom.value = '';
    champPseudo.value = '';
    renderJoueurs();
    champNom.focus();
}

// Les champs d'une fiche, retrouvés par son identifiant. Le formulaire d'ajout
// porte les mêmes classes mais n'a pas de fiche : ses champs sont ainsi écartés.
function champsDesFiches(classe) {
    return Array.from(document.querySelectorAll(classe)).filter(c => c.dataset && c.dataset.id);
}

function champDeLaFiche(classe, id) {
    return champsDesFiches(classe).find(c => c.dataset.id === id) || null;
}

// Synchronise une fiche avec chess.com : le pseudo tel qu'il est saisi dans la
// ligne, et le classement que le site lui donne. L'Elo ne se tapant nulle part,
// ce bouton l'enregistre lui-même — il n'y a pas de valeur en attente à garder.
async function synchroniserFiche(id) {
    const champPseudo = champDeLaFiche('.joueur-pseudo', id);
    if (!champPseudo) return;

    const pseudo = champPseudo.value.trim();
    if (!pseudo) {
        notifyErreur('Renseigne d\'abord le pseudo chess.com de ce joueur.');
        return;
    }

    const classement = await fetchClassementChessCom(pseudo);
    if (!classement) {
        notifyErreur('chess.com ne donne aucun classement pour « ' + pseudo + ' ».');
        return;
    }

    if (!await updateJoueur(id, { pseudo, elo: classement.elo })) return;

    renderJoueurs();
    notifySucces(pseudo + ' — Elo ' + classement.format + ' : ' + classement.elo + '.');
}

async function saveJoueursFromForm() {
    const noms = champsDesFiches('.joueur-nom');
    const pseudos = champsDesFiches('.joueur-pseudo');

    const modifications = [];
    for (let i = 0; i < noms.length; i++) {
        const nom = noms[i].value.trim();
        if (!nom) {
            notifyErreur('Tous les noms doivent être remplis.');
            return;
        }
        modifications.push({ id: noms[i].dataset.id, nom, pseudo: pseudos[i].value.trim() });
    }

    const resultat = await saveFiches(modifications);
    renderJoueurs();
    if (resultat === 'modifie') notifySucces('Modifications enregistrées.');
    else if (resultat === 'inchange') notify('Rien à enregistrer.');
}

async function removeJoueur(id) {
    const fiche = getJoueur(id);
    if (!fiche) return;
    const suite = await askConfirmation({
        titre: 'Supprimer « ' + fiche.nom + ' » de la liste ?',
        message: 'Les tournois où il a joué gardent son nom, mais il ne sera plus proposé à l\'inscription.',
        action: 'Supprimer',
        danger: true
    });
    if (!suite) return;
    if (!await removeFiche(id)) return;
    renderJoueurs();
    notifySucces('« ' + fiche.nom + ' » supprimé de la liste.');
}

async function startPageJoueurs() {
    const conteneur = document.getElementById('joueurs-editor');
    conteneur.innerHTML = '<div class="tournaments-empty">Chargement…</div>';

    if (!await loadJoueurs()) {
        conteneur.innerHTML = '<div class="tournaments-empty">Liste indisponible — hors ligne ?</div>';
        return;
    }
    renderJoueurs();
}

startPageJoueurs();
