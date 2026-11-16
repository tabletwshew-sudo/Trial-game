import { describe, expect, it } from 'vitest';
import {
  ITEM, K, MOVEMENT, MV, PM, POSE, SIM_HZ, SK, SOLID_CELL, SPAWN_ISLAND, ZIP_HANG, addToInventory, aimOrigin, boxSolid, getWorld, isLow,
  newPlayerState, rayPlayer, solidKey, stepPlayer, surfaceAt, terrainAt, type InputCmd, type PlayerState, type ShotEvent, type Solid, type World,
} from '../src/index';

/**
 * A sandbox: the real island's terrain, but no buildings, with a flat slab (top at FLOOR)
 * on the warm-up island and whatever test boxes we add on top of it.
 */
const base = getWorld();
const X = SPAWN_ISLAND.x, Z = SPAWN_ISLAND.z, FLOOR = 6;
function sandbox(extra: Solid[] = []): World {
  const w: World = Object.create(base);
  w.solidGrid = new Map();
  w.ladders = []; w.zips = []; w.pads = [];
  const add = (o: Solid) => {
    for (let i = Math.floor(o.x0 / SOLID_CELL); i <= Math.floor(o.x1 / SOLID_CELL); i++)
      for (let j = Math.floor(o.z0 / SOLID_CELL); j <= Math.floor(o.z1 / SOLID_CELL); j++) {
        const k = solidKey(i, j);
        if (!w.solidGrid.has(k)) w.solidGrid.set(k, []);
        w.solidGrid.get(k)!.push(o);
      }
  };
  add(boxSolid(X, Z, 45, 45, 0, FLOOR, SK.Floor));
  extra.forEach(add);
  return w;
}
const player = (w: World, dx = 0, dz = 0) => {
  const s = newPlayerState(); s.x = X + dx; s.z = Z + dz; s.y = surfaceAt(w, s.x, s.z, 50); return s;
};
/** Run `ticks` steps; north is -z (yaw 0 faces -z). */
const run = (s: PlayerState, w: World, cmd: InputCmd | ((i: number) => InputCmd), ticks: number, onTick?: (s: PlayerState, i: number) => void) => {
  for (let i = 0; i < ticks; i++) { stepPlayer(s, typeof cmd === 'function' ? cmd(i) : cmd, w); onTick?.(s, i); }
};
const speed = (s: PlayerState) => Math.hypot(s.vx, s.vz);

describe('slide', () => {
  it('sprint + crouch slides faster than you can run, then slows to a crouch', () => {
    const w = sandbox(); const s = player(w);
    run(s, w, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 40);
    expect(speed(s)).toBeCloseTo(MOVEMENT.sprintSpeed, 1);
    const z0 = s.z;
    let peak = 0, slideTicks = 0;
    run(s, w, { keys: K.F | K.SPRINT | K.CROUCH, yaw: 0, pitch: 0 }, 150, (q) => { peak = Math.max(peak, speed(q)); if (q.mv === MV.Slide) slideTicks++; });
    expect(peak).toBeGreaterThan(MOVEMENT.sprintSpeed + 1);
    expect(slideTicks).toBeGreaterThan(40); // most of a second at least...
    expect(slideTicks).toBeLessThan(150); // ...but it ends on flat ground
    expect(s.mv).toBe(MV.None);
    expect(speed(s)).toBeCloseTo(MOVEMENT.crouchSpeed, 1);
    expect(z0 - s.z).toBeGreaterThan(9);
    // crouch-walking from a standstill never slides
    const c = player(w);
    run(c, w, { keys: K.F | K.CROUCH, yaw: 0, pitch: 0 }, 60, (q) => expect(q.mv).toBe(MV.None));
  });

  it('a slide-jump keeps the momentum in the air', () => {
    const w = sandbox(); const s = player(w);
    run(s, w, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 40);
    run(s, w, { keys: K.F | K.SPRINT | K.CROUCH, yaw: 0, pitch: 0 }, 6);
    expect(s.mv).toBe(MV.Slide);
    const before = speed(s);
    run(s, w, { keys: K.F | K.SPRINT | K.CROUCH | K.JUMP, yaw: 0, pitch: 0 }, 1);
    expect(s.grounded).toBe(false);
    run(s, w, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 20);
    expect(s.grounded).toBe(false);
    expect(speed(s)).toBeGreaterThan(MOVEMENT.sprintSpeed + 0.5);
    expect(speed(s)).toBeLessThanOrEqual(Math.min(before, MOVEMENT.slideJumpMax) + 1e-6);
  });

  it('spamming crouch does not stack the slide boost', () => {
    const w = sandbox(); const s = player(w);
    run(s, w, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 40);
    let peak = 0;
    run(s, w, (i) => ({ keys: K.F | K.SPRINT | (i % 8 < 4 ? K.CROUCH : 0), yaw: 0, pitch: 0 }), 240, (q) => { peak = Math.max(peak, speed(q)); });
    expect(peak).toBeLessThan(MOVEMENT.sprintSpeed + MOVEMENT.slideBoost + 0.2);
  });

  it('crouching and sliding shrink your hitbox and lower your aim', () => {
    const w = sandbox(); const s = player(w);
    expect(isLow(s)).toBe(false);
    run(s, w, { keys: K.CROUCH, yaw: 0, pitch: 0 }, 2);
    expect(isLow(s)).toBe(true);
    // a shot at chest height of a standing player passes over a crouched one
    const o = { x: 0, y: 1.53, z: 10 }, d = { x: 0, y: 0, z: -1 };
    expect(rayPlayer(o, d, 0, 0, 0, 100, POSE.Stand)).not.toBeNull();
    expect(rayPlayer(o, d, 0, 0, 0, 100, POSE.Low)).toBeNull();
    expect(rayPlayer({ x: 0, y: 1.22, z: 10 }, d, 0, 0, 0, 100, POSE.Low)!.head).toBe(true);
    expect(aimOrigin(0, 0, 0, 0, true).y).toBeLessThan(aimOrigin(0, 0, 0, 0, false).y);
  });
});

describe('jumping', () => {
  it('coyote time: you can still jump just after running off a ledge, but not long after', () => {
    // a 3 m high platform ending at z = Z - 10
    const w = sandbox([boxSolid(X, Z, 6, 10, FLOOR, FLOOR + 3, SK.Block)]);
    const go = (late: number) => {
      const s = player(w, 0, 5);
      expect(s.y).toBeCloseTo(FLOOR + 3);
      let left = -1;
      run(s, w, (i) => ({ keys: K.F | (left >= 0 && i === left + late ? K.JUMP : 0), yaw: 0, pitch: 0 }), 200, (q, i) => {
        if (left < 0 && !q.grounded) left = i;
        if (left >= 0 && i === left + late + 1) expect(q.vy > 3).toBe(late <= 4);
        if (left >= 0 && i > left + late + 1 && q.grounded) i = 1e9;
      });
    };
    go(3);
    go(14);
  });

  it('jump buffer: pressing jump just before landing jumps as soon as you land', () => {
    const w = sandbox(); const s = player(w);
    run(s, w, { keys: K.JUMP, yaw: 0, pitch: 0 }, 1);
    // wait until just before touching down, tap jump, release
    let t = 0;
    while (!(s.vy < 0 && s.y - FLOOR < 0.25)) { run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 1); if (++t > 200) throw new Error('never fell'); }
    run(s, w, { keys: K.JUMP, yaw: 0, pitch: 0 }, 1);
    let jumpedAgain = false;
    run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 10, (q) => { if (q.vy > 3) jumpedAgain = true; });
    expect(jumpedAgain).toBe(true);
  });
});

describe('mantle and hurdle', () => {
  it('jumping at a chest-high ledge climbs onto it', () => {
    const w = sandbox([boxSolid(X, Z - 6, 3, 2, FLOOR, FLOOR + 1.9, SK.Block)]); // front face at Z - 4
    const s = player(w);
    let mantled = false;
    run(s, w, (i) => ({ keys: (i < 75 ? K.F : 0) | (i === 30 ? K.JUMP : 0), yaw: 0, pitch: 0 }), 90, (q) => { if (q.mv === MV.Mantle) mantled = true; });
    expect(mantled).toBe(true);
    expect(s.y).toBeCloseTo(FLOOR + 1.9, 2);
    expect(s.grounded).toBe(true);
    expect(s.z).toBeLessThan(Z - 4);
  });

  it('holding forward in the air at a ledge mantles without another press', () => {
    const w = sandbox([boxSolid(X, Z - 6, 3, 2, FLOOR, FLOOR + 2.3, SK.Block)]);
    const s = player(w, 0, -3.3);
    // jump in place, then push forward against the wall
    let stoodOnTop = false;
    run(s, w, (i) => ({ keys: (i === 0 ? K.JUMP : 0) | (i > 2 && i < 40 ? K.F : 0), yaw: 0, pitch: 0 }), 60, (q) => { if (q.grounded && Math.abs(q.y - FLOOR - 2.3) < 0.01) stoodOnTop = true; });
    expect(stoodOnTop).toBe(true);
    expect(s.y).toBeCloseTo(FLOOR + 2.3, 2);
  });

  it('walls that are too tall, or with no room on top, are not mantled', () => {
    const tall = sandbox([boxSolid(X, Z - 6, 3, 2, FLOOR, FLOOR + 3.8, SK.Block)]); // a full storey
    const s = player(tall);
    run(s, tall, (i) => ({ keys: K.F | (i === 30 || i === 60 ? K.JUMP : 0), yaw: 0, pitch: 0 }), 120, (q) => expect(q.mv).not.toBe(MV.Mantle));
    expect(s.y).toBeCloseTo(FLOOR, 1);
    // a ledge under a low ceiling (that also covers where you stand)
    const low = sandbox([boxSolid(X, Z - 6, 3, 2, FLOOR, FLOOR + 1.5, SK.Block), boxSolid(X, Z - 3, 3, 5, FLOOR + 2.6, FLOOR + 3, SK.Ceil)]);
    const t = player(low);
    run(t, low, (i) => ({ keys: K.F | (i === 30 ? K.JUMP : 0), yaw: 0, pitch: 0 }), 90, (q) => expect(q.mv).not.toBe(MV.Mantle));
  });

  it('sprinting + jump at a low fence vaults clean over it', () => {
    const w = sandbox([boxSolid(X, Z - 8, 4, 0.1, FLOOR, FLOOR + 1.0, SK.Prop)]);
    const s = player(w);
    let hurdled = false, top = 0;
    for (let i = 0; i < 150 && !hurdled; i++) {
      // jump when the fence is just ahead
      const near = s.z - (Z - 8 + 0.1) < 1.4;
      run(s, w, { keys: K.F | K.SPRINT | (near ? K.JUMP : 0), yaw: 0, pitch: 0 }, 1);
      if (s.mv === MV.Hurdle) hurdled = true;
    }
    expect(hurdled).toBe(true);
    run(s, w, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 30, (q) => { top = Math.max(top, q.y); });
    expect(top).toBeGreaterThan(FLOOR + 1.0); // went over, not through
    expect(s.z).toBeLessThan(Z - 8.5);
    expect(s.y).toBeCloseTo(FLOOR, 1);
    expect(s.grounded).toBe(true);
    expect(speed(s)).toBeGreaterThan(MOVEMENT.walkSpeed);
  });

  it('you can climb out of water onto a dock', () => {
    // find open water next to the warm-up island and put a dock edge there
    let wx = 0;
    for (let r = 60; r < 140; r += 1) if (terrainAt(base, X + r, Z) < -3) { wx = X + r; break; }
    expect(wx).not.toBe(0);
    const w: World = Object.create(base);
    w.solidGrid = new Map(); w.ladders = []; w.zips = []; w.pads = [];
    const dock = boxSolid(wx + 8, Z, 4, 4, -3, 0.6, SK.Prop);
    for (const k of [solidKey(Math.floor((wx + 4) / SOLID_CELL), Math.floor(Z / SOLID_CELL)), solidKey(Math.floor((wx + 12) / SOLID_CELL), Math.floor(Z / SOLID_CELL))]) w.solidGrid.set(k, [dock]);
    const s = newPlayerState(); s.x = wx; s.z = Z; s.y = surfaceAt(w, wx, Z, 5);
    let out = false;
    run(s, w, { keys: K.F, yaw: -Math.PI / 2, pitch: 0 }, 200, (q) => { if (q.grounded && Math.abs(q.y - 0.6) < 0.01 && q.x > wx + 4) out = true; }); // yaw -pi/2 faces +x
    expect(out).toBe(true);
  });
});

describe('ladders, ziplines, spring pads', () => {
  it('walk into a ladder to climb it, over the top onto the roof', () => {
    const roof = FLOOR + 7;
    const w = sandbox([boxSolid(X, Z - 10, 4, 4, FLOOR, roof, SK.Block)]); // south face at Z - 6
    w.ladders = [{ x: X, z: Z - 6 + 0.45, y0: FLOOR, y1: roof, nx: 0, nz: 1, tx: X, tz: Z - 7 }];
    const s = player(w);
    let climbed = false, onRoof = -1;
    run(s, w, { keys: K.F, yaw: 0, pitch: 0 }, 300, (q, i) => { if (q.mv === MV.Climb) climbed = true; if (onRoof < 0 && q.grounded && Math.abs(q.y - roof) < 0.01 && q.z < Z - 6) onRoof = i; });
    expect(climbed).toBe(true);
    expect(onRoof).toBeGreaterThan(0);
    expect(onRoof / SIM_HZ).toBeLessThan(3.5); // ~7 m of ladder at 4.2 m/s, after a 1 s walk
    // and the world has real ladders whose tops are somewhere you can stand
    for (const L of base.ladders) {
      const top = surfaceAt(base, L.tx, L.tz, L.y1 + 0.6);
      expect(Math.abs(top - L.y1)).toBeLessThan(1.2);
    }
    expect(base.ladders.length).toBeGreaterThan(15);
  });

  it('jump off a ladder to let go; you cannot shoot while climbing', () => {
    const w = sandbox([boxSolid(X, Z - 10, 4, 4, FLOOR, FLOOR + 9, SK.Block)]);
    w.ladders = [{ x: X, z: Z - 6 + 0.45, y0: FLOOR, y1: FLOOR + 9, nx: 0, nz: 1, tx: X, tz: Z - 7 }];
    const s = player(w); addToInventory(s, ITEM.ar, 1, 1, 30);
    run(s, w, { keys: K.F, yaw: 0, pitch: 0 }, 70);
    expect(s.mv).toBe(MV.Climb);
    const shots: ShotEvent[] = [];
    for (let i = 0; i < 20; i++) stepPlayer(s, { keys: K.F | K.FIRE, yaw: 0, pitch: 0 }, w, { shot: (e) => shots.push(e) });
    expect(shots.length).toBe(0);
    run(s, w, { keys: K.JUMP, yaw: 0, pitch: 0 }, 1);
    expect(s.mv).toBe(MV.None);
    run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 120);
    expect(s.grounded).toBe(true);
    expect(s.z).toBeGreaterThan(Z - 6);
  });

  it('press E under a zipline to ride it; jump to drop off with its speed', () => {
    const w = sandbox();
    const y = FLOOR + 3.6;
    w.zips = [{ ax: X, ay: y, az: Z, bx: X, by: y + 4, bz: Z - 80, len: Math.hypot(80, 4) }];
    const s = player(w, 0.5, -0.5);
    run(s, w, { keys: K.USE, yaw: 0, pitch: 0 }, 1);
    expect(s.mode).toBe(PM.Zip);
    expect(s.y).toBeCloseTo(y + 4 * s.zt - ZIP_HANG, 1);
    run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 90);
    expect(s.mode).toBe(PM.Zip);
    expect(Math.abs(s.zv)).toBeCloseTo(MOVEMENT.zipSpeed, 1);
    expect(Z - s.z).toBeGreaterThan(20);
    // looking back turns you around
    expect(s.zv).toBeGreaterThan(0);
    run(s, w, { keys: 0, yaw: Math.PI, pitch: 0 }, 120);
    expect(s.zv).toBeLessThan(0);
    run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 120);
    run(s, w, { keys: K.JUMP, yaw: 0, pitch: 0 }, 1);
    expect(s.mode).toBe(PM.Walk);
    expect(speed(s)).toBeGreaterThan(10);
    run(s, w, { keys: 0, yaw: 0, pitch: 0 }, 200);
    expect(s.grounded).toBe(true);
    expect(s.hp).toBe(100);
    // riding to the end drops you off there
    const t = player(w, 0.5, -0.5);
    run(t, w, { keys: K.USE, yaw: 0, pitch: 0 }, 1);
    let endSpeed = 0;
    run(t, w, { keys: 0, yaw: 0, pitch: 0 }, 400, (q) => { if (q.mode === PM.Zip) endSpeed = Math.abs(q.zv); });
    expect(t.mode).toBe(PM.Walk);
    expect(t.z).toBeLessThan(Z - 75);
    expect(t.z).toBeGreaterThan(Z - 86); // braked at the end, not flung off
    expect(endSpeed).toBeLessThan(6);
    // the real island has a few
    expect(base.zips.length).toBeGreaterThanOrEqual(2);
  });

  it('a spring pad launches you, the glider opens, and you land unhurt', () => {
    const w = sandbox([boxSolid(X, Z - 5, 0.9, 0.9, FLOOR, FLOOR + 0.15, SK.Prop)]);
    w.pads = [{ x: X, y: FLOOR + 0.15, z: Z - 5 }];
    const s = player(w);
    let top = 0, glided = false;
    run(s, w, { keys: K.F, yaw: 0, pitch: 0 }, 900, (q) => { top = Math.max(top, q.y); if (q.mode === PM.Glide) glided = true; });
    expect(top - FLOOR).toBeGreaterThan(15);
    expect(glided).toBe(true);
    expect(s.mode).toBe(PM.Walk);
    expect(s.hp).toBe(100);
    expect(base.pads.length).toBeGreaterThan(3);
  });
});

describe('swimming', () => {
  it('no shooting or healing while swimming', () => {
    let wx = 0;
    for (let r = 60; r < 140; r += 1) if (terrainAt(base, X + r, Z) < -3) { wx = X + r + 8; break; }
    const s = newPlayerState(); s.x = wx; s.z = Z; s.y = surfaceAt(base, wx, Z, 5);
    addToInventory(s, ITEM.ar, 1, 1, 30);
    const shots: ShotEvent[] = [];
    for (let i = 0; i < SIM_HZ; i++) stepPlayer(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, base, { shot: (e) => shots.push(e) });
    expect(shots.length).toBe(0);
  });
});
