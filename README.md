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

---

## Architecture

```
public/
  index.html      5 écrans (config · poule · demies · finale · résultats)
  styles.css      thème « hippodrome » : casaques colorées, typo sport
  js/
    core.js       état partagé, couleurs, règles de départage
    poule.js      calendrier aller/retour, classement, cartes de duel
    finales.js    demi-finales, grande finale, podium
    tournois.js   identité du tournoi (lien, nom), liste, renommage
    sync.js       sauvegarde versionnée : envois sérialisés, réessai, conflits
worker.js         API + service des fichiers statiques
wrangler.toml     config Cloudflare (Worker + binding KV + [assets])
nix/flake.nix     shell de dev (node + wrangler)
```

Le Worker sert **à la fois** la page et l'API : un chemin relatif suffit côté client,
ce qui survit au renommage du Worker comme à l'ajout d'un domaine perso.

### API

| Route | Réponse |
|---|---|
| `GET /tournaments` | `{ tournaments: [...], complete }` — liste des tournois non vides |
| `GET /state?id=<id>` | `{ version, updatedAt, state }` (`state: null` si inexistant) |
| `POST /state?id=<id>` | corps `{ baseVersion, state }` → `200 { version }`, ou `409` + état courant |
| `DELETE /state?id=<id>` | supprime définitivement le tournoi |

Les identifiants suivent `^[a-z0-9-]{1,64}$`. Une requête sans `id` retombe sur la clé
historique `tournament`, pour qu'un onglet resté sur une ancienne version continue de marcher.

---

## Développement

```bash
# shell de dev (node + wrangler)
nix develop ./nix

# serveur local, sur http://localhost:8787
wrangler dev
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

## Choses à savoir

- **L'identifiant n'est pas un secret.** Pas d'authentification : qui a le lien peut
  lire *et* modifier. C'est voulu — c'est un tournoi entre amis, pas un coffre-fort.
- **CORS grand ouvert** (`Access-Control-Allow-Origin: *`), à restreindre au domaine
  le jour où ça compte.
- **« Donner le départ » régénère tout le calendrier** et efface les résultats.
  L'app demande confirmation dès qu'une manche a été jouée.
- Les tournois **sans aucun partant inscrit** n'apparaissent pas dans la liste.
