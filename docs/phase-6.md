# Phase 6: The storm, bosses and vaults, recall beacons, end screens, settings, emotes

## The storm
- Nine phases after the dropship leaves: wait, then shrink to the next circle. Damage rises from
  1 to 12 per second, goes straight to health, and the last circles keep drifting. A full match
  now ends in about 12 minutes.
- Circles are planned by the server and sent once, so every screen agrees and counts down on its own.
  Late circles always end on land.
- **You see:**
  - a towering swirling purple wall (it fades with distance, so the sky stays blue until the storm is close)
  - a purple tint when you're caught outside
  - the safe zone on the minimap and full map, with outside shaded and the next circle dashed
  - a countdown ("STORM SHRINKS IN 0:42 · 4/s")
  - an arrow with the distance to safety
- Bots move into the safe zone before the wall arrives, and keep shooting if they're mid-fight.

## Bosses and vaults
- **Warden Vex** at Rustworks and **Captain Hale** at Harborlight, each with two guards. They appear
  when the dropship leaves, hold their post and fight anyone who comes close.
- Bosses take 30% of incoming damage, guards 75%. A health bar shows while you're near a boss.
- Bosses and guards don't count as players left, and taking them out isn't an elimination.
- The boss drops its gear and a **Vault Keycard**.
- Each boss guards a concrete **vault bunker**. The keycard opens the steel door and three chests
  inside hold supply-drop quality loot. The door is solid for players, bullets and cars until it's
  opened, and each match has its own vaults.

## Recall beacons
- In duos, trios and squads, an eliminated player drops a **recall card** that only their squad
  can pick up. It lasts 90 seconds.
- Carry it to one of 9 **recall beacons** (green diamonds on your map) and hold E for 4 seconds:
  your teammates drop back in from the sky with a pistol and ammo.
- A beacon then recharges for 90 seconds. Its crystal turns grey while it recharges.
- Carried cards drop if the carrier goes down. Bots carry cards to beacons too.

## End of match
- **Victory:**
  - a gold #1 with "Last squad standing", confetti, and your squad's eliminations
  - your stats: eliminations, damage, damage taken, healing, revives, chests opened, distance
    travelled, time survived and placement
- **Eliminated:** your place, who got you, and the same stats.
- Buttons: **Spectate** (the arrows or left/right click switch who you watch), **Lobby**, and
  **Play again**, which drops you back in the queue (or readies you up if you're not the party leader).

## Settings (lobby and pause menu, saved in your browser)
- **Controls:**
  - mouse sensitivity, with separate aim and scope multipliers, and invert Y
  - sprint by default
  - toggle aim (click to aim instead of holding)
- **Video:** field of view (60–100°), graphics (low / medium / high), show FPS, and colour-blind
  palettes for deuteranopia, protanopia and tritanopia (rarity and team colours).
- **Audio:** master, effects and music volume (used by the sound in Phase 8).
- **Keys:** remap every action. Picking a key that's already in use swaps the two, so nothing ends up unbound.

## Emotes
- **B** plays an emote. Press again for the next one: a bouncing wave, a spinning groove, a cheer.
- The camera swings round so you can see yourself. Moving, jumping, aiming or shooting stops it.
- Everyone nearby sees it.

## Tests
- `npm test`: 97 tests. New ones cover:
  - storm damage (health, not shield) and a **full 80-player match played to the end**: it finishes
    in about 12 minutes with exactly one winning squad and a unique placement for every other squad
  - bosses: reduced damage, keycard drop, no elimination credit
  - the vault: locked door, opening with the keycard, rich chests, and a second match on the same
    server keeping its own vault locked
  - recall: card drop, a teammate picks it up, holds E at a beacon, and you drop back in with a pistol
  - spectate switching and emotes
- Browser runs: `e2e:combat`, `e2e:match` and `e2e:lobby` all pass with no errors.

## Bugs found and fixed while testing
- The boss crews (hidden until the dropship) were being "respawned" onto the warm-up island like players.
- From inside the circle the far storm wall filled the whole sky. It now fades with distance.
- Teammates standing together had their name tags drawn on top of each other. Tags now stack.
