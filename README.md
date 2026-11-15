# Dropzone

An original, browser-based **no-build battle royale**: 80 players, Solo/Duo/Trio/Squad,
fills, bots, bus drop, storm, chests. Built with Three.js + Node WebSockets.

See [`docs/PLAN.md`](docs/PLAN.md) for the 8-phase roadmap and
[`docs/RESEARCH.md`](docs/RESEARCH.md) for the mechanics research.

## Run locally
```bash
npm install
npm run build && npm start      # http://localhost:8080
```
Dev mode with hot reload: `npm run dev` (client on :5173, server on :8080).

## Checks
```bash
npm run typecheck
npm test
```
