// Le menu burger, identique sur les trois pages.
//
// Il porte d'abord la navigation (Accueil, Tournois, Joueurs), puis les actions
// propres à la page ouverte. Sa mécanique vit ici pour qu'aucune page n'ait sa
// propre version — c'est le même objet partout.

function closeMenu() {
    document.getElementById('main-menu').hidden = true;
    document.getElementById('btn-menu').setAttribute('aria-expanded', 'false');
}

function toggleMenu() {
    const menu = document.getElementById('main-menu');
    const ouvert = menu.hidden;
    menu.hidden = !ouvert;
    document.getElementById('btn-menu').setAttribute('aria-expanded', String(ouvert));
}

// Le menu se referme dès qu'on choisit une entrée...
document.getElementById('main-menu').addEventListener('click', (e) => {
    if (e.target.closest('.menu-item')) closeMenu();
});

// ...qu'on clique ailleurs dans la page...
document.addEventListener('click', (e) => {
    if (document.getElementById('main-menu').hidden) return;
    if (e.target.closest('#main-menu') || e.target.closest('#btn-menu')) return;
    closeMenu();
});

// ...ou qu'on appuie sur Échap.
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
});
