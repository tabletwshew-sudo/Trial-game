# Update: better cars, supply drops, sound markers trimmed, a softer look

All original: the cars, crates and art style are Dropzone's own, not copied from another game.

## Cars
- **New model:** a rounded off-road pickup.
  - The body has real wheel arches, dark fender flares and a raked cab with side windows and a windscreen.
  - At the front: a chrome grille, round headlights and a heavy bumper.
  - At the back: tail lights, a roll bar with two spot lamps, a wooden bed with rails and a spare wheel.
  - Down the sides: a stripe and door lines.
  - Some have a white roof and roll bar.
- **Wheels:** knobbly tyres on five-spoke rims. The front wheels now steer the right way and the wheels roll the right way.
- **Suspension:** each wheel follows the ground under it. The body leans out of corners, squats when you accelerate and dips when you brake.
- **Boost:** hold **Sprint (Shift)** while driving forward.
  - **Speed:** acceleration more than doubles and top speed goes up 40%.
  - **Meter:** it lasts 3 seconds and refills as fast once you let go. A BOOST meter shows above the hotbar while you drive.
  - **Effects:** flames stream out of the exhaust (other players see them too), there's a whoosh as it kicks in, and the view widens a little.
- **Dust and smoke:**
  - Cars kick up dust off grass, dirt and sand at speed.
  - Drifting on the handbrake (Space) leaves tyre smoke.
  - Damaged cars still smoke.

## Supply drops
- **How many:** about eight a match, up from three. They leave the sky 35, 95 and 155 seconds after the dropship, then two at a time at 215, 280, 350, 420 and 500 seconds.
- **Where they land:** always on open ground inside the storm's next safe circle, near where people are, and well apart from each other.
- **Finding them:**
  - A tall beam of pale blue light stands on the landing spot from the moment a drop is announced, until someone opens the crate. It gets wider and brighter with distance, so it still shows as a column over the treeline from most of a kilometre away.
  - A **SUPPLY** marker with the distance floats over every unopened drop, over the crate while it falls and over where it landed.
  - The announcement says to follow the blue beam, and the crate lands with a heavy thud.
- **Loot:** better than a chest, as before, plus 60 gold.

## Sound markers
- **Four kinds only:** footsteps, gunshots, chests (supply drops included) and cars. Landing, jumping and sliding count as footsteps.
- **Removed:** explosions, impacts, gliders, splashes and vaults.
- **Less clutter:**
  - A marker right next to a closer one of the same kind is hidden.
  - At most four footstep markers show at once.
  - Footsteps show within 32 m.

## A softer, brighter look
- **Grass:** a soft carpet of short, wide blades with rounded tips that curl outward, instead of thin spikes.
  - Roots match the ground and tips are sun-warmed.
  - The blades shade like the ground they grow from.
  - Ankle-high in meadows, knee-high and golden in farm fields.
- **Trees and bushes:**
  - Oak crowns and bushes close by are made of round lobes, shaded as one soft mass, in brighter, warmer greens.
  - Far ones keep the simpler shapes.
- **Light and colour:**
  - A cooler, greener bounce light, so shade reads fresh rather than brown.
  - A slightly warmer sun.
  - A brighter colour grade: more saturation, softer contrast, lifted cool shadows and warm highlights.
- **Cost:** about the same triangles as before (the island view drew about 1.17 million on High, down from 1.25 million).

## Tests
- **Supply drops:** about eight a match, two at a time from the fourth wave, each inside the next safe circle, on the ground, and the pair well apart.
- **Boost:** much faster with Sprint held, empty after 3 seconds, then refilling. It's counted in whole simulation ticks, so the browser's prediction matches the server exactly.
- **Netcode:** vehicle and self snapshots carry the boost flag and meter, and the round-trip test still passes.
