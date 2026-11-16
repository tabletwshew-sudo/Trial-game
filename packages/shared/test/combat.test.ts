import { describe, expect, it } from 'vitest';
import {
  ACT, CAR, ITEM, ITEMS, K, PM, SIM_HZ, SK, SPAWN_ISLAND, addToInventory, aimDir, aimOrigin, shotOrigin, applyDamage, blastDamage, falloff, getWorld, newPlayerState,
  rayPlayer, raycastWorld, spreadDir, stepCar, stepPlayer, surfaceAt, weaponDef, type InputCmd, type ShotEvent,
} from '../src/index';

const w = getWorld();
const fresh = () => { const s = newPlayerState(); s.x = SPAWN_ISLAND.x; s.z = SPAWN_ISLAND.z; s.y = surfaceAt(w, s.x, s.z, 50); return s; };
const run = (s: ReturnType<typeof newPlayerState>, cmd: InputCmd, ticks: number, shots?: ShotEvent[]) => {
  for (let i = 0; i < ticks; i++) stepPlayer(s, cmd, w, { shot: (e) => shots?.push(e) });
};

describe('weapons', () => {
  it('an AR fires at its fire rate while held and runs out, then auto-reloads', () => {
    const s = fresh(); addToInventory(s, ITEM.ar, 2, 1, 30); s.ammo[1] = 60;
    const shots: ShotEvent[] = [];
    run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, SIM_HZ, shots); // 1 second
    const def = weaponDef(ITEM.ar)!;
    expect(shots.length).toBe(Math.ceil(SIM_HZ / def.interval));
    run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, SIM_HZ * 8, shots);
    expect(shots.length).toBeGreaterThan(30); // reloaded and kept going
    expect(s.ammo[1]).toBeLessThan(60);
  });
  it('a pump needs a fresh click per shot and fires 9 pellets', () => {
    const s = fresh(); addToInventory(s, ITEM.pump, 0, 1, 5);
    const shots: ShotEvent[] = [];
    run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, 200, shots);
    expect(shots.length).toBe(1);
    expect(shots[0].dirs.length).toBe(9);
  });
  it('burst ARs fire three rounds per click', () => {
    const s = fresh(); addToInventory(s, ITEM.burst, 1, 1, 30);
    const shots: ShotEvent[] = [];
    stepPlayer(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, w, { shot: (e) => shots.push(e) });
    run(s, { keys: 0, yaw: 0, pitch: 0 }, 20, shots);
    expect(shots.length).toBe(3);
    expect(s.inv[0].mag).toBe(27);
  });
  it('R reloads a partly-empty mag from reserve ammo; switching slots cancels', () => {
    const s = fresh(); addToInventory(s, ITEM.smg, 0, 1, 10); s.ammo[0] = 100;
    addToInventory(s, ITEM.pistol, 0, 1, 16);
    stepPlayer(s, { keys: K.RELOAD, yaw: 0, pitch: 0 }, w);
    expect(s.reload).toBeGreaterThan(0);
    stepPlayer(s, { keys: 0, yaw: 0, pitch: 0, slot: 2 }, w);
    expect(s.reload).toBe(0); expect(s.slot).toBe(1);
    stepPlayer(s, { keys: 0, yaw: 0, pitch: 0, slot: 1 }, w);
    stepPlayer(s, { keys: K.RELOAD, yaw: 0, pitch: 0 }, w);
    run(s, { keys: 0, yaw: 0, pitch: 0 }, SIM_HZ * 3);
    expect(s.inv[0].mag).toBe(30); expect(s.ammo[0]).toBe(80);
  });
  it('shotguns load one shell at a time', () => {
    const s = fresh(); addToInventory(s, ITEM.pump, 0, 1, 0); s.ammo[3] = 3;
    run(s, { keys: 0, yaw: 0, pitch: 0 }, SIM_HZ * 5);
    expect(s.inv[0].mag).toBe(3); expect(s.ammo[3]).toBe(0);
  });
  it('spread is deterministic and stays inside the cone', () => {
    const d = aimDir(0.3, -0.1);
    const a = spreadDir(d, 0.05, 7, 100, 3), b = spreadDir(d, 0.05, 7, 100, 3), c = spreadDir(d, 0.05, 7, 101, 3);
    expect(a).toEqual(b); expect(a).not.toEqual(c);
    for (let i = 0; i < 200; i++) {
      const p = spreadDir(d, 0.05, 1, i, 0);
      expect(Math.acos(Math.min(1, p.x * d.x + p.y * d.y + p.z * d.z))).toBeLessThanOrEqual(0.0501);
    }
  });
  it('damage falls off with range', () => {
    const def = weaponDef(ITEM.pump)!;
    expect(falloff(def, 2)).toBe(1);
    expect(falloff(def, 50)).toBe(def.falloffMin);
    expect(blastDamage(100, 5, 0)).toBe(100); expect(blastDamage(100, 5, 5.1)).toBe(0);
  });
  it('every item definition is sane', () => {
    for (const d of ITEMS) {
      if (!d || d.kind !== 'weapon') continue;
      expect(d.mag).toBeGreaterThan(0); expect(d.interval).toBeGreaterThan(0); expect(d.range).toBeGreaterThan(d.falloffStart);
      if (d.burst > 1) expect(d.interval).toBeGreaterThan(d.burstGap * (d.burst - 1));
      expect(d.mag).toBeLessThan(256);
    }
  });
});

describe('health, shields, items', () => {
  it('damage hits shields before health', () => {
    const s = fresh(); s.hp = 100; s.shield = 30;
    expect(applyDamage(s, 50)).toEqual([30, 20]);
    expect(s.shield).toBe(0); expect(s.hp).toBe(80);
  });
  it('shield sips stop at 50; jugs go to 100; bandages stop at 75 health', () => {
    const s = fresh(); s.hp = 40;
    addToInventory(s, ITEM.shieldSip, 0, 3, 0);
    for (let i = 0; i < 3; i++) run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, 2.2 * SIM_HZ);
    expect(s.shield).toBe(50); expect(s.inv[0].n).toBe(1); // third one refused: already at the cap
    addToInventory(s, ITEM.bandage, 0, 5, 0);
    stepPlayer(s, { keys: 0, yaw: 0, pitch: 0, slot: 2 }, w); run(s, { keys: 0, yaw: 0, pitch: 0 }, 20);
    for (let i = 0; i < 5; i++) run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, 3.7 * SIM_HZ);
    expect(s.hp).toBe(75);
  });
  it('consumables and grenades stack; weapons need a free slot', () => {
    const s = fresh();
    expect(addToInventory(s, ITEM.bandage, 0, 10, 0)).toBe(10);
    expect(addToInventory(s, ITEM.bandage, 0, 10, 0)).toBe(10); // 15 + 5 in a new slot
    expect(s.inv.filter((x) => x.id === ITEM.bandage).length).toBe(2);
    for (let i = 0; i < 3; i++) expect(addToInventory(s, ITEM.ar, 0, 1, 30)).toBe(1);
    expect(addToInventory(s, ITEM.smg, 0, 1, 30)).toBe(0);
    expect(addToInventory(s, ITEM.ammoMedium, 0, 5000, 0)).toBe(999);
  });
  it('knocked players crawl and cannot shoot', () => {
    const s = fresh(); addToInventory(s, ITEM.ar, 0, 1, 30); s.mode = PM.Knocked; s.knock = 100;
    const shots: ShotEvent[] = [];
    const x0 = s.x, z0 = s.z;
    run(s, { keys: K.F | K.SPRINT | K.FIRE, yaw: 0, pitch: 0 }, SIM_HZ, shots);
    expect(shots.length).toBe(0);
    expect(Math.hypot(s.x - x0, s.z - z0)).toBeLessThan(1.9);
  });
  it('reviving freezes you in place', () => {
    const s = fresh(); s.act = ACT.Reviving;
    const x0 = s.x;
    run(s, { keys: K.R, yaw: 0, pitch: 0 }, 30);
    expect(s.x).toBe(x0);
  });
  it('falling off a big height hurts, a short hop does not', () => {
    const s = fresh(); s.y += 30; s.grounded = false; s.vy = 0;
    run(s, { keys: 0, yaw: 0, pitch: 0 }, 4 * SIM_HZ);
    expect(s.hp).toBeLessThan(100); expect(s.hp).toBeGreaterThan(0);
    const t = fresh();
    run(t, { keys: K.JUMP, yaw: 0, pitch: 0 }, 2 * SIM_HZ);
    expect(t.hp).toBe(100);
  });
});

/**
 * An outside wall (outside facing +x) at least 7 m long, standing on the ground floor, with a
 * spot just inside it: standing there facing north puts your right shoulder against the wall.
 */
export function shoulderToWall() {
  for (const o of w.solids) {
    if (o.k !== SK.Wall || o.inner || o.face !== 1 || !o.b || o.z1 - o.z0 < 7 || o.y0 > o.b.fy + 0.05 || o.y1 < o.b.fy + 2.6) continue;
    const x = o.x0 - 0.42, z = o.z1 - 1.2; // touching the wall (player radius)
    const y = surfaceAt(w, x, z, o.b.fy + 1);
    if (Math.abs(y - o.b.fy) > 0.3) continue;
    // somewhere open outside, ahead and to the right, on the ground
    const tx = o.x1 + 1.2, tz = z - 5;
    const ty = surfaceAt(w, tx, tz, o.b.fy + 3);
    if (Math.abs(ty - o.b.fy) > 1.2 || raycastWorld(w, { x: tx, y: ty + 1, z: tz }, { x: 0, y: 1, z: 0 }, 6).kind !== 'none') continue;
    return { wall: o, x, y, z, tx, ty, tz };
  }
  throw new Error('no suitable wall');
}

describe('shots and walls', () => {
  it('a shoulder pressed against a wall does not put the shot on the other side', () => {
    const c = shoulderToWall();
    const raw = aimOrigin(c.x, c.y, c.z, 0), safe = shotOrigin(w, c.x, c.y, c.z, 0);
    expect(raw.x).toBeGreaterThan(c.wall.x0);          // the old start point was in or past the wall
    expect(safe.x).toBeLessThan(c.wall.x0);            // the new one stays on your side
    // aiming at someone outside: the wall stops it from the safe origin
    const toT = (o: { x: number; y: number; z: number }) => { const d = { x: c.tx - o.x, y: c.ty + 1.2 - o.y, z: c.tz - o.z }; const l = Math.hypot(d.x, d.y, d.z); return { d: { x: d.x / l, y: d.y / l, z: d.z / l }, l }; };
    const a = toT(safe);
    expect(raycastWorld(w, safe, a.d, a.l).kind).toBe('building');
  });
  it('shots fired in the open start at the shoulder as before', () => {
    const s = fresh();
    const raw = aimOrigin(s.x, s.y, s.z, 1.1), safe = shotOrigin(w, s.x, s.y, s.z, 1.1);
    expect(safe.x).toBeCloseTo(raw.x, 6); expect(safe.z).toBeCloseTo(raw.z, 6);
  });
  it('a player firing with their shoulder on a wall emits the shot from their side of it', () => {
    const c = shoulderToWall();
    const s = newPlayerState(); s.x = c.x; s.y = c.y; s.z = c.z; s.yaw = 0;
    addToInventory(s, ITEM.ar, 0, 1, 30); s.ammo[1] = 30;
    const shots: ShotEvent[] = [];
    run(s, { keys: K.FIRE, yaw: 0, pitch: 0 }, 2, shots);
    expect(shots.length).toBe(1);
    expect(shots[0].origin.x).toBeLessThan(c.wall.x0);
  });
});

describe('raycasts', () => {
  it('hits a player body and head, misses beside them', () => {
    const o = { x: 0, y: 1.6, z: 10 };
    const toward = (y: number) => { const d = { x: 0, y: y - 1.6, z: -10 }; const l = Math.hypot(d.y, d.z); return { x: 0, y: d.y / l, z: d.z / l }; };
    expect(rayPlayer(o, toward(1.0), 0, 0, 0, 100)?.head).toBe(false);
    expect(rayPlayer(o, toward(1.8), 0, 0, 0, 100)?.head).toBe(true);
    expect(rayPlayer({ x: 2, y: 1.6, z: 10 }, { x: 0, y: 0, z: -1 }, 0, 0, 0, 100)).toBeNull();
  });
  it('buildings and the ground stop bullets', () => {
    const b = w.boxes.find((x) => x.shape === 0)!;
    const o = { x: b.x0 - 10, y: b.fy + 1.5, z: (b.z0 + b.z1) / 2 };
    const hit = raycastWorld(w, o, { x: 1, y: 0, z: 0 }, 100);
    expect(hit.kind).toBe('building'); expect(hit.t).toBeCloseTo(10, 1);
    const g = raycastWorld(w, { x: SPAWN_ISLAND.x, y: 50, z: SPAWN_ISLAND.z }, { x: 0, y: -1, z: 0 }, 100);
    expect(g.kind).toBe('terrain'); expect(50 - g.t).toBeCloseTo(surfaceAt(w, SPAWN_ISLAND.x, SPAWN_ISLAND.z, 50), 0);
  });
});

describe('cars', () => {
  const road = w.roads.find((r) => !r.street)!;
  it('accelerates along a road, steers, and brakes', () => {
    const c = { x: road.pts[40], y: 0, z: road.pts[41], vy: 0, vh: 0, vs: 0, grounded: true };
    c.y = surfaceAt(w, c.x, c.z, 100);
    for (let i = 0; i < SIM_HZ * 3; i++) stepCar(c, 1, 0, false, w, 1 / SIM_HZ);
    expect(c.vs).toBeGreaterThan(15);
    const h0 = c.vh;
    for (let i = 0; i < SIM_HZ; i++) stepCar(c, 1, 1, false, w, 1 / SIM_HZ);
    expect(c.vh).toBeLessThan(h0); // right = clockwise
    for (let i = 0; i < SIM_HZ * 3; i++) stepCar(c, -1, 0, false, w, 1 / SIM_HZ);
    expect(c.vs).toBeLessThanOrEqual(0);
    expect(c.vs).toBeGreaterThanOrEqual(-CAR.maxReverse);
  });
  it('cannot drive through a building', () => {
    const b = w.boxes.find((x) => x.shape === 0 && x.x1 - x.x0 > 8)!;
    const c = { x: b.x0 - 8, y: 0, z: (b.z0 + b.z1) / 2, vy: 0, vh: -Math.PI / 2, vs: 25, grounded: true };
    c.y = surfaceAt(w, c.x, c.z, 100);
    for (let i = 0; i < SIM_HZ * 2; i++) stepCar(c, 1, 0, false, w, 1 / SIM_HZ);
    expect(c.x).toBeLessThan(b.x0);
  });
  it('drivers are predicted with the same code', () => {
    const s = fresh(); s.mode = PM.Drive; s.vh = 0;
    run(s, { keys: K.F, yaw: 0, pitch: 0 }, SIM_HZ);
    expect(s.vs).toBeGreaterThan(5); expect(s.z).toBeLessThan(SPAWN_ISLAND.z);
  });
});

describe('emotes', () => {
  it('B starts an emote, pressing again cycles, moving cancels it', () => {
    const s = fresh();
    stepPlayer(s, { keys: K.EMOTE, yaw: 0, pitch: 0 }, w);
    expect(s.emote).toBe(1);
    stepPlayer(s, { keys: 0, yaw: 0, pitch: 0 }, w);
    stepPlayer(s, { keys: K.EMOTE, yaw: 0, pitch: 0 }, w);
    expect(s.emote).toBe(2);
    stepPlayer(s, { keys: K.F, yaw: 0, pitch: 0 }, w);
    expect(s.emote).toBe(0);
  });
});
