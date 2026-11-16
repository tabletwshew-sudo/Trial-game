import * as THREE from 'three';

/**
 * Tiling noise baked into small textures once at load, so shaders read a texture instead of
 * evaluating noise per pixel (the sky and water used to run 5-11 noise calls for every pixel).
 */

/** Tileable fractal value noise, values roughly 0..1. `period` = lattice cells across at the first octave. */
export function tileFbm(size: number, period: number, octaves: number, seed: number): Float32Array {
  const out = new Float32Array(size * size);
  let amp = 0.5, total = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    const lat = new Float32Array(p * p);
    let s = (seed * 9301 + o * 49297 + 233280) >>> 0;
    for (let i = 0; i < lat.length; i++) { s = (s * 1664525 + 1013904223) >>> 0; lat[i] = s / 2 ** 32; }
    const k = p / size;
    for (let y = 0; y < size; y++) {
      const fy = y * k, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % p) * p, y1 = ((iy + 1) % p) * p;
      for (let x = 0; x < size; x++) {
        const fx = x * k, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % p, x1 = (ix + 1) % p;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp; amp *= 0.5; p *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function texture(data: Uint8Array, size: number, format: THREE.PixelFormat) {
  const t = new THREE.DataTexture(data, size, size, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Single-channel tiling fbm (sky streaks). */
export function noiseTexture(size = 256, period = 8, octaves = 5, seed = 1) {
  const f = tileFbm(size, period, octaves, seed);
  const d = new Uint8Array(size * size * 4);
  for (let i = 0; i < f.length; i++) { const v = Math.round(Math.min(1, Math.max(0, f[i])) * 255); d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; }
  return texture(d, size, THREE.RGBAFormat);
}

/**
 * Water ripples: RG = the ripple slope (x, z), B and A = two independent noise fields for foam.
 * Ripples are a mix of soft noise and sharper crests, so the surface reads as small waves.
 */
export function waveTexture(size = 256) {
  const h = tileFbm(size, 6, 4, 11), h2 = tileFbm(size, 16, 3, 23), n1 = tileFbm(size, 4, 3, 37), n2 = tileFbm(size, 12, 3, 41);
  const H = new Float32Array(size * size);
  for (let i = 0; i < H.length; i++) {
    // ridged crests on top of rolling swell
    const r = 1 - Math.abs(h2[i] * 2 - 1);
    H[i] = h[i] * 0.7 + r * r * 0.3;
  }
  const d = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const sx = (at(x - 1, y) - at(x + 1, y)) * size * 0.06, sz = (at(x, y - 1) - at(x, y + 1)) * size * 0.06;
    d[i * 4] = Math.round(Math.min(1, Math.max(0, sx * 0.5 + 0.5)) * 255);
    d[i * 4 + 1] = Math.round(Math.min(1, Math.max(0, sz * 0.5 + 0.5)) * 255);
    d[i * 4 + 2] = Math.round(n1[i] * 255);
    d[i * 4 + 3] = Math.round(n2[i] * 255);
  }
  return texture(d, size, THREE.RGBAFormat);
}

let _detail: THREE.DataTexture | null = null;
/** One shared tiling grain/blotch texture for surface detail on terrain and buildings. */
export function detailNoise() {
  if (!_detail) { _detail = noiseTexture(256, 8, 5, 3); _detail.anisotropy = 8; }
  return _detail;
}
