import { MOVEMENT } from './constants.js';
import { PLAYER_HEIGHT, PLAYER_RADIUS, SOLID_CELL, STEP_UP, isOpenDoor, solidKey, solidTop, surfaceAt, terrainAt, type World } from './world.js';

/** Movement sub-states (on top of the player mode). */
export const MV = { None: 0, Slide: 1, Mantle: 2, Hurdle: 3, Climb: 4, Launch: 5 } as const;
export const MANTLE_TICKS = 22, HURDLE_TICKS = 24;

/** Is a vertical column (a player-sized box) free of solids and above the terrain? */
export function clearColumn(w: World, x: number, z: number, y0: number, y1: number, r = 0.3): boolean {
  if (terrainAt(w, x, z) > y0 + 0.15) return false;
  const list = w.solidGrid.get(solidKey(Math.floor(x / SOLID_CELL), Math.floor(z / SOLID_CELL)));
  if (!list) return true;
  for (const o of list) {
    if (x + r <= o.x0 || x - r >= o.x1 || z + r <= o.z0 || z - r >= o.z1 || isOpenDoor(w, o)) continue;
    const top = solidTop(o, Math.min(Math.max(x, o.x0), o.x1), Math.min(Math.max(z, o.z0), o.z1));
    if (top > y0 && o.y0 < y1) return false;
  }
  return true;
}

export interface Ledge { hurdle: boolean; x: number; y: number; z: number; /** top of what you're going over */ top: number }

/**
 * Something in front of you to climb onto (mantle) or vault over (hurdle)?
 * (dx, dz) is the direction you're moving, normalised. `vault` = you pressed jump, so a low,
 * thin obstacle (fence, railing, sandbags) is vaulted instead of climbed onto.
 */
export function findLedge(w: World, s: { x: number; y: number; z: number }, dx: number, dz: number, inWater: boolean, vault: boolean): Ledge | null {
  const maxH = inWater ? MOVEMENT.mantleWaterHeight : MOVEMENT.mantleMaxHeight;
  const qy = s.y + maxH - STEP_UP;
  // the first thing in the way, scanning out from your body
  let probe = -1, top = 0;
  const reach = PLAYER_RADIUS + (vault ? 1.25 : 0.7);
  for (let d = PLAYER_RADIUS + 0.08; d <= reach; d += 0.12) {
    const t = surfaceAt(w, s.x + dx * d, s.z + dz * d, qy);
    if (t - s.y > STEP_UP + 0.05) { probe = d; top = t; break; }
    // a wall too tall to climb: nothing to do
    if (!clearColumn(w, s.x + dx * d, s.z + dz * d, s.y + STEP_UP, s.y + maxH, 0.05)) return null;
  }
  if (probe < 0) return null;
  const rise = top - s.y;
  if (rise > maxH) return null;
  const px = s.x + dx * probe, pz = s.z + dz * probe;
  // head room above where we are now, all the way up to standing on the ledge
  if (!clearColumn(w, s.x, s.z, s.y + PLAYER_HEIGHT, top + PLAYER_HEIGHT, 0.25)) return null;
  // how deep is it? (a thin fence vs a crate you can stand on)
  let depth = 0;
  while (depth < 1.2 && surfaceAt(w, px + dx * (depth + 0.1), pz + dz * (depth + 0.1), top + 0.1) > top - 0.3) depth += 0.1;
  if (depth < 0.75 && rise <= MOVEMENT.hurdleMaxHeight + 0.05 && !inWater) {
    if (!vault) return null;
    // room to pass over it (not a window too small to dive through)
    if (!clearColumn(w, px + dx * depth * 0.5, pz + dz * depth * 0.5, top + 0.05, top + 1.5, 0.2)) return null;
    // land on the far side, about where we'd be if we hopped it
    const far = probe + depth + 0.1 + PLAYER_RADIUS + 0.2;
    const fx = s.x + dx * far, fz = s.z + dz * far;
    const fy = surfaceAt(w, fx, fz, top + 0.1);
    if (fy > top - 0.3 || Math.abs(fy - s.y) > 1.2) return null;
    if (!clearColumn(w, fx, fz, fy + 0.05, fy + PLAYER_HEIGHT, PLAYER_RADIUS * 0.8)) return null;
    return { hurdle: true, x: fx, y: fy, z: fz, top };
  }
  // climb on top, a little way in from the edge
  for (const inset of [0.5, 0.3, 0.15]) {
    if (inset > depth + 0.05) continue;
    const tx = px + dx * inset, tz = pz + dz * inset;
    const ty = surfaceAt(w, tx, tz, top + 0.05);
    if (Math.abs(ty - top) > 0.25) continue;
    if (clearColumn(w, tx, tz, ty + 0.05, ty + PLAYER_HEIGHT, PLAYER_RADIUS * 0.75)) return { hurdle: false, x: tx, y: ty, z: tz, top };
  }
  return null;
}

/** A ladder you're standing at and facing (index into w.ladders), or -1. */
export function ladderAt(w: World, s: { x: number; y: number; z: number }, fx: number, fz: number): number {
  for (let i = 0; i < w.ladders.length; i++) {
    const L = w.ladders[i];
    // distance out from the wall, and sideways along it
    const dx = s.x - L.x, dz = s.z - L.z;
    const out = dx * L.nx + dz * L.nz, side = Math.abs(dx * L.nz - dz * L.nx);
    if (out > 0.8 || out < -0.5 || side > 0.95) continue;
    if (s.y < L.y0 - 0.4 || s.y > L.y1 - 0.6) continue;
    if (fx * -L.nx + fz * -L.nz < 0.55) continue; // must be facing the wall
    return i;
  }
  return -1;
}

export function padAt(w: World, s: { x: number; y: number; z: number }): boolean {
  for (const p of w.pads) if (Math.abs(p.x - s.x) < 1.1 && Math.abs(p.z - s.z) < 1.1 && Math.abs(p.y - s.y) < 0.35) return true;
  return false;
}

/** Closest zipline you could grab from here: [index, param 0..1] or null. */
export function zipNear(w: World, x: number, y: number, z: number): [number, number] | null {
  let best: [number, number] | null = null, bd = 3.2;
  w.zips.forEach((Z, i) => {
    const vx = Z.bx - Z.ax, vz = Z.bz - Z.az, l2 = vx * vx + vz * vz;
    const t = Math.max(0, Math.min(1, ((x - Z.ax) * vx + (z - Z.az) * vz) / l2));
    const cx = Z.ax + vx * t, cz = Z.az + vz * t, cy = Z.ay + (Z.by - Z.ay) * t;
    const d = Math.hypot(cx - x, cz - z);
    if (d < bd && y > cy - 4.5 && y < cy - 0.5) { bd = d; best = [i, Math.max(0.01, Math.min(0.99, t))]; }
  });
  return best;
}
