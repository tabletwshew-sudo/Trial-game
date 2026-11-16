import { K } from '@dropzone/shared';
import { settings, type Action } from '../settings';

const ACTION_BITS: Partial<Record<Action, number>> = {
  forward: K.F, back: K.B, left: K.L, right: K.R, jump: K.JUMP, sprint: K.SPRINT, crouch: K.CROUCH, reload: K.RELOAD, interact: K.USE, emote: K.EMOTE,
};
/** Key code -> input bits, from the player's key bindings (arrow keys always move too). */
function keymap(): Record<string, number> {
  const m: Record<string, number> = { ArrowUp: K.F, ArrowDown: K.B, ArrowLeft: K.L, ArrowRight: K.R, ControlLeft: K.CROUCH, ShiftRight: K.SPRINT };
  for (const [a, bit] of Object.entries(ACTION_BITS)) m[settings.keys[a as Action]] = (m[settings.keys[a as Action]] ?? 0) | bit!;
  return m;
}

/** Keyboard + mouse. Mouse look uses pointer lock; keys work either way. */
export class Input {
  /** Raw key bits as held. Read `keys` for what the game should act on. */
  private held = 0;
  private adsLatched = false;
  yaw = 0;
  pitch = -0.15;
  /** Base sensitivity; scaled down while aiming down sights (see `zoom`). */
  sensitivity = 0.0023;
  /** Current zoom factor (FOV ratio) so aiming with a scope isn't twitchy. */
  zoom = 1;
  locked = false;
  /** 1..5 when a slot key was pressed this frame, 6 for the pickaxe (consumed by the game). */
  pendingSlot = 0;
  /** Accumulated wheel notches (+1 = next slot). */
  wheel = 0;
  onAction?: (a: 'map' | 'menu' | 'ping' | 'spec' | 'inventory') => void;
  /** After you're eliminated: left/right click cycles who you watch. */
  spectating = false;
  onSpec?: (dir: number) => void;

  /** Bits the game should act on: sprint-by-default and toggle-aim applied. */
  get keys() {
    let k = this.held | this.tapped;
    if (settings.autoSprint) k ^= K.SPRINT;
    if (settings.toggleAds) k = (k & ~K.ADS) | (this.adsLatched ? K.ADS : 0);
    return k;
  }
  set keys(v: number) { this.held = v & ~(this.tapped & ~this.held); if (!(v & K.ADS)) this.adsLatched = false; }
  /**
   * Keys pressed since the last sim step, even if already released: a quick tap on a slow frame
   * (low-end laptops) still counts. The game calls this after each step reads `keys`.
   */
  consumeTaps() { this.tapped = 0; }
  private tapped = 0;
  onLockChange?: (locked: boolean) => void;
  private off: (() => void)[] = [];
  private mouse = 0;

  constructor(private el: HTMLElement) {
    const on = <K2 extends keyof DocumentEventMap>(target: Document | Window | HTMLElement, type: K2, fn: (e: DocumentEventMap[K2]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(document, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || document.querySelector('.settings-overlay')) return;
      const bit = keymap()[e.code];
      if (bit) { this.held |= bit; if (!e.repeat) this.tapped |= bit; e.preventDefault(); }
      if (e.repeat) return;
      for (let i = 1; i <= 5; i++) if (settings.keys[`slot${i}` as Action] === e.code) this.pendingSlot = i;
      if (e.code === settings.keys.pickaxe || e.code === 'Digit6') this.pendingSlot = 6;
      if (e.code === settings.keys.map) { e.preventDefault(); this.onAction?.('map'); }
      if (e.code === settings.keys.inventory || e.code === 'Tab') { e.preventDefault(); this.onAction?.('inventory'); }
      if (e.code === 'Escape') this.onAction?.('menu');
      if (this.spectating && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) this.onSpec?.(e.code === 'ArrowRight' ? 1 : -1);
    });
    on(document, 'keyup', (e) => { const bit = keymap()[e.code]; if (bit) this.held &= ~bit; });
    on(window, 'blur' as any, () => { this.held = 0; this.tapped = 0; this.mouse = 0; });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      // some browsers report a huge delta on the first locked frame
      const dx = Math.max(-300, Math.min(300, e.movementX)), dy = Math.max(-300, Math.min(300, e.movementY));
      // zoomed in: slow down by the field-of-view ratio and the player's ADS/scope multipliers
      const mul = this.zoom < 0.4 ? settings.scopeMul : this.zoom < 0.95 ? settings.adsMul : 1;
      const sens = this.sensitivity * settings.sensitivity * this.zoom * mul;
      this.yaw -= dx * sens;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * sens * (settings.invertY ? -1 : 1)));
    });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.held = 0; this.mouse = 0; this.adsLatched = false; }
      this.onLockChange?.(this.locked);
    });
    on(el, 'mousedown', (e) => {
      if (!this.locked) { this.lock(); return; }
      e.preventDefault();
      if (this.spectating && (e.button === 0 || e.button === 2)) { this.onSpec?.(e.button === 0 ? 1 : -1); return; }
      if (e.button === 0) this.held |= K.FIRE;
      else if (e.button === 2) { this.held |= K.ADS; this.adsLatched = !this.adsLatched; }
      else if (e.button === 1) this.onAction?.('ping');
      this.mouse |= 1 << e.button;
    });
    on(document, 'mouseup', (e) => {
      if (e.button === 0) this.held &= ~K.FIRE;
      else if (e.button === 2) this.held &= ~K.ADS;
      this.mouse &= ~(1 << e.button);
    });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'wheel', (e) => { if (this.locked) { e.preventDefault(); this.wheel += Math.sign(e.deltaY); } }, { passive: false });
  }

  /**
   * Take the slot change requested since last frame (absolute 1..5, 6 = pickaxe), resolving wheel
   * scrolls from the current slot: the wheel goes round the five slots and the pickaxe.
   */
  takeSlot(current: number, usable: (slot: number) => boolean): number {
    if (this.pendingSlot) { const s = this.pendingSlot; this.pendingSlot = 0; this.wheel = 0; return s; }
    if (!this.wheel) return 0;
    const dir = Math.sign(this.wheel);
    this.wheel = 0;
    for (let i = 1; i <= 6; i++) {
      const s = (((current + dir * i) % 6) + 6) % 6;
      if (s === 5 || usable(s)) return s + 1;
    }
    return 0;
  }

  lock() {
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch { /* browser refused (e.g. too soon after Esc) - the player can click again */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  dispose() { this.off.forEach((f) => f()); this.unlock(); }
}
