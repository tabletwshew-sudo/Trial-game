import { hash2, mulberry32 } from './noise.js';
import { ROOF_FLAT, terrainAt, type Box, type World } from './world.js';

/**
 * Everything solid that isn't terrain: building walls/floors/stairs/furniture, tree trunks,
 * rocks, props and caves. All axis-aligned boxes, generated from the seed, so the server
 * and every browser collide against exactly the same shapes.
 */

export const SK = {
  Found: 0, Wall: 1, Floor: 2, Ceil: 3, Roof: 4, Stair: 5, Furn: 6, Trunk: 7, Rock: 8, Prop: 9, Cave: 10, Step: 11, Block: 12, Whole: 13,
} as const;

export interface Solid {
  x0: number; y0: number; z0: number; x1: number; y1: number; z1: number;
  k: number;
  /** Building this belongs to (roof solids use it for the gable shape). */
  b?: Box;
  /** Walls: which way the outside faces (0 +z, 1 +x, 2 -z, 3 -x). Other kinds: free use. */
  face?: number;
  /** Interior wall (no exterior face). */
  inner?: boolean;
}

export type BuildingType = 'house' | 'hall' | 'shop' | 'tower' | 'solid';
export interface Door { x: number; z: number; ix: number; iz: number; y: number; w: number; h: number; face: number; cx: number; cz: number }
export interface Spot { x: number; y: number; z: number; face: number }
export interface Furniture { t: string; x0: number; z0: number; x1: number; z1: number; y: number; h: number; face: number }
export interface Layout {
  b: Box;
  type: BuildingType;
  /** Floor heights you can stand on inside (ground floor first). */
  floors: number[];
  /** Height of the accessible part above the ground floor (anything above is solid). */
  access: number;
  wallT: number;
  doors: Door[];
  stairs: { bx: number; bz: number; tx: number; tz: number; y0: number; y1: number; x0: number; z0: number; x1: number; z1: number; face: number } | null;
  loot: Spot[];
  chests: Spot[];
  furniture: Furniture[];
  /** World-space frame for the client: front face and size. */
  front: number; W: number; D: number;
}

// ------------------------------------------------------------------ the building's local frame
// u runs along the front wall, v runs from the front wall inwards. `front` is the outward face index.
interface Frame { b: Box; f: number; W: number; D: number }
function frameOf(b: Box): Frame {
  const f = (b.style >> 6) % 4;
  return { b, f, W: f % 2 === 0 ? b.x1 - b.x0 : b.z1 - b.z0, D: f % 2 === 0 ? b.z1 - b.z0 : b.x1 - b.x0 };
}
export function localToWorld(F: { b: Box; f: number }, u: number, v: number): [number, number] {
  const b = F.b;
  switch (F.f) {
    case 0: return [b.x0 + u, b.z1 - v];
    case 1: return [b.x1 - v, b.z0 + u];
    case 2: return [b.x1 - u, b.z0 + v];
    default: return [b.x0 + v, b.z1 - u];
  }
}
function rect(F: Frame, u0: number, u1: number, v0: number, v1: number) {
  const [ax, az] = localToWorld(F, u0, v0), [bx, bz] = localToWorld(F, u1, v1);
  return { x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) };
}
/** Face index (outward) of: front, right (u = W), back, left (u = 0). */
const faceFront = (F: Frame) => F.f, faceRight = (F: Frame) => (F.f + 1) % 4, faceBack = (F: Frame) => (F.f + 2) % 4, faceLeft = (F: Frame) => (F.f + 3) % 4;

export function buildingType(b: Box): BuildingType {
  if (b.shape !== 0) return 'solid';
  const W = b.x1 - b.x0, D = b.z1 - b.z0, h = b.y1 - b.fy;
  if (b.kind === 'industrial' && W * D > 250) return 'hall';
  if (b.kind === 'farm' && b.roofH > 3.5) return 'hall';
  if (b.kind === 'harbor' && Math.max(W, D) >= 16) return 'hall';
  if (b.kind === 'city') return h > 16 ? 'tower' : 'shop';
  if (b.kind === 'resort' && h > 10) return 'tower';
  return 'house';
}

// ------------------------------------------------------------------ generation
export function genLayout(w: World, b: Box, out: Solid[]): Layout {
  const type = buildingType(b);
  const F = frameOf(b);
  const { W, D } = F;
  const fy = b.fy, y1 = b.y1, h = y1 - fy;
  const rnd = mulberry32(b.style * 31 + 7);
  const L: Layout = { b, type, floors: [], access: 0, wallT: 0.3, doors: [], stairs: null, loot: [], chests: [], furniture: [], front: F.f, W, D };
  const add = (r: { x0: number; z0: number; x1: number; z1: number }, y0: number, yTop: number, k: number, extra: Partial<Solid> = {}) => {
    if (yTop - y0 < 0.01 || r.x1 - r.x0 < 0.01 || r.z1 - r.z0 < 0.01) return;
    out.push({ x0: r.x0, z0: r.z0, x1: r.x1, z1: r.z1, y0, y1: yTop, k, b, ...extra });
  };
  const roofSolid = () => { if (b.roof !== ROOF_FLAT) add({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, y1, y1 + b.roofH, SK.Roof); };

  if (type === 'solid') {
    add({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, b.y0, y1, SK.Whole);
    return L;
  }

  // how much of the building you can walk around in
  const T = type === 'hall' ? 0.35 : 0.3;
  L.wallT = T;
  let access = h, storeys = 1;
  if (type === 'house') storeys = h >= 5.6 ? 2 : 1;
  if (type === 'shop') { access = Math.min(h, 7); storeys = access >= 6.4 ? 2 : 1; }
  if (type === 'tower') access = 4.2;
  if (h - access < 0.4) access = h;
  const sh = access / storeys;
  L.access = access;
  for (let i = 0; i < storeys; i++) L.floors.push(fy + i * sh);
  const top = fy + access; // underside of the solid block above / roof slab top

  // foundation (you stand on it inside)
  add({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, b.y0, fy, SK.Found);

  // doors: front always, back door when the building is deep enough
  const doorW = type === 'hall' ? 4.6 : type === 'tower' ? 2.4 : type === 'shop' ? 2.0 : 1.6;
  const doorH = type === 'hall' ? Math.min(4.2, access - 0.8) : type === 'tower' ? 3.0 : 2.3;
  const back = type === 'hall' || type === 'tower' || D >= 8.5;
  const backW = type === 'hall' ? 1.8 : 1.6, backH = 2.3;

  // a wall along the front (v = 0..T) or back (v = D-T..D) with an opening at the middle
  const wallWithDoor = (v0: number, v1: number, face: number, dw: number, dh: number | 0) => {
    const c = W / 2;
    if (!dh) { add(rect(F, 0, W, v0, v1), fy, top, SK.Wall, { face }); return; }
    add(rect(F, 0, c - dw / 2, v0, v1), fy, top, SK.Wall, { face });
    add(rect(F, c + dw / 2, W, v0, v1), fy, top, SK.Wall, { face });
    add(rect(F, c - dw / 2, c + dw / 2, v0, v1), fy + dh, top, SK.Wall, { face });
  };
  wallWithDoor(0, T, faceFront(F), doorW, doorH);
  wallWithDoor(D - T, D, faceBack(F), backW, back ? backH : 0);
  add(rect(F, 0, T, T, D - T), fy, top, SK.Wall, { face: faceLeft(F) });
  add(rect(F, W - T, W, T, D - T), fy, top, SK.Wall, { face: faceRight(F) });

  const mkDoor = (u: number, vOut: number, vIn: number, wv: number, hv: number, face: number, vWall: number) => {
    const [x, z] = localToWorld(F, u, vOut), [ix, iz] = localToWorld(F, u, vIn), [cx, cz] = localToWorld(F, u, vWall);
    L.doors.push({ x, z, ix, iz, y: fy, w: wv, h: hv, face, cx, cz });
  };
  mkDoor(W / 2, -1.3, 1.4, doorW, doorH, faceFront(F), T / 2);
  if (back) mkDoor(W / 2, D + 1.3, D - 1.4, backW, backH, faceBack(F), D - T / 2);

  // porch steps where the ground outside is lower than the floor
  for (const d of L.doors) {
    const g = terrainAt(w, d.x, d.z);
    const drop = fy - g;
    if (drop < 0.3) continue;
    const n = Math.min(8, Math.ceil(drop / 0.28)), rise = drop / n;
    const atBack = d.face === faceBack(F);
    for (let k = 0; k < n; k++) {
      const outer = (n - k) * 0.36;
      const vA = atBack ? D + outer - 0.36 : -outer, vB = vA + 0.36;
      add(rect(F, W / 2 - d.w / 2 - 0.3, W / 2 + d.w / 2 + 0.3, vA, vB), g - 0.4, g + (k + 1) * rise, SK.Step);
    }
  }

  // ceiling / roof slab, solid block above the accessible part, gable roof
  add({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, top - 0.28, top, SK.Ceil);
  if (top < y1 - 0.01) add({ x0: b.x0, z0: b.z0, x1: b.x1, z1: b.z1 }, top, y1, SK.Block);
  roofSolid();

  // ---------------------------------------------------------------- inside
  const inner = (u0: number, u1: number, v0: number, v1: number) => ({ u0: Math.max(T, u0), u1: Math.min(W - T, u1), v0: Math.max(T, v0), v1: Math.min(D - T, v1) });
  const occupied: { u0: number; u1: number; v0: number; v1: number; fl: number }[] = [];
  // keep door approaches clear
  occupied.push({ u0: W / 2 - doorW / 2 - 0.4, u1: W / 2 + doorW / 2 + 0.4, v0: 0, v1: 2.2, fl: 0 });
  if (back) occupied.push({ u0: W / 2 - backW / 2 - 0.4, u1: W / 2 + backW / 2 + 0.4, v0: D - 2.2, v1: D, fl: 0 });
  const free = (r: { u0: number; u1: number; v0: number; v1: number }, fl: number) =>
    r.u0 >= T - 0.01 && r.u1 <= W - T + 0.01 && r.v0 >= T - 0.01 && r.v1 <= D - T + 0.01 &&
    !occupied.some((o) => o.fl === fl && r.u0 < o.u1 && r.u1 > o.u0 && r.v0 < o.v1 && r.v1 > o.v0);
  const furn = (t: string, u0: number, u1: number, v0: number, v1: number, fl: number, hgt: number, face: number, solid = true) => {
    const r = { u0, u1, v0, v1 };
    if (!free(r, fl)) return false;
    occupied.push({ ...r, fl });
    const y = L.floors[fl];
    const wr = rect(F, u0, u1, v0, v1);
    L.furniture.push({ t, ...wr, y, h: hgt, face });
    if (solid) add(wr, y, y + hgt, SK.Furn);
    return true;
  };

  // stairs up the right-hand wall, rising towards the back
  if (storeys === 2) {
    const n = Math.ceil(sh / 0.3), rise = sh / n, run = 0.3, sw = 1.05;
    const vEnd = D - T - 0.15, vStart = vEnd - n * run;
    const u0 = W - T - sw, u1 = W - T;
    for (let i = 0; i < n; i++) add(rect(F, u0, u1, vStart + i * run, vStart + (i + 1) * run), fy, fy + (i + 1) * rise, SK.Stair);
    occupied.push({ u0: u0 - 0.6, u1, v0: vStart - 1.0, v1: D, fl: 0 });
    // upper floor with a hole over the stairs (and a landing beside the top step)
    const yU = fy + sh;
    const hole = { u0: u0 - 0.05, u1: W - T, v0: vStart - 0.4, v1: D - T };
    add(rect(F, T, hole.u0, T, D - T), yU - 0.22, yU, SK.Floor);
    add(rect(F, hole.u0, W - T, T, hole.v0), yU - 0.22, yU, SK.Floor);
    occupied.push({ u0: hole.u0 - 1.0, u1: W, v0: hole.v0 - 0.2, v1: D, fl: 1 });
    // railing along the open side of the hole, leaving the top 1.3 m clear to step off
    add(rect(F, hole.u0 - 0.08, hole.u0, hole.v0, D - T - 1.3), yU, yU + 1.0, SK.Furn);
    L.furniture.push({ t: 'rail', ...rect(F, hole.u0 - 0.08, hole.u0, hole.v0, D - T - 1.3), y: yU, h: 1.0, face: faceLeft(F) });
    const [bx, bz] = localToWorld(F, u0 + sw / 2, vStart - 0.7), [tx, tz] = localToWorld(F, u0 - 0.7, vEnd - 0.5);
    const sr = rect(F, u0, u1, vStart, vEnd);
    L.stairs = { bx, bz, tx, tz, y0: fy, y1: yU, ...sr, face: faceBack(F) };
  }

  // a partition wall splitting the back of bigger single-hall houses into two rooms
  if (type === 'house' && W >= 9 && D >= 8) {
    const up = W * 0.45, v0 = D * 0.5, gap0 = v0 + (D - T - v0) / 2 - 0.65;
    add(rect(F, up - 0.1, up + 0.1, v0, gap0), fy, fy + sh - 0.22, SK.Wall, { inner: true, face: faceRight(F) });
    add(rect(F, up - 0.1, up + 0.1, gap0 + 1.3, D - T), fy, fy + sh - 0.22, SK.Wall, { inner: true, face: faceRight(F) });
    occupied.push({ u0: up - 0.6, u1: up + 0.6, v0, v1: D, fl: 0 });
  }

  // furniture by building type
  const fl0 = 0, flTop = storeys - 1;
  const r01 = () => rnd();
  if (type === 'house') {
    furn('sofa', T, T + 0.9, 1.4, 3.4, fl0, 0.8, faceRight(F));
    furn('table', W * 0.25, W * 0.25 + 1.2, D * 0.32, D * 0.32 + 0.8, fl0, 0.75, faceFront(F));
    furn('shelf', W - T - 0.45, W - T, 1.0, 2.4, fl0, 1.9, faceLeft(F));
    furn('counter', T, T + 0.65, D - T - 2.6, D - T - 0.2, fl0, 0.95, faceRight(F));
    furn('bed', T, T + 1.6, D - T - 2.1, D - T, flTop, 0.55, faceFront(F)) || furn('bed', T + 0.2, T + 1.8, T + 0.2, T + 2.3, flTop, 0.55, faceBack(F));
    furn('wardrobe', T, T + 0.6, T + 0.5, T + 1.7, flTop, 2.0, faceRight(F));
    furn('lamp', W - T - 0.5, W - T - 0.2, D * 0.45, D * 0.45 + 0.3, fl0, 1.5, faceLeft(F), false);
    furn('rug', W * 0.3, W * 0.7, D * 0.15 + 0.6, D * 0.45, fl0, 0.02, faceFront(F), false);
  } else if (type === 'shop') {
    furn('counter', W * 0.2, W * 0.75, D * 0.55, D * 0.55 + 0.7, fl0, 1.0, faceFront(F));
    for (let i = 0; i < 3; i++) furn('shelf', T, T + 0.5, 2.2 + i * 1.6, 3.4 + i * 1.6, fl0, 1.9, faceRight(F));
    if (storeys === 2) {
      furn('desk', T + 0.3, T + 1.8, T + 0.3, T + 1.0, 1, 0.75, faceBack(F));
      furn('sofa', T, T + 0.9, D * 0.45, D * 0.45 + 2, 1, 0.8, faceRight(F));
      furn('crate', W * 0.4, W * 0.4 + 1.1, T + 0.2, T + 1.3, 1, 1.1, faceFront(F));
    }
  } else if (type === 'tower') {
    furn('counter', W * 0.35, W * 0.65, D * 0.6, D * 0.6 + 0.8, fl0, 1.05, faceFront(F));
    furn('plant', T + 0.2, T + 0.9, T + 0.4, T + 1.1, fl0, 1.6, faceFront(F), false);
    furn('plant', W - T - 0.9, W - T - 0.2, T + 0.4, T + 1.1, fl0, 1.6, faceFront(F), false);
    furn('pillar', W * 0.3 - 0.35, W * 0.3 + 0.35, D * 0.35 - 0.35, D * 0.35 + 0.35, fl0, access, faceFront(F));
    furn('pillar', W * 0.7 - 0.35, W * 0.7 + 0.35, D * 0.35 - 0.35, D * 0.35 + 0.35, fl0, access, faceFront(F));
    furn('sofa', T, T + 0.9, D * 0.5, D * 0.5 + 2.2, fl0, 0.8, faceRight(F));
  } else if (type === 'hall') {
    const hay = b.kind === 'farm';
    const n = 3 + Math.floor(r01() * 4);
    for (let i = 0, tries = 0; i < n && tries < 40; tries++) {
      const s = hay ? 1.3 : 1.4;
      const u = T + 0.3 + r01() * (W - 2 * T - 0.6 - s), v = 2.4 + r01() * (D - T - 2.6 - s);
      const stack = r01() < 0.35 ? 2 : 1;
      if (furn(hay ? 'hay' : 'crate', u, u + s, v, v + s, fl0, s * stack, faceFront(F))) i++;
    }
    if (!hay) furn('shelf', T, T + 0.8, D * 0.4, D * 0.4 + 3, fl0, 2.6, faceRight(F));
  }

  // loot spots on each floor, a chest somewhere sensible
  const spotAt = (fl: number, tries = 30): Spot | null => {
    for (let i = 0; i < tries; i++) {
      const u = T + 0.6 + r01() * (W - 2 * T - 1.2), v = T + 0.6 + r01() * (D - 2 * T - 1.2);
      const r = { u0: u - 0.45, u1: u + 0.45, v0: v - 0.45, v1: v + 0.45 };
      if (!free(r, fl)) continue;
      occupied.push({ ...r, fl });
      const [x, z] = localToWorld(F, u, v);
      return { x, y: L.floors[fl], z, face: faceFront(F) };
    }
    return null;
  };
  // chests go against a wall, facing into the room
  const chestAt = (fl: number): Spot | null => {
    const opts: [number, number, number][] = [
      [T + 0.5, D * 0.6, faceRight(F)], [W - T - 0.5, D * 0.3, faceLeft(F)], [W * 0.3, D - T - 0.5, faceFront(F)], [W * 0.7, D - T - 0.5, faceFront(F)], [T + 0.5, D * 0.25, faceRight(F)],
      [W * 0.25, T + 0.5, faceBack(F)], [W * 0.8, T + 0.5, faceBack(F)],
    ];
    const start = Math.floor(r01() * opts.length);
    for (let i = 0; i < opts.length; i++) {
      const [u, v, face] = opts[(i + start) % opts.length];
      const r = { u0: u - 0.45, u1: u + 0.45, v0: v - 0.45, v1: v + 0.45 };
      if (!free(r, fl)) continue;
      occupied.push({ ...r, fl });
      const [x, z] = localToWorld(F, u, v);
      return { x, y: L.floors[fl], z, face };
    }
    return null;
  };
  const chestFloor = storeys - 1;
  const c = chestAt(chestFloor);
  if (c) L.chests.push(c);
  if (type === 'hall' || (type === 'tower' && W > 25)) { const c2 = chestAt(0); if (c2) L.chests.push(c2); }
  const lootN = type === 'hall' ? 4 : type === 'house' && storeys === 1 ? 2 : 3;
  for (let i = 0; i < lootN; i++) { const s = spotAt(i % storeys); if (s) L.loot.push(s); }
  // something on top of a crate stack, for the climbers
  if (type === 'hall') {
    const f = L.furniture.find((x) => x.t === 'crate' || x.t === 'hay');
    if (f) L.loot.push({ x: (f.x0 + f.x1) / 2, y: f.y + f.h, z: (f.z0 + f.z1) / 2, face: 0 });
  }
  return L;
}

// ------------------------------------------------------------------ outdoor props
export interface Prop { t: string; x: number; y: number; z: number; rot: number; s: number; n?: number; label?: string }

/** Small reusable helper: a solid box centred at (x, z). */
export function boxSolid(x: number, z: number, hx: number, hz: number, y0: number, y1: number, k: number): Solid {
  return { x0: x - hx, x1: x + hx, z0: z - hz, z1: z + hz, y0, y1, k };
}

export function hashPick(i: number, j: number, seed: number) { return hash2(i, j, seed); }
