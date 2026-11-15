import * as THREE from 'three';
import { fbm, hash2, layoutAt, poiAt, roadEdgeDist, surfaceAt, terrainAt, type World } from '@dropzone/shared';
import { softRamp } from '../lobby/toon';
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

function tuftGeo() {
  // five tapered blades fanned around the centre; base dark, tips light
  const pos: number[] = [], col: number[] = [], nor: number[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4, lean = 0.12 + (i % 2) * 0.08;
    const cx = Math.cos(a) * 0.06, cz = Math.sin(a) * 0.06;
    const px = -Math.sin(a) * 0.045, pz = Math.cos(a) * 0.045;
    const h = 0.42 + (i % 3) * 0.12;
    const tx = cx + Math.cos(a) * lean, tz = cz + Math.sin(a) * lean;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, tx, h, tz);
    col.push(0.55, 0.62, 0.5, 0.55, 0.62, 0.5, 1.15, 1.18, 1.0);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

export class Grass {
  private mesh: THREE.InstancedMesh;
  private flowers: THREE.InstancedMesh;
  private cx = Infinity; private cz = Infinity;
  private readonly radius: number;
  private readonly cell = 0.85;

  constructor(private w: World, scene: THREE.Object3D, private max: number) {
    const mat = addWind(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide }), 0.16, 0);
    this.mesh = new THREE.InstancedMesh(tuftGeo(), mat, max);
    this.mesh.frustumCulled = false; this.mesh.count = 0;
    const fGeo = new THREE.IcosahedronGeometry(0.07, 0).translate(0, 0.5, 0);
    const fMat = addWind(new THREE.MeshBasicMaterial({ color: '#ffffff' }), 0.16, 0);
    this.flowers = new THREE.InstancedMesh(fGeo, fMat, Math.ceil(max / 8));
    this.flowers.frustumCulled = false; this.flowers.count = 0;
    this.radius = Math.sqrt(max * this.cell * this.cell / Math.PI) * 0.95;
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
      const k = (field ? 1.5 : 0.75) + hash2(i, j, 14) * 0.6 + patch * 0.4;
      q.setFromAxisAngle(up, hash2(i, j, 15) * 6.28);
      this.mesh.setMatrixAt(n, m.compose(p.set(x, h - 0.02, z), q, s.set(k, k * (0.8 + hash2(i, j, 16) * 0.5), k)));
      this.mesh.setColorAt(n, col);
      n++;
      if (!field && nf < this.flowers.instanceMatrix.count && hash2(i, j, 17) > 0.93 && patch > 0.5) {
        this.flowers.setMatrixAt(nf, m.compose(p.set(x, h - 0.02, z), q, s.set(k, k, k)));
        this.flowers.setColorAt(nf, FL[Math.floor(hash2(i, j, 18) * 4)]);
        nf++;
      }
    }
    this.mesh.count = n; this.flowers.count = nf;
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.flowers.instanceMatrix.needsUpdate = true; if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
  }
}
