import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm, hash2, layoutAt, poiAt, roadEdgeDist, surfaceAt, terrainAt, type World } from '@dropzone/shared';
import { groundColor } from './terrain';
import { SUN_DIR } from './atmosphere';

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
 * A clump of tapered, curved blades (two segments each, pointed tips). Roots are dark and take
 * the ground's colour so the clump grows out of the terrain instead of sitting on it; tips are
 * lighter and warmer. Normals lean outward from the clump so it shades as a soft rounded tuft.
 * `blades` = how many (the far ring uses fewer).
 */
function tuftGeo(blades: number, spread = 1) {
  const pos: number[] = [], col: number[] = [], nor: number[] = [], hgt: number[] = [];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (i % 3) * 0.7, r = (0.02 + (i % 4) * 0.03) * spread;
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const wBase = 0.026 + (i % 3) * 0.006;
    const px = -Math.sin(a) * wBase, pz = Math.cos(a) * wBase;   // half width at the base
    const h = 0.28 + ((i * 7) % 6) * 0.05;
    const lean = (0.06 + (i % 4) * 0.05) * spread;
    const mx = cx + Math.cos(a) * lean * 0.3, mz = cz + Math.sin(a) * lean * 0.3, my = h * 0.55;
    const tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    const base = [0.5, 0.56, 0.42], mid = [0.92, 0.98, 0.8], tip = [1.28, 1.26, 0.9];
    // outward-leaning normal: rounded shading across the clump
    const nl = Math.hypot(Math.cos(a) * 0.55, 1);
    const n = [Math.cos(a) * 0.55 / nl, 1 / nl, Math.sin(a) * 0.55 / nl];
    const v = (x: number, y: number, z: number, c: number[]) => { pos.push(x, y, z); col.push(...c); nor.push(...n); hgt.push(y / h); };
    v(cx - px, 0, cz - pz, base); v(cx + px, 0, cz + pz, base); v(mx + px * 0.75, my, mz + pz * 0.75, mid);
    v(cx - px, 0, cz - pz, base); v(mx + px * 0.75, my, mz + pz * 0.75, mid); v(mx - px * 0.75, my, mz - pz * 0.75, mid);
    v(mx - px * 0.75, my, mz - pz * 0.75, mid); v(mx + px * 0.75, my, mz + pz * 0.75, mid); v(tx, h, tz, tip);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('bladeH', new THREE.Float32BufferAttribute(hgt, 1));
  return g;
}

/** Grass blades shrink into the ground near the edge of their ring, so rebuilding never pops. */
function grassMaterial(radius: { value: number }, inner: { value: number }, key: string) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = wind; sh.uniforms.uR = radius; sh.uniforms.uR0 = inner;
    sh.uniforms.uSun = { value: SUN_DIR };
    sh.vertexShader = 'uniform float uWind, uR, uR0;\nattribute float bladeH;\nvarying float vBladeH;\nvarying vec3 vGrassWorld;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float d = distance(root.xz, cameraPosition.xz);
        // grow in past the inner edge (where the near ring stops), shrink away at the outer edge
        transformed *= smoothstep(uR, uR * 0.78, d) * smoothstep(uR0 * 0.85, uR0, d + step(uR0, 0.01) * 1e4);
        float h = max(position.y, 0.0);
        float s = sin(uWind * 1.9 + root.x * 0.31 + root.z * 0.23) + 0.5 * sin(uWind * 3.7 + root.x * 0.83 - root.z * 0.61);
        float gust = 0.6 + 0.4 * sin(uWind * 0.45 + root.x * 0.02);
        transformed.x += s * h * h * 0.55 * gust;
        transformed.z += s * h * h * 0.33 * gust;
        vBladeH = bladeH;
        vGrassWorld = root;
      }`);
    sh.fragmentShader = 'uniform vec3 uSun;\nvarying float vBladeH;\nvarying vec3 vGrassWorld;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      {
        // sunlight through the blades: tips glow when you look toward the sun
        vec3 toCam = normalize(cameraPosition - vGrassWorld);
        float back = pow(max(dot(-toCam, uSun), 0.0), 3.0);
        outgoingLight += diffuseColor.rgb * vec3(1.0, 0.95, 0.7) * (0.12 + back * 0.55) * vBladeH * vBladeH;
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'grass3' + key;
  return m;
}

/** Tufts for the grass ring around you, and a sparser far ring of bigger clumps beyond it. */
const nearR = { value: 30 }, noInner = { value: 0 }, farR = { value: 60 };

export class Grass {
  private mesh: THREE.InstancedMesh;
  private far: THREE.InstancedMesh;
  private flowers: THREE.InstancedMesh;
  private cx = Infinity; private cz = Infinity;
  private readonly radius: number;
  private readonly farRadius: number;
  private readonly cell = 0.55;
  private readonly farCell = 1.25;
  private readonly farMax: number;

  constructor(private w: World, scene: THREE.Object3D, private max: number) {
    this.mesh = new THREE.InstancedMesh(tuftGeo(12), grassMaterial(nearR, noInner, 'n'), max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    // the far ring: fewer blades per clump, scaled up, out to about twice the distance
    this.farMax = Math.round(max * 0.45);
    this.far = new THREE.InstancedMesh(tuftGeo(7, 1.4), grassMaterial(farR, nearR, 'f'), Math.max(1, this.farMax));
    this.far.frustumCulled = false; this.far.count = 0;
    // a little flower: a ring of petals round a yellow middle, on top of a stem-high clump
    const petals: THREE.BufferGeometry[] = [];
    for (let k = 0; k < 5; k++) petals.push(new THREE.SphereGeometry(0.028, 5, 3).scale(1, 0.4, 1.6).translate(0, 0, 0.035).rotateY((k / 5) * Math.PI * 2));
    const fGeo = mergeGeometries(petals).translate(0, 0.36, 0);
    const fMat = addWind(new THREE.MeshLambertMaterial({ color: '#ffffff' }), 0.16, 0);
    this.flowers = new THREE.InstancedMesh(fGeo, fMat, Math.ceil(max / 8));
    this.flowers.frustumCulled = false; this.flowers.count = 0;
    this.radius = Math.sqrt(max * this.cell * this.cell / Math.PI) * 0.92;
    this.farRadius = Math.sqrt(this.radius * this.radius + this.farMax * this.farCell * this.farCell / Math.PI) * 0.95;
    nearR.value = this.radius; farR.value = this.farRadius;
    scene.add(this.mesh, this.far, this.flowers);
  }

  /** Should grass grow here? Returns the ground height and a size, or null. */
  private spot(x: number, z: number, i: number, j: number, col: THREE.Color) {
    const w = this.w;
    const h = terrainAt(w, x, z);
    if (h < 3.3 || h > 82) return null;
    const patch = fbm(x / 9, z / 9, 21, 2);
    if (patch < 0.3 && hash2(i, j, 13) > 0.35) return null;
    const slope = Math.abs(terrainAt(w, x + 1, z) - terrainAt(w, x - 1, z)) + Math.abs(terrainAt(w, x, z + 1) - terrainAt(w, x, z - 1));
    if (slope > 1.2 || roadEdgeDist(w, x, z) < 0.4) return null;
    const poi = poiAt(w, x, z);
    if (poi && !poi.minor && (poi.kind === 'city' || poi.kind === 'industrial' || poi.kind === 'harbor' || poi.kind === 'quarry' || poi.kind === 'station')) return null;
    if (layoutAt(w, x, z) || surfaceAt(w, x, z, h + 0.3) > h + 0.05) return null;
    groundColor(w, x, z, h, slope / 4, col);
    const field = poi?.kind === 'farm' && !poi.minor;
    col.multiplyScalar(field ? 1.12 : 1.02);
    col.offsetHSL((hash2(i, j, 19) - 0.5) * 0.035, (hash2(i, j, 20) - 0.5) * 0.14, (hash2(i, j, 21) - 0.5) * 0.07);
    // tall in fields and lush patches, shorter and sparser elsewhere
    const k = (field ? 1.9 : 0.95) + hash2(i, j, 14) * 0.5 + patch * 0.7;
    return { h, k, patch, field };
  }

  update(cam: THREE.Vector3) {
    // rebuild around the camera when it has moved a few metres
    if (Math.hypot(cam.x - this.cx, cam.z - this.cz) < 6) return;
    this.cx = Math.round(cam.x / 3) * 3; this.cz = Math.round(cam.z / 3) * 3;
    const R = this.radius, c = this.cell;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const FL = [new THREE.Color('#ffffff'), new THREE.Color('#ffe066'), new THREE.Color('#ff8fab'), new THREE.Color('#b388ff')];
    let n = 0, nf = 0;
    const i0 = Math.floor((this.cx - R) / c), i1 = Math.floor((this.cx + R) / c), j0 = Math.floor((this.cz - R) / c), j1 = Math.floor((this.cz + R) / c);
    for (let j = j0; j <= j1 && n < this.max; j++) for (let i = i0; i <= i1 && n < this.max; i++) {
      const x = (i + hash2(i, j, 11)) * c, z = (j + hash2(i, j, 12)) * c;
      const dx = x - cam.x, dz = z - cam.z;
      if (dx * dx + dz * dz > R * R) continue;
      const g = this.spot(x, z, i, j, col);
      if (!g) continue;
      q.setFromAxisAngle(up, hash2(i, j, 15) * 6.28);
      this.mesh.setMatrixAt(n, m.compose(p.set(x, g.h - 0.02, z), q, s.set(g.k, g.k * (0.8 + hash2(i, j, 16) * 0.5), g.k)));
      this.mesh.setColorAt(n, col);
      n++;
      if (!g.field && nf < this.flowers.instanceMatrix.count && hash2(i, j, 17) > 0.93 && g.patch > 0.5) {
        this.flowers.setMatrixAt(nf, m.compose(p.set(x, g.h - 0.02, z), q, s.set(g.k * 0.8, g.k * 0.8, g.k * 0.8)));
        this.flowers.setColorAt(nf, FL[Math.floor(hash2(i, j, 18) * 4)]);
        nf++;
      }
    }
    // far ring: between the near ring and twice as far, bigger and sparser clumps
    let nfar = 0;
    const F = this.farRadius, fc = this.farCell;
    if (this.farMax > 0) {
      const a0 = Math.floor((this.cx - F) / fc), a1 = Math.floor((this.cx + F) / fc), b0 = Math.floor((this.cz - F) / fc), b1 = Math.floor((this.cz + F) / fc);
      for (let j = b0; j <= b1 && nfar < this.farMax; j++) for (let i = a0; i <= a1 && nfar < this.farMax; i++) {
        const x = (i + hash2(i, j, 31)) * fc, z = (j + hash2(i, j, 32)) * fc;
        const d2 = (x - cam.x) ** 2 + (z - cam.z) ** 2;
        if (d2 > F * F || d2 < (R * 0.85) ** 2) continue;
        const g = this.spot(x, z, i + 7919, j + 104729, col);
        if (!g) continue;
        q.setFromAxisAngle(up, hash2(i, j, 35) * 6.28);
        const k = g.k * 1.35;
        this.far.setMatrixAt(nfar, m.compose(p.set(x, g.h - 0.02, z), q, s.set(k, k * (0.8 + hash2(i, j, 36) * 0.4), k)));
        this.far.setColorAt(nfar, col);
        nfar++;
      }
    }
    this.mesh.count = n; this.far.count = nfar; this.flowers.count = nf;
    for (const im of [this.mesh, this.far, this.flowers]) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  }
}
