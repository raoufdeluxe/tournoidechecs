// Worker Cloudflare : stocke et sert l'état du tournoi (un seul tournoi partagé)
//
// Routes :
// L'API vit sous /api : /joueurs et /tournois sont des pages HTML, et les
// fichiers statiques sont servis avant le Worker — une route d'API portant le
// même chemin qu'une page ne serait jamais atteinte.
//
//   GET    /api/joueurs       -> { version, updatedAt, joueurs }   les joueurs réutilisables
//   POST   /api/joueurs       -> corps { nom, elo? }      crée une fiche -> 201 { version, joueur }
//   PATCH  /api/joueurs/<id>  -> corps { nom?, elo? }     modifie la fiche
//   DELETE /api/joueurs/<id>  ->                          supprime la fiche
//   PUT    /api/joueurs       -> corps { baseVersion, joueurs }   remplace la liste (restauration)
//   GET    /api/tournois      -> { tournaments: [...], complete }  liste des tournois
//   GET    /api/etat?id=<id>  -> { version, updatedAt, state }  (state vaut null si rien n'est enregistré)
//   POST   /api/etat?id=<id>  -> corps { baseVersion, state }
//   DELETE /api/etat?id=<id>  -> supprime définitivement le tournoi
//                   200 + { version } si l'écriture est acceptée
//                   409 + l'état courant si baseVersion n'est plus à jour
//
// Le numéro de version sert à repérer qu'un autre appareil a modifié le tournoi
// entre-temps, au lieu de l'écraser en silence.

const ALLOWED_ORIGIN = "*"; // à restreindre à ton domaine une fois en prod

// Chaque tournoi a sa propre clé. Une requête sans "id" retombe sur l'ancienne clé
// unique, pour qu'un onglet resté sur la page d'avant continue de fonctionner.
const LEGACY_KEY = "tournament";
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

// Les joueurs vivent hors des tournois : une seule liste, sous sa propre clé.
// Un tournoi ne garde qu'un renvoi vers la fiche, si bien qu'un renommage se
// répercute partout — d'où l'intérêt de valider ce qui entre ici.
const PLAYERS_KEY = "players";
const MAX_JOUEURS = 200;

function rosterValide(joueurs) {
  if (!Array.isArray(joueurs) || joueurs.length > MAX_JOUEURS) return false;
  const vus = new Set();
  for (const j of joueurs) {
    if (!j || typeof j !== "object") return false;
    if (typeof j.id !== "string" || !ID_PATTERN.test(j.id)) return false;
    if (vus.has(j.id)) return false; // deux fiches sous le même renvoi
    vus.add(j.id);
    if (typeof j.nom !== "string" || !j.nom.trim() || j.nom.length > 64) return false;
    if (j.elo != null && (typeof j.elo !== "number" || !Number.isFinite(j.elo))) return false;
  }
  return true;
}

// L'identifiant est attribué par le serveur : deux appareils qui créent une
// fiche en même temps ne peuvent pas produire le même renvoi.
function nouvelIdJoueur(existants) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789"; // sans l, o, 0, 1
  const pris = new Set(existants.map((j) => j.id));
  for (let essai = 0; essai < 50; essai++) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = "j-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
    if (!pris.has(id)) return id;
  }
  return "j-" + Date.now().toString(36);
}

function readRoster(raw) {
  const vide = { version: 0, updatedAt: null, joueurs: [] };
  if (!raw) return vide;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.joueurs)) return vide;
    return {
      version: typeof parsed.version === "number" ? parsed.version : 0,
      updatedAt: parsed.updatedAt || null,
      joueurs: parsed.joueurs,
    };
  } catch (e) {
    return vide;
  }
}

// Résumé attaché à la clé KV : il alimente la liste des tournois sans avoir à
// relire chaque état complet. Les métadonnées KV sont limitées à 1 Ko, on reste loin.
function summarize(envelope) {
  const st = envelope.state;
  const t = st && st.tournament;
  return {
    name: (t && t.name) || null,
    screen: (st && st.screen) || null,
    players: t && Array.isArray(t.players) ? t.players.length : 0,
    updatedAt: envelope.updatedAt || null,
  };
}

function keyForRequest(url) {
  const id = url.searchParams.get("id");
  if (!id) return LEGACY_KEY;
  return ID_PATTERN.test(id) ? `tournament:${id}` : null;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// Lit la valeur stockée en tolérant l'ancien format, où l'état était écrit nu,
// sans enveloppe ni version. Un tournoi enregistré avant cette mise à jour
// est donc relu normalement, et repart de la version 0.
function readEnvelope(raw) {
  if (!raw) return { version: 0, updatedAt: null, state: null };

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return { version: 0, updatedAt: null, state: null };
  }

  const isEnvelope =
    parsed && typeof parsed === "object" &&
    typeof parsed.version === "number" && "state" in parsed;

  return isEnvelope ? parsed : { version: 0, updatedAt: null, state: parsed };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Pré-requête CORS envoyée automatiquement par le navigateur
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    // --- Administration des joueurs ------------------------------------------
    if (url.pathname === "/api/joueurs" || url.pathname.startsWith("/api/joueurs/")) {
      const current = readRoster(await env.CHESS_TOURNAMENT.get(PLAYERS_KEY));
      const segments = url.pathname.split("/").filter(Boolean); // ["api","joueurs"] ou ["api","joueurs",id]

      if (segments.length > 3) {
        return new Response("Not found", { status: 404, headers: corsHeaders() });
      }

      // Écrit la liste et renvoie la version qu'elle vient de prendre.
      const ecrire = async (joueurs) => {
        const next = {
          version: current.version + 1,
          updatedAt: new Date().toISOString(),
          joueurs,
        };
        await env.CHESS_TOURNAMENT.put(PLAYERS_KEY, JSON.stringify(next));
        return next;
      };

      const lireCorps = async () => {
        try {
          const corps = await request.json();
          return corps && typeof corps === "object" && !Array.isArray(corps) ? corps : null;
        } catch (e) {
          return null;
        }
      };

      // --- La liste entière ---------------------------------------------------
      if (segments.length === 2) {
        if (request.method === "GET") {
          return json(current);
        }

        // Création d'une fiche. Le serveur attribue l'identifiant : deux
        // appareils qui ajoutent en même temps ne peuvent pas se marcher dessus.
        if (request.method === "POST") {
          const corps = await lireCorps();
          if (!corps) return json({ error: "JSON invalide" }, 400);

          const nom = typeof corps.nom === "string" ? corps.nom.trim() : "";
          if (!nom || nom.length > 64) {
            return json({ error: "Nom de joueur invalide" }, 400);
          }
          if (corps.elo != null && (typeof corps.elo !== "number" || !Number.isFinite(corps.elo))) {
            return json({ error: "Elo invalide" }, 400);
          }
          if (current.joueurs.length >= MAX_JOUEURS) {
            return json({ error: "Liste de joueurs pleine" }, 409);
          }
          // Deux fiches homonymes seraient indiscernables dans les menus.
          if (current.joueurs.some((j) => j.nom.toLowerCase() === nom.toLowerCase())) {
            return json({ error: "Ce joueur existe déjà", joueur: current.joueurs.find((j) => j.nom.toLowerCase() === nom.toLowerCase()) }, 409);
          }

          const joueur = { id: nouvelIdJoueur(current.joueurs), nom, elo: corps.elo == null ? null : corps.elo };
          const next = await ecrire([...current.joueurs, joueur]);
          return json({ version: next.version, updatedAt: next.updatedAt, joueur }, 201);
        }

        // Remplacement de toute la liste : sert à la restauration d'une sauvegarde.
        if (request.method === "PUT") {
          const corps = await lireCorps();
          if (!corps) return json({ error: "JSON invalide" }, 400);
          if (!rosterValide(corps.joueurs)) {
            return json({ error: "Liste de joueurs invalide" }, 400);
          }
          if (typeof corps.baseVersion === "number" && corps.baseVersion !== current.version) {
            return json({ error: "conflit", ...current }, 409);
          }
          const next = await ecrire(corps.joueurs);
          return json({ version: next.version, updatedAt: next.updatedAt });
        }

        return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
      }

      // --- Une fiche en particulier -------------------------------------------
      const id = segments[2];
      const index = current.joueurs.findIndex((j) => j.id === id);
      if (index === -1) {
        return json({ error: "Joueur introuvable" }, 404);
      }

      if (request.method === "GET") {
        return json({ version: current.version, joueur: current.joueurs[index] });
      }

      if (request.method === "PATCH") {
        const corps = await lireCorps();
        if (!corps) return json({ error: "JSON invalide" }, 400);

        const joueur = { ...current.joueurs[index] };

        if (corps.nom !== undefined) {
          const nom = typeof corps.nom === "string" ? corps.nom.trim() : "";
          if (!nom || nom.length > 64) return json({ error: "Nom de joueur invalide" }, 400);
          const homonyme = current.joueurs.some(
            (j) => j.id !== id && j.nom.toLowerCase() === nom.toLowerCase());
          if (homonyme) return json({ error: "Ce joueur existe déjà" }, 409);
          joueur.nom = nom;
        }

        if (corps.elo !== undefined) {
          if (corps.elo != null && (typeof corps.elo !== "number" || !Number.isFinite(corps.elo))) {
            return json({ error: "Elo invalide" }, 400);
          }
          joueur.elo = corps.elo == null ? null : corps.elo;
        }

        const joueurs = [...current.joueurs];
        joueurs[index] = joueur;
        const next = await ecrire(joueurs);
        return json({ version: next.version, updatedAt: next.updatedAt, joueur });
      }

      if (request.method === "DELETE") {
        // La fiche disparaît, les tournois qui la référencent restent lisibles :
        // ils ont gardé le nom au moment de l'inscription.
        const next = await ecrire(current.joueurs.filter((j) => j.id !== id));
        return json({ version: next.version, updatedAt: next.updatedAt, deleted: true });
      }

      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    // /tournaments reste accepté : un onglet resté sur une ancienne page l'appelle.
    if ((url.pathname === "/api/tournois" || url.pathname === "/tournaments") && request.method === "GET") {
      const listing = await env.CHESS_TOURNAMENT.list({ prefix: "tournament:", limit: 100 });
      const tournaments = [];

      for (const entry of listing.keys) {
        // list() est mis en cache jusqu'à 60 s côté Cloudflare : une clé supprimée
        // peut encore y figurer. On relit chaque clé — la lecture directe, elle,
        // reflète la suppression immédiatement — pour ne lister que ce qui existe.
        const raw = await env.CHESS_TOURNAMENT.get(entry.name);
        if (!raw) continue;

        const meta = summarize(readEnvelope(raw));
        // On masque les tournois vides (créés puis abandonnés avant toute inscription).
        if (!meta.players) continue;
        tournaments.push({ id: entry.name.slice("tournament:".length), ...meta });
      }

      tournaments.sort((a, b) =>
        String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

      return json({ tournaments, complete: listing.list_complete });
    }

    // /state reste accepté au même titre, pour la même raison.
    if (url.pathname !== "/api/etat" && url.pathname !== "/state") {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const key = keyForRequest(url);
    if (!key) {
      return json({ error: "Identifiant de tournoi invalide" }, 400);
    }

    if (request.method === "GET") {
      return json(readEnvelope(await env.CHESS_TOURNAMENT.get(key)));
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return json({ error: "JSON invalide" }, 400);
      }

      const current = readEnvelope(await env.CHESS_TOURNAMENT.get(key));
      const versioned =
        body && typeof body === "object" && typeof body.baseVersion === "number";

      // Écriture versionnée : refusée si le tournoi a bougé depuis la lecture du client.
      if (versioned && body.baseVersion !== current.version) {
        return json({ error: "conflit", ...current }, 409);
      }

      const next = {
        version: current.version + 1,
        updatedAt: new Date().toISOString(),
        // Un corps sans baseVersion vient d'un onglet resté sur l'ancienne page :
        // on l'accepte tel quel pour ne pas lui faire perdre ses saisies.
        state: versioned ? body.state : body,
      };

      await env.CHESS_TOURNAMENT.put(key, JSON.stringify(next));
      return json({ version: next.version, updatedAt: next.updatedAt });
    }

    if (request.method === "DELETE") {
      await env.CHESS_TOURNAMENT.delete(key);
      return json({ deleted: true });
    }

    return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
  },
};
