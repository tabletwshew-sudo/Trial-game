import { emptySlot, type InputCmd, type PlayerState } from './sim.js';

/** Binary packets for the hot path (inputs up, snapshots down). Everything else is JSON. */
export const PKT_INPUT = 1, PKT_SNAPSHOT = 2;
export const MAX_INPUTS_PER_PACKET = 12;
const TAU = Math.PI * 2;
const CMD_BYTES = 11, INPUT_HEAD = 14;

/** `viewTime` = the server time the client was looking at (for lag-compensated hits). */
export function encodeInputs(firstSeq: number, cmds: InputCmd[], viewTime = 0): ArrayBuffer {
  const buf = new ArrayBuffer(INPUT_HEAD + cmds.length * CMD_BYTES), v = new DataView(buf);
  v.setUint8(0, PKT_INPUT); v.setUint32(1, firstSeq, true); v.setUint8(5, cmds.length); v.setFloat64(6, viewTime, true);
  cmds.forEach((c, i) => {
    const o = INPUT_HEAD + i * CMD_BYTES;
    v.setUint16(o, c.keys, true); v.setUint8(o + 2, c.slot ?? 0); v.setFloat32(o + 3, c.yaw, true); v.setFloat32(o + 7, c.pitch, true);
  });
  return buf;
}

/** Returns null for malformed packets (never trust the client). */
export function decodeInputs(v: DataView): { firstSeq: number; cmds: InputCmd[]; viewTime: number } | null {
  if (v.byteLength < INPUT_HEAD || v.getUint8(0) !== PKT_INPUT) return null;
  const n = v.getUint8(5);
  if (n > MAX_INPUTS_PER_PACKET || v.byteLength !== INPUT_HEAD + n * CMD_BYTES) return null;
  const viewTime = v.getFloat64(6, true);
  if (!Number.isFinite(viewTime)) return null;
  const cmds: InputCmd[] = [];
  for (let i = 0; i < n; i++) {
    const o = INPUT_HEAD + i * CMD_BYTES;
    const yaw = v.getFloat32(o + 3, true), pitch = v.getFloat32(o + 7, true), slot = v.getUint8(o + 2);
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch) || Math.abs(yaw) > 1e4 || slot > 6) return null; // 1..5 slots, 6 = pickaxe
    cmds.push({ keys: v.getUint16(o, true) & 0xfff, yaw, pitch: Math.max(-1.55, Math.min(1.55, pitch)), slot });
  }
  return { firstSeq: v.getUint32(1, true), cmds, viewTime };
}

// ------------------------------------------------------------------ other players
/** Entity flags. */
export const EF = { GROUNDED: 1, ADS: 2, CROUCH: 4, USING: 8, RELOADING: 16, SPRINT: 32 } as const;
/** Emote id lives in the top two flag bits. */
export const EF_EMOTE_SHIFT = 6;
export interface EntSnap { idx: number; x: number; y: number; z: number; yaw: number; pitch: number; mode: number; flags: number; item: number; rarity: number; /** movement sub-state + its tick counter (for slide/mantle/climb poses) */ mv: number; mt: number }
export const ENT_BYTES = 15;

export function encodeEnt(e: EntSnap, out: Uint8Array, o: number) {
  const v = new DataView(out.buffer, out.byteOffset);
  v.setUint8(o, e.idx);
  v.setInt16(o + 1, Math.round(e.x * 16), true);
  v.setInt16(o + 3, Math.round(e.y * 32), true);
  v.setInt16(o + 5, Math.round(e.z * 16), true);
  v.setUint8(o + 7, Math.round(((((e.yaw % TAU) + TAU) % TAU) / TAU) * 256) & 255);
  v.setInt8(o + 8, Math.round(Math.max(-1.57, Math.min(1.57, e.pitch)) * 80));
  v.setUint8(o + 9, e.mode); v.setUint8(o + 10, e.flags); v.setUint8(o + 11, e.item); v.setUint8(o + 12, e.rarity);
  v.setUint8(o + 13, e.mv); v.setUint8(o + 14, Math.max(0, Math.min(255, e.mt)));
}

// ------------------------------------------------------------------ cars
export interface VehSnap { id: number; x: number; y: number; z: number; vh: number; vs: number; hp: number; driver: boolean }
export const VEH_BYTES = 12;
function encodeVeh(e: VehSnap, v: DataView, o: number) {
  v.setUint8(o, e.id);
  v.setInt16(o + 1, Math.round(e.x * 16), true); v.setInt16(o + 3, Math.round(e.y * 32), true); v.setInt16(o + 5, Math.round(e.z * 16), true);
  v.setUint8(o + 7, Math.round(((((e.vh % TAU) + TAU) % TAU) / TAU) * 256) & 255);
  v.setInt8(o + 8, Math.round(Math.max(-127, Math.min(127, e.vs * 3))));
  v.setUint16(o + 9, Math.max(0, Math.round(e.hp)), true);
  v.setUint8(o + 11, e.driver ? 1 : 0);
}

// ------------------------------------------------------------------ snapshot
export interface Snapshot { tick: number; time: number; ack: number; self: PlayerState | null; ents: EntSnap[]; vehs: VehSnap[] }
const SELF_BYTES = 134;

function writeSelf(v: DataView, o: number, s: PlayerState) {
  for (const f of [s.x, s.y, s.z, s.vx, s.vy, s.vz]) { v.setFloat32(o, f, true); o += 4; }
  v.setUint8(o++, s.mode); v.setUint8(o++, s.grounded ? 1 : 0); v.setUint16(o, s.keys, true); o += 2;
  v.setUint8(o++, s.hp); v.setUint8(o++, s.shield); v.setUint8(o++, s.knock); v.setUint8(o++, s.slot);
  v.setUint8(o++, s.cd); v.setUint8(o++, s.burst); v.setUint16(o, s.reload, true); o += 2; v.setUint16(o, s.use, true); o += 2;
  v.setUint16(o, s.bloom, true); o += 2; v.setUint32(o, s.shots, true); o += 4; v.setUint32(o, s.seed, true); o += 4;
  v.setUint8(o++, s.act); v.setInt8(o++, s.veh); v.setUint8(o++, s.seat);
  v.setFloat32(o, s.vh, true); o += 4; v.setFloat32(o, s.vs, true); o += 4;
  for (const sl of s.inv) { v.setUint8(o++, sl.id); v.setUint8(o++, sl.r); v.setUint8(o++, sl.n); v.setUint8(o++, sl.mag); }
  for (const a of s.ammo) { v.setUint16(o, a, true); o += 2; }
  v.setFloat32(o, s.yaw, true); o += 4; v.setFloat32(o, s.pitch, true); o += 4;
  v.setUint8(o++, s.emote);
  v.setUint8(o++, s.mv); v.setUint8(o++, s.mt);
  for (const f of [s.tx, s.ty, s.tz, s.my, s.mh]) { v.setFloat32(o, f, true); o += 4; }
  v.setUint8(o++, s.air); v.setUint8(o++, s.jbuf); v.setInt16(o, s.li, true); o += 2;
  v.setFloat32(o, s.zt, true); o += 4; v.setFloat32(o, s.zv, true); o += 4; v.setUint8(o++, s.scd); v.setUint8(o++, s.wk);
  return o;
}
function readSelf(v: DataView, o: number): PlayerState {
  const f = () => { const x = v.getFloat32(o, true); o += 4; return x; };
  const u8 = () => v.getUint8(o++), u16 = () => { const x = v.getUint16(o, true); o += 2; return x; }, u32 = () => { const x = v.getUint32(o, true); o += 4; return x; };
  const x = f(), y = f(), z = f(), vx = f(), vy = f(), vz = f();
  const mode = u8(), grounded = u8() === 1, keys = u16(), hp = u8(), shield = u8(), knock = u8(), slot = u8(), cd = u8(), burst = u8();
  const reload = u16(), use = u16(), bloom = u16(), shots = u32(), seed = u32(), act = u8();
  const veh = v.getInt8(o++), seat = u8(), vh = f(), vs = f();
  const inv = [0, 1, 2, 3, 4].map(() => ({ ...emptySlot(), id: u8(), r: u8(), n: u8(), mag: u8() }));
  const ammo = [0, 1, 2, 3, 4].map(() => u16());
  const yaw = f(), pitch = f(), emote = u8();
  const mv = u8(), mt = u8(), tx = f(), ty = f(), tz = f(), my = f(), mh = f(), air = u8(), jbuf = u8();
  const li = v.getInt16(o, true); o += 2;
  const zt = f(), zv = f(), scd = u8(), wk = u8();
  return { wk, mv, mt, tx, ty, tz, my, mh, air, jbuf, li, zt, zv, scd, emote, x, y, z, vx, vy, vz, yaw, pitch, mode, grounded, keys, hp, shield, knock, slot, inv, ammo, cd, burst, reload, use, bloom, shots, seed, act, veh, seat, vh, vs };
}

/**
 * `ents` is a pre-encoded block of ENT_BYTES records (built once per tick, sliced per player).
 */
export function encodeSnapshot(tick: number, time: number, ack: number, self: PlayerState | null, ents: Uint8Array, entCount: number, vehs: VehSnap[]): ArrayBuffer {
  const head = 18 + (self ? SELF_BYTES : 0);
  const size = head + 1 + entCount * ENT_BYTES + 1 + vehs.length * VEH_BYTES;
  const buf = new ArrayBuffer(size), v = new DataView(buf);
  v.setUint8(0, PKT_SNAPSHOT); v.setUint32(1, tick, true); v.setFloat64(5, time, true); v.setUint32(13, ack, true); v.setUint8(17, self ? 1 : 0);
  if (self) writeSelf(v, 18, self);
  let o = head;
  v.setUint8(o++, entCount);
  new Uint8Array(buf, o, entCount * ENT_BYTES).set(ents.subarray(0, entCount * ENT_BYTES));
  o += entCount * ENT_BYTES;
  v.setUint8(o++, vehs.length);
  for (const e of vehs) { encodeVeh(e, v, o); o += VEH_BYTES; }
  return buf;
}

export function decodeSnapshot(v: DataView): Snapshot | null {
  if (v.byteLength < 20 || v.getUint8(0) !== PKT_SNAPSHOT) return null;
  const snap: Snapshot = { tick: v.getUint32(1, true), time: v.getFloat64(5, true), ack: v.getUint32(13, true), self: null, ents: [], vehs: [] };
  let o = 18;
  if (v.getUint8(17)) { if (v.byteLength < o + SELF_BYTES) return null; snap.self = readSelf(v, o); o += SELF_BYTES; }
  const n = v.getUint8(o++);
  if (v.byteLength < o + n * ENT_BYTES + 1) return null;
  for (let i = 0; i < n; i++, o += ENT_BYTES) {
    snap.ents.push({
      idx: v.getUint8(o), x: v.getInt16(o + 1, true) / 16, y: v.getInt16(o + 3, true) / 32, z: v.getInt16(o + 5, true) / 16,
      yaw: (v.getUint8(o + 7) / 256) * TAU, pitch: v.getInt8(o + 8) / 80, mode: v.getUint8(o + 9), flags: v.getUint8(o + 10), item: v.getUint8(o + 11), rarity: v.getUint8(o + 12), mv: v.getUint8(o + 13), mt: v.getUint8(o + 14),
    });
  }
  const nv = v.getUint8(o++);
  if (v.byteLength < o + nv * VEH_BYTES) return null;
  for (let i = 0; i < nv; i++, o += VEH_BYTES) {
    snap.vehs.push({
      id: v.getUint8(o), x: v.getInt16(o + 1, true) / 16, y: v.getInt16(o + 3, true) / 32, z: v.getInt16(o + 5, true) / 16,
      vh: (v.getUint8(o + 7) / 256) * TAU, vs: v.getInt8(o + 8) / 3, hp: v.getUint16(o + 9, true), driver: v.getUint8(o + 11) === 1,
    });
  }
  return snap;
}
