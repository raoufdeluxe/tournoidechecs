# ♟️ Grand Prix des Échecs

> Application web pour organiser un tournoi d'échecs entre amis : poule aller/retour,
> demi-finales, grande finale — synchronisée entre tous les appareils, sans compte ni installation.

Une page statique, un Worker Cloudflare, un espace KV. Rien d'autre : pas de build,
pas de framework, pas de `node_modules`. On ouvre le lien, on saisit les résultats,
tout le monde voit la même chose en direct.

---

## Le format du tournoi

| Phase | Format | Qualification |
|---|---|---|
| 🏇 **Poule** | Championnat aller/retour, un duel par journée (méthode du cercle) | Les **4 premiers** passent |
| 🥊 **Demi-finales** | 1er vs 4e · 2e vs 3e, en 2 manches (une chez chacun) | Les 2 vainqueurs |
| 🏆 **Grande Finale** | 2 manches, belle éventuelle sur terrain neutre | Le champion |

**Barème de la poule** — Victoire `1 pt` · Nulle `0,5 pt` · Défaite `0 pt`.

**Départage au classement** (dans l'ordre) :
1. Points
2. Nombre de victoires
3. Confrontation directe entre les joueurs encore à égalité

**Départage d'un duel** en demi-finale ou en finale (dans l'ordre) :
1. Score des manches
2. **Elo le plus bas** — le tournoi récompense l'exploit du moins bien classé
3. Manche décisive (belle)
4. Meilleur classement en poule — le dernier recours, pour qu'un duel désigne toujours un vainqueur

La **3e place** ne se joue pas : c'est le mieux classé en poule parmi les deux perdants des demies.

---

## Ce que ça fait, concrètement

- **Un lien = un tournoi.** L'identifiant vit dans l'URL (`…/#tournoi-des-potes`).
  Partager le tournoi, c'est partager le lien — qui l'a peut lire et saisir.
- **L'accueil rouvre le dernier tournoi consulté.** Sans lien ni tournoi
  précédent, il montre l'écran d'inscription — et n'invente aucune adresse.
- **Nom lisible.** « Tournoi des potes » devient l'adresse `#tournoi-des-potes`,
  avec vérification qu'elle n'est pas déjà prise.
- **Synchro multi-appareils.** Chaque saisie est poussée au Worker ; les autres onglets
  récupèrent l'état à l'ouverture. Un indicateur affiche en permanence l'état de l'enregistrement.
- **Écriture versionnée.** Si un autre appareil a modifié le tournoi entre-temps,
  le serveur refuse l'écriture (409) et l'app demande *laquelle des deux versions garder* —
  plutôt que d'en écraser une en silence.
- **Fonctionne hors-ligne.** Copie locale immédiate en `localStorage`, réessai automatique
  avec back-off (1s, 2s, 4s… plafonné à 30s), reprise dès le retour du réseau.
- **Classement vivant.** Table des scores, barre de progression, cartes de résumé et
  **graphe de progression journée après journée**.
- **De 4 à 16 partants**, nombre impair géré (journée de repos), Elo optionnel par joueur.
- **Cadence et type par partie** — 10 min (défaut), 5 min, 3 min ou 24 h ;
  classique (défaut) ou Chess960. Chaque partie a les siens : une poule peut
  mêler blitz et parties par correspondance.
- **Joueurs réutilisables.** Une liste unique, hors des tournois : on inscrit un partant
  en le choisissant, plus en retapant son nom.

---

## Architecture

```
public/
  index.html      accueil : le tournoi en cours (config · poule · demies · finale · résultats)
  joueurs.html    /joueurs  : la liste des joueurs et son édition
  tournois.html   /tournois : la liste des tournois, renommage, suppression
  stats.html      /stats : comparaison des joueurs
  sauvegarde.html /sauvegarde : export, import, effacement total
  styles.css      thème « hippodrome » : casaques colorées, typo sport
  js/
    core.js       état partagé, couleurs, échappement, règles de départage,
                  réglages d'une partie, copie locale
    notice.js     les messages affichés dans la page (à la place des alert)
    api.js        adresses de l'API, motif d'identifiant, slug d'un nom
    joueurs.js    les fiches : chargement et modifications (aucun rendu)
    poule.js      inscription, calendrier aller/retour, classement, cartes de duel
    finales.js    demi-finales, grande finale, podium
    menu.js       le menu burger, identique sur les trois pages
    tournois.js   identité du tournoi courant (lien, nom), renommage
    sync.js       sauvegarde versionnée : envois sérialisés, réessai, conflits
    page-joueurs.js   la page /joueurs
    page-tournois.js  la page /tournois
    sauvegarde.js     export/import (tournois + joueurs)
    stats.js          dépouillement des parties (calcul pur)
    page-stats.js     la page /stats : sélection et tableaux
    page-sauvegarde.js  la page /sauvegarde : état, effacement total
worker.js         API + service des fichiers statiques
wrangler.toml     config Cloudflare (Worker + binding KV + [assets])
nix/flake.nix     shell de dev (node + wrangler)
```

Le Worker sert **à la fois** la page et l'API : un chemin relatif suffit côté client,
ce qui survit au renommage du Worker comme à l'ajout d'un domaine perso.

### API

**Les tournois**

| Route | Réponse |
|---|---|
| `GET /api/tournois` | `{ tournaments: [...], complete }` — liste des tournois non vides |
| `GET /api/etat?id=<id>` | `{ version, updatedAt, state }` (`state: null` si inexistant) |
| `POST /api/etat?id=<id>` | corps `{ baseVersion, state }` → `200 { version }`, ou `409` + état courant |
| `DELETE /api/etat?id=<id>` | supprime définitivement le tournoi |

**Les joueurs** — création, modification et suppression fiche par fiche :

| Route | Réponse |
|---|---|
| `GET /api/joueurs` | `{ version, updatedAt, joueurs }` |
| `POST /api/joueurs` | corps `{ nom, elo? }` → `201 { version, joueur }`, ou `409` si le nom est pris |
| `GET /api/joueurs/<id>` | `{ version, joueur }`, ou `404` |
| `PATCH /api/joueurs/<id>` | corps `{ nom?, elo? }` → `200 { version, joueur }` |
| `DELETE /api/joueurs/<id>` | `200 { version, deleted }`, ou `404` |
| `PUT /api/joueurs` | corps `{ baseVersion, joueurs }` — remplace toute la liste (restauration) |

**C'est le serveur qui attribue l'identifiant d'une fiche** et qui refuse les
homonymes : deux appareils qui ajoutent un joueur en même temps ne peuvent ni
produire le même renvoi, ni créer un doublon. Il n'y a donc pas de `baseVersion`
sur les opérations fiche par fiche — chacune s'applique à la liste courante.
Seul `PUT`, qui écrase tout, la réclame.

`GET /tournaments` et `/state` restent servis, pour qu'un onglet resté sur une
version antérieure de la page continue de marcher.

Les identifiants suivent `^[a-z0-9-]{1,64}$`. Une requête sans `id` retombe sur la clé
historique `tournament`, pour qu'un onglet resté sur une ancienne version continue de marcher.

---

## Développement

```bash
# shell de dev (node + wrangler)
nix develop ./nix

# serveur local, sur http://localhost:8787
wrangler dev

# la suite de tests (Node >= 22.7, aucune dépendance à installer)
node --test
```

La page marche aussi en `file://` (double-clic sur `public/index.html`) : dans ce cas
elle tape sur le Worker déployé plutôt que sur `/state`.

### Déploiement

```bash
wrangler login
wrangler kv namespace create CHESS_TOURNAMENT   # une seule fois — reporter l'id dans wrangler.toml
wrangler deploy
```

> ⚠️ Dans `wrangler.toml`, la table `[assets]` doit rester **en dernier** :
> en TOML, toute clé écrite après elle lui appartient.

---

## Tests et intégration continue

```bash
node --test                        # tout
node --test tests/poule.test.mjs   # un seul fichier
```

Les tests n'utilisent que le lanceur intégré de Node (`node:test`) : **pas de
dépendance, pas de `node_modules`, pas de `package.json`, pas de build** — comme
le reste du projet. L'extension `.mjs` suffit à ce que Node les lise comme des
modules ; rien à configurer.

```
tests/
  aide/app.mjs       charge public/js/*.js dans un DOM factice (voir plus bas)
  aide/tournoi.mjs   fabriques : poule générée, résultats joués
  aide/kv.mjs        faux espace KV + appel du Worker
  core.test.mjs      départages : Elo, belle, 3e place, barème
  poule.test.mjs     méthode du cercle, aller/retour, classement, progression
  finales.test.mjs   qualification des 4 premiers, demies, Grande Finale, podium
  sync.test.mjs      envois sérialisés, back-off hors-ligne, conflit 409
  tournois.test.mjs  slug du nom, identifiant du lien, échappement HTML
  worker.test.mjs    routes, versionnage, liste des tournois
  statique.test.mjs  cohérence page ↔ code ↔ wrangler.toml
  sauvegarde.test.mjs  export/import : format, plan, écriture, échecs partiels
  joueurs.test.mjs     fiches : résolution, création, modification, inscription
  page-joueurs.test.mjs   la page /joueurs
  page-tournois.test.mjs  la page /tournois
  page-sauvegarde.test.mjs  la page /sauvegarde, dont l'effacement total
  stats.test.mjs       le dépouillement des parties
  page-stats.test.mjs  la page /stats : sélection et lecture des tableaux
```

**Comment le front est testé sans navigateur.** Les scripts de `public/js/` sont
écrits pour la page : variables globales, aucun export, effets de bord au
chargement. Plutôt que de les refactorer, `tests/aide/app.mjs` les exécute tels
quels dans un contexte `node:vm` muni d'un faux `document` — tout élément
demandé répond, rien n'est rendu. Le test interroge ensuite les fonctions
comme le ferait la page. Les minuteries et `fetch` sont pilotés depuis le test :
c'est ce qui permet de vérifier le back-off (1s, 2s, 4s… 30s) sans attendre.

`statique.test.mjs` attrape ce qu'aucun test unitaire ne voit : un `onclick=`
qui appelle une fonction supprimée, un `getElementById` orphelin, un script
ajouté dans `public/js/` mais oublié dans `index.html`, un binding absent de
`wrangler.toml`, ou la table `[assets]` qui ne serait plus la dernière.

La CI GitHub Actions (`.github/workflows/ci.yml`) rejoue tout cela à chaque
push et chaque pull request, et vérifie en plus que le Worker se compile
(`wrangler deploy --dry-run`, sans jeton Cloudflare ni déploiement).

---

## Ce que l'accueil ouvre

| Situation | Ce qui se passe |
|---|---|
| Lien explicite (`…/#tournoi-des-potes`) | ce tournoi, même s'il n'existe pas encore — le lien a pu être partagé avant le départ |
| Rien dans l'URL, un tournoi déjà consulté | **le dernier ouvert**, repris là où il en était |
| Rien du tout | l'écran d'inscription, **sans identifiant** |

**Un tournoi ne reçoit son adresse qu'au premier « Donner le départ »** : le nom
saisi devient le lien (`Tournoi des potes` → `…/#tournoi-des-potes`), ou un
identifiant est tiré au sort si le nom est vide. Avant cela, rien n'est écrit —
ni en local, ni sur le serveur.

C'est ce qui empêche une simple visite de laisser un tournoi fantôme dans la
liste partagée : auparavant, ouvrir l'accueil réservait une adresse aléatoire,
et il suffisait de cliquer pour la voir apparaître chez tout le monde.

Un repère local qui ne mène plus à rien — tournoi supprimé entre-temps — est
oublié, et la barre d'adresse nettoyée. Un lien partagé, lui, reste valable.

---

## Cinq pages

| Page | Ce qu'on y fait |
|---|---|
| `/` | **le tournoi en cours** : inscription, poule, demies, finale, résultats |
| `/joueurs` | **la liste des joueurs** : ajouter, renommer, changer l'Elo, supprimer |
| `/tournois` | **la liste des tournois** : renommer, ouvrir, supprimer |
| `/stats` | **comparer les joueurs** : % de victoire par cadence et par type |
| `/sauvegarde` | **les données dans leur ensemble** : exporter, importer, tout effacer |

Le **même menu burger** sur les trois pages : d'abord la navigation, puis les
la sauvegarde (exporter, importer — elle porte les deux listes, donc elle est
partout), puis les actions propres à la page ouverte (seul l'accueil en a :
nouveau tournoi et copier le lien). Deux tests vérifient que le bouton est identique partout et
que les trois entrées de navigation sont les mêmes.

Chaque page ne charge que ce dont elle a besoin : `/joueurs` et `/tournois`
n'embarquent ni `sync.js` ni la machinerie de la poule, si bien qu'ouvrir l'une
d'elles ne crée aucun tournoi et n'écrit rien. Un test s'en assure.

**L'API vit sous `/api`** pour cette raison précise : les fichiers statiques sont
servis avant le Worker, donc `public/joueurs.html` (servi sur `/joueurs`)
masquerait une route d'API du même nom. `/state` et `/tournaments` restent
acceptés pour les onglets restés sur une version antérieure.

---

## Les statistiques

`/stats` compare de **un à tous les joueurs** sur trois axes : toutes parties
confondues, par cadence, par type de partie. Chaque cellule donne le pourcentage
de victoire, le nombre de parties dessous, et le bilan complet au survol
(« 2 victoires, 1 nulle, 1 défaite »).

- Le taux porte sur les **parties jouées**, nulles comprises : deux victoires sur
  quatre parties dont une nulle font 50 %.
- Un format jamais joué affiche **—**, pas « 0 % » : l'absence de partie n'est pas
  un échec.
- Les joueurs sont cochés d'emblée **s'ils ont joué** ; les autres restent
  proposés, décochés.

**Les parties sont comptées par fiche, jamais par nom.** Deux homonymes seraient
confondus, et un renommage effacerait un historique. Les parties dont un partant
n'a pas de fiche — les tournois d'avant leur existence — ne sont donc pas
attribuables : la page en donne le nombre plutôt que de les passer sous silence.
Les rattacher à des fiches les fait entrer dans les comptes.

---

## La cadence et le type d'une partie

Chaque partie porte ses propres réglages, choisis sur sa carte :

| Cadence | Type |
|---|---|
| **10 min** (défaut) · 5 min · 3 min · 24 h | **Classique** (défaut) · Chess960 |

Ils valent pour **une partie**, pas pour le tournoi : rien n'empêche de jouer la
poule en blitz et la finale en 24 h, ni d'intercaler un Chess960.

Une **belle** reprend le format de la manche 1 du duel : elle le prolonge, elle
ne change pas les règles en cours de route.

Les parties créées **avant cet ajout** n'ont pas ces champs. Elles s'affichent
avec les valeurs par défaut, et leur enregistrement n'est pas réécrit tant qu'on
n'y touche pas — une valeur inconnue (page d'une autre version) est ignorée de la
même façon, la partie gardant son réglage.

---

## Les joueurs, hors des tournois

Les joueurs vivent dans **une liste unique** (menu → 👥 Joueurs), pas dans les
tournois. Un tournoi ne retient qu'un **renvoi** (`ref`) vers la fiche :

```json
"players": [ { "id": 0, "ref": "j-av9uvyqw", "name": "Raphael", "elo": 1610 } ]
```

- `id` reste l'indice du partant dans le tournoi — c'est lui que les matchs
  et les classements référencent.
- `ref` désigne la fiche, et **fait foi** : renommer quelqu'un dans la liste le
  renomme partout, y compris dans les tournois déjà joués.
- `name` et `elo` sont **recopiés au moment de l'inscription, en simple repli**.
  Ils sont écrasés par la fiche à chaque chargement. Sans eux, un tournoi ouvert
  hors ligne — ou dont la fiche a été supprimée — n'afficherait que des cases vides.

Supprimer une fiche ne casse donc rien : les tournois où ce joueur figure
continuent d'afficher son nom, marqué comme absent de la liste.

L'Elo appartient à la fiche : il se saisit sur la page `/joueurs`, plus sur
l'écran d'inscription. Le départage « Elo le plus bas » utilise la valeur courante
de la fiche.

Un partant se renomme **sur `/joueurs`**, jamais dans le tournoi : son nom
appartient à la fiche. Les **tournois d'avant les fiches** n'ont pas de `ref` :
ils affichent les noms inscrits dans le tournoi, figés — les rattacher à des
fiches est ce qui les rend à nouveau modifiables.

La liste est partagée comme le reste (clé `players` du KV). Elle s'administre
fiche par fiche via `/joueurs` : ajouter, renommer, changer un Elo ou supprimer
ne touche que la fiche visée, si bien que deux appareils qui travaillent en même
temps ne se marchent pas dessus. Seule une restauration de sauvegarde réécrit
toute la liste d'un coup, et celle-là est refusée si la liste a bougé entre-temps.

---

## Comment les choses s'appellent

**Verbe technique en anglais, terme métier en français** : `renderClassement`,
`addJoueur`, `loadJoueurs`, `setResultatPartie`, `computeClassement`,
`buildOptionsJoueurs`, `eraseTout`. Le geste se lit en anglais, ce sur quoi il
porte se lit en français.

| Métier (français) | Technique (anglais) |
|---|---|
| joueur, fiche, tournoi, poule, journée, partie, manche, belle, duel, classement, demie, finale, cadence, variante, casaque, partant | get, set, is, build, render, show, add, remove, update, save, load, read, start, check, compute, generate, resolve, apply, merge, fetch, export |

**Les clés enregistrées ne suivent pas cette règle** et ne doivent pas changer :
`tournament`, `players`, `matches`, `played`, `semifinalMatches`, `finalMatches`,
`round`, `num`… Elles sont dans le KV de tous les tournois existants ; les
renommer les rendrait illisibles. La variable du navigateur s'appelle `tournoi`,
la clé qu'elle produit reste `tournament` — la frontière est dans `getEtatCourant()`
et `applyEtat()`.

---

## Les messages

Aucun `alert()` : ils bloquent l'onglet, s'affichent hors de la page et ne
peuvent rien montrer de long. À la place, `notice.js` empile des bandeaux en haut
à droite :

- **information** et **succès** s'effacent au bout de cinq secondes ;
- **erreur** reste jusqu'à ce qu'on la ferme — elle porte parfois la liste de ce
  qui a échoué, qu'on veut pouvoir relire.

`confirm()` et `prompt()` **restent** : ils ne montrent pas un message, ils posent
une question et gardent une action destructrice (régénérer un calendrier,
supprimer un tournoi, tout effacer). Les remplacer demanderait une fenêtre maison,
et affaiblirait ces garde-fous entre-temps. Un test relève où ils subsistent, pour
que leur nombre ne grossisse pas sans qu'on le veuille.

---

## Sauvegarde et restauration

Tout se passe sur **`/sauvegarde`** : une sauvegarde contient les tournois *et*
les fiches des joueurs, elle n'appartient donc à aucune des deux listes.

- **⬇️ Tout exporter** — télécharge `sauvegarde-<horodatage>.json` : l'état
  complet de chaque tournoi, plus **toutes** les fiches — y compris celles
  qu'aucun tournoi ne cite. L'export relit la liste des joueurs au moment du
  clic plutôt que de se fier à ce que la page a chargé : sinon un clic rapide
  produisait un fichier sans aucune fiche.
- **⬆️ Importer une sauvegarde** — ouvre un fichier et **affiche d'abord ce qu'il
  ferait**, ligne par ligne : chaque tournoi (marqué *nouveau* ou *remplacé*) et
  chaque joueur, nommés, avec une case à cocher — tout est coché au départ, on
  décoche ce qu'on ne veut pas. Rien n'est écrit avant « Restaurer ».

  **Une fiche réclamée par un tournoi coché ne peut pas être décochée** : sans
  elle, ses partants s'afficheraient comme supprimés. La ligne indique alors quel
  tournoi la réclame, et la case redevient libre dès qu'on décoche ce tournoi.
- **🧨 Tout effacer** — supprime tous les tournois et toutes les fiches. Comme
  c'est définitif et visible par tous, un `confirm()` serait trop léger : il faut
  **écrire le mot `EFFACER`**. Un tournoi qui résiste n'arrête pas les autres, et
  la liste des échecs est affichée.

Aucune route d'export ou d'import n'a été ajoutée au Worker : la page se sert de
`/tournaments` et `/state?id=…`, qu'elle utilise déjà. Rien de nouveau n'est donc
exposé — l'import reste, comme le reste de l'app, à la portée de qui a le lien.

Chaque tournoi est réécrit avec la version que le serveur annonce à l'instant :
la restauration n'entre pas en conflit (409) avec l'état en place, elle le
remplace franchement. Si un tournoi échoue, les autres passent quand même et la
liste des échecs est affichée.

Depuis que les joueurs vivent hors des tournois, la sauvegarde **embarque aussi
leurs fiches** (format `version: 2`) : sans elles, des tournois qui ne stockent
que des renvois seraient illisibles. À l'import, les fiches du fichier font foi,
celles qui n'y figurent pas sont conservées. Les fichiers `version: 1` restent
lisibles.

**Ce que l'export ne contient pas** : les tournois sans aucun partant inscrit
(l'API ne les liste pas) et l'ancienne clé sans identifiant, vestige des
premières versions.

### Le format

Un seul fichier JSON indenté, tournois triés par identifiant, états décodés :

```json
{
  "format": "grand-prix-des-echecs/sauvegarde",
  "version": 1,
  "exporteLe": "2026-09-04T09:10:49.142Z",
  "tournois": {
    "tournoi-des-potes": { "version": 3, "updatedAt": "…", "state": { … } }
  }
}
```

Les états sont écrits décodés plutôt qu'en chaînes échappées : une sauvegarde se
lit, se compare et se corrige à la main. Le tri rend l'export déterministe — deux
sauvegardes d'un contenu inchangé donnent le même fichier, donc aucun diff
parasite si on les archive.

Pourquoi JSON et pas autre chose : à cette échelle (quelques tournois de quelques
Ko), NDJSON mettrait chaque tournoi sur une ligne unique — pire en diff ; CBOR ou
MessagePack échangeraient la lisibilité contre des Ko ; SQLite serait un moteur de
base pour une poignée de clés. Si le volume devenait un problème, `gzip` sur le
même fichier.

---

## Choses à savoir

- **L'identifiant n'est pas un secret.** Pas d'authentification : qui a le lien peut
  lire *et* modifier. C'est voulu — c'est un tournoi entre amis, pas un coffre-fort.
- **CORS grand ouvert** (`Access-Control-Allow-Origin: *`), à restreindre au domaine
  le jour où ça compte.
- **Les noms viennent d'autrui.** Une fiche de joueur est modifiable par quiconque
  a le lien : son nom n'est jamais injecté brut dans la page. Un test le vérifie
  sur chaque écran — classement, cartes de duel, menus de résultat, demies,
  finale, podium, listes.
- **Au-delà de 100 tournois**, `list()` en rend 100, dans l'ordre alphabétique
  des clés : ce ne sont pas « les plus récents », et la page le dit ainsi.
- **Un partant dont la fiche a été supprimée** garde le nom recopié à son
  inscription et porte la mention « fiche supprimée » au classement : sans elle,
  on ne comprendrait pas pourquoi le renommer reste sans effet.
- **« Donner le départ » régénère tout le calendrier** et efface les résultats.
  L'app demande confirmation dès qu'une manche a été jouée.
- Les tournois **sans aucun partant inscrit** n'apparaissent pas dans la liste.
