# Research notes — no-build battle royale mechanics

Sources: community guides and Epic's Creative documentation (linked at the bottom).
There are **no official numbers** for most mechanics, so the values in
`packages/shared/src/constants.ts` are *tuned targets*. We will tune them by feel
in Phase 7 and check them against gameplay footage in Phase 8.

## Movement
* **Sprint.** Holding sprint raises speed noticeably. Weapons are lowered while
  sprinting, and firing cancels sprint.
* **Slide.** Crouch while sprinting. You keep your momentum and gain speed on slopes.
  Jumping or sprinting ends a slide early (Epic Creative docs). A popular
  community tactic is sprint → jump → slide to keep speed.
* **Mantle.** Jump at a ledge to pull yourself up. It's used for bigger objects
  (vehicles, walls, building edges).
* **Hurdle.** Happens automatically when you sprint into a low obstacle (fences,
  low walls). Objects too tall to hurdle are usually mantle height.
* **Swim.** Surface swimming, a faster sprint-swim, and you can't shoot while swimming.
* Movement matters more in no-build because you can't put up cover instantly. That
  means peeking, sliding between cover and smart rotations decide fights.

## Storm
* Many phases (about 9–12) of *wait → shrink*. Damage scales up by phase.
  Community tables list roughly 1 dmg/s early, rising to about 10 dmg/s late.
* The final circles move (moving zones). The fast modes start at about 700 m.
* **Our choice:** 9 phases, see `STORM_PHASES` in constants.

## Loot
* Rarity colours: grey (Common), green (Uncommon), blue (Rare), purple (Epic),
  gold (Legendary). Higher tiers do more damage and have tighter spread.
* Chests: a weapon + ammo + an extra item. Chests skip Common weapons and lean
  towards Uncommon/Rare. Legendary rolls are rare (data-miners report < 1% for
  specific Legendary weapons).
* Shields: small = +25 (cap 50), big = +50 (cap 100).
* Supply drops: better odds of high-rarity loot.

## Teams / fills
* Solo / Duo / Trio / Squad. The fill toggle merges partial parties into full teams.
* Matches top up with bots when there aren't enough humans (the standard approach in
  modern BRs, which also helps small school lobbies).

## Not done
* The reference video could not be fetched (YouTube blocks automated access). If you
  describe what's in it (drop spot, weapons used, moments you liked), we'll use those
  descriptions as reference for **mechanics and feel**. We still won't copy the map or art.

## Sources
- https://dev.epicgames.com/documentation/en-us/fortnite/player-movements-in-fortnite-creative
- https://dignitas.gg/articles/tips-and-tricks-to-master-movement-in-fortnite-s-zero-build-mode
- https://www.pcgamesn.com/fortnite/hurdle
- https://www.hotspawn.com/fortnite/guide/fortnite-storm-mechanics
- https://gamertagmythras.com/blog/fortnite/fortnite-blitz-royale-guide
- https://guildorder.com/games/fortnite/wiki/loot-system
- https://fortnitenews.com/fortnite-increases-shield-potion-drop-rate/
