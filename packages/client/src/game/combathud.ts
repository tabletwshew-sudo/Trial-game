import {
  AMMO_COLORS, AMMO_NAMES, BOOST_MAX, ITEM, ITEMS, K, PICK_SLOT, PM, RARITIES, RARITY_COLOR, SIM_HZ, consumableDef, itemName, itemRarity, weaponDef,
  type GameResult, type PlayerState, type RosterEntry,
} from '@dropzone/shared';
import { h } from '../ui/dom';
import { itemIconSvg } from '../ui/icons';
import { keyName, settings } from '../settings';
import { Reticle, hitMarkerSvg, shapeFor } from './reticle';

/** Short labels for the hotbar tiles. */
const SHORT: Record<number, string> = {};
ITEMS.forEach((d, i) => {
  if (!d) return;
  SHORT[i] = d.kind === 'weapon' ? ({ pistol: 'PISTOL', smg: 'SMG', ar: 'AR', burst: 'BURST', shotgun: 'PUMP', autoshotgun: 'AUTO SG', dmr: 'DMR', sniper: 'SNIPER', rocket: 'ROCKET' } as const)[d.cls]
    : ({ 'Frag Grenade': 'FRAG', 'Bandage Roll': 'BANDAGE', 'Med Pack': 'MEDPACK', 'Shield Sip': 'SIP', 'Shield Jug': 'JUG', 'Fizz Can': 'FIZZ' } as Record<string, string>)[d.name] ?? d.name.toUpperCase();
});
SHORT[ITEM.pickaxe] = 'PICKAXE';

const fmtDur = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export interface CombatView {
  s: PlayerState;
  spread: number;          // radians
  fov: number;
  prompt: string | null;
  promptRarity: number;
  /** Item the prompt is about (shows its icon), 0 for none. */
  promptItem?: number;
  revive: number;          // 0..1
  reviveLabel: string;
  scoped: boolean;
  spectating: string | null;
  /** Server clock (for the redeploy countdown). */
  serverNow: number;
  kills: number;
  /** Names of teammates whose recall cards you carry. */
  cards: string[];
}

export class CombatHud {
  readonly el: HTMLElement;
  private hpFill = h('div.bar-fill.hp'); private hpText = h('b');
  private shFill = h('div.bar-fill.sh'); private shText = h('b');
  private osFill = h('div.bar-fill.os'); private osText = h('b'); private osBar!: HTMLElement;
  private slots: { tile: HTMLElement; name: HTMLElement; count: HTMLElement; icon: HTMLElement; id: number }[] = [];
  private pickKey = h('span.s-key');
  private ammoEl = h('div.ammo');
  /** Car boost meter (while driving). */
  private boostFill = h('i'); private boostKey = h('kbd');
  private boostEl = h('div.boost', h('b', 'BOOST'), h('div.boost-bar', this.boostFill), this.boostKey);
  private reticle = new Reticle();
  private hit = h('div.hitmark', { html: hitMarkerSvg() });
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
  /** Gold carried (spend it at the merchants' stalls). */
  private goldEl = h('div.gold-count', h('span', { html: itemIconSvg(ITEM.gold) }), h('b', '0'));
  private bossEl = h('div.boss-bar', h('b'), h('div.boss-track', h('span')));
  private bossUntil = 0;
  private cardsEl = h('div.cards-ui');
  private structEl = h('div.struct-hp', h('span'));
  private structUntil = 0;
  private confetti: HTMLCanvasElement | null = null;
  private pickTile!: HTMLElement;
  private lastHp = 100;
  private hitTimer = 0;
  private resultShown = false;
  /** Shown the moment you go down for good (before your team's result, if they're still alive). */
  private deathEl = h('div.death-panel');
  private deathShown = false;
  private killedBy = '';
  /** Redeploy: when you're coming back (server time, 0 = not waiting), how many are left (-1 = teams). */
  private redeployAt = 0; private rdLeft = -1;
  private rdCount = h('b'); private rdNote = h('span');
  private rdEl = h('div.redeploy', h('small', 'REDEPLOYING IN'), this.rdCount, this.rdNote);
  private rdChip = h('div.rd-chip');
  /** You closed the result card to watch: a button brings it back. */
  private lastResult: GameResult | null = null;

  constructor(private roster: RosterEntry[], private selfIdx: number, private cb: { onLeave: (again?: boolean) => void; onSpectate: () => void; onSpecNext: (dir: number) => void }) {
    this.osBar = h('div.bar.over', this.osFill, h('div.bar-label', h('span', '⬢'), this.osText));
    const bars = h('div.vitals',
      this.rdChip,
      this.osBar,
      h('div.bar.shield', this.shFill, h('div.bar-label', h('span', '🛡'), this.shText)),
      h('div.bar.health', this.hpFill, h('div.bar-label', h('span', '✚'), this.hpText)));
    const hotbar = h('div.hotbar');
    // the pickaxe sits in its own tile in front of the five slots
    const pick = h('div.slot-tile.pick', this.pickKey, h('span.s-icon', { html: itemIconSvg(ITEM.pickaxe) }), h('span.s-name', 'PICKAXE'));
    this.pickTile = pick;
    hotbar.append(pick);
    for (let i = 0; i < 5; i++) {
      const name = h('span.s-name'), count = h('span.s-count'), icon = h('span.s-icon');
      const tile = h('div.slot-tile', h('span.s-key', String(i + 1)), icon, name, count);
      this.slots.push({ tile, name, count, icon, id: -1 });
      hotbar.append(tile);
    }
    this.ring.append(this.ringLabel);
    this.el = h('div.combat',
      this.vignette, this.scope, this.dirs, this.nums,
      this.reticle.el, this.hit, this.prompt, this.ring, this.center, this.knocked,
      h('div.bottom-left', bars), h('div.bottom-right', this.boostEl, this.ammoEl, hotbar),
      this.feed, this.killsEl, this.goldEl, this.specEl, this.bossEl, this.cardsEl, this.structEl, this.deathEl, this.rdEl, this.resultEl);
  }

  // ------------------------------------------------------------ events
  /** Redeploy status chip above the health bars ('2 REDEPLOYS', 'REDEPLOY ON', 'REDEPLOYS CLOSED'). */
  redeployChip(text: string, closed = false) { this.rdChip.textContent = text; this.rdChip.classList.toggle('closed', closed); }
  /** You were eliminated and come back at server time `at`. */
  redeploying(at: number, left: number) {
    this.redeployAt = at; this.rdLeft = left;
    if (left >= 0) this.redeployChip(`${left} REDEPLOY${left === 1 ? '' : 'S'} LEFT`);
  }
  redeployed() { this.redeployAt = 0; this.deathShown = false; }

  /** You fired: the reticle kicks out a little. */
  fired(amount = 1) { this.reticle.fired(amount); }

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
      weapon && !how ? h('span.wpn', { title: weapon, html: itemIconSvg(item) || ` · ${weapon}` }) : null);
    this.feed.prepend(line);
    while (this.feed.children.length > 6) this.feed.lastElementChild!.remove();
    setTimeout(() => line.classList.add('fade'), 6000);
    setTimeout(() => line.remove(), 7000);
    if (mine(killer) && killer !== victim && !how) this.popCenter(knock ? 'KNOCKED' : 'ELIMINATED', name(victim), knock);
    if (mine(victim) && !knock) this.killedBy = how ? how.replace(/^was /, '') : killer >= 0 && killer !== victim ? `by ${name(killer)}` : '';
  }

  /** Health left on the wall you're hitting (shown under the crosshair for a moment). */
  structureHp(hp: number) {
    (this.structEl.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(1, hp)) * 100}%`;
    this.structEl.classList.toggle('low', hp < 0.35);
    this.structEl.classList.add('show');
    this.structUntil = performance.now() + 1400;
  }

  boss(name: string, hp: number) {
    (this.bossEl.querySelector('b') as HTMLElement).textContent = name.toUpperCase();
    (this.bossEl.querySelector('.boss-track span') as HTMLElement).style.width = `${Math.max(0, Math.min(1, hp)) * 100}%`;
    this.bossEl.classList.add('show');
    this.bossUntil = performance.now() + (hp <= 0 ? 2500 : 1500);
  }

  popCenter(title: string, sub: string, knock: boolean) {
    this.center.replaceChildren(h('div.e-title', { class: knock ? 'knock' : '' }, title), h('div.e-sub', sub));
    this.center.classList.remove('show'); void this.center.offsetWidth; this.center.classList.add('show');
  }

  showResult(r: GameResult) {
    this.resultShown = true;
    this.lastResult = r;
    this.deathEl.classList.remove('show');
    const st = r.stats;
    const stat = (v: string | number, label: string) => h('div', h('b', String(v)), h('small', label));
    this.resultEl.replaceChildren(
      h('div.result-card', { class: r.win ? 'win' : '' },
        h('div.r-kicker', r.win ? 'VICTORY' : 'ELIMINATED'),
        h('div.r-place', h('span', '#'), String(r.place)),
        h('div.r-sub', r.win ? 'Last squad standing!' : r.killer ? `Taken out by ${r.killer}` : `out of ${r.teams} teams`),
        r.squad.length > 1 ? h('div.r-squad', ...r.squad.map((m) => h('div', { class: m.you ? 'you' : '' }, h('b', m.name), h('span', `${m.kills} elim${m.kills === 1 ? '' : 's'}`)))) : null,
        h('div.r-stats',
          stat(r.kills, 'ELIMINATIONS'), stat(st.damage, 'DAMAGE'), stat(fmtDur(st.survivedS), 'SURVIVED'),
          stat(st.taken, 'DAMAGE TAKEN'), stat(st.healed, 'HEALED'), stat(st.revives, 'REVIVES'),
          stat(st.chests, 'CHESTS'), stat(`${(st.distance / 1000).toFixed(1)} km`, 'TRAVELLED'), stat(`${r.place}/${r.teams}`, 'PLACED')),
        h('div.r-actions',
          !r.win ? h('button.btn.btn-ghost', { onclick: () => { this.resultEl.classList.remove('show'); this.cb.onSpectate(); } }, 'SPECTATE') : null,
          h('button.btn.btn-ghost', { onclick: () => this.cb.onLeave(false) }, 'LOBBY'),
          h('button.btn.btn-primary', { onclick: () => this.cb.onLeave(true) }, 'PLAY AGAIN'))));
    this.resultEl.classList.add('show');
    if (r.win) this.startConfetti();
  }

  /** A burst of confetti for the winners. */
  private startConfetti() {
    const cv = this.confetti ?? (this.confetti = h('canvas.confetti') as HTMLCanvasElement);
    this.resultEl.prepend(cv);
    cv.width = innerWidth; cv.height = innerHeight;
    const g = cv.getContext('2d')!;
    const cols = ['#ffd23f', '#3ee6ff', '#ff5fa2', '#4ade80', '#b388ff', '#ffffff'];
    const bits = Array.from({ length: 220 }, () => ({ x: Math.random() * cv.width, y: -Math.random() * cv.height, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[Math.floor(Math.random() * cols.length)], w: 6 + Math.random() * 6 }));
    const tick = () => {
      if (!cv.isConnected) return;
      g.clearRect(0, 0, cv.width, cv.height);
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx += (Math.random() - 0.5) * 0.1;
        if (b.y > cv.height + 20) { b.y = -20; b.x = Math.random() * cv.width; }
        g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.c; g.fillRect(-b.w / 2, -b.w / 4, b.w, b.w / 2); g.restore();
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
  get resultOpen() { return this.resultEl.classList.contains('show') || this.deathEl.classList.contains('show'); }

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
    // overshield: an extra 50 on top, shown as its own bar while you have any
    this.osFill.style.width = `${(s.os / 50) * 100}%`; this.osText.textContent = String(Math.round(s.os));
    this.osBar.classList.toggle('none', s.os <= 0.5);
    if (s.hp < this.lastHp && !knocked) this.vignette.classList.add('hit');
    else if (this.frame % 20 === 0) this.vignette.classList.remove('hit');
    this.vignette.classList.toggle('low', s.hp > 0 && s.hp <= 25);
    this.lastHp = s.hp;

    // knocked
    this.knocked.classList.toggle('show', knocked);
    if (knocked) (this.knocked.querySelector('.k-bar span') as HTMLElement).style.width = `${s.knock}%`;

    // hotbar
    if (this.frame % 3 === 0) {
      this.slots.forEach((sl, i) => {
        const it = s.inv[i];
        const r = itemRarity(it.id, it.r);
        sl.tile.classList.toggle('sel', i === s.slot);
        sl.tile.classList.toggle('empty', !it.id);
        sl.tile.style.setProperty('--rc', it.id ? RARITY_COLOR[RARITIES[r]] : 'transparent');
        sl.tile.dataset.r = it.id && weaponDef(it.id) ? RARITIES[r] : ''; // rarity name on weapons
        if (sl.id !== it.id) { sl.id = it.id; sl.name.textContent = it.id ? SHORT[it.id] : ''; sl.icon.innerHTML = itemIconSvg(it.id); }
        const w = weaponDef(it.id);
        sl.count.textContent = !it.id ? '' : w ? String(it.mag) : String(it.n);
      });
      this.pickTile.classList.toggle('sel', s.slot === PICK_SLOT);
      this.pickKey.textContent = keyName(settings.keys.pickaxe);
    }

    // ammo readout for the held weapon
    const held = s.inv[s.slot] ?? { id: 0, r: 0, n: 0, mag: 0 }, w = weaponDef(held.id);
    if (w) {
      this.ammoEl.replaceChildren(h('b', { class: held.mag === 0 ? 'empty' : '' }, String(held.mag)), h('span', ' / '), h('span.reserve', { style: { color: AMMO_COLORS[w.ammo] } }, String(s.ammo[w.ammo])), h('small', AMMO_NAMES[w.ammo]));
      this.ammoEl.style.display = '';
    } else this.ammoEl.style.display = 'none';

    // car boost meter
    const driving = s.mode === PM.Drive;
    this.boostEl.classList.toggle('show', driving);
    if (driving) {
      this.boostFill.style.width = `${(s.boost / BOOST_MAX) * 100}%`;
      this.boostEl.classList.toggle('empty', s.boost <= 0);
      this.boostEl.classList.toggle('on', (s.keys & K.SPRINT) !== 0 && (s.keys & K.F) !== 0 && s.boost > 0);
      if (this.frame % 30 === 1) this.boostKey.textContent = keyName(settings.keys.sprint);
    }

    // reticle: its shape follows what you're holding, its size the weapon's spread right now
    // (the spread cone's radius on screen, in CSS pixels, so it matches the 3D view)
    const px = (Math.tan(v.spread) / Math.tan((v.fov * Math.PI) / 360)) * (innerHeight / 2);
    const melee = s.slot === PICK_SLOT;
    this.reticle.update(dt, shapeFor(w?.cls ?? null, melee), w ? px : 0, settings.reticleColor,
      dead || knocked || v.scoped || s.mode === PM.Drive || s.mode === PM.Bus || s.mode === PM.Fall || s.mode === PM.Glide);
    this.scope.classList.toggle('show', v.scoped);

    // hit marker fade
    if (this.hitTimer > 0) { this.hitTimer -= dt; if (this.hitTimer <= 0) this.hit.classList.remove('show'); }

    // interact prompt
    this.prompt.classList.toggle('show', !!v.prompt);
    if (v.prompt && this.prompt.dataset.t !== v.prompt) {
      this.prompt.dataset.t = v.prompt;
      const icon = v.promptItem ? h('span.p-icon', { html: itemIconSvg(v.promptItem), style: { '--rc': RARITY_COLOR[RARITIES[v.promptRarity]] } }) : null;
      this.prompt.replaceChildren(...[h('kbd', 'E'), icon, h('span', { style: { color: RARITY_COLOR[RARITIES[v.promptRarity]] } }, v.prompt)].filter((x): x is HTMLElement => !!x));
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
    this.specEl.classList.toggle('show', !!v.spectating && !this.resultOpen && !this.deathEl.classList.contains('show'));
    if (v.spectating && this.specEl.dataset.n !== v.spectating + (this.lastResult ? '1' : '0')) {
      this.specEl.dataset.n = v.spectating + (this.lastResult ? '1' : '0');
      this.specEl.replaceChildren(
        h('button', { title: 'Previous player (←)', onclick: () => this.cb.onSpecNext(-1) }, '◀'),
        h('div', h('small', 'SPECTATING'), h('b', v.spectating)),
        h('button', { title: 'Next player (→)', onclick: () => this.cb.onSpecNext(1) }, '▶'),
        h('div.spec-actions',
          this.lastResult ? h('button.btn.btn-ghost.small', { onclick: () => { if (this.lastResult) this.showResult(this.lastResult); } }, 'RESULTS') : null,
          h('button.btn.btn-ghost.small', { onclick: () => this.cb.onLeave(false) }, 'LOBBY')));
    }
    // waiting to redeploy: a countdown instead of the death card
    const waiting = dead && this.redeployAt > v.serverNow;
    this.rdEl.classList.toggle('show', waiting && !this.resultOpen);
    if (waiting) {
      const secs = String(Math.max(1, Math.ceil((this.redeployAt - v.serverNow) / 1000)));
      if (this.rdCount.textContent !== secs) this.rdCount.textContent = secs;
      this.rdNote.textContent = this.rdLeft >= 0 ? `${this.rdLeft} redeploy${this.rdLeft === 1 ? '' : 's'} left after this one` : 'Your team is still in: you drop back in near them';
      this.deathShown = true; this.deathEl.classList.remove('show');
    }
    // went down for good with teammates still fighting: a death card with what to do next
    if (dead && !this.resultShown && !this.deathShown) {
      this.deathShown = true;
      this.deathEl.replaceChildren(
        h('div.d-title', 'ELIMINATED'),
        h('div.d-sub', this.killedBy || ' '),
        h('div.d-note', 'Your squad is still in the fight.'),
        h('div.d-actions',
          h('button.btn.btn-primary', { onclick: () => { this.deathEl.classList.remove('show'); this.cb.onSpectate(); } }, 'SPECTATE'),
          h('button.btn.btn-ghost', { onclick: () => this.cb.onLeave(false) }, 'LOBBY')));
      this.deathEl.classList.add('show');
    }
    if (!dead) { this.deathShown = false; this.deathEl.classList.remove('show'); }
    if (this.bossUntil && performance.now() > this.bossUntil) { this.bossEl.classList.remove('show'); this.bossUntil = 0; }
    if (this.structUntil && performance.now() > this.structUntil) { this.structEl.classList.remove('show'); this.structUntil = 0; }
    this.cardsEl.classList.toggle('show', v.cards.length > 0 && !dead);
    if (v.cards.length && this.cardsEl.dataset.n !== v.cards.join()) {
      this.cardsEl.dataset.n = v.cards.join();
      this.cardsEl.replaceChildren(h('span.card-ico'), h('div', h('b', `${v.cards.join(', ')}`), h('small', 'Take their recall card to a beacon (green ◆ on your map)')));
    }
    (this.killsEl.querySelector('b') as HTMLElement).textContent = String(v.kills);
    (this.goldEl.querySelector('b') as HTMLElement).textContent = String(s.gold);
    this.goldEl.classList.toggle('show', s.gold > 0 && !dead);
    if (dead && !this.resultShown) { /* result message will arrive from the server */ }
  }

  /** Name for an item on the ground, for the pickup prompt. */
  static label(item: number, r: number, n: number) {
    const d = ITEMS[item];
    const base = itemName(item, r);
    return d && d.kind !== 'weapon' && n > 1 ? `${base} ×${n}` : base;
  }
}
