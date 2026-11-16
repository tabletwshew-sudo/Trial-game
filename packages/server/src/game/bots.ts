import {
  ITEM, ITEMS, K, MV, PICK_SLOT, PM, SPAWN_ISLAND, shotOrigin, consumableDef, layoutAt, raycastWorld, routeParamNear, surfaceAt, throwableDef, weaponDef,
  type BusRoute, type InputCmd, type Layout, type PlayerState, type StormState, type World,
} from '@dropzone/shared';
import type { LootStore } from './loot.js';

/**
 * Bot brains. Bots read the same world the players do and drive the same
 * input commands, so they obey every movement and weapon rule.
 *
 * Fight behaviour is built to feel like casual human opponents:
 *  - a reaction delay before the first shot, longer for weaker bots
 *  - aim error that grows with distance and shrinks the longer the fight lasts
 *  - strafing (side to side, crouching and jumping more for skilled bots), switching weapon for the range
 *  - breaking line of sight to reload or heal behind cover, then peeking back out
 *  - pushing a target they've hurt badly or knocked, chasing around corners to where it was last seen
 *  - grenades over cover, the pickaxe when they've nothing to shoot
 *  - turning toward footsteps and gunshots, and going to look when they're healthy
 *  - healing when it's safe, picking up better loot, reviving teammates
 * They only see what a player could: line of sight comes from their own side of any wall.
 */

export interface BotTarget { idx: number; x: number; y: number; z: number; knocked: boolean; /** horizontal speed (loud when sprinting) */ speed?: number }

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
  /** Boss/guard NPCs defend a spot instead of roaming. */
  post?: { x: number; z: number };
  /** Movement: ticks spent walking into something, and a slide in progress. */
  blocked: number;
  slideUntil: number;
  /** Where the bot last made progress, and a short "get unstuck" run in a fresh direction. */
  prog: { x: number; z: number; at: number } | null;
  unstickUntil: number;
  unstickYaw: number;
  /** Damage done to the current enemy, and when it was last added to (pushes when it's a lot). */
  dealt: number;
  dealtAt: number;
  /** A spot out of the enemy's sight to heal or reload behind, and when to give up on it. */
  cover: { x: number; z: number; until: number } | null;
  coverCheck: number;
  /** When the next grenade may be thrown. */
  nadeAt: number;
  crouchUntil: number;
  /** Going to look at where a noise came from. */
  investigate: { x: number; z: number; until: number } | null;
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
    blocked: 0, slideUntil: 0, prog: null, unstickUntil: 0, unstickYaw: 0,
    dealt: 0, dealtAt: 0, cover: null, coverCheck: 0, nadeAt: 0, crouchUntil: 0, investigate: null,
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
  /** Closed chests / ammo boxes / landed supply drops near a point. */
  chestsNear(x: number, z: number, r: number): { id: number; x: number; y: number; z: number; k: number }[];
  storm: StormState | null;
  /** Recall cards this bot carries, the nearest usable beacon, and whether a card on the ground is a teammate's. */
  cards: number;
  beaconNear(x: number, z: number): { x: number; z: number } | null;
  isMateCard(r: number): boolean;
}

/** Set movement keys to walk toward (dx, dz) while looking wherever yaw points (strafe-running). */
function moveToward(cmd: InputCmd, yaw: number, dx: number, dz: number) {
  const len = Math.hypot(dx, dz) || 1;
  const df = (dx * -Math.sin(yaw) + dz * -Math.cos(yaw)) / len, dr = (dx * Math.cos(yaw) + dz * -Math.sin(yaw)) / len;
  cmd.keys &= ~(K.F | K.B | K.L | K.R);
  if (df > 0.35) cmd.keys |= K.F; else if (df < -0.35) cmd.keys |= K.B;
  if (dr > 0.35) cmd.keys |= K.R; else if (dr < -0.35) cmd.keys |= K.L;
}

/** Should this bot be heading for the safe zone, and where to? */
function stormGoal(s: PlayerState, bw: BotWorld, now: number): { x: number; z: number; urgent: boolean } | null {
  const st = bw.storm;
  if (!st) return null;
  const outNow = Math.hypot(s.x - st.x, s.z - st.z) > st.r - 4;
  const dNext = Math.hypot(s.x - st.next.x, s.z - st.next.z);
  const outNext = dNext > st.next.r * 0.8;
  const soon = st.shrinking || st.until - now < 35_000;
  if (!outNow && !(outNext && soon)) return null;
  // aim for a point well inside the next circle, on our side of it
  const k = dNext > 1 ? Math.min(1, (st.next.r * 0.5) / dNext) : 0;
  return { x: st.next.x + (s.x - st.next.x) * k, z: st.next.z + (s.z - st.next.z) * k, urgent: outNow };
}

/**
 * Where to walk next to reach (tx, ty, tz): through a door if the target is in a different
 * building (or outside), up or down the stairs if it's on another floor.
 */
export function navStep(w: World, s: PlayerState, tx: number, ty: number, tz: number): { x: number; z: number } {
  const here = layoutAt(w, s.x, s.z), there = layoutAt(w, tx, tz);
  const inside = (L: Layout | null) => L && L.type !== 'solid' ? L : null;
  const A = inside(here), B = inside(there);
  const viaDoor = (L: Layout, leaving: boolean) => {
    let best = L.doors[0], bd = Infinity;
    for (const d of L.doors) { const dd = Math.hypot(d.x - (leaving ? tx : s.x), d.z - (leaving ? tz : s.z)) + Math.hypot(d.ix - s.x, d.iz - s.z) * (leaving ? 1 : 0); if (dd < bd) { bd = dd; best = d; } }
    const nx = best.ix - best.x, nz = best.iz - best.z, nl = Math.hypot(nx, nz) || 1;
    const along = ((s.x - best.cx) * nx + (s.z - best.cz) * nz) / nl;      // <0 outside, >0 inside
    const lateral = Math.abs(((s.x - best.cx) * nz - (s.z - best.cz) * nx) / nl);
    if (leaving) return lateral < 0.5 && along < 1.7 ? { x: best.x, z: best.z } : { x: best.ix, z: best.iz };
    return lateral < 0.5 && along > -1.7 ? { x: best.ix, z: best.iz } : { x: best.x, z: best.z };
  };
  if (A && A !== B) {
    // on the roof (climbed a ladder): just head for the target and drop off the edge
    if (s.y > A.floors[A.floors.length - 1] + 2.6) return { x: tx, z: tz };
    // upstairs: take the stairs down before making for the door
    if (A.stairs && s.y > A.floors[0] + 1.5) {
      const st = A.stairs;
      const onStairs = s.x > st.x0 - 0.1 && s.x < st.x1 + 0.1 && s.z > st.z0 - 0.1 && s.z < st.z1 + 0.1;
      return onStairs || Math.hypot(s.x - st.tx, s.z - st.tz) < 0.7 ? { x: st.bx, z: st.bz } : { x: st.tx, z: st.tz };
    }
    return viaDoor(A, true);
  }
  if (B && A !== B) {
    // only bother with the door if the target is on the ground floor or we'll take the stairs after
    return viaDoor(B, false);
  }
  if (A && A === B && A.stairs) {
    const st = A.stairs, up = ty > st.y0 + 1.5, onUpper = s.y > st.y0 + 1.5;
    const onStairs = s.x > st.x0 - 0.1 && s.x < st.x1 + 0.1 && s.z > st.z0 - 0.1 && s.z < st.z1 + 0.1;
    if (up && !onUpper) return onStairs || Math.hypot(s.x - st.bx, s.z - st.bz) < 0.7 ? { x: st.tx, z: st.tz } : { x: st.bx, z: st.bz };
    if (!up && onUpper) return onStairs || Math.hypot(s.x - st.tx, s.z - st.tz) < 0.7 ? { x: st.bx, z: st.bz } : { x: st.tx, z: st.tz };
  }
  return { x: tx, z: tz };
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
  const o = shotOrigin(w, s.x, s.y, s.z, s.yaw);
  const dx = t.x - o.x, dy = t.y + 1.2 - o.y, dz = t.z - o.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 1) return true;
  const hit = raycastWorld(w, o, { x: dx / dist, y: dy / dist, z: dz / dist }, dist, false);
  return hit.kind === 'none';
}

/**
 * A nearby spot the enemy can't see (a wall, a tree, a rock between you), reachable in a straight
 * line on about the same level. Prefers close spots that put distance between you and them.
 */
export function findCover(w: World, s: PlayerState, e: { x: number; y: number; z: number }): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null, bestScore = Infinity;
  const eye = { x: e.x, y: e.y + 1.6, z: e.z };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const dx = Math.cos(a), dz = Math.sin(a);
    for (const r of [3, 5.5, 8.5]) {
      const x = s.x + dx * r, z = s.z + dz * r;
      const y = surfaceAt(w, x, z, s.y + 1.5);
      if (Math.abs(y - s.y) > 1.2) continue;
      if (raycastWorld(w, { x: s.x, y: s.y + 0.7, z: s.z }, { x: dx, y: 0, z: dz }, r, false).kind !== 'none') continue;
      const tx = x - eye.x, ty = y + 1.2 - eye.y, tz = z - eye.z, tl = Math.hypot(tx, ty, tz);
      if (tl < 4) continue;
      if (raycastWorld(w, eye, { x: tx / tl, y: ty / tl, z: tz / tl }, tl, false).kind === 'none') continue;
      const score = r - Math.hypot(x - e.x, z - e.z) * 0.25;
      if (score < bestScore) { bestScore = score; best = { x, z }; }
    }
  }
  return best;
}

const grenadeSlot = (s: PlayerState) => s.inv.findIndex((sl) => !!throwableDef(sl.id) && sl.n > 0);

/**
 * One decision for one bot. Returns the command to run this tick and whether it wants
 * to use (E) - the match handles pickups/revives from USE like it does for humans.
 */
export function botInput(s: PlayerState, b: BotBrain, bw: BotWorld, home: { x: number; z: number }, roam: number): InputCmd {
  const cmd = decide(s, b, bw, home, roam);
  if (s.mode !== PM.Walk || s.act) { b.blocked = 0; b.prog = null; return cmd; }
  // no progress for a while (wedged in a corner, a roof, a room it can't path out of)? pick a new way
  const now = bw.now;
  if ((cmd.keys & K.F) && b.enemy < 0 && !b.post) {
    if (!b.prog || Math.hypot(s.x - b.prog.x, s.z - b.prog.z) > 3) b.prog = { x: s.x, z: s.z, at: now };
    else if (now - b.prog.at > 10_000) {
      b.unstickUntil = now + 2200; b.unstickYaw = b.rnd() * Math.PI * 2;
      b.wander = null;
      if (b.lootId >= 0) { b.ignoreLoot.add(b.lootId); b.lootId = -1; }
      b.prog = { x: s.x, z: s.z, at: now };
    }
  } else b.prog = null;
  if (now < b.unstickUntil) {
    cmd.yaw = b.unstickYaw; cmd.keys = (cmd.keys & ~(K.B | K.L | K.R | K.CROUCH)) | K.F | K.SPRINT;
    if (b.rnd() < 0.08 && !(s.keys & K.JUMP)) cmd.keys |= K.JUMP;
  }
  const sp = Math.hypot(s.vx, s.vz);
  // walking into something (a crate, fence, low wall)? jump: holding forward turns that into a mantle or vault
  if ((cmd.keys & K.F) && s.grounded && s.mv === MV.None && sp < 1.5) {
    if (++b.blocked > 8 && !(s.keys & K.JUMP)) { cmd.keys |= K.JUMP; b.blocked = 0; }
  } else b.blocked = 0;
  // sprinting somewhere (or rushing a fight): the odd slide, more often downhill
  if (bw.now < b.slideUntil) { if (cmd.keys & K.F) cmd.keys |= K.CROUCH | K.SPRINT; }
  else if ((cmd.keys & K.SPRINT) && s.grounded && sp > 7 && s.mv === MV.None && b.rnd() < 0.004 + b.skill * 0.006) b.slideUntil = bw.now + 500 + b.rnd() * 700;
  return cmd;
}

function decide(s: PlayerState, b: BotBrain, bw: BotWorld, home: { x: number; z: number }, roam: number): InputCmd {
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
      if (found !== b.enemy) { b.enemyFirstSeen = now; b.enemy = found; b.dealt = 0; b.cover = null; }
      b.enemySeenAt = now;
      b.investigate = null;
    } else if (b.enemy >= 0 && now - b.enemySeenAt > 4000) { b.enemy = -1; b.cover = null; }
    // footsteps: someone sprinting nearby is heard even when they can't be seen
    if (found < 0) for (const c of cands) if ((c.speed ?? 0) > 6 && (c.x - s.x) ** 2 + (c.z - s.z) ** 2 < 22 * 22) { b.heardFrom = { x: c.x, z: c.z, at: now }; break; }
  }

  // ------------------------------------------------ fight
  if (b.post && b.enemy >= 0 && b.lastPos && Math.hypot(b.lastPos.x - b.post.x, b.lastPos.z - b.post.z) > 55) b.enemy = -1;
  if (b.enemy >= 0 && b.lastPos) {
    const live = bw.enemiesNear(b.lastPos.x, b.lastPos.z, 12).find((e) => e.idx === b.enemy);
    const t = live && now - b.enemySeenAt < 600 ? live : null;
    if (t) b.lastPos = { x: t.x, y: t.y, z: t.z };
    const knocked = !!live?.knocked;
    const tx = b.lastPos.x, ty = b.lastPos.y + (knocked ? 0.4 : 1.15), tz = b.lastPos.z;
    const o = shotOrigin(bw.w, s.x, s.y, s.z, s.yaw);
    const dx = tx - o.x, dy = ty - o.y, dz = tz - o.z, dist = Math.hypot(dx, dz);
    const gunSlot = pickWeaponSlot(s, dist);
    const health = s.hp + s.shield;
    const healAt = healSlot(s);
    const pushing = knocked || (b.dealt >= 70 && now - b.dealtAt < 5000);
    const weak = health < 45 + (1 - b.skill) * 25 && !pushing;

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

    // nothing to shoot with: swing the pickaxe if they're close, otherwise go and find a gun
    if (gunSlot < 0) {
      if (dist < 10 || knocked) {
        if (s.slot !== PICK_SLOT) cmd.slot = PICK_SLOT + 1;
        moveToward(cmd, cmd.yaw, dx, dz); cmd.keys |= K.SPRINT;
        if (t && dist < 2.4 && Math.abs(dyaw) < 0.6) cmd.keys |= K.FIRE;
        if (s.grounded && dist > 4 && b.rnd() < 0.02) cmd.keys |= K.JUMP;
        return cmd;
      }
      b.enemy = -1; b.cover = null;
    } else {
      const held = weaponDef(s.inv[s.slot]?.id ?? 0);
      const reloading = !!held && (s.reload > 0 || s.inv[s.slot].mag === 0);

      // ---- break line of sight to heal or reload, then peek back out
      const wantCover = (weak && healAt >= 0) || (reloading && dist > 10 && (held?.mag ?? 0) > 6 && b.skill > 0.3);
      if (wantCover && !b.cover && now > b.coverCheck) {
        b.coverCheck = now + 1500;
        const c = findCover(bw.w, s, b.lastPos);
        if (c) b.cover = { ...c, until: now + 7000 };
      }
      if (b.cover && (now > b.cover.until || (!wantCover && !(weak && healAt >= 0)))) b.cover = null;
      if (b.cover) {
        const cdx = b.cover.x - s.x, cdz = b.cover.z - s.z, cd = Math.hypot(cdx, cdz);
        if (cd > 0.8) {
          cmd.yaw = yawTo(cdx, cdz); cmd.pitch = 0;
          cmd.keys = (cmd.keys & ~(K.B | K.L | K.R)) | K.F | K.SPRINT;
          if (reloading) cmd.keys |= K.RELOAD;
        } else {
          cmd.keys |= K.CROUCH;
          if (weak && healAt >= 0 && !t) { if (healAt !== s.slot) cmd.slot = healAt + 1; else cmd.keys |= K.FIRE; }
          else if (held && s.inv[s.slot].mag < held.mag) cmd.keys |= K.RELOAD;
        }
        return cmd;
      }
      if (gunSlot !== s.slot) cmd.slot = gunSlot + 1;

      // ---- shoot
      const reacted = now - b.enemyFirstSeen > 900 - b.skill * 550;
      const lined = Math.abs(dyaw) < 0.12 + 2 / Math.max(dist, 4);
      const def = held;
      if (t && reacted && lined && def && s.cd === 0 && s.reload === 0) {
        // automatics at long range: tap so the spread settles between shots
        const tap = def.auto && dist > 45 && def.cls !== 'smg';
        if (def.auto && !tap) cmd.keys |= K.FIRE;
        else { b.firePulse = !b.firePulse; if (b.firePulse) cmd.keys |= K.FIRE; }
        if (dist > 25 && def.cls !== 'shotgun' && def.cls !== 'autoshotgun') cmd.keys |= K.ADS;
      }
      if (def && s.inv[s.slot].mag === 0) cmd.keys |= K.RELOAD;

      // ---- move: hold a range for the weapon, close in on a hurt or knocked target, always strafe
      if (now > b.strafeUntil) { b.strafe = b.rnd() < 0.5 ? -1 : 1; b.strafeUntil = now + 250 + (1 - b.skill) * 650 + b.rnd() * 800; }
      const close = def?.cls === 'shotgun' || def?.cls === 'autoshotgun';
      const ideal = pushing ? (knocked ? 2.5 : close ? 4 : 8) : close ? 6 : def?.cls === 'smg' ? 14 : def?.cls === 'sniper' ? 90 : 30;
      if (dist > ideal + 6) { cmd.keys |= K.F; if (pushing && dist > 10) cmd.keys |= K.SPRINT; }
      else if (dist < ideal - 6) cmd.keys |= K.B;
      if (!(pushing && dist > 10)) cmd.keys |= b.strafe > 0 ? K.R : K.L;
      if (s.grounded && b.rnd() < (dist < 15 ? 0.025 : 0.01) + b.skill * 0.02) cmd.keys |= K.JUMP;
      // skilled bots crouch now and then mid-fight to throw off your aim
      if (b.skill > 0.4 && t && dist > 12 && b.rnd() < 0.006) b.crouchUntil = now + 350 + b.rnd() * 700;
      if (now < b.crouchUntil) cmd.keys |= K.CROUCH;

      // ---- they ducked behind something: lob a grenade over it
      const gs = grenadeSlot(s);
      const hidden = now - b.enemySeenAt;
      if (!t && gs >= 0 && now > b.nadeAt && hidden > 900 && hidden < 5000 && dist > 7 && dist < 26) {
        if (s.slot !== gs) cmd.slot = gs + 1;
        else if (s.cd === 0 && !(s.keys & K.FIRE)) {
          cmd.yaw = yawTo(tx - s.x, tz - s.z); cmd.pitch = Math.min(0.6, 0.12 + dist * 0.014);
          cmd.keys = K.FIRE; b.nadeAt = now + 9000;
        }
        return cmd;
      }

      // ---- lost sight: go to where they were, the way a player would (doors, stairs)
      if (!t && dist > 3) {
        const to = navStep(bw.w, s, b.lastPos.x, b.lastPos.y, b.lastPos.z);
        cmd.keys &= ~(K.FIRE | K.F | K.B | K.L | K.R);
        if (dist > 12) { cmd.yaw = yawTo(to.x - s.x, to.z - s.z); cmd.pitch = 0; cmd.keys |= K.F; }
        else moveToward(cmd, cmd.yaw, to.x - s.x, to.z - s.z);
      }
      // caught in the storm: keep shooting but move toward safety
      const sg = stormGoal(s, bw, now);
      if (sg?.urgent && dist > 12) { moveToward(cmd, cmd.yaw, sg.x - s.x, sg.z - s.z); cmd.keys |= K.SPRINT; }
      // guards stay near their post
      if (b.post && Math.hypot(s.x - b.post.x, s.z - b.post.z) > 18) moveToward(cmd, cmd.yaw, b.post.x - s.x, b.post.z - s.z);
      return cmd;
    }
  }
  if (b.post) return wanderCmd(s, b, now, b.post, 6, cmd);

  // ------------------------------------------------ rotate with the storm
  const sg = stormGoal(s, bw, now);
  if (sg) {
    const to = navStep(bw.w, s, sg.x, s.y, sg.z);
    cmd.yaw = yawTo(to.x - s.x, to.z - s.z);
    cmd.keys |= K.F | K.SPRINT;
    if (s.grounded && b.rnd() < 0.01) cmd.keys |= K.JUMP;
    // still heal on the move if we can
    const hs = healSlot(s);
    if (hs >= 0 && s.hp < 50 && !sg.urgent) { cmd.keys &= ~K.SPRINT; if (hs !== s.slot) cmd.slot = hs + 1; else cmd.keys |= K.FIRE; }
    return cmd;
  }

  // ------------------------------------------------ carry recall cards to a beacon
  if (bw.cards > 0) {
    const bc = bw.beaconNear(s.x, s.z);
    if (bc) {
      const to = navStep(bw.w, s, bc.x, s.y, bc.z), d = Math.hypot(bc.x - s.x, bc.z - s.z);
      cmd.yaw = yawTo(to.x - s.x, to.z - s.z);
      if (d > 2) cmd.keys |= K.F | (d > 8 ? K.SPRINT : 0); else cmd.keys |= K.USE;
      return cmd;
    }
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

  // ------------------------------------------------ a noise (gunfire, footsteps): turn to look, and go see if we're in good shape
  if (b.heardFrom && now - b.heardFrom.at < 2500 && !b.post) {
    const hx = b.heardFrom.x - s.x, hz = b.heardFrom.z - s.z, hd = Math.hypot(hx, hz);
    if (hd > 2) {
      cmd.yaw = s.yaw + Math.max(-0.2, Math.min(0.2, wrap(yawTo(hx, hz) - s.yaw)));
      if (!b.investigate && hd < 70 && s.hp + s.shield > 80 && pickWeaponSlot(s, hd) >= 0 && b.rnd() < 0.02 + b.skill * 0.04) b.investigate = { x: b.heardFrom.x, z: b.heardFrom.z, until: now + 9000 };
      if (!b.investigate) return cmd;
    }
  }
  if (b.investigate) {
    const d = Math.hypot(b.investigate.x - s.x, b.investigate.z - s.z);
    if (now > b.investigate.until || d < 4) b.investigate = null;
    else {
      const to = navStep(bw.w, s, b.investigate.x, s.y, b.investigate.z);
      cmd.yaw = yawTo(to.x - s.x, to.z - s.z);
      cmd.keys |= K.F;
      if (d > 30) cmd.keys |= K.SPRINT; // close in quietly once near
      return cmd;
    }
  }

  const chestTarget = () => (b.lootId <= -10 ? bw.chestsNear(s.x, s.z, 60).find((c) => c.id === -b.lootId - 10) : undefined);
  if (now > b.lootUntil || b.lootId === -1 || (b.lootId >= 0 && !bw.loot.get(b.lootId)) || (b.lootId <= -10 && !chestTarget())) {
    b.lootUntil = now + 1500;
    let best = -1, bestScore = 0;
    for (const it of bw.loot.near(s.x, s.z, 45)) {
      if (b.ignoreLoot.has(it.id) || Math.abs(it.y - s.y) > 6) continue;
      const kind = ITEMS[it.item]?.kind;
      const want = kind === 'forage' ? (s.hp < 95 || s.shield < 95 ? 2 : 0) : kind === 'card' ? (bw.isMateCard(it.r) ? 12 : 0) : kind === 'keycard' ? 0 : wantItem(s, it.item, it.r);
      if (!want) continue;
      const score = want / (1 + Math.hypot(it.x - s.x, it.z - s.z) / 10 + Math.abs(it.y - s.y) / 3);
      if (score > bestScore) { bestScore = score; best = it.id; }
    }
    // chests are worth a detour (more so when you're poorly armed)
    const armed = s.inv.filter((sl) => weaponDef(sl.id)).length;
    for (const c of bw.chestsNear(s.x, s.z, 55)) {
      if (b.ignoreLoot.has(-c.id - 10) || Math.abs(c.y - s.y) > 6) continue;
      const want = c.k === 2 ? 14 : c.k === 1 ? 3 : armed < 2 ? 9 : 5;
      const score = want / (1 + Math.hypot(c.x - s.x, c.z - s.z) / 10 + Math.abs(c.y - s.y) / 3);
      if (score > bestScore) { bestScore = score; best = -c.id - 10; }
    }
    if (best !== b.lootId) b.stuckCheck = { x: s.x, z: s.z, at: now };
    b.lootId = best;
  }
  const it = b.lootId >= 0 ? bw.loot.get(b.lootId) : b.lootId <= -10 ? chestTarget() : undefined;
  if (it) {
    const to = navStep(bw.w, s, it.x, it.y, it.z);
    const dx = to.x - s.x, dz = to.z - s.z;
    const d = Math.hypot(it.x - s.x, it.z - s.z), dy = Math.abs(it.y - s.y);
    cmd.yaw = yawTo(dx, dz);
    if (d > 1.2 || dy > 1.5) { cmd.keys |= K.F; if (d > 8 && Math.hypot(dx, dz) > 6) cmd.keys |= K.SPRINT; }
    if (d < 2 && dy < 1.5) { b.firePulse = !b.firePulse; if (b.firePulse) cmd.keys |= K.USE; }
    // give up on loot we can't reach (behind a wall, on a roof)
    if (now - b.stuckCheck.at > 6000) {
      if (Math.hypot(s.x - b.stuckCheck.x, s.z - b.stuckCheck.z) < 4 || d > 3) { b.ignoreLoot.add(b.lootId); b.lootId = -1; }
      b.stuckCheck = { x: s.x, z: s.z, at: now };
    }
    if (s.grounded && b.rnd() < 0.01) cmd.keys |= K.JUMP;
    return cmd;
  }

  // reload whatever is empty while wandering
  if (s.inv[s.slot] && weaponDef(s.inv[s.slot].id) && s.inv[s.slot].mag < (weaponDef(s.inv[s.slot].id)!.mag)) cmd.keys |= K.RELOAD;
  return wanderCmd(s, b, now, home, roam, cmd);
}
