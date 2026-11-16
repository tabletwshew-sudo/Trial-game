/**
 * Soak test: plays many complete 80-player matches headless (every mode, with a few simulated
 * human clients sending real input packets alongside the bots) and checks invariants the whole
 * way through. Run with:  npx tsx packages/server/test/soak.ts [matches]
 */
import { K, PM, encodeInputs, terrainAt, type InputCmd } from '@dropzone/shared';
import { MatchInstance, type Sock } from '../src/game/match';
import type { Match } from '../src/hub';

const N = Number(process.argv[2] ?? 8);
const MODES = ['solo', 'duo', 'trio', 'squad'] as const;
const SIZE = { solo: 1, duo: 2, trio: 3, squad: 4 } as const;

class Client implements Sock {
  msgs: { t: string }[] = [];
  json(m: unknown) { if ((m as { t: string }).t === 'result') this.msgs.push(m as { t: string }); }
  bin() { /* snapshots ignored */ }
}

function makeMatch(mode: (typeof MODES)[number], humans: number, id: string): Match {
  const size = SIZE[mode], teamsN = Math.floor((mode === 'trio' ? 78 : 80) / size);
  let h = 0;
  const teams = Array.from({ length: teamsN }, (_, i) => ({
    id: i + 1, partyIds: [],
    members: Array.from({ length: size }, (_, k) => { const human = h < humans && k === 0; if (human) h++; return { id: human ? `h${i}` : `b${i}_${k}`, name: `P${i}_${k}`, bot: !human, skin: (i + k) % 8 }; }),
  }));
  return { mode, teams, humans, bots: teamsN * size - humans, partyIds: [], id, createdAt: 0 } as Match;
}

interface Report { mode: string; minutes: number; winners: number; elims: number; errors: number; nan: number; underMap: number; flying: number; stuckBots: number; hpBad: number; ms: number }

function play(i: number): Report {
  const mode = MODES[i % 4];
  const humans = 1 + (i % 3);
  const match = makeMatch(mode, humans, `soak${i}`);
  let now = 100_000_000 + i * 10_000_000;
  const start = now;
  const inst = new MatchInstance(match, { warmupS: 3, onEnd: () => {} }, now);
  const humanIds = match.teams.flatMap((t) => t.members).filter((m) => !m.bot).map((m) => m.id);
  const clients = new Map(humanIds.map((id) => [id, new Client()]));
  for (const [id, c] of clients) inst.join(id, c, now);
  const r: Report = { mode, minutes: 0, winners: 0, elims: 0, errors: 0, nan: 0, underMap: 0, flying: 0, stuckBots: 0, hpBad: 0, ms: 0 };
  // simulated humans: wander, sprint, slide, jump, shoot, jump out of the ship when the doors open
  const seqs = new Map(humanIds.map((id) => [id, 0]));
  const rnd = (() => { let s = 99 + i; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); })();
  const held = new Map<string, InputCmd>();
  const lastMoved = new Map<number, { x: number; z: number; at: number }>();
  const stuck = new Set<number>();
  const t0 = performance.now();
  let ended = 0;
  for (let tick = 0; tick < 30 * 60 * 18 && !ended; tick++) {
    now += 1000 / 30;
    if (tick % 15 === 0) for (const id of humanIds) {
      held.set(id, { keys: (rnd() < 0.85 ? K.F : 0) | (rnd() < 0.5 ? K.SPRINT : 0) | (rnd() < 0.15 ? K.CROUCH : 0) | (rnd() < 0.2 ? K.JUMP : 0) | (rnd() < 0.25 ? K.FIRE : 0) | (rnd() < 0.1 ? K.USE : 0), yaw: rnd() * 6.28, pitch: (rnd() - 0.6) * 1.2, slot: rnd() < 0.1 ? 1 + Math.floor(rnd() * 5) : 0 });
    }
    for (const id of humanIds) {
      const cmd = held.get(id)!;
      const seq = seqs.get(id)! + 2; seqs.set(id, seq);
      try { inst.onBinary(id, new DataView(encodeInputs(seq - 1, [cmd, { ...cmd, keys: cmd.keys & ~(K.JUMP | K.USE), slot: 0 }], now - 100))); } catch { r.errors++; }
    }
    try { inst.step(now); } catch (e) { r.errors++; if (r.errors < 3) console.error(e); }
    // invariants, once a second
    if (tick % 30 === 0) {
      for (const p of inst.players) {
        const s = p.s;
        if (![s.x, s.y, s.z, s.vx, s.vy, s.vz].every(Number.isFinite)) r.nan++;
        if (s.hp < 0 || s.hp > 100 || s.shield < 0 || s.shield > 100) r.hpBad++;
        if (!p.alive || p.gone) continue;
        if ((s.mode === PM.Walk || s.mode === PM.Knocked) && s.y < terrainAt(inst.world, s.x, s.z) - 3 && s.y < -3) r.underMap++;
        if (s.mode === PM.Walk && s.y > 700) r.flying++;
        // bots standing in one spot for a long time during the match (not NPCs, who guard a post)
        if (p.bot && !p.npc && inst.phase === 'play' && s.mode === PM.Walk) {
          const lm = lastMoved.get(p.idx);
          if (!lm || Math.hypot(s.x - lm.x, s.z - lm.z) > 3) lastMoved.set(p.idx, { x: s.x, z: s.z, at: now });
          else if (now - lm.at > 90_000) stuck.add(p.idx);
        }
      }
    }
    const teamsLeft = new Set(inst.players.filter((p) => !p.npc && p.alive && !p.gone).map((p) => p.team));
    if (inst.phase === 'play' && teamsLeft.size <= 1) ended = now;
  }
  for (let k = 0; k < 20; k++) { now += 1000 / 30; try { inst.step(now); } catch { r.errors++; } }
  r.ms = Math.round(performance.now() - t0);
  r.minutes = +((ended - start) / 60_000).toFixed(1);
  r.winners = new Set(inst.players.filter((p) => !p.npc && p.alive).map((p) => p.team)).size;
  r.elims = inst.players.filter((p) => !p.npc && !p.alive).length;
  r.stuckBots = stuck.size;
  if (!ended) r.minutes = -1;
  return r;
}

const reports: Report[] = [];
for (let i = 0; i < N; i++) {
  const r = play(i);
  reports.push(r);
  console.log(JSON.stringify({ match: i, ...r }));
}
const bad = reports.filter((r) => r.minutes < 0 || r.winners !== 1 || r.errors || r.nan || r.hpBad || r.underMap || r.flying);
console.log(`\n${reports.length} matches, ${bad.length} with problems; avg ${(reports.reduce((a, r) => a + r.minutes, 0) / reports.length).toFixed(1)} min, stuck bots total ${reports.reduce((a, r) => a + r.stuckBots, 0)}`);
process.exit(bad.length ? 1 : 0);
