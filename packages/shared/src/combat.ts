import { hash2 } from './noise.js';
import { BRIDGE_Y, SOLID_CELL, boxTop, roadEdgeDist, solidKey, terrainAt, type World } from './world.js';
import { SK, type Solid } from './structures.js';

/**
 * Shooting maths shared by the server (authority) and the browser (instant tracers):
 * where a shot starts, which way each pellet goes, and what it hits.
 */

export interface Vec3 { x: number; y: number; z: number }

export const EYE_HEIGHT = 1.62;
export const SHOULDER = 0.75;
/** Where shots start: the over-the-shoulder pivot the camera looks through (see the client camera). */
export function aimOrigin(x: number, y: number, z: number, yaw: number, crouch = false): Vec3 {
  return { x: x + Math.cos(yaw) * SHOULDER, y: y + (crouch ? 1.15 : EYE_HEIGHT), z: z - Math.sin(yaw) * SHOULDER };
}
export function aimDir(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/**
 * Direction of one pellet: the aim direction pushed inside a cone of `spread` radians.
 * Random but deterministic from (seed, shot counter, pellet), so client and server agree.
 */
export function spreadDir(d: Vec3, spread: number, seed: number, shot: number, pellet: number): Vec3 {
  if (spread <= 0) return { ...d };
  const r1 = hash2(shot, pellet * 2, seed), r2 = hash2(shot, pellet * 2 + 1, seed);
  const ang = r1 * Math.PI * 2, rad = Math.sqrt(r2) * spread;
  // build a basis perpendicular to d
  let ux = -d.z, uy = 0, uz = d.x;
  let ul = Math.hypot(ux, uy, uz);
  if (ul < 1e-5) { ux = 1; uy = 0; uz = 0; ul = 1; }
  ux /= ul; uy /= ul; uz /= ul;
  const vx = d.y * uz - d.z * uy, vy = d.z * ux - d.x * uz, vz = d.x * uy - d.y * ux;
  const c = Math.cos(ang) * rad, s = Math.sin(ang) * rad;
  const ox = d.x + ux * c + vx * s, oy = d.y + uy * c + vy * s, oz = d.z + uz * c + vz * s;
  const l = Math.hypot(ox, oy, oz);
  return { x: ox / l, y: oy / l, z: oz / l };
}

// ------------------------------------------------------------------ world raycast
/** Ray vs axis-aligned box. Returns entry distance or Infinity. */
export function rayBox(o: Vec3, d: Vec3, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, maxT: number) {
  let tmin = 0, tmax = maxT;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]] as const) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return Infinity; continue; }
    let t0 = (lo - oo) / dd, t1 = (hi - oo) / dd;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tmin) tmin = t0;
    if (t1 < tmax) tmax = t1;
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

function raySolid(o: Vec3, d: Vec3, s: Solid, maxT: number) {
  const t = rayBox(o, d, s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, maxT);
  if (t === Infinity || s.k !== SK.Roof || !s.b) return t;
  // gable roofs: step through the roof volume to find the sloped surface
  const b = s.b;
  const exit = Math.min(maxT, t + Math.hypot(b.x1 - b.x0, b.roofH, b.z1 - b.z0));
  for (let q = t; q <= exit; q += 0.2) {
    const px = o.x + d.x * q, py = o.y + d.y * q, pz = o.z + d.z * q;
    if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1 && py <= boxTop(b, px, pz)) return q;
  }
  return Infinity;
}

export interface WorldHit { t: number; kind: 'terrain' | 'water' | 'building' | 'none'; solid?: Solid }

/** Visit the 16 m grid cells a ray passes over (2D DDA), nearest first. */
function forCells(o: Vec3, d: Vec3, maxT: number, fn: (key: number, tEnter: number) => boolean) {
  let cx = Math.floor(o.x / SOLID_CELL), cz = Math.floor(o.z / SOLID_CELL);
  const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1;
  const inv = (v: number) => (Math.abs(v) < 1e-9 ? Infinity : 1 / Math.abs(v));
  const dtx = SOLID_CELL * inv(d.x), dtz = SOLID_CELL * inv(d.z);
  let tx = Math.abs(d.x) < 1e-9 ? Infinity : ((d.x > 0 ? (cx + 1) * SOLID_CELL - o.x : o.x - cx * SOLID_CELL) * inv(d.x));
  let tz = Math.abs(d.z) < 1e-9 ? Infinity : ((d.z > 0 ? (cz + 1) * SOLID_CELL - o.z : o.z - cz * SOLID_CELL) * inv(d.z));
  let t = 0;
  for (let i = 0; i < 400 && t <= maxT; i++) {
    if (fn(solidKey(cx, cz), t)) return;
    if (tx < tz) { t = tx; tx += dtx; cx += sx; } else { t = tz; tz += dtz; cz += sz; }
  }
}

/** First solid thing a ray hits (terrain, water surface, buildings, trunks, rocks, props, bridge decks). */
export function raycastWorld(w: World, o: Vec3, d: Vec3, maxT: number, stopAtWater = true): WorldHit {
  let best: WorldHit = { t: maxT, kind: 'none' };
  const seen = new Set<Solid>();
  forCells(o, d, maxT, (key, tEnter) => {
    if (tEnter > best.t) return true;
    const list = w.solidGrid.get(key);
    if (list) for (const s of list) {
      if (seen.has(s)) continue;
      seen.add(s);
      const t = raySolid(o, d, s, best.t);
      if (t < best.t) best = { t, kind: 'building', solid: s };
    }
    return false;
  });
  // terrain + water: march, then refine with bisection
  const ground = (x: number, z: number) => {
    let g = terrainAt(w, x, z);
    if (stopAtWater && g < 0) g = 0;
    if (g < BRIDGE_Y && roadEdgeDist(w, x, z) < 0) g = BRIDGE_Y;
    return g;
  };
  let prev = 0;
  const step = 1.5;
  for (let s = 0; s <= best.t; s += step) {
    const px = o.x + d.x * s, py = o.y + d.y * s, pz = o.z + d.z * s;
    if (py <= ground(px, pz)) {
      let lo = prev, hi = s;
      for (let k = 0; k < 10; k++) {
        const m = (lo + hi) / 2;
        if (o.y + d.y * m <= ground(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m;
      }
      const hx = o.x + d.x * hi, hz = o.z + d.z * hi;
      if (hi < best.t) best = { t: hi, kind: stopAtWater && terrainAt(w, hx, hz) < 0 ? 'water' : 'terrain' };
      break;
    }
    prev = s;
    // big vertical rays (sky shots) can skip ahead quickly
    if (py > 260 && d.y > 0) break;
  }
  return best;
}

// ------------------------------------------------------------------ player hitboxes
export const BODY_R = 0.42, BODY_H = 1.55, HEAD_R = 0.27, HEAD_Y = 1.78;
export const KNOCKED_H = 0.75;

/** Ray vs a vertical capsule-ish body (cylinder) and a head sphere. Returns distance and whether it was the head. */
export function rayPlayer(o: Vec3, d: Vec3, px: number, py: number, pz: number, maxT: number, knocked = false): { t: number; head: boolean } | null {
  let best: { t: number; head: boolean } | null = null;
  const hy = knocked ? 0.55 : HEAD_Y;
  // head sphere (done first so a ray that hits both counts as the head only when the head is nearer)
  {
    const cx = o.x - px, cy = o.y - (py + hy), cz = o.z - pz;
    const b = cx * d.x + cy * d.y + cz * d.z, c = cx * cx + cy * cy + cz * cz - HEAD_R * HEAD_R;
    const disc = b * b - c;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t < maxT) best = { t, head: true }; }
  }
  // body cylinder
  const h = knocked ? KNOCKED_H * 0.6 : BODY_H;
  const ox = o.x - px, oz = o.z - pz;
  const a = d.x * d.x + d.z * d.z;
  if (a > 1e-9) {
    const b = ox * d.x + oz * d.z, c = ox * ox + oz * oz - BODY_R * BODY_R;
    const disc = b * b - a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / a, (-b + sq) / a]) {
        if (t < 0 || t >= maxT) continue;
        const y = o.y + d.y * t - py;
        if (y >= 0 && y <= h) { if (!best || t < best.t) best = { t, head: false }; break; }
      }
    }
  }
  return best;
}

export function lenSq(a: Vec3, b: Vec3) { return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2; }
