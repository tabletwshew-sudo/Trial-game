import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createApp } from '../src/app';
import type { ServerMsg, ClientMsg } from '@dropzone/shared';

let app: ReturnType<typeof createApp>;
let base = '';

beforeAll(async () => {
  app = createApp({ port: 0, dataFile: null, clientDist: '/nonexistent', queueTimeoutS: 2, disconnectGraceMs: 0, warmupS: 1 });
  const port = await app.listen();
  base = `http://localhost:${port}`;
});
afterAll(() => app.close());

const post = async (path: string, body: object) => {
  const r = await fetch(base + path, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};

class Client {
  ws!: WebSocket;
  inbox: ServerMsg[] = [];
  private waiters: { pred: (m: ServerMsg) => boolean; ok: (m: ServerMsg) => void }[] = [];
  id = '';
  static async connect(token: string) {
    const c = new Client();
    c.ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    c.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMsg;
      c.inbox.push(m);
      c.waiters = c.waiters.filter((w) => (w.pred(m) ? (w.ok(m), false) : true));
    });
    await new Promise((ok) => c.ws.on('open', ok));
    c.send({ t: 'hello', token });
    const w = await c.wait((m) => m.t === 'welcome');
    if (w.t === 'welcome') c.id = w.you.id;
    return c;
  }
  send(m: ClientMsg) { this.ws.send(JSON.stringify(m)); }
  /** Wait for a matching message (checks already-received ones first, newest first). */
  wait<T extends ServerMsg>(pred: (m: ServerMsg) => boolean, timeout = 4000): Promise<T> {
    const hit = [...this.inbox].reverse().find(pred);
    if (hit) { this.inbox = []; return Promise.resolve(hit as T); }
    return new Promise((ok, fail) => {
      const t = setTimeout(() => fail(new Error('timeout waiting for message')), timeout);
      this.waiters.push({ pred, ok: (m) => { clearTimeout(t); this.inbox = []; ok(m as T); } });
    });
  }
  close() { this.ws.close(); }
}

describe('auth', () => {
  it('registers, rejects duplicates and bad input, logs in', async () => {
    expect((await post('/api/register', { name: 'ab', password: 'secret1' })).status).toBe(400);
    expect((await post('/api/register', { name: 'Alice', password: '123' })).status).toBe(400);
    const r = await post('/api/register', { name: 'Alice', password: 'secret1' });
    expect(r.status).toBe(200);
    expect(r.body.user.name).toBe('Alice');
    expect((await post('/api/register', { name: 'alice', password: 'secret1' })).status).toBe(409);
    expect((await post('/api/login', { name: 'ALICE', password: 'nope!!' })).status).toBe(401);
    expect((await post('/api/login', { name: 'alice', password: 'secret1' })).status).toBe(200);
  });
  it('creates guests with unique names', async () => {
    const a = await post('/api/guest', {}), b = await post('/api/guest', {});
    expect(a.body.user.guest).toBe(true);
    expect(a.body.user.name).not.toBe(b.body.user.name);
  });
  it('/api/me validates tokens', async () => {
    const r = await post('/api/register', { name: 'MeTest', password: 'secret1' });
    const ok = await fetch(base + '/api/me', { headers: { authorization: `Bearer ${r.body.token}` } });
    expect(ok.status).toBe(200);
    const bad = await fetch(base + '/api/me', { headers: { authorization: 'Bearer nope' } });
    expect(bad.status).toBe(401);
  });
  it('rejects a websocket with a bad token', async () => {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
    await new Promise((ok) => ws.on('open', ok));
    ws.send(JSON.stringify({ t: 'hello', token: 'garbage' }));
    const code = await new Promise((ok) => ws.on('close', ok));
    expect(code).toBe(4001);
  });
});

describe('friends -> party -> queue -> match', () => {
  it('full flow with a duo filling a squad with bots', async () => {
    const a = (await post('/api/register', { name: 'Bob', password: 'secret1' })).body;
    const b = (await post('/api/register', { name: 'Cara', password: 'secret1' })).body;
    const bob = await Client.connect(a.token);
    const cara = await Client.connect(b.token);

    // friend request + accept
    bob.send({ t: 'friend_request', name: 'cara' });
    await cara.wait((m) => m.t === 'friends' && m.incoming.some((u) => u.name === 'Bob'));
    cara.send({ t: 'friend_respond', userId: bob.id, accept: true });
    const fl = await bob.wait<Extract<ServerMsg, { t: 'friends' }>>((m) => m.t === 'friends' && m.friends.length === 1);
    expect(fl.friends[0]).toMatchObject({ name: 'Cara', presence: 'lobby' });

    // invite + accept
    bob.send({ t: 'party_invite', userId: cara.id });
    const inv = await cara.wait<Extract<ServerMsg, { t: 'party_invite' }>>((m) => m.t === 'party_invite');
    cara.send({ t: 'party_respond', partyId: inv.partyId, accept: true });
    const pv = await bob.wait<Extract<ServerMsg, { t: 'party' }>>((m) => m.t === 'party' && m.party.members.length === 2);
    expect(pv.party.leaderId).toBe(bob.id);
    expect(pv.party.mode).toBe('squad');

    // non-leader cannot change mode
    cara.send({ t: 'party_set', mode: 'duo' });
    await cara.wait((m) => m.t === 'toast' && m.kind === 'error');

    // leader can't queue until member ready
    bob.send({ t: 'party_set', mode: 'squad', fill: true });
    bob.send({ t: 'queue_start' });
    await bob.wait((m) => m.t === 'toast' && /ready up/.test(m.message));
    cara.send({ t: 'ready', ready: true });
    await bob.wait((m) => m.t === 'party' && m.party.members.every((x) => x.ready));
    bob.send({ t: 'queue_start' });
    await cara.wait((m) => m.t === 'queue' && m.queue.state === 'searching');

    // queue timeout is 2s in tests -> match with bots
    const found = await bob.wait<Extract<ServerMsg, { t: 'match_found' }>>((m) => m.t === 'match_found', 5000);
    const cFound = await cara.wait<Extract<ServerMsg, { t: 'match_found' }>>((m) => m.t === 'match_found', 5000);
    expect(found.match.matchId).toBe(cFound.match.matchId);
    expect(found.match.yourTeam).toBe(cFound.match.yourTeam);
    expect(found.match.teams).toHaveLength(10);
    const myTeam = found.match.teams.find((t) => t.id === found.match.yourTeam)!;
    expect(myTeam.members.filter((m) => !m.bot).map((m) => m.name).sort()).toEqual(['Bob', 'Cara']);
    expect(myTeam.members).toHaveLength(4);
    expect(found.match.humans).toBe(2);
    expect(found.match.bots).toBe(38);

    // presence shows in match; leaving returns to lobby
    bob.send({ t: 'leave_match' });
    cara.send({ t: 'leave_match' });
    await bob.wait((m) => m.t === 'friends' && m.friends[0]?.presence === 'lobby');
    expect(app.hub.matches.size).toBe(0);

    // leaving the party gives you a fresh solo party
    cara.send({ t: 'party_leave' });
    await cara.wait((m) => m.t === 'party' && m.party.members.length === 1 && m.party.leaderId === cara.id);
    await bob.wait((m) => m.t === 'party' && m.party.members.length === 1);

    // disconnect shows offline to friends
    cara.close();
    await bob.wait((m) => m.t === 'friends' && m.friends[0]?.presence === 'offline');
    bob.close();
  });

  it('two separate parties with fill merge into one squad', async () => {
    const mk = async (n: string) => Client.connect((await post('/api/register', { name: n, password: 'secret1' })).body.token);
    const solo = await mk('SoloSam');
    const t1 = await mk('TrioA'), t2 = await mk('TrioB'), t3 = await mk('TrioC');
    // build a trio party via friend joins
    for (const c of [t2, t3]) {
      t1.send({ t: 'friend_request', name: c === t2 ? 'TrioB' : 'TrioC' });
      await c.wait((m) => m.t === 'friends' && m.incoming.length > 0);
      c.send({ t: 'friend_respond', userId: t1.id, accept: true });
      await c.wait((m) => m.t === 'friends' && m.friends.length > 0);
      c.send({ t: 'party_join_friend', userId: t1.id });
      c.send({ t: 'ready', ready: true });
    }
    await t1.wait((m) => m.t === 'party' && m.party.members.length === 3 && m.party.members.every((x) => x.ready));
    t1.send({ t: 'queue_start' });
    solo.send({ t: 'queue_start' });
    const a = await solo.wait<Extract<ServerMsg, { t: 'match_found' }>>((m) => m.t === 'match_found', 5000);
    const b = await t1.wait<Extract<ServerMsg, { t: 'match_found' }>>((m) => m.t === 'match_found', 5000);
    expect(a.match.matchId).toBe(b.match.matchId);
    expect(a.match.yourTeam).toBe(b.match.yourTeam);
    const team = a.match.teams.find((t) => t.id === a.match.yourTeam)!;
    expect(team.members.every((m) => !m.bot)).toBe(true);
    for (const c of [solo, t1, t2, t3]) c.close();
  });

  it('party grows past mode size -> mode auto-bumps', async () => {
    const mk = async (n: string) => Client.connect((await post('/api/register', { name: n, password: 'secret1' })).body.token);
    const x = await mk('Xavi'), y = await mk('Yara');
    x.send({ t: 'party_set', mode: 'solo' });
    await x.wait((m) => m.t === 'party' && m.party.mode === 'solo');
    x.send({ t: 'friend_request', name: 'Yara' });
    await y.wait((m) => m.t === 'friends' && m.incoming.length > 0);
    y.send({ t: 'friend_respond', userId: x.id, accept: true });
    await y.wait((m) => m.t === 'friends' && m.friends.length > 0);
    y.send({ t: 'party_join_friend', userId: x.id });
    const p = await x.wait<Extract<ServerMsg, { t: 'party' }>>((m) => m.t === 'party' && m.party.members.length === 2);
    expect(p.party.mode).toBe('duo');
    x.send({ t: 'party_set', mode: 'solo' });
    await x.wait((m) => m.t === 'toast' && /too many/.test(m.message));
    x.close(); y.close();
  });
});
