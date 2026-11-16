import * as THREE from 'three';
import { stepProjectile, type Projectile, type World } from '@dropzone/shared';
import { itemMesh } from './items3d';

/** Pooled short-lived visuals: tracers, muzzle flashes, impact puffs, explosions, flying projectiles. */
const IMPACT_COLORS = ['#e8dcc4', '#3ee6ff', '#ffffff', '#cfefff', '#ffb347', '#ffffff'];

interface Tracer { line: THREE.Mesh; life: number; max: number }
interface Puff { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; grow: number }

export class Effects {
  private tracers: Tracer[] = [];
  private puffs: Puff[] = [];
  private flashes: { mesh: THREE.Mesh; life: number }[] = [];
  private projectiles = new Map<number, { p: Projectile; mesh: THREE.Object3D; trail: number }>();
  private tracerGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  private puffGeo = new THREE.IcosahedronGeometry(1, 1);
  private flashGeo = new THREE.IcosahedronGeometry(1, 0);
  private light = new THREE.PointLight('#ffd27a', 0, 12);
  private lightLife = 0;

  constructor(private scene: THREE.Scene, private w: World) { scene.add(this.light); }

  /** Bullet tracer from a to b. Bright for a moment, then fades. */
  tracer(a: THREE.Vector3, b: THREE.Vector3, color = '#fff3b0', strong = false) {
    const len = a.distanceTo(b);
    if (len < 0.5) return;
    const m = new THREE.Mesh(this.tracerGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: strong ? 1 : 0.8, depthWrite: false, fog: false }));
    m.position.copy(a);
    m.lookAt(b);
    m.scale.set(strong ? 1.6 : 1, strong ? 1.6 : 1, len);
    this.scene.add(m);
    const max = Math.min(0.18, 0.06 + len / 900);
    this.tracers.push({ line: m, life: max, max });
  }

  muzzle(at: THREE.Vector3, big = false) {
    const m = new THREE.Mesh(this.flashGeo, new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
    m.position.copy(at); m.scale.setScalar(big ? 0.32 : 0.18); m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    this.scene.add(m);
    this.flashes.push({ mesh: m, life: 0.05 });
    this.light.position.copy(at); this.light.intensity = big ? 30 : 14; this.lightLife = 0.05;
  }

  /** kind: 0 world, 1 shield, 2 health, 3 water, 4 car, 5 nothing */
  impact(at: THREE.Vector3, kind: number) {
    if (kind === 5) return;
    const n = kind === 3 ? 4 : kind === 1 || kind === 2 ? 5 : 3;
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3 + (kind === 3 ? 3 : 0.5), (Math.random() - 0.5) * 3);
      this.puff(at, v, IMPACT_COLORS[kind], kind === 3 ? 0.14 : 0.07, 0.3, kind === 1 ? 1.5 : 1, kind === 1 || kind === 2 ? 0.5 : 0.2);
    }
  }

  /**
   * A burst of soft puffs (dust, sand, splashes): n puffs thrown out sideways at `speed` and
   * up at `up` m/s. Skipped when lots are already alive, so big fights stay cheap.
   */
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, up: number, size: number, life: number, grow = 1.4) {
    if (this.puffs.length > 360) return;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = speed * (0.5 + Math.random() * 0.5);
      this.puff(new THREE.Vector3(x, y, z), new THREE.Vector3(Math.cos(a) * r, up * (0.6 + Math.random() * 0.6), Math.sin(a) * r), color, size * (0.7 + Math.random() * 0.6), life * (0.7 + Math.random() * 0.5), grow, 0);
    }
  }

  private puff(at: THREE.Vector3, vel: THREE.Vector3, color: string, size: number, life: number, grow: number, glow: number) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false });
    if (glow > 0.3) mat.fog = false;
    const m = new THREE.Mesh(this.puffGeo, mat);
    m.position.copy(at); m.scale.setScalar(size);
    this.scene.add(m);
    this.puffs.push({ mesh: m, vel, life, max: life, grow });
  }

  explosion(at: THREE.Vector3, radius: number) {
    for (let i = 0; i < 14; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 8, Math.random() * 7, (Math.random() - 0.5) * 8);
      this.puff(at, v, i < 6 ? '#ffd23f' : i < 10 ? '#ff7b39' : '#5c5c66', radius * (i < 6 ? 0.25 : 0.32), i < 10 ? 0.45 : 1.3, i < 10 ? 2.4 : 1.8, i < 10 ? 1 : 0);
    }
    this.light.position.copy(at); this.light.intensity = 220; this.light.distance = radius * 8; this.lightLife = 0.25;
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
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6).translate(0, 0, 0.3), new THREE.MeshBasicMaterial({ color: '#ffb347', fog: false }));
    g.add(body, tip, glow);
    return g;
  }

  update(dt: number) {
    for (const t of this.tracers) { t.life -= dt; (t.line.material as THREE.MeshBasicMaterial).opacity = Math.max(0, t.life / t.max); }
    this.tracers = this.tracers.filter((t) => { if (t.life > 0) return true; this.scene.remove(t.line); (t.line.material as THREE.Material).dispose(); return false; });
    for (const f of this.flashes) f.life -= dt;
    this.flashes = this.flashes.filter((f) => { if (f.life > 0) return true; this.scene.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); return false; });
    for (const p of this.puffs) {
      p.life -= dt;
      p.vel.y -= 4 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.multiplyScalar(1 + p.grow * dt);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life / p.max) * 0.9;
    }
    this.puffs = this.puffs.filter((p) => { if (p.life > 0) return true; this.scene.remove(p.mesh); (p.mesh.material as THREE.Material).dispose(); return false; });
    if (this.lightLife > 0) { this.lightLife -= dt; if (this.lightLife <= 0) this.light.intensity = 0; }
    for (const [id, pr] of this.projectiles) {
      const res = stepProjectile(pr.p, this.w, dt);
      pr.mesh.position.set(pr.p.x, pr.p.y, pr.p.z);
      if (pr.p.rocket) {
        pr.mesh.lookAt(pr.p.x + pr.p.vx, pr.p.y + pr.p.vy, pr.p.z + pr.p.vz);
        pr.mesh.rotateY(Math.PI);
        pr.trail -= dt;
        if (pr.trail <= 0) { pr.trail = 0.025; this.puff(pr.mesh.position.clone(), new THREE.Vector3(0, 0.6, 0), '#d9d9d9', 0.16, 0.8, 1.6, 0); }
      } else pr.mesh.rotation.x += dt * 8;
      // the server decides when it explodes; locally just stop it after a while
      if (res === 'explode' && pr.p.age > 10) this.removeProjectile(id);
    }
  }
}
