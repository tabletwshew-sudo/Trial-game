import {
  ACT, AMMO_ITEM, CAR, CHEST_KIND, SUPPLY_FALL, RECALL, ITEM, EF_EMOTE_SHIFT, makeStormPlan, stormAt, inStorm, consumableDef, ENT_BYTES, EF, ITEMS, K, MAP, PM, SIM_DT, SIM_HZ, SPAWN_ISLAND, TEAM_SIZE,
  addToInventory, applyDamage, blastDamage, busPos, decodeInputs, emptySlot, encodeEnt, encodeSnapshot, falloff, getWorld,
  MV, POSE, isLow, makeRoute, resetMove, mulberry32, newPlayerState, rayPlayer, raycastWorld, seatWorld, stepCar, stepPlayer, stepProjectile, surfaceAt, terrainAt,
  weaponDamage, weaponDef, throwableDef, collideBoxes, meleeDef, heldItemId, BODY_R, PICK_SLOT,
  type BusRoute, type CarBody, type FeedCause, type GameEvent, type GameInit, type GamePhase, type InputCmd, type LootView,
  type ChestView, type ClientMsg, type MatchStats, type StormPlan, type PlayerState, type Projectile, type ServerMsg, type ShotEvent, type SimEvents, type SwingEvent, type ThrowEvent, type Vec3, type VehSnap, type World,
} from '@dropzone/shared';
import type { Match } from '../hub.js';

type InventoryMsg = Extract<ClientMsg, { t: 'inv_swap' | 'inv_drop' | 'ammo_drop' }>;
import { botInput, newBrain, planDrop, type BotBrain, type BotTarget, type BotWorld } from './bots.js';
import { LootStore, rollContainer, rollWeapon, spawnIslandLoot, spawnWarmupLoot, type ChestEnt, type LootItem } from './loot.js';

export interface Sock { json: (m: ServerMsg) => void; bin: (b: ArrayBuffer) => void }

interface P {
  idx: number; id: string; name: string; bot: boolean; team: number; skin: number;
  s: PlayerState;
  queue: { seq: number; cmd: InputCmd; view: number }[];
  lastSeq: number;
  budget: number;
  starve: number;
  gone: boolean;
  sock: Sock | null;
  brain: BotBrain | null;
  marker: { x: number; z: number } | null;
  /** Still in the match (not eliminated). */
  alive: boolean;
  kills: number;
  place: number;
  lastHit: { by: number; at: number; w: number; cause: FeedCause } | null;
  knockedBy: number;
  revive: { target: number; t: number } | null;
  bleedAcc: number;
  respawnAt: number;
  spec: number;
  ev: GameEvent[];
  /** Boss/guard NPCs: their post, and how much of incoming damage they actually take. */
  npc?: 'boss' | 'guard';
  post?: { x: number; z: number };
  armor: number;
  /** Recall cards being carried (player indexes). */
  cards: number[];
  stats: MatchStats;
  aliveSince: number;
  lastPos: { x: number; z: number } | null;
}

const NPC_NAMES = [['Warden Vex', 'Rivet', 'Sprocket'], ['Captain Hale', 'Barnacle', 'Tidewell']];
const newStats = (): MatchStats => ({ damage: 0, taken: 0, revives: 0, chests: 0, distance: 0, survivedS: 0, healed: 0 });

interface Veh extends CarBody { id: number; hp: number; seats: number[]; dead: boolean; lastHitBy: number }

export interface MatchOptions { warmupS: number; seed?: number; onEnd: (matchId: string) => void }

const MAX_QUEUE = 40;
const EMPTY_TIMEOUT_MS = 45_000;
const REVIVE_S = 7;
const INTEREST = 500;
const HISTORY = 14; // ticks of positions kept for lag compensation (~460 ms)
const STARVE_TICKS = 15; // ~500 ms without input before the server moves you itself
const HS = 5; // history stride: x, y, z, mode, hitbox pose
const poseOf = (s: PlayerState) => (s.mode === PM.Knocked ? POSE.Knocked : isLow(s) ? POSE.Low : POSE.Stand);
const MAX_REWIND_MS = 300;

export class MatchInstance {
  readonly id: string;
  readonly world: World;
  readonly players: P[] = [];
  readonly loot: LootStore;
  readonly vehicles: Veh[] = [];
  private byId = new Map<string, P>();
  phase: GamePhase = 'warmup';
  route: BusRoute | null = null;
  warmupEndsAt: number;
  private tick = 0;
  private lastNow: number;
  private now: number;
  private botAcc = 0;
  private emptySince: number | null = null;
  private rnd: () => number;
  private projectiles: Projectile[] = [];
  private nextProj = 1;
  readonly chests = new Map<number, ChestEnt>();
  private nextChest = 1;
  private chestAdds: ChestView[] = [];
  private chestOpens: number[] = [];
  private playAt = 0;
  private supplyDrops = 0;
  private hist: { t: number; pos: Float32Array }[] = [];
  private endAt = 0;
  private dbno: boolean;
  storm: StormPlan | null = null;
  private stormAcc = 0;
  private bossAcc = 0;
  private beaconReady: number[];
  /** Things players dropped from their inventory: who, and until when they won't auto-collect it. */
  private droppedBy = new Map<number, { idx: number; until: number }>();
  private cardExpiry = new Map<number, number>();
  ended = false;

  constructor(private match: Match, private opts: MatchOptions, now: number) {
    this.id = match.id;
    // each match gets its own view of the shared world (so vault doors open per match)
    this.world = Object.create(getWorld(opts.seed ?? MAP.seed)) as World;
    this.world.openVaults = new Set();
    this.beaconReady = this.world.beacons.map(() => 0);
    this.rnd = mulberry32((now ^ 0x9e3779b9) >>> 0);
    this.lastNow = this.now = now;
    this.warmupEndsAt = now + opts.warmupS * 1000;
    this.dbno = TEAM_SIZE[match.mode] > 1;
    this.loot = new LootStore(this.world);
    let idx = 0;
    for (const team of match.teams) for (const m of team.members) {
      const p: P = {
        idx: idx++, id: m.id, name: m.name, bot: m.bot, team: team.id, skin: m.skin,
        s: newPlayerState(), queue: [], lastSeq: 0, budget: 4, starve: 0, gone: false, sock: null,
        brain: m.bot ? newBrain(mulberry32(Math.floor(this.rnd() * 2 ** 31))) : null, marker: null,
        alive: true, kills: 0, place: 0, lastHit: null, knockedBy: -1, revive: null, bleedAcc: 0, respawnAt: 0, spec: -1, ev: [],
        armor: 1, cards: [], stats: newStats(), aliveSince: now, lastPos: null,
      };
      p.s.seed = Math.floor(this.rnd() * 2 ** 31);
      this.spawnOnWarmupIsland(p);
      this.players.push(p);
      if (!m.bot) this.byId.set(m.id, p);
    }
    // boss crews: they appear when the dropship leaves
    for (const v of this.world.vaults) {
      const names = NPC_NAMES[v.id % NPC_NAMES.length];
      names.forEach((name, k) => {
        const boss = k === 0;
        const p: P = {
          idx: idx++, id: `npc${v.id}_${k}`, name, bot: true, team: 1000 + v.id, skin: boss ? 8 : 9,
          s: newPlayerState(), queue: [], lastSeq: 0, budget: 4, starve: 0, gone: false, sock: null,
          brain: newBrain(mulberry32(Math.floor(this.rnd() * 2 ** 31))), marker: null,
          alive: false, kills: 0, place: 0, lastHit: null, knockedBy: -1, revive: null, bleedAcc: 0, respawnAt: 0, spec: -1, ev: [],
          npc: boss ? 'boss' : 'guard', post: { x: v.post.x + (k - 1) * 4, z: v.post.z + (k ? 2 : 0) }, armor: boss ? 0.3 : 0.75,
          cards: [], stats: newStats(), aliveSince: now, lastPos: null,
        };
        p.brain!.skill = boss ? 0.85 : 0.55;
        p.brain!.post = p.post;
        p.s.mode = PM.Dead;
        this.players.push(p);
      });
    }
    spawnWarmupLoot(this.world, this.loot, this.rnd);
    // a few chests on the warm-up island to try out
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4, x = SPAWN_ISLAND.x + Math.cos(a) * 26, z = SPAWN_ISLAND.z + Math.sin(a) * 26;
      if (terrainAt(this.world, x, z) < 1.5) continue;
      const c: ChestEnt = { id: this.nextChest++, k: CHEST_KIND.Chest, x, y: surfaceAt(this.world, x, z, 50), z, face: Math.abs(Math.cos(a)) > 0.7 ? (Math.cos(a) > 0 ? 3 : 1) : (Math.sin(a) > 0 ? 2 : 0), open: false };
      this.chests.set(c.id, c);
    }
    this.loot.flush();
    this.spawnVehicles();
  }

  // ------------------------------------------------------------ setup
  private spawnOnWarmupIsland(p: P) {
    const s = p.s;
    s.x = SPAWN_ISLAND.x; s.z = SPAWN_ISLAND.z;
    for (let i = 0; i < 30; i++) {
      const x = SPAWN_ISLAND.x + (this.rnd() * 2 - 1) * 48, z = SPAWN_ISLAND.z + (this.rnd() * 2 - 1) * 48;
      if (Math.hypot(x - SPAWN_ISLAND.x, z - SPAWN_ISLAND.z) > 48 || terrainAt(this.world, x, z) < 2) continue;
      s.x = x; s.z = z;
      break;
    }
    s.y = surfaceAt(this.world, s.x, s.z, 100);
    s.yaw = this.rnd() * Math.PI * 2;
    s.mode = PM.Walk; s.grounded = true; s.vx = s.vy = s.vz = 0; resetMove(s);
    s.hp = 100; s.shield = 0; s.knock = 0; s.act = ACT.None;
    this.resetInventory(s);
    // warm-up loadout: a random gun with ammo
    const [id, r] = rollWeapon(this.rnd, [10, 30, 30, 20, 10]);
    const def = weaponDef(id)!;
    addToInventory(s, id, r, 1, def.mag);
    s.ammo[def.ammo] = def.ammo === 4 ? 6 : 90;
    s.slot = 0;
  }

  private resetInventory(s: PlayerState) {
    s.inv = [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()];
    s.ammo = [0, 0, 0, 0, 0];
    s.slot = PICK_SLOT; s.cd = 0; s.burst = 0; s.reload = 0; s.use = 0; s.bloom = 0;
  }

  private spawnVehicles() {
    // two on the warm-up island to mess around with
    for (const [ox, oz, h] of [[14, 6, 0.4], [-12, -10, 2.2]]) {
      const x = SPAWN_ISLAND.x + ox, z = SPAWN_ISLAND.z + oz;
      this.vehicles.push({ id: this.vehicles.length, x, y: surfaceAt(this.world, x, z, 50), z, vy: 0, vh: h, vs: 0, grounded: true, hp: CAR.maxHp, seats: [-1, -1, -1, -1], dead: false, lastHitBy: -1 });
    }
    const placed: { x: number; z: number }[] = [];
    const roads = this.world.roads.filter((r) => !r.street);
    for (let tries = 0; tries < 600 && this.vehicles.length < 24; tries++) {
      const r = roads[Math.floor(this.rnd() * roads.length)];
      const n = r.pts.length / 2;
      const i = 2 + Math.floor(this.rnd() * (n - 4));
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
      if (terrainAt(this.world, x, z) < 2.5 || placed.some((p) => Math.hypot(p.x - x, p.z - z) < 160)) continue;
      const dx = r.pts[i * 2 + 2] - r.pts[i * 2 - 2], dz = r.pts[i * 2 + 3] - r.pts[i * 2 - 1];
      // park on the verge, facing along the road
      const len = Math.hypot(dx, dz), side = r.width / 2 + 1.6;
      const px = x + (-dz / len) * side, pz = z + (dx / len) * side;
      if (terrainAt(this.world, px, pz) < 2) continue;
      placed.push({ x: px, z: pz });
      this.vehicles.push({
        id: this.vehicles.length, x: px, y: surfaceAt(this.world, px, pz, 500), z: pz, vy: 0, vh: Math.atan2(-dx, -dz) + (this.rnd() < 0.5 ? Math.PI : 0),
        vs: 0, grounded: true, hp: CAR.maxHp, seats: [-1, -1, -1, -1], dead: false, lastHitBy: -1,
      });
    }
  }

  get humans() { return this.players.filter((p) => !p.bot && !p.gone); }
  get alive() { return this.players.filter((p) => p.alive && !p.gone && !p.npc).length; }
  teamsAlive() { return new Set(this.players.filter((p) => p.alive && !p.gone && !p.npc).map((p) => p.team)).size; }
  has(userId: string) { const p = this.byId.get(userId); return !!p && !p.gone; }
  private mates(p: P) { return this.players.filter((q) => q.team === p.team && q !== p); }

  // ------------------------------------------------------------ connections
  join(userId: string, sock: Sock, now: number) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    p.sock = sock;
    p.queue.length = 0;
    const init: GameInit = {
      matchId: this.id, seed: this.world.seed, mode: this.match.mode, you: p.idx,
      phase: this.phase, warmupEndsAt: this.warmupEndsAt, route: this.route, serverTime: now,
      players: this.players.map(({ idx, name, team, skin, bot, npc }) => ({ idx, name, team, skin, bot, npc })),
      gone: this.players.filter((q) => q.gone || !q.alive).map((q) => q.idx),
      markers: this.players.filter((q) => q.team === p.team && q.marker).map((q) => ({ idx: q.idx, ...q.marker! })),
      loot: this.loot.all(),
      chests: [...this.chests.values()].map(chestView),
      alive: this.alive, teamsAlive: this.teamsAlive(),
      kills: this.players.map((q) => q.kills),
      storm: this.storm ? { t0: this.storm.t0, circles: this.storm.circles } : null,
      vaultsOpen: [...this.world.openVaults!],
      beacons: this.beaconReady,
    };
    sock.json({ t: 'game_init', init });
    if (!p.alive && p.place) sock.json({ t: 'result', result: this.resultFor(p, null, p.place === 1) });
    if (p.cards.length) sock.json({ t: 'cards', cards: p.cards });
  }

  disconnect(userId: string) {
    const p = this.byId.get(userId);
    if (p) p.sock = null;
  }

  leave(userId: string) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    if (p.alive && this.phase !== 'warmup') this.eliminate(p, 'left');
    p.gone = true; p.sock = null;
    this.exitVehicle(p);
    for (const q of this.players) if (q.sock) q.sock.json({ t: 'game_gone', idx: p.idx });
  }

  private broadcast(m: ServerMsg, team?: number) {
    for (const p of this.players) if (p.sock && (team === undefined || p.team === team)) p.sock.json(m);
  }
  private emitNear(x: number, z: number, r: number, e: GameEvent, except?: P) {
    for (const p of this.players) {
      if (!p.sock || p === except) continue;
      const c = this.interestCenter(p);
      if ((c.x - x) ** 2 + (c.z - z) ** 2 < r * r) p.ev.push(e);
    }
  }

  // ------------------------------------------------------------ client input
  onBinary(userId: string, view: DataView) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    const pkt = decodeInputs(view);
    if (!pkt) return;
    pkt.cmds.forEach((cmd, i) => {
      const seq = (pkt.firstSeq + i) >>> 0;
      const last = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
      if (seq <= last) return;
      p.queue.push({ seq, cmd, view: pkt.viewTime });
    });
    if (p.queue.length > MAX_QUEUE) p.queue.splice(0, p.queue.length - MAX_QUEUE);
  }

  onMarker(userId: string, x?: number, z?: number) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    const ok = typeof x === 'number' && typeof z === 'number' && Number.isFinite(x) && Number.isFinite(z) && Math.abs(x) <= MAP.size / 2 && Math.abs(z) <= MAP.size / 2;
    p.marker = ok ? { x: x!, z: z! } : null;
    this.broadcast(ok ? { t: 'game_marker', idx: p.idx, x, z } : { t: 'game_marker', idx: p.idx }, p.team);
  }

  /**
   * Inventory screen actions. Swapping keeps whatever you were holding in your hands (the
   * selection follows it). Dropped things land just in front of you, like a death drop.
   */
  onInventory(userId: string, msg: InventoryMsg) {
    const p = this.byId.get(userId);
    if (!p || p.gone || !p.alive) return;
    const s = p.s;
    if (s.mode !== PM.Walk || s.act !== ACT.None) return;
    const ok = (i: unknown): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < 5;
    if (msg.t === 'inv_swap') {
      if (!ok(msg.a) || !ok(msg.b) || msg.a === msg.b) return;
      [s.inv[msg.a], s.inv[msg.b]] = [s.inv[msg.b], s.inv[msg.a]];
      if (s.slot === msg.a) s.slot = msg.b; else if (s.slot === msg.b) s.slot = msg.a;
      return;
    }
    if (this.droppedBy.size > 300) for (const [id, d] of this.droppedBy) if (this.now > d.until) this.droppedBy.delete(id);
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const at = { x: s.x + fx * 1.3, z: s.z + fz * 1.3 };
    // don't push it through a wall: drop at your feet if something's in the way
    if (raycastWorld(this.world, { x: s.x, y: s.y + 0.8, z: s.z }, { x: fx, y: 0, z: fz }, 1.5, false).kind !== 'none') { at.x = s.x; at.z = s.z; }
    const y = surfaceAt(this.world, at.x, at.z, s.y + 1.5);
    if (msg.t === 'inv_drop') {
      if (!ok(msg.slot)) return;
      const sl = s.inv[msg.slot];
      if (!sl.id) return;
      const isWeapon = !!weaponDef(sl.id);
      const n = isWeapon ? 1 : Math.max(1, Math.min(sl.n, Number.isInteger(msg.n) ? (msg.n as number) : sl.n));
      const it = this.loot.add(sl.id, sl.r, isWeapon ? sl.mag : n, at.x, y, at.z);
      this.droppedBy.set(it.id, { idx: p.idx, until: this.now + 3000 });
      if (isWeapon || n >= sl.n) s.inv[msg.slot] = emptySlot(); else sl.n -= n;
      if (s.slot === msg.slot) { s.reload = 0; s.use = 0; s.burst = 0; }
      return;
    }
    if (msg.t === 'ammo_drop') {
      if (!Number.isInteger(msg.ammo) || msg.ammo < 0 || msg.ammo > 4) return;
      const n = Math.max(0, Math.min(s.ammo[msg.ammo], Math.floor(Number(msg.n) || 0)));
      if (!n) return;
      s.ammo[msg.ammo] -= n;
      const it = this.loot.add(AMMO_ITEM[msg.ammo], 0, n, at.x, y, at.z);
      this.droppedBy.set(it.id, { idx: p.idx, until: this.now + 3000 });
    }
  }

  // ------------------------------------------------------------ lag compensation
  private record() {
    const pos = new Float32Array(this.players.length * HS);
    this.players.forEach((p, i) => { const o = i * HS; pos[o] = p.s.x; pos[o + 1] = p.s.y; pos[o + 2] = p.s.z; pos[o + 3] = p.s.mode; pos[o + 4] = poseOf(p.s); });
    this.hist.push({ t: this.now, pos });
    if (this.hist.length > HISTORY) this.hist.shift();
  }

  /** Where player i was at server time t (interpolated between recorded ticks). */
  private posAt(i: number, t: number): { x: number; y: number; z: number; mode: number; pose: number } {
    const s = this.players[i].s;
    const h = this.hist;
    if (!h.length || t >= h[h.length - 1].t) return { x: s.x, y: s.y, z: s.z, mode: s.mode, pose: poseOf(s) };
    let b = h.length - 1;
    while (b > 0 && h[b - 1].t > t) b--;
    const B = h[b], A = h[Math.max(0, b - 1)];
    const k = B.t > A.t ? Math.max(0, Math.min(1, (t - A.t) / (B.t - A.t))) : 1;
    const o = i * HS;
    return { x: A.pos[o] + (B.pos[o] - A.pos[o]) * k, y: A.pos[o + 1] + (B.pos[o + 1] - A.pos[o + 1]) * k, z: A.pos[o + 2] + (B.pos[o + 2] - A.pos[o + 2]) * k, mode: B.pos[o + 3], pose: (k < 0.5 ? A : B).pos[o + 4] };
  }

  // ------------------------------------------------------------ shooting
  private hittable(q: P, by: P) {
    return q !== by && !q.gone && q.alive && q.team !== by.team && q.s.mode !== PM.Bus && q.s.mode !== PM.Dead;
  }

  private resolveShot(p: P, e: ShotEvent, viewTime: number) {
    const def = weaponDef(e.weapon);
    if (!def) return;
    if (def.projectile) {
      const d = e.dirs[0];
      // start a metre ahead, or just short of a wall that's closer (so it can't appear beyond it)
      const near = raycastWorld(this.world, e.origin, d, 1, false);
      const k = near.kind === 'none' ? 1 : Math.max(0.02, near.t - 0.1);
      this.spawnProjectile(p, e.weapon, { x: e.origin.x + d.x * k, y: e.origin.y + d.y * k, z: e.origin.z + d.z * k }, { x: d.x * def.projectile.speed, y: d.y * def.projectile.speed, z: d.z * def.projectile.speed }, 0, true);
      return;
    }
    const t = p.bot ? this.now : Math.max(this.now - MAX_REWIND_MS, Math.min(this.now, viewTime));
    const o = e.origin;
    const perTarget = new Map<number, { dmg: number; head: boolean; at: Vec3 }>();
    const perCar = new Map<number, number>();
    const ends: number[] = [];
    const base = weaponDamage(def, e.rarity);
    // candidate players: anyone within range of the line (cheap pre-filter)
    const cands: { q: P; x: number; y: number; z: number; pose: number }[] = [];
    for (const q of this.players) {
      if (!this.hittable(q, p)) continue;
      const at = this.posAt(q.idx, t);
      if ((at.x - o.x) ** 2 + (at.z - o.z) ** 2 > (def.range + 3) ** 2) continue;
      cands.push({ q, x: at.x, y: at.y, z: at.z, pose: q.s.mode === PM.Knocked ? POSE.Knocked : at.pose });
    }
    for (const d of e.dirs) {
      const wh = raycastWorld(this.world, o, d, def.range);
      let bestT = wh.t, kind = wh.kind === 'none' ? 5 : wh.kind === 'water' ? 3 : 0;
      let victim: (typeof cands)[number] | null = null, head = false, car: Veh | null = null;
      for (const c of cands) {
        const hit = rayPlayer(o, d, c.x, c.y, c.z, bestT, c.pose);
        if (hit) { bestT = hit.t; victim = c; head = hit.head; }
      }
      for (const v of this.vehicles) {
        if (v.dead || (v.x - o.x) ** 2 + (v.z - o.z) ** 2 > (def.range + 5) ** 2) continue;
        if (v.seats.includes(p.idx)) continue;
        const fx = -Math.sin(v.vh), fz = -Math.cos(v.vh);
        for (const k of [-1.1, 0, 1.1]) {
          const cx = v.x + fx * k - o.x, cy = v.y + 0.9 - o.y, cz = v.z + fz * k - o.z;
          const b = cx * d.x + cy * d.y + cz * d.z, c2 = cx * cx + cy * cy + cz * cz - 1.05 * 1.05;
          const disc = b * b - c2;
          if (disc < 0) continue;
          const th = b - Math.sqrt(disc);
          if (th > 0 && th < bestT) { bestT = th; car = v; victim = null; }
        }
      }
      if (victim) {
        const dmg = base * falloff(def, bestT) * (head ? def.headMul : 1);
        const acc = perTarget.get(victim.q.idx) ?? { dmg: 0, head: false, at: { x: o.x + d.x * bestT, y: o.y + d.y * bestT, z: o.z + d.z * bestT } };
        acc.dmg += dmg; acc.head ||= head;
        perTarget.set(victim.q.idx, acc);
        kind = victim.q.s.shield > 0 && victim.q.s.mode !== PM.Knocked ? 1 : 2;
      } else if (car) { perCar.set(car.id, (perCar.get(car.id) ?? 0) + base * falloff(def, bestT)); kind = 4; }
      ends.push(r1(o.x + d.x * bestT), r1(o.y + d.y * bestT), r1(o.z + d.z * bestT), kind);
    }
    this.emitNear(o.x, o.z, 320, { e: 'shot', i: p.idx, w: e.weapon, o: [r1(o.x), r1(o.y), r1(o.z)], h: ends }, p.bot ? undefined : p);
    for (const [idx, hit] of perTarget) this.damage(this.players[idx], hit.dmg, p, 'gun', e.weapon, hit.head, hit.at);
    for (const [id, dmg] of perCar) this.damageCar(this.vehicles[id], dmg, p.idx);
    // bots hear gunfire
    for (const q of this.players) if (q.brain && q.alive && (q.s.x - o.x) ** 2 + (q.s.z - o.z) ** 2 < 60 * 60) q.brain.heardFrom = { x: o.x, z: o.z, at: this.now };
  }

  /**
   * A pickaxe swing hits the nearest enemy in front of you within reach (never through a wall),
   * or else a car, or else chips the wall or ground it lands on.
   */
  private resolveMelee(p: P, e: SwingEvent, viewTime: number) {
    const def = meleeDef(ITEM.pickaxe)!;
    const s = p.s, o = e.origin, d = e.dir;
    const t = p.bot ? this.now : Math.max(this.now - MAX_REWIND_MS, Math.min(this.now, viewTime));
    const hl = Math.hypot(d.x, d.z) || 1, fx = d.x / hl, fz = d.z / hl;
    const chest = { x: s.x, y: s.y + 1.2, z: s.z };
    let best: { q: P; at: Vec3 } | null = null, bestD = Infinity;
    for (const q of this.players) {
      if (!this.hittable(q, p)) continue;
      const at = this.posAt(q.idx, t);
      const dx = at.x - chest.x, dz = at.z - chest.z, dist = Math.hypot(dx, dz);
      if (dist > def.range + BODY_R || Math.abs(at.y - s.y) > 1.9) continue;
      if (dist > 0.35 && (dx * fx + dz * fz) / dist < 0.6) continue; // in front of you (about ±53°)
      const ty = at.y + (q.s.mode === PM.Knocked ? 0.4 : 1.1);
      const lx = at.x - chest.x, ly = ty - chest.y, lz = at.z - chest.z, ll = Math.hypot(lx, ly, lz) || 1;
      if (raycastWorld(this.world, chest, { x: lx / ll, y: ly / ll, z: lz / ll }, ll, false).kind !== 'none') continue;
      if (dist < bestD) { bestD = dist; best = { q, at: { x: at.x - (dx / (dist || 1)) * BODY_R, y: ty, z: at.z - (dz / (dist || 1)) * BODY_R } }; }
    }
    let kind = 5, hit: Vec3 = { x: o.x + d.x * def.range, y: o.y + d.y * def.range, z: o.z + d.z * def.range };
    if (best) {
      kind = best.q.s.shield > 0 && best.q.s.mode !== PM.Knocked ? 1 : 2;
      hit = best.at;
      this.damage(best.q, def.damage, p, 'gun', ITEM.pickaxe, false, best.at);
    } else {
      const car = this.vehicles.find((v) => !v.dead && !v.seats.includes(p.idx) && Math.hypot(v.x - chest.x, v.z - chest.z) < def.range + 1.8
        && ((v.x - chest.x) * fx + (v.z - chest.z) * fz) > 0);
      if (car) { kind = 4; hit = { x: car.x, y: car.y + 0.9, z: car.z }; this.damageCar(car, def.damage, p.idx); }
      else {
        const wh = raycastWorld(this.world, o, d, def.range, false);
        if (wh.kind !== 'none') { kind = 0; hit = { x: o.x + d.x * wh.t, y: o.y + d.y * wh.t, z: o.z + d.z * wh.t }; }
      }
    }
    this.emitNear(o.x, o.z, 120, { e: 'melee', i: p.idx, h: [r1(hit.x), r1(hit.y), r1(hit.z), kind] }, p.bot ? undefined : p);
    for (const q of this.players) if (q.brain && q.alive && (q.s.x - o.x) ** 2 + (q.s.z - o.z) ** 2 < 25 * 25) q.brain.heardFrom = { x: o.x, z: o.z, at: this.now };
  }

  private damage(q: P, amount: number, by: P | null, cause: FeedCause, weapon: number, head = false, at?: Vec3) {
    if (!q.alive || q.s.mode === PM.Dead || q.s.mode === PM.Bus) return;
    const knockedBefore = q.s.mode === PM.Knocked;
    if (q.npc) amount *= q.armor;
    const [sh, hp] = applyDamage(q.s, amount, cause === 'fall' || cause === 'water' || cause === 'storm');
    q.stats.taken += sh + hp;
    if (by && by !== q && by.team !== q.team) by.stats.damage += sh + hp;
    // a bot keeps count of how hard it has hit its target (it pushes when it's a lot)
    if (by?.brain && by.brain.enemy === q.idx) { by.brain.dealt += sh + hp; by.brain.dealtAt = this.now; }
    if (sh + hp <= 0) return;
    q.lastHit = { by: by ? by.idx : -1, at: this.now, w: weapon, cause };
    if (by && by !== q) {
      q.ev.push({ e: 'hurt', d: sh + hp, from: [r1(by.s.x), r1(by.s.z)] });
      if (by.sock) {
        const p = at ?? { x: q.s.x, y: q.s.y + 1.4, z: q.s.z };
        by.ev.push({ e: 'dmg', t: q.idx, d: sh + hp, sh: sh > 0 && hp === 0, hd: head, p: [r1(p.x), r1(p.y), r1(p.z)], ko: undefined });
      }
      if (q.brain && by.alive) { q.brain.enemy = by.idx; q.brain.enemySeenAt = this.now; q.brain.lastPos = { x: by.s.x, y: by.s.y, z: by.s.z }; if (q.brain.enemyFirstSeen === 0 || this.now - q.brain.enemyFirstSeen > 8000) q.brain.enemyFirstSeen = this.now; }
    } else q.ev.push({ e: 'hurt', d: sh + hp, from: null });
    this.checkDown(q, knockedBefore);
  }

  private checkDown(q: P, wasKnocked = q.s.mode === PM.Knocked) {
    if (!q.alive) return;
    if (q.s.mode === PM.Knocked) {
      if (wasKnocked && q.s.knock <= 0) this.eliminate(q, q.lastHit && this.now - q.lastHit.at < 2000 ? q.lastHit.cause : 'bleed');
      return;
    }
    if (q.s.hp > 0) return;
    if (this.phase === 'warmup') {
      this.feed(q, q.lastHit?.by ?? -1, false, q.lastHit?.cause ?? 'gun');
      this.exitVehicle(q);
      q.s.mode = PM.Dead; q.respawnAt = this.now + 3000;
      return;
    }
    const up = this.mates(q).filter((m) => m.alive && m.s.mode !== PM.Knocked && m.s.mode !== PM.Dead);
    if (this.dbno && !q.npc && up.length > 0 && q.lastHit?.cause !== 'left') {
      this.exitVehicle(q);
      q.s.mode = PM.Knocked; q.s.knock = 100; q.s.shield = 0; q.s.hp = 0; q.s.act = ACT.None;
      q.s.reload = 0; q.s.use = 0; q.revive = null; q.bleedAcc = 0;
      q.knockedBy = q.lastHit?.by ?? -1;
      this.feed(q, q.knockedBy, true, q.lastHit?.cause ?? 'gun');
      if (q.knockedBy >= 0 && this.players[q.knockedBy].sock) this.players[q.knockedBy].ev.push({ e: 'dmg', t: q.idx, d: 0, sh: false, hd: false, p: [r1(q.s.x), r1(q.s.y + 1), r1(q.s.z)], ko: true });
      return;
    }
    this.eliminate(q, q.lastHit?.cause ?? 'gun');
  }

  private feed(v: P, k: number, knock: boolean, cause: FeedCause) {
    this.broadcast({ t: 'ev', ev: [{ e: 'feed', k, v: v.idx, w: k >= 0 ? (v.lastHit?.w ?? 0) : 0, knock, cause }] });
  }

  private eliminate(q: P, cause: FeedCause) {
    if (!q.alive) return;
    const recent = q.lastHit && this.now - q.lastHit.at < 30_000 ? q.lastHit.by : -1;
    const killer = recent >= 0 && recent !== q.idx ? recent : q.knockedBy >= 0 ? q.knockedBy : -1;
    this.exitVehicle(q);
    this.cancelRevivesOn(q);
    if (q.npc) {
      // bosses and guards: drop their gear (and the boss's keycard), no placement, no elimination credit
      this.loot.dropInventory(q.s);
      if (q.npc === 'boss') this.loot.drop(ITEM.keycard, 0, 1, q.s.x, q.s.y, q.s.z, 9);
      this.resetInventory(q.s);
      q.s.mode = PM.Dead; q.alive = false; q.s.hp = 0; q.s.shield = 0;
      this.feed(q, killer, false, cause);
      if (q.npc === 'boss') for (const p of this.players) if (p.sock && (p.s.x - q.s.x) ** 2 + (p.s.z - q.s.z) ** 2 < 150 * 150) p.sock.json({ t: 'boss', idx: q.idx, name: q.name, hp: 0 });
      return;
    }
    q.stats.survivedS = Math.round((this.now - Math.max(this.playAt || this.now, q.aliveSince)) / 1000);
    if (this.phase !== 'warmup') {
      this.loot.dropInventory(q.s);
      // carried recall cards fall where you fell; and your own card drops for your squad
      const team = this.players.filter((m) => m.team === q.team && m !== q);
      for (const c of q.cards) this.dropCard(c, q.s.x, q.s.y, q.s.z);
      q.cards = [];
      if (this.dbno && team.some((m) => m.alive && m.s.mode !== PM.Knocked && m.s.mode !== PM.Dead)) this.dropCard(q.idx, q.s.x, q.s.y, q.s.z);
    }
    this.resetInventory(q.s);
    q.s.mode = PM.Dead; q.s.act = ACT.None; q.s.hp = 0; q.s.shield = 0; q.s.knock = 0; q.s.vx = q.s.vz = 0;
    q.alive = false; q.revive = null;
    if (killer >= 0 && this.players[killer].team !== q.team) this.players[killer].kills++;
    this.feed(q, killer, false, cause);

    // everyone else on the team knocked? then the team is out
    const team = this.players.filter((m) => m.team === q.team);
    if (team.every((m) => !m.alive || m.s.mode === PM.Knocked)) for (const m of team) if (m.alive) this.eliminate(m, 'bleed');
    if (team.every((m) => !m.alive)) {
      const place = this.teamsAlive() + 1;
      for (const m of team) {
        m.place = place;
        if (m.alive === false && m.stats.survivedS === 0) m.stats.survivedS = Math.round((this.now - Math.max(this.playAt || this.now, m.aliveSince)) / 1000);
        if (m.sock) m.sock.json({ t: 'result', result: this.resultFor(m, killer >= 0 ? this.players[killer].name : null, false) });
      }
    }
    this.broadcast({ t: 'alive', alive: this.alive, teams: this.teamsAlive() });
    this.checkVictory();
  }

  private resultFor(p: P, killer: string | null, win: boolean) {
    return {
      place: p.place || 1, kills: p.kills, killer, win, teams: this.match.teams.length, stats: { ...p.stats, distance: Math.round(p.stats.distance), damage: Math.round(p.stats.damage), taken: Math.round(p.stats.taken), healed: Math.round(p.stats.healed) },
      squad: this.players.filter((m) => m.team === p.team).map((m) => ({ name: m.name, kills: m.kills, you: m === p })),
    };
  }

  private checkVictory() {
    if (this.phase === 'warmup' || this.endAt) return;
    const alive = this.players.filter((p) => p.alive && !p.gone && !p.npc);
    const teams = new Set(alive.map((p) => p.team));
    if (teams.size > 1) return;
    this.endAt = this.now + 15_000;
    for (const p of this.players) {
      if (!teams.has(p.team)) continue;
      p.place = 1;
      if (p.alive) p.stats.survivedS = Math.round((this.now - Math.max(this.playAt || this.now, p.aliveSince)) / 1000);
      if (p.sock) p.sock.json({ t: 'result', result: this.resultFor(p, null, true) });
    }
  }

  // ------------------------------------------------------------ revive
  private cancelRevivesOn(q: P) {
    for (const r of this.players) if (r.revive?.target === q.idx) { r.revive = null; r.s.act = ACT.None; }
  }

  private stepRevives(dt: number) {
    for (const p of this.players) {
      if (!p.revive) continue;
      if (p.revive.target <= -1000) { this.stepRecall(p, dt); continue; }
      const q = this.players[p.revive.target];
      const ok = p.alive && p.s.mode === PM.Walk && (p.s.keys & K.USE) && q.alive && q.s.mode === PM.Knocked && Math.hypot(q.s.x - p.s.x, q.s.z - p.s.z) < 3.2;
      if (!ok) { p.revive = null; p.s.act = ACT.None; continue; }
      p.revive.t += dt;
      if (p.revive.t >= REVIVE_S) {
        p.revive = null; p.s.act = ACT.None;
        q.s.mode = PM.Walk; q.s.hp = 30; q.s.knock = 0; q.knockedBy = -1;
        p.stats.revives++;
        this.broadcast({ t: 'ev', ev: [{ e: 'revived', i: q.idx, by: p.idx }] }, q.team);
      }
    }
    // bleed out
    for (const q of this.players) {
      if (!q.alive || q.s.mode !== PM.Knocked) continue;
      const beingRevived = this.players.some((r) => r.revive?.target === q.idx);
      if (beingRevived) continue;
      q.bleedAcc += dt * 1.6;
      if (q.bleedAcc >= 1) { const n = Math.floor(q.bleedAcc); q.bleedAcc -= n; q.s.knock = Math.max(0, q.s.knock - n); q.lastHit = q.lastHit && this.now - q.lastHit.at < 2000 ? q.lastHit : { by: q.knockedBy, at: this.now - 5000, w: 0, cause: 'bleed' }; this.checkDown(q, true); }
    }
  }

  // ------------------------------------------------------------ recall cards + beacons
  private dropCard(idx: number, x: number, y: number, z: number) {
    const it = this.loot.drop(ITEM.card, idx, 1, x, y, z, 5);
    this.cardExpiry.set(it.id, this.now + RECALL.cardLifeS * 1000);
  }

  private stepRecall(p: P, dt: number) {
    const bi = -1000 - p.revive!.target, b = this.world.beacons[bi];
    const ok = p.alive && p.s.mode === PM.Walk && (p.s.keys & K.USE) && p.cards.length && b && Math.hypot(b.x - p.s.x, b.z - p.s.z) < 3.4 && this.now >= this.beaconReady[bi];
    if (!ok) { p.revive = null; p.s.act = ACT.None; return; }
    p.revive!.t += dt;
    if (p.revive!.t < RECALL.holdS) return;
    p.revive = null; p.s.act = ACT.None;
    for (const idx of p.cards) {
      const q = this.players[idx];
      if (q.gone || q.alive || q.team !== p.team) continue;
      const s = q.s;
      q.alive = true; q.place = 0; q.lastHit = null; q.knockedBy = -1; q.spec = -1; q.aliveSince = this.now;
      this.resetInventory(s);
      addToInventory(s, ITEM.pistol, 0, 1, 16); s.ammo[0] = 36;
      s.mode = PM.Fall; s.grounded = false; s.hp = 100; s.shield = 0; s.knock = 0; s.act = ACT.None;
      s.x = b.x + (this.rnd() - 0.5) * 12; s.z = b.z + (this.rnd() - 0.5) * 12; s.y = b.y + RECALL.dropHeight; s.vx = s.vz = 0; s.vy = -10;
      this.broadcast({ t: 'ev', ev: [{ e: 'recalled', i: q.idx, by: p.idx }] }, p.team);
    }
    p.cards = [];
    p.sock?.json({ t: 'cards', cards: [] });
    this.beaconReady[bi] = this.now + RECALL.cooldownS * 1000;
    this.broadcast({ t: 'beacons', ready: this.beaconReady });
    this.broadcast({ t: 'alive', alive: this.alive, teams: this.teamsAlive() });
  }

  /** Revive progress (0..1) for HUD, if this player is reviving or being revived. */
  reviveProgress(p: P): number {
    if (p.revive && p.revive.target <= -1000) return p.revive.t / RECALL.holdS;
    if (p.revive) return p.revive.t / REVIVE_S;
    const r = this.players.find((x) => x.revive?.target === p.idx);
    return r ? r.revive!.t / REVIVE_S : 0;
  }

  // ------------------------------------------------------------ E: interact
  private interact(p: P) {
    const s = p.s;
    if (s.mode === PM.Drive || s.mode === PM.Ride) return this.exitVehicle(p);
    if (s.mode !== PM.Walk || s.act !== ACT.None || s.mv === MV.Climb || s.mv === MV.Mantle) return;
    // 1) revive a knocked teammate
    const downed = this.mates(p).find((q) => q.alive && q.s.mode === PM.Knocked && Math.hypot(q.s.x - s.x, q.s.z - s.z) < 2.8 && Math.abs(q.s.y - s.y) < 2);
    if (downed && !this.players.some((r) => r.revive?.target === downed.idx)) {
      p.revive = { target: downed.idx, t: 0 }; s.act = ACT.Reviving; s.vx = s.vz = 0;
      return;
    }
    // 2) get in a car (bots don't drive: their E presses are for loot and revives)
    const car = p.bot ? undefined : this.vehicles.find((v) => !v.dead && Math.hypot(v.x - s.x, v.z - s.z) < 3.8 && Math.abs(v.y - s.y) < 2.5 && v.seats.includes(-1));
    if (car) return this.enterVehicle(p, car);
    // 3) a vault door, if you have the keycard
    const kc = s.inv.findIndex((sl) => sl.id === ITEM.keycard);
    if (kc >= 0) for (const v of this.world.vaults) {
      if (this.world.openVaults!.has(v.id) || Math.hypot(v.door.x - s.x, v.door.z - s.z) > 2.8) continue;
      this.world.openVaults!.add(v.id);
      s.inv[kc] = emptySlot();
      this.broadcast({ t: 'vaults', open: [...this.world.openVaults!] });
      this.emitNear(v.x, v.z, 200, { e: 'vault', id: v.id, by: p.idx });
      return;
    }
    // 4) a recall beacon, if you're carrying cards
    if (p.cards.length) {
      const bi = this.world.beacons.findIndex((b) => Math.hypot(b.x - s.x, b.z - s.z) < 3.4);
      if (bi >= 0 && this.now >= this.beaconReady[bi]) { p.revive = { target: -1000 - bi, t: 0 }; s.act = ACT.Reviving; s.vx = s.vz = 0; return; }
    }
    // 5) open the chest / pick up the item you're looking at (or the nearest)
    const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
    const score = (x: number, z: number) => {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      return d + (1 - (d > 0.01 ? (dx * fx + dz * fz) / d : 1)) * 1.5;
    };
    let best: LootItem | null = null, bestScore = Infinity;
    for (const it of this.loot.near(s.x, s.z, 2.6)) {
      if (Math.abs(it.y - s.y) > 2) continue;
      if (it.item === ITEM.card && this.players[it.r]?.team !== p.team) continue; // only teammates can carry a card
      const sc = score(it.x, it.z);
      if (sc < bestScore) { bestScore = sc; best = it; }
    }
    let chest: ChestEnt | null = null;
    for (const c of this.chests.values()) {
      if (c.open || (c.k === CHEST_KIND.Supply && c.y !== c.landY)) continue;
      if (Math.hypot(c.x - s.x, c.z - s.z) > 2.6 || Math.abs(c.y - s.y) > 2) continue;
      const sc = score(c.x, c.z) - 0.3; // chests win ties
      if (sc < bestScore) { bestScore = sc; chest = c; best = null; }
    }
    if (chest) this.openChest(p, chest);
    else if (best) this.pickUp(p, best);
  }

  private openChest(p: P, c: ChestEnt) {
    c.open = true;
    p.stats.chests++;
    this.chestOpens.push(c.id);
    rollContainer(this.loot, this.rnd, c.rich ? CHEST_KIND.Supply : c.k, c.x, c.y, c.z, c.face);
    this.emitNear(c.x, c.z, 120, { e: 'opened', id: c.id, by: p.idx });
  }

  private addChest(c: ChestEnt) { this.chests.set(c.id, c); this.chestAdds.push(chestView(c)); }

  /** Supply drops: a few times a match, somewhere near the action. */
  private stepSupply(now: number) {
    for (const c of this.chests.values()) {
      if (c.k !== CHEST_KIND.Supply || c.y === c.landY) continue;
      c.y = Math.max(c.landY!, c.y0! - (SUPPLY_FALL * (now - c.t0!)) / 1000);
    }
    if (this.phase !== 'play' || this.endAt) return;
    const due = [40_000, 140_000, 240_000][this.supplyDrops];
    if (due === undefined || now - this.playAt < due) return;
    this.supplyDrops++;
    const alive = this.players.filter((q) => q.alive && !q.gone);
    const cx = alive.reduce((n, q) => n + q.s.x, 0) / Math.max(1, alive.length), cz = alive.reduce((n, q) => n + q.s.z, 0) / Math.max(1, alive.length);
    for (let t = 0; t < 80; t++) {
      const x = cx + (this.rnd() - 0.5) * 500, z = cz + (this.rnd() - 0.5) * 500;
      const g = terrainAt(this.world, x, z), top = surfaceAt(this.world, x, z, 500);
      if (g < 2 || Math.abs(top - g) > 0.2) continue; // on open ground, not a roof or the sea
      const c: ChestEnt = { id: this.nextChest++, k: CHEST_KIND.Supply, x, y: 260, z, face: 0, open: false, t0: now, y0: 260, landY: top };
      this.addChest(c);
      this.broadcast({ t: 'ev', ev: [{ e: 'supply', id: c.id, x: Math.round(x), z: Math.round(z) }] });
      break;
    }
  }

  private pickUp(p: P, it: LootItem) {
    const s = p.s, def = ITEMS[it.item];
    if (!def) return;
    if (def.kind === 'card') {
      const q = this.players[it.r];
      if (!q || q.team !== p.team || q.alive || q.gone) return;
      if (!p.cards.includes(it.r)) p.cards.push(it.r);
      this.loot.remove(it.id); this.cardExpiry.delete(it.id);
      p.sock?.json({ t: 'cards', cards: p.cards });
      return;
    }
    if (def.kind === 'forage') {
      s.hp = Math.min(100, s.hp + def.heal);
      s.shield = Math.min(100, s.shield + def.shield);
      this.loot.remove(it.id);
      return;
    }
    if (def.kind === 'ammo') {
      const took = addToInventory(s, it.item, it.r, it.n, 0);
      if (took >= it.n) this.loot.remove(it.id); else if (took > 0) this.loot.setCount(it.id, it.n - took);
      return;
    }
    const isWeapon = def.kind === 'weapon';
    const freeAt = s.inv.findIndex((sl) => sl.id === 0);
    const took = addToInventory(s, it.item, it.r, isWeapon ? 1 : it.n, isWeapon ? it.n : 0);
    if (took > 0) {
      if (isWeapon || took >= it.n) this.loot.remove(it.id); else this.loot.setCount(it.id, it.n - took);
      // picked up a gun while swinging the pickaxe: it goes straight into your hands
      if (isWeapon && s.slot === PICK_SLOT && freeAt >= 0 && s.inv[freeAt].id === it.item) { s.slot = freeAt; s.cd = Math.max(s.cd, 14); }
      return;
    }
    // full while holding the pickaxe: nothing to swap with (select an item first)
    if (s.slot === PICK_SLOT) return;
    // full: swap with what's in your hands
    const cur = s.inv[s.slot];
    if (cur.id) this.loot.drop(cur.id, cur.r, ITEMS[cur.id]?.kind === 'weapon' ? cur.mag : cur.n, s.x, s.y, s.z, 1);
    s.inv[s.slot] = { id: it.item, r: it.r, n: isWeapon ? 1 : it.n, mag: isWeapon ? it.n : 0 };
    s.reload = 0; s.use = 0; s.burst = 0; s.cd = Math.max(s.cd, 14);
    this.loot.remove(it.id);
  }

  private autoPickup(p: P) {
    const s = p.s;
    if (s.mode !== PM.Walk) return;
    for (const it of this.loot.near(s.x, s.z, 1.5)) {
      const def = ITEMS[it.item];
      if (def?.kind !== 'ammo' || Math.abs(it.y - s.y) > 1.5) continue;
      // ammo you just dropped doesn't jump straight back into your pockets
      const dropped = this.droppedBy.get(it.id);
      if (dropped && dropped.idx === p.idx && this.now < dropped.until) continue;
      const took = addToInventory(s, it.item, 0, it.n, 0);
      if (took >= it.n) this.loot.remove(it.id); else if (took > 0) this.loot.setCount(it.id, it.n - took);
    }
  }

  // ------------------------------------------------------------ vehicles
  private enterVehicle(p: P, v: Veh) {
    const seat = v.seats.indexOf(-1);
    if (seat < 0) return;
    const s = p.s;
    v.seats[seat] = p.idx;
    s.veh = v.id; s.seat = seat; s.reload = 0; s.use = 0; s.burst = 0; s.act = ACT.None;
    if (seat === 0) { s.mode = PM.Drive; s.x = v.x; s.y = v.y; s.z = v.z; s.vy = v.vy; s.vh = v.vh; s.vs = v.vs; s.grounded = v.grounded; }
    else { s.mode = PM.Ride; const at = seatWorld(v, seat); s.x = at.x; s.y = at.y; s.z = at.z; s.vh = v.vh; s.vs = 0; }
    s.vx = s.vz = 0;
  }

  private exitVehicle(p: P) {
    const s = p.s;
    if (s.veh < 0) return;
    const v = this.vehicles[s.veh];
    if (v) {
      if (s.mode === PM.Drive) { v.x = s.x; v.y = s.y; v.z = s.z; v.vy = s.vy; v.vh = s.vh; v.vs = s.vs; v.grounded = s.grounded; }
      if (v.seats[s.seat] === p.idx) v.seats[s.seat] = -1;
      // step out to the side of your seat; try the other side if that's a wall
      const side = s.seat % 2 === 0 ? -1 : 1;
      for (const k of [side, -side]) {
        const at = seatWorld(v, s.seat);
        const rx = Math.cos(v.vh) * k * 1.9, rz = -Math.sin(v.vh) * k * 1.9;
        const probe = { x: at.x + rx, y: v.y, z: at.z + rz, vx: 0, vz: 0 };
        if (!collideBoxes(this.world, probe) || k === -side) { s.x = probe.x; s.z = probe.z; break; }
      }
      s.y = surfaceAt(this.world, s.x, s.z, v.y + 2);
      s.vx = -Math.sin(v.vh) * v.vs * 0.3; s.vz = -Math.cos(v.vh) * v.vs * 0.3;
    }
    if (s.mode === PM.Drive || s.mode === PM.Ride) s.mode = PM.Walk;
    s.veh = -1; s.seat = 0; s.vs = 0; s.grounded = true; s.vy = 0;
  }

  private damageCar(v: Veh, dmg: number, by: number) {
    if (v.dead) return;
    v.hp -= dmg;
    v.lastHitBy = by;
    if (v.hp > 0) return;
    v.dead = true;
    for (const idx of v.seats) if (idx >= 0) this.exitVehicle(this.players[idx]);
    this.emitNear(v.x, v.z, 400, { e: 'car_boom', id: v.id, p: [r1(v.x), r1(v.y + 1), r1(v.z)] });
    this.explode({ x: v.x, y: v.y + 1, z: v.z }, 6, 55, by >= 0 ? this.players[by] : null, -1);
  }

  private stepVehicles(steps: number) {
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const driver = v.seats[0] >= 0 ? this.players[v.seats[0]] : null;
      if (driver) { v.x = driver.s.x; v.y = driver.s.y; v.z = driver.s.z; v.vy = driver.s.vy; v.vh = driver.s.vh; v.vs = driver.s.vs; v.grounded = driver.s.grounded; }
      else if (Math.abs(v.vs) > 0.01 || !v.grounded) for (let i = 0; i < steps; i++) stepCar(v, 0, 0, true, this.world, SIM_DT);
      for (let seat = 1; seat < 4; seat++) {
        const idx = v.seats[seat];
        if (idx < 0) continue;
        const s = this.players[idx].s, at = seatWorld(v, seat);
        s.x = at.x; s.y = at.y; s.z = at.z; s.vh = v.vh;
      }
    }
  }

  // ------------------------------------------------------------ projectiles
  private spawnProjectile(p: P, item: number, o: Vec3, v: Vec3, fuse: number, rocket: boolean) {
    const pr: Projectile = { id: this.nextProj++, item, owner: p.idx, x: o.x, y: o.y, z: o.z, vx: v.x, vy: v.y, vz: v.z, age: 0, fuse, rocket, done: false };
    this.projectiles.push(pr);
    this.emitNear(o.x, o.z, 400, { e: 'proj', id: pr.id, it: item, p: [r2(o.x), r2(o.y), r2(o.z)], v: [r2(v.x), r2(v.y), r2(v.z)], fuse });
  }

  private onThrow(p: P, e: ThrowEvent) {
    const def = throwableDef(e.item);
    if (def) this.spawnProjectile(p, e.item, e.origin, e.vel, def.fuse, false);
  }

  private stepProjectiles(dt: number) {
    for (const pr of this.projectiles) {
      if (pr.done) continue;
      let res = stepProjectile(pr, this.world, dt);
      const owner = this.players[pr.owner];
      if (pr.rocket && res === 'fly') {
        for (const q of this.players) if (this.hittable(q, owner) && (q.s.x - pr.x) ** 2 + (q.s.y + 1 - pr.y) ** 2 + (q.s.z - pr.z) ** 2 < 1.4 ** 2) res = 'explode';
        for (const v of this.vehicles) if (!v.dead && !v.seats.includes(pr.owner) && (v.x - pr.x) ** 2 + (v.y + 1 - pr.y) ** 2 + (v.z - pr.z) ** 2 < 2.4 ** 2) res = 'explode';
      }
      if (res === 'explode') {
        pr.done = true;
        const wdef = weaponDef(pr.item), tdef = throwableDef(pr.item);
        const radius = wdef?.projectile?.radius ?? tdef?.radius ?? 4, blast = wdef?.projectile?.blast ?? tdef?.blast ?? 80;
        this.emitNear(pr.x, pr.z, 400, { e: 'boom', id: pr.id, p: [r2(pr.x), r2(pr.y), r2(pr.z)], r: radius });
        this.explode(pr, radius, blast, owner, pr.item);
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.done);
  }

  private explode(at: Vec3, radius: number, blast: number, by: P | null, item: number) {
    for (const q of this.players) {
      if (!q.alive || q.s.mode === PM.Bus || q.s.mode === PM.Dead) continue;
      if (by && q.team === by.team) continue; // no friendly fire (including yourself)
      const cy = q.s.y + 1;
      const d = Math.hypot(q.s.x - at.x, cy - at.y, q.s.z - at.z);
      if (d >= radius) continue;
      // walls block blasts
      const dir = { x: (q.s.x - at.x) / (d || 1), y: (cy - at.y) / (d || 1), z: (q.s.z - at.z) / (d || 1) };
      const wall = raycastWorld(this.world, at, dir, d, false);
      if (wall.kind === 'building' && wall.t < d - 0.4) continue;
      this.damage(q, blastDamage(blast, radius, d), by, 'blast', item, false, { x: q.s.x, y: cy, z: q.s.z });
    }
    for (const v of this.vehicles) {
      if (v.dead) continue;
      const d = Math.hypot(v.x - at.x, v.y + 1 - at.y, v.z - at.z);
      if (d < radius + 1) this.damageCar(v, blastDamage(blast, radius + 1, d) * 2, by ? by.idx : -1);
    }
  }

  // ------------------------------------------------------------ phases
  private startBus(now: number) {
    this.phase = 'bus';
    this.route = makeRoute(this.rnd, now);
    const b = busPos(this.route, now);
    // warm-up loot goes away; the island gets its loot
    for (const it of this.loot.all()) this.loot.remove(it.id);
    for (const c of this.chests.values()) if (!c.open) { c.open = true; this.chestOpens.push(c.id); }
    // vault chests (rich loot) sit behind the locked door
    for (const v of this.world.vaults) for (const sp of v.chests) this.addChest({ id: this.nextChest++, k: CHEST_KIND.Chest, x: sp.x, y: sp.y, z: sp.z, face: sp.face, open: false, rich: true });
    for (const c of spawnIslandLoot(this.world, this.loot, this.rnd, () => this.nextChest++)) this.addChest(c);
    const teamTargets = new Map<number, { x: number; z: number }>();
    for (const p of this.players) {
      if (p.gone) continue;
      if (p.npc) { this.spawnNpc(p); continue; }
      this.exitVehicle(p);
      p.alive = true; p.stats = newStats(); p.aliveSince = now; p.cards = []; p.revive = null; p.lastHit = null; p.knockedBy = -1; p.kills = 0;
      const s = p.s;
      this.resetInventory(s);
      s.hp = 100; s.shield = 0; s.knock = 0; s.act = ACT.None;
      s.mode = PM.Bus; s.grounded = false;
      s.x = b.x; s.y = b.y; s.z = b.z; s.vx = s.vy = s.vz = 0;
      if (!p.brain) continue;
      const mate = this.players.find((q) => q.team === p.team && !q.bot && !q.gone);
      p.brain.follow = mate ? mate.idx : -1;
      p.brain.enemy = -1; p.brain.lootId = -1; p.brain.ignoreLoot.clear();
      if (!teamTargets.has(p.team)) {
        const poi = this.world.pois[Math.floor(this.rnd() * this.world.pois.length)];
        teamTargets.set(p.team, { x: poi.x + (this.rnd() - 0.5) * poi.r, z: poi.z + (this.rnd() - 0.5) * poi.r });
      }
      planDrop(p.brain, this.route, teamTargets.get(p.team)!);
      if (mate) p.brain.jumpAt = Infinity;
    }
    this.broadcast({ t: 'game_phase', phase: 'bus', route: this.route, serverTime: now });
    this.broadcast({ t: 'alive', alive: this.alive, teams: this.teamsAlive() });
  }

  private spawnNpc(p: P) {
    const s = p.s, post = p.post!;
    this.resetInventory(s);
    s.x = post.x; s.z = post.z; s.y = surfaceAt(this.world, s.x, s.z, 500);
    s.mode = PM.Walk; s.grounded = true; s.vx = s.vy = s.vz = 0; s.act = ACT.None; resetMove(s);
    s.hp = 100; s.shield = p.npc === 'boss' ? 100 : 50; s.yaw = this.rnd() * 6.28;
    if (p.npc === 'boss') { addToInventory(s, ITEM.ar, 4, 1, 30); addToInventory(s, ITEM.pump, 4, 1, 5); }
    else addToInventory(s, this.rnd() < 0.5 ? ITEM.smg : ITEM.ar, 2, 1, 30);
    s.ammo = [999, 999, 999, 999, 0];
    p.alive = true; p.lastHit = null;
  }

  private eject(p: P, now: number) {
    if (p.s.mode !== PM.Bus || !this.route) return;
    const b = busPos(this.route, now);
    const len = Math.hypot(this.route.x1 - this.route.x0, this.route.z1 - this.route.z0);
    const dx = (this.route.x1 - this.route.x0) / len, dz = (this.route.z1 - this.route.z0) / len;
    const side = (this.rnd() - 0.5) * 6;
    p.s.mode = PM.Fall; p.s.grounded = false;
    p.s.x = b.x - dz * side; p.s.z = b.z + dx * side; p.s.y = b.y - 7;
    p.s.vx = dx * 12; p.s.vz = dz * 12; p.s.vy = -6;
  }

  // ------------------------------------------------------------ stepping players
  private events(p: P, view: number): SimEvents {
    return {
      shot: (e) => this.resolveShot(p, e, view),
      swing: (e) => this.resolveMelee(p, e, view),
      thrown: (e) => this.onThrow(p, e),
      used: (item) => { const d = consumableDef(item); if (d) p.stats.healed += d.heal + d.shield; },
      fallDamage: (dmg) => {
        p.lastHit = { by: p.lastHit && this.now - p.lastHit.at < 10_000 ? p.lastHit.by : -1, at: this.now, w: 0, cause: 'fall' };
        p.ev.push({ e: 'hurt', d: dmg, from: null });
      },
    };
  }

  private runCmd(p: P, cmd: InputCmd, view: number) {
    const s = p.s;
    if ((cmd.keys & K.USE) && !(s.keys & K.USE)) this.interact(p);
    if (s.mode === PM.Bus) {
      if (this.route && this.now >= this.route.doorsAt && (cmd.keys & K.JUMP) && !(s.keys & K.JUMP)) this.eject(p, this.now);
      s.keys = cmd.keys; s.yaw = cmd.yaw; s.pitch = cmd.pitch;
      return;
    }
    const hpBefore = s.hp;
    stepPlayer(s, cmd, this.world, this.events(p, view));
    if (s.mode === PM.Drive && s.veh >= 0) { const v = this.vehicles[s.veh]; v.x = s.x; v.y = s.y; v.z = s.z; v.vh = s.vh; v.vs = s.vs; }
    if (s.hp < hpBefore || (s.hp <= 0 && s.mode === PM.Walk)) this.checkDown(p);
  }

  private stepStorm(dt: number) {
    if (!this.storm || this.phase !== 'play') return;
    this.stormAcc += dt;
    if (this.stormAcc < 1) return;
    this.stormAcc -= 1;
    const st = stormAt(this.storm, this.now);
    for (const q of this.players) {
      if (!q.alive || q.npc || q.gone || q.s.mode === PM.Bus || q.s.mode === PM.Dead) continue;
      if (!inStorm(st, q.s.x, q.s.z)) continue;
      q.ev.push({ e: 'storm_hurt', d: st.dps });
      q.lastHit = q.lastHit && this.now - q.lastHit.at < 5000 && q.lastHit.cause !== 'storm' ? q.lastHit : { by: -1, at: this.now, w: 0, cause: 'storm' };
      this.damage(q, st.dps, null, 'storm', 0);
    }
  }

  onSpecNext(userId: string, dir: number) {
    const p = this.byId.get(userId);
    if (!p || p.s.mode !== PM.Dead) return;
    const cands = this.players.filter((q) => q.alive && !q.gone && !q.npc).sort((a, b) => Number(b.team === p.team) - Number(a.team === p.team) || a.idx - b.idx);
    if (!cands.length) return;
    const i = cands.findIndex((q) => q.idx === p.spec);
    p.spec = cands[(((i + (dir >= 0 ? 1 : -1)) % cands.length) + cands.length) % cands.length].idx;
    p.sock?.json({ t: 'spec', idx: p.spec });
  }

  private stepBot(p: P, steps: number) {
    const b = p.brain!, s = p.s, now = this.now;
    const mate = b.follow >= 0 ? this.players[b.follow] : null;
    const following = mate && !mate.gone && mate.alive;
    if (s.mode === PM.Dead) return;
    if (s.mode === PM.Bus && this.route && now >= this.route.doorsAt) {
      if (following) {
        if (mate!.s.mode === PM.Bus) b.jumpAt = Infinity;
        else if (b.jumpAt === Infinity) b.jumpAt = now + 300 + b.rnd() * 700;
      }
      if (now >= b.jumpAt) this.eject(p, now);
      return;
    }
    const home = p.post ?? (this.phase === 'warmup' ? SPAWN_ISLAND : following && b.enemy < 0 ? mate!.s : b.target);
    const roam = p.post ? 6 : this.phase === 'warmup' ? 42 : following ? 14 : 32;
    const cmd = botInput(s, b, this.botWorld(p), home, roam);
    for (let i = 0; i < steps; i++) {
      this.runCmd(p, cmd, now);
      cmd.keys &= ~(K.JUMP | K.USE | K.RELOAD);
      cmd.slot = 0;
      if (!p.alive || s.mode === PM.Dead) break;
    }
  }

  private botWorld(p: P): BotWorld {
    return {
      w: this.world, loot: this.loot, now: this.now, combat: this.phase !== 'warmup',
      storm: this.storm && this.phase === 'play' ? stormAt(this.storm, this.now) : null,
      cards: p.cards.length,
      beaconNear: (x, z) => {
        let best: { x: number; z: number } | null = null, bd = 700;
        this.world.beacons.forEach((b, i) => { const d = Math.hypot(b.x - x, b.z - z); if (d < bd && this.now >= this.beaconReady[i]) { bd = d; best = b; } });
        return best;
      },
      isMateCard: (r) => this.players[r]?.team === p.team && !this.players[r].alive,
      enemiesNear: (x, z, r) => {
        const out: BotTarget[] = [];
        for (const q of this.players) {
          if (!this.hittable(q, p)) continue;
          if ((q.s.x - x) ** 2 + (q.s.z - z) ** 2 > r * r) continue;
          out.push({ idx: q.idx, x: q.s.x, y: q.s.y, z: q.s.z, knocked: q.s.mode === PM.Knocked, speed: Math.hypot(q.s.vx, q.s.vz) });
        }
        return out;
      },
      downedMates: () => this.mates(p).filter((q) => q.alive && q.s.mode === PM.Knocked).map((q) => ({ idx: q.idx, x: q.s.x, y: q.s.y, z: q.s.z, knocked: true })),
      chestsNear: (x, z, r) => {
        const out: { id: number; x: number; y: number; z: number; k: number }[] = [];
        for (const c of this.chests.values()) if (!c.open && (c.k !== CHEST_KIND.Supply || c.y === c.landY) && (c.x - x) ** 2 + (c.z - z) ** 2 < r * r) out.push({ id: c.id, x: c.x, y: c.y, z: c.z, k: c.k });
        return out;
      },
    };
  }

  private stepHuman(p: P, elapsedMs: number) {
    p.budget = Math.min(12, p.budget + (elapsedMs * SIM_HZ) / 1000 * 1.08);
    let ran = 0;
    while (p.queue.length && p.budget >= 1) {
      const { seq, cmd, view } = p.queue.shift()!;
      p.budget -= 1;
      this.runCmd(p, cmd, view);
      p.lastSeq = seq;
      ran++;
    }
    if (ran) { p.starve = 0; return; }
    // no input for a while (tab hidden, bad connection): keep physics moving with neutral input.
    // Half a second of grace first: school wifi often stalls for a few hundred ms, and stepping
    // without the player's real inputs would snap them back when the packets arrive.
    if (++p.starve > STARVE_TICKS && p.s.mode !== PM.Bus) {
      const held = p.s.keys;
      const idle: InputCmd = { keys: 0, yaw: p.s.yaw, pitch: p.s.pitch };
      this.runCmd(p, idle, this.now); this.runCmd(p, idle, this.now);
      p.s.keys = held; // a key still down after the stall is not a fresh press
    }
  }

  /** Advance the match. Call ~30 times a second with the current server clock. */
  step(now: number) {
    if (this.ended) return;
    const elapsed = Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = this.now = now;
    this.tick++;
    const dt = elapsed / 1000;

    if (this.phase === 'warmup' && now >= this.warmupEndsAt) this.startBus(now);
    if (this.phase === 'bus' && this.route) {
      const b = busPos(this.route, now);
      for (const p of this.players) if (p.s.mode === PM.Bus) { p.s.x = b.x; p.s.y = b.y; p.s.z = b.z; }
      if (now >= this.route.ejectAt) for (const p of this.players) if (!p.gone) this.eject(p, now);
      if (now >= this.route.t1) { this.phase = 'play'; this.playAt = now; this.broadcast({ t: 'game_phase', phase: 'play', route: null, serverTime: now });
        this.storm = makeStormPlan(this.world, Math.floor(this.rnd() * 2 ** 31), now);
        this.broadcast({ t: 'storm', plan: { t0: this.storm.t0, circles: this.storm.circles } }); }
    }
    if (this.phase === 'warmup') for (const p of this.players) if (p.s.mode === PM.Dead && !p.gone && !p.npc && now >= p.respawnAt) this.spawnOnWarmupIsland(p);

    this.botAcc += (elapsed * SIM_HZ) / 1000;
    const botSteps = Math.min(8, Math.floor(this.botAcc));
    this.botAcc -= botSteps;
    for (const p of this.players) {
      if (p.gone) continue;
      if (p.bot) { if (botSteps) this.stepBot(p, botSteps); }
      else this.stepHuman(p, elapsed);
    }
    this.stepVehicles(botSteps);
    this.stepProjectiles(dt);
    this.stepRevives(dt);
    this.stepSupply(now);
    this.stepStorm(dt);
    for (const [id, until] of this.cardExpiry) if (now >= until) { this.loot.remove(id); this.cardExpiry.delete(id); }
    for (const p of this.players) {
      if (!p.alive || p.npc || this.phase === 'warmup') { p.lastPos = null; continue; }
      if (p.lastPos && (p.s.mode === PM.Walk || p.s.mode === PM.Drive)) p.stats.distance += Math.min(20, Math.hypot(p.s.x - p.lastPos.x, p.s.z - p.lastPos.z));
      p.lastPos = { x: p.s.x, z: p.s.z };
    }
    this.bossAcc += dt;
    if (this.bossAcc >= 0.5) {
      this.bossAcc = 0;
      for (const b of this.players) {
        if (b.npc !== 'boss' || !b.alive) continue;
        for (const p of this.players) if (p.sock && !p.npc && (p.s.x - b.s.x) ** 2 + (p.s.z - b.s.z) ** 2 < 110 * 110) p.sock.json({ t: 'boss', idx: b.idx, name: b.name, hp: (b.s.hp + b.s.shield) / 200 });
      }
    }
    for (const p of this.players) if (p.alive && !p.gone) this.autoPickup(p);
    // anyone who swam off the edge of the world
    for (const p of this.players) if (p.alive && p.s.mode === PM.Walk && p.s.y < -20) { p.lastHit = { by: -1, at: now, w: 0, cause: 'water' }; applyDamage(p.s, 999, true); this.checkDown(p); }
    this.record();
    this.sendSnapshots(now);

    if (this.endAt && now >= this.endAt) return this.end('finished');
    const humans = this.humans;
    if (humans.length === 0) return this.end('empty');
    if (humans.some((p) => p.sock)) this.emptySince = null;
    else if (this.emptySince === null) this.emptySince = now;
    else if (now - this.emptySince > EMPTY_TIMEOUT_MS) this.end('abandoned');
  }

  private interestCenter(p: P) {
    if (p.s.mode === PM.Dead && p.spec >= 0) return this.players[p.spec].s;
    return p.s;
  }

  private pickSpectate(p: P) {
    if (p.s.mode !== PM.Dead || this.phase === 'warmup') return -1;
    if (p.spec >= 0 && this.players[p.spec].alive && !this.players[p.spec].npc) return p.spec;
    const mate = this.mates(p).find((q) => q.alive && !q.gone);
    if (mate) return mate.idx;
    const killer = p.lastHit?.by ?? -1;
    if (killer >= 0 && this.players[killer].alive) return killer;
    const any = this.players.find((q) => q.alive && !q.gone && !q.npc);
    return any ? any.idx : -1;
  }

  private sendSnapshots(now: number) {
    const listeners = this.players.filter((p) => p.sock);
    const deltas = this.loot.flush();
    const chestAdds = this.chestAdds, chestOpens = this.chestOpens;
    this.chestAdds = []; this.chestOpens = [];
    if (!listeners.length) { for (const p of this.players) p.ev.length = 0; return; }
    const n = this.players.length;
    const block = new Uint8Array(n * ENT_BYTES);
    const visible: boolean[] = [];
    let count = 0;
    for (const q of this.players) {
      const s = q.s;
      const show = !q.gone && s.mode !== PM.Dead;
      visible.push(show);
      if (!show) continue;
      const held = s.slot === PICK_SLOT ? { id: heldItemId(s), r: 0 } : s.inv[s.slot];
      const flags = (s.grounded ? EF.GROUNDED : 0) | (s.keys & K.ADS ? EF.ADS : 0) | (s.keys & K.CROUCH ? EF.CROUCH : 0) | (s.use > 0 ? EF.USING : 0) | (s.reload > 0 ? EF.RELOADING : 0) | (s.keys & K.SPRINT && Math.hypot(s.vx, s.vz) > 6 ? EF.SPRINT : 0) | ((s.emote & 3) << EF_EMOTE_SHIFT);
      encodeEnt({ idx: q.idx, x: s.x, y: s.y, z: s.z, yaw: s.mode === PM.Drive ? s.vh : s.yaw, pitch: s.pitch, mode: s.mode, flags, item: held?.id ?? 0, rarity: held?.r ?? 0, mv: s.mv, mt: s.mt }, block, count * ENT_BYTES);
      count++;
    }
    const vehs: VehSnap[] = this.vehicles.filter((v) => !v.dead).map((v) => ({ id: v.id, x: v.x, y: v.y, z: v.z, vh: v.vh, vs: v.vs, hp: v.hp, driver: v.seats[0] >= 0 }));
    const sub = new Uint8Array(n * ENT_BYTES);
    for (const p of listeners) {
      const spec = this.pickSpectate(p);
      if (spec !== p.spec) { p.spec = spec; p.sock!.json({ t: 'spec', idx: spec }); }
      const c = this.interestCenter(p);
      // interest management: teammates always, everyone else within range
      let k = 0;
      for (let i = 0, j = 0; i < n; i++) {
        if (!visible[i]) continue;
        const q = this.players[i];
        if (q.team === p.team || (q.s.x - c.x) ** 2 + (q.s.z - c.z) ** 2 < INTEREST * INTEREST || q.s.mode === PM.Fall || q.s.mode === PM.Glide) {
          sub.set(block.subarray(j * ENT_BYTES, (j + 1) * ENT_BYTES), k * ENT_BYTES); k++;
        }
        j++;
      }
      p.sock!.bin(encodeSnapshot(this.tick, now, p.lastSeq, p.s, sub, k, vehs));
      if (deltas.add.length || deltas.del.length) p.sock!.json({ t: 'loot', add: deltas.add as LootView[], del: deltas.del });
      if (chestAdds.length || chestOpens.length) p.sock!.json({ t: 'chests', add: chestAdds, open: chestOpens });
      const rp = this.reviveProgress(p);
      if (rp > 0) p.ev.push({ e: 'revived', i: -1, by: Math.round(rp * 100) });
      if (p.ev.length) { p.sock!.json({ t: 'ev', ev: p.ev }); p.ev = []; }
    }
    for (const p of this.players) if (!p.sock) p.ev.length = 0;
  }

  end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.broadcast({ t: 'game_end', reason });
    this.opts.onEnd(this.id);
  }
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const chestView = (c: ChestEnt): ChestView => ({ id: c.id, k: c.k, x: c.x, y: c.k === CHEST_KIND.Supply ? c.landY! : c.y, z: c.z, face: c.face, open: c.open, t0: c.t0, y0: c.y0 });
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Owns every running match and routes player traffic to the right one. */
export class Games {
  private matches = new Map<string, MatchInstance>();
  private byUser = new Map<string, MatchInstance>();
  private socks = new Map<string, Sock>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: { warmupS: number; onEnd: (matchId: string) => void; now?: () => number }) {}
  private now() { return (this.opts.now ?? Date.now)(); }

  start() { this.timer = setInterval(() => this.stepAll(), 1000 / 30); }
  stop() { if (this.timer) clearInterval(this.timer); }
  stepAll() {
    const now = this.now();
    for (const m of this.matches.values()) {
      try { m.step(now); } catch (e) { console.error(`[match ${m.id}] crashed`, e); m.end('error'); }
    }
  }
  get size() { return this.matches.size; }
  get(matchId: string) { return this.matches.get(matchId); }

  create(match: Match) {
    const inst = new MatchInstance(match, {
      warmupS: this.opts.warmupS,
      onEnd: (id) => {
        this.matches.delete(id);
        for (const [u, m] of this.byUser) if (m.id === id) this.byUser.delete(u);
        this.opts.onEnd(id);
      },
    }, this.now());
    this.matches.set(inst.id, inst);
    for (const t of match.teams) for (const m of t.members) if (!m.bot) this.byUser.set(m.id, inst);
    return inst;
  }

  attach(userId: string, sock: Sock) { this.socks.set(userId, sock); }
  detach(userId: string, sock: Sock) {
    if (this.socks.get(userId) !== sock) return;
    this.socks.delete(userId);
    this.byUser.get(userId)?.disconnect(userId);
  }
  join(userId: string) {
    const sock = this.socks.get(userId), m = this.byUser.get(userId);
    if (sock && m) m.join(userId, sock, this.now());
  }
  leave(userId: string) {
    const m = this.byUser.get(userId);
    this.byUser.delete(userId);
    m?.leave(userId);
  }
  onBinary(userId: string, view: DataView) { this.byUser.get(userId)?.onBinary(userId, view); }
  onMarker(userId: string, x?: number, z?: number) { this.byUser.get(userId)?.onMarker(userId, x, z); }
  onSpecNext(userId: string, dir: number) { this.byUser.get(userId)?.onSpecNext(userId, dir); }
  onInventory(userId: string, msg: InventoryMsg) { this.byUser.get(userId)?.onInventory(userId, msg); }
}
