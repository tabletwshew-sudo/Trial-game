import * as THREE from 'three';
import { ITEMS, RARITIES, RARITY_COLOR, itemRarity, type LootView } from '@dropzone/shared';
import { itemMesh } from './items3d';

/**
 * Floor loot: nearby pickups are drawn as their real model, floating and spinning slowly
 * above a glowing rarity-coloured ring. Far ones aren't drawn at all, and middle-distance ones
 * skip their outline and shadow.
 */
const SHOW = 56;
/** Closer than this the model gets its outline and casts a shadow (both cost a draw call each). */
const DETAIL = 24;

export class LootRenderer {
  readonly items = new Map<number, LootView>();
  private meshes = new Map<number, THREE.Group>();
  private ringGeo = new THREE.RingGeometry(0.34, 0.58, 28).rotateX(-Math.PI / 2);
  private beamGeo = new THREE.CylinderGeometry(0.05, 0.22, 2.6, 10, 1, true).translate(0, 1.3, 0);
  private ringMats = RARITIES.map((r) => new THREE.MeshBasicMaterial({ color: new THREE.Color(RARITY_COLOR[r]).multiplyScalar(2.2 + RARITIES.indexOf(r) * 0.5), transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  private beamMats = RARITIES.map((r) => new THREE.MeshBasicMaterial({ color: RARITY_COLOR[r], transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, fog: false, blending: THREE.AdditiveBlending }));
  private timer = 0;

  constructor(private scene: THREE.Scene) {}

  set(list: LootView[]) { this.clear(); for (const it of list) this.items.set(it.id, it); }
  add(list: LootView[]) { for (const it of list) this.items.set(it.id, it); }
  remove(ids: number[]) { for (const id of ids) { this.items.delete(id); this.drop(id); } }
  private drop(id: number) { const m = this.meshes.get(id); if (m) { this.scene.remove(m); this.meshes.delete(id); } }
  clear() { for (const id of [...this.meshes.keys()]) this.drop(id); this.items.clear(); }

  update(dt: number, t: number, cam: THREE.Vector3) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.3;
      for (const [id, it] of this.items) {
        const near = (it.x - cam.x) ** 2 + (it.z - cam.z) ** 2 < SHOW * SHOW;
        if (near && !this.meshes.has(id)) {
          const g = new THREE.Group();
          const r = itemRarity(it.item, it.r);
          const model = itemMesh(it.item, it.r);
          const isWeapon = ITEMS[it.item]?.kind === 'weapon';
          model.position.y = isWeapon ? 0.45 : 0.3;
          model.scale.setScalar(isWeapon ? 1.7 : 2.0);
          model.name = 'model';
          const ring = new THREE.Mesh(this.ringGeo, this.ringMats[r]);
          ring.position.y = 0.04;
          g.add(model, ring);
          if ((r >= 2 || isWeapon) && ITEMS[it.item]?.kind !== 'forage') g.add(new THREE.Mesh(this.beamGeo, this.beamMats[r]));
          g.position.set(it.x, it.y, it.z);
          g.userData.phase = (id % 17) / 17;
          g.userData.weapon = isWeapon;
          this.scene.add(g);
          this.meshes.set(id, g);
        } else if (!near && this.meshes.has(id)) this.drop(id);
      }
      for (const [id, g] of this.meshes) {
        const it = this.items.get(id);
        if (!it) continue;
        const close = (it.x - cam.x) ** 2 + (it.z - cam.z) ** 2 < DETAIL * DETAIL;
        const m = g.getObjectByName('model') as THREE.Mesh;
        m.castShadow = close;
        if (m.children[0]) m.children[0].visible = close;
      }
    }
    for (const g of this.meshes.values()) {
      const m = g.getObjectByName('model')!;
      m.rotation.y = t * 0.9 + g.userData.phase * 6;
      m.position.y = (g.userData.weapon ? 0.45 : 0.3) + Math.sin(t * 2 + g.userData.phase * 6) * 0.06;
    }
  }

  /** The item a pickup press would grab (mirrors the server's choice). */
  pickTarget(x: number, y: number, z: number, yaw: number): LootView | null {
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let best: LootView | null = null, bestScore = Infinity;
    for (const it of this.items.values()) {
      const dx = it.x - x, dz = it.z - z, d = Math.hypot(dx, dz);
      if (d > 2.6 || Math.abs(it.y - y) > 2 || ITEMS[it.item]?.kind === 'ammo') continue; // ammo is picked up by walking over it
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      const score = d + (1 - facing) * 1.5;
      if (score < bestScore) { bestScore = score; best = it; }
    }
    return best;
  }
}
