import * as THREE from 'three';
import { SK, hash2, terrainAt, type Prop, type World } from '@dropzone/shared';
import { softRamp } from '../lobby/toon';
import { mat4, mergeColored, type Piece } from './geo';

/**
 * Outdoor props: one instanced batch per model (one draw call each), plus a few animated
 * landmarks. All models are original low-poly designs; front is -Z, origin on the ground.
 */
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
glowMat.color.setScalar(1.6);
/** Hot glow (crystals, pads, signs): bright enough to bloom. */
const hotGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
hotGlowMat.color.setScalar(5);

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const CY = (r0: number, r1: number, h: number, seg = 10) => new THREE.CylinderGeometry(r1, r0, h, seg);
const WOOD = '#9c6b43', DARK = '#3d3d46', METAL = '#8d99ae';

type Template = { solid: Piece[]; glow?: Piece[] };

function templates(): Record<string, (v: number) => Template> {
  return {
    lamp: () => ({
      solid: [{ geo: CY(0.1, 0.07, 5), color: DARK, matrix: mat4(0, 2.5, 0) }, { geo: B(0.08, 0.08, 1.1), color: DARK, matrix: mat4(0, 4.9, -0.5) }, { geo: B(0.4, 0.14, 0.5), color: DARK, matrix: mat4(0, 4.85, -1.05) }],
      glow: [{ geo: B(0.32, 0.06, 0.4), color: '#fff2b0', matrix: mat4(0, 4.76, -1.05) }],
    }),
    bench: () => ({ solid: [
      { geo: B(1.6, 0.08, 0.45), color: WOOD, matrix: mat4(0, 0.45, 0) }, { geo: B(1.6, 0.35, 0.06), color: WOOD, matrix: mat4(0, 0.75, 0.2) },
      ...[-0.7, 0.7].map((x) => ({ geo: B(0.06, 0.45, 0.4), color: DARK, matrix: mat4(x, 0.22, 0) })),
    ] }),
    bin: () => ({ solid: [{ geo: CY(0.28, 0.3, 0.95, 10), color: '#2d6a4f', matrix: mat4(0, 0.47, 0) }, { geo: CY(0.32, 0.32, 0.06, 10), color: '#1b4332', matrix: mat4(0, 0.97, 0) }] }),
    fence: () => ({ solid: [
      ...[-1.5, 0, 1.5].map((x) => ({ geo: B(0.12, 1.1, 0.12), color: '#8b5e3c', matrix: mat4(x, 0.55, 0) })),
      { geo: B(3.0, 0.1, 0.05), color: '#a47148', matrix: mat4(0, 0.45, 0) }, { geo: B(3.0, 0.1, 0.05), color: '#a47148', matrix: mat4(0, 0.88, 0) },
    ] }),
    hay: () => ({ solid: [
      { geo: CY(0.6, 0.6, 1.2, 14).rotateZ(Math.PI / 2), color: '#e9c46a', matrix: mat4(0, 0.6, 0) },
      { geo: CY(0.61, 0.61, 0.05, 14).rotateZ(Math.PI / 2), color: '#b08930', matrix: mat4(-0.3, 0.6, 0) }, { geo: CY(0.61, 0.61, 0.05, 14).rotateZ(Math.PI / 2), color: '#b08930', matrix: mat4(0.3, 0.6, 0) },
    ] }),
    tractor: (v) => {
      const c = ['#d62828', '#2d6a4f', '#457b9d'][v % 3];
      return { solid: [
        { geo: B(1.4, 0.9, 2.6), color: c, matrix: mat4(0, 1.05, 0.2) }, { geo: B(1.2, 1.2, 1.1), color: c, matrix: mat4(0, 2.05, 0.75) },
        { geo: B(1.1, 0.9, 0.06), color: '#8fd0ea', matrix: mat4(0, 2.15, 0.19) }, { geo: B(0.1, 0.6, 0.1), color: DARK, matrix: mat4(0.4, 2.0, -0.8) },
        ...[-0.85, 0.85].map((x) => ({ geo: CY(0.75, 0.75, 0.45, 14).rotateZ(Math.PI / 2), color: '#22223b', matrix: mat4(x, 0.75, 0.9) })),
        ...[-0.75, 0.75].map((x) => ({ geo: CY(0.42, 0.42, 0.3, 12).rotateZ(Math.PI / 2), color: '#22223b', matrix: mat4(x, 0.42, -1.0) })),
      ] };
    },
    windmill: () => ({ solid: [
      { geo: CY(2.3, 1.5, 13, 8), color: '#f1ece2', matrix: mat4(0, 6.5, 0) }, { geo: new THREE.ConeGeometry(2.0, 2.6, 8), color: '#7f4f24', matrix: mat4(0, 14.3, 0) },
      { geo: B(1.0, 1.8, 0.1), color: '#7b3f00', matrix: mat4(0, 0.9, -2.25) }, { geo: B(0.7, 0.7, 0.1), color: '#9ad7ee', matrix: mat4(0, 7, -1.9) },
      { geo: B(0.5, 0.5, 1.4), color: '#5c4033', matrix: mat4(0, 12.6, -1.6) },
    ] }),
    fire: () => ({
      solid: [...Array.from({ length: 8 }, (_, k) => ({ geo: new THREE.DodecahedronGeometry(0.22, 0), color: '#8d8d94', matrix: mat4(Math.cos((k / 8) * 6.28) * 0.8, 0.1, Math.sin((k / 8) * 6.28) * 0.8) })),
        { geo: CY(0.1, 0.1, 1.1, 6).rotateZ(Math.PI / 2), color: '#5b3b24', matrix: mat4(0, 0.15, 0, 0, 0.5, 0) }, { geo: CY(0.1, 0.1, 1.1, 6).rotateZ(Math.PI / 2), color: '#5b3b24', matrix: mat4(0, 0.22, 0, 0, -0.6, 0) }],
    }),
    log: () => ({ solid: [{ geo: CY(0.24, 0.24, 1.8, 8).rotateZ(Math.PI / 2), color: '#7f5539', matrix: mat4(0, 0.24, 0) }, { geo: CY(0.25, 0.25, 0.02, 8).rotateZ(Math.PI / 2), color: '#d4a373', matrix: mat4(0.9, 0.24, 0) }] }),
    tent: (v) => {
      const c = ['#f77f00', '#3a86ff', '#2a9d8f', '#e63946'][v % 4];
      return { solid: [
        { geo: new THREE.ConeGeometry(1.6, 1.8, 4, 1).rotateY(Math.PI / 4).scale(0.85, 1, 0.72), color: c, matrix: mat4(0, 0.9, 0) },
        // the door lies on the sloping front face
        { geo: B(0.62, 0.95, 0.03), color: '#2b2d42', matrix: mat4(0, 0.47, -0.85, -0.57, 0, 0) },
      ] };
    },
    picnic: () => ({ solid: [
      { geo: B(1.8, 0.07, 0.8), color: WOOD, matrix: mat4(0, 0.75, 0) }, ...[-0.65, 0.65].map((z) => ({ geo: B(1.8, 0.06, 0.28), color: WOOD, matrix: mat4(0, 0.45, z) })),
      ...[-0.75, 0.75].map((x) => ({ geo: B(0.08, 0.75, 1.5), color: '#7f5539', matrix: mat4(x, 0.37, 0) })),
    ] }),
    barrel: (v) => {
      const c = ['#e63946', '#457b9d', '#e9c46a', '#2a9d8f'][v % 4];
      return { solid: [{ geo: CY(0.34, 0.34, 1.0, 12), color: c, matrix: mat4(0, 0.5, 0) }, { geo: CY(0.36, 0.36, 0.06, 12), color: DARK, matrix: mat4(0, 0.25, 0) }, { geo: CY(0.36, 0.36, 0.06, 12), color: DARK, matrix: mat4(0, 0.75, 0) }, { geo: CY(0.3, 0.3, 0.02, 12), color: '#bfc0c0', matrix: mat4(0, 1.0, 0) }] };
    },
    crates: () => ({ solid: [
      { geo: B(0.7, 0.7, 0.7), color: '#c98b4a', matrix: mat4(-0.36, 0.35, -0.36) }, { geo: B(0.7, 0.7, 0.7), color: '#b97c3f', matrix: mat4(0.36, 0.35, -0.36) },
      { geo: B(0.7, 0.7, 0.7), color: '#c98b4a', matrix: mat4(0, 0.35, 0.36) }, { geo: B(0.7, 0.7, 0.7), color: '#d39a59', matrix: mat4(0, 1.05, -0.1, 0, 0.3, 0) },
    ] }),
    chimney: () => ({ solid: [
      { geo: CY(1.15, 0.85, 22, 12), color: '#a44a3f', matrix: mat4(0, 11, 0) },
      { geo: CY(0.95, 0.95, 1.2, 12), color: '#f1faee', matrix: mat4(0, 18.5, 0) }, { geo: CY(0.92, 0.92, 1.2, 12), color: '#e63946', matrix: mat4(0, 20, 0) },
      { geo: CY(1.0, 1.0, 0.5, 12), color: DARK, matrix: mat4(0, 22.1, 0) },
    ] }),
    pipes: () => ({ solid: [
      { geo: CY(0.35, 0.35, 14, 10).rotateZ(Math.PI / 2), color: '#9aa5b1', matrix: mat4(0, 1.7, -0.25) }, { geo: CY(0.25, 0.25, 14, 10).rotateZ(Math.PI / 2), color: '#e9c46a', matrix: mat4(0, 2.35, 0.25) },
      ...[-6.5, -3.2, 0, 3.2, 6.5].map((x) => ({ geo: B(0.15, 2.4, 1.1), color: DARK, matrix: mat4(x, 1.2, 0) })),
      { geo: CY(0.5, 0.5, 0.8, 10), color: '#e63946', matrix: mat4(1.5, 1.7, -0.25, 0, 0, Math.PI / 2) },
    ] }),
    crane: () => {
      const y = '#ffb703', pieces: Piece[] = [];
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pieces.push({ geo: B(0.15, 18, 0.15), color: y, matrix: mat4(x, 9, z) });
      for (let h = 1; h < 18; h += 2) { pieces.push({ geo: B(2.1, 0.1, 0.1), color: y, matrix: mat4(0, h, -1) }, { geo: B(2.1, 0.1, 0.1), color: y, matrix: mat4(0, h, 1) }, { geo: B(0.1, 0.1, 2.1), color: y, matrix: mat4(-1, h + 1, 0) }, { geo: B(0.1, 0.1, 2.1), color: y, matrix: mat4(1, h + 1, 0) }); }
      pieces.push({ geo: B(1.2, 1.0, 16), color: y, matrix: mat4(0, 18.4, -5) }, { geo: B(1.8, 1.6, 2.4), color: '#6c757d', matrix: mat4(0, 18.3, 3.8) }, { geo: B(1.6, 1.4, 1.6), color: '#e9ecef', matrix: mat4(0, 17.3, 0) });
      pieces.push({ geo: B(0.04, 9, 0.04), color: DARK, matrix: mat4(0, 13.6, -11) }, { geo: B(0.4, 0.5, 0.4), color: DARK, matrix: mat4(0, 9, -11) });
      return { solid: pieces };
    },
    rockpile: () => ({ solid: [
      { geo: new THREE.DodecahedronGeometry(1.0, 0), color: '#a39e93', matrix: mat4(-0.4, 0.6, 0, 0.3, 0.2, 0, 1.2, 0.8, 1) }, { geo: new THREE.DodecahedronGeometry(0.8, 0), color: '#8f8a80', matrix: mat4(0.7, 0.45, 0.3, 0.7, 0.5, 0.2) },
      { geo: new THREE.DodecahedronGeometry(0.6, 0), color: '#b5afa3', matrix: mat4(0.1, 1.2, -0.2, 0.1, 0.9, 0) },
    ] }),
    umbrella: (v) => {
      const c = ['#ef476f', '#ffd166', '#06d6a0', '#118ab2'][v % 4];
      return { solid: [{ geo: CY(0.04, 0.04, 2.4, 6), color: '#f1faee', matrix: mat4(0, 1.2, 0) }, { geo: new THREE.ConeGeometry(1.4, 0.6, 10), color: c, matrix: mat4(0, 2.4, 0) }, { geo: new THREE.ConeGeometry(1.42, 0.62, 10, 1, true).scale(1, 0.2, 1), color: '#ffffff', matrix: mat4(0, 2.12, 0) }] };
    },
    lounger: (v) => ({ solid: [
      { geo: B(0.7, 0.12, 1.9), color: '#f1faee', matrix: mat4(0, 0.35, 0) }, { geo: B(0.66, 0.08, 1.2), color: ['#ef476f', '#118ab2', '#ffd166'][v % 3], matrix: mat4(0, 0.44, 0.3) },
      { geo: B(0.66, 0.08, 0.7), color: ['#ef476f', '#118ab2', '#ffd166'][v % 3], matrix: mat4(0, 0.62, -0.6, 0.6, 0, 0) },
    ] }),
    pool: () => ({
      solid: [{ geo: B(8.4, 0.25, 0.4), color: '#f1faee', matrix: mat4(0, 0.12, -3.2) }, { geo: B(8.4, 0.25, 0.4), color: '#f1faee', matrix: mat4(0, 0.12, 3.2) }, { geo: B(0.4, 0.25, 6.8), color: '#f1faee', matrix: mat4(-4.2, 0.12, 0) }, { geo: B(0.4, 0.25, 6.8), color: '#f1faee', matrix: mat4(4.2, 0.12, 0) }],
      glow: [{ geo: B(8, 0.05, 6), color: '#48cae4', matrix: mat4(0, 0.08, 0) }],
    }),
    mast: () => {
      const pieces: Piece[] = [];
      for (let k = 0; k < 10; k++) {
        const y = k * 3, r = 1.3 - k * 0.11, c = k % 2 ? '#e63946' : '#f1faee';
        for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) pieces.push({ geo: B(0.12, 3, 0.12), color: c, matrix: mat4(x * r, y + 1.5, z * r) });
        pieces.push({ geo: B(r * 2, 0.08, 0.08), color: c, matrix: mat4(0, y + 3, -r) }, { geo: B(r * 2, 0.08, 0.08), color: c, matrix: mat4(0, y + 3, r) }, { geo: B(0.08, 0.08, r * 2), color: c, matrix: mat4(-r, y + 3, 0) }, { geo: B(0.08, 0.08, r * 2), color: c, matrix: mat4(r, y + 3, 0) });
      }
      pieces.push({ geo: B(3, 3, 3), color: '#d9dde3', matrix: mat4(0, 1.5, 3.2) });
      return { solid: pieces };
    },
    dish: () => ({ solid: [{ geo: CY(0.15, 0.15, 1.4, 8), color: METAL, matrix: mat4(0, 0.7, 0) }, { geo: new THREE.SphereGeometry(1.0, 14, 8, 0, Math.PI * 2, 0, Math.PI / 3), color: '#f1faee', matrix: mat4(0, 1.6, -0.2, -0.9, 0, 0) }] }),
    beacon: () => ({
      solid: [
        { geo: CY(1.2, 1.05, 0.5, 6), color: '#3d405b', matrix: mat4(0, 0.25, 0) }, { geo: CY(0.95, 0.95, 0.12, 6), color: '#4ade80', matrix: mat4(0, 0.56, 0) },
        { geo: CY(0.12, 0.08, 4.2, 6), color: '#c0c4cc', matrix: mat4(0, 2.6, 0) },
        { geo: new THREE.TorusGeometry(0.55, 0.06, 6, 16).rotateX(Math.PI / 2), color: '#c0c4cc', matrix: mat4(0, 3.2, 0) },
        { geo: B(0.5, 0.7, 0.3), color: '#2b2d42', matrix: mat4(0, 1.0, 0.85) }, { geo: B(0.36, 0.3, 0.02), color: '#3ee6ff', matrix: mat4(0, 1.12, 1.01) },
      ],
    }),
    vault: () => ({
      solid: [
        { geo: B(7, 0.2, 6), color: '#9a958c', matrix: mat4(0, 0.1, 0) },
        { geo: B(7, 3.6, 0.45), color: '#8d8f94', matrix: mat4(0, 1.8, -2.78) },
        { geo: B(0.45, 3.6, 6), color: '#8d8f94', matrix: mat4(-3.28, 1.8, 0) }, { geo: B(0.45, 3.6, 6), color: '#8d8f94', matrix: mat4(3.28, 1.8, 0) },
        { geo: B(2.6, 3.6, 0.45), color: '#8d8f94', matrix: mat4(-2.2, 1.8, 2.78) }, { geo: B(2.6, 3.6, 0.45), color: '#8d8f94', matrix: mat4(2.2, 1.8, 2.78) },
        { geo: B(1.8, 1.2, 0.45), color: '#8d8f94', matrix: mat4(0, 3.0, 2.78) },
        { geo: B(7.4, 0.4, 6.4), color: '#6c6f75', matrix: mat4(0, 3.8, 0) },
        // hazard stripes framing the door
        ...[-1, 1].flatMap((sd) => [0, 1, 2, 3, 4].map((k) => ({ geo: B(0.22, 0.36, 0.05), color: k % 2 ? '#ffd23f' : '#14123a', matrix: mat4(sd * 1.05, 0.25 + k * 0.48, 3.02, 0, 0, 0.4) }))),
        { geo: B(2.3, 0.3, 0.06), color: '#ffd23f', matrix: mat4(0, 2.55, 3.02) },
        { geo: B(5.6, 0.12, 0.12), color: '#fff2c4', matrix: mat4(0, 3.45, -2.4) },
      ],
    }),
    // warm-up island movement course
    ptower: () => {
      const pieces: Piece[] = [
        { geo: B(4, 6.5, 4), color: '#bdb6aa', matrix: mat4(0, 3.25, 0) },
        { geo: B(4.12, 0.5, 4.12), color: '#3d405b', matrix: mat4(0, 6.3, 0) },
        { geo: B(3.6, 0.04, 3.6), color: '#8d99ae', matrix: mat4(0, 6.52, 0) },
        { geo: B(1.3, 2.2, 0.08), color: '#5c4033', matrix: mat4(0, 1.1, -2.02) },
      ];
      // hazard stripes round the top
      for (let k = 0; k < 8; k++) for (const f of [0, 1, 2, 3]) {
        const a = -1.75 + k * 0.5, x = f === 1 ? 2.07 : f === 3 ? -2.07 : a, z = f === 0 ? 2.07 : f === 2 ? -2.07 : a;
        pieces.push({ geo: B(f % 2 ? 0.04 : 0.25, 0.5, f % 2 ? 0.25 : 0.04), color: '#ffb703', matrix: mat4(x, 6.3, z) });
      }
      for (const y of [2.2, 4.4]) for (const f of [-1, 1]) pieces.push({ geo: B(0.9, 0.5, 0.05), color: '#8fd0ea', matrix: mat4(f * 1.0, y + 0.8, -2.03) });
      return { solid: pieces };
    },
    pblock: () => ({ solid: [
      { geo: B(2.4, 1.5, 2.4), color: '#e9c46a', matrix: mat4(0, 0.75, 0) },
      { geo: B(2.46, 0.14, 2.46), color: '#3d405b', matrix: mat4(0, 1.43, 0) }, { geo: B(2.46, 0.14, 2.46), color: '#3d405b', matrix: mat4(0, 0.07, 0) },
      ...[-1, 1].map((f) => ({ geo: B(0.12, 1.2, 2.46), color: '#3d405b', matrix: mat4(f * 1.17, 0.75, 0) })),
    ] }),
    pwall: () => ({ solid: [
      { geo: B(4, 2.3, 0.5), color: '#c8553d', matrix: mat4(0, 1.15, 0) },
      { geo: B(4.1, 0.14, 0.6), color: '#d9d4c7', matrix: mat4(0, 2.33, 0) },
      ...[-1.3, 0, 1.3].map((x) => ({ geo: B(0.06, 2.2, 0.52), color: '#a44a3f', matrix: mat4(x, 1.1, 0) })),
    ] }),
    pole: () => ({ solid: [{ geo: CY(0.16, 0.12, 7.5, 7), color: '#7f5539', matrix: mat4(0, 3.75, 0) }, { geo: B(2.2, 0.12, 0.12), color: '#7f5539', matrix: mat4(0, 7.1, 0) }, ...[-0.9, 0, 0.9].map((x) => ({ geo: CY(0.05, 0.05, 0.18, 6), color: '#e9ecef', matrix: mat4(x, 7.25, 0) }))] }),
  };
}

const ANIMATED = new Set(['beacon', 'vault', 'windmill', 'fire', 'chimney', 'mast', 'lighthouse', 'boat', 'dock', 'sign', 'pole', 'ladder', 'zippole', 'pad']);

export interface PropsView {
  update(dt: number, t: number, cam: THREE.Vector3): void;
  /** Beacon lights: green when ready, grey while cooling down. */
  setBeacons(ready: boolean[]): void;
  /** Hide the doors of vaults that have been opened. */
  setVaults(open: Set<number>): void;
}

export function buildProps(w: World, scene: THREE.Group): PropsView {
  const T = templates();
  const byType = new Map<string, Prop[]>();
  for (const p of w.props) { let l = byType.get(p.t); if (!l) byType.set(p.t, (l = [])); l.push(p); }
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), scl = new THREE.Vector3();

  // ------------------------------------------------ static instanced props (plus the static parts of the animated ones)
  for (const [t, list] of byType) {
    const make = T[t];
    if (!make) continue;
    const variants = new Map<number, Prop[]>();
    for (const p of list) { const v = Math.floor(hash2(Math.round(p.x), Math.round(p.z), 5) * 4); let l = variants.get(v); if (!l) variants.set(v, (l = [])); l.push(p); }
    for (const [v, ps] of variants) {
      const tmpl = make(v);
      for (const [pieces, material, shadow] of [[tmpl.solid, mat, true], [tmpl.glow, glowMat, false]] as const) {
        if (!pieces?.length) continue;
        const inst = new THREE.InstancedMesh(mergeColored(pieces), material, ps.length);
        ps.forEach((p, i) => inst.setMatrixAt(i, m.compose(pos.set(p.x, p.y, p.z), q.setFromAxisAngle(up, p.rot), scl.setScalar(p.s))));
        inst.instanceMatrix.needsUpdate = true;
        inst.computeBoundingSphere();
        inst.castShadow = shadow; inst.receiveShadow = shadow;
        scene.add(inst);
      }
    }
  }

  // ------------------------------------------------ animated and one-off landmarks
  const spinners: { o: THREE.Object3D; axis: 'x' | 'y' | 'z'; speed: number }[] = [];
  const flames: THREE.Object3D[] = [];
  const blinkers: THREE.Mesh[] = [];
  const bobbers: { o: THREE.Object3D; phase: number; y: number }[] = [];
  const smokeSources: THREE.Vector3[] = [];
  const add = (o: THREE.Object3D, p: Prop) => { o.position.set(p.x, p.y, p.z); o.rotation.y = p.rot; scene.add(o); return o; };
  const mesh = (pieces: Piece[], glow = false) => { const me = new THREE.Mesh(mergeColored(pieces), glow ? hotGlowMat : mat); me.castShadow = !glow; return me; };

  for (const p of byType.get('windmill') ?? []) {
    const hub = new THREE.Group();
    hub.position.set(0, 12.6, -2.4);
    const blades: Piece[] = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      blades.push({ geo: B(0.3, 6.5, 0.12), color: '#5c4033', matrix: new THREE.Matrix4().makeRotationZ(a).multiply(mat4(0, 3.6, 0)) });
      blades.push({ geo: B(1.3, 5.2, 0.05), color: '#f8f1e5', matrix: new THREE.Matrix4().makeRotationZ(a).multiply(mat4(0.75, 3.9, -0.05)) });
    }
    blades.push({ geo: CY(0.35, 0.35, 0.6, 10).rotateX(Math.PI / 2), color: DARK, matrix: mat4(0, 0, 0.2) });
    hub.add(mesh(blades));
    const g = new THREE.Group(); g.add(hub);
    add(g, p);
    spinners.push({ o: hub, axis: 'z', speed: 0.6 });
  }
  // beacon crystals and vault doors change during the match
  const beaconLights = (byType.get('beacon') ?? []).map((p) => {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color('#4ade80').multiplyScalar(5) }));
    gem.position.set(p.x, p.y + 4.9, p.z);
    scene.add(gem);
    spinners.push({ o: gem, axis: 'y', speed: 1.4 });
    return gem;
  });
  const vaultDoors = new Map<number, THREE.Object3D>();
  for (const p of byType.get('vault') ?? []) {
    const door = new THREE.Group();
    door.add(mesh([
      { geo: B(1.8, 2.4, 0.3), color: '#a8adb5', matrix: mat4(0, 1.2, 2.7) },
      { geo: CY(0.75, 0.75, 0.2, 16).rotateX(Math.PI / 2), color: '#c9ced6', matrix: mat4(0, 1.25, 2.92) },
      { geo: CY(0.25, 0.25, 0.25, 10).rotateX(Math.PI / 2), color: '#5c6370', matrix: mat4(0, 1.25, 3.0) },
      ...[0, 1, 2].map((k) => ({ geo: B(1.2, 0.08, 0.06), color: '#5c6370', matrix: mat4(0, 1.25, 3.06, 0, 0, (k * Math.PI) / 3) })),
    ]));
    door.position.set(p.x, p.y, p.z); door.rotation.y = p.rot;
    scene.add(door);
    vaultDoors.set(p.n ?? 0, door);
  }

  for (const p of byType.get('fire') ?? []) {
    const f = new THREE.Group();
    f.add(mesh([{ geo: new THREE.ConeGeometry(0.42, 1.1, 7), color: '#ff7b00', matrix: mat4(0, 0.6, 0) }, { geo: new THREE.ConeGeometry(0.26, 0.8, 7), color: '#ffd23f', matrix: mat4(0.05, 0.55, 0.05) }], true));
    add(f, p);
    flames.push(f);
  }
  for (const p of byType.get('chimney') ?? []) smokeSources.push(new THREE.Vector3(p.x, p.y + 22.5, p.z));
  for (const p of byType.get('mast') ?? []) {
    const light = mesh([{ geo: new THREE.SphereGeometry(0.35, 8, 6), color: '#ff2d2d', matrix: mat4(0, 30.4, 0) }], true);
    add(light, p); blinkers.push(light);
  }
  for (const p of byType.get('lighthouse') ?? []) {
    const g = new THREE.Group();
    const bands: Piece[] = [];
    for (let k = 0; k < 6; k++) bands.push({ geo: CY(2.4 - k * 0.14, 2.4 - (k + 1) * 0.14, 3.3, 14), color: k % 2 ? '#e63946' : '#f8f9fa', matrix: mat4(0, 1.65 + k * 3.3, 0) });
    bands.push({ geo: CY(2.0, 2.0, 0.3, 14), color: DARK, matrix: mat4(0, 20, 0) }, { geo: CY(1.3, 1.3, 2.2, 10), color: '#9ad7ee', matrix: mat4(0, 21.3, 0) }, { geo: new THREE.ConeGeometry(1.6, 1.6, 10), color: '#e63946', matrix: mat4(0, 23.2, 0) }, { geo: B(1.1, 2.0, 0.1), color: '#7b3f00', matrix: mat4(0, 1.0, -2.35) });
    g.add(mesh(bands));
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 60, 16, 1, true).translate(0, -30, 0).rotateZ(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#fff5c0', transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    const pivot = new THREE.Group(); pivot.position.y = 21.3; pivot.add(beam);
    g.add(pivot, mesh([{ geo: new THREE.SphereGeometry(0.7, 10, 8), color: '#fff3b0', matrix: mat4(0, 21.3, 0) }], true));
    add(g, p);
    spinners.push({ o: pivot, axis: 'y', speed: 0.9 });
  }
  for (const p of byType.get('dock') ?? []) {
    const len = p.s, planks: Piece[] = [];
    for (let k = 0; k < len / 0.5; k++) planks.push({ geo: B(3.2, 0.12, 0.46), color: k % 3 ? '#a47148' : '#8b5e3c', matrix: mat4(0, -0.06, -len / 2 + 0.25 + k * 0.5) });
    for (let k = 0; k <= len / 4; k++) for (const x of [-1.5, 1.5]) planks.push({ geo: CY(0.13, 0.13, 3.6, 7), color: '#5b3b24', matrix: mat4(x, -1.7, -len / 2 + k * 4) });
    const g = new THREE.Group(); g.add(mesh(planks));
    g.position.set(p.x, p.y, p.z); g.rotation.y = p.rot; scene.add(g);
  }
  for (const p of byType.get('boat') ?? []) {
    const hull: Piece[] = [
      { geo: B(2.4, 1.1, 5.4), color: '#f1faee', matrix: mat4(0, 0.15, 0) }, { geo: B(2.42, 0.25, 5.42), color: '#1d3557', matrix: mat4(0, -0.3, 0) },
      { geo: new THREE.ConeGeometry(1.2, 1.6, 4, 1).rotateX(Math.PI / 2).rotateZ(Math.PI / 4).scale(1, 0.75, 1), color: '#f1faee', matrix: mat4(0, 0.2, -3.4) },
      { geo: B(1.8, 1.0, 1.8), color: '#e63946', matrix: mat4(0, 1.2, 0.8) }, { geo: B(1.6, 0.4, 0.06), color: '#9ad7ee', matrix: mat4(0, 1.35, -0.12) },
      { geo: B(0.1, 2.6, 0.1), color: METAL, matrix: mat4(0, 2.4, 0.8) },
    ];
    const g = new THREE.Group(); g.add(mesh(hull));
    add(g, p);
    bobbers.push({ o: g, phase: p.x * 0.1, y: p.y + 0.35 });
  }
  for (const p of byType.get('sign') ?? []) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
    const c = cv.getContext('2d')!;
    c.fillStyle = '#2d6a4f'; c.fillRect(0, 0, 512, 128);
    c.strokeStyle = '#f1faee'; c.lineWidth = 8; c.strokeRect(10, 10, 492, 108);
    c.fillStyle = '#f1faee'; c.font = 'bold 54px "Lilita One", Arial Black, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText((p.label ?? '').toUpperCase(), 256, 68, 470);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const g = new THREE.Group();
    g.add(mesh([{ geo: B(0.14, 2.6, 0.14), color: '#7f5539', matrix: mat4(-1.3, 1.3, 0) }, { geo: B(0.14, 2.6, 0.14), color: '#7f5539', matrix: mat4(1.3, 1.3, 0) }, { geo: B(3.0, 0.8, 0.08), color: '#1b4332', matrix: mat4(0, 2.05, 0) }]));
    const board = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 0.72), new THREE.MeshBasicMaterial({ map: tex }));
    board.position.set(0, 2.05, 0.05);
    const back = board.clone(); back.rotation.y = Math.PI; back.position.z = -0.05;
    g.add(board, back);
    add(g, p);
  }
  // wires between neighbouring power poles
  const poles = byType.get('pole') ?? [];
  const wire: number[] = [];
  for (let i = 0; i + 1 < poles.length; i++) {
    const a = poles[i], b = poles[i + 1];
    const d = Math.hypot(a.x - b.x, a.z - b.z);
    if (d > 70 || d < 10) continue;
    for (const off of [-0.9, 0, 0.9]) {
      const ax = a.x + Math.cos(a.rot) * off, az = a.z - Math.sin(a.rot) * off, bx = b.x + Math.cos(b.rot) * off, bz = b.z - Math.sin(b.rot) * off;
      for (let k = 0; k < 8; k++) {
        const t0 = k / 8, t1 = (k + 1) / 8, sag = (t: number) => -Math.sin(t * Math.PI) * d * 0.03;
        wire.push(ax + (bx - ax) * t0, a.y + 7.3 + (b.y - a.y) * t0 + sag(t0), az + (bz - az) * t0, ax + (bx - ax) * t1, a.y + 7.3 + (b.y - a.y) * t1 + sag(t1), az + (bz - az) * t1);
      }
    }
  }
  if (wire.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#2b2d42' })));
  }

  // ------------------------------------------------ ladders: steel rails + rungs, with hoops above the roof edge
  const ladderPieces: Piece[] = [];
  for (const p of byType.get('ladder') ?? []) {
    const h = p.s, top = h + 0.95, rot = mat4(p.x, p.y, p.z, 0, p.rot, 0);
    const at = (x: number, y: number, z: number, geo: THREE.BufferGeometry, color: string) => ladderPieces.push({ geo, color, matrix: rot.clone().multiply(mat4(x, y, z)) });
    for (const x of [-0.29, 0.29]) {
      at(x, top / 2, 0.04, B(0.07, top, 0.07), '#5f6b7a');
      // bolts holding it to the wall
      for (let y = 1.2; y < h; y += 2.4) at(x, y, -0.06, B(0.05, 0.08, 0.14), DARK);
    }
    for (let y = 0.32; y < top - 0.1; y += 0.34) at(0, y, 0.04, B(0.56, 0.045, 0.06), y > h ? '#5f6b7a' : '#c2c9d1');
    // grab hoops over the top
    for (const x of [-0.29, 0.29]) at(x, top, -0.35, B(0.07, 0.07, 0.8), '#ffb703');
    at(0, 0.02, 0.04, B(0.75, 0.04, 0.3), '#ffb703'); // a painted step at the bottom
  }
  if (ladderPieces.length) scene.add(mesh(ladderPieces));

  // ------------------------------------------------ ziplines: poles, a steel cable, and glowing arrow signs
  const zipPieces: Piece[] = [], zipGlow: Piece[] = [];
  const cable = new THREE.Vector3(), up3 = new THREE.Vector3(0, 1, 0);
  for (const Z of w.zips) {
    cable.set(Z.bx - Z.ax, Z.by - Z.ay, Z.bz - Z.az);
    const len = cable.length();
    const qq = new THREE.Quaternion().setFromUnitVectors(up3, cable.clone().normalize());
    const mid = new THREE.Matrix4().compose(new THREE.Vector3((Z.ax + Z.bx) / 2, (Z.ay + Z.by) / 2, (Z.az + Z.bz) / 2), qq, new THREE.Vector3(1, 1, 1));
    zipPieces.push({ geo: CY(0.035, 0.035, len, 5), color: '#2b2d42', matrix: mid });
    for (const [x, y, z, ox, oz] of [[Z.ax, Z.ay, Z.az, Z.bx, Z.bz], [Z.bx, Z.by, Z.bz, Z.ax, Z.az]]) {
      const g = terrainAt(w, x, z), face = Math.atan2(ox - x, oz - z);
      const base = mat4(x, g, z, 0, face, 0);
      const at = (px: number, py: number, pz: number, geo: THREE.BufferGeometry, color: string, glow = false) => (glow ? zipGlow : zipPieces).push({ geo, color, matrix: base.clone().multiply(mat4(px, py, pz)) });
      const hh = y - g + 0.9;
      at(0, hh / 2, 0, CY(0.16, 0.12, hh, 8), '#ffb703');
      at(0, hh - 0.05, 0.1, B(0.16, 0.16, 0.5), DARK);
      at(0, y - g, 0.2, CY(0.14, 0.14, 0.1, 10).rotateZ(Math.PI / 2), '#e9ecef'); // pulley
      at(0, 0.15, 0, CY(0.55, 0.65, 0.3, 10), '#6c757d'); // concrete footing
      // arrow sign pointing along the line
      at(0, 2.1, 0.2, B(0.62, 0.62, 0.05), '#2b2d42');
      at(0, 2.18, 0.24, new THREE.ConeGeometry(0.2, 0.26, 3), '#7cf2ff', true);
      at(0, 1.98, 0.24, B(0.1, 0.22, 0.03), '#7cf2ff', true);
    }
  }
  if (zipPieces.length) scene.add(mesh(zipPieces));
  if (zipGlow.length) scene.add(mesh(zipGlow, true));

  // ------------------------------------------------ spring pads: a metal ring with a pulsing glowing face
  const padPulses: THREE.Mesh[] = [];
  for (const p of byType.get('pad') ?? []) {
    const g = new THREE.Group();
    g.add(mesh([
      { geo: CY(0.98, 1.05, 0.12, 20), color: '#3d405b', matrix: mat4(0, 0.06, 0) },
      ...[0, 1, 2, 3, 4, 5].map((k) => ({ geo: B(0.16, 0.13, 0.3), color: '#ffb703', matrix: mat4(Math.cos(k * 1.047) * 0.92, 0.07, Math.sin(k * 1.047) * 0.92, 0, -k * 1.047, 0) })),
    ]));
    g.add(mesh([
      { geo: CY(0.8, 0.8, 0.04, 20), color: '#38f8b8', matrix: mat4(0, 0.13, 0) },
      ...[-0.3, 0.15].map((z) => ({ geo: new THREE.ConeGeometry(0.28, 0.3, 3).rotateX(-Math.PI / 2).scale(1, 0.2, 1), color: '#effff8', matrix: mat4(0, 0.16, z) })),
    ], true));
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 24).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color('#38f8b8').multiplyScalar(4), transparent: true, opacity: 0.8, depthWrite: false }));
    ring.position.y = 0.2; g.add(ring); padPulses.push(ring);
    add(g, p);
  }

  // ------------------------------------------------ caves: rock shell, boulders on top, glowing crystals
  const rockPieces: Piece[] = [], crystalPieces: Piece[] = [];
  const caveSolids = w.solids.filter((o) => o.k === SK.Cave);
  for (const o of caveSolids) rockPieces.push({ geo: B(o.x1 - o.x0, o.y1 - o.y0, o.z1 - o.z0), color: '#6f6658', matrix: mat4((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, (o.z0 + o.z1) / 2) });
  w.caves.forEach((c, ci) => {
    const nx = -c.dz, nz = c.dx;
    for (let k = 0; k < 26; k++) {
      const t = -c.len / 2 + (k / 25) * c.len, side = hash2(k, ci, 77) * 2 - 1;
      const s = 2.2 + hash2(k, ci, 78) * 2.4;
      const x = c.x + c.dx * t + nx * side * (c.width / 2 + 1.6), z = c.z + c.dz * t + nz * side * (c.width / 2 + 1.6);
      rockPieces.push({ geo: new THREE.DodecahedronGeometry(s, 0), color: k % 3 ? '#857a6a' : '#6d8f4e', matrix: mat4(x, c.ceil + 1.6 + hash2(k, ci, 79) * 1.2, z, k, k * 2, 0, 1.2, 0.7, 1.2) });
    }
    for (const end of [-1, 1]) for (const side of [-1, 1]) {
      const x = c.x + c.dx * end * (c.len / 2) + nx * side * (c.width / 2 + 1.3), z = c.z + c.dz * end * (c.len / 2) + nz * side * (c.width / 2 + 1.3);
      rockPieces.push({ geo: new THREE.DodecahedronGeometry(2.0, 0), color: '#7a7062', matrix: mat4(x, c.floor + 2.2, z, side, end, 0, 1, 1.6, 1) });
    }
    for (const cr of c.crystals) {
      const col = ['#3ee6ff', '#b388ff', '#ff5fa2'][cr.c];
      crystalPieces.push({ geo: new THREE.OctahedronGeometry(cr.s, 0), color: col, matrix: mat4(cr.x, cr.y, cr.z, 0.3, cr.x, 0.2, 0.6, 1.6, 0.6) });
      crystalPieces.push({ geo: new THREE.OctahedronGeometry(cr.s * 0.6, 0), color: col, matrix: mat4(cr.x + 0.2, cr.y - 0.2, cr.z + 0.1, -0.4, cr.z, 0.3, 0.6, 1.5, 0.6) });
    }
  });
  if (rockPieces.length) { const r = mesh(rockPieces); r.receiveShadow = true; scene.add(r); }
  if (crystalPieces.length) scene.add(mesh(crystalPieces, true));

  // ------------------------------------------------ smoke puffs from chimneys
  const puffGeo = new THREE.IcosahedronGeometry(1, 1);
  const puffs: { m: THREE.Mesh; life: number; v: THREE.Vector3 }[] = [];
  let smokeT = 0;

  return {
    setBeacons(ready) { beaconLights.forEach((g, i) => { (g.material as THREE.MeshBasicMaterial).color.set(ready[i] === false ? '#8a8a99' : '#4ade80').multiplyScalar(ready[i] === false ? 1 : 5); }); },
    setVaults(open) { for (const [id, d] of vaultDoors) d.visible = !open.has(id); },
    update(dt, t, cam) {
      for (const s of spinners) s.o.rotation[s.axis] += s.speed * dt;
      for (const f of flames) { const k = 0.85 + Math.sin(t * 13 + f.position.x) * 0.1 + Math.sin(t * 7.3) * 0.08; f.scale.set(1, k, 1); f.rotation.y += dt * 2; }
      for (const b of blinkers) b.visible = Math.sin(t * 3) > 0;
      for (const r of padPulses) {
        const k = (t * 0.9 + r.parent!.position.x * 0.01) % 1;
        r.position.y = 0.2 + k * 2.4; r.scale.setScalar(1 - k * 0.45);
        (r.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.8;
      }
      for (const b of bobbers) { b.o.position.y = b.y + Math.sin(t * 1.3 + b.phase) * 0.12; b.o.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.04; }
      smokeT -= dt;
      if (smokeT <= 0) {
        smokeT = 0.35;
        for (const src of smokeSources) {
          if (src.distanceToSquared(cam) > 600 * 600) continue;
          const pm = new THREE.Mesh(puffGeo, new THREE.MeshToonMaterial({ color: '#d9d9de', gradientMap: softRamp, transparent: true, opacity: 0.85 }));
          pm.position.copy(src); pm.scale.setScalar(0.9);
          scene.add(pm);
          puffs.push({ m: pm, life: 6, v: new THREE.Vector3(1.2, 2.2, 0.4) });
        }
      }
      for (const p of puffs) { p.life -= dt; p.m.position.addScaledVector(p.v, dt); p.m.scale.multiplyScalar(1 + dt * 0.35); (p.m.material as THREE.MeshToonMaterial).opacity = Math.max(0, p.life / 6) * 0.85; }
      for (let i = puffs.length - 1; i >= 0; i--) if (puffs[i].life <= 0) { scene.remove(puffs[i].m); (puffs[i].m.material as THREE.Material).dispose(); puffs.splice(i, 1); }
    },
  };
}

export const PROP_ANIMATED = ANIMATED;
