import { describe, expect, it } from 'vitest';
import { DROP, K, MOVEMENT, PM, SIM_HZ, SPAWN_ISLAND, WATER_FLOAT_Y, busPos, collideBoxes, decodeInputs, decodeSnapshot, encodeEnt, ENT_BYTES, encodeInputs, encodeSnapshot, getWorld, makeRoute, mulberry32, newPlayerState, stepPlayer, surfaceAt, terrainAt, type InputCmd } from '../src/index';

const w = getWorld();
const run = (s: ReturnType<typeof newPlayerState>, cmd: InputCmd, seconds: number) => { for (let i = 0; i < seconds * SIM_HZ; i++) stepPlayer(s, cmd, w); };

describe('world', () => {
  it('is deterministic', () => {
    const a = terrainAt(w, 123.4, -456.7);
    expect(terrainAt(getWorld(), 123.4, -456.7)).toBe(a);
  });
  it('every location is on dry land with buildings', () => {
    for (const p of w.pois) {
      expect(terrainAt(w, p.x, p.z), p.name).toBeGreaterThan(1.5);
      expect(w.boxes.filter((b) => b.poi === p.id).length, p.name).toBeGreaterThanOrEqual(3);
    }
  });
  it('buildings never overlap and sit on land', () => {
    for (let i = 0; i < w.boxes.length; i++) {
      const a = w.boxes[i];
      expect(a.y1).toBeGreaterThan(a.fy);
      expect(terrainAt(w, (a.x0 + a.x1) / 2, (a.z0 + a.z1) / 2)).toBeGreaterThan(1);
      for (let j = i + 1; j < w.boxes.length; j++) {
        const b = w.boxes[j];
        expect(a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0).toBe(false);
      }
    }
  });
  it('warm-up island is above water and the map edge is ocean', () => {
    expect(terrainAt(w, SPAWN_ISLAND.x, SPAWN_ISLAND.z)).toBeGreaterThan(2);
    for (const [x, z] of [[-1190, 0], [1190, 0], [0, -1190], [0, 1190]]) expect(terrainAt(w, x, z)).toBeLessThan(0);
  });
});

describe('movement', () => {
  const start = () => { const s = newPlayerState(); s.x = SPAWN_ISLAND.x; s.z = SPAWN_ISLAND.z; s.y = surfaceAt(w, s.x, s.z, 50); return s; };
  it('walks forward at walk speed and sprints faster', () => {
    const a = start(); run(a, { keys: K.F, yaw: 0, pitch: 0 }, 2);
    const walked = Math.hypot(a.x - SPAWN_ISLAND.x, a.z - SPAWN_ISLAND.z);
    expect(walked).toBeGreaterThan(MOVEMENT.walkSpeed * 1.8);
    expect(walked).toBeLessThan(MOVEMENT.walkSpeed * 2.05);
    expect(a.z).toBeLessThan(SPAWN_ISLAND.z); // yaw 0 faces -Z (north)
    const b = start(); run(b, { keys: K.F | K.SPRINT, yaw: 0, pitch: 0 }, 2);
    expect(Math.hypot(b.x - SPAWN_ISLAND.x, b.z - SPAWN_ISLAND.z)).toBeGreaterThan(walked * 1.3);
  });
  it('stays glued to the ground while walking', () => {
    const s = start();
    for (let i = 0; i < 300; i++) { stepPlayer(s, { keys: K.F | K.SPRINT, yaw: 1, pitch: 0 }, w); expect(s.grounded).toBe(true); expect(s.y).toBeCloseTo(surfaceAt(w, s.x, s.z, s.y), 5); }
  });
  it('jumps once per press and lands', () => {
    const s = start(); const y0 = s.y;
    stepPlayer(s, { keys: K.JUMP, yaw: 0, pitch: 0 }, w);
    expect(s.grounded).toBe(false);
    let peak = 0;
    for (let i = 0; i < 120; i++) { stepPlayer(s, { keys: K.JUMP, yaw: 0, pitch: 0 }, w); peak = Math.max(peak, s.y - y0); }
    expect(peak).toBeGreaterThan(0.8); expect(peak).toBeLessThan(1.4);
    expect(s.grounded).toBe(true); // holding jump does not bunny-hop
  });
  it('floats in deep water', () => {
    const s = newPlayerState(); s.x = 0; s.z = 1500; s.y = WATER_FLOAT_Y; // open ocean
    run(s, { keys: K.F, yaw: 0, pitch: 0 }, 1);
    expect(s.y).toBeCloseTo(WATER_FLOAT_Y, 5);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(MOVEMENT.swimSpeed, 3);
  });
  it('cannot walk through a building but can stand on its roof', () => {
    const b = w.boxes.find((x) => x.shape === 0 && x.roof === 0)!;
    const s = newPlayerState();
    s.x = b.x0 - 3; s.z = (b.z0 + b.z1) / 2; s.y = surfaceAt(w, s.x, s.z, 500);
    run(s, { keys: K.F, yaw: -Math.PI / 2, pitch: 0 }, 3); // yaw -90deg faces +X
    expect(s.x).toBeLessThanOrEqual(b.x0 - 0.4);
    const t = newPlayerState(); t.mode = PM.Glide; t.grounded = false;
    t.x = (b.x0 + b.x1) / 2; t.z = (b.z0 + b.z1) / 2; t.y = b.y1 + 5;
    run(t, { keys: 0, yaw: 0, pitch: 0 }, 2);
    expect(t.mode).toBe(PM.Walk); expect(t.y).toBeCloseTo(b.y1, 4);
  });
  it('collideBoxes leaves players outside walls alone', () => {
    const b = w.boxes[0];
    const s = { x: b.x0 - 5, y: b.fy, z: b.z0 - 5, vx: 1, vz: 1 };
    expect(collideBoxes(w, s)).toBe(false);
  });
});

describe('drop', () => {
  it('freefall dives faster than it glides flat, auto-deploys, then lands', () => {
    const drop = (pitch: number) => {
      const s = newPlayerState(); s.mode = PM.Fall; s.grounded = false; s.x = -140; s.z = 300; s.y = DROP.busAltitude;
      let t = 0, deployedAt = -1;
      while (s.mode !== PM.Walk && t < 120 * SIM_HZ) { stepPlayer(s, { keys: K.F, yaw: 0, pitch }, w); t++; if (deployedAt < 0 && s.mode === PM.Glide) deployedAt = s.y - surfaceAt(w, s.x, s.z, Infinity); }
      return { s, seconds: t / SIM_HZ, deployedAt };
    };
    const flat = drop(0), dive = drop(-1.4);
    expect(dive.seconds).toBeLessThan(flat.seconds);
    expect(flat.s.mode).toBe(PM.Walk); expect(flat.s.grounded).toBe(true);
    expect(dive.deployedAt).toBeLessThanOrEqual(DROP.gliderAutoDeployHeight + 2);
    expect(dive.deployedAt).toBeGreaterThan(DROP.gliderAutoDeployHeight - 3);
    expect(dive.seconds).toBeGreaterThan(8); expect(flat.seconds).toBeLessThan(40);
  });
  it('space toggles the glider when high up', () => {
    const s = newPlayerState(); s.mode = PM.Fall; s.grounded = false; s.y = 320;
    stepPlayer(s, { keys: K.JUMP, yaw: 0, pitch: 0 }, w); expect(s.mode).toBe(PM.Glide);
    stepPlayer(s, { keys: 0, yaw: 0, pitch: 0 }, w);
    stepPlayer(s, { keys: K.JUMP, yaw: 0, pitch: 0 }, w); expect(s.mode).toBe(PM.Fall);
  });
  it('routes cross the island and stay on schedule', () => {
    const rnd = mulberry32(5);
    for (let i = 0; i < 50; i++) {
      const r = makeRoute(rnd, 1000);
      expect(r.doorsAt).toBeGreaterThan(r.t0); expect(r.ejectAt).toBeGreaterThan(r.doorsAt); expect(r.t1).toBeGreaterThan(r.ejectAt);
      const mid = busPos(r, (r.t0 + r.t1) / 2);
      expect(Math.hypot(mid.x, mid.z)).toBeLessThan(330);
      expect((r.t1 - r.t0) / 1000).toBeGreaterThan(50);
      const eject = busPos(r, r.ejectAt);
      expect(Math.hypot(eject.x, eject.z)).toBeLessThan(1150); // forced exit is still over (or near) the island
    }
  });
});

describe('netcode', () => {
  it('round-trips inputs and rejects garbage', () => {
    const cmds = [{ keys: 5 | K.FIRE | K.ADS, yaw: Math.fround(1.25), pitch: Math.fround(-0.5), slot: 0 }, { keys: 16, yaw: Math.fround(-3), pitch: 0, slot: 3 }];
    expect(decodeInputs(new DataView(encodeInputs(42, cmds, 1234.5)))).toEqual({ firstSeq: 42, cmds, viewTime: 1234.5 });
    expect(decodeInputs(new DataView(new ArrayBuffer(3)))).toBeNull();
    expect(decodeInputs(new DataView(encodeInputs(1, [{ keys: 0, yaw: NaN, pitch: 0 }])))).toBeNull();
    expect(decodeInputs(new DataView(encodeInputs(1, [{ keys: 0, yaw: 0, pitch: 0, slot: 9 }])))).toBeNull();
    const steep = decodeInputs(new DataView(encodeInputs(1, [{ keys: 0, yaw: 0, pitch: 9 }])))!;
    expect(steep.cmds[0].pitch).toBeLessThanOrEqual(1.55);
  });
  it('round-trips snapshots, including the full inventory', () => {
    const self = { ...newPlayerState(), x: 101.5, y: 22.25, z: -640.125, vx: 1, vy: -2, vz: 3, mode: PM.Glide, grounded: false, keys: 17 | K.ADS, hp: 73, shield: 50, slot: 2, cd: 40, burst: 2, reload: 99, use: 0, bloom: 31, shots: 123456, seed: 99, veh: 3, seat: 1, vh: 1.5, vs: -4.25, yaw: 0.5, pitch: -0.25, mv: 2, mt: 9, tx: 4.5, ty: 2.25, tz: -8, my: 0.5, mh: 1.25, air: 255, jbuf: 3, li: 12, zt: 0.5, zv: -19, scd: 44 };
    self.inv[2] = { id: 3, r: 4, n: 1, mag: 27 }; self.inv[4] = { id: 11, r: 0, n: 12, mag: 0 };
    self.ammo = [10, 999, 0, 7, 2];
    const ents = [
      { idx: 7, x: -1450.3, y: 330, z: 912.77, yaw: 4.2, pitch: -0.6, mode: PM.Fall, flags: 3, item: 5, rarity: 2, mv: 0, mt: 0 },
      { idx: 79, x: 0, y: -1.15, z: 0, yaw: 0, pitch: 0.3, mode: PM.Walk, flags: 1, item: 0, rarity: 0, mv: 2, mt: 17 },
    ];
    const block = new Uint8Array(ents.length * ENT_BYTES);
    ents.forEach((e, i) => encodeEnt(e, block, i * ENT_BYTES));
    const vehs = [{ id: 4, x: 10.5, y: 3.25, z: -20, vh: 2.0, vs: 18.33, hp: 640, driver: true }];
    const snap = decodeSnapshot(new DataView(encodeSnapshot(9, 123456.5, 77, self, block, ents.length, vehs)))!;
    expect(snap).toMatchObject({ tick: 9, time: 123456.5, ack: 77 });
    expect(snap.self).toEqual(self);
    snap.ents.forEach((e, i) => {
      expect(e).toMatchObject({ idx: ents[i].idx, mode: ents[i].mode, flags: ents[i].flags, item: ents[i].item, rarity: ents[i].rarity });
      expect(Math.abs(e.x - ents[i].x)).toBeLessThan(0.04); expect(Math.abs(e.y - ents[i].y)).toBeLessThan(0.02);
      expect(Math.abs(e.yaw - ents[i].yaw)).toBeLessThan(0.03); expect(Math.abs(e.pitch - ents[i].pitch)).toBeLessThan(0.01);
    });
    expect(snap.vehs[0]).toMatchObject({ id: 4, hp: 640, driver: true });
    expect(Math.abs(snap.vehs[0].vs - 18.33)).toBeLessThan(0.2);
    expect(decodeSnapshot(new DataView(encodeSnapshot(1, 1, 1, null, new Uint8Array(0), 0, [])))!.self).toBeNull();
  });
});
