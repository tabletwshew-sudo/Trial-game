import type { Mode } from './constants.js';

export const PROTOCOL_VERSION = 2;

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
  | { t: 'leave_match' };

// ---------- server -> client ----------
export type ServerMsg =
  | { t: 'welcome'; you: UserView; serverTime: number }
  | { t: 'pong'; at: number; serverTime: number }
  | { t: 'friends'; friends: FriendView[]; incoming: UserView[]; outgoing: UserView[] }
  | { t: 'party'; party: PartyView }
  | { t: 'party_invite'; partyId: string; from: UserView }
  | { t: 'queue'; queue: QueueView }
  | { t: 'match_found'; match: MatchFoundView }
  | { t: 'toast'; kind: 'info' | 'error' | 'success'; message: string }
  | { t: 'error'; message: string };

// ---------- HTTP auth API ----------
export interface AuthRequest { name: string; password: string }
export interface AuthResponse { token: string; user: UserView }
export interface ApiError { error: string }

export const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
export const MIN_PASSWORD = 6;
export const SKIN_COUNT = 8;
