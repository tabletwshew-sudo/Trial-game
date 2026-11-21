import { K } from '@dropzone/shared';
import type { Input } from './input';
import { applyHudScale, settings } from '../settings';

/**
 * Touch controls for phones and tablets: a joystick that appears under your left thumb (push it
 * all the way forward to sprint), drag anywhere on the right to look, and on-screen buttons.
 * Tap a hotbar slot to switch to it.
 *
 * Every button can be moved, resized, hidden and faded in the layout editor (✎, or EDIT TOUCH
 * LAYOUT in the pause menu). The layout is saved on this device.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(location.search).get('touch');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (settings.touchControls !== 'auto') return settings.touchControls === 'on';
  // the primary pointer is a finger: phones and tablets (touchscreen laptops report a fine pointer)
  return matchMedia('(pointer: coarse)').matches;
}

export type BtnId = 'fire' | 'fire2' | 'aim' | 'jump' | 'crouch' | 'reload' | 'use' | 'pick' | 'inv' | 'map' | 'ping' | 'emote' | 'menu';
interface Spot { x: number; y: number; s: number; h?: boolean } // centre as % of the screen, size in px, hidden
interface Layout { btn: Record<BtnId, Spot>; opacity: number }
const BUTTONS: { id: BtnId; label: string; name: string; bit?: number }[] = [
  { id: 'fire', label: '✦', name: 'FIRE', bit: K.FIRE },
  { id: 'fire2', label: '✦', name: 'FIRE (LEFT)', bit: K.FIRE },
  { id: 'aim', label: '◎', name: 'AIM', bit: K.ADS },
  { id: 'jump', label: '⤒', name: 'JUMP', bit: K.JUMP },
  { id: 'crouch', label: '⤓', name: 'CROUCH', bit: K.CROUCH },
  { id: 'reload', label: '↻', name: 'RELOAD', bit: K.RELOAD },
  { id: 'use', label: 'E', name: 'INTERACT', bit: K.USE },
  { id: 'pick', label: '⛏', name: 'PICKAXE' },
  { id: 'emote', label: '☺', name: 'EMOTE', bit: K.EMOTE },
  { id: 'ping', label: '⚑', name: 'MARK' },
  { id: 'inv', label: '▤', name: 'INVENTORY' },
  { id: 'map', label: '⌖', name: 'MAP' },
  { id: 'menu', label: '≡', name: 'MENU' },
];
const bitOf = (id?: BtnId) => BUTTONS.find((b) => b.id === id)?.bit ?? 0;
const DEFAULT_BTNS: Record<BtnId, Spot> = {
  fire: { x: 84, y: 63, s: 84 }, fire2: { x: 6, y: 46, s: 54 }, aim: { x: 93, y: 52, s: 58 }, jump: { x: 93, y: 78, s: 68 },
  crouch: { x: 83, y: 87, s: 54 }, reload: { x: 73, y: 75, s: 50 }, use: { x: 73, y: 55, s: 54 }, pick: { x: 75, y: 93, s: 44 },
  emote: { x: 79, y: 32, s: 38, h: true }, ping: { x: 79, y: 20, s: 38 }, inv: { x: 5, y: 67, s: 42 }, map: { x: 79, y: 8, s: 40 }, menu: { x: 18, y: 8, s: 40 },
};
const fresh = (): Layout => ({ btn: Object.fromEntries(Object.entries(DEFAULT_BTNS).map(([k, v]) => [k, { ...v }])) as Record<BtnId, Spot>, opacity: 0.85 });
const STORE = 'dz.touchLayout';
function loadLayout(): Layout {
  const l = fresh();
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (raw && typeof raw === 'object') {
      for (const id of Object.keys(l.btn) as BtnId[]) {
        const s = raw.btn?.[id];
        if (s && Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.s)) l.btn[id] = { x: s.x, y: s.y, s: s.s, h: !!s.h };
      }
      if (Number.isFinite(raw.opacity)) l.opacity = Math.max(0.25, Math.min(1, raw.opacity));
    }
  } catch { /* storage blocked or bad data: use the default */ }
  return l;
}
function saveLayout(l: Layout) { try { localStorage.setItem(STORE, JSON.stringify(l)); } catch { /* still used this session */ } }

type Ptr = { kind: 'stick' | 'look' | 'btn'; id?: BtnId; x: number; y: number; ox: number; oy: number };

export class TouchControls {
  readonly el = document.createElement('div');
  private btns = new Map<BtnId, HTMLElement>();
  private layout = loadLayout();
  private saved = JSON.stringify(this.layout);
  private stick = document.createElement('div');
  private knob = document.createElement('div');
  private editBar = document.createElement('div');
  private selName = document.createElement('b');
  private hideBtn!: HTMLButtonElement;
  private fadeBtn!: HTMLButtonElement;
  private editing = false;
  private selected: BtnId | null = null;
  private ptrs = new Map<number, Ptr>();
  private moveBits = 0;
  private btnBits = 0;
  private shown = false;
  private raf = 0;

  constructor(host: HTMLElement, private input: Input) {
    this.el.className = 'touch-ui';
    this.stick.className = 'touch-stick'; this.knob.className = 'touch-knob'; this.stick.append(this.knob);
    this.el.append(this.stick);
    for (const b of BUTTONS) {
      const e = document.createElement('div');
      e.className = `touch-btn tb-${b.id}`; e.dataset.id = b.id; e.dataset.name = b.name;
      e.append(Object.assign(document.createElement('span'), { textContent: b.label }));
      this.btns.set(b.id, e); this.el.append(e);
    }
    const edit = document.createElement('div');
    edit.className = 'touch-edit'; edit.textContent = '✎'; edit.title = 'Edit the button layout';
    edit.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); if (this.editing) this.finish(true); else this.edit(); });
    this.el.append(edit);

    // the editor's toolbar
    const mk = (t: string, f: () => void, cls = '') => {
      const b = document.createElement('button'); b.textContent = t; if (cls) b.className = cls;
      b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); ev.stopPropagation(); f(); });
      return b;
    };
    this.editBar.className = 'touch-editbar';
    this.hideBtn = mk('HIDE', () => { if (!this.selected) return; const s = this.layout.btn[this.selected]; s.h = !s.h; this.place(); });
    this.fadeBtn = mk('', () => { const o = [1, 0.85, 0.65, 0.45]; this.layout.opacity = o[(o.indexOf(this.layout.opacity) + 1) % o.length] ?? 0.85; this.place(); });
    this.editBar.append(
      h2('div.teb-hint', 'Drag a button to move it. Tap one to pick it, then resize or hide it.'),
      this.selName,
      mk('−', () => this.resize(-6)), mk('+', () => this.resize(6)), this.hideBtn, this.fadeBtn,
      mk('RESET', () => { this.layout = fresh(); this.place(); }),
      mk('CANCEL', () => { this.layout = JSON.parse(this.saved); this.finish(false); }),
      mk('SAVE', () => this.finish(true), 'go'),
    );
    this.el.append(this.editBar);
    // phones held upright: ask for landscape
    this.el.append(h2('div.touch-rotate', h2('b', '⟳'), 'Turn your phone sideways to play'));

    host.append(this.el);
    document.body.classList.add('touch');
    applyHudScale();
    addEventListener('resize', applyHudScale);
    this.place();
    this.el.addEventListener('pointerdown', this.down);
    addEventListener('pointermove', this.move, { passive: false });
    addEventListener('pointerup', this.up);
    addEventListener('pointercancel', this.up);
    // no page zoom or scrolling from stray gestures while playing
    this.el.addEventListener('touchstart', prevent, { passive: false });
    this.el.addEventListener('touchmove', prevent, { passive: false });
    this.el.addEventListener('contextmenu', prevent);
    const tick = () => { this.raf = requestAnimationFrame(tick); this.show(this.input.locked || this.editing); };
    tick();
  }

  /** Open the layout editor. */
  edit() {
    this.saved = JSON.stringify(this.layout);
    this.editing = true; this.selected = null;
    this.release();
    this.el.classList.add('editing');
    this.place();
  }

  private finish(save: boolean) {
    if (save) { saveLayout(this.layout); this.saved = JSON.stringify(this.layout); }
    this.editing = false; this.selected = null;
    this.el.classList.remove('editing');
    this.ptrs.clear();
    this.place();
    // opened from the pause menu: back to the game
    if (!this.input.locked) this.input.lock();
  }

  private show(on: boolean) {
    if (on === this.shown) return;
    this.shown = on;
    this.el.classList.toggle('on', on);
    if (!on) this.release();
  }

  /** Let go of everything (the UI was hidden or the editor opened). */
  private release() {
    this.ptrs.clear(); this.moveBits = 0; this.btnBits = 0; this.push();
    this.stick.classList.remove('on', 'sprint'); this.knob.style.transform = ''; this.stick.style.left = this.stick.style.top = '';
    for (const e of this.btns.values()) e.classList.remove('down');
  }

  private place() {
    this.el.style.setProperty('--touch-op', String(this.layout.opacity));
    for (const [id, e] of this.btns) {
      const p = this.layout.btn[id];
      e.style.left = `${p.x}%`; e.style.top = `${p.y}%`; e.style.width = e.style.height = `${p.s}px`;
      e.style.fontSize = `${Math.round(p.s * 0.42)}px`;
      e.classList.toggle('sel', this.editing && this.selected === id);
      e.classList.toggle('hid', !!p.h);
    }
    const sel = this.selected ? this.layout.btn[this.selected] : null;
    this.selName.textContent = this.selected ? BUTTONS.find((b) => b.id === this.selected)!.name : 'NONE PICKED';
    this.hideBtn.textContent = sel?.h ? 'SHOW' : 'HIDE';
    this.hideBtn.disabled = !sel;
    this.fadeBtn.textContent = `OPACITY ${Math.round(this.layout.opacity * 100)}%`;
  }

  private resize(d: number) {
    if (!this.selected) return;
    const p = this.layout.btn[this.selected];
    p.s = Math.max(34, Math.min(150, p.s + d));
    this.place();
  }

  private down = (ev: PointerEvent) => {
    ev.preventDefault();
    const t = (ev.target as HTMLElement).closest('.touch-btn') as HTMLElement | null;
    const id = t?.dataset.id as BtnId | undefined;
    const ptr: Ptr = { kind: 'look', id, x: ev.clientX, y: ev.clientY, ox: ev.clientX, oy: ev.clientY };
    if (this.editing) {
      if (id) { this.selected = id; ptr.kind = 'btn'; this.ptrs.set(ev.pointerId, ptr); this.place(); }
      return;
    }
    if (id && !this.layout.btn[id].h) {
      ptr.kind = 'btn';
      this.btnBits |= bitOf(id);
      if (id === 'pick') this.input.pendingSlot = 6;
      else if (id === 'inv') this.input.onAction?.('inventory');
      else if (id === 'map') this.input.onAction?.('map');
      else if (id === 'ping') this.input.onAction?.('ping');
      else if (id === 'menu') this.input.onAction?.('menu');
      t!.classList.add('down');
    } else {
      // tap a hotbar slot to hold it (the first tile is the pickaxe)
      const tiles = Array.from(document.querySelectorAll<HTMLElement>('.slot-tile'));
      const i = tiles.findIndex((e) => { const r = e.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom; });
      if (i >= 0) { this.input.pendingSlot = i === 0 ? 6 : i; tiles[i].classList.add('tapped'); setTimeout(() => tiles[i].classList.remove('tapped'), 150); return; }
      if (ev.clientX < innerWidth * 0.42 && ![...this.ptrs.values()].some((p) => p.kind === 'stick')) {
        // the joystick appears where your thumb lands
        ptr.kind = 'stick';
        this.stick.style.left = `${ev.clientX}px`; this.stick.style.top = `${ev.clientY}px`;
        this.stick.classList.add('on');
      }
    }
    this.ptrs.set(ev.pointerId, ptr);
    this.push();
  };

  private move = (ev: PointerEvent) => {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    ev.preventDefault();
    const dx = ev.clientX - p.x, dy = ev.clientY - p.y;
    p.x = ev.clientX; p.y = ev.clientY;
    if (this.editing) {
      if (p.kind === 'btn' && p.id) {
        const s = this.layout.btn[p.id];
        s.x = Math.max(1, Math.min(99, s.x + (dx / innerWidth) * 100));
        s.y = Math.max(2, Math.min(98, s.y + (dy / innerHeight) * 100));
        this.place();
      }
      return;
    }
    if (p.kind === 'stick') {
      const R = 58, vx = ev.clientX - p.ox, vy = ev.clientY - p.oy, d = Math.hypot(vx, vy), k = Math.min(1, d / R);
      const nx = d > 0 ? vx / d : 0, ny = d > 0 ? vy / d : 0;
      this.knob.style.transform = `translate(${nx * k * R}px, ${ny * k * R}px)`;
      this.moveBits = 0;
      if (k > 0.28) {
        if (ny < -0.38) this.moveBits |= K.F;
        if (ny > 0.38) this.moveBits |= K.B;
        if (nx < -0.38) this.moveBits |= K.L;
        if (nx > 0.38) this.moveBits |= K.R;
        if (k > 0.97 && ny < -0.7) this.moveBits |= K.SPRINT; // all the way forward: sprint
      }
      this.stick.classList.toggle('sprint', !!(this.moveBits & K.SPRINT));
      this.push();
    } else if (p.kind === 'look' || p.id === 'fire' || p.id === 'fire2' || p.id === 'aim') {
      // drag to look, also while holding fire or aim so you can track a target
      this.input.touchLook(dx, dy);
    }
  };

  private up = (ev: PointerEvent) => {
    const p = this.ptrs.get(ev.pointerId);
    if (!p) return;
    this.ptrs.delete(ev.pointerId);
    if (this.editing) return;
    if (p.kind === 'stick') { this.moveBits = 0; this.knob.style.transform = ''; this.stick.classList.remove('on', 'sprint'); this.stick.style.left = this.stick.style.top = ''; }
    if (p.kind === 'btn' && p.id) {
      // let go of the bit unless another finger holds a button with the same one (the two fire buttons)
      const bit = bitOf(p.id);
      if (bit && ![...this.ptrs.values()].some((q) => q.kind === 'btn' && bitOf(q.id) === bit)) this.btnBits &= ~bit;
      this.btns.get(p.id)?.classList.remove('down');
    }
    this.push();
  };

  private push() { this.input.touchBits = this.moveBits | this.btnBits; }

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('pointermove', this.move); removeEventListener('pointerup', this.up); removeEventListener('pointercancel', this.up);
    removeEventListener('resize', applyHudScale);
    document.body.classList.remove('touch');
    applyHudScale();
    this.el.remove();
  }
}

function prevent(e: Event) { e.preventDefault(); }
function h2(sel: string, ...kids: (Node | string)[]) {
  const [tag, ...cls] = sel.split('.');
  const e = document.createElement(tag);
  if (cls.length) e.className = cls.join(' ');
  e.append(...kids);
  return e;
}
