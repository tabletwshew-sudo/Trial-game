# Phase 8: Sound, graphics, a smaller UI, hardening, and going online

## Sound (all original, made in code)
Every sound is synthesised live with the Web Audio API (`packages/client/src/audio.ts`). There are
no recorded or borrowed sound files.

- **Gunfire:**
  - each weapon class has its own crack, body and low thump
  - far-off shots are muffled and roll back as an echo, so you can tell where a fight is and how far away
  - pump and bolt sounds on shotguns and snipers
- **Footsteps** on grass, dirt, sand, stone/road, wood floors and in water:
  - sprinting is loud, walking quieter, crouching almost silent
  - you hear the 12 nearest players, positioned in 3D (HRTF up close)
  - ladder rungs clank
- **Movement:** jump, hard landings, slides, mantles and vaults, spring pads, grabbing a zipline, splashes, the glider opening.
- **Looping beds:**
  - wind while skydiving (louder in a dive) and under the glider
  - the dropship's engines; car engines that rev with speed
  - the zipline trolley's whir
  - a shimmering hum from unopened chests (you hear them before you see them)
  - the storm's rumble, which grows as the wall gets close
  - waves near the shore, birdsong on land
- **Feedback:**
  - hit ticks, a bright ding for headshots, a crack when you break shield, a thud for a knock
  - an elimination cue, a hurt thump
  - pickups, ammo, weapon swaps, heals and shields, reloads
  - chests opening, supply drops, vaults, revives
- **Storm:** while you're inside it, every sound is muffled.
- **Music** (original):
  - an easy-going lobby groove
  - a driving theme from the dropship until you land
  - victory and defeat stings
- **Interface:** button clicks, ready-up, match found, the last-5-seconds countdown and a "go" when the dropship leaves.
- **Volume:** master, effects and music sliders in Settings → Audio. A limiter keeps big fights from clipping.

## Graphics overhaul
- **New frame pipeline** (`post.ts`):
  - the scene renders in HDR with multisampling
  - only things that glow bloom: the sun, sparkles on the water, muzzle flashes, tracers, explosions, loot rings, chest glows, cave crystals, beacons, spring pads, campfires and the storm's energy veins
  - then tone mapping that keeps the bright cartoon colours, a colour grade (warm highlights, cool shadows), a soft vignette, and anti-aliasing
- **Atmosphere** (`atmosphere.ts`):
  - real height fog: thicker near the sea, thinner up high, and warmer when you look toward the sun
  - distant hills fade into exactly the colour of the sky at the horizon, from the ground or from the dropship
- **Sky:**
  - a deep blue zenith fading to haze
  - a sun bright enough to bloom, with a warm halo
  - drifting high streaky clouds
  - bigger cumulus clouds, shaded with grey-blue undersides and bright silver edges toward the sun
- **Water:** a depth map of the sea floor drives it:
  - clear turquoise shallows you can see the sand through, deepening to blue
  - foam lines and waves rolling onto beaches
  - sky reflections at shallow angles and glinting sparkles from the sun
- **Grass:**
  - finer, denser clumps of curved blades, dark at the root and light at the tip
  - colour varies clump to clump, and it sways in gusts
  - it shrinks away at the edge of its range instead of popping
  - little five-petal flowers; tall golden wheat in the fields
- **Trees:**
  - fuller, rounder oaks with branches; five-tier pines
  - canopies shaded darker underneath and brighter on top
  - rocks with moss on top
- **Terrain:** broad meadows of drier and lusher grass break up the green.
- **Buildings:** soft shading toward the ground so they sit on it instead of floating.
- **Characters:** a crisp rim of light round their outline so players stand out from busy scenery.
- **Storm wall:** deeper purple, crackling bright energy veins, and a glowing seam where it meets the ground.
- **Ambient life:** flocks of birds wheeling overhead, butterflies over the grass, sunlit pollen drifting past.
- **Quality presets:**

  | | Low | Medium | High |
  |---|---|---|---|
  | Shadows | off | 1024 | 2048 |
  | Bloom | off | on | on |
  | Anti-aliasing | FXAA | FXAA | 4× multisampling |
  | Grass clumps | 3,500 | 8,000 | 14,000 |
  | Birds, butterflies, pollen | off | on | on |
  | Tree draw distance | short | medium | far |

- **Dynamic resolution:**
  - if the frame rate dips below about 48, the game renders fewer pixels, and it scales back up when there's room
  - if it's still slow at the lowest resolution, it switches off shadows, then shortens the tree distance

## Smaller UI
- The in-game HUD is about 20% smaller by default:
  - health and shield, the hotbar, the minimap, the team list, the banners, the kill feed, prompts and the storm and boss bars
  - each cluster shrinks into its own corner, so the screen centre is clearer
- A new **HUD size** slider (60–120%) in Settings → Video.
- The lobby's party list, play panel and locker are smaller, and the top bar is slimmer.

## Making everything work together
- **Reconnecting:**
  - if your connection drops mid-match, a "Connection lost · reconnecting…" notice appears
  - the game reconnects and puts you back in the same match as the same player
  - checked by a new browser test that cuts the connection on purpose
- **Soak testing:**
  - `npm run soak` plays full 80-player matches headless, with simulated human clients sending real input packets alongside the bots
  - every second it checks for bad numbers, health or shield out of range, anyone under the map or flying off, and bots stuck in one place
  - result: 8 matches across all four modes, 0 problems, one winning team each, about 11.7 minutes per match
- **Bots got smarter about getting unstuck** (the soak test found these):
  - a bot upstairs takes the stairs down before heading for the door; a bot on a roof walks off the edge toward its goal
  - a bot that makes no progress for 10 seconds outside a fight picks a new direction and drops the loot it couldn't reach
  - stuck bots went from 36 across 8 matches to 4
- **Faster loading on school wifi:** the server now compresses the game files (Brotli/gzip). The game download drops from 802 KB to 213 KB.

## Going online
See [`DEPLOY.md`](DEPLOY.md) for the full walkthrough. The repo is now ready to deploy:
- `render.yaml`: a one-click Render blueprint (build, start, health check, settings)
- `Dockerfile` and `.dockerignore`: for Fly.io, Railway or your own server
- `.node-version` and `engines`: Node 20 or newer
- a clean install from scratch was tested: `npm ci && npm run build && npm start` serves the game,
  the health check and sign-in

## Tests
- `npm test`: 113 unit and simulation tests, all passing.
- `npm run soak -- 8`: 8 full matches, 0 problems.
- Browser runs, all passing:
  - `e2e:lobby`, `e2e:match`, `e2e:combat`, `e2e:movement` (from earlier phases)
  - new: `e2e:audio`, which checks that every one of the 47 sounds, 8 loops and the music actually makes sound with no errors
  - new: `e2e:reconnect`

## Honest notes
- I can't listen to audio in this environment. The audio test proves every sound plays, but how it
  *sounds* (balance, character) hasn't been heard. Tell me anything that's too loud, too quiet or annoying.
- Screenshots here come from a software-rendered browser (no graphics card) at about 10 fps. A school laptop's
  real GPU runs the game far faster, and the new dynamic resolution keeps it smooth on weaker ones.
