import { MAP } from './constants.js';
import { clamp, fbm, hash2, lerp, mulberry32, smooth, vnoise } from './noise.js';
import { SK, genLayout, type Layout, type Prop, type Solid, type Spot } from './structures.js';
import { genProps, type Cave, type Exclusion } from './props.js';

/**
 * The island. Everything here is deterministic from the seed, so the server
 * (authority) and each browser (prediction + rendering) build the identical world.
 * Units are metres. +X is east, +Z is south, sea level is y = 0.
 */

export const WATER_FLOAT_Y = -1.15; // feet height while swimming
export const STEP_UP = 0.6;
export const PLAYER_RADIUS = 0.42;
export const PLAYER_HEIGHT = 1.85;
export const WORLD_LIMIT = 1900;
export const SPAWN_ISLAND = { x: -1450, z: -1450, r: 130 };
/** Roads become bridge decks at this height wherever the ground dips below it (rivers). */
export const BRIDGE_Y = 1.25;

export class HeightField {
  readonly data: Float32Array;
  readonly maxX: number;
  readonly maxZ: number;
  constructor(readonly ox: number, readonly oz: number, readonly cell: number, readonly nx: number, readonly nz: number) {
    this.data = new Float32Array(nx * nz);
    this.maxX = ox + (nx - 1) * cell;
    this.maxZ = oz + (nz - 1) * cell;
  }
  contains(x: number, z: number) { return x >= this.ox && z >= this.oz && x <= this.maxX && z <= this.maxZ; }
  /** Height using the same triangle split the terrain mesh uses, so feet never float or sink. */
  sample(x: number, z: number) {
    const gx = clamp((x - this.ox) / this.cell, 0, this.nx - 1.0001);
    const gz = clamp((z - this.oz) / this.cell, 0, this.nz - 1.0001);
    const ix = Math.floor(gx), iz = Math.floor(gz);
    const fx = gx - ix, fz = gz - iz;
    const d = this.data, i = iz * this.nx + ix;
    const h00 = d[i], h10 = d[i + 1], h01 = d[i + this.nx], h11 = d[i + this.nx + 1];
    return fx + fz <= 1 ? h00 + (h10 - h00) * fx + (h01 - h00) * fz : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
}

// ------------------------------------------------------------------ locations
export type PoiKind = 'city' | 'town' | 'industrial' | 'farm' | 'camp' | 'harbor' | 'station' | 'resort' | 'quarry';
export interface Poi { id: number; name: string; x: number; z: number; r: number; kind: PoiKind; h: number; /** A small unnamed hamlet along a road (not labelled on the map). */ minor?: boolean }

const POI_DEFS: Omit<Poi, 'id' | 'h'>[] = [
  { name: 'Brickwell', kind: 'city', x: -140, z: 40, r: 125 },
  { name: 'Pinewood Plaza', kind: 'town', x: -520, z: -560, r: 100 },
  { name: 'Northgate', kind: 'town', x: -160, z: -700, r: 95 },
  { name: 'Windmill Flats', kind: 'farm', x: 200, z: -730, r: 95 },
  { name: 'Summit Station', kind: 'station', x: 520, z: -520, r: 46 },
  { name: 'Coral Cove', kind: 'resort', x: -800, z: -150, r: 90 },
  { name: 'Stillwater Camp', kind: 'camp', x: -330, z: -95, r: 70 },
  { name: 'Cloverfield Farm', kind: 'farm', x: -640, z: 160, r: 110 },
  { name: 'Arcade Avenue', kind: 'town', x: 420, z: 30, r: 100 },
  { name: 'Rustworks', kind: 'industrial', x: 660, z: 250, r: 120 },
  { name: 'Mosshollow', kind: 'camp', x: 240, z: 420, r: 80 },
  { name: 'Quarry Nine', kind: 'quarry', x: -400, z: 690, r: 90 },
  { name: 'Harborlight', kind: 'harbor', x: 130, z: 850, r: 100 },
  { name: 'Sandbar Shacks', kind: 'town', x: 600, z: 610, r: 80 },
  // filling the gaps: a place in each region
  { name: 'Maple Hollow', kind: 'camp', x: 790, z: -160, r: 72 },
  { name: 'Lookout Ridge', kind: 'camp', x: -30, z: -420, r: 66 },
  { name: 'Petal Fields', kind: 'farm', x: 440, z: 330, r: 80 },
  { name: 'Blossom Grove', kind: 'camp', x: -600, z: -340, r: 70 },
  { name: 'Redrock Gulch', kind: 'quarry', x: -640, z: 470, r: 66 },
  { name: 'Frostfall Lodge', kind: 'station', x: 360, z: 640, r: 40 },
];

/** Road links between locations (by name), with optional waypoints. */
const ROAD_LINKS: [string, string, ...[number, number][]][] = [
  ['Brickwell', 'Stillwater Camp'],
  ['Brickwell', 'Cloverfield Farm'],
  ['Brickwell', 'Northgate', [-120, -330]],
  ['Northgate', 'Pinewood Plaza'],
  ['Pinewood Plaza', 'Coral Cove', [-700, -400]],
  ['Coral Cove', 'Cloverfield Farm'],
  ['Cloverfield Farm', 'Quarry Nine', [-560, 460]],
  ['Quarry Nine', 'Harborlight', [-150, 830]],
  ['Harborlight', 'Mosshollow'],
  ['Mosshollow', 'Arcade Avenue'],
  ['Arcade Avenue', 'Rustworks'],
  ['Rustworks', 'Sandbar Shacks'],
  ['Sandbar Shacks', 'Harborlight', [380, 780]],
  ['Arcade Avenue', 'Brickwell', [140, 10]],
  ['Northgate', 'Windmill Flats'],
  ['Windmill Flats', 'Summit Station', [360, -660], [470, -600]],
  ['Lookout Ridge', 'Windmill Flats'],
  ['Lookout Ridge', 'Stillwater Camp'],
  ['Maple Hollow', 'Arcade Avenue'],
  ['Maple Hollow', 'Rustworks'],
  ['Petal Fields', 'Arcade Avenue'],
  ['Petal Fields', 'Mosshollow'],
  ['Blossom Grove', 'Pinewood Plaza'],
  ['Blossom Grove', 'Coral Cove'],
  ['Redrock Gulch', 'Cloverfield Farm'],
  ['Redrock Gulch', 'Quarry Nine'],
  ['Frostfall Lodge', 'Sandbar Shacks'],
];

/**
 * The island's regions, each fading out toward its edge (0..1): an autumn wood round the big
 * mountain, a blossom forest round the lake, red-rock badlands in the south-west and the flower
 * fields of Petal Fields. Shared, so trees and the ground agree everywhere.
 */
export interface Biome { autumn: number; blossom: number; badlands: number; flowers: number }
const REGIONS = { autumn: { x: 700, z: -260, r: 340 }, blossom: { x: -560, z: -320, r: 300 }, badlands: { x: -660, z: 520, r: 260 }, flowers: { x: 440, z: 330, r: 135 } } as const;
export function biomeAt(x: number, z: number): Biome {
  const k = (c: { x: number; z: number; r: number }) => { const d = Math.hypot(x - c.x, z - c.z); return d >= c.r ? 0 : smooth(c.r, c.r * 0.6, d); };
  return { autumn: k(REGIONS.autumn), blossom: k(REGIONS.blossom), badlands: k(REGIONS.badlands), flowers: k(REGIONS.flowers) };
}
/** A second, smaller lake in the autumn wood. */
const AMBER_LAKE = { x: 600, z: -130, r: 52 };

const RIVER: [number, number][] = [[300, -330], [170, -160], [70, 60], [-40, 300], [-140, 560], [-200, 800], [-230, 1080]];
const LAKE = { x: -350, z: -250, r: 100 };

export interface Road { pts: Float32Array; width: number; street: boolean }

export const ROOF_FLAT = 0, ROOF_GABLE_X = 1, ROOF_GABLE_Z = 2;
/** A solid building block. `roof` 1/2 = gable with the ridge along X/Z. */
export interface Box {
  x0: number; x1: number; z0: number; z1: number;
  y0: number; fy: number; y1: number;
  roof: number; roofH: number;
  kind: PoiKind; style: number; poi: number;
  /** 0 = building, 1 = container, 2 = silo */
  shape: number;
}

export interface World {
  seed: number;
  main: HeightField;
  spawn: HeightField;
  pois: Poi[];
  roads: Road[];
  river: Float32Array;
  boxes: Box[];
  boxGrid: Map<number, Box[]>;
  roadGrid: Map<number, number[]>; // cell -> flat [x, z, halfWidth, ...]
  /** One layout per box (same index): rooms, doors, stairs, loot and chest spots. */
  layouts: Layout[];
  /** Everything solid that isn't terrain, and a 16 m grid over it. */
  solids: Solid[];
  solidGrid: Map<number, Solid[]>;
  props: Prop[];
  caves: Cave[];
  /** Chest spots outside buildings (camps, landmarks, docks, caves). */
  outdoorChests: Spot[];
  /** Trees, rocks, bushes: per type, flat [x, y, z, scale, rot01, tint01]. */
  scatter: Float32Array[];
  /** Recall beacons, and boss vaults (bunker with a locked door and chests inside). */
  beacons: { x: number; y: number; z: number }[];
  vaults: Vault[];
  /** Per match: vault doors that have been opened (use Object.create(world) to give each match its own). */
  openVaults?: Set<number>;
  /** Per match: walls and furniture smashed with the pickaxe or blown up (solid ids). */
  broken?: Set<number>;
  /** Climbable ladders, ziplines, spring pads. */
  ladders: Ladder[];
  zips: Zip[];
  pads: { x: number; y: number; z: number }[];
  /** Pirate merchants' stalls: where you trade gold for gear (the stall faces `rot`). */
  merchants: { x: number; y: number; z: number; rot: number }[];
}

/** Where you hang while climbing (x, z), from y0 to y1; n = outward from the wall; (tx, tz) = where you step off at the top. */
export interface Ladder { x: number; z: number; y0: number; y1: number; nx: number; nz: number; tx: number; tz: number }
/** A zipline cable from A to B (heights are the cable; you hang about 2 m below it). */
export interface Zip { ax: number; ay: number; az: number; bx: number; by: number; bz: number; len: number }

export interface Vault { id: number; x: number; z: number; y: number; face: number; door: { x: number; z: number }; post: { x: number; z: number }; chests: Spot[]; poi: number }

/** Is this solid not there right now (an opened vault door, or a wall/furniture that's been broken)? */
const isOpenDoor = (w: World, o: Solid) => (o.vault !== undefined && !!w.openVaults?.has(o.vault)) || (o.id !== undefined && !!w.broken?.has(o.id));

export const SOLID_CELL = 16;
export const solidKey = (cx: number, cz: number) => (cx + 1024) * 2048 + (cz + 1024);

// ------------------------------------------------------------------ helpers
function distToPolyline(x: number, z: number, pts: ArrayLike<number>) {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3];
    const dx = bx - ax, dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = ax + dx * t - x, pz = az + dz * t - z;
    const d = px * px + pz * pz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** Chaikin corner cutting, then resample at a fixed spacing. */
function smoothPath(ctrl: [number, number][], spacing: number): Float32Array {
  let pts = ctrl;
  for (let it = 0; it < 3; it++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      next.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    next.push(pts[pts.length - 1]);
    pts = next;
  }
  const out: number[] = [pts[0][0], pts[0][1]];
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    let d = spacing - carry;
    while (d <= len) { out.push(ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len); d += spacing; }
    carry = len - (d - spacing);
  }
  out.push(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  return new Float32Array(out);
}

const gridKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);
const BOX_CELL = 32, ROAD_CELL = 16;

// ------------------------------------------------------------------ terrain
function rawHeight(x: number, z: number, seed: number, riverPts: Float32Array) {
  const warp = fbm(x / 420 + 11, z / 420 - 7, seed, 3) - 0.5;
  const bays = fbm(x / 800 - 3, z / 800 + 5, seed + 13, 2) - 0.5;
  const r = Math.sqrt(x * x + z * z) / 1000 + warp * 0.34 + bays * 0.22;
  const mask = smooth(1.0, 0.8, r);
  let land = 5 + fbm(x / 300, z / 300, seed + 1, 4) * 26 + (fbm(x / 70, z / 70, seed + 2, 3) - 0.5) * 5;

  // the mountain (north-east)
  const dm = Math.hypot(x - 520, z + 520) / 400;
  if (dm < 1) {
    const m = (1 - dm * dm) ** 2;
    const ridge = 1 - Math.abs(2 * vnoise(x / 120, z / 120, seed + 5) - 1);
    land += m * (118 + (fbm(x / 90, z / 90, seed + 3, 4) - 0.5) * 60 + ridge * 22);
  }
  // western highlands and southern hills
  const dh = Math.hypot(x + 640, z + 420) / 260;
  if (dh < 1) land += (1 - dh * dh) ** 2 * 26;
  // a second, snow-capped peak in the south-east (Frostfall Lodge sits up on it)
  const ds = Math.hypot(x - 360, z - 650) / 250;
  if (ds < 1) {
    const ridge2 = 1 - Math.abs(2 * vnoise(x / 100, z / 100, seed + 15) - 1);
    land += (1 - ds * ds) ** 2 * (112 + ridge2 * 18);
  }
  // red-rock badlands: flat-topped mesas with steep sides
  const bd = Math.hypot(x - REGIONS.badlands.x, z - REGIONS.badlands.z);
  if (bd < REGIONS.badlands.r) {
    const b = smooth(REGIONS.badlands.r, REGIONS.badlands.r * 0.6, bd);
    const m = fbm(x / 110 + 4.1, z / 110 - 2.7, seed + 21, 3);
    land += smooth(0.49, 0.55, m) * 24 * b;
  }

  let h = lerp(-9, land, mask);

  // river valley + channel
  const dr = Math.abs(x - 40) > 520 ? 999 : distToPolyline(x + (vnoise(z / 110, 0.5, seed + 8) - 0.5) * 70, z, riverPts) + (vnoise(x / 40, z / 40, seed + 9) - 0.5) * 6;
  if (dr < 75) {
    const t = smooth(75, 14, dr);
    h = lerp(h, Math.min(h, 1.3 + (h - 1.3) * 0.12), t);
    h = lerp(h, Math.min(h, -2.6), smooth(13, 5, dr));
  }
  // the amber lake in the autumn wood
  const da = Math.hypot(x - AMBER_LAKE.x, z - AMBER_LAKE.z) + (fbm(x / 40, z / 40, seed + 17, 2) - 0.5) * 30;
  if (da < AMBER_LAKE.r + 45) {
    h = lerp(h, Math.min(h, 2), smooth(AMBER_LAKE.r + 45, AMBER_LAKE.r + 4, da));
    h = lerp(h, Math.min(h, -4), smooth(AMBER_LAKE.r, AMBER_LAKE.r - 25, da));
  }
  // lake
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z) + (fbm(x / 60, z / 60, seed + 7, 2) - 0.5) * 50;
  if (dl < LAKE.r + 60) {
    h = lerp(h, Math.min(h, 2), smooth(LAKE.r + 60, LAKE.r + 5, dl));
    h = lerp(h, Math.min(h, -5), smooth(LAKE.r, LAKE.r - 35, dl));
  }
  return h;
}

function genMain(seed: number, pois: Poi[], riverPts: Float32Array): HeightField {
  const half = MAP.size / 2, cell = 5, n = MAP.size / cell + 1;
  const f = new HeightField(-half, -half, cell, n, n);
  for (const p of pois) {
    const pre = rawHeight(p.x, p.z, seed, riverPts);
    p.h = p.kind === 'harbor' ? 2.4 : p.kind === 'resort' ? 2.8 : p.kind === 'quarry' ? Math.max(pre, 24) : Math.max(pre, 3.2);
  }
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = -half + ix * cell, z = -half + iz * cell;
      let h = rawHeight(x, z, seed, riverPts);
      for (const p of pois) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d > p.r * 1.35) continue;
        h = lerp(h, p.h, smooth(p.r * 1.35, p.r * 0.78, d));
        if (p.kind === 'quarry' && d < p.r * 0.8) h = p.h - Math.floor((1 - d / (p.r * 0.8)) * 4.99) * 4.5;
      }
      f.data[iz * n + ix] = h;
    }
  }
  return f;
}

function genSpawn(seed: number): HeightField {
  const cell = 2.5, n = 129;
  const f = new HeightField(SPAWN_ISLAND.x - 160, SPAWN_ISLAND.z - 160, cell, n, n);
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const x = f.ox + ix * cell, z = f.oz + iz * cell;
      const d = Math.hypot(x - SPAWN_ISLAND.x, z - SPAWN_ISLAND.z) / SPAWN_ISLAND.r + (fbm(x / 40, z / 40, seed + 21, 2) - 0.5) * 0.3;
      const land = 3.6 + fbm(x / 30, z / 30, seed + 22, 3) * 2.4;
      f.data[iz * n + ix] = lerp(-10, land, smooth(1.0, 0.72, d));
    }
  }
  return f;
}

// ------------------------------------------------------------------ roads
function genRoads(seed: number, pois: Poi[]): Road[] {
  const byName = new Map(pois.map((p) => [p.name, p]));
  const roads: Road[] = [];
  let k = 0;
  for (const [a, b, ...mids] of ROAD_LINKS) {
    const A = byName.get(a)!, B = byName.get(b)!;
    const anchors: [number, number][] = [[A.x, A.z], ...mids, [B.x, B.z]];
    const ctrl: [number, number][] = [];
    for (let i = 0; i < anchors.length - 1; i++) {
      const [ax, az] = anchors[i], [bx, bz] = anchors[i + 1];
      const len = Math.hypot(bx - ax, bz - az), steps = Math.max(2, Math.round(len / 60));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const off = (vnoise(k * 13.7 + i * 3.1 + s * 0.9, 0.5, seed + 31) - 0.5) * 70 * 4 * t * (1 - t);
        ctrl.push([ax + (bx - ax) * t + (-(bz - az) / len) * off, az + (bz - az) * t + ((bx - ax) / len) * off]);
      }
    }
    ctrl.push(anchors[anchors.length - 1]);
    roads.push({ pts: smoothPath(ctrl, 4), width: 7, street: false });
    k++;
  }
  // streets inside built-up locations
  for (const p of pois) {
    const line = (x0: number, z0: number, x1: number, z1: number) => {
      const pts: number[] = [];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 4);
      for (let i = 0; i <= n; i++) pts.push(x0 + ((x1 - x0) * i) / n, z0 + ((z1 - z0) * i) / n);
      roads.push({ pts: new Float32Array(pts), width: 6.5, street: true });
    };
    const e = p.r * 0.88;
    if (p.kind === 'city') {
      for (const o of [-0.42, 0.42]) { line(p.x - e, p.z + o * p.r, p.x + e, p.z + o * p.r); line(p.x + o * p.r, p.z - e, p.x + o * p.r, p.z + e); }
      line(p.x - e, p.z, p.x + e, p.z); line(p.x, p.z - e, p.x, p.z + e);
    } else if (p.kind === 'town' || p.kind === 'industrial' || p.kind === 'harbor' || p.kind === 'resort') {
      line(p.x - e, p.z, p.x + e, p.z); line(p.x, p.z - e, p.x, p.z + e);
    }
  }
  return roads;
}

function buildRoadGrid(roads: Road[]) {
  const grid = new Map<number, number[]>();
  for (const r of roads) {
    for (let i = 0; i < r.pts.length; i += 2) {
      const key = gridKey(Math.floor(r.pts[i] / ROAD_CELL), Math.floor(r.pts[i + 1] / ROAD_CELL));
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(r.pts[i], r.pts[i + 1], r.width / 2);
    }
  }
  return grid;
}

/** Distance from (x, z) to the nearest road edge (negative = on the road). Infinity if none within ~16 m. */
export function roadEdgeDist(w: World, x: number, z: number) {
  const cx = Math.floor(x / ROAD_CELL), cz = Math.floor(z / ROAD_CELL);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const list = w.roadGrid.get(gridKey(cx + dx, cz + dz));
    if (!list) continue;
    for (let i = 0; i < list.length; i += 3) {
      const d = Math.hypot(list[i] - x, list[i + 1] - z) - list[i + 2];
      if (d < best) best = d;
    }
  }
  return best;
}

// ------------------------------------------------------------------ buildings
interface Spec { n: number; w: [number, number]; d: [number, number]; h: [number, number]; roof: 'flat' | 'gable' | 'mix'; roofH: [number, number]; shape?: number }
const SPECS: Record<PoiKind, Spec[]> = {
  city: [
    { n: 13, w: [16, 24], d: [16, 24], h: [20, 44], roof: 'flat', roofH: [0, 0] },
    { n: 22, w: [10, 16], d: [10, 14], h: [8, 16], roof: 'flat', roofH: [0, 0] },
  ],
  town: [
    { n: 4, w: [14, 20], d: [10, 14], h: [6.5, 8], roof: 'flat', roofH: [0, 0] },
    { n: 22, w: [9, 13], d: [8, 11], h: [5.8, 6.8], roof: 'gable', roofH: [2.4, 3.4] },
  ],
  industrial: [
    { n: 8, w: [24, 36], d: [16, 24], h: [9, 13], roof: 'mix', roofH: [2, 3] },
    { n: 7, w: [6, 6], d: [6, 6], h: [13, 17], roof: 'flat', roofH: [0, 0], shape: 2 },
    { n: 14, w: [2.6, 2.6], d: [6.2, 6.2], h: [2.7, 2.7], roof: 'flat', roofH: [0, 0], shape: 1 },
  ],
  farm: [
    { n: 3, w: [16, 20], d: [11, 13], h: [6, 7], roof: 'gable', roofH: [4.5, 5.5] },
    { n: 3, w: [5, 5], d: [5, 5], h: [10, 12], roof: 'flat', roofH: [0, 0], shape: 2 },
    { n: 8, w: [7, 10], d: [6, 8], h: [5.8, 6.4], roof: 'gable', roofH: [2, 2.6] },
  ],
  camp: [{ n: 13, w: [7, 9], d: [6.5, 8], h: [5.6, 6], roof: 'gable', roofH: [1.8, 2.4] }],
  harbor: [
    { n: 7, w: [16, 22], d: [22, 30], h: [7, 9], roof: 'gable', roofH: [2, 2.8] },
    { n: 20, w: [2.6, 2.6], d: [6.2, 6.2], h: [2.7, 2.7], roof: 'flat', roofH: [0, 0], shape: 1 },
    { n: 7, w: [8, 11], d: [7, 9], h: [6, 6.8], roof: 'flat', roofH: [0, 0] },
  ],
  station: [
    { n: 1, w: [16, 16], d: [14, 14], h: [6, 6], roof: 'flat', roofH: [0, 0] },
    { n: 4, w: [7, 8], d: [6.5, 7.5], h: [5.8, 6.2], roof: 'gable', roofH: [1.6, 2] },
  ],
  resort: [
    { n: 1, w: [32, 36], d: [14, 16], h: [15, 18], roof: 'flat', roofH: [0, 0] },
    { n: 15, w: [7, 9], d: [7, 9], h: [5.8, 6.4], roof: 'gable', roofH: [2.2, 2.8] },
  ],
  quarry: [
    { n: 4, w: [8, 12], d: [7, 9], h: [6, 6.8], roof: 'flat', roofH: [0, 0] },
    { n: 11, w: [2.6, 2.6], d: [6.2, 6.2], h: [2.7, 2.7], roof: 'flat', roofH: [0, 0], shape: 1 },
  ],
};

/** Hamlets: a few two-storey houses beside a road between the named places. */
const HAMLET: Spec[] = [{ n: 4, w: [8, 11], d: [7, 10], h: [5.8, 6.8], roof: 'gable', roofH: [2.2, 3] }];

function genBoxes(w: World) {
  const rnd = mulberry32(w.seed * 7 + 99);
  const range = (r: [number, number]) => r[0] + (r[1] - r[0]) * rnd();
  for (const p of w.pois) {
    const placed: Box[] = [];
    for (const spec of p.minor ? HAMLET : SPECS[p.kind]) {
      let made = 0;
      for (let tries = 0; tries < spec.n * 40 && made < spec.n; tries++) {
        let bw = Math.round(range(spec.w) * 2) / 2, bd = Math.round(range(spec.d) * 2) / 2;
        if (rnd() < 0.5) [bw, bd] = [bd, bw];
        // sample a point in the disc (rejection keeps it trig-free)
        const ux = rnd() * 2 - 1, uz = rnd() * 2 - 1;
        if (ux * ux + uz * uz > 1) continue;
        const reach = p.kind === 'quarry' ? 0.98 : 0.86;
        const cx = Math.round((p.x + ux * p.r * reach) / 2) * 2, cz = Math.round((p.z + uz * p.r * reach) / 2) * 2;
        if (p.kind === 'quarry' && Math.hypot(cx - p.x, cz - p.z) < p.r * 0.82 && Math.hypot(cx - p.x, cz - p.z) > p.r * 0.2) continue;
        const b: Box = {
          x0: cx - bw / 2, x1: cx + bw / 2, z0: cz - bd / 2, z1: cz + bd / 2, y0: 0, fy: 0, y1: 0,
          roof: ROOF_FLAT, roofH: 0, kind: p.kind, style: Math.floor(rnd() * 65536), poi: p.id, shape: spec.shape ?? 0,
        };
        const gap = b.shape === 1 ? 1.2 : 4;
        if (placed.some((o) => b.x0 < o.x1 + gap && b.x1 > o.x0 - gap && b.z0 < o.z1 + gap && b.z1 > o.z0 - gap)) continue;
        // keep off the roads
        let onRoad = false;
        for (let sx = 0; sx <= 4 && !onRoad; sx++) for (let sz = 0; sz <= 4; sz++) {
          if (roadEdgeDist(w, lerp(b.x0, b.x1, sx / 4), lerp(b.z0, b.z1, sz / 4)) < 2.2) { onRoad = true; break; }
        }
        if (onRoad) continue;
        // needs flat, dry ground
        const hs = [terrainAt(w, b.x0, b.z0), terrainAt(w, b.x1, b.z0), terrainAt(w, b.x0, b.z1), terrainAt(w, b.x1, b.z1), terrainAt(w, cx, cz)];
        const lo = Math.min(...hs), hi = Math.max(...hs);
        if (lo < 1.1 || hi - lo > 1.6) continue;
        const height = range(spec.h);
        b.y0 = lo - 0.6; b.fy = hi + 0.15; b.y1 = b.fy + height;
        const gable = spec.roof === 'gable' || (spec.roof === 'mix' && rnd() < 0.5);
        if (gable) { b.roof = bw >= bd ? ROOF_GABLE_X : ROOF_GABLE_Z; b.roofH = range(spec.roofH); }
        placed.push(b);
        made++;
      }
    }
    w.boxes.push(...placed);
  }
  for (const b of w.boxes) {
    const pad = PLAYER_RADIUS + 1;
    for (let cz = Math.floor((b.z0 - pad) / BOX_CELL); cz <= Math.floor((b.z1 + pad) / BOX_CELL); cz++)
      for (let cx = Math.floor((b.x0 - pad) / BOX_CELL); cx <= Math.floor((b.x1 + pad) / BOX_CELL); cx++) {
        const key = gridKey(cx, cz);
        let list = w.boxGrid.get(key);
        if (!list) w.boxGrid.set(key, (list = []));
        list.push(b);
      }
  }
}

// ------------------------------------------------------------------ queries
export function terrainAt(w: World, x: number, z: number) {
  if (w.main.contains(x, z)) return w.main.sample(x, z);
  if (w.spawn.contains(x, z)) return w.spawn.sample(x, z);
  return -9;
}

/** Roof / top height of a box at (x, z) (clamped to its footprint). */
export function boxTop(b: Box, x: number, z: number) {
  if (b.roof === ROOF_GABLE_X) { const half = (b.z1 - b.z0) / 2; return b.y1 + b.roofH * (1 - Math.min(1, Math.abs(z - (b.z0 + b.z1) / 2) / half)); }
  if (b.roof === ROOF_GABLE_Z) { const half = (b.x1 - b.x0) / 2; return b.y1 + b.roofH * (1 - Math.min(1, Math.abs(x - (b.x0 + b.x1) / 2) / half)); }
  return b.y1;
}

/** Top of a solid at (x, z): gable roofs slope, everything else is flat. */
export { isOpenDoor };
export function solidTop(o: Solid, x: number, z: number) {
  return o.k === SK.Roof && o.b ? boxTop(o.b, x, z) : o.y1;
}

/** Highest walkable surface at (x, z) that is no more than a step above feet height y. */
export function surfaceAt(w: World, x: number, z: number, y: number) {
  let s = Math.max(terrainAt(w, x, z), WATER_FLOAT_Y);
  if (s < BRIDGE_Y && BRIDGE_Y <= y + STEP_UP && roadEdgeDist(w, x, z) < 0.2) s = BRIDGE_Y;
  const list = w.solidGrid.get(solidKey(Math.floor(x / SOLID_CELL), Math.floor(z / SOLID_CELL)));
  if (list) for (const o of list) {
    if (x < o.x0 || x > o.x1 || z < o.z0 || z > o.z1 || isOpenDoor(w, o)) continue;
    const top = solidTop(o, x, z);
    if (top <= y + STEP_UP && top > s) s = top;
  }
  return s;
}

/**
 * Push a player out of walls, furniture, trunks... (circle vs box, so corners and door frames
 * slide smoothly), and stop upward motion against ceilings. Mutates and returns true if moved.
 */
export function collideBoxes(w: World, s: { x: number; y: number; z: number; vx: number; vz: number; vy?: number }, radius = PLAYER_RADIUS, height = PLAYER_HEIGHT) {
  const list = w.solidGrid.get(solidKey(Math.floor(s.x / SOLID_CELL), Math.floor(s.z / SOLID_CELL)));
  if (!list) return false;
  const r = radius;
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of list) {
      if (s.x <= o.x0 - r || s.x >= o.x1 + r || s.z <= o.z0 - r || s.z >= o.z1 + r) continue;
      if (o.y0 >= s.y + height || isOpenDoor(w, o)) continue; // above your head, or an opened vault door
      const cx = clamp(s.x, o.x0, o.x1), cz = clamp(s.z, o.z0, o.z1);
      const top = solidTop(o, cx, cz);
      if (s.y >= top - STEP_UP) continue; // you can step onto it (or you're on it)
      const inside = s.x > o.x0 && s.x < o.x1 && s.z > o.z0 && s.z < o.z1;
      // ceilings: you're under it and jumping into it
      if (inside && o.y0 > s.y + 1.0) {
        if ((s.vy ?? 0) > 0) s.vy = 0;
        s.y = Math.min(s.y, o.y0 - height - 0.01);
        hit = true;
        continue;
      }
      let dx = s.x - cx, dz = s.z - cz;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) {
        if (d >= r) continue;
        dx /= d; dz /= d;
        s.x = cx + dx * r; s.z = cz + dz * r;
      } else {
        // centre inside the box: leave by the nearest side
        const dl = s.x - o.x0, dr = o.x1 - s.x, dt = s.z - o.z0, db = o.z1 - s.z;
        const m = Math.min(dl, dr, dt, db);
        if (m === dl) { s.x = o.x0 - r; dx = -1; dz = 0; } else if (m === dr) { s.x = o.x1 + r; dx = 1; dz = 0; }
        else if (m === dt) { s.z = o.z0 - r; dx = 0; dz = -1; } else { s.z = o.z1 + r; dx = 0; dz = 1; }
      }
      // cancel velocity into the surface
      const vn = s.vx * dx + s.vz * dz;
      if (vn < 0) { s.vx -= vn * dx; s.vz -= vn * dz; }
      hit = true;
    }
  }
  return hit;
}

/** Which building footprint (with its layout) contains this point, if any. */
export function layoutAt(w: World, x: number, z: number): Layout | null {
  const list = w.boxGrid.get(gridKey(Math.floor(x / BOX_CELL), Math.floor(z / BOX_CELL)));
  if (!list) return null;
  for (const b of list) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) return w.layouts[w.boxes.indexOf(b)] ?? null;
  return null;
}

export function poiAt(w: World, x: number, z: number): Poi | null {
  for (const p of w.pois) if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  return null;
}

// ------------------------------------------------------------------ scatter (trees, rocks, bushes)
export const SC_OAK = 0, SC_PINE = 1, SC_PALM = 2, SC_ROCK = 3, SC_BUSH = 4;
/** Oaks in the autumn wood and the blossom forest (same shape, their own colours). */
export const SC_AUTUMN = 5, SC_BLOSSOM = 6;
export const SC_TYPES = 7;
/** Flat arrays of [x, y, z, scale, rotation01, tint01] per type. Visual only for now. */
export function genScatter(w: World, excl: Exclusion[] = []): Float32Array[] {
  const out: number[][] = Array.from({ length: SC_TYPES }, () => []);
  const exGrid = new Map<number, Exclusion[]>();
  for (const e of excl) for (let cz = Math.floor((e.z - e.r) / 32); cz <= Math.floor((e.z + e.r) / 32); cz++) for (let cx = Math.floor((e.x - e.r) / 32); cx <= Math.floor((e.x + e.r) / 32); cx++) {
    const k = gridKey(cx, cz); let l = exGrid.get(k); if (!l) exGrid.set(k, (l = [])); l.push(e);
  }
  const excluded = (x: number, z: number) => (exGrid.get(gridKey(Math.floor(x / 32), Math.floor(z / 32))) ?? []).some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < e.r * e.r);
  const step = 10;
  const half = MAP.size / 2;
  const place = (x: number, z: number, i: number, j: number, s: number) => {
    const h = terrainAt(w, x, z);
    if (h < 0.9 || excluded(x, z)) return;
    const r1 = hash2(i, j, s + 1), r2 = hash2(i, j, s + 2), r3 = hash2(i, j, s + 3), r4 = hash2(i, j, s + 4);
    const slope = Math.hypot(terrainAt(w, x + 2, z) - terrainAt(w, x - 2, z), terrainAt(w, x, z + 2) - terrainAt(w, x, z - 2)) / 4;
    const road = roadEdgeDist(w, x, z);
    if (road < 3) return;
    const poi = poiAt(w, x, z);
    const push = (t: number, scale: number) => out[t].push(x, h - 0.05, z, scale, r3, r4);
    if (slope > 0.75 || h > 96) { if (r1 < 0.22) push(SC_ROCK, 0.8 + r2 * 2.4); return; }
    if (poi) {
      if (poi.kind === 'quarry' || poi.kind === 'city' && r1 > 0.05) return;
      if (r1 > 0.12) return;
      const list = w.boxGrid.get(gridKey(Math.floor(x / BOX_CELL), Math.floor(z / BOX_CELL)));
      if (list && list.some((b) => x > b.x0 - 3 && x < b.x1 + 3 && z > b.z0 - 3 && z < b.z1 + 3)) return;
    }
    if (h < 3.2) { // beach
      if (r1 < 0.05) push(SC_PALM, 0.85 + r2 * 0.5);
      else if (r1 < 0.08) push(SC_ROCK, 0.5 + r2);
      return;
    }
    const forest = fbm(x / 170, z / 170, w.seed + 41, 3);
    const bio = biomeAt(x, z);
    // denser woods everywhere (the gaps between places are forest now, not empty fields),
    // lush in the blossom forest, sparse and rocky in the badlands
    let density = poi ? 1 : 0.06 + smooth(0.44, 0.62, forest) * 0.68 + bio.blossom * 0.12 + bio.autumn * 0.08;
    density *= 1 - bio.badlands * 0.85;
    if (r1 < density && bio.badlands < 0.4) { // (no trees out in the badlands: scrub and boulders)
      // (the autumn wood climbs the mountain's lower slopes; pines take over higher up)
      const piney = h > 38 + bio.autumn * 42 + bio.blossom * 20 || fbm(x / 260, z / 260, w.seed + 43, 2) + (z < -300 ? 0.12 : 0) - bio.autumn * 0.3 > 0.62;
      const oak = bio.blossom > 0.4 && r3 < bio.blossom ? SC_BLOSSOM : bio.autumn > 0.35 && r3 < bio.autumn * 1.1 ? SC_AUTUMN : SC_OAK;
      push(piney && bio.blossom < 0.4 ? SC_PINE : oak, 0.8 + r2 * 0.7);
    } else if (r1 < density + 0.05 + bio.badlands * 0.04) push(SC_BUSH, 0.7 + r2 * 0.8);
    else if (r1 > 0.985 - bio.badlands * 0.06) push(SC_ROCK, 0.5 + r2 * (1.2 + bio.badlands * 1.5));
  };
  for (let j = 0; j < MAP.size / step; j++) for (let i = 0; i < MAP.size / step; i++) {
    const x = -half + (i + hash2(i, j, w.seed + 51)) * step, z = -half + (j + hash2(i, j, w.seed + 52)) * step;
    place(x, z, i, j, w.seed + 60);
  }
  // warm-up island: a ring of trees and bushes
  for (let j = 0; j < 22; j++) for (let i = 0; i < 22; i++) {
    const x = w.spawn.ox + (i + hash2(i, j, w.seed + 71)) * 9, z = w.spawn.oz + (j + hash2(i, j, w.seed + 72)) * 9;
    const d = Math.hypot(x - SPAWN_ISLAND.x, z - SPAWN_ISLAND.z);
    const h = terrainAt(w, x, z), r1 = hash2(i, j, w.seed + 73), r2 = hash2(i, j, w.seed + 74);
    if (h < 1.2 || d < 34) continue;
    if (r1 < 0.3) out[h < 3 ? SC_PALM : SC_OAK].push(x, h - 0.05, z, 0.8 + r2 * 0.5, r2, r1 * 3);
    else if (r1 < 0.42) out[SC_BUSH].push(x, h - 0.05, z, 0.8 + r2 * 0.6, r2, r1);
  }
  return out.map((a) => new Float32Array(a));
}

/** Tree trunks and rocks block movement and bullets (bushes and leaves don't). */
function addScatterSolids(w: World) {
  const sc = w.scatter;
  const trunk = (arr: Float32Array, rFn: (s: number) => number, hFn: (s: number) => number) => {
    for (let i = 0; i < arr.length; i += 6) {
      const x = arr[i], y = arr[i + 1], z = arr[i + 2], s = arr[i + 3], r = rFn(s);
      w.solids.push({ x0: x - r, x1: x + r, z0: z - r, z1: z + r, y0: y - 0.5, y1: y + hFn(s), k: SK.Trunk });
    }
  };
  trunk(sc[SC_OAK], (s) => 0.36 * s, (s) => 3.6 * s);
  trunk(sc[SC_AUTUMN], (s) => 0.36 * s, (s) => 3.6 * s);
  trunk(sc[SC_BLOSSOM], (s) => 0.36 * s, (s) => 3.6 * s);
  trunk(sc[SC_PINE], (s) => 0.3 * s, (s) => 3.4 * s);
  trunk(sc[SC_PALM], () => 0.24, (s) => 5.5 * s);
  const rocks = sc[SC_ROCK];
  for (let i = 0; i < rocks.length; i += 6) {
    const x = rocks[i], y = rocks[i + 1], z = rocks[i + 2], s = rocks[i + 3], rot = rocks[i + 4], tint = rocks[i + 5];
    const hx = 0.75 * s * (0.8 + tint * 0.6), hz = 0.75 * s, top = 0.8 * s * (0.7 + rot * 0.6);
    if (s < 0.9) continue; // pebbles don't block
    w.solids.push({ x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0: y - 0.5, y1: y + top, k: SK.Rock });
  }
}

function buildSolidGrid(w: World) {
  const pad = 1.6; // big enough for a car's collision circle
  w.solids.forEach((o, i) => { o.id = i; });
  for (const o of w.solids) {
    for (let cz = Math.floor((o.z0 - pad) / SOLID_CELL); cz <= Math.floor((o.z1 + pad) / SOLID_CELL); cz++)
      for (let cx = Math.floor((o.x0 - pad) / SOLID_CELL); cx <= Math.floor((o.x1 + pad) / SOLID_CELL); cx++) {
        const key = solidKey(cx, cz);
        let list = w.solidGrid.get(key);
        if (!list) w.solidGrid.set(key, (list = []));
        list.push(o);
      }
  }
}

/** Spots beside the roads, away from the named places and from each other, for small hamlets. */
function genHamlets(seed: number, pois: Poi[], roads: Road[], river: Float32Array): Poi[] {
  const rnd = mulberry32(seed * 13 + 5);
  const out: Poi[] = [];
  const kinds: PoiKind[] = ['town', 'farm', 'camp'];
  for (const road of roads) {
    const pts = road.pts;
    for (let i = 4; i + 2 < pts.length / 2 && out.length < 16; i += 6) {
      const x = pts[i * 2], z = pts[i * 2 + 1];
      const tx = pts[i * 2 + 2] - pts[i * 2 - 2], tz = pts[i * 2 + 3] - pts[i * 2 - 1], tl = Math.hypot(tx, tz) || 1;
      const side = rnd() < 0.5 ? -1 : 1;
      const hx = x + (-tz / tl) * 24 * side, hz = z + (tx / tl) * 24 * side;
      if ([...pois, ...out].some((p) => Math.hypot(p.x - hx, p.z - hz) < p.r + (p.minor ? 200 : 90))) continue;
      const g = rawHeight(hx, hz, seed, river);
      if (g < 3 || g > 45 || Math.abs(hx) > MAP.size / 2 - 120 || Math.abs(hz) > MAP.size / 2 - 120) continue;
      // not on a steep slope
      const slope = Math.abs(rawHeight(hx + 15, hz, seed, river) - rawHeight(hx - 15, hz, seed, river)) + Math.abs(rawHeight(hx, hz + 15, seed, river) - rawHeight(hx, hz - 15, seed, river));
      if (slope > 9) continue;
      out.push({ id: pois.length + out.length, name: '', kind: kinds[out.length % 3], x: Math.round(hx), z: Math.round(hz), r: 30, h: 0, minor: true });
    }
  }
  return out;
}

// ------------------------------------------------------------------ entry
const cache = new Map<number, World>();
export function getWorld(seed: number = MAP.seed): World {
  let w = cache.get(seed);
  if (w) return w;
  // places are a fifth bigger than they were drawn (Stillwater Camp keeps its size: it sits close to Brickwell)
  const pois: Poi[] = POI_DEFS.map((p, id) => ({ ...p, id, h: 0, r: Math.round(p.r * (p.name === 'Stillwater Camp' ? 1 : p.name === 'Brickwell' ? 1.15 : 1.22)) }));
  const river = smoothPath(RIVER, 30);
  const roads = genRoads(seed, pois);
  pois.push(...genHamlets(seed, pois, roads, river));
  w = {
    seed, pois, roads, river,
    main: genMain(seed, pois, river),
    spawn: genSpawn(seed),
    boxes: [], boxGrid: new Map(), roadGrid: buildRoadGrid(roads),
    layouts: [], solids: [], solidGrid: new Map(), props: [], caves: [], outdoorChests: [], scatter: [], beacons: [], vaults: [], ladders: [], zips: [], pads: [], merchants: [],
  };
  genBoxes(w);
  for (const b of w.boxes) w.layouts.push(genLayout(w, b, w.solids));
  const extra = genProps(w, w.solids);
  w.props = extra.props; w.caves = extra.caves; w.beacons = extra.beacons; w.vaults = extra.vaults; w.ladders = extra.ladders; w.zips = extra.zips; w.pads = extra.pads; w.merchants = extra.merchants;
  w.outdoorChests = [...extra.extraChests, ...extra.caves.map((c) => c.chest)];
  w.scatter = genScatter(w, extra.excl);
  addScatterSolids(w);
  buildSolidGrid(w);
  cache.set(seed, w);
  return w;
}
