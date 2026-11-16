# Phase 7: Movement

Every move below runs in the shared simulation (`packages/shared/src/sim.ts` and `move.ts`). It is
predicted on your screen and confirmed by the server, so it feels instant online and nobody can fake it.

## Sliding
- Sprint and press **Crouch** (C or Ctrl) to slide. You get a short burst of speed, then friction
  slows you back to a crouch. A slide covers about 9–10 m on flat ground.
- **Downhill slides speed up** (up to 13 m/s). Uphill slides stop sooner. You can steer a little.
- **Slide-jump:** jump during a slide to keep its speed in the air (up to 9.5 m/s).
- Land with crouch held while you're moving fast and you go straight into a slide.
- The speed boost has a cooldown, so tapping crouch can't chain boosts together.
- You can aim and shoot while sliding. Your hitbox is smaller (see Combat).

## Mantling and vaulting
- **Mantle:** jump at a ledge up to 2.5 m above your feet (2.9 m when you're in water) and you climb
  on top. In the air, holding forward into a ledge climbs it without another press.
- **Vault:** sprint and jump at something low and thin, like a fence, railing or low wall, and you
  hop clean over it without losing speed.
- **Checks:**
  - nothing taller than you can climb in one go is mantled
  - there must be head room above the ledge (no climbing into low ceilings)
  - you only vault through gaps big enough for your body (no diving through small windows)
- You can **climb out of water** onto docks and boats.

## Jumping that feels right
- **Coyote time:** run off an edge and you can still jump for about 0.1 s afterwards.
- **Jump buffer:** press jump just before you land and you jump the moment you touch down.
- **Air momentum:** speed from slides, vaults, ziplines and pads carries into a jump and bleeds off slowly.
  Ordinary jumps still steer as before.

## Ladders, ziplines and spring pads
- **Ladders (41 on the island):**
  - on the farm silos, the lighthouse, and the sides of halls and shops
  - walk into one to climb it, and you step off onto the roof at the top
  - jump or crouch to let go
  - you can't shoot while climbing
- **Ziplines (4 across valleys, plus 1 on the warm-up island):**
  - press **E** under either end, or jump into the cable
  - it carries you at 19 m/s the way you're looking; look back along the line to turn around
  - you can shoot while riding
  - jump to drop off with its speed; you don't re-grab it straight away
  - the end posts have glowing arrow signs, and the lines show on the map
- **Spring pads (7 in towns, plus 1 on the warm-up island):**
  - step on one to launch about 23 m up
  - your glider opens on the way down, so you land unhurt
  - they show as green dots on the map

## Warm-up island practice course
A lookout tower with a ladder and a zipline off its roof, a row of fences to vault, a crate to
mantle, a brick wall to jump-mantle, and a spring pad. Warm up your movement while you wait for the dropship.

## Combat changes
- Crouching and sliding give you a **shorter hitbox** and lower eyes. Shots aimed at a standing
  player's chest go over a crouched one. Lag compensation remembers whether you were crouched at
  the moment the shooter saw you.
- No shooting, reloading or healing while you're swimming, climbing or mantling.

## What you see
- **New animations:**
  - slide: leaning back with your lead leg out and a hand trailing on the ground
  - mantle: reach up, haul yourself up, knee onto the ledge
  - vault: legs split over the obstacle
  - ladder: hand over hand, facing the wall
  - zipline: hanging from a trolley, one hand free to aim
  - launch: arms out
  - hard landings squash you down for a moment
- **Camera:**
  - it drops when you crouch (about 0.4 m) and lower still in a slide
  - it dips on hard landings
  - the field of view widens a little when you sprint, slide, ride a zipline or launch off a pad
- **Effects:**
  - dust trails behind slides
  - dust puffs on hard landings and when you mantle or vault
  - splashes when you hit the water, and wake puffs while you swim
  - a burst of green when a pad launches you
- Other players' slides, mantles, vaults and climbs are sent to you too, so you see their poses as well as your own.

## Bots
- A bot walking into a crate, fence or low wall jumps, which turns into a mantle or vault.
- Sprinting bots slide now and then. In a 6-minute 80-bot test match they mantled about 100 times
  and each spent several seconds sliding.

## Other fixes
- Ctrl is a crouch key and Ctrl+W closes the browser tab. Leaving the page mid-match now asks you
  to confirm first.
- **Quick key taps never get lost.** On a slow frame (a busy school laptop), a jump or interact tap
  pressed and released between two simulation steps used to vanish. Taps are now held until the
  next step reads them.
- **Fewer snap-backs on patchy wifi.** If your inputs stop arriving, the server now waits half a
  second (was 0.3 s) before moving you itself. A short wifi hiccup no longer pulls you back when
  your packets catch up. A tab that's really gone still can't freeze you in mid-air.
- **The sign-in card scrolls on short windows** (small laptop screens, zoomed-in browsers).
  Before, the guest button could end up off-screen.
- **Zipline ends:** the trolley brakes over the last few metres, so riding off the end drops you
  gently instead of flinging you 13 m. Jumping off mid-line still keeps full speed.

## Tests
- `npm test`: 113 tests. New ones cover:
  - **slides:** faster than sprinting, ending on flat ground; slide-jump momentum; no stacking the boost
  - **mantles:** onto a ledge, from mid-air, refusing walls that are too tall or have no head room;
    vaulting a fence; climbing out of water
  - **ladders:** climbing onto the roof, letting go, no shooting
  - **ziplines:** riding, turning round, dropping off with speed, riding to the end
  - **spring pads:** launch, glider, safe landing
  - **jumping:** coyote time and the jump buffer
  - **combat:** the crouched hitbox, and no shooting while swimming
  - **server:** the prediction replay now includes slides and still matches the server exactly;
    the 80-bot match checks that bots slide and mantle
- Browser run: `npm run e2e:movement` plays the warm-up course (slide, vault, mantle, ladder,
  zipline, pad) and checks the server agrees with your screen the whole way.
