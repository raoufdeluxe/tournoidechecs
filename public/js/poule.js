// Phase de poule : inscription, calendrier aller/retour, classement, duels

// Calendrier façon championnat : méthode du cercle, chaque partant joue une fois par journée
function generateJournees(playerIds) {
    let arr = playerIds.slice();
    const hasBye = arr.length % 2 !== 0;
    if (hasBye) arr.push(null); // null = journée de repos si nombre impair de partants
    const numRounds = arr.length - 1;
    const half = arr.length / 2;
    const rounds = [];

    for (let r = 0; r < numRounds; r++) {
        const pairs = [];
        for (let i = 0; i < half; i++) {
            const a = arr[i];
            const b = arr[arr.length - 1 - i];
            if (a !== null && b !== null) pairs.push([a, b]);
        }
        rounds.push(pairs);

        const fixed = arr[0];
        const rest = arr.slice(1);
        rest.unshift(rest.pop());
        arr = [fixed, ...rest];
    }

    return rounds;
}

// Les <option> d'un emplacement de partant. `ref` est le joueur déjà choisi.
function buildOptionsJoueurs(ref) {
    const choisi = (valeur) => (valeur === ref ? ' selected' : '');
    let html = '<option value=""' + (ref ? '' : ' selected') + '>— choisir un joueur —</option>';
    for (const j of joueurs) {
        html += '<option value="' + escapeHtml(j.id) + '"' + choisi(j.id) + '>' +
            escapeHtml(j.nom) + (j.elo != null ? ' (' + j.elo + ')' : '') + '</option>';
    }
    html += '<option value="' + REF_NOUVEAU + '">➕ Nouveau joueur…</option>';
    return html;
}

// Choisir « Nouveau joueur… » crée la fiche sans quitter l'inscription ;
// la page Joueurs reste l'endroit où on les gère vraiment.
async function selectJoueur(select) {
    if (select.value !== REF_NOUVEAU) return;
    select.value = '';
    const nom = await askConfirmation({
        titre: 'Nouveau joueur',
        message: 'Il rejoindra la liste des joueurs, réutilisable d\'un tournoi à l\'autre.',
        action: 'Ajouter',
        saisie: ''
    });
    if (nom == null) return;
    const fiche = await addJoueur(nom);
    if (!fiche) return;

    const dejaChoisis = Array.from(document.querySelectorAll('.player-ref')).map(el => el.value);
    renderPartants(dejaChoisis);
    Array.from(document.querySelectorAll('.player-ref'))[Number(select.dataset.index)].value = fiche.id;
}

// Un emplacement par partant, chacun pointant vers une fiche de la liste des
// joueurs. L'Elo ne se saisit plus ici : il appartient à la fiche.
function renderPartants(refsChoisies) {
    const count = parseInt(document.getElementById('player-count').value);
    const container = document.getElementById('player-inputs');
    // Sans argument, on conserve les choix déjà faits : changer le nombre de
    // partants ne doit pas effacer la sélection.
    const refs = refsChoisies ||
        Array.from(document.querySelectorAll('.player-ref')).map(el => el.value);

    container.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const group = document.createElement('div');
        group.className = 'player-input-group';
        group.innerHTML = `
            <div class="form-group" style="margin-bottom: 0;">
                <label>Partant n°${i + 1}</label>
                <select class="player-ref" data-index="${i}" onchange="selectJoueur(this)">
                    ${buildOptionsJoueurs(refs[i] || '')}
                </select>
            </div>
        `;
        container.appendChild(group);
    }
}

// La fonction prend un argument : on ne lui passe pas l'évènement du <select>.
document.getElementById('player-count').addEventListener('change', () => renderPartants());
renderPartants();

async function startTournoi() {
    const refs = Array.from(document.querySelectorAll('.player-ref')).map(el => el.value);

    if (refs.some(ref => !ref)) {
        notifyErreur('Choisis un joueur pour chaque partant.');
        return;
    }

    const doublon = refs.find((ref, i) => refs.indexOf(ref) !== i);
    if (doublon) {
        const fiche = getJoueur(doublon);
        notifyErreur('« ' + (fiche ? fiche.nom : doublon) + ' » occupe deux places : chaque partant doit être un joueur différent.');
        return;
    }

    // Donner le départ régénère tout le calendrier : les résultats déjà saisis
    // seraient effacés sans retour possible. On ne le fait jamais en silence.
    const dejaJoues = [
        ...tournoi.matches,
        ...(tournoi.semifinalMatches || []).flatMap(s => s.matches),
        ...(tournoi.finalMatches || [])
    ].filter(m => m.played).length;

    if (dejaJoues) {
        const pluriel = dejaJoues > 1 ? 's' : '';
        const suite = await askConfirmation({
            titre: `Effacer ${dejaJoues} manche${pluriel} déjà jouée${pluriel} ?`,
            message: 'Donner le départ régénère le calendrier et efface tous les résultats, ' +
                'y compris les demi-finales et la finale. C\'est définitif.',
            action: 'Régénérer le calendrier',
            danger: true
        });
        if (!suite) return;
    }

    // Le nom saisi devient l'adresse du tournoi (…/#tournoi-des-potes).
    // Sans nom, un identifiant est tiré au sort — c'est ici, et seulement ici,
    // qu'un tournoi reçoit son adresse.
    const rawName = document.getElementById('tournament-name').value.trim();
    const slug = slugify(rawName);

    if (!idTournoi && !slug) {
        setIdTournoi(newIdTournoi());
    }

    if (slug && slug !== idTournoi) {
        if (await isIdTaken(slug)) {
            notifyErreur('Un tournoi nommé « ' + rawName + ' » existe déjà.\n\n' +
                  'Ouvre-le avec son lien (…/#' + slug + '), ou choisis un autre nom.');
            return;
        }
        setIdTournoi(slug);
        remoteVersion = 0; // nouvelle clé côté serveur
    }

    tournoi.name = rawName || null;
    renderTitreTournoi();

    // `ref` est ce qui fait foi ; nom et Elo sont recopiés pour que le tournoi
    // reste lisible hors ligne, mais la fiche les écrase à chaque chargement.
    tournoi.players = refs.map((ref, idx) => {
        const fiche = getJoueur(ref);
        return {
            id: idx,
            ref: ref,
            name: fiche ? fiche.nom : NOM_JOUEUR_ABSENT,
            elo: fiche ? fiche.elo : null,
            points: 0,
            matches: 0
        };
    });

    // Sans cela, les demi-finales et la finale de la manche précédente survivraient
    // à la régénération de la poule, dans un état incohérent avec elle.
    tournoi.semifinalMatches = [];
    tournoi.finalMatches = [];
    tournoi.championId = null;
    tournoi.runnerId = null;
    tournoi.thirdId = null;

    generateCalendrier();
    showEcran('screen-tournament');
}

function generateCalendrier() {
    tournoi.matches = [];
    const playerIds = tournoi.players.map(p => p.id);
    const roundsPerLeg = generateJournees(playerIds);

    let roundCounter = 0;
    [1, 2].forEach(leg => {
        roundsPerLeg.forEach(pairs => {
            roundCounter++;
            pairs.forEach(([a, b]) => {
                const i = Math.min(a, b);
                const j = Math.max(a, b);
                tournoi.matches.push({
                    id: `${i}-${j}-leg${leg}`,
                    player1: i,
                    player2: j,
                    player1Score: null,
                    player2Score: null,
                    played: false,
                    round: roundCounter,
                    cadence: CADENCE_DEFAUT,
                    variante: VARIANTE_DEFAUT
                });
            });
        });
    });

    tournoi.totalRounds = roundCounter;
    tournoi.currentRound = 1;

    renderPoule();
}

function renderPoule() {
    updateProgression();
    renderClassement();
    renderParties();
    renderGrapheProgression();
    saveEtat();
}

function updateProgression() {
    const total = tournoi.matches.length;
    const played = tournoi.matches.filter(m => m.played).length;
    document.getElementById('matches-played').textContent = played;
    document.getElementById('matches-total').textContent = total;
    document.getElementById('progress-fill').style.width = ((played / total) * 100) + '%';
}

// Sans argument : classement général, toutes journées confondues — c'est ce que
// réclament la qualification, les départages et le classement final.
// Avec `jusquALaJournee` : classement tel qu'il était à l'issue de cette journée.
function computeClassement(jusquALaJournee) {
    const retenus = tournoi.matches.filter(m =>
        m.played && (jusquALaJournee == null || m.round <= jusquALaJournee));

    const standings = tournoi.players.map(p => ({ ...p, points: 0, matches: 0, wins: 0 }));

    retenus.forEach(match => {
        standings[match.player1].matches++;
        standings[match.player2].matches++;
        
        if (match.player1Score > match.player2Score) {
            standings[match.player1].points += 1;
            standings[match.player1].wins += 1;
        } else if (match.player2Score > match.player1Score) {
            standings[match.player2].points += 1;
            standings[match.player2].wins += 1;
        } else {
            standings[match.player1].points += 0.5;
            standings[match.player2].points += 0.5;
        }
    });

    // Points marqués uniquement dans les duels entre joueurs à égalité (confrontation directe)
    function headToHeadPoints(playerId, tiedOpponentIds) {
        let pts = 0;
        retenus.forEach(match => {
            const isP1 = match.player1 === playerId;
            const isP2 = match.player2 === playerId;
            if (!isP1 && !isP2) return;
            const opponentId = isP1 ? match.player2 : match.player1;
            if (!tiedOpponentIds.includes(opponentId)) return;
            const myScore = isP1 ? match.player1Score : match.player2Score;
            const oppScore = isP1 ? match.player2Score : match.player1Score;
            if (myScore > oppScore) pts += 1;
            else if (myScore === oppScore) pts += 0.5;
        });
        return pts;
    }

    // 1) Points, 2) Nombre de victoires
    standings.sort((a, b) => b.points - a.points || b.wins - a.wins);

    // 3) Confrontation directe entre joueurs encore à égalité stricte (points + victoires)
    let i = 0;
    while (i < standings.length) {
        let j = i + 1;
        while (j < standings.length && standings[j].points === standings[i].points && standings[j].wins === standings[i].wins) {
            j++;
        }
        if (j - i > 1) {
            const tiedIds = standings.slice(i, j).map(p => p.id);
            const group = standings.slice(i, j).map(p => ({
                ...p,
                h2h: headToHeadPoints(p.id, tiedIds.filter(id => id !== p.id))
            }));
            group.sort((a, b) => b.h2h - a.h2h || b.matches - a.matches);
            for (let k = 0; k < group.length; k++) {
                standings[i + k] = group[k];
            }
        }
        i = j;
    }

    return standings;
}

// Nombre de duels dus (journées ≤ journée affichée) que ce partant n'a pas encore joués
function countPartiesEnRetard(playerId) {
    return tournoi.matches.filter(m =>
        (m.player1 === playerId || m.player2 === playerId) &&
        m.round <= tournoi.currentRound &&
        !m.played
    ).length;
}

function renderClassement() {
    const standings = computeClassement(tournoi.currentRound);

    const titre = document.getElementById('standings-title');
    if (titre) {
        titre.innerHTML = 'Classement ' +
            `<span class="standings-round">à l'issue de la journée ${tournoi.currentRound} / ${tournoi.totalRounds}</span>`;
    }

    const tbody = document.getElementById('standings-body');
    tbody.innerHTML = standings.map((p, idx) => {
        const pending = countPartiesEnRetard(p.id);
        const pendingTag = pending > 0 ? ` <span style="color: var(--danger); font-weight: 700; font-size: 12px;">(-${pending})</span>` : '';
        return `
        <tr>
            <td><strong>${idx + 1}</strong></td>
            <td>${buildCasaque(p.id)}${escapeHtml(p.name)}${p.absent ? buildTagFicheAbsente() : ''}${pendingTag}</td>
            <td style="text-align: center; font-weight: 600; font-size: 18px;">${p.points.toFixed(1)}</td>
            <td style="text-align: center;">${p.matches}</td>
        </tr>
    `;
    }).join('');
}

// Points cumulés de chaque partant après chaque journée (pour le graphique de progression)
function computeProgression() {
    const rounds = tournoi.totalRounds;
    return tournoi.players.map(p => {
        const series = [];
        for (let r = 1; r <= rounds; r++) {
            let pts = 0;
            tournoi.matches.forEach(m => {
                if (m.round > r || !m.played) return;
                if (m.player1 !== p.id && m.player2 !== p.id) return;
                const isP1 = m.player1 === p.id;
                const my = isP1 ? m.player1Score : m.player2Score;
                const opp = isP1 ? m.player2Score : m.player1Score;
                if (my > opp) pts += 1;
                else if (my === opp) pts += 0.5;
            });
            series.push(pts);
        }
        return { id: p.id, name: p.name, series };
    });
}

function renderGrapheProgression() {
    const container = document.getElementById('progress-chart-container');
    if (!container) return;

    const rounds = tournoi.totalRounds;
    const data = computeProgression();
    const maxPoints = Math.max(1, ...data.flatMap(d => d.series));

    const width = 640;
    const height = 260;
    const padL = 34, padR = 14, padT = 14, padB = 30;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const xFor = (round) => padL + (rounds === 1 ? 0 : (round - 1) / (rounds - 1) * plotW);
    const yFor = (pts) => padT + plotH - (pts / maxPoints) * plotH;

    // Grille horizontale (4 paliers) + labels d'axe Y
    let gridHtml = '';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const val = (maxPoints / ySteps) * i;
        const y = yFor(val);
        gridHtml += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border)" stroke-width="1"/>`;
        gridHtml += `<text x="${padL - 8}" y="${y + 4}" font-size="10" fill="var(--text-secondary)" text-anchor="end">${val.toFixed(1)}</text>`;
    }

    // Labels d'axe X (une étiquette sur deux si trop de journées)
    let xLabelsHtml = '';
    const xLabelStep = rounds > 10 ? Math.ceil(rounds / 10) : 1;
    for (let r = 1; r <= rounds; r += xLabelStep) {
        xLabelsHtml += `<text x="${xFor(r)}" y="${height - padB + 16}" font-size="10" fill="var(--text-secondary)" text-anchor="middle">J${r}</text>`;
    }

    // Une ligne par partant, colorée avec sa casaque
    let linesHtml = '';
    let legendHtml = '';
    data.forEach(d => {
        const color = getCouleurCasaque(d.id);
        const points = d.series.map((pts, idx) => `${xFor(idx + 1)},${yFor(pts)}`).join(' ');
        linesHtml += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
        d.series.forEach((pts, idx) => {
            linesHtml += `<circle cx="${xFor(idx + 1)}" cy="${yFor(pts)}" r="2.5" fill="${color}"/>`;
        });
        legendHtml += `<span style="display:inline-flex; align-items:center; gap:6px; margin-right:14px; margin-bottom:6px; font-size:12px; color:var(--text-secondary);"><span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${color};"></span>${escapeHtml(d.name)}</span>`;
    });

    container.innerHTML = `
        <svg viewBox="0 0 ${width} ${height}" style="width: 100%; height: auto; display: block;">
            ${gridHtml}
            ${xLabelsHtml}
            ${linesHtml}
        </svg>
        <div style="margin-top: 10px; display: flex; flex-wrap: wrap;">${legendHtml}</div>
    `;
}

function renderParties() {
    const total = tournoi.totalRounds;
    const current = tournoi.currentRound;
    const roundMatches = tournoi.matches.filter(m => m.round === current);
    const leg = current <= total / 2 ? 1 : 2;
    const allPlayed = tournoi.matches.every(m => m.played);

    const champJournee = document.getElementById('round-input');
    champJournee.value = current;
    champJournee.max = total;
    document.getElementById('round-total').textContent = '/ ' + total;
    document.getElementById('round-leg').textContent = leg === 1 ? 'Aller' : 'Retour';

    // Les flèches ne font que feuilleter : elles s'éteignent au bout du calendrier.
    document.getElementById('prev-round-btn').disabled = current <= 1;
    document.getElementById('next-round-btn').disabled = current >= total;

    // La clôture n'apparaît qu'une fois tous les duels joués.
    document.getElementById('cloture-poule').hidden = !allPlayed;

    const container = document.getElementById('matches-container');
    container.innerHTML = '';

    roundMatches.forEach(match => renderCartePartie(match));
}

// Domicile / extérieur.
// Poule : à l'aller le premier nommé reçoit, au retour c'est l'inverse.
//   La règle se déduit de la manche (leg1/leg2) et non de l'ordre des joueurs,
//   pour rester juste y compris sur les tournois lancés avant cet ajout.
// Demies et finale : la manche 1 chez l'un, la manche 2 chez l'autre.
//   La belle éventuelle se joue sur terrain neutre.
function getCoteDomicile(match) {
    if (match.num) {
        if (match.num === 1) return 'p1';
        if (match.num === 2) return 'p2';
        return null;
    }
    return String(match.id).endsWith('leg2') ? 'p2' : 'p1';
}

function buildBadgeTerrain(match, isPlayer1) {
    const home = getCoteDomicile(match);
    if (!home) return '<span class="venue venue-neutral">⚑ Terrain neutre</span>';
    return (home === 'p1') === isPlayer1
        ? '<span class="venue venue-home">🏠 Domicile</span>'
        : '<span class="venue venue-away">✈️ Extérieur</span>';
}

function renderCartePartie(match) {
    const container = document.getElementById('matches-container');
    const p1 = tournoi.players[match.player1];
    const p2 = tournoi.players[match.player2];

    const div = document.createElement('div');
    div.innerHTML = `
        <div style="background: var(--bg-secondary); border-radius: 8px; padding: 15px; margin-bottom: 15px;">
            <div class="match-card" style="margin: 0 0 12px;">
                <div class="player-result ${getClasseResultat(match, true)}">
                    ${getIconeResultat(match, true)}${buildCasaque(p1.id)}${escapeHtml(p1.name)}
                    ${buildBadgeTerrain(match, true)}
                </div>
                <div class="vs-indicator">vs</div>
                <div class="player-result ${getClasseResultat(match, false)}">
                    ${getIconeResultat(match, false)}${buildCasaque(p2.id)}${escapeHtml(p2.name)}
                    ${buildBadgeTerrain(match, false)}
                </div>
            </div>
            ${buildReglagesPartie(match,
                `setCadencePartie('${match.id}', this.value)`,
                `setVariantePartie('${match.id}', this.value)`)}
            <select class="result-select" onchange="setResultatPartie('${match.id}', this.value)">
                ${buildOptionsResultat(match, escapeHtml(p1.name), escapeHtml(p2.name))}
            </select>
            ${match.played ? '<div class="result-hint">✓ Résultat enregistré — modifiable à tout moment</div>' : ''}
        </div>
    `;

    container.appendChild(div);
}

function setCadencePartie(matchId, valeur) {
    if (setCadence(tournoi.matches.find(m => m.id === matchId), valeur)) saveEtat();
}

function setVariantePartie(matchId, valeur) {
    if (setVariante(tournoi.matches.find(m => m.id === matchId), valeur)) saveEtat();
}

function setResultatPartie(matchId, value) {
    const match = tournoi.matches.find(m => m.id === matchId);
    applyResultat(match, value);
    renderPoule();
}

function nextJournee() {
    if (tournoi.currentRound < tournoi.totalRounds) {
        tournoi.currentRound++;
        renderPoule();
    }
}

// Le numéro de journée se saisit : taper 12 mène droit à la 12e. Hors
// calendrier ou illisible, on s'en tient à la borne la plus proche — et le
// champ reprend le numéro affiché, puisque tout se redessine.
function goToJournee(value) {
    const round = parseInt(value, 10);
    if (Number.isFinite(round)) {
        tournoi.currentRound = Math.min(Math.max(round, 1), tournoi.totalRounds);
    }
    renderPoule();
}

function prevJournee() {
    if (tournoi.currentRound > 1) {
        tournoi.currentRound--;
        renderPoule();
    }
}

function finalizePoule() {
    if (tournoi.matches.some(m => !m.played)) {
        notifyErreur('Tous les matches doivent être joués');
        return;
    }
    
    const standings = computeClassement();
    const top4 = standings.slice(0, 4);
    
    tournoi.semifinalMatches = [];
    
    // Semi-finale 1: 1er vs 4e
    tournoi.semifinalMatches.push({
        id: 'semi-1',
        type: 'semifinal',
        players: [top4[0].id, top4[3].id],
        matches: [
            { player1: top4[0].id, player2: top4[3].id, player1Score: null, player2Score: null, played: false, num: 1, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT },
            { player1: top4[0].id, player2: top4[3].id, player1Score: null, player2Score: null, played: false, num: 2, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT }
        ],
        winner: null
    });
    
    // Semi-finale 2: 2e vs 3e
    tournoi.semifinalMatches.push({
        id: 'semi-2',
        type: 'semifinal',
        players: [top4[1].id, top4[2].id],
        matches: [
            { player1: top4[1].id, player2: top4[2].id, player1Score: null, player2Score: null, played: false, num: 1, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT },
            { player1: top4[1].id, player2: top4[2].id, player1Score: null, player2Score: null, played: false, num: 2, cadence: CADENCE_DEFAUT, variante: VARIANTE_DEFAUT }
        ],
        winner: null
    });
    
    showEcran('screen-semifinals');
    renderDemies();
}
