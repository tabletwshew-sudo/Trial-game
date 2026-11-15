import { raycastWorld, type Vec3 } from './combat.js';
import type { World } from './world.js';

/**
 * Rockets fly straight and explode on contact. Grenades arc, bounce and explode
 * when their fuse runs out. Same code on the server (damage) and the client (visuals).
 */
export interface Projectile { id: number; item: number; owner: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; fuse: number; rocket: boolean; done: boolean }

export function stepProjectile(p: Projectile, w: World, dt: number): 'fly' | 'explode' {
  p.age += dt;
  if (!p.rocket) p.vy -= 19.6 * dt;
  const d: Vec3 = { x: p.vx, y: p.vy, z: p.vz };
  const sp = Math.hypot(d.x, d.y, d.z);
  if (sp > 1e-4) {
    d.x /= sp; d.y /= sp; d.z /= sp;
    const travel = sp * dt;
    const hit = raycastWorld(w, p, d, travel + 0.15, true);
    if (hit.kind !== 'none') {
      if (p.rocket) {
        const t = Math.max(0, hit.t - 0.1);
        p.x += d.x * t; p.y += d.y * t; p.z += d.z * t;
        return 'explode';
      }
      // grenade: bounce. Walls flip horizontal velocity, ground flips vertical.
      const t = Math.max(0, hit.t - 0.12);
      p.x += d.x * t; p.y += d.y * t; p.z += d.z * t;
      if (hit.kind === 'building' && Math.abs(d.y) < 0.7) { p.vx *= -0.45; p.vz *= -0.45; p.vy *= 0.6; }
      else { p.vy = Math.abs(p.vy) * 0.35; p.vx *= 0.6; p.vz *= 0.6; if (hit.kind === 'water') { p.vx *= 0.3; p.vz *= 0.3; p.vy = 0; } }
    } else { p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; }
  }
  if (p.rocket && p.age > 8) return 'explode';
  if (!p.rocket && p.age >= p.fuse) return 'explode';
  if (p.y < -30) return 'explode';
  return 'fly';
}

/** Blast damage at a distance: full in the inner 35 %, fading to 25 % at the edge. */
export function blastDamage(base: number, radius: number, dist: number) {
  if (dist >= radius) return 0;
  const k = dist / radius;
  return k < 0.35 ? base : base * (1 - ((k - 0.35) / 0.65) * 0.75);
}
