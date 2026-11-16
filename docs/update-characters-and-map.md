# Update: new characters and a fixed map

## Characters, rebuilt
Every character was rebuilt from scratch (`packages/client/src/lobby/character.ts`). They're still
original designs, the "Dropzone crew".

- **A real rig:**
  - hips and chest are separate, so the chest twists against the hips when running
  - shoulders and elbows, hips and knees: arms and legs now bend instead of swinging like sticks
- **Better animation:**
  - **Running:** knees fold as each leg swings through, elbows stay bent, the chest counter-twists and the head steadies.
  - **Strafing and backpedalling:** when you strafe the hips turn toward where you're going; backing up runs the steps in reverse.
  - **Crouching:** thighs forward, shins back, so it's a real crouch instead of a shrink.
  - **Other poses:** the slide (lead leg out, the other folded under), vaults, ladder climbing, mantles, swimming, crawling while knocked, sitting in cars, the skydive and the glider all use the knees and elbows now.
  - **Aiming:** the rifle is held with bent elbows and a supporting hand, and the chest turns into the shot.
  - **Fix:** the weapon is now in the right hand. Before, it was in the left while shots came from the right shoulder.
- **Models:**
  - **Body:** a shaped jacket with a hem, collar and zip; gloves with thumbs; boots with toe caps, laces and chunky soles; cargo pockets, a belt with a buckle and pouch, and a backpack with straps and a bedroll.
  - **Faces:** eyes with coloured irises, pupils and highlights; brows; a nose; a smile; rosy cheeks; ears.
- **Ten distinct outfits**, each with its own hairstyle, headgear, top and accessories:

  | Outfit | Hair | Headgear | Top | Extras |
  |---|---|---|---|---|
  | Trailblazer | swept | beanie | hoodie | knee pads |
  | Tidepool | buzz cut | backwards cap | windbreaker | |
  | Moss | ponytail | | hoodie | freckles |
  | Ultraviolet | big curls | headband | jacket | |
  | Ember | spiky | goggles | jacket | shoulder pads |
  | Glacier | bob | | parka with fur hood | scarf |
  | Citrus | mohawk | | vest | sunglasses |
  | Midnight | bun | | jacket | glowing visor |
  | Boss (Warden Vex / Captain Hale) | buzz cut | beret | armour | scar, shoulder pads |
  | Guards | buzz cut | helmet with visor | armour | knee pads |

- **Far-away figures:** the cheap stand-ins used beyond the 10 nearest players have the new proportions, and their hat or hair is coloured per player, so squads are still recognisable at range.
- **Developer page:** `/?charsheet=idle` (or `run`, `slide`, `climb`...) shows every outfit side by side. Add `&item=3` for a rifle or `&yaw=3.14` for the back view.

## Map, fixed and redesigned
- **Minimap:**
  - no more seam where the map image met the surrounding sea (the sea colour now matches exactly)
  - the map image is painted at twice the resolution, so it's crisp when zoomed in
  - a north marker, the names of places in view, and the grid square you're in (for example "D4")
  - the warm-up island is drawn properly from its own terrain, practice course included, instead of two flat circles
- **Full map (M):**
  - **Header:** where you are (place name and grid square), the storm timer (or when the dropship leaves), and players left.
  - **Zoom and pan:** the mouse wheel zooms around the cursor, drag to pan, and buttons for zoom in, zoom out, centre on me, and whole island.
  - **Grid:** A–H across the top and 1–8 down the side, for calling out drops.
  - **Labels and markers:**
    - place names on readable dark labels that grow as you zoom
    - squadmates' names under their arrows
    - your arrow is bigger, outlined in white and has a halo
    - a dashed line to your own marker with the distance
  - **Key:** a legend for every icon (you, squad, marker, safe zone, next zone, dropship route, supply drop, recall beacon, zipline, spring pad).
  - **Warm-up:** an inset shows the warm-up island with "you are here". Before, you were simply missing from the map.
  - **Small screens:** the legend hides and the map fills the screen.
