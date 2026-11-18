import * as THREE from 'three';
import type { Effects } from './effects';
import { CHEST_KIND, SUPPLY_FALL, type ChestView } from '@dropzone/shared';
import { outlineMaterial, softRamp } from '../lobby/toon';
import { mat4, mergeColored, type Piece } from './geo';

/**
 * Chests, ammo boxes and supply drops. Closed chests glow and sparkle; opening one flips the
 * lid back with a burst of light and the chest fades away. Supply drops float down under a
 * balloon and leave a smoke flare where they land.
 */
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });

/**
 * The light beam over a supply drop's landing spot: tall enough to see from across the island,
 * brightest at the bottom and fading up into the sky, with a slow shimmer running up it.
 */
const beamGeo = new THREE.CylinderGeometry(0.9, 0.9, 320, 12, 1, true).translate(0, 160, 0);
const beamMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color('#6cd0ff') } },
  vertexShader: 'varying float vH; varying vec3 vN; varying vec3 vV; void main(){ vH = uv.y; vec4 wp = modelMatrix * vec4(position, 1.0); vN = normalize(mat3(modelMatrix) * normal); vV = normalize(cameraPosition - wp.xyz); gl_Position = projectionMatrix * viewMatrix * wp; }',
  fragmentShader: `uniform float uTime; uniform vec3 uColor; varying float vH; varying vec3 vN; varying vec3 vV;
    void main(){
      float edge = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 1.5);  // soft edges, bright core
      float core = 1.0 - edge;
      float fade = (1.0 - vH) * (1.0 - vH);
      float shimmer = 0.75 + 0.25 * sin(vH * 120.0 - uTime * 3.0);
      float a = (0.25 + core * 0.55) * fade * shimmer;
      gl_FragColor = vec4(uColor * (1.2 + core), a);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
});
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

interface View { c: ChestView; root: THREE.Group; lid?: THREE.Object3D; balloon?: THREE.Object3D; beam?: THREE.Mesh; opening: number; landed: boolean; sparkT: number; fresh: boolean }

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
  private timer = 0;

  /** A supply drop just touched down (for the thud). */
  onLand: ((x: number, y: number, z: number) => void) | null = null;

  /** Sparkles and smoke go through the shared effect pools (one draw call, no new materials). */
  constructor(private scene: THREE.Scene, private fx: Effects) {}

  set(list: ChestView[]) { for (const v of this.views.values()) this.drop(v); this.views.clear(); this.chests.clear(); for (const c of list) this.chests.set(c.id, c); }
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
    const v: View = { c, root, opening: 0, landed: false, sparkT: Math.random(), fresh: true };
    const outlined = (g: THREE.BufferGeometry) => { const m = new THREE.Mesh(g, mat); m.castShadow = true; m.add(new THREE.Mesh(g, outlineMaterial)); return m; };
    if (c.k === CHEST_KIND.Chest) {
      root.add(outlined(this.geo.body));
      const lid = new THREE.Group(); lid.position.set(0, 0.48, -0.29); lid.add(outlined(this.geo.lid));
      root.add(lid); v.lid = lid;
    } else if (c.k === CHEST_KIND.Ammo) root.add(outlined(this.ammo));
    else {
      root.add(outlined(this.supply.crate));
      const bl = new THREE.Mesh(this.supply.balloon, mat); root.add(bl); v.balloon = bl;
      // the beam stands on the landing spot from the moment it's announced
      const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.set(c.x, c.y, c.z); beam.frustumCulled = false; beam.renderOrder = 2;
      this.scene.add(beam); v.beam = beam;
    }
    if (c.k !== CHEST_KIND.Ammo) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: new THREE.Color(c.k === CHEST_KIND.Supply ? '#9fd3ff' : '#ffe08a').multiplyScalar(2.6), transparent: true, depthWrite: false, opacity: 0.85 }));
      glow.scale.setScalar(c.k === CHEST_KIND.Supply ? 4.2 : 2.4); glow.position.y = 0.5; glow.name = 'glow';
      root.add(glow);
    }
    // face the room: the chest's front (+z in model space) points along its face direction
    root.rotation.y = [0, Math.PI / 2, Math.PI, -Math.PI / 2][c.face % 4];
    root.position.set(c.x, c.y, c.z);
    this.scene.add(root);
    return v;
  }

  private drop(v: View) { this.scene.remove(v.root); if (v.beam) this.scene.remove(v.beam); }

  private burst(at: THREE.Vector3, n: number) {
    for (let i = 0; i < n; i++) this.fx.spark(at.x, at.y + 0.5, at.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 4, (Math.random() - 0.5) * 4, i % 3 ? '#ffd23f' : '#ffffff', 0.06, 0.9, 6);
  }

  update(dt: number, t: number, cam: THREE.Vector3, serverNow: number) {
    beamMat.uniforms.uTime.value = t;
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      for (const [id, c] of this.chests) {
        const range = c.k === CHEST_KIND.Supply ? 2000 : 130;
        const near = (c.x - cam.x) ** 2 + (c.z - cam.z) ** 2 < range * range;
        const v = this.views.get(id);
        if (near && !v && !c.open) this.views.set(id, this.make(c));
        else if (v && (!near || (c.open && v.opening === 0))) { this.drop(v); this.views.delete(id); }
      }
    }
    for (const [id, v] of this.views) {
      const c = v.c;
      if (c.k === CHEST_KIND.Supply) {
        const y = this.heightOf(c, serverNow);
        v.root.position.y = y;
        const falling = y > c.y + 0.01;
        if (v.fresh) { v.fresh = false; if (!falling) v.landed = true; } // already down when it came into view: no landing burst
        if (v.balloon) v.balloon.visible = falling;
        v.root.rotation.z = falling ? Math.sin(t * 1.4 + id) * 0.06 : 0;
        const p = v.root.position;
        if (!falling && !v.landed) { v.landed = true; this.onLand?.(p.x, p.y, p.z); for (let i = 0; i < 14; i++) this.fx.smokePuff(p.x, p.y, p.z, (Math.random() - 0.5) * 6, Math.random() * 1.5, (Math.random() - 0.5) * 6, '#9fd3ff', 0.6, 3, 0.6); }
        if (v.landed && !c.open && Math.random() < dt * 6) this.fx.smokePuff(p.x + 0.9, p.y + 0.2, p.z + 0.9, 0.3, 3.2, 0.2, '#7fd1ff', 0.6, 3, 0.6);
      }
      const glow = v.root.getObjectByName('glow') as THREE.Sprite | undefined;
      if (glow) (glow.material as THREE.SpriteMaterial).opacity = 0.65 + Math.sin(t * 3 + id) * 0.2;
      // rising sparkles on closed chests
      if (!c.open && c.k === CHEST_KIND.Chest) {
        v.sparkT -= dt;
        if (v.sparkT <= 0) {
          v.sparkT = 0.12;
          const p = v.root.position;
          this.fx.spark(p.x + (Math.random() - 0.5) * 0.9, p.y + 0.3, p.z + (Math.random() - 0.5) * 0.6, 0, 0.8 + Math.random() * 0.6, 0, '#ffe8a3', 0.045, 1.2, 1.5);
        }
      }
      // opening: lid swings back, then the whole chest shrinks away
      if (v.opening > 0) {
        v.opening += dt;
        if (v.lid) v.lid.rotation.x = -Math.min(1.9, v.opening * 9);
        if (v.opening > 1.2) v.root.scale.setScalar(Math.max(0.001, 1 - (v.opening - 1.2) * 2.5));
        if (v.beam) v.beam.visible = v.opening < 0.4;
        if (v.opening > 1.6) { this.drop(v); this.views.delete(id); }
      }
    }
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
