import { hash2, mulberry32 } from './noise.js';
import { SK, boxSolid, type Prop, type Solid, type Spot } from './structures.js';
import { BRIDGE_Y, ROOF_FLAT, ROOF_GABLE_X, SPAWN_ISLAND, roadEdgeDist, terrainAt, type Ladder, type Poi, type Vault, type World, type Zip } from './world.js';

/**
 * Outdoor details: street furniture, farm fences, camp tents, harbor docks, landmarks,
 * location signs, power lines and caves. Props listed here are drawn by the client;
 * the solid ones also block players, bullets and cars.
 */

export interface Cave {
  x: number; z: number; dx: number; dz: number; len: number; width: number; floor: number; ceil: number;
  chest: Spot; crystals: { x: number; y: number; z: number; s: number; c: number }[];
}
export interface Exclusion { x: number; z: number; r: number }

const BOX_CELL = 32;
const gridKey = (cx: number, cz: number) => (cx + 512) * 1024 + (cz + 512);

export function genProps(w: World, solids: Solid[]): { props: Prop[]; caves: Cave[]; excl: Exclusion[]; extraChests: Spot[]; beacons: { x: number; y: number; z: number }[]; vaults: Vault[]; ladders: Ladder[]; zips: Zip[]; pads: { x: number; y: number; z: number }[] } {
  const props: Prop[] = [];
  const excl: Exclusion[] = [];
  const extraChests: Spot[] = [];
  const rnd = mulberry32(w.seed * 13 + 5);
  const ground = (x: number, z: number) => terrainAt(w, x, z);
  const nearBuilding = (x: number, z: number, pad: number) => {
    const list = w.boxGrid.get(gridKey(Math.floor(x / BOX_CELL), Math.floor(z / BOX_CELL)));
    return !!list && list.some((b) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad);
  };
  const clear = (x: number, z: number, pad: number) => !nearBuilding(x, z, pad) && roadEdgeDist(w, x, z) > pad * 0.6 && ground(x, z) > 1.3;
  const put = (t: string, x: number, z: number, rot: number, s = 1, solid?: { hx: number; hz: number; h: number }, extra: Partial<Prop> = {}) => {
    const y = ground(x, z);
    props.push({ t, x, y, z, rot, s, ...extra });
    if (solid) {
      // rotations are multiples of 90 degrees for solid props, so swap extents when turned sideways
      const side = Math.round(rot / (Math.PI / 2)) % 2 !== 0;
      solids.push(boxSolid(x, z, side ? solid.hz : solid.hx, side ? solid.hx : solid.hz, y - 0.3, y + solid.h, SK.Prop));
    }
    excl.push({ x, z, r: Math.max(2, (solid ? Math.max(solid.hx, solid.hz) : 1) + 1.5) });
  };
  const q = (r: number) => Math.round(r / (Math.PI / 2)) * (Math.PI / 2);

  // ---------------------------------------------------------------- per location
  for (const p of w.pois) {
    const streets = w.roads.filter((r) => r.street && Math.hypot(r.pts[0] - p.x, r.pts[1] - p.z) < p.r * 1.3);
    // street lamps, bins and benches along streets
    if (p.kind === 'city' || p.kind === 'town' || p.kind === 'harbor' || p.kind === 'resort') {
      for (const r of streets) {
        for (let i = 3; i < r.pts.length / 2 - 3; i += 5) {
          const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
          const tx = r.pts[i * 2 + 2] - r.pts[i * 2 - 2], tz = r.pts[i * 2 + 3] - r.pts[i * 2 - 1], tl = Math.hypot(tx, tz) || 1;
          const side = (i / 5) % 2 === 0 ? 1 : -1, off = r.width / 2 + 1.1;
          const lx = x + (-tz / tl) * off * side, lz = z + (tx / tl) * off * side;
          if (nearBuilding(lx, lz, 0.8) || roadEdgeDist(w, lx, lz) < 0.6) continue;
          put('lamp', lx, lz, Math.atan2(tz, tx) + (side > 0 ? Math.PI : 0), 1, { hx: 0.15, hz: 0.15, h: 5 });
          const r2 = rnd();
          const bx = lx + (tx / tl) * 2.2, bz = lz + (tz / tl) * 2.2;
          if (r2 < 0.25 && clear(bx, bz, 0.8)) put('bench', bx, bz, q(Math.atan2(-tz, tx) + (side > 0 ? 0 : Math.PI)), 1, { hx: 0.8, hz: 0.3, h: 0.5 });
          else if (r2 < 0.45 && clear(bx, bz, 0.6)) put('bin', bx, bz, 0, 1, { hx: 0.3, hz: 0.3, h: 1.0 });
        }
      }
    }
    // farms: fenced fields, hay bales, a tractor, the windmill
    if (p.kind === 'farm') {
      const half = p.r * 0.8;
      for (const [ax, az, bx, bz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
        const sx = p.x + ax * half, sz = p.z + az * half, ex = p.x + bx * half, ez = p.z + bz * half;
        const len = Math.hypot(ex - sx, ez - sz), n = Math.floor(len / 3);
        const horiz = Math.abs(ez - sz) < 1;
        for (let i = 0; i < n; i++) {
          const x = sx + ((ex - sx) * (i + 0.5)) / n, z = sz + ((ez - sz) * (i + 0.5)) / n;
          if (roadEdgeDist(w, x, z) < 2.5 || nearBuilding(x, z, 1.5) || ground(x, z) < 1.3) continue;
          put('fence', x, z, horiz ? 0 : Math.PI / 2, 1, { hx: 1.5, hz: 0.08, h: 1.0 });
        }
      }
      for (let i = 0; i < 14; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.4, z = p.z + (rnd() - 0.5) * p.r * 1.4;
        if (clear(x, z, 2)) put('hay', x, z, rnd() * Math.PI, 1, { hx: 0.6, hz: 0.6, h: 1.2 });
      }
      for (let i = 0; i < 30; i++) {
        const x = p.x + (rnd() - 0.5) * p.r, z = p.z + (rnd() - 0.5) * p.r;
        if (clear(x, z, 4)) { put('tractor', x, z, q(rnd() * 6.28), 1, { hx: 1.2, hz: 2.0, h: 2.4 }); break; }
      }
      if (p.name === 'Windmill Flats') {
        for (let i = 0; i < 60; i++) {
          const x = p.x + (rnd() - 0.5) * p.r * 1.2, z = p.z + (rnd() - 0.5) * p.r * 1.2;
          if (!clear(x, z, 7)) continue;
          put('windmill', x, z, rnd() * 6.28, 1, { hx: 2.2, hz: 2.2, h: 15 });
          extraChests.push({ x: x + 3.2, y: ground(x + 3.2, z), z, face: 1 });
          break;
        }
      }
    }
    // camps: tents around a campfire with log seats
    if (p.kind === 'camp') {
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rnd() - 0.5) * p.r, z = p.z + (rnd() - 0.5) * p.r;
        if (!clear(x, z, 6)) continue;
        put('fire', x, z, 0, 1);
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * Math.PI * 2 + rnd();
          put('log', x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2, a + Math.PI / 2, 1);
        }
        let tents = 0;
        for (let k = 0; k < 10 && tents < 3; k++) {
          const a = rnd() * Math.PI * 2, d = 5 + rnd() * 5;
          const tx = x + Math.cos(a) * d, tz = z + Math.sin(a) * d;
          if (!clear(tx, tz, 2.5)) continue;
          put('tent', tx, tz, q(a + Math.PI / 2), 1, { hx: 1.3, hz: 1.1, h: 1.7 });
          tents++;
          if (tents === 1) extraChests.push({ x: tx + Math.cos(a) * 2.2, y: ground(tx + Math.cos(a) * 2.2, tz + Math.sin(a) * 2.2), z: tz + Math.sin(a) * 2.2, face: 0 });
        }
        break;
      }
      for (let i = 0; i < 4; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.3, z = p.z + (rnd() - 0.5) * p.r * 1.3;
        if (clear(x, z, 2)) put('picnic', x, z, q(rnd() * 6.28), 1, { hx: 1.0, hz: 0.8, h: 0.75 });
      }
    }
    // industrial: barrels, crate stacks, pipes, chimneys
    if (p.kind === 'industrial' || p.kind === 'harbor' || p.kind === 'quarry') {
      for (let i = 0; i < 26; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.5, z = p.z + (rnd() - 0.5) * p.r * 1.5;
        if (!clear(x, z, 1.4)) continue;
        if (rnd() < 0.55) put('barrel', x, z, 0, 1, { hx: 0.35, hz: 0.35, h: 1.0 });
        else put('crates', x, z, q(rnd() * 6.28), 1, { hx: 0.7, hz: 0.7, h: 1.4 });
      }
    }
    if (p.kind === 'industrial') {
      let made = 0;
      for (let i = 0; i < 60 && made < 3; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.2, z = p.z + (rnd() - 0.5) * p.r * 1.2;
        if (!clear(x, z, 3)) continue;
        put('chimney', x, z, 0, 1, { hx: 1.1, hz: 1.1, h: 22 });
        made++;
      }
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rnd() - 0.5) * p.r, z = p.z + (rnd() - 0.5) * p.r;
        const horiz = rnd() < 0.5;
        const ok = [-6, 0, 6].every((o) => clear(x + (horiz ? o : 0), z + (horiz ? 0 : o), 1.5));
        if (!ok) continue;
        put('pipes', x, z, horiz ? 0 : Math.PI / 2, 1, { hx: 7, hz: 0.6, h: 2.6 });
        break;
      }
    }
    if (p.kind === 'quarry') {
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.6, z = p.z + (rnd() - 0.5) * p.r * 1.6;
        if (!clear(x, z, 5)) continue;
        put('crane', x, z, rnd() * 6.28, 1, { hx: 1.2, hz: 1.2, h: 18 });
        break;
      }
      for (let i = 0; i < 8; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.4, z = p.z + (rnd() - 0.5) * p.r * 1.4;
        if (clear(x, z, 3)) put('rockpile', x, z, rnd() * 6.28, 0.8 + rnd() * 0.8, { hx: 1.6, hz: 1.6, h: 1.4 });
      }
    }
    if (p.kind === 'resort') {
      for (let i = 0; i < 40; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 2.0, z = p.z + (rnd() - 0.5) * p.r * 2.0;
        const g = ground(x, z);
        if (g < 0.8 || g > 3.6 || nearBuilding(x, z, 2) || roadEdgeDist(w, x, z) < 2) continue;
        put('umbrella', x, z, rnd() * 6.28, 1);
        put('lounger', x + 1.4, z, q(rnd() * 6.28), 1, { hx: 0.4, hz: 0.95, h: 0.45 });
      }
      for (let i = 0; i < 60; i++) {
        const x = p.x + (rnd() - 0.5) * p.r, z = p.z + (rnd() - 0.5) * p.r;
        if (![-4, 4].every((ox) => [-3, 3].every((oz) => clear(x + ox, z + oz, 1.5)))) continue;
        put('pool', x, z, 0, 1);
        break;
      }
    }
    if (p.kind === 'station') {
      for (let i = 0; i < 60; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.6, z = p.z + (rnd() - 0.5) * p.r * 1.6;
        if (!clear(x, z, 4)) continue;
        put('mast', x, z, 0, 1, { hx: 1.4, hz: 1.4, h: 30 });
        extraChests.push({ x: x + 2.6, y: ground(x + 2.6, z), z, face: 1 });
        break;
      }
      for (let i = 0; i < 3; i++) {
        const x = p.x + (rnd() - 0.5) * p.r * 1.6, z = p.z + (rnd() - 0.5) * p.r * 1.6;
        if (clear(x, z, 2)) put('dish', x, z, rnd() * 6.28, 1, { hx: 0.8, hz: 0.8, h: 2.2 });
      }
    }
    if (p.kind === 'harbor') genHarbor(w, p, put, solids, props, excl, extraChests);
    // a sign at the edge of town on the busiest road in
    const main = w.roads.filter((r) => !r.street);
    let signed = 0;
    for (const r of main) {
      if (signed >= 2) break;
      for (let i = 1; i < r.pts.length / 2 - 1; i++) {
        const x = r.pts[i * 2], z = r.pts[i * 2 + 1], d = Math.hypot(x - p.x, z - p.z);
        if (Math.abs(d - p.r * 1.12) > 3) continue;
        const tx = r.pts[i * 2 + 2] - r.pts[i * 2 - 2], tz = r.pts[i * 2 + 3] - r.pts[i * 2 - 1], tl = Math.hypot(tx, tz) || 1;
        const sx = x + (-tz / tl) * (r.width / 2 + 2), sz = z + (tx / tl) * (r.width / 2 + 2);
        if (nearBuilding(sx, sz, 1) || ground(sx, sz) < 1.3) continue;
        put('sign', sx, sz, Math.atan2(sx - p.x, sz - p.z), 1, { hx: 0.25, hz: 0.25, h: 2.6 }, { label: p.name });
        signed++;
        break;
      }
    }
  }

  // ---------------------------------------------------------------- power lines along the main roads
  for (const r of w.roads.filter((r) => !r.street)) {
    let last = -1e9;
    for (let i = 1; i < r.pts.length / 2 - 1; i++) {
      const x = r.pts[i * 2], z = r.pts[i * 2 + 1];
      if (i * 4 - last < 44) continue;
      const tx = r.pts[i * 2 + 2] - r.pts[i * 2 - 2], tz = r.pts[i * 2 + 3] - r.pts[i * 2 - 1], tl = Math.hypot(tx, tz) || 1;
      const px = x + (-tz / tl) * 6.5, pz = z + (tx / tl) * 6.5;
      if (w.pois.some((p) => Math.hypot(px - p.x, pz - p.z) < p.r * 0.95) || ground(px, pz) < 1.5 || nearBuilding(px, pz, 2) || roadEdgeDist(w, px, pz) < 1.5) continue;
      put('pole', px, pz, Math.atan2(tz, tx), 1, { hx: 0.18, hz: 0.18, h: 7.5 }, { n: r.pts.length + i });
      last = i * 4;
    }
  }

  // ---------------------------------------------------------------- recall beacons: by main roads, spread across the island
  const beacons: { x: number; y: number; z: number }[] = [];
  const mains = w.roads.filter((r) => !r.street);
  for (let t = 0; t < 400 && beacons.length < 9; t++) {
    const r = mains[Math.floor(rnd() * mains.length)];
    const i = 2 + Math.floor(rnd() * (r.pts.length / 2 - 4));
    const x0 = r.pts[i * 2], z0 = r.pts[i * 2 + 1];
    const tx = r.pts[i * 2 + 2] - r.pts[i * 2 - 2], tz = r.pts[i * 2 + 3] - r.pts[i * 2 - 1], tl = Math.hypot(tx, tz) || 1;
    const x = x0 + (-tz / tl) * 9, z = z0 + (tx / tl) * 9;
    if (!clear(x, z, 4) || beacons.some((b) => Math.hypot(b.x - x, b.z - z) < 260)) continue;
    if (w.pois.some((p) => Math.hypot(x - p.x, z - p.z) < p.r * 0.9)) continue;
    put('beacon', x, z, Math.atan2(tz, tx), 1, { hx: 1.1, hz: 1.1, h: 1.0 });
    beacons.push({ x, y: ground(x, z), z });
  }

  // ---------------------------------------------------------------- boss vaults: a concrete bunker with a locked door
  const vaults: Vault[] = [];
  for (const name of ['Rustworks', 'Harborlight']) {
    const p = w.pois.find((q) => q.name === name);
    if (!p) continue;
    for (let t = 0; t < 200; t++) {
      const x = Math.round(p.x + (rnd() - 0.5) * p.r * 1.3), z = Math.round(p.z + (rnd() - 0.5) * p.r * 1.3);
      const ok = [-6, 0, 6].every((ox) => [-6, 0, 6].every((oz) => clear(x + ox, z + oz, 2) && Math.abs(ground(x + ox, z + oz) - ground(x, z)) < 1.2));
      if (!ok) continue;
      const g = Math.max(...[-4, 0, 4].flatMap((ox) => [-4, 0, 4].map((oz) => ground(x + ox, z + oz)))) + 0.1;
      const face = Math.floor(rnd() * 4), id = vaults.length;
      const W = 7, D = 6, H = 3.6, T = 0.45;
      // local frame: door in the middle of the "front" wall facing `face`
      const fx = [0, 1, 0, -1][face], fz = [1, 0, -1, 0][face], sx = -fz, sz = fx; // forward and sideways
      const at = (u: number, v: number) => ({ x: x + sx * u + fx * v, z: z + sz * u + fz * v });
      const box = (u0: number, u1: number, v0: number, v1: number, y0: number, y1: number, extra: Partial<Solid> = {}) => {
        const a = at(u0, v0), b = at(u1, v1);
        solids.push({ x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x), z0: Math.min(a.z, b.z), z1: Math.max(a.z, b.z), y0, y1, k: SK.Prop, ...extra });
      };
      box(-W / 2, W / 2, -D / 2, D / 2, g - 1, g, {});                 // floor
      box(-W / 2, W / 2, -D / 2, -D / 2 + T, g, g + H, {});             // back wall
      box(-W / 2, -W / 2 + T, -D / 2, D / 2, g, g + H, {});             // side walls
      box(W / 2 - T, W / 2, -D / 2, D / 2, g, g + H, {});
      box(-W / 2, -0.9, D / 2 - T, D / 2, g, g + H, {});               // front wall either side of the door
      box(0.9, W / 2, D / 2 - T, D / 2, g, g + H, {});
      box(-0.9, 0.9, D / 2 - T, D / 2, g + 2.4, g + H, {});             // lintel
      box(-0.9, 0.9, D / 2 - T, D / 2, g, g + 2.4, { vault: id });       // the vault door itself
      box(-W / 2 - 0.2, W / 2 + 0.2, -D / 2 - 0.2, D / 2 + 0.2, g + H, g + H + 0.4, {}); // roof slab
      const door = at(0, D / 2 + 1.2), post = at(0, D / 2 + 7);
      const chests: Spot[] = [-2.2, 0, 2.2].map((u) => { const c = at(u, -D / 2 + T + 0.55); return { x: c.x, y: g, z: c.z, face: (face + 0) % 4 }; });
      props.push({ t: 'vault', x, y: g, z, rot: [0, Math.PI / 2, Math.PI, -Math.PI / 2][face], s: 1, n: id });
      excl.push({ x, z, r: 10 });
      vaults.push({ id, x, z, y: g, face, door, post, chests, poi: p.id });
      break;
    }
  }

  // ---------------------------------------------------------------- ladders: silos, the lighthouse, halls and shops
  const ladders: Ladder[] = [];
  const FACE_N: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const ladderOn = (x0: number, z0: number, x1: number, z1: number, face: number, yTop: number, along: number) => {
    const [nx, nz] = FACE_N[face];
    // a point on that wall's outside face, `along` (0..1) of the way along it
    const wx = nx > 0 ? x1 : nx < 0 ? x0 : x0 + (x1 - x0) * along, wz = nz > 0 ? z1 : nz < 0 ? z0 : z0 + (z1 - z0) * along;
    const x = wx + nx * 0.45, z = wz + nz * 0.45, y0 = terrainAt(w, x, z);
    if (y0 < 1 || roadEdgeDist(w, x, z) < 0.5 || yTop - y0 < 2.6) return;
    ladders.push({ x, z, y0, y1: yTop, nx, nz, tx: wx - nx * 1.0, tz: wz - nz * 1.0 });
    props.push({ t: 'ladder', x: wx + nx * 0.12, y: y0, z: wz + nz * 0.12, rot: Math.atan2(nx, nz), s: yTop - y0 });
  };
  w.boxes.forEach((b, i) => {
    const L = w.layouts[i];
    if (b.shape === 2) ladderOn(b.x0, b.z0, b.x1, b.z1, 1, b.y1, 0.5);
    else if (L.type === 'hall' || L.type === 'shop') {
      // put it under an eave (not a gable end), and not on the front wall with the door
      const faces = b.roof === ROOF_FLAT ? [0, 1, 2, 3] : b.roof === ROOF_GABLE_X ? [0, 2] : [1, 3];
      const face = faces.find((f) => f !== L.front && f !== (L.front + 2) % 4) ?? faces.find((f) => f !== L.front)!;
      ladderOn(b.x0, b.z0, b.x1, b.z1, face, L.type === 'shop' ? b.fy + L.access : b.y1, 0.3);
    }
  });
  for (const p of props.filter((q) => q.t === 'lighthouse')) ladderOn(p.x - 2.4, p.z - 2.4, p.x + 2.4, p.z + 2.4, 1, p.y + 22, 0.5);

  // ---------------------------------------------------------------- ziplines across valleys
  // Both ends hang low enough to grab from the ground (the cable is ZIP_END above the ground at
  // each pole); the line has to clear the ground in between, so they end up between high spots.
  const zips: Zip[] = [];
  const ZIP_END = 3.6;
  const sites: [number, number, number][] = [];
  for (let t = 0; t < 1600; t++) {
    const x = (rnd() - 0.5) * 2100, z = (rnd() - 0.5) * 2100;
    if (!clear(x, z, 4)) continue;
    const g = ground(x, z);
    // prefer high ground: compare to the ring around it
    let ring = 0;
    for (let k = 0; k < 8; k++) ring += ground(x + Math.cos(k * 0.785) * 40, z + Math.sin(k * 0.785) * 40);
    if (g - ring / 8 > 2.5 && g > 6) sites.push([x, z, g]);
  }
  const cands: { ax: number; az: number; ay: number; bx: number; bz: number; by: number; len: number }[] = [];
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const [ax, az, ga] = sites[i], [bx, bz, gb] = sites[j];
    const hd = Math.hypot(bx - ax, bz - az);
    if (hd < 110 || hd > 420) continue;
    const ay = ga + ZIP_END, by = gb + ZIP_END;
    if (Math.abs(ay - by) / hd > 0.25) continue;
    let ok = true, mid = 0;
    const n = Math.ceil(hd / 3);
    for (let k = 1; k < n && ok; k++) {
      const f = k / n, x = ax + (bx - ax) * f, z = az + (bz - az) * f, y = ay + (by - ay) * f;
      const gap = y - Math.max(ground(x, z), 0), fromEnd = Math.min(f, 1 - f) * hd;
      if (gap < (fromEnd < 5 ? 2.4 : 3.2) || nearBuilding(x, z, 1.5)) ok = false;
      if (f > 0.3 && f < 0.7) mid = Math.max(mid, gap);
    }
    if (ok && mid > 8) cands.push({ ax, az, ay, bx, bz, by, len: Math.hypot(bx - ax, by - ay, bz - az) });
  }
  cands.sort((p, q) => q.len - p.len);
  for (const c of cands) {
    if (zips.length >= 12) break;
    const far = (x: number, z: number) => zips.every((Z) => Math.hypot(Z.ax - x, Z.az - z) > 140 && Math.hypot(Z.bx - x, Z.bz - z) > 140);
    if (!far(c.ax, c.az) || !far(c.bx, c.bz)) continue;
    zips.push(c);
    put('zippole', c.ax, c.az, Math.atan2(c.bx - c.ax, c.bz - c.az), ZIP_END + 0.9, { hx: 0.2, hz: 0.2, h: ZIP_END + 0.9 });
    put('zippole', c.bx, c.bz, Math.atan2(c.ax - c.bx, c.az - c.bz), ZIP_END + 0.9, { hx: 0.2, hz: 0.2, h: ZIP_END + 0.9 });
  }

  // ---------------------------------------------------------------- spring pads
  const pads: { x: number; y: number; z: number }[] = [];
  for (const p of w.pois.filter((q) => !q.minor)) for (let n = 0; n < 2; n++) {
    for (let t = 0; t < 60; t++) {
      const x = p.x + (rnd() - 0.5) * p.r * 1.2, z = p.z + (rnd() - 0.5) * p.r * 1.2;
      if (!clear(x, z, 3)) continue;
      const y = ground(x, z);
      put('pad', x, z, 0, 1, { hx: 0.9, hz: 0.9, h: 0.15 });
      pads.push({ x, y: y + 0.15, z });
      break;
    }
  }

  // ---------------------------------------------------------------- warm-up island: a little movement course
  {
    const X = SPAWN_ISLAND.x, Z = SPAWN_ISLAND.z;
    // a lookout tower with a ladder, and a zipline from its roof back down across the island
    const tx = X + 22, tz = Z - 22, tg = ground(tx, tz), tTop = tg + 6.5;
    props.push({ t: 'ptower', x: tx, y: tg, z: tz, rot: 0, s: 1 });
    solids.push(boxSolid(tx, tz, 2, 2, tg - 0.3, tTop, SK.Block));
    excl.push({ x: tx, z: tz, r: 4.5 });
    ladderOn(tx - 2, tz - 2, tx + 2, tz + 2, 0, tTop, 0.5);
    const bx = X + 34, bz = Z + 28, by = ground(bx, bz) + 3.6, ay = tTop + 3.4;
    zips.push({ ax: tx, ay, az: tz, bx, by, bz, len: Math.hypot(bx - tx, by - ay, bz - tz) });
    solids.push(boxSolid(tx, tz, 0.2, 0.2, tTop, ay + 0.9, SK.Prop));
    put('zippole', bx, bz, Math.atan2(tx - bx, tz - bz), 4.5, { hx: 0.2, hz: 0.2, h: 4.5 });
    // a row of fences to vault, a crate to climb, a wall to mantle
    for (const dz of [-30, -35, -40]) put('fence', X + 4, Z + dz, 0, 1, { hx: 1.5, hz: 0.08, h: 1.0 });
    put('pblock', X - 12, Z - 26, 0, 1, { hx: 1.2, hz: 1.2, h: 1.5 });
    put('pwall', X - 26, Z - 18, 0, 1, { hx: 2, hz: 0.25, h: 2.3 });
    // and a spring pad
    const px = X - 30, pz = Z + 10, py = ground(px, pz);
    put('pad', px, pz, 0, 1, { hx: 0.9, hz: 0.9, h: 0.15 });
    pads.push({ x: px, y: py + 0.15, z: pz });
  }

  // ---------------------------------------------------------------- caves
  const caves: Cave[] = [];
  const candidates: [number, number, number][] = [[-660, -380, 0.6], [360, 640, 2.2], [700, -300, 1.2], [-470, 560, 4.0]];
  for (const [cx, cz, ang] of candidates) {
    let best: Cave | null = null;
    for (let t = 0; t < 240 && !best; t++) {
      const x = cx + (hash2(t, 1, w.seed + 801) - 0.5) * 160, z = cz + (hash2(t, 2, w.seed + 801) - 0.5) * 160;
      // tunnels run along the compass axes so their walls are exact boxes
      const a = Math.round((ang + (hash2(t, 3, w.seed + 801) - 0.5) * 1.2) / (Math.PI / 2)) * (Math.PI / 2);
      const dx = Math.round(Math.cos(a)), dz = Math.round(Math.sin(a)), len = 26, width = 5.5;
      const line: number[] = [], sides: number[] = [];
      for (let k = -4; k <= 4; k++) {
        line.push(ground(x + dx * (len / 2) * (k / 4), z + dz * (len / 2) * (k / 4)));
        for (const s2 of [-1, 1]) sides.push(ground(x + dx * (len / 2) * (k / 4) - dz * s2 * 6, z + dz * (len / 2) * (k / 4) + dx * s2 * 6));
      }
      const lo = Math.min(...line), hi = Math.max(...line);
      // a hillside: the sides should rise around the tunnel so it reads as a cave
      const sideHi = Math.max(...sides);
      if (lo < 4 || hi - lo > 3.5 || sideHi < hi + 1 || roadEdgeDist(w, x, z) < 25 || nearBuilding(x, z, 25) || w.pois.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 20)) continue;
      const floor = hi + 0.1, ceil = floor + 4.2;
      best = { x, z, dx, dz, len, width, floor, ceil, chest: { x: 0, y: 0, z: 0, face: 0 }, crystals: [] };
    }
    if (!best) continue;
    const c = best;
    // walls (thick), roof slab; ends are open
    const nx = -c.dz, nz = c.dx;
    const half = c.len / 2, wh = c.width / 2, thick = 2.6;
    for (let k = 0; k < 13; k++) {
      // the tunnel is built from short AABB segments so it can run at any angle
      const t0 = -half + (k * c.len) / 13, t1 = -half + ((k + 1) * c.len) / 13, tm = (t0 + t1) / 2, seg = c.len / 13 / 2 + 0.3;
      const mx = c.x + c.dx * tm, mz = c.z + c.dz * tm;
      for (const side of [-1, 1]) {
        const wx = mx + nx * side * (wh + thick / 2), wz = mz + nz * side * (wh + thick / 2);
        const hx = Math.abs(c.dx) * seg + Math.abs(nx) * thick / 2, hz = Math.abs(c.dz) * seg + Math.abs(nz) * thick / 2;
        solids.push(boxSolid(wx, wz, hx, hz, c.floor - 6, c.ceil + 2.4, SK.Cave));
      }
      const hx = Math.abs(c.dx) * seg + Math.abs(nx) * (wh + 0.4), hz = Math.abs(c.dz) * seg + Math.abs(nz) * (wh + 0.4);
      solids.push(boxSolid(mx, mz, hx, hz, c.ceil, c.ceil + 2.4, SK.Cave));
      // level floor inside so the tunnel is walkable even where the hill dips
      solids.push(boxSolid(mx, mz, hx, hz, c.floor - 6, c.floor, SK.Cave));
    }
    // steps up into each mouth where the ground outside is lower than the tunnel floor
    for (const end of [-1, 1]) {
      const ex = c.x + c.dx * end * (half + 1.2), ez = c.z + c.dz * end * (half + 1.2);
      const g = ground(ex, ez), drop = c.floor - g;
      if (drop < 0.3) continue;
      const n = Math.min(14, Math.ceil(drop / 0.28)), rise = drop / n;
      for (let k = 0; k < n; k++) {
        const along = half + (n - k) * 0.36 - 0.18;
        const sx = c.x + c.dx * end * along, sz = c.z + c.dz * end * along;
        const hx = Math.abs(c.dx) * 0.18 + Math.abs(nx) * wh, hz = Math.abs(c.dz) * 0.18 + Math.abs(nz) * wh;
        solids.push(boxSolid(sx, sz, hx, hz, g - 1, g + (k + 1) * rise, SK.Step));
      }
    }
    c.chest = { x: c.x + nx * (wh - 0.6), y: c.floor, z: c.z + nz * (wh - 0.6), face: 0 };
    for (let k = 0; k < 18; k++) {
      const t = -half + 2 + (hash2(k, 7, w.seed + 803) * (c.len - 4)), side = k % 2 ? 1 : -1;
      const up = hash2(k, 8, w.seed + 803);
      c.crystals.push({ x: c.x + c.dx * t + nx * side * (wh - 0.1), y: c.floor + 0.3 + up * 3.2, z: c.z + c.dz * t + nz * side * (wh - 0.1), s: 0.3 + hash2(k, 9, w.seed + 803) * 0.5, c: k % 3 });
    }
    // carve the hillside so the tunnel is open inside (the rock walls and roof hide the cut)
    const f = w.main;
    for (let iz = 0; iz < f.nz; iz++) {
      const z = f.oz + iz * f.cell;
      if (Math.abs(z - c.z) > half + wh + 4) continue;
      for (let ix = 0; ix < f.nx; ix++) {
        const x = f.ox + ix * f.cell;
        const along = (x - c.x) * c.dx + (z - c.z) * c.dz, across = (x - c.x) * nx + (z - c.z) * nz;
        if (Math.abs(along) <= half && Math.abs(across) <= wh + thick) {
          const i = iz * f.nx + ix;
          f.data[i] = Math.min(f.data[i], c.floor - 0.4);
        }
      }
    }
    excl.push({ x: c.x, z: c.z, r: half + 8 });
    caves.push(c);
  }
  return { props, caves, excl, extraChests, beacons, vaults, ladders, zips, pads };
}

function genHarbor(w: World, p: Poi, put: (t: string, x: number, z: number, rot: number, s?: number, solid?: { hx: number; hz: number; h: number }, extra?: Partial<Prop>) => void, solids: Solid[], props: Prop[], excl: Exclusion[], extraChests: Spot[]) {
  // walk from the town toward the sea to find the shore, then build two docks out into the water
  const dirs: [number, number][] = [[0, 1], [1, 0], [-1, 0], [0, -1]];
  let shore: { x: number; z: number; dx: number; dz: number } | null = null;
  for (const [dx, dz] of dirs) {
    for (let d = 10; d < 260; d += 2) {
      const x = p.x + dx * d, z = p.z + dz * d;
      if (terrainAt(w, x, z) < 0.4) { shore = { x, z, dx, dz }; break; }
    }
    if (shore) break;
  }
  if (!shore) return;
  const { dx, dz } = shore;
  const nx = -dz, nz = dx;
  for (const off of [-14, 14]) {
    const sx = shore.x + nx * off - dx * 6, sz = shore.z + nz * off - dz * 6;
    const len = 30, y = BRIDGE_Y + 0.15;
    const cx = sx + dx * len / 2, cz = sz + dz * len / 2;
    const hx = Math.abs(dx) * len / 2 + Math.abs(nx) * 1.6, hz = Math.abs(dz) * len / 2 + Math.abs(nz) * 1.6;
    solids.push({ x0: cx - hx, x1: cx + hx, z0: cz - hz, z1: cz + hz, y0: y - 0.35, y1: y, k: SK.Prop });
    props.push({ t: 'dock', x: cx, y, z: cz, rot: Math.atan2(dx, dz), s: len });
    excl.push({ x: cx, z: cz, r: len / 2 + 2 });
    // a boat moored alongside you can stand on
    const bx = cx + nx * 3.6 * Math.sign(off), bz = cz + nz * 3.6 * Math.sign(off);
    const bhx = Math.abs(dx) * 3.2 + Math.abs(nx) * 1.3, bhz = Math.abs(dz) * 3.2 + Math.abs(nz) * 1.3;
    solids.push({ x0: bx - bhx, x1: bx + bhx, z0: bz - bhz, z1: bz + bhz, y0: -1.2, y1: 0.9, k: SK.Prop });
    props.push({ t: 'boat', x: bx, y: 0, z: bz, rot: Math.atan2(dx, dz), s: 1 });
    if (off > 0) extraChests.push({ x: cx + dx * (len / 2 - 2), y, z: cz + dz * (len / 2 - 2), face: 0 });
  }
  // a lighthouse on the coast a little way along
  for (let d = 60; d < 200; d += 6) {
    for (const side of [1, -1]) {
      const x = shore.x + nx * d * side - dx * 4, z = shore.z + nz * d * side - dz * 4;
      const g = terrainAt(w, x, z);
      if (g < 1.5 || g > 6 || roadEdgeDist(w, x, z) < 6) continue;
      put('lighthouse', x, z, 0, 1, { hx: 2.4, hz: 2.4, h: 22 });
      extraChests.push({ x: x + 3.4, y: g, z, face: 1 });
      return;
    }
  }
}
