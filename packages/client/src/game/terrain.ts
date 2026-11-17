import * as THREE from 'three';
import { waveTexture } from './noisetex';
import { withTerrainDetail } from './surface';
import {
  BRIDGE_Y, ROOF_FLAT, ROOF_GABLE_X, SC_BUSH, SC_OAK, SC_PALM, SC_PINE, SC_ROCK, fbm, genScatter, hash2, lerp, roadEdgeDist, smooth, terrainAt,
  type Box, type HeightField, type Poi, type PoiKind, type World,
} from '@dropzone/shared';
import { softRamp } from '../lobby/toon';
import { FOG_GLSL } from './atmosphere';
import { GeoBuilder, mat4, mergeColored } from './geo';
import { buildBuildingMeshes, buildingMat, collapseRanges } from './buildings';
import { Grass, addWind, wind } from './grass';
import { buildProps } from './props3d';

export interface Quality {
  shadows: boolean; shadowSize: number; treeRange: number; bushes: boolean; pixelRatio: number; grass: number;
  /** Post pipeline: bloom and FXAA, or `direct` (no post at all, the canvas's own anti-aliasing). */
  bloom: boolean; fxaa: boolean; direct: boolean;
  /** Softer (more expensive) shadow filtering. */
  softShadows: boolean;
  /** Birds, butterflies, drifting pollen. */
  life: boolean;
}
export const QUALITY: Record<'low' | 'medium' | 'high', Quality> = {
  low: { shadows: false, shadowSize: 1024, treeRange: 380, bushes: false, pixelRatio: 1, grass: 2500, bloom: false, fxaa: false, direct: true, softShadows: false, life: false },
  medium: { shadows: true, shadowSize: 1024, treeRange: 600, bushes: true, pixelRatio: 1.1, grass: 6000, bloom: true, fxaa: true, direct: false, softShadows: false, life: true },
  high: { shadows: true, shadowSize: 2048, treeRange: 900, bushes: true, pixelRatio: 1.5, grass: 10000, bloom: true, fxaa: true, direct: false, softShadows: true, life: true },
};

const C = (hex: string) => new THREE.Color(hex);
const COL = {
  deep: C('#1d7fd0'), shallow: C('#d9c98f'), sand: C('#eedfaa'), grassA: C('#5cb646'), grassB: C('#3f9a3b'), grassC: C('#93c95a'), dry: C('#a9b25c'), lush: C('#2f8a3a'),
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
  // broad meadows: drier yellow-green slopes and deep green hollows
  const n3 = fbm(x / 420 + 7.3, z / 420 - 2.1, w.seed + 83, 3);
  out.lerp(COL.dry, smooth(0.56, 0.74, n3) * 0.45).lerp(COL.lush, smooth(0.42, 0.26, n3) * 0.4);
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

const terrainMat = withTerrainDetail(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp }));
/** How much of the ground at a point is paved (squares, yards, platforms): drawn as slabs. */
const PAVED: Partial<Record<PoiKind, number>> = { city: 1, industrial: 1, harbor: 1, station: 1, town: 0.75 };
function pavedAt(w: World, x: number, z: number, slope: number) {
  for (const p of w.pois) {
    const amt = PAVED[p.kind];
    if (!amt) continue;
    const d = Math.hypot(x - p.x, z - p.z);
    if (d > p.r * 1.05) continue;
    return smooth(p.r * 1.0, p.r * 0.75, d) * amt * smooth(0.35, 0.12, slope);
  }
  return 0;
}

function fieldChunks(w: World, f: HeightField, chunkCells: number, group: THREE.Group, colorsOut?: Float32Array) {
  const { nx, nz, cell, data } = f;
  // per-vertex normals + colours for the whole field
  const nor = new Float32Array(nx * nz * 3), col = colorsOut ?? new Float32Array(nx * nz * 3), pave = new Float32Array(nx * nz);
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
    if (data[i] > 2.4) pave[i] = pavedAt(w, f.ox + ix * cell, f.oz + iz * cell, Math.hypot(gx, gz));
  }
  for (let cz = 0; cz < nz - 1; cz += chunkCells) for (let cx = 0; cx < nx - 1; cx += chunkCells) {
    const wv = Math.min(chunkCells, nx - 1 - cx) + 1, hv = Math.min(chunkCells, nz - 1 - cz) + 1;
    const pos = new Float32Array(wv * hv * 3), n = new Float32Array(wv * hv * 3), cl = new Float32Array(wv * hv * 3), pv = new Float32Array(wv * hv);
    let minY = Infinity, maxY = -Infinity;
    for (let j = 0; j < hv; j++) for (let i = 0; i < wv; i++) {
      const src = (cz + j) * nx + cx + i, dst = (j * wv + i) * 3;
      const y = data[src];
      pos[dst] = f.ox + (cx + i) * cell; pos[dst + 1] = y; pos[dst + 2] = f.oz + (cz + j) * cell;
      n.set(nor.subarray(src * 3, src * 3 + 3), dst); cl.set(col.subarray(src * 3, src * 3 + 3), dst);
      pv[j * wv + i] = pave[src];
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
    g.setAttribute('surf', new THREE.BufferAttribute(pv, 1)); // paved amount (surface.ts)
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, terrainMat);
    m.receiveShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- water
/** Depth below sea level baked into a small texture, so the water shader knows where the shallows are. */
function depthTexture(f: HeightField) {
  const data = new Uint8Array(f.nx * f.nz);
  for (let i = 0; i < data.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, (-f.data[i] + 2) / 16)) * 255);
  const t = new THREE.DataTexture(data, f.nx, f.nz, THREE.RedFormat, THREE.UnsignedByteType);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

export function makeWater(w: World) {
  const rect = (f: HeightField) => new THREE.Vector4(f.ox, f.oz, 1 / (f.maxX - f.ox), 1 / (f.maxZ - f.oz));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      time: { value: 0 }, waveTex: { value: waveTexture() },
      depthMain: { value: depthTexture(w.main) }, mainRect: { value: rect(w.main) },
      depthSpawn: { value: depthTexture(w.spawn) }, spawnRect: { value: rect(w.spawn) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main(){ vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform float time; uniform sampler2D depthMain, depthSpawn, waveTex; uniform vec4 mainRect, spawnRect;
      varying vec3 vWorld;
      ${FOG_GLSL}
      float depthIn(sampler2D t, vec4 r, vec2 p, inout bool hit){
        vec2 uv = (p - r.xy) * r.zw;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 40.0;
        hit = true;
        return texture2D(t, uv).r * 16.0 - 2.0;
      }
      float depthAt(vec2 p){
        bool hit = false;
        float d = depthIn(depthMain, mainRect, p, hit);
        if (hit) return d;
        return depthIn(depthSpawn, spawnRect, p, hit);
      }
      void main(){
        vec2 p = vWorld.xz;
        float dist = distance(cameraPosition, vWorld);
        float d = depthAt(p);
        // colour by depth: clear turquoise shallows, then blue, then deep ocean
        vec3 shallow = vec3(0.06, 0.62, 0.66), midC = vec3(0.012, 0.30, 0.62), deep = vec3(0.004, 0.09, 0.30);
        vec3 col = mix(shallow, midC, smoothstep(0.4, 4.0, d));
        // (the depth map tops out at 14 m, so reach full ocean blue before that: no seam at its edge)
        col = mix(col, deep, smoothstep(4.0, 12.5, d));
        // ripples: a normal from the wave height, calmer far away (no shimmer from the air)
        float near = smoothstep(500.0, 40.0, dist);
        // two layers of baked ripples drifting in different directions, plus a fine third up close
        vec4 ta = texture2D(waveTex, p * 0.021 + vec2(time * 0.011, time * 0.007));
        vec4 tb = texture2D(waveTex, p * 0.053 + vec2(-time * 0.017, time * 0.013));
        vec2 slope = (ta.rg - 0.5) * 1.1 + (tb.rg - 0.5) * 0.8;
        slope += (texture2D(waveTex, p * 0.17 + vec2(time * 0.03, -time * 0.024)).rg - 0.5) * 0.6 * smoothstep(90.0, 15.0, dist);
        vec3 N = normalize(vec3(slope.x * near * 0.9, 1.0, slope.y * near * 0.9));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 R = reflect(-V, N);
        vec3 sky = mix(DZ_HAZE, vec3(0.10, 0.32, 0.80), clamp(R.y * 1.6, 0.0, 1.0));
        col = mix(col, sky, clamp(fres * 0.75 + 0.06, 0.0, 1.0));
        // sun glints (bright enough to bloom into sparkles)
        float spec = pow(max(dot(reflect(-DZ_SUN, N), V), 0.0), 260.0);
        col += vec3(1.0, 0.94, 0.82) * spec * (3.0 + 9.0 * near);
        // shore foam: a line at the water's edge and bands rolling in
        float n1 = ta.b, n2 = tb.a;
        float edge = 1.0 - smoothstep(0.0, 0.35 + n1 * 0.3, d);
        float bands = smoothstep(0.72, 0.95, sin(d * 3.2 - time * 1.4 + n1 * 4.0)) * (1.0 - smoothstep(0.2, 2.4, d)) * smoothstep(0.35, 0.7, n2);
        float foam = clamp(max(edge, bands), 0.0, 1.0) * near;
        col = mix(col, vec3(1.05, 1.08, 1.08), foam * 0.9);
        // see the sand through the shallows when you are close
        float alpha = mix(0.5, 0.97, smoothstep(0.0, 3.5, d));
        alpha = max(alpha, smoothstep(60.0, 380.0, dist));
        alpha = max(alpha, foam);
        gl_FragColor = vec4(dzFog(col, vWorld), alpha);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
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

// ---------------------------------------------------------------- trees, rocks, bushes
/**
 * Darken the underside and brighten the top of foliage/rocks (vertex colours), which reads as
 * light filtering through a canopy. Only vertices above `from` are touched (not trunks).
 */
function shadeByHeight(g: THREE.BufferGeometry, from: number, y0: number, y1: number, lo: number, hi: number, topTint?: THREE.Color) {
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < from) continue;
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0))), k = lo + (hi - lo) * t * t * (3 - 2 * t);
    let r = col.getX(i) * k, gg = col.getY(i) * k, bb = col.getZ(i) * k;
    if (topTint && t > 0.7) { const m = (t - 0.7) / 0.3 * 0.5; r += (topTint.r - r) * m; gg += (topTint.g - gg) * m; bb += (topTint.b - bb) * m; }
    col.setXYZ(i, r, gg, bb);
  }
  col.needsUpdate = true;
  return g;
}

/** Give every triangle of a non-indexed geometry (above `from`) its own slight shade: a leafy, faceted look for free. */
function faceVary(g: THREE.BufferGeometry, from: number, amount: number, seed: number) {
  const pos = g.getAttribute('position'), col = g.getAttribute('color');
  for (let t = 0; t < pos.count; t += 3) {
    if (pos.getY(t) < from && pos.getY(t + 1) < from && pos.getY(t + 2) < from) continue;
    const k = 1 + (hash2(t, seed, 91) - 0.5) * 2 * amount;
    for (let v = t; v < t + 3; v++) col.setXYZ(v, col.getX(v) * k, col.getY(v) * k, col.getZ(v) * k);
  }
  col.needsUpdate = true;
  return g;
}

/**
 * Foliage normals bent outward from the middle of the crown, so leaves light as one soft,
 * rounded mass (bright on top and toward the sun, cool underneath) instead of hard facets.
 * `centre` gives the point to bend away from; only green vertices are touched (not trunks).
 */
function roundFoliage(g: THREE.BufferGeometry, centre: (y: number) => [number, number, number], blend = 0.75) {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), col = g.getAttribute('color');
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    if (col.getY(i) < col.getX(i) * 1.15) continue;
    const [cx, cy, cz] = centre(pos.getY(i));
    v.set(pos.getX(i) - cx, pos.getY(i) - cy, pos.getZ(i) - cz).normalize();
    n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).lerp(v, blend).normalize();
    nor.setXYZ(i, n.x, n.y, n.z);
  }
  nor.needsUpdate = true;
  return g;
}

/** Near and far versions of each scatter type: [oak, pine, palm, rock, bush]. */
function scatterGeometries() {
  const ico = (r: number, d = 0) => new THREE.IcosahedronGeometry(r, d);
  // oak: a trunk and a lumpy crown of six faceted lobes (~150 triangles)
  const oakCrown: [number, number, number, number, string][] = [
    [0, 4.9, 0, 2.35, '#4aae4a'], [1.45, 4.2, 0.5, 1.65, '#55bd55'], [-1.35, 4.3, -0.6, 1.6, '#3f9d43'],
    [0.4, 4.1, -1.45, 1.5, '#4cb34c'], [-0.5, 4.0, 1.35, 1.45, '#58c058'], [0.3, 6.2, 0.2, 1.55, '#62c95c'],
  ];
  const oak = faceVary(shadeByHeight(mergeColored([
    { geo: new THREE.CylinderGeometry(0.3, 0.5, 3.6, 7, 1, true), color: '#74472a', matrix: mat4(0, 1.8, 0) },
    ...oakCrown.map(([x, y, z, r, c], i) => ({ geo: ico(r), color: c, matrix: mat4(x, y, z, i * 0.7, i * 1.3, 0, 1, 0.86, 1) })),
  ]), 2.8, 2.8, 7.4, 0.55, 1.18, new THREE.Color('#9be06a')), 2.8, 0.12, 3);
  roundFoliage(oak, () => [0, 4.4, 0]);
  const oakFar = shadeByHeight(mergeColored([
    { geo: new THREE.CylinderGeometry(0.3, 0.5, 3.6, 5, 1, true), color: '#74472a', matrix: mat4(0, 1.8, 0) },
    { geo: ico(2.6), color: '#4cb04c', matrix: mat4(0, 4.8, 0, 0, 0, 0, 1.25, 0.95, 1.25) },
  ]), 2.8, 2.8, 7.4, 0.6, 1.15);
  roundFoliage(oakFar, () => [0, 4.4, 0]);
  // pine: five tiers, each turned a little
  const pine = faceVary(shadeByHeight(mergeColored([
    { geo: new THREE.CylinderGeometry(0.22, 0.4, 3, 6, 1, true), color: '#5e3a22', matrix: mat4(0, 1.5, 0) },
    ...[0, 1, 2, 3, 4].map((k) => ({ geo: new THREE.ConeGeometry(2.5 - k * 0.42, 2.9 - k * 0.15, 8), color: ['#286f3e', '#2f7f46', '#358c4d', '#3d9a56', '#46a85e'][k], matrix: mat4(0, 3.1 + k * 1.55, 0, 0, k * 0.37, 0) })),
  ]), 1.6, 1.8, 10.5, 0.62, 1.15), 1.6, 0.1, 5);
  // each tier bends away from a point a little below it: soft cones that still show their layers
  roundFoliage(pine, (y) => [0, y - 1.4, 0], 0.6);
  const pineFar = shadeByHeight(mergeColored([
    { geo: new THREE.CylinderGeometry(0.22, 0.4, 3, 4, 1, true), color: '#5e3a22', matrix: mat4(0, 1.5, 0) },
    { geo: new THREE.ConeGeometry(2.4, 5.2, 6), color: '#2f7f46', matrix: mat4(0, 4.2, 0) },
    { geo: new THREE.ConeGeometry(1.7, 4.4, 6), color: '#3d9a56', matrix: mat4(0, 7.4, 0, 0, 0.5, 0) },
  ]), 1.6, 1.8, 10.5, 0.62, 1.15);
  roundFoliage(pineFar, (y) => [0, y - 1.4, 0], 0.6);
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
  // rocks: darker at the base, a little moss on top
  const rock = shadeByHeight(mergeColored([
    { geo: ico(1), color: '#9a948a', matrix: mat4(0, 0.45, 0, 0.4, 0.2, 0.1, 1.2, 0.75, 1) },
    { geo: ico(0.6), color: '#857f76', matrix: mat4(0.9, 0.25, 0.3, 1, 0.5, 0.3, 1, 0.7, 1.1) },
    { geo: ico(0.45), color: '#8e887e', matrix: mat4(-0.8, 0.2, -0.4, 2, 1, 0.5, 1, 0.8, 1) },
  ]), -1, -0.1, 1.2, 0.62, 1.12, new THREE.Color('#7fa65a'));
  const bush = faceVary(shadeByHeight(mergeColored([
    { geo: ico(0.9), color: '#4fb04a', matrix: mat4(0, 0.55, 0, 0.5, 0, 0.2, 1.15, 0.8, 1) },
    { geo: ico(0.65), color: '#63c75b', matrix: mat4(0.7, 0.45, 0.25, 1, 1, 0) },
    { geo: ico(0.55), color: '#3f9a41', matrix: mat4(-0.6, 0.4, -0.2, 0, 2, 1) },
    { geo: ico(0.5), color: '#58bd52', matrix: mat4(0.1, 0.85, -0.5, 1, 0, 2) },
  ]), -1, 0, 1.4, 0.6, 1.15), -1, 0.12, 7);
  roundFoliage(bush, () => [0, 0.2, 0]);
  return { near: [oak, pine, palm, rock, bush], far: [oakFar, pineFar, palm, rock, bush] };
}

/**
 * Trees, bushes and rocks. Every instance is stored once, sorted into 100 m squares. Each frame
 * the squares you can see are copied into three instanced meshes per kind (close and
 * shadow-casting, near, far with a simple model), so the whole forest costs about a dozen draw
 * calls however many squares are on screen. The copy only happens when the visible set changes.
 */
interface ScatterSet {
  type: number; shadow: boolean;
  mats: Float32Array; cols: Float32Array;
  /** per square: first instance, count, centre x, centre z */
  cells: Float64Array; nCells: number;
  close: THREE.InstancedMesh; near: THREE.InstancedMesh; far: THREE.InstancedMesh;
  sig: Int32Array;
}

const REGION = 100;
const CLOSE = 110;  // shadow area around you
const NEAR = 320;   // detailed models out to here

function buildScatter(w: World, group: THREE.Group, q: Quality): ScatterSet[] {
  const data = w.scatter, geos = scatterGeometries();
  const mat = addWind(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp }), 0.022, 2.2);
  const sets: ScatterSet[] = [];
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
    const total = arr.length / 6;
    if (!total) return;
    const mats = new Float32Array(total * 16), cols = new Float32Array(total * 3), cells = new Float64Array(buckets.size * 4);
    let k = 0, c = 0;
    for (const [key, list] of buckets) {
      const [kx, kz] = key.split(',').map(Number);
      cells[c * 4] = k; cells[c * 4 + 1] = list.length; cells[c * 4 + 2] = (kx + 0.5) * REGION; cells[c * 4 + 3] = (kz + 0.5) * REGION;
      c++;
      for (const i of list) {
        const sz = arr[i + 3], rot = arr[i + 4], tint = arr[i + 5];
        pos.set(arr[i], arr[i + 1], arr[i + 2]);
        quat.setFromAxisAngle(up, rot * Math.PI * 2);
        if (type === SC_ROCK) scl.set(sz * (0.8 + tint * 0.6), sz * (0.7 + rot * 0.6), sz); else scl.set(sz, sz * (0.9 + tint * 0.25), sz);
        m.compose(pos, quat, scl).toArray(mats, k * 16);
        const v = 0.86 + (tint % 1) * 0.24;
        (type === SC_ROCK ? col.setScalar(v) : col.setRGB(v * (0.94 + rot * 0.12), v, v * (0.9 + rot * 0.15))).toArray(cols, k * 3);
        k++;
      }
    }
    const make = (geo: THREE.BufferGeometry, shadow: boolean) => {
      const im = new THREE.InstancedMesh(geo, mat, total);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(total * 3), 3);
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      im.count = 0; im.frustumCulled = false; im.castShadow = shadow; im.receiveShadow = false;
      group.add(im);
      return im;
    };
    const shadow = q.shadows && type !== SC_BUSH;
    sets.push({ type, shadow, mats, cols, cells, nCells: buckets.size, close: make(geos.near[type], shadow), near: make(geos.near[type], false), far: make(geos.far[type], false), sig: new Int32Array(buckets.size).fill(-1) });
  });
  return sets;
}

const _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4(), _sphere = new THREE.Sphere();
function updateScatter(sets: ScatterSet[], cam: THREE.Vector3, camera: THREE.Camera | undefined, range: number) {
  if (camera) {
    camera.updateMatrixWorld();
    _frustum.setFromProjectionMatrix(_pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  }
  const r = REGION * 0.75;
  for (const s of sets) {
    const maxD = (s.type === SC_BUSH ? Math.min(range, 260) : range) + r;
    // which bucket each square goes in: 0 hidden, 1 close, 2 near, 3 far
    let changed = false;
    for (let c = 0; c < s.nCells; c++) {
      const cx = s.cells[c * 4 + 2], cz = s.cells[c * 4 + 3];
      const d = Math.hypot(cam.x - cx, cam.z - cz);
      let b = 0;
      if (d < CLOSE + r) b = 1;
      else if (d < maxD) {
        _sphere.center.set(cx, cam.y * 0.25 + 20, cz); _sphere.radius = r + 30 + Math.abs(cam.y) * 0.4;
        if (!camera || _frustum.intersectsSphere(_sphere)) b = d < NEAR + r * 0.5 ? 2 : 3;
      }
      if (s.sig[c] !== b) { s.sig[c] = b; changed = true; }
    }
    if (!changed) continue;
    const fill = [s.close, s.near, s.far];
    const n = [0, 0, 0];
    for (let c = 0; c < s.nCells; c++) {
      const b = s.sig[c];
      if (!b) continue;
      const im = fill[b - 1], start = s.cells[c * 4], count = s.cells[c * 4 + 1], at = n[b - 1];
      (im.instanceMatrix.array as Float32Array).set(s.mats.subarray(start * 16, (start + count) * 16), at * 16);
      (im.instanceColor!.array as Float32Array).set(s.cols.subarray(start * 3, (start + count) * 3), at * 3);
      n[b - 1] += count;
    }
    fill.forEach((im, i) => {
      im.count = n[i];
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, n[i] * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor!.clearUpdateRanges(); im.instanceColor!.addUpdateRange(0, n[i] * 3); im.instanceColor!.needsUpdate = true;
      im.visible = n[i] > 0;
    });
  }
}

// ---------------------------------------------------------------- entry
export interface IslandView {
  group: THREE.Group;
  props: import('./props3d').PropsView;
  water: ReturnType<typeof makeWater>;
  /** Per-vertex colours of the main field (re-used to paint the map). */
  mainColors: Float32Array;
  update(dt: number, cam: THREE.Vector3, camera?: THREE.Camera): void;
  /** Hide a smashed wall or piece of furniture; returns its colour (for debris), null if not drawn. */
  breakSolid(id: number): THREE.Color | null;
}

export function buildIsland(w: World, q: Quality): IslandView {
  const group = new THREE.Group();
  const mainColors = new Float32Array(w.main.nx * w.main.nz * 3);
  fieldChunks(w, w.main, 60, group, mainColors);
  fieldChunks(w, w.spawn, 80, group);
  buildRoads(w, group);
  const breakRanges = buildBuildingMeshes(w, group);
  const scatter = buildScatter(w, group, q);
  const props = buildProps(w, group);
  const grass = new Grass(w, group, q.grass);
  const water = makeWater(w);
  group.add(water.mesh);
  let t = 0;
  return {
    group, water, mainColors, props,
    breakSolid(id) {
      const rs = breakRanges.get(id);
      if (!rs) return null;
      breakRanges.delete(id);
      return collapseRanges(rs);
    },
    update(dt, cam, camera) {
      t += dt;
      wind.value = t;
      props.update(dt, t, cam);
      grass.update(cam);
      water.mat.uniforms.time.value = t;
      updateScatter(scatter, cam, camera, q.treeRange);
    },
  };
}
