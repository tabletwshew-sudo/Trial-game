import type { InputCmd, PlayerState } from './sim.js';

/** Binary packets for the hot path (inputs up, snapshots down). */
export const PKT_INPUT = 1, PKT_SNAPSHOT = 2;
export const MAX_INPUTS_PER_PACKET = 12;
const TAU = Math.PI * 2;

export function encodeInputs(firstSeq: number, cmds: InputCmd[]): ArrayBuffer {
  const buf = new ArrayBuffer(6 + cmds.length * 9), v = new DataView(buf);
  v.setUint8(0, PKT_INPUT); v.setUint32(1, firstSeq, true); v.setUint8(5, cmds.length);
  cmds.forEach((c, i) => {
    const o = 6 + i * 9;
    v.setUint8(o, c.keys); v.setFloat32(o + 1, c.yaw, true); v.setFloat32(o + 5, c.pitch, true);
  });
  return buf;
}

/** Returns null for malformed packets (never trust the client). */
export function decodeInputs(v: DataView): { firstSeq: number; cmds: InputCmd[] } | null {
  if (v.byteLength < 6 || v.getUint8(0) !== PKT_INPUT) return null;
  const n = v.getUint8(5);
  if (n > MAX_INPUTS_PER_PACKET || v.byteLength !== 6 + n * 9) return null;
  const cmds: InputCmd[] = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 9;
    const yaw = v.getFloat32(o + 1, true), pitch = v.getFloat32(o + 5, true);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(yaw) > 1e4) return null;
    cmds.push({ keys: v.getUint8(o), yaw, pitch: Math.max(-1.55, Math.min(1.55, pitch)) });
  }
  return { firstSeq: v.getUint32(1, true), cmds };
}

export interface EntSnap { idx: number; x: number; y: number; z: number; yaw: number; mode: number; grounded: boolean }
export interface Snapshot { tick: number; time: number; ack: number; self: PlayerState | null; ents: EntSnap[] }

export const ENT_BYTES = 9;
/** Encode the entity block once per tick; it is shared by every recipient. */
export function encodeEnts(ents: EntSnap[]): Uint8Array {
  const out = new Uint8Array(1 + ents.length * ENT_BYTES), v = new DataView(out.buffer);
  out[0] = ents.length;
  ents.forEach((e, i) => {
    const o = 1 + i * ENT_BYTES;
    v.setUint8(o, e.idx);
    v.setInt16(o + 1, Math.round(e.x * 16), true);
    v.setInt16(o + 3, Math.round(e.y * 32), true);
    v.setInt16(o + 5, Math.round(e.z * 16), true);
    const yaw = ((e.yaw % TAU) + TAU) % TAU;
    v.setUint8(o + 7, Math.round((yaw / TAU) * 256) & 255);
    v.setUint8(o + 8, (e.grounded ? 4 : 0) | (e.mode & 3));
  });
  return out;
}

const SELF_BYTES = 27;
export function encodeSnapshot(tick: number, time: number, ack: number, self: PlayerState | null, ents: Uint8Array): ArrayBuffer {
  const head = 18 + (self ? SELF_BYTES : 0);
  const buf = new ArrayBuffer(head + ents.length), v = new DataView(buf);
  v.setUint8(0, PKT_SNAPSHOT); v.setUint32(1, tick, true); v.setFloat64(5, time, true); v.setUint32(13, ack, true); v.setUint8(17, self ? 1 : 0);
  if (self) {
    let o = 18;
    for (const f of [self.x, self.y, self.z, self.vx, self.vy, self.vz]) { v.setFloat32(o, f, true); o += 4; }
    v.setUint8(o, self.mode); v.setUint8(o + 1, self.grounded ? 1 : 0); v.setUint8(o + 2, self.keys);
  }
  new Uint8Array(buf, head).set(ents);
  return buf;
}

export function decodeSnapshot(v: DataView): Snapshot | null {
  if (v.byteLength < 19 || v.getUint8(0) !== PKT_SNAPSHOT) return null;
  const snap: Snapshot = { tick: v.getUint32(1, true), time: v.getFloat64(5, true), ack: v.getUint32(13, true), self: null, ents: [] };
  let o = 18;
  if (v.getUint8(17)) {
    const f = (i: number) => v.getFloat32(o + i * 4, true);
    snap.self = { x: f(0), y: f(1), z: f(2), vx: f(3), vy: f(4), vz: f(5), yaw: 0, pitch: 0, mode: v.getUint8(o + 24), grounded: v.getUint8(o + 25) === 1, keys: v.getUint8(o + 26) };
    o += SELF_BYTES;
  }
  const n = v.getUint8(o++);
  if (v.byteLength < o + n * ENT_BYTES) return null;
  for (let i = 0; i < n; i++, o += ENT_BYTES) {
    const b = v.getUint8(o + 8);
    snap.ents.push({
      idx: v.getUint8(o), x: v.getInt16(o + 1, true) / 16, y: v.getInt16(o + 3, true) / 32, z: v.getInt16(o + 5, true) / 16,
      yaw: (v.getUint8(o + 7) / 256) * TAU, mode: b & 3, grounded: (b & 4) !== 0,
    });
  }
  return snap;
}
