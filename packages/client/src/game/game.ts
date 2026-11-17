import * as THREE from 'three';
import {
  ACT, DROP, EF, EF_EMOTE_SHIFT, ITEM, ITEMS, K, MV, PICK_SLOT, consumableDef, heldItemId, meleeDef, PM, SIM_DT, WATER_FLOAT_Y, isLow, zipNear, busPos, clamp, currentSpread, decodeSnapshot, encodeInputs, getWorld, raycastWorld, seatWorld, stepPlayer, surfaceAt, terrainAt, weaponDef,
  type EntSnap, type GameEvent, type GameInit, type GamePhase, type InputCmd, type MatchFoundView, type PlayerState, type RouteView, type ServerMsg, type SimEvents, type UserView, type World,
} from '@dropzone/shared';
import { STORM_PHASES } from '@dropzone/shared';
import type { Net } from '../net';
import { SKINS } from '../lobby/character';
import { h, toast } from '../ui/dom';
import { Actors } from './actors';
import { CarRenderer } from './cars';
import { CombatHud } from './combathud';
import { InventoryPanel } from './inventory';
import { Effects } from './effects';
import { LootRenderer } from './lootview';
import { StormView } from './storm3d';
import { settings, settingsPanel, onSettings } from '../settings';
import { ChestRenderer } from './chests3d';
import { buildDropship } from './dropship';
import { Hud, type HudView } from './hud';
import { Input } from './input';
import { buildSky } from './sky';
import { installAtmosphere } from './atmosphere';
import { Post } from './post';
import { Life } from './life';
import { audio } from '../audio';
import { Soundscape } from './soundscape';
import { buildIsland } from './terrain';
import { pickQuality } from './quality';

const INTERP_MS = 100;
interface Sample { t: number; x: number; y: number; z: number; yaw: number; pitch: number; mode: number; flags: number; item: number; rarity: number; mv: number; mt: number }

export function gameScreen(net: Net, _you: UserView, found: MatchFoundView, onExit: (playAgain?: boolean) => void) {
  const stage = h('div.stage');
  const myTeam = found.teams.find((t) => t.id === found.yourTeam);
  const loading = h('div.game-loading',
    h('div.match-card',
      h('div.mf-kicker', 'MATCH FOUND'),
      h('div.mf-title', found.mode === 'solo' ? 'SOLO' : found.mode.toUpperCase() + 'S'),
      h('div.mf-stats', h('div', h('b', found.teams.length), h('small', 'TEAMS')), h('div', h('b', found.humans), h('small', 'PLAYERS')), h('div', h('b', found.bots), h('small', 'BOTS'))),
      h('div.mf-team-title', 'YOUR TEAM'),
      h('div.mf-team', ...(myTeam?.members ?? []).map((x) => h('div.mf-member', h('span.avatar', { style: { background: SKINS[x.skin % SKINS.length].hoodie } }), h('b', x.name), x.bot ? h('small.bot', 'BOT') : null))),
      h('div.loading', h('div.bar', h('span')), 'Building the island…')));
  const root = h('div.screen.game', stage, loading);

  let running: ReturnType<typeof start> | null = null;
  let disposed = false;

  const offMsg = net.on((m: ServerMsg) => {
    if (disposed) return;
    if (m.t === 'welcome') net.send({ t: 'game_join' }); // reconnected: ask for the match state again
    else if (m.t === 'game_init') {
      if (running) running.resync(m.init);
      // let the loading card paint before the heavy world build blocks the thread
      else setTimeout(() => { if (!disposed && !running) { running = start(m.init); loading.classList.add('done'); setTimeout(() => loading.remove(), 600); } }, 60);
    } else if (m.t === 'game_end') { toast('Match ended', 'info'); leave(false); }
    else if (m.t === 'toast') toast(m.message, m.kind);
    else running?.onMsg(m);
  });
  net.onBinary = (v) => running?.onSnapshot(v);
  // lost the connection: say so (the client reconnects and rejoins the match on its own)
  const connPill = h('div.conn-pill', 'Connection lost · reconnecting…');
  root.append(connPill);
  net.onStatus = (st) => { connPill.classList.toggle('show', st === 'reconnecting'); if (st === 'signed_out') leave(false); };
  net.send({ t: 'game_join' });

  let playAgain = false;
  function leave(tellServer: boolean, again = playAgain) {
    if (disposed) return;
    if (tellServer) net.send({ t: 'leave_match' });
    onExit(again);
  }

  // ------------------------------------------------------------------ the running match
  function start(init: GameInit) {
    // this match's own view of the island (vault doors open per match)
    const world: World = Object.create(getWorld(init.seed)) as World;
    world.openVaults = new Set(init.vaultsOpen);
    world.broken = new Set(init.broken ?? []);
    const q = pickQuality();
    const roster = init.players, selfIdx = init.you;
    const team = roster.filter((r) => r.team === roster[selfIdx].team).map((r) => r.idx);

    // height fog and sun haze for every material (before anything compiles)
    installAtmosphere();
    // Medium and High render into an HDR buffer finished by the post pipeline (post.ts)
    // Low renders straight to the screen, so it uses the canvas's own anti-aliasing instead of FXAA
    const renderer = new THREE.WebGLRenderer({ antialias: q.direct, powerPreference: 'high-performance', stencil: false });
    // resolution follows the frame rate (dynamic resolution, see the bottom of frame())
    const maxRatio = Math.min(devicePixelRatio || 1, q.pixelRatio);
    let pixelRatio = maxRatio;
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // neutral tone mapping keeps the bright cartoon colours (ACES dulls them)
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = q.softShadows ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.info.autoReset = false; // the post pipeline renders several times a frame: count the whole frame
    /** Frame cost: draw calls, triangles, and milliseconds spent in our code vs. submitting the render. */
    const perf = { calls: 0, tris: 0, js: 0, render: 0 };
    stage.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 9000);
    const sky = buildSky(scene, q.shadows, q.shadowSize);
    const post = new Post(renderer, scene, camera, { bloom: q.bloom, fxaa: q.fxaa, direct: q.direct });
    const island = buildIsland(world, q);
    scene.add(island.group);
    const ship = buildDropship();
    ship.root.visible = false;
    scene.add(ship.root);
    const actors = new Actors(scene, roster, selfIdx, world, q.name);
    const fx = new Effects(scene, world);
    const life = q.life ? new Life(world, scene) : null;
    const lootR = new LootRenderer(scene);
    lootR.set(init.loot);
    const cars = new CarRenderer(scene, world, fx);
    const chestR = new ChestRenderer(scene, fx);
    chestR.set(init.chests);
    let aliveCount = init.alive, specIdx = -1, revive = { p: 0, at: 0 };
    const kills = [...init.kills];
    const storm = new StormView(scene);
    if (init.storm) storm.plan = { ...init.storm, phases: STORM_PHASES };
    let cards: number[] = [], beaconReady = [...init.beacons];
    const myTeam = roster[selfIdx].team;
    island.props.setVaults(world.openVaults);
    for (const id of world.broken) island.breakSolid(id);
    let settingsEl: HTMLElement | null = null;
    const openSettings = () => {
      if (settingsEl) return;
      settingsEl = settingsPanel(() => { settingsEl?.remove(); settingsEl = null; });
      root.append(settingsEl);
    };
    const offSettings = onSettings(() => { fpsShown(); });
    const fpsShown = () => root.classList.toggle('show-fps', settings.showFps);
    fpsShown();

    // squad map markers: a light beam in the world
    const beams = new Map<number, THREE.Mesh>();
    const markers = new Map<number, { x: number; z: number }>();
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 400, 8, 1, true).translate(0, 200, 0);
    const BEAM_COLORS = ['#ffd23f', '#3ee6ff', '#ff5fa2', '#4ade80'];
    function setMarker(idx: number, x?: number, z?: number) {
      let beam = beams.get(idx);
      if (x === undefined || z === undefined) { markers.delete(idx); if (beam) beam.visible = false; return; }
      markers.set(idx, { x, z });
      if (!beam) {
        beam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: BEAM_COLORS[team.indexOf(idx) % 4], transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, fog: false }));
        beams.set(idx, beam); scene.add(beam);
      }
      beam.visible = true;
      beam.position.set(x, Math.max(0, terrainAt(world, x, z)), z);
    }
    for (const m of init.markers) setMarker(m.idx, m.x, m.z);

    const input = new Input(renderer.domElement);
    const hud = new Hud(world, island.mainColors, roster, selfIdx, {
      onLeave: () => leave(true, false),
      onSettings: () => openSettings(),
      onResume: () => { hud.setMenu(false); input.lock(); },
      onMarker: (x, z) => net.send(x === undefined ? { t: 'game_marker' } : { t: 'game_marker', x, z }),
      onCloseMap: () => toggleMap(false),
    });
    const combat = new CombatHud(roster, selfIdx, {
      onLeave: (again) => leave(true, !!again),
      onSpecNext: (dir) => net.send({ t: 'spec_next', dir }),
      onSpectate: () => input.lock(),
    });
    // inventory screen (Tab / I): rearrange, inspect and drop things
    const inv = new InventoryPanel({
      swap: (a, b) => net.send({ t: 'inv_swap', a, b }),
      drop: (slot, n) => { net.send(n === undefined ? { t: 'inv_drop', slot } : { t: 'inv_drop', slot, n }); audio.item('swap'); },
      dropAmmo: (ammo, n) => { net.send({ t: 'ammo_drop', ammo, n }); audio.item('ammo'); },
      equip: (slot) => { input.pendingSlot = slot + 1; },
    }, () => toggleInv(false));
    root.append(hud.el, combat.el, inv.el);
    function toggleInv(open = !inv.open) {
      if (open && (!pred || pred.mode === PM.Dead || pred.mode === PM.Bus)) return;
      if (open && hud.mapOpen) hud.setMap(false);
      inv.setOpen(open, pred);
      if (open) input.unlock(); else if (!hud.menuOpen && !hud.mapOpen) input.lock();
    }
    // while it's open, number keys pick a card and Q drops it (instead of switching what you hold)
    const invKeys = (e: KeyboardEvent) => { if (inv.open && inv.key(e.code)) { e.preventDefault(); e.stopPropagation(); } };
    addEventListener('keydown', invKeys, true);

    function toggleMap(open = !hud.mapOpen) {
      hud.setMap(open);
      if (open) input.unlock(); else if (!hud.menuOpen) input.lock();
    }
    let lockLostAt = 0;
    input.onAction = (a) => {
      if (a === 'map') { if (hud.menuOpen || settingsEl) return; if (inv.open) toggleInv(false); toggleMap(); }
      else if (a === 'inventory') { if (hud.menuOpen || settingsEl) return; toggleInv(); }
      else if (a === 'menu') {
        if (settingsEl) { settingsEl.remove(); settingsEl = null; return; }
        if (hud.mapOpen) return toggleMap(false);
        if (inv.open) return toggleInv(false);
        if (input.locked) return input.unlock(); // -> onLockChange opens the menu
        // Esc while locked is consumed by the browser (it just unlocks); see onLockChange
        if (!input.locked && performance.now() - lockLostAt > 150) { hud.setMenu(!hud.menuOpen); if (!hud.menuOpen) input.lock(); }
      } else if (a === 'ping') {
        // mark the spot you're looking at
        const d = new THREE.Vector3(); camera.getWorldDirection(d);
        const p = camera.position.clone();
        for (let i = 0; i < 400; i++) { p.addScaledVector(d, 2); if (p.y <= Math.max(0, terrainAt(world, p.x, p.z))) { net.send({ t: 'game_marker', x: p.x, z: p.z }); break; } }
      }
    };
    input.onLockChange = (locked) => {
      if (locked) { hud.setMenu(false); return; }
      lockLostAt = performance.now();
      if (!hud.mapOpen && !inv.open && !disposed) hud.setMenu(true); // Esc pressed
    };

    // ---------------------------------------------------------------- state
    let phase: GamePhase = init.phase;
    let route: RouteView | null = init.route;
    let warmupEndsAt = init.warmupEndsAt;
    const gone = new Set<number>(init.gone);
    let clockOffset = init.serverTime - performance.now();
    let haveClock = false;

    let pred: PlayerState | null = null;
    const prevPos = new THREE.Vector3(), err = new THREE.Vector3();
    let seq = 0;
    let pending: { seq: number; cmd: InputCmd }[] = [];
    let outbox: InputCmd[] = [];
    const hist: Sample[][] = roster.map(() => []);
    const seenTick = new Int32Array(roster.length).fill(-1);
    let lastTick = -1;

    function setPhase(p: GamePhase, r: RouteView | null) {
      if (p === 'bus' && phase !== 'bus') {
        hud.doFlash(); input.pitch = -0.32;
        if (r) input.yaw = Math.atan2(-(r.x1 - r.x0), -(r.z1 - r.z0)) + 0.5; // start behind the ship, slightly to one side
      }
      phase = p; if (r) route = r;
    }

    function resync(i: GameInit) {
      setPhase(i.phase, i.route); warmupEndsAt = i.warmupEndsAt;
      gone.clear(); i.gone.forEach((g) => gone.add(g));
      pending = []; outbox = []; pred = null; haveClock = false;
    }

    function onMsg(m: ServerMsg) {
      if (m.t === 'game_phase') setPhase(m.phase, m.route);
      else if (m.t === 'game_gone') gone.add(m.idx);
      else if (m.t === 'game_marker') setMarker(m.idx, m.x, m.z);
      else if (m.t === 'loot') { lootR.remove(m.del); lootR.add(m.add); }
      else if (m.t === 'chests') { chestR.add(m.add); chestR.open(m.open); }
      else if (m.t === 'storm') storm.plan = { ...m.plan, phases: STORM_PHASES };
      else if (m.t === 'cards') cards = m.cards;
      else if (m.t === 'beacons') beaconReady = m.ready;
      else if (m.t === 'vaults') { world.openVaults = new Set(m.open); island.props.setVaults(world.openVaults); }
      else if (m.t === 'boss') combat.boss(m.name, m.hp);
      else if (m.t === 'alive') aliveCount = m.alive;
      else if (m.t === 'spec') specIdx = m.idx;
      else if (m.t === 'result') { input.unlock(); combat.showResult(m.result); audio.setMusic(null); audio.ui(m.result.win ? 'victory' : 'defeat'); }
      else if (m.t === 'ev') for (const e of m.ev) onEvent(e);
    }

    const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
    function onEvent(e: GameEvent) {
      switch (e.e) {
        case 'shot': {
          const ch = actors.character(e.i);
          const from = ch && actors.states[e.i].visible ? ch.muzzleWorld(tmpA, e.w) : tmpA.set(...e.o);
          fx.muzzle(from, weaponDef(e.w)?.cls === 'sniper');
          if (e.i !== selfIdx) audio.gun(weaponDef(e.w)?.cls ?? 'ar', { x: from.x, y: from.y, z: from.z });
          for (let i = 0; i < e.h.length; i += 4) {
            tmpB.set(e.h[i], e.h[i + 1], e.h[i + 2]);
            if (i < 12 || weaponDef(e.w)?.pellets === 1) fx.tracer(from, tmpB);
            fx.impact(tmpB, e.h[i + 3]);
          }
          break;
        }
        case 'melee': {
          actors.swing(e.i);
          const at = { x: e.h[0], y: e.h[1], z: e.h[2] };
          audio.melee('swing', at);
          if (e.h[3] === 0 || e.h[3] === 4) { tmpB.set(at.x, at.y, at.z); fx.impact(tmpB, e.h[3] === 4 ? 4 : 0); audio.melee('wall', at); }
          else if (e.h[3] === 1 || e.h[3] === 2) { tmpB.set(at.x, at.y, at.z); fx.impact(tmpB, e.h[3]); audio.melee('flesh', at); }
          break;
        }
        case 'broke': {
          world.broken!.add(e.id);
          const col = island.breakSolid(e.id);
          const o = world.solids[e.id];
          if (o && col) {
            const cx = (o.x0 + o.x1) / 2, cy = (o.y0 + o.y1) / 2, cz = (o.z0 + o.z1) / 2;
            const hex = '#' + col.getHexString();
            const n = Math.min(26, 6 + Math.round((o.x1 - o.x0 + o.z1 - o.z0) * (o.y1 - o.y0) * 0.6));
            fx.burst(cx, cy, cz, n, hex, 4, 3, 0.22, 0.9, 0.6);
            fx.burst(cx, o.y0 + 0.3, cz, Math.ceil(n / 2), '#d8d0c0', 3, 1, 0.5, 1.4, 1.8);
            audio.melee('break', { x: cx, y: cy, z: cz });
          }
          break;
        }
        case 'struct': combat.structureHp(e.hp); break;
        case 'dmg': {
          combat.hitMarker(e.hd, !!e.ko);
          audio.hit(e.ko ? 'knock' : e.hd ? 'head' : e.sh ? 'shield' : 'body');
          if (e.d > 0) { const p = project(...e.p); if (p.show) combat.damageNumber(p.sx, p.sy, e.d, e.sh, e.hd); }
          break;
        }
        case 'hurt': {
          audio.hurt((pred?.shield ?? 0) > 0);
          if (!e.from || !pred) { combat.hurtFrom(null); break; }
          const ang = Math.atan2(-(e.from[0] - pred.x), -(e.from[1] - pred.z)) - input.yaw;
          combat.hurtFrom(-ang);
          break;
        }
        case 'proj': fx.spawnProjectile(e.id, e.it, e.p, e.v, e.fuse, !!weaponDef(e.it)?.projectile); break;
        case 'boom': fx.removeProjectile(e.id); fx.explosion(tmpA.set(...e.p), e.r); audio.explosion({ x: e.p[0], y: e.p[1], z: e.p[2] }); break;
        case 'car_boom': fx.explosion(tmpA.set(...e.p), 6); audio.explosion({ x: e.p[0], y: e.p[1], z: e.p[2] }, 1.4); break;
        case 'supply': toast('Supply drop incoming! Check your map.', 'info'); audio.item('supply'); break;
        case 'opened': { const c = chestR.chests.get(e.id); if (c) audio.item('chest', { x: c.x, y: c.y + 0.5, z: c.z }); break; }
        case 'recalled': audio.item('revive'); toast(e.i === selfIdx ? `${roster[e.by]?.name} brought you back!` : `${roster[e.by]?.name} recalled ${roster[e.i]?.name}`, 'success'); break;
        case 'vault': { const d = world.vaults.find((v) => v.id === e.id)?.door; audio.item('vault', d ? { x: d.x, y: (pred?.y ?? 0) + 1, z: d.z } : null); } toast(`${roster[e.by]?.name ?? 'Someone'} opened a vault!`, 'info'); break;
        case 'feed':
          combat.feedLine(e.k, e.v, e.w, e.knock, e.cause);
          if (!e.knock && e.k >= 0 && e.k !== e.v) kills[e.k] = (kills[e.k] ?? 0) + 1;
          if (!e.knock && e.k === selfIdx && e.v !== selfIdx) audio.elim();
          break;
        case 'revived':
          if (e.i < 0) revive = { p: e.by / 100, at: performance.now() };
          else { if (team.includes(e.i)) audio.item('revive'); if (e.i !== selfIdx) toast(`${roster[e.by]?.name} revived ${roster[e.i]?.name}`, 'success'); }
          break;
      }
    }

    function onSnapshot(view: DataView) {
      const snap = decodeSnapshot(view);
      if (!snap) return;
      const sample = snap.time - performance.now();
      if (!haveClock || Math.abs(sample - clockOffset) > 400) { clockOffset = sample; haveClock = true; }
      else clockOffset += (sample - clockOffset) * 0.06;
      lastTick = snap.tick;
      for (const e of snap.ents as EntSnap[]) {
        if (e.idx >= hist.length) continue;
        const list = hist[e.idx];
        list.push({ t: snap.time, x: e.x, y: e.y, z: e.z, yaw: e.yaw, pitch: e.pitch, mode: e.mode, flags: e.flags, item: e.item, rarity: e.rarity, mv: e.mv, mt: e.mt });
        if (list.length > 16) list.shift();
        seenTick[e.idx] = snap.tick;
      }
      cars.onSnapshot(snap.time, snap.vehs, snap.tick);
      if (snap.self) {
        const before = pred ? { x: pred.x, y: pred.y, z: pred.z } : null;
        pred = { ...snap.self, yaw: input.yaw, pitch: input.pitch };
        pending = pending.filter((p) => p.seq > snap.ack);
        for (const p of pending) stepPlayer(pred, p.cmd, world);
        if (before) {
          // hide small corrections by blending them out; snap on teleports (boarding / leaving the ship)
          const dx = pred.x - before.x, dy = pred.y - before.y, dz = pred.z - before.z;
          prevPos.x += dx; prevPos.y += dy; prevPos.z += dz;
          err.x -= dx; err.y -= dy; err.z -= dz;
          if (err.lengthSq() > 36) err.set(0, 0, 0);
        } else prevPos.set(pred.x, pred.y, pred.z);
      }
    }

    // your own shots: draw them right away (the server confirms hits)
    const liveEvents: SimEvents = {
      shot: (e) => {
        const def = weaponDef(e.weapon);
        if (!def) return;
        const ch = actors.character(selfIdx);
        const from = ch ? ch.muzzleWorld(tmpA, e.weapon).clone() : new THREE.Vector3(e.origin.x, e.origin.y, e.origin.z);
        fx.muzzle(from, def.cls === 'sniper' || def.cls === 'shotgun');
        audio.gun(def.cls, null, true);
        if (!def.projectile) for (const d of e.dirs) {
          const hit = raycastWorld(world, e.origin, d, def.range);
          tmpB.set(e.origin.x + d.x * hit.t, e.origin.y + d.y * hit.t, e.origin.z + d.z * hit.t);
          fx.tracer(from, tmpB, '#fff3b0', true);
          if (hit.kind !== 'none') fx.impact(tmpB, hit.kind === 'water' ? 3 : 0);
        }
        // recoil kick
        const kick = { pistol: 0.012, smg: 0.006, ar: 0.008, burst: 0.006, shotgun: 0.045, autoshotgun: 0.025, dmr: 0.018, sniper: 0.06, rocket: 0.05 }[def.cls];
        input.pitch = Math.min(1.5, input.pitch + kick * ((input.keys & K.ADS) ? 0.6 : 1));
        input.yaw += (Math.random() - 0.5) * kick * 0.3;
      },
      swing: (e) => {
        actors.swing(selfIdx);
        audio.melee('swing', null);
        // chips off a wall right in front of you (the server decides hits on players)
        const md = meleeDef(ITEM.pickaxe)!;
        const hit = raycastWorld(world, e.origin, e.dir, md.range, false);
        if (hit.kind !== 'none') {
          tmpB.set(e.origin.x + e.dir.x * hit.t, e.origin.y + e.dir.y * hit.t, e.origin.z + e.dir.z * hit.t);
          fx.impact(tmpB, 0); fx.burst(tmpB.x, tmpB.y, tmpB.z, 3, '#cbbfa8', 1.5, 1.2, 0.08, 0.35);
          audio.melee('wall', null);
        }
      },
      kicked: () => {
        actors.kick(selfIdx);
        audio.move('jump', null); audio.move('mantle', null);
        if (pred) fx.burst(pred.x - Math.sin(input.yaw) * 0.7, pred.y + 0.9, pred.z - Math.cos(input.yaw) * 0.7, 5, '#e6dcc6', 1.2, 1, 0.14, 0.45);
      },
      reloaded: () => audio.reload('end'),
      used: (item) => audio.item(consumableDef(item)?.shield ? 'shield' : 'heal'),
    };

    function simStep() {
      const frozen = hud.menuOpen || hud.mapOpen || combat.resultOpen;
      const slot = pred ? input.takeSlot(pred.slot, (i) => i === PICK_SLOT || pred!.inv[i].id !== 0) : 0;
      const cmd: InputCmd = { keys: frozen ? 0 : input.keys, yaw: Math.fround(input.yaw), pitch: Math.fround(input.pitch), slot };
      input.consumeTaps();
      seq++;
      pending.push({ seq, cmd });
      if (pending.length > 180) pending.shift();
      outbox.push(cmd);
      if (pred) { prevPos.set(pred.x, pred.y, pred.z); stepPlayer(pred, cmd, world, liveEvents); }
      if (outbox.length >= 2) {
        net.sendBinary(encodeInputs(seq - outbox.length + 1, outbox, performance.now() + clockOffset - INTERP_MS));
        outbox = [];
      }
    }

    // ---------------------------------------------------------------- render
    const selfPos = new THREE.Vector3(), camPos = new THREE.Vector3(), pivot = new THREE.Vector3(), dir = new THREE.Vector3(), proj = new THREE.Vector3();
    let camDist = 4.3, shoulder = 0.75, fov = settings.fov, emoteSwing = 0;
    // movement feel: camera drops when you crouch or slide, dips on hard landings, FOV kicks with speed
    let camLow = 0, camDip = 0, fovKick = 0, selfFallVy = 0, selfWasGrounded = true;
    // per-player effect timers and "were they in the water" flags
    const dustT = roster.map(() => 0), wetPrev = roster.map(() => false), mvPrev = roster.map(() => 0), zipPrev = roster.map(() => false);
    // sound: the continuous soundscape, plus a little state for one-shots we infer from the prediction
    const sound = new Soundscape(world, roster.length);
    let prevReload = 0, prevSlot = -1, prevItems = -1, prevAmmo = -1, landedOnce = false;
    input.onSpec = (dir) => net.send({ t: 'spec_next', dir });
    let acc = 0, last = performance.now(), time = 0, fps = 60, slowFor = 0, fastFor = 0, resTimer = 0, resizePending = false;
    let debugCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

    function resize() {
      const w = stage.clientWidth || innerWidth, hh = stage.clientHeight || innerHeight;
      renderer.setSize(w, hh);
      post.setSize(w, hh, pixelRatio);
      camera.aspect = w / hh; camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize);
    // Ctrl is a crouch key and Ctrl+W closes the tab: ask before leaving a match by accident
    const leaveGuard = (e: BeforeUnloadEvent) => { if (pred && pred.mode !== PM.Dead) { e.preventDefault(); e.returnValue = ''; } };
    addEventListener('beforeunload', leaveGuard);
    resize();

    function project(x: number, y: number, z: number) {
      proj.set(x, y, z).project(camera);
      return { sx: (proj.x * 0.5 + 0.5) * renderer.domElement.clientWidth, sy: (-proj.y * 0.5 + 0.5) * renderer.domElement.clientHeight, show: proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 };
    }

    function frame() {
      const nowMs = performance.now();
      if (resizePending) { resizePending = false; renderer.setPixelRatio(pixelRatio); resize(); }
      renderer.info.reset();
      const dt = Math.min(0.1, (nowMs - last) / 1000);
      last = nowMs; time += dt;
      fps += (1 / Math.max(dt, 0.001) - fps) * 0.05;

      acc += dt;
      let steps = 0;
      while (acc >= SIM_DT && steps < 8) { simStep(); acc -= SIM_DT; steps++; }
      if (acc > SIM_DT * 3) acc = 0;
      const alpha = acc / SIM_DT;
      const serverNow = nowMs + clockOffset, rt = serverNow - INTERP_MS;

      // dropship
      const shipActive = phase === 'bus' && route !== null && serverNow < route.t1 + 500;
      ship.root.visible = shipActive;
      let shipX = 0, shipY = 0, shipZ = 0;
      if (shipActive && route) {
        const b = busPos(route, serverNow);
        shipX = b.x; shipY = b.y; shipZ = b.z;
        ship.root.position.set(b.x, b.y - 1.6, b.z);
        ship.root.rotation.y = Math.atan2(route.x1 - route.x0, route.z1 - route.z0);
        ship.update(dt, time);
      }

      // other players: interpolate between snapshots
      const st = actors.states;
      for (let i = 0; i < st.length; i++) {
        if (i === selfIdx) continue;
        const s = st[i], list = hist[i];
        s.visible = !gone.has(i) && seenTick[i] === lastTick && list.length > 0;
        if (!s.visible) continue;
        let b = list.length - 1;
        while (b > 0 && list[b - 1].t > rt) b--;
        const B = list[b], A = list[Math.max(0, b - 1)];
        const k = B.t > A.t ? clamp((rt - A.t) / (B.t - A.t), 0, 1) : 1;
        s.x = A.x + (B.x - A.x) * k; s.y = A.y + (B.y - A.y) * k; s.z = A.z + (B.z - A.z) * k;
        let dy = B.yaw - A.yaw; if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
        s.yaw = A.yaw + dy * k;
        s.pitch = A.pitch + (B.pitch - A.pitch) * k;
        s.mode = B.mode; s.grounded = (B.flags & EF.GROUNDED) !== 0; s.flags = B.flags; s.item = B.item; s.rarity = B.rarity; s.mv = B.mv; s.mt = B.mt;
        if (s.mode === PM.Drive) { const at = seatWorld({ x: s.x, y: s.y, z: s.z, vh: s.yaw }, 0); s.x = at.x; s.y = at.y - 0.55; s.z = at.z; }
        if (s.mode === PM.Ride) { s.y -= 0.55; const near = cars.nearest(s.x, s.y, s.z, 3); if (near !== null) { const c = cars.sample(near, rt); if (c) s.yaw = c.vh; } }
        const span = Math.max(0.001, (B.t - A.t) / 1000);
        const sp = Math.hypot(B.x - A.x, B.z - A.z) / span;
        s.vy = (B.y - A.y) / span;
        s.vx += ((B.x - A.x) / span - s.vx) * 0.3; s.vz += ((B.z - A.z) / span - s.vz) * 0.3;
        s.speed += (sp - s.speed) * 0.25;
        s.dive = clamp((-(B.y - A.y) / span - DROP.freefallMinSpeed) / (DROP.freefallMaxSpeed - DROP.freefallMinSpeed), 0, 1);
        if (s.mode === PM.Bus) s.visible = false;
      }

      // self
      const me = st[selfIdx];
      const inBus = !pred || pred.mode === PM.Bus;
      const dead = !!pred && pred.mode === PM.Dead;
      let carOverride: Parameters<typeof cars.update>[2];
      if (pred && !inBus && !dead) {
        err.multiplyScalar(Math.exp(-dt * 12));
        selfPos.set(prevPos.x + (pred.x - prevPos.x) * alpha, prevPos.y + (pred.y - prevPos.y) * alpha, prevPos.z + (pred.z - prevPos.z) * alpha).add(err);
        me.x = selfPos.x; me.y = selfPos.y; me.z = selfPos.z;
        me.yaw = input.yaw; me.pitch = input.pitch; me.mode = pred.mode; me.grounded = pred.grounded; me.mv = pred.mv; me.mt = pred.mt; me.vy = pred.vy; me.vx = pred.vx; me.vz = pred.vz;
        me.speed = Math.hypot(pred.vx, pred.vz);
        me.dive = clamp((-input.pitch - 0.2) / 0.9, 0, 1);
        me.item = heldItemId(pred); me.rarity = pred.slot === PICK_SLOT ? 0 : pred.inv[pred.slot].r;
        me.flags = (pred.keys & K.SPRINT && me.speed > 6 ? EF.SPRINT : 0) | (pred.keys & K.CROUCH ? EF.CROUCH : 0) | (pred.use > 0 ? EF.USING : 0) | (pred.keys & K.ADS ? EF.ADS : 0) | ((pred.emote & 3) << EF_EMOTE_SHIFT);
        me.visible = true;
        if (pred.mode === PM.Drive) {
          const steer = ((input.keys & K.R) ? 1 : 0) - ((input.keys & K.L) ? 1 : 0);
          carOverride = { id: pred.veh, x: selfPos.x, y: selfPos.y, z: selfPos.z, vh: pred.vh, vs: pred.vs, steer };
          const at = seatWorld(carOverride, 0);
          me.x = at.x; me.y = at.y - 0.55; me.z = at.z; me.yaw = pred.vh;
        } else if (pred.mode === PM.Ride) {
          const c = cars.sample(pred.veh, rt);
          if (c) { const at = seatWorld(c, pred.seat); selfPos.set(at.x, at.y, at.z); me.x = at.x; me.y = at.y - 0.55; me.z = at.z; me.yaw = c.vh; }
        }
      } else {
        me.visible = false; me.mode = inBus ? PM.Bus : PM.Dead;
        if (shipActive) selfPos.set(shipX, shipY, shipZ);
        else if (dead && specIdx >= 0 && st[specIdx].visible) selfPos.set(st[specIdx].x, st[specIdx].y, st[specIdx].z);
        else if (pred) selfPos.set(pred.x, pred.y, pred.z);
      }

      // camera
      const watching = dead && specIdx >= 0 && st[specIdx].visible;
      // while you emote the camera swings round to show you off
      emoteSwing += (((pred?.emote ?? 0) > 0 ? Math.PI * 0.85 : 0) - emoteSwing) * (1 - Math.exp(-dt * 3));
      const camYaw = watching ? st[specIdx].yaw : input.yaw + emoteSwing;
      input.spectating = dead && !combat.resultOpen;
      const camPitch = watching ? -0.2 : input.pitch;
      const cp = Math.cos(camPitch);
      dir.set(-Math.sin(camYaw) * cp, Math.sin(camPitch), -Math.cos(camYaw) * cp);
      const air = !inBus && (me.mode === PM.Fall || me.mode === PM.Glide);
      const driving = !!pred && (pred.mode === PM.Drive || pred.mode === PM.Ride);
      const heldDef = pred ? weaponDef(heldItemId(pred)) : null;
      const ads = !!pred && !!heldDef && (input.keys & K.ADS) !== 0 && (pred.mode === PM.Walk || pred.mode === PM.Ride) && pred.act === ACT.None;
      const kCam = 1 - Math.exp(-dt * (ads ? 14 : 6));
      camDist += ((inBus ? 46 : air ? 8.5 : driving ? 8 : ads ? 2.2 : dead ? 5 : 4.3) - camDist) * kCam;
      shoulder += ((inBus || air || driving ? 0 : ads ? 0.62 : 0.75) - shoulder) * kCam;
      const knockedCam = pred?.mode === PM.Knocked ? -0.7 : 0;
      const walking = !!pred && pred.mode === PM.Walk && !watching;
      camLow += ((walking ? (pred!.mv === MV.Slide ? -0.62 : isLow(pred!) ? -0.42 : 0) : 0) - camLow) * (1 - Math.exp(-dt * 10));
      if (pred && pred.mode === PM.Walk) {
        if (!pred.grounded) selfFallVy = Math.min(selfFallVy, pred.vy);
        else if (!selfWasGrounded) { if (selfFallVy < -7 && pred.mv === MV.None) camDip = Math.min(0.35, (-selfFallVy - 5) * 0.03); selfFallVy = 0; }
        selfWasGrounded = pred.grounded;
      } else { selfWasGrounded = true; selfFallVy = 0; }
      camDip *= Math.exp(-dt * 7);
      pivot.set(selfPos.x + Math.cos(camYaw) * shoulder, selfPos.y + (inBus ? 4 : air ? 1.3 : driving ? 2.4 : 1.62 + knockedCam + camLow - camDip), selfPos.z - Math.sin(camYaw) * shoulder);
      camPos.copy(pivot).addScaledVector(dir, -camDist);
      // keep the camera out of walls: pull in to the first thing behind the player
      const back = { x: camPos.x - pivot.x, y: camPos.y - pivot.y, z: camPos.z - pivot.z };
      const bl = Math.hypot(back.x, back.y, back.z);
      if (bl > 0.5 && !inBus) {
        const hit = raycastWorld(world, pivot, { x: back.x / bl, y: back.y / bl, z: back.z / bl }, bl, false);
        if (hit.kind === 'building') camPos.copy(pivot).addScaledVector(dir, -Math.max(0.6, hit.t - 0.3));
      }
      camPos.y = Math.max(camPos.y, Math.max(terrainAt(world, camPos.x, camPos.z), 0) + 0.35);
      camera.position.copy(camPos);
      camera.lookAt(pivot.x + dir.x * 20, pivot.y + dir.y * 20, pivot.z + dir.z * 20);
      const scoped = ads && !!heldDef?.scope && camDist < 2.6;
      const baseFov = settings.fov;
      const kickTo = !pred || ads || watching ? 0 : pred.mode === PM.Zip ? 6 : pred.mv === MV.Launch ? 10 : pred.mv === MV.Slide ? 4 + Math.min(5, Math.hypot(pred.vx, pred.vz) - 6) : (me.flags & EF.SPRINT) ? 3 : 0;
      fovKick += (Math.max(0, kickTo) - fovKick) * (1 - Math.exp(-dt * 5));
      const wantFov = me.mode === PM.Fall && !inBus ? baseFov + 6 + me.dive * 10 : ads && heldDef ? heldDef.adsFov * (baseFov / 70) : baseFov + fovKick;
      if (Math.abs(wantFov - fov) > 0.05) { fov += (wantFov - fov) * kCam; camera.fov = fov; camera.updateProjectionMatrix(); }
      input.zoom = fov / baseFov;
      actors.states[selfIdx].visible &&= !scoped; // hide yourself inside a scope

      if (debugCam) { // free camera for screenshots and debugging
        camPos.set(debugCam.x, debugCam.y, debugCam.z);
        camera.position.copy(camPos);
        const c2 = Math.cos(debugCam.pitch);
        camera.lookAt(camPos.x - Math.sin(debugCam.yaw) * c2, camPos.y + Math.sin(debugCam.pitch), camPos.z - Math.cos(debugCam.yaw) * c2);
      }
      sky.update(dt, camPos, debugCam ? camPos : selfPos);
      island.update(dt, camPos, camera);
      storm.update(time, serverNow);
      if (Math.floor(time * 2) !== Math.floor((time - dt) * 2)) island.props.setBeacons(beaconReady.map((t) => serverNow >= t));
      actors.update(dt, time, camPos);
      // movement effects: slide dust, hard-landing puffs, splashes, launch bursts
      for (const [x, y, z, k] of actors.landings) if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 < 80 * 80) audio.move('land', { x, y, z }, k);
      for (const [x, y, z, k] of actors.landings) if ((x - camPos.x) ** 2 + (z - camPos.z) ** 2 < 80 * 80) fx.burst(x, y + 0.1, z, 4 + Math.round(k * 8), y < 2.5 ? '#eadcb5' : '#d6c9a8', 2 + k * 3, 0.6, 0.22, 0.6);
      for (let i = 0; i < st.length; i++) {
        const s = st[i];
        if (!s.visible || (s.x - camPos.x) ** 2 + (s.z - camPos.z) ** 2 > 75 * 75) { wetPrev[i] = false; mvPrev[i] = s.mv; continue; }
        dustT[i] -= dt;
        const wet = (s.mode === PM.Walk || s.mode === PM.Knocked) && s.y <= WATER_FLOAT_Y + 0.05 && terrainAt(world, s.x, s.z) < WATER_FLOAT_Y;
        const at = { x: s.x, y: s.y + 0.3, z: s.z };
        if (wet && !wetPrev[i] && (s.vy < -2 || s.speed > 3)) audio.move('splash', at, Math.min(1, -s.vy / 15));
        if (s.mode === PM.Walk && s.mv !== mvPrev[i]) {
          if (s.mv === MV.Slide) audio.move('slide', at);
          else if (s.mv === MV.Mantle || s.mv === MV.Hurdle) audio.move('mantle', at);
          else if (s.mv === MV.Launch) audio.move('pad', at);
          else if (s.mv === MV.Roll) { audio.move('land', at, 0.4); audio.move('slide', at); }
        }
        if (s.mode === PM.Zip && !zipPrev[i]) audio.move('zipgrab', at);
        zipPrev[i] = s.mode === PM.Zip;
        if (wet && !wetPrev[i] && (s.vy < -2 || s.speed > 3)) fx.burst(s.x, WATER_FLOAT_Y + 0.9, s.z, 12, '#e9fbff', 2.5, 5 + Math.min(6, -s.vy * 0.4), 0.2, 0.7, 1.1);
        else if (wet && s.speed > 1 && dustT[i] <= 0) { dustT[i] = 0.16; fx.burst(s.x, WATER_FLOAT_Y + 0.95, s.z, 2, '#ffffff', 0.8, 1.2, 0.14, 0.5, 1.5); }
        if (s.mode === PM.Walk && s.mv === MV.Slide && s.grounded && dustT[i] <= 0) {
          dustT[i] = 0.045;
          const fx2 = -Math.sin(s.yaw), fz2 = -Math.cos(s.yaw);
          fx.burst(s.x + fx2 * 0.5, s.y + 0.12, s.z + fz2 * 0.5, 1, s.y < 2.5 ? '#eadcb5' : '#d2c4a0', 1.4, 1.4, 0.18, 0.55, 2.2);
        }
        if (s.mv === MV.Launch && mvPrev[i] !== MV.Launch) fx.burst(s.x, s.y + 0.3, s.z, 14, '#7dffd2', 5, 3, 0.2, 0.6, 1.2);
        if (s.mv === MV.Roll && mvPrev[i] !== MV.Roll) fx.burst(s.x, s.y + 0.15, s.z, 8, s.y < 2.5 ? '#eadcb5' : '#d6c9a8', 2.5, 0.8, 0.22, 0.6);
        if ((s.mv === MV.Mantle || s.mv === MV.Hurdle) && mvPrev[i] !== s.mv) fx.burst(s.x - Math.sin(s.yaw) * 0.6, s.y + 0.9, s.z - Math.cos(s.yaw) * 0.6, 3, '#e6dcc6', 0.8, 0.8, 0.12, 0.4);
        wetPrev[i] = wet; mvPrev[i] = s.mv;
      }
      fx.update(dt);
      life?.update(dt, camPos, pixelRatio);

      // sound
      if (pred) {
        if (pred.reload > 0 && prevReload === 0) audio.reload('start');
        prevReload = pred.reload;
        const items = pred.inv.reduce((a, sl) => a + (sl.id ? sl.n : 0), 0), ammo = pred.ammo.reduce((a, b) => a + b, 0);
        if (prevItems >= 0 && items > prevItems) audio.item('pickup');
        else if (prevAmmo >= 0 && ammo > prevAmmo) audio.item('ammo');
        if (prevSlot >= 0 && pred.slot !== prevSlot) audio.item('swap');
        prevItems = items; prevAmmo = ammo; prevSlot = pred.slot;
        if (phase === 'play' && pred.mode === PM.Walk) landedOnce = true;
      }
      audio.setMusic(phase === 'bus' || (phase === 'play' && !landedOnce && !!pred && (pred.mode === PM.Fall || pred.mode === PM.Glide || pred.mode === PM.Bus)) ? 'drop' : null);
      sound.frame({
        dt, phase, pred, self: selfIdx, actors: actors.states, cam: camPos, camYaw,
        chests: [...chestR.chests.values()].filter((c) => !c.open && (c.x - camPos.x) ** 2 + (c.z - camPos.z) ** 2 < 400),
        cars: [...cars.cars.keys()].map((id) => { const c = cars.sample(id, rt); return c && { id, x: c.x, y: c.y, z: c.z, vs: c.vs, mine: !!pred && pred.veh === id }; }).filter((c): c is NonNullable<typeof c> => !!c),
        ship: shipActive ? { x: shipX, y: shipY, z: shipZ } : null,
        storm: storm.state, warmupLeft: (warmupEndsAt - serverNow) / 1000,
      });
      lootR.update(dt, time, camPos);
      chestR.update(dt, time, camPos, serverNow);
      cars.update(dt, rt, carOverride, camPos);
      for (const b of beams.values()) if (b.visible) (b.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(time * 3) * 0.12;
      const tJs = performance.now();
      post.render(dt);
      perf.js += ((tJs - nowMs) - perf.js) * 0.05; perf.render += ((performance.now() - tJs) - perf.render) * 0.05;
      perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles;

      // HUD
      const view: HudView = {
        phase, serverNow, warmupEndsAt, route,
        self: {
          x: selfPos.x, y: selfPos.y, z: selfPos.z, yaw: input.yaw, mode: inBus ? PM.Bus : me.mode,
          height: selfPos.y - surfaceAt(world, selfPos.x, selfPos.z, Infinity), vy: pred?.vy ?? 0, speed: me.speed,
        },
        alive: aliveCount,
        team: team.map((idx) => ({ idx, x: idx === selfIdx ? selfPos.x : st[idx].x, z: idx === selfIdx ? selfPos.z : st[idx].z, yaw: idx === selfIdx ? input.yaw : st[idx].yaw, mode: idx === selfIdx ? (inBus ? PM.Bus : me.mode) : hist[idx].length ? hist[idx][hist[idx].length - 1].mode : PM.Walk, visible: idx === selfIdx ? !inBus : st[idx].visible })),
        tags: team.filter((idx) => idx !== selfIdx && st[idx].visible).map((idx) => {
          const s = st[idx], p = project(s.x, s.y + 2.45, s.z);
          return { idx, sx: p.sx, sy: p.sy, show: p.show, dist: Math.hypot(s.x - selfPos.x, s.y - selfPos.y, s.z - selfPos.z) };
        }),
        markers: new Map([...markers].map(([idx, m]) => {
          const y = Math.max(0, terrainAt(world, m.x, m.z)) + 14, p = project(m.x, y, m.z);
          return [idx, { ...m, sx: p.sx, sy: p.sy, show: p.show, dist: Math.hypot(m.x - selfPos.x, m.z - selfPos.z) }];
        })),
        locked: input.locked, fps,
        drops: [...chestR.chests.values()].filter((c) => c.k === 2 && !c.open).map((c) => ({ x: c.x, z: c.z })),
        storm: storm.state, kills: kills[selfIdx] ?? 0,
        beacons: world.beacons.map((b, i) => ({ x: b.x, z: b.z, ready: serverNow >= beaconReady[i] })),
      };
      hud.update(view, dt);
      if (pred) {
        // what would E do right now?
        let prompt: string | null = null, promptRarity = 0, promptItem = 0;
        if (pred.mode === PM.Drive || pred.mode === PM.Ride) prompt = 'Get out';
        else if (pred.mode === PM.Walk && pred.act === ACT.None) {
          const downed = team.find((i) => i !== selfIdx && st[i].visible && st[i].mode === PM.Knocked && Math.hypot(st[i].x - pred!.x, st[i].z - pred!.z) < 2.8);
          const car = cars.nearest(pred.x, pred.y, pred.z, 3.8);
          let it = lootR.pickTarget(pred.x, pred.y, pred.z, input.yaw);
          if (it && it.item === ITEM.card && roster[it.r]?.team !== myTeam) it = null; // enemies' cards are no use to you
          const hasKey = pred.inv.some((sl) => sl.id === ITEM.keycard);
          const vault = world.vaults.find((v) => !world.openVaults!.has(v.id) && Math.hypot(v.door.x - pred!.x, v.door.z - pred!.z) < 2.8);
          const bi = world.beacons.findIndex((b) => Math.hypot(b.x - pred!.x, b.z - pred!.z) < 3.4);
          const chest = chestR.pickTarget(pred.x, pred.y, pred.z, input.yaw, serverNow);
          const fx2 = -Math.sin(input.yaw), fz2 = -Math.cos(input.yaw);
          const score = (x: number, z: number) => { const dx = x - pred!.x, dz = z - pred!.z, d = Math.hypot(dx, dz); return d + (1 - (d > 0.01 ? (dx * fx2 + dz * fz2) / d : 1)) * 1.5; };
          const chestWins = chest && (!it || score(chest.x, chest.z) - 0.3 < score(it.x, it.z));
          if (downed !== undefined) prompt = `Hold to revive ${roster[downed].name}`;
          else if (car !== null) prompt = 'Get in';
          else if (vault) { prompt = hasKey ? 'Open vault' : 'Vault locked: the boss carries the keycard'; promptRarity = 4; }
          else if (bi >= 0 && cards.length) { prompt = serverNow >= beaconReady[bi] ? `Hold to recall ${cards.map((c) => roster[c].name).join(', ')}` : `Beacon recharging (${Math.ceil((beaconReady[bi] - serverNow) / 1000)}s)`; promptRarity = 3; }
          else if (it && it.item === ITEM.card) { prompt = `Pick up ${roster[it.r]?.name}'s recall card`; promptRarity = 3; }
          else if (chestWins) { prompt = chest!.k === 0 ? 'Open Chest' : chest!.k === 1 ? 'Search Ammo Box' : 'Open Supply Drop'; promptRarity = chest!.k === 2 ? 3 : chest!.k === 0 ? 4 : 0; }
          else if (it) {
            const kind = ITEMS[it.item]?.kind;
            prompt = kind === 'forage' ? `Eat ${ITEMS[it.item]!.name}` : CombatHud.label(it.item, it.r, it.n);
            promptRarity = kind === 'weapon' ? it.r : 0; promptItem = it.item;
            // no free slot and nothing in your hands to swap it for
            if (kind !== 'forage' && kind !== 'ammo' && pred.slot === PICK_SLOT && pred.inv.every((sl) => sl.id !== 0) && !pred.inv.some((sl) => sl.id === it!.item && kind !== 'weapon')) prompt += '  ·  inventory full: hold an item to swap';
          }
          else if (pred.mv === MV.None && zipNear(world, pred.x, pred.y, pred.z)) prompt = 'Ride zipline';
        }
        const rp = performance.now() - revive.at < 200 ? revive.p : 0;
        if (inv.open && (pred.mode === PM.Dead || pred.mode === PM.Bus)) toggleInv(false);
        inv.update(pred);
        combat.update({
          s: pred, spread: heldDef ? currentSpread(pred, heldDef) : 0, fov, prompt, promptRarity, promptItem,
          revive: rp, reviveLabel: pred.act === ACT.Reviving ? 'REVIVING' : 'BEING REVIVED', scoped,
          spectating: watching ? roster[specIdx].name : null, kills: kills[selfIdx] ?? 0, cards: cards.map((c) => roster[c]?.name ?? '?'),
        }, dt);
      }

      // dynamic resolution: render fewer pixels when the frame rate dips, more when there's room
      resTimer += dt;
      if (time > 3 && resTimer > 0.75) {
        resTimer = 0;
        const minRatio = Math.min(maxRatio, 0.6);
        let next = pixelRatio;
        if (fps < 48 && pixelRatio > minRatio) next = Math.max(minRatio, pixelRatio - (fps < 30 ? 0.2 : 0.1));
        else if (fps > 58) { fastFor += 0.75; if (fastFor > 3 && pixelRatio < maxRatio) { next = Math.min(maxRatio, pixelRatio + 0.1); fastFor = 0; } }
        else fastFor = 0;
        // applied at the start of the next frame, just before drawing: resizing the canvas clears it,
        // and doing it after this frame's draw showed one blank frame (a flash of the background)
        if (Math.abs(next - pixelRatio) > 0.01) { pixelRatio = next; resizePending = true; }
      }
      // still slow at the lowest resolution? quietly drop to cheaper settings
      if (time > 6 && fps < 26 && pixelRatio <= Math.min(maxRatio, 0.6) + 0.01) { slowFor += dt; } else slowFor = 0;
      if (slowFor > 3) {
        slowFor = 0;
        if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight) (o as THREE.DirectionalLight).castShadow = false; }); }
        else if (q.treeRange > 320) q.treeRange -= 150;
      }
    }
    renderer.setAnimationLoop(frame);

    // test / debug hook
    (window as any).__dz = {
      input,
      set cam(c: typeof debugCam) { debugCam = c; },
      ground: (x: number, z: number) => surfaceAt(world, x, z, 1e4),
      /** Simulate a dropped connection (tests). */
      drop: () => (net as unknown as { ws: WebSocket | null }).ws?.close(),
      self: selfIdx, roster, actors: actors.states,
      get pred() { return pred; }, loot: lootR, cars, fx, world, chests: chestR, combat, storm,
      scene, renderer,
      get perf() { return { ...perf, ratio: pixelRatio, w: renderer.domElement.width, h: renderer.domElement.height, programs: renderer.info.programs?.length ?? 0, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }; },
      get state() { return { phase, mode: pred?.mode ?? -1, hp: pred?.hp ?? 0, shield: pred?.shield ?? 0, slot: pred?.slot ?? 0, inv: pred?.inv.map((x) => x.id) ?? [], veh: pred?.veh ?? -1, alive: aliveCount, x: selfPos.x, y: selfPos.y, z: selfPos.z, grounded: pred?.grounded ?? false, fps, pending: pending.length, visible: actors.states.filter((s) => s.visible).length, doorsOpen: !!route && performance.now() + clockOffset >= route.doorsAt, err: err.length() }; },
    };

    return {
      onMsg, onSnapshot, resync,
      dispose() {
        renderer.setAnimationLoop(null);
        removeEventListener('resize', resize); removeEventListener('beforeunload', leaveGuard); removeEventListener('keydown', invKeys, true);
        input.dispose(); actors.dispose(); lootR.clear(); offSettings();
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose(); });
        post.dispose(); renderer.dispose(); renderer.domElement.remove();
        audio.stopLoops(); audio.muffle(false); audio.setMusic(null);
        delete (window as any).__dz;
      },
    };
  }

  return {
    el: root,
    destroy() {
      disposed = true;
      offMsg(); net.onBinary = undefined;
      running?.dispose();
    },
  };
}
