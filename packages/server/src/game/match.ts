import {
  K, MAP, PM, SIM_HZ, SPAWN_ISLAND, busPos, decodeInputs, encodeEnts, encodeSnapshot, getWorld, makeRoute,
  mulberry32, newPlayerState, stepPlayer, surfaceAt, terrainAt,
  type BusRoute, type EntSnap, type GameInit, type GamePhase, type InputCmd, type PlayerState, type ServerMsg, type World,
} from '@dropzone/shared';
import type { Match } from '../hub.js';
import { botInput, newBrain, planDrop, type BotBrain } from './bots.js';

export interface Sock { json: (m: ServerMsg) => void; bin: (b: ArrayBuffer) => void }

interface P {
  idx: number; id: string; name: string; bot: boolean; team: number; skin: number;
  s: PlayerState;
  queue: { seq: number; cmd: InputCmd }[];
  lastSeq: number;
  budget: number;
  starve: number;
  gone: boolean;
  sock: Sock | null;
  brain: BotBrain | null;
  marker: { x: number; z: number } | null;
}

export interface MatchOptions { warmupS: number; seed?: number; onEnd: (matchId: string) => void }

const MAX_QUEUE = 40;
const EMPTY_TIMEOUT_MS = 45_000;

export class MatchInstance {
  readonly id: string;
  readonly world: World;
  readonly players: P[] = [];
  private byId = new Map<string, P>();
  phase: GamePhase = 'warmup';
  route: BusRoute | null = null;
  warmupEndsAt: number;
  private tick = 0;
  private lastNow: number;
  private botAcc = 0;
  private emptySince: number | null = null;
  private rnd: () => number;
  ended = false;

  constructor(private match: Match, private opts: MatchOptions, now: number) {
    this.id = match.id;
    this.world = getWorld(opts.seed ?? MAP.seed);
    this.rnd = mulberry32((now ^ 0x9e3779b9) >>> 0);
    this.lastNow = now;
    this.warmupEndsAt = now + opts.warmupS * 1000;
    let idx = 0;
    for (const team of match.teams) for (const m of team.members) {
      const p: P = {
        idx: idx++, id: m.id, name: m.name, bot: m.bot, team: team.id, skin: m.skin,
        s: newPlayerState(), queue: [], lastSeq: 0, budget: 4, starve: 0, gone: false, sock: null,
        brain: m.bot ? newBrain(mulberry32(Math.floor(this.rnd() * 2 ** 31))) : null, marker: null,
      };
      this.spawnOnWarmupIsland(p);
      this.players.push(p);
      if (!m.bot) this.byId.set(m.id, p);
    }
  }

  private spawnOnWarmupIsland(p: P) {
    for (let i = 0; i < 30; i++) {
      const x = SPAWN_ISLAND.x + (this.rnd() * 2 - 1) * 48, z = SPAWN_ISLAND.z + (this.rnd() * 2 - 1) * 48;
      if (Math.hypot(x - SPAWN_ISLAND.x, z - SPAWN_ISLAND.z) > 48 || terrainAt(this.world, x, z) < 2) continue;
      p.s.x = x; p.s.z = z;
      break;
    }
    if (p.s.x === 0) { p.s.x = SPAWN_ISLAND.x; p.s.z = SPAWN_ISLAND.z; }
    p.s.y = surfaceAt(this.world, p.s.x, p.s.z, 100);
    p.s.yaw = this.rnd() * Math.PI * 2;
  }

  get humans() { return this.players.filter((p) => !p.bot && !p.gone); }
  get alive() { return this.players.filter((p) => !p.gone).length; }
  has(userId: string) { const p = this.byId.get(userId); return !!p && !p.gone; }

  // ------------------------------------------------------------ connections
  join(userId: string, sock: Sock, now: number) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    p.sock = sock;
    p.queue.length = 0;
    const init: GameInit = {
      matchId: this.id, seed: this.world.seed, mode: this.match.mode, you: p.idx,
      phase: this.phase, warmupEndsAt: this.warmupEndsAt, route: this.route, serverTime: now,
      players: this.players.map(({ idx, name, team, skin, bot }) => ({ idx, name, team, skin, bot })),
      gone: this.players.filter((q) => q.gone).map((q) => q.idx),
      markers: this.players.filter((q) => q.team === p.team && q.marker).map((q) => ({ idx: q.idx, ...q.marker! })),
    };
    sock.json({ t: 'game_init', init });
  }

  disconnect(userId: string) {
    const p = this.byId.get(userId);
    if (p) p.sock = null;
  }

  leave(userId: string) {
    const p = this.byId.get(userId);
    if (!p || p.gone) return;
    p.gone = true; p.sock = null;
    this.broadcast({ t: 'game_gone', idx: p.idx });
  }

  private broadcast(m: ServerMsg, team?: number) {
    for (const p of this.players) if (p.sock && (team === undefined || p.team === team)) p.sock.json(m);
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
      if (seq <= last) return; // duplicate or out of order
      p.queue.push({ seq, cmd });
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

  // ------------------------------------------------------------ simulation
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

  private startBus(now: number) {
    this.phase = 'bus';
    this.route = makeRoute(this.rnd, now);
    const b = busPos(this.route, now);
    const teamTargets = new Map<number, { x: number; z: number }>();
    for (const p of this.players) {
      if (p.gone) continue;
      p.s.mode = PM.Bus; p.s.grounded = false;
      p.s.x = b.x; p.s.y = b.y; p.s.z = b.z; p.s.vx = p.s.vy = p.s.vz = 0;
      if (!p.brain) continue;
      const mate = this.players.find((q) => q.team === p.team && !q.bot && !q.gone);
      p.brain.follow = mate ? mate.idx : -1;
      if (!teamTargets.has(p.team)) {
        const poi = this.world.pois[Math.floor(this.rnd() * this.world.pois.length)];
        teamTargets.set(p.team, { x: poi.x + (this.rnd() - 0.5) * poi.r, z: poi.z + (this.rnd() - 0.5) * poi.r });
      }
      planDrop(p.brain, this.route, teamTargets.get(p.team)!);
      if (mate) p.brain.jumpAt = Infinity;
    }
    this.broadcast({ t: 'game_phase', phase: 'bus', route: this.route, serverTime: now });
  }

  private stepBot(p: P, now: number, steps: number) {
    const b = p.brain!, s = p.s;
    const mate = b.follow >= 0 ? this.players[b.follow] : null;
    const following = mate && !mate.gone;
    if (s.mode === PM.Bus && this.route && now >= this.route.doorsAt) {
      if (following) {
        // filler teammates wait for their human, then jump a moment later
        if (mate!.s.mode === PM.Bus) b.jumpAt = Infinity;
        else if (b.jumpAt === Infinity) b.jumpAt = now + 300 + b.rnd() * 700;
      }
      if (now >= b.jumpAt) this.eject(p, now);
    }
    const home = this.phase === 'warmup' ? SPAWN_ISLAND : following ? mate!.s : b.target;
    const roam = this.phase === 'warmup' ? 42 : following ? 14 : 32;
    const cmd = botInput(s, b, now, this.world, home, roam);
    for (let i = 0; i < steps; i++) {
      stepPlayer(s, cmd, this.world);
      cmd.keys &= ~K.JUMP; // jump is a tap
    }
  }

  private stepHuman(p: P, now: number, elapsedMs: number) {
    p.budget = Math.min(12, p.budget + (elapsedMs * SIM_HZ) / 1000 * 1.08);
    let ran = 0;
    while (p.queue.length && p.budget >= 1) {
      const { seq, cmd } = p.queue.shift()!;
      p.budget -= 1;
      if (p.s.mode === PM.Bus && this.route && now >= this.route.doorsAt && cmd.keys & K.JUMP && !(p.s.keys & K.JUMP)) {
        this.eject(p, now);
        p.s.keys = cmd.keys; p.s.yaw = cmd.yaw; p.s.pitch = cmd.pitch;
      } else stepPlayer(p.s, cmd, this.world);
      p.lastSeq = seq;
      ran++;
    }
    if (ran) { p.starve = 0; return; }
    // no input for a while (tab hidden, bad connection): keep physics moving with neutral input
    if (++p.starve > 9) {
      const idle: InputCmd = { keys: 0, yaw: p.s.yaw, pitch: 0 };
      const held = p.s.keys;
      stepPlayer(p.s, idle, this.world); stepPlayer(p.s, idle, this.world);
      p.s.keys = held; // remember what was held, so a key still down after the stall is not a fresh press
    }
  }

  /** Advance the match. Call ~30 times a second with the current server clock. */
  step(now: number) {
    if (this.ended) return;
    const elapsed = Math.min(250, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.tick++;

    if (this.phase === 'warmup' && now >= this.warmupEndsAt) this.startBus(now);
    if (this.phase === 'bus' && this.route) {
      const b = busPos(this.route, now);
      for (const p of this.players) if (p.s.mode === PM.Bus) { p.s.x = b.x; p.s.y = b.y; p.s.z = b.z; }
      if (now >= this.route.ejectAt) for (const p of this.players) if (!p.gone) this.eject(p, now);
      if (now >= this.route.t1) { this.phase = 'play'; this.broadcast({ t: 'game_phase', phase: 'play', route: null, serverTime: now }); }
    }

    this.botAcc += (elapsed * SIM_HZ) / 1000;
    const botSteps = Math.min(8, Math.floor(this.botAcc));
    this.botAcc -= botSteps;
    for (const p of this.players) {
      if (p.gone) continue;
      if (p.bot) { if (botSteps) this.stepBot(p, now, botSteps); }
      else this.stepHuman(p, now, elapsed);
    }

    // snapshots
    const listeners = this.players.filter((p) => p.sock);
    if (listeners.length) {
      const ents: EntSnap[] = [];
      for (const p of this.players) if (!p.gone) ents.push({ idx: p.idx, x: p.s.x, y: p.s.y, z: p.s.z, yaw: p.s.yaw, mode: p.s.mode, grounded: p.s.grounded });
      const block = encodeEnts(ents);
      for (const p of listeners) p.sock!.bin(encodeSnapshot(this.tick, now, p.lastSeq, p.s, block));
    }

    // shut down when nobody is left to play
    const humans = this.humans;
    if (humans.length === 0) return this.end('empty');
    if (humans.some((p) => p.sock)) this.emptySince = null;
    else if (this.emptySince === null) this.emptySince = now;
    else if (now - this.emptySince > EMPTY_TIMEOUT_MS) this.end('abandoned');
  }

  end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.broadcast({ t: 'game_end', reason });
    this.opts.onEnd(this.id);
  }
}

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
  stepAll() { const now = this.now(); for (const m of this.matches.values()) m.step(now); }
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
}
