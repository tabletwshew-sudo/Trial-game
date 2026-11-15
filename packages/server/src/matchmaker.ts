import { TEAM_SIZE, matchCapacity, type Mode } from '@dropzone/shared';

/**
 * Pure matchmaking logic (no I/O) so it can be unit-tested exhaustively.
 *
 * Rules:
 *  - A party with fill=false always plays as its own team, even if short-handed.
 *  - Parties with fill=true are packed together into full teams
 *    (e.g. a solo + a trio in Squads become one team). Any gaps left get bot teammates.
 *  - A match forms when the humans fill the lobby, or when the oldest party has
 *    waited `timeoutS`. All remaining team slots become bot teams.
 *  - Parties are taken first-in-first-out. A party that doesn't fit stays queued.
 */

export interface QueuedPlayer { id: string; name: string; skin: number }
export interface QueuedParty {
  partyId: string;
  mode: Mode;
  fill: boolean;
  members: QueuedPlayer[];
  enqueuedAt: number; // ms
}

export interface FormedMember { id: string; name: string; bot: boolean; skin: number }
export interface FormedTeam { id: number; partyIds: string[]; members: FormedMember[] }
export interface FormedMatch {
  mode: Mode;
  teams: FormedTeam[];
  humans: number;
  bots: number;
  partyIds: string[];
}

interface DraftTeam { parties: QueuedParty[]; size: number; fill: boolean }

/** First-fit-decreasing packing of fill parties, plus one team per no-fill party. */
export function packTeams(parties: QueuedParty[], teamSize: number): DraftTeam[] {
  const teams: DraftTeam[] = [];
  for (const p of parties) if (!p.fill || teamSize === 1) teams.push({ parties: [p], size: p.members.length, fill: p.fill });
  const fillers = parties
    .filter((p) => p.fill && teamSize > 1)
    .sort((a, b) => b.members.length - a.members.length || a.enqueuedAt - b.enqueuedAt);
  for (const p of fillers) {
    const slot = teams.find((t) => t.fill && t.size + p.members.length <= teamSize);
    if (slot) { slot.parties.push(p); slot.size += p.members.length; }
    else teams.push({ parties: [p], size: p.members.length, fill: true });
  }
  return teams;
}

export function validateParty(mode: Mode, size: number): string | null {
  if (size < 1) return 'Empty party';
  if (size > TEAM_SIZE[mode]) return `Your party has ${size} players. That's too many for ${mode}s.`;
  return null;
}

/**
 * Try to form one match from the queue for `mode`.
 * Returns null if we should keep waiting.
 */
export function tryFormMatch(
  queue: QueuedParty[],
  mode: Mode,
  now: number,
  timeoutS: number,
  botName: () => string,
  botSkin: () => number = () => 0,
): FormedMatch | null {
  const teamSize = TEAM_SIZE[mode];
  const maxTeams = matchCapacity(mode) / teamSize;
  const candidates = queue
    .filter((p) => p.mode === mode && !validateParty(mode, p.members.length))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  if (candidates.length === 0) return null;

  // Greedy FIFO selection: add parties while the packed team count still fits.
  const selected: QueuedParty[] = [];
  for (const p of candidates) {
    if (packTeams([...selected, p], teamSize).length <= maxTeams) selected.push(p);
  }
  const drafts = packTeams(selected, teamSize);
  const humans = selected.reduce((n, p) => n + p.members.length, 0);
  const lobbyFull = drafts.length === maxTeams && drafts.every((d) => !d.fill || d.size === teamSize);
  const timedOut = now - candidates[0].enqueuedAt >= timeoutS * 1000;
  if (!lobbyFull && !timedOut) return null;

  let bots = 0;
  const makeBot = (): FormedMember => { bots++; return { id: `bot${bots}`, name: botName(), bot: true, skin: botSkin() }; };

  const teams: FormedTeam[] = drafts.map((d, i) => {
    const members: FormedMember[] = d.parties.flatMap((p) => p.members.map((m) => ({ ...m, bot: false })));
    if (d.fill) while (members.length < teamSize) members.push(makeBot());
    return { id: i + 1, partyIds: d.parties.map((p) => p.partyId), members };
  });
  while (teams.length < maxTeams) {
    const members: FormedMember[] = [];
    for (let i = 0; i < teamSize; i++) members.push(makeBot());
    teams.push({ id: teams.length + 1, partyIds: [], members });
  }
  return { mode, teams, humans, bots, partyIds: selected.map((p) => p.partyId) };
}

// ---------- bot names that look like real usernames ----------
const A = ['Shadow', 'Pixel', 'Turbo', 'Frosty', 'Nova', 'Blaze', 'Echo', 'Lucky', 'Rapid', 'Silent', 'Cosmic', 'Neon', 'Mango', 'Waffle', 'Sneaky', 'Crispy', 'Atomic', 'Stormy', 'Cyber', 'Fuzzy', 'Golden', 'Rogue', 'Jolly', 'Hyper'];
const B = ['Fox', 'Wolf', 'Ninja', 'Panda', 'Rider', 'Sniper', 'Taco', 'Knight', 'Ghost', 'Tiger', 'Llama', 'Falcon', 'Viper', 'Noodle', 'Bear', 'Comet', 'Shark', 'Raven', 'Pickle', 'Ace'];
const SUFFIX = ['', '', '_', 'YT', 'TTV', 'x', 'Pro', 'xd'];

export function makeBotNamer(seed = Date.now()) {
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
  const used = new Set<string>();
  return () => {
    for (let tries = 0; tries < 50; tries++) {
      const num = rnd() < 0.6 ? String(Math.floor(rnd() * (rnd() < 0.5 ? 100 : 10000))) : '';
      const name = (pick(A) + pick(B) + pick(SUFFIX) + num).slice(0, 16);
      if (!used.has(name)) { used.add(name); return name; }
    }
    return `Player${Math.floor(rnd() * 1e6)}`;
  };
}
