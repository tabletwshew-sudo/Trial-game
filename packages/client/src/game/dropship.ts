import * as THREE from 'three';
import { softRamp } from '../lobby/toon';
import { GeoBuilder, mat4, mergeColored } from './geo';

/**
 * The dropship: an original cargo airship. A striped envelope, a gondola with
 * an open jump door, tail fins and two spinning prop pods. Nose points along +Z.
 */
export function buildDropship() {
  const root = new THREE.Group();
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp, side: THREE.DoubleSide });

  // envelope: capsule built from coloured bands so it reads as stitched panels
  const pieces: Parameters<typeof mergeColored>[0] = [];
  const bands = 11, len = 36, rad = 6.6;
  for (let i = 0; i < bands; i++) {
    const t0 = i / bands, t1 = (i + 1) / bands;
    const r = (t: number) => Math.max(0.5, Math.sqrt(Math.max(0, 1 - (2 * (0.03 + t * 0.94) - 1) ** 2)) * rad * (0.82 + 0.18 * t));
    const geo = new THREE.CylinderGeometry(r(t1), r(t0), len / bands, 20, 1, true);
    pieces.push({ geo, color: i % 2 ? '#ffd23f' : '#3b3fb8', matrix: mat4(0, 9.5, -len / 2 + (i + 0.5) * (len / bands), Math.PI / 2, 0, 0) });
  }
  pieces.push({ geo: new THREE.SphereGeometry(1.5, 12, 8), color: '#ff5fa2', matrix: mat4(0, 9.5, len / 2 - 0.3, 0, 0, 0, 1.6, 1.6, 1.2) });
  pieces.push({ geo: new THREE.SphereGeometry(1.4, 10, 8), color: '#3b3fb8', matrix: mat4(0, 9.5, -len / 2 + 0.3) });
  // tail fins
  for (const [rz, c] of [[0, '#ff5fa2'], [Math.PI / 2, '#ffd23f'], [Math.PI, '#ff5fa2'], [-Math.PI / 2, '#ffd23f']] as const) {
    pieces.push({ geo: new THREE.BoxGeometry(0.35, 6.5, 6), color: c, matrix: new THREE.Matrix4().makeTranslation(0, 9.5, -len / 2 + 3.2).multiply(new THREE.Matrix4().makeRotationZ(rz)).multiply(mat4(0, 5.6, 0, -0.35, 0, 0)) });
  }
  // prop pods on struts
  for (const side of [-1, 1]) {
    pieces.push({ geo: new THREE.CylinderGeometry(0.16, 0.16, 5, 6), color: '#2b2d42', matrix: mat4(side * 5.4, 4.2, -1, 0, 0, (side * Math.PI) / 2.6) });
    pieces.push({ geo: new THREE.CapsuleGeometry(0.9, 2.2, 4, 10), color: '#e9ecef', matrix: mat4(side * 7.6, 3.1, -1, Math.PI / 2, 0, 0) });
    pieces.push({ geo: new THREE.ConeGeometry(0.5, 0.9, 8), color: '#ff5fa2', matrix: mat4(side * 7.6, 3.1, 1.2, Math.PI / 2, 0, 0) });
  }
  const hull = new THREE.Mesh(mergeColored(pieces), mat);
  root.add(hull);

  // gondola (hand-built so the jump door is a real opening)
  const g = new GeoBuilder();
  const W = 2.6, L = 7.5, y0 = -0.2, y1 = 3.2;
  g.box(-W, y0 - 0.35, -L, W, y0, L, '#2b2d42', true);                 // floor
  g.box(-W, y1, -L, W, y1 + 0.3, L, '#3b3fb8', true);                  // ceiling
  g.box(-W, y0, -L, W, y1, -L + 0.25, '#f1f3f5', true);                // back wall
  g.box(-W, y0, L - 0.25, W, y1, L, '#f1f3f5', true);                  // front wall
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -W : W - 0.25, x1 = side < 0 ? -W + 0.25 : W;
    g.box(x0, y0, -L, x1, y1, -2.2, '#f1f3f5', true);                  // door gap between z -2.2 and 2.2
    g.box(x0, y0, 2.2, x1, y1, L, '#f1f3f5', true);
    g.box(x0, y1 - 0.5, -2.2, x1, y1, 2.2, '#ffd23f', true);           // door header
    for (const z of [-5.6, -3.9, 3.9, 5.6]) g.box(side * (W + 0.02) - 0.02, 1.4, z - 0.6, side * (W + 0.02) + 0.02, 2.5, z + 0.6, '#8fd0ea', true);
    g.box(side * W - 0.1, y0 - 0.05, -2.2, side * (W + 1.1), y0 + 0.05, 2.2, '#ffd23f', true); // jump step
  }
  g.box(-W - 0.05, 0.9, -L - 0.02, W + 0.05, 1.2, L + 0.02, '#ff5fa2', true); // stripe
  for (const [x, z] of [[-2, -6.5], [2, -6.5], [-2, 6.5], [2, 6.5]]) g.box(x - 0.06, y1 + 0.3, z - 0.06, x + 0.06, 4.6, z + 0.06, '#2b2d42'); // rigging
  const gondola = new THREE.Mesh(g.build(), mat);
  root.add(gondola);

  // propellers
  const props: THREE.Mesh[] = [];
  const bladeGeo = mergeColored([
    { geo: new THREE.BoxGeometry(3.4, 0.34, 0.08), color: '#2b2d42' },
    { geo: new THREE.BoxGeometry(0.34, 3.4, 0.08), color: '#2b2d42' },
  ]);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(bladeGeo, mat);
    p.position.set(side * 7.6, 3.1, 1.75);
    props.push(p); root.add(p);
  }
  root.traverse((o) => { o.castShadow = false; });
  return {
    root,
    update(dt: number, t: number) {
      for (const p of props) p.rotation.z += dt * 30;
      hull.position.y = Math.sin(t * 0.8) * 0.25;
      root.rotation.z = Math.sin(t * 0.5) * 0.02;
    },
  };
}
