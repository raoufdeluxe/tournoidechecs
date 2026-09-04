// Faux espace KV Cloudflare : juste ce que le Worker utilise.

export function fauxKV(entrees = {}) {
    const donnees = new Map(Object.entries(entrees).map(
        ([cle, valeur]) => [cle, typeof valeur === 'string' ? valeur : JSON.stringify(valeur)]));

    return {
        donnees,
        // Les clés listées mais absentes de `donnees` simulent le cache de list()
        // côté Cloudflare, qui peut retarder une suppression de 60 s.
        clesFantomes: new Set(),
        async get(cle) {
            return donnees.has(cle) ? donnees.get(cle) : null;
        },
        async put(cle, valeur) {
            donnees.set(cle, valeur);
        },
        async delete(cle) {
            donnees.delete(cle);
        },
        async list({ prefix = '', limit = 1000 } = {}) {
            const noms = [...new Set([...donnees.keys(), ...this.clesFantomes])]
                .filter(nom => nom.startsWith(prefix));
            return {
                keys: noms.slice(0, limit).map(nom => ({ name: nom })),
                list_complete: noms.length <= limit,
            };
        },
    };
}

/** Appelle le Worker et renvoie { status, headers, body } (corps JSON si possible). */
export async function appeler(worker, kv, methode, chemin, corps) {
    const init = { method: methode };
    if (corps !== undefined) {
        init.body = typeof corps === 'string' ? corps : JSON.stringify(corps);
        init.headers = { 'Content-Type': 'application/json' };
    }
    const reponse = await worker.fetch(
        new Request('https://echecs.test' + chemin, init),
        { CHESS_TOURNAMENT: kv });
    const texte = await reponse.text();
    let body;
    try { body = JSON.parse(texte); } catch { body = texte; }
    return { status: reponse.status, headers: reponse.headers, body };
}
