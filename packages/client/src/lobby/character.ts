import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { outlineMaterial, part, softRamp, toonVertex } from './toon';
import { GeoBuilder, mergeColored, type Piece } from '../game/geo';
import { itemMesh, muzzleOffset } from '../game/items3d';
import { weaponDef } from '@dropzone/shared';

/**
 * The Dropzone crew: original stylised characters with a proper rig (hips, chest, shoulders,
 * elbows, knees), shaped clothes, faces, and their own hair, headgear and accessories.
 *
 *   root ── body (lean, bob)
 *            ├─ hips ── legL ── kneeL        (thigh, shin, boot)
 *            │      └─ legR ── kneeR
 *            └─ chest (twists) ── armL ── elbowL   (upper arm, forearm, glove)
 *                               ├─ armR ── elbowR ── held item
 *                               └─ head
 */
export type HairStyle = 'swept' | 'spiky' | 'bob' | 'bun' | 'afro' | 'buzz' | 'ponytail' | 'mohawk';
export type Hat = 'beanie' | 'cap' | 'capBack' | 'headband' | 'goggles' | 'helmet' | 'beret' | 'none';
export type Top = 'hoodie' | 'jacket' | 'vest' | 'parka' | 'armor';
export type Acc = 'scarf' | 'sunglasses' | 'visor' | 'kneepads' | 'freckles' | 'scar' | 'shoulderpads';
export interface Skin {
  name: string;
  /** Main outfit colour (also used for avatars and far-away figures). */
  hoodie: string;
  /** Accent: zips, cuffs, straps, the glider. */
  trim: string;
  pants: string;
  /** Hat colour (or a second accent when there's no hat). */
  beanie: string;
  skinTone: string;
  hair: string;
  hairStyle: HairStyle; hat: Hat; top: Top; acc: Acc[];
  eyes: string; boots: string;
}
export const SKINS: Skin[] = [
  { name: 'Trailblazer', hoodie: '#ff7a2f', trim: '#ffd23f', pants: '#2d3a5c', beanie: '#2bb3a3', skinTone: '#f2c39b', hair: '#4a2c1a', hairStyle: 'swept', hat: 'beanie', top: 'hoodie', acc: ['kneepads'], eyes: '#3f8f4f', boots: '#5a3a24' },
  { name: 'Tidepool', hoodie: '#2f8cff', trim: '#9ef0ff', pants: '#24304a', beanie: '#ffcf33', skinTone: '#c98e63', hair: '#1b1b1b', hairStyle: 'buzz', hat: 'cap', top: 'jacket', acc: [], eyes: '#5a3a22', boots: '#e9ecef' },
  { name: 'Moss', hoodie: '#4caf50', trim: '#d6f36b', pants: '#5b4636', beanie: '#d6f36b', skinTone: '#ffd8b8', hair: '#c46a2b', hairStyle: 'ponytail', hat: 'none', top: 'hoodie', acc: ['freckles'], eyes: '#2e7d32', boots: '#3b2a20' },
  { name: 'Ultraviolet', hoodie: '#8f4dff', trim: '#ff6fd8', pants: '#1f1d33', beanie: '#ff6fd8', skinTone: '#8a5a3c', hair: '#140d08', hairStyle: 'afro', hat: 'headband', top: 'jacket', acc: [], eyes: '#4a2a14', boots: '#ff6fd8' },
  { name: 'Ember', hoodie: '#e53945', trim: '#ffb703', pants: '#2b2d42', beanie: '#2b2d42', skinTone: '#f0b98d', hair: '#2a1a12', hairStyle: 'spiky', hat: 'goggles', top: 'jacket', acc: ['shoulderpads'], eyes: '#6b3d1f', boots: '#1d1d24' },
  { name: 'Glacier', hoodie: '#e9f4ff', trim: '#4cc9f0', pants: '#3a506b', beanie: '#4cc9f0', skinTone: '#ffe0c7', hair: '#e8d27a', hairStyle: 'bob', hat: 'none', top: 'parka', acc: ['scarf'], eyes: '#3d7fd1', boots: '#8d99ae' },
  { name: 'Citrus', hoodie: '#ffd166', trim: '#ef476f', pants: '#264653', beanie: '#06d6a0', skinTone: '#a86b47', hair: '#06d6a0', hairStyle: 'mohawk', hat: 'none', top: 'vest', acc: ['sunglasses'], eyes: '#3a2414', boots: '#ef476f' },
  { name: 'Midnight', hoodie: '#22223b', trim: '#f72585', pants: '#141420', beanie: '#4361ee', skinTone: '#d9a07a', hair: '#0e0e0e', hairStyle: 'bun', hat: 'none', top: 'jacket', acc: ['visor'], eyes: '#2a1a12', boots: '#2b2d42' },
  // boss and guard outfits (not selectable in the locker)
  { name: 'Boss', hoodie: '#1c1c28', trim: '#ffb703', pants: '#101018', beanie: '#e63946', skinTone: '#b07850', hair: '#000000', hairStyle: 'buzz', hat: 'beret', top: 'armor', acc: ['scar', 'shoulderpads'], eyes: '#7a1f1f', boots: '#101018' },
  { name: 'Guard', hoodie: '#5c677d', trim: '#e63946', pants: '#33415c', beanie: '#33415c', skinTone: '#e0ac85', hair: '#2b1a10', hairStyle: 'buzz', hat: 'helmet', top: 'armor', acc: ['kneepads'], eyes: '#3a2a1a', boots: '#1d1d24' },
];

const gliderMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide });

/** Collapse a joint's many small meshes into one mesh + one outline (2 draw calls instead of dozens). */
function bake(group: THREE.Group) {
  const meshes = group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh);
  if (!meshes.length) return;
  const all: Piece[] = [], outlined: Piece[] = [];
  for (const m of meshes) {
    m.updateMatrix();
    const piece: Piece = { geo: m.geometry, color: m.userData.color, matrix: m.matrix.clone() };
    all.push(piece);
    if (m.userData.outline) outlined.push(piece);
    group.remove(m);
  }
  const mesh = new THREE.Mesh(mergeColored(all), toonVertex);
  mesh.castShadow = true;
  if (outlined.length) mesh.add(new THREE.Mesh(mergeColored(outlined), outlineMaterial));
  for (const m of meshes) m.geometry.dispose();
  group.add(mesh);
}

// ------------------------------------------------------------------ shape helpers
const rbox = (w: number, h: number, d: number, r = 0.03) => new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001));
const cyl = (rt: number, rb: number, h: number, seg = 14) => new THREE.CylinderGeometry(rt, rb, h, seg);
const sph = (r: number, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
const mix = (a: string, b: string, k: number) => '#' + new THREE.Color(a).lerp(new THREE.Color(b), k).getHexString();
/** Add a part at a position/rotation/scale. */
function put(g: THREE.Group, geo: THREE.BufferGeometry, color: string, p: [number, number, number], o: { r?: [number, number, number]; s?: [number, number, number]; outline?: boolean } = {}) {
  const m = part(geo, color, o.outline ?? true);
  m.position.set(...p);
  if (o.r) m.rotation.set(...o.r);
  if (o.s) m.scale.set(...o.s);
  g.add(m);
  return m;
}

export type PoseMode = 'idle' | 'run' | 'air' | 'fall' | 'glide' | 'swim' | 'knocked' | 'drive' | 'sit' | 'slide' | 'mantle' | 'hurdle' | 'climb' | 'zip' | 'launch';
export interface Pose {
  mode: PoseMode; speed: number; dive: number; hold?: 'none' | 'gun' | 'item'; pitch: number; sprint?: boolean; crouch?: boolean; using?: boolean; emote?: number;
  /** 0..1 through a mantle or hurdle. */
  phase?: number;
  /** Vertical speed (ladders). */
  vy?: number;
  /** Direction of travel relative to facing, radians (0 = forward, ±π/2 = strafing, π = backwards). */
  moveAngle?: number;
}
const damp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Joint targets for one frame. */
interface Rig {
  lean: number; by: number; roll: number; hipsYaw: number; twist: number;
  hipL: number; hipR: number; hipLz: number; hipRz: number; kneeL: number; kneeR: number;
  shLx: number; shLy: number; shLz: number; shRx: number; shRy: number; shRz: number; elL: number; elR: number;
  headX: number; headY: number;
}
const restRig = (): Rig => ({
  lean: 0, by: 0, roll: 0, hipsYaw: 0, twist: 0,
  hipL: 0, hipR: 0, hipLz: -0.03, hipRz: 0.03, kneeL: 0.05, kneeR: 0.05,
  shLx: 0.05, shLy: 0, shLz: -0.14, shRx: 0.05, shRy: 0, shRz: 0.14, elL: -0.18, elR: -0.18,
  headX: 0, headY: 0,
});

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group(); private armR = new THREE.Group();
  private elbowL = new THREE.Group(); private elbowR = new THREE.Group();
  private legL = new THREE.Group(); private legR = new THREE.Group();
  private kneeL = new THREE.Group(); private kneeR = new THREE.Group();
  private glider = new THREE.Group();
  private held = new THREE.Group();
  private heldKey = '';
  private cycle = 0;
  private gliderOpen = 0;
  private phase = Math.random() * 10;
  private hop = 0;
  private wave = 0;
  private squash = 0;
  private roll = 0;
  private cur = restRig();
  /** The little trolley you hang from on a zipline. */
  private trolley: THREE.Group;
  lookTarget = new THREE.Vector3(0, 1.6, 10);

  constructor(public skinIndex: number) {
    this.build(SKINS[skinIndex % SKINS.length]);
    this.trolley = new THREE.Group();
    const dark = new THREE.MeshToonMaterial({ color: '#2b2d42' }), yellow = new THREE.MeshToonMaterial({ color: '#ffb703' });
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.07, 10).rotateZ(Math.PI / 2), dark);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.32, 0.12), yellow); frame.position.y = -0.16;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6).rotateZ(Math.PI / 2), dark); bar.position.y = -0.32;
    this.trolley.add(wheel, frame, bar);
    this.trolley.position.set(0, 2.05 + 0.02, 0.05);
    this.trolley.visible = false;
    this.root.add(this.trolley);
  }

  /** Hit the ground hard: squash down for a moment (0..1). */
  land(intensity: number) { this.squash = Math.max(this.squash, Math.min(1, intensity)); }

  setSkin(i: number) {
    if (i === this.skinIndex) return;
    this.skinIndex = i;
    this.dispose();
    this.root.remove(this.body, this.glider);
    this.glider = new THREE.Group();
    this.body = new THREE.Group(); this.hips = new THREE.Group(); this.chest = new THREE.Group(); this.head = new THREE.Group();
    this.armL = new THREE.Group(); this.armR = new THREE.Group(); this.elbowL = new THREE.Group(); this.elbowR = new THREE.Group();
    this.legL = new THREE.Group(); this.legR = new THREE.Group(); this.kneeL = new THREE.Group(); this.kneeR = new THREE.Group();
    this.build(SKINS[i % SKINS.length]);
    this.heldKey = '';
  }

  // ================================================================== the model
  private build(s: Skin) {
    const B = this.body, armor = s.top === 'armor';
    this.root.add(B);
    // The model is built facing +z, where +x would be the character's *left*. Mirroring the body puts
    // "armR" (the arm that holds the weapon) on the character's right, matching the right-shoulder
    // camera and where shots come from.
    B.scale.x = -1;
    B.add(this.hips, this.chest);
    this.hips.position.y = 0.95;
    this.chest.position.y = 1.0;

    // ---------------------------------------------------------------- hips, belt
    const H = this.hips;
    put(H, rbox(0.4, 0.2, 0.27, 0.08), s.pants, [0, 0.02, 0]);
    put(H, new THREE.TorusGeometry(0.2, 0.032, 8, 24).rotateX(Math.PI / 2), '#2a2018', [0, 0.1, 0], { s: [1.04, 1, 0.72], outline: false });
    put(H, rbox(0.08, 0.06, 0.03, 0.01), '#d8b25a', [0, 0.1, 0.15], { outline: false });
    put(H, rbox(0.09, 0.09, 0.06, 0.02), mix(s.pants, '#000000', 0.3), [0.17, 0.08, 0.08], { outline: false }); // belt pouch

    // ---------------------------------------------------------------- legs
    for (const [leg, knee, side] of [[this.legL, this.kneeL, -1], [this.legR, this.kneeR, 1]] as const) {
      leg.position.set(0.12 * side, 0, 0);
      H.add(leg);
      put(leg, cyl(0.125, 0.098, 0.47), s.pants, [0, -0.22, 0]);
      put(leg, rbox(0.05, 0.13, 0.14, 0.022), mix(s.pants, '#000000', 0.18), [0.115 * side, -0.24, 0.0], { outline: false }); // cargo pocket
      knee.position.y = -0.45;
      leg.add(knee);
      put(knee, sph(0.1, 14, 10), s.pants, [0, 0, 0]);
      put(knee, cyl(0.098, 0.084, 0.34), s.pants, [0, -0.17, 0]);
      if (s.acc.includes('kneepads')) put(knee, rbox(0.15, 0.13, 0.07, 0.03), s.trim, [0, -0.02, 0.085]);
      // boot: cuff, upper, toe cap, laces, chunky sole
      put(knee, cyl(0.1, 0.1, 0.07), mix(s.boots, '#000000', 0.15), [0, -0.33, 0]);
      put(knee, rbox(0.2, 0.15, 0.3, 0.06), s.boots, [0, -0.4, 0.04]);
      put(knee, rbox(0.19, 0.08, 0.1, 0.035), mix(s.boots, '#ffffff', 0.25), [0, -0.43, 0.15], { outline: false });
      for (let k = 0; k < 3; k++) put(knee, rbox(0.1, 0.012, 0.02, 0.005), '#f1ecd8', [0, -0.335 - k * 0.02, 0.1 + k * 0.025], { r: [-0.6, 0, 0], outline: false });
      put(knee, rbox(0.22, 0.05, 0.33, 0.02), '#1c1612', [0, -0.47, 0.045]);
    }

    // ---------------------------------------------------------------- torso: a shaped jacket
    const C = this.chest;
    const prof: [number, number][] = [[0.2, -0.03], [0.208, 0.04], [0.198, 0.14], [0.225, 0.3], [0.255, 0.42], [0.258, 0.5], [0.228, 0.57], [0.13, 0.63], [0.001, 0.65]];
    const torso = new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), 22);
    put(C, torso, s.hoodie, [0, 0, 0], { s: [1.06, 1, 0.78] });
    put(C, new THREE.TorusGeometry(0.205, 0.03, 8, 26).rotateX(Math.PI / 2), s.trim, [0, 0.01, 0], { s: [1.06, 1, 0.78], outline: false }); // hem
    if (s.top !== 'vest' && !armor) put(C, rbox(0.025, 0.5, 0.02, 0.008), s.trim, [0, 0.3, 0.19], { outline: false }); // zip
    put(C, new THREE.TorusGeometry(0.12, 0.045, 8, 22).rotateX(Math.PI / 2), mix(s.hoodie, '#000000', 0.12), [0, 0.6, 0.0], { s: [1.05, 1, 0.9] }); // collar
    if (s.top === 'hoodie' || s.top === 'parka') {
      put(C, sph(0.17, 16, 12), mix(s.hoodie, '#000000', 0.08), [0, 0.58, -0.13], { s: [1.25, 0.72, 0.8] }); // hood, down
      put(C, cyl(0.012, 0.012, 0.16, 5), s.trim, [-0.06, 0.48, 0.19], { outline: false }); // drawstrings
      put(C, cyl(0.012, 0.012, 0.16, 5), s.trim, [0.06, 0.48, 0.19], { outline: false });
      put(C, rbox(0.3, 0.13, 0.05, 0.03), mix(s.hoodie, '#000000', 0.1), [0, 0.13, 0.17], { outline: false }); // front pouch
    }
    if (s.top === 'parka') put(C, new THREE.TorusGeometry(0.17, 0.05, 8, 20), '#f4efe6', [0, 0.6, -0.13], { r: [0.3, 0, 0], s: [1.25, 1, 1] }); // fur rim
    if (s.top === 'jacket') {
      put(C, rbox(0.11, 0.09, 0.03, 0.015), mix(s.hoodie, '#000000', 0.15), [0.12, 0.4, 0.185], { r: [0, 0.25, 0], outline: false }); // chest pocket
      put(C, rbox(0.024, 0.024, 0.01, 0.006), s.trim, [0.12, 0.43, 0.205], { outline: false });
      put(C, rbox(0.42, 0.04, 0.2, 0.015), s.trim, [0, 0.47, 0.03], { s: [1, 1, 1], outline: false }); // yoke stripe
    }
    if (s.top === 'vest') {
      put(C, rbox(0.06, 0.4, 0.03, 0.01), s.trim, [-0.09, 0.32, 0.185], { outline: false });
      put(C, rbox(0.06, 0.4, 0.03, 0.01), s.trim, [0.09, 0.32, 0.185], { outline: false });
    }
    if (armor) {
      put(C, rbox(0.46, 0.36, 0.1, 0.05), mix(s.hoodie, '#ffffff', 0.12), [0, 0.36, 0.15]); // chest plate
      put(C, rbox(0.3, 0.05, 0.02, 0.01), s.trim, [0, 0.47, 0.205], { outline: false });
      for (let k = 0; k < 3; k++) put(C, rbox(0.075, 0.1, 0.04, 0.015), mix(s.hoodie, '#000000', 0.25), [-0.12 + k * 0.12, 0.17, 0.19], { outline: false }); // mag pouches
    }
    if (s.acc.includes('scarf')) {
      put(C, new THREE.TorusGeometry(0.125, 0.055, 10, 22).rotateX(Math.PI / 2), s.trim, [0, 0.64, 0.01]);
      put(C, rbox(0.1, 0.24, 0.05, 0.025), s.trim, [0.08, 0.5, 0.17], { r: [0.15, 0, 0.12] });
    }
    // backpack with straps and a bedroll
    put(C, rbox(0.38, 0.42, 0.17, 0.06), '#6b4f3a', [0, 0.36, -0.27]);
    put(C, rbox(0.4, 0.14, 0.2, 0.05), s.trim, [0, 0.52, -0.27]);
    put(C, rbox(0.22, 0.14, 0.06, 0.03), '#5a412f', [0, 0.27, -0.37], { outline: false });
    put(C, cyl(0.075, 0.075, 0.44, 12), '#9b5a33', [0, 0.12, -0.3], { r: [0, 0, Math.PI / 2] });
    for (const x of [-0.13, 0.13]) {
      put(C, rbox(0.04, 0.2, 0.025, 0.01), mix(s.hoodie, '#000000', 0.38), [x, 0.48, 0.19], { r: [0.12, 0, 0], outline: false });
      put(C, rbox(0.04, 0.03, 0.2, 0.01), mix(s.hoodie, '#000000', 0.38), [x, 0.6, 0.03], { outline: false });
    }

    // ---------------------------------------------------------------- arms
    const sleeve = s.top === 'vest' ? s.skinTone : s.hoodie, upperSleeve = s.top === 'vest' ? s.trim : s.hoodie;
    for (const [arm, elbow, side] of [[this.armL, this.elbowL, -1], [this.armR, this.elbowR, 1]] as const) {
      arm.position.set(0.275 * side, 0.55, 0);
      arm.rotation.order = 'YXZ';
      C.add(arm);
      put(arm, sph(0.095, 14, 10), upperSleeve, [0, 0, 0]);
      put(arm, cyl(0.088, 0.076, 0.3), s.top === 'vest' ? s.skinTone : s.hoodie, [0, -0.15, 0]);
      if (s.top === 'vest') put(arm, cyl(0.096, 0.09, 0.1), s.trim, [0, -0.04, 0]); // t-shirt sleeve
      if (s.acc.includes('shoulderpads') || s.top === 'armor') put(arm, rbox(0.2, 0.08, 0.2, 0.035), armor ? mix(s.hoodie, '#ffffff', 0.12) : s.trim, [0.02 * side, 0.08, 0], { r: [0, 0, -0.35 * side] });
      elbow.position.y = -0.3;
      arm.add(elbow);
      put(elbow, sph(0.078, 12, 10), sleeve, [0, 0, 0]);
      put(elbow, cyl(0.077, 0.064, 0.25), sleeve, [0, -0.125, 0]);
      put(elbow, cyl(0.075, 0.075, 0.055), s.trim, [0, -0.245, 0], { outline: false }); // cuff
      put(elbow, sph(0.082, 14, 12), '#2f3036', [0, -0.33, 0.005], { s: [0.92, 1.12, 0.82] }); // glove
      put(elbow, new THREE.CapsuleGeometry(0.03, 0.05, 4, 8), '#2f3036', [-0.06 * side, -0.31, 0.045], { r: [0.3, 0, 0.5 * side] }); // thumb
    }

    // ---------------------------------------------------------------- head and face
    const Hd = this.head;
    Hd.position.set(0, 0.64, 0);
    C.add(Hd);
    const R = 0.23, hy = 0.22; // skull radius, centre height
    put(Hd, cyl(0.075, 0.085, 0.12), s.skinTone, [0, 0.03, 0], { outline: false });
    put(Hd, sph(R, 28, 22), s.skinTone, [0, hy, 0], { s: [0.96, 1.06, 0.98] });
    put(Hd, sph(0.12, 16, 12), s.skinTone, [0, hy - 0.11, 0.05], { s: [1.25, 0.8, 1.15], outline: false }); // jaw/cheeks
    for (const side of [-1, 1]) {
      put(Hd, sph(0.05, 12, 10), mix(s.skinTone, '#a0522d', 0.06), [0.215 * side, hy - 0.01, -0.01], { s: [0.45, 1, 0.8], outline: false }); // ears
      // eyes: white, coloured iris, pupil, a highlight
      const ex = 0.083 * side, ey = hy + 0.015, ez = 0.188;
      put(Hd, sph(0.052, 14, 12), '#ffffff', [ex, ey, ez], { s: [0.9, 1.18, 0.45], outline: false });
      put(Hd, sph(0.036, 14, 12), s.eyes, [ex + 0.004 * side, ey - 0.004, ez + 0.019], { s: [0.88, 1.1, 0.4], outline: false });
      put(Hd, sph(0.019, 10, 8), '#14101e', [ex + 0.004 * side, ey - 0.004, ez + 0.03], { s: [0.9, 1.1, 0.4], outline: false });
      put(Hd, sph(0.0105, 8, 6), '#ffffff', [ex + 0.016, ey + 0.016, ez + 0.036], { outline: false });
      put(Hd, rbox(0.075, 0.019, 0.02, 0.009), s.acc.includes('scar') ? '#1b1b1b' : mix(s.hair, '#000000', 0.2), [ex, ey + 0.075, ez + 0.012], { r: [0, 0, -0.14 * side], outline: false }); // brows
      put(Hd, sph(0.036, 10, 8), mix(s.skinTone, '#ff6f7d', 0.35), [0.118 * side, hy - 0.06, 0.168], { s: [1, 0.62, 0.3], outline: false }); // cheeks
    }
    put(Hd, sph(0.027, 10, 8), mix(s.skinTone, '#a0522d', 0.12), [0, hy - 0.035, 0.226], { s: [1, 0.9, 0.8], outline: false }); // nose
    put(Hd, new THREE.TorusGeometry(0.04, 0.0095, 6, 14, Math.PI), '#7a3340', [0, hy - 0.088, 0.2], { r: [0.15, 0, Math.PI], outline: false }); // smile
    if (s.acc.includes('freckles')) for (let k = 0; k < 6; k++) put(Hd, sph(0.0065, 6, 5), '#b8673a', [(k < 3 ? -1 : 1) * (0.09 + (k % 3) * 0.022), hy - 0.045 + ((k * 7) % 3) * 0.008, 0.188], { outline: false });
    if (s.acc.includes('scar')) put(Hd, rbox(0.012, 0.09, 0.01, 0.004), '#7a2e2e', [0.11, hy, 0.19], { r: [0, 0, 0.35], outline: false });
    if (s.acc.includes('sunglasses')) {
      for (const side of [-1, 1]) put(Hd, rbox(0.11, 0.075, 0.025, 0.025), '#16131f', [0.085 * side, hy + 0.012, 0.218], { r: [0, 0.2 * side, 0], outline: false });
      put(Hd, rbox(0.05, 0.014, 0.014, 0.005), '#16131f', [0, hy + 0.025, 0.222], { outline: false });
      for (const side of [-1, 1]) put(Hd, rbox(0.012, 0.012, 0.18, 0.005), '#16131f', [0.2 * side, hy + 0.025, 0.12], { outline: false });
    }
    if (s.acc.includes('visor')) put(Hd, new THREE.TorusGeometry(0.232, 0.034, 6, 30, Math.PI * 0.85), s.trim, [0, hy + 0.015, 0.0], { r: [Math.PI / 2, 0, Math.PI * 0.075], s: [1.0, 1.06, 1.7], outline: false });

    // ---------------------------------------------------------------- hair
    const capGeo = (r: number, theta: number) => new THREE.SphereGeometry(r, 26, 16, 0, Math.PI * 2, 0, theta);
    const hairC = s.hair;
    const cap = (r = R * 1.06, theta = 1.3, tilt = -0.42) => put(Hd, capGeo(r, theta), hairC, [0, hy + 0.005, -0.01], { r: [tilt, 0, 0], s: [0.97, 1.06, 1] });
    switch (s.hairStyle) {
      case 'swept':
        cap();
        put(Hd, new THREE.CapsuleGeometry(0.05, 0.22, 4, 10), hairC, [0.03, hy + 0.15, 0.16], { r: [0.2, 0, 1.25] });
        break;
      case 'buzz': cap(R * 1.025, 1.4, -0.35); break;
      case 'spiky':
        cap();
        for (let k = 0; k < 9; k++) {
          const a = (k / 9) * Math.PI * 2, tilt = 0.55 + (k % 3) * 0.12;
          put(Hd, new THREE.ConeGeometry(0.06, 0.17, 6), hairC, [Math.sin(a) * 0.12, hy + 0.2, Math.cos(a) * 0.1 - 0.03], { r: [Math.cos(a) * tilt - 0.3, 0, -Math.sin(a) * tilt] });
        }
        break;
      case 'bob':
        cap(R * 1.08, 1.35);
        put(Hd, new THREE.SphereGeometry(R * 1.12, 26, 16, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9, 0.35, 1.55), hairC, [0, hy - 0.01, -0.01], { s: [1, 1.04, 1] });
        put(Hd, new THREE.CapsuleGeometry(0.05, 0.26, 4, 10), hairC, [0, hy + 0.14, 0.17], { r: [0.1, 0, Math.PI / 2] }); // fringe
        break;
      case 'bun':
        cap(R * 1.05, 1.35, -0.3);
        put(Hd, sph(0.095, 14, 12), hairC, [0, hy + 0.2, -0.14]);
        put(Hd, new THREE.TorusGeometry(0.06, 0.016, 6, 14).rotateX(1.0), s.trim, [0, hy + 0.15, -0.12], { outline: false });
        break;
      case 'afro':
        cap(R * 1.12, 1.45, -0.3);
        for (let k = 0; k < 18; k++) {
          const a = (k / 18) * Math.PI * 2 * 1.618, el = 0.25 + ((k * 5) % 7) / 7 * 1.0;
          const x = Math.sin(a) * Math.cos(el - 0.2), z = Math.cos(a) * Math.cos(el - 0.2) - 0.15, y = Math.sin(el);
          put(Hd, sph(0.1 + (k % 3) * 0.012, 12, 10), hairC, [x * 0.24, hy + 0.06 + y * 0.2, z * 0.22]);
        }
        break;
      case 'ponytail':
        cap(R * 1.06, 1.35, -0.32);
        put(Hd, new THREE.CapsuleGeometry(0.055, 0.24, 4, 10), hairC, [0, hy - 0.02, -0.26], { r: [0.45, 0, 0] });
        put(Hd, new THREE.TorusGeometry(0.05, 0.015, 6, 14).rotateX(1.2), s.trim, [0, hy + 0.1, -0.22], { outline: false });
        put(Hd, new THREE.CapsuleGeometry(0.045, 0.2, 4, 10), hairC, [-0.06, hy + 0.15, 0.17], { r: [0.2, 0, 1.4] });
        break;
      case 'mohawk':
        cap(R * 1.02, 1.35, -0.35);
        for (let k = 0; k < 6; k++) {
          const a = -0.5 + k * 0.32;
          put(Hd, rbox(0.045, 0.14, 0.09, 0.02), hairC, [0, hy + Math.cos(a) * 0.25, Math.sin(a) * 0.25], { r: [a, 0, 0] });
        }
        break;
    }

    // ---------------------------------------------------------------- headgear
    switch (s.hat) {
      case 'beanie':
        put(Hd, capGeo(R * 1.14, 1.5), s.beanie, [0, hy + 0.035, -0.01], { r: [-0.22, 0, 0], s: [1, 1.08, 1] });
        put(Hd, new THREE.TorusGeometry(R * 1.1, 0.05, 10, 30).rotateX(Math.PI / 2), mix(s.beanie, '#000000', 0.1), [0, hy + 0.07, -0.025], { r: [-0.22, 0, 0] });
        put(Hd, new THREE.IcosahedronGeometry(0.07, 1), s.trim, [0, hy + 0.3, -0.07]);
        break;
      case 'cap': case 'capBack': {
        const back = s.hat === 'capBack';
        put(Hd, capGeo(R * 1.07, 1.2), s.beanie, [0, hy + 0.02, -0.01], { r: [-0.22, 0, 0], s: [1, 0.95, 1.04] });
        put(Hd, cyl(0.15, 0.15, 0.022, 20), mix(s.beanie, '#000000', 0.12), [0, hy + 0.1, back ? -0.2 : 0.2], { r: [back ? -0.2 : 0.2, 0, 0], s: [0.95, 1, 0.8] });
        put(Hd, sph(0.022, 8, 6), s.trim, [0, hy + 0.255, -0.02], { outline: false });
        if (back) put(Hd, rbox(0.1, 0.035, 0.02, 0.008), s.trim, [0, hy + 0.12, 0.22], { outline: false });
        break;
      }
      case 'headband':
        put(Hd, new THREE.TorusGeometry(R * 1.05, 0.03, 8, 30).rotateX(Math.PI / 2), s.beanie, [0, hy + 0.1, 0], { r: [-0.25, 0, 0] });
        break;
      case 'goggles':
        put(Hd, new THREE.TorusGeometry(R * 1.06, 0.022, 6, 30).rotateX(Math.PI / 2), s.beanie, [0, hy + 0.13, 0], { r: [-0.3, 0, 0], outline: false });
        for (const side of [-1, 1]) {
          put(Hd, cyl(0.055, 0.055, 0.05, 16), '#3b3d4a', [0.075 * side, hy + 0.15, 0.17], { r: [Math.PI / 2 - 0.5, 0, 0] });
          put(Hd, cyl(0.042, 0.042, 0.02, 16), '#7cf2ff', [0.075 * side, hy + 0.16, 0.19], { r: [Math.PI / 2 - 0.5, 0, 0], outline: false });
        }
        break;
      case 'helmet':
        put(Hd, capGeo(R * 1.2, 1.62), s.beanie, [0, hy + 0.01, -0.01], { r: [-0.12, 0, 0], s: [1, 1.0, 1.05] });
        put(Hd, new THREE.SphereGeometry(R * 1.13, 22, 12, Math.PI / 2 - 0.85, 1.7, 1.15, 0.5), '#1d2d44', [0, hy + 0.0, 0.0], { outline: false }); // visor glass
        put(Hd, rbox(0.06, 0.05, 0.05, 0.015), s.trim, [0.2, hy + 0.13, 0.05], { outline: false });
        break;
      case 'beret':
        put(Hd, sph(0.2, 18, 12), s.beanie, [0.03, hy + 0.2, -0.01], { r: [0, 0, -0.3], s: [1.2, 0.36, 1.18] });
        put(Hd, rbox(0.06, 0.04, 0.02, 0.01), s.trim, [-0.12, hy + 0.17, 0.15], { outline: false });
        break;
    }

    for (const g of [this.hips, this.legL, this.legR, this.kneeL, this.kneeR, this.chest, this.armL, this.armR, this.elbowL, this.elbowR, this.head]) bake(g);
    this.held.position.set(0, -0.33, 0.03);
    this.elbowR.add(this.held);

    // glider: an original delta kite in the outfit's colours
    const g = new GeoBuilder();
    const N: [number, number, number] = [0, 3.3, 1.9], T: [number, number, number] = [0, 3.22, -1.0];
    for (const side of [-1, 1]) {
      const tip: [number, number, number] = [2.9 * side, 3.02, -1.25], M: [number, number, number] = [1.45 * side, 3.18, 0.33];
      g.tri(N, M, T, s.trim, [0, 1, 0]);
      g.tri(M, tip, T, s.hoodie, [0, 1, 0]);
      g.quad([0.62 * side, 2.2, 0.12], [0.66 * side, 2.2, 0.12], [0.04 * side, 3.24, 0.3], [0, 3.24, 0.3], '#2b2d42', [0, 0, 1]);
    }
    g.box(-0.035, 3.2, -1.0, 0.035, 3.27, 1.9, '#2b2d42', true);
    g.box(-2.2, 3.1, -0.42, 2.2, 3.16, -0.36, '#2b2d42', true);
    g.box(-0.66, 2.17, 0.09, 0.66, 2.23, 0.15, '#2b2d42', true);
    this.glider.add(new THREE.Mesh(g.build(), gliderMat));
    this.glider.visible = false;
    this.root.add(this.glider);
  }

  /** Put an item in the right hand (0 = nothing). */
  setHeld(item: number, rarity: number) {
    const key = item ? `${item}:${rarity}` : '';
    if (key === this.heldKey) return;
    this.heldKey = key;
    this.held.clear();
    if (!item) return;
    const m = itemMesh(item, rarity);
    const isWeapon = !!weaponDef(item);
    // weapon barrels run along the forearm; small items sit in the palm
    if (isWeapon) { m.rotation.set(-Math.PI / 2, 0, Math.PI, 'XYZ'); m.position.set(0, -0.02, 0.02); }
    else { m.position.set(0, -0.05, 0.08); m.scale.setScalar(0.9); }
    this.held.add(m);
  }

  // ================================================================== animation
  /** In-match animation: blends every joint toward the pose for the current movement state. */
  animate(dt: number, t: number, p: Pose) {
    const k = 1 - Math.exp(-dt * 14);
    const r = restRig();
    const sp = Math.min(1.15, p.speed / 7.6);
    const gun = p.hold === 'gun';
    const tt = t + this.phase;
    let spin = 0;
    switch (p.mode) {
      case 'idle': {
        const br = Math.sin(tt * 2.1);
        r.by = br * 0.008; r.shLx = Math.sin(tt * 1.05) * 0.04; r.shRx = -r.shLx; r.headY = Math.sin(tt * 0.4) * 0.15;
        r.hipLz = -0.05; r.hipRz = 0.05; r.kneeL = 0.06; r.kneeR = 0.1; r.roll = Math.sin(tt * 0.35) * 0.02;
        break;
      }
      case 'run': {
        // which way are we going relative to where we face? turn the hips toward it, run backwards when backing up
        const ma = p.moveAngle ?? 0, back = Math.abs(ma) > 2.2;
        const strafe = back ? 0 : Math.max(-1.1, Math.min(1.1, ma));
        this.cycle += dt * (5.4 + p.speed * 1.12) * (back ? -1 : 1);
        const c = this.cycle, sw = Math.sin(c), amp = 0.35 + sp * 0.6;
        r.hipL = -sw * amp; r.hipR = sw * amp;
        // knees fold as each leg swings through
        r.kneeL = 0.12 + Math.max(0, Math.sin(c - 1.2)) * amp * 1.5;
        r.kneeR = 0.12 + Math.max(0, Math.sin(c + Math.PI - 1.2)) * amp * 1.5;
        r.shLx = sw * amp * 0.85; r.shRx = -sw * amp * 0.85; r.shLz = -0.12; r.shRz = 0.12;
        r.elL = r.elR = -0.55 - sp * 0.7;
        r.lean = back ? -0.05 : 0.05 + sp * 0.16;
        r.by = Math.abs(Math.cos(c)) * 0.065 * amp - 0.025 * sp;
        r.twist = sw * 0.16 * amp; r.headY = -r.twist * 0.8;
        r.hipsYaw = -strafe * 0.85; // (the body is mirrored, so a negative turn points the legs to the character's left)
        break;
      }
      case 'air':
        r.hipL = -0.65; r.kneeL = 1.0; r.hipR = 0.15; r.kneeR = 0.55;
        r.shLx = -0.45; r.shRx = -0.45; r.shLz = -0.75; r.shRz = 0.75; r.elL = r.elR = -0.4; r.lean = 0.05;
        break;
      case 'fall': {
        const wob = Math.sin(tt * 9);
        r.lean = 1.3 + p.dive * 0.75; r.headX = -0.55 + p.dive * 0.4;
        r.shLz = -1.6 + p.dive * 1.3 + wob * 0.05; r.shRz = 1.6 - p.dive * 1.3 - wob * 0.05; r.shLx = r.shRx = p.dive * 0.25; r.elL = r.elR = -0.35;
        r.hipL = 0.15 + wob * 0.06; r.hipR = 0.1 - wob * 0.06; r.kneeL = 0.5; r.kneeR = 0.65;
        break;
      }
      case 'glide': {
        const sway = Math.sin(tt * 1.7);
        r.lean = 0.12; r.shLx = r.shRx = -2.85; r.shLz = -0.18; r.shRz = 0.18; r.elL = r.elR = -0.25;
        r.hipL = 0.1 + sway * 0.12; r.hipR = -0.05 - sway * 0.1; r.kneeL = 0.35; r.kneeR = 0.5; r.headX = 0.1;
        break;
      }
      case 'swim': {
        this.cycle += dt * (3 + p.speed * 1.2);
        const sw = Math.sin(this.cycle);
        r.lean = 1.15; r.by = -0.25; r.headX = -0.75;
        r.shLx = -2.4 + sw * 0.9; r.shRx = -2.4 - sw * 0.9; r.shLz = -0.3; r.shRz = 0.3; r.elL = -0.4 - Math.max(0, sw) * 0.6; r.elR = -0.4 - Math.max(0, -sw) * 0.6;
        r.hipL = sw * 0.4; r.hipR = -sw * 0.4; r.kneeL = 0.3 + Math.max(0, sw) * 0.5; r.kneeR = 0.3 + Math.max(0, -sw) * 0.5;
        break;
      }
      case 'knocked': {
        this.cycle += dt * (2 + p.speed * 2.5);
        const sw = Math.sin(this.cycle) * Math.min(1, p.speed);
        r.lean = 1.35; r.by = -0.55; r.headX = -0.95;
        r.shLx = -2.5 + sw * 0.5; r.shRx = -2.5 - sw * 0.5; r.shLz = -0.35; r.shRz = 0.35; r.elL = r.elR = -0.5;
        r.hipL = -0.9 + sw * 0.3; r.hipR = -0.9 - sw * 0.3; r.kneeL = r.kneeR = 1.6;
        break;
      }
      case 'drive': case 'sit':
        r.by = -0.42; r.hipL = r.hipR = -1.45; r.kneeL = r.kneeR = 1.45; r.lean = -0.08;
        if (p.mode === 'drive') { r.shLx = r.shRx = -1.0; r.shLz = -0.05; r.shRz = 0.05; r.elL = r.elR = -0.55; }
        else { r.shLx = r.shRx = -0.3; r.elL = r.elR = -0.9; }
        break;
      case 'slide':
        r.lean = -0.62; r.by = -0.66; r.headX = 0.42;
        r.hipL = -1.5; r.kneeL = 0.08; r.hipR = -0.45; r.kneeR = 1.7;
        r.shLx = 0.35; r.shLz = -0.95; r.elL = -0.15; r.shRx = -0.35; r.shRz = 0.5;
        this.roll = damp(this.roll, 0.12, k);
        break;
      case 'mantle': {
        const ph = p.phase ?? 0;
        if (ph < 0.6) {
          const u = ph / 0.6;
          r.lean = 0.25 + u * 0.35; r.headX = -0.25;
          r.shLx = r.shRx = -2.95 + u * 2.3; r.elL = r.elR = -0.2 - Math.sin(u * Math.PI) * 0.9;
          r.hipL = -1.1 * Math.sin(u * Math.PI) - 0.2; r.kneeL = 0.4 + Math.sin(u * Math.PI) * 1.2; r.hipR = -0.35 - u * 0.5; r.kneeR = 0.6; r.by = -u * 0.2;
        } else {
          const u = (ph - 0.6) / 0.4;
          r.lean = 0.6 * (1 - u); r.shLx = r.shRx = -0.65 * (1 - u); r.shLz = -0.3; r.shRz = 0.3; r.elL = r.elR = -0.3;
          r.hipL = -1.4 * (1 - u); r.kneeL = 1.6 * (1 - u); r.hipR = -0.3 * (1 - u); r.kneeR = 0.4 * (1 - u); r.by = -0.2 * (1 - u);
        }
        break;
      }
      case 'hurdle': {
        const arc = Math.sin((p.phase ?? 0) * Math.PI);
        r.lean = 0.32 * arc; r.hipL = -1.3 * arc; r.kneeL = 0.15; r.hipR = 0.85 * arc; r.kneeR = 1.5 * arc;
        r.shLx = -0.5 * arc; r.shLz = -0.35 - 0.9 * arc; r.shRz = 0.35 + 0.9 * arc; r.shRx = 0.3 * arc; r.elL = r.elR = -0.3;
        this.roll = damp(this.roll, 0.28 * arc, k);
        break;
      }
      case 'climb': {
        this.cycle += dt * Math.abs(p.vy ?? 0) * 2.2;
        const sw = Math.sin(this.cycle);
        r.lean = -0.04; r.headX = -0.35;
        r.shLx = -2.6 + sw * 0.45; r.shRx = -2.6 - sw * 0.45; r.shLz = -0.12; r.shRz = 0.12; r.elL = -0.4 - Math.max(0, -sw) * 0.6; r.elR = -0.4 - Math.max(0, sw) * 0.6;
        r.hipL = -0.8 + sw * 0.55; r.hipR = -0.8 - sw * 0.55; r.kneeL = 1.1 - sw * 0.5; r.kneeR = 1.1 + sw * 0.5;
        break;
      }
      case 'zip': {
        const sway = Math.sin(tt * 2.3);
        r.lean = 0.06; r.shLx = -3.0; r.shLz = 0.12; r.shRx = -3.0; r.shRz = -0.12; r.elL = r.elR = -0.15;
        r.hipL = -0.45 + sway * 0.18; r.hipR = -0.15 - sway * 0.15; r.kneeL = 0.5; r.kneeR = 0.35; r.headX = 0.05;
        this.roll = damp(this.roll, sway * 0.06, k);
        break;
      }
      case 'launch':
        r.lean = -0.12; r.shLx = r.shRx = -0.3; r.shLz = -2.45; r.shRz = 2.45; r.elL = r.elR = -0.2; r.hipL = 0.1; r.hipR = -0.15; r.kneeL = 0.15; r.kneeR = 0.3; r.headX = -0.3;
        break;
    }

    // upper body: aim the gun (except while sprinting, swimming, gliding...)
    const canAim = gun && (p.mode === 'idle' || p.mode === 'run' || p.mode === 'air' || p.mode === 'sit' || p.mode === 'slide' || p.mode === 'zip');
    if (canAim && (!p.sprint || p.mode === 'slide')) {
      const pitch = Math.max(-1.2, Math.min(1.2, p.pitch));
      const lean = p.mode === 'slide' ? -0.62 : r.lean;
      // right arm: upper arm angled down, elbow bent, so the forearm (and gun) points where you aim
      r.shRx = -Math.PI / 2 - pitch - lean + 0.9; r.elR = -0.9; r.shRy = -0.3; r.shRz = 0.08;
      if (p.mode !== 'zip') { r.shLx = -Math.PI / 2 - pitch - lean + 0.75; r.elL = -1.05; r.shLy = 0.8; r.shLz = 0.12; } // (on a zipline the other hand holds on)
      r.twist = -0.22; r.headY = 0.22; r.headX = -pitch * 0.5 - lean * 0.6;
      if (p.mode === 'run') r.lean = Math.min(r.lean, 0.06);
    } else if (canAim && p.sprint) { r.shRx = -0.55; r.elR = -1.15; r.shRy = 0; r.shLx = -0.6; r.elL = -1.2; r.shLy = 0.55; r.shRz = 0.15; }
    if (p.using) { r.shRx = -1.15; r.elR = -1.85; r.shRz = -0.15; r.shRy = 0.35; r.headX = 0.2; }
    if (p.crouch && (p.mode === 'idle' || p.mode === 'run')) {
      // a real crouch: thighs forward, shins back, body low
      r.by -= 0.19; r.hipL -= 0.75; r.hipR -= 0.75; r.kneeL += 1.35; r.kneeR += 1.35; r.lean += 0.22;
    }
    // landing squash
    if (this.squash > 0.01) {
      const q = this.squash;
      r.by -= q * 0.17; r.hipL -= q * 0.7; r.hipR -= q * 0.5; r.kneeL += q * 1.2; r.kneeR += q * 1.0; r.lean += q * 0.25; r.shLz -= q * 0.3; r.shRz += q * 0.3;
      this.squash = Math.max(0, this.squash - dt * 4.5);
    }
    if (p.mode !== 'slide' && p.mode !== 'hurdle' && p.mode !== 'zip') this.roll = damp(this.roll, 0, k);

    // emotes (only while standing still)
    if (p.emote && p.mode === 'idle') {
      const e = t * 2 * Math.PI;
      if (p.emote === 1) { // bounce + wave
        const b = Math.abs(Math.sin(e * 0.9));
        r.by = b * 0.16; r.kneeL = r.kneeR = 0.3 - b * 0.25; r.hipL = r.hipR = -0.15 + b * 0.1;
        r.shRx = 0; r.shRz = 2.6 + Math.sin(e * 1.8) * 0.4; r.elR = -0.3; r.shLz = -2.6 - Math.sin(e * 1.8 + 1.5) * 0.4; r.shLx = 0; r.elL = -0.3; r.headX = Math.sin(e * 0.9) * 0.15;
      } else if (p.emote === 2) { // spinning groove
        spin = t * 4.2; r.by = Math.abs(Math.sin(e)) * 0.08; r.shLz = -1.4; r.shRz = 1.4; r.shLx = Math.sin(e) * 0.5; r.shRx = -r.shLx; r.elL = r.elR = -0.9;
        r.hipL = Math.sin(e) * 0.45; r.hipR = -r.hipL; r.kneeL = 0.3 + Math.max(0, Math.sin(e)) * 0.5; r.kneeR = 0.3 + Math.max(0, -Math.sin(e)) * 0.5; r.lean = 0.1;
      } else { // cheer: fists pumping, little jumps
        const pump = Math.sin(e * 1.4);
        r.by = Math.max(0, pump) * 0.25; r.shRx = -2.9 + pump * 0.35; r.shLx = -2.9 - pump * 0.35; r.shLz = -0.25; r.shRz = 0.25; r.elL = r.elR = -0.6 - Math.max(0, pump) * 0.5; r.headX = -0.3;
        r.hipL = r.hipR = -Math.max(0, pump) * 0.5; r.kneeL = r.kneeR = Math.max(0, pump) * 0.9;
      }
    }
    // lobby: hop and wave hello
    if (this.hop > 0) { r.by += Math.max(0, Math.sin((1 - this.hop) * Math.PI)) * 0.3; this.hop = Math.max(0, this.hop - dt * 1.8); }
    if (this.wave > 0) { this.wave -= dt; r.shRx = -0.2; r.shRz = 2.6 + Math.sin(t * 14) * 0.3; r.elR = -0.35 - Math.sin(t * 14) * 0.25; }

    this.apply(r, dt, k, gun, spin);
    this.held.visible = !p.emote && p.mode !== 'fall' && p.mode !== 'glide' && p.mode !== 'swim' && p.mode !== 'knocked' && p.mode !== 'drive' && p.mode !== 'climb' && p.mode !== 'mantle' && p.mode !== 'launch';
    this.trolley.visible = p.mode === 'zip';
    // glider pops open / folds away
    this.gliderOpen = damp(this.gliderOpen, p.mode === 'glide' ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.glider.visible = this.gliderOpen > 0.03;
    this.glider.scale.set(this.gliderOpen, 0.4 + this.gliderOpen * 0.6, this.gliderOpen);
    this.glider.position.y = (1 - this.gliderOpen) * 1.2;
    this.glider.rotation.z = Math.sin(t * 1.3 + this.phase) * 0.04;
  }

  /** Blend the joints toward a target rig. */
  private apply(r: Rig, dt: number, k: number, gun: boolean, spin: number) {
    const c = this.cur, kArm = gun ? 1 - Math.exp(-dt * 24) : k;
    for (const key of Object.keys(r) as (keyof Rig)[]) {
      const arm = key.startsWith('sh') || key.startsWith('el');
      c[key] = damp(c[key], r[key], arm ? kArm : k);
    }
    const B = this.body;
    B.rotation.y = spin ? spin : damp(B.rotation.y % (Math.PI * 2), 0, k);
    B.rotation.x = c.lean; B.rotation.z = this.roll;
    // keep the body's centre in place when it tips over (the pivot is at the feet)
    const pivot = 1.05;
    B.position.set(0, c.by + pivot * (1 - Math.cos(c.lean)), -pivot * Math.sin(c.lean));
    this.root.rotation.z = 0;
    this.hips.rotation.set(0, c.hipsYaw, c.roll);
    // the chest keeps facing where you look, turning only a little with the legs
    this.chest.rotation.set(0, c.twist + c.hipsYaw * 0.2, 0);
    this.legL.rotation.set(c.hipL, 0, c.hipLz); this.legR.rotation.set(c.hipR, 0, c.hipRz);
    this.kneeL.rotation.x = Math.max(0, c.kneeL); this.kneeR.rotation.x = Math.max(0, c.kneeR);
    this.armL.rotation.set(c.shLx, c.shLy, c.shLz); this.armR.rotation.set(c.shRx, c.shRy, c.shRz);
    this.elbowL.rotation.x = Math.min(0, c.elL); this.elbowR.rotation.x = Math.min(0, c.elR);
    this.head.rotation.set(c.headX, c.headY, 0);
  }

  /** World position of the muzzle of the held weapon (for flashes and tracers). */
  muzzleWorld(out: THREE.Vector3, item: number) {
    const m = this.held.children[0];
    if (!m) return this.elbowR.getWorldPosition(out);
    return m.localToWorld(out.copy(muzzleOffset(item)));
  }

  /** Frees this character's own geometry (held items share a cache, so they're detached first). */
  dispose() {
    this.held.removeFromParent();
    const tr = this.trolley;
    tr?.removeFromParent();
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
    if (tr) this.root.add(tr);
  }

  /** Little hop + wave (ready-up, joining). */
  celebrate() { this.hop = 1; this.wave = 1.6; }

  /** Lobby idle: breathe, shift weight, look toward the camera, wave when asked. */
  update(dt: number, t: number) {
    this.animate(dt, t, { mode: 'idle', speed: 0, dive: 0, pitch: 0, hold: 'none' });
    const local = this.root.worldToLocal(this.lookTarget.clone());
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.6, 0.6);
    this.head.rotation.y = yaw * 0.8 + Math.sin((t + this.phase) * 0.4) * 0.1;
  }
}
