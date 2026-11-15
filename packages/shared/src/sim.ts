import { DROP, MOVEMENT } from './constants.js';
import { clamp, lerp } from './noise.js';
import { WATER_FLOAT_Y, WORLD_LIMIT, collideBoxes, surfaceAt, terrainAt, type World } from './world.js';

/**
 * Player movement simulation. The SAME code runs in the browser (prediction)
 * and on the server (authority), at a fixed 60 steps per second.
 * Phase 7 adds slide / mantle / hurdle on top of this.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const K = { F: 1, B: 2, L: 4, R: 8, JUMP: 16, SPRINT: 32, CROUCH: 64 } as const;
export const PM = { Walk: 0, Bus: 1, Fall: 2, Glide: 3 } as const;

export interface InputCmd { keys: number; yaw: number; pitch: number }
export interface PlayerState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  mode: number;
  grounded: boolean;
  /** Keys held on the previous step (for edge-triggered actions like jump). */
  keys: number;
}

export const newPlayerState = (): PlayerState => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: PM.Walk, grounded: true, keys: 0 });
export const isSwimming = (s: PlayerState, w: World) => s.mode === PM.Walk && s.y <= WATER_FLOAT_Y + 0.02 && terrainAt(w, s.x, s.z) < WATER_FLOAT_Y;

function approach2(s: PlayerState, tx: number, tz: number, maxDelta: number) {
  const dx = tx - s.vx, dz = tz - s.vz;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta) { s.vx = tx; s.vz = tz; }
  else { s.vx += (dx / len) * maxDelta; s.vz += (dz / len) * maxDelta; }
}
const approach = (v: number, t: number, d: number) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

export function stepPlayer(s: PlayerState, cmd: InputCmd, w: World): void {
  const dt = SIM_DT;
  const prev = s.keys, keys = cmd.keys;
  s.keys = keys; s.yaw = cmd.yaw; s.pitch = cmd.pitch;
  if (s.mode === PM.Bus) return;

  const jumpEdge = (keys & K.JUMP) !== 0 && (prev & K.JUMP) === 0;
  const f = (keys & K.F ? 1 : 0) - (keys & K.B ? 1 : 0), r = (keys & K.R ? 1 : 0) - (keys & K.L ? 1 : 0);
  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * f + cos * r, wz = -cos * f - sin * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) { wx /= wl; wz /= wl; }

  if (s.mode === PM.Walk) {
    const swimming = isSwimming(s, w);
    const sprint = (keys & K.SPRINT) !== 0 && f > 0;
    let speed = swimming ? (sprint ? MOVEMENT.swimSprintSpeed : MOVEMENT.swimSpeed) : sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;
    if (f < 0) speed *= 0.82;
    approach2(s, wx * speed, wz * speed, MOVEMENT.groundAccel * (s.grounded ? 1 : MOVEMENT.airControl) * dt);
    if (s.grounded && jumpEdge && !swimming) { s.vy = MOVEMENT.jumpVelocity; s.grounded = false; }
    if (!s.grounded) s.vy = Math.max(s.vy - MOVEMENT.gravity * dt, -60);
    s.x += s.vx * dt; s.z += s.vz * dt;
    collideBoxes(w, s);
    if (s.grounded) {
      const g = surfaceAt(w, s.x, s.z, s.y);
      if (g >= s.y - 0.7) s.y = g;
      else { s.grounded = false; s.vy = 0; }
    } else {
      s.y += s.vy * dt;
      const g = surfaceAt(w, s.x, s.z, s.y);
      if (s.vy <= 0 && s.y <= g) { s.y = g; s.vy = 0; s.grounded = true; }
    }
  } else {
    const height = s.y - surfaceAt(w, s.x, s.z, Infinity);
    if (s.mode === PM.Fall) { if (height < DROP.gliderAutoDeployHeight || jumpEdge) s.mode = PM.Glide; }
    else if (jumpEdge && height > DROP.gliderAutoDeployHeight + 20) s.mode = PM.Fall;

    if (s.mode === PM.Fall) {
      const dive = clamp((-cmd.pitch - 0.2) / 0.9, 0, 1);
      const hs = lerp(DROP.freefallHorizontalSpeed, DROP.freefallDiveHorizontalSpeed, dive);
      approach2(s, wx * hs, wz * hs, 28 * dt);
      s.vy = approach(s.vy, -lerp(DROP.freefallMinSpeed, DROP.freefallMaxSpeed, dive), 50 * dt);
    } else {
      const hs = DROP.gliderSpeed * (f > 0 ? 1 : f < 0 ? 0.45 : 0.75);
      approach2(s, wx * hs, wz * hs, 14 * dt);
      s.vy = approach(s.vy, -DROP.gliderSink, 160 * dt);
    }
    s.x += s.vx * dt; s.z += s.vz * dt;
    collideBoxes(w, s);
    s.y += s.vy * dt;
    const g = surfaceAt(w, s.x, s.z, s.y);
    if (s.y <= g) {
      s.y = g; s.vy = 0; s.grounded = true; s.mode = PM.Walk;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > MOVEMENT.sprintSpeed) { s.vx *= MOVEMENT.sprintSpeed / sp; s.vz *= MOVEMENT.sprintSpeed / sp; }
    }
  }
  s.x = clamp(s.x, -WORLD_LIMIT, WORLD_LIMIT);
  s.z = clamp(s.z, -WORLD_LIMIT, WORLD_LIMIT);
}
