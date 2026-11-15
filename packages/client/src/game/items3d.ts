import * as THREE from 'three';
import { ITEM, ITEMS, RARITIES, RARITY_COLOR, weaponDef } from '@dropzone/shared';
import { outlineMaterial, softRamp } from '../lobby/toon';
import { mat4, mergeColored, type Piece } from './geo';

/**
 * Low-poly models for every item. Weapons point down -Z with the grip at the origin,
 * so the same mesh works on the floor and in a player's hand. Rarity shows as the
 * colour of the accent panels (and the glow on the floor).
 */
const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: softRamp });
const cache = new Map<string, { geo: THREE.BufferGeometry; outline: THREE.BufferGeometry }>();

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const CYL = (r: number, len: number, seg = 8) => new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
const DARK = '#2b2d42', METAL = '#5c6370', GRIP = '#3b3030';

function weaponPieces(id: number, accent: string): Piece[] {
  const def = weaponDef(id)!;
  switch (def.cls) {
    case 'pistol': return [
      { geo: B(0.07, 0.11, 0.3), color: METAL, matrix: mat4(0, 0.1, -0.08) },
      { geo: B(0.06, 0.16, 0.08), color: GRIP, matrix: mat4(0, 0, 0.02, 0.25, 0, 0) },
      { geo: B(0.075, 0.03, 0.22), color: accent, matrix: mat4(0, 0.165, -0.08) },
      { geo: CYL(0.022, 0.06), color: DARK, matrix: mat4(0, 0.12, -0.25) },
    ];
    case 'smg': return [
      { geo: B(0.09, 0.13, 0.42), color: DARK, matrix: mat4(0, 0.1, -0.1) },
      { geo: B(0.05, 0.2, 0.07), color: GRIP, matrix: mat4(0, -0.04, 0.02, 0.2, 0, 0) },
      { geo: B(0.04, 0.22, 0.06), color: METAL, matrix: mat4(0, -0.05, -0.15) },
      { geo: B(0.095, 0.04, 0.3), color: accent, matrix: mat4(0, 0.18, -0.1) },
      { geo: CYL(0.025, 0.14), color: METAL, matrix: mat4(0, 0.12, -0.38) },
      { geo: B(0.04, 0.05, 0.18), color: DARK, matrix: mat4(0, 0.08, 0.18) },
    ];
    case 'ar': case 'burst': return [
      { geo: B(0.09, 0.14, 0.62), color: def.cls === 'burst' ? '#3d405b' : DARK, matrix: mat4(0, 0.1, -0.16) },
      { geo: B(0.06, 0.2, 0.08), color: GRIP, matrix: mat4(0, -0.05, 0.03, 0.25, 0, 0) },
      { geo: B(0.05, 0.22, 0.09), color: METAL, matrix: mat4(0, -0.06, -0.18, -0.2, 0, 0) },
      { geo: B(0.08, 0.13, 0.26), color: def.cls === 'burst' ? '#3d405b' : '#4a3b2f', matrix: mat4(0, 0.08, 0.27) },
      { geo: B(0.1, 0.05, 0.36), color: accent, matrix: mat4(0, 0.06, -0.38) },
      { geo: CYL(0.022, 0.22), color: METAL, matrix: mat4(0, 0.12, -0.58) },
      { geo: B(0.05, 0.06, 0.1), color: DARK, matrix: mat4(0, 0.2, -0.08) },
    ];
    case 'shotgun': case 'autoshotgun': return [
      { geo: CYL(0.04, 0.72), color: METAL, matrix: mat4(0, 0.13, -0.32) },
      { geo: CYL(0.035, 0.5), color: DARK, matrix: mat4(0, 0.06, -0.3) },
      { geo: B(0.09, 0.13, 0.22), color: DARK, matrix: mat4(0, 0.1, 0.0) },
      { geo: B(0.08, 0.12, 0.3), color: def.cls === 'shotgun' ? '#8b5a2b' : '#3d405b', matrix: mat4(0, 0.04, 0.24, -0.12, 0, 0) },
      { geo: B(0.1, 0.09, 0.2), color: accent, matrix: mat4(0, 0.07, -0.38) },
      { geo: B(0.05, 0.16, 0.07), color: GRIP, matrix: mat4(0, -0.03, 0.06, 0.25, 0, 0) },
    ];
    case 'dmr': case 'sniper': return [
      { geo: B(0.08, 0.12, 0.7), color: def.cls === 'sniper' ? '#556b2f' : DARK, matrix: mat4(0, 0.1, -0.12) },
      { geo: CYL(0.022, def.cls === 'sniper' ? 0.55 : 0.4), color: METAL, matrix: mat4(0, 0.12, def.cls === 'sniper' ? -0.72 : -0.64) },
      { geo: CYL(0.045, 0.32, 10), color: DARK, matrix: mat4(0, 0.24, -0.08) },
      { geo: CYL(0.05, 0.04, 10), color: accent, matrix: mat4(0, 0.24, -0.25) },
      { geo: B(0.08, 0.14, 0.3), color: def.cls === 'sniper' ? '#556b2f' : '#4a3b2f', matrix: mat4(0, 0.06, 0.34) },
      { geo: B(0.05, 0.18, 0.08), color: GRIP, matrix: mat4(0, -0.04, 0.08, 0.25, 0, 0) },
      { geo: B(0.085, 0.04, 0.3), color: accent, matrix: mat4(0, 0.03, -0.3) },
    ];
    case 'rocket': return [
      { geo: CYL(0.11, 1.0, 10), color: '#6b8e23', matrix: mat4(0, 0.16, -0.2) },
      { geo: CYL(0.13, 0.1, 10), color: accent, matrix: mat4(0, 0.16, -0.7) },
      { geo: CYL(0.13, 0.1, 10), color: accent, matrix: mat4(0, 0.16, 0.3) },
      { geo: B(0.05, 0.18, 0.08), color: GRIP, matrix: mat4(0, -0.02, -0.05, 0.2, 0, 0) },
      { geo: B(0.06, 0.1, 0.14), color: DARK, matrix: mat4(0.12, 0.26, -0.3) },
    ];
  }
  return [];
}

function itemPieces(id: number, rarity: number): Piece[] {
  const accent = RARITY_COLOR[RARITIES[Math.min(4, rarity)]];
  const d = ITEMS[id];
  if (!d) return [];
  if (d.kind === 'weapon') return weaponPieces(id, accent);
  switch (id) {
    case ITEM.grenade: return [
      { geo: new THREE.SphereGeometry(0.09, 10, 8), color: '#4b5320', matrix: mat4(0, 0.09, 0) },
      { geo: B(0.05, 0.06, 0.05), color: METAL, matrix: mat4(0, 0.19, 0) },
      { geo: new THREE.TorusGeometry(0.03, 0.008, 4, 10), color: '#c0c0c0', matrix: mat4(0.04, 0.22, 0) },
    ];
    case ITEM.bandage: return [
      { geo: new THREE.CylinderGeometry(0.08, 0.08, 0.12, 12), color: '#f5f1e8', matrix: mat4(0, 0.06, 0) },
      { geo: new THREE.CylinderGeometry(0.03, 0.03, 0.125, 8), color: '#c9c3b5', matrix: mat4(0, 0.06, 0) },
      { geo: B(0.1, 0.012, 0.18), color: '#f5f1e8', matrix: mat4(0.05, 0.006, 0.12) },
    ];
    case ITEM.medpack: return [
      { geo: B(0.34, 0.14, 0.24), color: '#f8f9fa', matrix: mat4(0, 0.07, 0) },
      { geo: B(0.2, 0.02, 0.06), color: '#e63946', matrix: mat4(0, 0.145, 0) },
      { geo: B(0.06, 0.02, 0.18), color: '#e63946', matrix: mat4(0, 0.145, 0) },
      { geo: B(0.1, 0.04, 0.03), color: DARK, matrix: mat4(0, 0.16, -0.08) },
    ];
    case ITEM.shieldSip: return [
      { geo: new THREE.SphereGeometry(0.09, 12, 10), color: '#3ee6ff', matrix: mat4(0, 0.09, 0) },
      { geo: new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8), color: '#bde0fe', matrix: mat4(0, 0.2, 0) },
      { geo: new THREE.CylinderGeometry(0.032, 0.032, 0.03, 8), color: DARK, matrix: mat4(0, 0.245, 0) },
    ];
    case ITEM.shieldJug: return [
      { geo: new THREE.CylinderGeometry(0.15, 0.17, 0.32, 12), color: '#3a86ff', matrix: mat4(0, 0.16, 0) },
      { geo: new THREE.CylinderGeometry(0.155, 0.155, 0.08, 12), color: '#3ee6ff', matrix: mat4(0, 0.2, 0) },
      { geo: new THREE.CylinderGeometry(0.05, 0.06, 0.08, 8), color: '#e9ecef', matrix: mat4(0, 0.36, 0) },
      { geo: new THREE.TorusGeometry(0.07, 0.015, 4, 10, Math.PI), color: DARK, matrix: mat4(0, 0.34, 0) },
    ];
    case ITEM.fizz: return [
      { geo: new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12), color: '#b388ff', matrix: mat4(0, 0.1, 0) },
      { geo: new THREE.CylinderGeometry(0.061, 0.061, 0.05, 12), color: '#ff5fa2', matrix: mat4(0, 0.12, 0) },
      { geo: new THREE.CylinderGeometry(0.045, 0.06, 0.02, 12), color: '#c0c0c0', matrix: mat4(0, 0.21, 0) },
    ];
  }
  if (d.kind === 'ammo') {
    const col = ['#9fd3ff', '#ffd23f', '#ff8a5c', '#ff5f6d', '#b388ff'][d.ammo];
    return [
      { geo: B(0.32, 0.18, 0.2), color: '#556b2f', matrix: mat4(0, 0.09, 0) },
      { geo: B(0.33, 0.04, 0.21), color: col, matrix: mat4(0, 0.13, 0) },
      { geo: B(0.12, 0.03, 0.05), color: DARK, matrix: mat4(0, 0.195, 0) },
    ];
  }
  return [{ geo: B(0.2, 0.2, 0.2), color: '#ff00ff' }];
}

/** A mesh (with ink outline) for an item. Geometry is shared; the mesh is new each call. */
export function itemMesh(id: number, rarity: number): THREE.Mesh {
  const key = `${id}:${rarity}`;
  let g = cache.get(key);
  if (!g) {
    const pieces = itemPieces(id, rarity);
    g = { geo: mergeColored(pieces), outline: mergeColored(pieces.map((p) => ({ ...p, color: '#000' }))) };
    cache.set(key, g);
  }
  const m = new THREE.Mesh(g.geo, mat);
  m.castShadow = true;
  const o = new THREE.Mesh(g.outline, outlineMaterial);
  o.scale.setScalar(1);
  m.add(o);
  return m;
}

/** Muzzle position (in the weapon's own frame) for flashes and tracers. */
export function muzzleOffset(id: number): THREE.Vector3 {
  const d = weaponDef(id);
  if (!d) return new THREE.Vector3(0, 0.1, -0.4);
  switch (d.cls) {
    case 'pistol': return new THREE.Vector3(0, 0.12, -0.28);
    case 'smg': return new THREE.Vector3(0, 0.12, -0.45);
    case 'shotgun': case 'autoshotgun': return new THREE.Vector3(0, 0.13, -0.68);
    case 'dmr': return new THREE.Vector3(0, 0.12, -0.85);
    case 'sniper': return new THREE.Vector3(0, 0.12, -1.0);
    case 'rocket': return new THREE.Vector3(0, 0.16, -0.75);
    default: return new THREE.Vector3(0, 0.12, -0.7);
  }
}
