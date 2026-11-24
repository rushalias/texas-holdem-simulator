import {
  RANKS,
  SUITS,
  SUIT_SYMBOLS,
  makeCard,
  cardRank,
  cardSuit,
  cardToString,
  parseCardList,
  getPositionNames,
} from '../src/cards.js';
import {
  ARCHETYPES,
  ARCHETYPE_LIST,
  ARCHETYPE_PARAM_DEFS,
  getDefaultArchetypeParams,
} from '../src/archetypes.js';
import { STREET_NAMES } from '../src/engine.js';
import { runSimulationAsync } from '../src/simulator.js';

const PRESETS = [
  {
    id: 'flop_4way',
    label: '4-Way Flop Clash (LAG vs Station vs Nit vs TAG)',
    trials: 10000,
    stackBB: 100,
    startingPotBB: 12,
    startMode: 'street',
    board: 'Ah 7d 2c',
    players: [
      { name: 'Hero', cards: 'As Ks', type: 'aggressive' },
      { name: 'Station', cards: 'Jh Ts', type: 'calling_station' },
      { name: 'Nit', cards: 'Qh Qd', type: 'nit' },
      { name: 'Villain', cards: '??', type: 'tag' },
    ],
  },
  {
    id: 'nit_draw_vs_2agg',
    label: 'Nit on Flush Draw vs 2 Aggressive Players',
    trials: 10000,
    stackBB: 100,
    startingPotBB: 9,
    startMode: 'street',
    board: 'Kh 7h 2c',
    players: [
      { name: 'Agg1', cards: 'Ks Qd', type: 'aggressive' },
      { name: 'Agg2', cards: '7c 7s', type: 'aggressive' },
      { name: 'NitDraw', cards: 'Ah 9h', type: 'nit' },
    ],
  },
  {
    id: 'aa_vs_kk',
    label: 'AA vs KK Preflop Classic',
    trials: 10000,
    stackBB: 100,
    startingPotBB: 6,
    startMode: 'street',
    board: '',
    players: [
      { name: 'Aces', cards: 'As Ad', type: 'tag' },
      { name: 'Kings', cards: 'Ks Kd', type: 'aggressive' },
    ],
  },
  {
    id: 'set_vs_draw',
    label: 'Set vs Nut Flush Draw on Flop',
    trials: 10000,
    stackBB: 100,
    startingPotBB: 10,
    startMode: 'street',
    board: 'Qh 7h 2s',
    players: [
      { name: 'Set', cards: '7c 7s', type: 'tag' },
      { name: 'FlushDraw', cards: 'Ah Kh', type: 'aggressive' },
      { name: 'TopPair', cards: 'Qd Jd', type: 'calling_station' },
    ],
  },
  {
    id: 'sixmax_types',
    label: '6-Max Archetype Battle (All Random Cards)',
    trials: 10000,
    stackBB: 100,
    startingPotBB: 18,
    startMode: 'preflop',
    board: '',
    players: [
      { name: 'Aggressive', cards: '??', type: 'aggressive' },
      { name: 'Station', cards: '??', type: 'calling_station' },
      { name: 'Nit', cards: '??', type: 'nit' },
      { name: 'TAG', cards: '??', type: 'tag' },
      { name: 'Maniac', cards: '??', type: 'maniac' },
      { name: 'Showdown', cards: '??', type: 'showdown' },
    ],
  },
  {
    id: 'river_bluff',
    label: 'River Bluff Catcher (Station vs LAG)',
    trials: 5000,
    stackBB: 100,
    startingPotBB: 24,
    startMode: 'street',
    board: 'Ks 7h 4d 2c 3s',
    players: [
      { name: 'Bluffer', cards: '9s 8s', type: 'aggressive' },
      { name: 'Catcher', cards: 'Kd Qc', type: 'calling_station' },
    ],
  },
];

const DEFAULT_TYPE_CYCLE = ['aggressive', 'calling_station', 'nit', 'tag', 'maniac', 'showdown'];

const state = {
  players: [],
  board: [null, null, null, null, null],
  trials: 10000,
  stackBB: 100,
  startingPotBB: 12,
  startMode: 'street',
  seed: '',
  fourColor: true,
  activeSlot: { kind: 'player', seat: 0, cardIdx: 0 },
  archetypeConfigs: getDefaultArchetypeParams(),
  selectedArchId: 'nit',
  running: false,
  lastResult: null,
  selectedSampleIdx: 0,
  error: null,
};

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadPreset(presetId) {
  const preset = PRESETS.find((p) => p.id === presetId) || PRESETS[0];
  state.trials = preset.trials;
  state.stackBB = preset.stackBB;
  state.startingPotBB = preset.startingPotBB;
  state.startMode = preset.startMode;
  state.board = parseCardList(preset.board, 5);
  state.players = preset.players.map((p) => ({
    name: p.name,
    cards: parseCardList(p.cards, 2),
    type: p.type,
    stackBB: preset.stackBB,
  }));
  state.activeSlot = { kind: 'player', seat: 0, cardIdx: 0 };
  state.error = null;
  renderAll();
}

function setPlayerCount(newCount) {
  const count = Math.max(2, Math.min(9, newCount));
  while (state.players.length < count) {
    const idx = state.players.length;
    state.players.push({
      name: `Seat ${idx + 1}`,
      cards: [null, null],
      type: DEFAULT_TYPE_CYCLE[idx % DEFAULT_TYPE_CYCLE.length],
      stackBB: state.stackBB,
    });
  }
  if (state.players.length > count) {
    state.players.length = count;
  }
  if (state.activeSlot.kind === 'player' && state.activeSlot.seat >= count) {
    state.activeSlot = { kind: 'player', seat: count - 1, cardIdx: 0 };
  }
  state.startingPotBB = Math.max(4, count * 3);
  state.error = null;
  renderAll();
}

function getCardOwnerMap() {
  const map = new Map();
  state.players.forEach((p, idx) => {
    p.cards.forEach((c) => {
      if (c !== null) map.set(c, `S${idx + 1}`);
    });
  });
  state.board.forEach((c, idx) => {
    if (c !== null) {
      const lbl = idx < 3 ? `F${idx + 1}` : idx === 3 ? 'T' : 'R';
      map.set(c, lbl);
    }
  });
  return map;
}

function assignCardToActiveSlot(cardId) {
  const owners = getCardOwnerMap();
  if (cardId !== null && owners.has(cardId)) return;

  const slot = state.activeSlot;
  if (slot.kind === 'board') {
    state.board[slot.index] = cardId;
    if (cardId !== null) advanceSlot();
  } else {
    state.players[slot.seat].cards[slot.cardIdx] = cardId;
    if (cardId !== null) advanceSlot();
  }
  state.error = null;
  renderSetup();
}

function advanceSlot() {
  const slot = state.activeSlot;
  if (slot.kind === 'board') {
    for (let i = slot.index + 1; i < 5; i++) {
      if (state.board[i] === null) {
        state.activeSlot = { kind: 'board', index: i };
        return;
      }
    }
    return;
  }

  // Player slot: try card 2 of same seat, then next empty seat slot
  if (slot.cardIdx === 0 && state.players[slot.seat].cards[1] === null) {
    state.activeSlot = { kind: 'player', seat: slot.seat, cardIdx: 1 };
    return;
  }
  for (let s = slot.seat + 1; s < state.players.length; s++) {
    for (let ci = 0; ci < 2; ci++) {
      if (state.players[s].cards[ci] === null) {
        state.activeSlot = { kind: 'player', seat: s, cardIdx: ci };
        return;
      }
    }
  }
  // If all players ahead are filled, try board flop slots
  for (let i = 0; i < 3; i++) {
    if (state.board[i] === null) {
      state.activeSlot = { kind: 'board', index: i };
      return;
    }
  }
}

function dealRandomFlop() {
  state.board = [null, null, null, null, null];
  const freshOwners = getCardOwnerMap();
  const avail = [];
  for (let c = 0; c < 52; c++) {
    if (!freshOwners.has(c)) avail.push(c);
  }
  for (let i = 0; i < 3; i++) {
    const pick = Math.floor(Math.random() * avail.length);
    state.board[i] = avail.splice(pick, 1)[0];
  }
  state.activeSlot = { kind: 'board', index: 3 };
  renderSetup();
}

function clearAllCards() {
  state.board = [null, null, null, null, null];
  state.players.forEach((p) => {
    p.cards = [null, null];
  });
  state.activeSlot = { kind: 'player', seat: 0, cardIdx: 0 };
  renderSetup();
}

function renderCardContent(cardId) {
  if (cardId === null || cardId === undefined) {
    return `<span class="text-sm font-semibold opacity-60">?</span>`;
  }
  const r = RANKS[cardRank(cardId)];
  const s = SUITS[cardSuit(cardId)];
  const sym = SUIT_SYMBOLS[s];
  return `<span class="suit-${s} text-sm leading-none">${r}</span><span class="suit-${s} text-base leading-none mt-0.5">${sym}</span>`;
}

function renderMiniCard(cardStr) {
  if (!cardStr || cardStr === '??' || cardStr === '?') {
    return `<span class="poker-card-mini is-unknown">?</span>`;
  }
  // Supports both "As" and "A♠"
  let r = cardStr.slice(0, -1);
  let rawSuit = cardStr.slice(-1);
  let suitKey = rawSuit;
  if (rawSuit === '♠') suitKey = 's';
  else if (rawSuit === '♥') suitKey = 'h';
  else if (rawSuit === '♦') suitKey = 'd';
  else if (rawSuit === '♣') suitKey = 'c';
  const sym = SUIT_SYMBOLS[suitKey] || rawSuit;
  return `<span class="poker-card-mini suit-${suitKey}">${escapeHtml(r)}${sym}</span>`;
}

function getActiveSlotLabel() {
  const s = state.activeSlot;
  if (s.kind === 'board') {
    const names = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'];
    return `Community Board · ${names[s.index]}`;
  }
  const positions = getPositionNames(state.players.length);
  const p = state.players[s.seat];
  return `${p.name} (${positions[s.seat]}) · Card ${s.cardIdx + 1}`;
}

function buildScenarioConfig() {
  const archetypeOverrides = {};
  for (const [id, params] of Object.entries(state.archetypeConfigs)) {
    archetypeOverrides[id] = { ...params };
  }
  return {
    trials: state.trials,
    stackBB: state.stackBB,
    startingPotBB: state.startingPotBB,
    startMode: state.startMode,
    seed: state.seed.trim() !== '' ? state.seed.trim() : null,
    archetypeOverrides,
    board: state.board.map((c) => (c !== null ? cardToString(c) : null)),
    players: state.players.map((p) => ({
      name: p.name.trim() || 'Player',
      cards: p.cards.map((c) => (c !== null ? cardToString(c) : null)),
      type: p.type,
      stackBB: p.stackBB,
    })),
  };
}

async function handleRunSimulation() {
  if (state.running) return;
  state.running = true;
  state.error = null;
  updateRunButton(0, state.trials);

  try {
    const cfg = buildScenarioConfig();
    const batchSize =
      state.trials >= 500000 ? 5000 : state.trials >= 50000 ? 2500 : state.trials >= 20000 ? 1000 : 500;
    const res = await runSimulationAsync(
      cfg,
      (done, total) => updateRunButton(done, total),
      batchSize
    );
    state.lastResult = res;
    state.selectedSampleIdx = 0;
  } catch (err) {
    state.error = err.message || String(err);
  } finally {
    state.running = false;
    updateRunButton(state.trials, state.trials);
    renderError();
    renderResults();
  }
}

function updateRunButton(done, total) {
  const btn = document.getElementById('run-sim-btn');
  const progWrap = document.getElementById('sim-progress-wrap');
  const progBar = document.getElementById('sim-progress-bar');
  const progText = document.getElementById('sim-progress-text');
  if (!btn) return;

  if (state.running) {
    btn.disabled = true;
    btn.textContent = 'Running Simulation…';
    if (progWrap) progWrap.classList.remove('hidden');
    const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
    if (progBar) progBar.style.width = `${pct}%`;
    if (progText) progText.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} hands (${pct}%)`;
  } else {
    btn.disabled = false;
    btn.textContent = `Run ${state.trials.toLocaleString()} Hands`;
    if (progWrap) progWrap.classList.add('hidden');
  }
}

function renderError() {
  const el = document.getElementById('error-banner');
  if (!el) return;
  if (!state.error) {
    el.classList.add('hidden');
    el.textContent = '';
  } else {
    el.classList.remove('hidden');
    el.textContent = state.error;
  }
}

function renderSetup() {
  document.body.classList.toggle('four-color-deck', state.fourColor);

  // Sync top controls
  const countEl = document.getElementById('player-count-val');
  if (countEl) countEl.textContent = String(state.players.length);

  const trialsSel = document.getElementById('trials-select');
  if (trialsSel) trialsSel.value = String(state.trials);

  const stackIn = document.getElementById('stack-input');
  if (stackIn && document.activeElement !== stackIn) stackIn.value = String(state.stackBB);

  const potIn = document.getElementById('pot-input');
  if (potIn && document.activeElement !== potIn) potIn.value = String(state.startingPotBB);

  const modeSel = document.getElementById('mode-select');
  if (modeSel) modeSel.value = state.startMode;

  const boardCount = state.board.filter((c) => c !== null).length;
  const potGroup = document.getElementById('starting-pot-group');
  if (potGroup) {
    potGroup.classList.toggle('opacity-50', boardCount === 0 || state.startMode === 'preflop');
  }

  // Render Board Slots
  const boardContainer = document.getElementById('board-slots');
  if (boardContainer) {
    const labels = ['Flop 1', 'Flop 2', 'Flop 3', 'Turn', 'River'];
    boardContainer.innerHTML = state.board
      .map((c, idx) => {
        const isActive = state.activeSlot.kind === 'board' && state.activeSlot.index === idx;
        const filledClass = c !== null ? 'is-filled' : '';
        const activeClass = isActive ? 'is-active' : '';
        const gapClass = idx === 3 || idx === 4 ? 'ml-1.5' : '';
        return `
          <div class="flex flex-col items-center gap-1 ${gapClass}">
            <div
              class="poker-card poker-card-slot ${filledClass} ${activeClass}"
              data-slot-kind="board"
              data-board-idx="${idx}"
              role="button"
              tabindex="0"
              aria-label="${labels[idx]}"
            >
              ${renderCardContent(c)}
              ${c !== null ? `<button type="button" class="card-clear-btn" data-clear-board="${idx}" title="Clear card">×</button>` : ''}
            </div>
            <span class="text-xs text-[var(--muted-foreground)]">${labels[idx]}</span>
          </div>
        `;
      })
      .join('');
  }

  // Render Player Seats
  const seatsContainer = document.getElementById('seats-container');
  const positions = getPositionNames(state.players.length);
  if (seatsContainer) {
    seatsContainer.innerHTML = state.players
      .map((p, idx) => {
        const arch = ARCHETYPES[p.type] || ARCHETYPES.tag;
        const slot0Active =
          state.activeSlot.kind === 'player' && state.activeSlot.seat === idx && state.activeSlot.cardIdx === 0;
        const slot1Active =
          state.activeSlot.kind === 'player' && state.activeSlot.seat === idx && state.activeSlot.cardIdx === 1;

        const archOptions = ARCHETYPE_LIST.map(
          (a) => `<option value="${a.id}" ${a.id === p.type ? 'selected' : ''}>${escapeHtml(a.name)}</option>`
        ).join('');

        return `
          <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)] flex flex-col gap-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="px-1.5 py-0.5 text-xs font-mono font-semibold rounded bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] shrink-0">
                  ${positions[idx]}
                </span>
                <input
                  type="text"
                  value="${escapeHtml(p.name)}"
                  data-seat-name="${idx}"
                  maxlength="18"
                  aria-label="Seat ${idx + 1} name"
                  class="w-full min-w-0 bg-transparent text-sm font-semibold text-[var(--foreground)] border-b border-transparent focus:border-[var(--primary)] focus:outline-none px-0.5"
                />
              </div>
              <div class="flex items-center gap-1.5 shrink-0">
                <label class="text-xs text-[var(--muted-foreground)] flex items-center gap-1" title="Seat starting stack in BB">
                  <input
                    type="number"
                    min="5"
                    max="1000"
                    step="5"
                    value="${p.stackBB}"
                    data-seat-stack="${idx}"
                    class="w-14 px-1.5 py-0.5 text-xs text-right tabular-nums rounded bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)]"
                  />
                  <span>BB</span>
                </label>
                <button
                  type="button"
                  data-clear-seat="${idx}"
                  title="Randomize hole cards"
                  class="px-1.5 py-0.5 text-xs rounded border border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--card)]"
                >
                  ??
                </button>
              </div>
            </div>

            <div class="flex items-center gap-3">
              <div class="flex items-center gap-1.5 shrink-0">
                ${[0, 1]
                  .map((ci) => {
                    const cardId = p.cards[ci];
                    const active = ci === 0 ? slot0Active : slot1Active;
                    return `
                      <div
                        class="poker-card poker-card-slot ${cardId !== null ? 'is-filled' : ''} ${active ? 'is-active' : ''}"
                        data-slot-kind="player"
                        data-seat-idx="${idx}"
                        data-card-idx="${ci}"
                        role="button"
                        tabindex="0"
                        aria-label="${escapeHtml(p.name)} card ${ci + 1}"
                      >
                        ${renderCardContent(cardId)}
                        ${
                          cardId !== null
                            ? `<button type="button" class="card-clear-btn" data-clear-player-card="${idx}:${ci}" title="Clear card">×</button>`
                            : ''
                        }
                      </div>
                    `;
                  })
                  .join('')}
              </div>

              <div class="flex-1 min-w-0 flex flex-col gap-1">
                <select
                  data-seat-type="${idx}"
                  aria-label="Archetype for ${escapeHtml(p.name)}"
                  class="w-full px-2 py-1.5 text-xs font-medium rounded-md bg-[var(--card)] border border-[var(--border)] text-[var(--foreground)] focus:outline-none focus:border-[var(--primary)]"
                >
                  ${archOptions}
                </select>
                <p class="text-xs text-[var(--muted-foreground)] leading-snug truncate" title="${escapeHtml(arch.description)}">
                  ${escapeHtml(arch.tagline)}
                </p>
              </div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Render 52-card Deck Picker
  const targetLabel = document.getElementById('picker-target-label');
  if (targetLabel) targetLabel.textContent = getActiveSlotLabel();

  const deckGrid = document.getElementById('deck-picker-grid');
  if (deckGrid) {
    const owners = getCardOwnerMap();
    const rankOrder = [12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]; // A down to 2
    deckGrid.innerHTML = SUITS.map((suitKey, suitIdx) => {
      const sym = SUIT_SYMBOLS[suitKey];
      const buttons = rankOrder
        .map((rankIdx) => {
          const cardId = makeCard(rankIdx, suitIdx);
          const owner = owners.get(cardId);
          return `
            <button
              type="button"
              class="deck-btn suit-${suitKey}"
              data-pick-card="${cardId}"
              ${owner ? 'disabled' : ''}
              title="${RANKS[rankIdx]}${sym}${owner ? ` (assigned to ${owner})` : ''}"
            >
              <span>${RANKS[rankIdx]}</span>
              <span class="text-xs leading-none">${sym}</span>
              ${owner ? `<span class="owner-tag">${owner}</span>` : ''}
            </button>
          `;
        })
        .join('');
      return `<div class="grid grid-cols-13 gap-1" style="grid-template-columns: repeat(13, minmax(0, 1fr));">${buttons}</div>`;
    }).join('');
  }

  updateRunButton(state.trials, state.trials);
}

function renderResults() {
  const section = document.getElementById('results-section');
  if (!section) return;

  const res = state.lastResult;
  if (!res) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  // Top winning hand category at showdown
  const topHand = res.handRankDistribution.reduce(
    (best, cur) => (cur.count > best.count ? cur : best),
    { name: '—', pct: 0, count: 0 }
  );

  // Best EV player
  const bestEvSeat = res.players.reduce(
    (best, p) => (p.evBB > best.evBB ? p : best),
    res.players[0]
  );

  const kpiEl = document.getElementById('results-kpis');
  if (kpiEl) {
    const boardDisp = res.board.filter(Boolean);
    kpiEl.innerHTML = `
      <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)]">
        <div class="text-xs text-[var(--muted-foreground)]">Simulated Hands</div>
        <div class="text-lg font-bold tabular-nums text-[var(--foreground)] mt-0.5">${res.trials.toLocaleString()}</div>
        <div class="text-xs text-[var(--muted-foreground)] mt-0.5">${res.elapsedMs} ms · ${STREET_NAMES[res.startStreet]} start</div>
      </div>
      <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)]">
        <div class="text-xs text-[var(--muted-foreground)]">Average Pot</div>
        <div class="text-lg font-bold tabular-nums text-[var(--foreground)] mt-0.5">${res.avgPotBB.toFixed(1)} BB</div>
        <div class="text-xs text-[var(--muted-foreground)] mt-0.5">${boardDisp.length > 0 ? `Board: ${boardDisp.join(' ')}` : 'Full random board'}</div>
      </div>
      <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)]">
        <div class="text-xs text-[var(--muted-foreground)]">Showdown Rate</div>
        <div class="text-lg font-bold tabular-nums text-[var(--foreground)] mt-0.5">${res.showdownPct.toFixed(1)}%</div>
        <div class="text-xs text-[var(--muted-foreground)] mt-0.5">${(100 - res.showdownPct).toFixed(1)}% won by fold</div>
      </div>
      <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)]">
        <div class="text-xs text-[var(--muted-foreground)]">Top EV Seat</div>
        <div class="text-lg font-bold text-[var(--foreground)] mt-0.5 truncate">${escapeHtml(bestEvSeat.name)}</div>
        <div class="text-xs font-mono tabular-nums mt-0.5" style="color: var(--success);">
          ${bestEvSeat.evBB >= 0 ? '+' : ''}${bestEvSeat.evBB.toFixed(2)} BB/hand · Top hand: ${escapeHtml(topHand.name)}
        </div>
      </div>
    `;
  }

  // Per-Player Results Table
  const tbody = document.getElementById('results-table-body');
  if (tbody) {
    tbody.innerHTML = res.players
      .map((p) => {
        const evColor =
          p.evBB > 0.05 ? 'var(--success)' : p.evBB < -0.05 ? 'var(--error)' : 'var(--muted-foreground)';
        const evSign = p.evBB >= 0 ? '+' : '';
        const deltaEq = p.actualEquityPct - p.rawEquityPct;
        const deltaSign = deltaEq >= 0 ? '+' : '';
        const deltaColor =
          deltaEq > 1 ? 'var(--success)' : deltaEq < -1 ? 'var(--error)' : 'var(--muted-foreground)';

        return `
          <tr class="border-t border-[var(--card-border)] hover:bg-[var(--content)] transition-colors">
            <td class="py-2.5 px-3">
              <div class="flex items-center gap-2">
                <span class="px-1.5 py-0.5 text-xs font-mono rounded bg-[var(--content)] border border-[var(--border)]">${p.position}</span>
                <div>
                  <div class="font-semibold text-sm text-[var(--foreground)]">${escapeHtml(p.name)}</div>
                  <div class="text-xs text-[var(--muted-foreground)]">${escapeHtml(p.archetypeShort)}</div>
                </div>
              </div>
            </td>
            <td class="py-2.5 px-2 whitespace-nowrap">
              <div class="flex items-center gap-1">
                ${renderMiniCard(p.cards[0])}
                ${renderMiniCard(p.cards[1])}
              </div>
            </td>
            <td class="py-2.5 px-3 min-w-[140px]">
              <div class="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                <span class="font-semibold text-[var(--foreground)]">${p.actualEquityPct.toFixed(1)}%</span>
                <span class="text-[var(--muted-foreground)]">Tie ${p.tiePct.toFixed(1)}%</span>
              </div>
              <div class="bar-track mt-1">
                <div class="bar-fill" style="width: ${Math.min(100, p.actualEquityPct)}%; background: var(--chart-1);"></div>
              </div>
            </td>
            <td class="py-2.5 px-3 min-w-[140px]">
              <div class="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                <span class="font-medium text-[var(--foreground)]">${p.rawEquityPct.toFixed(1)}%</span>
                <span class="font-mono" style="color: ${deltaColor};" title="Strategy impact (Actual Win% minus Raw Showdown Equity%)">
                  ${deltaSign}${deltaEq.toFixed(1)}%
                </span>
              </div>
              <div class="bar-track mt-1">
                <div class="bar-fill" style="width: ${Math.min(100, p.rawEquityPct)}%; background: var(--chart-2);"></div>
              </div>
            </td>
            <td class="py-2.5 px-3 text-right whitespace-nowrap tabular-nums">
              <div class="font-bold text-sm font-mono" style="color: ${evColor};">${evSign}${p.evBB.toFixed(2)} BB</div>
              <div class="text-xs text-[var(--muted-foreground)]">±${p.evCi95BB.toFixed(2)}</div>
            </td>
            <td class="py-2.5 px-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">${p.foldPct.toFixed(1)}%</td>
            <td class="py-2.5 px-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">${p.wtsdPct.toFixed(1)}%</td>
            <td class="py-2.5 px-2.5 text-right text-xs tabular-nums text-[var(--foreground)]">${p.vpipPct.toFixed(1)}%</td>
            <td class="py-2.5 px-3 text-right text-xs tabular-nums text-[var(--foreground)]">${p.aggPct.toFixed(1)}%</td>
          </tr>
        `;
      })
      .join('');
  }

  // Street breakdown chart
  const streetEl = document.getElementById('street-breakdown');
  if (streetEl) {
    streetEl.innerHTML = res.streetBreakdown
      .map(
        (s, idx) => `
        <div class="space-y-1">
          <div class="flex justify-between text-xs tabular-nums">
            <span class="text-[var(--foreground)] font-medium">${s.label}</span>
            <span class="text-[var(--muted-foreground)]">${s.pct.toFixed(1)}% (${s.count.toLocaleString()})</span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${Math.min(100, s.pct)}%; background: var(--chart-${(idx % 5) + 1});"></div>
          </div>
        </div>
      `
      )
      .join('');
  }

  // Winning hand rank distribution
  const rankEl = document.getElementById('hand-rank-breakdown');
  if (rankEl) {
    const activeRanks = res.handRankDistribution.slice().reverse();
    rankEl.innerHTML = activeRanks
      .map(
        (h) => `
        <div class="grid grid-cols-[112px_1fr_54px] items-center gap-2 text-xs tabular-nums">
          <span class="text-[var(--foreground)] truncate">${h.name}</span>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${Math.min(100, h.pct)}%; background: var(--chart-3);"></div>
          </div>
          <span class="text-right text-[var(--muted-foreground)]">${h.pct.toFixed(1)}%</span>
        </div>
      `
      )
      .join('');
  }

  renderSampleHands();
}

function renderSampleHands() {
  const res = state.lastResult;
  const tabsEl = document.getElementById('sample-hand-tabs');
  const bodyEl = document.getElementById('sample-hand-body');
  if (!res || !tabsEl || !bodyEl) return;

  if (!res.sampleHands || res.sampleHands.length === 0) {
    tabsEl.innerHTML = '';
    bodyEl.innerHTML = '<p class="text-xs text-[var(--muted-foreground)]">No sample hands recorded.</p>';
    return;
  }

  tabsEl.innerHTML = res.sampleHands
    .map((h, idx) => {
      const active = idx === state.selectedSampleIdx;
      return `
        <button
          type="button"
          data-sample-idx="${idx}"
          class="px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
            active
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent'
              : 'bg-[var(--content)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--card)]'
          }"
        >
          Hand #${idx + 1} (${h.endedStreet})
        </button>
      `;
    })
    .join('');

  const hand = res.sampleHands[state.selectedSampleIdx] || res.sampleHands[0];
  const dealtSeatsHtml = res.players
    .map((p, idx) => {
      const hole = hand.holes[idx] || ['?', '?'];
      const isWinner = hand.winners.some((w) => w.seat === idx);
      return `
        <div class="px-2.5 py-1.5 rounded-md border ${
          isWinner ? 'border-[var(--success)] bg-[var(--card)]' : 'border-[var(--card-border)] bg-[var(--content)]'
        } flex items-center gap-2 text-xs">
          <span class="font-semibold text-[var(--foreground)]">${escapeHtml(p.name)}</span>
          <span class="text-[var(--muted-foreground)]">(${p.archetypeShort})</span>
          <span class="flex items-center gap-1">${renderMiniCard(hole[0])}${renderMiniCard(hole[1])}</span>
        </div>
      `;
    })
    .join('');

  const boardHtml = hand.board.map((c) => renderMiniCard(c)).join('');
  const logLines = hand.events
    .map((line) => {
      const isHeader = line.startsWith('—') || line.startsWith('Starting') || line.startsWith('Preflop');
      const isResult = line.startsWith('Result:') || line.includes('→ WINS');
      const cls = isResult
        ? 'font-semibold text-[var(--foreground)]'
        : isHeader
          ? 'font-semibold text-[var(--foreground)] pt-1'
          : 'text-[var(--muted-foreground)]';
      return `<div class="${cls} font-mono text-xs leading-relaxed">${escapeHtml(line)}</div>`;
    })
    .join('');

  bodyEl.innerHTML = `
    <div class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[var(--card-border)]">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-xs font-medium text-[var(--muted-foreground)] mr-1">Full Board:</span>
          ${boardHtml}
        </div>
        <span class="text-xs font-mono text-[var(--muted-foreground)]">Final Pot: ${(hand.pot / res.bb).toFixed(1)} BB</span>
      </div>
      <div class="flex flex-wrap gap-2">${dealtSeatsHtml}</div>
      <div class="p-3 rounded-lg bg-[var(--content)] border border-[var(--card-border)] hand-log-scroll space-y-0.5">
        ${logLines}
      </div>
    </div>
  `;
}

function isArchetypeModified(archId) {
  const def = ARCHETYPES[archId]?.params;
  const cur = state.archetypeConfigs[archId];
  if (!def || !cur) return false;
  return ARCHETYPE_PARAM_DEFS.some((p) => Number(cur[p.key]) !== Number(def[p.key]));
}

function renderArchetypeMatrix() {
  const tbody = document.getElementById('archetype-matrix-body');
  if (!tbody) return;
  const configurable = ARCHETYPE_LIST.filter((a) => a.params);
  tbody.innerHTML = configurable
    .map((a) => {
      const cfg = state.archetypeConfigs[a.id] || a.params;
      const selected = a.id === state.selectedArchId;
      const modified = isArchetypeModified(a.id);
      return `
        <tr
          data-arch-row="${a.id}"
          class="border-t border-[var(--card-border)] cursor-pointer transition-colors ${
            selected ? 'bg-[var(--card)] font-semibold' : 'hover:bg-[var(--card)]'
          }"
        >
          <td class="py-2 px-2.5 text-[var(--foreground)] whitespace-nowrap">
            ${escapeHtml(a.shortName)}${modified ? ' <span title="Customized" style="color: var(--primary);">•</span>' : ''}
          </td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.preflopLooseness}%</td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.preflopAggression}%</td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.foldToPressure}%</td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.drawDefense}%</td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.postflopAggression}%</td>
          <td class="py-2 px-1.5 text-right text-[var(--foreground)]">${cfg.bluffFreq}%</td>
          <td class="py-2 px-2 text-right text-[var(--foreground)]">${cfg.betSizePct}%</td>
        </tr>
      `;
    })
    .join('');
}

function renderArchetypeConfig() {
  const tabsEl = document.getElementById('archetype-tabs');
  const descEl = document.getElementById('archetype-selected-desc');
  const slidersEl = document.getElementById('archetype-sliders');
  if (!tabsEl || !slidersEl) return;

  const configurable = ARCHETYPE_LIST.filter((a) => a.params);
  const seatCounts = new Map();
  state.players.forEach((p) => {
    seatCounts.set(p.type, (seatCounts.get(p.type) || 0) + 1);
  });

  tabsEl.innerHTML = configurable
    .map((a) => {
      const active = a.id === state.selectedArchId;
      const count = seatCounts.get(a.id) || 0;
      const modified = isArchetypeModified(a.id);
      const countBadge = count > 0 ? ` (${count})` : '';
      const modDot = modified ? ' •' : '';
      return `
        <button
          type="button"
          data-arch-tab="${a.id}"
          class="px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors ${
            active
              ? 'bg-[var(--primary)] text-[var(--primary-foreground)] border-transparent'
              : 'bg-[var(--content)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--card)]'
          }"
        >
          ${escapeHtml(a.name)}${countBadge}${modDot}
        </button>
      `;
    })
    .join('');

  const arch = ARCHETYPES[state.selectedArchId] || configurable[0];
  const cfg = state.archetypeConfigs[arch.id] || arch.params;

  if (descEl) {
    descEl.textContent = arch.description;
  }

  slidersEl.innerHTML = ARCHETYPE_PARAM_DEFS.map((def) => {
    const val = cfg[def.key];
    return `
      <div class="space-y-1">
        <div class="flex items-center justify-between gap-2 text-xs">
          <label for="slider-${def.key}" class="font-medium text-[var(--foreground)]">${escapeHtml(def.label)}</label>
          <span id="slider-val-${def.key}" class="font-mono font-semibold tabular-nums text-[var(--foreground)]">${val}${def.unit}</span>
        </div>
        <input
          id="slider-${def.key}"
          type="range"
          min="${def.min}"
          max="${def.max}"
          step="${def.step}"
          value="${val}"
          data-arch-slider="${def.key}"
          class="w-full accent-[var(--primary)] cursor-pointer"
        />
        <div class="text-xs text-[var(--muted-foreground)] leading-snug">${escapeHtml(def.desc)}</div>
      </div>
    `;
  }).join('');

  renderArchetypeMatrix();
}

function renderAll() {
  renderSetup();
  renderArchetypeConfig();
  renderError();
  renderResults();
}

function initUI() {
  // Populate preset selector
  const presetSel = document.getElementById('preset-select');
  if (presetSel) {
    presetSel.innerHTML = PRESETS.map(
      (p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`
    ).join('');
    presetSel.addEventListener('change', (e) => {
      loadPreset(e.target.value);
      handleRunSimulation();
    });
  }

  document.getElementById('dec-players-btn')?.addEventListener('click', () => {
    setPlayerCount(state.players.length - 1);
  });
  document.getElementById('inc-players-btn')?.addEventListener('click', () => {
    setPlayerCount(state.players.length + 1);
  });

  document.getElementById('trials-select')?.addEventListener('change', (e) => {
    state.trials = Number(e.target.value) || 10000;
    updateRunButton(state.trials, state.trials);
  });

  document.getElementById('stack-input')?.addEventListener('change', (e) => {
    const val = Math.max(5, Math.min(1000, Number(e.target.value) || 100));
    state.stackBB = val;
    state.players.forEach((p) => {
      p.stackBB = val;
    });
    renderSetup();
  });

  document.getElementById('pot-input')?.addEventListener('change', (e) => {
    state.startingPotBB = Math.max(2, Math.min(500, Number(e.target.value) || 12));
  });

  document.getElementById('mode-select')?.addEventListener('change', (e) => {
    state.startMode = e.target.value;
    renderSetup();
  });

  document.getElementById('seed-input')?.addEventListener('input', (e) => {
    state.seed = e.target.value;
  });

  document.getElementById('four-color-toggle')?.addEventListener('change', (e) => {
    state.fourColor = e.target.checked;
    document.body.classList.toggle('four-color-deck', state.fourColor);
  });

  document.getElementById('clear-board-btn')?.addEventListener('click', () => {
    state.board = [null, null, null, null, null];
    state.activeSlot = { kind: 'board', index: 0 };
    renderSetup();
  });

  document.getElementById('random-flop-btn')?.addEventListener('click', dealRandomFlop);
  document.getElementById('set-random-slot-btn')?.addEventListener('click', () => assignCardToActiveSlot(null));
  document.getElementById('clear-all-cards-btn')?.addEventListener('click', clearAllCards);
  document.getElementById('reset-btn')?.addEventListener('click', () => {
    const presetSelEl = document.getElementById('preset-select');
    loadPreset(presetSelEl ? presetSelEl.value : PRESETS[0].id);
  });

  document.getElementById('reset-arch-btn')?.addEventListener('click', () => {
    const def = ARCHETYPES[state.selectedArchId]?.params;
    if (def) {
      state.archetypeConfigs[state.selectedArchId] = { ...def };
      renderArchetypeConfig();
    }
  });

  document.getElementById('reset-all-arch-btn')?.addEventListener('click', () => {
    state.archetypeConfigs = getDefaultArchetypeParams();
    renderArchetypeConfig();
  });

  document.getElementById('apply-arch-run-btn')?.addEventListener('click', handleRunSimulation);
  document.getElementById('run-sim-btn')?.addEventListener('click', handleRunSimulation);

  document.getElementById('copy-json-btn')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const text = JSON.stringify(buildScenarioConfig(), null, 2);
    try {
      await navigator.clipboard.writeText(text);
      const prev = btn.textContent;
      btn.textContent = 'Copied JSON!';
      setTimeout(() => {
        btn.textContent = prev;
      }, 1500);
    } catch {
      window.prompt('Copy scenario JSON:', text);
    }
  });

  // Delegated click handlers for board, seats, deck, archetype tabs/rows, and sample tabs
  document.addEventListener('click', (e) => {
    const clearBoardBtn = e.target.closest('[data-clear-board]');
    if (clearBoardBtn) {
      e.stopPropagation();
      const idx = Number(clearBoardBtn.dataset.clearBoard);
      state.board[idx] = null;
      state.activeSlot = { kind: 'board', index: idx };
      renderSetup();
      return;
    }

    const clearPlayerCardBtn = e.target.closest('[data-clear-player-card]');
    if (clearPlayerCardBtn) {
      e.stopPropagation();
      const [seat, ci] = clearPlayerCardBtn.dataset.clearPlayerCard.split(':').map(Number);
      state.players[seat].cards[ci] = null;
      state.activeSlot = { kind: 'player', seat, cardIdx: ci };
      renderSetup();
      return;
    }

    const clearSeatBtn = e.target.closest('[data-clear-seat]');
    if (clearSeatBtn) {
      const seat = Number(clearSeatBtn.dataset.clearSeat);
      state.players[seat].cards = [null, null];
      state.activeSlot = { kind: 'player', seat, cardIdx: 0 };
      renderSetup();
      return;
    }

    const slotEl = e.target.closest('[data-slot-kind]');
    if (slotEl) {
      if (slotEl.dataset.slotKind === 'board') {
        state.activeSlot = { kind: 'board', index: Number(slotEl.dataset.boardIdx) };
      } else {
        state.activeSlot = {
          kind: 'player',
          seat: Number(slotEl.dataset.seatIdx),
          cardIdx: Number(slotEl.dataset.cardIdx),
        };
      }
      renderSetup();
      return;
    }

    const pickBtn = e.target.closest('[data-pick-card]');
    if (pickBtn && !pickBtn.disabled) {
      assignCardToActiveSlot(Number(pickBtn.dataset.pickCard));
      return;
    }

    const archTab = e.target.closest('[data-arch-tab]');
    if (archTab) {
      state.selectedArchId = archTab.dataset.archTab;
      renderArchetypeConfig();
      return;
    }

    const archRow = e.target.closest('[data-arch-row]');
    if (archRow) {
      state.selectedArchId = archRow.dataset.archRow;
      renderArchetypeConfig();
      return;
    }

    const sampleTab = e.target.closest('[data-sample-idx]');
    if (sampleTab) {
      state.selectedSampleIdx = Number(sampleTab.dataset.sampleIdx);
      renderSampleHands();
    }
  });

  // Delegated input/change handlers for seat name, archetype sliders, seat type, and stack
  document.addEventListener('input', (e) => {
    const nameIn = e.target.closest('[data-seat-name]');
    if (nameIn) {
      const idx = Number(nameIn.dataset.seatName);
      state.players[idx].name = nameIn.value;
      return;
    }
    const slider = e.target.closest('[data-arch-slider]');
    if (slider) {
      const key = slider.dataset.archSlider;
      const val = Number(slider.value);
      const archId = state.selectedArchId;
      if (state.archetypeConfigs[archId]) {
        state.archetypeConfigs[archId][key] = val;
        const valEl = document.getElementById(`slider-val-${key}`);
        if (valEl) valEl.textContent = `${val}%`;
        renderArchetypeMatrix();
      }
    }
  });

  document.addEventListener('change', (e) => {
    const typeSel = e.target.closest('[data-seat-type]');
    if (typeSel) {
      const idx = Number(typeSel.dataset.seatType);
      state.players[idx].type = typeSel.value;
      if (ARCHETYPES[typeSel.value]?.params) {
        state.selectedArchId = typeSel.value;
      }
      renderSetup();
      renderArchetypeConfig();
      return;
    }
    const stackIn = e.target.closest('[data-seat-stack]');
    if (stackIn) {
      const idx = Number(stackIn.dataset.seatStack);
      state.players[idx].stackBB = Math.max(5, Math.min(1000, Number(stackIn.value) || state.stackBB));
      return;
    }
    const slider = e.target.closest('[data-arch-slider]');
    if (slider) {
      // Refresh tab modified dot after slider release
      renderArchetypeConfig();
    }
  });

  // Backspace/Delete clears currently active card slot when not editing a text box
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      e.preventDefault();
      assignCardToActiveSlot(null);
    }
  });

  // Load default preset and immediately run an initial simulation
  loadPreset(PRESETS[0].id);
  handleRunSimulation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUI);
} else {
  initUI();
}
