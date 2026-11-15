import * as THREE from 'three';
import { CHEST_KIND, SUPPLY_FALL, type ChestView } from '@dropzone/shared';
import { outlineMaterial, softRamp } from '../lobby/toon';
import { mat4, mergeColored, type Piece } from './geo';

/**
 * Chests, ammo boxes and supply drops. Closed chests glow and sparkle; opening one flips the
 * lid back with a burst of light and the chest fades away. Supply drops float down under a
 * balloon and leave a smoke flare where they land.
 */
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

function chestGeo(): { body: THREE.BufferGeometry; lid: THREE.BufferGeometry } {
  const wood = '#a0612c', band = '#ffcf3f', dark = '#5b3417';
  const body: Piece[] = [
    { geo: B(0.9, 0.48, 0.58), color: wood, matrix: mat4(0, 0.24, 0) },
    ...[-0.36, 0.36].map((x) => ({ geo: B(0.08, 0.5, 0.6), color: band, matrix: mat4(x, 0.25, 0) })),
    { geo: B(0.92, 0.06, 0.6), color: dark, matrix: mat4(0, 0.03, 0) },
    { geo: B(0.16, 0.18, 0.04), color: band, matrix: mat4(0, 0.42, 0.3) },
  ];
  // lid hinges along the back edge (z = -0.29); built around the hinge so it can rotate
  const lid: Piece[] = [
    { geo: new THREE.CylinderGeometry(0.29, 0.29, 0.9, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), color: wood, matrix: mat4(0, 0, 0.29) },
    ...[-0.36, 0.36].map((x) => ({ geo: new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2), color: band, matrix: mat4(x, 0, 0.29) })),
  ];
  return { body: mergeColored(body), lid: mergeColored(lid) };
}

function ammoBoxGeo() {
  return mergeColored([
    { geo: B(0.8, 0.42, 0.5), color: '#4b5320', matrix: mat4(0, 0.21, 0) },
    { geo: B(0.82, 0.08, 0.52), color: '#3a4119', matrix: mat4(0, 0.44, 0) },
    { geo: B(0.5, 0.12, 0.03), color: '#ffd23f', matrix: mat4(0, 0.25, 0.26) },
    { geo: B(0.25, 0.05, 0.08), color: '#2b2d42', matrix: mat4(0, 0.5, 0) },
  ]);
}

function supplyGeo() {
  const crate: Piece[] = [
    { geo: B(1.4, 1.2, 1.4), color: '#3a86ff', matrix: mat4(0, 0.6, 0) },
    ...[-0.6, 0.6].flatMap((x) => [{ geo: B(0.12, 1.22, 1.42), color: '#f1faee', matrix: mat4(x, 0.6, 0) }, { geo: B(1.42, 1.22, 0.12), color: '#f1faee', matrix: mat4(0, 0.6, x) }]),
    { geo: B(1.42, 0.12, 1.42), color: '#f1faee', matrix: mat4(0, 1.2, 0) },
  ];
  const balloon: Piece[] = [
    { geo: new THREE.SphereGeometry(1.6, 16, 12), color: '#ffd23f', matrix: mat4(0, 6.2, 0, 0, 0, 0, 1, 1.15, 1) },
    ...[0, 1, 2, 3].map((k) => ({ geo: new THREE.SphereGeometry(1.62, 16, 12, (k / 4) * Math.PI * 2, Math.PI / 8), color: '#ef476f', matrix: mat4(0, 6.2, 0, 0, 0, 0, 1, 1.15, 1) })),
    ...[[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.02, 0.02, 4.0, 4), color: '#2b2d42', matrix: new THREE.Matrix4().makeTranslation(x * 0.5, 3.3, z * 0.5).multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(z * 0.18, 0, -x * 0.18))) })),
  ];
  return { crate: mergeColored(crate), balloon: mergeColored(balloon) };
}

interface View { c: ChestView; root: THREE.Group; lid?: THREE.Object3D; balloon?: THREE.Object3D; opening: number; landed: boolean; sparkT: number }

export class ChestRenderer {
  readonly chests = new Map<number, ChestView>();
  private views = new Map<number, View>();
  private geo = chestGeo();
  private ammo = ammoBoxGeo();
  private supply = supplyGeo();
  private glowTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d')!, grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,230,140,1)'); grad.addColorStop(0.4, 'rgba(255,210,63,.5)'); grad.addColorStop(1, 'rgba(255,210,63,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })();
  private sparkGeo = new THREE.OctahedronGeometry(0.05, 0);
  private sparks: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private smoke: { m: THREE.Mesh; v: THREE.Vector3; life: number }[] = [];
  private smokeGeo = new THREE.IcosahedronGeometry(0.6, 1);
  private timer = 0;

  constructor(private scene: THREE.Scene) {}

  set(list: ChestView[]) { for (const v of this.views.values()) this.scene.remove(v.root); this.views.clear(); this.chests.clear(); for (const c of list) this.chests.set(c.id, c); }
  add(list: ChestView[]) { for (const c of list) this.chests.set(c.id, c); }
  open(ids: number[]) {
    for (const id of ids) {
      const c = this.chests.get(id);
      if (!c) continue;
      c.open = true;
      const v = this.views.get(id);
      if (v) { v.opening = 0.001; this.burst(v.root.position, c.k === CHEST_KIND.Supply ? 40 : 24); }
    }
  }

  /** Supply drops' current height (they fall at a fixed speed from y0 at t0). */
  heightOf(c: ChestView, serverNow: number) {
    if (c.k !== CHEST_KIND.Supply || c.t0 === undefined || c.y0 === undefined) return c.y;
    return Math.max(c.y, c.y0 - (SUPPLY_FALL * (serverNow - c.t0)) / 1000);
  }

  private make(c: ChestView): View {
    const root = new THREE.Group();
    const v: View = { c, root, opening: 0, landed: false, sparkT: Math.random() };
    const outlined = (g: THREE.BufferGeometry) => { const m = new THREE.Mesh(g, mat); m.castShadow = true; m.add(new THREE.Mesh(g, outlineMaterial)); return m; };
    if (c.k === CHEST_KIND.Chest) {
      root.add(outlined(this.geo.body));
      const lid = new THREE.Group(); lid.position.set(0, 0.48, -0.29); lid.add(outlined(this.geo.lid));
      root.add(lid); v.lid = lid;
    } else if (c.k === CHEST_KIND.Ammo) root.add(outlined(this.ammo));
    else {
      root.add(outlined(this.supply.crate));
      const bl = new THREE.Mesh(this.supply.balloon, mat); root.add(bl); v.balloon = bl;
    }
    if (c.k !== CHEST_KIND.Ammo) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: c.k === CHEST_KIND.Supply ? '#9fd3ff' : '#ffe08a', transparent: true, depthWrite: false, opacity: 0.85 }));
      glow.scale.setScalar(c.k === CHEST_KIND.Supply ? 4.2 : 2.4); glow.position.y = 0.5; glow.name = 'glow';
      root.add(glow);
    }
    // face the room: the chest's front (+z in model space) points along its face direction
    root.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][c.face % 4];
    root.position.set(c.x, c.y, c.z);
    this.scene.add(root);
    return v;
  }

  private burst(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: i % 3 ? '#ffd23f' : '#ffffff', transparent: true }));
      m.position.copy(at).add(new THREE.Vector3(0, 0.5, 0));
      this.scene.add(m);
      this.sparks.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4), life: 0.9 });
    }
  }

  update(dt: number, t: number, cam: THREE.Vector3, serverNow: number) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      for (const [id, c] of this.chests) {
        const range = c.k === CHEST_KIND.Supply ? 900 : 90;
        const near = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < range * range;
        const v = this.views.get(id);
        if (near && !v && !c.open) this.views.set(id, this.make(c));
        else if (v && (!near || (c.open && v.opening === 0))) { this.scene.remove(v.root); this.views.delete(id); }
      }
    }
    for (const [id, v] of this.views) {
      const c = v.c;
      if (c.k === CHEST_KIND.Supply) {
        const y = this.heightOf(c, serverNow);
        v.root.position.y = y;
        const falling = y > c.y + 0.01;
        if (v.balloon) v.balloon.visible = falling;
        v.root.rotation.z = falling ? Math.sin(t * 1.4 + id) * 0.06 : 0;
        if (!falling && !v.landed) { v.landed = true; for (let i = 0; i < 14; i++) this.puff(v.root.position, '#9fd3ff'); }
        if (v.landed && !c.open && Math.random() < dt * 6) this.puff(v.root.position.clone().add(new THREE.Vector3(0.9, 0.2, 0.9)), '#7fd1ff', true);
      }
      const glow = v.root.getObjectByName('glow') as THREE.Sprite | undefined;
      if (glow) (glow.material as THREE.SpriteMaterial).opacity = 0.65 + Math.sin(t * 3 + id) * 0.2;
      // rising sparkles on closed chests
      if (!c.open && c.k === CHEST_KIND.Chest) {
        v.sparkT -= dt;
        if (v.sparkT <= 0) {
          v.sparkT = 0.12;
          const m = new THREE.Mesh(this.sparkGeo, new THREE.MeshBasicMaterial({ color: '#ffe8a3', transparent: true }));
          m.position.copy(v.root.position).add(new THREE.Vector3((Math.random() - 0.5) * 0.9, 0.3, (Math.random() - 0.5) * 0.6));
          this.scene.add(m);
          this.sparks.push({ m, v: new THREE.Vector3(0, 0.8 + Math.random() * 0.6, 0), life: 1.2 });
        }
      }
      // opening: lid swings back, then the whole chest shrinks away
      if (v.opening > 0) {
        v.opening += dt;
        if (v.lid) v.lid.rotation.x = -Math.min(1.9, v.opening * 9);
        if (v.opening > 1.2) v.root.scale.setScalar(Math.max(0.001, 1 - (v.opening - 1.2) * 2.5));
        if (v.opening > 1.6) { this.scene.remove(v.root); this.views.delete(id); }
      }
    }
    for (const s of this.sparks) { s.life -= dt; s.m.position.addScaledVector(s.v, dt); s.v.y -= dt * 1.5; s.m.rotation.y += dt * 6; (s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life); }
    for (let i = this.sparks.length - 1; i >= 0; i--) if (this.sparks[i].life <= 0) { this.scene.remove(this.sparks[i].m); (this.sparks[i].m.material as THREE.Material).dispose(); this.sparks.splice(i, 1); }
    for (const s of this.smoke) { s.life -= dt; s.m.position.addScaledVector(s.v, dt); s.m.scale.multiplyScalar(1 + dt * 0.6); (s.m.material as THREE.MeshBasicMaterial).opacity = Math.max(0, s.life / 3) * 0.7; }
    for (let i = this.smoke.length - 1; i >= 0; i--) if (this.smoke[i].life <= 0) { this.scene.remove(this.smoke[i].m); (this.smoke[i].m.material as THREE.Material).dispose(); this.smoke.splice(i, 1); }
  }

  private puff(at: THREE.Vector3, color: string, rising = false) {
    const m = new THREE.Mesh(this.smokeGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.copy(at);
    this.scene.add(m);
    this.smoke.push({ m, v: rising ? new THREE.Vector3(0.3, 3.2, 0.2) : new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 1.5, (Math.random() - 0.5) * 6), life: 3 });
  }

  /** The chest an E press would open (mirrors the server's choice). */
  pickTarget(x: number, y: number, z: number, yaw: number, serverNow: number): ChestView | null {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: ChestView | null = null, bs = Infinity;
    for (const c of this.chests.values()) {
      if (c.open || (c.k === CHEST_KIND.Supply && this.heightOf(c, serverNow) > c.y + 0.01)) continue;
      const dx = c.x - x, dz = c.z - z, d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(c.y - y) > 2) continue;
      const s = d + (1 - (d > 0.01 ? (dx * fx + dz * fz) / d : 1)) * 1.5 - 0.3;
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }
}
