import { K } from '@dropzone/shared';

const KEYMAP: Record<string, number> = {
  KeyW: K.F, ArrowUp: K.F, KeyS: K.B, ArrowDown: K.B, KeyA: K.L, ArrowLeft: K.L, KeyD: K.R, ArrowRight: K.R,
  Space: K.JUMP, ShiftLeft: K.SPRINT, ShiftRight: K.SPRINT, ControlLeft: K.CROUCH, KeyC: K.CROUCH,
};

/** Keyboard + mouse. Mouse look uses pointer lock; keys work either way. */
export class Input {
  keys = 0;
  yaw = 0;
  pitch = -0.15;
  sensitivity = 0.0023;
  locked = false;
  onAction?: (a: 'map' | 'menu' | 'ping') => void;
  private off: (() => void)[] = [];

  constructor(private el: HTMLElement) {
    const on = <K2 extends keyof DocumentEventMap>(target: Document | Window | HTMLElement, type: K2, fn: (e: DocumentEventMap[K2]) => void) => {
      target.addEventListener(type, fn as EventListener);
      this.off.push(() => target.removeEventListener(type, fn as EventListener));
    };
    on(document, 'keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const bit = KEYMAP[e.code];
      if (bit) { this.keys |= bit; e.preventDefault(); }
      if (e.repeat) return;
      if (e.code === 'KeyM' || e.code === 'Tab') { e.preventDefault(); this.onAction?.('map'); }
      if (e.code === 'Escape') this.onAction?.('menu');
    });
    on(document, 'keyup', (e) => { const bit = KEYMAP[e.code]; if (bit) this.keys &= ~bit; });
    on(window, 'blur' as any, () => { this.keys = 0; });
    on(document, 'mousemove', (e) => {
      if (!this.locked) return;
      // some browsers report a huge delta on the first locked frame
      const dx = Math.max(-300, Math.min(300, e.movementX)), dy = Math.max(-300, Math.min(300, e.movementY));
      this.yaw -= dx * this.sensitivity;
      this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * this.sensitivity));
    });
    on(document, 'pointerlockchange', () => { this.locked = document.pointerLockElement === this.el; if (!this.locked) this.keys = 0; this.onLockChange?.(this.locked); });
    on(el, 'mousedown', (e) => { if (!this.locked) this.lock(); else if (e.button === 1) { e.preventDefault(); this.onAction?.('ping'); } });
  }
  onLockChange?: (locked: boolean) => void;

  lock() {
    try {
      const p = this.el.requestPointerLock() as unknown as Promise<void> | undefined;
      p?.catch?.(() => {});
    } catch { /* browser refused (e.g. too soon after Esc) - the player can click again */ }
  }
  unlock() { if (document.pointerLockElement) document.exitPointerLock(); }
  dispose() { this.off.forEach((f) => f()); this.unlock(); }
}
