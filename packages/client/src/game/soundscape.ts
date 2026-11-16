import {
  MV, PM, WATER_FLOAT_Y, layoutAt, poiAt, roadEdgeDist, terrainAt, type PlayerState, type StormState, type World,
} from '@dropzone/shared';
import { audio, type Surface, type V3 } from '../audio';
import type { ActorState } from './actors';

/** What's underfoot at a spot (for footstep sounds). */
export function surfaceUnder(w: World, x: number, y: number, z: number): Surface {
  const t = terrainAt(w, x, z);
  if (y <= WATER_FLOAT_Y + 0.1 && t < WATER_FLOAT_Y) return 'water';
  if (y > t + 0.35) return layoutAt(w, x, z) ? 'wood' : 'stone';
  if (roadEdgeDist(w, x, z) < 0.2) return 'stone';
  if (t < 2.6) return 'sand';
  const p = poiAt(w, x, z);
  if (p && (p.kind === 'city' || p.kind === 'industrial' || p.kind === 'harbor' || p.kind === 'station')) return 'stone';
  if (p && (p.kind === 'quarry' || p.kind === 'camp')) return 'dirt';
  return 'grass';
}

export interface SoundFrame {
  dt: number;
  phase: string;
  pred: PlayerState | null;
  self: number;
  actors: ActorState[];
  cam: V3;
  camYaw: number;
  /** Closed chests near you. */
  chests: { id: number; x: number; y: number; z: number; k: number }[];
  /** Cars: position and speed (and whether you're the one driving it). */
  cars: { id: number; x: number; y: number; z: number; vs: number; mine: boolean }[];
  ship: V3 | null;
  storm: StormState | null;
  warmupLeft: number;
}

/**
 * The continuous side of the soundscape, updated every frame: footsteps for everyone nearby,
 * wind while dropping, engines, the zipline, chest shimmer, the storm, the sea, birds.
 * (One-shot events like gunfire are played where the game handles them.)
 */
export class Soundscape {
  private stride: number[];
  private climb = 0;
  private birdT = 4;
  private lastBeep = -1;
  private wasGrounded = true;
  private wasMode = -1;

  constructor(private w: World, n: number) { this.stride = new Array(n).fill(0); }

  frame(f: SoundFrame) {
    if (!audio.on) return;
    const { dt, pred, cam, w } = { ...f, w: this.w };
    audio.listener(cam, f.camYaw);

    // ---- footsteps (you and the 12 nearest other players)
    const near = f.actors.map((a, i) => ({ a, i, d: (a.x - cam.x) ** 2 + (a.z - cam.z) ** 2 }))
      .filter((o) => o.a.visible && o.a.mode === PM.Walk && o.d < 45 * 45).sort((p, q) => p.d - q.d).slice(0, 13);
    for (const { a, i } of near) {
      const self = i === f.self;
      if (!a.grounded || a.mv !== MV.None || a.speed < 1) { this.stride[i] = Math.min(this.stride[i], 0.6); continue; }
      const len = a.speed > 6.5 ? 2.1 : a.speed > 3.2 ? 1.6 : 1.15;
      this.stride[i] += a.speed * dt;
      if (this.stride[i] >= len) {
        this.stride[i] -= len;
        const loud = (a.speed > 6.5 ? 1.25 : a.speed > 3.2 ? 0.85 : 0.35) * (self ? 0.55 : 1.4);
        audio.step(self ? null : { x: a.x, y: a.y + 0.1, z: a.z }, surfaceUnder(w, a.x, a.y, a.z), loud);
      }
    }

    if (pred) {
      // ladder rungs
      if (pred.mv === MV.Climb && Math.abs(pred.vy) > 0.5) { this.climb += Math.abs(pred.vy) * dt; if (this.climb > 0.5) { this.climb = 0; audio.step(null, 'metal', 0.8); } }
      // jumping, and the glider opening
      if (pred.mode === PM.Walk && this.wasGrounded && !pred.grounded && pred.vy > 3 && pred.mv === MV.None) audio.move('jump', null);
      if (pred.mode === PM.Glide && this.wasMode === PM.Fall) audio.move('glider', null);
      this.wasGrounded = pred.grounded; this.wasMode = pred.mode;

      // wind: loud and high while skydiving, softer under the glider and on the ship
      const speed = Math.hypot(pred.vx, pred.vy, pred.vz);
      if (pred.mode === PM.Fall) audio.loop('wind', 'wind', 0.35 + Math.min(0.35, speed / 220), 700 + speed * 22);
      else if (pred.mode === PM.Glide) audio.loop('wind', 'wind', 0.16, 520);
      else if (pred.mode === PM.Bus) audio.loop('wind', 'wind', 0.07, 400);
      else if (pred.mode === PM.Zip) audio.loop('wind', 'wind', 0.08, 900);
      // sliding, the zipline trolley, healing
      if (pred.mode === PM.Walk && pred.mv === MV.Slide) audio.loop('slide', 'slide', Math.min(0.35, Math.hypot(pred.vx, pred.vz) / 30), 900 + Math.hypot(pred.vx, pred.vz) * 60);
      if (pred.mode === PM.Zip) audio.loop('zip', 'zip', 0.16, 110 + Math.abs(pred.zv) * 9);
      if (pred.use > 0) audio.loop('use', 'use', 0.1);
    }

    // ---- the dropship's engines
    if (f.ship) audio.loop('ship', 'engine', 0.55, 46, f.ship);

    // ---- cars: your own engine up close, others by position
    for (const c of f.cars) {
      const d = Math.hypot(c.x - cam.x, c.z - cam.z);
      if (d > 70 && !c.mine) continue;
      const rev = 38 + Math.abs(c.vs) * 2.4;
      audio.loop(`car${c.id}`, 'engine', (c.mine ? 0.32 : 0.45) * (0.4 + Math.min(1, Math.abs(c.vs) / 20) * 0.6), rev, c.mine ? undefined : c);
    }

    // ---- chests hum until they're opened (the three nearest)
    f.chests.filter((c) => c.k === 0).map((c) => ({ c, d: Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z) })).filter((o) => o.d < 18)
      .sort((p, q) => p.d - q.d).slice(0, 3).forEach(({ c }) => audio.loop(`hum${c.id}`, 'hum', 0.2, undefined, { x: c.x, y: c.y + 0.5, z: c.z }));

    // ---- the storm: a rumble that grows as the wall gets close; inside it, everything is muffled
    const st = f.storm;
    if (st && st.r > 0.5 && pred && pred.mode !== PM.Bus) {
      const dc = Math.hypot(pred.x - st.x, pred.z - st.z), inside = dc > st.r, wall = Math.abs(dc - st.r);
      const v = inside ? 0.5 : Math.max(0, 1 - wall / 90) * 0.4;
      if (v > 0.01) audio.loop('storm', 'storm', v, inside ? 220 : 320);
      audio.muffle(inside);
    } else audio.muffle(false);

    // ---- the sea: waves near the shore, a softer wash out on open water
    let water = 0;
    for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (terrainAt(w, cam.x + Math.cos(a) * 35, cam.z + Math.sin(a) * 35) < -0.3) water++; }
    if (cam.y < 60 && water > 0) audio.loop('waves', 'waves', water === 8 ? 0.1 : 0.24, 600);

    // ---- birds in the trees now and then
    this.birdT -= dt;
    if (this.birdT <= 0) {
      this.birdT = 3 + Math.random() * 7;
      const a = Math.random() * Math.PI * 2, d = 12 + Math.random() * 25, x = cam.x + Math.cos(a) * d, z = cam.z + Math.sin(a) * d;
      const g = terrainAt(w, x, z);
      if (g > 3 && g < 80 && cam.y - g < 40 && f.phase !== 'bus') audio.chirp({ x, y: g + 6, z });
    }

    // ---- countdown beeps for the last seconds of the warm-up
    if (f.phase === 'warmup' && f.warmupLeft > 0 && f.warmupLeft <= 5.05) {
      const s = Math.ceil(f.warmupLeft);
      if (s !== this.lastBeep) { this.lastBeep = s; audio.ui('beep'); }
    } else if (this.lastBeep !== -1 && f.phase === 'bus') { this.lastBeep = -1; audio.ui('go'); }

    audio.sweep();
  }
}
