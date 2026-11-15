import * as THREE from 'three';
import { EF, PM, WATER_FLOAT_Y, weaponDef, type RosterEntry } from '@dropzone/shared';
import { Character, SKINS, type PoseMode } from '../lobby/character';
import { softRamp } from '../lobby/toon';
import { mat4, mergeColored } from './geo';

export interface ActorState { x: number; y: number; z: number; yaw: number; pitch: number; mode: number; grounded: boolean; speed: number; dive: number; visible: boolean; item: number; rarity: number; flags: number }

const FULL_MODELS = 10;

/**
 * Draws every player. The nearest few get the full animated character;
 * everyone else is a cheap instanced figure, so 80 players stay fast.
 */
export class Actors {
  readonly states: ActorState[];
  private pool: { ch: Character; idx: number }[] = [];
  private lodBody: THREE.InstancedMesh;
  private lodRest: THREE.InstancedMesh;
  private lodGlider: THREE.InstancedMesh;
  private order: number[];
  private sortTimer = 0;
  private full = new Map<number, Character>();

  constructor(private scene: THREE.Scene, private roster: RosterEntry[], private selfIdx: number) {
    this.states = roster.map(() => ({ x: 0, y: -100, z: 0, yaw: 0, pitch: 0, mode: PM.Walk, grounded: true, speed: 0, dive: 0, visible: false, item: 0, rarity: 0, flags: 0 }));
    this.order = roster.map((r) => r.idx);
    const n = roster.length;
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
    // tintable part (hoodie + beanie)
    const body = mergeColored([
      { geo: new THREE.CapsuleGeometry(0.3, 0.45, 2, 8), color: '#ffffff', matrix: mat4(0, 1.32, 0, 0, 0, 0, 1, 1, 0.8) },
      { geo: new THREE.CapsuleGeometry(0.1, 0.4, 2, 6), color: '#ffffff', matrix: mat4(-0.4, 1.3, 0) },
      { geo: new THREE.CapsuleGeometry(0.1, 0.4, 2, 6), color: '#ffffff', matrix: mat4(0.4, 1.3, 0) },
      { geo: new THREE.SphereGeometry(0.29, 8, 6, 0, Math.PI * 2, 0, Math.PI / 1.9), color: '#e8e8e8', matrix: mat4(0, 2.16, 0) },
    ]);
    const rest = mergeColored([
      { geo: new THREE.SphereGeometry(0.26, 8, 6), color: '#e6b48a', matrix: mat4(0, 2.04, 0) },
      { geo: new THREE.CapsuleGeometry(0.13, 0.5, 2, 6), color: '#2d3250', matrix: mat4(-0.17, 0.5, 0) },
      { geo: new THREE.CapsuleGeometry(0.13, 0.5, 2, 6), color: '#2d3250', matrix: mat4(0.17, 0.5, 0) },
      { geo: new THREE.BoxGeometry(0.42, 0.48, 0.2), color: '#6b4f3a', matrix: mat4(0, 1.38, -0.3) },
    ]);
    const glider = mergeColored([
      { geo: new THREE.ConeGeometry(2.9, 3.1, 3, 1).rotateX(Math.PI / 2).scale(1, 0.05, 1), color: '#ffffff', matrix: mat4(0, 3.2, 0.2) },
      { geo: new THREE.BoxGeometry(1.3, 0.06, 0.06), color: '#2b2d42', matrix: mat4(0, 2.2, 0.12) },
    ]);
    this.lodBody = new THREE.InstancedMesh(body, mat, n);
    this.lodRest = new THREE.InstancedMesh(rest, mat, n);
    this.lodGlider = new THREE.InstancedMesh(glider, mat, n);
    const c = new THREE.Color();
    roster.forEach((r, i) => {
      const s = SKINS[r.skin % SKINS.length];
      this.lodBody.setColorAt(i, c.set(s.hoodie));
      this.lodGlider.setColorAt(i, c.set(s.trim));
    });
    for (const m of [this.lodBody, this.lodRest, this.lodGlider]) { m.frustumCulled = false; m.castShadow = false; scene.add(m); }
    for (let i = 0; i < FULL_MODELS; i++) {
      const ch = new Character(0);
      ch.root.visible = false;
      scene.add(ch.root);
      this.pool.push({ ch, idx: -1 });
    }
  }

  /** The full model currently standing in for a player, if any (used for name tags). */
  isFull(idx: number) { return this.full.has(idx); }
  /** The animated model for a player, if they currently have one. */
  character(idx: number) { return this.full.get(idx); }

  private poseOf(s: ActorState): PoseMode {
    if (s.mode === PM.Knocked) return 'knocked';
    if (s.mode === PM.Drive) return 'drive';
    if (s.mode === PM.Ride) return 'sit';
    if (s.mode === PM.Fall) return 'fall';
    if (s.mode === PM.Glide) return 'glide';
    if (s.y <= WATER_FLOAT_Y + 0.05) return 'swim';
    if (!s.grounded) return 'air';
    return s.speed > 0.6 ? 'run' : 'idle';
  }

  update(dt: number, t: number, cam: THREE.Vector3) {
    const st = this.states;
    // re-pick who gets a full model a few times a second
    this.sortTimer -= dt;
    if (this.sortTimer <= 0) {
      this.sortTimer = 0.25;
      const d = (i: number) => (i === this.selfIdx ? -1 : !st[i].visible ? 1e12 : (st[i].x - cam.x) ** 2 + (st[i].y - cam.y) ** 2 + (st[i].z - cam.z) ** 2);
      this.order.sort((a, b) => d(a) - d(b));
      const want = new Set(this.order.slice(0, FULL_MODELS).filter((i) => st[i].visible && d(i) < 140 * 140));
      for (const slot of this.pool) if (slot.idx >= 0 && !want.has(slot.idx)) { this.full.delete(slot.idx); slot.idx = -1; slot.ch.root.visible = false; }
      for (const i of want) {
        if (this.full.has(i)) continue;
        const slot = this.pool.find((s) => s.idx < 0);
        if (!slot) break;
        slot.idx = i; slot.ch.setSkin(this.roster[i].skin % SKINS.length);
        this.full.set(i, slot.ch);
      }
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, 'YXZ'), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0);
    const hide = m.clone().compose(p.set(0, -500, 0), q, zero);
    for (let i = 0; i < st.length; i++) {
      const s = st[i], ch = this.full.get(i);
      // anyone practically inside the camera would fill the screen with their outline: hide them
      const tooClose = i !== this.selfIdx && (s.x - cam.x) ** 2 + (s.y + 1.1 - cam.y) ** 2 + (s.z - cam.z) ** 2 < 1.6 * 1.6;
      if (ch) {
        ch.root.visible = s.visible && !tooClose;
        ch.root.position.set(s.x, s.y, s.z);
        ch.root.rotation.y = s.yaw + Math.PI;
        ch.setHeld(s.mode === PM.Walk || s.mode === PM.Ride ? s.item : 0, s.rarity);
        ch.animate(dt, t, {
          mode: this.poseOf(s), speed: s.speed, dive: s.dive, pitch: s.pitch,
          hold: !s.item ? 'none' : weaponDef(s.item) ? 'gun' : 'item',
          sprint: (s.flags & EF.SPRINT) !== 0, crouch: (s.flags & EF.CROUCH) !== 0, using: (s.flags & EF.USING) !== 0,
        });
      }
      if (ch || !s.visible || tooClose) {
        this.lodBody.setMatrixAt(i, hide); this.lodRest.setMatrixAt(i, hide); this.lodGlider.setMatrixAt(i, hide);
        continue;
      }
      const falling = s.mode === PM.Fall, flat = s.mode === PM.Knocked || s.mode === PM.Drive || s.mode === PM.Ride;
      e.set(falling ? 1.3 : s.mode === PM.Knocked ? 1.3 : 0, s.yaw + Math.PI, 0);
      q.setFromEuler(e);
      m.compose(p.set(s.x, s.y + (falling ? 0.8 : flat ? -0.4 : 0), s.z), q, one);
      this.lodBody.setMatrixAt(i, m); this.lodRest.setMatrixAt(i, m);
      this.lodGlider.setMatrixAt(i, s.mode === PM.Glide ? m : hide);
    }
    this.lodBody.instanceMatrix.needsUpdate = this.lodRest.instanceMatrix.needsUpdate = this.lodGlider.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    for (const s of this.pool) { this.scene.remove(s.ch.root); s.ch.dispose(); }
    for (const m of [this.lodBody, this.lodRest, this.lodGlider]) { this.scene.remove(m); m.geometry.dispose(); }
  }
}
