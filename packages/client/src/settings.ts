import { RARITIES, RARITY_COLOR } from '@dropzone/shared';
import { h } from './ui/dom';

/**
 * Player settings, saved in this browser. Changes apply immediately where they can
 * (sensitivity, FOV, keys, FPS counter, colours) and graphics apply from the next match.
 */
export type Action = 'forward' | 'back' | 'left' | 'right' | 'jump' | 'sprint' | 'crouch' | 'reload' | 'interact' | 'map' | 'inventory' | 'emote' | 'slot1' | 'slot2' | 'slot3' | 'slot4' | 'slot5' | 'pickaxe' | 'fire' | 'aim' | 'ping';
export const ACTION_LABELS: Record<Action, string> = {
  fire: 'Fire / swing', aim: 'Aim / scope', forward: 'Move forward', back: 'Move back', left: 'Move left', right: 'Move right', jump: 'Jump / glider', sprint: 'Sprint', crouch: 'Crouch / slide',
  reload: 'Reload', interact: 'Interact / pick up', map: 'Map', inventory: 'Inventory', emote: 'Emote', slot1: 'Slot 1', slot2: 'Slot 2', slot3: 'Slot 3', slot4: 'Slot 4', slot5: 'Slot 5', pickaxe: 'Pickaxe', ping: 'Mark a spot',
};
export const DEFAULT_KEYS: Record<Action, string> = {
  fire: 'Mouse0', aim: 'Mouse2', ping: 'Mouse1', forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD', jump: 'Space', sprint: 'ShiftLeft', crouch: 'KeyC',
  reload: 'KeyR', interact: 'KeyE', map: 'KeyM', inventory: 'KeyI', emote: 'KeyB', slot1: 'Digit1', slot2: 'Digit2', slot3: 'Digit3', slot4: 'Digit4', slot5: 'Digit5', pickaxe: 'KeyF',
};
export type ColorMode = 'normal' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export type Graphics = 'auto' | 'low' | 'medium' | 'high';

export interface Settings {
  sensitivity: number;   // 0.2 .. 3 (1 = default)
  adsMul: number;        // multiplier while aiming down sights
  scopeMul: number;      // multiplier while scoped
  invertY: boolean;
  fov: number;           // 60 .. 100
  graphics: Graphics;
  /** Bumped when the graphics default changes, so old saved defaults move to the new one. */
  graphicsV?: number;
  showFps: boolean;
  autoSprint: boolean;   // sprint by default (Shift walks)
  toggleAds: boolean;
  /** Toggle aim only for scoped weapons (DMR, sniper). */
  toggleScope: boolean;
  colorMode: ColorMode;
  /** Reticle colour (CSS colour). */
  reticleColor: string;
  /** Show where sounds come from (footsteps, gunfire, chests...) as markers on screen. */
  visualSound: boolean;
  master: number; effects: number; music: number; // 0..1
  hudScale: number;      // 0.6 .. 1.2: size of the in-game HUD
  keys: Record<Action, string>;
}

const DEFAULTS: Settings = {
  sensitivity: 1, adsMul: 0.7, scopeMul: 0.55, invertY: false, fov: 75, graphics: 'auto', graphicsV: 2, showFps: false,
  autoSprint: false, toggleAds: false, toggleScope: false, colorMode: 'normal', reticleColor: '#ffffff', visualSound: true, master: 0.8, effects: 0.9, music: 0.6, hudScale: 0.8, keys: { ...DEFAULT_KEYS },
};

const KEY = 'dz.settings';
function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw === 'object') {
      const s: Settings = { ...DEFAULTS, ...raw, keys: { ...DEFAULT_KEYS, ...(raw.keys ?? {}) } };
      // "high" used to be the default and was too heavy for most laptops: move it to auto once
      if ((raw.graphicsV ?? 1) < 2) { if (s.graphics === 'high') s.graphics = 'auto'; s.graphicsV = 2; }
      return s;
    }
  } catch { /* storage blocked or bad data: use defaults */ }
  return { ...DEFAULTS, keys: { ...DEFAULT_KEYS } };
}

export const settings: Settings = load();
const listeners = new Set<() => void>();
export function onSettings(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* not saved, still applied */ }
  listeners.forEach((f) => f());
  applyColorMode();
}

// ------------------------------------------------------------------ colour-blind friendly palettes
const PALETTES: Record<ColorMode, string[]> = {
  normal: RARITIES.map((r) => RARITY_COLOR[r]),
  deuteranopia: ['#9d9d9d', '#3aa0ff', '#0057e7', '#d14fff', '#ffb000'],
  protanopia: ['#9d9d9d', '#49c6e5', '#1f6fe5', '#c779ff', '#ffd000'],
  tritanopia: ['#9d9d9d', '#2ec4b6', '#ff5d8f', '#9b5de5', '#ff9f1c'],
};
export const rarityColor = (r: number) => PALETTES[settings.colorMode][Math.max(0, Math.min(4, r))];
export const teamColors = () => (settings.colorMode === 'normal' ? ['#ffd23f', '#3ee6ff', '#ff5fa2', '#4ade80'] : ['#ffd23f', '#3ee6ff', '#ffffff', '#ff9f1c']);
function applyColorMode() {
  RARITIES.forEach((r, i) => document.documentElement.style.setProperty(`--rarity-${i}`, rarityColor(i)));
  document.documentElement.style.setProperty('--hud', String(Math.max(0.6, Math.min(1.2, settings.hudScale || 0.8))));
}
applyColorMode();

export const keyName = (code: string) => ({ Mouse0: 'L-Click', Mouse1: 'M-Click', Mouse2: 'R-Click', Mouse3: 'Mouse 4', Mouse4: 'Mouse 5' } as Record<string, string>)[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift').replace('ControlLeft', 'L-Ctrl').replace('Space', 'Space').replace(/^Arrow/, '↑').replace('AltLeft', 'L-Alt');

// ------------------------------------------------------------------ the panel
export function settingsPanel(onClose: () => void): HTMLElement {
  let tab: 'controls' | 'video' | 'audio' | 'keys' = 'controls';
  const body = h('div.set-body');
  const root = h('div.settings-overlay', h('div.settings-card',
    h('div.set-head', h('b', 'SETTINGS'), h('button.mini.x', { onclick: onClose }, '✕')),
    h('div.set-tabs', ...(['controls', 'video', 'audio', 'keys'] as const).map((t) => h('button', { 'data-t': t, onclick: () => { tab = t; render(); } }, t.toUpperCase()))),
    body,
    h('div.set-foot', h('button.btn.btn-ghost', { onclick: () => { Object.assign(settings, { ...DEFAULTS, keys: { ...DEFAULT_KEYS } }); saveSettings(); render(); } }, 'RESET'), h('button.btn.btn-primary', { onclick: onClose }, 'DONE'))));
  root.addEventListener('mousedown', (e) => { if (e.target === root) onClose(); });

  const slider = (label: string, key: keyof Settings, min: number, max: number, step: number, fmt: (v: number) => string) => {
    const val = h('span.set-val', fmt(settings[key] as number));
    const input = h('input', { type: 'range', min, max, step, value: settings[key] }) as HTMLInputElement;
    input.oninput = () => { (settings as any)[key] = Number(input.value); val.textContent = fmt(Number(input.value)); saveSettings(); };
    return h('label.set-row', h('span', label), input, val);
  };
  const toggle = (label: string, key: keyof Settings, hint?: string) => {
    const input = h('input', { type: 'checkbox', checked: settings[key] }) as HTMLInputElement;
    input.onchange = () => { (settings as any)[key] = input.checked; saveSettings(); };
    return h('label.set-row.check', h('span', label, hint ? h('small', hint) : null), input);
  };
  const choice = <T extends string>(label: string, key: keyof Settings, opts: [T, string][], hint?: string) =>
    h('div.set-row', h('span', label, hint ? h('small', hint) : null), h('div.set-choice', ...opts.map(([v, l]) => h('button', { class: settings[key] === v ? 'on' : '', onclick: () => { (settings as any)[key] = v; saveSettings(); render(); } }, l))));

  function render() {
    root.querySelectorAll('.set-tabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.t === tab));
    if (tab === 'controls') body.replaceChildren(
      slider('Mouse sensitivity', 'sensitivity', 0.2, 3, 0.05, (v) => v.toFixed(2)),
      slider('Aim (ADS) sensitivity', 'adsMul', 0.2, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
      slider('Scope sensitivity', 'scopeMul', 0.2, 1.5, 0.05, (v) => `${Math.round(v * 100)}%`),
      toggle('Invert mouse Y', 'invertY'),
      toggle('Sprint by default', 'autoSprint', 'Hold Sprint to walk instead'),
      toggle('Toggle aim', 'toggleAds', 'Press aim once to aim, again to stop (all weapons)'),
      toggle('Toggle scope', 'toggleScope', 'Same, but only for scoped weapons (DMR, sniper)'),
    );
    if (tab === 'video') body.replaceChildren(
      slider('Field of view', 'fov', 60, 100, 1, (v) => `${v}°`),
      slider('HUD size', 'hudScale', 0.6, 1.2, 0.05, (v) => `${Math.round(v * 100)}%`),
      choice('Graphics', 'graphics', [['auto', 'AUTO'], ['low', 'LOW'], ['medium', 'MEDIUM'], ['high', 'HIGH']], 'Auto picks for your computer; applies next match'),
      toggle('Show FPS', 'showFps'),
      choice('Colour-blind mode', 'colorMode', [['normal', 'OFF'], ['deuteranopia', 'DEUTER.'], ['protanopia', 'PROTAN.'], ['tritanopia', 'TRITAN.']], 'Changes rarity and team colours'),
      h('div.swatches', ...[0, 1, 2, 3, 4].map((r) => h('span', { style: { background: rarityColor(r) } }, ['C', 'U', 'R', 'E', 'L'][r]))),
      choice('Reticle colour', 'reticleColor', [['#ffffff', 'WHITE'], ['#ffe14d', 'YELLOW'], ['#5dff7a', 'GREEN'], ['#4df3ff', 'CYAN'], ['#ff6bd6', 'PINK']]),
    );
    if (tab === 'audio') body.replaceChildren(
      slider('Master volume', 'master', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      slider('Effects', 'effects', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      slider('Music', 'music', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`),
      toggle('Visualize sound effects', 'visualSound', 'Markers around the middle of the screen show where footsteps, gunshots, chests and cars are'),
    );
    if (tab === 'keys') {
      const rows = (Object.keys(ACTION_LABELS) as Action[]).map((a) => {
        const btn = h('button.keycap', keyName(settings.keys[a]));
        btn.onclick = (ev) => {
          ev.stopPropagation();
          btn.textContent = 'press a key or button…'; btn.classList.add('listening');
          const bind = (code: string | null) => {
            if (code) {
              // swap with whatever already used that key so nothing ends up unbound
              const clash = (Object.keys(settings.keys) as Action[]).find((k) => settings.keys[k] === code && k !== a);
              if (clash) settings.keys[clash] = settings.keys[a];
              settings.keys[a] = code;
              saveSettings();
            }
            removeEventListener('keydown', grabKey, true); removeEventListener('mousedown', grabMouse, true); removeEventListener('contextmenu', noMenu, true);
            render();
          };
          const grabKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopPropagation(); bind(e.code === 'Escape' ? null : e.code); };
          // any mouse button works too (left, right, middle, side buttons)
          const grabMouse = (e: MouseEvent) => { e.preventDefault(); e.stopPropagation(); bind(`Mouse${e.button}`); };
          const noMenu = (e: Event) => e.preventDefault();
          addEventListener('keydown', grabKey, true);
          setTimeout(() => { addEventListener('mousedown', grabMouse, true); addEventListener('contextmenu', noMenu, true); }, 0);
        };
        return h('div.set-row', h('span', ACTION_LABELS[a]), btn);
      });
      body.replaceChildren(h('div.keys-grid', ...rows), h('div.set-note', 'Click a binding, then press a key or a mouse button. Mouse wheel switches slots. Esc opens the menu.'));
    }
  }
  render();
  return root;
}
