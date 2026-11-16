import * as THREE from 'three';
import { ROOF_FLAT, ROOF_GABLE_X, SK, hash2, lerp, type Box, type Furniture, type Layout, type PoiKind, type Solid, type World } from '@dropzone/shared';
import { softRamp } from '../lobby/toon';
import { GeoBuilder } from './geo';
import { SURF, withGlass, withSurfaces } from './surface';

/**
 * Buildings drawn from the same solids the game collides with, so what you see is exactly
 * what blocks you: outside walls in the building's paint, wallpaper inside, wooden or tiled
 * floors, stairs, furniture, windows on both sides, door frames with open doors, porch steps.
 */
export const buildingMat = withSurfaces(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide }));
/**
 * Inside surfaces: lit like the outside, plus a soft fill (part of their own colour as
 * emissive) so rooms read clearly even when the sun can't reach in.
 */
export function fillLitMaterial(fill: number) {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * ${fill.toFixed(2)};`);
  };
  m.customProgramCacheKey = () => `fill${fill}`;
  return withSurfaces(m);
}
const interiorMat = fillLitMaterial(0.32);
/** Glass, lamp shades and crystals: drawn unlit so they glow a little. */
const glowMat = withGlass(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));

const WALLS: Record<PoiKind, string[]> = {
  city: ['#e8dcc4', '#c96f4a', '#9fb7c9', '#d9a441', '#b5c99a', '#cfcfd6', '#e07a5f'],
  town: ['#f2e8cf', '#ffd6a5', '#a8dadc', '#f4a261', '#e9c46a', '#cdb4db', '#ffb4a2', '#b7e4c7'],
  industrial: ['#8d99ae', '#b08968', '#7f8c8d', '#a3b18a', '#c1666b'],
  farm: ['#c1440e', '#a63d2f', '#e9d8a6', '#d4a373'],
  camp: ['#8b5e3c', '#a47148', '#7f5539', '#9c6644'],
  harbor: ['#577590', '#e9ecef', '#90be6d', '#f9c74f', '#b56576'],
  station: ['#d9dde3', '#aab4c0'],
  resort: ['#fff1e6', '#ffd6e0', '#bde0fe', '#fde68a'],
  quarry: ['#c2a878', '#9a8c73', '#d9b44a'],
};
const ROOFS: Record<PoiKind, string[]> = {
  city: ['#4a4e69', '#5c5f66', '#3d405b'], town: ['#9b2226', '#bb3e03', '#3d5a80', '#6d597a', '#588157', '#7f4f24'],
  industrial: ['#52525b', '#6b705c', '#7a4a3a'], farm: ['#5c4033', '#6f4e37', '#4a4a4a'], camp: ['#386641', '#52796f', '#6a4c3b'],
  harbor: ['#3d405b', '#9b2226', '#52525b'], station: ['#e63946', '#577590'], resort: ['#00b4d8', '#ef476f', '#f4a261'], quarry: ['#5c5f66'],
};
const INTERIOR = ['#f4ecdc', '#e3eef2', '#e8f0e0', '#f6e1de', '#efe6cf', '#e6e0f0'];
const FLOORS: Record<string, string[]> = { house: ['#b5835a', '#a0704a', '#c4955f'], shop: ['#d9d4c7', '#c9c2b4'], tower: ['#e6e2da', '#cfc8bb'], hall: ['#8f8b84', '#9a958c'] };
const CONTAINER = ['#e63946', '#2a9d8f', '#e9c46a', '#457b9d', '#f4a261', '#6a994e', '#9d4edd'];
const FABRIC = ['#e76f51', '#2a9d8f', '#457b9d', '#8d6cab', '#e9c46a', '#6c757d', '#c1121f'];
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

/** Face index (0 +z, 1 +x, 2 -z, 3 -x) -> boxFaces slot. */
const FACE_SLOT = [2, 0, 3, 1];
const FACE_DIR: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

interface Paint { wall: string; trim: string; roof: string; inside: string; floor: string; ceiling: string; wallSurf: number; floorSurf: number }
function paintFor(b: Box, L: Layout): Paint {
  const pick = <T,>(arr: T[], salt: number) => arr[(b.style >> salt) % arr.length];
  const wall = pick(WALLS[b.kind], 0);
  return { wall, trim: shade(wall, 0.72), roof: pick(ROOFS[b.kind], 3), inside: pick(INTERIOR, 5), floor: pick(FLOORS[L.type] ?? FLOORS.house, 7), ceiling: '#f7f3ea', wallSurf: wallSurface(b), floorSurf: L.type === 'house' ? SURF.planks : L.type === 'hall' ? SURF.plaster : SURF.tiles };
}
/** What the outside walls are made of, by place and building. */
function wallSurface(b: Box): number {
  const v = (b.style >> 2) % 4;
  switch (b.kind) {
    case 'city': return v < 2 ? SURF.brick : SURF.plaster;
    case 'town': return v === 0 ? SURF.brick : v === 1 ? SURF.plaster : SURF.siding;
    case 'farm': case 'harbor': return SURF.siding;
    case 'camp': return SURF.logs;
    case 'industrial': case 'quarry': return v < 2 ? SURF.metal : SURF.brick;
    case 'resort': case 'station': return SURF.plaster;
    default: return SURF.plaster;
  }
}

function addSolidOutline(g: GeoBuilder, gi: GeoBuilder, o: Solid, p: Paint, L: Layout) {
  const { x0, y0, z0, x1, y1, z1 } = o;
  switch (o.k) {
    case SK.Found: {
      const plinth = shade(p.wall, 0.62);
      g.surf = SURF.plaster; gi.surf = p.floorSurf;
      g.boxFaces(x0 - 0.06, y0, z0 - 0.06, x1 + 0.06, y1, z1 + 0.06, [plinth, plinth, plinth, plinth, null, null]);
      gi.boxFaces(x0, y0, z0, x1, y1, z1, [null, null, null, null, p.floor, null]);
      break;
    }
    case SK.Wall: {
      g.surf = p.wallSurf; gi.surf = SURF.wallpaper;
      const c: (string | null)[] = Array(6).fill(o.inner ? shade(p.inside, 0.93) : p.inside);
      c[4] = shade(p.inside, 0.85); c[5] = null;
      if (!o.inner && o.face !== undefined) {
        const out: (string | null)[] = Array(6).fill(null);
        out[FACE_SLOT[o.face]] = p.wall;
        c[FACE_SLOT[o.face]] = null;
        g.boxFaces(x0, y0, z0, x1, y1, z1, out);
      }
      gi.boxFaces(x0, y0, z0, x1, y1, z1, c);
      // a darker band at the foot of outside walls (reads like dirt and grounds the building)
      if (!o.inner && o.face !== undefined && y0 <= L.b.fy + 0.01) {
        const [fx, fz] = FACE_DIR[o.face], e = 0.012;
        const bx0 = fx > 0 ? x1 + e : fx < 0 ? x0 - e : x0, bx1 = fx > 0 ? x1 + e : fx < 0 ? x0 - e : x1;
        const bz0 = fz > 0 ? z1 + e : fz < 0 ? z0 - e : z0, bz1 = fz > 0 ? z1 + e : fz < 0 ? z0 - e : z1;
        g.surf = SURF.plaster;
        g.quad([bx0, y0, bz0], [bx1, y0, bz1], [bx1, y0 + 0.5, bz1], [bx0, y0 + 0.5, bz0], shade(p.wall, 0.8), [fx, 0, fz]);
      }
      break;
    }
    case SK.Floor: gi.surf = p.floorSurf; gi.boxFaces(x0, y0, z0, x1, y1, z1, [p.inside, p.inside, p.inside, p.inside, p.floor, p.ceiling]); break;
    case SK.Ceil:
      g.surf = SURF.gravel; gi.surf = SURF.plain;
      g.boxFaces(x0, y0, z0, x1, y1, z1, [null, null, null, null, L.b.roof === ROOF_FLAT || L.access < L.b.y1 - L.b.fy - 0.01 ? shade(p.roof, 1.05) : null, null]);
      gi.boxFaces(x0, y0, z0, x1, y1, z1, [null, null, null, null, null, p.ceiling]);
      break;
    case SK.Block: g.surf = p.wallSurf; g.boxFaces(x0, y0, z0, x1, y1, z1, [p.wall, p.wall, p.wall, p.wall, L.b.roof === ROOF_FLAT ? shade(p.roof, 1.05) : null, null]); break;
    case SK.Stair: gi.surf = p.floorSurf === SURF.planks ? SURF.planks : SURF.plaster; gi.boxFaces(x0, y0, z0, x1, y1, z1, [shade(p.floor, 0.8), shade(p.floor, 0.8), shade(p.floor, 0.8), shade(p.floor, 0.8), p.floor, null]); break;
    case SK.Step: g.surf = SURF.plaster; g.boxFaces(x0, y0, z0, x1, y1, z1, ['#b8b2a6', '#b8b2a6', '#b8b2a6', '#b8b2a6', '#cfc9bd', null]); break;
  }
  g.surf = gi.surf = SURF.plain;
}

function addRoof(g: GeoBuilder, b: Box, p: Paint) {
  const { x0, x1, z0, z1, y1 } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  g.surf = SURF.plaster;
  if (b.roof === ROOF_FLAT) {
    const pw = 0.3, ph = b.kind === 'city' ? 0.9 : 0.45;
    g.box(x0 - 0.25, y1, z0 - 0.25, x1 + 0.25, y1 + ph, z0 - 0.25 + pw, p.roof);
    g.box(x0 - 0.25, y1, z1 + 0.25 - pw, x1 + 0.25, y1 + ph, z1 + 0.25, p.roof);
    g.box(x0 - 0.25, y1, z0, x0 - 0.25 + pw, y1 + ph, z1, p.roof);
    g.box(x1 + 0.25 - pw, y1, z0, x1 + 0.25, y1 + ph, z1, p.roof);
    if (x1 - x0 > 7 && z1 - z0 > 7) {
      const r = (k: number) => hash2(b.style, k, 7);
      g.box(cx - 3 + r(1) * 2, y1, cz - 2.5 + r(2) * 2, cx - 1 + r(1) * 2, y1 + 1.1, cz - 1 + r(2) * 2, '#c8ccd2');
      g.box(cx - 2.9 + r(1) * 2, y1 + 1.1, cz - 2.4 + r(2) * 2, cx - 1.1 + r(1) * 2, y1 + 1.16, cz - 1.1 + r(2) * 2, '#9aa1ab');
      if (r(3) < 0.6) g.box(cx + 0.5, y1, cz + 0.5, cx + 3, y1 + 2.4, cz + 3, shade(p.wall, 0.85));
      if (b.kind === 'city' && r(4) < 0.5) { g.cylinder(cx - 2, y1 + 1.2, cz + 2.2, 1.3, y1 + 3.6, '#b08968', 8, 0.9, '#7f5539'); for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(cx - 2 + ox * 0.9 - 0.08, y1, cz + 2.2 + oz * 0.9 - 0.08, cx - 2 + ox * 0.9 + 0.08, y1 + 1.2, cz + 2.2 + oz * 0.9 + 0.08, '#555'); }
      if (b.kind === 'city' && y1 - b.fy > 30) { g.box(cx - 0.12, y1, cz - 0.12, cx + 0.12, y1 + 9, cz + 0.12, '#d8d8d8'); g.box(cx - 0.3, y1 + 8.6, cz - 0.3, cx + 0.3, y1 + 9.2, cz + 0.3, '#ff3b3b'); }
    }
    return;
  }
  const o = 0.55, alongX = b.roof === ROOF_GABLE_X;
  const half = alongX ? (z1 - z0) / 2 : (x1 - x0) / 2, slope = b.roofH / half, ye = y1 - o * slope, yr = y1 + b.roofH;
  const P = (a: number, y: number, c: number): [number, number, number] => (alongX ? [a, y, c] : [c, y, a]);
  const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1, c0 = alongX ? z0 : x0, c1 = alongX ? z1 : x1, cc = (c0 + c1) / 2;
  g.surf = b.kind === 'industrial' || b.kind === 'farm' && (b.style & 2) ? SURF.metal : SURF.shingles;
  g.quad(P(a0 - o, ye, c1 + o), P(a1 + o, ye, c1 + o), P(a1 + o, yr, cc), P(a0 - o, yr, cc), p.roof, [0, 1, 0]);
  g.quad(P(a0 - o, ye, c0 - o), P(a1 + o, ye, c0 - o), P(a1 + o, yr, cc), P(a0 - o, yr, cc), shade(p.roof, 0.92), [0, 1, 0]);
  g.surf = SURF.plain;
  // underside (seen from the attic-less interior) and gable ends
  g.quad(P(a0 - o, ye - 0.05, c1 + o), P(a1 + o, ye - 0.05, c1 + o), P(a1 + o, yr - 0.05, cc), P(a0 - o, yr - 0.05, cc), shade(p.roof, 0.6), [0, -1, 0]);
  g.quad(P(a0 - o, ye - 0.05, c0 - o), P(a1 + o, ye - 0.05, c0 - o), P(a1 + o, yr - 0.05, cc), P(a0 - o, yr - 0.05, cc), shade(p.roof, 0.6), [0, -1, 0]);
  g.surf = p.wallSurf;
  g.tri(P(a0, y1, c0), P(a0, y1, c1), P(a0, yr, cc), p.wall, alongX ? [-1, 0, 0] : [0, 0, -1]);
  g.tri(P(a1, y1, c0), P(a1, y1, c1), P(a1, yr, cc), p.wall, alongX ? [1, 0, 0] : [0, 0, 1]);
  g.surf = SURF.plain;
  g.box(...(alongX ? [x0 - o, yr - 0.08, cz - 0.18, x1 + o, yr + 0.14, cz + 0.18] : [cx - 0.18, yr - 0.08, z0 - o, cx + 0.18, yr + 0.14, z1 + o]) as [number, number, number, number, number, number], shade(p.roof, 0.75));
  if ((b.kind === 'town' || b.kind === 'camp' || b.kind === 'resort') && (b.style & 1)) {
    const [px, , pz] = P(lerp(a0, a1, 0.72), 0, cc + half * 0.45);
    g.box(px - 0.4, y1, pz - 0.4, px + 0.4, yr + 0.7, pz + 0.4, '#8d6e63');
    g.box(px - 0.5, yr + 0.7, pz - 0.5, px + 0.5, yr + 0.9, pz + 0.5, '#5d4037');
  }
}

/** Windows along the outside of a wall segment, on both faces. */
function addWindows(g: GeoBuilder, gi: GeoBuilder, glass: GeoBuilder, o: Solid, L: Layout, p: Paint, storeys: { y: number; h: number }[]) {
  if (o.face === undefined || o.inner) return;
  const [fx, fz] = FACE_DIR[o.face];
  const alongX = fz !== 0;
  const a0 = alongX ? o.x0 : o.z0, a1 = alongX ? o.x1 : o.z1;
  const outer = fx > 0 ? o.x1 : fx < 0 ? o.x0 : fz > 0 ? o.z1 : o.z0;
  const inner = fx > 0 ? o.x0 : fx < 0 ? o.x1 : fz > 0 ? o.z0 : o.z1;
  const len = a1 - a0;
  const big = L.type === 'hall';
  const spacing = big ? 5 : L.b.kind === 'city' ? 2.6 : 3.1;
  const n = Math.floor((len - 1.2) / spacing);
  if (n < 1) return;
  const at = (a: number, y: number, off: number, side: number): [number, number, number] =>
    alongX ? [a, y, (side > 0 ? outer : inner) + fz * off * side] : [(side > 0 ? outer : inner) + fx * off * side, y, a];
  for (const st of storeys) {
    for (let i = 0; i < n; i++) {
      const mid = a0 + (len - (n - 1) * spacing) / 2 + i * spacing;
      const ww = big ? 2.2 : Math.min(1.5, spacing * 0.5);
      const wy0 = st.y + (big ? st.h - 1.8 : 1.05), wy1 = st.y + (big ? st.h - 0.6 : Math.min(st.h - 0.5, 2.45));
      if (wy1 - wy0 < 0.6) continue;
      const r = hash2(L.b.style + i * 7, Math.round(st.y * 10), 3);
      if (!big && L.b.kind !== 'city' && r < 0.1) continue;
      const lit = r > 0.86 ? '#ffe9a3' : r > 0.45 ? '#9ad7ee' : '#78c0dc';
      for (const side of [1, -1]) {
        if (side < 0 && L.access < st.y - L.b.fy + 0.5) continue; // no inside to the solid upper block
        const g2 = side > 0 ? g : gi;
        const frame = side > 0 ? shade(p.wall, 0.7) : shade(p.inside, 0.8);
        const n3: [number, number, number] = [fx * side, 0, fz * side];
        g2.quad(at(mid - ww / 2 - 0.1, wy0 - 0.1, 0.02, side), at(mid + ww / 2 + 0.1, wy0 - 0.1, 0.02, side), at(mid + ww / 2 + 0.1, wy1 + 0.1, 0.02, side), at(mid - ww / 2 - 0.1, wy1 + 0.1, 0.02, side), frame, n3);
        glass.quad(at(mid - ww / 2, wy0, 0.04, side), at(mid + ww / 2, wy0, 0.04, side), at(mid + ww / 2, wy1, 0.04, side), at(mid - ww / 2, wy1, 0.04, side), side > 0 ? lit : '#cfe9f5', n3);
        // mullion + sill
        g2.quad(at(mid - 0.03, wy0, 0.05, side), at(mid + 0.03, wy0, 0.05, side), at(mid + 0.03, wy1, 0.05, side), at(mid - 0.03, wy1, 0.05, side), frame, n3);
        if (side > 0 && !big) g.quad(at(mid - ww / 2 - 0.2, wy0 - 0.22, 0.12, side), at(mid + ww / 2 + 0.2, wy0 - 0.22, 0.12, side), at(mid + ww / 2 + 0.2, wy0 - 0.08, 0.12, side), at(mid - ww / 2 - 0.2, wy0 - 0.08, 0.12, side), '#f5f1e8', n3);
      }
    }
  }
}

/** Door frames and the open door leaf. */
function addDoors(g: GeoBuilder, gi: GeoBuilder, L: Layout, p: Paint) {
  for (const d of L.doors) {
    const [fx, fz] = FACE_DIR[d.face];
    const alongX = fz !== 0, T = L.wallT;
    const y = d.y;
    const tx = alongX ? 1 : 0, tz = alongX ? 0 : 1;
    // frame: two posts and a header, slightly proud of the wall on the outside
    for (const s of [-1, 1]) {
      const px = d.cx + tx * s * (d.w / 2 + 0.06), pz = d.cz + tz * s * (d.w / 2 + 0.06);
      const hx = alongX ? 0.08 : T / 2 + 0.05, hz = alongX ? T / 2 + 0.05 : 0.08;
      g.box(px - hx, y, pz - hz, px + hx, y + d.h + 0.1, pz + hz, p.trim);
    }
    const hx = alongX ? d.w / 2 + 0.14 : T / 2 + 0.05, hz = alongX ? T / 2 + 0.05 : d.w / 2 + 0.14;
    g.box(d.cx - hx, y + d.h, d.cz - hz, d.cx + hx, y + d.h + 0.14, d.cz + hz, p.trim);
    if (L.type === 'hall') {
      // roll-up door rolled up under the header
      g.box(d.cx - hx + 0.1, y + d.h - 0.5, d.cz - hz + 0.05, d.cx + hx - 0.1, y + d.h, d.cz + hz - 0.05, '#5a6470');
      continue;
    }
    // the door itself, swung open against the inside of the wall
    const hinge = { x: d.cx + tx * (d.w / 2) - fx * (T / 2), z: d.cz + tz * (d.w / 2) - fz * (T / 2) };
    const leafCol = ['#7b3f00', '#2d6a4f', '#1d3557', '#9d0208', '#f1faee'][(L.b.style >> 9) % 5];
    const ix = -fx, iz = -fz; // into the building
    const lx0 = Math.min(hinge.x, hinge.x + ix * (d.w - 0.1)), lx1 = Math.max(hinge.x, hinge.x + ix * (d.w - 0.1));
    const lz0 = Math.min(hinge.z, hinge.z + iz * (d.w - 0.1)), lz1 = Math.max(hinge.z, hinge.z + iz * (d.w - 0.1));
    const th = 0.05;
    gi.box(alongX ? hinge.x - 0.02 - th : lx0, y + 0.02, alongX ? lz0 : hinge.z - 0.02 - th, alongX ? hinge.x - 0.02 : lx1, y + d.h - 0.06, alongX ? lz1 : hinge.z - 0.02, leafCol);
  }
}

/** Furniture models, built from boxes inside each piece's footprint and facing its front. */
function addFurniture(g: GeoBuilder, glow: GeoBuilder, f: Furniture, p: Paint, salt: number) {
  const { x0, z0, x1, z1, y, h } = f;
  const fz = f.face === 0 || f.face === 2;
  const front = f.face === 0 ? z1 : f.face === 1 ? x1 : f.face === 2 ? z0 : x0;
  const back = f.face === 0 ? z0 : f.face === 1 ? x0 : f.face === 2 ? z1 : x1;
  const w0 = fz ? x0 : z0, w1 = fz ? x1 : z1;
  // a sub-box: (w-fraction range, depth-fraction from front, height range)
  const sub = (wa: number, wb: number, da: number, db: number, ya: number, yb: number, col: string, target = g) => {
    const A = lerp(w0, w1, wa), B = lerp(w0, w1, wb), D0 = lerp(front, back, da), D1 = lerp(front, back, db);
    if (fz) target.box(Math.min(A, B), y + ya, Math.min(D0, D1), Math.max(A, B), y + yb, Math.max(D0, D1), col);
    else target.box(Math.min(D0, D1), y + ya, Math.min(A, B), Math.max(D0, D1), y + yb, Math.max(A, B), col);
  };
  const fab = FABRIC[salt % FABRIC.length], wood = '#9c6b43', dark = '#5b3b24';
  switch (f.t) {
    case 'sofa': sub(0, 1, 0, 1, 0.12, 0.42, fab); sub(0, 1, 0.7, 1, 0.42, 0.8, shade(fab, 0.85)); sub(0, 0.1, 0, 0.7, 0.42, 0.62, shade(fab, 0.9)); sub(0.9, 1, 0, 0.7, 0.42, 0.62, shade(fab, 0.9)); sub(0.15, 0.45, 0.15, 0.65, 0.42, 0.5, shade(fab, 1.1)); sub(0.55, 0.85, 0.15, 0.65, 0.42, 0.5, shade(fab, 1.1)); break;
    case 'table': case 'desk': sub(0, 1, 0, 1, h - 0.06, h, wood); for (const [a, b] of [[0.04, 0.08], [0.92, 0.96]]) for (const [c, d] of [[0.06, 0.14], [0.86, 0.94]]) sub(a, b, c, d, 0, h - 0.06, dark); if (f.t === 'table') { sub(0.2, 0.35, 0.3, 0.6, h, h + 0.12, '#f1faee'); sub(0.6, 0.72, 0.4, 0.55, h, h + 0.2, '#e63946'); } else sub(0.3, 0.7, 0.55, 0.65, h, h + 0.35, '#2b2d42'); break;
    case 'shelf': {
      sub(0, 1, 0.85, 1, 0, h, shade(wood, 0.8)); sub(0, 0.05, 0, 1, 0, h, wood); sub(0.95, 1, 0, 1, 0, h, wood);
      const rows = Math.max(2, Math.floor(h / 0.45));
      for (let r = 0; r < rows; r++) {
        const yy = (r / rows) * h;
        sub(0, 1, 0, 1, yy, yy + 0.04, wood);
        for (let k = 0; k < 4; k++) { const c = ['#e63946', '#457b9d', '#e9c46a', '#2a9d8f', '#f4a261', '#8d6cab'][(salt + r * 3 + k) % 6]; sub(0.08 + k * 0.22, 0.24 + k * 0.22, 0.15, 0.8, yy + 0.04, yy + 0.04 + 0.22 + ((k + r) % 3) * 0.05, c); }
      }
      break;
    }
    case 'counter': sub(0, 1, 0, 1, 0, h - 0.05, '#f5f1e8'); sub(0, 1, -0.03, 1, h - 0.05, h, '#6c757d'); sub(0.35, 0.65, 0.2, 0.7, h - 0.06, h + 0.01, '#9aa5b1'); sub(0.48, 0.52, 0.75, 0.8, h, h + 0.3, '#adb5bd'); break;
    case 'bed': sub(0, 1, 0, 1, 0, 0.3, wood); sub(0.02, 0.98, 0.02, 0.98, 0.3, h, '#f8f9fa'); sub(0, 1, 0, 0.6, h - 0.02, h + 0.04, fab); sub(0.1, 0.9, 0.78, 0.95, h, h + 0.14, '#ffffff'); sub(0, 1, 0.96, 1, 0, 1.0, dark); break;
    case 'wardrobe': sub(0, 1, 0, 1, 0, h, shade(wood, 0.9)); sub(0.49, 0.51, -0.01, 0, 0.1, h - 0.1, dark); sub(0.42, 0.46, -0.03, 0, h * 0.5, h * 0.55, '#e9c46a'); sub(0.54, 0.58, -0.03, 0, h * 0.5, h * 0.55, '#e9c46a'); break;
    case 'lamp': sub(0.4, 0.6, 0.4, 0.6, 0, h - 0.4, '#3b3b3b'); sub(0.1, 0.9, 0.1, 0.9, h - 0.45, h, '#ffe8a3', glow); break;
    case 'rug': sub(0, 1, 0, 1, 0, 0.02, fab); sub(0.1, 0.9, 0.1, 0.9, 0.02, 0.025, shade(fab, 1.25)); break;
    case 'crate': {
      const levels = Math.max(1, Math.round(h / (x1 - x0)));
      const s = h / levels;
      for (let k = 0; k < levels; k++) {
        sub(0, 1, 0, 1, k * s, (k + 1) * s - 0.01, '#c98b4a');
        sub(-0.01, 1.01, 0.45, 0.55, k * s, (k + 1) * s, '#9c6b38'); sub(0.45, 0.55, -0.01, 1.01, k * s, (k + 1) * s, '#9c6b38');
        sub(-0.01, 1.01, -0.01, 1.01, (k + 1) * s - 0.1, (k + 1) * s - 0.01, '#9c6b38');
      }
      break;
    }
    case 'hay': {
      const levels = Math.max(1, Math.round(h / 1.3)), s = h / levels;
      for (let k = 0; k < levels; k++) { sub(0, 1, 0, 1, k * s, (k + 1) * s, '#e9c46a'); sub(-0.01, 1.01, 0.3, 0.34, k * s, (k + 1) * s, '#b08930'); sub(-0.01, 1.01, 0.66, 0.7, k * s, (k + 1) * s, '#b08930'); }
      break;
    }
    case 'pillar': sub(0, 1, 0, 1, 0, h, '#e9e4d8'); sub(-0.08, 1.08, -0.08, 1.08, 0, 0.25, '#cfc8bb'); sub(-0.08, 1.08, -0.08, 1.08, h - 0.25, h, '#cfc8bb'); break;
    case 'plant': g.cylinder((x0 + x1) / 2, y, (z0 + z1) / 2, (x1 - x0) * 0.35, y + 0.5, '#bc6c25', 8); g.cylinder((x0 + x1) / 2, y + 0.5, (z0 + z1) / 2, (x1 - x0) * 0.55, y + 0.9, '#40916c', 7, h - 0.9, '#52b788'); break;
    case 'rail': {
      // top bar plus posts along whichever side is longer
      const long = Math.max(x1 - x0, z1 - z0), alongW = (fz ? x1 - x0 : z1 - z0) >= long - 1e-6;
      sub(0, 1, 0, 1, h - 0.06, h, dark);
      const n = Math.max(2, Math.round(long / 0.5));
      for (let k = 0; k <= n; k++) { const t = k / n; if (alongW) sub(Math.max(0, t - 0.02), Math.min(1, t + 0.02), 0, 1, 0, h, dark); else sub(0, 1, Math.max(0, t - 0.02), Math.min(1, t + 0.02), 0, h, dark); }
      break;
    }
  }
}

/** The whole building: shell from solids, roof, windows, doors, furniture, ceiling lamps. */
export function buildBuildingMeshes(w: World, group: THREE.Group) {
  const solidsByBox = new Map<Box, Solid[]>();
  for (const o of w.solids) if (o.b) { let l = solidsByBox.get(o.b); if (!l) solidsByBox.set(o.b, (l = [])); l.push(o); }
  for (const poi of w.pois) {
    const g = new GeoBuilder(), gi = new GeoBuilder(), glass = new GeoBuilder();
    w.layouts.forEach((L, i) => {
      const b = w.boxes[i];
      if (b.poi !== poi.id) return;
      const p = paintFor(b, L);
      g.ao = { base: b.fy - 0.8, h: 3.2, k: 0.34 };
      if (L.type === 'solid') { addContainerOrSilo(g, b); return; }
      const solids = solidsByBox.get(b) ?? [];
      const storeys = L.floors.map((y, k) => ({ y, h: (k + 1 < L.floors.length ? L.floors[k + 1] : b.fy + L.access) - y }));
      for (const o of solids) {
        addSolidOutline(g, gi, o, p, L);
        if (o.k === SK.Wall && !o.inner && o.y0 <= b.fy + 0.01) addWindows(g, gi, glass, o, L, p, storeys);
        if (o.k === SK.Block) for (const face of [0, 1, 2, 3]) {
          const fake: Solid = { ...o, k: SK.Wall, face };
          const n = Math.floor((o.y1 - o.y0) / 3.4);
          addWindows(g, gi, glass, fake, L, p, Array.from({ length: n }, (_, k) => ({ y: o.y0 + k * 3.4, h: 3.4 })));
        }
      }
      addRoof(g, b, p);
      g.surf = SURF.plain;
      addDoors(g, gi, L, p);
      L.furniture.forEach((f, k) => addFurniture(gi, glass, f, p, (b.style >> 3) + k));
      // ceiling lamps in each room
      for (let k = 0; k < L.floors.length; k++) {
        const top = (k + 1 < L.floors.length ? L.floors[k + 1] - 0.22 : b.fy + L.access - 0.28);
        const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
        glass.box(cx - 0.25, top - 0.12, cz - 0.25, cx + 0.25, top - 0.02, cz + 0.25, '#fff2c4');
        gi.box(cx - 0.03, top - 0.02, cz - 0.03, cx + 0.03, top, cz + 0.03, '#333');
      }
    });
    if (g.vertexCount) {
      const m = new THREE.Mesh(g.build(), buildingMat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    if (gi.vertexCount) {
      const m = new THREE.Mesh(gi.build(), interiorMat);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m);
    }
    if (glass.vertexCount) group.add(new THREE.Mesh(glass.build(), glowMat));
  }
}

function addContainerOrSilo(g: GeoBuilder, b: Box) {
  const pick = <T,>(arr: T[], salt: number) => arr[(b.style >> salt) % arr.length];
  const { x0, x1, z0, z1, y0, fy, y1 } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  if (b.shape === 2) {
    const wall = pick(WALLS[b.kind], 0), r = (x1 - x0) / 2;
    g.surf = SURF.metal;
    g.cylinder(cx, y0, cz, r, y1, wall, 12, 1.6, shade(wall, 0.8));
    for (let k = 1; k < 4; k++) g.cylinder(cx, lerp(fy, y1, k / 4) - 0.12, cz, r + 0.06, lerp(fy, y1, k / 4) + 0.12, shade(wall, 0.7), 12);
    // a ladder up the side
    g.box(cx + r - 0.02, fy, cz - 0.3, cx + r + 0.08, y1, cz - 0.24, '#555'); g.box(cx + r - 0.02, fy, cz + 0.24, cx + r + 0.08, y1, cz + 0.3, '#555');
    for (let yy = fy + 0.3; yy < y1; yy += 0.4) g.box(cx + r, yy, cz - 0.27, cx + r + 0.06, yy + 0.04, cz + 0.27, '#666');
    g.surf = SURF.plain;
    return;
  }
  const col = pick(CONTAINER, 0);
  g.surf = SURF.metal;
  g.box(x0, y0, z0, x1, y1, z1, col);
  const longX = x1 - x0 > z1 - z0, ribs = 7;
  for (let k = 1; k < ribs; k++) {
    if (longX) { const x = lerp(x0, x1, k / ribs); g.box(x - 0.06, fy + 0.15, z0 - 0.04, x + 0.06, y1 - 0.15, z1 + 0.04, shade(col, 0.82)); }
    else { const z = lerp(z0, z1, k / ribs); g.box(x0 - 0.04, fy + 0.15, z - 0.06, x1 + 0.04, y1 - 0.15, z + 0.06, shade(col, 0.82)); }
  }
  g.surf = SURF.plain;
}
