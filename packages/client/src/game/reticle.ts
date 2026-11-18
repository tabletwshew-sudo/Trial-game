/**
 * The aiming reticle: an SVG drawn at the middle of the screen whose shape depends on what's
 * in your hands, and whose size is the weapon's real spread right now (moving, jumping, firing
 * and crouching all change it), so you can see where your shots can land.
 *
 *   rifle    pistol / SMG / AR / burst / DMR: four ticks around a dot
 *   shotgun  a circle the size of the pellet cone, with four notches
 *   sniper   four long ticks and a small ring (hip fire; scoping in shows the scope instead)
 *   launcher two brackets either side of the dot
 *   melee    a small ring (the pickaxe)
 *   dot      heals, grenades, empty hands
 */
export type ReticleShape = 'rifle' | 'shotgun' | 'sniper' | 'launcher' | 'melee' | 'dot';

const NS = 'http://www.w3.org/2000/svg';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};

export function shapeFor(cls: string | null, melee: boolean): ReticleShape {
  if (melee) return 'melee';
  switch (cls) {
    case 'shotgun': case 'autoshotgun': return 'shotgun';
    case 'sniper': return 'sniper';
    case 'rocket': return 'launcher';
    case 'pistol': case 'smg': case 'ar': case 'burst': case 'dmr': return 'rifle';
    default: return 'dot';
  }
}

export class Reticle {
  readonly el: SVGSVGElement;
  private dot = svg('circle', { r: 1.7 });
  private ticks = [0, 1, 2, 3].map(() => svg('rect', { rx: 0.6 }));
  private ring = svg('circle', { fill: 'none', 'stroke-width': 1.6 });
  private notches = [0, 1, 2, 3].map(() => svg('rect', { rx: 0.5 }));
  private brackets = [svg('path', { fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' }), svg('path', { fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' })];
  private shape: ReticleShape | null = null;
  private gap = 8;
  /** A short kick each time you fire, on top of the spread. */
  private kick = 0;
  private colour = '';

  constructor() {
    this.el = svg('svg', { class: 'reticle', viewBox: '-150 -150 300 300', width: 300, height: 300 }) as SVGSVGElement;
    this.el.append(this.ring, ...this.notches, ...this.brackets, ...this.ticks, this.dot);
  }

  /** You fired: the reticle jumps out a little and settles back. */
  fired(amount = 1) { this.kick = Math.min(14, this.kick + 5 * amount); }

  /**
   * `spreadPx`: the spread cone's radius on screen, in pixels. `hidden`: scoped, in a car,
   * dropping, knocked, dead...
   */
  update(dt: number, shape: ReticleShape, spreadPx: number, colour: string, hidden: boolean) {
    this.el.classList.toggle('hide', hidden);
    if (hidden) return;
    if (colour !== this.colour) { this.colour = colour; this.el.style.setProperty('--rc', colour); }
    this.kick = Math.max(0, this.kick - dt * 60);
    const min = shape === 'shotgun' ? 14 : shape === 'launcher' ? 16 : shape === 'sniper' ? 10 : 5;
    const target = Math.min(120, Math.max(min, spreadPx) + this.kick);
    // ease toward the target (fast enough to feel instant, slow enough not to flicker)
    this.gap += (target - this.gap) * Math.min(1, dt * 22);
    if (shape !== this.shape) { this.shape = shape; this.gap = target; this.el.dataset.shape = shape; }
    const g = this.gap;

    const showTicks = shape === 'rifle' || shape === 'sniper';
    const len = shape === 'sniper' ? 11 : 7, wid = 2;
    this.ticks.forEach((t, i) => {
      t.style.display = showTicks ? '' : 'none';
      if (!showTicks) return;
      // up, right, down, left
      const [x, y, w, hgt] = i === 0 ? [-wid / 2, -g - len, wid, len] : i === 1 ? [g, -wid / 2, len, wid] : i === 2 ? [-wid / 2, g, wid, len] : [-g - len, -wid / 2, len, wid];
      t.setAttribute('x', x.toFixed(2)); t.setAttribute('y', y.toFixed(2)); t.setAttribute('width', String(w)); t.setAttribute('height', String(hgt));
    });

    const ringR = shape === 'shotgun' ? g : shape === 'melee' ? 6 : shape === 'sniper' ? 4 : 0;
    this.ring.style.display = ringR ? '' : 'none';
    if (ringR) this.ring.setAttribute('r', ringR.toFixed(2));

    // shotgun: four notches pointing in at the edge of the cone
    this.notches.forEach((n, i) => {
      n.style.display = shape === 'shotgun' ? '' : 'none';
      if (shape !== 'shotgun') return;
      const l = 5, w2 = 1.8;
      const [x, y, w, hgt] = i === 0 ? [-w2 / 2, -g - 1, w2, l] : i === 1 ? [g + 1 - l, -w2 / 2, l, w2] : i === 2 ? [-w2 / 2, g + 1 - l, w2, l] : [-g - 1, -w2 / 2, l, w2];
      n.setAttribute('x', x.toFixed(2)); n.setAttribute('y', y.toFixed(2)); n.setAttribute('width', String(w)); n.setAttribute('height', String(hgt));
    });

    // launcher: two brackets either side
    const showLauncher = shape === 'launcher';
    for (const [i, b] of this.brackets.entries()) {
      b.style.display = showLauncher ? '' : 'none';
      if (!showLauncher) continue;
      const s = i === 0 ? -1 : 1, a = 0.75; // half the arc, radians
      const x0 = s * g * Math.cos(a), y0 = -g * Math.sin(a), x1 = s * g * Math.cos(a), y1 = g * Math.sin(a);
      b.setAttribute('d', `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${g.toFixed(2)} ${g.toFixed(2)} 0 0 ${s > 0 ? 1 : 0} ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    }

    this.dot.setAttribute('r', shape === 'dot' ? '2.2' : shape === 'shotgun' ? '1.5' : '1.7');
  }
}

/** Hit marker: four short diagonal strokes around the reticle that pop out and fade. */
export function hitMarkerSvg() {
  const lines = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => `<line x1="${x * 7}" y1="${y * 7}" x2="${x * 15}" y2="${y * 15}"/>`).join('');
  return `<svg viewBox="-20 -20 40 40" width="40" height="40">${lines}</svg>`;
}
