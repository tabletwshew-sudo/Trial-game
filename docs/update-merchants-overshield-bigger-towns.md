# Update: merchants and gold, breakable walls, overshield, bigger towns, new grass

All of this is original to Dropzone. Nothing is copied from another game, including its names, art, characters or maps.

## Gold and the pirate merchants
- **Gold** is a new pickup (a stack of coins). You collect it just by walking over it, and you can carry up to 9,999. It shows under the minimap whenever you have any.
- **Where it comes from:**
  - Small piles (10–20) on the ground.
  - 15–30 in every chest; 60 in supply drops.
  - 15 for each elimination after the drop.
  - Everything a player was carrying drops where they fall.
- **Merchants:** three original pirate traders have set up stalls on the coast, at Harborlight, Coral Cove and Sandbar Shacks.
  - Each stall has a striped awning, a plank counter, a chest of gold and barrels. The trader sways behind the counter.
  - Stalls show on the full map as gold markers.
- **Trading:** walk up to a stall and press **E** to open the shop. E, Tab or Esc closes it.
  - Each merchant has five offers: high-rarity guns that come with ammo, heals, shields and grenades.
  - Prices run from 30 gold (5 bandages) to 250 gold (a legendary launcher).
  - Offers you can't afford are greyed out.
  - The server checks that you're at the stall and can pay. If your slots are full, the item goes at your feet.

## Pickaxe and breakable walls
- **Slower swing:** about 1.1 swings a second (it was 1.8). It does 20 damage to players.
- **Breaking things:** each swing does 75 damage to a wall or a piece of furniture.
  - Inside walls take 150 (2 swings), outside walls 300 (4 swings), furniture 100.
  - Explosions damage them too. A small bar shows how much is left of the thing you're hitting.
- **What breaking does:** a broken piece crumbles with debris and a crash, for everyone in the match.
  - People and bullets go through the gap afterwards.
  - Players who join late see the same holes.
- **What can't break:** vault doors, the ground, rocks and trees.

## Overshield
- **What it is:** 50 extra protection on top of your shields. It's shown as its own bar above the shield bar.
- **Damage order:** damage takes the overshield first, then shields, then health.
- **Refilling:** it's full when you jump from the dropship. After 6 seconds without taking damage it refills by 20 a second. Being knocked down empties it.

## Cars hurt people
- **Damage:** driving into someone at speed hurts them, and the faster you're going the harder it hits (about 22 damage at 7 m/s, nearly 100 at top speed on a road).
- **Knockback:** the person is thrown forward and the car loses speed.
- **Credit and safety:** the driver gets the credit. Teammates and people in the car are safe.

## Warm-up island
- **Size:** much bigger, with a radius of 130 m (it was 75), and more loot spread over it.
- **Spawns:** players start on open ground, never inside a crate or a rock.
- **No damage:** nobody can hurt anybody else during warm-up, whether with guns, grenades, the pickaxe or cars.
  - Your shots still show a hit marker, without a damage number, so practice feels right.
  - Falls and the sea still hurt, and you respawn after 3 seconds.

## Bots are a lot worse
- **Skill:** most bots are now beginners. Their skill range dropped from 0.15–0.70 to 0.05–0.35.
- **Seeing and reacting:** they spot you from shorter range, react about half a second slower and turn more slowly.
- **Aim and grenades:** their aim is much sloppier, and only the better ones throw grenades.

## Bigger places, upstairs everywhere, houses around the map
- **Bigger places:** named places cover about a fifth more ground and have around 40% more buildings.
- **Two floors everywhere:** houses, cabins, farmhouses, shops, barns, warehouses and city towers all have a second floor reached by stairs, with loot and chests upstairs.
- **Hamlets:** up to 16 small clusters of two-storey houses sit along the roads between places. They aren't named on the map.
- **Ziplines and pads:** there are up to 12 ziplines (there were 5), and two spring pads in every named place.
- **Bots on stairs:** bots climb stairs up the middle now (they used to walk off the side).

## Controls
- **Rebinding:** fire, aim/scope and ping can be bound to any key or mouse button, including side buttons, in Settings → Controls.
- **Toggle scope** (Settings → Controls): one click scopes in and the next scopes out. It applies to scoped weapons only; other guns still aim while held.
- **When you're eliminated with teammates still alive,** a card offers **Spectate** or **Back to lobby**.
  - While you're spectating, the bar at the bottom has **Results** and **Lobby** buttons.
  - The cursor stays free so you can click them.

## Simpler HUD
- **Key hints:** the line of key hints fades away after 15 seconds.
- **Hidden until needed:**
  - The gold counter shows only when you have gold.
  - The wall bar shows only while you're hitting something.
- **Map:** hamlets aren't labelled.

## Looks
- **Grass:** each tuft is a clump of tapered, curved blades.
  - Dark roots match the ground, so tufts grow out of it instead of sitting on top.
  - Tips are lighter and glow when you look toward the sun.
  - Tufts are taller in fields and shorter elsewhere.
  - A second, sparser ring carries the grass out to about twice the distance.
- **Render distance:**
  - Trees and forests draw much further out on every quality setting: 560 / 950 / 1400 m (they were 380 / 600 / 900).
  - The haze is lighter.
  - Cars, chests, loot and signs show from further away.
- **Running:** a new run and sprint animation.
  - A loose jog.
  - A proper sprint: forward lean, high knees, bent elbows pumping, a springy bounce, and the head held steady.
- **Lobby:**
  - The character stands on a stone stage with a gold ring and four lamp posts.
  - Proper blade grass around the stage.
  - A "What's new" card lists this update.

## Tests
- **New server tests:**
  - The slower pickaxe.
  - Breaking a wall: you can walk and shoot through the gap afterwards.
  - Overshield: soaks damage first and refills.
  - Gold: you collect it by walking over it, and buying works only at a stall and only when you can afford it.
  - An elimination pays the 15 gold bounty, and the loser's gold drops where they fell.
- **Updated tests:** the spawn, squad, car and bot tests were changed for the bigger map.
- **End-to-end:** the combat test now shoots a bot during warm-up and expects a hit marker but no damage.
