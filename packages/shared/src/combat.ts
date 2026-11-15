import { hash2 } from './noise.js';
import { BRIDGE_Y, boxTop, roadEdgeDist, terrainAt, type Box, type World } from './world.js';

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
const BOX_CELL = 32;
const gridKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

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

function rayBuilding(o: Vec3, d: Vec3, b: Box, maxT: number) {
  // body
  let t = rayBox(o, d, b.x0, b.y0, b.z0, b.x1, b.y1, b.z1, maxT);
  if (b.roofH > 0) {
    // gable roof: march the roof volume coarsely (roofs are small)
    const tr = rayBox(o, d, b.x0, b.y1, b.z0, b.x1, b.y1 + b.roofH, b.z1, maxT);
    if (tr < t) {
      const exit = Math.min(maxT, tr + Math.hypot(b.x1 - b.x0, b.roofH, b.z1 - b.z0));
      for (let s = tr; s <= exit; s += 0.25) {
        const px = o.x + d.x * s, py = o.y + d.y * s, pz = o.z + d.z * s;
        if (px >= b.x0 && px <= b.x1 && pz >= b.z0 && pz <= b.z1 && py <= boxTop(b, px, pz)) { t = Math.min(t, s); break; }
      }
    }
  }
  return t;
}

export interface WorldHit { t: number; kind: 'terrain' | 'water' | 'building' | 'none'; box?: Box }

/** First solid thing a ray hits (terrain, water surface, buildings, bridge decks). */
export function raycastWorld(w: World, o: Vec3, d: Vec3, maxT: number, stopAtWater = true): WorldHit {
  let best: WorldHit = { t: maxT, kind: 'none' };
  // buildings: walk the 32 m grid cells the ray passes through
  const seen = new Set<Box>();
  const steps = Math.ceil(maxT / (BOX_CELL / 2));
  let lastKey = NaN;
  for (let i = 0; i <= steps; i++) {
    const s = Math.min(maxT, i * (BOX_CELL / 2));
    if (s > best.t) break;
    const px = o.x + d.x * s, pz = o.z + d.z * s;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const key = gridKey(Math.floor(px / BOX_CELL) + dx, Math.floor(pz / BOX_CELL) + dz);
      if (key === lastKey) continue;
      const list = w.boxGrid.get(key);
      if (!list) continue;
      for (const b of list) {
        if (seen.has(b)) continue;
        seen.add(b);
        const t = rayBuilding(o, d, b, best.t);
        if (t < best.t) best = { t, kind: 'building', box: b };
      }
    }
  }
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
