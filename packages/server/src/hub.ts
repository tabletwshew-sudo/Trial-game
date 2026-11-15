import { randomBytes } from 'node:crypto';
import {
  MAX_PARTY_SIZE, SKIN_COUNT, TEAM_SIZE,
  type ClientMsg, type FriendView, type MatchFoundView, type Mode, type PartyView,
  type Presence, type QueueView, type ServerMsg, type UserView,
} from '@dropzone/shared';
import { makeBotNamer, tryFormMatch, validateParty, type FormedMatch, type QueuedParty } from './matchmaker.js';
import type { Store, UserRecord } from './store.js';

const MODES: Mode[] = ['solo', 'duo', 'trio', 'squad'];

interface Party {
  id: string;
  leaderId: string;
  mode: Mode;
  fill: boolean;
  members: string[];
  ready: Set<string>;
  invites: Set<string>;
  queuedAt: number | null;
}

export interface Match extends FormedMatch { id: string; createdAt: number }

export interface HubOptions {
  queueTimeoutS: number;
  /** Ms a disconnected player keeps their party slot (page refresh). */
  disconnectGraceMs: number;
  now?: () => number;
  /** Phase 3 hook: called when a match is formed. */
  onMatch?: (m: Match) => void;
}

type Send = (msg: ServerMsg) => void;

/**
 * The social + matchmaking hub: presence, friends, parties and queues.
 * Transport-agnostic: give it a `send` function per connected user.
 */
export class Hub {
  private conns = new Map<string, Send>();
  private parties = new Map<string, Party>();
  private partyOf = new Map<string, string>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  readonly matches = new Map<string, Match>();
  private inMatch = new Map<string, string>();
  private botNamer = makeBotNamer();
  private now: () => number;

  constructor(private store: Store, private opts: HubOptions) {
    this.now = opts.now ?? Date.now;
  }

  // ---------------------------------------------------------------- utils
  private send(userId: string, msg: ServerMsg) { this.conns.get(userId)?.(msg); }
  private toast(userId: string, message: string, kind: 'info' | 'error' | 'success' = 'info') {
    this.send(userId, { t: 'toast', kind, message });
  }
  private user(id: string) { return this.store.getUser(id); }
  private userView(u: UserRecord): UserView { return { id: u.id, name: u.name, guest: u.guest }; }

  presence(userId: string): Presence {
    if (!this.conns.has(userId)) return 'offline';
    if (this.inMatch.has(userId)) return 'in_match';
    const p = this.partyFor(userId);
    return p?.queuedAt != null ? 'queue' : 'lobby';
  }

  partyFor(userId: string) { const id = this.partyOf.get(userId); return id ? this.parties.get(id) : undefined; }
  isOnline(userId: string) { return this.conns.has(userId); }

  // ----------------------------------------------------------- connection
  connect(user: UserRecord, send: Send) {
    const timer = this.graceTimers.get(user.id);
    if (timer) { clearTimeout(timer); this.graceTimers.delete(user.id); }
    const old = this.conns.get(user.id);
    if (old) old({ t: 'error', message: 'Signed in from another tab' });
    this.conns.set(user.id, send);

    send({ t: 'welcome', you: this.userView(user), serverTime: this.now() });
    if (!this.partyFor(user.id)) this.createParty(user.id);
    this.pushFriends(user.id);
    this.pushParty(this.partyFor(user.id)!);
    this.pushQueue(this.partyFor(user.id)!);
    const matchId = this.inMatch.get(user.id);
    if (matchId) this.sendMatch(user.id, this.matches.get(matchId)!);
    this.notifyFriendsOf(user.id);
  }

  disconnect(userId: string, send?: Send) {
    if (send && this.conns.get(userId) !== send) return; // a newer tab took over
    this.conns.delete(userId);
    const party = this.partyFor(userId);
    if (party?.queuedAt != null) this.cancelQueue(party, `${this.user(userId)?.name} disconnected`);
    this.notifyFriendsOf(userId);
    const leave = () => {
      this.graceTimers.delete(userId);
      if (this.conns.has(userId)) return;
      this.leaveParty(userId, false);
    };
    if (this.opts.disconnectGraceMs <= 0) leave();
    else this.graceTimers.set(userId, setTimeout(leave, this.opts.disconnectGraceMs));
  }

  // -------------------------------------------------------------- friends
  private friendsPayload(u: UserRecord): ServerMsg {
    const friends: FriendView[] = u.friends
      .map((id) => this.user(id)).filter(Boolean)
      .map((f) => ({ id: f!.id, name: f!.name, presence: this.presence(f!.id), partySize: this.partyFor(f!.id)?.members.length ?? 0 }));
    const order: Record<Presence, number> = { lobby: 0, queue: 1, in_match: 2, offline: 3 };
    friends.sort((a, b) => order[a.presence] - order[b.presence] || a.name.localeCompare(b.name));
    const list = (ids: string[]) => ids.map((id) => this.user(id)).filter(Boolean).map((x) => this.userView(x!));
    return { t: 'friends', friends, incoming: list(u.incoming), outgoing: list(u.outgoing) };
  }
  pushFriends(userId: string) {
    const u = this.user(userId);
    if (u && this.conns.has(userId)) this.send(userId, this.friendsPayload(u));
  }
  private notifyFriendsOf(userId: string) {
    for (const f of this.user(userId)?.friends ?? []) this.pushFriends(f);
  }

  private friendRequest(me: UserRecord, name: string) {
    const them = this.store.findByName(String(name).trim());
    if (!them) return this.toast(me.id, `No player called "${name}"`, 'error');
    if (them.id === me.id) return this.toast(me.id, "You can't friend yourself", 'error');
    if (me.friends.includes(them.id)) return this.toast(me.id, `${them.name} is already your friend`, 'error');
    if (me.incoming.includes(them.id)) return this.friendRespond(me, them.id, true);
    if (me.outgoing.includes(them.id)) return this.toast(me.id, 'Request already sent', 'info');
    this.store.update(me, (u) => u.outgoing.push(them.id));
    this.store.update(them, (u) => u.incoming.push(me.id));
    this.toast(me.id, `Friend request sent to ${them.name}`, 'success');
    this.toast(them.id, `${me.name} sent you a friend request`, 'info');
    this.pushFriends(me.id); this.pushFriends(them.id);
  }

  private friendRespond(me: UserRecord, otherId: string, accept: boolean) {
    const them = this.user(otherId);
    if (!them || !me.incoming.includes(otherId)) return;
    this.store.update(me, (u) => { u.incoming = u.incoming.filter((x) => x !== otherId); if (accept) u.friends.push(otherId); });
    this.store.update(them, (u) => { u.outgoing = u.outgoing.filter((x) => x !== me.id); if (accept) u.friends.push(me.id); });
    if (accept) { this.toast(me.id, `You and ${them.name} are now friends`, 'success'); this.toast(them.id, `${me.name} accepted your friend request`, 'success'); }
    this.pushFriends(me.id); this.pushFriends(them.id);
  }

  private friendRemove(me: UserRecord, otherId: string) {
    const them = this.user(otherId);
    if (!them) return;
    const strip = (u: UserRecord, id: string) => {
      u.friends = u.friends.filter((x) => x !== id);
      u.incoming = u.incoming.filter((x) => x !== id);
      u.outgoing = u.outgoing.filter((x) => x !== id);
    };
    this.store.update(me, (u) => strip(u, otherId));
    this.store.update(them, (u) => strip(u, me.id));
    this.pushFriends(me.id); this.pushFriends(them.id);
  }

  // -------------------------------------------------------------- parties
  private createParty(leaderId: string): Party {
    const p: Party = {
      id: 'pt' + randomBytes(5).toString('hex'), leaderId, mode: 'squad', fill: true,
      members: [leaderId], ready: new Set(), invites: new Set(), queuedAt: null,
    };
    this.parties.set(p.id, p);
    this.partyOf.set(leaderId, p.id);
    return p;
  }

  partyView(p: Party): PartyView {
    return {
      id: p.id, leaderId: p.leaderId, mode: p.mode, fill: p.fill,
      members: p.members.map((id) => {
        const u = this.user(id)!;
        return { id, name: u.name, ready: id === p.leaderId || p.ready.has(id), skin: u.skin };
      }),
    };
  }
  private pushParty(p: Party) {
    const view = this.partyView(p);
    for (const m of p.members) this.send(m, { t: 'party', party: view });
    for (const m of p.members) this.notifyFriendsOf(m);
  }

  private queueView(p: Party): QueueView {
    if (p.queuedAt == null) return { state: 'idle' };
    const queued = [...this.parties.values()].filter((q) => q.queuedAt != null && q.mode === p.mode);
    const oldest = Math.min(...queued.map((q) => q.queuedAt!));
    return {
      state: 'searching', mode: p.mode, since: p.queuedAt,
      playersInQueue: queued.reduce((n, q) => n + q.members.length, 0),
      etaS: Math.max(0, Math.ceil(this.opts.queueTimeoutS - (this.now() - oldest) / 1000)),
    };
  }
  private pushQueue(p: Party) {
    const view = this.queueView(p);
    for (const m of p.members) this.send(m, { t: 'queue', queue: view });
  }

  private cancelQueue(p: Party, reason?: string) {
    if (p.queuedAt == null) return;
    p.queuedAt = null;
    this.pushQueue(p);
    if (reason) for (const m of p.members) this.toast(m, `Matchmaking cancelled: ${reason}`, 'info');
    for (const m of p.members) this.notifyFriendsOf(m);
  }

  /** Smallest mode that fits the party if it's grown past the current team size. */
  private fitMode(p: Party) {
    if (p.members.length > TEAM_SIZE[p.mode]) p.mode = MODES.find((m) => TEAM_SIZE[m] >= p.members.length) ?? 'squad';
  }

  private joinParty(userId: string, target: Party) {
    if (target.members.includes(userId)) return;
    if (target.members.length >= MAX_PARTY_SIZE) return this.toast(userId, 'That party is full', 'error');
    if (this.inMatch.has(userId)) return this.toast(userId, 'Finish your match first', 'error');
    this.leaveParty(userId, false, true);
    target.members.push(userId);
    target.invites.delete(userId);
    this.partyOf.set(userId, target.id);
    this.cancelQueue(target, 'party changed');
    this.fitMode(target);
    for (const m of target.members) if (m !== userId) this.toast(m, `${this.user(userId)!.name} joined the party`, 'success');
    this.pushParty(target);
    this.pushQueue(target);
  }

  /** Remove from current party. If `solo` is set, the player gets a fresh solo party. */
  private leaveParty(userId: string, notify = true, joiningAnother = false) {
    const p = this.partyFor(userId);
    if (p) {
      this.cancelQueue(p, p.members.length > 1 ? 'party changed' : undefined);
      p.members = p.members.filter((m) => m !== userId);
      p.ready.delete(userId);
      this.partyOf.delete(userId);
      if (p.members.length === 0) this.parties.delete(p.id);
      else {
        if (p.leaderId === userId) p.leaderId = p.members[0];
        if (notify) for (const m of p.members) this.toast(m, `${this.user(userId)?.name} left the party`, 'info');
        this.pushParty(p);
        this.pushQueue(p);
      }
    }
    if (!joiningAnother && this.conns.has(userId)) {
      const mine = this.createParty(userId);
      this.pushParty(mine);
      this.pushQueue(mine);
    }
  }

  // ------------------------------------------------------------- dispatch
  handle(userId: string, msg: ClientMsg) {
    const me = this.user(userId);
    if (!me || !msg || typeof msg !== 'object') return;
    const party = this.partyFor(userId) ?? this.createParty(userId);
    const isLeader = party.leaderId === userId;

    switch (msg.t) {
      case 'ping': return this.send(userId, { t: 'pong', at: msg.at, serverTime: this.now() });
      case 'sync': {
        this.pushFriends(userId);
        this.send(userId, { t: 'party', party: this.partyView(party) });
        return this.send(userId, { t: 'queue', queue: this.queueView(party) });
      }
      case 'friend_request': return this.friendRequest(me, String(msg.name ?? '').slice(0, 32));
      case 'friend_respond': return this.friendRespond(me, String(msg.userId), !!msg.accept);
      case 'friend_remove': return this.friendRemove(me, String(msg.userId));

      case 'party_invite': {
        const them = this.user(String(msg.userId));
        if (!them || !me.friends.includes(them.id)) return this.toast(userId, 'You can only invite friends', 'error');
        if (!this.isOnline(them.id)) return this.toast(userId, `${them.name} is offline`, 'error');
        if (party.members.includes(them.id)) return;
        if (party.members.length >= MAX_PARTY_SIZE) return this.toast(userId, 'Party is full (4 max)', 'error');
        party.invites.add(them.id);
        this.send(them.id, { t: 'party_invite', partyId: party.id, from: this.userView(me) });
        return this.toast(userId, `Invited ${them.name}`, 'success');
      }
      case 'party_respond': {
        const target = this.parties.get(String(msg.partyId));
        if (!target || !target.invites.has(userId)) return this.toast(userId, 'That invite expired', 'error');
        if (!msg.accept) {
          target.invites.delete(userId);
          return this.toast(target.leaderId, `${me.name} declined your invite`, 'info');
        }
        return this.joinParty(userId, target);
      }
      case 'party_join_friend': {
        const fid = String(msg.userId);
        if (!me.friends.includes(fid)) return;
        const target = this.partyFor(fid);
        if (!target) return this.toast(userId, 'Friend is offline', 'error');
        return this.joinParty(userId, target);
      }
      case 'party_leave': {
        if (party.members.length <= 1) return;
        return this.leaveParty(userId);
      }
      case 'party_kick': {
        const target = String(msg.userId);
        if (!isLeader || target === userId || !party.members.includes(target)) return;
        this.toast(target, 'You were removed from the party', 'info');
        this.leaveParty(target, true);
        return;
      }
      case 'party_promote': {
        const target = String(msg.userId);
        if (!isLeader || !party.members.includes(target)) return;
        party.leaderId = target;
        party.ready.delete(target);
        return this.pushParty(party);
      }
      case 'party_set': {
        if (!isLeader) return this.toast(userId, 'Only the party leader can change this', 'error');
        if (msg.mode && MODES.includes(msg.mode)) {
          const err = validateParty(msg.mode, party.members.length);
          if (err) return this.toast(userId, err, 'error');
          party.mode = msg.mode;
        }
        if (typeof msg.fill === 'boolean') party.fill = msg.fill;
        this.cancelQueue(party, 'settings changed');
        return this.pushParty(party);
      }
      case 'set_skin': {
        const skin = Math.floor(Number(msg.skin));
        if (!(skin >= 0 && skin < SKIN_COUNT)) return;
        this.store.update(me, (u) => (u.skin = skin));
        return this.pushParty(party);
      }
      case 'ready': {
        if (msg.ready) party.ready.add(userId); else { party.ready.delete(userId); this.cancelQueue(party, `${me.name} isn't ready`); }
        return this.pushParty(party);
      }
      case 'queue_start': {
        if (!isLeader) return this.toast(userId, 'Only the party leader can start matchmaking', 'error');
        if (party.queuedAt != null) return;
        const err = validateParty(party.mode, party.members.length);
        if (err) return this.toast(userId, err, 'error');
        const notReady = party.members.filter((m) => m !== party.leaderId && !party.ready.has(m));
        if (notReady.length) return this.toast(userId, `Waiting for ${notReady.map((m) => this.user(m)!.name).join(', ')} to ready up`, 'error');
        const busy = party.members.filter((m) => this.inMatch.has(m) || !this.isOnline(m));
        if (busy.length) return this.toast(userId, `${busy.map((m) => this.user(m)!.name).join(', ')} can't play right now`, 'error');
        party.queuedAt = this.now();
        this.pushQueue(party);
        for (const m of party.members) this.notifyFriendsOf(m);
        return;
      }
      case 'queue_cancel': return this.cancelQueue(party, party.members.length > 1 ? `cancelled by ${me.name}` : undefined);
      case 'leave_match': {
        const mid = this.inMatch.get(userId);
        if (!mid) return;
        this.inMatch.delete(userId);
        const m = this.matches.get(mid);
        if (m && ![...this.inMatch.values()].includes(mid)) this.matches.delete(mid);
        this.pushParty(party);
        this.pushQueue(party);
        return this.notifyFriendsOf(userId);
      }
    }
  }

  /** The game server finished (or abandoned) a match: send everyone back to the lobby. */
  endMatch(matchId: string) {
    if (!this.matches.delete(matchId)) return;
    for (const [userId, mid] of [...this.inMatch]) {
      if (mid !== matchId) continue;
      this.inMatch.delete(userId);
      const p = this.partyFor(userId);
      if (p) { this.pushParty(p); this.pushQueue(p); }
      this.notifyFriendsOf(userId);
    }
  }

  // ---------------------------------------------------------- matchmaking
  /** Call about once per second. */
  tick() {
    const now = this.now();
    for (const mode of MODES) {
      for (;;) {
        const queued: QueuedParty[] = [...this.parties.values()]
          .filter((p) => p.queuedAt != null && p.mode === mode)
          .map((p) => ({
            partyId: p.id, mode: p.mode, fill: p.fill, enqueuedAt: p.queuedAt!,
            members: p.members.map((id) => { const u = this.user(id)!; return { id, name: u.name, skin: u.skin }; }),
          }));
        const formed = tryFormMatch(queued, mode, now, this.opts.queueTimeoutS, this.botNamer, () => Math.floor(Math.random() * SKIN_COUNT));
        if (!formed) break;
        this.startMatch(formed);
      }
    }
    for (const p of this.parties.values()) if (p.queuedAt != null) this.pushQueue(p);
  }

  private startMatch(formed: FormedMatch) {
    const match: Match = { ...formed, id: 'm' + randomBytes(5).toString('hex'), createdAt: this.now() };
    this.matches.set(match.id, match);
    for (const pid of formed.partyIds) {
      const p = this.parties.get(pid)!;
      p.queuedAt = null;
      p.ready.clear();
      for (const m of p.members) this.inMatch.set(m, match.id);
    }
    for (const team of match.teams) for (const m of team.members) if (!m.bot) this.sendMatch(m.id, match);
    for (const pid of formed.partyIds) {
      const p = this.parties.get(pid)!;
      this.pushParty(p); this.pushQueue(p);
    }
    this.opts.onMatch?.(match);
  }

  private sendMatch(userId: string, match: Match) {
    const yourTeam = match.teams.find((t) => t.members.some((m) => m.id === userId))?.id ?? 0;
    const view: MatchFoundView = {
      matchId: match.id, mode: match.mode, yourTeam, humans: match.humans, bots: match.bots,
      teams: match.teams.map((t) => ({ id: t.id, members: t.members.map(({ id, name, bot, skin }) => ({ id, name, bot, skin })) })),
    };
    this.send(userId, { t: 'match_found', match: view });
  }
}
