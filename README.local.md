# Running Texas Hold'em Simulator Without Docker

This project has **zero external npm dependencies** and runs directly with standard Node.js—or by opening the pre-built standalone HTML file straight in your browser.

---

## Prerequisites
- **Node.js 18+** (Node.js 22 recommended) for running the local server, rebuilding after edits, running tests, or using the CLI.
- *(No Node.js needed at all if you just open the pre-built `dist/index.html` directly in a browser!)*

---

## Option 1: Run the Local Web Server (Recommended)

From the project directory (`holdem-sim/`):

```bash
# 1. Build dist/index.html from src/ and web/
npm run build

# 2. Start the local HTTP server (default port 8080)
npm start
```

Or run both in one command:
```bash
npm run dev
```

Then open your browser to:
- `http://localhost:8080`

To use a custom port (e.g., `3000`):
```bash
PORT=3000 npm start
```

---

## Option 2: Open Directly in Your Browser (Zero Setup)

Because `dist/index.html` is a single self-contained bundle with all JavaScript and CSS inlined, you can open it directly without starting any server:

1. Double-click `dist/index.html` in your file explorer, **or**
2. Run from terminal:
   - **macOS**: `open dist/index.html`
   - **Linux**: `xdg-open dist/index.html`
   - **Windows**: `start dist\index.html`

> If `dist/index.html` doesn't exist yet (for example after a fresh clone), generate it once with `npm run build`.

---

## Option 3: Run Simulations from the Command Line (CLI)

The optional CLI shares the exact same poker engine as the Web UI:

```bash
node cli.js \
  --player "Hero:AsKs:aggressive" \
  --player "Station:JhTs:calling_station" \
  --player "Nit:QhQd:nit" \
  --player "Villain:??:tag" \
  --board "Ah 7d 2c" \
  --trials 100000
```

You can also export any setup from the Web UI using the **Copy JSON** button, save it to a file (e.g., `scenario.json`), and run it via CLI:

```bash
node cli.js --config scenario.json
```

Run `node cli.js --help` for all CLI flags (`--trials`, `--stack`, `--pot`, `--mode`, `--seed`, `--samples`, `--json`).

---

## Developing & Running Tests

### Run Automated Tests
```bash
npm test
```

### Project Structure
```text
holdem-sim/
├── src/
│   ├── cards.js            # 52-card deck, notation parser, validation, PRNG
│   ├── evaluator.js        # Fast exact 7-card hand evaluator & draw detector
│   ├── archetypes.js       # Player types & 7 tunable behavioral parameters
│   ├── engine.js           # Street betting engine, side pots & hand history log
│   └── simulator.js        # Sync + chunked async Monte Carlo runner
├── web/
│   ├── template.html       # Web UI layout
│   ├── app.js              # Interactive deck picker, config sliders & results UI
│   ├── styles.css          # Playing cards & component CSS
│   └── standalone-theme.css# Light/dark theme tokens for standalone browsers
├── build.mjs               # Bundles src/ + web/ into dist/index.html
├── server.mjs              # Lightweight zero-dependency static server
├── cli.js                  # Optional Node.js CLI runner
└── tests/
    └── simulator.test.js   # Unit, chip-conservation & behavioral tests
```

Whenever you edit files in `src/` or `web/`, run `npm run build` to regenerate `dist/index.html` and refresh your browser.
