import { MAP, PM, SPAWN_ISLAND, busPos, type GamePhase, type RosterEntry, type RouteView, type World } from '@dropzone/shared';
import { SKINS } from '../lobby/character';
import { fmtTime, h } from '../ui/dom';

const HALF = MAP.size / 2;
const TEAM_COLORS = ['#ffd23f', '#3ee6ff', '#ff5fa2', '#4ade80'];

/** Paint the top-down map once: terrain colours, water, hill shading, roads and buildings. */
export function paintMap(w: World, colors: Float32Array): HTMLCanvasElement {
  const n = w.main.nx, d = w.main.data;
  const base = document.createElement('canvas'); base.width = base.height = n;
  const ctx = base.getContext('2d')!, img = ctx.createImageData(n, n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, hgt = d[k];
    let r = colors[k * 3], g = colors[k * 3 + 1], b = colors[k * 3 + 2];
    // three.js vertex colours are linear; the canvas wants sRGB
    r = Math.pow(r, 1 / 2.2); g = Math.pow(g, 1 / 2.2); b = Math.pow(b, 1 / 2.2);
    if (hgt < 0) { const t = Math.min(1, -hgt / 7); r = 0.36 - t * 0.2; g = 0.74 - t * 0.24; b = 0.95 - t * 0.12; }
    else {
      const shade = 1 + Math.max(-0.28, Math.min(0.28, ((d[k - (i > 0 ? 1 : 0)] - d[k + (i < n - 1 ? 1 : 0)]) + (d[k - (j > 0 ? n : 0)] - d[k + (j < n - 1 ? n : 0)])) * 0.035));
      r *= shade; g *= shade; b *= shade;
    }
    img.data.set([Math.min(255, r * 255), Math.min(255, g * 255), Math.min(255, b * 255), 255], k * 4);
  }
  ctx.putImageData(img, 0, 0);

  const S = 1024, out = document.createElement('canvas'); out.width = out.height = S;
  const c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(base, 0, 0, S, S);
  const px = (v: number) => ((v + HALF) / MAP.size) * S;
  // roads
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [{ col: '#3b3d47', add: 2.2 }, { col: '#f1ead2', add: 0 }]) {
    c.strokeStyle = pass.col;
    for (const r of w.roads) {
      c.lineWidth = (r.width / MAP.size) * S + pass.add;
      c.beginPath();
      for (let i = 0; i < r.pts.length; i += 2) i ? c.lineTo(px(r.pts[i]), px(r.pts[i + 1])) : c.moveTo(px(r.pts[i]), px(r.pts[i + 1]));
      c.stroke();
    }
  }
  // buildings
  for (const b of w.boxes) {
    c.fillStyle = '#4a4458'; c.fillRect(px(b.x0) - 0.6, px(b.z0) - 0.6, px(b.x1) - px(b.x0) + 1.2, px(b.z1) - px(b.z0) + 1.2);
    c.fillStyle = b.shape === 1 ? '#e9a15b' : '#efe6d8'; c.fillRect(px(b.x0), px(b.z0), px(b.x1) - px(b.x0), px(b.z1) - px(b.z0));
  }
  return out;
}

export interface HudPlayer { idx: number; x: number; z: number; yaw: number; mode: number; visible: boolean }
export interface HudTag { idx: number; sx: number; sy: number; dist: number; show: boolean }
export interface HudView {
  phase: GamePhase;
  serverNow: number;
  warmupEndsAt: number;
  route: RouteView | null;
  self: { x: number; y: number; z: number; yaw: number; mode: number; height: number; vy: number; speed: number };
  alive: number;
  team: HudPlayer[];
  tags: HudTag[];
  markers: Map<number, { x: number; z: number; sx: number; sy: number; show: boolean; dist: number }>;
  locked: boolean;
  fps: number;
}

export class Hud {
  readonly el: HTMLElement;
  mapOpen = false;
  menuOpen = false;
  private mapTex: HTMLCanvasElement;
  private mini: HTMLCanvasElement; private big: HTMLCanvasElement; private compass: HTMLCanvasElement;
  private banner = h('div.banner'); private bannerSub = h('div.banner-sub');
  private hint = h('div.hint-keys');
  private alt = h('div.altimeter');
  private aliveEl = h('b', '0');
  private teamEl = h('div.team');
  private tagsEl = h('div.world-tags');
  private mapWrap: HTMLElement; private menu: HTMLElement; private clickHint = h('div.click-hint', 'Click to look around');
  private place = h('div.place');
  private flash = h('div.flash');
  private fpsEl = h('div.fps');
  private tagEls = new Map<string, HTMLElement>();
  private teamRows = new Map<number, { row: HTMLElement; status: HTMLElement }>();
  private lastPoi = -1; private placeTimer = 0;
  private lastView: HudView | null = null;
  private teamIdx: number[];

  constructor(private w: World, colors: Float32Array, private roster: RosterEntry[], private selfIdx: number,
    private cb: { onLeave: () => void; onResume: () => void; onMarker: (x?: number, z?: number) => void; onCloseMap: () => void }) {
    this.mapTex = paintMap(w, colors);
    const myTeam = roster[selfIdx].team;
    this.teamIdx = roster.filter((r) => r.team === myTeam).map((r) => r.idx);
    this.mini = h('canvas.minimap', { width: 380, height: 380 }) as HTMLCanvasElement;
    this.big = h('canvas', { width: 1024, height: 1024 }) as HTMLCanvasElement;
    this.compass = h('canvas.compass', { width: 720, height: 64 }) as HTMLCanvasElement;

    for (const idx of this.teamIdx) {
      const r = roster[idx], status = h('small', '');
      const row = h('div.mate', { class: idx === selfIdx ? 'you' : '' },
        h('span.pip', { style: { background: TEAM_COLORS[this.teamIdx.indexOf(idx) % 4] } }),
        h('span.avatar', { style: { background: SKINS[r.skin % SKINS.length].hoodie } }),
        h('div', h('b', r.name), status));
      this.teamRows.set(idx, { row, status });
      this.teamEl.append(row);
    }

    this.big.addEventListener('mousedown', (e) => {
      const rect = this.big.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * MAP.size - HALF, z = ((e.clientY - rect.top) / rect.height) * MAP.size - HALF;
      if (e.button === 2) this.cb.onMarker(); else this.cb.onMarker(x, z);
    });
    this.big.addEventListener('contextmenu', (e) => e.preventDefault());
    this.mapWrap = h('div.bigmap', h('div.bigmap-card', this.big, h('div.bigmap-help', h('span', h('kbd', 'Click'), ' place marker'), h('span', h('kbd', 'Right-click'), ' remove'), h('span', h('kbd', 'M'), ' close'))));
    this.mapWrap.addEventListener('mousedown', (e) => { if (e.target === this.mapWrap) this.cb.onCloseMap(); });

    this.menu = h('div.pause',
      h('div.pause-card',
        h('div.pause-title', 'PAUSED'),
        h('button.btn.btn-primary.wide', { onclick: () => this.cb.onResume() }, 'RESUME'),
        h('div.controls',
          ...[['W A S D', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump / Drop / Glider'], ['M', 'Map'], ['Middle click', 'Ping'], ['Esc', 'Menu']]
            .map(([k, v]) => h('div', h('kbd', k), h('span', v)))),
        h('button.btn.btn-ghost.wide', { onclick: () => this.cb.onLeave() }, 'LEAVE MATCH')));

    this.el = h('div.hud',
      this.tagsEl,
      h('div.hud-top', this.compass, this.banner, this.bannerSub),
      h('div.hud-right', this.mini, h('div.alive', h('span', '👥'), this.aliveEl, h('small', 'LEFT'))),
      this.teamEl, this.alt, this.hint, this.place, this.clickHint, h('div.crosshair'), this.fpsEl,
      this.flash, this.mapWrap, this.menu);
  }

  doFlash() { this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go'); }
  setMap(open: boolean) { this.mapOpen = open; this.mapWrap.classList.toggle('open', open); if (open && this.lastView) this.drawBig(this.lastView); }
  setMenu(open: boolean) { this.menuOpen = open; this.menu.classList.toggle('open', open); }

  private px(v: number, size: number) { return ((v + HALF) / MAP.size) * size; }

  private drawOverlays(c: CanvasRenderingContext2D, v: HudView, toX: (x: number) => number, toY: (z: number) => number, scale: number) {
    if (v.route && v.phase === 'bus') {
      const r = v.route, b = busPos(r, v.serverNow);
      c.setLineDash([10 * scale, 8 * scale]); c.lineWidth = 3 * scale; c.strokeStyle = 'rgba(255,255,255,.9)';
      c.beginPath(); c.moveTo(toX(r.x0), toY(r.z0)); c.lineTo(toX(r.x1), toY(r.z1)); c.stroke(); c.setLineDash([]);
      const ang = Math.atan2(r.z1 - r.z0, r.x1 - r.x0);
      c.save(); c.translate(toX(b.x), toY(b.z)); c.rotate(ang);
      c.fillStyle = '#ffd23f'; c.strokeStyle = '#14123a'; c.lineWidth = 2 * scale;
      c.beginPath(); c.ellipse(0, 0, 13 * scale, 6 * scale, 0, 0, Math.PI * 2); c.fill(); c.stroke();
      c.restore();
    }
    for (const [idx, m] of v.markers) {
      const col = TEAM_COLORS[this.teamIdx.indexOf(idx) % 4], x = toX(m.x), y = toY(m.z);
      c.fillStyle = col; c.strokeStyle = '#14123a'; c.lineWidth = 2 * scale;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 7 * scale, y - 16 * scale); c.arc(x, y - 18 * scale, 7 * scale, Math.PI, 0); c.lineTo(x, y); c.fill(); c.stroke();
    }
    for (const p of v.team) {
      if (!p.visible && p.idx !== this.selfIdx) continue;
      const x = toX(p.x), y = toY(p.z), me = p.idx === this.selfIdx;
      c.save(); c.translate(x, y); c.rotate(-p.yaw);
      c.fillStyle = TEAM_COLORS[this.teamIdx.indexOf(p.idx) % 4]; c.strokeStyle = '#14123a'; c.lineWidth = 2 * scale;
      const s = (me ? 9 : 7) * scale;
      c.beginPath(); c.moveTo(0, -s * 1.25); c.lineTo(s * 0.85, s); c.lineTo(0, s * 0.5); c.lineTo(-s * 0.85, s); c.closePath(); c.fill(); c.stroke();
      c.restore();
    }
  }

  private drawMini(v: HudView) {
    const c = this.mini.getContext('2d')!, S = this.mini.width;
    const span = v.self.mode === PM.Walk ? 380 : 900; // metres across; zoom out while dropping
    const k = this.mapTex.width / MAP.size;
    c.fillStyle = '#2b8fd6'; c.fillRect(0, 0, S, S);
    const sx = (v.self.x - span / 2 + HALF) * k, sy = (v.self.z - span / 2 + HALF) * k;
    c.imageSmoothingEnabled = true;
    c.drawImage(this.mapTex, sx, sy, span * k, span * k, 0, 0, S, S);
    const toX = (x: number) => ((x - v.self.x) / span + 0.5) * S, toY = (z: number) => ((z - v.self.z) / span + 0.5) * S;
    if (Math.hypot(v.self.x - SPAWN_ISLAND.x, v.self.z - SPAWN_ISLAND.z) < 400) {
      c.fillStyle = '#f3e2a6'; c.beginPath(); c.arc(toX(SPAWN_ISLAND.x), toY(SPAWN_ISLAND.z), (SPAWN_ISLAND.r * 0.86 / span) * S, 0, 7); c.fill();
      c.fillStyle = '#63c24b'; c.beginPath(); c.arc(toX(SPAWN_ISLAND.x), toY(SPAWN_ISLAND.z), (SPAWN_ISLAND.r * 0.74 / span) * S, 0, 7); c.fill();
    }
    this.drawOverlays(c, v, toX, toY, 1.5);
  }

  private drawBig(v: HudView) {
    const c = this.big.getContext('2d')!, S = this.big.width;
    c.drawImage(this.mapTex, 0, 0, S, S);
    const toX = (x: number) => this.px(x, S), toY = (z: number) => this.px(z, S);
    c.textAlign = 'center'; c.font = '700 17px "Lilita One", system-ui, sans-serif'; c.lineWidth = 4; c.lineJoin = 'round';
    for (const p of this.w.pois) {
      const y = toY(p.z - p.r) - 4;
      c.strokeStyle = 'rgba(20,18,58,.9)'; c.strokeText(p.name.toUpperCase(), toX(p.x), y);
      c.fillStyle = '#fff'; c.fillText(p.name.toUpperCase(), toX(p.x), y);
    }
    this.drawOverlays(c, v, toX, toY, 1.4);
  }

  private drawCompass(yaw: number) {
    const c = this.compass.getContext('2d')!, W = this.compass.width, H = this.compass.height;
    c.clearRect(0, 0, W, H);
    const bearing = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360, pxPerDeg = W / 150;
    const names: Record<number, string> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
    c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 15) {
      let off = d - bearing; if (off > 180) off -= 360; if (off < -180) off += 360;
      const x = W / 2 + off * pxPerDeg, fade = Math.max(0, 1 - Math.abs(off) / 75);
      if (fade <= 0) continue;
      c.globalAlpha = fade;
      if (names[d]) { c.fillStyle = d % 90 === 0 ? '#ffd23f' : '#fff'; c.font = `${d % 90 === 0 ? 30 : 22}px "Lilita One", system-ui, sans-serif`; c.fillText(names[d], x, 26); }
      else { c.fillStyle = 'rgba(255,255,255,.75)'; c.fillRect(x - 1.5, 18, 3, 16); }
    }
    c.globalAlpha = 1; c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(W / 2, 62); c.lineTo(W / 2 - 9, 50); c.lineTo(W / 2 + 9, 50); c.fill();
  }

  private frame = 0;
  update(v: HudView, dt: number) {
    this.lastView = v; this.frame++;
    const s = v.self;
    // banner
    let big = '', sub = '', hint = '';
    if (v.phase === 'warmup') { big = 'WARM-UP'; sub = `Dropship leaves in ${fmtTime(Math.max(0, (v.warmupEndsAt - v.serverNow) / 1000))}`; hint = 'WASD move · SHIFT sprint · SPACE jump · M map'; }
    else if (s.mode === PM.Bus && v.route) {
      const toDoors = (v.route.doorsAt - v.serverNow) / 1000;
      if (toDoors > 0) { big = 'GET READY'; sub = `Doors open in ${Math.ceil(toDoors)}`; hint = 'M map · click the map to mark where your squad should land'; }
      else { big = 'SPACE TO DROP'; sub = `Last call in ${Math.max(0, Math.ceil((v.route.ejectAt - v.serverNow) / 1000))}s`; hint = 'Press SPACE to jump'; }
    } else if (s.mode === PM.Fall) hint = 'Look down to dive · W to steer · SPACE deploy glider';
    else if (s.mode === PM.Glide) hint = s.height > 85 ? 'W to glide · SPACE fold glider' : 'W to glide';
    this.banner.textContent = big; this.bannerSub.textContent = sub;
    this.banner.classList.toggle('pulse', big === 'SPACE TO DROP');
    this.hint.textContent = hint;

    const air = s.mode === PM.Fall || s.mode === PM.Glide;
    this.alt.classList.toggle('show', air);
    if (air) this.alt.replaceChildren(h('b', `${Math.max(0, Math.round(s.height))}`), h('small', 'M ABOVE GROUND'), h('i', `${Math.round(Math.hypot(s.vy, s.speed))} m/s`));

    this.aliveEl.textContent = String(v.alive);
    this.clickHint.classList.toggle('show', !v.locked && !this.mapOpen && !this.menuOpen);

    // location name pops up when you walk into a named place
    if (s.mode === PM.Walk && v.phase !== 'warmup') {
      const poi = this.w.pois.find((p) => Math.hypot(s.x - p.x, s.z - p.z) < p.r);
      const id = poi ? poi.id : -1;
      if (id !== this.lastPoi) { this.lastPoi = id; if (poi) { this.place.textContent = poi.name.toUpperCase(); this.placeTimer = 3.2; } }
    }
    this.placeTimer -= dt;
    this.place.classList.toggle('show', this.placeTimer > 0);

    // team list
    if (this.frame % 10 === 0) for (const p of v.team) {
      const row = this.teamRows.get(p.idx); if (!row) continue;
      const d = Math.round(Math.hypot(p.x - s.x, p.z - s.z));
      row.status.textContent = p.idx === this.selfIdx ? 'YOU' : !p.visible && p.mode !== PM.Bus ? 'LEFT' : p.mode === PM.Bus ? 'On board' : p.mode === PM.Fall ? `Dropping · ${d} m` : p.mode === PM.Glide ? `Gliding · ${d} m` : `${d} m`;
      row.row.classList.toggle('gone', !p.visible && p.mode !== PM.Bus);
    }

    // world tags (teammates + markers)
    const want = new Set<string>();
    const tag = (key: string, sx: number, sy: number, show: boolean, build: () => HTMLElement, dist: number, far: boolean) => {
      if (!show) return;
      want.add(key);
      let el = this.tagEls.get(key);
      if (!el) { el = build(); this.tagEls.set(key, el); this.tagsEl.append(el); }
      el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -100%)`;
      const dEl = el.querySelector('i'); if (dEl && this.frame % 6 === 0) dEl.textContent = far ? `${Math.round(dist)} m` : '';
    };
    for (const t of v.tags) {
      const col = TEAM_COLORS[this.teamIdx.indexOf(t.idx) % 4];
      tag(`p${t.idx}`, t.sx, t.sy, t.show, () => h('div.wtag', h('span', { style: { color: col } }, '▼'), h('b', this.roster[t.idx].name), h('i')), t.dist, t.dist > 20);
    }
    for (const [idx, m] of v.markers) {
      const col = TEAM_COLORS[this.teamIdx.indexOf(idx) % 4];
      tag(`m${idx}`, m.sx, m.sy, m.show, () => h('div.wtag.marker', h('span.pin', { style: { background: col } }), h('i')), m.dist, true);
    }
    for (const [key, el] of this.tagEls) if (!want.has(key)) { el.remove(); this.tagEls.delete(key); }

    this.drawCompass(s.yaw);
    if (this.frame % 2 === 0) this.drawMini(v);
    if (this.mapOpen && this.frame % 6 === 0) this.drawBig(v);
    if (this.frame % 30 === 0) this.fpsEl.textContent = `${Math.round(v.fps)} fps`;
  }
}
