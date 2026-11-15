import { DROP } from './constants.js';
import { clamp } from './noise.js';

/** The dropship's straight flight across the island. Times are server-clock milliseconds. */
export interface BusRoute {
  x0: number; z0: number; x1: number; z1: number;
  t0: number;       // departure
  t1: number;       // arrival (ship despawns)
  doorsAt: number;  // players may jump from here
  ejectAt: number;  // anyone left is dropped
}

/** A random chord through (or near) the island centre. `rnd` returns [0, 1). */
export function makeRoute(rnd: () => number, t0: number): BusRoute {
  const R = DROP.routeRadius;
  // pick a direction without trig: random unit vector by rejection
  let dx = 0, dz = 0, len = 0;
  do { dx = rnd() * 2 - 1; dz = rnd() * 2 - 1; len = Math.hypot(dx, dz); } while (len < 0.2 || len > 1);
  dx /= len; dz /= len;
  const off = (rnd() * 2 - 1) * 320; // sideways offset from centre
  const px = -dz * off, pz = dx * off;
  const halfChord = Math.sqrt(R * R - off * off);
  const x0 = px - dx * halfChord, z0 = pz - dz * halfChord, x1 = px + dx * halfChord, z1 = pz + dz * halfChord;
  const duration = ((halfChord * 2) / DROP.busSpeed) * 1000;
  return { x0, z0, x1, z1, t0, t1: t0 + duration, doorsAt: t0 + DROP.doorsOpenDelayS * 1000, ejectAt: t0 + duration - DROP.forceExitBeforeEndS * 1000 };
}

export function busPos(r: BusRoute, time: number) {
  const u = clamp((time - r.t0) / (r.t1 - r.t0), 0, 1);
  return { x: r.x0 + (r.x1 - r.x0) * u, y: DROP.busAltitude, z: r.z0 + (r.z1 - r.z0) * u, u };
}

/** Route parameter (0..1) of the point on the route closest to (x, z). */
export function routeParamNear(r: BusRoute, x: number, z: number) {
  const dx = r.x1 - r.x0, dz = r.z1 - r.z0;
  return clamp(((x - r.x0) * dx + (z - r.z0) * dz) / (dx * dx + dz * dz), 0, 1);
}
