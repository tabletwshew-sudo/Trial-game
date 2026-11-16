import { describe, expect, it } from 'vitest';
import {
  ITEM, PICK_SLOT, SK, getWorld, mulberry32, newPlayerState, raycastWorld, stepPlayer, surfaceAt,
  type InputCmd, type PlayerState, type World,
} from '@dropzone/shared';
import { botInput, findCover, newBrain, type BotBrain, type BotTarget, type BotWorld } from '../src/game/bots';
import { LootStore } from '../src/game/loot';

const w = getWorld();
const AT = { x: -640, z: 230 }; // open, flat farmland

function botWorld(enemies: BotTarget[], clock: { now: number }): BotWorld {
  return {
    w, loot: new LootStore(w), get now() { return clock.now; }, combat: true,
    enemiesNear: (x, z, r) => enemies.filter((e) => (e.x - x) ** 2 + (e.z - z) ** 2 <= r * r),
    downedMates: () => [], chestsNear: () => [], storm: null, cards: 0, beaconNear: () => null, isMateCard: () => false,
  };
}
function bot(x: number, z: number, yaw = 0): { s: PlayerState; b: BotBrain } {
  const s = newPlayerState();
  s.x = x; s.z = z; s.y = surfaceAt(w, x, z, 500); s.yaw = yaw;
  const b = newBrain(mulberry32(7));
  b.skill = 0.6;
  return { s, b };
}
/** Run the bot for `ms`, two sim steps per decision like the server. Returns every command. */
function run(s: PlayerState, b: BotBrain, bw: BotWorld, clock: { now: number }, ms: number, onSwing?: () => void) {
  const cmds: InputCmd[] = [];
  for (let t = 0; t < ms; t += 1000 / 30) {
    clock.now += 1000 / 30;
    const cmd = botInput(s, b, bw, { x: s.x, z: s.z }, 20);
    cmds.push(cmd);
    for (let k = 0; k < 2; k++) stepPlayer(s, k ? { ...cmd, slot: 0 } : cmd, w, { swing: () => onSwing?.() });
  }
  return cmds;
}
/** An outside wall facing +x with room on both sides (see the shot tests). */
function wallSpot(world: World) {
  return world.solids.find((o) => o.k === SK.Wall && !o.inner && o.face === 1 && o.b && o.z1 - o.z0 >= 7 && o.y0 <= o.b.fy + 0.05 && o.y1 >= o.b.fy + 2.6
    && Math.abs(surfaceAt(world, o.x0 - 0.42, o.z1 - 1.2, o.b.fy + 1) - o.b.fy) < 0.3 && Math.abs(surfaceAt(world, o.x1 + 1.2, o.z1 - 6.2, o.b.fy + 3) - o.b.fy) < 1.2)!;
}

describe('bots', () => {
  it('do not spot someone through a wall their shoulder is pressed against', () => {
    const wall = wallSpot(w);
    const { s, b } = bot(wall.x0 - 0.42, wall.z1 - 1.2, 0);
    s.y = surfaceAt(w, s.x, s.z, wall.b!.fy + 1);
    s.inv[0] = { id: ITEM.ar, r: 0, n: 1, mag: 30 }; s.ammo[1] = 60; s.slot = 0;
    const enemy: BotTarget = { idx: 1, x: wall.x1 + 1.2, y: surfaceAt(w, wall.x1 + 1.2, wall.z1 - 6.2, wall.b!.fy + 3), z: wall.z1 - 6.2, knocked: false };
    const clock = { now: 1_000_000 };
    // stand still (no stepping): only perception matters here
    for (let i = 0; i < 20; i++) { clock.now += 300; botInput(s, b, botWorld([enemy], clock), { x: s.x, z: s.z }, 0); }
    expect(b.enemy).toBe(-1);
  });

  it('findCover picks a nearby spot the enemy cannot see', () => {
    let tried = 0;
    for (const box of w.boxes) {
      if (box.shape !== 0 || box.x1 - box.x0 > 12 || box.z1 - box.z0 > 12) continue;
      const mz = (box.z0 + box.z1) / 2;
      const s = newPlayerState(); s.x = box.x1 + 3; s.z = mz; s.y = surfaceAt(w, s.x, s.z, box.fy + 2);
      const e = { x: box.x1 + 28, z: mz, y: 0 }; e.y = surfaceAt(w, e.x, e.z, box.fy + 3);
      if (Math.abs(s.y - box.fy) > 0.6 || Math.abs(e.y - s.y) > 2) continue;
      if (++tried > 40) break;
      const c = findCover(w, s, e);
      if (!c) continue;
      const cy = surfaceAt(w, c.x, c.z, s.y + 1.5);
      const dx = c.x - e.x, dy = cy + 1.2 - (e.y + 1.6), dz = c.z - e.z, l = Math.hypot(dx, dy, dz);
      expect(raycastWorld(w, { x: e.x, y: e.y + 1.6, z: e.z }, { x: dx / l, y: dy / l, z: dz / l }, l, false).kind).not.toBe('none');
      expect(Math.hypot(c.x - s.x, c.z - s.z)).toBeLessThan(9);
      return;
    }
    throw new Error('no building gave cover');
  });

  it('a hurt bot with heals breaks line of sight and heals instead of standing in the open', () => {
    // a small building between the bot's escape route and the enemy
    for (const box of w.boxes) {
      if (box.shape !== 0 || box.x1 - box.x0 > 12 || box.z1 - box.z0 > 12) continue;
      const mz = (box.z0 + box.z1) / 2;
      const { s, b } = bot(box.x1 + 3, mz, -Math.PI / 2); // facing +x, toward the enemy
      const enemy: BotTarget = { idx: 1, x: box.x1 + 28, y: 0, z: mz, knocked: false };
      enemy.y = surfaceAt(w, enemy.x, enemy.z, box.fy + 3);
      if (Math.abs(s.y - box.fy) > 0.6 || Math.abs(enemy.y - s.y) > 2 || !findCover(w, s, enemy)) continue;
      s.inv[0] = { id: ITEM.ar, r: 0, n: 1, mag: 30 }; s.ammo[1] = 60; s.slot = 0;
      s.inv[1] = { id: ITEM.bandage, r: 0, n: 5, mag: 0 };
      s.hp = 30; s.shield = 0;
      const clock = { now: 1_000_000 };
      const bw = botWorld([enemy], clock);
      run(s, b, bw, clock, 6000);
      // ended up out of the enemy's sight, and is bandaging (or already healed)
      const dx = s.x - enemy.x, dy = s.y + 1.2 - (enemy.y + 1.6), dz = s.z - enemy.z, l = Math.hypot(dx, dy, dz);
      expect(raycastWorld(w, { x: enemy.x, y: enemy.y + 1.6, z: enemy.z }, { x: dx / l, y: dy / l, z: dz / l }, l, false).kind).not.toBe('none');
      expect(s.hp > 30 || s.use > 0).toBe(true);
      return;
    }
    throw new Error('no suitable building');
  });

  it('with nothing to shoot, a bot takes out the pickaxe and swings at someone close', () => {
    const { s, b } = bot(AT.x, AT.z, 0);
    const enemy: BotTarget = { idx: 1, x: AT.x, y: s.y, z: AT.z - 1.8, knocked: false };
    const clock = { now: 1_000_000 };
    let swings = 0;
    run(s, b, botWorld([enemy], clock), clock, 3000, () => swings++);
    expect(s.slot).toBe(PICK_SLOT);
    expect(swings).toBeGreaterThan(0);
  });

  it('turns toward footsteps behind it and then spots the runner', () => {
    const { s, b } = bot(AT.x, AT.z, 0);   // facing north (-z)
    s.inv[0] = { id: ITEM.ar, r: 0, n: 1, mag: 30 }; s.ammo[1] = 60; s.slot = 0;
    const enemy: BotTarget = { idx: 1, x: AT.x, y: s.y, z: AT.z + 18, knocked: false, speed: 7.5 }; // sprinting, behind
    const clock = { now: 1_000_000 };
    const bw = botWorld([enemy], clock);
    b.enemyFirstSeen = 0;
    run(s, b, bw, clock, 300);
    expect(b.enemy).toBe(-1);               // can't see behind itself
    run(s, b, bw, clock, 3000);
    expect(b.enemy).toBe(1);                // heard, turned, saw
  });
});
