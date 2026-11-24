# Running Texas Hold'em Simulator in Docker

Run the complete Texas Hold'em Monte Carlo Simulator Web UI (and optional CLI/tests) inside a lightweight `node:22-alpine` container—no local Node.js installation required.

---

## Prerequisites
- [Docker](https://docs.docker.com/get-docker/) (Docker Desktop or Docker Engine)
- *(Optional)* Docker Compose v2 (`docker compose`)

---

## Option 1: Quick Start with Docker Compose (Recommended)

From the project directory (`holdem-sim/`):

```bash
docker compose up --build
```

Then open your browser to:
- **Web UI**: `http://localhost:8080`
- **Health check**: `http://localhost:8080/health`

To run on a different port (for example, `3000`):

```bash
PORT=3000 docker compose up --build
```

To run in the background and stop later:

```bash
docker compose up -d --build
docker compose down
```

---

## Option 2: Plain `docker build` & `docker run`

### 1. Build the Docker Image
```bash
docker build -t texas-holdem-sim .
```

### 2. Run the Web UI Container
```bash
docker run --rm -p 8080:8080 --name holdem-sim texas-holdem-sim
```

Open `http://localhost:8080` in your browser.

To run detached in the background on port `3000`:
```bash
docker run -d -p 3000:8080 --name holdem-sim texas-holdem-sim
```

Stop and remove the detached container:
```bash
docker stop holdem-sim && docker rm holdem-sim
```

---

## Running the Optional CLI or Tests Inside Docker

The same image includes the simulation engine CLI (`cli.js`) and full test suite:

### Run a Custom CLI Simulation
```bash
docker run --rm texas-holdem-sim node cli.js \
  --player "Hero:AsKs:aggressive" \
  --player "Station:JhTs:calling_station" \
  --player "Nit:QhQd:nit" \
  --player "Villain:??:tag" \
  --board "Ah 7d 2c" \
  --trials 100000
```

### Run the Automated Test Suite
```bash
docker run --rm texas-holdem-sim npm test
```

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | Internal port the Node HTTP server listens on |
| `HOST` | `0.0.0.0` | Bind address inside the container |

---

## Notes
- **Zero npm dependencies**: The project uses pure Node.js built-ins and ES modules, so `docker build` requires no `npm install` step and finishes in a few seconds.
- **Light / Dark mode**: The Web UI automatically adapts to your browser/OS light or dark theme preference.
- **Fully offline**: All CSS and JavaScript are bundled directly into `dist/index.html` with no external CDN requests required.
