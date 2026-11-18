import { ITEM, ITEMS, RARITIES, RARITY_COLOR, itemName, itemRarity, merchantStock, weaponDef } from '@dropzone/shared';
import { h } from '../ui/dom';
import { itemIconSvg } from '../ui/icons';

/**
 * A pirate merchant's stall: what they sell, for how much gold, and a BUY button for each.
 * The server checks you're at the stall and can afford it; this just shows the stock.
 */
export class ShopPanel {
  readonly el: HTMLElement;
  open = false;
  merchant = -1;
  private list = h('div.shop-list');
  private goldEl = h('b');
  private sig = '';

  constructor(private onBuy: (merchant: number, offer: number) => void, private onClose: () => void) {
    this.el = h('div.shop-panel',
      h('div.shop-card',
        h('div.shop-head',
          h('div', h('b.shop-title', 'THE MERCHANT'), h('small', 'Gold buys gear. Find it in chests, supply drops and on the ground.')),
          h('div.shop-gold', h('span', { html: itemIconSvg(ITEM.gold) }), this.goldEl),
          h('button.inv-x', { onclick: () => this.onClose() }, '✕')),
        this.list,
        h('div.shop-foot', 'E, Tab or Esc to close')));
    this.el.addEventListener('click', () => (document.activeElement as HTMLElement | null)?.blur?.());
  }

  setOpen(open: boolean, merchant = this.merchant, gold = 0) {
    this.open = open;
    this.merchant = merchant;
    this.el.classList.toggle('open', open);
    if (open) { this.sig = ''; this.update(gold); }
  }

  update(gold: number) {
    if (!this.open) return;
    const sig = `${this.merchant}|${gold}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.goldEl.textContent = String(gold);
    const stock = merchantStock(this.merchant);
    this.list.replaceChildren(...stock.map((o, i) => {
      const r = itemRarity(o.item, o.r), col = RARITY_COLOR[RARITIES[r]];
      const w = weaponDef(o.item);
      const afford = gold >= o.price;
      return h('div.shop-offer', { style: { '--rc': col }, class: afford ? '' : 'poor' },
        h('span.so-icon', { html: itemIconSvg(o.item) }),
        h('div.so-name', h('small', { style: { color: col } }, w ? RARITIES[r].toUpperCase() : (ITEMS[o.item]?.kind ?? '').toUpperCase()),
          // (weapons: the rarity is on the line above, so just the gun's name)
          h('b', (w ? w.name : itemName(o.item, o.r)) + (o.n > 1 ? ` ×${o.n}` : '')),
          w ? h('small', `${Math.round(w.damage * [1, 1.05, 1.1, 1.15, 1.2][o.r])}${w.pellets > 1 ? ` ×${w.pellets}` : ''} damage · comes with ammo`) : null),
        h('button.btn.btn-primary.small.so-buy', { disabled: !afford, onclick: () => this.onBuy(this.merchant, i) },
          h('span', { html: itemIconSvg(ITEM.gold) }), String(o.price)));
    }));
  }
}
