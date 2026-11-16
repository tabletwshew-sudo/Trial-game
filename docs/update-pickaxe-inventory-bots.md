# Update: pickaxe, inventory, weapon icons, smarter bots, new moves, no shooting through walls

## Shots no longer go through walls
- **The cause:** shots start at your right shoulder, 0.75 m beside you (where the over-the-shoulder camera looks from). Standing with that shoulder against a wall put the start of the shot on the other side of the wall. Bullets then hit people behind it, and bots could spot you through it.
- **The fix:**
  - The shot's start point is now traced out from your body and stops at any wall in the way. This covers bullets, grenades and the pickaxe.
  - Rockets fired with a wall right in front of you start just short of it, instead of 1 m ahead (which used to be beyond it).
  - Bots see from the same safe point.
- **Tests** recreate the exact case: a player pressed against an outside wall shoots someone outside, and no damage gets through. These tests fail without the fix.

## Pickaxe
- **Always carried:** it has its own slot in front of the five item slots.
- **Taking it out:** press **F** (or **6**, or scroll to it). If the slot you're holding becomes empty (you used your last heal or dropped the item), the pickaxe comes out automatically.
- **Swinging:**
  - Click to swing, or hold to keep swinging (about 1.8 swings a second).
  - A swing hits the nearest enemy in front of you within 2.5 m, for 20 damage, and never through a wall.
  - It also damages cars, and chips sparks and dust off walls.
- **Model and animation:** an original pickaxe (ash handle, wrapped grip, steel head with a spike and a blade). It's carried low at your side; a swing winds up over the shoulder, chops forward and follows through.
- **Sounds:** a whoosh, a clank on walls, a thud on players.
- **Pickups:**
  - Picking up a gun while holding the pickaxe puts the gun straight into your hands.
  - With every slot full and the pickaxe out, there's nothing to swap with. The prompt says to hold an item first.
- **Bots** use it too when they have nothing to shoot.

## Weapon icons
- **Every weapon type has its own silhouette:**
  - **Pistol:** a compact pistol.
  - **SMG:** stubby, with a straight magazine.
  - **AR:** a full rifle with a curved magazine.
  - **Burst AR:** a scope rail and three dots.
  - **Pump:** a pump grip and a long tube.
  - **Auto shotgun:** a drum magazine.
  - **DMR:** a scope and a long barrel.
  - **Sniper:** a big scope and a bipod.
  - **Launcher:** a tube.
- **Other items:** the pickaxe, grenade, bandages, med pack, shield sip, shield jug, fizz can, cards and each ammo type have icons too.
- **Accent colour:** the accent on each icon takes the item's rarity colour.
- **Where they appear:** the hotbar, the pickup prompt, the kill feed (instead of the weapon's name) and the inventory screen.
- All drawn from scratch as small vector images, so they're sharp at any size.

## Inventory screen (Tab or I)
- **Slots:** your five slots and the pickaxe. **Drag** one slot onto another to swap them; whatever you're holding stays in your hands.
- **Details:** click a slot for its stats:
  - **Weapons:** damage, headshot multiplier, fire rate, magazine, reload time, range, ammo type.
  - **Heals:** how much they heal, the cap, use time, stack size.
  - **Grenades and the pickaxe:** their damage and reach.
- **Actions:** **Equip**, **Drop**, **Drop half** (stacks), **Drop all**. With the screen open, **1–6** selects a slot and **Q** drops it.
- **Ammo:** each type with its icon and count. Drop 10 (rockets: 1) or half for a teammate.
- **Dropping:** things land just in front of you (at your feet if a wall's in the way), and you won't auto-collect ammo you just dropped for 3 seconds.
- **Keys:** Tab now opens the inventory; the map stays on **M**. Both keys can be changed in Settings (new entries: Inventory, Pickaxe).

## Smarter bots
- **Cover:** when hurt (or reloading at range), a bot finds a nearby spot the enemy can't see (behind a wall, a tree, a rock). It runs there, crouches, heals or reloads, then comes back out to fight.
- **Pushing:** a bot that has hit its target hard (70+ damage) or knocked it closes in to finish the fight, instead of hanging back.
- **Chasing:** when a target ducks out of sight, the bot follows to where it was last seen the way a player would (through doors, up and down stairs), instead of walking into walls.
- **Grenades:** a bot lobs one over cover at an enemy who has just hidden 7–26 m away.
- **Hearing:**
  - Bots hear you sprinting nearby and turn to look; they don't see behind themselves otherwise.
  - Gunfire and pickaxe swings make them look too, and healthy, armed bots go to investigate.
- **Fighting style:**
  - Quicker side-to-side strafing for skilled bots, the odd crouch mid-fight, more jumping up close.
  - At long range they tap-fire automatic rifles so their spread settles.
- **No gun:** they take out the pickaxe and charge if you're close; otherwise they go and look for a weapon.
- **No x-ray:** bots see from their side of any wall (see the first section).

## New moves
- **Roll landing:**
  - **Trigger:** drop 4 m or more while moving and you roll forward out of it, keeping your speed.
  - **Fall damage:** the roll soaks up 8 m of the fall, so damage starts at 18 m instead of 10 m.
  - **While rolling:** it lasts half a second, you're low (smaller to hit) and your hands are busy. Jumping straight out of it keeps the speed.
  - **Look and sound:** a tucked forward roll with dust and sound.
  - Bots roll too when they drop off roofs.
- **Wall kick:**
  - **Trigger:** in the air with a wall right in front of you, press jump to kick off it, up and away (once per jump; landing gives it back).
  - **No wall climbing:** a kick can't be used to climb a full-height wall, because you can't mantle again until you land.
  - **Look and sound:** a kick-off pose, a thud and a puff of dust.

## Tests
- **Shots through walls:**
  - the shot origin stays on your side of a wall
  - a player can't damage someone through a wall
- **Pickaxe:**
  - slot 6 selects it
  - a swing does 20 damage and keeps swinging when held
  - it misses someone behind you and never hits through a wall
- **Inventory:** a full inventory with the pickaxe in hand doesn't swap; holding a slot does.
- **Bots:**
  - no spotting through a wall
  - cover is found, and is really hidden
  - a hurt bot breaks line of sight and heals
  - no gun means pickaxe
  - footsteps make them turn and spot you
- **Movement:**
  - a roll saves fall damage
  - a small hop doesn't roll
  - roll speed and hitbox
  - one kick per jump, pushed away from the wall
  - no wall, no kick
- **Totals:** 129 unit tests, plus the browser suites (lobby, full match, combat, movement, audio, reconnect).
