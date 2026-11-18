# Dropzone

An original, browser-based **no-build battle royale**: 80 players, Solo/Duo/Trio/Squad,
fills, bots, bus drop, storm, chests. Built with Three.js + Node WebSockets.

See [`docs/PLAN.md`](docs/PLAN.md) for the 8-phase roadmap and
[`docs/RESEARCH.md`](docs/RESEARCH.md) for the mechanics research.

**Put it online for your friends:** follow [`docs/DEPLOY.md`](docs/DEPLOY.md) (Render, about 10 minutes, free).

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
| Space | Jump / climb a ledge / vault a fence / drop from the ship / open or fold the glider / handbrake |
| Left mouse | Fire / use the item in your hands / swing the pickaxe (it breaks walls and furniture) |
| Right mouse | Aim down sights (scoped guns can toggle instead: Settings → Controls) |
| R | Reload |
| E | Pick up / get in or out of a car / ride a zipline / hold to revive / trade at a merchant's stall |
| 1–5, mouse wheel | Choose a slot |
| F or 6 | Pickaxe |
| Tab or I | Inventory (drag to swap, drop items and ammo) |
| Ctrl or C | Crouch (while sprinting: slide) / let go of a ladder or zipline |
| B | Emote (press again for the next one) |
| ← → / left-right click | Switch who you're spectating |
| M | Map (click to place a squad marker) |
| Middle click | Mark the spot you're looking at |
| Esc | Menu / leave match |

Every key can be changed in Settings → Controls; fire, aim and ping can go on any mouse button too.

## Settings worth knowing
- **Video:**
  - Graphics Low / Medium / High: Low suits older school laptops, and the game also lowers its own resolution when the frame rate dips
  - HUD size (60–120%)
  - field of view
  - colour-blind palettes
  - reticle colour
- **Audio:** master, effects and music volume. Sound starts after your first click.
  - **Visualize sound effects** (on by default): markers around the middle of the screen show where footsteps, gunfire, explosions, chests and cars are

## Checks
```bash
npm run typecheck
npm test                 # unit + simulation tests
npm run soak -- 8        # 8 full 80-player matches headless, checking invariants
```
Browser end-to-end runs (start a server first with `QUEUE_TIMEOUT_S=2 WARMUP_S=300`):

```bash
npm run e2e:lobby
npm run e2e:match
npm run e2e:combat
npm run e2e:movement
npm run e2e:audio
npm run e2e:reconnect
```
