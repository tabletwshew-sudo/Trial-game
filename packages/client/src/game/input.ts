import { K } from '@dropzone/shared';

const KEYMAP: Record<string, number> = {
  KeyW: K.F, ArrowUp: K.F, KeyS: K.B, ArrowDown: K.B, KeyA: K.L, ArrowLeft: K.L, KeyD: K.R, ArrowRight: K.R,
  Space: K.JUMP, ShiftLeft: K.SPRINT, ShiftRight: K.SPRINT, ControlLeft: K.CROUCH, KeyC: K.CROUCH,
  KeyR: K.RELOAD, KeyE: K.USE,
};

/** Keyboard + mouse. Mouse look uses pointer lock; keys work either way. */
export class Input {
  keys = 0;
  yaw = 0;
  pitch = -0.15;
  /** Base sensitivity; scaled down while aiming down sights (see `zoom`). */
  sensitivity = 0.0023;
  /** Current zoom factor (FOV ratio) so aiming with a scope isn't twitchy. */
  zoom = 1;
  locked = false;
  /** 1..5 when a slot key was pressed this frame (consumed by the game). */
  pendingSlot = 0;
  /** Accumulated wheel notches (+1 = next slot). */
  wheel = 0;
  onAction?: (a: 'map' | 'menu' | 'ping') => void;
  onLockChange?: (locked: boolean) => void;
  private off: (() => void)[] = [];
  private mouse = 0;

  constructor(private el: HTMLElement) {
    const on = <K2 extends keyof DocumentEventMap>(target: Document | Window | HTMLElement, type: K2, fn: (e: DocumentEventMap[K2]) => void, opts?: AddEventListenerOptions) => {
      target.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(document, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const bit = KEYMAP[e.code];
      if (bit) { this.keys |= bit; e.preventDefault(); }
      if (e.repeat) return;
      const digit = /^Digit([1-5])$/.exec(e.code);
      if (digit) this.pendingSlot = Number(digit[1]);
      if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); this.onAction?.('map'); }
      if (e.code === 'Escape') this.onAction?.('menu');
    });
    on(document, 'keyup', (e) => { const bit = KEYMAP[e.code]; if (bit) this.keys &= ~bit; });
    on(window, 'blur' as any, () => { this.keys = 0; this.mouse = 0; });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      // some browsers report a huge delta on the first locked frame
      const dx = Math.max(-300, Math.min(300, e.movementX)), dy = Math.max(-300, Math.min(300, e.movementY));
      const sens = this.sensitivity * this.zoom;
      this.yaw -= dx * sens;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * sens));
    });
    on(document, 'pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.el;
      if (!this.locked) { this.keys = 0; this.mouse = 0; }
      this.onLockChange?.(this.locked);
    });
    on(el, 'mousedown', (e) => {
      if (!this.locked) { this.lock(); return; }
      e.preventDefault();
      if (e.button === 0) this.keys |= K.FIRE;
      else if (e.button === 2) this.keys |= K.ADS;
      else if (e.button === 1) this.onAction?.('ping');
      this.mouse |= 1 << e.button;
    });
    on(document, 'mouseup', (e) => {
      if (e.button === 0) this.keys &= ~K.FIRE;
      else if (e.button === 2) this.keys &= ~K.ADS;
      this.mouse &= ~(1 << e.button);
    });
    on(el, 'contextmenu', (e) => e.preventDefault());
    on(el, 'wheel', (e) => { if (this.locked) { e.preventDefault(); this.wheel += Math.sign(e.deltaY); } }, { passive: false });
  }

  /** Take the slot change requested since last frame (absolute 1..5), resolving wheel scrolls from the current slot. */
  takeSlot(current: number, usable: (slot: number) => boolean): number {
    if (this.pendingSlot) { const s = this.pendingSlot; this.pendingSlot = 0; this.wheel = 0; return s; }
    if (!this.wheel) return 0;
    const dir = Math.sign(this.wheel);
    this.wheel = 0;
    for (let i = 1; i <= 5; i++) {
      const s = (((current + dir * i) % 5) + 5) % 5;
      if (usable(s)) return s + 1;
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
