# Dropzone — Master Plan (Phase 1)

A browser-based, **no-build battle royale** for playing with friends at school.
80 players per match, Solo / Duo / Trio / Squad, fill with real players or bots,
bus drop, storm, chests, rarity-tiered loot, vehicles, and a full-movement kit
(sprint, slide, mantle, hurdle, swim).

> **Originality rule (applies to every phase).** Dropzone is an *original game in
> the battle royale genre*. We use genre mechanics (bus drop, storm, chests, rarity
> colours, no-build combat), but we do **not** copy any existing game's map, POI
> names, characters, skins, logos, UI art, sounds or music. The island, buildings,
> weapons names, characters and audio are all made for this project.

---

## 1. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Rendering | **Three.js** + TypeScript | Runs everywhere (Chromebooks included), WebGL2, big ecosystem |
| Art style | Stylised toon: cel-shading, bright saturated palette, soft outlines, gradient sky, stylised foliage | A bright cartoon look that runs on school hardware |
| Build tool | **Vite** | Fast dev server, small production bundle |
| Server | **Node.js + `ws`** (WebSockets), authoritative | One process serves the static client, the lobby API and the game servers |
| Shared code | `packages/shared` | The **same** movement, weapon and loot code runs on the client (prediction) and the server (authority) |
| Persistence | SQLite (`better-sqlite3`) → swappable for Postgres | Accounts, friends, stats |
| Tests | **Vitest** (unit + simulation) and **Playwright** (headless end-to-end) | Phase 8 bug-test passes |
| Deploy | One Node service on Render / Railway / Fly.io over **HTTPS + WSS on port 443** | School networks usually block other ports |

### Repo layout
```
packages/
  shared/   constants, protocol, movement sim, loot tables, map data, math
  server/   http + ws, auth, friends, parties, matchmaker, match instances, bots
  client/   three.js renderer, input (KBM), UI/HUD, audio, prediction
docs/       PLAN.md, RESEARCH.md, per-phase notes
tests/      e2e (Playwright)
```

### Networking model
* **Server-authoritative at 30 Hz.** Clients send input frames (keys, look angles,
  sequence number) at 60 Hz. The server simulates and sends delta snapshots.
* **Client-side prediction + reconciliation** for the local player, using the shared
  movement code. **Interpolation** (100 ms buffer) for everyone else.
* **Lag-compensated hitscan** (rewinds up to 200 ms). Projectiles are simulated on the server.
* **Interest management.** A player only receives entities within about 300 m, or that are
  audible or visible, which keeps 80-player matches cheap.
* Bots run **inside the match process** on the server, so they cost no bandwidth.

---

## 2. Phase breakdown

### Phase 1 — Research, repo, plan ✅ *(this phase)*
* Research notes → `docs/RESEARCH.md`
* Monorepo scaffold, build, test runner, a running server, a client that renders
* All gameplay constants centralised in `packages/shared/src/constants.ts`

### Phase 2 — Sign-in, lobby, friends, party, queue ✅
* Sign-in: username + password (bcrypt), or **guest** (no email, which suits school use)
* Session token (JWT in memory plus refresh in an httpOnly cookie)
* 3D lobby scene: your character plus party members standing beside you, ready-up toggle
* Friends: search by username, request, accept, online status, invite to party
* Party: up to 4 players, leader picks mode (Solo/Duo/Trio/Squad) and **Fill / No Fill**
* Matchmaker (80 players; trios cap at 78 = 26 full teams):
  * Buckets per mode. A party of size *p* in a mode of team size *t* needs *t − p* fills.
  * **Fill:** merge parties into teams (bin-packing largest-first), e.g. a solo and
    a trio in Squads become one team.
  * The match starts at **80 humans**, or after a **queue timer** (default 30 s, so school
    lobbies start fast). The remaining slots go to **bot teams**. If there are only 2 real
    teams, the other 18 squads are bots.
* Tests: matchmaker unit tests (team merging, bot fill counts, edge cases)

### Phase 3 — Pre-game island, teams, map, bus ✅
* **Warm-up island.** Players spawn on a small separate island, respawn on death, have
  random weapons, and see a countdown (60 s)
* Team assignment is preserved from the matchmaker: same team means the same match, shared
  HUD, and team-coloured markers
* **The island.** An original ~2.2 km × 2.2 km map generated from a seeded height
  field plus hand-placed biome/POI data in `shared/map`. It has a river, lakes, hills,
  coast, and about 12 named original POIs (towns, industrial site, farm, resort, peaks)
* **Battle bus.** A random straight route across the island each match, shown on the map
  before the drop. Doors open after 5 s; you're forced out at the end
  * Freefall: ~80 m/s dive (look down) / ~25 m/s horizontal glide
  * Glider auto-deploys at a height threshold (~100 m above ground); it can be redeployed
    by jumping from height later (if enabled)
  * Squad **follow-leader** jumping

### Phase 4 — Weapons, heals, vehicles, ammo, inventory
* Inventory: **5 slots** + ammo pouch; rarity tiers Common → Uncommon → Rare →
  Epic → Legendary (grey/green/blue/purple/gold), with damage scaling per tier
* Weapon classes (original names): AR, Burst AR, SMG, Pump Shotgun, Tactical
  Shotgun, DMR, Bolt Sniper, Pistol, Rocket Launcher; grenades
* Ammo types: Light, Medium, Heavy, Shells, Rockets
* Bloom/spread, recoil, first-shot accuracy, ADS, headshot multipliers, damage falloff,
  reload with partial-mag handling
* Heals: Bandage (15 HP, cap 75), Medkit (100 HP), Small Shield (+25, cap 50),
  Big Shield (+50), Splash (+20 HP/shield, thrown). Health 100 + shield 100
* Vehicles: car + boat with fuel, seat swapping and passengers shooting
* Down-But-Not-Out in team modes, revive, **reboot cards / reboot vans**

### Phase 5 — Map detail, buildings, chests
* GPU-instanced grass, trees, rocks and bushes with LOD and wind sway; caves; docks; bridges
* Modular building kit (walls, floors, stairs, roofs) for houses, shops, a factory, a mansion
* **Destructible** props and walls (no building, but you can still break things)
* Loot spawns: chests (glowing, hum sound), floor loot, ammo boxes, supply drops,
  fishing spots. Seeded spawn tables in `shared/loot`
* Chest: one weapon + ammo + a consumable/heal (+ chance of a 2nd item)

### Phase 6 — Bosses, end screens, settings, extras
* Original boss NPCs at 2 POIs (guard squads, a boss with a medallion/keycard-style
  reward), vault doors
* Storm: 9 phases, damage ramping up per phase, a moving final circle
* Spectate teammates, kill feed, eliminations counter, placement, **Victory screen**
* Settings: sensitivity (hip/ADS/scope), FOV, keybind remapping, graphics presets
  (Low/Medium/High for Chromebooks), volume sliders, colour-blind modes
* Map (M) with markers and pings (middle mouse), compass

### Phase 7 — Movement polish
* Walk, sprint (unlimited, with a tactical-sprint toggle), crouch, **slide** (momentum, downhill
  boost), jump, **mantle** (ledges up to ~2.5 m), **hurdle** (low obstacles while
  sprinting), swim (surface + sprint-swim), fall damage, ladder/zip-line, knock-back
* Animation: procedural plus authored rig blending, first-person arms option, 3rd-person
  over-the-shoulder camera (default)

### Phase 8 — Audio, test passes, polish, deploy
* Original spatial audio (footsteps per surface, gunshots by distance, chest hum,
  storm, bus, music stingers) via Web Audio with HRTF panning
* **Bug-test passes**: unit + simulation (bots fight 80-player headless matches 50×),
  Playwright e2e (sign-in → party → queue → drop → win), perf budget (60 fps on a mid
  Chromebook at Low)
* Deploy walk-through (Render/Railway), custom domain, scaling notes

---

## Art direction (owner notes, keep for Phases 3 and 5)
* The owner cares about **detail and looks**. Every scene should feel dense, lively and polished.
* The island is original but has the **density and layout feel of a classic BR map**: many towns
  close together, full buildings with enterable interiors, roads linking POIs, a river and lake,
  a mountain, farms, an industrial area, a retail strip, coastline, caves, and lots of props.
* Toon shading with outlines, a gradient sky, puffy clouds, wind-swayed foliage, and warm key plus cool rim light.

## 3. Bot design (Phase 2–6)
Bots are server-side agents with a **utility-AI + behaviour tree**:
* **Drop:** pick a POI weighted by distance from the bus route (bots avoid the hottest drop)
* **Loot:** path to the nearest chest or floor loot, upgrade to higher rarity, keep heals
* **Rotate:** move inside the storm early, using roads; get in vehicles sometimes
* **Fight:** perception cone + line of sight + hearing; reaction delay 350–900 ms;
  aim error that shrinks over the engagement; strafes, crouches, uses cover
* **Skill ramp:** early bots are weak. Bots that are still alive later in the match are
  stronger, and there are always fewer bots in late circles.
* **Squads of bots** move together in formation and revive each other
* Navigation: navmesh baked per map seed (recast-style grid + A*)

## 4. Controls (keyboard + mouse)
| Action | Key | Action | Key |
|---|---|---|---|
| Move | W A S D | Fire / ADS | LMB / RMB |
| Jump / Deploy glider | Space | Reload | R |
| Sprint | Shift (hold/toggle) | Interact / open chest | E (hold for revive) |
| Crouch / Slide | Ctrl or C | Slots | 1–5, mouse wheel |
| Map | M | Inventory | Tab / I |
| Ping | Middle mouse | Emote | B |
| Quick heal | H | Settings | Esc |

## 5. Definition of done per phase
1. `npm run build` and `npm test` pass
2. Manual play-through checklist in `docs/phase-N.md`
3. Committed and pushed to the dev branch
