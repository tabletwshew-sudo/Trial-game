# Phase 3: Warm-up island, shared matches, the island, and the dropship

## What's in
- **Same match for the whole lobby.** When matchmaking forms a match, the server starts a match
  instance and every player in it (humans and bots) is simulated there. Teams from the lobby carry over.
- **Warm-up island.** All 80 players spawn on a small separate island and can run and jump
  while a countdown runs (`WARMUP_S`, default 30 s). Bots wander around.
- **The island.** An original 2.4 km map, generated from a seed so the server and every browser
  build the identical world: 14 named locations (a city, towns, farms, camps, a harbor, an
  industrial yard, a resort, a quarry and a mountain station), 211 solid buildings, a road network
  with bridges over the river, a lake, a snowy mountain, beaches, and about 6,000 trees, rocks and bushes.
- **The dropship** (our battle bus): flies a random straight route across the island.
  Doors open after 6 s, `SPACE` drops you, and anyone left is dropped before the route ends.
- **Skydiving and gliding.** Look down to dive faster, `W` to steer, and `SPACE` opens or folds the
  glider while high up. The glider opens by itself 65 m above the ground. You can land on roofs.
- **On foot.** Walk, sprint, jump, swim, walk on bridges, and collide with buildings.
  (Slide, mantle and hurdle arrive in Phase 7.)
- **Bots.** Bot squads pick a location, time their jump for it, dive and glide there, then roam.
  Bots that fill out a human's team wait for their human to jump and land with them.
- **HUD.** Compass, minimap, full map (`M`) with location names and the ship's route, squad list
  with distances, altitude and speed while dropping, location name on arrival, and a pause menu (`Esc`).
- **Squad markers.** Click the map (or middle-click in the world) to place a marker your squad
  sees as a light beam with a distance. Right-click the map to remove it.
- **Slow computers.** The game lowers its own graphics settings when the frame rate stays low.
  `?q=low` in the address forces the low setting.

## How the netcode works
- The server is in charge and runs the match 30 times a second.
- Your own movement is predicted in the browser with the same code the server runs, so it
  feels instant. A test confirms the prediction matches the server to within 2 cm with 100 ms of lag.
- Other players are shown 100 ms in the past and smoothed between updates.
- Inputs and position updates are small binary packets (about 22 kB/s per player for 80 players).
- The server limits how many inputs it accepts per second, so a speed hack cannot move faster.

## Tests
- `npm test`: 47 tests. New ones cover the world (locations on dry land, no overlapping
  buildings), movement, the drop, packet encoding, a full simulated 80-player match
  (warm-up → dropship → everyone lands), speed-hack throttling, lag spikes, and prediction accuracy.
- `npm run e2e:match`: one browser plays a whole drop: queue → warm-up → dropship → map marker →
  jump → dive → glide → land → run → leave.
- `npm run e2e:lobby`: two browsers party up, load into the same match, and see each other move.
- Start the server for the e2e runs with: `PORT=8099 QUEUE_TIMEOUT_S=2 WARMUP_S=22 npm start` (22 s leaves room for loading the island with software rendering)

## Bugs found and fixed while testing
- Roads were invisible from above (their surfaces faced downward).
- A connection stall while holding `SPACE` could count as two presses (drop, then instant glider).
- The dropship camera started in front of the ship instead of behind it.
- The sea floor showed a hard rectangle through the water from high up.

## Not in this phase
- Storm, weapons, loot and eliminations (Phases 4–6). The "players left" counter only drops when someone leaves.
- Building interiors, grass and small props (Phase 5). Trees have no collision yet.
