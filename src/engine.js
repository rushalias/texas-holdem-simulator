import { cardToPretty } from './cards.js';
import { evaluateHand, describeHandScore, scoreCategory } from './evaluator.js';
import { decideAction } from './archetypes.js';

export const STREET_NAMES = ['Preflop', 'Flop', 'Turn', 'River'];

const _showdownBuf = new Int8Array(7);

/**
 * Plays a single No-Limit Texas Hold'em hand with full betting rounds,
 * player archetype decisions, and exact main/side-pot resolution.
 */
export function playHand(params, rng) {
  const {
    holes,           // Array<[c0, c1]> of length N
    board,           // Array<number> of length 5
    archetypes,      // Array<Archetype> of length N
    names,           // Array<string> of length N
    positions,       // Array<string> of length N
    stacks,          // Array<number> initial stacks (integer chips)
    sb,              // Small blind (integer chips)
    bb,              // Big blind (integer chips)
    buttonIndex = 0, // Dealer button seat index
    startStreet = 0, // 0=Preflop, 1=Flop, 2=Turn, 3=River
    startingPot = 0, // Total pot already in middle when startStreet > 0
    maxRaisesPerStreet = 4,
    recordHistory = false,
  } = params;

  const n = holes.length;
  const curStacks = stacks.slice();
  const totalBet = new Float64Array(n);
  const folded = new Uint8Array(n);
  const allIn = new Uint8Array(n);
  const vpip = new Uint8Array(n);
  const pfr = new Uint8Array(n);
  const aggActions = new Uint16Array(n);
  const passActions = new Uint16Array(n);

  const history = recordHistory
    ? {
        holes: holes.map((h) => [cardToPretty(h[0]), cardToPretty(h[1])]),
        board: board.map(cardToPretty),
        startStreet,
        events: [],
        winners: [],
        pot: 0,
        endedStreet: '',
      }
    : null;

  const logEvent = (msg) => {
    if (history) history.events.push(msg);
  };

  let pot = 0;
  let activeCount = n;
  let lastAggressor = -1;

  const postChips = (seat, amount) => {
    const actual = Math.min(amount, curStacks[seat]);
    curStacks[seat] -= actual;
    totalBet[seat] += actual;
    pot += actual;
    if (curStacks[seat] === 0) allIn[seat] = 1;
    return actual;
  };

  const btn = ((buttonIndex % n) + n) % n;
  const sbSeat = n === 2 ? btn : (btn + 1) % n;
  const bbSeat = n === 2 ? (btn + 1) % n : (btn + 2) % n;

  // Initial blinds or starting pot for postflop starts
  let preflopCurrentBet = 0;
  const preflopStreetBet = new Float64Array(n);

  if (startStreet === 0) {
    const sbPosted = postChips(sbSeat, sb);
    const bbPosted = postChips(bbSeat, bb);
    preflopStreetBet[sbSeat] = sbPosted;
    preflopStreetBet[bbSeat] = bbPosted;
    preflopCurrentBet = Math.max(sbPosted, bbPosted);
    if (history) {
      logEvent(
        `Preflop · ${names[sbSeat]} (${positions[sbSeat]}) posts SB ${fmtBB(sbPosted, bb)}, ${names[bbSeat]} (${positions[bbSeat]}) posts BB ${fmtBB(bbPosted, bb)}`
      );
    }
  } else {
    const perPlayer = Math.max(bb, Math.round((startingPot || n * 3 * bb) / n));
    for (let i = 0; i < n; i++) {
      postChips(i, perPlayer);
    }
    if (history) {
      const shownBoard = board.slice(0, startStreet === 1 ? 3 : startStreet === 2 ? 4 : 5).map(cardToPretty).join(' ');
      logEvent(
        `Starting on ${STREET_NAMES[startStreet]} [${shownBoard}] · Pot ${fmtBB(pot, bb)} (${fmtBB(perPlayer, bb)} each)`
      );
    }
  }

  let endedStreet = startStreet;
  let reachedShowdown = false;

  for (let street = startStreet; street <= 3; street++) {
    if (activeCount <= 1) break;
    endedStreet = street;

    const boardLen = street === 0 ? 0 : street === 1 ? 3 : street === 2 ? 4 : 5;
    if (history && street > startStreet) {
      const dealt = board.slice(0, boardLen).map(cardToPretty).join(' ');
      logEvent(`— ${STREET_NAMES[street]} [${dealt}] (Pot: ${fmtBB(pot, bb)}) —`);
    }

    // Count players able to act (not folded and have chips left)
    let canActCount = 0;
    for (let i = 0; i < n; i++) {
      if (!folded[i] && curStacks[i] > 0) canActCount++;
    }
    if (canActCount <= 1) continue;

    const streetBet = street === 0 && startStreet === 0 ? preflopStreetBet : new Float64Array(n);
    let currentBet = street === 0 && startStreet === 0 ? preflopCurrentBet : 0;
    let raisesThisStreet = 0;
    const needsToAct = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (!folded[i] && curStacks[i] > 0) needsToAct[i] = 1;
    }

    // Determine first seat to act on this street
    let actor;
    if (street === 0) {
      actor = n === 2 ? sbSeat : (btn + 3) % n;
    } else {
      actor = (btn + 1) % n;
    }

    // Count remaining actors ahead to approximate position (in-position if acting in back half)
    let safety = 0;
    while (safety++ < n * 10) {
      // Find next seat that needs to act
      let found = -1;
      for (let step = 0; step < n; step++) {
        const s = (actor + step) % n;
        if (needsToAct[s] && !folded[s] && curStacks[s] > 0) {
          found = s;
          break;
        }
      }
      if (found === -1 || activeCount <= 1) break;
      actor = found;

      // Determine if player is roughly in position (acts near or on button)
      const distFromFirst = (actor - (btn + 1) + n) % n;
      const isInPosition = distFromFirst >= Math.floor(n / 2);

      const action = decideAction(
        {
          archetype: archetypes[actor],
          hole0: holes[actor][0],
          hole1: holes[actor][1],
          board,
          boardLen,
          street,
          pot,
          currentBet,
          playerStreetBet: streetBet[actor],
          playerStack: curStacks[actor],
          bb,
          raisesThisStreet,
          maxRaisesPerStreet,
          isInPosition,
          activeCount,
          wasAggressor: lastAggressor === actor,
        },
        rng
      );

      const toCall = Math.max(0, currentBet - streetBet[actor]);

      if (action.type === 'fold' && toCall > 0) {
        folded[actor] = 1;
        needsToAct[actor] = 0;
        activeCount--;
        logEvent(`  ${names[actor]} (${archetypes[actor].shortName}) folds`);
      } else if (action.type === 'check' || (action.type === 'fold' && toCall === 0)) {
        needsToAct[actor] = 0;
        passActions[actor]++;
        logEvent(`  ${names[actor]} (${archetypes[actor].shortName}) checks`);
      } else if (action.type === 'call') {
        const paid = postChips(actor, toCall);
        streetBet[actor] += paid;
        needsToAct[actor] = 0;
        vpip[actor] = 1;
        passActions[actor]++;
        const allInTag = curStacks[actor] === 0 ? ' (all-in)' : '';
        logEvent(
          `  ${names[actor]} (${archetypes[actor].shortName}) calls ${fmtBB(paid, bb)}${allInTag}`
        );
      } else {
        // bet or raise
        const desiredTotal = Math.max(currentBet + bb, action.amount);
        const deltaNeeded = Math.max(toCall, desiredTotal - streetBet[actor]);
        const paid = postChips(actor, deltaNeeded);
        streetBet[actor] += paid;
        vpip[actor] = 1;

        if (streetBet[actor] > currentBet) {
          const verb = currentBet === 0 ? 'bets' : 'raises to';
          currentBet = streetBet[actor];
          raisesThisStreet++;
          lastAggressor = actor;
          aggActions[actor]++;
          if (street === 0) pfr[actor] = 1;

          // Everyone else who is active and not all-in must respond
          for (let j = 0; j < n; j++) {
            needsToAct[j] = j !== actor && !folded[j] && curStacks[j] > 0 ? 1 : 0;
          }
          const allInTag = curStacks[actor] === 0 ? ' (all-in)' : '';
          logEvent(
            `  ${names[actor]} (${archetypes[actor].shortName}) ${verb} ${fmtBB(currentBet, bb)}${allInTag}`
          );
        } else {
          // Short all-in that didn't exceed currentBet -> treated as call
          needsToAct[actor] = 0;
          passActions[actor]++;
          logEvent(
            `  ${names[actor]} (${archetypes[actor].shortName}) calls ${fmtBB(paid, bb)} (all-in)`
          );
        }
      }

      actor = (actor + 1) % n;
    }
  }

  // --- POT RESOLUTION ---
  const payouts = new Float64Array(n);
  const scores = new Int32Array(n);
  let winningCategory = -1;

  if (activeCount === 1) {
    // Win by fold
    let soleWinner = -1;
    for (let i = 0; i < n; i++) {
      if (!folded[i]) {
        soleWinner = i;
        break;
      }
    }
    payouts[soleWinner] = pot;
    curStacks[soleWinner] += pot;
    if (history) {
      history.endedStreet = STREET_NAMES[endedStreet];
      history.pot = pot;
      history.winners.push({
        seat: soleWinner,
        name: names[soleWinner],
        amount: pot,
        hand: 'Uncontested (everyone folded)',
      });
      logEvent(
        `Result: ${names[soleWinner]} wins ${fmtBB(pot, bb)} uncontested on ${STREET_NAMES[endedStreet]}`
      );
    }
  } else {
    // Showdown with exact side-pot calculation
    reachedShowdown = true;
    for (let i = 0; i < n; i++) {
      if (!folded[i]) {
        _showdownBuf[0] = holes[i][0];
        _showdownBuf[1] = holes[i][1];
        for (let b = 0; b < 5; b++) _showdownBuf[2 + b] = board[b];
        scores[i] = evaluateHand(_showdownBuf, 7);
      }
    }

    // Collect sorted unique positive contribution levels of non-folded players
    const levelSet = new Set();
    for (let i = 0; i < n; i++) {
      if (!folded[i] && totalBet[i] > 0) levelSet.add(totalBet[i]);
    }
    const levels = Array.from(levelSet).sort((a, b) => a - b);

    // Order for odd-chip remainder distribution: clockwise starting left of button
    const oddChipOrder = [];
    for (let step = 1; step <= n; step++) {
      oddChipOrder.push((btn + step) % n);
    }

    let prevLevel = 0;
    let allocated = 0;
    let mainPotTopScore = -1;

    for (let li = 0; li < levels.length; li++) {
      const level = levels[li];
      let tierPot = 0;
      for (let j = 0; j < n; j++) {
        const contrib = Math.max(0, Math.min(totalBet[j], level) - prevLevel);
        tierPot += contrib;
      }
      if (tierPot <= 0) {
        prevLevel = level;
        continue;
      }

      let bestScore = -1;
      for (let i = 0; i < n; i++) {
        if (!folded[i] && totalBet[i] >= level && scores[i] > bestScore) {
          bestScore = scores[i];
        }
      }
      if (li === 0) mainPotTopScore = bestScore;

      const winners = [];
      for (const seatIdx of oddChipOrder) {
        if (!folded[seatIdx] && totalBet[seatIdx] >= level && scores[seatIdx] === bestScore) {
          winners.push(seatIdx);
        }
      }

      const share = Math.floor(tierPot / winners.length);
      let rem = tierPot - share * winners.length;
      for (const w of winners) {
        const extra = rem > 0 ? 1 : 0;
        if (rem > 0) rem--;
        payouts[w] += share + extra;
        curStacks[w] += share + extra;
      }
      allocated += tierPot;
      prevLevel = level;
    }

    // Edge guard: if any folded player somehow contributed above max active level
    if (allocated < pot) {
      const leftover = pot - allocated;
      let bestSeat = -1;
      let bestScore = -1;
      for (let i = 0; i < n; i++) {
        if (!folded[i] && scores[i] > bestScore) {
          bestScore = scores[i];
          bestSeat = i;
        }
      }
      if (bestSeat !== -1) {
        payouts[bestSeat] += leftover;
        curStacks[bestSeat] += leftover;
      }
    }

    winningCategory = mainPotTopScore >= 0 ? scoreCategory(mainPotTopScore) : -1;

    if (history) {
      history.endedStreet = 'Showdown';
      history.pot = pot;
      logEvent(`— Showdown [${board.map(cardToPretty).join(' ')}] —`);
      for (let i = 0; i < n; i++) {
        if (!folded[i]) {
          const wonStr = payouts[i] > 0 ? ` → WINS ${fmtBB(payouts[i], bb)}` : '';
          logEvent(
            `  ${names[i]} shows ${cardToPretty(holes[i][0])}${cardToPretty(holes[i][1])} (${describeHandScore(scores[i])})${wonStr}`
          );
        }
      }
      for (let i = 0; i < n; i++) {
        if (payouts[i] > 0) {
          history.winners.push({
            seat: i,
            name: names[i],
            amount: payouts[i],
            hand: describeHandScore(scores[i]),
          });
        }
      }
    }
  }

  const netChips = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    netChips[i] = curStacks[i] - stacks[i];
  }

  return {
    pot,
    payouts,
    netChips,
    finalStacks: curStacks,
    folded,
    vpip,
    pfr,
    aggActions,
    passActions,
    reachedShowdown,
    endedStreet,
    winningCategory,
    history,
  };
}

function fmtBB(chips, bb) {
  const val = chips / bb;
  return Number.isInteger(val) ? `${val} BB` : `${val.toFixed(1)} BB`;
}
