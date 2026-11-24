import { evaluatePreflopStrength, evaluatePostflopStrength } from './evaluator.js';

export const ARCHETYPE_PARAM_DEFS = [
  {
    key: 'preflopLooseness',
    label: 'Preflop Looseness (VPIP)',
    min: 5,
    max: 95,
    step: 1,
    unit: '%',
    desc: 'How wide of a starting hand range this player enters pots with preflop.',
  },
  {
    key: 'preflopAggression',
    label: 'Preflop Raise / 3-Bet',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    desc: 'Tendency to open-raise and 3-bet instead of limping or flat-calling.',
  },
  {
    key: 'foldToPressure',
    label: 'Postflop Tightness (Fold to Bets)',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    desc: 'How readily this player folds pairs and marginal hands facing bets or raises.',
  },
  {
    key: 'drawDefense',
    label: 'Draw Chasing',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    desc: 'Willingness to call bets/raises on flush or straight draws (low = folds draws under fire).',
  },
  {
    key: 'postflopAggression',
    label: 'Postflop Bet / Raise',
    min: 0,
    max: 100,
    step: 1,
    unit: '%',
    desc: 'How aggressively this player value-bets, c-bets, and raises postflop.',
  },
  {
    key: 'bluffFreq',
    label: 'Bluff Frequency',
    min: 0,
    max: 80,
    step: 1,
    unit: '%',
    desc: 'How often this player fires pure bluffs or semi-bluff raises without a strong made hand.',
  },
  {
    key: 'betSizePct',
    label: 'Bet Sizing (% of Pot)',
    min: 25,
    max: 150,
    step: 5,
    unit: '%',
    desc: 'Typical bet size as a percentage of the current pot.',
  },
];

export const ARCHETYPES = {
  calling_station: {
    id: 'calling_station',
    name: 'Calling Station',
    shortName: 'Station',
    tagline: 'Loose-Passive · Calls wide, chases draws, rarely raises',
    description:
      'Plays a wide range and hates folding once connected with any pair or draw. Seldom bets aggressively or bluffs.',
    params: {
      preflopLooseness: 72,
      preflopAggression: 8,
      foldToPressure: 10,
      drawDefense: 94,
      postflopAggression: 10,
      bluffFreq: 2,
      betSizePct: 50,
    },
  },
  aggressive: {
    id: 'aggressive',
    name: 'Aggressive (LAG)',
    shortName: 'Aggressive',
    tagline: 'Loose-Aggressive · High pressure, frequent raises & bluffs',
    description:
      'Enters many pots with raises, applies multi-street pressure via c-bets and semi-bluffs, and frequently 3-bets.',
    params: {
      preflopLooseness: 48,
      preflopAggression: 86,
      foldToPressure: 36,
      drawDefense: 72,
      postflopAggression: 84,
      bluffFreq: 34,
      betSizePct: 75,
    },
  },
  nit: {
    id: 'nit',
    name: 'Nit',
    shortName: 'Nit',
    tagline: 'Ultra-Tight · Waits for premiums, folds draws & pairs under fire',
    description:
      'Plays only top-tier hands, folds marginal pairs and draws quickly when facing bets or raises, and rarely bluffs.',
    params: {
      preflopLooseness: 14,
      preflopAggression: 48,
      foldToPressure: 84,
      drawDefense: 8,
      postflopAggression: 28,
      bluffFreq: 3,
      betSizePct: 55,
    },
  },
  tag: {
    id: 'tag',
    name: 'TAG (Tight-Aggressive)',
    shortName: 'TAG',
    tagline: 'Tight-Aggressive · Selective range, disciplined aggression',
    description:
      'Chooses solid starting hands, bets/raises strong value hands and selective draws, and folds to heavy multi-way pressure.',
    params: {
      preflopLooseness: 26,
      preflopAggression: 74,
      foldToPressure: 56,
      drawDefense: 45,
      postflopAggression: 62,
      bluffFreq: 14,
      betSizePct: 65,
    },
  },
  maniac: {
    id: 'maniac',
    name: 'Maniac',
    shortName: 'Maniac',
    tagline: 'Hyper-Aggressive · Constant bets, raises & bluffs',
    description:
      'Plays a huge range at maximum aggression—constantly raising, re-raising, and firing multi-street bluffs.',
    params: {
      preflopLooseness: 84,
      preflopAggression: 96,
      foldToPressure: 20,
      drawDefense: 88,
      postflopAggression: 96,
      bluffFreq: 54,
      betSizePct: 100,
    },
  },
  showdown: {
    id: 'showdown',
    name: 'Showdown (Baseline)',
    shortName: 'Showdown',
    tagline: 'Passive Baseline · Never folds, never raises',
    description:
      'Always checks or calls to showdown. Useful for measuring how pure card equity performs against active archetypes.',
    params: null,
  },
};

export const ARCHETYPE_LIST = Object.values(ARCHETYPES);

export function getDefaultArchetypeParams() {
  const out = {};
  for (const arch of ARCHETYPE_LIST) {
    if (arch.params) {
      out[arch.id] = { ...arch.params };
    }
  }
  return out;
}

export function getArchetype(id, overrides = null) {
  const key = String(id || 'tag').toLowerCase().trim().replace(/[\s-]+/g, '_');
  let base = ARCHETYPES[key];
  if (!base) {
    if (key === 'lag' || key === 'agg' || key === 'aggro') base = ARCHETYPES.aggressive;
    else if (key === 'station' || key === 'fish' || key === 'passive') base = ARCHETYPES.calling_station;
    else if (key === 'tight' || key === 'rock') base = ARCHETYPES.nit;
    else if (key === 'baseline' || key === 'passive_baseline') base = ARCHETYPES.showdown;
  }
  if (!base) {
    throw new Error(`Unknown player archetype: "${id}"`);
  }
  if (!base.params || !overrides || !overrides[base.id]) {
    return base;
  }
  const merged = { ...base.params };
  const custom = overrides[base.id];
  for (const def of ARCHETYPE_PARAM_DEFS) {
    if (custom[def.key] !== undefined && custom[def.key] !== null && !Number.isNaN(Number(custom[def.key]))) {
      merged[def.key] = Math.max(def.min, Math.min(def.max, Number(custom[def.key])));
    }
  }
  return { ...base, params: merged };
}

/**
 * Computes a betting action for a player on the current street using their
 * configurable archetype parameters.
 */
export function decideAction(ctx, rng) {
  const {
    archetype,
    hole0,
    hole1,
    board,
    boardLen,
    street, // 0=preflop, 1=flop, 2=turn, 3=river
    pot,
    currentBet,
    playerStreetBet,
    playerStack,
    bb,
    raisesThisStreet,
    maxRaisesPerStreet,
    isInPosition,
    activeCount,
    wasAggressor,
  } = ctx;

  const toCall = Math.max(0, currentBet - playerStreetBet);
  const canRaise = raisesThisStreet < maxRaisesPerStreet && playerStack > toCall;

  // Baseline showdown bot: always checks or calls
  if (!archetype.params) {
    if (toCall === 0) return { type: 'check', amount: 0 };
    return { type: 'call', amount: Math.min(toCall, playerStack) };
  }

  const cfg = archetype.params;
  const looseness = cfg.preflopLooseness / 100;
  const preAgg = cfg.preflopAggression / 100;
  const foldPress = cfg.foldToPressure / 100;
  const drawDef = cfg.drawDefense / 100;
  const postAgg = cfg.postflopAggression / 100;
  const bluff = cfg.bluffFreq / 100;
  const betSizePotFrac = cfg.betSizePct / 100;

  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const noise = (rng() - 0.5) * 0.07;
  const posBonus = isInPosition ? 0.04 : -0.02;
  const multiwayPenalty = Math.max(0, activeCount - 2) * (0.015 + foldPress * 0.025);

  if (street === 0) {
    // --- PREFLOP ---
    const preflopPlay = Math.max(0.08, Math.min(0.84, 0.78 - looseness * 0.72));
    const preflopRaise = preflopPlay + (1 - preAgg) * (0.90 - preflopPlay) * 0.75;
    const preflop3Bet = Math.max(
      preflopRaise + 0.06,
      Math.min(0.96, 0.96 - preAgg * 0.38 - (preAgg > 0.2 ? looseness * 0.14 : 0))
    );
    const potOddsFactor = 0.35 + foldPress * 0.90;

    const rawStr = evaluatePreflopStrength(hole0, hole1);
    const effStr = rawStr + posBonus + noise - multiwayPenalty;

    if (toCall === 0) {
      if (canRaise && effStr >= preflopRaise) {
        const raiseTo = choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack);
        return { type: 'raise', amount: raiseTo };
      }
      return { type: 'check', amount: 0 };
    }

    const isUnopened = currentBet <= bb;
    const facing3Bet = raisesThisStreet >= 2;
    const betInBB = toCall / bb;

    if (isUnopened) {
      if (canRaise && effStr >= preflopRaise) {
        const raiseTo = choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack);
        return { type: 'raise', amount: raiseTo };
      }
      if (effStr >= preflopPlay) {
        if (canRaise && preAgg >= 0.65 && rng() < preAgg * 0.7) {
          const raiseTo = choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack);
          return { type: 'raise', amount: raiseTo };
        }
        return { type: 'call', amount: Math.min(toCall, playerStack) };
      }
      if (potOdds < 0.22 && effStr >= preflopPlay - 0.10 * (1 - foldPress)) {
        return { type: 'call', amount: Math.min(toCall, playerStack) };
      }
      return { type: 'fold', amount: 0 };
    }

    // Facing a preflop raise or 3-bet+
    if (canRaise && effStr >= preflop3Bet + (facing3Bet ? 0.09 : 0)) {
      const raiseTo = choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack);
      return { type: 'raise', amount: raiseTo };
    }
    if (canRaise && !facing3Bet && effStr >= preflopPlay && rng() < bluff * 0.45 * preAgg) {
      const raiseTo = choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack);
      return { type: 'raise', amount: raiseTo };
    }

    const sizePressure = Math.min(0.28, Math.max(0, (betInBB - 2.5) * 0.016)) * potOddsFactor;
    const callThreshold =
      0.10 +
      foldPress * 0.56 +
      (facing3Bet ? 0.10 + foldPress * 0.10 : 0) +
      sizePressure +
      potOdds * 0.28 * potOddsFactor;

    if (effStr >= callThreshold || (potOdds < 0.15 && effStr >= preflopPlay - 0.05)) {
      return { type: 'call', amount: Math.min(toCall, playerStack) };
    }
    return { type: 'fold', amount: 0 };
  }

  // --- POSTFLOP (Flop / Turn / River) ---
  const evalRes = evaluatePostflopStrength(hole0, hole1, board, boardLen);
  const isRiver = street === 3;
  const facingRaise = raisesThisStreet >= 2;

  // Draw value is weighted by this player's drawDefense setting (Nits discount draws under fire!)
  const drawWeight = (0.05 + 0.95 * drawDef) * (facingRaise ? 0.42 : 1.0);
  const effectiveDraw = evalRes.drawBoost * drawWeight * (1 - evalRes.madeStrength * 0.45);
  const effStr = Math.min(0.99, evalRes.madeStrength + effectiveDraw) + posBonus + noise - multiwayPenalty;

  const postflopBet = 0.80 - postAgg * 0.48;
  const postflopRaise = 0.92 - postAgg * 0.38;
  const semiBluffFreq = Math.min(0.90, postAgg * 0.42 + bluff * 1.15) * (0.20 + 0.80 * drawDef);

  if (toCall === 0) {
    // Checked to us: Check vs Bet
    const cbetBoost = wasAggressor ? 0.03 + postAgg * 0.07 : 0;
    if (canRaise && effStr + cbetBoost >= postflopBet) {
      const betTo = choosePostflopBetSize(pot, bb, betSizePotFrac, playerStreetBet, playerStack, effStr > 0.80);
      return { type: 'bet', amount: betTo };
    }
    // Semi-bluff bet with a strong draw
    if (canRaise && !isRiver && evalRes.hasStrongDraw && rng() < semiBluffFreq) {
      const betTo = choosePostflopBetSize(pot, bb, betSizePotFrac, playerStreetBet, playerStack, false);
      return { type: 'bet', amount: betTo };
    }
    // Pure bluff / stab
    const bluffProb = bluff * (isInPosition ? 1.15 : 0.72) * (wasAggressor ? 1.2 : 0.85) * (activeCount <= 2 ? 1.0 : 0.55);
    if (canRaise && activeCount <= 3 && rng() < bluffProb) {
      const betTo = choosePostflopBetSize(pot, bb, betSizePotFrac, playerStreetBet, playerStack, false);
      return { type: 'bet', amount: betTo };
    }
    return { type: 'check', amount: 0 };
  }

  // Facing a postflop bet or raise
  // Value raise
  if (canRaise && effStr >= postflopRaise + (facingRaise ? 0.08 + foldPress * 0.06 : 0)) {
    const raiseTo = choosePostflopRaiseSize(pot, currentBet, bb, betSizePotFrac, playerStreetBet, playerStack);
    return { type: 'raise', amount: raiseTo };
  }
  // Semi-bluff raise with strong draw (only aggressive/TAG types with draw appetite)
  if (canRaise && !isRiver && !facingRaise && evalRes.hasStrongDraw && rng() < semiBluffFreq * 0.55) {
    const raiseTo = choosePostflopRaiseSize(pot, currentBet, bb, betSizePotFrac, playerStreetBet, playerStack);
    return { type: 'raise', amount: raiseTo };
  }
  // Pure bluff raise
  if (canRaise && !facingRaise && activeCount === 2 && rng() < bluff * 0.25 * postAgg) {
    const raiseTo = choosePostflopRaiseSize(pot, currentBet, bb, betSizePotFrac, playerStreetBet, playerStack);
    return { type: 'raise', amount: raiseTo };
  }

  // Call vs Fold: governed directly by foldToPressure, pot odds, facingRaise, and drawDefense
  const baseCallFloor = 0.12 + foldPress * 0.50;
  const raisePenalty = facingRaise ? 0.06 + foldPress * 0.22 : 0;
  const potOddsFactor = 0.35 + foldPress * 0.95;

  const callThreshold = Math.max(
    baseCallFloor + raisePenalty,
    potOdds * potOddsFactor + (baseCallFloor - 0.18) * 0.70 + raisePenalty
  );

  // Explicit archetype-driven draw defense (Nits fold draws facing pressure/raises; Stations call)
  let defendedDraw = false;
  if (!isRiver && (evalRes.hasStrongDraw || (evalRes.hasWeakDraw && drawDef >= 0.65))) {
    const maxOdds = 0.20 + drawDef * 0.32 - (facingRaise ? 0.10 : 0);
    const drawCallProb =
      potOdds <= maxOdds
        ? drawDef * (facingRaise ? 0.25 : 1.0)
        : drawDef * (facingRaise ? 0.04 : 0.22);
    if (rng() < drawCallProb) {
      defendedDraw = true;
    }
  }

  if (effStr >= callThreshold || defendedDraw || (toCall <= bb && effStr >= baseCallFloor * 0.72)) {
    return { type: 'call', amount: Math.min(toCall, playerStack) };
  }
  return { type: 'fold', amount: 0 };
}

function choosePreflopRaiseSize(currentBet, bb, raisesThisStreet, betSizePotFrac, playerStreetBet, playerStack) {
  const maxTotal = playerStreetBet + playerStack;
  let target;
  if (raisesThisStreet === 0) {
    const mult = betSizePotFrac >= 0.80 ? 3.5 : betSizePotFrac >= 0.62 ? 3.0 : 2.5;
    target = Math.round(bb * mult);
  } else {
    target = Math.round(currentBet * 3);
  }
  target = Math.max(currentBet + bb, target);
  if (target - playerStreetBet >= playerStack * 0.65) {
    return maxTotal;
  }
  return Math.min(maxTotal, target);
}

function choosePostflopBetSize(pot, bb, betSizePotFrac, playerStreetBet, playerStack, isMonster) {
  const maxTotal = playerStreetBet + playerStack;
  const frac = isMonster ? Math.min(1.5, betSizePotFrac + 0.12) : betSizePotFrac;
  const betSize = Math.max(bb, Math.round(pot * frac));
  const target = playerStreetBet + betSize;
  if (target - playerStreetBet >= playerStack * 0.65) {
    return maxTotal;
  }
  return Math.min(maxTotal, target);
}

function choosePostflopRaiseSize(pot, currentBet, bb, betSizePotFrac, playerStreetBet, playerStack) {
  const maxTotal = playerStreetBet + playerStack;
  const minRaise = Math.max(bb, currentBet - playerStreetBet);
  const potRaise = Math.round(currentBet * 2.5 + pot * 0.25 * betSizePotFrac);
  const target = Math.max(currentBet + minRaise, potRaise);
  if (target - playerStreetBet >= playerStack * 0.65) {
    return maxTotal;
  }
  return Math.min(maxTotal, target);
}
