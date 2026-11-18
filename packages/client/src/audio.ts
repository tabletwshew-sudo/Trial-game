import type { Cue } from './game/soundviz';
import { settings, onSettings } from './settings';

/**
 * Dropzone's sound: everything is synthesised live with the Web Audio API (no recorded or
 * borrowed sounds). One engine is shared by the lobby and the match.
 *
 *  - one-shots: gunfire per weapon class (muffled and echoing with distance), footsteps per
 *    surface, impacts, hit markers, pickups, chests, explosions, UI blips
 *  - loops the game keeps alive each frame (wind, engines, zipline, chest shimmer, storm, waves)
 *  - a little sequencer for original music (lobby and drop themes, victory and defeat stings)
 *
 * Positional sounds use HRTF panners close up and cheaper panning far away. The browser only
 * allows audio after a click or key press, so `unlock()` is called on the first one.
 */
export interface V3 { x: number; y: number; z: number }
export type Surface = 'grass' | 'dirt' | 'sand' | 'stone' | 'wood' | 'water' | 'metal';
type LoopKind = 'wind' | 'engine' | 'zip' | 'slide' | 'hum' | 'storm' | 'waves' | 'use';

const GUN: Record<string, { body: number; q: number; thump: number; dur: number; crack: number; gain: number; tail: number }> = {
  pistol: { body: 1500, q: 0.8, thump: 150, dur: 0.16, crack: 0.25, gain: 0.55, tail: 0.25 },
  smg: { body: 1900, q: 0.9, thump: 170, dur: 0.11, crack: 0.2, gain: 0.45, tail: 0.2 },
  ar: { body: 1150, q: 0.7, thump: 115, dur: 0.21, crack: 0.35, gain: 0.65, tail: 0.4 },
  burst: { body: 1350, q: 0.8, thump: 125, dur: 0.17, crack: 0.3, gain: 0.58, tail: 0.35 },
  shotgun: { body: 900, q: 0.5, thump: 72, dur: 0.42, crack: 0.15, gain: 0.95, tail: 0.6 },
  autoshotgun: { body: 1050, q: 0.5, thump: 84, dur: 0.3, crack: 0.15, gain: 0.8, tail: 0.5 },
  dmr: { body: 1000, q: 0.7, thump: 95, dur: 0.32, crack: 0.6, gain: 0.8, tail: 0.7 },
  sniper: { body: 850, q: 0.6, thump: 62, dur: 0.5, crack: 0.9, gain: 1.0, tail: 1.2 },
  rocket: { body: 600, q: 0.6, thump: 70, dur: 0.6, crack: 0, gain: 0.7, tail: 0.6 },
};

class Loop {
  out: GainNode;
  panner: PannerNode | null = null;
  touched = true;
  private nodes: AudioScheduledSourceNode[] = [];
  /** Parameters the loop exposes (filter frequency, oscillator pitch...). */
  params: AudioParam[] = [];
  constructor(private e: AudioEngine, readonly kind: LoopKind, positional: boolean) {
    const c = e.ctx!;
    this.out = c.createGain(); this.out.gain.value = 0;
    if (positional) { this.panner = e.panner(12, 'HRTF'); this.out.connect(this.panner).connect(e.sfxIn); }
    else this.out.connect(kind === 'use' ? e.sfxIn : e.sfxIn);
    this.build(c);
  }
  private src(n: AudioScheduledSourceNode) { this.nodes.push(n); n.start(); return n; }
  private build(c: AudioContext) {
    const e = this.e, o = this.out;
    const noise = () => { const s = c.createBufferSource(); s.buffer = e.noiseBuf; s.loop = true; s.playbackRate.value = 0.9 + Math.random() * 0.2; return s; };
    const filt = (type: BiquadFilterType, f: number, q = 1) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    switch (this.kind) {
      case 'wind': case 'slide': case 'storm': case 'waves': case 'use': {
        const n = noise();
        const f = this.kind === 'wind' ? filt('bandpass', 700, 0.6) : this.kind === 'slide' ? filt('lowpass', 1400, 0.8) : this.kind === 'storm' ? filt('lowpass', 260, 0.7) : this.kind === 'waves' ? filt('lowpass', 650, 0.5) : filt('bandpass', 2400, 1.4);
        const g = c.createGain(); g.gain.value = 1;
        n.connect(f).connect(g).connect(o);
        this.params.push(f.frequency);
        // slow swells (waves, storm) or a fast rhythm (wrapping a bandage)
        if (this.kind === 'waves' || this.kind === 'storm' || this.kind === 'use') {
          const lfo = c.createOscillator(), depth = c.createGain();
          lfo.frequency.value = this.kind === 'waves' ? 0.13 : this.kind === 'storm' ? 0.35 : 5.5;
          depth.gain.value = this.kind === 'use' ? 0.7 : 0.45;
          lfo.connect(depth).connect(g.gain);
          this.src(lfo);
        }
        if (this.kind === 'storm') {
          // crackle on top of the rumble
          const n2 = noise(), hp = filt('highpass', 3000, 0.7), cg = c.createGain(); cg.gain.value = 0.25;
          n2.connect(hp).connect(cg).connect(o); this.src(n2);
        }
        this.src(n);
        break;
      }
      case 'engine': {
        const a = c.createOscillator(), b = c.createOscillator(), lp = filt('lowpass', 700, 2), g = c.createGain();
        a.type = 'sawtooth'; b.type = 'sawtooth'; a.frequency.value = 55; b.frequency.value = 110.7; g.gain.value = 0.5;
        a.connect(lp); b.connect(lp); lp.connect(g).connect(o);
        const n = noise(), nf = filt('bandpass', 300, 1), ng = c.createGain(); ng.gain.value = 0.35; n.connect(nf).connect(ng).connect(o);
        this.params.push(a.frequency, b.frequency, lp.frequency);
        this.src(a); this.src(b); this.src(n);
        break;
      }
      case 'zip': {
        const a = c.createOscillator(), bp = filt('bandpass', 900, 5), g = c.createGain();
        a.type = 'sawtooth'; a.frequency.value = 180; g.gain.value = 0.5;
        a.connect(bp).connect(g).connect(o);
        const n = noise(), nf = filt('highpass', 2500, 0.7), ng = c.createGain(); ng.gain.value = 0.4; n.connect(nf).connect(ng).connect(o);
        this.params.push(a.frequency);
        this.src(a); this.src(n);
        break;
      }
      case 'hum': {
        // a shimmering major chord with a slow tremolo: you hear a chest before you see it
        const trem = c.createGain(); trem.gain.value = 0.6; trem.connect(o);
        for (const f of [523.25, 659.25, 783.99, 1046.5]) {
          const s = c.createOscillator(); s.type = 'sine'; s.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
          const g = c.createGain(); g.gain.value = f > 1000 ? 0.12 : 0.22; s.connect(g).connect(trem); this.src(s);
        }
        const lfo = c.createOscillator(), d = c.createGain(); lfo.frequency.value = 3.2; d.gain.value = 0.3; lfo.connect(d).connect(trem.gain); this.src(lfo);
        break;
      }
    }
  }
  set(vol: number, p?: number, pos?: V3) {
    const t = this.e.ctx!.currentTime;
    this.touched = true;
    this.out.gain.setTargetAtTime(Math.max(0, vol), t, 0.08);
    if (p !== undefined) {
      if (this.kind === 'engine') { this.params[0].setTargetAtTime(p, t, 0.1); this.params[1].setTargetAtTime(p * 2.013, t, 0.1); this.params[2].setTargetAtTime(400 + p * 9, t, 0.1); }
      else if (this.params[0]) this.params[0].setTargetAtTime(p, t, 0.1);
    }
    if (pos && this.panner) this.e.place(this.panner, pos);
  }
  stop() {
    const t = this.e.ctx!.currentTime;
    this.out.gain.setTargetAtTime(0, t, 0.1);
    for (const n of this.nodes) { try { n.stop(t + 0.6); } catch { /* already stopped */ } }
    setTimeout(() => { this.out.disconnect(); this.panner?.disconnect(); }, 900);
  }
}

export class AudioEngine {
  ctx: AudioContext | null = null;
  noiseBuf!: AudioBuffer;
  /** Effects go in here (through the storm muffle filter). */
  sfxIn!: GainNode;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private muffleF!: BiquadFilterNode;
  private loops = new Map<string, Loop>();
  private voices = 0;
  private lp: V3 = { x: 0, y: 0, z: 0 };
  private music: Music | null = null;
  private wantMusic: string | null = null;

  /**
   * Told about every sound from somewhere in the world (not your own), before any volume or
   * mute check, so the on-screen sound markers work even with the sound off.
   */
  onCue: ((kind: Cue, pos: V3, key?: string, loud?: number) => void) | null = null;

  constructor() {
    onSettings(() => this.applyVolumes());
  }

  /** Create / resume the audio context (must happen during a user gesture). */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const c = new AC({ latencyHint: 'interactive' });
      this.ctx = c;
      this.master = c.createGain();
      // a gentle limiter so a big fight never clips
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -10; comp.knee.value = 8; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
      this.master.connect(comp).connect(c.destination);
      this.sfx = c.createGain(); this.musicBus = c.createGain();
      this.muffleF = c.createBiquadFilter(); this.muffleF.type = 'lowpass'; this.muffleF.frequency.value = 20000;
      this.sfxIn = c.createGain();
      this.sfxIn.connect(this.muffleF).connect(this.sfx).connect(this.master);
      this.musicBus.connect(this.master);
      const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      this.applyVolumes();
      if (this.wantMusic) this.setMusic(this.wantMusic);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  get on() { return !!this.ctx && this.ctx.state === 'running'; }

  private analyser: AnalyserNode | null = null;
  /** Current output level, 0..1 (used by tests). */
  level() {
    if (!this.ctx) return 0;
    if (!this.analyser) { this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 2048; this.master.connect(this.analyser); }
    const d = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(d);
    let m = 0; for (const v of d) m = Math.max(m, Math.abs(v));
    return m;
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(settings.master, t, 0.05);
    this.sfx.gain.setTargetAtTime(settings.effects, t, 0.05);
    this.musicBus.gain.setTargetAtTime(settings.music * 1.1, t, 0.05);
  }

  /** Where the ears are (the camera) and which way they face. */
  listener(pos: V3, yaw: number) {
    this.lp = { x: pos.x, y: pos.y, z: pos.z };
    if (!this.ctx) return;
    const l = this.ctx.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.value = pos.x; l.positionY.value = pos.y; l.positionZ.value = pos.z;
      l.forwardX.value = fx; l.forwardY.value = 0; l.forwardZ.value = fz; l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }
  dist(p: V3) { return Math.hypot(p.x - this.lp.x, p.y - this.lp.y, p.z - this.lp.z); }

  panner(ref: number, model: PanningModelType = 'equalpower') {
    const p = this.ctx!.createPanner();
    p.panningModel = model; p.distanceModel = 'inverse'; p.refDistance = ref; p.rolloffFactor = 1.1; p.maxDistance = 2000;
    return p;
  }
  place(p: PannerNode, pos: V3) {
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
  }
  /** Muffle effects (you're in the storm). */
  muffle(on: boolean) { if (this.ctx) this.muffleF.frequency.setTargetAtTime(on ? 900 : 20000, this.ctx.currentTime, 0.25); }

  // ------------------------------------------------------------ building blocks
  /** An output for a one-shot: positional if `pos` is given. Returns null if too many sounds are playing. */
  private dest(pos: V3 | null | undefined, ref = 6, life = 1, priority = false): AudioNode | null {
    if (!this.on) return null;
    if (this.voices > 48 && !priority) return null;
    this.voices++;
    setTimeout(() => this.voices--, life * 1000 + 50);
    if (!pos) return this.sfxIn;
    const p = this.panner(ref, this.dist(pos) < 30 ? 'HRTF' : 'equalpower');
    this.place(p, pos);
    p.connect(this.sfxIn);
    setTimeout(() => p.disconnect(), life * 1000 + 200);
    return p;
  }
  private noise(to: AudioNode, t: number, dur: number, gain: number, type: BiquadFilterType, f: number, q = 1, attack = 0.002, f2?: number) {
    const c = this.ctx!, s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const flt = c.createBiquadFilter(); flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
    if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt).connect(g).connect(to);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  private tone(to: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number, attack = 0.003) {
    const c = this.ctx!, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(to);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------ weapons
  /** A gunshot. `self` = your own gun (not positional, a touch louder). */
  gun(cls: string, pos: V3 | null, self = false) {
    if (pos && !self) this.onCue?.('gun', pos, undefined, cls === 'sniper' || cls === 'shotgun' || cls === 'rocket' ? 1 : 0.8);
    const P = GUN[cls] ?? GUN.ar;
    const d = pos ? this.dist(pos) : 0;
    const to = this.dest(self ? null : pos, 9, P.dur + P.tail + 0.4, self);
    if (!to) return;
    const c = this.ctx!, t = c.currentTime;
    // far away: duller, quieter, with a rolling echo off the hills
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(500, 16000 * Math.exp(-d / 110)); lp.connect(to);
    const v = P.gain * (self ? 0.85 : 1);
    const jitter = 0.9 + Math.random() * 0.2;
    if (cls === 'rocket') {
      this.noise(lp, t, 0.7, v, 'bandpass', 380, 1.2, 0.02, 2200);
      this.tone(lp, t, 'sine', 90, 40, 0.3, v * 0.8);
      return;
    }
    this.noise(lp, t, P.dur * jitter, v, 'bandpass', P.body * jitter, P.q);
    this.tone(lp, t, 'sine', P.thump * 1.8, P.thump, Math.min(0.16, P.dur), v * 0.9);
    if (P.crack > 0) this.noise(lp, t, 0.035, v * P.crack, 'highpass', 3200, 0.7, 0.001);
    if (d > 60 || cls === 'sniper' || cls === 'shotgun') this.noise(lp, t + 0.04 + Math.min(0.2, d / 1500), P.tail, v * (d > 60 ? 0.5 : 0.25), 'lowpass', 480, 0.7, 0.03);
    if (self && (cls === 'shotgun' || cls === 'sniper')) {
      // the pump / the bolt
      this.noise(to, t + (cls === 'shotgun' ? 0.32 : 0.45), 0.05, 0.25, 'bandpass', 2600, 3);
      this.noise(to, t + (cls === 'shotgun' ? 0.42 : 0.6), 0.06, 0.28, 'bandpass', 1900, 3);
    }
  }
  reload(stage: 'start' | 'end' | 'shell') {
    const to = this.dest(null, 1, 0.4); if (!to) return;
    const t = this.ctx!.currentTime;
    if (stage === 'start') { this.noise(to, t, 0.06, 0.3, 'bandpass', 1800, 4); this.noise(to, t + 0.12, 0.05, 0.2, 'bandpass', 900, 3); }
    else if (stage === 'shell') this.noise(to, t, 0.05, 0.3, 'bandpass', 1500, 5);
    else { this.noise(to, t, 0.04, 0.35, 'bandpass', 2400, 5); this.noise(to, t + 0.07, 0.05, 0.35, 'bandpass', 1200, 4); }
  }
  empty() { const to = this.dest(null, 1, 0.2); if (to) this.noise(to, this.ctx!.currentTime, 0.03, 0.3, 'bandpass', 3500, 6); }

  // ------------------------------------------------------------ hits and fights
  /** Your shot landed. */
  hit(kind: 'body' | 'head' | 'shield' | 'knock') {
    const to = this.dest(null, 1, 0.6, true); if (!to) return;
    const t = this.ctx!.currentTime;
    if (kind === 'head') { this.tone(to, t, 'sine', 1760, 1760, 0.35, 0.35); this.tone(to, t, 'sine', 2637, 2637, 0.25, 0.12); }
    else if (kind === 'shield') { this.noise(to, t, 0.08, 0.25, 'bandpass', 4200, 3); this.tone(to, t, 'triangle', 1320, 1100, 0.12, 0.15); }
    else if (kind === 'knock') { this.tone(to, t, 'square', 220, 110, 0.25, 0.18); this.noise(to, t, 0.15, 0.3, 'lowpass', 600, 1); }
    else this.noise(to, t, 0.03, 0.3, 'bandpass', 2600, 2, 0.001);
  }
  /** Pickaxe: the swing through the air, a clank off stone or metal, a dull thud on a player. */
  melee(kind: 'swing' | 'wall' | 'flesh' | 'break', pos: V3 | null) {
    const to = this.dest(pos, 4, 1.0); if (!to) return;
    const t = this.ctx!.currentTime, j = 0.9 + Math.random() * 0.2;
    if (kind === 'swing') this.noise(to, t, 0.22, 0.28, 'bandpass', 700 * j, 0.9, 0.06, 2200 * j);
    else if (kind === 'wall') { this.tone(to, t + 0.12, 'triangle', 1500 * j, 1350 * j, 0.18, 0.22); this.tone(to, t + 0.12, 'sine', 2350 * j, 2300 * j, 0.12, 0.1); this.noise(to, t + 0.12, 0.06, 0.35, 'bandpass', 3200, 2, 0.001); }
    else if (kind === 'break') {
      // a wall giving way: a crack, a crunching rumble, rubble settling
      this.noise(to, t, 0.08, 0.6, 'bandpass', 2600, 1.2, 0.001);
      this.noise(to, t + 0.02, 0.7, 0.55, 'lowpass', 1200, 0.8, 0.01, 180);
      this.tone(to, t, 'sine', 90, 40, 0.5, 0.5);
      for (let i = 0; i < 4; i++) this.noise(to, t + 0.25 + i * 0.09 + Math.random() * 0.05, 0.06, 0.15, 'bandpass', 1800 + Math.random() * 1500, 2, 0.001);
    }
    else { this.tone(to, t + 0.12, 'sine', 150 * j, 70, 0.14, 0.45); this.noise(to, t + 0.12, 0.08, 0.3, 'lowpass', 900, 1, 0.002); }
  }
  /** You took damage. */
  hurt(shield: boolean) {
    const to = this.dest(null, 1, 0.4, true); if (!to) return;
    const t = this.ctx!.currentTime;
    this.tone(to, t, 'sine', 140, 70, 0.18, 0.45);
    if (shield) this.noise(to, t, 0.1, 0.2, 'bandpass', 3800, 2);
  }
  /** You eliminated someone. */
  elim() {
    const to = this.dest(null, 1, 1.2, true); if (!to) return;
    const t = this.ctx!.currentTime;
    this.tone(to, t, 'sine', 90, 45, 0.4, 0.6);
    [784, 988, 1319].forEach((f, i) => this.tone(to, t + 0.05 + i * 0.07, 'triangle', f, f, 0.35, 0.18));
  }
  /** A heavy crate hitting the ground (supply drops). */
  thud(pos: V3) {
    this.onCue?.('chest', pos, undefined, 1);
    const to = this.dest(pos, 10, 1.2); if (!to) return;
    const t = this.ctx!.currentTime;
    this.tone(to, t, 'sine', 95, 38, 0.5, 0.9);
    this.noise(to, t, 0.35, 0.55, 'lowpass', 520, 0.8, 0.004, 160);
    this.noise(to, t + 0.04, 0.22, 0.25, 'bandpass', 1400, 1.2);
  }
  explosion(pos: V3, big = 1) {
    const to = this.dest(pos, 18, 2.2, true); if (!to) return;
    const t = this.ctx!.currentTime, d = this.dist(pos);
    const lp = this.ctx!.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = Math.max(400, 9000 * Math.exp(-d / 160)); lp.connect(to);
    this.noise(lp, t, 1.4 * big, 1.0, 'lowpass', 2200, 0.7, 0.004, 200);
    this.tone(lp, t, 'sine', 80, 28, 0.9, 1.0);
    this.noise(lp, t + 0.25, 1.2, 0.3, 'lowpass', 400, 0.7, 0.05);
  }

  // ------------------------------------------------------------ movement
  step(pos: V3 | null, surface: Surface, loud = 1) {
    if (pos) this.onCue?.('step', pos, undefined, Math.min(1, loud));
    const to = this.dest(pos, 3, 0.25); if (!to) return;
    const t = this.ctx!.currentTime, v = 0.3 * loud * (0.8 + Math.random() * 0.4), j = 0.85 + Math.random() * 0.3;
    switch (surface) {
      case 'grass': this.noise(to, t, 0.09, v * 0.8, 'bandpass', 1100 * j, 0.8, 0.01); break;
      case 'dirt': this.noise(to, t, 0.07, v, 'bandpass', 650 * j, 1.1, 0.004); break;
      case 'sand': this.noise(to, t, 0.1, v * 0.8, 'lowpass', 900 * j, 0.8, 0.012); break;
      case 'stone': this.noise(to, t, 0.045, v, 'bandpass', 2300 * j, 2.2, 0.001); this.tone(to, t, 'sine', 220 * j, 150, 0.04, v * 0.5); break;
      case 'wood': this.tone(to, t, 'sine', 190 * j, 110, 0.07, v * 1.1); this.noise(to, t, 0.05, v * 0.6, 'bandpass', 900 * j, 1.5); break;
      case 'metal': this.tone(to, t, 'triangle', 1150 * j, 1100 * j, 0.14, v * 0.5); this.tone(to, t, 'sine', 1720 * j, 1700 * j, 0.1, v * 0.3); break;
      case 'water': this.noise(to, t, 0.16, v, 'lowpass', 1600 * j, 1.5, 0.02); this.noise(to, t + 0.05, 0.1, v * 0.6, 'bandpass', 2800 * j, 2); break;
    }
  }
  /** Small movement one-shots. */
  move(kind: 'jump' | 'land' | 'slide' | 'mantle' | 'pad' | 'zipgrab' | 'splash' | 'glider', pos: V3 | null, k = 1) {
    // landing, jumping, sliding and climbing over things are footfalls too
    if (pos && (kind === 'land' || kind === 'jump' || kind === 'slide' || kind === 'mantle')) this.onCue?.('step', pos, undefined, kind === 'land' ? Math.min(1, 0.5 + k) : 0.7);
    const to = this.dest(pos, 5, 1.3); if (!to) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'jump': this.noise(to, t, 0.12, 0.18, 'bandpass', 900, 0.8, 0.02); break;
      case 'land': this.tone(to, t, 'sine', 110, 50, 0.16, 0.25 + k * 0.45); this.noise(to, t, 0.14, 0.15 + k * 0.3, 'lowpass', 700, 0.8); break;
      case 'slide': this.noise(to, t, 0.5, 0.3, 'bandpass', 1400, 0.7, 0.03, 500); break;
      case 'mantle': this.noise(to, t, 0.08, 0.25, 'bandpass', 1300, 1); this.tone(to, t + 0.1, 'sine', 160, 100, 0.08, 0.25); break;
      case 'pad': this.tone(to, t, 'sine', 180, 820, 0.35, 0.45, 0.01); this.tone(to, t + 0.04, 'triangle', 360, 1200, 0.3, 0.15); this.noise(to, t, 0.7, 0.3, 'bandpass', 600, 0.8, 0.05, 2400); break;
      case 'zipgrab': this.noise(to, t, 0.06, 0.35, 'bandpass', 3000, 4); this.tone(to, t, 'triangle', 900, 1400, 0.12, 0.12); break;
      case 'splash': this.noise(to, t, 0.5, 0.25 + k * 0.4, 'lowpass', 2000, 0.8, 0.01, 400); this.noise(to, t + 0.05, 0.3, 0.2, 'bandpass', 3500, 1.5); break;
      case 'glider': this.noise(to, t, 0.25, 0.3, 'bandpass', 500, 0.9, 0.01, 1500); this.tone(to, t, 'sine', 120, 70, 0.15, 0.25); break;
    }
  }

  // ------------------------------------------------------------ items and the world
  item(kind: 'pickup' | 'ammo' | 'heal' | 'shield' | 'swap' | 'chest' | 'supply' | 'revive' | 'card' | 'vault', pos: V3 | null = null) {
    if (pos && (kind === 'chest' || kind === 'supply')) this.onCue?.('chest', pos, undefined, 1);
    const to = this.dest(pos, 6, 2); if (!to) return;
    const t = this.ctx!.currentTime;
    switch (kind) {
      case 'pickup': this.tone(to, t, 'triangle', 520, 780, 0.09, 0.22); this.noise(to, t, 0.05, 0.12, 'bandpass', 2000, 2); break;
      case 'ammo': [0, 0.05, 0.1].forEach((d) => this.noise(to, t + d, 0.04, 0.2, 'bandpass', 3000 + d * 4000, 5)); break;
      case 'swap': this.noise(to, t, 0.06, 0.18, 'bandpass', 1500, 2); break;
      case 'heal': [523, 659, 784].forEach((f, i) => this.tone(to, t + i * 0.08, 'sine', f, f, 0.3, 0.18)); break;
      case 'shield': [659, 880, 1175].forEach((f, i) => this.tone(to, t + i * 0.06, 'triangle', f, f * 1.01, 0.35, 0.16)); this.noise(to, t, 0.3, 0.08, 'highpass', 5000, 0.7); break;
      case 'chest':
        this.noise(to, t, 0.25, 0.25, 'bandpass', 500, 2, 0.02, 300); // the lid creaks
        [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(to, t + 0.12 + i * 0.05, 'sine', f, f, 0.5, 0.14));
        break;
      case 'supply': this.tone(to, t, 'sawtooth', 220, 220, 0.6, 0.08); this.tone(to, t + 0.3, 'sawtooth', 330, 330, 0.8, 0.08); break;
      case 'revive': case 'card': [440, 554, 659, 880].forEach((f, i) => this.tone(to, t + i * 0.09, 'triangle', f, f, 0.4, 0.15)); break;
      case 'vault': this.tone(to, t, 'sawtooth', 60, 45, 1.6, 0.4); this.noise(to, t, 1.4, 0.3, 'lowpass', 300, 1, 0.1); break;
    }
  }
  /** A bird somewhere nearby. */
  chirp(pos: V3) {
    const to = this.dest(pos, 8, 1); if (!to) return;
    const t = this.ctx!.currentTime, base = 2200 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone(to, t + i * 0.11, 'sine', base, base * (1.2 + Math.random() * 0.4), 0.07, 0.06);
  }

  // ------------------------------------------------------------ interface
  ui(kind: 'click' | 'ready' | 'found' | 'beep' | 'go' | 'toast' | 'victory' | 'defeat') {
    const to = this.dest(null, 1, 3, true); if (!to) return;
    const t = this.ctx!.currentTime;
    const notes = (fs: number[], gap: number, dur: number, type: OscillatorType = 'triangle', g = 0.16) => fs.forEach((f, i) => this.tone(to, t + i * gap, type, f, f, dur, g));
    switch (kind) {
      case 'click': this.tone(to, t, 'sine', 880, 660, 0.05, 0.12); break;
      case 'ready': notes([523, 784], 0.07, 0.15); break;
      case 'found': notes([392, 523, 659, 784, 1047], 0.08, 0.35); break;
      case 'beep': this.tone(to, t, 'sine', 880, 880, 0.12, 0.18); break;
      case 'go': notes([1047, 1319], 0.06, 0.3, 'sine', 0.2); break;
      case 'toast': notes([988, 1319], 0.05, 0.12, 'sine', 0.1); break;
      case 'victory': notes([523, 659, 784, 1047, 784, 1047, 1319], 0.12, 0.5, 'triangle', 0.2); notes([262, 330, 392], 0, 1.6, 'sawtooth', 0.04); break;
      case 'defeat': notes([440, 415, 392, 311], 0.18, 0.6, 'triangle', 0.16); break;
    }
  }

  // ------------------------------------------------------------ loops (kept alive by calling every frame)
  loop(key: string, kind: LoopKind, vol: number, param?: number, pos?: V3) {
    // cars and chests nearby keep a marker up while you can hear them (not the dropship overhead)
    if (pos && key !== 'ship' && (kind === 'engine' || kind === 'hum')) this.onCue?.(kind === 'engine' ? 'car' : 'chest', pos, key, Math.min(1, vol * 2.2));
    if (!this.on) return;
    let l = this.loops.get(key);
    if (!l) { if (vol < 0.005) return; l = new Loop(this, kind, !!pos); this.loops.set(key, l); }
    l.set(vol, param, pos);
  }
  /** End of frame: loops nobody asked for this frame fade out. */
  sweep() {
    for (const [k, l] of this.loops) { if (!l.touched) { l.stop(); this.loops.delete(k); } else l.touched = false; }
  }
  stopLoops() { for (const l of this.loops.values()) l.stop(); this.loops.clear(); }

  // ------------------------------------------------------------ music
  setMusic(track: string | null) {
    this.wantMusic = track;
    if (!this.ctx) return;
    if (this.music?.name === track) return;
    this.music?.stop();
    this.music = track ? new Music(this.ctx, this.musicBus, this.noiseBuf, track) : null;
  }
}

// ------------------------------------------------------------------ the music sequencer
const NOTE = (n: number) => 440 * Math.pow(2, (n - 69) / 12);
interface Song { bpm: number; chords: number[][]; bass: number[]; drums: 'chill' | 'drive'; arp: boolean; lead: number[] }
// Original progressions and motifs (MIDI note numbers).
const SONGS: Record<string, Song> = {
  // easy-going lobby groove in F
  lobby: { bpm: 96, chords: [[65, 69, 72], [60, 64, 67], [62, 65, 69], [58, 62, 65]], bass: [41, 36, 38, 34], drums: 'chill', arp: true, lead: [77, 76, 72, 74, 72, 69, 72, -1, 74, 72, 70, 69, 67, -1, 65, -1] },
  // the drop: driving, minor, quicker
  drop: { bpm: 122, chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]], bass: [45, 41, 48, 43], drums: 'drive', arp: true, lead: [69, 72, 76, 74, 72, -1, 69, 67, 69, -1, 72, 71, 67, -1, 64, -1] },
};

class Music {
  private timer: number;
  private step = 0;
  private next: number;
  private out: GainNode;
  private echo: DelayNode;
  constructor(private c: AudioContext, bus: AudioNode, private noise: AudioBuffer, readonly name: string) {
    this.out = c.createGain(); this.out.gain.value = 0;
    this.out.gain.setTargetAtTime(1, c.currentTime, 0.8);
    this.out.connect(bus);
    this.echo = c.createDelay(1); this.echo.delayTime.value = 60 / (SONGS[name]?.bpm ?? 100) * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.28; const wet = c.createGain(); wet.gain.value = 0.3;
    this.echo.connect(fb).connect(this.echo); this.echo.connect(wet).connect(this.out);
    this.next = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }
  stop() {
    clearInterval(this.timer);
    this.out.gain.setTargetAtTime(0, this.c.currentTime, 0.4);
    setTimeout(() => this.out.disconnect(), 2500);
  }
  private schedule() {
    const song = SONGS[this.name];
    if (!song) return;
    const s16 = 60 / song.bpm / 4;
    while (this.next < this.c.currentTime + 0.2) {
      this.play(song, this.step, this.next, s16);
      this.step++; this.next += s16;
    }
  }
  private voice(t: number, type: OscillatorType, f: number, dur: number, gain: number, attack = 0.005, cutoff = 6000, echo = false) {
    const c = this.c, o = c.createOscillator(), g = c.createGain(), lp = c.createBiquadFilter();
    o.type = type; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = cutoff;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.out);
    if (echo) g.connect(this.echo);
    o.start(t); o.stop(t + dur + 0.05);
  }
  private hit(t: number, kind: 'kick' | 'snare' | 'hat', gain: number) {
    const c = this.c;
    if (kind === 'kick') {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + 0.3);
      return;
    }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noise; f.type = kind === 'hat' ? 'highpass' : 'bandpass'; f.frequency.value = kind === 'hat' ? 7000 : 1800; f.Q.value = kind === 'hat' ? 0.7 : 0.8;
    const dur = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }
  private play(song: Song, step: number, t: number, s16: number) {
    const bar = Math.floor(step / 16) % song.chords.length, beat = step % 16;
    const chord = song.chords[bar];
    // pad: a soft chord at the start of every bar
    if (beat === 0) for (const n of chord) { this.voice(t, 'sawtooth', NOTE(n), s16 * 15, 0.035, 0.35, 1100); this.voice(t, 'triangle', NOTE(n + 12), s16 * 14, 0.025, 0.3, 2500); }
    // bass
    const b = song.bass[bar];
    if (song.drums === 'drive' ? beat % 2 === 0 : beat === 0 || beat === 8 || beat === 14) this.voice(t, 'triangle', NOTE(b), s16 * (song.drums === 'drive' ? 1.6 : 3), 0.2, 0.004, 900);
    // arpeggio
    if (song.arp && beat % 2 === 0) { const n = chord[(beat / 2) % chord.length] + 12 + (beat >= 8 ? 12 : 0); this.voice(t, 'triangle', NOTE(n), s16 * 1.6, 0.05, 0.003, 4000, true); }
    // lead motif every other phrase
    const phrase = Math.floor(step / 64) % 2;
    if (phrase === 1 && beat % 4 === 0) { const n = song.lead[(Math.floor(step / 4)) % song.lead.length]; if (n > 0) this.voice(t, 'square', NOTE(n), s16 * 3.5, 0.03, 0.01, 2200, true); }
    // drums
    if (song.drums === 'drive') {
      if (beat % 4 === 0) this.hit(t, 'kick', 0.55);
      if (beat === 4 || beat === 12) this.hit(t, 'snare', 0.22);
      this.hit(t, 'hat', beat % 2 ? 0.05 : 0.09);
    } else {
      if (beat === 0 || beat === 10) this.hit(t, 'kick', 0.4);
      if (beat === 4 || beat === 12) this.hit(t, 'snare', 0.14);
      if (beat % 2 === 0) this.hit(t, 'hat', 0.05);
    }
  }
}

export const audio = new AudioEngine();
