import { RANKS } from './cards.js';

export const HAND_CATEGORIES = [
  'High Card',
  'One Pair',
  'Two Pair',
  'Three of a Kind',
  'Straight',
  'Flush',
  'Full House',
  'Four of a Kind',
  'Straight Flush',
];

// Precomputed 13-bit lookup tables (2^13 = 8192)
const STRAIGHT_HIGH = new Int8Array(8192);
const TOP5_SCORE = new Int32Array(8192);

(function initTables() {
  STRAIGHT_HIGH.fill(-1);
  const wheelMask = (1 << 12) | 0x0f; // A-2-3-4-5

  for (let mask = 0; mask < 8192; mask++) {
    // Highest straight
    for (let high = 12; high >= 4; high--) {
      const pattern = 0x1f << (high - 4);
      if ((mask & pattern) === pattern) {
        STRAIGHT_HIGH[mask] = high;
        break;
      }
    }
    if (STRAIGHT_HIGH[mask] === -1 && (mask & wheelMask) === wheelMask) {
      STRAIGHT_HIGH[mask] = 3; // 5-high wheel straight
    }

    // Top 5 ranks packed into 20 bits (4 bits each)
    let packed = 0;
    let picked = 0;
    for (let r = 12; r >= 0 && picked < 5; r--) {
      if (mask & (1 << r)) {
        packed = (packed << 4) | r;
        picked++;
      }
    }
    while (picked < 5) {
      packed <<= 4;
      picked++;
    }
    TOP5_SCORE[mask] = packed;
  }
})();

// Reusable scratch arrays for zero-allocation evaluation
const _rankCounts = new Int8Array(13);
const _suitCounts = new Int8Array(4);
const _suitMasks = new Int16Array(4);

/**
 * Evaluates 5, 6, or 7 cards into a comparable 32-bit integer score.
 * Higher score strictly beats lower score; equal scores are exact ties.
 */
export function evaluateHand(cards, len = cards.length) {
  _rankCounts.fill(0);
  _suitCounts.fill(0);
  _suitMasks.fill(0);

  let allMask = 0;
  for (let i = 0; i < len; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    const bit = 1 << r;
    _rankCounts[r]++;
    _suitCounts[s]++;
    _suitMasks[s] |= bit;
    allMask |= bit;
  }

  // Check flush / straight flush
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (_suitCounts[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  if (flushSuit !== -1) {
    const sfHigh = STRAIGHT_HIGH[_suitMasks[flushSuit]];
    if (sfHigh !== -1) {
      return (8 << 20) | (sfHigh << 16);
    }
  }

  // Scan ranks high-to-low to collect quads, trips, pairs
  let quad = -1;
  let trip1 = -1;
  let trip2 = -1;
  let pair1 = -1;
  let pair2 = -1;

  for (let r = 12; r >= 0; r--) {
    const cnt = _rankCounts[r];
    if (cnt === 4) {
      quad = r;
    } else if (cnt === 3) {
      if (trip1 === -1) trip1 = r;
      else if (trip2 === -1) trip2 = r;
    } else if (cnt === 2) {
      if (pair1 === -1) pair1 = r;
      else if (pair2 === -1) pair2 = r;
    }
  }

  // 7: Four of a Kind
  if (quad !== -1) {
    let kicker = 0;
    for (let r = 12; r >= 0; r--) {
      if (r !== quad && _rankCounts[r] > 0) {
        kicker = r;
        break;
      }
    }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }

  // 6: Full House
  if (trip1 !== -1 && (trip2 !== -1 || pair1 !== -1)) {
    const housePair = trip2 > pair1 ? trip2 : pair1;
    return (6 << 20) | (trip1 << 16) | (housePair << 12);
  }

  // 5: Flush
  if (flushSuit !== -1) {
    return (5 << 20) | TOP5_SCORE[_suitMasks[flushSuit]];
  }

  // 4: Straight
  const stHigh = STRAIGHT_HIGH[allMask];
  if (stHigh !== -1) {
    return (4 << 20) | (stHigh << 16);
  }

  // 3: Three of a Kind
  if (trip1 !== -1) {
    let k1 = 0;
    let k2 = 0;
    let found = 0;
    for (let r = 12; r >= 0; r--) {
      if (r !== trip1 && _rankCounts[r] > 0) {
        if (found === 0) k1 = r;
        else {
          k2 = r;
          break;
        }
        found++;
      }
    }
    return (3 << 20) | (trip1 << 16) | (k1 << 12) | (k2 << 8);
  }

  // 2: Two Pair (handles 3-pair boards properly by picking highest remaining card as kicker)
  if (pair1 !== -1 && pair2 !== -1) {
    let kicker = 0;
    for (let r = 12; r >= 0; r--) {
      if (r !== pair1 && r !== pair2 && _rankCounts[r] > 0) {
        kicker = r;
        break;
      }
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8);
  }

  // 1: One Pair
  if (pair1 !== -1) {
    let k1 = 0;
    let k2 = 0;
    let k3 = 0;
    let found = 0;
    for (let r = 12; r >= 0; r--) {
      if (r !== pair1 && _rankCounts[r] > 0) {
        if (found === 0) k1 = r;
        else if (found === 1) k2 = r;
        else {
          k3 = r;
          break;
        }
        found++;
      }
    }
    return (1 << 20) | (pair1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4);
  }

  // 0: High Card
  return TOP5_SCORE[allMask];
}

export function scoreCategory(score) {
  return score >> 20;
}

export function describeHandScore(score) {
  const cat = score >> 20;
  const r1 = (score >> 16) & 0x0f;
  const r2 = (score >> 12) & 0x0f;
  const rn = (r) => RANKS[r] || '?';

  switch (cat) {
    case 8:
      return r1 === 12 ? 'Royal Flush' : `Straight Flush (${rn(r1)}-high)`;
    case 7:
      return `Four of a Kind (${rn(r1)}s)`;
    case 6:
      return `Full House (${rn(r1)}s full of ${rn(r2)}s)`;
    case 5:
      return `Flush (${rn(r1)}-high)`;
    case 4:
      return `Straight (${rn(r1)}-high)`;
    case 3:
      return `Three of a Kind (${rn(r1)}s)`;
    case 2:
      return `Two Pair (${rn(r1)}s & ${rn(r2)}s)`;
    case 1:
      return `Pair of ${rn(r1)}s`;
    default:
      return `${rn(r1)}-High`;
  }
}

/**
 * Preflop hand strength heuristic in [0.04, 1.00] (Chen-formula inspired).
 */
export function evaluatePreflopStrength(c1, c2) {
  let r1 = c1 >> 2;
  let r2 = c2 >> 2;
  const suited = (c1 & 3) === (c2 & 3);
  if (r2 > r1) {
    const tmp = r1;
    r1 = r2;
    r2 = tmp;
  }

  // Base high-card points (A=10, K=8, Q=7, J=6, T=5, 9..2 = rank/2)
  const highPts = (r) => {
    if (r === 12) return 10;
    if (r === 11) return 8;
    if (r === 10) return 7;
    if (r === 9) return 6;
    return (r + 2) / 2;
  };

  let score = highPts(r1);
  const isPair = r1 === r2;

  if (isPair) {
    score = Math.max(5.5, score * 2);
    if (r1 === 3) score = Math.max(score, 6); // 55
  } else {
    if (suited) score += 2.0;

    const gap = r1 - r2 - 1;
    if (gap === 1) score -= 1;
    else if (gap === 2) score -= 2;
    else if (gap === 3) score -= 4;
    else if (gap >= 4) score -= 5;

    // Straight bonus for connected low/mid cards (e.g. T9s, 98s, 76s, QJ)
    if (gap <= 1 && r1 < 10) {
      score += 1;
    }
    // Wheel-ace suited bonus (A5s-A2s)
    if (r1 === 12 && r2 <= 3 && suited) {
      score += 1.5;
    }
  }

  // Map roughly [-2, 20] -> [0.04, 1.00]
  const norm = (score + 2.0) / 22.0;
  return Math.max(0.04, Math.min(1.0, norm));
}

const _evalBuf = new Int8Array(7);
const _boardRankCounts = new Int8Array(13);
const _boardSuitCounts = new Int8Array(4);
const _fullSuitCounts = new Int8Array(4);

/**
 * Evaluates postflop effective hand strength in [0.05, 1.00], incorporating
 * made-hand quality relative to board texture plus flop/turn draw potential.
 */
export function evaluatePostflopStrength(hole0, hole1, board, boardLen) {
  _evalBuf[0] = hole0;
  _evalBuf[1] = hole1;
  _boardRankCounts.fill(0);
  _boardSuitCounts.fill(0);
  _fullSuitCounts.fill(0);

  let boardMask = 0;
  let boardHighRank = -1;
  let boardSecondRank = -1;

  for (let i = 0; i < boardLen; i++) {
    const c = board[i];
    _evalBuf[2 + i] = c;
    const r = c >> 2;
    const s = c & 3;
    _boardRankCounts[r]++;
    _boardSuitCounts[s]++;
    _fullSuitCounts[s]++;
    boardMask |= 1 << r;
    if (r > boardHighRank) {
      boardSecondRank = boardHighRank;
      boardHighRank = r;
    } else if (r > boardSecondRank && r !== boardHighRank) {
      boardSecondRank = r;
    }
  }

  const h0r = hole0 >> 2;
  const h1r = hole1 >> 2;
  const h0s = hole0 & 3;
  const h1s = hole1 & 3;
  _fullSuitCounts[h0s]++;
  _fullSuitCounts[h1s]++;
  const allMask = boardMask | (1 << h0r) | (1 << h1r);

  const score = evaluateHand(_evalBuf, 2 + boardLen);
  const cat = score >> 20;
  const primaryRank = (score >> 16) & 0x0f;
  const secondaryRank = (score >> 12) & 0x0f;

  // Check if board itself is paired / trips / flushy
  let boardMaxDup = 1;
  let boardPairRank = -1;
  for (let r = 12; r >= 0; r--) {
    if (_boardRankCounts[r] > boardMaxDup) {
      boardMaxDup = _boardRankCounts[r];
      boardPairRank = r;
    }
  }

  let strength = 0.12;
  const highHole = h0r > h1r ? h0r : h1r;
  const lowHole = h0r > h1r ? h1r : h0r;

  if (cat >= 7) {
    strength = 0.99;
  } else if (cat === 6) {
    strength = 0.95 + (primaryRank / 12) * 0.03;
  } else if (cat === 5) {
    // Flush: check if we actually hold a card of the flush suit
    let flushSuit = -1;
    for (let s = 0; s < 4; s++) {
      if (_fullSuitCounts[s] >= 5) {
        flushSuit = s;
        break;
      }
    }
    const holeFlushCards = (h0s === flushSuit ? 1 : 0) + (h1s === flushSuit ? 1 : 0);
    if (holeFlushCards === 0) {
      strength = 0.45; // Playing board flush
    } else {
      const bestSuitRank =
        h0s === flushSuit && h1s === flushSuit
          ? highHole
          : h0s === flushSuit
            ? h0r
            : h1r;
      strength = 0.85 + (bestSuitRank / 12) * 0.09;
    }
  } else if (cat === 4) {
    const boardStraight = STRAIGHT_HIGH[boardMask];
    if (boardStraight === primaryRank) {
      strength = 0.48; // Playing board straight
    } else {
      strength = 0.80 + (primaryRank / 12) * 0.08;
    }
  } else if (cat === 3) {
    if (boardMaxDup >= 3 && primaryRank === boardPairRank) {
      // Board trips; strength depends on kicker
      strength = 0.36 + (highHole / 12) * 0.18;
    } else if (h0r === h1r && h0r === primaryRank) {
      // Pocket set!
      strength = 0.81 + (primaryRank / 12) * 0.07;
    } else {
      // Trips using 1 hole card + board pair
      const kicker = h0r === primaryRank ? h1r : h0r;
      strength = 0.72 + (primaryRank / 12) * 0.06 + (kicker / 12) * 0.04;
    }
  } else if (cat === 2) {
    // Two pair
    const boardPairs = _boardRankCounts[primaryRank] >= 2 || _boardRankCounts[secondaryRank] >= 2;
    const bothBoardPairs =
      _boardRankCounts[primaryRank] >= 2 && _boardRankCounts[secondaryRank] >= 2;
    if (bothBoardPairs) {
      strength = 0.30 + (highHole / 12) * 0.16;
    } else if (boardPairs) {
      // One board pair + one of our own pairs
      const ownPair = _boardRankCounts[primaryRank] >= 2 ? secondaryRank : primaryRank;
      if (ownPair >= boardHighRank) strength = 0.67 + (ownPair / 12) * 0.06;
      else strength = 0.56 + (ownPair / 12) * 0.06;
    } else {
      // True two pair using both hole cards
      strength = 0.72 + (primaryRank / 12) * 0.06 + (secondaryRank / 12) * 0.04;
    }
  } else if (cat === 1) {
    // One pair
    if (boardMaxDup === 2 && primaryRank === boardPairRank) {
      // Just playing board pair (effectively high card)
      strength = 0.20 + (highHole / 12) * 0.14 + (lowHole / 12) * 0.04;
    } else if (h0r === h1r) {
      // Pocket pair
      if (h0r > boardHighRank) {
        // Overpair
        strength = 0.67 + (h0r / 12) * 0.10;
      } else if (h0r > boardSecondRank) {
        // Between top and second board card
        strength = 0.48 + (h0r / 12) * 0.08;
      } else {
        // Underpair
        strength = 0.36 + (h0r / 12) * 0.08;
      }
    } else {
      // Paired a board card
      const kicker = h0r === primaryRank ? h1r : h0r;
      if (primaryRank === boardHighRank) {
        // Top pair
        strength = 0.56 + (kicker / 12) * 0.14;
      } else if (primaryRank === boardSecondRank) {
        // Middle pair
        strength = 0.43 + (kicker / 12) * 0.09;
      } else {
        // Bottom/low pair
        strength = 0.34 + (kicker / 12) * 0.08;
      }
    }
  } else {
    // High card
    strength = 0.10 + (highHole / 12) * 0.13 + (lowHole / 12) * 0.05;
  }

  const madeStrength = Math.max(0.05, Math.min(1.0, strength));

  // Draw potential on Flop (3) and Turn (4)
  let hasStrongDraw = false;
  let hasWeakDraw = false;
  let drawBoost = 0;

  if (boardLen < 5 && cat < 5) {
    const streetScale = boardLen === 3 ? 1.0 : 0.52;

    // Flush draw (4 of a suit with at least 1 hole card contributing)
    for (let s = 0; s < 4; s++) {
      if (_fullSuitCounts[s] === 4 && (h0s === s || h1s === s)) {
        drawBoost += 0.22 * streetScale;
        hasStrongDraw = true;
        break;
      }
    }

    // Straight draw (only if not already a straight)
    if (cat < 4) {
      let straightRankOuts = 0;
      for (let r = 0; r < 13; r++) {
        const bit = 1 << r;
        if (allMask & bit) continue;
        const newSt = STRAIGHT_HIGH[allMask | bit];
        if (newSt !== -1 && newSt > STRAIGHT_HIGH[boardMask | bit]) {
          straightRankOuts++;
        }
      }
      if (straightRankOuts >= 2) {
        drawBoost += 0.19 * streetScale;
        hasStrongDraw = true;
      } else if (straightRankOuts === 1) {
        drawBoost += 0.09 * streetScale;
        hasWeakDraw = true;
      }
    }

    // Two overcards to the board on flop/turn
    if (cat === 0 && lowHole > boardHighRank) {
      drawBoost += 0.09 * streetScale;
      hasWeakDraw = true;
    }

    strength = Math.min(0.86, madeStrength + drawBoost * (1 - madeStrength * 0.45));
  }

  return {
    strength: Math.max(0.05, Math.min(1.0, strength)),
    madeStrength,
    drawBoost,
    category: cat,
    hasStrongDraw,
    hasWeakDraw,
  };
}
