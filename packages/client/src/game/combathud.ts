import {
  AMMO_COLORS, AMMO_NAMES, ITEMS, PM, RARITIES, RARITY_COLOR, SIM_HZ, consumableDef, itemName, itemRarity, weaponDef,
  type GameResult, type PlayerState, type RosterEntry,
} from '@dropzone/shared';
import { h } from '../ui/dom';

/** Short labels for the hotbar tiles. */
const SHORT: Record<number, string> = {};
ITEMS.forEach((d, i) => {
  if (!d) return;
  SHORT[i] = d.kind === 'weapon' ? ({ pistol: 'PISTOL', smg: 'SMG', ar: 'AR', burst: 'BURST', shotgun: 'PUMP', autoshotgun: 'AUTO SG', dmr: 'DMR', sniper: 'SNIPER', rocket: 'ROCKET' } as const)[d.cls]
    : ({ 'Frag Grenade': 'FRAG', 'Bandage Roll': 'BANDAGE', 'Med Pack': 'MEDPACK', 'Shield Sip': 'SIP', 'Shield Jug': 'JUG', 'Fizz Can': 'FIZZ' } as Record<string, string>)[d.name] ?? d.name.toUpperCase();
});
const ICON: Record<string, string> = { pistol: '🔫', smg: '🔫', ar: '🔫', burst: '🔫', shotgun: '🔫', autoshotgun: '🔫', dmr: '🔭', sniper: '🔭', rocket: '🚀' };
const itemIcon = (id: number) => {
  const d = ITEMS[id];
  if (!d || d.kind === 'forage') return '';
  if (d.kind === 'weapon') return ICON[d.cls];
  if (d.kind === 'throwable') return '💣';
  if (d.kind === 'consumable') return d.shield && d.heal ? '🥤' : d.shield ? '🛡️' : '🩹';
  return '';
};

export interface CombatView {
  s: PlayerState;
  spread: number;          // radians
  fov: number;
  prompt: string | null;
  promptRarity: number;
  revive: number;          // 0..1
  reviveLabel: string;
  scoped: boolean;
  spectating: string | null;
  kills: number;
}

export class CombatHud {
  readonly el: HTMLElement;
  private hpFill = h('div.bar-fill.hp'); private hpText = h('b');
  private shFill = h('div.bar-fill.sh'); private shText = h('b');
  private slots: { tile: HTMLElement; name: HTMLElement; count: HTMLElement; icon: HTMLElement }[] = [];
  private ammoEl = h('div.ammo');
  private cross = h('div.xhair');
  private hit = h('div.hitmark');
  private prompt = h('div.prompt');
  private ring = h('div.progress');
  private ringLabel = h('span');
  private feed = h('div.feed');
  private center = h('div.elim-pop');
  private dirs = h('div.hurt-dirs');
  private knocked = h('div.knocked-ui', h('div.k-title', 'KNOCKED'), h('div.k-sub', 'Crawl to cover. A teammate can revive you.'), h('div.k-bar', h('span')));
  private vignette = h('div.vignette');
  private scope = h('div.scope');
  private nums = h('div.dmg-nums');
  private resultEl = h('div.result');
  private specEl = h('div.spectating');
  private killsEl = h('div.kills', h('span', '⦿'), h('b', '0'));
  private lastHp = 100;
  private hitTimer = 0;
  private resultShown = false;

  constructor(private roster: RosterEntry[], private selfIdx: number, private cb: { onLeave: () => void; onSpectate: () => void }) {
    const bars = h('div.vitals',
      h('div.bar.shield', this.shFill, h('div.bar-label', h('span', '🛡'), this.shText)),
      h('div.bar.health', this.hpFill, h('div.bar-label', h('span', '✚'), this.hpText)));
    const hotbar = h('div.hotbar');
    for (let i = 0; i < 5; i++) {
      const name = h('span.s-name'), count = h('span.s-count'), icon = h('span.s-icon');
      const tile = h('div.slot-tile', h('span.s-key', String(i + 1)), icon, name, count);
      this.slots.push({ tile, name, count, icon });
      hotbar.append(tile);
    }
    this.ring.append(this.ringLabel);
    this.el = h('div.combat',
      this.vignette, this.scope, this.dirs, this.nums,
      this.cross, this.hit, this.prompt, this.ring, this.center, this.knocked,
      h('div.bottom-left', bars), h('div.bottom-right', this.ammoEl, hotbar),
      this.feed, this.killsEl, this.specEl, this.resultEl);
  }

  // ------------------------------------------------------------ events
  hitMarker(head: boolean, knockout = false) {
    this.hit.className = 'hitmark show' + (head ? ' head' : '') + (knockout ? ' ko' : '');
    this.hitTimer = 0.18;
  }

  damageNumber(sx: number, sy: number, amount: number, shield: boolean, head: boolean) {
    const el = h('div.dnum', { class: (shield ? 'sh' : '') + (head ? ' hd' : '') }, String(Math.round(amount)));
    el.style.left = `${sx + (Math.random() - 0.5) * 30}px`; el.style.top = `${sy}px`;
    this.nums.append(el);
    setTimeout(() => el.remove(), 900);
  }

  hurtFrom(angle: number | null) {
    const el = h('div.hurt', { class: angle === null ? 'all' : '' });
    if (angle !== null) el.style.transform = `rotate(${angle}rad)`;
    this.dirs.append(el);
    setTimeout(() => el.remove(), 900);
  }

  feedLine(killer: number, victim: number, item: number, knock: boolean, cause: string) {
    const name = (i: number) => (i >= 0 ? this.roster[i]?.name ?? '?' : '');
    const mine = (i: number) => i === this.selfIdx;
    const team = this.roster[this.selfIdx].team;
    const ally = (i: number) => i >= 0 && this.roster[i].team === team;
    const how = cause === 'fall' ? 'fell too far' : cause === 'bleed' ? 'bled out' : cause === 'water' ? 'was lost at sea' : cause === 'left' ? 'left the match' : '';
    const weapon = item ? (ITEMS[item]?.name ?? '') : '';
    const line = h('div.feed-line', { class: (mine(killer) ? 'me ' : '') + (mine(victim) ? 'meDied ' : '') + (knock ? 'knock' : '') },
      killer >= 0 && killer !== victim && !how ? h('b', { class: ally(killer) ? 'ally' : '' }, name(killer)) : null,
      killer >= 0 && killer !== victim && !how ? h('span.verb', knock ? ` knocked ` : ` eliminated `) : null,
      h('b', { class: ally(victim) ? 'ally' : '' }, name(victim)),
      how ? h('span.verb', ` ${how}`) : null,
      weapon && !how ? h('span.wpn', ` · ${weapon}`) : null);
    this.feed.prepend(line);
    while (this.feed.children.length > 6) this.feed.lastElementChild!.remove();
    setTimeout(() => line.classList.add('fade'), 6000);
    setTimeout(() => line.remove(), 7000);
    if (mine(killer) && killer !== victim && !how) this.popCenter(knock ? 'KNOCKED' : 'ELIMINATED', name(victim), knock);
  }

  popCenter(title: string, sub: string, knock: boolean) {
    this.center.replaceChildren(h('div.e-title', { class: knock ? 'knock' : '' }, title), h('div.e-sub', sub));
    this.center.classList.remove('show'); void this.center.offsetWidth; this.center.classList.add('show');
  }

  showResult(r: GameResult) {
    this.resultShown = true;
    this.resultEl.replaceChildren(
      h('div.result-card', { class: r.win ? 'win' : '' },
        h('div.r-kicker', r.win ? 'VICTORY' : 'ELIMINATED'),
        h('div.r-place', h('span', '#'), String(r.place)),
        h('div.r-sub', r.win ? 'Last squad standing!' : r.killer ? `Taken out by ${r.killer}` : `out of ${r.teams} teams`),
        h('div.r-stats', h('div', h('b', String(r.kills)), h('small', 'ELIMINATIONS')), h('div', h('b', `${r.place}/${r.teams}`), h('small', 'PLACED'))),
        h('div.r-actions',
          !r.win ? h('button.btn.btn-ghost', { onclick: () => { this.resultEl.classList.remove('show'); this.cb.onSpectate(); } }, 'SPECTATE') : null,
          h('button.btn.btn-primary', { onclick: () => this.cb.onLeave() }, 'BACK TO LOBBY'))));
    this.resultEl.classList.add('show');
  }
  get resultOpen() { return this.resultEl.classList.contains('show'); }

  // ------------------------------------------------------------ per frame
  private frame = 0;
  update(v: CombatView, dt: number) {
    this.frame++;
    const s = v.s;
    const dead = s.mode === PM.Dead, knocked = s.mode === PM.Knocked;
    this.el.classList.toggle('dead', dead);
    this.el.classList.toggle('in-air', s.mode === PM.Bus || s.mode === PM.Fall || s.mode === PM.Glide);

    // vitals
    this.hpFill.style.width = `${s.hp}%`; this.hpText.textContent = String(s.hp);
    this.shFill.style.width = `${s.shield}%`; this.shText.textContent = String(s.shield);
    if (s.hp < this.lastHp && !knocked) this.vignette.classList.add('hit');
    else if (this.frame % 20 === 0) this.vignette.classList.remove('hit');
    this.vignette.classList.toggle('low', s.hp > 0 && s.hp <= 25);
    this.lastHp = s.hp;

    // knocked
    this.knocked.classList.toggle('show', knocked);
    if (knocked) (this.knocked.querySelector('.k-bar span') as HTMLElement).style.width = `${s.knock}%`;

    // hotbar
    if (this.frame % 3 === 0) this.slots.forEach((sl, i) => {
      const it = s.inv[i];
      const r = itemRarity(it.id, it.r);
      sl.tile.classList.toggle('sel', i === s.slot);
      sl.tile.classList.toggle('empty', !it.id);
      sl.tile.style.setProperty('--rc', it.id ? RARITY_COLOR[RARITIES[r]] : 'transparent');
      sl.name.textContent = it.id ? SHORT[it.id] : '';
      sl.icon.textContent = itemIcon(it.id);
      const w = weaponDef(it.id);
      sl.count.textContent = !it.id ? '' : w ? String(it.mag) : String(it.n);
    });

    // ammo readout for the held weapon
    const held = s.inv[s.slot], w = weaponDef(held.id);
    if (w) {
      this.ammoEl.replaceChildren(h('b', { class: held.mag === 0 ? 'empty' : '' }, String(held.mag)), h('span', ' / '), h('span.reserve', { style: { color: AMMO_COLORS[w.ammo] } }, String(s.ammo[w.ammo])), h('small', AMMO_NAMES[w.ammo]));
      this.ammoEl.style.display = '';
    } else this.ammoEl.style.display = 'none';

    // crosshair: four ticks pushed out by the current spread
    const px = Math.max(3, (Math.tan(v.spread) / Math.tan((v.fov * Math.PI) / 360)) * (innerHeight / 2));
    this.cross.style.setProperty('--gap', `${Math.min(80, px)}px`);
    this.cross.classList.toggle('hide', dead || knocked || !w || v.scoped || s.mode === PM.Drive || s.mode === PM.Bus || s.mode === PM.Fall || s.mode === PM.Glide);
    this.scope.classList.toggle('show', v.scoped);

    // hit marker fade
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.hit.classList.remove('show'); }

    // interact prompt
    this.prompt.classList.toggle('show', !!v.prompt);
    if (v.prompt && this.prompt.dataset.t !== v.prompt) {
      this.prompt.dataset.t = v.prompt;
      this.prompt.replaceChildren(h('kbd', 'E'), h('span', { style: { color: RARITY_COLOR[RARITIES[v.promptRarity]] } }, v.prompt));
    }

    // progress ring: reload, heal, revive
    let prog = 0, label = '';
    const cdef = consumableDef(held.id);
    if (s.reload > 0 && w) { const total = (w.perShell ?? w.reload) * SIM_HZ; prog = 1 - s.reload / total; label = 'RELOADING'; }
    else if (s.use > 0 && cdef) { prog = 1 - s.use / (cdef.use * SIM_HZ); label = cdef.name.toUpperCase(); }
    else if (v.revive > 0) { prog = v.revive; label = v.reviveLabel; }
    this.ring.classList.toggle('show', prog > 0);
    if (prog > 0) { this.ring.style.setProperty('--p', String(Math.min(1, prog))); this.ringLabel.textContent = label; }

    // spectating + kills
    this.specEl.classList.toggle('show', !!v.spectating && !this.resultOpen);
    if (v.spectating) this.specEl.textContent = `SPECTATING ${v.spectating}`;
    (this.killsEl.querySelector('b') as HTMLElement).textContent = String(v.kills);
    if (dead && !this.resultShown) { /* result message will arrive from the server */ }
  }

  /** Name for an item on the ground, for the pickup prompt. */
  static label(item: number, r: number, n: number) {
    const d = ITEMS[item];
    const base = itemName(item, r);
    return d && d.kind !== 'weapon' && n > 1 ? `${base} ×${n}` : base;
  }
}
