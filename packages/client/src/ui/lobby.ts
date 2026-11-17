import {
  SKIN_COUNT, TEAM_SIZE, matchCapacity, type FriendView, type MatchFoundView, type Mode, type PartyView,
  type QueueView, type ServerMsg, type UserView,
} from '@dropzone/shared';
import type { Net } from '../net';
import { audio } from '../audio';
import { LobbyScene } from '../lobby/scene';
import { SKINS } from '../lobby/character';
import { fmtTime, h, toast } from './dom';
import { settingsPanel } from '../settings';

const MODE_LABEL: Record<Mode, string> = { solo: 'SOLO', duo: 'DUOS', trio: 'TRIOS', squad: 'SQUADS' };
const PRESENCE_LABEL = { lobby: 'In Lobby', queue: 'Matchmaking', in_match: 'In Match', offline: 'Offline' } as const;

export function lobbyScreen(net: Net, you: UserView, onSignOut: () => void, onMatch: (m: MatchFoundView) => void, playAgain = false) {
  let party: PartyView | null = null;
  let queue: QueueView = { state: 'idle' };
  let friends: FriendView[] = [];
  let incoming: UserView[] = [];
  let outgoing: UserView[] = [];
  let tab: 'play' | 'locker' = 'play';
  let friendsOpen = false;

  const root = h('div.screen.lobby');
  const stage = h('div.stage');
  const tags = h('div.tags');
  const ui = h('div.ui');
  root.append(stage, tags, ui);
  const scene = new LobbyScene(stage);
  const status = h('div.conn');

  const isLeader = () => party?.leaderId === you.id;
  const me = () => party?.members.find((m) => m.id === you.id);

  // ---------------------------------------------------------- name tags
  const tagEls = new Map<string, HTMLElement>();
  scene.onFrame = () => {
    for (const [id, el] of tagEls) {
      const p = scene.tagPosition(id);
      if (!p || !p.visible || tab === 'locker') { el.style.opacity = '0'; continue; }
      el.style.opacity = '1';
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const timer = document.querySelector<HTMLElement>('.queue-timer');
    if (timer && queue.state === 'searching' && queue.since) timer.textContent = fmtTime((Date.now() + net.serverOffset - queue.since) / 1000);
  };

  function renderTags() {
    tags.replaceChildren();
    tagEls.clear();
    for (const m of party?.members ?? []) {
      const el = h('div.nametag', { class: m.ready || m.id === party!.leaderId ? 'ready' : '' },
        m.id === party!.leaderId ? h('span.crown', '★') : null,
        h('span.n', m.name),
        h('span.state', m.id === party!.leaderId ? 'LEADER' : m.ready ? 'READY' : 'NOT READY'),
      );
      tagEls.set(m.id, el);
      tags.append(el);
    }
  }

  // ---------------------------------------------------------- top bar
  const topbar = () => h('div.topbar',
    h('div.logo', h('span', 'DROP'), h('span.accent', 'ZONE')),
    h('nav.tabs',
      h('button', { class: tab === 'play' ? 'on' : '', onclick: () => setTab('play') }, 'PLAY'),
      h('button', { class: tab === 'locker' ? 'on' : '', onclick: () => setTab('locker') }, 'LOCKER'),
      h('button', { onclick: () => { if (!document.querySelector('.settings-overlay')) root.append(settingsPanel(() => document.querySelector('.settings-overlay')?.remove())); } }, 'SETTINGS'),
    ),
    h('div.spacer'),
    status,
    h('button.chip.friends-btn', { onclick: () => { friendsOpen = !friendsOpen; render(); } },
      h('span.icon', '👥'), `${friends.filter((f) => f.presence !== 'offline').length}/${friends.length}`,
      incoming.length ? h('span.badge', incoming.length) : null),
    h('div.chip.me', h('span.avatar', { style: { background: SKINS[me()?.skin ?? 0].hoodie } }), you.name, you.guest ? h('span.guest', 'GUEST') : null),
    h('button.chip.signout', { title: 'Sign out', onclick: onSignOut }, 'Sign out'),
  );

  // ---------------------------------------------------------- play panel
  function playPanel() {
    if (!party) return h('div');
    const searching = queue.state === 'searching';
    const leader = isLeader();
    const modes = (Object.keys(TEAM_SIZE) as Mode[]).map((m) => {
      const tooSmall = TEAM_SIZE[m] < party!.members.length;
      return h('button.mode', {
        class: (party!.mode === m ? 'on' : '') + (tooSmall ? ' disabled' : ''),
        disabled: !leader || searching || tooSmall,
        onclick: () => net.send({ t: 'party_set', mode: m }),
      }, h('b', MODE_LABEL[m]), h('small', `${matchCapacity(m)} players`));
    });
    const fill = h('label.toggle', { class: (party.fill ? 'on' : '') + (!leader || searching || party.mode === 'solo' ? ' disabled' : '') },
      h('input', { type: 'checkbox', checked: party.fill, disabled: !leader || searching || party.mode === 'solo', onchange: (e: Event) => net.send({ t: 'party_set', fill: (e.target as HTMLInputElement).checked }) }),
      h('span.track', h('span.knob')),
      h('span', party.mode === 'solo' ? 'FILL —' : party.fill ? 'FILL' : 'NO FILL'),
    );

    let action: HTMLElement;
    if (searching) {
      action = h('button.btn.btn-play.searching', { onclick: () => net.send({ t: 'queue_cancel' }) },
        h('span.big', 'MATCHMAKING'),
        h('span.sub', h('span.queue-timer', '0:00'), ' · ', `${queue.playersInQueue ?? 1} in queue`, queue.etaS ? ` · bots in ${queue.etaS}s` : ' · starting…'),
        h('span.cancel', 'CANCEL'));
    } else if (leader) {
      const waiting = party.members.filter((m) => m.id !== party!.leaderId && !m.ready);
      action = h('button.btn.btn-play', { onclick: () => net.send({ t: 'queue_start' }) },
        h('span.big', 'PLAY'),
        h('span.sub', waiting.length ? `Waiting on ${waiting.length} to ready up` : `${MODE_LABEL[party.mode]} · ${party.fill ? 'Fill' : 'No Fill'}`));
    } else {
      const ready = !!me()?.ready;
      action = h('button.btn.btn-play', { class: ready ? 'is-ready' : '', onclick: () => { if (!ready) audio.ui('ready'); net.send({ t: 'ready', ready: !ready }); } },
        h('span.big', ready ? 'READY ✓' : 'READY UP'),
        h('span.sub', ready ? 'Waiting for the leader' : 'Let your leader know'));
    }

    return h('div.play-panel',
      h('div.panel-title', 'GAME MODE', !leader ? h('span.hint', 'Leader picks') : null),
      h('div.modes', ...modes),
      fill,
      action,
    );
  }

  function partyPanel() {
    if (!party) return h('div');
    const slots = Array.from({ length: 4 }, (_, i) => {
      const m = party!.members[i];
      if (!m) return h('button.slot.empty', { onclick: () => { friendsOpen = true; render(); } }, h('span.plus', '+'), 'Invite');
      const leaderHere = m.id === party!.leaderId;
      return h('div.slot', { class: m.id === you.id ? 'you' : '' },
        h('span.avatar', { style: { background: SKINS[m.skin].hoodie } }),
        h('span.n', m.name, leaderHere ? h('span.crown', ' ★') : null),
        h('span.dot', { class: leaderHere || m.ready ? 'ok' : '' }),
        isLeader() && m.id !== you.id ? h('span.slot-actions',
          h('button', { title: 'Make leader', onclick: () => net.send({ t: 'party_promote', userId: m.id }) }, '★'),
          h('button', { title: 'Kick', onclick: () => net.send({ t: 'party_kick', userId: m.id }) }, '✕')) : null,
      );
    });
    return h('div.party-panel',
      h('div.panel-title', `PARTY ${party.members.length}/4`),
      ...slots,
      party.members.length > 1 ? h('button.link.leave', { onclick: () => net.send({ t: 'party_leave' }) }, 'Leave party') : null,
    );
  }

  // ---------------------------------------------------------- friends
  function friendsPanel() {
    const input = h('input', { placeholder: 'Add by username', maxLength: 16, spellcheck: false }) as HTMLInputElement;
    const add = () => { if (input.value.trim()) net.send({ t: 'friend_request', name: input.value.trim() }); input.value = ''; };
    input.onkeydown = (e) => e.key === 'Enter' && add();
    const inParty = new Set(party?.members.map((m) => m.id));
    const row = (f: FriendView) => h('div.friend', { class: f.presence },
      h('span.pres'),
      h('div.fmeta', h('b', f.name), h('small', PRESENCE_LABEL[f.presence] + (f.partySize > 1 && f.presence !== 'offline' ? ` · Party ${f.partySize}/4` : ''))),
      f.presence !== 'offline' && !inParty.has(f.id) ? h('div.factions',
        h('button.mini', { onclick: () => net.send({ t: 'party_invite', userId: f.id }) }, 'Invite'),
        f.presence === 'lobby' ? h('button.mini.ghost', { onclick: () => { net.send({ t: 'party_join_friend', userId: f.id }); friendsOpen = false; render(); } }, 'Join') : null) : null,
      inParty.has(f.id) ? h('span.inparty', 'IN PARTY') : null,
      h('button.mini.x', { title: 'Remove friend', onclick: () => confirm(`Remove ${f.name}?`) && net.send({ t: 'friend_remove', userId: f.id }) }, '✕'),
    );
    return h('aside.friends', { class: friendsOpen ? 'open' : '' },
      h('div.friends-head', h('b', 'FRIENDS'), h('button.mini.x', { onclick: () => { friendsOpen = false; render(); } }, '✕')),
      h('div.addrow', input, h('button.mini', { onclick: add }, 'Add')),
      incoming.length ? h('div.section', h('div.sec-title', `REQUESTS (${incoming.length})`), ...incoming.map((u) => h('div.friend.req',
        h('div.fmeta', h('b', u.name), h('small', 'wants to be friends')),
        h('div.factions',
          h('button.mini', { onclick: () => net.send({ t: 'friend_respond', userId: u.id, accept: true }) }, 'Accept'),
          h('button.mini.ghost', { onclick: () => net.send({ t: 'friend_respond', userId: u.id, accept: false }) }, 'Decline'))))) : null,
      h('div.section', h('div.sec-title', `ONLINE — ${friends.filter((f) => f.presence !== 'offline').length}`), ...friends.filter((f) => f.presence !== 'offline').map(row)),
      friends.some((f) => f.presence === 'offline') ? h('div.section', h('div.sec-title', 'OFFLINE'), ...friends.filter((f) => f.presence === 'offline').map(row)) : null,
      outgoing.length ? h('div.section', h('div.sec-title', 'SENT'), ...outgoing.map((u) => h('div.friend.req', h('div.fmeta', h('b', u.name), h('small', 'pending'))))) : null,
      !friends.length && !incoming.length ? h('div.empty-note', 'Add your classmates by username to party up.') : null,
    );
  }

  // ---------------------------------------------------------- locker
  function lockerPanel() {
    const current = me()?.skin ?? 0;
    return h('div.locker',
      h('div.panel-title', 'OUTFIT'),
      h('div.skin-name', SKINS[current].name),
      h('div.skins', ...SKINS.slice(0, SKIN_COUNT).map((s, i) => h('button.skin', {
        class: i === current ? 'on' : '',
        title: s.name,
        style: { background: `linear-gradient(160deg, ${s.hoodie} 0 55%, ${s.beanie} 55% 75%, ${s.pants} 75%)` },
        onclick: () => net.send({ t: 'set_skin', skin: i }),
      }))),
      h('div.hint', 'Drag on your character to spin'),
    );
  }

  // ---------------------------------------------------------- render
  function setTab(t: typeof tab) { tab = t; scene.focusYou = t === 'locker'; render(); }

  /** What's new on the island (bottom left of the play screen). */
  function newsCard() {
    const items: [string, string][] = [
      ['⛏', 'Pickaxe: F to swing, smash walls and furniture'],
      ['◈', 'Gold: spend it at the pirate merchants on the coast'],
      ['⬢', 'Overshield: 50 extra that refills out of combat'],
      ['⌂', 'Bigger towns, an upstairs in every building, hamlets on the roads'],
      ['⇄', 'Tab opens your inventory; rebind fire and aim in Settings'],
    ];
    return h('div.news-card', h('div.news-title', "WHAT'S NEW"), ...items.map(([i, t]) => h('div.news-row', h('span', i), h('small', t))));
  }

  function render() {
    ui.replaceChildren(
      topbar(),
      tab === 'play' ? partyPanel() : h('div'),
      tab === 'play' ? playPanel() : lockerPanel(),
      tab === 'play' ? newsCard() : h('div'),
      friendsPanel(),
    );
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && friendsOpen) { friendsOpen = false; render(); } };
  addEventListener('keydown', onKey);

  // drag to spin in locker
  let dragging = false, lastX = 0;
  stage.addEventListener('pointerdown', (e) => { dragging = tab === 'locker'; lastX = e.clientX; });
  addEventListener('pointerup', () => (dragging = false));
  addEventListener('pointermove', (e) => { if (dragging) { scene.rotatePreview((e.clientX - lastX) * 0.01); lastX = e.clientX; } });

  // ---------------------------------------------------------- network
  let prevReady = new Set<string>();
  const off = net.on((m: ServerMsg) => {
    switch (m.t) {
      case 'party': {
        party = m.party;
        // "play again" from the results screen: queue straight back up (or ready up if someone else leads)
        if (playAgain) {
          playAgain = false;
          setTimeout(() => net.send(party!.leaderId === you.id ? { t: 'queue_start' } : { t: 'ready', ready: true }), 300);
        }
        scene.setMembers(party.members.map((x) => ({ ...x, leader: x.id === party!.leaderId, you: x.id === you.id })));
        for (const x of party.members) if (x.ready && !prevReady.has(x.id)) scene.celebrate(x.id);
        prevReady = new Set(party.members.filter((x) => x.ready).map((x) => x.id));
        renderTags();
        break;
      }
      case 'queue': queue = m.queue; break;
      case 'friends': friends = m.friends; incoming = m.incoming; outgoing = m.outgoing; break;
      case 'match_found': onMatch(m.match); return;
      case 'toast': toast(m.message, m.kind); return;
      case 'party_invite': return showInvite(m.partyId, m.from);
      case 'error': toast(m.message, 'error'); return;
      default: return;
    }
    render();
  });

  function showInvite(partyId: string, from: UserView) {
    const el = h('div.invite',
      h('div', h('b', from.name), ' invited you to their party'),
      h('div.invite-actions',
        h('button.mini', { onclick: () => { net.send({ t: 'party_respond', partyId, accept: true }); el.remove(); friendsOpen = false; render(); } }, 'Join'),
        h('button.mini.ghost', { onclick: () => { net.send({ t: 'party_respond', partyId, accept: false }); el.remove(); } }, 'Decline')),
    );
    document.body.append(el);
    setTimeout(() => el.remove(), 20_000);
  }

  net.onStatus = (s) => {
    status.textContent = s === 'online' ? '' : s === 'reconnecting' ? 'Reconnecting…' : '';
    status.className = 'conn ' + s;
    if (s === 'signed_out') onSignOut();
  };

  render();
  net.send({ t: 'sync' }); // (re)entering the lobby: ask for the current party / friends / queue
  return { el: root, destroy: () => { off(); removeEventListener('keydown', onKey); scene.dispose(); } };
}
