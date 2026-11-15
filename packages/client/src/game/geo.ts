import * as THREE from 'three';

export interface Piece { geo: THREE.BufferGeometry; color: THREE.ColorRepresentation; matrix?: THREE.Matrix4 }

/** Merge geometries into one non-indexed geometry with baked transforms and vertex colours. */
export function mergeColored(pieces: Piece[]): THREE.BufferGeometry {
  const gs = pieces.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    return g;
  });
  const total = gs.reduce((n, g) => n + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), col = new Float32Array(total * 3);
  const c = new THREE.Color();
  let o = 0;
  gs.forEach((g, i) => {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    c.set(pieces[i].color);
    for (let k = 0; k < n; k++) { col[(o + k) * 3] = c.r; col[(o + k) * 3 + 1] = c.g; col[(o + k) * 3 + 2] = c.b; }
    o += n;
    g.dispose();
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

export const mat4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));

type V3 = [number, number, number];

/** Append-only builder for flat-shaded, vertex-coloured geometry (buildings, props). */
export class GeoBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private c = new THREE.Color();

  private push(p: V3, n: V3) { this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.col.push(this.c.r, this.c.g, this.c.b); }

  /** Triangle; flipped if needed so its normal agrees with `hint`. */
  tri(a: V3, b: V3, c: V3, color: THREE.ColorRepresentation, hint?: V3) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let n: V3 = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    if (hint && n[0] * hint[0] + n[1] * hint[1] + n[2] * hint[2] < 0) { [b, c] = [c, b]; n = [-n[0], -n[1], -n[2]]; }
    this.c.set(color);
    this.push(a, n); this.push(b, n); this.push(c, n);
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: THREE.ColorRepresentation, hint?: V3) {
    this.tri(a, b, c, color, hint); this.tri(a, c, d, color, hint);
  }
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.ColorRepresentation, bottom = false) {
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], color, [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, [-1, 0, 0]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], color, [0, 0, -1]);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], color, [0, 1, 0]);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, [0, -1, 0]);
  }
  /** Box with a colour per face (null = skip that face). Faces: +x, -x, +z, -z, +y, -y. */
  boxFaces(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: (THREE.ColorRepresentation | null)[]) {
    if (c[0]) this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], c[0], [1, 0, 0]);
    if (c[1]) this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], c[1], [-1, 0, 0]);
    if (c[2]) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c[2], [0, 0, 1]);
    if (c[3]) this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c[3], [0, 0, -1]);
    if (c[4]) this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], c[4], [0, 1, 0]);
    if (c[5]) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], c[5], [0, -1, 0]);
  }
  /** Vertical cylinder (flat-shaded sides) with a cap or a cone/dome top. */
  cylinder(cx: number, y0: number, cz: number, r: number, y1: number, color: THREE.ColorRepresentation, seg = 10, topH = 0, topColor = color) {
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2, a1 = ((i + 1) / seg) * Math.PI * 2;
      const x0 = cx + Math.cos(a0) * r, z0 = cz + Math.sin(a0) * r, x1 = cx + Math.cos(a1) * r, z1 = cz + Math.sin(a1) * r;
      const out: V3 = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      this.quad([x0, y0, z0], [x1, y0, z1], [x1, y1, z1], [x0, y1, z0], color, out);
      this.tri([x0, y1, z0], [x1, y1, z1], [cx, y1 + topH, cz], topColor, [out[0] * 0.3, 1, out[2] * 0.3]);
    }
  }
  get vertexCount() { return this.pos.length / 3; }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.col), 3));
    g.computeBoundingSphere();
    return g;
  }
}
