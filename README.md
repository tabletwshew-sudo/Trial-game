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

## Controls
| Key | Action |
|---|---|
| W A S D | Move (steer while dropping) |
| Mouse | Look (click the game to capture the mouse) |
| Shift | Sprint |
| Space | Jump / drop from the ship / open or fold the glider / handbrake |
| Left mouse | Fire / use the item in your hands |
| Right mouse | Aim down sights |
| R | Reload |
| E | Pick up / get in or out of a car / hold to revive |
| 1–5, mouse wheel | Choose a slot |
| Ctrl or C | Crouch |
| M | Map (click to place a squad marker) |
| Middle click | Mark the spot you're looking at |
| Esc | Menu / leave match |

## Checks
```bash
npm run typecheck
npm test
```
