import * as THREE from 'three';
import {
  DROP, PM, SIM_DT, busPos, clamp, decodeSnapshot, encodeInputs, getWorld, stepPlayer, surfaceAt, terrainAt,
  type EntSnap, type GameInit, type GamePhase, type InputCmd, type MatchFoundView, type PlayerState, type RouteView, type ServerMsg, type UserView, type World,
} from '@dropzone/shared';
import type { Net } from '../net';
import { SKINS } from '../lobby/character';
import { h, toast } from '../ui/dom';
import { Actors } from './actors';
import { buildDropship } from './dropship';
import { Hud, type HudView } from './hud';
import { Input } from './input';
import { FOG_COLOR, FOG_FAR, FOG_NEAR, buildSky } from './sky';
import { QUALITY, buildIsland, type Quality } from './terrain';

const INTERP_MS = 100;
interface Sample { t: number; x: number; y: number; z: number; yaw: number; mode: number; grounded: boolean }

function pickQuality(): Quality {
  let name = new URLSearchParams(location.search).get('q');
  try { name ??= localStorage.getItem('dz.quality'); } catch { /* storage blocked */ }
  return { ...(name === 'low' ? QUALITY.low : QUALITY.high) };
}

export function gameScreen(net: Net, _you: UserView, found: MatchFoundView, onExit: () => void) {
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
  net.send({ t: 'game_join' });

  function leave(tellServer: boolean) {
    if (disposed) return;
    if (tellServer) net.send({ t: 'leave_match' });
    onExit();
  }

  // ------------------------------------------------------------------ the running match
  function start(init: GameInit) {
    const world: World = getWorld(init.seed);
    const q = pickQuality();
    const roster = init.players, selfIdx = init.you;
    const team = roster.filter((r) => r.team === roster[selfIdx].team).map((r) => r.idx);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    let pixelRatio = Math.min(devicePixelRatio, q.pixelRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    stage.append(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(70, 1, 0.3, 9000);
    const sky = buildSky(scene, q.shadows);
    const island = buildIsland(world, q, FOG_COLOR, FOG_NEAR, FOG_FAR);
    scene.add(island.group);
    const ship = buildDropship();
    ship.root.visible = false;
    scene.add(ship.root);
    const actors = new Actors(scene, roster, selfIdx);

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
      onLeave: () => leave(true),
      onResume: () => { hud.setMenu(false); input.lock(); },
      onMarker: (x, z) => net.send(x === undefined ? { t: 'game_marker' } : { t: 'game_marker', x, z }),
      onCloseMap: () => toggleMap(false),
    });
    root.append(hud.el);

    function toggleMap(open = !hud.mapOpen) {
      hud.setMap(open);
      if (open) input.unlock(); else if (!hud.menuOpen) input.lock();
    }
    let lockLostAt = 0;
    input.onAction = (a) => {
      if (a === 'map') { if (hud.menuOpen) return; toggleMap(); }
      else if (a === 'menu') {
        if (hud.mapOpen) return toggleMap(false);
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
      if (!hud.mapOpen && !disposed) hud.setMenu(true); // Esc pressed
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
        list.push({ t: snap.time, x: e.x, y: e.y, z: e.z, yaw: e.yaw, mode: e.mode, grounded: e.grounded });
        if (list.length > 16) list.shift();
        seenTick[e.idx] = snap.tick;
      }
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

    function simStep() {
      const frozen = hud.menuOpen || hud.mapOpen;
      const cmd: InputCmd = { keys: frozen ? 0 : input.keys, yaw: Math.fround(input.yaw), pitch: Math.fround(input.pitch) };
      seq++;
      pending.push({ seq, cmd });
      if (pending.length > 180) pending.shift();
      outbox.push(cmd);
      if (pred) { prevPos.set(pred.x, pred.y, pred.z); stepPlayer(pred, cmd, world); }
      if (outbox.length >= 2) { net.sendBinary(encodeInputs(seq - outbox.length + 1, outbox)); outbox = []; }
    }

    // ---------------------------------------------------------------- render
    const selfPos = new THREE.Vector3(), camPos = new THREE.Vector3(), pivot = new THREE.Vector3(), dir = new THREE.Vector3(), proj = new THREE.Vector3();
    let camDist = 4.3, shoulder = 0.75, fov = 70;
    let acc = 0, last = performance.now(), time = 0, fps = 60, slowFor = 0;
    let debugCam: { x: number; y: number; z: number; yaw: number; pitch: number } | null = null;

    function resize() {
      const w = stage.clientWidth || innerWidth, hh = stage.clientHeight || innerHeight;
      renderer.setSize(w, hh);
      camera.aspect = w / hh; camera.updateProjectionMatrix();
    }
    addEventListener('resize', resize);
    resize();

    function project(x: number, y: number, z: number) {
      proj.set(x, y, z).project(camera);
      return { sx: (proj.x * 0.5 + 0.5) * renderer.domElement.clientWidth, sy: (-proj.y * 0.5 + 0.5) * renderer.domElement.clientHeight, show: proj.z < 1 && Math.abs(proj.x) < 1.1 && Math.abs(proj.y) < 1.1 };
    }

    function frame() {
      const nowMs = performance.now();
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
        s.mode = B.mode; s.grounded = B.grounded;
        const span = Math.max(0.001, (B.t - A.t) / 1000);
        const sp = Math.hypot(B.x - A.x, B.z - A.z) / span;
        s.speed += (sp - s.speed) * 0.25;
        s.dive = clamp((-(B.y - A.y) / span - DROP.freefallMinSpeed) / (DROP.freefallMaxSpeed - DROP.freefallMinSpeed), 0, 1);
        if (s.mode === PM.Bus) s.visible = false;
      }

      // self
      const me = st[selfIdx];
      const inBus = !pred || pred.mode === PM.Bus;
      if (pred && !inBus) {
        err.multiplyScalar(Math.exp(-dt * 12));
        selfPos.set(prevPos.x + (pred.x - prevPos.x) * alpha, prevPos.y + (pred.y - prevPos.y) * alpha, prevPos.z + (pred.z - prevPos.z) * alpha).add(err);
        me.x = selfPos.x; me.y = selfPos.y; me.z = selfPos.z;
        me.yaw = input.yaw; me.mode = pred.mode; me.grounded = pred.grounded;
        me.speed = Math.hypot(pred.vx, pred.vz);
        me.dive = clamp((-input.pitch - 0.2) / 0.9, 0, 1);
        me.visible = true;
      } else {
        me.visible = false; me.mode = PM.Bus;
        if (shipActive) selfPos.set(shipX, shipY, shipZ);
        else if (pred) selfPos.set(pred.x, pred.y, pred.z);
      }

      // camera
      const cp = Math.cos(input.pitch);
      dir.set(-Math.sin(input.yaw) * cp, Math.sin(input.pitch), -Math.cos(input.yaw) * cp);
      const air = !inBus && (me.mode === PM.Fall || me.mode === PM.Glide);
      const kCam = 1 - Math.exp(-dt * 6);
      camDist += ((inBus ? 46 : air ? 8.5 : 4.3) - camDist) * kCam;
      shoulder += ((inBus || air ? 0 : 0.75) - shoulder) * kCam;
      pivot.set(selfPos.x + Math.cos(input.yaw) * shoulder, selfPos.y + (inBus ? 4 : air ? 1.3 : 1.62), selfPos.z - Math.sin(input.yaw) * shoulder);
      camPos.copy(pivot).addScaledVector(dir, -camDist);
      camPos.y = Math.max(camPos.y, Math.max(terrainAt(world, camPos.x, camPos.z), 0) + 0.35);
      camera.position.copy(camPos);
      camera.lookAt(pivot.x + dir.x * 20, pivot.y + dir.y * 20, pivot.z + dir.z * 20);
      const wantFov = me.mode === PM.Fall && !inBus ? 76 + me.dive * 10 : 70;
      if (Math.abs(wantFov - fov) > 0.05) { fov += (wantFov - fov) * kCam; camera.fov = fov; camera.updateProjectionMatrix(); }

      if (debugCam) { // free camera for screenshots and debugging
        camPos.set(debugCam.x, debugCam.y, debugCam.z);
        camera.position.copy(camPos);
        const c2 = Math.cos(debugCam.pitch);
        camera.lookAt(camPos.x - Math.sin(debugCam.yaw) * c2, camPos.y + Math.sin(debugCam.pitch), camPos.z - Math.cos(debugCam.yaw) * c2);
      }
      sky.update(dt, camPos, debugCam ? camPos : selfPos);
      island.update(dt, camPos);
      actors.update(dt, time, camPos);
      for (const b of beams.values()) if (b.visible) (b.material as THREE.MeshBasicMaterial).opacity = 0.42 + Math.sin(time * 3) * 0.12;
      renderer.render(scene, camera);

      // HUD
      const view: HudView = {
        phase, serverNow, warmupEndsAt, route,
        self: {
          x: selfPos.x, y: selfPos.y, z: selfPos.z, yaw: input.yaw, mode: inBus ? PM.Bus : me.mode,
          height: selfPos.y - surfaceAt(world, selfPos.x, selfPos.z, Infinity), vy: pred?.vy ?? 0, speed: me.speed,
        },
        alive: roster.length - gone.size,
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
      };
      hud.update(view, dt);

      // slow computer? quietly drop to cheaper settings
      if (time > 4 && fps < 26) { slowFor += dt; } else slowFor = 0;
      if (slowFor > 3) {
        slowFor = 0;
        if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scene.traverse((o) => { if ((o as THREE.DirectionalLight).isDirectionalLight) (o as THREE.DirectionalLight).castShadow = false; }); }
        else if (pixelRatio > 1) { pixelRatio = Math.max(1, pixelRatio - 0.5); renderer.setPixelRatio(pixelRatio); resize(); }
        else if (q.treeRange > 320) q.treeRange -= 150;
      }
    }
    renderer.setAnimationLoop(frame);

    // test / debug hook
    (window as any).__dz = {
      input,
      set cam(c: typeof debugCam) { debugCam = c; },
      self: selfIdx, roster, actors: actors.states,
      get state() { return { phase, mode: pred?.mode ?? -1, x: selfPos.x, y: selfPos.y, z: selfPos.z, grounded: pred?.grounded ?? false, fps, pending: pending.length, visible: actors.states.filter((s) => s.visible).length, doorsOpen: !!route && performance.now() + clockOffset >= route.doorsAt, err: err.length() }; },
    };

    return {
      onMsg, onSnapshot, resync,
      dispose() {
        renderer.setAnimationLoop(null);
        removeEventListener('resize', resize);
        input.dispose(); actors.dispose();
        scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh || (o as THREE.InstancedMesh).isInstancedMesh) m.geometry?.dispose(); });
        renderer.dispose(); renderer.domElement.remove();
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
