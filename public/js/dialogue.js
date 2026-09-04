// Confirmations et saisies, dans la page.
//
// confirm() et prompt() bloquent l'onglet, s'affichent hors de la page, ne
// peuvent rien mettre en forme et ne disent pas ce qui va être détruit. Ici, un
// panneau posé au-dessus du contenu : titre, explication, et deux issues
// clairement nommées — « Supprimer ce tournoi », pas « OK ».

let dialogueOuvert = null;

/**
 * @param {object} options
 * @param {string} options.titre        ce qui va se passer, en une ligne
 * @param {string} options.message      les conséquences, en toutes lettres
 * @param {string} options.action       le libellé du bouton qui valide
 * @param {boolean} options.danger      l'action détruit quelque chose
 * @param {string} options.mot          mot à recopier pour valider (effacement total)
 * @param {string} options.saisie       demande un texte libre (nom d'un joueur)
 * @returns {Promise<string|boolean|null>} le texte saisi, true, ou null si annulé
 */
function askConfirmation(options) {
    const { titre, message = '', action = 'Confirmer', danger = false, mot = null, saisie = null } = options;

    // Une seule à la fois : deux panneaux superposés ne se distinguent plus.
    if (dialogueOuvert) fermerDialogue(null);

    return new Promise((resolve) => {
        const fond = document.createElement('div');
        fond.className = 'dialogue-fond';

        const panneau = document.createElement('div');
        panneau.className = 'dialogue' + (danger ? ' dialogue--danger' : '');
        panneau.setAttribute('role', 'dialog');
        panneau.setAttribute('aria-modal', 'true');

        const html = [`<h2 class="dialogue-titre">${escapeHtml(titre)}</h2>`];
        if (message) html.push(`<p class="dialogue-message">${escapeHtml(message)}</p>`);
        if (mot) {
            html.push(`<p class="dialogue-consigne">Écris <strong>${escapeHtml(mot)}</strong> pour confirmer.</p>`);
            html.push('<input type="text" class="dialogue-saisie" autocomplete="off">');
        } else if (saisie !== null) {
            html.push(`<input type="text" class="dialogue-saisie" autocomplete="off" value="${escapeHtml(saisie)}">`);
        }
        html.push(`
            <div class="dialogue-actions">
                <button type="button" class="secondary dialogue-annuler">Annuler</button>
                <button type="button" class="${danger ? 'danger' : ''} dialogue-valider">${escapeHtml(action)}</button>
            </div>`);
        panneau.innerHTML = html.join('');
        fond.appendChild(panneau);
        document.body.appendChild(fond);

        const champ = panneau.querySelector('.dialogue-saisie');
        const valider = panneau.querySelector('.dialogue-valider');

        const terminer = (valeur) => { fermerDialogue(); resolve(valeur); };

        valider.onclick = () => {
            if (mot) {
                // Le mot exact, à la casse et aux espaces près : c'est le seul
                // garde-fou avant une destruction totale.
                if (String(champ.value || '').trim().toUpperCase() !== mot.toUpperCase()) {
                    notifyErreur('Rien n\'a été effacé : le mot ne correspond pas.');
                    return;
                }
                return terminer(true);
            }
            terminer(saisie !== null ? String(champ.value || '') : true);
        };
        panneau.querySelector('.dialogue-annuler').onclick = () => terminer(null);
        fond.onclick = (e) => { if (e.target === fond) terminer(null); };

        dialogueOuvert = { fond, terminer };
        if (champ) champ.focus();
        else valider.focus();
    });
}

function fermerDialogue(valeur) {
    if (!dialogueOuvert) return;
    const { fond, terminer } = dialogueOuvert;
    dialogueOuvert = null;
    fond.remove();
    if (valeur !== undefined && terminer) terminer(valeur);
}

// Échap referme sans valider : c'est ce qu'on attend d'un panneau modal.
window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dialogueOuvert) fermerDialogue(null);
});
