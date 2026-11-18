import * as THREE from 'three';
import type { Effects } from './effects';
import { CAR, clamp, surfaceAt, type VehSnap, type World } from '@dropzone/shared';
import { outlineMaterial, softRamp } from '../lobby/toon';
import { mat4, mergeColored, type Piece } from './geo';
import { surfaceUnder } from './soundscape';

/**
 * An original off-road pickup: a rounded body with proper wheel arches and fender flares, a
 * raked cab, grille and round lamps, a roll bar with spot lamps, a spare wheel in the bed, and
 * knobbly tyres on five-spoke rims. Front is -Z.
 */
const PAINTS = ['#e63946', '#2a9d8f', '#f4a261', '#457b9d', '#ffd23f', '#6a994e', '#8338ec', '#ff6fb5'];
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
const DARK = '#2b2d42', TRIM = '#f1faee', CHROME = '#d9dde3', GLASS = '#9fd8ef', TYRE = '#25252d';

/** A side profile (u forward, y up) extruded across the car's width with rounded edges. */
function profile(shape: THREE.Shape, width: number, bevel: number, x = 0) {
  const depth = Math.max(0.01, width - bevel * 2);
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 12 });
  g.translate(0, 0, -depth / 2);
  g.rotateY(Math.PI / 2); // shape u -> -z (front), extrusion -> x (across)
  if (x) g.translate(x, 0, 0);
  return g;
}
const poly = (pts: [number, number][]) => new THREE.Shape(pts.map(([u, y]) => new THREE.Vector2(u, y)));
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: string): Piece =>
  ({ geo: new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), color, matrix: mat4((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) });
const cyl = (r: number, len: number, color: string, matrix: THREE.Matrix4, seg = 12): Piece => ({ geo: new THREE.CylinderGeometry(r, r, len, seg), color, matrix });

const WHEEL_R = 0.5, WHEEL_U = 1.35, WHEEL_X = 1.06;

function wheelPieces(): Piece[] {
  const out: Piece[] = [
    cyl(WHEEL_R - 0.02, 0.42, TYRE, mat4(0, 0, 0, 0, 0, Math.PI / 2), 22),
    cyl(0.31, 0.44, CHROME, mat4(0, 0, 0, 0, 0, Math.PI / 2), 16),
    cyl(0.25, 0.45, '#4a4f5c', mat4(0, 0, 0, 0, 0, Math.PI / 2), 14),
    cyl(0.085, 0.47, '#ffd23f', mat4(0, 0, 0, 0, 0, Math.PI / 2), 8),
  ];
  // knobbly tread
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    out.push({ geo: new THREE.BoxGeometry(0.44, 0.07, 0.13), color: '#1b1b22', matrix: mat4(0, Math.cos(a) * (WHEEL_R - 0.015), Math.sin(a) * (WHEEL_R - 0.015), a) });
  }
  // five spokes across the hub (ten arms)
  for (let k = 0; k < 5; k++) out.push({ geo: new THREE.BoxGeometry(0.455, 0.5, 0.065), color: CHROME, matrix: mat4(0, 0, 0, (k / 5) * Math.PI) });
  return out;
}
const wheelGeo = mergeColored(wheelPieces());

function bodyGeo(paint: string, seed: number) {
  const pieces: Piece[] = [];
  const two = seed % 3 === 0; // some have a white roof and roll bar, some a dark one
  const roof = two ? TRIM : paint;

  // lower body: wheel arches cut out of the bottom edge
  const s = new THREE.Shape();
  const archR = 0.66, archY = WHEEL_R, cut = Math.asin(Math.min(1, (0.62 - archY) / archR));
  s.moveTo(-2.12, 0.62);
  s.lineTo(-WHEEL_U - archR * Math.cos(cut), 0.62);
  s.absarc(-WHEEL_U, archY, archR, Math.PI - cut, cut, true);
  s.lineTo(WHEEL_U - archR * Math.cos(cut), 0.62);
  s.absarc(WHEEL_U, archY, archR, Math.PI - cut, cut, true);
  s.lineTo(2.14, 0.62);
  s.lineTo(2.22, 0.86);
  s.lineTo(2.16, 1.1);
  s.quadraticCurveTo(1.6, 1.24, 0.86, 1.3);
  s.lineTo(-0.76, 1.3);
  s.lineTo(-2.06, 1.22);
  s.lineTo(-2.14, 0.92);
  s.lineTo(-2.12, 0.62);
  pieces.push({ geo: profile(s, 1.96, 0.07), color: paint });

  // cab with a raked windscreen
  pieces.push({ geo: profile(poly([[0.86, 1.26], [0.3, 1.98], [-0.52, 2.03], [-0.74, 1.92], [-0.77, 1.26]]), 1.78, 0.08), color: roof });
  // side windows (poke out through both sides of the cab), windscreen and back window
  pieces.push({ geo: profile(poly([[0.66, 1.4], [0.29, 1.88], [-0.48, 1.92], [-0.64, 1.4]]), 1.9, 0), color: GLASS });
  const rake = Math.atan2(0.56, 0.72);
  pieces.push({ geo: new THREE.BoxGeometry(1.55, 0.78, 0.03), color: GLASS, matrix: mat4(0, 1.64 + Math.sin(rake) * 0.06, -0.58 - Math.cos(rake) * 0.06, rake) });
  pieces.push(box(-0.7, 1.42, 0.86, 0.7, 1.86, 0.89, GLASS));
  // side stripe and door lines
  for (const sx of [-1, 1]) {
    const side = sx * 0.99;
    pieces.push(box(side - 0.012, 1.13, -2.0, side + 0.012, 1.21, 1.98, two ? DARK : TRIM));
    pieces.push(box(side - 0.01, 0.7, 0.6, side + 0.01, 1.28, 0.64, DARK));
    pieces.push(box(side - 0.01, 0.7, -0.84, side + 0.01, 1.28, -0.8, DARK));
    pieces.push(box(side - 0.012, 1.0, -0.5, side + 0.012, 1.04, -0.32, CHROME)); // door handle
    // mirrors
    pieces.push(box(sx * 0.95, 1.5, -0.66, sx * 1.12, 1.54, -0.6, DARK));
    pieces.push(box(sx * 1.1 - 0.05, 1.45, -0.7, sx * 1.1 + 0.07, 1.66, -0.58, roof));
  }
  // fender flares over every wheel
  const flare = new THREE.Shape();
  flare.absarc(0, 0, 0.76, 0.12, Math.PI - 0.12, false);
  flare.absarc(0, 0, 0.64, Math.PI - 0.12, 0.12, true);
  for (const sx of [-1, 1]) for (const u of [-WHEEL_U, WHEEL_U]) {
    const g = profile(flare, 0.2, 0.025, sx * 1.02); g.translate(0, archY, -u);
    pieces.push({ geo: g, color: DARK });
  }
  // bed: walls, tailgate, wooden floor
  for (const sx of [-1, 1]) pieces.push(box(sx * 0.97 - 0.05, 1.2, 0.78, sx * 0.97 + 0.05, 1.58, 2.08, paint));
  pieces.push(box(-1.0, 1.2, 2.02, 1.0, 1.58, 2.12, paint));
  pieces.push(box(-0.92, 1.21, 0.8, 0.92, 1.25, 2.02, '#7a5a3f'));
  for (const sx of [-1, 1]) pieces.push(box(sx * 0.98 - 0.06, 1.56, 0.78, sx * 0.98 + 0.06, 1.62, 2.12, DARK)); // rails
  // roll bar with two spot lamps
  for (const sx of [-1, 1]) pieces.push(cyl(0.065, 1.1, roof === TRIM ? DARK : TRIM, mat4(sx * 0.84, 1.8, 0.86), 8));
  pieces.push(cyl(0.065, 1.74, roof === TRIM ? DARK : TRIM, mat4(0, 2.35, 0.86, 0, 0, Math.PI / 2), 8));
  for (const sx of [-1, 1]) {
    pieces.push(cyl(0.12, 0.12, DARK, mat4(sx * 0.5, 2.48, 0.86, Math.PI / 2), 12));
    pieces.push(cyl(0.095, 0.02, '#fff7c2', mat4(sx * 0.5, 2.48, 0.79, Math.PI / 2), 12));
  }
  // spare wheel standing in the bed
  const spare = mat4(0, 1.72, 1.06, 0, Math.PI / 2, 0, 0.85);
  for (const p of wheelPieces()) pieces.push({ ...p, matrix: spare.clone().multiply(p.matrix ?? new THREE.Matrix4()) });
  // front: grille, lamps, bumper with a winch-style bar
  // (the body's nose is at z = -2.29 with its rounded edge, the tail at +2.2)
  pieces.push(box(-0.6, 0.74, -2.31, 0.6, 1.04, -2.26, DARK));
  for (const y of [0.8, 0.89, 0.98]) pieces.push(box(-0.56, y - 0.015, -2.33, 0.56, y + 0.015, -2.3, CHROME));
  for (const sx of [-1, 1]) {
    pieces.push(cyl(0.19, 0.06, CHROME, mat4(sx * 0.8, 0.95, -2.29, Math.PI / 2), 14));
    pieces.push(cyl(0.15, 0.06, '#fff6c4', mat4(sx * 0.8, 0.95, -2.31, Math.PI / 2), 14));
    pieces.push(box(sx * 0.8 - 0.14, 0.98, 2.17, sx * 0.8 + 0.14, 1.14, 2.23, '#ff3b5c')); // tail lights
  }
  pieces.push({ geo: profile(poly([[2.16, 0.5], [2.42, 0.52], [2.44, 0.78], [2.18, 0.8]]), 2.12, 0.05), color: DARK });
  pieces.push({ geo: profile(poly([[-2.1, 0.52], [-2.34, 0.52], [-2.36, 0.76], [-2.12, 0.78]]), 2.08, 0.05), color: DARK });
  // exhaust
  pieces.push(cyl(0.07, 0.34, '#55565e', mat4(0.62, 0.6, 2.32, Math.PI / 2), 8));
  return mergeColored(pieces);
}

/** Where the exhaust is, in the car's frame (for boost flames and puffs). */
const EXHAUST = { x: 0.62, y: 0.6, z: 2.5 };

interface CarView {
  root: THREE.Group; body: THREE.Group; wheels: THREE.Mesh[]; hist: { t: number; s: VehSnap }[];
  spin: number; smoke: number; hp: number; seen: number;
  /** smoothed body motion: lean in corners, squat/dive under throttle and brakes */
  roll: number; dive: number; lastVs: number; lastVh: number; dust: number;
}

export class CarRenderer {
  readonly cars = new Map<number, CarView>();
  constructor(private scene: THREE.Scene, private w: World, private fx: Effects) {}

  private make(id: number): CarView {
    const root = new THREE.Group(), body = new THREE.Group();
    const geo = bodyGeo(PAINTS[id % PAINTS.length], id);
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    const ol = new THREE.Mesh(geo, outlineMaterial);
    body.add(m, ol);
    const wheels: THREE.Mesh[] = [];
    for (const [x, z] of [[-WHEEL_X, -WHEEL_U], [WHEEL_X, -WHEEL_U], [-WHEEL_X, WHEEL_U], [WHEEL_X, WHEEL_U]]) {
      const wh = new THREE.Mesh(wheelGeo, mat);
      wh.position.set(x, WHEEL_R, z); wh.castShadow = true;
      wheels.push(wh); root.add(wh);
    }
    root.add(body);
    this.scene.add(root);
    return { root, body, wheels, hist: [], spin: 0, smoke: 0, hp: CAR.maxHp, seen: 0, roll: 0, dive: 0, lastVs: 0, lastVh: 0, dust: 0 };
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
  sample(id: number, rt: number): { x: number; y: number; z: number; vh: number; vs: number; boost: boolean } | null {
    const c = this.cars.get(id);
    if (!c || !c.hist.length) return null;
    const h = c.hist;
    let b = h.length - 1;
    while (b > 0 && h[b - 1].t > rt) b--;
    const B = h[b].s, A = h[Math.max(0, b - 1)].s, tA = h[Math.max(0, b - 1)].t, tB = h[b].t;
    const k = tB > tA ? clamp((rt - tA) / (tB - tA), 0, 1) : 1;
    let dh = B.vh - A.vh; if (dh > Math.PI) dh -= Math.PI * 2; if (dh < -Math.PI) dh += Math.PI * 2;
    return { x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, vh: A.vh + dh * k, vs: A.vs + (B.vs - A.vs) * k, boost: !!B.boost };
  }

  /** `override` = the car you are driving (predicted locally, so no delay). */
  update(dt: number, rt: number, override?: { id: number; x: number; y: number; z: number; vh: number; vs: number; steer: number; boost?: boolean; handbrake?: boolean }, cam?: THREE.Vector3) {
    for (const [id, c] of this.cars) {
      const mine = !!override && override.id === id;
      const s = mine ? override! : this.sample(id, rt);
      if (!s) continue;
      // far cars are a few pixels: skip them, and only near ones cast shadows
      const d2 = cam ? (s.x - cam.x) ** 2 + (s.z - cam.z) ** 2 : 0;
      c.root.visible = d2 < 450 * 450;
      if (!c.root.visible) { c.lastVs = s.vs; c.lastVh = s.vh; continue; }
      const shadow = d2 < 90 * 90;
      if (c.wheels[0].castShadow !== shadow) { c.wheels.forEach((wh) => (wh.castShadow = shadow)); (c.body.children[0] as THREE.Mesh).castShadow = shadow; }
      c.root.position.set(s.x, s.y, s.z);
      c.root.rotation.y = s.vh;
      const fx = -Math.sin(s.vh), fz = -Math.cos(s.vh), rx = Math.cos(s.vh), rz = -Math.sin(s.vh);
      // each wheel follows the ground under it (a little suspension), and the body sits on them
      const hs = [[-WHEEL_X, -WHEEL_U], [WHEEL_X, -WHEEL_U], [-WHEEL_X, WHEEL_U], [WHEEL_X, WHEEL_U]].map(([x, u]) =>
        surfaceAt(this.w, s.x + rx * x + fx * -u, s.z + rz * x + fz * -u, s.y + 1) - s.y);
      const hF = (hs[0] + hs[1]) / 2, hB = (hs[2] + hs[3]) / 2, hL = (hs[0] + hs[2]) / 2, hR = (hs[1] + hs[3]) / 2;
      const pitch = clamp(Math.atan2(hF - hB, WHEEL_U * 2), -0.5, 0.5), roll = clamp(Math.atan2(hR - hL, WHEEL_X * 2), -0.4, 0.4);
      // lean out of corners, squat when accelerating, dive when braking
      let dvh = s.vh - c.lastVh; if (dvh > Math.PI) dvh -= Math.PI * 2; if (dvh < -Math.PI) dvh += Math.PI * 2;
      const turn = dt > 0 ? dvh / dt : 0, acc = dt > 0 ? (s.vs - c.lastVs) / dt : 0;
      c.lastVh = s.vh; c.lastVs = s.vs;
      const k = Math.min(1, dt * 8);
      c.roll += (clamp(-turn * Math.abs(s.vs) * 0.004, -0.11, 0.11) - c.roll) * k;
      c.dive += (clamp(acc * 0.006, -0.07, 0.06) - c.dive) * k;
      c.body.rotation.set(-pitch + c.dive, 0, roll + c.roll);
      c.body.position.y = (hF + hB) / 2 * 0.5 + Math.sin(performance.now() / 85 + id) * 0.012 * Math.min(1, Math.abs(s.vs) / 10);
      c.spin += (s.vs / WHEEL_R) * dt;
      const steer = mine ? override!.steer : 0;
      c.wheels.forEach((wh, i) => {
        wh.rotation.set(-c.spin, i < 2 ? -steer * 0.45 : 0, 0, 'YXZ');
        wh.position.y = WHEEL_R + clamp(hs[i], -0.25, 0.3);
      });

      // effects behind the rear wheels and at the exhaust
      const speed = Math.abs(s.vs);
      const boost = mine ? !!override!.boost : 'boost' in s && !!(s as { boost?: boolean }).boost;
      c.dust -= dt;
      if (c.dust <= 0 && (speed > 7 || boost)) {
        c.dust = 0.04;
        const surf = surfaceUnder(this.w, s.x, s.y + 0.1, s.z);
        const col = surf === 'grass' ? '#a9c47f' : surf === 'dirt' ? '#c8a77c' : surf === 'sand' ? '#eadbb0' : null;
        for (const side of [-1, 1]) {
          const wx = s.x + rx * side * WHEEL_X - fx * WHEEL_U, wz = s.z + rz * side * WHEEL_X - fz * WHEEL_U;
          if (col && speed > 7) this.fx.smokePuff(wx, s.y + 0.25, wz, -fx * speed * 0.08 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, -fz * speed * 0.08 + (Math.random() - 0.5), col, 0.45, 1.1, 1.8);
          // drifting on the handbrake: tyre smoke
          if (mine && override!.handbrake && speed > 9) this.fx.smokePuff(wx, s.y + 0.2, wz, (Math.random() - 0.5) * 1.2, 0.6, (Math.random() - 0.5) * 1.2, '#e9e9ee', 0.5, 1.2, 2);
        }
      }
      if (boost) {
        // flames out of the exhaust, streaming back
        const ex = s.x + rx * EXHAUST.x - fx * EXHAUST.z, ez = s.z + rz * EXHAUST.x - fz * EXHAUST.z, ey = s.y + EXHAUST.y;
        for (let i = 0; i < 3; i++) this.fx.spark(ex, ey, ez, -fx * (6 + Math.random() * 4) + (Math.random() - 0.5), 0.3 + Math.random() * 0.5, -fz * (6 + Math.random() * 4) + (Math.random() - 0.5), i ? '#ffb347' : '#fff1a8', 0.12, 0.22, 0);
        if (Math.random() < dt * 20) this.fx.smokePuff(ex, ey, ez, -fx * 3, 0.6, -fz * 3, '#8a8a92', 0.35, 0.7, 1.4);
      }

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
