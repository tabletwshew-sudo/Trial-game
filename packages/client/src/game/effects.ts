import * as THREE from 'three';
import { stepProjectile, type Projectile, type World } from '@dropzone/shared';
import { itemMesh } from './items3d';

/**
 * Short-lived visuals: tracers, muzzle flashes, puffs (dust, smoke, splashes, sparks, fire),
 * explosions and flying projectiles.
 *
 * Everything is pooled: puffs live in two instanced meshes (one draw call each, no new objects
 * or materials per puff), and tracers and flashes reuse a fixed set of meshes. Fights used to
 * create hundreds of throwaway materials a second.
 */
const IMPACT_COLORS = ['#e8dcc4', '#3ee6ff', '#ffffff', '#cfefff', '#ffb347', '#ffffff'].map((c) => new THREE.Color(c));

/** Hundreds of soft puffs in one draw call; each has its own colour, size, velocity, life and fade. */
class PuffPool {
  readonly mesh: THREE.InstancedMesh;
  private alpha: THREE.InstancedBufferAttribute;
  private next = 0;
  active = 0;
  private life: Float32Array; private max: Float32Array; private grow: Float32Array; private size: Float32Array;
  private p: Float32Array; private v: Float32Array; private gravity: Float32Array;
  private m = new THREE.Matrix4();
  private zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Object3D, readonly cap: number, fog: boolean) {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.alpha.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAlpha', this.alpha);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog });
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vAlpha = aAlpha;');
      sh.fragmentShader = 'varying float vAlpha;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n diffuseColor.a *= vAlpha;');
    };
    mat.customProgramCacheKey = () => `puffpool${fog}`;
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, this.zero); this.mesh.setColorAt(i, white); }
    this.life = new Float32Array(cap); this.max = new Float32Array(cap); this.grow = new Float32Array(cap); this.size = new Float32Array(cap);
    this.p = new Float32Array(cap * 3); this.v = new Float32Array(cap * 3); this.gravity = new Float32Array(cap);
    scene.add(this.mesh);
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: THREE.Color, size: number, life: number, grow: number, gravity = 4) {
    const i = this.next;
    this.next = (this.next + 1) % this.cap;
    if (this.life[i] <= 0) this.active++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.life[i] = life; this.max[i] = life; this.grow[i] = grow; this.size[i] = size; this.gravity[i] = gravity;
    this.mesh.setColorAt(i, color);
    this.mesh.instanceColor!.needsUpdate = true;
  }

  update(dt: number) {
    if (this.active <= 0) return;
    const a = this.alpha.array as Float32Array;
    for (let i = 0; i < this.cap; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.active--; this.mesh.setMatrixAt(i, this.zero); a[i] = 0; continue; }
      const k = i * 3;
      this.v[k + 1] -= this.gravity[i] * dt;
      this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
      this.size[i] *= 1 + this.grow[i] * dt;
      const s = this.size[i];
      this.m.makeScale(s, s, s).setPosition(this.p[k], this.p[k + 1], this.p[k + 2]);
      this.mesh.setMatrixAt(i, this.m);
      a[i] = Math.max(0, this.life[i] / this.max[i]) * 0.9;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.alpha.needsUpdate = true;
  }
}

/** A fixed set of meshes, each with its own material, handed out round-robin. */
class MeshPool {
  private items: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; life: number; max: number; fade: number }[] = [];
  private next = 0;
  constructor(scene: THREE.Object3D, geo: THREE.BufferGeometry, n: number) {
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false; mesh.frustumCulled = false;
      scene.add(mesh);
      this.items.push({ mesh, mat, life: 0, max: 1, fade: 1 });
    }
  }
  take(life: number, color: THREE.Color, opacity: number) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.life = life; it.max = life; it.fade = opacity;
    it.mat.color.copy(color); it.mat.opacity = opacity;
    it.mesh.visible = true;
    return it.mesh;
  }
  update(dt: number) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life -= dt;
      if (it.life <= 0) it.mesh.visible = false;
      else it.mat.opacity = (it.life / it.max) * it.fade;
    }
  }
}

export class Effects {
  private projectiles = new Map<number, { p: Projectile; mesh: THREE.Object3D; trail: number }>();
  private smoke: PuffPool;
  private glow: PuffPool;
  private tracers: MeshPool;
  private flashes: MeshPool;
  private c = new THREE.Color();
  private tmp = new THREE.Vector3();

  constructor(private scene: THREE.Scene, private w: World) {
    this.smoke = new PuffPool(scene, 360, true);
    this.glow = new PuffPool(scene, 220, false);
    this.tracers = new MeshPool(scene, new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2), 48);
    this.flashes = new MeshPool(scene, new THREE.IcosahedronGeometry(1, 0), 14);
  }

  /** Bullet tracer from a to b. Bright for a moment, then fades. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color = '#fff3b0', strong = false) {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    // HDR colours (above 1) so tracers, flashes and fire bloom in the post pipeline
    const m = this.tracers.take(Math.min(0.18, 0.06 + len / 900), this.c.set(color).multiplyScalar(strong ? 5 : 3.5), strong ? 1 : 0.8);
    m.position.copy(a);
    m.lookAt(b);
    m.scale.set(strong ? 1.6 : 1, strong ? 1.6 : 1, len);
  }

  muzzle(at: THREE.Vector3, big = false) {
    const m = this.flashes.take(0.05, this.c.set('#ffe08a').multiplyScalar(8), 0.95);
    m.position.copy(at); m.scale.setScalar(big ? 0.32 : 0.18); m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  }

  /** kind: 0 world, 1 shield, 2 health, 3 water, 4 car, 5 nothing */
  impact(at: THREE.Vector3, kind: number) {
    if (kind === 5) return;
    const n = kind === 3 ? 4 : kind === 1 || kind === 2 ? 5 : 3;
    const pool = kind === 1 || kind === 2 ? this.glow : this.smoke;
    this.c.copy(IMPACT_COLORS[kind]);
    if (pool === this.glow) this.c.multiplyScalar(3.2);
    for (let i = 0; i < n; i++) pool.spawn(at.x, at.y, at.z, (Math.random() - 0.5) * 3, Math.random() * 3 + (kind === 3 ? 3 : 0.5), (Math.random() - 0.5) * 3, this.c, kind === 3 ? 0.14 : 0.07, 0.3, kind === 1 ? 1.5 : 1);
  }

  /**
   * A burst of soft puffs (dust, sand, splashes): n puffs thrown out sideways at `speed` and
   * up at `up` m/s. Skipped when lots are already alive, so big fights stay cheap.
   */
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, size: number, life: number, grow = 1.4) {
    if (this.smoke.active > 300) return;
    this.c.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = speed * (0.5 + Math.random() * 0.5);
      this.smoke.spawn(x, y, z, Math.cos(a) * r, up * (0.6 + Math.random() * 0.6), Math.sin(a) * r, this.c, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), grow);
    }
  }

  /** One glowing spark (chest sparkles, supply-drop flares). */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, size: number, life: number, gravity = 1.5) {
    this.glow.spawn(x, y, z, vx, vy, vz, this.c.set(color).multiplyScalar(2.5), size, life, 0, gravity);
  }
  /** One soft smoke puff that drifts up (car damage, chest dust, supply-drop smoke). */
  smokePuff(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: string, size: number, life: number, grow = 0.8) {
    if (this.smoke.active > 330) return;
    this.smoke.spawn(x, y, z, vx, vy, vz, this.c.set(color), size, life, grow, 0);
  }

  explosion(at: THREE.Vector3, radius: number) {
    for (let i = 0; i < 14; i++) {
      const vx = (Math.random() - 0.5) * 8, vy = Math.random() * 7, vz = (Math.random() - 0.5) * 8;
      if (i < 10) this.glow.spawn(at.x, at.y, at.z, vx, vy, vz, this.c.set(i < 6 ? '#ffd23f' : '#ff7b39').multiplyScalar(5.5), radius * (i < 6 ? 0.25 : 0.32), 0.45, 2.4);
      else this.smoke.spawn(at.x, at.y, at.z, vx, vy, vz, this.c.set('#5c5c66'), radius * 0.32, 1.3, 1.8);
    }
  }

  spawnProjectile(id: number, item: number, p: [number, number, number], v: [number, number, number], fuse: number, rocket: boolean) {
    const mesh = rocket ? this.rocketMesh() : itemMesh(item, 1);
    mesh.position.set(...p);
    this.scene.add(mesh);
    this.projectiles.set(id, { p: { id, item, owner: -1, x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], age: 0, fuse: fuse || 99, rocket, done: false }, mesh, trail: 0 });
  }
  removeProjectile(id: number) {
    const pr = this.projectiles.get(id);
    if (!pr) return;
    this.scene.remove(pr.mesh);
    this.projectiles.delete(id);
  }

  private rocketMesh() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 8).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#e9ecef' }));
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.33), new THREE.MeshBasicMaterial({ color: '#e63946' }));
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffb347').multiplyScalar(6), fog: false }));
    g.add(body, tip, glow);
    return g;
  }

  update(dt: number) {
    this.tracers.update(dt);
    this.flashes.update(dt);
    this.smoke.update(dt);
    this.glow.update(dt);
    for (const [id, pr] of this.projectiles) {
      const res = stepProjectile(pr.p, this.w, dt);
      pr.mesh.position.set(pr.p.x, pr.p.y, pr.p.z);
      if (pr.p.rocket) {
        pr.mesh.lookAt(pr.p.x + pr.p.vx, pr.p.y + pr.p.vy, pr.p.z + pr.p.vz);
        pr.mesh.rotateY(Math.PI);
        pr.trail -= dt;
        if (pr.trail <= 0) { pr.trail = 0.025; this.tmp.copy(pr.mesh.position); this.smoke.spawn(this.tmp.x, this.tmp.y, this.tmp.z, 0, 0.6, 0, this.c.set('#d9d9d9'), 0.16, 0.8, 1.6, 0); }
      } else pr.mesh.rotation.x += dt * 8;
      // the server decides when it explodes; locally just stop it after a while
      if (res === 'explode' && pr.p.age > 10) this.removeProjectile(id);
    }
  }
}
