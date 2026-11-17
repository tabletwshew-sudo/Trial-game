import { DROP, MOVEMENT } from './constants.js';
import { aimDir, shotOrigin, spreadDir, type Vec3 } from './combat.js';
import { AMMO_MAX, ITEM, ITEMS, PICK_SLOT, RARITY_RELOAD_MUL, consumableDef, meleeDef, throwableDef, weaponDef, type WeaponDef } from './items.js';
import { clamp, lerp } from './noise.js';
import { HURDLE_TICKS, MANTLE_TICKS, MV, ROLL_TICKS, clearColumn, findLedge, ladderAt, padAt, zipNear } from './move.js';
import { stepCar } from './veh.js';
import { PLAYER_RADIUS, WATER_FLOAT_Y, WORLD_LIMIT, collideBoxes, surfaceAt, terrainAt, type World } from './world.js';

/**
 * Player simulation. The SAME code runs in the browser (prediction) and on the
 * server (authority), at a fixed 60 steps per second. Timers are whole ticks so both
 * sides stay bit-for-bit identical.
 */
export const SIM_HZ = 60;
export const SIM_DT = 1 / SIM_HZ;

export const K = {
  F: 1, B: 2, L: 4, R: 8, JUMP: 16, SPRINT: 32, CROUCH: 64,
  FIRE: 128, ADS: 256, RELOAD: 512, USE: 1024, EMOTE: 2048,
} as const;
export const PM = { Walk: 0, Bus: 1, Fall: 2, Glide: 3, Drive: 4, Ride: 5, Knocked: 6, Dead: 7, Zip: 8 } as const;
/** Server-controlled "busy" states that freeze the player. */
export const ACT = { None: 0, Reviving: 1 } as const;

export interface InputCmd { keys: number; yaw: number; pitch: number; /** 0 = keep, 1..5 = select slot, 6 = pickaxe */ slot?: number }
export interface Slot { id: number; r: number; n: number; mag: number }
export const emptySlot = (): Slot => ({ id: 0, r: 0, n: 0, mag: 0 });

export interface PlayerState {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  mode: number;
  grounded: boolean;
  /** Keys held on the previous step (for edge-triggered actions like jump). */
  keys: number;
  hp: number; shield: number;
  /** Overshield: an extra layer (up to 50) on top of your shield that refills itself out of combat. */
  os: number;
  /** Gold carried (spent at merchants). */
  gold: number;
  /** Bleed-out health while knocked. */
  knock: number;
  slot: number;
  inv: Slot[];
  ammo: number[];
  /** Ticks until the weapon can fire again. */
  cd: number;
  /** Shots still to come in the current burst. */
  burst: number;
  /** Ticks left on a reload / consumable use (0 = not reloading / using). */
  reload: number;
  use: number;
  /** Extra spread from sustained fire, in milliradians. */
  bloom: number;
  /** Shot counter: seeds the spread pattern so client and server agree. */
  shots: number;
  /** Fixed per-player spread seed. */
  seed: number;
  act: number;
  /** Vehicle you are in (-1 = none), your seat, and the car's heading/speed while you drive. */
  veh: number; seat: number; vh: number; vs: number;
  /** Emote playing (0 = none, 1..3). Stops when you move, jump or shoot. */
  emote: number;
  /** Movement sub-state (MV: slide, mantle, hurdle, climb, launch) and its tick counter. */
  mv: number; mt: number;
  /** Mantle/hurdle: where you end up, where you started (height) and how high the hop arcs. */
  tx: number; ty: number; tz: number; my: number; mh: number;
  /** Ticks since you left the ground without jumping (coyote time; 255 after a jump) and a buffered jump. */
  air: number; jbuf: number;
  /** Ladder or zipline index, position along the zipline (0..1) and signed speed along it (m/s). */
  li: number; zt: number; zv: number;
  /** Cooldown before another slide gives a speed boost. */
  scd: number;
  /** Wall kicks used since you last stood on something. */
  wk: number;
}

export const newPlayerState = (): PlayerState => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: PM.Walk, grounded: true, keys: 0,
  hp: 100, shield: 0, os: 0, gold: 0, knock: 0, slot: 0, inv: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()], ammo: [0, 0, 0, 0, 0],
  cd: 0, burst: 0, reload: 0, use: 0, bloom: 0, shots: 0, seed: 1, act: ACT.None, veh: -1, seat: 0, vh: 0, vs: 0, emote: 0,
  mv: 0, mt: 0, tx: 0, ty: 0, tz: 0, my: 0, mh: 0, air: 0, jbuf: 0, li: -1, zt: 0, zv: 0, scd: 0, wk: 0,
});

/** Clear any slide/mantle/climb/zipline state (after a teleport or respawn). */
export function resetMove(s: PlayerState) {
  s.mv = MV.None; s.mt = 0; s.li = -1; s.air = 0; s.jbuf = 0; s.zt = 0; s.zv = 0; s.scd = 0; s.wk = 0;
}

export function clonePlayerState(s: PlayerState): PlayerState {
  return { ...s, inv: s.inv.map((x) => ({ ...x })), ammo: [...s.ammo] };
}

export const isSwimming = (s: PlayerState, w: World) =>
  (s.mode === PM.Walk || s.mode === PM.Knocked) && s.mv !== MV.Climb && s.y <= WATER_FLOAT_Y + 0.02 && terrainAt(w, s.x, s.z) < WATER_FLOAT_Y;
/** Crouched or sliding: smaller hitbox, lower eyes. */
export const isLow = (s: PlayerState) => s.mode === PM.Walk && (s.mv === MV.Slide || s.mv === MV.Roll || ((s.keys & K.CROUCH) !== 0 && s.mv === MV.None && s.grounded));
/** Hands busy (climbing, mantling, swimming): can't shoot, reload or heal. */
const handsBusy = (s: PlayerState, swimming: boolean) => swimming || s.mv === MV.Mantle || s.mv === MV.Climb || s.mv === MV.Roll;

/** Things that happened during a step that the server (hits) or client (effects) cares about. */
export interface ShotEvent { origin: Vec3; dirs: Vec3[]; weapon: number; rarity: number }
export interface ThrowEvent { origin: Vec3; vel: Vec3; item: number }
/** A pickaxe swing: where it starts and which way it goes (the server finds what it hits). */
export interface SwingEvent { origin: Vec3; dir: Vec3 }
export interface SimEvents {
  shot?(e: ShotEvent): void;
  thrown?(e: ThrowEvent): void;
  swing?(e: SwingEvent): void;
  fallDamage?(dmg: number): void;
  used?(item: number): void;
  reloaded?(): void;
  /** Movement moments for effects and sounds: a roll landing, a wall kick. */
  rolled?(): void;
  kicked?(): void;
}

function approach2(s: PlayerState, tx: number, tz: number, maxDelta: number) {
  const dx = tx - s.vx, dz = tz - s.vz;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta) { s.vx = tx; s.vz = tz; }
  else { s.vx += (dx / len) * maxDelta; s.vz += (dz / len) * maxDelta; }
}
const approach = (v: number, t: number, d: number) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

/** Overshield: how much you get, how long without damage before it refills, and how fast. */
export const OVERSHIELD = { max: 50, delayMs: 6000, perSecond: 20 } as const;
export const KNOCKED_SPEED = 1.7;
export const USE_WALK_SPEED = 2.4;

/** Current spread in radians for the held weapon. */
export function currentSpread(s: PlayerState, def: WeaponDef) {
  const ads = (s.keys & K.ADS) !== 0;
  let base = ads ? def.spreadAds : def.spreadHip;
  const moving = Math.hypot(s.vx, s.vz) > 0.5;
  if (moving && !ads) base *= 1.45;
  if ((!s.grounded && s.mode === PM.Walk) || s.mode === PM.Zip) base *= 2;
  if (s.mv === MV.Slide) base *= 1.25;
  if (s.keys & K.CROUCH && !moving) base *= 0.8;
  return base + s.bloom / 1000;
}

export const heldWeapon = (s: PlayerState) => weaponDef(s.inv[s.slot]?.id ?? 0);
/** Item id in your hands (the pickaxe when its slot is selected). */
export const heldItemId = (s: PlayerState) => (s.slot === PICK_SLOT ? ITEM.pickaxe : s.inv[s.slot]?.id ?? 0);
export const canShoot = (s: PlayerState) => (s.mode === PM.Walk || s.mode === PM.Ride || s.mode === PM.Zip) && s.act === ACT.None;

function canConsume(s: PlayerState, id: number) {
  const d = consumableDef(id);
  if (!d) return false;
  return (d.heal > 0 && s.hp < d.healCap) || (d.shield > 0 && s.shield < d.shieldCap);
}

function startReload(s: PlayerState, def: WeaponDef) {
  const slot = s.inv[s.slot];
  if (s.reload > 0 || slot.mag >= def.mag || s.ammo[def.ammo] <= 0) return;
  s.reload = Math.round((def.perShell ?? def.reload) * RARITY_RELOAD_MUL[slot.r] * SIM_HZ);
  s.burst = 0;
}

function finishReload(s: PlayerState, def: WeaponDef, ev?: SimEvents) {
  const slot = s.inv[s.slot];
  const need = def.perShell ? 1 : def.mag - slot.mag;
  const take = Math.min(need, s.ammo[def.ammo]);
  slot.mag += take; s.ammo[def.ammo] -= take;
  s.reload = 0;
  // shotguns load shell by shell until full
  if (def.perShell && slot.mag < def.mag && s.ammo[def.ammo] > 0) startReload(s, def);
  else ev?.reloaded?.();
}

function fireOnce(s: PlayerState, def: WeaponDef, w: World, ev?: SimEvents) {
  const slot = s.inv[s.slot];
  slot.mag--;
  const origin = shotOrigin(w, s.x, s.y, s.z, s.yaw, isLow(s));
  const d = aimDir(s.yaw, s.pitch);
  const spread = currentSpread(s, def);
  const dirs: Vec3[] = [];
  // shotguns: the first pellet (index 0) is kept tighter, like a choke
  for (let p = 0; p < def.pellets; p++) dirs.push(spreadDir(d, p === 0 && def.pellets > 1 ? spread * 0.35 : spread, s.seed, s.shots, p));
  s.shots = (s.shots + 1) >>> 0;
  s.bloom = Math.min(Math.round(def.bloomMax * 1000), s.bloom + Math.round(def.bloomShot * 1000));
  ev?.shot?.({ origin, dirs, weapon: slot.id, rarity: slot.r });
}

function stepCombat(s: PlayerState, cmd: InputCmd, prevKeys: number, w: World, ev?: SimEvents, busy = false) {
  const keys = cmd.keys;
  const fireEdge = (keys & K.FIRE) !== 0 && (prevKeys & K.FIRE) === 0;
  const fireHeld = (keys & K.FIRE) !== 0;

  // slot switching cancels reloads and item use, with a short equip delay
  if (cmd.slot && cmd.slot >= 1 && cmd.slot <= PICK_SLOT + 1 && cmd.slot - 1 !== s.slot) {
    s.slot = cmd.slot - 1;
    s.reload = 0; s.use = 0; s.burst = 0;
    s.cd = Math.max(s.cd, 14);
  }
  // nothing in the selected slot (used your last heal, dropped it): out comes the pickaxe
  if (s.slot !== PICK_SLOT && !s.inv[s.slot]?.id) { s.slot = PICK_SLOT; s.reload = 0; s.use = 0; s.burst = 0; }
  if (s.cd > 0) s.cd--;
  if (s.slot === PICK_SLOT) {
    if (s.bloom > 0) s.bloom = Math.max(0, s.bloom - Math.round(100 / SIM_HZ));
    const md = meleeDef(ITEM.pickaxe)!;
    if (canShoot(s) && !busy && s.mode === PM.Walk && fireHeld && s.cd === 0) {
      ev?.swing?.({ origin: shotOrigin(w, s.x, s.y, s.z, s.yaw, isLow(s)), dir: aimDir(s.yaw, s.pitch) });
      s.cd = md.interval;
      s.shots = (s.shots + 1) >>> 0;
    }
    return;
  }
  const slot = s.inv[s.slot];
  const def = weaponDef(slot.id);
  if (s.bloom > 0) s.bloom = Math.max(0, s.bloom - Math.round(((def?.bloomRecover ?? 0.1) * 1000) / SIM_HZ));
  if (!canShoot(s) || busy) { s.reload = 0; s.use = 0; s.burst = 0; return; }

  if (def) {
    if (s.reload > 0) {
      // shotguns can fire mid-reload if they have a shell loaded
      if (def.perShell && slot.mag > 0 && fireEdge && s.cd === 0) s.reload = 0;
      else if (--s.reload === 0) finishReload(s, def, ev);
    }
    if (s.reload === 0) {
      if (s.burst > 0 && s.cd === 0 && slot.mag > 0) {
        fireOnce(s, def, w, ev);
        s.burst--;
        s.cd = s.burst > 0 ? def.burstGap : def.interval - (def.burst - 1) * def.burstGap;
      } else if ((def.auto ? fireHeld : fireEdge) && s.cd === 0) {
        if (slot.mag > 0) {
          fireOnce(s, def, w, ev);
          s.burst = def.burst - 1;
          s.cd = s.burst > 0 ? def.burstGap : def.interval;
        } else startReload(s, def);
      }
      if (slot.mag === 0 && s.cd === 0 && s.burst === 0) startReload(s, def);
      if ((keys & K.RELOAD) && !(prevKeys & K.RELOAD)) startReload(s, def);
    }
    return;
  }

  const cdef = consumableDef(slot.id);
  if (cdef) {
    if (s.use > 0) {
      if (--s.use === 0) {
        if (cdef.heal) s.hp = Math.max(s.hp, Math.min(cdef.healCap, s.hp + cdef.heal));
        if (cdef.shield) s.shield = Math.max(s.shield, Math.min(cdef.shieldCap, s.shield + cdef.shield));
        ev?.used?.(slot.id);
        if (--slot.n <= 0) s.inv[s.slot] = emptySlot();
      }
    } else if (fireHeld && s.cd === 0 && canConsume(s, slot.id)) s.use = Math.round(cdef.use * SIM_HZ);
    return;
  }

  const tdef = throwableDef(slot.id);
  if (tdef && fireEdge && s.cd === 0 && (s.mode === PM.Walk || s.mode === PM.Zip)) {
    const d = aimDir(s.yaw, s.pitch + 0.12);
    const o = shotOrigin(w, s.x, s.y, s.z, s.yaw);
    ev?.thrown?.({ origin: o, vel: { x: d.x * tdef.speed + s.vx, y: d.y * tdef.speed + 2, z: d.z * tdef.speed + s.vz }, item: slot.id });
    s.cd = 30;
    if (--slot.n <= 0) s.inv[s.slot] = emptySlot();
  }
}

export function stepPlayer(s: PlayerState, cmd: InputCmd, w: World, ev?: SimEvents): void {
  const dt = SIM_DT;
  const prev = s.keys, keys = cmd.keys;
  s.keys = keys; s.yaw = cmd.yaw; s.pitch = cmd.pitch;
  if (s.mode === PM.Bus || s.mode === PM.Dead) return;
  if (s.mode !== PM.Walk) s.emote = 0;

  const jumpEdge = (keys & K.JUMP) !== 0 && (prev & K.JUMP) === 0;
  const f = (keys & K.F ? 1 : 0) - (keys & K.B ? 1 : 0), r = (keys & K.R ? 1 : 0) - (keys & K.L ? 1 : 0);

  if (s.mode === PM.Drive || s.mode === PM.Ride) s.mv = MV.None;
  if (s.mode === PM.Drive) {
    stepCar(s, f, r, (keys & K.JUMP) !== 0, w, dt);
    s.vx = -Math.sin(s.vh) * s.vs; s.vz = -Math.cos(s.vh) * s.vs;
    s.x = clamp(s.x, -WORLD_LIMIT, WORLD_LIMIT); s.z = clamp(s.z, -WORLD_LIMIT, WORLD_LIMIT);
    stepCombat(s, cmd, prev, w, ev);
    return;
  }
  if (s.mode === PM.Ride) { s.vx = s.vz = s.vy = 0; stepCombat(s, cmd, prev, w, ev); return; }

  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * f + cos * r, wz = -cos * f - sin * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) { wx /= wl; wz /= wl; }

  if (s.mode === PM.Zip) { stepZip(s, cmd, prev, jumpEdge, w, ev); return; }
  if (s.mode === PM.Walk || s.mode === PM.Knocked) {
    stepGround(s, cmd, prev, f, r, wx, wz, jumpEdge, w, ev);
  } else {
    const height = s.y - surfaceAt(w, s.x, s.z, Infinity);
    s.mv = MV.None;
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
      s.y = g; s.vy = 0; s.grounded = true; s.mode = PM.Walk; s.air = 0;
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > MOVEMENT.sprintSpeed) { s.vx *= MOVEMENT.sprintSpeed / sp; s.vz *= MOVEMENT.sprintSpeed / sp; }
    }
    if (s.cd > 0) s.cd--;
  }
  s.x = clamp(s.x, -WORLD_LIMIT, WORLD_LIMIT);
  s.z = clamp(s.z, -WORLD_LIMIT, WORLD_LIMIT);
}

/** Standing, walking, sprinting, crouching, sliding, jumping, swimming, mantling, hurdling, climbing. */
function stepGround(s: PlayerState, cmd: InputCmd, prev: number, f: number, r: number, wx: number, wz: number, jumpEdge: boolean, w: World, ev?: SimEvents) {
  const dt = SIM_DT, keys = cmd.keys;
  const knocked = s.mode === PM.Knocked;
  const frozen = s.act !== ACT.None;
  if (knocked || frozen) { if (s.mv !== MV.Climb || knocked) s.mv = MV.None; }
  if (s.scd > 0) s.scd--;
  if (s.mv === MV.None && s.mt > 0) s.mt--; // (after a zipline: no auto re-grab for a moment)
  if (jumpEdge) s.jbuf = MOVEMENT.jumpBufferTicks; else if (s.jbuf > 0) s.jbuf--;
  const fwdX = -Math.sin(s.yaw), fwdZ = -Math.cos(s.yaw);

  // ---------------------------------------------------------------- mantle / hurdle (scripted, no collisions)
  if (s.mv === MV.Mantle || s.mv === MV.Hurdle) {
    const total = s.mv === MV.Mantle ? MANTLE_TICKS : HURDLE_TICKS;
    s.mt--;
    if (s.mv === MV.Mantle) {
      // pull up first, then step forward onto the ledge
      const H = Math.round(total * 0.4);
      if (s.mt >= H) {
        const k = 1 - (s.mt - H) / (total - H);
        s.y = s.my + (s.ty - s.my) * (k * k * (3 - 2 * k));
        s.x += (s.tx - s.x) * 0.04; s.z += (s.tz - s.z) * 0.04;
      } else { s.y = s.ty; s.x += (s.tx - s.x) / (s.mt + 1); s.z += (s.tz - s.z) / (s.mt + 1); }
    } else {
      const k = 1 - s.mt / total;
      s.x += (s.tx - s.x) / (s.mt + 1); s.z += (s.tz - s.z) / (s.mt + 1);
      s.y = s.my + (s.ty - s.my) * k + 4 * s.mh * k * (1 - k);
    }
    if (s.mt <= 0) {
      s.x = s.tx; s.y = s.ty; s.z = s.tz; s.grounded = true; s.vy = 0; s.air = 0;
      if (s.mv === MV.Mantle) { s.vx = fwdX * 2.5; s.vz = fwdZ * 2.5; }
      s.mv = MV.None;
    }
    stepCombat(s, cmd, prev, w, ev, s.mv === MV.Mantle);
    return;
  }

  // ---------------------------------------------------------------- ladders
  if (s.mv === MV.Climb) {
    const L = w.ladders[s.li];
    if (!L || knocked) { s.mv = MV.None; s.li = -1; }
    else {
      s.x = L.x; s.z = L.z; s.vx = s.vz = 0;
      s.vy = frozen ? 0 : f * MOVEMENT.climbSpeed;
      s.y += s.vy * dt;
      s.grounded = false; s.air = 0;
      if (jumpEdge || (keys & K.CROUCH)) {
        // let go, pushing off the wall
        s.mv = MV.None; s.li = -1; s.vx = L.nx * 3.2; s.vz = L.nz * 3.2; s.vy = jumpEdge ? 4.5 : 0; s.air = 255; s.jbuf = 0;
      } else if (s.y >= L.y1 - 0.05) {
        // over the top
        s.mv = MV.Mantle; s.mt = 14; s.my = s.y = L.y1 - 0.05;
        s.tx = L.tx; s.tz = L.tz; s.ty = surfaceAt(w, L.tx, L.tz, L.y1 + 0.6);
      } else if (s.y <= L.y0) { s.y = L.y0; s.grounded = true; s.vy = 0; s.mv = MV.None; s.li = -1; }
      stepCombat(s, cmd, prev, w, ev, true);
      return;
    }
  }

  const swimming = isSwimming(s, w);
  const using = s.use > 0;
  const usingSlow = using && !(consumableDef(s.inv[s.slot]?.id ?? 0)?.walk ?? true);
  const ads = (keys & K.ADS) !== 0 && !swimming && !knocked;
  const firing = (keys & K.FIRE) !== 0 && heldWeapon(s) !== null && !swimming;
  const sprint = (keys & K.SPRINT) !== 0 && f > 0 && !ads && !firing && !using && !knocked;
  const crouchHeld = (keys & K.CROUCH) !== 0 && !swimming && !knocked;
  const hs = Math.hypot(s.vx, s.vz);
  const canAct = !knocked && !frozen && !using;

  // grab a ladder you walk into, a zipline you press E under (or jump into)
  if (canAct && f > 0) {
    const li = ladderAt(w, s, fwdX, fwdZ);
    if (li >= 0) { s.mv = MV.Climb; s.li = li; s.emote = 0; s.vx = s.vz = 0; s.vy = 0; stepCombat(s, cmd, prev, w, ev, true); return; }
  }
  if (canAct && w.zips.length && (((keys & K.USE) && !(prev & K.USE)) || (!s.grounded && s.air > 4 && s.mt === 0))) {
    const z = zipNear(w, s.x, s.y, s.z);
    if (z && (s.grounded ? true : zipHandsNear(w, s, z[0], z[1]))) { startZip(s, w, z[0], z[1]); return; }
  }

  // ---------------------------------------------------------------- mantle / hurdle triggers
  const wantJump = s.jbuf > 0;
  const coyote = !s.grounded && s.air < MOVEMENT.coyoteTicks;
  // (after a wall kick, no climbing until you land: a kick can't take you up a full-height wall)
  if (canAct && f > 0 && (wantJump || (!s.grounded && s.vy < 3) || swimming) && s.wk === 0) {
    const ml = Math.hypot(wx, wz) > 0.1;
    const dx = ml ? wx : fwdX, dz = ml ? wz : fwdZ;
    const ledge = findLedge(w, s, dx, dz, swimming, wantJump && !swimming);
    if (ledge) {
      s.mv = ledge.hurdle ? MV.Hurdle : MV.Mantle;
      s.mt = ledge.hurdle ? HURDLE_TICKS : MANTLE_TICKS;
      s.tx = ledge.x; s.ty = ledge.y; s.tz = ledge.z; s.my = s.y;
      s.mh = ledge.hurdle ? Math.max(0.4, ledge.top - Math.min(s.y, ledge.y) + 0.3) : 0;
      s.grounded = false; s.vy = 0; s.jbuf = 0; s.air = 255; s.emote = 0;
      if (ledge.hurdle) { const v = Math.max(hs, MOVEMENT.sprintSpeed); s.vx = dx * v; s.vz = dz * v; }
      else { s.vx = s.vz = 0; }
      stepCombat(s, cmd, prev, w, ev, !ledge.hurdle);
      return;
    }
  }

  // ---------------------------------------------------------------- wall kick
  // in the air with a wall right in front of you: jump kicks off it, up and away (once per jump)
  if (!s.grounded && !coyote && jumpEdge && canAct && !swimming && s.wk === 0 && s.mv === MV.None && s.air > 3) {
    const ml = Math.hypot(wx, wz) > 0.1;
    const dx = ml ? wx : fwdX, dz = ml ? wz : fwdZ;
    const reach = PLAYER_RADIUS + MOVEMENT.wallKickReach;
    if (!clearColumn(w, s.x + dx * reach, s.z + dz * reach, s.y + 0.5, s.y + 1.6, 0.05)) {
      const into = s.vx * dx + s.vz * dz;
      if (into > 0) { s.vx -= dx * into * 2; s.vz -= dz * into * 2; } // bounce off it
      s.vx -= dx * MOVEMENT.wallKickPush; s.vz -= dz * MOVEMENT.wallKickPush;
      s.vy = MOVEMENT.wallKickUp; s.wk = 1; s.jbuf = 0; s.air = 255; s.emote = 0;
      ev?.kicked?.();
    }
  }

  // ---------------------------------------------------------------- slide
  if (s.mv === MV.Slide && (!crouchHeld || !s.grounded || swimming || knocked)) s.mv = MV.None;
  if (s.mv === MV.None && s.grounded && crouchHeld && canAct && hs >= MOVEMENT.slideMinEntrySpeed) {
    s.mv = MV.Slide; s.emote = 0;
    if (s.scd === 0) { const b = Math.min(hs + MOVEMENT.slideBoost, MOVEMENT.slideMaxSpeed) / hs; s.vx *= b; s.vz *= b; s.scd = 90; }
  }

  let speed: number = swimming ? (sprint ? MOVEMENT.swimSprintSpeed : MOVEMENT.swimSpeed) : sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;
  if (crouchHeld) speed = MOVEMENT.crouchSpeed;
  if (ads) speed *= MOVEMENT.adsSpeedMul;
  if (using) speed = Math.min(speed, usingSlow ? 0 : USE_WALK_SPEED);
  if (knocked) speed = KNOCKED_SPEED;
  if (frozen) speed = 0;
  if (f < 0) speed *= 0.82;

  if (s.mv === MV.Roll) {
    // tucked roll: carried forward at rolling speed, a little steering
    const cur = Math.hypot(s.vx, s.vz);
    let sp = Math.max(cur, MOVEMENT.rollSpeed * (0.6 + 0.4 * (s.mt / ROLL_TICKS)));
    let ux = cur > 1e-3 ? s.vx / cur : fwdX, uz = cur > 1e-3 ? s.vz / cur : fwdZ;
    if (Math.hypot(wx, wz) > 0.1) {
      const cross = ux * wz - uz * wx, dot = ux * wx + uz * wz;
      const turn = Math.max(-1.2 * dt, Math.min(1.2 * dt, Math.atan2(cross, dot)));
      const c = Math.cos(turn), sn = Math.sin(turn);
      [ux, uz] = [ux * c - uz * sn, ux * sn + uz * c];
    }
    sp = Math.min(sp, MOVEMENT.rollSpeed);
    s.vx = ux * sp; s.vz = uz * sp;
    if (--s.mt <= 0) { s.mv = MV.None; s.mt = 0; }
  } else if (s.mv === MV.Slide) {
    // momentum: friction, gravity down slopes, gentle steering
    let sp = Math.hypot(s.vx, s.vz);
    let ux = sp > 1e-3 ? s.vx / sp : fwdX, uz = sp > 1e-3 ? s.vz / sp : fwdZ;
    const e = 0.5, y = s.y + 0.5;
    const gx = (surfaceAt(w, s.x + e, s.z, y) - surfaceAt(w, s.x - e, s.z, y)) / (2 * e);
    const gz = (surfaceAt(w, s.x, s.z + e, y) - surfaceAt(w, s.x, s.z - e, y)) / (2 * e);
    const downhill = -(gx * ux + gz * uz); // > 0 going downhill
    const slope = Math.max(-0.8, Math.min(0.8, downhill));
    sp += (slope * MOVEMENT.slideSlopeAccel - MOVEMENT.slideFriction) * dt;
    sp = Math.min(sp, MOVEMENT.slideMaxSpeed);
    if (Math.hypot(wx, wz) > 0.1) {
      const cross = ux * wz - uz * wx, dot = ux * wx + uz * wz;
      const want = Math.atan2(cross, dot), turn = Math.max(-MOVEMENT.slideSteer * dt, Math.min(MOVEMENT.slideSteer * dt, want));
      const c = Math.cos(turn), sn = Math.sin(turn);
      [ux, uz] = [ux * c - uz * sn, ux * sn + uz * c];
    }
    if (sp < MOVEMENT.slideExitSpeed) { s.mv = MV.None; sp = Math.max(sp, 0); }
    s.vx = ux * sp; s.vz = uz * sp;
  } else if (s.grounded || swimming) {
    approach2(s, wx * speed, wz * speed, MOVEMENT.groundAccel * dt);
  } else {
    // in the air: steer, but keep momentum from slides, pads and hurdles (bleeds off slowly)
    const keep = Math.max(speed, hs - 1.2 * dt);
    const has = Math.hypot(wx, wz) > 0.1;
    const tx = has ? wx * keep : hs > speed ? (s.vx / hs) * keep : 0, tz = has ? wz * keep : hs > speed ? (s.vz / hs) * keep : 0;
    approach2(s, tx, tz, MOVEMENT.groundAccel * MOVEMENT.airControl * dt);
  }

  // ---------------------------------------------------------------- jump (with coyote time and a buffer)
  if ((s.grounded || coyote) && wantJump && !swimming && canAct) {
    s.vy = MOVEMENT.jumpVelocity; s.grounded = false; s.air = 255; s.jbuf = 0;
    if (s.mv === MV.Slide) {
      // slide-jump keeps your speed (up to a cap)
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > MOVEMENT.slideJumpMax) { s.vx *= MOVEMENT.slideJumpMax / sp; s.vz *= MOVEMENT.slideJumpMax / sp; }
    }
    s.mv = MV.None;
  }
  // spring pads
  if (s.grounded && w.pads.length && !knocked && padAt(w, s)) {
    s.vy = MOVEMENT.padLaunch; s.grounded = false; s.mv = MV.Launch; s.air = 255; s.jbuf = 0; s.emote = 0;
  }

  if (!s.grounded) s.vy = Math.max(s.vy - MOVEMENT.gravity * dt, -60);
  s.x += s.vx * dt; s.z += s.vz * dt;
  collideBoxes(w, s);
  if (s.grounded) {
    const g = surfaceAt(w, s.x, s.z, s.y);
    // sliding sticks to the ground over small dips; walking steps down 0.7 m
    if (g >= s.y - (s.mv === MV.Slide || s.mv === MV.Roll ? 0.9 : 0.7)) { s.y = g; s.wk = 0; }
    else { s.grounded = false; s.vy = 0; s.air = 0; }
  } else {
    if (s.air < 255) s.air++;
    s.y += s.vy * dt;
    const g = surfaceAt(w, s.x, s.z, s.y);
    if (s.mv === MV.Launch && s.vy < 0 && s.y - g > 4) {
      // launched: the glider opens on the way down
      s.mode = PM.Glide; s.mv = MV.None;
    } else if (s.vy <= 0 && s.y <= g) {
      // fall damage, from the speed you hit the ground at (health only, like the storm).
      // Coming down from a height while moving, you roll out of it and take far less.
      const height = (s.vy * s.vy) / (2 * MOVEMENT.gravity);
      const rolls = height >= MOVEMENT.rollMinHeight && Math.hypot(s.vx, s.vz) > 3 && !crouchHeld && canAct && g > WATER_FLOAT_Y + 0.01 && s.mv !== MV.Launch;
      const felt = height - (rolls ? MOVEMENT.rollSave : 0);
      if (felt > MOVEMENT.fallDamageMinHeight && g > WATER_FLOAT_Y + 0.01) {
        const dmg = Math.round((felt - MOVEMENT.fallDamageMinHeight) * MOVEMENT.fallDamagePerMetre);
        s.hp = Math.max(0, s.hp - dmg);
        ev?.fallDamage?.(dmg);
      }
      s.y = g; s.vy = 0; s.grounded = true; s.air = 0; s.wk = 0;
      if (s.mv === MV.Launch) s.mv = MV.None;
      if (rolls) { s.mv = MV.Roll; s.mt = ROLL_TICKS; s.emote = 0; ev?.rolled?.(); }
      // land with crouch held and speed: straight into a slide
      if (crouchHeld && Math.hypot(s.vx, s.vz) >= MOVEMENT.slideMinEntrySpeed && canAct) s.mv = MV.Slide;
      // buffered jump fires on landing
      if (s.jbuf > 0 && canAct && !isSwimming(s, w)) { s.vy = MOVEMENT.jumpVelocity; s.grounded = false; s.air = 255; s.jbuf = 0; s.mv = MV.None; }
    }
  }
  if (!knocked) stepCombat(s, cmd, prev, w, ev, handsBusy(s, swimming));
  // emotes: B cycles through three; any movement, jump, shot or aim cancels
  if ((keys & K.EMOTE) && !(prev & K.EMOTE) && s.grounded && !knocked && !swimming && s.act === ACT.None && s.mv === MV.None) s.emote = (s.emote % 3) + 1;
  if (s.emote && (f !== 0 || r !== 0 || (keys & (K.FIRE | K.ADS | K.JUMP)) || !s.grounded || knocked || swimming)) s.emote = 0;
}

/** Are your hands close enough to the cable to grab it mid-air? */
function zipHandsNear(w: World, s: PlayerState, i: number, t: number) {
  const Z = w.zips[i];
  const cy = Z.ay + (Z.by - Z.ay) * t;
  return Math.abs(cy - ZIP_HANG - s.y) < 1.1;
}

/** How far below the cable your feet hang. */
export const ZIP_HANG = 2.05;

function startZip(s: PlayerState, w: World, i: number, t: number) {
  const Z = w.zips[i];
  const ux = (Z.bx - Z.ax) / Z.len, uz = (Z.bz - Z.az) / Z.len;
  // ride the way you're looking (or already moving)
  const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
  const dir = fx * ux + fz * uz >= 0 ? 1 : -1;
  const carry = (s.vx * ux + s.vz * uz) * dir;
  s.mode = PM.Zip; s.mv = MV.None; s.li = i; s.zt = t; s.zv = dir * Math.max(4, Math.min(carry, MOVEMENT.zipSpeed));
  s.vx = s.vz = s.vy = 0; s.grounded = false; s.emote = 0; s.jbuf = 0;
  placeOnZip(s, w);
}

function placeOnZip(s: PlayerState, w: World) {
  const Z = w.zips[s.li];
  s.x = Z.ax + (Z.bx - Z.ax) * s.zt; s.z = Z.az + (Z.bz - Z.az) * s.zt;
  s.y = Z.ay + (Z.by - Z.ay) * s.zt - ZIP_HANG;
}

/** Hanging from a zipline: it pulls you along the way you face; jump or crouch to let go. */
function stepZip(s: PlayerState, cmd: InputCmd, prev: number, jumpEdge: boolean, w: World, ev?: SimEvents) {
  const dt = SIM_DT, Z = w.zips[s.li];
  const detach = (vy: number) => {
    s.mode = PM.Walk; s.li = -1; s.grounded = false; s.air = 255; s.vy = vy; s.mv = MV.None; s.mt = 50;
    s.vx = s.zv * (Z ? (Z.bx - Z.ax) / Z.len : 0); s.vz = s.zv * (Z ? (Z.bz - Z.az) / Z.len : 0);
  };
  if (!Z) { detach(0); return; }
  const ux = (Z.bx - Z.ax) / Z.len, uz = (Z.bz - Z.az) / Z.len;
  const fx = -Math.sin(cmd.yaw), fz = -Math.cos(cmd.yaw);
  const look = fx * ux + fz * uz;
  // turn around by looking back along the line
  let want = Math.abs(look) > 0.3 ? Math.sign(look) * MOVEMENT.zipSpeed : Math.sign(s.zv || 1) * MOVEMENT.zipSpeed;
  // the trolley brakes over the last few metres, so riding off the end drops you gently
  const left = (want > 0 ? 1 - s.zt : s.zt) * Z.len;
  if (left < 9) want = Math.sign(want) * Math.max(4, left * 1.6);
  s.zv = approach(s.zv, want, (Math.abs(want) < Math.abs(s.zv) && left < 9 ? 40 : 22) * dt);
  s.zt += (s.zv * dt) / Z.len;
  const prevY = s.y;
  if (s.zt <= 0 || s.zt >= 1) { s.zt = Math.max(0, Math.min(1, s.zt)); placeOnZip(s, w); detach(3); stepCombat(s, cmd, prev, w, ev); return; }
  placeOnZip(s, w);
  s.vy = (s.y - prevY) / dt;
  stepCombat(s, cmd, prev, w, ev);
  if (jumpEdge) detach(6);
  else if ((cmd.keys & K.CROUCH) && !(prev & K.CROUCH)) detach(0);
}

/** Apply damage: shield first, then health. Returns [shieldDamage, healthDamage]. */
export function applyDamage(s: PlayerState, dmg: number, ignoreShield = false): [number, number] {
  dmg = Math.max(0, Math.round(dmg));
  if (s.mode === PM.Knocked) { const d = Math.min(s.knock, dmg); s.knock -= d; return [0, d]; }
  // overshield first, then shield, then health (the storm and falls go straight to health)
  const toOs = ignoreShield ? 0 : Math.min(s.os, dmg);
  s.os -= toOs;
  const toShield = ignoreShield ? 0 : Math.min(s.shield, dmg - toOs);
  s.shield -= toShield;
  const toHp = Math.min(s.hp, dmg - toOs - toShield);
  s.hp -= toHp;
  return [toOs + toShield, toHp];
}

/** Add an item to the inventory. Returns how many were taken (0 = no room). */
export function addToInventory(s: PlayerState, id: number, r: number, n: number, mag: number): number {
  const def = ITEMS[id];
  if (!def || def.kind === 'forage' || def.kind === 'card' || def.kind === 'coin' || def.kind === 'melee') return 0;
  if (def.kind === 'ammo') {
    const room = AMMO_MAX[def.ammo] - s.ammo[def.ammo];
    const take = Math.min(room, n);
    s.ammo[def.ammo] += take;
    return take;
  }
  if (def.kind === 'consumable' || def.kind === 'throwable') {
    let left = n;
    for (const slot of s.inv) {
      if (slot.id !== id || left <= 0) continue;
      const take = Math.min(def.stack - slot.n, left);
      slot.n += take; left -= take;
    }
    if (left > 0) {
      const empty = s.inv.findIndex((x) => x.id === 0);
      if (empty >= 0) { s.inv[empty] = { id, r, n: Math.min(def.stack, left), mag: 0 }; left -= Math.min(def.stack, left); }
    }
    return n - left;
  }
  const empty = s.inv.findIndex((x) => x.id === 0);
  if (empty < 0) return 0;
  s.inv[empty] = { id, r, n: 1, mag };
  return 1;
}
