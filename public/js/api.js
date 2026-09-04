// Adresses de l'API, communes aux trois pages.
//
// L'API vit sous /api : /joueurs et /tournois sont des pages HTML, et les
// fichiers statiques sont servis avant le Worker. Une route d'API portant le
// même chemin qu'une page ne serait jamais atteinte.
//
// Seul le cas « fichier ouvert en double-clic » (file://) a besoin de l'URL
// complète : partout ailleurs un chemin relatif suffit, ce qui survit au
// renommage du Worker comme à l'ajout d'un domaine perso.

const API_RACINE = location.protocol === 'file:'
    ? 'https://echecs.vodkafunk.workers.dev/api'
    : '/api';

const URL_ETAT = API_RACINE + '/etat';
const URL_JOUEURS = API_RACINE + '/joueurs';
const URL_TOURNOIS = API_RACINE + '/tournois';

const urlEtat = (id) => URL_ETAT + '?id=' + encodeURIComponent(id);
const urlJoueur = (id) => URL_JOUEURS + '/' + encodeURIComponent(id);

// Les identifiants de tournoi comme de joueur suivent ce motif, que le Worker
// applique de son côté : ce qui est refusé ici le serait aussi là-bas.
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

// Une page ouverte ailleurs (menu, lien) : les trois pages se répondent.
const PAGE_ACCUEIL = './';
const PAGE_JOUEURS = './joueurs';
const PAGE_TOURNOIS = './tournois';

// « Tournoi des potes » -> « tournoi-des-potes », pour servir d'adresse lisible.
function slugify(name) {
    return name
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // retire les accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)
        .replace(/-+$/, '');
}

// Un nom déjà utilisé pointerait sur le tournoi de quelqu'un d'autre : on vérifie.
async function isIdTaken(id) {
    try {
        const res = await fetch(urlEtat(id));
        if (!res.ok) return false;
        const data = await res.json();
        const t = data && data.state && data.state.tournament;
        return !!(t && Array.isArray(t.players) && t.players.length > 0);
    } catch (e) {
        return false; // hors ligne : on ne bloque pas la création
    }
}


// Dernière liste affichée : évite de faire transiter les noms par des attributs HTML.
let lastTournamentsList = [];

// Tournois supprimés depuis cet onglet. L'index du serveur peut mettre
// quelques secondes à refléter une suppression : on les masque en attendant,
// pour que la liste corresponde à ce que l'on vient de faire.
const deletedThisSession = new Set();
