import type { Mode } from './constants.js';

export const PROTOCOL_VERSION = 4;

// ---------- view models (what the server sends about things) ----------
export type Presence = 'offline' | 'lobby' | 'queue' | 'in_match';

export interface UserView { id: string; name: string; guest: boolean }
export interface FriendView { id: string; name: string; presence: Presence; partySize: number }

export interface PartyMemberView { id: string; name: string; ready: boolean; skin: number }
export interface PartyView {
  id: string;
  leaderId: string;
  mode: Mode;
  fill: boolean;
  members: PartyMemberView[];
}

export interface QueueView {
  state: 'idle' | 'searching';
  mode?: Mode;
  since?: number;
  /** Real players currently waiting in this mode's queue. */
  playersInQueue?: number;
  /** Server-estimated seconds until the match forms (bots top up after this). */
  etaS?: number;
}

export interface MatchMemberView { id: string; name: string; bot: boolean; skin: number }
export interface TeamView { id: number; members: MatchMemberView[] }
export interface MatchFoundView {
  matchId: string;
  mode: Mode;
  teams: TeamView[];
  yourTeam: number;
  humans: number;
  bots: number;
}

// ---------- in-match ----------
export type GamePhase = 'warmup' | 'bus' | 'play';
export interface RosterEntry { idx: number; name: string; team: number; skin: number; bot: boolean; npc?: 'boss' | 'guard' }
export interface RouteView { x0: number; z0: number; x1: number; z1: number; t0: number; t1: number; doorsAt: number; ejectAt: number }
export interface MarkerView { idx: number; x: number; z: number }
/** Chests (0), ammo boxes (1) and supply drops (2). Supply drops fall from y0 at t0 (server ms) at SUPPLY_FALL m/s. */
export interface ChestView { id: number; k: number; x: number; y: number; z: number; face: number; open: boolean; t0?: number; y0?: number }
export const SUPPLY_FALL = 9;
export const CHEST_KIND = { Chest: 0, Ammo: 1, Supply: 2 } as const;

/** A pickup lying on the ground. */
export interface LootView { id: number; item: number; r: number; n: number; x: number; y: number; z: number }

export type FeedCause = 'gun' | 'blast' | 'fall' | 'bleed' | 'car' | 'water' | 'left' | 'storm';
type V3 = [number, number, number];
/** Things that happened this tick, batched into one message per player. */
export type GameEvent =
  /** A shot: shooter, weapon, origin, and per pellet the end point + what it hit (0 world, 1 shield, 2 health, 3 water, 4 car, 5 nothing). */
  | { e: 'shot'; i: number; w: number; o: V3; h: number[] }
  /** A pickaxe swing: who swung, and where it landed + what it hit (same kinds as shots; 5 = only air). */
  | { e: 'melee'; i: number; h: [number, number, number, number] }
  /** A wall or piece of furniture was smashed (solid id). */
  | { e: 'broke'; id: number }
  /** You hit a breakable piece: how much of it is left (0..1). */
  | { e: 'struct'; id: number; hp: number }
  /** You bought something from a merchant. */
  | { e: 'bought'; item: number; r: number }
  /** Damage you dealt (for hit markers and damage numbers). */
  | { e: 'dmg'; t: number; d: number; sh: boolean; hd: boolean; p: V3; ko?: boolean }
  /** Damage you took, and the direction it came from. */
  | { e: 'hurt'; d: number; from: [number, number] | null }
  | { e: 'proj'; id: number; it: number; p: V3; v: V3; fuse: number }
  | { e: 'boom'; id: number; p: V3; r: number }
  | { e: 'feed'; k: number; v: number; w: number; knock: boolean; cause: FeedCause }
  | { e: 'revived'; i: number; by: number }
  | { e: 'car_boom'; id: number; p: V3 }
  | { e: 'opened'; id: number; by: number }
  | { e: 'supply'; id: number; x: number; z: number }
  | { e: 'recalled'; i: number; by: number }
  /** You're coming back: at server time `at`; `left` = solo redeploys left after this one (-1: teams, no limit). */
  | { e: 'redeploying'; at: number; left: number }
  /** Player `i` dropped back in. */
  | { e: 'redeployed'; i: number }
  | { e: 'redeploys_closed' }
  | { e: 'vault'; id: number; by: number }
  | { e: 'storm_hurt'; d: number };

export interface MatchStats { damage: number; taken: number; revives: number; chests: number; distance: number; survivedS: number; healed: number }
export interface GameResult { place: number; kills: number; killer: string | null; win: boolean; teams: number; stats: MatchStats; squad: { name: string; kills: number; you: boolean }[] }

export interface GameInit {
  matchId: string;
  seed: number;
  mode: Mode;
  you: number;
  phase: GamePhase;
  /** Server-clock ms when the warm-up ends. */
  warmupEndsAt: number;
  route: RouteView | null;
  serverTime: number;
  players: RosterEntry[];
  gone: number[];
  markers: MarkerView[];
  loot: LootView[];
  chests: ChestView[];
  /** Players still in (not eliminated), and how many teams. */
  alive: number;
  teamsAlive: number;
  /** Eliminations per player index. */
  kills: number[];
  storm: StormPlanView | null;
  vaultsOpen: number[];
  /** Server time each recall beacon is usable again. */
  beacons: number[];
  /** Walls and furniture already broken in this match (solid ids). */
  broken?: number[];
}
export interface StormPlanView { t0: number; circles: { x: number; z: number; r: number }[] }

// ---------- client -> server ----------
export type ClientMsg =
  | { t: 'hello'; token: string }
  | { t: 'ping'; at: number }
  | { t: 'friend_request'; name: string }
  | { t: 'friend_respond'; userId: string; accept: boolean }
  | { t: 'friend_remove'; userId: string }
  | { t: 'party_invite'; userId: string }
  | { t: 'party_respond'; partyId: string; accept: boolean }
  | { t: 'party_join_friend'; userId: string }
  | { t: 'party_leave' }
  | { t: 'party_kick'; userId: string }
  | { t: 'party_promote'; userId: string }
  | { t: 'party_set'; mode?: Mode; fill?: boolean }
  | { t: 'set_skin'; skin: number }
  | { t: 'ready'; ready: boolean }
  | { t: 'queue_start' }
  | { t: 'queue_cancel' }
  | { t: 'leave_match' }
  | { t: 'sync' }
  | { t: 'game_join' }
  | { t: 'game_marker'; x?: number; z?: number }
  | { t: 'spec_next'; dir: number }
  /** Inventory: swap two slots (0..4), drop (part of) a slot, or drop some of an ammo type. */
  | { t: 'inv_swap'; a: number; b: number }
  | { t: 'inv_drop'; slot: number; n?: number }
  | { t: 'ammo_drop'; ammo: number; n: number }
  /** Buy offer `offer` from merchant `merchant` (both indexes). */
  | { t: 'shop_buy'; merchant: number; offer: number };

// ---------- server -> client ----------
export type ServerMsg =
  | { t: 'welcome'; you: UserView; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'friends'; friends: FriendView[]; incoming: UserView[]; outgoing: UserView[] }
  | { t: 'party'; party: PartyView }
  | { t: 'party_invite'; partyId: string; from: UserView }
  | { t: 'queue'; queue: QueueView }
  | { t: 'match_found'; match: MatchFoundView }
  | { t: 'game_init'; init: GameInit }
  | { t: 'game_phase'; phase: GamePhase; route: RouteView | null; serverTime: number }
  | { t: 'game_gone'; idx: number }
  | { t: 'game_marker'; idx: number; x?: number; z?: number }
  | { t: 'game_end'; reason: string }
  | { t: 'ev'; ev: GameEvent[] }
  | { t: 'loot'; add: LootView[]; del: number[] }
  | { t: 'chests'; add: ChestView[]; open: number[] }
  | { t: 'alive'; alive: number; teams: number }
  | { t: 'result'; result: GameResult }
  /** Who you're watching after you've been eliminated (-1 = nobody). */
  | { t: 'spec'; idx: number }
  | { t: 'storm'; plan: StormPlanView }
  /** Recall cards you're carrying (player indexes). */
  | { t: 'cards'; cards: number[] }
  | { t: 'beacons'; ready: number[] }
  | { t: 'vaults'; open: number[] }
  /** Boss health bar: shown while you're near a boss. */
  | { t: 'boss'; idx: number; name: string; hp: number } 
  | { t: 'toast'; kind: 'info' | 'error' | 'success'; message: string }
  | { t: 'error'; message: string };

// ---------- HTTP auth API ----------
export interface AuthRequest { name: string; password: string }
export interface AuthResponse { token: string; user: UserView }
export interface ApiError { error: string }

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 6;
export const SKIN_COUNT = 8;
