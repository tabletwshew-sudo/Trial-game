import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface UserRecord {
  id: string;
  name: string;
  nameLower: string;
  guest: boolean;
  salt: string;
  hash: string;
  skin: number;
  friends: string[];
  incoming: string[]; // user ids who sent *me* a request
  outgoing: string[]; // user ids I sent a request to
  createdAt: number;
}

interface DbShape { users: Record<string, UserRecord>; sessions: Record<string, { userId: string; createdAt: number }> }

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

/**
 * Tiny JSON-file database. That's fine for a school-sized player base
 * (hundreds of accounts). Writes are debounced and atomic (tmp + rename).
 * Pass `file = null` for an in-memory store (tests).
 */
export class Store {
  private db: DbShape = { users: {}, sessions: {} };
  private byName = new Map<string, string>();
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(private file: string | null) {
    if (file && existsSync(file)) this.db = JSON.parse(readFileSync(file, 'utf8'));
    for (const u of Object.values(this.db.users)) this.byName.set(u.nameLower, u.id);
    const now = Date.now();
    for (const [tok, s] of Object.entries(this.db.sessions)) if (now - s.createdAt > SESSION_TTL_MS) delete this.db.sessions[tok];
  }

  private save() {
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file) return;
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file + '.tmp', JSON.stringify(this.db));
    renameSync(this.file + '.tmp', this.file);
  }

  getUser(id: string) { return this.db.users[id]; }
  findByName(name: string) { const id = this.byName.get(name.toLowerCase()); return id ? this.db.users[id] : undefined; }

  createUser(name: string, password: string | null, guest: boolean): UserRecord {
    const id = 'u' + randomBytes(6).toString('hex');
    const salt = randomBytes(16).toString('hex');
    const hash = password ? scryptSync(password, salt, 32).toString('hex') : '';
    const u: UserRecord = {
      id, name, nameLower: name.toLowerCase(), guest, salt, hash, skin: Math.floor(Math.random() * 8),
      friends: [], incoming: [], outgoing: [], createdAt: Date.now(),
    };
    this.db.users[id] = u;
    this.byName.set(u.nameLower, id);
    this.save();
    return u;
  }

  checkPassword(u: UserRecord, password: string) {
    if (!u.hash) return false;
    const a = Buffer.from(u.hash, 'hex');
    const b = scryptSync(password, u.salt, 32);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  createSession(userId: string) {
    const token = randomBytes(24).toString('base64url');
    this.db.sessions[token] = { userId, createdAt: Date.now() };
    this.save();
    return token;
  }
  userForToken(token: string) {
    const s = this.db.sessions[token];
    if (!s || Date.now() - s.createdAt > SESSION_TTL_MS) return undefined;
    return this.db.users[s.userId];
  }
  deleteSession(token: string) { delete this.db.sessions[token]; this.save(); }

  /** Mutate a user, then persist. */
  update(u: UserRecord, fn: (u: UserRecord) => void) { fn(u); this.save(); }
}
