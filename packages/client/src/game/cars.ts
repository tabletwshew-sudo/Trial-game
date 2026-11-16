import * as THREE from 'three';
import type { Effects } from './effects';
import { CAR, clamp, surfaceAt, type VehSnap, type World } from '@dropzone/shared';
import { outlineMaterial, softRamp } from '../lobby/toon';
import { GeoBuilder, mat4, mergeColored } from './geo';

/** An original off-road pickup: rounded cab, roll bar, bed, chunky wheels. Front is -Z. */
const PAINTS = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#ffd23f', '#6a994e', '#8338ec', '#f1faee'];
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });

function bodyGeo(paint: string) {
  const g = new GeoBuilder();
  const dark = '#2b2d42', trim = '#e9ecef';
  g.box(-1.0, 0.55, -2.15, 1.0, 1.15, 2.1, paint, true);           // chassis tub
  g.box(-1.05, 0.45, -2.3, 1.05, 0.7, -2.05, dark, true);          // front bumper
  g.box(-1.05, 0.45, 2.05, 1.05, 0.7, 2.3, dark, true);            // rear bumper
  g.box(-0.95, 1.15, -0.65, 0.95, 1.95, 0.55, paint, true);        // cab
  g.box(-0.9, 1.95, -0.55, 0.9, 2.05, 0.45, paint, true);          // roof
  g.box(-0.96, 1.25, -0.66, 0.96, 1.85, -0.62, '#8fd0ea', true);   // windscreen
  for (const s of [-1, 1]) g.box(s * 0.96 - 0.02, 1.3, -0.5, s * 0.96 + 0.02, 1.82, 0.35, '#8fd0ea', true); // side windows
  g.box(-0.95, 1.15, -2.15, 0.95, 1.32, -0.65, paint, true);       // bonnet
  g.box(-0.4, 1.32, -1.9, 0.4, 1.38, -0.9, dark, true);            // bonnet scoop
  for (const s of [-1, 1]) {
    g.box(s * 0.72 - 0.18, 0.8, -2.17, s * 0.72 + 0.18, 1.02, -2.13, '#fff7c2', true); // headlights
    g.box(s * 0.8 - 0.12, 0.85, 2.11, s * 0.8 + 0.12, 1.0, 2.14, '#ff4d6d', true);     // tail lights
    g.box(s * 1.0 - 0.05, 1.15, 0.6, s * 1.0 + 0.05, 1.55, 2.05, paint, true);          // bed walls
    // wheel arches
    for (const z of [-1.35, 1.35]) g.box(s * 1.0 - 0.06, 1.0, z - 0.6, s * 1.0 + 0.12, 1.12, z + 0.6, dark, true);
  }
  g.box(-1.0, 1.15, 2.0, 1.0, 1.55, 2.08, paint, true);             // tailgate
  g.box(-0.9, 1.16, 0.6, 0.9, 1.2, 2.0, '#6b4f3a', true);           // bed floor (wood)
  // roll bar
  for (const s of [-1, 1]) g.box(s * 0.85 - 0.07, 1.55, 0.65, s * 0.85 + 0.07, 2.35, 0.79, trim, true);
  g.box(-0.92, 2.28, 0.65, 0.92, 2.42, 0.79, trim, true);
  for (const s of [-1, 1]) g.box(s * 0.55 - 0.12, 2.42, 0.62, s * 0.55 + 0.12, 2.56, 0.74, '#fff7c2', true); // spot lamps
  return g.build();
}

const wheelGeo = mergeColored([
  { geo: new THREE.CylinderGeometry(0.46, 0.46, 0.38, 14).rotateZ(Math.PI / 2), color: '#22223b' },
  { geo: new THREE.CylinderGeometry(0.25, 0.25, 0.4, 8).rotateZ(Math.PI / 2), color: '#c0c4cc' },
  { geo: new THREE.BoxGeometry(0.42, 0.1, 0.5), color: '#3b3f58', matrix: mat4(0, 0, 0) },
]);

interface CarView { root: THREE.Group; body: THREE.Group; wheels: THREE.Mesh[]; hist: { t: number; s: VehSnap }[]; spin: number; smoke: number; hp: number; seen: number }

export class CarRenderer {
  readonly cars = new Map<number, CarView>();
  constructor(private scene: THREE.Scene, private w: World, private fx: Effects) {}

  private make(id: number): CarView {
    const root = new THREE.Group(), body = new THREE.Group();
    const geo = bodyGeo(PAINTS[id % PAINTS.length]);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    const ol = new THREE.Mesh(geo, outlineMaterial);
    body.add(m, ol);
    const wheels: THREE.Mesh[] = [];
    for (const [x, z] of [[-1.05, -1.35], [1.05, -1.35], [-1.05, 1.35], [1.05, 1.35]]) {
      const wh = new THREE.Mesh(wheelGeo, mat);
      wh.position.set(x, 0.46, z); wh.castShadow = true;
      wheels.push(wh); root.add(wh);
    }
    root.add(body);
    this.scene.add(root);
    return { root, body, wheels, hist: [], spin: 0, smoke: 0, hp: CAR.maxHp, seen: 0 };
  }

  onSnapshot(time: number, vehs: VehSnap[], tick: number) {
    for (const v of vehs) {
      let c = this.cars.get(v.id);
      if (!c) { c = this.make(v.id); this.cars.set(v.id, c); }
      c.hist.push({ t: time, s: v });
      if (c.hist.length > 12) c.hist.shift();
      c.seen = tick; c.hp = v.hp;
    }
    for (const [id, c] of this.cars) if (c.seen !== tick) { this.scene.remove(c.root); this.cars.delete(id); }
  }

  /** Interpolated state for car `id` at render time `rt`. */
  sample(id: number, rt: number): { x: number; y: number; z: number; vh: number; vs: number } | null {
    const c = this.cars.get(id);
    if (!c || !c.hist.length) return null;
    const h = c.hist;
    let b = h.length - 1;
    while (b > 0 && h[b - 1].t > rt) b--;
    const B = h[b].s, A = h[Math.max(0, b - 1)].s, tA = h[Math.max(0, b - 1)].t, tB = h[b].t;
    const k = tB > tA ? clamp((rt - tA) / (tB - tA), 0, 1) : 1;
    let dh = B.vh - A.vh; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, vh: A.vh + dh * k, vs: A.vs + (B.vs - A.vs) * k };
  }

  /** `override` = the car you are driving (predicted locally, so no delay). */
  update(dt: number, rt: number, override?: { id: number; x: number; y: number; z: number; vh: number; vs: number; steer: number }, cam?: THREE.Vector3) {
    for (const [id, c] of this.cars) {
      const s = override && override.id === id ? override : this.sample(id, rt);
      if (!s) continue;
      // far cars are a few pixels: skip them (5 draw calls each), and only near ones cast shadows
      const d2 = cam ? (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 : 0;
      c.root.visible = d2 < 300 * 300;
      if (!c.root.visible) continue;
      const shadow = d2 < 90 * 90;
      if (c.wheels[0].castShadow !== shadow) { c.wheels.forEach((wh) => (wh.castShadow = shadow)); (c.body.children[0] as THREE.Mesh).castShadow = shadow; }
      c.root.position.set(s.x, s.y, s.z);
      c.root.rotation.y = s.vh;
      // tilt the body to the ground under the wheels
      const fx = -Math.sin(s.vh), fz = -Math.cos(s.vh), rx = Math.cos(s.vh), rz = -Math.sin(s.vh);
      const hF = surfaceAt(this.w, s.x + fx * 1.35, s.z + fz * 1.35, s.y + 1), hB = surfaceAt(this.w, s.x - fx * 1.35, s.z - fz * 1.35, s.y + 1);
      const hR = surfaceAt(this.w, s.x + rx, s.z + rz, s.y + 1), hL = surfaceAt(this.w, s.x - rx, s.z - rz, s.y + 1);
      const pitch = clamp(Math.atan2(hF - hB, 2.7), -0.5, 0.5), roll = clamp(Math.atan2(hR - hL, 2.1), -0.4, 0.4);
      c.body.rotation.set(-pitch, 0, roll);
      c.body.position.y = Math.sin(performance.now() / 90 + id) * 0.015 * Math.min(1, Math.abs(s.vs) / 10);
      c.spin += (s.vs / 0.46) * dt;
      const steer = override && override.id === id ? override.steer : 0;
      c.wheels.forEach((wh, i) => {
        wh.rotation.set(c.spin, i < 2 ? steer * 0.45 : 0, 0, 'YXZ');
        const local = wh.position;
        wh.position.y = 0.46 + (i < 2 ? (hF - s.y) : (hB - s.y)) * 0.5;
        void local;
      });
      // damaged cars smoke
      if (c.hp < CAR.maxHp * 0.45) {
        c.smoke -= dt;
        if (c.smoke <= 0) {
          c.smoke = c.hp < CAR.maxHp * 0.2 ? 0.05 : 0.14;
          this.fx.smokePuff(s.x + fx * 1.6, s.y + 1.5, s.z + fz * 1.6, (Math.random() - 0.5) * 0.4, 1.6, (Math.random() - 0.5) * 0.4, c.hp < CAR.maxHp * 0.2 ? '#3a3a40' : '#9a9aa2', 0.5, 1.4, 0.9);
        }
      }
    }
  }

  nearest(x: number, y: number, z: number, r: number) {
    let best: number | null = null, bd = r;
    for (const [id, c] of this.cars) {
      const d = Math.hypot(c.root.position.x - x, c.root.position.z - z);
      if (d < bd && Math.abs(c.root.position.y - y) < 2.5) { bd = d; best = id; }
    }
    return best;
  }
}
