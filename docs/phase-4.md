# Phase 4: Weapons, healing, ammo, inventory, cars, knocked and revive

## What's in
- **9 original weapons** across 5 rarities (grey → gold; higher rarity means more damage and faster reloads):
  Ranger Pistol, Hornet SMG, Vanguard AR, Trident Burst AR, Thunder Pump, Breacher Auto Shotgun,
  Keystone DMR (scoped), Longshot Sniper (scoped, 2.5× headshots), Boomtube Launcher (rockets).
  Each has its own fire rate, magazine, reload, spread, bloom, damage falloff and headshot multiplier.
  Shotguns reload shell by shell and can fire mid-reload.
- **Frag Grenades** that arc and bounce. Grenades and rockets do blast damage that walls block.
- **Healing:** Bandage Roll (+15, up to 75), Med Pack (to 100), Shield Sip (+25 shield, up to 50),
  Shield Jug (+50 shield), Fizz Can (+15 health and +15 shield, fast). You can walk while using
  the small ones; the big ones root you in place.
- **Ammo:** Light, Medium, Heavy, Shells, Rockets. You pick ammo up by walking over it.
- **Inventory:** 5 slots plus ammo. `E` picks up the item you're looking at. With a full
  inventory it swaps with what's in your hands. Healing items and grenades stack.
- **Health 100 + shield 100.** Damage hits the shield first; fall damage hits health only.
- **Knocked and revive** (duos, trios, squads): at 0 health you're knocked if a teammate is still up.
  You crawl, can't shoot, and bleed out over about a minute. A teammate holds `E` for 7 s to revive
  you with 30 health. If the whole squad is knocked, the squad is eliminated.
- **Eliminations** drop everything the player carried. Kill feed, an "ELIMINATED / KNOCKED" pop-up,
  hit markers (yellow for headshots), floating damage numbers, damage-direction arrows, and a low-health glow.
- **Placement and victory:** your squad's place when you're out, and **#1 VICTORY** for the last squad
  standing. After being eliminated you can spectate a teammate (or whoever got you).
- **Cars:** 24 off-road pickups parked along the roads (and 2 on the warm-up island). `E` to get in;
  the first player drives (W/S, A/D, Space for the handbrake) and up to 3 passengers can shoot from
  their seats. Cars are faster on roads, stop at deep water, bounce off walls, take damage,
  smoke when hurt, and explode when destroyed.
- **Warm-up island:** everyone gets a random gun and ammo, there's loot to grab, and you respawn
  3 s after being eliminated. Everything resets when the dropship leaves.
- **Floor loot** by every building's door and around each location. Phase 5 adds chests and building interiors.
- **Bots fight:**
  - They loot, choose a weapon for the range, react after a delay, and aim imperfectly. Their aim is
    worse at long range and improves as a fight goes on.
  - They strafe, jump, heal when it's safe, revive teammates, and take a different skill level each.

## Controls (keyboard + mouse)
| Key | Action |
|---|---|
| Left mouse | Fire / use the item in your hands |
| Right mouse | Aim down sights (scoped weapons zoom in) |
| R | Reload |
| E | Pick up / get in or out of a car / hold to revive |
| 1–5, mouse wheel | Choose a slot |
| Ctrl or C | Crouch (steadier aim) |

## How hits are decided (fair for everyone)
- Your own shots are drawn instantly (tracer, muzzle flash, recoil) using the same spread pattern
  the server uses, so the bullets you see are the bullets that count.
- The server decides hits. It rewinds other players up to 0.3 s to where they were on *your* screen
  when you fired (lag compensation), so you don't have to lead targets because of your connection.
  It won't rewind further than that, so a laggy player can't shoot round corners.
- No friendly fire.

## Tests
- `npm test`: 76 tests. New ones cover every weapon rule (fire rate, bursts, reloads, shell
  loading, spread, falloff), shields and healing caps, inventory stacking and swapping, knocked
  crawling, fall damage, raycasts, car physics, hit detection, lag compensation (including that it
  can't be abused), no friendly fire, knock, revive and bleed-out, squad wipes, placement, victory,
  pickups, cars with passengers, destroying cars, and a **six-minute 80-bot match** that checks the
  game state stays consistent and the server stays fast (about 0.6 ms per tick on average).
- Browser runs (start the server as described in each file):
  - `npm run e2e:combat`: aim at a bot and shoot it (hit markers and damage numbers), aim down sights,
    pick up a weapon, switch slots, get in a car, drive it, get out.
  - `npm run e2e:match`: the full drop.
  - `npm run e2e:lobby`: two players in the same match.

## Bugs found and fixed while testing
- Players standing right next to the camera covered the screen in black outline: they're now hidden when that close.
- Floor loot was too small and faint to spot: items are bigger and the rarity rings and beams are brighter.
- A 30 m fall was always lethal: fall damage was softened.
- The match browser test could miss the short glider phase while taking a slow screenshot: it now records every movement state.

## Not in this phase
- Chests, supply drops, building interiors and the storm (Phases 5–6). Without a storm, matches don't
  force everyone together yet, so the last few teams can take a while to find each other.
- Car fuel and boats.
- Reboot vans for bringing back eliminated teammates (Phase 6).
