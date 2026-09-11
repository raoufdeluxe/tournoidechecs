#!/usr/bin/env python3
"""Exporte les tournois de l'application vers un document Grist.

Ce n'est pas une fonctionnalité de l'application — c'est une opération qu'on
fait à la main, au moment d'une bascule ou d'une reprise. D'où le script.

Il lit par l'API du tournoi (la même que le navigateur), donc il marche aussi
bien sur `wrangler dev` que sur l'adresse déployée, et n'a besoin d'aucun secret
Cloudflare. Il écrit dans Grist par « ajouter ou mettre à jour » : relancé deux
fois, il n'empile rien.

    python3 outils/vers-grist.py --app http://127.0.0.1:8787 --env .dev.vars
    python3 outils/vers-grist.py --app https://echecs.exemple.workers.dev --env .dev.vars --pousse

--refaire supprime les tables, les recrée au modèle et reverse tout : c'est ce
qu'on fait après un changement de modèle, quand compléter ne suffit plus.

Sans --pousse, il ne fait que dire ce qu'il enverrait. Le modèle est celui du
miroir du Worker, au champ près : voir TABLES plus bas.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request


def lire_env(chemin):
    """Charge un fichier dotenv (.dev.vars, .env.grist) dans l'environnement."""
    if not chemin or not os.path.exists(chemin):
        return
    for ligne in open(chemin, encoding="utf-8"):
        ligne = ligne.strip()
        if not ligne or ligne.startswith("#") or "=" not in ligne:
            continue
        cle, _, valeur = ligne.partition("=")
        os.environ.setdefault(cle.strip(), valeur.strip().strip('"').strip("'"))


class Echec(Exception):
    """Une panne dite en une phrase, pas en pile d'appels."""


# Cloudflare refuse « Python-urllib » sur son contrôle d'intégrité (erreur 1010) :
# une requête sans nom se fait rejeter avant d'atteindre le Worker. On se nomme.
NOM_CLIENT = "grand-prix-des-echecs/outils"


def appel(url, methode="GET", corps=None, entetes=None):
    donnees = json.dumps(corps).encode() if corps is not None else None
    requete = urllib.request.Request(url, data=donnees, method=methode)
    requete.add_header("Content-Type", "application/json")
    requete.add_header("User-Agent", NOM_CLIENT)
    for nom, valeur in (entetes or {}).items():
        requete.add_header(nom, valeur)

    try:
        with urllib.request.urlopen(requete, timeout=30) as reponse:
            texte = reponse.read().decode()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace").strip()[:200]
        raise Echec(f"{methode} {url}\n  → {e.code} {e.reason}"
                    + (f"\n  → {detail}" if detail else "")) from None
    except urllib.error.URLError as e:
        raise Echec(f"{url} est injoignable : {e.reason}") from None
    except OSError as e:
        # Connexion coupée en cours de route : ça n'a pas à sortir en pile.
        raise Echec(f"{url} a coupé la communication : {e}") from None

    if not texte:
        return {}
    try:
        return json.loads(texte)
    except json.JSONDecodeError:
        # Le cas le plus fréquent : l'adresse mène à une page, pas à l'API.
        raise Echec(
            f"{methode} {url}\n  → la réponse n'est pas du JSON, mais :\n"
            f"    {texte.strip()[:120]}…\n"
            "  L'adresse doit être celle de l'API, de la forme\n"
            "    https://TON-INSTANCE/api/docs/<identifiant du document>\n"
            "  et non l'adresse de la page du document."
        ) from None


# --- Ce que l'application sait ----------------------------------------------

def manches_du_tournoi(etat):
    """Toutes les manches, avec leur phase, leur duel et leur journée.

    Le duel se nomme dans sa phase : en poule par la paire qui s'affronte, en
    demie par le numéro de la demie, et la finale est seule de sa phase. Avec la
    phase et le rang, il fait la clé naturelle d'une manche."""
    tournoi = (etat or {}).get("tournament") or {}
    paire = lambda m: f"{min(m['player1'], m['player2'])}-{max(m['player1'], m['player2'])}"
    manches = [("poule", paire(m), m.get("round"), m) for m in tournoi.get("matches") or []]
    for i, demie in enumerate(tournoi.get("semifinalMatches") or []):
        manches += [("demie", str(i + 1), None, m) for m in demie.get("matches") or []]
    manches += [("finale", "1", None, m) for m in tournoi.get("finalMatches") or []]
    return manches


def lignes_des_partants(identifiant, etat):
    """Un joueur dans un tournoi : son indice et sa fiche, rien de plus.

    Table d'association pure : le nom et l'Elo sont dans Joueurs, et le podium
    se recalcule des manches. Rien de calculable ne s'écrit ici."""
    tournoi = (etat or {}).get("tournament") or {}
    return [{
        "require": {"Cle": f"{identifiant}:{p.get('id')}"},
        "fields": {"Tournoi": identifiant, "Indice": p.get("id"), "Ref": p.get("ref")},
    } for p in tournoi.get("players") or []]


def lignes_des_manches(identifiant, etat):
    def partant(indice):
        """Une manche oppose deux PARTANTS, pas deux fiches : c'est Partants
        qu'elle désigne, et Joueurs se rejoint derrière par la ref."""
        return None if indice is None else f"{identifiant}:{indice}"

    def rang(m):
        """Le rang de la manche dans son duel, quelle que soit la phase : l'aller
        et le retour d'une poule sont la même notion que les manches 1 et 2 d'une
        demie, et la belle en est la troisième."""
        if m.get("num") is not None:
            return m["num"]
        return 2 if str(m.get("id", "")).endswith("leg2") else 1

    def cotes(m):
        """Les deux joueurs, les blancs d'abord. Les couleurs alternent d'une
        manche à l'autre : le premier nommé a les blancs aux manches impaires, le
        second aux paires. Aux manches 1 et 2, cela revient à dire que les blancs
        sont ceux qui reçoivent — la règle qu'affichent les pions des cartes."""
        a, b = m.get("player1"), m.get("player2")
        return (a, b) if rang(m) % 2 == 1 else (b, a)

    def resultat(m, blancs):
        """B si les blancs gagnent, N si les noirs gagnent, E en cas d'égalité."""
        p1, p2 = m.get("player1Score"), m.get("player2Score")
        if p1 is None:
            return None
        if p1 == p2:
            return "E"
        gagnant = m.get("player1") if p1 > p2 else m.get("player2")
        return "B" if gagnant == blancs else "N"

    lignes = []
    for phase, duel, journee, m in manches_du_tournoi(etat):
        cc = m.get("analyse") or {}
        blancs, noirs = cotes(m)
        lignes.append({
            "require": {"Cle": f"{identifiant}:{phase}:{duel}:{rang(m)}"},
            "fields": {
                "Tournoi": identifiant,
                "Phase": phase,
                "Duel": duel,
                "Journee": journee,
                "Manche": rang(m),
                "Blancs": partant(blancs),
                "Noirs": partant(noirs),
                "Resultat": resultat(m, blancs),
                "Cadence": m.get("cadence"),
                "Variante": m.get("variante"),
                "Lien": m.get("lien"),
                "CC_Blancs": cc.get("blancs"),
                "CC_Noirs": cc.get("noirs"),
                "CC_Issue": cc.get("resultat"),
                "CC_Fin": cc.get("fin"),
                "CC_Coups": cc.get("coups"),
            },
        })
    return lignes


def ligne_du_tournoi(identifiant, enveloppe):
    """Le nom et la version, et rien d'autre.

    Rien de calculable ne s'y écrit : le podium se refait des manches, le nombre
    de partants se compte dans Partants, et l'état complet ne s'écrit plus en
    JSON — les quatre tables le portent."""
    tournoi = (enveloppe.get("state") or {}).get("tournament") or {}
    return [{
        "require": {"Tournoi": identifiant},
        "fields": {
            "Nom": tournoi.get("name"),
            "Version": enveloppe.get("version"),
            "Maj": enveloppe.get("updatedAt"),
        },
    }]


def lignes_des_joueurs(joueurs):
    return [{
        "require": {"Ref": j.get("id")},
        "fields": {"Nom": j.get("nom"), "Elo": j.get("elo"), "Pseudo": j.get("pseudo")},
    } for j in joueurs]


# --- Le document -------------------------------------------------------------
#
# Le modèle : l'identifiant de chaque colonne et son type. Le poser par l'API
# évite la trentaine de renommages à la main dans Grist — et surtout les
# identifiants approximatifs, que le versement ne pardonnerait pas.
#
# Quatre tables qui se joignent, et aucune colonne qui porte du JSON : elles
# suffisent à elles seules, un tournoi s'y verse et s'en rebâtit à l'identique.
#
#     Joueurs (Ref) ←── Partants (Cle) ──→ Tournois (Tournoi)
#                          ↑
#                          └───────────── Manches.Blancs / Noirs
#
# Une manche désigne deux PARTANTS, pas deux fiches : un tournoi d'avant les
# fiches se lit donc comme les autres. Partants dit qui est inscrit à quoi — un
# joueur DANS un tournoi, avec son indice et son rang au podium ; le nom et
# l'Elo restent dans Joueurs, sans quoi Nom dépendrait de Ref et non du partant,
# la dépendance transitive que la 3e forme normale interdit.
#
# Dans Grist, ces colonnes de clés se convertissent en colonnes Référence : la
# table affiche alors les noms tout en gardant le lien.

TABLES = {
    "Joueurs": [("Ref", "Text"), ("Nom", "Text"), ("Elo", "Int"), ("Pseudo", "Text")],
    # « Tournoi » et non « Id » : Grist tient déjà un identifiant de ligne
    # nommé id, et une colonne qui s'en approche se fait refuser en silence.
    "Tournois": [("Tournoi", "Text"), ("Nom", "Text"), ("Version", "Int"), ("Maj", "Text")],
    "Partants": [("Cle", "Text"), ("Tournoi", "Text"), ("Indice", "Int"), ("Ref", "Text")],
    "Manches": [("Cle", "Text"), ("Tournoi", "Text"),
                # La phase, le duel dans cette phase, et le rang de la manche
                # dans ce duel : les trois font la clé naturelle.
                ("Phase", "Text"), ("Duel", "Text"), ("Journee", "Int"), ("Manche", "Int"),
                # Les deux partants, du côté de leur couleur : Manches joint
                # Partants, qui joint Joueurs par la ref.
                ("Blancs", "Text"), ("Noirs", "Text"),
                # B, N ou E : les blancs, les noirs, ou l'égalité.
                ("Resultat", "Text"),
                ("Cadence", "Text"), ("Variante", "Text"), ("Lien", "Text"),
                ("CC_Blancs", "Text"), ("CC_Noirs", "Text"), ("CC_Issue", "Text"),
                ("CC_Fin", "Text"), ("CC_Coups", "Int")],
}


def colonnes(noms):
    return [{"id": c, "fields": {"label": c, "type": t}} for c, t in noms]


def entetes_de(cle):
    return {"Authorization": "Bearer " + cle}


def tables_presentes(doc, cle):
    return {t["id"] for t in appel(f"{doc}/tables", entetes=entetes_de(cle)).get("tables", [])}


def verifie_colonnes(doc, cle, nom, attendues):
    """Grist rend 200 même quand il n'a pas créé ce qu'on demandait — un nom qui
    lui déplaît, par exemple. On relit plutôt que de le croire : sans cela,
    l'outil annonce « complétée » et le versement échoue juste après."""
    apres = {c["id"] for c in
             appel(f"{doc}/tables/{nom}/columns", entetes=entetes_de(cle)).get("columns", [])}
    refusees = [c for c in attendues if c not in apres]
    if refusees:
        raise Echec(
            f"Grist n'a pas créé dans « {nom} » : {', '.join(refusees)}.\n"
            "  Il a répondu 200 sans rien faire — un nom de colonne qu'il refuse.\n"
            "  Crée-les à la main dans Grist (Raw Data → COLUMN ID), ou dis-le moi."
        )


def cree_table(doc, cle, nom, modele):
    appel(f"{doc}/tables", "POST",
          {"tables": [{"id": nom, "columns": colonnes(modele)}]}, entetes_de(cle))
    verifie_colonnes(doc, cle, nom, [c for c, _ in modele])


def preparer(doc, cle, pousse):
    """Met le document en état : les tables manquantes sont créées, et celles
    qui existent reçoivent les colonnes qui leur manquent. Rien n'est supprimé,
    rien n'est renommé — une table déjà remplie garde ce qu'elle a en plus."""
    presentes = tables_presentes(doc, cle)
    gestes = 0

    for nom, modele in TABLES.items():
        if nom not in presentes:
            print(f"  + table {nom} ({len(modele)} colonnes)")
            gestes += 1
            if pousse:
                cree_table(doc, cle, nom, modele)
            continue

        # La table est là : reste à savoir si ses colonnes le sont.
        deja = {c["id"] for c in
                appel(f"{doc}/tables/{nom}/columns", entetes=entetes_de(cle)).get("columns", [])}
        manquantes = [(c, t) for c, t in modele if c not in deja]
        if not manquantes:
            print(f"  = table {nom} déjà complète")
            continue

        print(f"  ~ table {nom} : {len(manquantes)} colonne(s) à ajouter "
              f"({', '.join(c for c, _ in manquantes)})")
        gestes += 1
        if not pousse:
            continue

        appel(f"{doc}/tables/{nom}/columns", "PUT", {"columns": colonnes(manquantes)}, entetes_de(cle))
        verifie_colonnes(doc, cle, nom, [c for c, _ in manquantes])

    return gestes


# --- Le chemin du retour -----------------------------------------------------
#
# Un tournoi se rebâtit de ses lignes, sans JSON dans le document. C'est
# l'inverse exact de lignes_des_* ci-dessus, et le même code que
# `etatDepuisLignes()` dans worker.js — un test confronte les deux sur les mêmes
# lignes, pour qu'ils ne divergent pas en silence.
#
# Ce qui ne s'enregistre pas, parce que rien ne le fixe : le nombre de journées
# (c'est la dernière journée de la poule), la journée feuilletée, le vainqueur
# d'une demie (il se rejoue des manches, et quand la finale existe ses deux
# finalistes le disent), le podium (il se recalcule des manches : un tournoi
# terminé rouvre sur sa finale, et le clic qui proclame redonne le même),
# l'écran ouvert, et l'ordre de deux duels d'un même jour.

# Le résultat est écrit du point de vue des blancs ; la manche, elle, nomme ses
# joueurs dans l'ordre du duel. Le rang dit lequel des deux avait les blancs.
POINTS = {"B": (1, 0), "N": (0, 1), "E": (0.5, 0.5)}

CHAMPS_CC = ("CC_Blancs", "CC_Noirs", "CC_Issue", "CC_Fin", "CC_Coups")


def etat_depuis_lignes(tournoi, partants, manches, joueurs=()):
    """Refait l'enveloppe d'un tournoi à partir de ses lignes Grist.

    Le nom et l'Elo d'un partant viennent de sa fiche, et de nulle part
    ailleurs."""
    fiches = {j["Ref"]: j for j in joueurs if j.get("Ref")}
    indice, players = {}, []
    for p in sorted(partants, key=lambda p: p.get("Indice") or 0):
        indice[p["Cle"]] = p["Indice"]
        fiche = fiches.get(p.get("Ref")) if p.get("Ref") else None
        players.append({"id": p["Indice"], "ref": p.get("Ref") or None,
                        "name": (fiche.get("Nom") or None) if fiche else None,
                        "elo": fiche.get("Elo") if fiche else None})

    def refais_manche(l):
        droit = l["Manche"] % 2 == 1
        blancs, noirs = indice.get(l["Blancs"]), indice.get(l["Noirs"])
        player1, player2 = (blancs, noirs) if droit else (noirs, blancs)

        points = POINTS.get(l.get("Resultat"))
        if points is None:
            s1 = s2 = None
        else:
            s1, s2 = points if droit else (points[1], points[0])

        m = {"player1": player1, "player2": player2,
             "player1Score": s1, "player2Score": s2, "played": points is not None}
        if l.get("Cadence"):
            m["cadence"] = l["Cadence"]
        if l.get("Variante"):
            m["variante"] = l["Variante"]
        if l.get("Lien"):
            m["lien"] = l["Lien"]
        if any(l.get(c) not in (None, "") for c in CHAMPS_CC):
            m["analyse"] = {"blancs": l.get("CC_Blancs") or None, "noirs": l.get("CC_Noirs") or None,
                            "resultat": l.get("CC_Issue") or None, "fin": l.get("CC_Fin") or None,
                            "coups": l.get("CC_Coups")}
        return m

    def de_phase(phase):
        return [l for l in manches if l.get("Phase") == phase]

    # La poule : l'identifiant d'un duel y nomme la paire et l'aller ou le
    # retour, et c'est lui que les cartes et le calendrier désignent.
    poule = sorted(({"id": f"{l['Duel']}-leg{l['Manche']}", **refais_manche(l),
                     "round": l.get("Journee") or 1} for l in de_phase("poule")),
                   key=lambda m: (m["round"], m["id"]))

    demies = []
    for duel in sorted({l["Duel"] for l in de_phase("demie")}):
        lignes = sorted((l for l in de_phase("demie") if l["Duel"] == duel),
                        key=lambda l: l["Manche"])
        manches_du_duel = [{**refais_manche(l), "num": l["Manche"]} for l in lignes]
        demies.append({"players": [manches_du_duel[0]["player1"], manches_du_duel[0]["player2"]],
                       "matches": manches_du_duel, "winner": None})

    finale = [{**refais_manche(l), "num": l["Manche"]}
              for l in sorted(de_phase("finale"), key=lambda l: l["Manche"])]

    # Les finalistes sont les vainqueurs des demies : la finale, quand elle
    # existe, les nomme. Sinon l'affichage des demies les recalcule.
    if finale and len(demies) == 2:
        demies[0]["winner"] = finale[0]["player1"]
        demies[1]["winner"] = finale[0]["player2"]

    t = {
        "name": tournoi.get("Nom") or None,
        "players": players, "matches": poule,
        "semifinalMatches": demies, "finalMatches": finale,
        "totalRounds": max((m["round"] for m in poule), default=0),
        "currentRound": 1,
        # Le podium ne s'enregistre pas : il se recalcule des manches.
        "championId": None, "runnerId": None, "thirdId": None,
    }
    return {"version": tournoi.get("Version"), "updatedAt": tournoi.get("Maj") or None,
            "state": {"tournament": t, "screen": ecran_du_tournoi(t)}}


def ecran_du_tournoi(t):
    """L'écran où rouvrir un tournoi se lit de son avancement."""
    if t["finalMatches"]:
        return "screen-finals"
    if t["semifinalMatches"]:
        return "screen-semifinals"
    if t["matches"]:
        return "screen-tournament"
    return "screen-config"


# --- Repartir de zéro --------------------------------------------------------
#
# Après un changement de modèle, vider les tables ne suffit pas : leurs colonnes
# d'hier restent, et avec elles les vues et les formules qui s'y accrochaient.
# On les supprime donc, et on les recrée au modèle du jour.
#
# Grist n'a pas de DELETE sur une table (grist-core#934, toujours ouverte) :
# c'est l'action « RemoveTable », posée par /apply, qui le fait. Et un document
# doit garder au moins une table — on recrée donc chacune aussitôt supprimée,
# plutôt que de toutes les retirer d'abord.


def refaire_tables(doc, cle, pousse):
    """Supprime les tables du modèle et les recrée vides.

    Les tables, pas leur contenu : les vues, les mises en forme et les colonnes
    d'un modèle passé partent avec. C'est le prix d'un document qui redevient
    exactement le modèle, et rien d'autre."""
    presentes = tables_presentes(doc, cle)

    for nom, modele in TABLES.items():
        if nom in presentes:
            print(f"  − table {nom} supprimée")
            if pousse:
                appel(f"{doc}/apply", "POST", [["RemoveTable", nom]], entetes_de(cle))
        print(f"  + table {nom} recréée ({len(modele)} colonnes)")
        if pousse:
            cree_table(doc, cle, nom, modele)

    return len(TABLES)


# --- Le versement ------------------------------------------------------------

MANQUE_DOC = "Il manque --doc / --cle (ou GRIST_DOC / GRIST_CLE)."

# Le format que la page /sauvegarde de l'application sait relire. Un test vérifie
# qu'il colle encore à celui de public/js/sauvegarde.js.
FORMAT_SAUVEGARDE = "grand-prix-des-echecs/sauvegarde"
VERSION_SAUVEGARDE = 2


def extraire(doc, cle, tournois=None, date=None):
    """Relit le document et en refait une sauvegarde, telle que la page
    /sauvegarde de l'application l'accepte.

    Les fiches jointes sont celles que les tournois extraits citent : sans
    elles, leurs partants s'afficheraient comme supprimés. Les autres ne sont
    pas du voyage — c'est un extrait, pas une sauvegarde du document."""
    lignes = {table: [r.get("fields", {}) for r in
                      appel(f"{doc}/tables/{table}/records", entetes=entetes_de(cle)).get("records", [])]
              for table in TABLES}
    du_tournoi = lambda t, table: [l for l in lignes[table] if l.get("Tournoi") == t]
    connus = {l.get("Tournoi"): l for l in lignes["Tournois"] if l.get("Tournoi")}

    inconnus = [t for t in (tournois or []) if t not in connus]
    if inconnus:
        raise Echec(f"Le document ne contient pas : {', '.join(inconnus)}.\n"
                    f"  Il contient : {', '.join(sorted(connus)) or '(rien)'}.")

    contenu, refs = {}, set()
    for identifiant in sorted(tournois or connus):
        enveloppe = etat_depuis_lignes(connus[identifiant],
                                       du_tournoi(identifiant, "Partants"),
                                       du_tournoi(identifiant, "Manches"),
                                       lignes["Joueurs"])
        contenu[identifiant] = enveloppe
        refs |= {p["ref"] for p in enveloppe["state"]["tournament"]["players"] if p["ref"]}

    fiches = {l["Ref"]: l for l in lignes["Joueurs"] if l.get("Ref")}
    return {
        "format": FORMAT_SAUVEGARDE,
        "version": VERSION_SAUVEGARDE,
        "exporteLe": (date or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z"),
        "joueurs": [{"id": r, "nom": fiches[r].get("Nom"), "elo": fiches[r].get("Elo"),
                     "pseudo": fiches[r].get("Pseudo")}
                    for r in sorted(refs) if r in fiches],
        "tournois": contenu,
    }


def nom_de_fichier(date=None):
    """Le même nom que l'export de l'application, pour qu'ils se rangent
    ensemble : sauvegarde-2026-09-11T12-00-00.json"""
    horodatage = (date or datetime.now(timezone.utc)).isoformat().replace("+00:00", "Z")
    return "sauvegarde-" + horodatage.replace(":", "-").replace(".", "-")[:19] + ".json"


def verser(app, ecrire, tournois=None):
    """Lit l'application et pose tout dans Grist : les fiches, puis chaque
    tournoi avec ses partants et ses manches."""
    api = app.rstrip("/") + "/api"

    fiches = appel(f"{api}/joueurs").get("joueurs") or []
    comptes = {"fiches": ecrire("Joueurs", lignes_des_joueurs(fiches)),
               "tournois": 0, "partants": 0, "manches": 0}

    liste = appel(f"{api}/tournois").get("tournaments") or []
    for identifiant in tournois or [t["id"] for t in liste]:
        enveloppe = appel(f"{api}/etat?id={urllib.parse.quote(identifiant)}")
        if not (enveloppe.get("state") or {}).get("tournament"):
            print(f"  — {identifiant} : rien d'enregistré, passé")
            continue
        comptes["tournois"] += ecrire("Tournois", ligne_du_tournoi(identifiant, enveloppe))
        comptes["partants"] += ecrire("Partants", lignes_des_partants(identifiant, enveloppe["state"]))
        comptes["manches"] += ecrire("Manches", lignes_des_manches(identifiant, enveloppe["state"]))
        print(f"  ✓ {identifiant}")

    return comptes


def main():
    a = argparse.ArgumentParser(description="Exporte les tournois vers Grist.")
    a.add_argument("--app", help="adresse de l'application (sans /api)")
    a.add_argument("--doc", default=os.environ.get("GRIST_DOC"), help="https://…/api/docs/<id>")
    a.add_argument("--cle", default=os.environ.get("GRIST_CLE"), help="clé d'API Grist")
    a.add_argument("--env", help="fichier dotenv à charger (.dev.vars, .env.grist)")
    a.add_argument("--tournoi", action="append", help="n'exporter que ceux-là (répétable)")
    a.add_argument("--refaire", action="store_true",
                   help="supprime les tables, les recrée au modèle, puis reverse tout")
    a.add_argument("--depuis-grist", metavar="FICHIER", nargs="?", const="",
                   help="sens inverse : relit le document et écrit une sauvegarde JSON "
                        "à injecter dans /sauvegarde (défaut : sauvegarde-<horodatage>.json)")
    a.add_argument("--pousse", action="store_true", help="écrire pour de vrai")
    args = a.parse_args()

    lire_env(args.env)
    doc = args.doc or os.environ.get("GRIST_DOC")
    cle = args.cle or os.environ.get("GRIST_CLE")
    if doc and "/api/docs/" not in doc:
        sys.exit(f"GRIST_DOC vaut « {doc} ».\n"
                 "Ce n'est pas l'adresse de l'API : il y manque /api/docs/.\n"
                 "Attendu : https://TON-INSTANCE/api/docs/<identifiant du document>")

    # Le sens inverse : Grist est la source, l'application la destination. Rien
    # n'est écrit dans le document, et --pousse n'a rien à autoriser.
    if args.depuis_grist is not None:
        if not (doc and cle):
            sys.exit(MANQUE_DOC)
        sauvegarde = extraire(doc, cle, args.tournoi)
        fichier = args.depuis_grist or nom_de_fichier()
        with open(fichier, "w", encoding="utf-8") as f:
            json.dump(sauvegarde, f, ensure_ascii=False, indent=2)
            f.write("\n")
        manches = sum(len(manches_du_tournoi(e["state"])) for e in sauvegarde["tournois"].values())
        print(f"{fichier} : {len(sauvegarde['tournois'])} tournoi(s), "
              f"{manches} manches, {len(sauvegarde['joueurs'])} fiche(s)")
        print("À injecter dans l'application : page Sauvegarde → « Importer une sauvegarde ».")
        return

    if not args.app:
        sys.exit("Il manque --app (l'adresse de l'application).")
    if args.pousse and not (doc and cle):
        sys.exit(MANQUE_DOC)

    def ecrire(table, lignes):
        if lignes and args.pousse:
            appel(f"{doc}/tables/{table}/records", "PUT", {"records": lignes},
                  entetes_de(cle))
        return len(lignes)

    if doc and cle:
        print("Document :")
        if args.refaire:
            # Tout est supprimé puis recréé : le versement qui suit repeuple un
            # document neuf, et non un document qu'on aurait rapiécé.
            refaire_tables(doc, cle, args.pousse)
        else:
            # Le document est mis en état avant d'écrire : une table ou une
            # colonne manquante n'est pas une erreur à corriger à la main, c'est
            # un préalable que l'outil sait remplir. Il n'y a donc pas d'étape à
            # ne pas oublier.
            preparer(doc, cle, args.pousse)
        print()

    comptes = verser(args.app, ecrire, args.tournoi)

    verbe = "Versé dans Grist" if args.pousse else "À verser (essai à blanc)"
    print(f"\n{verbe} : {comptes['tournois']} tournois, {comptes['partants']} partants, "
          f"{comptes['manches']} manches, {comptes['fiches']} fiches")
    if not args.pousse:
        print("Relance avec --pousse pour écrire pour de vrai"
              + (" — les tables seront supprimées, c'est irréversible." if args.refaire else "."))


if __name__ == "__main__":
    try:
        main()
    except Echec as e:
        sys.exit(f"Échec : {e}")
