# Update: breakable windows you can dive through, pickaxe weak spots, lusher grass, bigger clouds

These are original takes on common battle-royale ideas. This update copies no map, interface, character or art from another game.

## Windows
- **Real openings:** about two in three outside wall panels have a real window on each storey. It's a hole in the wall framed by four wall pieces, with a glass pane in it. The old windows were only painted on.
- **Breaking glass:** any shot or pickaxe hit smashes the glass. The bullet that breaks it stops there; the next goes through.
- **Breaking the panel:** the pieces round a window are one panel. They share its 225 hit points and break together. The glass breaks on its own.
- **Diving through:** run at a broken window and press **Jump**.
  - You dive through, over the sill, onto the floor on the other side, from outside in or from inside out.
  - From an upstairs window you drop the rest of the way.
  - The dive is part of the shared movement code, so it's predicted in your browser and confirmed by the server.
- **Plain walls:** panels without a window are solid walls to hide behind, as before.

## Pickaxe weak spots
- **Weak spot:** after you hit a breakable wall, piece of furniture or prop with the pickaxe, a glowing ring appears near where you hit.
- **Critical:** land your next swing on it (within about 40 cm) for double damage. That's 150 instead of 75, with a gold number and a ding, and the spot moves after every hit.
- **Example:** an outside panel (225) goes down in two swings if you hit the spot, three if you don't.
- **The marker:** it faces you and pulses. It fades if you stop working on that spot or put the pickaxe away.

## Grass and sky
- **Grass:** longer, slimmer, denser blades with dark, cool roots and sunlit tips, for a deeper, lusher meadow. It's knee-high in fields. Wildflower drifts are unchanged.
- **Clouds:** fewer but much bigger cumulus clouds, each with a wide base and billowing heads stacked on top, at about the same drawing cost as before.

## Tests
- **Window dive:** with the glass intact you can't get in; once it's broken, you dive through and end up inside.
- **Shooting glass:** a shot smashes a window, and the four pieces round it still stand.
- **Weak spots:** a swing on the weak spot does double damage, so a 225 HP panel breaks in two swings.
