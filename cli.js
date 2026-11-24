#!/usr/bin/env node
import fs from 'node:fs';
import { runSimulation } from './src/simulator.js';
import { STREET_NAMES } from './src/engine.js';

function printUsage() {
  console.log(`
Texas Hold'em Simulator CLI (shares exact engine with Web UI)

Usage:
  node cli.js --config scenario.json
  node cli.js --player "Hero:AsKd:aggressive" --player "Villain:QhQd:nit" --board "Ah 7d 2c" --trials 10000

Options:
  --config <file>         Load scenario JSON file
  --player <spec>         Add player "Name:Cards:Type" (e.g. "P1:AsKs:aggressive" or "P2:??:calling_station")
  --board <cards>         Community cards (e.g. "Ah 7d 2c" or "")
  --trials <n>            Number of Monte Carlo trials (default: 5000)
  --stack <bb>            Starting stack in BB (default: 100)
  --pot <bb>              Starting pot in BB for postflop starts
  --mode <street|preflop> Starting street mode (default: street)
  --seed <n>              Optional RNG seed for reproducibility
  --samples <n>           Number of sample hand histories to print (default: 1)
  --json                  Output raw JSON result
`);
}

function parseArgs(argv) {
  const args = { players: [], samples: 1, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else if (a === '--config') {
      const raw = JSON.parse(fs.readFileSync(argv[++i], 'utf8'));
      Object.assign(args, raw);
    } else if (a === '--player' || a === '-p') {
      const spec = argv[++i];
      const parts = spec.split(':');
      if (parts.length === 1) {
        args.players.push({ name: `Seat ${args.players.length + 1}`, cards: '??', type: parts[0] });
      } else if (parts.length === 2) {
        args.players.push({ name: `Seat ${args.players.length + 1}`, cards: parts[0], type: parts[1] });
      } else {
        args.players.push({ name: parts[0], cards: parts[1], type: parts[2] });
      }
    } else if (a === '--board' || a === '-b') {
      args.board = argv[++i];
    } else if (a === '--trials' || a === '-n') {
      args.trials = Number(argv[++i]);
    } else if (a === '--stack') {
      args.stackBB = Number(argv[++i]);
    } else if (a === '--pot') {
      args.startingPotBB = Number(argv[++i]);
    } else if (a === '--mode') {
      args.startMode = argv[++i];
    } else if (a === '--seed') {
      args.seed = Number(argv[++i]);
    } else if (a === '--samples') {
      args.samples = Number(argv[++i]);
    } else if (a === '--json') {
      args.json = true;
    }
  }
  return args;
}

function pad(str, width, right = false) {
  const s = String(str);
  return right ? s.padStart(width) : s.padEnd(width);
}

const args = parseArgs(process.argv.slice(2));
if (args.players.length < 2) {
  printUsage();
  process.exit(1);
}

const res = runSimulation({ ...args, sampleCount: args.samples });

if (args.json) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

const boardDisp = res.board.filter(Boolean).join(' ') || '(Preflop — random board)';
console.log(`\n=== Texas Hold'em Simulation (${res.trials.toLocaleString()} trials in ${res.elapsedMs}ms) ===`);
console.log(
  `Board: ${boardDisp} | Start: ${STREET_NAMES[res.startStreet]} | Avg Pot: ${res.avgPotBB.toFixed(1)} BB | Showdown: ${res.showdownPct.toFixed(1)}%\n`
);

const header = [
  pad('Player', 14),
  pad('Pos', 6),
  pad('Cards', 7),
  pad('Type', 14),
  pad('Actual%', 8, true),
  pad('RawEq%', 8, true),
  pad('EV(BB)', 10, true),
  pad('Fold%', 7, true),
  pad('WTSD%', 7, true),
  pad('Agg%', 7, true),
].join(' ');
console.log(header);
console.log('-'.repeat(header.length));

for (const p of res.players) {
  const evSign = p.evBB >= 0 ? '+' : '';
  console.log(
    [
      pad(p.name, 14),
      pad(p.position, 6),
      pad(p.cards.join(' '), 7),
      pad(p.archetypeShort, 14),
      pad(p.actualEquityPct.toFixed(1) + '%', 8, true),
      pad(p.rawEquityPct.toFixed(1) + '%', 8, true),
      pad(`${evSign}${p.evBB.toFixed(2)}`, 10, true),
      pad(p.foldPct.toFixed(1) + '%', 7, true),
      pad(p.wtsdPct.toFixed(1) + '%', 7, true),
      pad(p.aggPct.toFixed(1) + '%', 7, true),
    ].join(' ')
  );
}

if (res.sampleHands.length > 0) {
  console.log('\n--- Sample Hand #1 ---');
  for (const ev of res.sampleHands[0].events) {
    console.log(ev);
  }
}
