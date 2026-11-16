import {
  AMMO_COLORS, AMMO_NAMES, ITEM, ITEMS, PICK_SLOT, RARITIES, RARITY_COLOR, SIM_HZ, consumableDef, itemName, itemRarity, meleeDef, throwableDef, weaponDef,
  type PlayerState,
} from '@dropzone/shared';
import { h } from '../ui/dom';
import { ammoIconSvg, itemIconSvg } from '../ui/icons';

/**
 * The inventory screen (Tab or I). Shows your five slots and the pickaxe, the stats of the
 * selected item, and your ammo. Drag a slot onto another to swap them (what you hold follows
 * the item), drop items or part of a stack, and drop ammo for teammates.
 */
export interface InventoryActions {
  swap(a: number, b: number): void;
  drop(slot: number, n?: number): void;
  dropAmmo(type: number, n: number): void;
  equip(slot: number): void;
}

const fmt = (n: number, d = 1) => (Math.round(n * 10 ** d) / 10 ** d).toString();

export class InventoryPanel {
  readonly el: HTMLElement;
  open = false;
  private slotsEl = h('div.inv-slots');
  private detailEl = h('div.inv-detail');
  private ammoEl = h('div.inv-ammo');
  private sel = 0;
  private sig = '';
  private dragFrom = -1;
  private last: PlayerState | null = null;

  constructor(private act: InventoryActions, private onClose: () => void) {
    this.el = h('div.inv-panel',
      h('div.inv-card',
        h('div.inv-head', h('b', 'INVENTORY'), h('span.inv-hint', 'Drag to rearrange · Q drops · Tab closes'), h('button.inv-x', { onclick: () => this.onClose() }, '✕')),
        this.slotsEl,
        h('div.inv-body', this.detailEl, h('div.inv-side', h('div.inv-sub', 'AMMO'), this.ammoEl))));
    // buttons must not keep focus: Tab / I / Esc go to the game's key handler to close the screen
    this.el.addEventListener('click', () => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  setOpen(open: boolean, s: PlayerState | null) {
    this.open = open;
    this.el.classList.toggle('open', open);
    if (open && s) { this.sel = s.slot; this.sig = ''; this.update(s); }
  }

  /** Keyboard while open: 1-5 / 6 selects, Q drops the selected item. */
  key(code: string) {
    if (!this.open) return false;
    const n = /^Digit([1-6])$/.exec(code);
    if (n) { this.sel = Number(n[1]) - 1; this.sig = ''; if (this.last) this.update(this.last); return true; }
    if (code === 'KeyQ' && this.sel < PICK_SLOT) { this.act.drop(this.sel); return true; }
    return false;
  }

  update(s: PlayerState) {
    this.last = s;
    if (!this.open) return;
    const sig = `${this.sel}|${s.slot}|${s.inv.map((x) => `${x.id}.${x.r}.${x.n}.${x.mag}`).join(',')}|${s.ammo.join(',')}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.renderSlots(s);
    this.renderDetail(s);
    this.renderAmmo(s);
  }

  private renderSlots(s: PlayerState) {
    const card = (i: number) => {
      const pick = i === PICK_SLOT;
      const it = pick ? { id: ITEM.pickaxe, r: 0, n: 1, mag: 0 } : s.inv[i];
      const r = itemRarity(it.id, it.r);
      const w = weaponDef(it.id);
      const el = h('div.inv-slot', {
        class: (it.id ? '' : 'empty ') + (i === this.sel ? 'sel ' : '') + (i === s.slot ? 'held ' : '') + (pick ? 'pick' : ''),
        style: { '--rc': it.id ? RARITY_COLOR[RARITIES[r]] : 'transparent' },
        draggable: !pick && !!it.id,
        onclick: () => { this.sel = i; this.sig = ''; this.update(s); },
        ondblclick: () => this.act.equip(i),
      },
      h('span.k', pick ? 'PICK' : String(i + 1)),
      h('span.i', { html: itemIconSvg(it.id) }),
      h('span.c', !it.id ? '' : pick ? '' : w ? String(it.mag) : `×${it.n}`));
      if (!pick) {
        el.addEventListener('dragstart', (e) => { this.dragFrom = i; e.dataTransfer?.setData('text/plain', String(i)); el.classList.add('dragging'); });
        el.addEventListener('dragend', () => { el.classList.remove('dragging'); this.dragFrom = -1; });
        el.addEventListener('dragover', (e) => { if (this.dragFrom >= 0 && this.dragFrom !== i) { e.preventDefault(); el.classList.add('over'); } });
        el.addEventListener('dragleave', () => el.classList.remove('over'));
        el.addEventListener('drop', (e) => {
          e.preventDefault(); el.classList.remove('over');
          if (this.dragFrom >= 0 && this.dragFrom !== i) { this.act.swap(this.dragFrom, i); if (this.sel === this.dragFrom) this.sel = i; }
          this.dragFrom = -1;
        });
      }
      return el;
    };
    this.slotsEl.replaceChildren(card(PICK_SLOT), h('div.inv-gap'), ...[0, 1, 2, 3, 4].map(card));
  }

  private renderDetail(s: PlayerState) {
    const pick = this.sel === PICK_SLOT;
    const it = pick ? { id: ITEM.pickaxe, r: 0, n: 1, mag: 0 } : s.inv[this.sel];
    if (!it?.id) { this.detailEl.replaceChildren(h('div.inv-empty', 'Empty slot', h('small', 'Pick things up with E. Drag items here to rearrange.'))); return; }
    const r = itemRarity(it.id, it.r), col = RARITY_COLOR[RARITIES[r]];
    const stat = (label: string, value: string, bar?: number) => h('div.inv-stat', h('span', label), bar !== undefined ? h('i', h('em', { style: { width: `${Math.max(4, Math.min(100, bar * 100))}%` } })) : null, h('b', value));
    const stats: HTMLElement[] = [];
    let blurb = '';
    const w = weaponDef(it.id), c = consumableDef(it.id), t = throwableDef(it.id), m = meleeDef(it.id);
    if (w) {
      const dmg = w.damage * [1, 1.05, 1.1, 1.15, 1.2][Math.min(4, it.r)];
      const rate = SIM_HZ / (w.burst > 1 ? w.interval / w.burst : w.interval);
      stats.push(
        stat('Damage', w.pellets > 1 ? `${fmt(dmg, 0)} ×${w.pellets}` : fmt(dmg, 0), (dmg * w.pellets) / 110),
        stat('Headshot', `×${w.headMul}`, (w.headMul - 1) / 1.6),
        stat('Fire rate', `${fmt(rate)}/s`, rate / 12),
        stat('Magazine', `${it.mag} / ${w.mag}`, w.mag / 30),
        stat('Reload', `${fmt(w.perShell ? w.perShell : w.reload)} s${w.perShell ? ' / shell' : ''}`, 1 - Math.min(1, (w.perShell ?? w.reload) / 4.6)),
        stat('Range', `${w.range} m`, w.range / 600),
        stat('Ammo', `${AMMO_NAMES[w.ammo]} (${s.ammo[w.ammo]})`));
      blurb = w.projectile ? 'Fires a rocket that explodes on impact.' : w.scope ? 'Aim to look down the scope.' : w.auto ? 'Hold to keep firing.' : 'Click for each shot.';
    } else if (c) {
      stats.push(
        c.heal ? stat('Heals', `+${c.heal} (up to ${c.healCap})`, c.heal / 100) : stat('Shields', `+${c.shield} (up to ${c.shieldCap})`, c.shield / 100),
        ...(c.heal && c.shield ? [stat('Shields', `+${c.shield} (up to ${c.shieldCap})`, c.shield / 100)] : []),
        stat('Use time', `${c.use} s`, 1 - c.use / 10),
        stat('Stack', `${it.n} / ${c.stack}`, it.n / c.stack));
      blurb = c.walk ? 'You can walk while using it.' : 'Stand still while using it.';
    } else if (t) {
      stats.push(stat('Blast', `${t.blast}`, t.blast / 110), stat('Radius', `${t.radius} m`, t.radius / 6), stat('Fuse', `${t.fuse} s`), stat('Stack', `${it.n} / ${t.stack}`, it.n / t.stack));
      blurb = 'Click to throw. Bounces, then explodes.';
    } else if (m) {
      stats.push(stat('Damage', `${m.damage}`, m.damage / 110), stat('Swings', `${fmt(SIM_HZ / m.interval)}/s`, (SIM_HZ / m.interval) / 3), stat('Reach', `${m.range} m`));
      blurb = 'Always with you. Swing at anyone who gets too close.';
    } else blurb = ITEMS[it.id]?.kind === 'keycard' ? 'Opens a vault door.' : '';
    const canDrop = !pick && it.id;
    const stack = !w && it.n > 1;
    this.detailEl.replaceChildren(
      h('div.inv-title', { style: { '--rc': col } },
        h('span.inv-big', { html: itemIconSvg(it.id) }),
        h('div', h('small', { style: { color: col } }, w ? RARITIES[r].toUpperCase() : (ITEMS[it.id]?.kind ?? '').toUpperCase()), h('b', itemName(it.id, it.r)))),
      h('div.inv-stats', ...stats),
      h('p.inv-blurb', blurb),
      h('div.inv-actions',
        this.sel !== s.slot ? h('button.btn.btn-ghost', { onclick: () => this.act.equip(this.sel) }, 'EQUIP') : h('span.inv-held', 'IN YOUR HANDS'),
        canDrop && stack ? h('button.btn.btn-ghost', { onclick: () => this.act.drop(this.sel, Math.ceil(it.n / 2)) }, 'DROP HALF') : null,
        canDrop ? h('button.btn.btn-danger', { onclick: () => this.act.drop(this.sel) }, stack ? 'DROP ALL' : 'DROP') : null));
  }

  private renderAmmo(s: PlayerState) {
    const uses = (a: number) => s.inv.some((x) => weaponDef(x.id)?.ammo === a);
    this.ammoEl.replaceChildren(...[0, 1, 2, 3, 4].map((a) => h('div.inv-ammo-row', { class: (s.ammo[a] ? '' : 'none ') + (uses(a) ? 'used' : ''), style: { '--rc': AMMO_COLORS[a] } },
      h('span.ai', { html: ammoIconSvg(a) }),
      h('div', h('b', String(s.ammo[a])), h('small', AMMO_NAMES[a])),
      s.ammo[a] > 0 ? h('button.btn.btn-ghost.small', { title: 'Drop some', onclick: () => this.act.dropAmmo(a, Math.min(s.ammo[a], a === 4 ? 1 : 10)) }, a === 4 ? '−1' : '−10') : null,
      s.ammo[a] > 0 ? h('button.btn.btn-ghost.small', { title: 'Drop half', onclick: () => this.act.dropAmmo(a, Math.ceil(s.ammo[a] / 2)) }, '½') : null)));
  }
}
