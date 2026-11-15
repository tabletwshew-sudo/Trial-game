import {
  AMMO_ITEM, AMMO_PICKUP, ITEM, ITEMS, RARITIES, SPAWN_ISLAND, surfaceAt, terrainAt, weaponDef,
  type LootView, type PlayerState, type World,
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

const pickWeighted = <T,>(pool: [T, number][], rnd: () => number) => {
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

const defaultCount = (id: number) => {
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

/**
 * Phase 4 loot placement: by every building's door, plus scattered spots around each
 * location and along the roads. Phase 5 replaces this with chests and interiors.
 */
export function spawnFloorLoot(w: World, store: LootStore, rnd: () => number) {
  for (const b of w.boxes) {
    if (b.shape !== 0) { if (rnd() < 0.25) rollFloor(store, rnd, b.x1 + 1.2, b.fy, (b.z0 + b.z1) / 2); continue; }
    const doorWall = (b.style >> 6) % 4;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    const spots: [number, number][] = [[cx, b.z1 + 1.6], [b.x1 + 1.6, cz], [cx, b.z0 - 1.6], [b.x0 - 1.6, cz]];
    const [x, z] = spots[doorWall];
    rollFloor(store, rnd, x, surfaceAt(w, x, z, b.fy + 1), z);
    if (rnd() < 0.5) { const [x2, z2] = spots[(doorWall + 2) % 4]; rollFloor(store, rnd, x2, surfaceAt(w, x2, z2, b.fy + 1), z2); }
  }
  for (const p of w.pois) {
    for (let i = 0; i < 6; i++) {
      const x = p.x + (rnd() - 0.5) * p.r * 1.4, z = p.z + (rnd() - 0.5) * p.r * 1.4;
      const y = surfaceAt(w, x, z, 500);
      if (terrainAt(w, x, z) < 1.2 || insideBuilding(w, x, z, y)) continue;
      rollFloor(store, rnd, x, y, z);
    }
  }
}

function insideBuilding(w: World, x: number, z: number, y: number) {
  return w.boxes.some((b) => x > b.x0 - 1 && x < b.x1 + 1 && z > b.z0 - 1 && z < b.z1 + 1 && y < b.y1 + 0.5 && y > b.y0);
}

/** The warm-up island: a ring of weapons to play with. */
export function spawnWarmupLoot(w: World, store: LootStore, rnd: () => number) {
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2, r = 20 + rnd() * 20;
    const x = SPAWN_ISLAND.x + Math.cos(a) * r, z = SPAWN_ISLAND.z + Math.sin(a) * r;
    if (terrainAt(w, x, z) < 1.5) continue;
    rollFloor(store, rnd, x, surfaceAt(w, x, z, 50), z);
  }
}
