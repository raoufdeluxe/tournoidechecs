// Messages affichés dans la page, à la place des notify() du navigateur.
//
// Une boîte notify() bloque l'onglet, se place hors de la page et ne peut rien
// montrer de long. Ici, un bandeau s'empile en haut à droite : les messages
// courts s'effacent seuls, les erreurs restent jusqu'à ce qu'on les ferme —
// elles portent parfois la liste de ce qui a échoué.

const DUREE_NOTICE = 5000;

// Les tests, et le code qui veut savoir ce qui a été dit, lisent ce journal.
let noticesEmises = [];

function getConteneurNotices() {
    let conteneur = document.getElementById('notices');
    if (!conteneur) {
        conteneur = document.createElement('div');
        conteneur.id = 'notices';
        conteneur.className = 'notices';
        conteneur.setAttribute('role', 'status');
        conteneur.setAttribute('aria-live', 'polite');
        document.body.appendChild(conteneur);
    }
    return conteneur;
}

/**
 * @param {string} message  texte à afficher (les retours à la ligne sont gardés)
 * @param {'info'|'succes'|'erreur'} type  une erreur reste jusqu'à fermeture
 */
function notify(message, type = 'info') {
    noticesEmises.push(String(message));

    const conteneur = getConteneurNotices();
    const notice = document.createElement('div');
    notice.className = 'notice notice--' + type;

    const texte = document.createElement('span');
    texte.className = 'notice-texte';
    texte.textContent = message;
    notice.appendChild(texte);

    const fermer = document.createElement('button');
    fermer.className = 'notice-fermer';
    fermer.type = 'button';
    fermer.setAttribute('aria-label', 'Fermer ce message');
    fermer.textContent = '×';
    fermer.onclick = () => notice.remove();
    notice.appendChild(fermer);

    conteneur.appendChild(notice);

    // Une erreur peut être longue à lire, et lister des échecs : on la laisse.
    if (type !== 'erreur') {
        setTimeout(() => notice.remove(), DUREE_NOTICE);
    }
    return notice;
}

const notifyErreur = (message) => notify(message, 'erreur');
const notifySucces = (message) => notify(message, 'succes');
