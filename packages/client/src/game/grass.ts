import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, hash2, layoutAt, poiAt, roadEdgeDist, surfaceAt, terrainAt, type World } from '@dropzone/shared';
import { groundColor } from './terrain';

/** Shared wind clock for grass and trees. */
export const wind = { value: 0 };

/** Bend vertices with height (local y) in a gentle travelling wave. */
export function addWind(m: THREE.Material, strength: number, from: number) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec4 wp = vec4(position, 1.0);
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
        #endif
        float h = max(position.y - ${from.toFixed(2)}, 0.0);
        float s = sin(uWind * 1.7 + wp.x * 0.31 + wp.z * 0.23) + 0.45 * sin(uWind * 3.3 + wp.x * 0.83 - wp.z * 0.61);
        transformed.x += s * h * ${strength.toFixed(3)};
        transformed.z += s * h * ${(strength * 0.6).toFixed(3)};
      }`);
  };
  m.customProgramCacheKey = () => `wind${strength}:${from}`;
  return m;
}

/**
 * A clump of nine thin, curved blades (two segments each). Base dark, tips light and a little
 * yellow; normals point up so the clump lights like the ground it grows from.
 */
function tuftGeo() {
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  const blades = 9;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (i % 3) * 0.7, r = 0.03 + (i % 4) * 0.025;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const px = -Math.sin(a) * 0.022, pz = Math.cos(a) * 0.022;   // half width at the base
    const h = 0.26 + ((i * 7) % 5) * 0.06;
    const lean = 0.08 + (i % 3) * 0.06;
    const mx = cx + Math.cos(a) * lean * 0.35, mz = cz + Math.sin(a) * lean * 0.35, my = h * 0.55;
    const tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    const base = [0.42, 0.5, 0.36], mid = [0.82, 0.9, 0.7], tip = [1.18, 1.2, 0.92];
    const quad = (ax: number, ay: number, az: number, w0: number, bx: number, by: number, bz: number, w1: number, c0: number[], c1: number[]) => {
      pos.push(ax - px * w0, ay, az - pz * w0, ax + px * w0, ay, az + pz * w0, bx + px * w1, by, bz + pz * w1);
      pos.push(ax - px * w0, ay, az - pz * w0, bx + px * w1, by, bz + pz * w1, bx - px * w1, by, bz - pz * w1);
      col.push(...c0, ...c0, ...c1, ...c0, ...c1, ...c1);
    };
    quad(cx, 0, cz, 1, mx, my, mz, 0.7, base, mid);
    pos.push(mx - px * 0.7, my, mz - pz * 0.7, mx + px * 0.7, my, mz + pz * 0.7, tx, h, tz);
    col.push(...mid, ...mid, ...tip);
  }
  for (let k = 0; k < pos.length / 3; k++) nor.push(0, 1, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/** Grass blades shrink into the ground near the edge of the grass radius, so rebuilding never pops. */
const grassRadius = { value: 30 };
function grassMaterial() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind; sh.uniforms.uR = grassRadius;
    sh.vertexShader = 'uniform float uWind, uR;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float d = distance(root.xz, cameraPosition.xz);
        transformed *= smoothstep(uR, uR * 0.72, d);
        float h = max(position.y, 0.0);
        float s = sin(uWind * 1.9 + root.x * 0.31 + root.z * 0.23) + 0.5 * sin(uWind * 3.7 + root.x * 0.83 - root.z * 0.61);
        float gust = 0.6 + 0.4 * sin(uWind * 0.45 + root.x * 0.02);
        transformed.x += s * h * h * 0.55 * gust;
        transformed.z += s * h * h * 0.33 * gust;
      }`);
  };
  m.customProgramCacheKey = () => 'grass2';
  return m;
}

export class Grass {
  private mesh: THREE.InstancedMesh;
  private flowers: THREE.InstancedMesh;
  private cx = Infinity; private cz = Infinity;
  private readonly radius: number;
  private readonly cell = 0.62;

  constructor(private w: World, scene: THREE.Object3D, private max: number) {
    this.mesh = new THREE.InstancedMesh(tuftGeo(), grassMaterial(), max);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    // a little flower: a ring of petals round a yellow middle, on top of a stem-high clump
    const petals: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) petals.push(new THREE.SphereGeometry(0.028, 5, 3).scale(1, 0.4, 1.6).translate(0, 0, 0.035).rotateY((k / 5) * Math.PI * 2));
    const fGeo = mergeGeometries(petals).translate(0, 0.36, 0);
    const fMat = addWind(new THREE.MeshLambertMaterial({ color: '#ffffff' }), 0.16, 0);
    this.flowers = new THREE.InstancedMesh(fGeo, fMat, Math.ceil(max / 8));
    this.flowers.frustumCulled = false; this.flowers.count = 0;
    this.radius = Math.sqrt(max * this.cell * this.cell / Math.PI) * 0.95;
    grassRadius.value = this.radius;
    scene.add(this.mesh, this.flowers);
  }

  update(cam: THREE.Vector3) {
    // rebuild around the camera when it has moved a few metres
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 6) return;
    this.cx = Math.round(cam.x / 3) * 3; this.cz = Math.round(cam.z / 3) * 3;
    const w = this.w, R = this.radius, c = this.cell;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const FL = [new THREE.Color('#ffffff'), new THREE.Color('#ffe066'), new THREE.Color('#ff8fab'), new THREE.Color('#b388ff')];
    let n = 0, nf = 0;
    const i0 = Math.floor((this.cx - R) / c), i1 = Math.floor((this.cx + R) / c), j0 = Math.floor((this.cz - R) / c), j1 = Math.floor((this.cz + R) / c);
    for (let j = j0; j <= j1 && n < this.max; j++) for (let i = i0; i <= i1 && n < this.max; i++) {
      const x = (i + hash2(i, j, 11)) * c, z = (j + hash2(i, j, 12)) * c;
      const dx = x - cam.x, dz = z - cam.z;
      if (dx * dx + dz * dz > R * R) continue;
      const h = terrainAt(w, x, z);
      if (h < 3.3 || h > 82) continue;
      const patch = fbm(x / 9, z / 9, 21, 2);
      if (patch < 0.36 && hash2(i, j, 13) > 0.25) continue;
      const slope = Math.abs(terrainAt(w, x + 1, z) - terrainAt(w, x - 1, z)) + Math.abs(terrainAt(w, x, z + 1) - terrainAt(w, x, z - 1));
      if (slope > 1.1 || roadEdgeDist(w, x, z) < 0.4) continue;
      const poi = poiAt(w, x, z);
      if (poi && (poi.kind === 'city' || poi.kind === 'industrial' || poi.kind === 'harbor' || poi.kind === 'quarry' || poi.kind === 'station')) continue;
      if (layoutAt(w, x, z) || surfaceAt(w, x, z, h + 0.3) > h + 0.05) continue;
      groundColor(w, x, z, h, slope / 4, col);
      const field = poi?.kind === 'farm';
      col.multiplyScalar(field ? 1.15 : 1.05);
      // tall in fields and lush patches, short and sparse elsewhere; colour varies a little per clump
      const k = (field ? 1.9 : 0.85) + hash2(i, j, 14) * 0.5 + patch * 0.6;
      col.offsetHSL((hash2(i, j, 19) - 0.5) * 0.03, (hash2(i, j, 20) - 0.5) * 0.12, (hash2(i, j, 21) - 0.5) * 0.06);
      q.setFromAxisAngle(up, hash2(i, j, 15) * 6.28);
      this.mesh.setMatrixAt(n, m.compose(p.set(x, h - 0.02, z), q, s.set(k, k * (0.8 + hash2(i, j, 16) * 0.5), k)));
      this.mesh.setColorAt(n, col);
      n++;
      if (!field && nf < this.flowers.instanceMatrix.count && hash2(i, j, 17) > 0.93 && patch > 0.5) {
        this.flowers.setMatrixAt(nf, m.compose(p.set(x, h - 0.02, z), q, s.set(k * 0.8, k * 0.8, k * 0.8)));
        this.flowers.setColorAt(nf, FL[Math.floor(hash2(i, j, 18) * 4)]);
        nf++;
      }
    }
    this.mesh.count = n; this.flowers.count = nf;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.flowers.instanceMatrix.needsUpdate = true; if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
  }
}
