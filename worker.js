// Worker Cloudflare : stocke et sert l'état du tournoi (un seul tournoi partagé)
//
// Routes :
//   GET  /tournaments    -> { tournaments: [...], complete }  liste des tournois enregistrés
//   GET  /state?id=<id>  -> { version, updatedAt, state }   (state vaut null si rien n'est enregistré)
//   POST /state?id=<id>  -> corps { baseVersion, state }
//   DELETE /state?id=<id> -> supprime définitivement le tournoi
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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

    if (url.pathname === "/tournaments" && request.method === "GET") {
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

    if (url.pathname !== "/state") {
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
