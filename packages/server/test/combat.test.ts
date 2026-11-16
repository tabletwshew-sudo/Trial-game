import { describe, expect, it } from 'vitest';
import { ACT, ITEM, K, MV, PM, aimOrigin, decodeSnapshot, encodeInputs, makeStormPlan, raycastWorld, surfaceAt, weaponDef, type InputCmd, type ServerMsg, type Snapshot } from '@dropzone/shared';
import { MatchInstance, type Sock } from '../src/game/match';
import type { Match } from '../src/hub';

/** A hand-built match: `teams` lists team sizes; the first member of each listed team in `humans` is a human. */
function makeMatch(teamSizes: number[], humanTeams: number[], mode: Match['mode'] = 'squad'): Match {
  let n = 0;
  const teams = teamSizes.map((size, i) => ({
    id: i + 1, partyIds: [],
    members: Array.from({ length: size }, (_, k) => {
      const human = humanTeams.includes(i) && k < (i === humanTeams[0] && humanTeams.filter((t) => t === i).length > 1 ? 2 : 1);
      return { id: human ? `h${i}_${k}` : `b${n++}`, name: human ? `Human${i}${k}` : `Bot${n}`, bot: !human, skin: 0 };
    }),
  }));
  return { mode, teams, humans: 0, bots: 0, partyIds: [], id: 'mt', createdAt: 0 };
}

class Client implements Sock {
  msgs: ServerMsg[] = []; snap: Snapshot | null = null; seq = 0;
  json = (m: ServerMsg) => { this.msgs.push(m); };
  bin = (b: ArrayBuffer) => { this.snap = decodeSnapshot(new DataView(b)); };
  send(inst: MatchInstance, id: string, cmd: InputCmd, view = 0, n = 2) {
    const cmds = Array.from({ length: n }, () => cmd);
    inst.onBinary(id, new DataView(encodeInputs(this.seq + 1, cmds, view)));
    this.seq += n;
  }
  events() { return this.msgs.flatMap((m) => (m.t === 'ev' ? m.ev : [])); }
}

/** Run warm-up -> bus -> drop everyone; then teleport chosen players to a test area. */
function inPlay(teamSizes: number[], humanTeams: number[], mode: Match['mode'] = 'squad') {
  let now = 50_000_000;
  const inst = new MatchInstance(makeMatch(teamSizes, humanTeams, mode), { warmupS: 1, onEnd: () => {} }, now);
  const clients = new Map<string, Client>();
  for (const p of inst.players) if (!p.bot) { const c = new Client(); clients.set(p.id, c); inst.join(p.id, c, now); }
  const step = (ms = 1000 / 30) => { now += ms; inst.step(now); };
  while (inst.phase !== 'play') step(200);
  for (let i = 0; i < 300; i++) step(200); // everyone lands
  // no storm unless a test asks for one; NPC crews stood down
  inst.storm = null;
  for (const p of inst.players) if (p.npc) { p.alive = false; p.s.mode = PM.Dead; }
  // park all bots far away so they don't interfere
  inst.players.forEach((p, i) => { if (p.bot && !p.npc) { p.s.mode = PM.Walk; p.s.x = -900 + (i % 10) * 25; p.s.z = 600 + Math.floor(i / 10) * 25; p.s.y = surfaceAt(inst.world, p.s.x, p.s.z, 500); p.brain!.wander = null; p.brain!.idleUntil = Infinity; p.brain!.skill = 0; } });
  const place = (idx: number, x: number, z: number, yaw = 0) => {
    const s = inst.players[idx].s;
    s.mode = PM.Walk; s.x = x; s.z = z; s.y = surfaceAt(inst.world, x, z, 500); s.yaw = yaw; s.vx = s.vz = 0; s.grounded = true; s.hp = 100; s.shield = 0;
  };
  return { inst, clients, step, place, get now() { return now; } };
}

// an open, flat spot in the farm fields
const AT = { x: -640, z: 230 };

describe('shooting', () => {
  it('a rifle shot hits, damages shields then health, and the shooter gets a hit marker', () => {
    const g = inPlay([1, 1, 1, 1, 1, 1, 1, 1], [0, 1], 'solo');
    const [a, b] = [g.inst.players[0], g.inst.players[1]];
    g.place(a.idx, AT.x, AT.z, 0);
    g.place(b.idx, AT.x, AT.z - 20, 0); // 20 m north of a; yaw 0 faces north
    b.s.shield = 50;
    a.s.inv[0] = { id: ITEM.ar, r: 2, n: 1, mag: 30 }; a.s.slot = 0; a.s.cd = 0;
    const ca = g.clients.get(a.id)!;
    const o = aimOrigin(a.s.x, a.s.y, a.s.z, 0);
    const pitch = Math.atan2(b.s.y + 1.1 - o.y, Math.hypot(b.s.x - o.x, b.s.z - o.z));
    const yaw = Math.atan2(-(b.s.x - o.x), -(b.s.z - o.z));
    ca.send(g.inst, a.id, { keys: K.FIRE, yaw, pitch }, g.now, 1);
    g.step();
    const dmg = ca.events().find((e) => e.e === 'dmg');
    expect(dmg).toBeTruthy();
    const per = weaponDef(ITEM.ar)!.damage;
    expect(b.s.shield).toBeLessThan(50);
    expect(50 - b.s.shield + (100 - b.s.hp)).toBeGreaterThanOrEqual(Math.floor(per));
  });

  it('lag compensation: hits where the target WAS on your screen, not where they are now', () => {
    const g = inPlay([1, 1, 1, 1, 1, 1, 1, 1], [0, 1], 'solo');
    const [a, b] = [g.inst.players[0], g.inst.players[1]];
    g.place(a.idx, AT.x, AT.z, 0);
    g.place(b.idx, AT.x, AT.z - 25, 0);
    for (let i = 0; i < 6; i++) g.step(); // record history with b standing still
    const seenAt = g.now - 60;
    const o = aimOrigin(a.s.x, a.s.y, a.s.z, 0);
    const yaw = Math.atan2(-(b.s.x - o.x), -(b.s.z - o.z)), pitch = Math.atan2(b.s.y + 1.1 - o.y, 25);
    // b has since side-stepped 3 m - a pure "now" check would miss
    b.s.x += 3; g.step();
    a.s.inv[0] = { id: ITEM.dmr, r: 2, n: 1, mag: 10 }; a.s.slot = 0; a.s.cd = 0; a.s.bloom = 0;
    g.clients.get(a.id)!.send(g.inst, a.id, { keys: K.FIRE | K.ADS, yaw, pitch }, seenAt, 1);
    g.step();
    expect(b.s.hp).toBeLessThan(100);
    // ...but you can't claim a time from the distant past
    b.s.hp = 100; b.s.x += 20; for (let i = 0; i < 20; i++) g.step();
    a.s.cd = 0;
    g.clients.get(a.id)!.send(g.inst, a.id, { keys: 0, yaw, pitch }, seenAt, 1);
    g.clients.get(a.id)!.send(g.inst, a.id, { keys: K.FIRE | K.ADS, yaw, pitch }, seenAt, 1);
    g.step();
    expect(b.s.hp).toBe(100);
  });

  it('teammates cannot hurt each other; walls stop bullets', () => {
    const g = inPlay([2, 1, 1, 1], [0], 'duo');
    const [a, m] = [g.inst.players[0], g.inst.players[1]];
    g.place(a.idx, AT.x, AT.z, 0); g.place(m.idx, AT.x, AT.z - 10, 0);
    a.s.inv[0] = { id: ITEM.pump, r: 4, n: 1, mag: 5 }; a.s.slot = 0; a.s.cd = 0;
    const o = aimOrigin(a.s.x, a.s.y, a.s.z, 0);
    g.clients.get(a.id)!.send(g.inst, a.id, { keys: K.FIRE, yaw: Math.atan2(-(m.s.x - o.x), -(m.s.z - o.z)), pitch: -0.05 }, g.now, 1);
    g.step();
    expect(m.s.hp).toBe(100);
  });
});

describe('knocked, revive, eliminated', () => {
  it('in squads you get knocked, a teammate can revive you, and a full wipe eliminates the team', () => {
    const g = inPlay([2, 2, 2, 2], [0, 0]);
    const [a, mate] = [g.inst.players[0], g.inst.players[1]];
    expect(mate.bot).toBe(false);
    g.place(a.idx, AT.x, AT.z); g.place(mate.idx, AT.x + 1.5, AT.z);
    a.s.hp = 1; a.lastHit = { by: 4, at: g.now, w: ITEM.ar, cause: 'gun' };
    a.s.hp = 0; (g.inst as any).checkDown(a);
    expect(a.s.mode).toBe(PM.Knocked);
    expect(g.clients.get(a.id)!.events().some((e) => e.e === 'feed' && e.knock)).toBe(true);
    // knocked: crawling, no shooting
    const cm = g.clients.get(mate.id)!;
    cm.send(g.inst, mate.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    expect(mate.s.act).toBe(ACT.Reviving);
    for (let i = 0; i < 30 * 7.5; i++) { cm.send(g.inst, mate.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step(); }
    expect(a.s.mode).toBe(PM.Walk); expect(a.s.hp).toBe(30); expect(mate.s.act).toBe(ACT.None);
    // knock both: the team is out, and both get a placement
    for (const it of g.inst.loot.near(AT.x, AT.z, 12)) g.inst.loot.remove(it.id);
    a.s.inv[0] = { id: ITEM.ar, r: 1, n: 1, mag: 20 }; a.s.ammo[1] = 40;
    for (const p of [a, mate]) { p.s.hp = 0; p.lastHit = { by: 4, at: g.now, w: ITEM.ar, cause: 'gun' }; (g.inst as any).checkDown(p); }
    expect(a.alive).toBe(false); expect(mate.alive).toBe(false);
    const result = g.clients.get(a.id)!.msgs.find((m) => m.t === 'result');
    expect(result && result.t === 'result' && result.result.place).toBeGreaterThan(1);
    const dropped = g.inst.loot.near(AT.x, AT.z, 10);
    expect(dropped.some((x) => x.item === ITEM.ar)).toBe(true); // dropped their gun...
    expect(dropped.some((x) => x.item === ITEM.ammoMedium && x.n === 40)).toBe(true); // ...and their ammo
  });

  it('knocked players bleed out', () => {
    const g = inPlay([2, 2], [0, 0]);
    const [a, mate] = [g.inst.players[0], g.inst.players[1]];
    g.place(a.idx, AT.x, AT.z); g.place(mate.idx, AT.x + 40, AT.z);
    a.s.hp = 0; a.lastHit = { by: 2, at: g.now, w: 0, cause: 'gun' }; (g.inst as any).checkDown(a);
    for (let i = 0; i < 30 * 70; i++) g.step();
    expect(a.alive).toBe(false);
    expect(g.inst.players[2].kills).toBe(1); // the knocker gets the elimination
  });

  it('the last team standing wins', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const [a, b] = [g.inst.players[0], g.inst.players[1]];
    b.s.hp = 0; b.lastHit = { by: a.idx, at: g.now, w: ITEM.ar, cause: 'gun' }; (g.inst as any).checkDown(b);
    const r = g.clients.get(a.id)!.msgs.find((m) => m.t === 'result');
    expect(r && r.t === 'result' && r.result).toMatchObject({ place: 1, win: true, kills: 1 });
  });
});

describe('loot and cars', () => {
  it('E picks up the item in front of you; a full inventory swaps with your hands', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const a = g.inst.players[0], c = g.clients.get(a.id)!;
    g.place(a.idx, AT.x, AT.z, 0);
    for (const it of g.inst.loot.near(AT.x, AT.z, 6)) g.inst.loot.remove(it.id);
    for (let i = 0; i < 5; i++) a.s.inv[i] = { id: ITEM.pistol, r: 0, n: 1, mag: 16 };
    const it = g.inst.loot.add(ITEM.sniper, 3, 4, AT.x, a.s.y, AT.z - 1.2);
    c.send(g.inst, a.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    expect(a.s.inv[0]).toMatchObject({ id: ITEM.sniper, r: 3, mag: 4 });
    expect(g.inst.loot.get(it.id)).toBeUndefined();
    expect(g.inst.loot.near(AT.x, AT.z, 4).some((x) => x.item === ITEM.pistol)).toBe(true); // old gun dropped
    // ammo is picked up just by walking over it
    g.inst.loot.add(ITEM.ammoHeavy, 0, 12, a.s.x, a.s.y, a.s.z);
    g.step();
    expect(a.s.ammo[2]).toBe(12);
  });

  it('get in a car, drive it, passengers ride along, and get out', () => {
    const g = inPlay([2, 1], [0, 0], 'duo');
    const [a, mate] = [g.inst.players[0], g.inst.players[1]];
    const car = g.inst.vehicles[0];
    car.vs = 0;
    g.place(a.idx, car.x + 2, car.z); g.place(mate.idx, car.x - 2, car.z);
    const ca = g.clients.get(a.id)!, cm = g.clients.get(mate.id)!;
    ca.send(g.inst, a.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    cm.send(g.inst, mate.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    expect(a.s.mode).toBe(PM.Drive); expect(mate.s.mode).toBe(PM.Ride);
    const x0 = car.x, z0 = car.z;
    for (let i = 0; i < 60; i++) { ca.send(g.inst, a.id, { keys: K.F, yaw: 0, pitch: 0 }); cm.send(g.inst, mate.id, { keys: 0, yaw: 0, pitch: 0 }); g.step(); }
    expect(Math.hypot(car.x - x0, car.z - z0)).toBeGreaterThan(10);
    expect(Math.hypot(mate.s.x - car.x, mate.s.z - car.z)).toBeLessThan(2); // passenger moved with it
    expect(ca.snap!.vehs.find((v) => v.id === car.id)?.driver).toBe(true);
    ca.send(g.inst, a.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    expect(a.s.mode).toBe(PM.Walk); expect(car.seats[0]).toBe(-1);
    expect(Math.hypot(a.s.x - car.x, a.s.z - car.z)).toBeGreaterThan(1.2);
  });

  it('shooting a car enough destroys it and throws everyone out', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const car = g.inst.vehicles[1];
    (g.inst as any).damageCar(car, 2000, -1);
    expect(car.dead).toBe(true);
    g.step();
    expect(g.clients.get(g.inst.players[0].id)!.snap!.vehs.some((v) => v.id === car.id)).toBe(false);
  });
});

describe('a full match with 80 bots', () => {
  it('runs fast, bots loot and fight, and the books always balance', () => {
    let now = 70_000_000;
    const teams = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, partyIds: [], members: Array.from({ length: 4 }, (_, k) => ({ id: i === 0 && k === 0 ? 'h0' : `b${i}_${k}`, name: `P${i}${k}`, bot: !(i === 0 && k === 0), skin: 0 })) }));
    const inst = new MatchInstance({ mode: 'squad', teams, humans: 1, bots: 79, partyIds: [], id: 'big', createdAt: 0 }, { warmupS: 2, onEnd: () => {} }, now);
    const c = new Client(); inst.join('h0', c, now);
    let worst = 0, total = 0, ticks = 0;
    const moves = { slide: 0, mantle: 0 };
    for (let i = 0; i < 30 * 60 * 6; i++) { // six minutes of match time
      now += 1000 / 30;
      const t0 = performance.now(); inst.step(now); const ms = performance.now() - t0;
      total += ms; ticks++; if (i > 30 * 90) worst = Math.max(worst, ms);
      for (const p of inst.players) { if (p.s.mv === MV.Slide) moves.slide++; else if (p.s.mv === MV.Mantle || p.s.mv === MV.Hurdle) moves.mantle++; }
      if (inst.ended) break;
      // invariants
      if (i % 300 === 0) {
        const alive = inst.players.filter((p) => p.alive);
        expect(c.msgs.filter((m) => m.t === 'alive').pop()?.t === 'alive' || i < 100).toBe(true);
        for (const p of inst.players) {
          expect(p.s.hp).toBeGreaterThanOrEqual(0); expect(p.s.hp).toBeLessThanOrEqual(100);
          expect(p.s.shield).toBeLessThanOrEqual(100);
          for (const sl of p.s.inv) if (sl.id) expect(sl.mag).toBeLessThanOrEqual(weaponDef(sl.id)?.mag ?? 255);
          if (!p.alive) expect(p.s.mode).toBe(PM.Dead);
        }
        void alive;
      }
    }
    const feed = c.events().filter((e) => e.e === 'feed');
    const looted = inst.players.filter((p) => p.bot && p.s.inv.some((s) => s.id)).length;
    const elims = inst.players.filter((p) => !p.alive).length;
    // eslint-disable-next-line no-console
    console.log(`slides ${moves.slide} mantles ${moves.mantle}; avg ${(total / ticks).toFixed(2)} ms/tick, worst ${worst.toFixed(1)} ms; ${elims} eliminated, ${feed.length} feed lines, ${looted} bots holding loot, loot on ground ${inst.loot.size}`);
    expect(total / ticks).toBeLessThan(8);
    expect(feed.length).toBeGreaterThan(10); // they actually fight
    expect(moves.slide).toBeGreaterThan(20); // bots slide...
    expect(moves.mantle).toBeGreaterThan(5); // ...and climb over things they walk into
    expect(elims).toBeGreaterThan(5);
    // kills add up: every elimination by a player is credited once
    const credited = inst.players.reduce((n, p) => n + p.kills, 0);
    expect(credited).toBeLessThanOrEqual(elims);
    // placements are consistent for eliminated teams
    for (const t of teams) {
      const ps = inst.players.filter((p) => p.team === t.id);
      if (ps.every((p) => !p.alive)) expect(new Set(ps.map((p) => p.place)).size).toBe(1);
    }
  }, 120_000);
});

describe('chests, supply drops, forage', () => {
  it('the island is stocked: chests in buildings and outdoors, ammo boxes, forage', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const kinds = [0, 0, 0];
    for (const c of g.inst.chests.values()) kinds[c.k]++;
    expect(kinds[0]).toBeGreaterThan(80);
    expect(kinds[1]).toBeGreaterThan(20);
    const forage = g.inst.loot.all().filter((x) => x.item === ITEM.apple || x.item === ITEM.glowcap).length;
    expect(forage).toBeGreaterThan(50);
  });

  it('E opens a chest: a weapon, its ammo and a heal spill out in front of it', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const a = g.inst.players[0], c = g.clients.get(a.id)!;
    const chest = [...g.inst.chests.values()].find((x) => x.k === 0 && !x.open)!;
    const fd = [[0, 1], [1, 0], [0, -1], [-1, 0]][chest.face];
    a.s.mode = PM.Walk; a.s.x = chest.x + fd[0] * 1.4; a.s.z = chest.z + fd[1] * 1.4; a.s.y = chest.y; a.s.grounded = true;
    for (const it of g.inst.loot.near(chest.x, chest.z, 4)) g.inst.loot.remove(it.id);
    const yaw = Math.atan2(-(chest.x - a.s.x), -(chest.z - a.s.z));
    c.send(g.inst, a.id, { keys: K.USE, yaw, pitch: 0 }); g.step();
    expect(chest.open).toBe(true);
    const spill = g.inst.loot.near(chest.x, chest.z, 4);
    const weapons = spill.filter((x) => weaponDef(x.item));
    expect(weapons.length).toBe(1);
    expect(weapons[0].r).toBeGreaterThanOrEqual(1); // chests never give commons
    expect(spill.length).toBeGreaterThanOrEqual(3);
    expect(c.msgs.some((m) => m.t === 'chests' && m.open.includes(chest.id))).toBe(true);
    // can't open it twice
    c.send(g.inst, a.id, { keys: 0, yaw, pitch: 0 }); c.send(g.inst, a.id, { keys: K.USE, yaw, pitch: 0 }); g.step();
    expect(g.inst.loot.near(chest.x, chest.z, 4).length).toBeLessThanOrEqual(spill.length);
  });

  it('eating an apple heals right away', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const a = g.inst.players[0], c = g.clients.get(a.id)!;
    g.place(a.idx, AT.x, AT.z); a.s.hp = 50;
    for (const it of g.inst.loot.near(AT.x, AT.z, 4)) g.inst.loot.remove(it.id);
    g.inst.loot.add(ITEM.apple, 0, 1, AT.x, a.s.y, AT.z - 1);
    c.send(g.inst, a.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    expect(a.s.hp).toBe(55);
    expect(a.s.inv.every((x) => x.id === 0)).toBe(true);
  });

  it('supply drops fall from the sky, land, and hold better loot', () => {
    const g = inPlay([1, 1], [0], 'solo');
    for (let i = 0; i < 30 * 45; i++) g.step(); // 45 s into the match
    const drop = [...g.inst.chests.values()].find((x) => x.k === 2);
    expect(drop).toBeTruthy();
    expect(g.clients.get(g.inst.players[0].id)!.events().some((e) => e.e === 'supply')).toBe(true);
    for (let i = 0; i < 30 * 40 && drop!.y !== drop!.landY; i++) g.step();
    expect(drop!.y).toBe(drop!.landY);
    const a = g.inst.players[0], c = g.clients.get(a.id)!;
    a.s.mode = PM.Walk; a.s.x = drop!.x; a.s.z = drop!.z + 1.5; a.s.y = drop!.y; a.s.grounded = true;
    for (const it of g.inst.loot.near(drop!.x, drop!.z, 5)) g.inst.loot.remove(it.id);
    c.send(g.inst, a.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step();
    const w = g.inst.loot.near(drop!.x, drop!.z, 5).find((x) => weaponDef(x.item));
    expect(w && w.r).toBeGreaterThanOrEqual(2);
  });

  it('bots go indoors through the door to loot a chest', () => {
    const g = inPlay([1, 1, 1], [0], 'solo');
    const bot = g.inst.players[1];
    const L = g.inst.world.layouts.find((x) => x.type === 'house' && x.floors.length === 1 && x.chests.length)!;
    const sp = L.chests[0];
    // clear the area, put one chest inside, the bot outside the front door
    for (const c of g.inst.chests.values()) if (Math.hypot(c.x - sp.x, c.z - sp.z) < 60) c.open = true;
    for (const it of g.inst.loot.near(sp.x, sp.z, 60)) g.inst.loot.remove(it.id);
    const chest = { id: 99999, k: 0, x: sp.x, y: sp.y, z: sp.z, face: sp.face, open: false };
    g.inst.chests.set(chest.id, chest);
    const d = L.doors[0];
    bot.s.mode = PM.Walk; bot.s.x = d.x + (d.x - d.ix) * 2; bot.s.z = d.z + (d.z - d.iz) * 2; bot.s.y = surfaceAt(g.inst.world, bot.s.x, bot.s.z, 500); bot.s.grounded = true;
    bot.s.inv = bot.s.inv.map(() => ({ id: 0, r: 0, n: 0, mag: 0 }));
    bot.brain!.idleUntil = 0; bot.brain!.enemy = -1; bot.brain!.lootId = -1; bot.brain!.ignoreLoot.clear();
    g.inst.players[2].alive = false; g.inst.players[2].s.mode = PM.Dead; // no distractions
    for (let i = 0; i < 30 * 25 && !chest.open; i++) g.step();
    expect(chest.open).toBe(true);
  });
});

describe('storm', () => {
  it('outside the circle you lose health (not shield) every second', () => {
    const g = inPlay([1, 1], [0], 'solo');
    const a = g.inst.players[0];
    g.inst.storm = makeStormPlan(g.inst.world, 1, g.now - 1000);
    g.inst.storm!.circles[0] = { x: 900, z: 900, r: 20 }; // a tiny circle far away
    g.place(a.idx, AT.x, AT.z); a.s.shield = 50;
    for (let i = 0; i < 30 * 3.2; i++) g.step();
    expect(a.s.shield).toBe(50);
    expect(a.s.hp).toBeLessThanOrEqual(97);
    expect(g.clients.get(a.id)!.events().some((e) => e.e === 'storm_hurt')).toBe(true);
  });

  it('a full 80-player match ends with one winner once the storm closes', () => {
    let now = 90_000_000;
    const teams = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, partyIds: [], members: Array.from({ length: 4 }, (_, k) => ({ id: i === 0 && k === 0 ? 'h0' : `b${i}_${k}`, name: `P${i}${k}`, bot: !(i === 0 && k === 0), skin: 0 })) }));
    const inst = new MatchInstance({ mode: 'squad', teams, humans: 1, bots: 79, partyIds: [], id: 'full', createdAt: 0 }, { warmupS: 2, onEnd: () => {} }, now);
    const c = new Client(); inst.join('h0', c, now);
    let ended = 0;
    for (let i = 0; i < 30 * 60 * 16 && !ended; i++) {
      now += 1000 / 30; inst.step(now);
      if (inst.players.filter((p) => !p.npc && p.alive && !p.gone).map((p) => p.team).filter((t, k, a) => a.indexOf(t) === k).length <= 1) ended = now;
    }
    expect(ended).toBeGreaterThan(0);
    const minutes = (ended - 90_000_000) / 60_000;
    // eslint-disable-next-line no-console
    console.log(`match finished after ${minutes.toFixed(1)} min`);
    for (let i = 0; i < 10; i++) { now += 1000 / 30; inst.step(now); }
    const winners = inst.players.filter((p) => !p.npc && p.alive);
    expect(new Set(winners.map((p) => p.team)).size).toBe(1);
    expect(winners.every((p) => p.place === 1)).toBe(true);
    // every eliminated team got a single, unique placement
    const places = new Map<number, number>();
    for (const p of inst.players) if (!p.npc && !p.alive) places.set(p.team, p.place);
    expect(new Set(places.values()).size).toBe(places.size);
    const res = c.msgs.find((m) => m.t === 'result');
    expect(res && res.t === 'result' && res.result.stats).toBeTruthy();
    expect(res && res.t === 'result' && res.result.squad.length).toBe(4);
  }, 180_000);
});

describe('bosses and vaults', () => {
  it('bosses take reduced damage, drop a keycard, and the keycard opens the vault', () => {
    let now = 60_000_000;
    const inst = new MatchInstance(makeMatch([1, 1], [0], 'solo'), { warmupS: 1, onEnd: () => {} }, now);
    const c = new Client(); inst.join('h0_0', c, now);
    const step = () => { now += 1000 / 30; inst.step(now); };
    while (inst.phase === 'warmup') step();
    const boss = inst.players.find((p) => p.npc === 'boss')!;
    expect(boss.alive).toBe(true);
    expect(Math.hypot(boss.s.x - boss.post!.x, boss.s.z - boss.post!.z)).toBeLessThan(1);
    expect(boss.s.shield).toBe(100);
    const me = inst.players.find((p) => p.id === 'h0_0')!;
    // 100 raw damage only takes 30 off the boss
    (inst as any).damage(boss, 100, me, 'gun', ITEM.ar);
    expect(100 + 100 - boss.s.hp - boss.s.shield).toBe(30);
    expect(me.kills).toBe(0);
    boss.s.hp = 1; boss.s.shield = 0;
    (inst as any).damage(boss, 50, me, 'gun', ITEM.ar);
    expect(boss.alive).toBe(false);
    expect(me.kills).toBe(0); // NPCs don't count as eliminations
    const v = inst.world.vaults.find((x) => Math.hypot(x.post.x - boss.post!.x, x.post.z - boss.post!.z) < 10)!;
    const card = inst.loot.near(boss.s.x, boss.s.z, 5).find((it) => it.item === ITEM.keycard)!;
    expect(card).toBeTruthy();
    // walk up, take the card, and try the door
    me.s.mode = PM.Walk; me.s.x = card.x; me.s.z = card.z + 1; me.s.y = surfaceAt(inst.world, me.s.x, me.s.z, 500); me.s.grounded = true;
    for (const it of inst.loot.near(card.x, card.z, 4)) if (it.id !== card.id) inst.loot.remove(it.id);
    c.send(inst, 'h0_0', { keys: K.USE, yaw: 0, pitch: 0 }); step();
    expect(me.s.inv.some((sl) => sl.id === ITEM.keycard)).toBe(true);
    // the door blocks you until it's opened
    const inside = v.chests[1];
    expect(raycastWorld(inst.world, { x: v.door.x, y: v.y + 1.2, z: v.door.z }, (() => { const dx = inside.x - v.door.x, dz = inside.z - v.door.z, l = Math.hypot(dx, dz); return { x: dx / l, y: 0, z: dz / l }; })(), 6).kind).toBe('building');
    me.s.x = v.door.x; me.s.z = v.door.z; me.s.y = surfaceAt(inst.world, me.s.x, me.s.z, v.y + 2);
    c.send(inst, 'h0_0', { keys: 0, yaw: 0, pitch: 0 }); c.send(inst, 'h0_0', { keys: K.USE, yaw: 0, pitch: 0 }); step();
    expect(inst.world.openVaults!.has(v.id)).toBe(true);
    expect(me.s.inv.some((sl) => sl.id === ITEM.keycard)).toBe(false);
    expect(c.msgs.some((m) => m.t === 'vaults' && m.open.includes(v.id))).toBe(true);
    // ...and another match on the same server still has its vault locked
    const other = new MatchInstance(makeMatch([1, 1], [0], 'solo'), { warmupS: 1, onEnd: () => {} }, now);
    expect(other.world.openVaults!.has(v.id)).toBe(false);
    // the vault chests are rich
    const vc = [...inst.chests.values()].filter((x) => x.rich);
    expect(vc.length).toBe(inst.world.vaults.length * 3);
  });
});

describe('recall beacons', () => {
  it('a teammate carries your card to a beacon and you drop back in', () => {
    const g = inPlay([2, 2, 2], [0, 0], 'duo');
    const [a, mate] = [g.inst.players[0], g.inst.players[1]];
    const b = g.inst.world.beacons[0];
    g.place(a.idx, b.x + 6, b.z); g.place(mate.idx, b.x + 4, b.z);
    for (const it of g.inst.loot.near(b.x, b.z, 12)) g.inst.loot.remove(it.id);
    // a goes down and out (mate is still up, so a is knocked first, then finished)
    a.s.hp = 0; a.lastHit = { by: 2, at: g.now, w: ITEM.ar, cause: 'gun' }; (g.inst as any).checkDown(a);
    a.s.knock = 0; (g.inst as any).checkDown(a, true);
    expect(a.alive).toBe(false);
    const card = g.inst.loot.near(a.s.x, a.s.z, 4).find((it) => it.item === ITEM.card)!;
    expect(card.r).toBe(a.idx);
    const cm = g.clients.get(mate.id)!;
    mate.s.x = card.x - 1; mate.s.z = card.z; mate.s.y = surfaceAt(g.inst.world, mate.s.x, mate.s.z, 500);
    cm.send(g.inst, mate.id, { keys: K.USE, yaw: -Math.PI / 2, pitch: 0 }); g.step();
    expect(mate.cards).toEqual([a.idx]);
    // to the beacon, hold E
    mate.s.x = b.x + 1.8; mate.s.z = b.z; mate.s.y = surfaceAt(g.inst.world, mate.s.x, mate.s.z, 500);
    cm.send(g.inst, mate.id, { keys: 0, yaw: 0, pitch: 0 });
    for (let i = 0; i < 30 * 4.5; i++) { cm.send(g.inst, mate.id, { keys: K.USE, yaw: 0, pitch: 0 }); g.step(); }
    expect(a.alive).toBe(true);
    expect(a.s.mode).toBe(PM.Fall);
    expect(a.s.inv[0].id).toBe(ITEM.pistol);
    expect(mate.cards.length).toBe(0);
    expect(g.clients.get(a.id)!.events().some((e) => e.e === 'recalled' && e.i === a.idx)).toBe(true);
  });
});

describe('spectating', () => {
  it('eliminated players can cycle who they watch', () => {
    const g = inPlay([1, 1, 1, 1], [0], 'solo');
    const a = g.inst.players[0];
    a.s.hp = 0; a.lastHit = { by: 1, at: g.now, w: ITEM.ar, cause: 'gun' }; (g.inst as any).checkDown(a);
    g.step();
    const first = a.spec;
    expect(first).toBeGreaterThan(0);
    g.inst.onSpecNext(a.id, 1); g.step();
    expect(a.spec).not.toBe(first);
    expect(g.inst.players[a.spec].alive).toBe(true);
  });
});
