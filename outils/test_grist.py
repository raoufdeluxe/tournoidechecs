#!/usr/bin/env python3
"""Tests de l'outil Grist.

    python3 outils/test_grist.py

Ils décrivent ce que l'outil fait, pas comment il est écrit : le document est
mis en état avant d'écrire, ce qu'on écrit correspond aux colonnes déclarées, et
une panne se dit en une phrase.
"""

import contextlib
import importlib.util
import io
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Chargé par son chemin : le test tourne aussi bien lancé seul que depuis la
# racine, sans dépendre de ce qu'il y a dans sys.path.
_chemin = Path(__file__).with_name("grist.py")
_spec = importlib.util.spec_from_file_location("grist", _chemin)
outil = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(outil)


class FauxGrist(BaseHTTPRequestHandler):
    """Un document Grist en mémoire : tables, colonnes, lignes reçues."""

    tables = {}
    lignes = {}
    journal = []

    def _repond(self, corps, code=200):
        charge = json.dumps(corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(charge)))
        self.end_headers()
        self.wfile.write(charge)

    def _corps(self):
        taille = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(taille) or b"{}")

    def do_GET(self):
        if self.path.endswith("/tables"):
            return self._repond({"tables": [{"id": t} for t in self.tables]})
        table = self.path.split("/tables/")[1].split("/")[0]
        if self.path.endswith("/records"):
            # Grist rend {id, fields} ; la clé de `require` y est une colonne
            # comme une autre, une fois la ligne posée.
            return self._repond({"records": [
                {"id": i, "fields": {**l.get("require", {}), **l.get("fields", {})}}
                for i, l in enumerate(self.lignes.get(table, []), 1)]})
        self._repond({"columns": [{"id": c} for c in self.tables.get(table, [])]})

    def do_DELETE(self):
        table, _, colonne = self.path.split("/tables/")[1].partition("/columns/")
        self.tables[table] = [c for c in self.tables[table] if c != colonne]
        self.journal.append(("colonne supprimée", table, colonne))
        self._repond({})

    def do_POST(self):
        if self.path.endswith("/apply"):
            for action in self._corps():
                # Grist refuse de laisser un document sans aucune table.
                if action[0] == "RemoveTable":
                    if len(self.tables) == 1:
                        return self._repond({"error": "Cannot remove the last table"}, 400)
                    self.tables.pop(action[1], None)
                    self.lignes.pop(action[1], None)
                    self.journal.append(("table supprimée", action[1]))
            return self._repond({})
        table = self._corps()["tables"][0]
        self.tables[table["id"]] = [c["id"] for c in table["columns"]]
        self.journal.append(("table créée", table["id"]))
        self._repond({})

    def do_PUT(self):
        table = self.path.split("/tables/")[1].split("/")[0]
        corps = self._corps()
        if self.path.endswith("/columns"):
            ajoutees = [c["id"] for c in corps["columns"]]
            self.tables[table] += ajoutees
            self.journal.append(("colonnes ajoutées", table, ajoutees))
        else:
            self.lignes.setdefault(table, []).extend(corps["records"])
            self.journal.append(("lignes", table, len(corps["records"])))
        self._repond({})

    def log_message(self, *args):
        pass


class FauxApp(BaseHTTPRequestHandler):
    """L'API de l'application : ce que l'outil y lit, et ce qu'il y écrit."""

    etats = {}
    fiches = [{"id": "j-alice", "nom": "Alice", "elo": 1500, "pseudo": "A_CC"}]
    recu = []

    def _corps(self):
        taille = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(taille) or b"{}")

    def _repond(self, corps):
        charge = json.dumps(corps).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(charge)))
        self.end_headers()
        self.wfile.write(charge)

    def do_PUT(self):
        self.recu.append(("joueurs", self._corps()))
        self._repond({"version": 2, "updatedAt": None})

    def do_POST(self):
        identifiant = urllib.parse.parse_qs(self.path.partition("?")[2])["id"][0]
        self.recu.append((identifiant, self._corps()))
        self._repond({"version": 2, "updatedAt": None})

    def do_GET(self):
        chemin, _, requete = self.path.partition("?")
        if chemin.endswith("/joueurs"):
            corps = {"version": 1, "joueurs": self.fiches}
        elif chemin.endswith("/tournois"):
            corps = {"tournaments": [{"id": t} for t in self.etats]}
        else:
            identifiant = urllib.parse.parse_qs(requete)["id"][0]
            corps = {"version": 1, "updatedAt": None,
                     "state": self.etats.get(identifiant, {})}
        self._repond(corps)

    def log_message(self, *args):
        pass


def preparer(doc, pousse):
    """Met le document en état sans raconter ce qu'il fait."""
    with contextlib.redirect_stdout(io.StringIO()):
        return outil.preparer(doc, "cle", pousse)


# Un seul faux Grist pour toute la série. Un serveur par test coûtait presque
# une demi-seconde en démarrage et en arrêt — plus que les tests eux-mêmes. Son
# contenu, lui, est remis à neuf avant chacun : c'est l'état qui doit être
# isolé, pas le socket.
SERVEUR = None


SERVEUR_APP = None


def setUpModule():
    global SERVEUR, SERVEUR_APP
    SERVEUR = HTTPServer(("127.0.0.1", 0), FauxGrist)
    SERVEUR_APP = HTTPServer(("127.0.0.1", 0), FauxApp)
    for serveur in (SERVEUR, SERVEUR_APP):
        threading.Thread(target=serveur.serve_forever, daemon=True).start()


def tearDownModule():
    for serveur in (SERVEUR, SERVEUR_APP):
        serveur.shutdown()
        serveur.server_close()


class SurUnFauxGrist(unittest.TestCase):
    def setUp(self):
        FauxGrist.tables = {}
        FauxGrist.lignes = {}
        FauxGrist.journal = []
        # Un test peut remplacer le gestionnaire pour éprouver une panne : on
        # remet celui d'origine, sinon la panne déborderait sur les suivants.
        SERVEUR.RequestHandlerClass = FauxGrist
        self.serveur = SERVEUR
        self.doc = f"http://127.0.0.1:{SERVEUR.server_port}/api/docs/essai"


class MiseEnEtat(SurUnFauxGrist):
    def test_cree_les_tables_absentes(self):
        preparer(self.doc, True)
        self.assertEqual(set(FauxGrist.tables), set(outil.TABLES))
        for nom, modele in outil.TABLES.items():
            self.assertEqual(FauxGrist.tables[nom], [c for c, _ in modele], nom)

    def test_complete_une_table_aux_mauvaises_colonnes(self):
        # Le cas qui a échoué : la table existe, avec les colonnes par défaut.
        FauxGrist.tables = {"Tournois": ["A", "B", "C"]}
        preparer(self.doc, True)
        for colonne, _ in outil.TABLES["Tournois"]:
            self.assertIn(colonne, FauxGrist.tables["Tournois"])
        self.assertEqual(FauxGrist.tables["Tournois"][:3], ["A", "B", "C"],
                         "les colonnes de l'utilisateur ne sont pas touchées")

    def test_relance_sans_rien_faire(self):
        preparer(self.doc, True)
        FauxGrist.journal = []
        gestes = preparer(self.doc, True)
        self.assertEqual(gestes, 0)
        self.assertEqual(FauxGrist.journal, [])

    def test_une_colonne_refusee_en_silence_est_dite(self):
        # Grist rend 200 sans rien créer quand un nom lui déplaît. L'outil doit
        # s'en apercevoir, pas annoncer « complétée » et laisser le versement
        # échouer juste après.
        class Sourd(FauxGrist):
            def do_PUT(self):
                if self.path.endswith("/columns"):
                    self._corps()
                    return self._repond({})       # 200, mais rien n'est créé
                return super().do_PUT()

        self.serveur.RequestHandlerClass = Sourd
        # Seule Tournois est incomplète : c'est d'elle qu'on veut entendre parler.
        FauxGrist.tables = {nom: [c for c, _ in modele] for nom, modele in outil.TABLES.items()}
        FauxGrist.tables["Tournois"] = ["A"]
        with self.assertRaises(outil.Echec) as cas:
            preparer(self.doc, True)
        self.assertIn("n'a pas créé", str(cas.exception))
        self.assertIn("Tournoi", str(cas.exception))

    def test_essai_a_blanc_n_ecrit_rien(self):
        gestes = preparer(self.doc, False)
        self.assertEqual(gestes, len(outil.TABLES))
        self.assertEqual(FauxGrist.tables, {})


class RepartirDeZero(SurUnFauxGrist):
    """--refaire : les tables sont supprimées, pas vidées, puis recréées."""

    def setUp(self):
        super().setUp()
        FauxGrist.tables = {nom: [c for c, _ in modele] for nom, modele in outil.TABLES.items()}
        FauxGrist.tables["Manches"] += ["Nom", "Id"]        # colonnes d'un modèle passé
        FauxGrist.lignes = {"Manches": [{"id": 1}, {"id": 2}], "Tournois": [{"id": 1}]}

    def refaire(self, pousse):
        with contextlib.redirect_stdout(io.StringIO()):
            return outil.refaire_tables(self.doc, "cle", pousse)

    def test_les_tables_sont_supprimees_puis_recreees_au_modele(self):
        self.refaire(True)
        for nom, modele in outil.TABLES.items():
            self.assertIn(("table supprimée", nom), FauxGrist.journal)
            self.assertEqual(FauxGrist.tables[nom], [c for c, _ in modele], nom)

    def test_les_colonnes_d_un_modele_passe_ne_survivent_pas(self):
        # Les vider n'y aurait rien fait : c'est la table qui les portait.
        self.refaire(True)
        self.assertNotIn("Nom", FauxGrist.tables["Manches"])
        self.assertNotIn("Id", FauxGrist.tables["Manches"])

    def test_les_lignes_partent_avec_leur_table(self):
        self.refaire(True)
        self.assertEqual(FauxGrist.lignes.get("Manches", []), [])
        self.assertEqual(FauxGrist.lignes.get("Tournois", []), [])

    def test_une_table_absente_est_simplement_creee(self):
        del FauxGrist.tables["Partants"]
        self.refaire(True)
        self.assertNotIn(("table supprimée", "Partants"), FauxGrist.journal)
        self.assertEqual(FauxGrist.tables["Partants"],
                         [c for c, _ in outil.TABLES["Partants"]])

    def test_l_essai_a_blanc_ne_supprime_rien(self):
        self.refaire(False)
        self.assertEqual(FauxGrist.journal, [])
        self.assertEqual(len(FauxGrist.lignes["Manches"]), 2)
        self.assertIn("Nom", FauxGrist.tables["Manches"])


ETAT = {
    "screen": "screen-tournament",
    "tournament": {
        "name": "Coupe du Dimanche",
        "players": [{"id": 0, "name": "Alice", "ref": "j-alice", "elo": 1500},
                    {"id": 1, "name": "Bob"}],
        "matches": [{"id": "0-1-leg1", "player1": 0, "player2": 1, "round": 1, "played": True,
                     "player1Score": 1, "player2Score": 0, "cadence": "3", "variante": "960",
                     "lien": "https://www.chess.com/game/live/1",
                     "analyse": {"blancs": "Alice_CC", "noirs": "Bob_CC", "resultat": "1-0",
                                 "fin": "abandon", "coups": 41}}],
        "semifinalMatches": [{"matches": [{"player1": 0, "player2": 1, "num": 1, "played": False}]}],
        "finalMatches": [{"player1": 0, "player2": 1, "num": 1, "played": False}],
    },
}


class CeQuOnEcrit(unittest.TestCase):
    def test_les_champs_ecrits_sont_des_colonnes_declarees(self):
        # L'invariant qui protège du « Invalid column » : rien ne part vers
        # Grist qui ne soit dans le modèle déclaré.
        ecrits = {
            "Partants": outil.lignes_des_partants("abc", ETAT),
            "Manches": outil.lignes_des_manches("abc", ETAT),
            "Tournois": outil.ligne_du_tournoi("abc", {"version": 3, "updatedAt": None, "state": ETAT}),
            "Joueurs": outil.lignes_des_joueurs([{"id": "j-a", "nom": "Alice", "elo": 1500, "pseudo": "A_CC"}]),
        }
        for table, lignes in ecrits.items():
            declarees = {c for c, _ in outil.TABLES[table]}
            for ligne in lignes:
                for champ in list(ligne["fields"]) + list(ligne["require"]):
                    self.assertIn(champ, declarees, f"{table}.{champ} n'est pas déclarée")

    def test_toute_colonne_declaree_est_alimentee(self):
        # L'inverse : une colonne que personne ne remplit est une colonne de trop.
        remplies = {"Manches": set(), "Tournois": set(), "Joueurs": set(), "Partants": set()}
        for ligne in outil.lignes_des_manches("abc", ETAT):
            remplies["Manches"] |= set(ligne["fields"]) | set(ligne["require"])
        for ligne in outil.lignes_des_partants("abc", ETAT):
            remplies["Partants"] |= set(ligne["fields"]) | set(ligne["require"])
        for ligne in outil.ligne_du_tournoi("abc", {"version": 3, "updatedAt": None, "state": ETAT}):
            remplies["Tournois"] |= set(ligne["fields"]) | set(ligne["require"])
        for ligne in outil.lignes_des_joueurs([{"id": "j-a", "nom": "A", "elo": 1, "pseudo": "p"}]):
            remplies["Joueurs"] |= set(ligne["fields"]) | set(ligne["require"])

        for table, colonnes in remplies.items():
            self.assertEqual(colonnes, {c for c, _ in outil.TABLES[table]}, table)

    def test_une_manche_par_phase_avec_sa_cle(self):
        lignes = outil.lignes_des_manches("abc", ETAT)
        # tournoi : phase : duel dans la phase : rang de la manche dans le duel
        self.assertEqual([l["require"]["Cle"] for l in lignes],
                         ["abc:poule:0-1:1", "abc:demie:1:1", "abc:finale:1:1"])

    def test_les_manches_designent_des_partants(self):
        poule = outil.lignes_des_manches("abc", ETAT)[0]["fields"]
        # Bob n'a pas de fiche, et sa manche le désigne quand même : c'est le
        # partant qu'elle nomme, pas la fiche. Alice reçoit à l'aller, elle est
        # donc du côté des blancs.
        self.assertEqual((poule["Blancs"], poule["Noirs"]), ("abc:0", "abc:1"))

    def test_tout_partant_cite_par_une_manche_est_inscrit_au_tournoi(self):
        cles = {l["require"]["Cle"] for l in outil.lignes_des_partants("abc", ETAT)}
        for manche in outil.lignes_des_manches("abc", ETAT):
            for cote in ("Blancs", "Noirs"):
                self.assertIn(manche["fields"][cote], cles)

    def test_un_partant_est_un_joueur_dans_un_tournoi(self):
        lignes = outil.lignes_des_partants("abc", ETAT)
        self.assertEqual([l["require"]["Cle"] for l in lignes], ["abc:0", "abc:1"])
        # Une table d'association, rien de plus : c'est Joueurs qui nomme.
        self.assertEqual(lignes[0]["fields"],
                         {"Tournoi": "abc", "Indice": 0, "Ref": "j-alice"})


    def test_le_resultat_s_ecrit_en_couleurs(self):
        etat = json.loads(json.dumps(ETAT))
        duel = etat["tournament"]["matches"][0]
        etat["tournament"]["matches"] = [
            duel,                                                   # aller : le 1er reçoit
            {**duel, "id": "0-1-leg2"},                             # retour : le 2nd reçoit
            {**duel, "id": "0-1-leg3", "player1Score": 0.5, "player2Score": 0.5},
            {**duel, "id": "0-1-leg4", "played": False,
             "player1Score": None, "player2Score": None},
        ]
        # La belle est la 3e manche : les couleurs alternent, elle repart donc
        # comme l'aller — le premier nommé a les blancs.
        etat["tournament"]["semifinalMatches"] = [{"matches": [
            {"player1": 0, "player2": 1, "num": 3, "played": True,
             "player1Score": 1, "player2Score": 0}]}]

        lettres = [l["fields"]["Resultat"] for l in outil.lignes_des_manches("abc", etat)]
        self.assertEqual(lettres, ["B", "N", "E", None, "B", None])

    def test_le_rang_de_la_manche_vaut_pour_toutes_les_phases(self):
        # L'aller et le retour d'une poule sont numérotés comme les manches
        # d'une demie : la colonne dit la même chose partout.
        etat = json.loads(json.dumps(ETAT))
        etat["tournament"]["matches"].append(
            {"id": "0-1-leg2", "player1": 0, "player2": 1, "round": 4, "played": False})
        rangs = {l["require"]["Cle"]: l["fields"]["Manche"]
                 for l in outil.lignes_des_manches("abc", etat)}
        self.assertEqual(rangs["abc:poule:0-1:1"], 1)
        self.assertEqual(rangs["abc:poule:0-1:2"], 2)
        self.assertEqual(rangs["abc:demie:1:1"], 1)

    def test_les_infos_chess_com_suivent_la_manche(self):
        poule = outil.lignes_des_manches("abc", ETAT)[0]["fields"]
        self.assertEqual(poule["CC_Blancs"], "Alice_CC")
        self.assertEqual(poule["CC_Issue"], "1-0")
        self.assertEqual(poule["CC_Coups"], 41)
        demie = outil.lignes_des_manches("abc", ETAT)[1]["fields"]
        self.assertIsNone(demie["CC_Blancs"], "sans partie en ligne, rien")


class UneSeuleCommande(SurUnFauxGrist):
    """--refaire supprime, recrée ET repeuple : les trois, ou rien."""

    def setUp(self):
        super().setUp()
        # Un document au modèle d'hier, déjà rempli.
        FauxGrist.tables = {"Manches": ["Cle", "Joueur1", "Joueur2"], "Tournois": ["Tournoi", "Etat"]}
        FauxGrist.lignes = {"Manches": [{"id": 1}], "Tournois": [{"id": 1}]}
        FauxApp.etats = {"coupe": ETAT}
        self.adresse = f"http://127.0.0.1:{SERVEUR_APP.server_port}"

    def lance(self, *options):
        argv = sys.argv
        sys.argv = ["grist.py", "sync", "kv2grist", "--app", self.adresse,
                    "--doc", self.doc, "--cle", "cle", *options]
        try:
            with contextlib.redirect_stdout(io.StringIO()) as sortie:
                outil.main()
            return sortie.getvalue()
        finally:
            sys.argv = argv

    def test_supprime_recree_et_repeuple_d_un_seul_coup(self):
        self.lance("--refaire", "--pousse")

        # Supprimé : les colonnes d'hier ne sont plus là.
        self.assertIn(("table supprimée", "Manches"), FauxGrist.journal)
        self.assertNotIn("Joueur1", FauxGrist.tables["Manches"])
        self.assertNotIn("Etat", FauxGrist.tables["Tournois"])

        # Recréé : les quatre tables au modèle du jour.
        for nom, modele in outil.TABLES.items():
            self.assertEqual(FauxGrist.tables[nom], [c for c, _ in modele], nom)

        # Repeuplé : le tournoi de l'application est là, une seule fois.
        self.assertEqual(len(FauxGrist.lignes["Tournois"]), 1)
        self.assertEqual(len(FauxGrist.lignes["Joueurs"]), 1)
        self.assertEqual([l["require"]["Cle"] for l in FauxGrist.lignes["Manches"]],
                         ["coupe:poule:0-1:1", "coupe:demie:1:1", "coupe:finale:1:1"])

    def test_sans_pousse_il_ne_touche_a_rien_et_le_dit(self):
        sortie = self.lance("--refaire")
        self.assertEqual(FauxGrist.journal, [])
        self.assertEqual(FauxGrist.tables["Manches"], ["Cle", "Joueur1", "Joueur2"])
        self.assertIn("irréversible", sortie)


class LesDeuxSens(SurUnFauxGrist):
    """`sync kv2grist` et `sync grist2kv` : le sens est l'argument."""

    def setUp(self):
        super().setUp()
        FauxApp.etats = {"coupe": ETAT}
        FauxApp.recu = []
        self.adresse = f"http://127.0.0.1:{SERVEUR_APP.server_port}"

    def lance(self, *options):
        argv = sys.argv
        sys.argv = ["grist.py", *options, "--app", self.adresse,
                    "--doc", self.doc, "--cle", "cle"]
        try:
            with contextlib.redirect_stdout(io.StringIO()) as sortie:
                outil.main()
            return sortie.getvalue()
        finally:
            sys.argv = argv

    def test_kv2grist_verse_l_application_dans_le_document(self):
        self.lance("sync", "kv2grist", "--pousse")
        self.assertEqual([l["require"]["Cle"] for l in FauxGrist.lignes["Manches"]],
                         ["coupe:poule:0-1:1", "coupe:demie:1:1", "coupe:finale:1:1"])
        self.assertEqual(FauxApp.recu, [], "rien n'est écrit dans l'application")

    def test_grist2kv_reinjecte_le_document_dans_l_application(self):
        self.lance("sync", "kv2grist", "--pousse")      # le document a de quoi relire
        FauxGrist.journal = []
        self.lance("sync", "grist2kv", "--pousse")

        # Les fiches d'abord : sans elles, les partants seraient dits supprimés.
        self.assertEqual(FauxApp.recu[0][0], "joueurs")
        self.assertEqual([f["id"] for f in FauxApp.recu[0][1]["joueurs"]], ["j-alice"])

        identifiant, corps = FauxApp.recu[1]
        self.assertEqual(identifiant, "coupe")
        self.assertEqual(corps["baseVersion"], 1, "la version relue juste avant d'écrire")
        t = corps["state"]["tournament"]
        self.assertEqual(t["name"], "Coupe du Dimanche")
        self.assertEqual(len(t["matches"]), 1)
        self.assertEqual(FauxGrist.journal, [], "rien n'est écrit dans le document")

    def test_sans_pousse_aucun_des_deux_sens_n_ecrit(self):
        self.lance("sync", "kv2grist")
        self.lance("sync", "grist2kv")
        self.assertEqual(FauxApp.recu, [])
        self.assertEqual(FauxGrist.journal, [])

    def test_un_sens_manquant_se_dit(self):
        for oubli in ([], ["sync"]):
            with self.assertRaises(SystemExit) as cas:
                self.lance(*oubli)
            self.assertIn("kv2grist", str(cas.exception), oubli)
            self.assertIn("grist2kv", str(cas.exception), oubli)
        self.assertEqual(FauxApp.recu, [])
        self.assertEqual(FauxGrist.journal, [])

    def test_le_fichier_arrete_grist2kv_avant_l_application(self):
        self.lance("sync", "kv2grist", "--pousse")      # le document a de quoi relire
        with tempfile.TemporaryDirectory() as dossier:
            chemin = Path(dossier) / "extrait.json"
            self.lance("sync", "grist2kv", "--fichier", str(chemin))
            sauvegarde = json.loads(chemin.read_text(encoding="utf-8"))

        self.assertEqual(list(sauvegarde["tournois"]), ["coupe"])
        # Les fiches font le voyage : sans elles, les partants seraient dits supprimés.
        self.assertEqual([f["id"] for f in sauvegarde["joueurs"]], ["j-alice"])
        self.assertEqual(FauxApp.recu, [], "l'application n'est pas touchée")

    def test_le_fichier_ne_vaut_que_pour_le_sens_qui_lit_le_document(self):
        with self.assertRaises(SystemExit) as cas:
            self.lance("sync", "kv2grist", "--fichier", "nawak.json")
        self.assertIn("grist2kv", str(cas.exception))


@unittest.skipUnless(shutil.which("node"), "node n'est pas là")
class LAllerRetour(unittest.TestCase):
    """Les quatre tables suffisent : un tournoi versé s'en rebâtit à l'identique.

    L'outil écrit les lignes, le widget les relit — deux implémentations des
    mêmes règles, dans deux langages. Elles finiraient par diverger, et ce serait
    en silence. On les confronte donc sur un tournoi allé jusqu'au bout : poule,
    demie avec sa belle, finale, et une partie relue sur chess.com."""

    # Le lecteur vit dans le widget, un script classique : on l'évalue comme la
    # page le ferait, plutôt que de lui faire un fichier pour un test.
    SCRIPT = """
        import { readFileSync } from 'node:fs';
        const etatDepuisLignes = new Function(
            readFileSync('./public/grist/widget-tournoi.js', 'utf8')
            + '; return etatDepuisLignes;')();
        const [tournoi, partants, manches, joueurs] = JSON.parse(process.argv[1]);
        console.log(JSON.stringify(etatDepuisLignes(tournoi, partants, manches, joueurs)));
    """

    def relit_avec_le_widget(self, *lignes):
        node = subprocess.run(["node", "--input-type=module", "-e", self.SCRIPT, json.dumps(lignes)],
                              cwd=_chemin.parent.parent, capture_output=True, text=True)
        self.assertEqual(node.returncode, 0, node.stderr)
        return json.loads(node.stdout)

    def setUp(self):
        reglages = {"cadence": "10", "variante": "classique"}
        duel = lambda i, a, b, r, s1, s2, **plus: dict(
            id=i, player1=a, player2=b, round=r, played=s1 is not None,
            player1Score=s1, player2Score=s2, **reglages, **plus)
        manche = lambda a, b, num, s1, s2: dict(
            player1=a, player2=b, num=num, played=True,
            player1Score=s1, player2Score=s2, **reglages)

        self.fiches = [{"id": f"j-{n.lower()}", "nom": n, "elo": 1500 + i, "pseudo": None}
                       for i, n in enumerate(["Alice", "Bob", "Carl", "Dan"])]
        self.etat = {
            # Le podium ne s'enregistre pas : le tournoi rouvre sur sa finale.
            "screen": "screen-finals",
            "tournament": {
                "name": "Coupe",
                "players": [{"id": i, "ref": f["id"], "name": f["nom"], "elo": f["elo"]}
                            for i, f in enumerate(self.fiches)],
                "matches": [
                    duel("0-1-leg1", 0, 1, 1, 1, 0),
                    duel("2-3-leg1", 2, 3, 1, 0.5, 0.5),
                    duel("0-2-leg2", 0, 2, 4, 0, 1,
                         lien="https://www.chess.com/game/live/9",
                         analyse={"blancs": "A_CC", "noirs": "C_CC", "resultat": "0-1",
                                  "fin": "mat", "coups": 30}),
                ],
                "semifinalMatches": [
                    # Une demie qui a demandé sa belle.
                    {"players": [0, 3], "winner": 0,
                     "matches": [manche(0, 3, 1, 1, 0), manche(0, 3, 2, 0, 1), manche(0, 3, 3, 1, 0)]},
                    {"players": [1, 2], "winner": 1,
                     "matches": [manche(1, 2, 1, 1, 0), manche(1, 2, 2, 1, 0)]},
                ],
                "finalMatches": [manche(0, 1, 1, 1, 0), manche(0, 1, 2, 1, 0)],
                "totalRounds": 4, "currentRound": 1,
                "championId": None, "runnerId": None, "thirdId": None,
            },
        }
        self.enveloppe = {"version": 7, "updatedAt": "2026-09-11T10:00:00Z", "state": self.etat}
        plat = lambda lignes: [{**l.get("require", {}), **l["fields"]} for l in lignes]
        self.lignes = (
            plat(outil.ligne_du_tournoi("abc", self.enveloppe))[0],
            plat(outil.lignes_des_partants("abc", self.etat)),
            plat(outil.lignes_des_manches("abc", self.etat)),
            plat(outil.lignes_des_joueurs(self.fiches)),
        )

    def test_le_widget_rebatit_le_tournoi_a_l_identique(self):
        self.assertEqual(self.relit_avec_le_widget(*self.lignes), self.enveloppe)

    def test_l_outil_et_le_widget_tombent_sur_le_meme_tournoi(self):
        self.assertEqual(outil.etat_depuis_lignes(*self.lignes),
                         self.relit_avec_le_widget(*self.lignes))


class LeFormatDeSauvegarde(unittest.TestCase):
    """L'extrait s'injecte dans la page /sauvegarde : il en parle la langue."""

    def test_le_format_est_celui_que_la_page_relit(self):
        source = (_chemin.parent.parent / "public" / "js" / "sauvegarde.js").read_text(encoding="utf-8")
        self.assertIn(f"FORMAT_SAUVEGARDE = '{outil.FORMAT_SAUVEGARDE}'", source)
        self.assertIn(f"VERSION_SAUVEGARDE = {outil.VERSION_SAUVEGARDE}", source)


class LExtrait(SurUnFauxGrist):
    """Ce que grist2kv relit du document, avant d'en faire quoi que ce soit."""

    def setUp(self):
        super().setUp()
        FauxGrist.tables = {nom: [c for c, _ in modele] for nom, modele in outil.TABLES.items()}
        enveloppe = {"version": 4, "updatedAt": "2026-09-11T10:00:00Z", "state": ETAT}
        FauxGrist.lignes = {
            "Tournois": outil.ligne_du_tournoi("coupe", enveloppe),
            "Partants": outil.lignes_des_partants("coupe", ETAT),
            "Manches": outil.lignes_des_manches("coupe", ETAT),
            "Joueurs": outil.lignes_des_joueurs([
                {"id": "j-alice", "nom": "Alice", "elo": 1500, "pseudo": "Alice_CC"},
                {"id": "j-zoe", "nom": "Zoé", "elo": None, "pseudo": None}]),
        }

    def extraire(self, tournois=None):
        return outil.extraire(self.doc, "cle", tournois)

    def test_le_document_entier_part_quand_on_ne_choisit_rien(self):
        self.assertEqual(list(self.extraire()["tournois"]), ["coupe"])

    def test_le_tournoi_revient_avec_ses_manches_et_sa_version(self):
        enveloppe = self.extraire()["tournois"]["coupe"]
        self.assertEqual(enveloppe["version"], 4)
        self.assertEqual(enveloppe["updatedAt"], "2026-09-11T10:00:00Z")
        t = enveloppe["state"]["tournament"]
        self.assertEqual(t["name"], "Coupe du Dimanche")
        # Alice a une fiche, Bob non : seul le premier a un nom à retrouver.
        self.assertEqual([p["name"] for p in t["players"]], ["Alice", None])
        self.assertEqual(len(t["matches"]), 1)
        self.assertEqual(len(t["semifinalMatches"]), 1)

    def test_seules_les_fiches_que_le_tournoi_cite_font_le_voyage(self):
        # Zoé n'est inscrite nulle part : c'est un extrait, pas une sauvegarde
        # du document entier.
        fiches = self.extraire()["joueurs"]
        self.assertEqual([f["id"] for f in fiches], ["j-alice"])
        self.assertEqual(fiches[0]["pseudo"], "Alice_CC", "le pseudo chess.com suit la fiche")

    def test_un_tournoi_absent_du_document_se_dit(self):
        with self.assertRaises(outil.Echec) as cas:
            self.extraire(["nawak"])
        self.assertIn("nawak", str(cas.exception))
        self.assertIn("coupe", str(cas.exception))


class QuandCaTourneMal(SurUnFauxGrist):
    def test_une_reponse_qui_n_est_pas_du_json_est_expliquee(self):
        class PageHtml(BaseHTTPRequestHandler):
            def do_GET(self):
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<!doctype html><html>")
            def log_message(self, *a): pass

        serveur = HTTPServer(("127.0.0.1", 0), PageHtml)
        threading.Thread(target=serveur.serve_forever, daemon=True).start()
        with self.assertRaises(outil.Echec) as cas:
            outil.appel(f"http://127.0.0.1:{serveur.server_port}/api/docs/x/tables")
        self.assertIn("n'est pas du JSON", str(cas.exception))
        self.assertIn("/api/docs/", str(cas.exception))
        serveur.shutdown()

    def test_une_instance_injoignable_le_dit(self):
        with self.assertRaises(outil.Echec) as cas:
            outil.appel("http://127.0.0.1:9/api/docs/x/tables")
        self.assertIn("injoignable", str(cas.exception))


class LeFichierDeReglages(unittest.TestCase):
    def test_lit_un_dotenv_avec_ses_guillemets(self):
        import os, tempfile
        with tempfile.NamedTemporaryFile("w", suffix=".vars", delete=False) as f:
            f.write('# un commentaire\nGRIST_TEST_DOC="https://exemple/api/docs/x"\nGRIST_TEST_CLE=abc\n')
        os.environ.pop("GRIST_TEST_DOC", None)
        os.environ.pop("GRIST_TEST_CLE", None)
        outil.lire_env(f.name)
        self.assertEqual(os.environ["GRIST_TEST_DOC"], "https://exemple/api/docs/x")
        self.assertEqual(os.environ["GRIST_TEST_CLE"], "abc")


if __name__ == "__main__":
    unittest.main(verbosity=2)
