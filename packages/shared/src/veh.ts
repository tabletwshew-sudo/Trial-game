import { clamp } from './noise.js';
import { BRIDGE_Y, SOLID_CELL, isOpenDoor, roadEdgeDist, solidKey, solidTop, surfaceAt, terrainAt, type World } from './world.js';

/**
 * Arcade car physics. The same function moves a parked/coasting car on the server and the
 * car you are driving (predicted in your browser, confirmed by the server).
 * Heading uses the same convention as player yaw: forward = (-sin h, 0, -cos h).
 */
export interface CarBody { x: number; y: number; z: number; vy: number; vh: number; vs: number; grounded: boolean }

export const CAR = {
  maxRoad: 31, maxGrass: 24, maxReverse: 9, accel: 12, brake: 30, drag: 2.5, handbrake: 22,
  steerRate: 1.7, radius: 1.15, axle: 1.3, seats: 4, maxHp: 800,
} as const;

/** Seat positions in the car's frame: x right, y up, z forward. */
export const SEATS: [number, number, number][] = [[-0.48, 0.75, 0.35], [0.48, 0.75, 0.35], [-0.5, 1.05, -1.3], [0.5, 1.05, -1.3]];

export function seatWorld(c: { x: number; y: number; z: number; vh: number }, seat: number) {
  const [sx, sy, sz] = SEATS[seat] ?? SEATS[0];
  const s = Math.sin(c.vh), co = Math.cos(c.vh);
  return { x: c.x + co * sx - s * sz, y: c.y + sy, z: c.z - s * sx - co * sz };
}

/** Push a circle out of solids taller than a kerb. Returns the push depth (0 = no hit). */
function pushOut(w: World, p: { x: number; z: number }, y: number, r: number) {
  const list = w.solidGrid.get(solidKey(Math.floor(p.x / SOLID_CELL), Math.floor(p.z / SOLID_CELL)));
  if (!list) return 0;
  let hit = 0;
  for (const o of list) {
    if (p.x <= o.x0 - r || p.x >= o.x1 + r || p.z <= o.z0 - r || p.z >= o.z1 + r || isOpenDoor(w, o)) continue;
    if (o.y0 >= y + 1.8 || y >= solidTop(o, clamp(p.x, o.x0, o.x1), clamp(p.z, o.z0, o.z1)) - 0.8) continue;
    const cx = clamp(p.x, o.x0, o.x1), cz = clamp(p.z, o.z0, o.z1);
    let dx = p.x - cx, dz = p.z - cz;
    const d = Math.hypot(dx, dz);
    if (d > 1e-6) { if (d >= r) continue; dx /= d; dz /= d; p.x = cx + dx * r; p.z = cz + dz * r; hit = Math.max(hit, r - d); }
    else {
      const dl = p.x - (o.x0 - r), dr = o.x1 + r - p.x, dt = p.z - (o.z0 - r), db = o.z1 + r - p.z;
      const m = Math.min(dl, dr, dt, db);
      if (m === dl) p.x = o.x0 - r; else if (m === dr) p.x = o.x1 + r; else if (m === dt) p.z = o.z0 - r; else p.z = o.z1 + r;
      hit = Math.max(hit, m);
    }
  }
  return hit;
}

const groundAt = (w: World, x: number, z: number, y: number) => {
  const g = surfaceAt(w, x, z, y);
  return g < BRIDGE_Y - 0.01 && roadEdgeDist(w, x, z) < 0.5 ? Math.max(g, BRIDGE_Y) : g;
};

/** Returns impact speed if the car hit a wall this step (for damage / effects). */
export function stepCar(c: CarBody, throttle: number, steer: number, handbrake: boolean, w: World, dt: number): number {
  const onRoad = roadEdgeDist(w, c.x, c.z) < 0.5;
  const max = onRoad ? CAR.maxRoad : CAR.maxGrass;
  if (c.grounded) {
    if (throttle > 0) c.vs = c.vs < 0 ? Math.min(0, c.vs + CAR.brake * dt) : Math.min(max, c.vs + CAR.accel * throttle * dt * (1 - (c.vs / max) * 0.5));
    else if (throttle < 0) c.vs = c.vs > 0 ? Math.max(0, c.vs - CAR.brake * dt) : Math.max(-CAR.maxReverse, c.vs - CAR.accel * 0.7 * dt);
    else c.vs -= Math.sign(c.vs) * Math.min(Math.abs(c.vs), CAR.drag * dt);
    if (handbrake) c.vs -= Math.sign(c.vs) * Math.min(Math.abs(c.vs), CAR.handbrake * dt);
    if (c.vs > max) c.vs = Math.max(max, c.vs - CAR.brake * 0.5 * dt); // left the road at speed
    const grip = clamp(Math.abs(c.vs) / 6, 0, 1) * (handbrake ? 1.5 : 1);
    c.vh += steer * CAR.steerRate * grip * Math.sign(c.vs || 1) * dt * -1;
  }
  const fx = -Math.sin(c.vh), fz = -Math.cos(c.vh);
  const px = c.x, pz = c.z;
  const nx = c.x + fx * c.vs * dt, nz = c.z + fz * c.vs * dt;
  // deep water and steep cliffs stop the car
  const gNext = terrainAt(w, nx, nz);
  const deep = gNext < -1.1 && !(roadEdgeDist(w, nx, nz) < 0.5);
  const climb = groundAt(w, nx, nz, c.y + 1.2) - c.y;
  if (deep || (c.grounded && climb > 1.0)) { const hit = Math.abs(c.vs); c.vs = 0; return hit; }
  c.x = nx; c.z = nz;
  // walls: test the front and back of the car
  let impact = 0;
  for (const k of [1, -1]) {
    const p = { x: c.x + fx * CAR.axle * k, z: c.z + fz * CAR.axle * k };
    const depth = pushOut(w, p, c.y, CAR.radius);
    if (depth > 0) { c.x += p.x - (c.x + fx * CAR.axle * k); c.z += p.z - (c.z + fz * CAR.axle * k); impact = Math.max(impact, Math.abs(c.vs)); }
  }
  if (impact > 0) {
    // bounce back a little, and keep sliding along the wall rather than sticking
    const moved = (c.x - px) * fx + (c.z - pz) * fz;
    c.vs = Math.abs(moved) < Math.abs(c.vs * dt) * 0.5 ? -c.vs * 0.25 : c.vs * 0.6;
  }
  // gravity + ground following
  const g = groundAt(w, c.x, c.z, c.y + 0.6);
  if (c.grounded && c.y - g < 0.8) { c.y = g; c.vy = 0; }
  else {
    c.grounded = false;
    c.vy = Math.max(-50, c.vy - 19.6 * dt);
    c.y += c.vy * dt;
    if (c.y <= g) { c.y = g; c.vy = 0; c.grounded = true; }
  }
  return impact;
}
