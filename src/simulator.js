import {
  parseCardList,
  buildRemainingDeck,
  createRng,
  drawRandomCards,
  getPositionNames,
  cardToString,
} from './cards.js';
import { evaluateHand, HAND_CATEGORIES } from './evaluator.js';
import { getArchetype } from './archetypes.js';
import { playHand } from './engine.js';

const _rawBuf = new Int8Array(7);

/**
 * Normalizes and validates a simulation scenario configuration.
 */
export function normalizeConfig(raw) {
  if (!raw || !Array.isArray(raw.players)) {
    throw new Error('Configuration must include a "players" array.');
  }
  const n = raw.players.length;
  if (n < 2 || n > 9) {
    throw new Error(`Number of players must be between 2 and 9 (got ${n}).`);
  }

  const trials = Math.max(10, Math.min(200000, Math.round(Number(raw.trials) || 5000)));
  const sb = Math.max(1, Math.round(Number(raw.sb) || 1));
  const bb = Math.max(sb, Math.round(Number(raw.bb) || 2));
  const defaultStackBB = Math.max(5, Number(raw.stackBB) || 100);
  const buttonIndex = Number.isInteger(raw.buttonIndex) ? raw.buttonIndex : 0;
  const positions = getPositionNames(n);

  const playerHoleCards = [];
  const archetypes = [];
  const names = [];
  const stacks = [];

  const archetypeOverrides = raw.archetypeOverrides || null;

  for (let i = 0; i < n; i++) {
    const p = raw.players[i] || {};
    const parsedHole = parseCardList(p.cards ?? p.holeCards ?? [null, null], 2);
    playerHoleCards.push(parsedHole);
    archetypes.push(getArchetype(p.type ?? p.archetype ?? 'tag', archetypeOverrides));
    names.push(String(p.name || `Seat ${i + 1}`));
    const seatStackBB = p.stackBB !== undefined && p.stackBB !== null ? Number(p.stackBB) : defaultStackBB;
    stacks.push(Math.max(bb * 2, Math.round(seatStackBB * bb)));
  }

  const boardParsed = parseCardList(raw.board ?? raw.communityCards ?? [], 5);
  const specifiedBoardCount = boardParsed.filter((c) => c !== null).length;

  // Compact specified board cards to front if user left gaps (e.g. only filled Turn slot)
  const boardSlots = boardParsed.slice(0, 5);
  const remainingDeck = buildRemainingDeck(playerHoleCards, boardSlots);

  // Determine starting street
  const startMode = raw.startMode === 'preflop' ? 'preflop' : 'street';
  let startStreet = 0;
  if (startMode === 'street') {
    if (specifiedBoardCount >= 5) startStreet = 3; // River
    else if (specifiedBoardCount === 4) startStreet = 2; // Turn
    else if (specifiedBoardCount >= 1) startStreet = 1; // Flop (1-3 cards known)
    else startStreet = 0; // Preflop
  }

  const startingPotBB =
    raw.startingPotBB !== undefined && raw.startingPotBB !== null && raw.startingPotBB !== ''
      ? Math.max(2, Number(raw.startingPotBB))
      : n * 3;
  const startingPot = Math.round(startingPotBB * bb);

  return {
    trials,
    sb,
    bb,
    stackBB: defaultStackBB,
    buttonIndex,
    positions,
    playerHoleCards,
    archetypes,
    names,
    stacks,
    boardSlots,
    specifiedBoardCount,
    remainingDeck,
    startMode,
    startStreet,
    startingPot,
    startingPotBB,
    seed: raw.seed ?? null,
    sampleCount: Math.max(0, Math.min(10, Number(raw.sampleCount ?? 5))),
  };
}

/**
 * Creates mutable accumulator state for incremental or synchronous Monte Carlo execution.
 */
function createSimulationState(cfg) {
  const n = cfg.playerHoleCards.length;
  let randomCardsNeeded = 0;
  for (let i = 0; i < n; i++) {
    if (cfg.playerHoleCards[i][0] === null) randomCardsNeeded++;
    if (cfg.playerHoleCards[i][1] === null) randomCardsNeeded++;
  }
  for (let b = 0; b < 5; b++) {
    if (cfg.boardSlots[b] === null) randomCardsNeeded++;
  }

  return {
    cfg,
    n,
    rng: createRng(cfg.seed),
    deckBuf: new Int8Array(cfg.remainingDeck),
    randomCardsNeeded,
    holesBuf: Array.from({ length: n }, () => [0, 0]),
    boardBuf: [0, 0, 0, 0, 0],
    rawScores: new Int32Array(n),

    // Per-player accumulators
    rawEquitySum: new Float64Array(n),
    rawWinCount: new Uint32Array(n),
    rawTieCount: new Uint32Array(n),
    actualWinCount: new Uint32Array(n),
    actualTieCount: new Uint32Array(n),
    actualEquitySum: new Float64Array(n),
    foldCount: new Uint32Array(n),
    wtsdCount: new Uint32Array(n),
    vpipCount: new Uint32Array(n),
    pfrCount: new Uint32Array(n),
    aggActionSum: new Uint32Array(n),
    passActionSum: new Uint32Array(n),
    netBBSum: new Float64Array(n),
    netBBSqSum: new Float64Array(n),
    potsWonBBSum: new Float64Array(n),
    potsWonCount: new Uint32Array(n),

    // Table accumulators
    totalPotBBSum: 0,
    showdownCount: 0,
    streetEndCounts: { preflop: 0, flop: 0, turn: 0, river: 0, showdown: 0 },
    winningHandRanks: new Uint32Array(HAND_CATEGORIES.length),
    sampleHands: [],
    completed: 0,
    startTime: Date.now(),
  };
}

function runBatch(state, count) {
  const {
    cfg,
    n,
    rng,
    deckBuf,
    randomCardsNeeded,
    holesBuf,
    boardBuf,
    rawScores,
  } = state;

  const end = Math.min(cfg.trials, state.completed + count);

  for (let t = state.completed; t < end; t++) {
    if (randomCardsNeeded > 0) {
      drawRandomCards(deckBuf, randomCardsNeeded, rng);
    }

    let drawIdx = 0;
    for (let i = 0; i < n; i++) {
      const h0 = cfg.playerHoleCards[i][0];
      const h1 = cfg.playerHoleCards[i][1];
      holesBuf[i][0] = h0 !== null ? h0 : deckBuf[drawIdx++];
      holesBuf[i][1] = h1 !== null ? h1 : deckBuf[drawIdx++];
    }
    for (let b = 0; b < 5; b++) {
      const bc = cfg.boardSlots[b];
      boardBuf[b] = bc !== null ? bc : deckBuf[drawIdx++];
    }

    // 1. Compute Raw Showdown Equity on this exact deal (nobody folds)
    let bestRaw = -1;
    let rawWinnerCount = 0;
    for (let i = 0; i < n; i++) {
      _rawBuf[0] = holesBuf[i][0];
      _rawBuf[1] = holesBuf[i][1];
      _rawBuf[2] = boardBuf[0];
      _rawBuf[3] = boardBuf[1];
      _rawBuf[4] = boardBuf[2];
      _rawBuf[5] = boardBuf[3];
      _rawBuf[6] = boardBuf[4];
      const sc = evaluateHand(_rawBuf, 7);
      rawScores[i] = sc;
      if (sc > bestRaw) {
        bestRaw = sc;
        rawWinnerCount = 1;
      } else if (sc === bestRaw) {
        rawWinnerCount++;
      }
    }
    const rawShare = 1 / rawWinnerCount;
    for (let i = 0; i < n; i++) {
      if (rawScores[i] === bestRaw) {
        state.rawEquitySum[i] += rawShare;
        if (rawWinnerCount === 1) state.rawWinCount[i]++;
        else state.rawTieCount[i]++;
      }
    }

    // 2. Play out the hand with archetype betting decisions
    const recordHistory = state.sampleHands.length < cfg.sampleCount;
    const res = playHand(
      {
        holes: holesBuf,
        board: boardBuf,
        archetypes: cfg.archetypes,
        names: cfg.names,
        positions: cfg.positions,
        stacks: cfg.stacks,
        sb: cfg.sb,
        bb: cfg.bb,
        buttonIndex: cfg.buttonIndex,
        startStreet: cfg.startStreet,
        startingPot: cfg.startingPot,
        recordHistory,
      },
      rng
    );

    if (recordHistory && res.history) {
      state.sampleHands.push(res.history);
    }

    state.totalPotBBSum += res.pot / cfg.bb;

    if (res.reachedShowdown) {
      state.showdownCount++;
      state.streetEndCounts.showdown++;
      if (res.winningCategory >= 0) {
        state.winningHandRanks[res.winningCategory]++;
      }
    } else {
      if (res.endedStreet === 0) state.streetEndCounts.preflop++;
      else if (res.endedStreet === 1) state.streetEndCounts.flop++;
      else if (res.endedStreet === 2) state.streetEndCounts.turn++;
      else state.streetEndCounts.river++;
    }

    // Determine main-pot / overall winners for Win% & Tie%
    let winnersCount = 0;
    for (let i = 0; i < n; i++) {
      if (res.payouts[i] > 0) winnersCount++;
    }

    for (let i = 0; i < n; i++) {
      const netBB = res.netChips[i] / cfg.bb;
      state.netBBSum[i] += netBB;
      state.netBBSqSum[i] += netBB * netBB;

      if (res.folded[i]) state.foldCount[i]++;
      else if (res.reachedShowdown) state.wtsdCount[i]++;

      if (res.vpip[i]) state.vpipCount[i]++;
      if (res.pfr[i]) state.pfrCount[i]++;
      state.aggActionSum[i] += res.aggActions[i];
      state.passActionSum[i] += res.passActions[i];

      if (res.payouts[i] > 0) {
        const potShare = res.pot > 0 ? res.payouts[i] / res.pot : 0;
        state.actualEquitySum[i] += potShare;
        state.potsWonBBSum[i] += res.payouts[i] / cfg.bb;
        state.potsWonCount[i]++;
        if (winnersCount === 1) state.actualWinCount[i]++;
        else state.actualTieCount[i]++;
      }
    }
  }

  state.completed = end;
}

function finalizeSimulation(state) {
  const { cfg, n } = state;
  const T = state.completed || 1;
  const elapsedMs = Math.max(1, Date.now() - state.startTime);

  const players = [];
  for (let i = 0; i < n; i++) {
    const meanEV = state.netBBSum[i] / T;
    const variance = Math.max(0, state.netBBSqSum[i] / T - meanEV * meanEV);
    const stdErr = Math.sqrt(variance / T);
    const ci95 = 1.96 * stdErr;

    const totalActions = state.aggActionSum[i] + state.passActionSum[i];
    const aggPct = totalActions > 0 ? (state.aggActionSum[i] / totalActions) * 100 : 0;

    players.push({
      seat: i,
      name: cfg.names[i],
      position: cfg.positions[i],
      cards: cfg.playerHoleCards[i].map((c) => (c !== null ? cardToString(c) : '??')),
      archetypeId: cfg.archetypes[i].id,
      archetypeName: cfg.archetypes[i].name,
      archetypeShort: cfg.archetypes[i].shortName,
      stackBB: cfg.stacks[i] / cfg.bb,
      rawEquityPct: (state.rawEquitySum[i] / T) * 100,
      rawWinPct: (state.rawWinCount[i] / T) * 100,
      rawTiePct: (state.rawTieCount[i] / T) * 100,
      actualEquityPct: (state.actualEquitySum[i] / T) * 100,
      winPct: (state.actualWinCount[i] / T) * 100,
      tiePct: (state.actualTieCount[i] / T) * 100,
      foldPct: (state.foldCount[i] / T) * 100,
      wtsdPct: (state.wtsdCount[i] / T) * 100,
      vpipPct: (state.vpipCount[i] / T) * 100,
      pfrPct: (state.pfrCount[i] / T) * 100,
      aggPct,
      evBB: meanEV,
      evCi95BB: ci95,
      totalNetBB: state.netBBSum[i],
      avgPotWonBB: state.potsWonCount[i] > 0 ? state.potsWonBBSum[i] / state.potsWonCount[i] : 0,
    });
  }

  const showdownTotal = state.showdownCount || 1;
  const handRankDistribution = HAND_CATEGORIES.map((name, idx) => ({
    category: idx,
    name,
    count: state.winningHandRanks[idx],
    pct: state.showdownCount > 0 ? (state.winningHandRanks[idx] / showdownTotal) * 100 : 0,
  }));

  const streetBreakdown = [
    { key: 'preflop', label: 'Preflop (Fold)', count: state.streetEndCounts.preflop, pct: (state.streetEndCounts.preflop / T) * 100 },
    { key: 'flop', label: 'Flop (Fold)', count: state.streetEndCounts.flop, pct: (state.streetEndCounts.flop / T) * 100 },
    { key: 'turn', label: 'Turn (Fold)', count: state.streetEndCounts.turn, pct: (state.streetEndCounts.turn / T) * 100 },
    { key: 'river', label: 'River (Fold)', count: state.streetEndCounts.river, pct: (state.streetEndCounts.river / T) * 100 },
    { key: 'showdown', label: 'Showdown', count: state.streetEndCounts.showdown, pct: (state.streetEndCounts.showdown / T) * 100 },
  ];

  return {
    trials: T,
    elapsedMs,
    sb: cfg.sb,
    bb: cfg.bb,
    startStreet: cfg.startStreet,
    startMode: cfg.startMode,
    startingPotBB: cfg.startingPotBB,
    board: cfg.boardSlots.map((c) => (c !== null ? cardToString(c) : null)),
    avgPotBB: state.totalPotBBSum / T,
    showdownPct: (state.showdownCount / T) * 100,
    players,
    streetBreakdown,
    handRankDistribution,
    sampleHands: state.sampleHands,
  };
}

/**
 * Synchronous Monte Carlo simulation (ideal for CLI & unit tests).
 */
export function runSimulation(rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  const state = createSimulationState(cfg);
  runBatch(state, cfg.trials);
  return finalizeSimulation(state);
}

/**
 * Chunked async Monte Carlo simulation so browsers stay responsive with live progress.
 */
export function runSimulationAsync(rawConfig, onProgress = null, batchSize = 500) {
  return new Promise((resolve, reject) => {
    let cfg;
    try {
      cfg = normalizeConfig(rawConfig);
    } catch (err) {
      reject(err);
      return;
    }

    const state = createSimulationState(cfg);

    function step() {
      try {
        runBatch(state, batchSize);
        if (onProgress) {
          onProgress(state.completed, cfg.trials);
        }
        if (state.completed < cfg.trials) {
          setTimeout(step, 0);
        } else {
          resolve(finalizeSimulation(state));
        }
      } catch (err) {
        reject(err);
      }
    }

    setTimeout(step, 0);
  });
}
