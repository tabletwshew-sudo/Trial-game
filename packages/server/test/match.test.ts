import { describe, expect, it } from 'vitest';
import { K, PM, SPAWN_ISLAND, decodeSnapshot, encodeInputs, terrainAt, type ServerMsg, type Snapshot } from '@dropzone/shared';
import { MatchInstance, type Sock } from '../src/game/match';
import { tryFormMatch, makeBotNamer } from '../src/matchmaker';

const formed = (humans: number) => {
  const members = Array.from({ length: humans }, (_, i) => ({ id: `h${i}`, name: `Human${i}`, skin: i }));
  const m = tryFormMatch([{ partyId: 'p', mode: 'squad', fill: true, members, enqueuedAt: 0 }], 'squad', 99_999, 1, makeBotNamer(3))!;
  return { ...m, id: 'm1', createdAt: 0 };
};
class FakeClient implements Sock {
  msgs: ServerMsg[] = []; snap: Snapshot | null = null; seq = 0;
  json = (m: ServerMsg) => { this.msgs.push(m); };
  bin = (b: ArrayBuffer) => { this.snap = decodeSnapshot(new DataView(b)); };
  send(inst: MatchInstance, id: string, keys: number, yaw = 0, pitch = 0) {
    inst.onBinary(id, new DataView(encodeInputs(this.seq + 1, [{ keys, yaw, pitch }, { keys, yaw, pitch }])));
    this.seq += 2;
  }
}

describe('match instance', () => {
  it('runs warm-up -> dropship -> everyone lands on the island', () => {
    let now = 1_000_000, ended = '';
    const inst = new MatchInstance(formed(2), { warmupS: 5, onEnd: (id) => (ended = id) }, now);
    inst.redeploy = false; // (this checks the drop: everyone on the ground, nobody coming back down from a redeploy)
    const c = new FakeClient();
    const c2 = new FakeClient();
    inst.join('h0', c, now); inst.join('h1', c2, now);
    const init = c.msgs.find((m) => m.t === 'game_init');
    expect(init && init.t === 'game_init' && init.init.players.filter((x) => !x.npc).length).toBe(40);
    expect(init && init.t === 'game_init' && init.init.players.filter((x) => x.npc === 'boss').length).toBe(2);
    expect(inst.players.filter((p) => !p.npc).every((p) => Math.hypot(p.s.x - SPAWN_ISLAND.x, p.s.z - SPAWN_ISLAND.z) < SPAWN_ISLAND.r)).toBe(true); // everyone starts on the warm-up island

    const tick = (keys = 0, yaw = 0, pitch = 0) => { now += 1000 / 30; c.send(inst, 'h0', keys, yaw, pitch); inst.step(now); };

    // warm-up: the human runs north, bots wander, nobody leaves the island
    const me = inst.players.find((p) => p.id === 'h0')!;
    const z0 = me.s.z;
    for (let i = 0; i < 60; i++) tick(K.F | K.SPRINT);
    expect(me.s.z).toBeLessThan(z0 - 10);
    expect(c.snap!.ack).toBe(c.seq);
    expect(c.snap!.ents.length).toBe(40); // NPCs stay hidden until the dropship leaves
    expect(inst.players.filter((p) => p.bot).some((p) => Math.hypot(p.s.vx, p.s.vz) > 1)).toBe(true);

    // dropship
    while (inst.phase === 'warmup') tick();
    expect(inst.phase).toBe('bus');
    expect(inst.players.filter((p) => !p.npc).every((p) => p.s.mode === PM.Bus)).toBe(true);
    expect(c.msgs.some((m) => m.t === 'game_phase' && m.phase === 'bus' && m.route)).toBe(true);

    // jumping before the doors open does nothing
    tick(K.JUMP); tick(0);
    expect(me.s.mode).toBe(PM.Bus);
    while (now < inst.route!.doorsAt + 4000) tick(0);
    const mates = inst.players.filter((p) => p.team === me.team && p.bot);
    expect(mates.length).toBe(2);
    expect(mates.every((p) => p.s.mode === PM.Bus)).toBe(true); // filler bots wait for their human

    tick(K.JUMP);
    expect(me.s.mode).toBe(PM.Fall);
    for (let i = 0; i < 60; i++) tick(K.F, 0, -1.4);
    expect(mates.every((p) => p.s.mode !== PM.Bus)).toBe(true); // ...then follow

    // the second human never jumps: forced out at the end of the route
    const afk = inst.players.find((p) => p.id === 'h1')!;
    while (inst.phase === 'bus') tick(K.F, 0, -1.4);
    expect(afk.s.mode).not.toBe(PM.Bus);
    for (let i = 0; i < 30 * 45; i++) tick(0);

    const landed = inst.players.filter((p) => !p.npc && p.s.mode !== PM.Bus && p.s.mode !== PM.Fall && p.s.mode !== PM.Glide);
    expect(landed.length).toBe(40); // everyone is down (some may already be fighting, knocked or out)
    const onLand = inst.players.filter((p) => !p.npc).filter((p) => terrainAt(inst.world, p.s.x, p.s.z) > 0 || p.s.y > 0);
    expect(onLand.length).toBeGreaterThanOrEqual(36); // almost everyone hits dry land
    // squad dropped together: teammates still standing are in the same part of the map after 45 s
    // (if you land in the sea, they make for the nearest town on land; eliminated teammates don't count)
    expect(mates.filter((p) => p.s.mode !== PM.Dead).every((p) => Math.hypot(p.s.x - me.s.x, p.s.z - me.s.z) < 260)).toBe(true);
    // bot squads spread across several locations
    const spots = new Set(inst.players.filter((p) => p.bot && !p.npc && p.team !== me.team).map((p) => `${Math.round(p.s.x / 250)},${Math.round(p.s.z / 250)}`));
    expect(spots.size).toBeGreaterThanOrEqual(5);

    // leaving ends the match once no humans remain
    inst.leave('h0');
    expect(c2.msgs.some((m) => m.t === 'game_gone')).toBe(true);
    inst.leave('h1'); tick();
    expect(ended).toBe('m1');
  });

  it('throttles speed-hacked input floods', () => {
    let now = 5_000_000;
    const inst = new MatchInstance(formed(1), { warmupS: 60, onEnd: () => {} }, now);
    const c = new FakeClient(); inst.join('h0', c, now);
    const me = inst.players.find((p) => p.id === 'h0')!;
    const x0 = me.s.x, z0 = me.s.z;
    for (let i = 0; i < 30; i++) { // 1 second of real time, 10x the allowed input rate
      for (let k = 0; k < 10; k++) c.send(inst, 'h0', K.F | K.SPRINT);
      now += 1000 / 30; inst.step(now);
    }
    expect(Math.hypot(me.s.x - x0, me.s.z - z0)).toBeLessThan(7.6 * 1.3);
  });

  it('keeps physics running for a silent client and ends abandoned matches', () => {
    let now = 9_000_000, ended = false;
    const inst = new MatchInstance(formed(1), { warmupS: 1, onEnd: () => (ended = true) }, now);
    const c = new FakeClient(); inst.join('h0', c, now);
    const me = inst.players.find((p) => p.id === 'h0')!;
    while (inst.phase !== 'play') { now += 1000 / 30; inst.step(now); }
    for (let i = 0; i < 30 * 40; i++) { now += 1000 / 30; inst.step(now); }
    expect(me.s.mode).toBe(PM.Walk); // fell and landed without sending anything
    inst.disconnect('h0');
    for (let i = 0; i < 30 * 50; i++) { now += 1000 / 30; inst.step(now); }
    expect(ended).toBe(true);
  });
});

describe('connection stalls', () => {
  it('holding space through a lag spike does not count as a second press', () => {
    let now = 7_000_000;
    const inst = new MatchInstance(formed(1), { warmupS: 1, onEnd: () => {} }, now);
    const c = new FakeClient(); inst.join('h0', c, now);
    const me = inst.players.find((p) => p.id === 'h0')!;
    const tick = (keys?: number) => { now += 1000 / 30; if (keys !== undefined) c.send(inst, 'h0', keys); inst.step(now); };
    while (!inst.route || now < inst.route.doorsAt + 2000) tick(0);
    tick(K.JUMP);
    expect(me.s.mode).toBe(PM.Fall);
    for (let i = 0; i < 20; i++) tick();        // 0.66 s with no packets at all
    for (let i = 0; i < 10; i++) tick(K.JUMP);  // packets resume, space still held
    expect(me.s.mode).toBe(PM.Fall);            // glider did NOT pop open
    tick(0); tick(K.JUMP);                      // a real second press does deploy it
    expect(me.s.mode).toBe(PM.Glide);
  });
});

describe('client prediction', () => {
  it('replaying unacknowledged inputs reproduces the server state exactly (with 100 ms of lag)', async () => {
    const { stepPlayer, getWorld } = await import('@dropzone/shared');
    const world = getWorld();
    let now = 3_000_000;
    const inst = new MatchInstance(formed(1), { warmupS: 4, onEnd: () => {} }, now);
    const c = new FakeClient(); inst.join('h0', c, now);
    const LAG = 3; // ticks each way
    const up: ArrayBuffer[][] = [], down: (Snapshot | null)[] = [];
    let pending: { seq: number; cmd: { keys: number; yaw: number; pitch: number } }[] = [];
    let pred: any = null, seq = 0, worst = 0, checks = 0, slid = 0;
    const rnd = (() => { let s = 7; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
    let keys = 0, yaw = 0, pitch = 0;
    for (let tick = 0; tick < 30 * 80; tick++) {
      now += 1000 / 30;
      // the "player": random wandering, jump taps, steering; presses space after the doors open
      if (tick % 20 === 0) { keys = (rnd() < 0.8 ? K.F : 0) | (rnd() < 0.5 ? K.SPRINT : 0) | (rnd() < 0.3 ? K.L : 0) | (rnd() < 0.2 ? K.JUMP : 0) | (rnd() < 0.3 ? K.CROUCH : 0); yaw = Math.fround(yaw + (rnd() - 0.5)); pitch = Math.fround(-rnd() * 1.4); } // (crouch + sprint = slides)
      if (tick % 20 === 8 && (keys & K.SPRINT) && (keys & K.F)) keys |= K.CROUCH; // crouch mid-sprint: a slide
      if (inst.route && now > inst.route.doorsAt + 3000 && now < inst.route.doorsAt + 3200) keys |= K.JUMP;
      const cmds = [0, 1].map(() => ({ keys, yaw, pitch }));
      for (const cmd of cmds) { seq++; pending.push({ seq, cmd }); if (pred) stepPlayer(pred, cmd, world); }
      up.push([encodeInputs(seq - 1, cmds)]);
      if (up.length > LAG) for (const b of up.shift()!) inst.onBinary('h0', new DataView(b));
      c.snap = null; inst.step(now);
      down.push(c.snap);
      if (down.length > LAG) {
        const snap = down.shift();
        if (snap?.self) {
          const before = pred && { x: pred.x, y: pred.y, z: pred.z, mode: pred.mode };
          pred = { ...snap.self, yaw, pitch };
          pending = pending.filter((p) => p.seq > snap.ack);
          for (const p of pending) stepPlayer(pred, p.cmd, world);
          // compare only when the mode did not just change server-side (boarding / leaving the ship is server-driven)
          if (pred.mv === 1) slid++;
          if (before && before.mode === pred.mode && pred.mode !== PM.Bus) { worst = Math.max(worst, Math.hypot(pred.x - before.x, pred.y - before.y, pred.z - before.z)); checks++; }
        }
      }
    }
    expect(checks).toBeGreaterThan(1500);
    expect(slid).toBeGreaterThan(5); // the replay covered slides too
    expect(pred.mode).toBe(PM.Walk); // made it down
    expect(worst).toBeLessThan(0.02);
  });
});
