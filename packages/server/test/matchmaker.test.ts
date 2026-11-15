import { describe, expect, it } from 'vitest';
import { packTeams, tryFormMatch, validateParty, makeBotNamer, type QueuedParty } from '../src/matchmaker';
import type { Mode } from '@dropzone/shared';

let pid = 0;
const party = (mode: Mode, size: number, fill = true, at = 0): QueuedParty => {
  const id = `p${++pid}`;
  return { partyId: id, mode, fill, enqueuedAt: at, members: Array.from({ length: size }, (_, i) => ({ id: `${id}m${i}`, name: `${id}m${i}`, skin: 0 })) };
};
const names = makeBotNamer(42);
const form = (q: QueuedParty[], mode: Mode, now = 60_000) => tryFormMatch(q, mode, now, 30, names);
const sizes = (m: NonNullable<ReturnType<typeof form>>) => m.teams.map((t) => t.members.length);
const humansIn = (t: { members: { bot: boolean }[] }) => t.members.filter((m) => !m.bot).length;

describe('packTeams', () => {
  it('merges a solo and a trio into one squad when both fill', () => {
    const t = packTeams([party('squad', 1), party('squad', 3)], 4);
    expect(t).toHaveLength(1);
    expect(t[0].size).toBe(4);
  });
  it('never merges a no-fill party', () => {
    const t = packTeams([party('squad', 2, false), party('squad', 2, true)], 4);
    expect(t).toHaveLength(2);
  });
  it('packs 2+2+1+1+1+1 into two full squads', () => {
    const t = packTeams([1, 2, 1, 2, 1, 1].map((s) => party('squad', s)), 4);
    expect(t.map((x) => x.size).sort()).toEqual([4, 4]);
  });
  it('trio + trio stay separate squads (each gets a filler)', () => {
    expect(packTeams([party('squad', 3), party('squad', 3)], 4)).toHaveLength(2);
  });
});

describe('validateParty', () => {
  it('rejects parties bigger than the team size', () => {
    expect(validateParty('duo', 3)).toMatch(/too many/);
    expect(validateParty('squad', 4)).toBeNull();
    expect(validateParty('solo', 1)).toBeNull();
  });
});

describe('tryFormMatch', () => {
  it('waits until the queue timeout when the lobby is not full', () => {
    expect(form([party('squad', 2)], 'squad', 10_000)).toBeNull();
    expect(form([party('squad', 2)], 'squad', 30_000)).not.toBeNull();
  });

  it('two real squads -> 18 bot squads, 80 total', () => {
    const m = form([party('squad', 4), party('squad', 4)], 'squad')!;
    expect(m.teams).toHaveLength(20);
    expect(sizes(m).every((s) => s === 4)).toBe(true);
    expect(m.humans).toBe(8);
    expect(m.bots).toBe(72);
    expect(m.teams.filter((t) => humansIn(t) === 0)).toHaveLength(18);
  });

  it('solo filling squads gets 3 bot teammates', () => {
    const m = form([party('squad', 1)], 'squad')!;
    const mine = m.teams.find((t) => humansIn(t) === 1)!;
    expect(mine.members).toHaveLength(4);
    expect(mine.members.filter((x) => x.bot)).toHaveLength(3);
  });

  it('solo + trio queued with fill land on the same team', () => {
    const a = party('squad', 1), b = party('squad', 3);
    const m = form([a, b], 'squad')!;
    const team = m.teams.find((t) => t.partyIds.includes(a.partyId))!;
    expect(team.partyIds).toContain(b.partyId);
    expect(humansIn(team)).toBe(4);
  });

  it('no-fill duo in squads plays short-handed', () => {
    const m = form([party('squad', 2, false)], 'squad')!;
    expect(m.teams.find((t) => humansIn(t) === 2)!.members).toHaveLength(2);
    expect(m.teams).toHaveLength(20);
  });

  it('trios hold 78 players in 26 teams', () => {
    const m = form([party('trio', 3)], 'trio')!;
    expect(m.teams).toHaveLength(26);
    expect(m.humans + m.bots).toBe(78);
  });

  it('solos: 80 teams of one', () => {
    const m = form([party('solo', 1), party('solo', 1)], 'solo')!;
    expect(m.teams).toHaveLength(80);
    expect(m.humans + m.bots).toBe(80);
  });

  it('forms immediately when humans fill the lobby, overflow stays queued', () => {
    const q = Array.from({ length: 81 }, (_, i) => party('solo', 1, true, i));
    const m = tryFormMatch(q, 'solo', 100, 30, names)!; // well before timeout
    expect(m).not.toBeNull();
    expect(m.humans).toBe(80);
    expect(m.bots).toBe(0);
    expect(m.partyIds).not.toContain(q[80].partyId); // last in line waits
  });

  it('ignores other modes and oversized parties', () => {
    expect(form([party('duo', 2)], 'squad')).toBeNull();
    expect(form([party('duo', 3)], 'duo')).toBeNull();
  });

  it('every human appears exactly once', () => {
    const q = [1, 2, 3, 4, 1, 1, 2, 3].map((s) => party('squad', s));
    const m = form(q, 'squad')!;
    const ids = m.teams.flatMap((t) => t.members.filter((x) => !x.bot).map((x) => x.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(17);
    expect(m.teams.every((t) => t.members.length <= 4)).toBe(true);
  });
});

describe('bot names', () => {
  it('are unique and valid-looking', () => {
    const n = makeBotNamer(7);
    const list = Array.from({ length: 300 }, n);
    expect(new Set(list).size).toBe(300);
    expect(list.every((x) => x.length >= 3 && x.length <= 16)).toBe(true);
  });
});
