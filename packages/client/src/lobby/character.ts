import * as THREE from 'three';
import { outlineMaterial, part, softRamp, toonVertex } from './toon';
import { GeoBuilder, mergeColored, type Piece } from '../game/geo';

/**
 * Original stylised character ("Ranger"): beanie, hoodie, cargo pants,
 * chunky boots, a small backpack. Skins are colourways of the same outfit.
 */
export interface Skin { name: string; hoodie: string; trim: string; pants: string; beanie: string; skinTone: string; hair: string }
export const SKINS: Skin[] = [
  { name: 'Trailblazer', hoodie: '#ff7a2f', trim: '#ffd23f', pants: '#2d3a5c', beanie: '#2bb3a3', skinTone: '#f2c39b', hair: '#4a2c1a' },
  { name: 'Tidepool',    hoodie: '#2f8cff', trim: '#9ef0ff', pants: '#24304a', beanie: '#ffcf33', skinTone: '#c98e63', hair: '#1b1b1b' },
  { name: 'Moss',        hoodie: '#4caf50', trim: '#d6f36b', pants: '#5b4636', beanie: '#e8572a', skinTone: '#ffd8b8', hair: '#c46a2b' },
  { name: 'Ultraviolet', hoodie: '#8f4dff', trim: '#ff6fd8', pants: '#1f1d33', beanie: '#ff6fd8', skinTone: '#8a5a3c', hair: '#120c08' },
  { name: 'Ember',       hoodie: '#e53945', trim: '#ffb703', pants: '#2b2d42', beanie: '#1d1d1d', skinTone: '#f0b98d', hair: '#2a1a12' },
  { name: 'Glacier',     hoodie: '#e9f4ff', trim: '#4cc9f0', pants: '#3a506b', beanie: '#4cc9f0', skinTone: '#ffe0c7', hair: '#e8d27a' },
  { name: 'Citrus',      hoodie: '#ffd166', trim: '#ef476f', pants: '#264653', beanie: '#06d6a0', skinTone: '#a86b47', hair: '#2b1a10' },
  { name: 'Midnight',    hoodie: '#22223b', trim: '#f72585', pants: '#141420', beanie: '#4361ee', skinTone: '#d9a07a', hair: '#0e0e0e' },
];

const gliderMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide });

/** Collapse a limb's many small meshes into one mesh + one outline (2 draw calls instead of dozens). */
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

export type PoseMode = 'idle' | 'run' | 'air' | 'fall' | 'glide' | 'swim';
export interface Pose { mode: PoseMode; speed: number; dive: number }
const damp = (a: number, b: number, k: number) => a + (b - a) * k;

export class Character {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private glider = new THREE.Group();
  private cycle = 0;
  private gliderOpen = 0;
  private phase = Math.random() * 10;
  private hop = 0;
  private wave = 0;
  lookTarget = new THREE.Vector3(0, 1.6, 10);

  constructor(public skinIndex: number) {
    this.build(SKINS[skinIndex % SKINS.length]);
  }

  setSkin(i: number) {
    if (i === this.skinIndex) return;
    this.skinIndex = i;
    this.dispose();
    this.root.remove(this.body, this.glider);
    this.glider = new THREE.Group();
    this.body = new THREE.Group(); this.head = new THREE.Group();
    this.armL = new THREE.Group(); this.armR = new THREE.Group();
    this.legL = new THREE.Group(); this.legR = new THREE.Group();
    this.build(SKINS[i % SKINS.length]);
  }

  private build(s: Skin) {
    const B = this.body;
    this.root.add(B);

    // legs
    for (const [leg, x] of [[this.legL, -0.17], [this.legR, 0.17]] as const) {
      leg.position.set(x, 0.92, 0);
      const thigh = part(new THREE.CapsuleGeometry(0.13, 0.42, 6, 12), s.pants);
      thigh.position.y = -0.3;
      const pocket = part(new THREE.BoxGeometry(0.1, 0.14, 0.2), s.pants);
      pocket.position.set(x > 0 ? 0.12 : -0.12, -0.28, 0);
      const boot = part(new THREE.BoxGeometry(0.24, 0.2, 0.36), '#3b2a20');
      boot.position.set(0, -0.78, 0.05);
      const sole = part(new THREE.BoxGeometry(0.26, 0.06, 0.38), '#1c1410', false);
      sole.position.set(0, -0.89, 0.05);
      leg.add(thigh, pocket, boot, sole);
      B.add(leg);
    }

    // torso (hoodie) + belt
    const torso = part(new THREE.CapsuleGeometry(0.3, 0.42, 8, 16), s.hoodie);
    torso.scale.set(1, 1, 0.75);
    torso.position.y = 1.32;
    const pocket = part(new THREE.BoxGeometry(0.34, 0.14, 0.06), s.trim);
    pocket.position.set(0, 1.18, 0.22);
    const belt = part(new THREE.CylinderGeometry(0.29, 0.29, 0.08, 20), '#2a2018', false);
    belt.position.y = 0.98;
    const zip = part(new THREE.BoxGeometry(0.03, 0.42, 0.02), s.trim, false);
    zip.position.set(0, 1.4, 0.235);
    const hood = part(new THREE.TorusGeometry(0.22, 0.07, 8, 20), s.hoodie);
    hood.rotation.x = Math.PI / 2.2; hood.position.set(0, 1.68, -0.06);
    B.add(torso, pocket, belt, zip, hood);

    // backpack
    const pack = part(new THREE.BoxGeometry(0.42, 0.48, 0.2), '#6b4f3a');
    pack.position.set(0, 1.38, -0.3);
    const flap = part(new THREE.BoxGeometry(0.44, 0.16, 0.22), s.trim);
    flap.position.set(0, 1.56, -0.3);
    const roll = part(new THREE.CylinderGeometry(0.08, 0.08, 0.46, 12), '#a0522d');
    roll.rotation.z = Math.PI / 2; roll.position.set(0, 1.12, -0.32);
    B.add(pack, flap, roll);

    // arms
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      arm.position.set(0.38 * side, 1.58, 0);
      const upper = part(new THREE.CapsuleGeometry(0.1, 0.36, 6, 12), s.hoodie);
      upper.position.y = -0.25;
      const cuff = part(new THREE.CylinderGeometry(0.11, 0.11, 0.08, 12), s.trim, false);
      cuff.position.y = -0.5;
      const hand = part(new THREE.SphereGeometry(0.1, 14, 12), '#30302f'); // gloves
      hand.scale.set(1, 1.1, 0.9);
      hand.position.y = -0.6;
      arm.add(upper, cuff, hand);
      arm.rotation.z = 0.12 * side;
      B.add(arm);
    }

    // head
    const H = this.head;
    H.position.y = 1.86;
    const neck = part(new THREE.CylinderGeometry(0.09, 0.1, 0.12, 12), s.skinTone, false);
    neck.position.y = -0.1;
    const skull = part(new THREE.SphereGeometry(0.27, 24, 20), s.skinTone);
    skull.scale.set(0.95, 1.05, 0.95);
    skull.position.y = 0.18;
    const eyeGeo = new THREE.SphereGeometry(0.045, 12, 10);
    const eyeWhite = new THREE.SphereGeometry(0.06, 12, 10);
    for (const x of [-0.095, 0.095]) {
      const w = part(eyeWhite, '#ffffff', false); w.scale.set(0.9, 1.1, 0.5); w.position.set(x, 0.2, 0.235);
      const e = part(eyeGeo, '#1d1530', false); e.scale.set(0.8, 1.05, 0.5); e.position.set(x, 0.195, 0.262);
      const glint = part(new THREE.SphereGeometry(0.013, 6, 6), '#ffffff', false); glint.position.set(x + 0.015, 0.215, 0.279);
      const brow = part(new THREE.BoxGeometry(0.1, 0.022, 0.02), s.hair, false); brow.position.set(x, 0.262, 0.252); brow.rotation.z = x > 0 ? -0.12 : 0.12;
      H.add(w, e, glint, brow);
    }
    const nose = part(new THREE.SphereGeometry(0.035, 10, 8), s.skinTone, false);
    nose.position.set(0, 0.13, 0.27);
    const mouth = part(new THREE.TorusGeometry(0.05, 0.012, 6, 12, Math.PI), '#7a3b3b', false);
    mouth.rotation.z = Math.PI; mouth.position.set(0, 0.07, 0.245);
    for (const x of [-0.27, 0.27]) {
      const ear = part(new THREE.SphereGeometry(0.06, 10, 8), s.skinTone, false);
      ear.scale.set(0.5, 1, 0.8); ear.position.set(x, 0.16, 0); H.add(ear);
    }
    // beanie + fold + pom
    const beanie = part(new THREE.SphereGeometry(0.29, 24, 16, 0, Math.PI * 2, 0, Math.PI / 1.9), s.beanie);
    beanie.position.y = 0.3;
    const fold = part(new THREE.TorusGeometry(0.265, 0.055, 10, 28), s.beanie);
    fold.rotation.x = Math.PI / 2; fold.position.y = 0.32;
    const pom = part(new THREE.IcosahedronGeometry(0.08, 1), s.trim);
    pom.position.y = 0.62;
    const fringe = part(new THREE.BoxGeometry(0.34, 0.06, 0.08), s.hair, false);
    fringe.position.set(0.02, 0.29, 0.215); fringe.rotation.z = -0.15;
    H.add(neck, skull, nose, mouth, beanie, fold, pom, fringe);
    B.add(H);
    for (const g of [B, H, this.armL, this.armR, this.legL, this.legR]) bake(g);

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

  /** In-match animation: blends joints toward the pose for the current movement state. */
  animate(dt: number, t: number, p: Pose) {
    const k = 1 - Math.exp(-dt * 14);
    let rx = 0, by = 0, legL = 0, legR = 0, aLx = 0, aRx = 0, aLz = -0.12, aRz = 0.12, headX = 0;
    const sp = Math.min(1.15, p.speed / 7.6);
    switch (p.mode) {
      case 'idle': by = Math.sin((t + this.phase) * 2.1) * 0.012; aLx = Math.sin((t + this.phase) * 1.05) * 0.05; aRx = -aLx; break;
      case 'run': {
        this.cycle += dt * (5.5 + p.speed * 1.15);
        const sw = Math.sin(this.cycle), amp = 0.35 + sp * 0.65;
        legL = sw * amp; legR = -sw * amp; aLx = -sw * amp * 0.95; aRx = sw * amp * 0.95;
        aLz = -0.2; aRz = 0.2; rx = 0.06 + sp * 0.12; by = Math.abs(Math.cos(this.cycle)) * 0.07 * amp;
        break;
      }
      case 'air': legL = 0.55; legR = -0.3; aLx = -0.5; aRx = -0.7; aLz = -0.75; aRz = 0.75; rx = 0.05; break;
      case 'fall': {
        const wob = Math.sin(t * 9 + this.phase);
        rx = 1.3 + p.dive * 0.75; headX = -0.5 + p.dive * 0.4;
        aLz = -1.75 + p.dive * 1.45 + wob * 0.05; aRz = 1.75 - p.dive * 1.45 - wob * 0.05;
        aLx = aRx = p.dive * 0.25;
        legL = -0.3 + p.dive * 0.25 + wob * 0.08; legR = -0.25 + p.dive * 0.2 - wob * 0.08;
        break;
      }
      case 'glide': {
        const sway = Math.sin(t * 1.7 + this.phase);
        rx = 0.12; aLx = aRx = -2.92; aLz = -0.2; aRz = 0.2;
        legL = 0.28 + sway * 0.12; legR = -0.08 - sway * 0.1; headX = 0.1;
        break;
      }
      case 'swim': {
        this.cycle += dt * (3 + p.speed * 1.2);
        const sw = Math.sin(this.cycle);
        rx = 1.15; by = -0.25; headX = -0.7;
        aLx = -2.4 + sw * 0.9; aRx = -2.4 - sw * 0.9; aLz = -0.3; aRz = 0.3;
        legL = sw * 0.45; legR = -sw * 0.45;
        break;
      }
    }
    const B = this.body;
    B.rotation.x = damp(B.rotation.x, rx, k);
    B.rotation.z = 0; B.position.x = 0;
    // keep the body's centre in place when it tips over (the pivot is at the feet)
    const pivot = 1.05;
    B.position.y = damp(B.position.y, by + pivot * (1 - Math.cos(B.rotation.x)), k);
    B.position.z = -pivot * Math.sin(B.rotation.x);
    this.legL.rotation.set(damp(this.legL.rotation.x, legL, k), 0, -0.03);
    this.legR.rotation.set(damp(this.legR.rotation.x, legR, k), 0, 0.03);
    this.armL.rotation.set(damp(this.armL.rotation.x, aLx, k), 0, damp(this.armL.rotation.z, aLz, k));
    this.armR.rotation.set(damp(this.armR.rotation.x, aRx, k), 0, damp(this.armR.rotation.z, aRz, k));
    this.head.rotation.set(damp(this.head.rotation.x, headX, k), damp(this.head.rotation.y, 0, k), 0);
    // glider pops open / folds away
    this.gliderOpen = damp(this.gliderOpen, p.mode === 'glide' ? 1 : 0, 1 - Math.exp(-dt * 10));
    this.glider.visible = this.gliderOpen > 0.03;
    this.glider.scale.set(this.gliderOpen, 0.4 + this.gliderOpen * 0.6, this.gliderOpen);
    this.glider.position.y = (1 - this.gliderOpen) * 1.2;
    this.glider.rotation.z = Math.sin(t * 1.3 + this.phase) * 0.04;
  }

  dispose() { this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); }); }

  /** Little hop + wave (ready-up, joining). */
  celebrate() { this.hop = 1; this.wave = 1.6; }

  update(dt: number, t: number) {
    const p = t + this.phase;
    const breathe = Math.sin(p * 2.1) * 0.012;
    this.body.position.y = breathe + Math.max(0, Math.sin((1 - this.hop) * Math.PI)) * 0.35 * (this.hop > 0 ? 1 : 0);
    this.hop = Math.max(0, this.hop - dt * 1.8);
    this.body.rotation.z = Math.sin(p * 0.7) * 0.025;
    this.legL.rotation.x = 0; this.legR.rotation.x = 0;
    // weight shift
    const shift = Math.sin(p * 0.35);
    this.body.position.x = shift * 0.03;
    this.legL.rotation.z = -0.03 + shift * 0.02;
    this.legR.rotation.z = 0.03 + shift * 0.02;
    // arms
    this.armL.rotation.x = Math.sin(p * 1.05) * 0.05;
    if (this.wave > 0) {
      this.wave -= dt;
      this.armR.rotation.z = 2.6 + Math.sin(t * 14) * 0.35;
    } else {
      this.armR.rotation.z = THREE.MathUtils.lerp(this.armR.rotation.z, 0.12, dt * 6);
      this.armR.rotation.x = Math.sin(p * 1.05 + 1) * 0.05;
    }
    // head looks toward target, softly
    const local = this.root.worldToLocal(this.lookTarget.clone());
    const yaw = THREE.MathUtils.clamp(Math.atan2(local.x, local.z), -0.6, 0.6);
    this.head.rotation.y = THREE.MathUtils.lerp(this.head.rotation.y, yaw, dt * 3);
    this.head.rotation.x = Math.sin(p * 0.9) * 0.03;
  }
}
