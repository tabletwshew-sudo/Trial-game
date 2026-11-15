import { K, PM, SPAWN_ISLAND, routeParamNear, type BusRoute, type InputCmd, type PlayerState, type World } from '@dropzone/shared';

/**
 * Phase 3 bot brain: wander the warm-up island, pick a drop spot, jump,
 * dive and glide to it, then roam the area. Combat and looting arrive in Phases 4-6.
 */
export interface BotBrain {
  rnd: () => number;
  target: { x: number; z: number };
  /** Roster index of a human teammate to stick with, or -1. */
  follow: number;
  jumpAt: number;
  wander: { x: number; z: number } | null;
  wanderUntil: number;
  idleUntil: number;
  sprint: boolean;
  offset: { x: number; z: number };
}

export function newBrain(rnd: () => number): BotBrain {
  return {
    rnd, target: { x: SPAWN_ISLAND.x, z: SPAWN_ISLAND.z }, follow: -1, jumpAt: Infinity,
    wander: null, wanderUntil: 0, idleUntil: 0, sprint: false,
    offset: { x: (rnd() - 0.5) * 16, z: (rnd() - 0.5) * 16 },
  };
}

/** Choose when to leave the ship so the glide ends near the target. */
export function planDrop(b: BotBrain, route: BusRoute, target: { x: number; z: number }) {
  b.target = target;
  const span = route.t1 - route.t0;
  const uMin = (route.doorsAt - route.t0) / span + 0.01, uMax = (route.ejectAt - route.t0) / span;
  const u = Math.min(uMax, Math.max(uMin, routeParamNear(route, target.x, target.z)));
  b.jumpAt = route.t0 + u * span + b.rnd() * 1800;
}

const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export function botInput(s: PlayerState, b: BotBrain, now: number, w: World, home: { x: number; z: number }, roam: number): InputCmd {
  const cmd: InputCmd = { keys: 0, yaw: s.yaw, pitch: 0 };
  if (s.mode === PM.Bus) return cmd;

  if (s.mode === PM.Fall || s.mode === PM.Glide) {
    const dx = home.x + b.offset.x - s.x, dz = home.z + b.offset.z - s.z;
    const d = Math.hypot(dx, dz);
    cmd.yaw = yawTo(dx, dz);
    if (d > 3) cmd.keys |= K.F;
    // dive when nearly above the target, otherwise stay flat to cover distance
    cmd.pitch = s.mode === PM.Fall && d < Math.max(30, s.y * 0.45) ? -1.3 : -0.1;
    return cmd;
  }

  // on foot
  if (now < b.idleUntil) return cmd;
  if (!b.wander || now > b.wanderUntil) {
    let ux = 0, uz = 0;
    do { ux = b.rnd() * 2 - 1; uz = b.rnd() * 2 - 1; } while (ux * ux + uz * uz > 1);
    b.wander = { x: home.x + ux * roam, z: home.z + uz * roam };
    b.wanderUntil = now + 4000 + b.rnd() * 6000;
    b.sprint = b.rnd() < 0.35 || Math.hypot(home.x - s.x, home.z - s.z) > roam * 1.5;
  }
  const dx = b.wander.x - s.x, dz = b.wander.z - s.z;
  if (Math.hypot(dx, dz) < 1.5) {
    b.wander = null;
    b.idleUntil = now + 400 + b.rnd() * 2600;
    return cmd;
  }
  cmd.yaw = yawTo(dx, dz);
  cmd.keys |= K.F;
  if (b.sprint) cmd.keys |= K.SPRINT;
  if (s.grounded && b.rnd() < 0.006) cmd.keys |= K.JUMP;
  return cmd;
}
