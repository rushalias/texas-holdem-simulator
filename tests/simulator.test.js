import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCardList, buildRemainingDeck, createRng } from '../src/cards.js';
import { evaluateHand, scoreCategory, describeHandScore, evaluatePreflopStrength } from '../src/evaluator.js';
import { getArchetype } from '../src/archetypes.js';
import { playHand } from '../src/engine.js';
import { runSimulation, runSimulationAsync, normalizeConfig, MAX_TRIALS } from '../src/simulator.js';

describe('Card parsing and validation', () => {
  it('parses standard, compact, 10x, and unknown card notations', () => {
    const hole = parseCardList('As 10h', 2);
    assert.equal(hole.length, 2);
    assert.notEqual(hole[0], null);
    assert.notEqual(hole[1], null);

    const partial = parseCardList('Kd ?', 2);
    assert.notEqual(partial[0], null);
    assert.equal(partial[1], null);

    const unknown = parseCardList('??', 2);
    assert.deepEqual(unknown, [null, null]);
  });

  it('rejects duplicate cards across players and board', () => {
    assert.throws(
      () =>
        buildRemainingDeck(
          [parseCardList('As Kd', 2), parseCardList('As Qh', 2)],
          parseCardList('', 5)
        ),
      /Duplicate card/i
    );

    assert.throws(
      () =>
        buildRemainingDeck(
          [parseCardList('As Kd', 2), parseCardList('Qc Jc', 2)],
          parseCardList('Kd 7h 2c', 5)
        ),
      /Duplicate card/i
    );
  });
});

describe('7-card Holdem hand evaluator', () => {
  const evalStr = (s) => evaluateHand(parseCardList(s));

  it('ranks all 9 hand categories in strictly increasing order', () => {
    const highCard = evalStr('As Kd 9c 7h 4s 2d 3c');
    const onePair = evalStr('As Ad 9c 7h 4s 2d 3c');
    const twoPair = evalStr('As Ad 9c 9h 4s 2d 3c');
    const trips = evalStr('As Ad Ac 9h 4s 2d 3c');
    const wheelStraight = evalStr('As 2d 3c 4h 5s 9d Kc');
    const broadwayStraight = evalStr('As Kd Qc Jh Ts 2d 3c');
    const flush = evalStr('As Ks 9s 7s 2s 4d 3c');
    const fullHouse = evalStr('As Ad Ac Ks Kd 2d 3c');
    const quads = evalStr('As Ad Ac Ah 5s 2d 3c');
    const straightFlush = evalStr('9s 8s 7s 6s 5s Ad Kc');
    const royalFlush = evalStr('As Ks Qs Js Ts 2d 3c');

    assert.equal(scoreCategory(highCard), 0);
    assert.equal(scoreCategory(onePair), 1);
    assert.equal(scoreCategory(twoPair), 2);
    assert.equal(scoreCategory(trips), 3);
    assert.equal(scoreCategory(wheelStraight), 4);
    assert.equal(scoreCategory(broadwayStraight), 4);
    assert.equal(scoreCategory(flush), 5);
    assert.equal(scoreCategory(fullHouse), 6);
    assert.equal(scoreCategory(quads), 7);
    assert.equal(scoreCategory(straightFlush), 8);
    assert.equal(describeHandScore(royalFlush), 'Royal Flush');

    const ordered = [
      highCard,
      onePair,
      twoPair,
      trips,
      wheelStraight,
      broadwayStraight,
      flush,
      fullHouse,
      quads,
      straightFlush,
      royalFlush,
    ];
    for (let i = 1; i < ordered.length; i++) {
      assert.ok(ordered[i] > ordered[i - 1], `Expected rank ${i} > rank ${i - 1}`);
    }
  });

  it('handles 7-card edge cases: 3 pairs, 2 trips, quads+trips kicker, exact ties', () => {
    // 3-pair board: AA KK QQ 2 -> kicker must be Q, beating AA KK JJ 9
    const threePairsQ = evalStr('As Ad Ks Kd Qs Qd 2c');
    const threePairsJ = evalStr('As Ad Ks Kd Js Jd 9c');
    assert.ok(threePairsQ > threePairsJ);

    // 2 trips: AAA KKK 2 -> AAA full of KK beats AAA full of QQ
    const twoTripsK = evalStr('As Ad Ac Ks Kd Kc 2h');
    const twoTripsQ = evalStr('As Ad Ac Qs Qd Qc Kh');
    assert.ok(twoTripsK > twoTripsQ);

    // Exact split pot when board plays (broadway straight on board)
    const p1 = evalStr('2c 3d As Ks Qs Js Th');
    const p2 = evalStr('7h 8c As Ks Qs Js Th');
    assert.equal(p1, p2);
  });

  it('orders preflop hand strengths sensibly', () => {
    const str = (s) => {
      const [a, b] = parseCardList(s, 2);
      return evaluatePreflopStrength(a, b);
    };
    assert.ok(str('As Ad') > str('Ks Kd'));
    assert.ok(str('Ks Kd') > str('Qs Qd'));
    assert.ok(str('As Ks') > str('As Kd'));
    assert.ok(str('As Kd') > str('7s 6s'));
    assert.ok(str('7s 6s') > str('7s 2d'));
  });
});

describe('Chip conservation and multi-way side pots', () => {
  it('strictly conserves chips across 500 varied hands including short-stack all-ins', () => {
    const rng = createRng(42);
    const archetypes = [
      getArchetype('maniac'),
      getArchetype('calling_station'),
      getArchetype('aggressive'),
      getArchetype('nit'),
    ];
    const stacks = [40, 120, 200, 300]; // Unequal stacks trigger side pots!
    const initialTotal = stacks.reduce((a, b) => a + b, 0);

    for (let h = 0; h < 500; h++) {
      // Build shuffled deck
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 0; i < 13; i++) {
        const j = i + Math.floor(rng() * (52 - i));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const holes = [
        [deck[0], deck[1]],
        [deck[2], deck[3]],
        [deck[4], deck[5]],
        [deck[6], deck[7]],
      ];
      const board = deck.slice(8, 13);

      const res = playHand(
        {
          holes,
          board,
          archetypes,
          names: ['P1', 'P2', 'P3', 'P4'],
          positions: ['BTN', 'SB', 'BB', 'CO'],
          stacks,
          sb: 1,
          bb: 2,
          buttonIndex: h % 4,
          startStreet: 0,
        },
        rng
      );

      const finalTotal = res.finalStacks.reduce((a, b) => a + b, 0);
      assert.equal(finalTotal, initialTotal, `Chip leak detected on hand ${h}`);
      const netSum = res.netChips.reduce((a, b) => a + b, 0);
      assert.equal(netSum, 0, `Net chips did not sum to zero on hand ${h}`);
    }
  });
});

describe('Known equity benchmarks and archetype behavioral sanity', () => {
  it('matches known preflop raw equity for AA vs KK (~82%)', () => {
    const res = runSimulation({
      trials: 8000,
      seed: 12345,
      players: [
        { name: 'Hero', cards: 'As Ad', type: 'showdown' },
        { name: 'Villain', cards: 'Ks Kd', type: 'showdown' },
      ],
    });
    const aaEq = res.players[0].rawEquityPct;
    assert.ok(aaEq > 79.5 && aaEq < 84.5, `Expected AA vs KK equity ~82%, got ${aaEq.toFixed(2)}%`);
    // With showdown baseline, actual win+tie equity equals raw equity
    assert.ok(Math.abs(res.players[0].actualEquityPct - aaEq) < 0.01);
  });

  it('produces clearly differentiated behavior across Nit, Calling Station, and Aggressive', () => {
    const res = runSimulation({
      trials: 5000,
      seed: 2026,
      players: [
        { name: 'NitSeat', cards: '??', type: 'nit' },
        { name: 'StationSeat', cards: '??', type: 'calling_station' },
        { name: 'LagSeat', cards: '??', type: 'aggressive' },
      ],
    });

    const [nit, station, lag] = res.players;

    // Net EV across all seats sums to 0 (zero-sum game!)
    const totalEV = res.players.reduce((s, p) => s + p.evBB, 0);
    assert.ok(Math.abs(totalEV) < 1e-6, `Expected zero-sum EV, got ${totalEV}`);

    // Nit folds much more often than Calling Station
    assert.ok(
      nit.foldPct > station.foldPct + 20,
      `Expected Nit fold% (${nit.foldPct.toFixed(1)}) >> Station fold% (${station.foldPct.toFixed(1)})`
    );

    // Aggressive bets/raises significantly more often than Calling Station
    assert.ok(
      lag.aggPct > station.aggPct + 15,
      `Expected Aggressive agg% (${lag.aggPct.toFixed(1)}) >> Station agg% (${station.aggPct.toFixed(1)})`
    );

    // Calling station reaches showdown significantly more often than Nit
    assert.ok(
      station.wtsdPct > nit.wtsdPct + 10,
      `Expected Station WTSD% (${station.wtsdPct.toFixed(1)}) >> Nit WTSD% (${nit.wtsdPct.toFixed(1)})`
    );
  });

  it('supports async chunked execution with progress callbacks', async () => {
    let progressCalls = 0;
    const res = await runSimulationAsync(
      {
        trials: 1200,
        seed: 99,
        board: 'Ah 7d 2c',
        players: [
          { name: 'P1', cards: 'As Ks', type: 'aggressive' },
          { name: 'P2', cards: '7c 7s', type: 'calling_station' },
          { name: 'P3', cards: 'Qd Qh', type: 'nit' },
        ],
      },
      () => {
        progressCalls++;
      },
      400
    );
    assert.equal(res.trials, 1200);
    assert.ok(progressCalls >= 3);
    assert.equal(res.startStreet, 1);
    assert.equal(res.sampleHands.length, 5);
  });

  it('has Nit fold draws facing two aggressive players while Calling Station chases them', () => {
    const nitRun = runSimulation({
      trials: 2000,
      seed: 77,
      board: 'Kh 7h 2c',
      players: [
        { name: 'Agg1', cards: 'Ks Qd', type: 'aggressive' },
        { name: 'Agg2', cards: '7c 7s', type: 'aggressive' },
        { name: 'Draw', cards: 'Ah 9h', type: 'nit' },
      ],
    });
    const stationRun = runSimulation({
      trials: 2000,
      seed: 77,
      board: 'Kh 7h 2c',
      players: [
        { name: 'Agg1', cards: 'Ks Qd', type: 'aggressive' },
        { name: 'Agg2', cards: '7c 7s', type: 'aggressive' },
        { name: 'Draw', cards: 'Ah 9h', type: 'calling_station' },
      ],
    });

    assert.ok(
      nitRun.players[2].foldPct > 85,
      `Expected Nit on flush draw vs 2 aggressors to fold >85%, got ${nitRun.players[2].foldPct.toFixed(1)}%`
    );
    assert.ok(
      stationRun.players[2].foldPct < 25,
      `Expected Calling Station on flush draw to chase (<25% fold), got ${stationRun.players[2].foldPct.toFixed(1)}%`
    );
  });

  it('applies custom archetypeOverrides directly to player decisions', () => {
    const defaultNit = runSimulation({
      trials: 1500,
      seed: 55,
      board: 'Kh 7h 2c',
      players: [
        { name: 'Agg', cards: 'Ks Qd', type: 'aggressive' },
        { name: 'Nit', cards: 'Ah 9h', type: 'nit' },
      ],
    });
    const stickyNit = runSimulation({
      trials: 1500,
      seed: 55,
      board: 'Kh 7h 2c',
      archetypeOverrides: {
        nit: { foldToPressure: 10, drawDefense: 95 },
      },
      players: [
        { name: 'Agg', cards: 'Ks Qd', type: 'aggressive' },
        { name: 'Nit', cards: 'Ah 9h', type: 'nit' },
      ],
    });

    assert.ok(
      defaultNit.players[1].foldPct > stickyNit.players[1].foldPct + 50,
      `Expected custom overrides to slash Nit fold% (default ${defaultNit.players[1].foldPct.toFixed(1)}% vs overridden ${stickyNit.players[1].foldPct.toFixed(1)}%)`
    );
  });

  it('allows up to 1,000,000 trials and clamps higher values', () => {
    const basePlayers = [
      { name: 'Hero', cards: 'As Ad', type: 'tag' },
      { name: 'Villain', cards: 'Ks Kd', type: 'aggressive' },
    ];
    assert.equal(MAX_TRIALS, 1000000);
    assert.equal(normalizeConfig({ trials: 1000000, players: basePlayers }).trials, 1000000);
    assert.equal(normalizeConfig({ trials: 2500000, players: basePlayers }).trials, 1000000);
    assert.equal(normalizeConfig({ trials: 1, players: basePlayers }).trials, 10);
  });
});
