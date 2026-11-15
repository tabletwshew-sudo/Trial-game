import {
  ITEMS, K, PM, SPAWN_ISLAND, aimOrigin, consumableDef, raycastWorld, routeParamNear, weaponDef,
  type BusRoute, type InputCmd, type PlayerState, type World,
} from '@dropzone/shared';
import type { LootStore } from './loot.js';

/**
 * Bot brains. Bots read the same world the players do and drive the same
 * input commands, so they obey every movement and weapon rule.
 *
 * Fight behaviour is built to feel like casual human opponents:
 *  - a reaction delay before the first shot, longer for weaker bots
 *  - aim error that grows with distance and shrinks the longer the fight lasts
 *  - strafing, the odd jump/crouch, and switching weapon for the range
 *  - healing when it's safe, picking up better loot, reviving teammates
 */

export interface BotTarget { idx: number; x: number; y: number; z: number; knocked: boolean }

export interface BotBrain {
  rnd: () => number;
  skill: number;
  target: { x: number; z: number };
  follow: number;
  jumpAt: number;
  wander: { x: number; z: number } | null;
  wanderUntil: number;
  idleUntil: number;
  sprint: boolean;
  offset: { x: number; z: number };
  // combat
  enemy: number;
  enemySeenAt: number;
  enemyFirstSeen: number;
  lastScan: number;
  lastPos: { x: number; y: number; z: number } | null;
  strafe: number;
  strafeUntil: number;
  heardFrom: { x: number; z: number; at: number } | null;
  aimYaw: number;
  aimPitch: number;
  errYaw: number;
  errPitch: number;
  errUntil: number;
  // looting
  lootId: number;
  lootUntil: number;
  ignoreLoot: Set<number>;
  firePulse: boolean;
  stuckCheck: { x: number; z: number; at: number };
}

export function newBrain(rnd: () => number): BotBrain {
  return {
    rnd, skill: 0.15 + rnd() * 0.55,
    target: { x: SPAWN_ISLAND.x, z: SPAWN_ISLAND.z }, follow: -1, jumpAt: Infinity,
    wander: null, wanderUntil: 0, idleUntil: 0, sprint: false,
    offset: { x: (rnd() - 0.5) * 16, z: (rnd() - 0.5) * 16 },
    enemy: -1, enemySeenAt: 0, enemyFirstSeen: 0, lastScan: 0, lastPos: null, strafe: 1, strafeUntil: 0, heardFrom: null,
    aimYaw: 0, aimPitch: 0, errYaw: 0, errPitch: 0, errUntil: 0,
    lootId: -1, lootUntil: 0, ignoreLoot: new Set(), firePulse: false, stuckCheck: { x: 0, z: 0, at: 0 },
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
const wrap = (a: number) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

export interface BotWorld {
  w: World;
  loot: LootStore;
  now: number;
  combat: boolean;
  /** Visible-to-bots enemies near a point (excluding teammates). */
  enemiesNear(x: number, z: number, r: number): BotTarget[];
  /** Knocked teammates near a point. */
  downedMates(): BotTarget[];
}

/** Score how much a bot wants this item (0 = ignore). */
function wantItem(s: PlayerState, item: number, r: number): number {
  const d = ITEMS[item];
  if (!d) return 0;
  if (d.kind === 'ammo') {
    const uses = s.inv.some((sl) => weaponDef(sl.id)?.ammo === d.ammo);
    return uses && s.ammo[d.ammo] < 90 ? 3 : 0;
  }
  const free = s.inv.some((sl) => sl.id === 0);
  if (d.kind === 'weapon') {
    const same = s.inv.find((sl) => weaponDef(sl.id)?.cls === d.cls);
    if (same) return r > same.r ? 4 : 0;
    const weapons = s.inv.filter((sl) => weaponDef(sl.id)).length;
    return free ? (weapons === 0 ? 10 : weapons < 3 ? 6 : 1) : 0;
  }
  if (d.kind === 'consumable' || d.kind === 'throwable') {
    const stack = s.inv.find((sl) => sl.id === item);
    if (stack) return stack.n < (d.kind === 'consumable' ? d.stack : d.stack) ? 3 : 0;
    return free ? 4 : 0;
  }
  return 0;
}

/** Best slot for a fight at this distance. */
function pickWeaponSlot(s: PlayerState, dist: number): number {
  let best = -1, bestScore = -1;
  s.inv.forEach((sl, i) => {
    const d = weaponDef(sl.id);
    if (!d || (sl.mag === 0 && s.ammo[d.ammo] === 0)) return;
    let score = 1 + sl.r * 0.3;
    if (d.cls === 'shotgun' || d.cls === 'autoshotgun') score += dist < 12 ? 6 : dist < 22 ? 1 : -3;
    else if (d.cls === 'smg') score += dist < 25 ? 4 : dist < 45 ? 1 : -1;
    else if (d.cls === 'ar' || d.cls === 'burst') score += dist < 10 ? 1 : 4;
    else if (d.cls === 'dmr') score += dist > 40 ? 5 : 1;
    else if (d.cls === 'sniper') score += dist > 70 ? 6 : -2;
    else if (d.cls === 'rocket') score += dist > 15 && dist < 70 ? 2 : -4;
    else if (d.cls === 'pistol') score += 0.5;
    if (sl.mag === 0) score -= 2;
    if (score > bestScore) { bestScore = score; best = i; }
  });
  return best;
}

function healSlot(s: PlayerState): number {
  return s.inv.findIndex((sl) => {
    const d = consumableDef(sl.id);
    if (!d) return false;
    return (d.shield > 0 && s.shield < d.shieldCap) || (d.heal > 0 && s.hp < Math.min(d.healCap, 90));
  });
}

function wanderCmd(s: PlayerState, b: BotBrain, now: number, home: { x: number; z: number }, roam: number, cmd: InputCmd) {
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

/** Can this bot see a point? (eye to chest, world geometry only) */
function canSee(w: World, s: PlayerState, t: { x: number; y: number; z: number }) {
  const o = aimOrigin(s.x, s.y, s.z, s.yaw);
  const dx = t.x - o.x, dy = t.y + 1.2 - o.y, dz = t.z - o.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1) return true;
  const hit = raycastWorld(w, o, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, false);
  return hit.kind === 'none';
}

/**
 * One decision for one bot. Returns the command to run this tick and whether it wants
 * to use (E) - the match handles pickups/revives from USE like it does for humans.
 */
export function botInput(s: PlayerState, b: BotBrain, bw: BotWorld, home: { x: number; z: number }, roam: number): InputCmd {
  const now = bw.now;
  const cmd: InputCmd = { keys: 0, yaw: s.yaw, pitch: 0 };
  if (s.mode === PM.Bus || s.mode === PM.Dead) return cmd;

  if (s.mode === PM.Fall || s.mode === PM.Glide) {
    const dx = home.x + b.offset.x - s.x, dz = home.z + b.offset.z - s.z;
    const d = Math.hypot(dx, dz);
    cmd.yaw = yawTo(dx, dz);
    if (d > 3) cmd.keys |= K.F;
    cmd.pitch = s.mode === PM.Fall && d < Math.max(30, s.y * 0.45) ? -1.3 : -0.1;
    return cmd;
  }
  if (s.mode === PM.Drive || s.mode === PM.Ride) { cmd.keys |= K.USE; return cmd; } // bots hop out of cars

  // ------------------------------------------------ knocked: crawl away from danger toward a teammate
  if (s.mode === PM.Knocked) {
    const mates = bw.downedMates(); // not used for crawling, but keeps the API symmetric
    void mates;
    const threat = b.enemy >= 0 && b.lastPos ? b.lastPos : null;
    if (threat) { cmd.yaw = yawTo(s.x - threat.x, s.z - threat.z); cmd.keys |= K.F; }
    return cmd;
  }

  if (!bw.combat) return wanderCmd(s, b, now, home, roam, cmd);

  // ------------------------------------------------ perception (4x a second)
  if (now - b.lastScan > 250) {
    b.lastScan = now;
    const range = 55 + b.skill * 70;
    const cands = bw.enemiesNear(s.x, s.z, range).sort((a, c) => (a.x - s.x) ** 2 + (a.z - s.z) ** 2 - ((c.x - s.x) ** 2 + (c.z - s.z) ** 2));
    let found = -1;
    for (const c of cands.slice(0, 3)) {
      // can't see what's behind you unless it's close or making noise
      const ang = Math.abs(wrap(yawTo(c.x - s.x, c.z - s.z) - s.yaw));
      const close = Math.hypot(c.x - s.x, c.z - s.z) < 14;
      if (ang > 1.4 && !close && b.enemy !== c.idx) continue;
      if (canSee(bw.w, s, c)) { found = c.idx; b.lastPos = { x: c.x, y: c.y, z: c.z }; break; }
    }
    if (found >= 0) {
      if (found !== b.enemy) { b.enemyFirstSeen = now; b.enemy = found; }
      b.enemySeenAt = now;
    } else if (b.enemy >= 0 && now - b.enemySeenAt > 4000) b.enemy = -1;
  }

  // ------------------------------------------------ fight
  if (b.enemy >= 0 && b.lastPos) {
    const live = bw.enemiesNear(b.lastPos.x, b.lastPos.z, 12).find((e) => e.idx === b.enemy);
    const t = live && now - b.enemySeenAt < 600 ? live : null;
    if (t) b.lastPos = { x: t.x, y: t.y, z: t.z };
    const tx = b.lastPos.x, ty = b.lastPos.y + (t?.knocked ? 0.4 : 1.15), tz = b.lastPos.z;
    const o = aimOrigin(s.x, s.y, s.z, s.yaw);
    const dx = tx - o.x, dy = ty - o.y, dz = tz - o.z, dist = Math.hypot(dx, dz);
    const slot = pickWeaponSlot(s, dist);
    if (slot >= 0 && slot !== s.slot) cmd.slot = slot + 1;

    // aim: smooth turn toward the target plus an error that shrinks over the fight
    if (now > b.errUntil) {
      const engaged = (now - b.enemyFirstSeen) / 1000;
      const sloppy = (1.15 - b.skill) * (0.05 + Math.min(0.06, dist / 900)) * Math.max(0.35, 1.4 - engaged * 0.25);
      b.errYaw = (b.rnd() - 0.5) * 2 * sloppy;
      b.errPitch = (b.rnd() - 0.5) * 1.6 * sloppy;
      b.errUntil = now + 250 + b.rnd() * 350;
    }
    const wantYaw = yawTo(dx, dz) + b.errYaw, wantPitch = Math.atan2(dy, dist) + b.errPitch;
    const turn = (3 + b.skill * 7) * (1 / 30) * 2;
    const dyaw = wrap(wantYaw - s.yaw);
    cmd.yaw = s.yaw + Math.max(-turn, Math.min(turn, dyaw));
    cmd.pitch = s.pitch + Math.max(-turn, Math.min(turn, wantPitch - s.pitch));

    const reacted = now - b.enemyFirstSeen > 900 - b.skill * 550;
    const lined = Math.abs(dyaw) < 0.12 + 2 / Math.max(dist, 4);
    const def = weaponDef(s.inv[s.slot]?.id ?? 0);
    if (t && reacted && lined && def && s.cd === 0 && s.reload === 0) {
      if (def.auto) cmd.keys |= K.FIRE;
      else { b.firePulse = !b.firePulse; if (b.firePulse) cmd.keys |= K.FIRE; }
      if (dist > 25 && def.cls !== 'shotgun' && def.cls !== 'autoshotgun') cmd.keys |= K.ADS;
    }
    if (def && s.inv[s.slot].mag === 0) cmd.keys |= K.RELOAD;

    // movement: close in with shotguns, hold range with rifles, always strafe
    if (now > b.strafeUntil) { b.strafe = b.rnd() < 0.5 ? -1 : 1; b.strafeUntil = now + 500 + b.rnd() * 1100; }
    const ideal = def?.cls === 'shotgun' || def?.cls === 'autoshotgun' ? 6 : def?.cls === 'smg' ? 14 : def?.cls === 'sniper' ? 90 : 30;
    if (dist > ideal + 6) cmd.keys |= K.F; else if (dist < ideal - 6) cmd.keys |= K.B;
    cmd.keys |= b.strafe > 0 ? K.R : K.L;
    if (s.grounded && b.rnd() < 0.015 + b.skill * 0.02) cmd.keys |= K.JUMP;
    if (b.rnd() < 0.004) cmd.keys |= K.CROUCH;
    if (!t && dist > 4) { cmd.keys |= K.F; cmd.keys &= ~K.FIRE; } // chase the last known spot
    return cmd;
  }

  // ------------------------------------------------ out of combat: heal, revive, loot, roam
  const h = healSlot(s);
  if (h >= 0 && (s.hp < 70 || s.shield < 50) && now - b.enemySeenAt > 2500) {
    if (h !== s.slot) cmd.slot = h + 1;
    else cmd.keys |= K.FIRE;
    return cmd;
  }

  const downed = bw.downedMates().filter((m) => Math.hypot(m.x - s.x, m.z - s.z) < 80);
  if (downed.length) {
    const m = downed[0], dx = m.x - s.x, dz = m.z - s.z, d = Math.hypot(dx, dz);
    cmd.yaw = yawTo(dx, dz);
    if (d > 1.8) { cmd.keys |= K.F; if (d > 6) cmd.keys |= K.SPRINT; } else cmd.keys |= K.USE;
    return cmd;
  }

  if (now > b.lootUntil || b.lootId < 0 || !bw.loot.get(b.lootId)) {
    b.lootUntil = now + 1500;
    let best = -1, bestScore = 0;
    for (const it of bw.loot.near(s.x, s.z, 45)) {
      if (b.ignoreLoot.has(it.id) || Math.abs(it.y - s.y) > 3) continue;
      const want = wantItem(s, it.item, it.r);
      if (!want) continue;
      const score = want / (1 + Math.hypot(it.x - s.x, it.z - s.z) / 10);
      if (score > bestScore) { bestScore = score; best = it.id; }
    }
    if (best !== b.lootId) b.stuckCheck = { x: s.x, z: s.z, at: now };
    b.lootId = best;
  }
  const it = b.lootId >= 0 ? bw.loot.get(b.lootId) : undefined;
  if (it) {
    const dx = it.x - s.x, dz = it.z - s.z, d = Math.hypot(dx, dz);
    cmd.yaw = yawTo(dx, dz);
    if (d > 1.2) { cmd.keys |= K.F; if (d > 8) cmd.keys |= K.SPRINT; }
    if (d < 2) { b.firePulse = !b.firePulse; if (b.firePulse) cmd.keys |= K.USE; }
    // give up on loot we can't reach (behind a wall, on a roof)
    if (now - b.stuckCheck.at > 6000) {
      if (Math.hypot(s.x - b.stuckCheck.x, s.z - b.stuckCheck.z) < 4 || d > 3) { b.ignoreLoot.add(it.id); b.lootId = -1; }
      b.stuckCheck = { x: s.x, z: s.z, at: now };
    }
    if (s.grounded && b.rnd() < 0.01) cmd.keys |= K.JUMP;
    return cmd;
  }

  // reload whatever is empty while wandering
  if (s.inv[s.slot] && weaponDef(s.inv[s.slot].id) && s.inv[s.slot].mag < (weaponDef(s.inv[s.slot].id)!.mag)) cmd.keys |= K.RELOAD;
  return wanderCmd(s, b, now, home, roam, cmd);
}
