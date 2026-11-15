import { DROP, MOVEMENT } from './constants.js';
import { aimDir, aimOrigin, spreadDir, type Vec3 } from './combat.js';
import { AMMO_MAX, ITEMS, RARITY_RELOAD_MUL, consumableDef, throwableDef, weaponDef, type WeaponDef } from './items.js';
import { clamp, lerp } from './noise.js';
import { stepCar } from './veh.js';
import { WATER_FLOAT_Y, WORLD_LIMIT, collideBoxes, surfaceAt, terrainAt, type World } from './world.js';

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
export const PM = { Walk: 0, Bus: 1, Fall: 2, Glide: 3, Drive: 4, Ride: 5, Knocked: 6, Dead: 7 } as const;
/** Server-controlled "busy" states that freeze the player. */
export const ACT = { None: 0, Reviving: 1 } as const;

export interface InputCmd { keys: number; yaw: number; pitch: number; /** 0 = keep, 1..5 = select slot */ slot?: number }
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
}

export const newPlayerState = (): PlayerState => ({
  x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0, mode: PM.Walk, grounded: true, keys: 0,
  hp: 100, shield: 0, knock: 0, slot: 0, inv: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()], ammo: [0, 0, 0, 0, 0],
  cd: 0, burst: 0, reload: 0, use: 0, bloom: 0, shots: 0, seed: 1, act: ACT.None, veh: -1, seat: 0, vh: 0, vs: 0, emote: 0,
});

export function clonePlayerState(s: PlayerState): PlayerState {
  return { ...s, inv: s.inv.map((x) => ({ ...x })), ammo: [...s.ammo] };
}

export const isSwimming = (s: PlayerState, w: World) =>
  (s.mode === PM.Walk || s.mode === PM.Knocked) && s.y <= WATER_FLOAT_Y + 0.02 && terrainAt(w, s.x, s.z) < WATER_FLOAT_Y;

/** Things that happened during a step that the server (hits) or client (effects) cares about. */
export interface ShotEvent { origin: Vec3; dirs: Vec3[]; weapon: number; rarity: number }
export interface ThrowEvent { origin: Vec3; vel: Vec3; item: number }
export interface SimEvents {
  shot?(e: ShotEvent): void;
  thrown?(e: ThrowEvent): void;
  fallDamage?(dmg: number): void;
  used?(item: number): void;
  reloaded?(): void;
}

function approach2(s: PlayerState, tx: number, tz: number, maxDelta: number) {
  const dx = tx - s.vx, dz = tz - s.vz;
  const len = Math.hypot(dx, dz);
  if (len <= maxDelta) { s.vx = tx; s.vz = tz; }
  else { s.vx += (dx / len) * maxDelta; s.vz += (dz / len) * maxDelta; }
}
const approach = (v: number, t: number, d: number) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

export const KNOCKED_SPEED = 1.7;
export const USE_WALK_SPEED = 2.4;

/** Current spread in radians for the held weapon. */
export function currentSpread(s: PlayerState, def: WeaponDef) {
  const ads = (s.keys & K.ADS) !== 0;
  let base = ads ? def.spreadAds : def.spreadHip;
  const moving = Math.hypot(s.vx, s.vz) > 0.5;
  if (moving && !ads) base *= 1.45;
  if (!s.grounded && s.mode === PM.Walk) base *= 2;
  if (s.keys & K.CROUCH && !moving) base *= 0.8;
  return base + s.bloom / 1000;
}

export const heldWeapon = (s: PlayerState) => weaponDef(s.inv[s.slot]?.id ?? 0);
export const canShoot = (s: PlayerState) => (s.mode === PM.Walk || s.mode === PM.Ride) && s.act === ACT.None;

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

function fireOnce(s: PlayerState, def: WeaponDef, ev?: SimEvents) {
  const slot = s.inv[s.slot];
  slot.mag--;
  const origin = aimOrigin(s.x, s.y, s.z, s.yaw, (s.keys & K.CROUCH) !== 0);
  const d = aimDir(s.yaw, s.pitch);
  const spread = currentSpread(s, def);
  const dirs: Vec3[] = [];
  // shotguns: the first pellet (index 0) is kept tighter, like a choke
  for (let p = 0; p < def.pellets; p++) dirs.push(spreadDir(d, p === 0 && def.pellets > 1 ? spread * 0.35 : spread, s.seed, s.shots, p));
  s.shots = (s.shots + 1) >>> 0;
  s.bloom = Math.min(Math.round(def.bloomMax * 1000), s.bloom + Math.round(def.bloomShot * 1000));
  ev?.shot?.({ origin, dirs, weapon: slot.id, rarity: slot.r });
}

function stepCombat(s: PlayerState, cmd: InputCmd, prevKeys: number, ev?: SimEvents) {
  const keys = cmd.keys;
  const fireEdge = (keys & K.FIRE) !== 0 && (prevKeys & K.FIRE) === 0;
  const fireHeld = (keys & K.FIRE) !== 0;

  // slot switching cancels reloads and item use, with a short equip delay
  if (cmd.slot && cmd.slot >= 1 && cmd.slot <= 5 && cmd.slot - 1 !== s.slot) {
    s.slot = cmd.slot - 1;
    s.reload = 0; s.use = 0; s.burst = 0;
    s.cd = Math.max(s.cd, 14);
  }
  if (s.cd > 0) s.cd--;
  const slot = s.inv[s.slot];
  const def = weaponDef(slot.id);
  if (s.bloom > 0) s.bloom = Math.max(0, s.bloom - Math.round(((def?.bloomRecover ?? 0.1) * 1000) / SIM_HZ));
  if (!canShoot(s)) { s.reload = 0; s.use = 0; s.burst = 0; return; }

  if (def) {
    if (s.reload > 0) {
      // shotguns can fire mid-reload if they have a shell loaded
      if (def.perShell && slot.mag > 0 && fireEdge && s.cd === 0) s.reload = 0;
      else if (--s.reload === 0) finishReload(s, def, ev);
    }
    if (s.reload === 0) {
      if (s.burst > 0 && s.cd === 0 && slot.mag > 0) {
        fireOnce(s, def, ev);
        s.burst--;
        s.cd = s.burst > 0 ? def.burstGap : def.interval - (def.burst - 1) * def.burstGap;
      } else if ((def.auto ? fireHeld : fireEdge) && s.cd === 0) {
        if (slot.mag > 0) {
          fireOnce(s, def, ev);
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
  if (tdef && fireEdge && s.cd === 0 && s.mode === PM.Walk) {
    const d = aimDir(s.yaw, s.pitch + 0.12);
    const o = aimOrigin(s.x, s.y, s.z, s.yaw);
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

  if (s.mode === PM.Drive) {
    stepCar(s, f, r, (keys & K.JUMP) !== 0, w, dt);
    s.vx = -Math.sin(s.vh) * s.vs; s.vz = -Math.cos(s.vh) * s.vs;
    s.x = clamp(s.x, -WORLD_LIMIT, WORLD_LIMIT); s.z = clamp(s.z, -WORLD_LIMIT, WORLD_LIMIT);
    stepCombat(s, cmd, prev, ev);
    return;
  }
  if (s.mode === PM.Ride) { s.vx = s.vz = s.vy = 0; stepCombat(s, cmd, prev, ev); return; }

  const sin = Math.sin(cmd.yaw), cos = Math.cos(cmd.yaw);
  let wx = -sin * f + cos * r, wz = -cos * f - sin * r;
  const wl = Math.hypot(wx, wz);
  if (wl > 1e-6) { wx /= wl; wz /= wl; }

  if (s.mode === PM.Walk || s.mode === PM.Knocked) {
    const knocked = s.mode === PM.Knocked;
    const frozen = s.act !== ACT.None;
    const swimming = isSwimming(s, w);
    const using = s.use > 0;
    const usingSlow = using && !(consumableDef(s.inv[s.slot]?.id ?? 0)?.walk ?? true);
    const ads = (keys & K.ADS) !== 0 && !swimming && !knocked;
    const firing = (keys & K.FIRE) !== 0 && heldWeapon(s) !== null;
    const sprint = (keys & K.SPRINT) !== 0 && f > 0 && !ads && !firing && !using && !knocked;
    const crouch = (keys & K.CROUCH) !== 0 && !swimming && !knocked;
    let speed: number = swimming ? (sprint ? MOVEMENT.swimSprintSpeed : MOVEMENT.swimSpeed) : sprint ? MOVEMENT.sprintSpeed : MOVEMENT.walkSpeed;
    if (crouch) speed = MOVEMENT.crouchSpeed;
    if (ads) speed *= MOVEMENT.adsSpeedMul;
    if (using) speed = Math.min(speed, usingSlow ? 0 : USE_WALK_SPEED);
    if (knocked) speed = KNOCKED_SPEED;
    if (frozen) speed = 0;
    if (f < 0) speed *= 0.82;
    approach2(s, wx * speed, wz * speed, MOVEMENT.groundAccel * (s.grounded ? 1 : MOVEMENT.airControl) * dt);
    if (s.grounded && jumpEdge && !swimming && !knocked && !frozen) { s.vy = MOVEMENT.jumpVelocity; s.grounded = false; }
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
      if (s.vy <= 0 && s.y <= g) {
        // fall damage, from the speed you hit the ground at (health only, like the storm)
        const height = (s.vy * s.vy) / (2 * MOVEMENT.gravity);
        if (height > MOVEMENT.fallDamageMinHeight && g > WATER_FLOAT_Y + 0.01) {
          const dmg = Math.round((height - MOVEMENT.fallDamageMinHeight) * MOVEMENT.fallDamagePerMetre);
          s.hp = Math.max(0, s.hp - dmg);
          ev?.fallDamage?.(dmg);
        }
        s.y = g; s.vy = 0; s.grounded = true;
      }
    }
    if (!knocked) stepCombat(s, cmd, prev, ev);
    // emotes: B cycles through three; any movement, jump, shot or aim cancels
    if ((keys & K.EMOTE) && !(prev & K.EMOTE) && s.grounded && !knocked && !swimming && s.act === ACT.None) s.emote = (s.emote % 3) + 1;
    if (s.emote && (f !== 0 || r !== 0 || (keys & (K.FIRE | K.ADS | K.JUMP)) || !s.grounded || knocked || swimming)) s.emote = 0;
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
    if (s.cd > 0) s.cd--;
  }
  s.x = clamp(s.x, -WORLD_LIMIT, WORLD_LIMIT);
  s.z = clamp(s.z, -WORLD_LIMIT, WORLD_LIMIT);
}

/** Apply damage: shield first, then health. Returns [shieldDamage, healthDamage]. */
export function applyDamage(s: PlayerState, dmg: number, ignoreShield = false): [number, number] {
  dmg = Math.max(0, Math.round(dmg));
  if (s.mode === PM.Knocked) { const d = Math.min(s.knock, dmg); s.knock -= d; return [0, d]; }
  const toShield = ignoreShield ? 0 : Math.min(s.shield, dmg);
  s.shield -= toShield;
  const toHp = Math.min(s.hp, dmg - toShield);
  s.hp -= toHp;
  return [toShield, toHp];
}

/** Add an item to the inventory. Returns how many were taken (0 = no room). */
export function addToInventory(s: PlayerState, id: number, r: number, n: number, mag: number): number {
  const def = ITEMS[id];
  if (!def || def.kind === 'forage' || def.kind === 'card') return 0;
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
