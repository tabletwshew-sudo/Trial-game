import * as THREE from 'three';
import { MAP, PM, SPAWN_ISLAND, busPos, type GamePhase, type RosterEntry, type RouteView, type StormState, type World } from '@dropzone/shared';
import { teamColors } from '../settings';
import { SKINS } from '../lobby/character';
import { fmtTime, h } from '../ui/dom';
import { groundColor } from './terrain';

const HALF = MAP.size / 2;
const TEAM_COLORS = teamColors();

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

  // painted at 2048 px (about 1.2 m per pixel) so the zoomed-in minimap and big map stay crisp
  const S = 2048, u = S / 1024, out = document.createElement('canvas'); out.width = out.height = S;
  const c = out.getContext('2d')!;
  c.imageSmoothingQuality = 'high';
  c.drawImage(base, 0, 0, S, S);
  const px = (v: number) => ((v + HALF) / MAP.size) * S;
  // roads
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [{ col: '#3b3d47', add: 2.2 * u }, { col: '#f1ead2', add: 0 }]) {
    c.strokeStyle = pass.col;
    for (const r of w.roads) {
      c.lineWidth = (r.width / MAP.size) * S + pass.add;
      c.beginPath();
      for (let i = 0; i < r.pts.length; i += 2) i ? c.lineTo(px(r.pts[i]), px(r.pts[i + 1])) : c.moveTo(px(r.pts[i]), px(r.pts[i + 1]));
      c.stroke();
    }
  }
  // buildings, with a soft drop shadow so they read as blocks
  for (const b of w.boxes) {
    c.fillStyle = 'rgba(20,18,40,.35)'; c.fillRect(px(b.x0) + u, px(b.z0) + u * 1.5, px(b.x1) - px(b.x0), px(b.z1) - px(b.z0));
    c.fillStyle = '#4a4458'; c.fillRect(px(b.x0) - 0.6 * u, px(b.z0) - 0.6 * u, px(b.x1) - px(b.x0) + 1.2 * u, px(b.z1) - px(b.z0) + 1.2 * u);
    c.fillStyle = b.shape === 1 ? '#e9a15b' : '#efe6d8'; c.fillRect(px(b.x0), px(b.z0), px(b.x1) - px(b.x0), px(b.z1) - px(b.z0));
  }
  // ziplines (dashed, with an end post at each end) and spring pads
  c.lineCap = 'butt';
  for (const Z of w.zips) {
    for (const [col, wd] of [['#2b2d42', 3.4 * u], ['#7cf2ff', 1.6 * u]] as const) {
      c.strokeStyle = col; c.lineWidth = wd; c.setLineDash(col === '#7cf2ff' ? [5 * u, 4 * u] : []);
      c.beginPath(); c.moveTo(px(Z.ax), px(Z.az)); c.lineTo(px(Z.bx), px(Z.bz)); c.stroke();
    }
    c.setLineDash([]);
    for (const [x, z] of [[Z.ax, Z.az], [Z.bx, Z.bz]]) { c.fillStyle = '#2b2d42'; c.beginPath(); c.arc(px(x), px(z), 3.2 * u, 0, Math.PI * 2); c.fill(); c.fillStyle = '#ffb703'; c.beginPath(); c.arc(px(x), px(z), 1.9 * u, 0, Math.PI * 2); c.fill(); }
  }
  for (const p of w.pads) { c.fillStyle = '#2b2d42'; c.beginPath(); c.arc(px(p.x), px(p.z), 3.4 * u, 0, Math.PI * 2); c.fill(); c.fillStyle = '#38f8b8'; c.beginPath(); c.arc(px(p.x), px(p.z), 2.2 * u, 0, Math.PI * 2); c.fill(); }
  return out;
}

/** The colour of open sea on the map (matches the deepest water paintMap draws, so there's no seam). */
export const OCEAN = 'rgb(41,128,212)';

/** The warm-up island (it sits off the main map): ground, water and the practice course, from above. */
export function paintSpawn(w: World) {
  const f = w.spawn, N = 384, out = document.createElement('canvas'); out.width = out.height = N;
  const c = out.getContext('2d')!, img = c.createImageData(N, N), col = new THREE.Color();
  const span = f.maxX - f.ox;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = f.ox + (i / N) * span, z = f.oz + (j / N) * span, hgt = f.sample(x, z);
    if (hgt < -0.4) { const t = Math.min(1, -hgt / 7); col.setRGB(0.36 - t * 0.2, 0.74 - t * 0.24, 0.95 - t * 0.12); }
    else {
      const slope = Math.abs(f.sample(x + 1, z) - f.sample(x - 1, z)) + Math.abs(f.sample(x, z + 1) - f.sample(x, z - 1));
      groundColor(w, x, z, hgt, slope / 4, col);
      col.setRGB(Math.pow(col.r, 1 / 2.2), Math.pow(col.g, 1 / 2.2), Math.pow(col.b, 1 / 2.2));
    }
    img.data.set([Math.min(255, col.r * 255), Math.min(255, col.g * 255), Math.min(255, col.b * 255), 255], (j * N + i) * 4);
  }
  c.putImageData(img, 0, 0);
  const px = (v: number, o: number) => ((v - o) / span) * N;
  for (const o of w.solids) {
    if (o.x1 < f.ox || o.x0 > f.maxX || o.z1 < f.oz || o.z0 > f.maxZ || o.y1 - o.y0 < 0.6) continue;
    c.fillStyle = '#4a4458'; c.fillRect(px(o.x0, f.ox) - 1, px(o.z0, f.oz) - 1, px(o.x1, f.ox) - px(o.x0, f.ox) + 2, px(o.z1, f.oz) - px(o.z0, f.oz) + 2);
    c.fillStyle = '#efe6d8'; c.fillRect(px(o.x0, f.ox), px(o.z0, f.oz), px(o.x1, f.ox) - px(o.x0, f.ox), px(o.z1, f.oz) - px(o.z0, f.oz));
  }
  return { canvas: out, x0: f.ox, z0: f.oz, span };
}

/** Map grid: 8 × 8 squares, columns A–H west to east, rows 1–8 north to south. */
const GRID = 8;
export function gridRef(x: number, z: number) {
  const i = Math.floor(((x + HALF) / MAP.size) * GRID), j = Math.floor(((z + HALF) / MAP.size) * GRID);
  if (i < 0 || j < 0 || i >= GRID || j >= GRID) return '';
  return String.fromCharCode(65 + i) + (j + 1);
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
  /** Supply drops that haven't been opened. */
  drops?: { x: number; z: number }[];
  storm?: StormState | null;
  /** Recall beacons and whether each is ready right now. */
  beacons?: { x: number; z: number; ready: boolean }[];
  kills?: number;
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
  private stormEl = h('div.storm-info');
  private stormArrow = h('div.storm-arrow', h('span.arr', '➤'), h('b'), h('small', 'TO SAFE ZONE'));
  private stormTint = h('div.storm-tint');
  private killsEl = h('b', '0');
  private tagEls = new Map<string, HTMLElement>();
  private teamRows = new Map<number, { row: HTMLElement; status: HTMLElement }>();
  private lastPoi = -1; private placeTimer = 0;
  private lastView: HudView | null = null;
  private teamIdx: number[];
  private spawnTex: ReturnType<typeof paintSpawn>;
  /** Big map view: centre and width in metres. */
  private view: { cx: number; cz: number; span: number } = { cx: 0, cz: 0, span: MAP.size };
  private drag: { x: number; y: number; cx: number; cz: number; moved: boolean; button: number } | null = null;
  private bmWhere!: HTMLElement; private bmStorm!: HTMLElement; private bmAlive!: HTMLElement;

  constructor(private w: World, colors: Float32Array, private roster: RosterEntry[], private selfIdx: number,
    private cb: { onLeave: () => void; onResume: () => void; onSettings: () => void; onMarker: (x?: number, z?: number) => void; onCloseMap: () => void }) {
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

    // ---- the big map: click to mark, right-click to clear, wheel to zoom, drag to pan
    this.spawnTex = paintSpawn(w);
    const toWorld = (e: MouseEvent) => {
      const rect = this.big.getBoundingClientRect(), v = this.view;
      return { x: v.cx + ((e.clientX - rect.left) / rect.width - 0.5) * v.span, z: v.cz + ((e.clientY - rect.top) / rect.height - 0.5) * v.span };
    };
    this.big.addEventListener('mousedown', (e) => { this.drag = { x: e.clientX, y: e.clientY, cx: this.view.cx, cz: this.view.cz, moved: false, button: e.button }; });
    this.big.addEventListener('contextmenu', (e) => e.preventDefault());
    this.big.addEventListener('wheel', (e) => {
      e.preventDefault();
      const at = toWorld(e), rect = this.big.getBoundingClientRect();
      this.view.span = Math.max(260, Math.min(MAP.size, this.view.span * (e.deltaY > 0 ? 1.25 : 0.8)));
      // keep the spot under the cursor where it is
      this.view.cx = at.x - ((e.clientX - rect.left) / rect.width - 0.5) * this.view.span;
      this.view.cz = at.z - ((e.clientY - rect.top) / rect.height - 0.5) * this.view.span;
      this.clampView(); this.redrawBig();
    }, { passive: false });
    const zoomBtn = (label: string, title: string, fn: () => void) => h('button.bm-btn', { title, onclick: () => { fn(); this.clampView(); this.redrawBig(); } }, label);
    this.bmWhere = h('span.bm-where'); this.bmStorm = h('span.bm-storm'); this.bmAlive = h('span.bm-alive');
    const legend = (cls: string, label: string) => h('div.bm-leg', h(`i.${cls}`), h('span', label));
    this.mapWrap = h('div.bigmap',
      h('div.bigmap-card',
        h('div.bigmap-head', h('b.bm-title', 'THE ISLAND'), this.bmWhere, h('span.bm-spacer'), this.bmStorm, this.bmAlive),
        h('div.bigmap-body',
          h('div.bigmap-canvas', this.big,
            h('div.bm-zoom',
              zoomBtn('+', 'Zoom in', () => { this.view.span *= 0.7; }),
              zoomBtn('−', 'Zoom out', () => { this.view.span /= 0.7; }),
              zoomBtn('◎', 'Centre on me', () => { const s = this.lastView?.self; if (s) { this.view.cx = s.x; this.view.cz = s.z; if (this.view.span > 1400) this.view.span = 900; } }),
              zoomBtn('⤢', 'Whole island', () => { this.view = { cx: 0, cz: 0, span: MAP.size }; }))),
          h('div.bigmap-legend',
            h('div.bm-leg-title', 'KEY'),
            legend('lg-you', 'You'), legend('lg-mate', 'Squad'), legend('lg-pin', 'Squad marker'),
            legend('lg-zone', 'Safe zone'), legend('lg-next', 'Next zone'), legend('lg-route', 'Dropship route'),
            legend('lg-drop', 'Supply drop'), legend('lg-beacon', 'Recall beacon'), legend('lg-zip', 'Zipline'), legend('lg-pad', 'Spring pad'))),
        h('div.bigmap-help', h('span', h('kbd', 'Click'), ' mark a spot'), h('span', h('kbd', 'Right-click'), ' clear'), h('span', h('kbd', 'Wheel'), ' zoom'), h('span', h('kbd', 'Drag'), ' pan'), h('span', h('kbd', 'M'), ' close'))));
    this.mapWrap.addEventListener('mousedown', (e) => { if (e.target === this.mapWrap) this.cb.onCloseMap(); });
    this.mapWrap.addEventListener('mousemove', (e) => {
      const d = this.drag;
      if (!d) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) d.moved = true;
      if (!d.moved) return;
      const mPerPx = this.view.span / this.big.getBoundingClientRect().width;
      this.view.cx = d.cx - (e.clientX - d.x) * mPerPx; this.view.cz = d.cz - (e.clientY - d.y) * mPerPx;
      this.clampView(); this.redrawBig();
    });
    this.mapWrap.addEventListener('mouseup', (e) => {
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved) return;
      if (d.button === 2) this.cb.onMarker();
      else if (d.button === 0) { const at = toWorld(e); if (Math.abs(at.x) <= HALF && Math.abs(at.z) <= HALF) this.cb.onMarker(at.x, at.z); }
    });

    this.menu = h('div.pause',
      h('div.pause-card',
        h('div.pause-title', 'PAUSED'),
        h('button.btn.btn-primary.wide', { onclick: () => this.cb.onResume() }, 'RESUME'),
        h('div.controls',
          ...[['W A S D', 'Move'], ['Mouse', 'Look / fire / aim'], ['Shift', 'Sprint'], ['Space', 'Jump / drop / glider'], ['E', 'Interact'], ['R', 'Reload'], ['B', 'Emote'], ['M', 'Map'], ['Middle click', 'Ping'], ['Esc', 'Menu']]
            .map(([k, v]) => h('div', h('kbd', k), h('span', v)))),
        h('button.btn.btn-ghost.wide', { onclick: () => this.cb.onSettings() }, 'SETTINGS'),
        h('button.btn.btn-ghost.wide', { onclick: () => this.cb.onLeave() }, 'LEAVE MATCH')));

    this.el = h('div.hud',
      this.tagsEl,
      h('div.hud-top', this.compass, this.banner, this.bannerSub),
      this.stormTint,
      h('div.hud-right', this.mini, h('div.hud-counts', h('div.alive', h('span', '👥'), this.aliveEl, h('small', 'LEFT')), h('div.alive', h('span', '⦿'), this.killsEl, h('small', 'ELIMS'))), this.stormEl),
      this.stormArrow,
      this.teamEl, this.alt, this.hint, this.place, this.clickHint, h('div.crosshair'), this.fpsEl,
      this.flash, this.mapWrap, this.menu);
  }

  doFlash() { this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go'); }
  setMap(open: boolean) { this.mapOpen = open; this.mapWrap.classList.toggle('open', open); this.drag = null; if (open) this.redrawBig(); }
  private clampView() {
    const v = this.view;
    v.span = Math.max(260, Math.min(MAP.size, v.span));
    const lim = HALF - v.span / 2 + 60;
    v.cx = Math.max(-lim, Math.min(lim, v.cx)); v.cz = Math.max(-lim, Math.min(lim, v.cz));
  }
  private redrawBig() { if (this.lastView) this.drawBig(this.lastView); }
  setMenu(open: boolean) { this.menuOpen = open; this.menu.classList.toggle('open', open); }

  private drawOverlays(c: CanvasRenderingContext2D, v: HudView, toX: (x: number) => number, toY: (z: number) => number, scale: number, names = false) {
    const st = v.storm;
    if (st) {
      const k = Math.abs(toX(1) - toX(0));
      // shade everything outside the safe circle
      c.save();
      c.fillStyle = 'rgba(122, 52, 214, 0.42)';
      c.beginPath(); c.rect(0, 0, c.canvas.width, c.canvas.height); c.arc(toX(st.x), toY(st.z), Math.max(0, st.r * k), 0, Math.PI * 2, true); c.fill();
      c.strokeStyle = '#d7b4ff'; c.lineWidth = 2.5 * scale;
      c.beginPath(); c.arc(toX(st.x), toY(st.z), Math.max(0, st.r * k), 0, Math.PI * 2); c.stroke();
      // next circle
      if (!st.done) { c.strokeStyle = '#ffffff'; c.setLineDash([6 * scale, 5 * scale]); c.beginPath(); c.arc(toX(st.next.x), toY(st.next.z), Math.max(0, st.next.r * k), 0, Math.PI * 2); c.stroke(); c.setLineDash([]); }
      c.restore();
    }
    for (const b of v.beacons ?? []) {
      const x = toX(b.x), y = toY(b.z), s = 6 * scale;
      c.fillStyle = b.ready ? '#4ade80' : '#8a8a99'; c.strokeStyle = '#14123a'; c.lineWidth = 2 * scale;
      c.beginPath(); c.moveTo(x, y - s * 1.4); c.lineTo(x + s, y); c.lineTo(x, y + s * 1.4); c.lineTo(x - s, y); c.closePath(); c.fill(); c.stroke();
    }
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
    for (const d of v.drops ?? []) {
      const x = toX(d.x), y = toY(d.z), s = 9 * scale;
      c.fillStyle = '#3a86ff'; c.strokeStyle = '#fff'; c.lineWidth = 2 * scale;
      c.fillRect(x - s / 2, y - s / 2, s, s); c.strokeRect(x - s / 2, y - s / 2, s, s);
      c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(x, y - s * 1.1, s * 0.55, 0, 7); c.fill(); c.stroke();
    }
    for (const [idx, m] of v.markers) {
      const col = TEAM_COLORS[this.teamIdx.indexOf(idx) % 4], x = toX(m.x), y = toY(m.z);
      c.fillStyle = col; c.strokeStyle = '#14123a'; c.lineWidth = 2 * scale;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x - 7 * scale, y - 16 * scale); c.arc(x, y - 18 * scale, 7 * scale, Math.PI, 0); c.lineTo(x, y); c.fill(); c.stroke();
    }
    // your own marker: a dashed line to it and how far it is
    const mine = v.markers.get(this.selfIdx);
    const me = v.team.find((p) => p.idx === this.selfIdx);
    if (mine && me && names) {
      const d = Math.round(Math.hypot(mine.x - me.x, mine.z - me.z));
      c.save(); c.strokeStyle = 'rgba(255,255,255,.85)'; c.lineWidth = 2 * scale; c.setLineDash([5 * scale, 5 * scale]);
      c.beginPath(); c.moveTo(toX(me.x), toY(me.z)); c.lineTo(toX(mine.x), toY(mine.z)); c.stroke(); c.restore();
      this.label(c, `${d} m`, toX(mine.x), toY(mine.z) - 30 * scale, 13 * scale, '#ffffff');
    }
    // squad (you last, on top): arrows that point where each player is looking
    const order = [...v.team].sort((a, b) => Number(a.idx === this.selfIdx) - Number(b.idx === this.selfIdx));
    for (const p of order) {
      if (!p.visible && p.idx !== this.selfIdx) continue;
      const x = toX(p.x), y = toY(p.z), self = p.idx === this.selfIdx;
      const col = TEAM_COLORS[this.teamIdx.indexOf(p.idx) % 4];
      if (self) { c.fillStyle = 'rgba(255,255,255,.28)'; c.beginPath(); c.arc(x, y, 15 * scale, 0, Math.PI * 2); c.fill(); }
      c.save(); c.translate(x, y); c.rotate(-p.yaw);
      c.fillStyle = col; c.strokeStyle = self ? '#ffffff' : '#14123a'; c.lineWidth = (self ? 2.6 : 2) * scale; c.lineJoin = 'round';
      const s = (self ? 9.5 : 7.5) * scale;
      c.beginPath(); c.moveTo(0, -s * 1.3); c.lineTo(s * 0.9, s); c.lineTo(0, s * 0.45); c.lineTo(-s * 0.9, s); c.closePath(); c.fill(); c.stroke();
      c.restore();
      if (names && !self) this.label(c, this.roster[p.idx].name, x, y + 20 * scale, 11 * scale, col);
    }
  }

  /** Text with a dark rounded backing, readable on any terrain. */
  private label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string) {
    c.save();
    c.font = `700 ${size}px "Lilita One", system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const w = c.measureText(text).width + size * 0.9, hgt = size * 1.45;
    c.fillStyle = 'rgba(20,18,58,.78)';
    c.beginPath(); c.roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt / 2); c.fill();
    c.fillStyle = color; c.fillText(text, x, y + size * 0.05);
    c.restore();
  }

  private nearSpawn(x: number, z: number) { return Math.hypot(x - SPAWN_ISLAND.x, z - SPAWN_ISLAND.z) < 400; }

  /** Draw the warm-up island texture into a map whose projection is toX/toY. */
  private drawSpawn(c: CanvasRenderingContext2D, toX: (x: number) => number, toY: (z: number) => number) {
    const t = this.spawnTex, x0 = toX(t.x0), z0 = toY(t.z0), size = toX(t.x0 + t.span) - x0;
    c.drawImage(t.canvas, x0, z0, size, size);
  }

  private drawMini(v: HudView) {
    const c = this.mini.getContext('2d')!, S = this.mini.width, s = v.self;
    const air = s.mode === PM.Fall || s.mode === PM.Glide || s.mode === PM.Bus;
    const span = air ? 900 : 360; // metres across; zoom out while dropping
    const k = this.mapTex.width / MAP.size;
    c.fillStyle = OCEAN; c.fillRect(0, 0, S, S);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.mapTex, (s.x - span / 2 + HALF) * k, (s.z - span / 2 + HALF) * k, span * k, span * k, 0, 0, S, S);
    const toX = (x: number) => ((x - s.x) / span + 0.5) * S, toY = (z: number) => ((z - s.z) / span + 0.5) * S;
    if (this.nearSpawn(s.x, s.z)) this.drawSpawn(c, toX, toY);
    // names of places in view
    if (!air) for (const p of this.w.pois) {
      const x = toX(p.x), y = toY(p.z);
      if (x > -60 && x < S + 60 && y > -20 && y < S + 20) this.label(c, p.name.toUpperCase(), x, y, 17, '#ffffff');
    }
    this.drawOverlays(c, v, toX, toY, 1.5);
    // north, and which grid square you're in
    c.fillStyle = 'rgba(20,18,58,.82)'; c.beginPath(); c.arc(S / 2, 20, 15, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#ffd23f'; c.font = '700 18px "Lilita One", system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('N', S / 2, 21);
    const ref = this.nearSpawn(s.x, s.z) ? 'WARM-UP' : gridRef(s.x, s.z);
    if (ref) this.label(c, ref, 40 + ref.length * 3, S - 22, 17, '#ffffff');
  }

  private drawBig(v: HudView) {
    const c = this.big.getContext('2d')!, S = this.big.width, vw = this.view, k = S / vw.span;
    const toX = (x: number) => (x - vw.cx) * k + S / 2, toY = (z: number) => (z - vw.cz) * k + S / 2;
    c.fillStyle = OCEAN; c.fillRect(0, 0, S, S);
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(this.mapTex, toX(-HALF), toY(-HALF), MAP.size * k, MAP.size * k);
    // the grid, for calling out places ("drop at D4")
    c.save(); c.strokeStyle = 'rgba(255,255,255,.2)'; c.lineWidth = 1.5;
    for (let i = 1; i < GRID; i++) {
      const g = -HALF + (i * MAP.size) / GRID;
      c.beginPath(); c.moveTo(toX(g), toY(-HALF)); c.lineTo(toX(g), toY(HALF)); c.moveTo(toX(-HALF), toY(g)); c.lineTo(toX(HALF), toY(g)); c.stroke();
    }
    c.restore();
    // place names grow a little as you zoom in
    const fs = Math.min(24, 15 + (MAP.size / vw.span - 1) * 3);
    for (const p of this.w.pois) this.label(c, p.name.toUpperCase(), toX(p.x), toY(p.z - p.r) - fs * 0.6, fs, '#ffffff');
    this.drawOverlays(c, v, toX, toY, 1.35, true);
    // grid letters along the top, numbers down the side (they stay on screen while you pan)
    for (let i = 0; i < GRID; i++) {
      const mid = -HALF + ((i + 0.5) * MAP.size) / GRID, x = toX(mid), y = toY(mid);
      if (x > 20 && x < S - 20) this.label(c, String.fromCharCode(65 + i), x, 16, 16, '#ffd23f');
      if (y > 36 && y < S - 20) this.label(c, String(i + 1), 16, y, 16, '#ffd23f');
    }
    // the warm-up island is off the edge of the map: show it in a corner while you're on it
    const me = v.team.find((p) => p.idx === this.selfIdx);
    if (v.phase === 'warmup' || (me && this.nearSpawn(me.x, me.z))) {
      const B = 300, ox = 18, oy = S - B - 18, t = this.spawnTex;
      c.save();
      c.fillStyle = 'rgba(20,18,58,.9)'; c.beginPath(); c.roundRect(ox - 6, oy - 34, B + 12, B + 40, 14); c.fill();
      c.beginPath(); c.roundRect(ox, oy, B, B, 10); c.clip();
      const sx = (x: number) => ox + ((x - t.x0) / t.span) * B, sz = (z: number) => oy + ((z - t.z0) / t.span) * B;
      c.fillStyle = OCEAN; c.fillRect(ox, oy, B, B);
      this.drawSpawn(c, sx, sz);
      this.drawOverlays(c, { ...v, storm: null, route: null, drops: [], beacons: [], markers: new Map() }, sx, sz, 1.2, true);
      c.restore();
      c.fillStyle = '#ffd23f'; c.font = '700 16px "Lilita One", system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'middle';
      c.fillText('WARM-UP ISLAND · YOU ARE HERE', ox + 4, oy - 17);
    }
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
    if (v.phase === 'warmup') { big = 'WARM-UP'; sub = `Dropship leaves in ${fmtTime(Math.max(0, (v.warmupEndsAt - v.serverNow) / 1000))} · no damage until then`; hint = 'WASD move · SHIFT sprint · SPACE jump · F pickaxe · TAB inventory · M map'; }
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
    this.killsEl.textContent = String(v.kills ?? 0);
    // storm timer + where to go
    const st = v.storm;
    this.stormEl.classList.toggle('show', !!st && !st.done);
    if (st && this.frame % 6 === 0) {
      const left = Math.max(0, (st.until - v.serverNow) / 1000);
      this.stormEl.replaceChildren(h('span', st.shrinking ? '⚡' : '⏱'), h('b', fmtTime(left)), h('small', st.shrinking ? 'STORM CLOSING' : st.phase === 0 && !st.shrinking ? 'STORM FORMS' : 'STORM SHRINKS IN'), h('i', `${st.dps}/s`));
    }
    const outside = !!st && Math.hypot(s.x - st.x, s.z - st.z) > st.r && s.mode !== PM.Bus;
    const outNext = !!st && !st.done && Math.hypot(s.x - st.next.x, s.z - st.next.z) > st.next.r;
    this.stormTint.classList.toggle('show', outside);
    this.stormArrow.classList.toggle('show', (outside || outNext) && s.mode !== PM.Bus);
    if (st && (outside || outNext)) {
      const tx = outside ? st.x : st.next.x, tz = outside ? st.z : st.next.z, tr = outside ? st.r : st.next.r;
      const ang = Math.atan2(-(tx - s.x), -(tz - s.z)) - s.yaw;
      (this.stormArrow.querySelector('.arr') as HTMLElement).style.transform = `rotate(${-ang - Math.PI / 2}rad)`;
      (this.stormArrow.querySelector('b') as HTMLElement).textContent = `${Math.max(0, Math.round(Math.hypot(tx - s.x, tz - s.z) - tr))} m`;
      this.stormArrow.classList.toggle('danger', outside);
    }
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
    // teammates standing together: stack their tags instead of drawing them on top of each other
    const placed: { x: number; y: number }[] = [];
    for (const t of [...v.tags].sort((a, b) => a.dist - b.dist)) {
      for (let k = 0; k < 4; k++) {
        const hit = placed.find((q) => Math.abs(q.x - t.sx) < 110 && Math.abs(q.y - t.sy) < 30);
        if (!hit) break;
        t.sy = hit.y - 30;
      }
      placed.push({ x: t.sx, y: t.sy });
    }
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
    if (this.mapOpen && this.frame % 6 === 0) {
      this.drawBig(v);
      // header: where you are, the storm, who's left
      const here = s.mode === PM.Bus ? 'On the dropship' : this.nearSpawn(s.x, s.z) ? 'Warm-up island'
        : (() => { const p = this.w.pois.find((q) => Math.hypot(s.x - q.x, s.z - q.z) < q.r * 1.2); const g = gridRef(s.x, s.z); return p ? `${p.name} · ${g}` : g || 'At sea'; })();
      this.bmWhere.textContent = here;
      const st = v.storm;
      this.bmStorm.textContent = v.phase === 'warmup' ? `Dropship leaves in ${fmtTime(Math.max(0, (v.warmupEndsAt - v.serverNow) / 1000))}`
        : st && !st.done ? `${st.shrinking ? 'Storm closing' : 'Storm shrinks in'} ${fmtTime(Math.max(0, (st.until - v.serverNow) / 1000))}` : '';
      this.bmAlive.textContent = `${v.alive} left`;
    }
    if (this.frame % 30 === 0) this.fpsEl.textContent = `${Math.round(v.fps)} fps`;
  }
}
