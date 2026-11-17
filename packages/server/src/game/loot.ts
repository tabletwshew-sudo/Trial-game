import {
  AMMO_ITEM, AMMO_PICKUP, CHEST_KIND, ITEM, ITEMS, RARITIES, SC_OAK, SC_PINE, SPAWN_ISLAND, hash2, surfaceAt, terrainAt, weaponDef,
  type ChestView, type LootView, type PlayerState, type Spot, type World,
} from '@dropzone/shared';

export interface LootItem extends LootView {}

const CELL = 16;
const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;

/** All pickups on the ground, with a spatial grid for "what's near me" and change tracking for the network. */
export class LootStore {
  private items = new Map<number, LootItem>();
  private grid = new Map<string, Set<LootItem>>();
  private nextId = 1;
  added: LootItem[] = [];
  removed: number[] = [];

  constructor(private w: World) {}

  all() { return [...this.items.values()]; }
  get size() { return this.items.size; }
  get(id: number) { return this.items.get(id); }

  add(item: number, r: number, n: number, x: number, y: number, z: number): LootItem {
    const it: LootItem = { id: this.nextId++, item, r, n, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, z: Math.round(z * 100) / 100 };
    this.items.set(it.id, it);
    const k = key(it.x, it.z);
    let set = this.grid.get(k);
    if (!set) this.grid.set(k, (set = new Set()));
    set.add(it);
    this.added.push(it);
    return it;
  }

  remove(id: number) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id);
    this.grid.get(key(it.x, it.z))?.delete(it);
    // an item added and removed in the same tick never needs to reach anyone
    const a = this.added.indexOf(it);
    if (a >= 0) this.added.splice(a, 1); else this.removed.push(id);
  }

  /** Change the count on a pile (partial ammo pickups). */
  setCount(id: number, n: number) {
    const it = this.items.get(id);
    if (!it) return;
    this.remove(id);
    this.add(it.item, it.r, n, it.x, it.y, it.z);
  }

  near(x: number, z: number, radius: number): LootItem[] {
    const out: LootItem[] = [];
    const r = Math.ceil(radius / CELL);
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const set = this.grid.get(`${cx + dx},${cz + dz}`);
      if (!set) continue;
      for (const it of set) if ((it.x - x) ** 2 + (it.z - z) ** 2 <= radius * radius) out.push(it);
    }
    return out;
  }

  flush() { const d = { add: this.added, del: this.removed }; this.added = []; this.removed = []; return d; }

  /** Drop something at a spot, nudged so piles don't stack on one point. */
  drop(item: number, r: number, n: number, x: number, y: number, z: number, k: number) {
    const a = k * 2.39996; // golden angle spiral
    const rad = 0.6 + Math.sqrt(k) * 0.55;
    const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
    const gy = surfaceAt(this.w, px, pz, y + 1);
    return this.add(item, r, n, px, Math.abs(gy - y) < 1.5 ? gy : y, pz);
  }

  /** Everything a player was carrying spills on the ground. */
  dropInventory(s: PlayerState) {
    let k = 0;
    for (const sl of s.inv) if (sl.id) this.drop(sl.id, sl.r, sl.id && ITEMS[sl.id]?.kind === 'weapon' ? sl.mag : sl.n, s.x, s.y, s.z, k++);
    s.ammo.forEach((n, i) => { if (n > 0) this.drop(AMMO_ITEM[i], 0, n, s.x, s.y, s.z, k++); });
  }
}

// ------------------------------------------------------------------ loot tables
const FLOOR_RARITY = [32, 34, 21, 10, 3];
const WEAPON_POOL: [number, number][] = [
  [ITEM.ar, 18], [ITEM.burst, 7], [ITEM.smg, 12], [ITEM.pistol, 8], [ITEM.pump, 14], [ITEM.autoshotgun, 7], [ITEM.dmr, 6], [ITEM.sniper, 3], [ITEM.rocket, 2],
];
const CONSUMABLE_POOL: [number, number][] = [[ITEM.bandage, 10], [ITEM.medpack, 4], [ITEM.shieldSip, 10], [ITEM.shieldJug, 4], [ITEM.fizz, 3], [ITEM.grenade, 6]];

export const pickWeighted = <T,>(pool: [T, number][], rnd: () => number) => {
  let total = 0; for (const [, w] of pool) total += w;
  let x = rnd() * total;
  for (const [v, w] of pool) { if ((x -= w) < 0) return v; }
  return pool[pool.length - 1][0];
};

/** A random weapon at a rarity it can come in. Returns [item, rarityIndex]. */
export function rollWeapon(rnd: () => number, rarityWeights = FLOOR_RARITY): [number, number] {
  const id = pickWeighted(WEAPON_POOL, rnd);
  const allowed = weaponDef(id)!.rarities.map((r) => RARITIES.indexOf(r));
  const pool: [number, number][] = allowed.map((r) => [r, rarityWeights[r]]);
  return [id, pickWeighted(pool, rnd)];
}

export const defaultCount = (id: number) => {
  const d = ITEMS[id];
  if (!d) return 1;
  if (d.kind === 'throwable') return 3;
  if (d.kind === 'consumable') return id === ITEM.bandage ? 5 : id === ITEM.shieldSip ? 3 : 1;
  return 1;
};

/** One floor-loot roll: a weapon (with its ammo), a consumable, or ammo. */
export function rollFloor(store: LootStore, rnd: () => number, x: number, y: number, z: number) {
  const roll = rnd();
  if (roll < 0.5) {
    const [id, r] = rollWeapon(rnd);
    const def = weaponDef(id)!;
    store.drop(id, r, def.mag, x, y, z, 0);
    store.drop(AMMO_ITEM[def.ammo], 0, AMMO_PICKUP[def.ammo], x, y, z, 1);
  } else if (roll < 0.78) {
    const id = pickWeighted(CONSUMABLE_POOL, rnd);
    store.drop(id, 0, defaultCount(id), x, y, z, 0);
  } else {
    const a = Math.floor(rnd() * 4);
    store.drop(AMMO_ITEM[a], 0, AMMO_PICKUP[a], x, y, z, 0);
  }
}

const FACE: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
const CHEST_RARITY = [0, 45, 35, 16, 4];
const SUPPLY_RARITY = [0, 0, 40, 45, 15];

/** What spills out of a chest, ammo box or supply drop, in a fan in front of it. */
export function rollContainer(store: LootStore, rnd: () => number, kind: number, x: number, y: number, z: number, face: number) {
  const [fx, fz] = FACE[face % 4];
  const ox = x + fx * 0.9, oz = z + fz * 0.9;
  let k = 0;
  const drop = (item: number, r: number, n: number) => store.drop(item, r, n, ox, y, oz, k++);
  if (kind === CHEST_KIND.Ammo) {
    const a = Math.floor(rnd() * 4), b = (a + 1 + Math.floor(rnd() * 3)) % 4;
    drop(AMMO_ITEM[a], 0, AMMO_PICKUP[a] * 2); drop(AMMO_ITEM[b], 0, AMMO_PICKUP[b]);
    return;
  }
  const supply = kind === CHEST_KIND.Supply;
  const [id, r] = rollWeapon(rnd, supply ? SUPPLY_RARITY : CHEST_RARITY);
  const def = weaponDef(id)!;
  drop(id, r, def.mag);
  drop(AMMO_ITEM[def.ammo], 0, AMMO_PICKUP[def.ammo] * (supply ? 2 : 1));
  const pool: [number, number][] = supply
    ? [[ITEM.shieldJug, 4], [ITEM.fizz, 3], [ITEM.medpack, 2], [ITEM.grenade, 2]]
    : [[ITEM.bandage, 8], [ITEM.shieldSip, 8], [ITEM.medpack, 3], [ITEM.shieldJug, 3], [ITEM.fizz, 2], [ITEM.grenade, 4]];
  const c = pickWeighted(pool, rnd);
  drop(c, 0, defaultCount(c));
  if (supply) drop(ITEM.shieldJug, 0, 1);
  else if (rnd() < 0.35) { const a = Math.floor(rnd() * 4); drop(AMMO_ITEM[a], 0, AMMO_PICKUP[a]); }
}

export interface ChestEnt extends ChestView { landY?: number; /** Vault chests roll supply-drop quality loot. */ rich?: boolean }

/**
 * Loot for the island: floor loot in rooms, chests by walls, ammo boxes, outdoor chests at
 * landmarks and caves, and food to forage. Returns the chests (closed until someone opens them).
 */
export function spawnIslandLoot(w: World, store: LootStore, rnd: () => number, nextId: () => number): ChestEnt[] {
  const chests: ChestEnt[] = [];
  const chest = (sp: Spot, kind: number) => chests.push({ id: nextId(), k: kind, x: sp.x, y: sp.y, z: sp.z, face: sp.face, open: false });
  for (const L of w.layouts) {
    for (const sp of L.chests) if (rnd() < 0.55) chest(sp, CHEST_KIND.Chest);
    for (const sp of L.loot) {
      const r = rnd();
      if (r < 0.12) chest(sp, CHEST_KIND.Ammo);
      else if (r < 0.8) rollFloor(store, rnd, sp.x, sp.y, sp.z);
    }
  }
  for (const sp of w.outdoorChests) if (rnd() < 0.85) chest(sp, CHEST_KIND.Chest);
  // a little floor loot outdoors around each location too
  for (const p of w.pois) {
    for (let i = 0; i < 4; i++) {
      const x = p.x + (rnd() - 0.5) * p.r * 1.4, z = p.z + (rnd() - 0.5) * p.r * 1.4;
      const y = surfaceAt(w, x, z, 500);
      if (terrainAt(w, x, z) < 1.2 || Math.abs(y - terrainAt(w, x, z)) > 0.3) continue;
      rollFloor(store, rnd, x, y, z);
    }
  }
  // forage: apples under some oaks, glow caps in pine woods and caves
  const oaks = w.scatter[SC_OAK], pines = w.scatter[SC_PINE];
  let apples = 0, caps = 0;
  for (let i = 0; i < oaks.length && apples < 220; i += 6) {
    if (hash2(i, 3, w.seed + 901) > 0.07) continue;
    const a = hash2(i, 4, w.seed + 901) * Math.PI * 2, x = oaks[i] + Math.cos(a) * 1.3, z = oaks[i + 2] + Math.sin(a) * 1.3;
    store.add(ITEM.apple, 0, 1, x, surfaceAt(w, x, z, oaks[i + 1] + 2), z); apples++;
  }
  for (let i = 0; i < pines.length && caps < 90; i += 6) {
    if (hash2(i, 5, w.seed + 902) > 0.04) continue;
    const x = pines[i] + 1.1, z = pines[i + 2];
    store.add(ITEM.glowcap, 0, 1, x, surfaceAt(w, x, z, pines[i + 1] + 2), z); caps++;
  }
  for (const c of w.caves) for (let k = 0; k < 3; k++) {
    const t = (k - 1) * 7, x = c.x + c.dx * t - c.dz * 1.8, z = c.z + c.dz * t + c.dx * 1.8;
    store.add(ITEM.glowcap, 0, 1, x, c.floor, z);
  }
  return chests;
}

/** The warm-up island: a ring of weapons to play with. */
export function spawnWarmupLoot(w: World, store: LootStore, rnd: () => number) {
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 + rnd() * 0.3, r = 18 + rnd() * 80;
    const x = SPAWN_ISLAND.x + Math.cos(a) * r, z = SPAWN_ISLAND.z + Math.sin(a) * r;
    if (terrainAt(w, x, z) < 1.5) continue;
    rollFloor(store, rnd, x, surfaceAt(w, x, z, 50), z);
  }
}
