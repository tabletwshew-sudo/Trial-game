/**
 * Visual sound effects: markers on a ring around the middle of the screen pointing at what you
 * can hear: footsteps, gunfire, explosions, chests, cars, impacts, gliders, splashes. Bright
 * when it's close, faint far off, with an arrow when it's well above or below you. It works with
 * the sound off too (it listens to what the game plays, not to the speakers).
 */
export type Cue = 'step' | 'gun' | 'boom' | 'chest' | 'car' | 'hit' | 'glider' | 'splash' | 'vault';

interface V3 { x: number; y: number; z: number }

/** How far each kind shows, how long a marker lasts, its colour and icon. */
const KINDS: Record<Cue, { range: number; life: number; color: string; icon: string }> = {
  step: { range: 42, life: 0.9, color: '#ffffff', icon: '<ellipse cx="8.5" cy="7" rx="3" ry="4.2"/><ellipse cx="15.5" cy="14" rx="3" ry="4.2"/><circle cx="8.5" cy="13.2" r="1.6"/><circle cx="15.5" cy="20" r="1.6"/>' },
  gun: { range: 170, life: 1.5, color: '#ff6b4a', icon: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3.2 3.2M15.8 15.8L19 19M19 5l-3.2 3.2M8.2 15.8L5 19" stroke-width="2.2" stroke-linecap="round" fill="none"/>' },
  boom: { range: 240, life: 2.2, color: '#ffae34', icon: '<path d="M12 1.5l2.4 5.6 5.6-2.4-2.4 5.6 5.4 1.7-5.4 1.7 2.4 5.6-5.6-2.4L12 22.5l-2.4-5.6-5.6 2.4 2.4-5.6-5.4-1.7 5.4-1.7-2.4-5.6 5.6 2.4z"/>' },
  chest: { range: 26, life: 0.45, color: '#ffd23f', icon: '<path d="M3 10.5C3 6.5 6 5 12 5s9 1.5 9 5.5z"/><rect x="3" y="11.5" width="18" height="8" rx="1.2"/><rect x="10.5" y="9.5" width="3" height="4.5" rx="0.8" fill="#3a2a10"/>' },
  car: { range: 130, life: 0.45, color: '#7fd6ff', icon: '<path d="M4 15l1.6-5.2C6 8.6 7 8 8.2 8h7.6c1.2 0 2.2.6 2.6 1.8L20 15z"/><rect x="2.5" y="14" width="19" height="4.5" rx="1.6"/><circle cx="7" cy="19" r="2.2"/><circle cx="17" cy="19" r="2.2"/>' },
  hit: { range: 40, life: 1, color: '#d9d9d9', icon: '<path d="M4 20L13 11" stroke-width="2.6" stroke-linecap="round" fill="none"/><path d="M8 5.5c4-2.4 9-1.8 12 1.5-3.8-.8-7.2.2-9.6 2.4z"/><path d="M15 3l2 2M19 9.5l2.4.6M14.5 1.5l.4 2.2" stroke-width="1.6" stroke-linecap="round" fill="none"/>' },
  glider: { range: 90, life: 1.2, color: '#c9a8ff', icon: '<path d="M2.5 11C4.5 5.5 19.5 5.5 21.5 11c-2.2-1.2-4.4-1.2-6.4 0-2-1.2-4.2-1.2-6.2 0-2-1.2-4.2-1.2-6.4 0z"/><path d="M3 11.5l9 8 9-8M9 11.5l3 8 3-8" stroke-width="1.2" fill="none"/>' },
  splash: { range: 45, life: 1, color: '#5fb8ff', icon: '<path d="M12 3c3.5 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2.5-6 6-11z"/>' },
  vault: { range: 140, life: 2.4, color: '#ffd23f', icon: '<rect x="4.5" y="10.5" width="15" height="10" rx="1.6"/><path d="M8 10.5V8a4 4 0 0 1 8 0" stroke-width="2.4" fill="none"/>' },
};

interface Marker { kind: Cue; key: string | null; x: number; y: number; z: number; t: number; loud: number; el: HTMLElement; icon: HTMLElement; arrow: HTMLElement; tip: HTMLElement }

const MAX = 14;

export class SoundViz {
  readonly el: HTMLElement;
  private markers: Marker[] = [];
  private pool: Marker[] = [];

  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'soundviz';
  }

  /**
   * Something made a noise at `pos`. `key` marks a continuous source (a car's engine, a chest's
   * hum): the same marker is kept up to date instead of adding new ones. `loud` 0..1 scales it.
   */
  add(kind: Cue, pos: V3, key: string | null = null, loud = 1) {
    const k = KINDS[kind];
    // the same source again (or the same runner a step further on): refresh, don't add
    const same = this.markers.find((m) => m.kind === kind && (key ? m.key === key : !m.key && (m.x - pos.x) ** 2 + (m.z - pos.z) ** 2 < (kind === 'gun' ? 36 : 16)));
    if (same) { same.x = pos.x; same.y = pos.y; same.z = pos.z; same.t = k.life; same.loud = Math.max(same.loud * 0.6, loud); return; }
    if (this.markers.length >= MAX) {
      // make room by dropping the faintest
      let worst = 0;
      for (let i = 1; i < this.markers.length; i++) if (this.markers[i].t * this.markers[i].loud < this.markers[worst].t * this.markers[worst].loud) worst = i;
      this.release(this.markers.splice(worst, 1)[0]);
    }
    const m = this.pool.pop() ?? this.make();
    m.kind = kind; m.key = key; m.x = pos.x; m.y = pos.y; m.z = pos.z; m.t = k.life; m.loud = loud;
    m.el.style.setProperty('--c', k.color);
    m.icon.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22">${k.icon}</svg>`;
    this.el.append(m.el);
    this.markers.push(m);
  }

  /** Place markers for where the camera is and which way it faces. */
  update(dt: number, cam: V3, yaw: number, enabled: boolean) {
    this.el.style.display = enabled ? '' : 'none';
    const R = Math.min(innerHeight * 0.3, 250);
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i], k = KINDS[m.kind];
      m.t -= dt;
      const dx = m.x - cam.x, dz = m.z - cam.z, dist = Math.hypot(dx, dz, m.y - cam.y);
      if (m.t <= 0 || dist > k.range) { this.release(this.markers.splice(i, 1)[0]); continue; }
      if (!enabled) continue;
      // angle round the ring: straight ahead is the top
      const a = Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz);
      const near = Math.max(0, 1 - dist / k.range);
      const fade = Math.min(1, m.t / Math.min(0.35, k.life * 0.6));
      const alpha = Math.min(1, (0.3 + near * 0.8) * (0.55 + m.loud * 0.45)) * fade;
      const scale = 0.78 + near * 0.42;
      m.el.style.transform = `translate(${(Math.sin(a) * R).toFixed(1)}px, ${(-Math.cos(a) * R).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      m.el.style.opacity = alpha.toFixed(3);
      m.tip.style.transform = `rotate(${a.toFixed(3)}rad)`;
      const dy = m.y - cam.y;
      const up = dy > 3.5 ? '▲' : dy < -3.5 ? '▼' : '';
      if (m.arrow.textContent !== up) m.arrow.textContent = up;
    }
  }

  clear() { while (this.markers.length) this.release(this.markers.pop()!); }

  private make(): Marker {
    const el = document.createElement('div'); el.className = 'sv';
    const tip = document.createElement('i'); tip.className = 'sv-tip';
    const icon = document.createElement('span'); icon.className = 'sv-icon';
    const arrow = document.createElement('b'); arrow.className = 'sv-up';
    el.append(tip, icon, arrow);
    return { kind: 'step', key: null, x: 0, y: 0, z: 0, t: 0, loud: 1, el, icon, arrow, tip };
  }
  private release(m: Marker) { m.el.remove(); this.pool.push(m); }
}
