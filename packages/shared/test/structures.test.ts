import { describe, expect, it } from 'vitest';
import { K, PM, SIM_HZ, SK, getWorld, layoutAt, newPlayerState, raycastWorld, stepPlayer, surfaceAt, terrainAt, type Layout } from '../src/index';

const t0 = performance.now();
const w = getWorld();
const genMs = performance.now() - t0;

/** Drive a player toward a list of waypoints (walking), returning the final state. */
function walk(start: { x: number; z: number; y?: number }, path: { x: number; z: number }[], maxS = 30) {
  const s = newPlayerState();
  s.x = start.x; s.z = start.z; s.y = start.y ?? surfaceAt(w, s.x, s.z, 500);
  let i = 0;
  for (let t = 0; t < maxS * SIM_HZ && i < path.length; t++) {
    const p = path[i];
    const dx = p.x - s.x, dz = p.z - s.z;
    if (Math.hypot(dx, dz) < 0.35) { i++; continue; }
    stepPlayer(s, { keys: K.F, yaw: Math.atan2(-dx, -dz), pitch: 0 }, w);
  }
  return { s, reached: i >= path.length };
}

describe('generated world', () => {
  it('builds quickly and has lots of detail', () => {
    // eslint-disable-next-line no-console
    console.log(`world gen ${genMs.toFixed(0)} ms: ${w.boxes.length} buildings, ${w.solids.length} solids, ${w.props.length} props, ${w.caves.length} caves, ${w.outdoorChests.length} outdoor chests, ${w.layouts.reduce((n, l) => n + l.chests.length, 0)} indoor chest spots, ${w.layouts.reduce((n, l) => n + l.loot.length, 0)} indoor loot spots`);
    expect(genMs).toBeLessThan(4000);
    expect(w.caves.length).toBeGreaterThanOrEqual(3);
    expect(w.props.filter((p) => p.t === 'sign').length).toBeGreaterThan(10);
    expect(['windmill', 'lighthouse', 'mast', 'dock'].every((t) => w.props.some((p) => p.t === t))).toBe(true);
  });
  it('every building with an interior has a usable front door', () => {
    for (const L of w.layouts) {
      if (L.type === 'solid') continue;
      expect(L.doors.length, L.b.kind).toBeGreaterThanOrEqual(1);
      expect(L.floors.length).toBeGreaterThanOrEqual(1);
    }
  });
});

const twoStorey = w.layouts.find((L) => L.type === 'house' && L.floors.length === 2 && L.stairs)!;

describe('inside buildings', () => {
  it('you can walk in through the front door', () => {
    const d = twoStorey.doors[0];
    const { s, reached } = walk({ x: d.x, z: d.z }, [{ x: d.ix, z: d.iz }]);
    expect(reached).toBe(true);
    expect(layoutAt(w, s.x, s.z)).toBe(twoStorey);
    expect(s.y).toBeCloseTo(twoStorey.b.fy, 1);
  });
  it('you can climb the stairs to the upper floor', () => {
    const L = twoStorey, st = L.stairs!, d = L.doors[0];
    const { s, reached } = walk({ x: d.x, z: d.z }, [{ x: d.ix, z: d.iz }, { x: st.bx, z: st.bz }, { x: (st.x0 + st.x1) / 2 + (st.tx - st.bx) * 0.01, z: (st.z0 + st.z1) / 2 }, { x: st.tx, z: st.tz }], 40);
    expect(reached).toBe(true);
    expect(s.y).toBeCloseTo(st.y1, 1);
    expect(s.grounded).toBe(true);
  });
  it('walls block you where there is no door', () => {
    const L = twoStorey, b = L.b, cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    // side walls (left/right of the front) never have doors
    const fromX = L.front % 2 === 0;
    const start = fromX ? { x: b.x0 - 2.5, z: cz } : { x: cx, z: b.z0 - 2.5 };
    const { s } = walk(start, [{ x: cx, z: cz }], 6);
    expect(layoutAt(w, s.x, s.z)).not.toBe(L);
  });
  it('bullets go through doorways but not walls; floors stop bullets', () => {
    const d = twoStorey.doors[0], y = twoStorey.b.fy + 1.3;
    const o = { x: d.x, y, z: d.z };
    const dir = { x: d.ix - d.x, y: 0, z: d.iz - d.z };
    const l = Math.hypot(dir.x, dir.z); dir.x /= l; dir.z /= l;
    expect(raycastWorld(w, o, dir, l).kind).toBe('none');
    const side = { x: dir.z, y: 0, z: -dir.x };
    const o2 = { x: d.x + side.x * 2.6, y, z: d.z + side.z * 2.6 };
    expect(raycastWorld(w, o2, dir, l + 1).kind).toBe('building');
    const up = raycastWorld(w, { x: d.ix, y, z: d.iz }, { x: 0, y: 1, z: 0 }, 30);
    expect(up.kind).toBe('building');
    expect(up.t).toBeLessThan(twoStorey.floors[1] - y + 0.1);
  });
  it('halls have big doors a car fits through, and crates to climb', () => {
    const hall = w.layouts.find((L) => L.type === 'hall')!;
    expect(hall.doors[0].w).toBeGreaterThan(4);
    expect(hall.furniture.some((f) => f.t === 'crate' || f.t === 'hay')).toBe(true);
  });
  it('trees block bullets and walkers', () => {
    const trunk = w.solids.find((o) => o.k === SK.Trunk && o.x1 - o.x0 > 0.6)!;
    const cx = (trunk.x0 + trunk.x1) / 2, cz = (trunk.z0 + trunk.z1) / 2, y = trunk.y0 + 1.6;
    expect(raycastWorld(w, { x: cx - 5, y, z: cz }, { x: 1, y: 0, z: 0 }, 10).kind).toBe('building');
    const { s } = walk({ x: cx - 4, z: cz }, [{ x: cx + 4, z: cz }], 3);
    expect(s.x).toBeLessThan(cx);
  });
  it('docks stick out over the water and you can stand on them', () => {
    const dock = w.props.find((p) => p.t === 'dock')!;
    expect(terrainAt(w, dock.x, dock.z)).toBeLessThan(1.5);
    expect(surfaceAt(w, dock.x, dock.z, 5)).toBeCloseTo(dock.y, 1);
  });
  it('caves have a roof and a walkable tunnel', () => {
    for (const c of w.caves) {
      expect(surfaceAt(w, c.x, c.z, c.floor + 0.1)).toBeCloseTo(c.floor, 1);
      const up = raycastWorld(w, { x: c.x, y: c.floor + 1.5, z: c.z }, { x: 0, y: 1, z: 0 }, 20);
      expect(up.kind).toBe('building');
      const { reached } = walk({ x: c.x - c.dx * 18, z: c.z - c.dz * 18 }, [{ x: c.x, z: c.z }, { x: c.x + c.dx * 18, z: c.z + c.dz * 18 }], 20);
      expect(reached).toBe(true);
    }
  });
});
