# Conventions du projet

Ce fichier note les règles qui ne se déduisent ni du code ni de l'historique.
Le README, lui, décrit l'application. Ici, seulement les décisions de travail.

---

## Les commits

**Ne jamais commiter.** Le dépôt est commité à la main, sans exception. Livrer le
travail dans l'arbre de travail, résumer les fichiers touchés, et s'arrêter là.
Les commandes git de lecture (`status`, `diff`, `log`) restent utiles pour rendre
compte de l'état.

---

## Le nommage

**Verbe technique en anglais, terme métier en français.** Le geste se lit en
anglais, ce sur quoi il porte se lit en français.

```
computeClassement    renderCartePartie    setResultatDemie
addJoueur            removeFiche          loadJoueurs
buildOptionsJoueurs  resolveVainqueurElo  eraseTout
```

| Métier — en français | Technique — en anglais |
|---|---|
| joueur, fiche, tournoi, poule, journée, partie, manche, belle, duel, classement, demie, finale, cadence, variante, casaque, partant | get, set, is, build, render, show, add, remove, update, save, load, read, start, check, compute, generate, resolve, apply, merge, fetch, export |

Les commentaires, les libellés et les messages sont en français.

### La seule exception : les clés enregistrées

`tournament`, `players`, `matches`, `played`, `semifinalMatches`, `finalMatches`,
`round`, `num`, `ref`… sont dans le KV de tous les tournois existants. **Les
renommer les rend illisibles.** La variable du navigateur s'appelle `tournoi`, la
clé qu'elle produit reste `tournament` : la frontière tient en deux endroits,
`getEtatCourant()` et `applyEtat()`.

---

## Les tests

Ils documentent **ce que fait l'application**. Pas la forme qu'elle a.

### Ce qui n'a pas sa place dans un test

- une classe CSS, une taille de police, une balise, l'ordre des `<script>` ;
- le contenu du code source (« ce fichier contient tel mot ») ;
- l'inventaire des fichiers, le nombre de lignes, la longueur d'un libellé ;
- la même chose dite six fois par une boucle sur des valeurs triviales.

Ces tests interdisent de changer le code sans rien garantir de plus. Quand il en
apparaît un, il se supprime. **La couverture n'est pas un objectif** : un test
qui ne décrit aucun comportement observable est un test en trop.

### Ce qui mérite un test

- **les règles du tournoi** — méthode du cercle, barème, départages, belle,
  3e place, cadence et type d'une partie ;
- **le contrat de l'API** — ce que le Worker accepte, ce qu'il refuse, avec quel
  code ; les écritures versionnées et leurs conflits ;
- **les liaisons page ↔ code** — un `onclick` désigne une fonction qui existe, un
  `getElementById` vise un élément présent, chaque page ne charge que ce dont
  elle a besoin ;
- **ce qui ne doit jamais arriver** — un nom de joueur injecté brut dans la page,
  une visite qui crée un tournoi, un export sans les fiches, une restauration qui
  écrit avant confirmation.

Formuler l'assertion sur ce qui est visible plutôt que sur le balisage :
« le classement affiche *fiche supprimée* à côté de Bob », et non
`Bob<span class="tag-absent">`.

### Comment ils tournent

`node --test`, sans dépendance ni `package.json`. Le front est chargé dans un
DOM factice (`tests/aide/app.mjs`) ; `fetch`, les minuteries, `confirm` et
`prompt` sont pilotés depuis le test.

---

## L'interface

- **Tout se fait dans l'application.** Pas de script à lancer soi-même pour une
  fonctionnalité destinée à l'usage courant : si ça sert, c'est un bouton.
- **Aucun `alert()`.** Les messages s'affichent dans la page (`notice.js`) :
  information et succès s'effacent seuls, une erreur reste jusqu'à fermeture.
  `confirm()` et `prompt()` demeurent, mais seulement pour garder une action
  destructrice.
- **Le même menu partout** : burger identique sur les cinq pages, contenant la
  navigation et rien d'autre. Une action propre à une page vit sur cette page.
- **Le nom du tournoi est l'information principale de l'accueil** ; il en est le
  titre, pas une mention discrète.
- **Regarder ce qui se fait dans les standards actuels du web.** Un contrôle
  inventé pour l'occasion — soulignement en pointillé, bricolage maison — ne se
  reconnaît pas. Reprendre les formes établies, et d'abord celles que
  l'application emploie déjà : un champ de saisie porte le cadre et le halo des
  autres champs.
- **Une visite ne crée rien.** Un tournoi ne reçoit son adresse qu'au premier
  « Donner le départ ».

---

## Vérifier avant d'annoncer

Les tests ne suffisent pas pour ce qui se voit. Lancer `wrangler dev`, ouvrir la
page, mesurer ce qui est affirmé (positions, tailles, appels réseau), et remettre
le KV local dans l'état trouvé avant de rendre la main.
