export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_SYMBOLS = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAMES = { s: 'Spades', h: 'Hearts', d: 'Diamonds', c: 'Clubs' };

const RANK_MAP = new Map(RANKS.map((r, i) => [r, i]));
const SUIT_MAP = new Map(SUITS.map((s, i) => [s, i]));

export function makeCard(rank, suit) {
  return (rank << 2) | suit;
}

export function cardRank(card) {
  return card >> 2;
}

export function cardSuit(card) {
  return card & 3;
}

export function cardToString(card) {
  if (card === null || card === undefined || card < 0) return '??';
  return RANKS[card >> 2] + SUITS[card & 3];
}

export function cardToPretty(card) {
  if (card === null || card === undefined || card < 0) return '?';
  return RANKS[card >> 2] + SUIT_SYMBOLS[SUITS[card & 3]];
}

export function stringToCard(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s || s === '?' || s === '??') return null;

  let rankChar;
  let suitChar;
  if (s.length === 3 && s.startsWith('10')) {
    rankChar = 'T';
    suitChar = s[2].toLowerCase();
  } else if (s.length === 2) {
    rankChar = s[0].toUpperCase();
    suitChar = s[1].toLowerCase();
  } else {
    throw new Error(`Invalid card notation: "${raw}"`);
  }

  // Allow Unicode suit symbols as input
  if (suitChar === '♠') suitChar = 's';
  else if (suitChar === '♥') suitChar = 'h';
  else if (suitChar === '♦') suitChar = 'd';
  else if (suitChar === '♣') suitChar = 'c';

  const r = RANK_MAP.get(rankChar);
  const su = SUIT_MAP.get(suitChar);
  if (r === undefined || su === undefined) {
    throw new Error(`Invalid card notation: "${raw}"`);
  }
  return (r << 2) | su;
}

/**
 * Parse hole cards or board cards from string ("As Kh", "AsKh", "As ?", "") or array.
 */
export function parseCardList(input, expectedCount = null) {
  let tokens = [];
  if (input === null || input === undefined) {
    tokens = [];
  } else if (Array.isArray(input)) {
    tokens = input;
  } else if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      tokens = [];
    } else if (trimmed.includes(' ') || trimmed.includes(',')) {
      tokens = trimmed.split(/[\s,]+/).filter(Boolean);
    } else {
      // Compact string like "AsKh" or "Ah7d2c" or "??"
      if (trimmed === '??' || trimmed === '?') {
        tokens = [null, null];
      } else {
        let i = 0;
        while (i < trimmed.length) {
          if (trimmed[i] === '?') {
            tokens.push(null);
            i += 1;
          } else if (trimmed.slice(i, i + 2) === '10' && i + 2 < trimmed.length) {
            tokens.push(trimmed.slice(i, i + 3));
            i += 3;
          } else if (i + 1 < trimmed.length) {
            tokens.push(trimmed.slice(i, i + 2));
            i += 2;
          } else {
            throw new Error(`Malformed card string: "${input}"`);
          }
        }
      }
    }
  } else {
    throw new Error(`Unsupported card list input: ${typeof input}`);
  }

  const parsed = tokens.map((tok) => (typeof tok === 'number' ? tok : stringToCard(tok)));

  if (expectedCount !== null) {
    if (parsed.length > expectedCount) {
      throw new Error(`Expected at most ${expectedCount} cards, got ${parsed.length}`);
    }
    while (parsed.length < expectedCount) {
      parsed.push(null);
    }
  }
  return parsed;
}

/**
 * Validates that no duplicate cards exist across all players and community cards,
 * and builds the remaining undealt deck.
 */
export function buildRemainingDeck(playerHoleCards, boardCards) {
  const used = new Uint8Array(52);
  const check = (card, label) => {
    if (card === null || card === undefined) return;
    if (!Number.isInteger(card) || card < 0 || card > 51) {
      throw new Error(`Invalid card id ${card} in ${label}`);
    }
    if (used[card]) {
      throw new Error(`Duplicate card ${cardToString(card)} found in ${label}`);
    }
    used[card] = 1;
  };

  playerHoleCards.forEach((hole, idx) => {
    if (!Array.isArray(hole) || hole.length !== 2) {
      throw new Error(`Player ${idx + 1} must have exactly 2 hole-card slots`);
    }
    check(hole[0], `Player ${idx + 1}`);
    check(hole[1], `Player ${idx + 1}`);
  });

  if (boardCards.length > 5) {
    throw new Error(`Community board can have at most 5 cards, got ${boardCards.length}`);
  }
  boardCards.forEach((c) => check(c, 'community board'));

  const remaining = [];
  for (let c = 0; c < 52; c++) {
    if (!used[c]) remaining.push(c);
  }

  // Count how many random cards are needed
  let needed = 0;
  for (const hole of playerHoleCards) {
    if (hole[0] === null) needed++;
    if (hole[1] === null) needed++;
  }
  for (let i = 0; i < 5; i++) {
    if (i >= boardCards.length || boardCards[i] === null) needed++;
  }
  if (needed > remaining.length) {
    throw new Error(`Not enough cards left in deck (need ${needed}, have ${remaining.length})`);
  }

  return new Int8Array(remaining);
}

/**
 * Fast deterministic PRNG (Mulberry32). If seed is null/undefined, uses Math.random.
 */
export function createRng(seed) {
  if (seed === null || seed === undefined || seed === '') {
    return Math.random;
  }
  let a = (typeof seed === 'number' ? seed : hashString(String(seed))) >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Partial Fisher-Yates shuffle: shuffles the first `count` positions of `arr` in-place.
 */
export function drawRandomCards(deck, count, rng) {
  const n = deck.length;
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (n - i));
    const tmp = deck[i];
    deck[i] = deck[j];
    deck[j] = tmp;
  }
}

export function getPositionNames(numPlayers) {
  switch (numPlayers) {
    case 2: return ['BTN/SB', 'BB'];
    case 3: return ['BTN', 'SB', 'BB'];
    case 4: return ['BTN', 'SB', 'BB', 'CO'];
    case 5: return ['BTN', 'SB', 'BB', 'UTG', 'CO'];
    case 6: return ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
    case 7: return ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'];
    case 8: return ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'];
    case 9: return ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'];
    default:
      return Array.from({ length: numPlayers }, (_, i) => `Seat ${i + 1}`);
  }
}
