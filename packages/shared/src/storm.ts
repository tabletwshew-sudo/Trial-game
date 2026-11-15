import { STORM_PHASES, type StormPhase } from './constants.js';
import { mulberry32 } from './noise.js';
import { terrainAt, type World } from './world.js';

/**
 * The storm: a circle that waits, then shrinks to the next circle, phase after phase.
 * The server picks every circle at the start of play and sends the whole plan, so
 * clients can draw it and count down without further messages.
 */
export interface Circle { x: number; z: number; r: number }
export interface StormPlan { t0: number; circles: Circle[]; phases: StormPhase[] }
export interface StormState {
  /** Current safe circle. */
  x: number; z: number; r: number;
  /** Where it's heading next. */
  next: Circle;
  /** Phase index (0-based) and whether the wall is moving right now. */
  phase: number;
  shrinking: boolean;
  /** Server time when the current wait/shrink ends. */
  until: number;
  /** Damage per second outside the circle. */
  dps: number;
  done: boolean;
}

export const ISLAND_HALF = 1200;
export const STORM_START_RADIUS = 1300;

export function makeStormPlan(w: World, seed: number, t0: number, phases = STORM_PHASES): StormPlan {
  const rnd = mulberry32(seed >>> 0);
  const circles: Circle[] = [{ x: 0, z: 0, r: STORM_START_RADIUS }];
  for (let i = 0; i < phases.length; i++) {
    const prev = circles[circles.length - 1];
    const r = phases[i].radiusFrac * ISLAND_HALF;
    const room = Math.max(0, prev.r - r);
    let best: Circle | null = null;
    // late circles (and the final moving circles) should end on land, not over the sea
    for (let k = 0; k < 40; k++) {
      let ux = 0, uz = 0;
      do { ux = rnd() * 2 - 1; uz = rnd() * 2 - 1; } while (ux * ux + uz * uz > 1);
      const pull = i === 0 ? 0.55 : 0.92; // the first circle stays fairly central
      const c = { x: prev.x + ux * room * pull, z: prev.z + uz * room * pull, r };
      if (terrainAt(w, c.x, c.z) > 2 || k === 39) { best = c; break; }
    }
    circles.push(best!);
  }
  return { t0, circles, phases };
}

/** Phase timings: [waitStart, shrinkStart, shrinkEnd] for each phase. */
function timeline(plan: StormPlan) {
  const out: [number, number, number][] = [];
  let t = plan.t0;
  for (const p of plan.phases) {
    const ws = t, ss = ws + p.waitS * 1000, se = ss + p.shrinkS * 1000;
    out.push([ws, ss, se]);
    t = se;
  }
  return out;
}

export function stormAt(plan: StormPlan, t: number): StormState {
  const tl = timeline(plan);
  const C = plan.circles;
  for (let i = 0; i < tl.length; i++) {
    const [ws, ss, se] = tl[i];
    if (t < ws) break;
    if (t > se) continue;
    const prev = C[i], next = C[i + 1];
    const dps = plan.phases[i].dps;
    if (t < ss) return { ...prev, next, phase: i, shrinking: false, until: ss, dps, done: false };
    const k = (t - ss) / (se - ss);
    return { x: prev.x + (next.x - prev.x) * k, z: prev.z + (next.z - prev.z) * k, r: prev.r + (next.r - prev.r) * k, next, phase: i, shrinking: true, until: se, dps, done: false };
  }
  const last = C[C.length - 1], first = C[0];
  if (t < plan.t0) return { ...first, next: C[1] ?? first, phase: 0, shrinking: false, until: plan.t0, dps: plan.phases[0].dps, done: false };
  return { ...last, next: last, phase: plan.phases.length - 1, shrinking: false, until: Infinity, dps: plan.phases[plan.phases.length - 1].dps, done: true };
}

export const inStorm = (s: StormState, x: number, z: number) => (x - s.x) ** 2 + (z - s.z) ** 2 > s.r * s.r;
