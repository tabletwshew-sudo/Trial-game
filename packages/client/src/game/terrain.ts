import * as THREE from 'three';
import {
  BRIDGE_Y, ROOF_FLAT, ROOF_GABLE_X, SC_BUSH, SC_OAK, SC_PALM, SC_PINE, SC_ROCK, fbm, genScatter, hash2, lerp, roadEdgeDist, smooth, terrainAt,
  type Box, type HeightField, type Poi, type PoiKind, type World,
} from '@dropzone/shared';
import { softRamp } from '../lobby/toon';
import { GeoBuilder, mat4, mergeColored } from './geo';

export interface Quality { shadows: boolean; treeRange: number; bushes: boolean; pixelRatio: number }
export const QUALITY: Record<'low' | 'high', Quality> = {
  low: { shadows: false, treeRange: 380, bushes: false, pixelRatio: 1 },
  high: { shadows: true, treeRange: 950, bushes: true, pixelRatio: 2 },
};

const C = (hex: string) => new THREE.Color(hex);
const COL = {
  deep: C('#1d7fd0'), shallow: C('#d9c98f'), sand: C('#f3e2a6'), grassA: C('#63c24b'), grassB: C('#4aa83e'), grassC: C('#8fd45c'),
  high: C('#7fa456'), rock: C('#8f8779'), rockDark: C('#6f6a61'), snow: C('#f6faff'), dirt: C('#b89b68'),
  pave: C('#b8b3a6'), yard: C('#a69c8d'), field: C('#cfae5e'), fieldB: C('#9fbf4f'), quarry: C('#bca78a'), camp: C('#a98d5f'),
};
const POI_GROUND: Partial<Record<PoiKind, THREE.Color>> = {
  city: COL.pave, industrial: COL.yard, harbor: COL.pave, quarry: COL.quarry, camp: COL.camp, station: COL.rock, town: COL.pave,
};

/** Ground colour at a point. Shared by the terrain mesh and the map. */
export function groundColor(w: World, x: number, z: number, h: number, slope: number, out: THREE.Color) {
  if (h < -0.4) return out.copy(COL.shallow).lerp(COL.deep, smooth(-0.4, -5, h));
  if (h < 2.3) return out.copy(COL.sand).lerp(COL.shallow, smooth(0.3, -0.4, h));
  const n = fbm(x / 55, z / 55, w.seed + 81, 2), n2 = fbm(x / 240, z / 240, w.seed + 82, 2);
  out.copy(COL.grassA).lerp(COL.grassB, smooth(0.35, 0.65, n)).lerp(COL.grassC, smooth(0.55, 0.8, n2) * 0.7);
  out.lerp(COL.high, smooth(40, 75, h));
  out.lerp(COL.sand, smooth(3.4, 2.3, h));
  for (const p of w.pois) {
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r * 1.1) continue;
    const k = smooth(p.r * 1.05, p.r * 0.8, d);
    if (p.kind === 'farm') {
      const rows = Math.floor((x + z * 0.35) / 7) % 2 === 0;
      out.lerp(rows ? COL.field : COL.fieldB, k * 0.85);
    } else if (p.kind === 'resort') out.lerp(COL.sand, k * 0.8);
    else out.lerp(POI_GROUND[p.kind]!, k * (p.kind === 'town' || p.kind === 'camp' ? 0.55 : 0.85));
    break;
  }
  const rd = roadEdgeDist(w, x, z);
  if (rd < 3.5) out.lerp(COL.dirt, smooth(3.5, 0.5, rd) * 0.7);
  out.lerp(n > 0.5 ? COL.rock : COL.rockDark, smooth(0.6, 0.95, slope));
  out.lerp(COL.rock, smooth(84, 100, h));
  out.lerp(COL.snow, smooth(104, 116, h + (n - 0.5) * 14));
  return out;
}

const terrainMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });

function fieldChunks(w: World, f: HeightField, chunkCells: number, group: THREE.Group, colorsOut?: Float32Array) {
  const { nx, nz, cell, data } = f;
  // per-vertex normals + colours for the whole field
  const nor = new Float32Array(nx * nz * 3), col = colorsOut ?? new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  for (let iz = 0; iz < nz; iz++) for (let ix = 0; ix < nx; ix++) {
    const i = iz * nx + ix;
    const hl = data[iz * nx + Math.max(0, ix - 1)], hr = data[iz * nx + Math.min(nx - 1, ix + 1)];
    const hu = data[Math.max(0, iz - 1) * nx + ix], hd = data[Math.min(nz - 1, iz + 1) * nx + ix];
    const gx = (hr - hl) / (2 * cell), gz = (hd - hu) / (2 * cell);
    const len = Math.hypot(gx, 1, gz);
    nor[i * 3] = -gx / len; nor[i * 3 + 1] = 1 / len; nor[i * 3 + 2] = -gz / len;
    groundColor(w, f.ox + ix * cell, f.oz + iz * cell, data[i], Math.hypot(gx, gz), c);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  for (let cz = 0; cz < nz - 1; cz += chunkCells) for (let cx = 0; cx < nx - 1; cx += chunkCells) {
    const wv = Math.min(chunkCells, nx - 1 - cx) + 1, hv = Math.min(chunkCells, nz - 1 - cz) + 1;
    const pos = new Float32Array(wv * hv * 3), n = new Float32Array(wv * hv * 3), cl = new Float32Array(wv * hv * 3);
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < hv; j++) for (let i = 0; i < wv; i++) {
      const src = (cz + j) * nx + cx + i, dst = (j * wv + i) * 3;
      const y = data[src];
      pos[dst] = f.ox + (cx + i) * cell; pos[dst + 1] = y; pos[dst + 2] = f.oz + (cz + j) * cell;
      n.set(nor.subarray(src * 3, src * 3 + 3), dst); cl.set(col.subarray(src * 3, src * 3 + 3), dst);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxY < -8.9) continue; // open-ocean floor: nothing to see
    const idx = new Uint32Array((wv - 1) * (hv - 1) * 6);
    let k = 0;
    for (let j = 0; j < hv - 1; j++) for (let i = 0; i < wv - 1; i++) {
      const a = j * wv + i, b = a + 1, cc = a + wv, d = cc + 1;
      idx[k++] = a; idx[k++] = cc; idx[k++] = b; idx[k++] = b; idx[k++] = cc; idx[k++] = d; // same split as HeightField.sample
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('color', new THREE.BufferAttribute(cl, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, terrainMat);
    m.receiveShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- water
export function makeWater(fogColor: THREE.Color, fogNear: number, fogFar: number) {
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, fogColor: { value: fogColor }, fogNear: { value: fogNear }, fogFar: { value: fogFar }, sunDir: { value: new THREE.Vector3(0.5, 0.75, 0.35).normalize() } },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDist;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; vec4 mv = viewMatrix * wp; vDist = -mv.z; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */ `
      uniform float time, fogNear, fogFar; uniform vec3 fogColor, sunDir;
      varying vec3 vWorld; varying float vDist;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec2 p = vWorld.xz;
        float n = noise(p * 0.08 + vec2(time * 0.35, time * 0.22)) * 0.6 + noise(p * 0.21 - vec2(time * 0.5, -time * 0.3)) * 0.4;
        float big = noise(p * 0.012 + vec2(time * 0.05, 0.0));
        // toon bands up close, fading to broad calm patches far away (no shimmer from the air)
        float nearK = smoothstep(420.0, 60.0, vDist);
        float band = (smoothstep(0.46, 0.5, n) * 0.5 + smoothstep(0.66, 0.69, n) * 0.5) * nearK + smoothstep(0.35, 0.75, big) * 0.45 * (1.0 - nearK);
        vec3 col = mix(vec3(0.07, 0.50, 0.86), vec3(0.20, 0.70, 0.95), band);
        // small glints near the viewer
        float sp = smoothstep(0.9, 0.93, noise(p * 2.6 + time * vec2(1.3, 0.8))) * smoothstep(70.0, 8.0, vDist);
        col += vec3(sp) * 0.3;
        float fog = smoothstep(fogNear, fogFar, vDist);
        col = mix(col, fogColor, fog);
        // see the sandy bottom only when you are close to it
        gl_FragColor = vec4(col, mix(0.78, 1.0, smoothstep(30.0, 260.0, vDist)));
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000, 1, 1).rotateX(-Math.PI / 2), mat);
  mesh.renderOrder = 2;
  return { mesh, mat };
}

// ---------------------------------------------------------------- roads
function roadTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#5b5c66'; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 260; i++) { g.fillStyle = Math.random() < 0.5 ? '#63646e' : '#54555e'; g.fillRect(Math.random() * 64, Math.random() * 128, 2, 2); }
  g.fillStyle = '#e9e6d8'; g.fillRect(3, 0, 2, 128); g.fillRect(59, 0, 2, 128);
  g.fillStyle = '#ffd23f'; g.fillRect(31, 10, 2, 50); g.fillRect(31, 74, 2, 50);
  const t = new THREE.CanvasTexture(cv);
  t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function buildRoads(w: World, group: THREE.Group) {
  const mat = new THREE.MeshToonMaterial({ map: roadTexture(), gradientMap: softRamp, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const deck = new GeoBuilder();
  const deckY = (x: number, z: number) => Math.max(terrainAt(w, x, z), BRIDGE_Y) + 0.1;
  for (const r of w.roads) {
    const n = r.pts.length / 2;
    const pos = new Float32Array(n * 9), uv = new Float32Array(n * 6), nor = new Float32Array(n * 9);
    let dist = 0;
    for (let i = 0; i < n; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
      const j = Math.min(n - 1, i + 1), k = Math.max(0, i - 1);
      let tx = r.pts[j * 2] - r.pts[k * 2], tz = r.pts[j * 2 + 1] - r.pts[k * 2 + 1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      if (i > 0) dist += Math.hypot(x - r.pts[k * 2], z - r.pts[k * 2 + 1]);
      const hw = r.width / 2;
      const pts: [number, number][] = [[x - tz * hw, z + tx * hw], [x, z], [x + tz * hw, z - tx * hw]];
      // keep the cross-section level so the road does not tilt sideways on slopes
      const y = Math.max(deckY(pts[0][0], pts[0][1]), deckY(x, z), deckY(pts[2][0], pts[2][1]));
      pts.forEach(([px, pz], s) => {
        pos.set([px, y, pz], i * 9 + s * 3); nor.set([0, 1, 0], i * 9 + s * 3);
        uv.set([s / 2, dist / 9], i * 6 + s * 2);
      });
      // bridge: side walls + piers where the deck is clear of the ground
      if (terrainAt(w, x, z) < BRIDGE_Y - 0.6 && i < n - 1) {
        const nx2 = r.pts[j * 2], nz2 = r.pts[j * 2 + 1];
        for (const side of [-1, 1]) {
          const ax = x + tz * hw * side, az = z - tx * hw * side, bx = nx2 + tz * hw * side, bz = nz2 - tx * hw * side;
          deck.quad([ax, y - 0.9, az], [bx, y - 0.9, bz], [bx, y + 0.85, bz], [ax, y + 0.85, az], '#c9c2b2', [tz * side, 0, -tx * side]);
          deck.quad([ax, y - 0.9, az], [bx, y - 0.9, bz], [bx, y + 0.85, bz], [ax, y + 0.85, az], '#a8a294', [-tz * side, 0, tx * side]);
        }
        deck.quad([x - tz * hw, y - 0.9, z + tx * hw], [x + tz * hw, y - 0.9, z - tx * hw], [nx2 + tz * hw, y - 0.9, nz2 - tx * hw], [nx2 - tz * hw, y - 0.9, nz2 + tx * hw], '#8f897c', [0, -1, 0]);
        if (i % 4 === 0) deck.box(x - 1, -4, z - 1, x + 1, y - 0.9, z + 1, '#9c9689');
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) for (let s = 0; s < 2; s++) {
      const a = i * 3 + s, b = a + 1, c = a + 3, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  }
  if (deck.vertexCount) {
    const m = new THREE.Mesh(deck.build(), buildingMat);
    m.castShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- buildings
const buildingMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide });

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
  city: ['#4a4e69', '#5c5f66', '#3d405b'],
  town: ['#9b2226', '#bb3e03', '#3d5a80', '#6d597a', '#588157', '#7f4f24'],
  industrial: ['#52525b', '#6b705c', '#7a4a3a'],
  farm: ['#5c4033', '#6f4e37', '#4a4a4a'],
  camp: ['#386641', '#52796f', '#6a4c3b'],
  harbor: ['#3d405b', '#9b2226', '#52525b'],
  station: ['#e63946', '#577590'],
  resort: ['#00b4d8', '#ef476f', '#f4a261'],
  quarry: ['#5c5f66'],
};
const CONTAINER = ['#e63946', '#2a9d8f', '#e9c46a', '#457b9d', '#f4a261', '#6a994e', '#9d4edd'];
const shade = (hex: string, k: number) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();

function addBuilding(g: GeoBuilder, b: Box, seed: number) {
  const pick = <T,>(arr: T[], salt: number) => arr[(b.style >> salt) % arr.length];
  const wall = pick(WALLS[b.kind], 0), roofCol = pick(ROOFS[b.kind], 3);
  const { x0, x1, z0, z1, y0, fy, y1 } = b;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;

  if (b.shape === 2) { // silo / tank
    const r = (x1 - x0) / 2;
    g.cylinder(cx, y0, cz, r, y1, wall, 12, 1.6, shade(wall, 0.8));
    for (let k = 1; k < 4; k++) g.cylinder(cx, lerp(fy, y1, k / 4) - 0.12, cz, r + 0.06, lerp(fy, y1, k / 4) + 0.12, shade(wall, 0.7), 12);
    return;
  }
  if (b.shape === 1) { // shipping container
    const col = pick(CONTAINER, 0);
    g.box(x0, y0, z0, x1, y1, z1, col);
    const longX = x1 - x0 > z1 - z0;
    const ribs = 7;
    for (let k = 1; k < ribs; k++) {
      if (longX) { const x = lerp(x0, x1, k / ribs); g.box(x - 0.06, fy + 0.15, z0 - 0.04, x + 0.06, y1 - 0.15, z1 + 0.04, shade(col, 0.82)); }
      else { const z = lerp(z0, z1, k / ribs); g.box(x0 - 0.04, fy + 0.15, z - 0.06, x1 + 0.04, y1 - 0.15, z + 0.06, shade(col, 0.82)); }
    }
    return;
  }

  // body + foundation trim
  g.box(x0, y0, z0, x1, y1, z1, wall);
  g.box(x0 - 0.12, y0, z0 - 0.12, x1 + 0.12, fy + 0.45, z1 + 0.12, shade(wall, 0.62));

  // roof
  if (b.roof === ROOF_FLAT) {
    g.box(x0 - 0.25, y1 - 0.02, z0 - 0.25, x1 + 0.25, y1 + 0.02, z1 + 0.25, shade(roofCol, 1.05));
    const pw = 0.3, ph = b.kind === 'city' ? 0.9 : 0.45; // parapet
    g.box(x0 - 0.25, y1, z0 - 0.25, x1 + 0.25, y1 + ph, z0 - 0.25 + pw, roofCol);
    g.box(x0 - 0.25, y1, z1 + 0.25 - pw, x1 + 0.25, y1 + ph, z1 + 0.25, roofCol);
    g.box(x0 - 0.25, y1, z0, x0 - 0.25 + pw, y1 + ph, z1, roofCol);
    g.box(x1 + 0.25 - pw, y1, z0, x1 + 0.25, y1 + ph, z1, roofCol);
    if (x1 - x0 > 7 && z1 - z0 > 7) {
      const r = (k: number) => hash2(b.style, k, seed);
      // rooftop clutter: AC unit, access hut, water tank or sign
      g.box(cx - 3 + r(1) * 2, y1, cz - 2.5 + r(2) * 2, cx - 1 + r(1) * 2, y1 + 1.1, cz - 1 + r(2) * 2, '#c8ccd2');
      if (r(3) < 0.6) g.box(cx + 0.5, y1, cz + 0.5, cx + 3, y1 + 2.4, cz + 3, shade(wall, 0.85));
      if (b.kind === 'city' && r(4) < 0.5) { g.cylinder(cx - 2, y1 + 1.2, cz + 2.2, 1.3, y1 + 3.6, '#b08968', 8, 0.9, '#7f5539'); for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.box(cx - 2 + ox * 0.9 - 0.08, y1, cz + 2.2 + oz * 0.9 - 0.08, cx - 2 + ox * 0.9 + 0.08, y1 + 1.2, cz + 2.2 + oz * 0.9 + 0.08, '#555'); }
      if (b.kind === 'city' && y1 - fy > 30) { g.box(cx - 0.12, y1, cz - 0.12, cx + 0.12, y1 + 9, cz + 0.12, '#d8d8d8'); g.box(cx - 0.3, y1 + 8.6, cz - 0.3, cx + 0.3, y1 + 9.2, cz + 0.3, '#ff3b3b'); }
    }
  } else {
    const o = 0.55, alongX = b.roof === ROOF_GABLE_X;
    const half = alongX ? (z1 - z0) / 2 : (x1 - x0) / 2, slope = b.roofH / half, ye = y1 - o * slope, yr = y1 + b.roofH;
    const P = (a: number, y: number, c: number): [number, number, number] => (alongX ? [a, y, c] : [c, y, a]);
    const a0 = alongX ? x0 : z0, a1 = alongX ? x1 : z1, c0 = alongX ? z0 : x0, c1 = alongX ? z1 : x1, cc = (c0 + c1) / 2;
    g.quad(P(a0 - o, ye, c1 + o), P(a1 + o, ye, c1 + o), P(a1 + o, yr, cc), P(a0 - o, yr, cc), roofCol, [0, 1, 0]);
    g.quad(P(a0 - o, ye, c0 - o), P(a1 + o, ye, c0 - o), P(a1 + o, yr, cc), P(a0 - o, yr, cc), shade(roofCol, 0.92), [0, 1, 0]);
    g.tri(P(a0, y1, c0), P(a0, y1, c1), P(a0, yr, cc), wall, alongX ? [-1, 0, 0] : [0, 0, -1]);
    g.tri(P(a1, y1, c0), P(a1, y1, c1), P(a1, yr, cc), wall, alongX ? [1, 0, 0] : [0, 0, 1]);
    // ridge cap + chimney
    g.box(...(alongX ? [x0 - o, yr - 0.08, cz - 0.18, x1 + o, yr + 0.14, cz + 0.18] : [cx - 0.18, yr - 0.08, z0 - o, cx + 0.18, yr + 0.14, z1 + o]) as [number, number, number, number, number, number], shade(roofCol, 0.75));
    if ((b.kind === 'town' || b.kind === 'camp' || b.kind === 'resort') && (b.style & 1)) {
      const [px, , pz] = P(lerp(a0, a1, 0.72), 0, cc + half * 0.45);
      g.box(px - 0.4, y1, pz - 0.4, px + 0.4, yr + 0.7, pz + 0.4, '#8d6e63');
      g.box(px - 0.5, yr + 0.7, pz - 0.5, px + 0.5, yr + 0.9, pz + 0.5, '#5d4037');
    }
  }

  // windows + door on each wall
  const storey = b.kind === 'city' ? 3.4 : 3.1;
  const floors = Math.max(1, Math.floor((y1 - fy) / storey));
  const doorWall = (b.style >> 6) % 4;
  const walls: [number, number, number, number, number][] = [ // origin x, z, outward normal x, z, length
    [x0, z1, 0, 1, x1 - x0], [x1, z1, 1, 0, z1 - z0], [x1, z0, 0, -1, x1 - x0], [x0, z0, -1, 0, z1 - z0],
  ];
  const big = b.kind === 'industrial' || b.kind === 'harbor' || b.kind === 'farm' && y1 - fy > 5;
  walls.forEach(([ox, oz, nx, nz, len], wi) => {
    const ux = nz, uz = -nx;
    const at = (s: number, y: number, out: number): [number, number, number] => [ox + ux * s + nx * out, y, oz + uz * s + nz * out];
    const panel = (s0: number, s1: number, ya: number, yb: number, color: string, out = 0.05) =>
      g.quad(at(s0, ya, out), at(s1, ya, out), at(s1, yb, out), at(s0, yb, out), color, [nx, 0, nz]);
    const cols = Math.max(1, Math.floor(len / (big ? 5 : 3.2)));
    const cw = len / cols;
    for (let f = 0; f < floors; f++) {
      const base = fy + f * storey;
      for (let c = 0; c < cols; c++) {
        const mid = (c + 0.5) * cw;
        if (f === 0 && wi === doorWall && c === Math.floor(cols / 2)) {
          if (big) { panel(mid - 2, mid + 2, fy, fy + 3.6, '#5a6470'); for (let k = 1; k < 6; k++) panel(mid - 2, mid + 2, fy + k * 0.6 - 0.03, fy + k * 0.6 + 0.03, '#454d57', 0.07); }
          else { panel(mid - 0.75, mid + 0.75, fy, fy + 2.35, shade(wall, 0.55)); panel(mid - 0.6, mid + 0.6, fy, fy + 2.2, pick(['#7b3f00', '#2d6a4f', '#1d3557', '#9d0208', '#f1faee'], 9), 0.08); panel(mid + 0.32, mid + 0.44, fy + 1.0, fy + 1.12, '#ffd23f', 0.1); }
          continue;
        }
        if (big && f === 0) { if (c % 2 === 0) panel(mid - 1.1, mid + 1.1, base + 4.2, base + 5.4, '#9fd3e6'); continue; }
        const r = hash2(b.style + wi * 7, f * 31 + c, seed);
        if (b.kind !== 'city' && r < 0.12) continue; // a few blank spots
        const ww = Math.min(cw * 0.5, 1.5), wy0 = base + 1.05, wy1 = base + 2.45;
        panel(mid - ww / 2 - 0.1, mid + ww / 2 + 0.1, wy0 - 0.1, wy1 + 0.1, shade(wall, 0.7));
        panel(mid - ww / 2, mid + ww / 2, wy0, wy1, r > 0.86 ? '#ffe9a3' : r > 0.45 ? '#8fd0ea' : '#6fb7d6', 0.08);
        if (b.kind === 'town' || b.kind === 'camp' || b.kind === 'resort') panel(mid - ww / 2 - 0.2, mid + ww / 2 + 0.2, wy0 - 0.22, wy0 - 0.08, '#f5f1e8', 0.14);
      }
    }
    if (b.kind === 'city' && floors > 3) panel(0, len, fy + 3.25, fy + 3.5, shade(wall, 0.6), 0.1); // storefront band
  });
}

function buildBuildings(w: World, group: THREE.Group) {
  for (const p of w.pois) {
    const g = new GeoBuilder();
    for (const b of w.boxes) if (b.poi === p.id) addBuilding(g, b, w.seed);
    if (!g.vertexCount) continue;
    const m = new THREE.Mesh(g.build(), buildingMat);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- trees, rocks, bushes
function scatterGeometries() {
  const ico = (r: number) => new THREE.IcosahedronGeometry(r, 0);
  const oak = mergeColored([
    { geo: new THREE.CylinderGeometry(0.32, 0.5, 3.4, 6), color: '#7a4b2a', matrix: mat4(0, 1.7, 0) },
    { geo: ico(2.3), color: '#49b04a', matrix: mat4(0, 4.7, 0, 0.3, 0.5, 0, 1, 0.85, 1) },
    { geo: ico(1.6), color: '#5cc45a', matrix: mat4(1.3, 4.0, 0.5, 1, 2, 0) },
    { geo: ico(1.5), color: '#3d9a42', matrix: mat4(-1.2, 4.2, -0.6, 2, 1, 0) },
    { geo: ico(1.3), color: '#66cc5e', matrix: mat4(0.2, 6.1, 0.1, 1, 1, 1) },
  ]);
  const pine = mergeColored([
    { geo: new THREE.CylinderGeometry(0.25, 0.42, 3, 6), color: '#6b4226', matrix: mat4(0, 1.5, 0) },
    { geo: new THREE.ConeGeometry(2.4, 4, 7), color: '#2d7d46', matrix: mat4(0, 4, 0) },
    { geo: new THREE.ConeGeometry(1.9, 3.6, 7), color: '#358f50', matrix: mat4(0, 6.2, 0, 0, 0.4, 0) },
    { geo: new THREE.ConeGeometry(1.3, 3.2, 7), color: '#3fa35c', matrix: mat4(0, 8.3, 0, 0, 0.8, 0) },
  ]);
  const palmPieces = [
    { geo: new THREE.CylinderGeometry(0.22, 0.3, 2.4, 6), color: '#a9825a', matrix: mat4(0.15, 1.2, 0, 0, 0, -0.12) },
    { geo: new THREE.CylinderGeometry(0.18, 0.22, 2.4, 6), color: '#b08c63', matrix: mat4(0.55, 3.4, 0, 0, 0, -0.24) },
    { geo: new THREE.CylinderGeometry(0.15, 0.18, 2.2, 6), color: '#a9825a', matrix: mat4(1.1, 5.4, 0, 0, 0, -0.34) },
    { geo: new THREE.SphereGeometry(0.28, 6, 5), color: '#6b4f2a', matrix: mat4(1.45, 6.35, 0.2) },
    { geo: new THREE.SphereGeometry(0.28, 6, 5), color: '#6b4f2a', matrix: mat4(1.55, 6.3, -0.25) },
  ];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const frond = new THREE.ConeGeometry(0.55, 3.4, 4).scale(1, 1, 0.18);
    palmPieces.push({ geo: frond, color: i % 2 ? '#3fae49' : '#56c45a', matrix: new THREE.Matrix4().makeTranslation(1.5, 6.5, 0).multiply(new THREE.Matrix4().makeRotationY(a)).multiply(new THREE.Matrix4().makeRotationZ(-1.95)).multiply(new THREE.Matrix4().makeTranslation(0, 1.6, 0)) });
  }
  const palm = mergeColored(palmPieces);
  const rock = mergeColored([
    { geo: ico(1), color: '#9a948a', matrix: mat4(0, 0.45, 0, 0.4, 0.2, 0.1, 1.2, 0.75, 1) },
    { geo: ico(0.6), color: '#857f76', matrix: mat4(0.9, 0.25, 0.3, 1, 0.5, 0.3, 1, 0.7, 1.1) },
  ]);
  const bush = mergeColored([
    { geo: ico(0.9), color: '#4fb04a', matrix: mat4(0, 0.55, 0, 0.5, 0, 0.2, 1.15, 0.8, 1) },
    { geo: ico(0.65), color: '#63c75b', matrix: mat4(0.7, 0.45, 0.25, 1, 1, 0) },
    { geo: ico(0.55), color: '#3f9a41', matrix: mat4(-0.6, 0.4, -0.2, 0, 2, 1) },
  ]);
  return [oak, pine, palm, rock, bush];
}

interface ScatterChunk { mesh: THREE.InstancedMesh; cx: number; cz: number; radius: number }

function buildScatter(w: World, group: THREE.Group, q: Quality): ScatterChunk[] {
  const data = genScatter(w), geos = scatterGeometries();
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
  const REGION = 300, chunks: ScatterChunk[] = [];
  const m = new THREE.Matrix4(), pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  data.forEach((arr, type) => {
    if (type === SC_BUSH && !q.bushes) return;
    const buckets = new Map<string, number[]>();
    for (let i = 0; i < arr.length; i += 6) {
      const key = `${Math.floor(arr[i] / REGION)},${Math.floor(arr[i + 2] / REGION)}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = []));
      b.push(i);
    }
    for (const [key, list] of buckets) {
      const mesh = new THREE.InstancedMesh(geos[type], mat, list.length);
      list.forEach((i, k) => {
        const s = arr[i + 3], rot = arr[i + 4], tint = arr[i + 5];
        pos.set(arr[i], arr[i + 1], arr[i + 2]);
        quat.setFromAxisAngle(up, rot * Math.PI * 2);
        if (type === SC_ROCK) scl.set(s * (0.8 + tint * 0.6), s * (0.7 + rot * 0.6), s); else scl.set(s, s * (0.9 + tint * 0.25), s);
        mesh.setMatrixAt(k, m.compose(pos, quat, scl));
        const v = 0.86 + (tint % 1) * 0.24;
        mesh.setColorAt(k, type === SC_ROCK ? col.setScalar(v) : col.setRGB(v * (0.94 + rot * 0.12), v, v * (0.9 + rot * 0.15)));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.castShadow = q.shadows && type !== SC_BUSH;
      mesh.receiveShadow = false;
      group.add(mesh);
      const [kx, kz] = key.split(',').map(Number);
      chunks.push({ mesh, cx: (kx + 0.5) * REGION, cz: (kz + 0.5) * REGION, radius: REGION * 0.75 });
    }
  });
  return chunks;
}

// ---------------------------------------------------------------- entry
export interface IslandView {
  group: THREE.Group;
  water: ReturnType<typeof makeWater>;
  /** Per-vertex colours of the main field (re-used to paint the map). */
  mainColors: Float32Array;
  update(dt: number, cam: THREE.Vector3): void;
}

export function buildIsland(w: World, q: Quality, fogColor: THREE.Color, fogNear: number, fogFar: number): IslandView {
  const group = new THREE.Group();
  const mainColors = new Float32Array(w.main.nx * w.main.nz * 3);
  fieldChunks(w, w.main, 60, group, mainColors);
  fieldChunks(w, w.spawn, 80, group);
  buildRoads(w, group);
  buildBuildings(w, group);
  const chunks = buildScatter(w, group, q);
  const water = makeWater(fogColor, fogNear, fogFar);
  group.add(water.mesh);
  let t = 0;
  return {
    group, water, mainColors,
    update(dt, cam) {
      t += dt;
      water.mat.uniforms.time.value = t;
      for (const c of chunks) c.mesh.visible = Math.hypot(cam.x - c.cx, cam.z - c.cz) < q.treeRange + c.radius;
    },
  };
}
