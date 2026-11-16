# Update: less lag, more detail

## Why it lagged
I measured the frame at fixed camera spots. The game code itself was cheap (under 5% of the frame). The slowdown was all graphics card work:

- **Trees:** about 2 million triangles of trees in one view, every oak casting a shadow.
- **Draw calls:** up to 815 separate draw calls per frame (each tree square, loot item, wheel, sparkle and puff was its own).
- **Pixels:** High drew at 1.75× screen resolution with 4× multisampling, and ran three full-screen passes after the scene.
- **Shaders:** the sky and water worked out 5–11 noise functions for every pixel.

## Speed fixes
Measured on High, 1280×720 at 2× pixel density:

- **Town from above:** 815 draw calls and 3.35M triangles before, 308 draw calls and 1.06M triangles after.
- **Now the heaviest spots:** the forest hill (378 draw calls, 1.01M triangles) and the warm-up island with 80 players (302 draw calls, 0.86M triangles).

- **Trees, bushes and rocks:**
  - Trees use a detailed model up close and a simple one beyond 320 m.
  - Only trees within about 110 m cast shadows.
  - The whole forest is now about a dozen draw calls instead of one per 200 m square.
  - Squares behind you aren't drawn at all.
- **Effects:**
  - Smoke, dust, splashes, sparks, chest sparkles, supply-drop smoke and car smoke all share two pooled particle systems (one draw call each).
  - Tracers and muzzle flashes reuse a fixed set of objects. Fights used to create hundreds of throwaway objects a second.
- **Loot, cars, signs, players:**
  - **Loot:** shown out to 56 m (was 70); outlines and shadows only within 24 m.
  - **Cars:** hidden beyond 300 m; shadows only within 90 m (before, every wheel of every car on the island was drawn).
  - **Signposts:** only drawn within 160 m.
  - **Players:** full models out to 100 m, outlines within 45 m, shadows within 55 m. Full models for the nearest 10 on High, 8 on Medium and 5 on Low.
- **Frame finishing:**
  - Tone mapping and colour grading are one pass instead of two.
  - Edge smoothing uses FXAA instead of 4× multisampling, and the bloom blur runs at a quarter of the size.
  - Low skips post-processing entirely and draws straight to the screen.
- **Resolution:**
  - High renders at up to 1.5× (was 1.75×), Medium at 1.1× (was 1.25×), Low at 1×.
  - Dynamic resolution still lowers this when the frame rate drops.
- **Flicker fix:** when dynamic resolution stepped up or down, one frame showed flat blue (the canvas was resized after drawing, which clears it). The change now happens just before drawing.
- **Sky and water:** their noise is baked into small textures once at load, so each pixel reads a texture instead of computing noise.
- **Grass and shadows:**
  - Grass blades no longer receive shadows.
  - Grass density is 10,000 / 6,000 / 2,500 tufts (High / Medium / Low).
  - Medium uses cheaper shadow filtering.
- **New "Auto" graphics setting (now the default):**
  - It reads your graphics chip and core count.
    - **Low:** software rendering, Chromebooks and phones, older Intel HD laptops.
    - **Medium:** recent integrated graphics (Intel Iris/UHD, base Apple M-series).
    - **High:** dedicated graphics cards and the bigger Apple chips.
  - Anyone who had the old default (High) is moved to Auto once. Low, Medium and High can still be picked in Settings.

## Detail added
- **Lighting:** smooth light across surfaces instead of hard bands, with stronger sun against shade so shapes read clearly.
- **Buildings:** real surface patterns, drawn by the graphics card from world position (no extra geometry):
  - **Outside walls:** brick, lapped siding, log cabins, plaster/concrete panels, or corrugated metal, depending on the place and the building.
  - **Roofs:** shingle rows on pitched roofs, metal on sheds and barns, gravel with tar seams on flat roofs.
  - **Inside:** plank floors in houses, tiled floors in shops and towers, patterned wallpaper.
  - **Weathering:** broad stains and grime on outside surfaces.
  - **Windows:** reflect the sky and ground, with a glint across the glass.
  - **Silos and shipping containers:** corrugated metal with rust patches.
- **Ground:**
  - **Grass and rock:** broad patches of sun-dried and lush grass, close-up grain, and layered rock strata on steep slopes.
  - **Paving:** paved squares and yards in towns, the city, the harbour and industrial areas are laid in concrete slabs.
  - **Sand and snow:** wind ripples in the sand and darker wet sand at the waterline; snow has soft drifts with cool blue hollows and glints up close.
- **Water:** layered ripples drifting in different directions, finer ripples close up, sky reflections and sun glints.
- **Trees and bushes:** lit as soft, rounded masses (bright on top, cooler underneath) instead of hard facets, and each leaf face is a slightly different shade.

All patterns fade out at a distance before they get small enough to shimmer.

## For developers
- **`__dz.perf`** in the browser console shows draw calls, triangles, milliseconds of game code vs. rendering, the current resolution scale, and resource counts.
- **New files:**
  - `game/surface.ts`: surface patterns.
  - `game/noisetex.ts`: baked noise textures.
  - `game/quality.ts`: Auto detection.
- **Surface kinds:** buildings tag each face with a kind through `GeoBuilder.surf`.
