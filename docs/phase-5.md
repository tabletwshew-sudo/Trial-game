# Phase 5: Buildings you can enter, chests, supply drops, and island detail

## Buildings with real interiors
Every building is built from solid pieces (walls with door openings, floors, stairs, ceilings,
furniture, porch steps). Players, bullets, cars, the camera and bots all collide with exactly
the same pieces, so what you see is what blocks you.
- **Houses:** one or two floors, front and back doors, stairs up the side wall to an upstairs
  room with a railing round the stairwell, a partition wall making a second room downstairs,
  furniture (sofa, table, shelves, kitchen counter, bed, wardrobe, lamp, rug), windows on both
  sides, door frames with the door swung open, and porch steps where the ground is lower.
- **Halls** (barns, warehouses, factories): one big room with a roll-up door a car fits through,
  crates or hay bales to climb on, and loot on top of the crate stacks.
- **City shops:** two floors with counters and shelves; anything taller is solid above that.
- **Towers and the resort hotel:** a lobby on the ground floor with pillars, a desk and plants.
- Windows, wallpaper, wood or tile floors and ceiling lamps, in the colours of each location.

## Loot
- **Chests** (186 spots indoors plus 10 outdoors, about 55% filled each match):
  - E opens them: the lid flips back in a burst of sparkles and out comes an Uncommon-or-better
    weapon, its ammo, a heal, and sometimes extra ammo.
  - They glow and sparkle so you can spot them.
- **Ammo boxes** spill two kinds of ammo.
- **Supply drops:** three per match (40 s, 2:20 and 4:00 after the dropship), near where the
  players are. They float down under a balloon, show on the map, smoke when they land, and hold
  Rare-to-Legendary weapons and a big shield.
- **Floor loot inside rooms**, upstairs and downstairs, and a little outside.
- **Forage:** apples under trees (+5 health) and glowing mushrooms in pine woods and caves (+5 shield).
  E eats them on the spot.
- **Warm-up island:** 4 chests to try out.

## Island detail
- **Grass:** thousands of tufts drawn around you, tinted to the ground beneath, with wildflowers.
  Farm fields grow tall golden crops. Grass and tree canopies sway in the wind.
- **Ground texture** so it doesn't look like flat paint up close.
- **Props (872):**
  - in towns: street lamps, benches, bins, and power lines with sagging wires along the main roads
  - at the farms: fenced fields, hay bales, tractors, and a working windmill
  - at the camps: tents, campfires and log seats
  - at the factory: barrels, crate stacks, pipe runs, and smoking chimneys
  - at the quarry: a crane and rock piles
  - at the resort: beach umbrellas, loungers and a pool
  - at the mountain station: a blinking radio mast and satellite dishes
  - at the harbor: docks with moored boats you can stand on, and a lighthouse with a sweeping beam
  - a name sign at the edge of every location
- **4 crystal caves:** tunnels through hillsides with rock walls, a boulder-strewn roof, glowing
  crystals, mushrooms and a chest inside, and steps up into each mouth.
- **Solid trees and rocks:** trunks and rocks now block players, bullets and cars, so they're real cover.
- **Lighting pass:** a brighter, neutral sky light, and a soft fill light indoors so rooms read clearly.

## Bots
- Bots head for chests and supply drops (supply drops most of all).
- They walk in and out through doors and use the stairs to reach loot on upper floors.
- They eat forage when hurt.

## Tests
- `npm test`: 91 tests. New ones cover:
  - world generation speed
  - every building having a working front door
  - walking in through a door, climbing the stairs to the upper floor, and walls blocking you
  - bullets passing through doorways but not walls or floors
  - trees blocking shots and walkers
  - standing on the docks and walking through every cave
  - the island being stocked with chests, ammo boxes and forage
  - opening a chest (no commons, can't be opened twice) and eating an apple
  - supply drops falling, landing and holding better loot
  - a bot walking in through a door to loot a chest
- Browser runs:
  - `npm run e2e:combat` now also walks up to a chest and opens it.
  - `npm run e2e:match` and `npm run e2e:lobby` pass unchanged.

## Bugs found and fixed while testing
- Chest spots were placed inside walls, so no indoor chests ever spawned.
- Diagonal cave tunnels built from boxes bulged into the passage, and some caves had no way in.
  Tunnels now run along the compass directions and have steps.
- The hillside filled the caves: the ground is now carved out under each tunnel.
- Rooms and ceilings were dark and green-tinted: the sky light is neutral now, and interiors get a fill light.
- Bots pressing E for loot next to a car would jump into the driver's seat. Bots no longer take cars.
- A test that "eliminated players drop their loot" had only been passing because old floor loot
  happened to lie nearby. It now checks the actual gun and ammo.
