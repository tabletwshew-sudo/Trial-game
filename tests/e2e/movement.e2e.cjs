// Movement end-to-end on the warm-up island's practice course: slide, vault the fences,
// mantle the crate, climb the tower ladder, ride the zipline down, launch off the spring pad.
// Checks the server agrees with the client's prediction the whole way.
// Start the server with QUEUE_TIMEOUT_S=2 WARMUP_S=300.
const { chromium } = require('playwright');
const S = process.argv[2] || 'tests/e2e/out', URL = (process.env.E2E_URL || 'http://localhost:8099/') + (process.env.E2E_Q ? `?q=${process.env.E2E_Q}` : '');
require('fs').mkdirSync(S, { recursive: true });
const X = -1450, Z = -1450;
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: +(process.env.E2E_W || 960), height: +(process.env.E2E_H || 540) }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errs.push(m.text()));
  const st = () => p.evaluate(() => window.__dz && window.__dz.state);
  const pred = () => p.evaluate(() => { const s = window.__dz.pred; return s && { x: s.x, y: s.y, z: s.z, mode: s.mode, mv: s.mv, grounded: s.grounded, vy: s.vy }; });
  // (a screenshot freezes the page for a moment in a software-rendered browser, the server sees no input
  //  and keeps your physics running, so prediction corrections right after a shot are expected)
  const shot = async (n) => { await p.evaluate(() => { window.__shotAt = 1e15; }); await p.screenshot({ path: `${S}/${n}.png` }); await p.evaluate(() => { window.__shotAt = performance.now(); }); };
  const until = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const s = await st(); if (s && await fn(s)) return s; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label + ' ' + JSON.stringify(s)); await p.waitForTimeout(120); } };
  const keys = (on, ...k) => Promise.all(k.map((c) => (on ? p.keyboard.down(c) : p.keyboard.up(c))));
  const look = (yaw, pitch = -0.15) => p.evaluate(([y, pt]) => { window.__dz.input.yaw = y; window.__dz.input.pitch = pt; }, [yaw, pitch]);
  const yawTo = (x, z, s) => Math.atan2(-(x - s.x), -(z - s.z));
  // watch movement states and prediction error in the page, every frame
  const startWatch = () => p.evaluate(() => {
    window.__mv = { seen: {}, modes: {}, maxErr: 0, maxY: -1e9, stalls: 0 };
    // a frame longer than the server's half-second grace (software rendering hiccups) means the server
    // moved you without your inputs; the correction that follows is expected, so don't count it
    let last = performance.now(), stallAt = -1e9;
    const tick = () => { const dz = window.__dz, s = dz.pred, now = performance.now(); if (now - last > 450) { stallAt = now; window.__mv.stalls++; } last = now;
      if (s) {
        window.__mv.seen[s.mv] = 1; window.__mv.modes[s.mode] = 1; window.__mv.maxY = Math.max(window.__mv.maxY, s.y);
        if (now - stallAt > 1500 && now - (window.__shotAt ?? -1e9) > 2000) window.__mv.maxErr = Math.max(window.__mv.maxErr, dz.state.err);
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  const watch = () => p.evaluate(() => window.__mv);
  /** Walk to a spot: sprint while far, walk when close, then short taps to line up exactly. */
  const goTo = async (x, z, close = 1.2, sprint = true) => {
    for (let i = 0; i < 300; i++) {
      const s = await pred();
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < close) break;
      await look(yawTo(x, z, s));
      if (d > 3) {
        await keys(true, 'KeyW'); await keys(sprint && d > 6, 'ShiftLeft');
        if (i % 30 === 29) await p.keyboard.press('Space'); // hop anything in the way
        await p.waitForTimeout(80);
      } else {
        await keys(false, 'ShiftLeft');
        await keys(true, 'KeyW'); await p.waitForTimeout(d > 1.5 ? 90 : 35); await keys(false, 'KeyW');
        // wait until we've actually stopped
        for (let k = 0; k < 20; k++) { const v = await p.evaluate(() => Math.hypot(window.__dz.pred.vx, window.__dz.pred.vz)); if (v < 0.2) break; await p.waitForTimeout(30); }
      }
    }
    await keys(false, 'KeyW', 'ShiftLeft');
    await p.waitForTimeout(150);
    return pred();
  };
  const log = {};
  const T0 = Date.now();
  const stage = async (n) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${n}`, JSON.stringify(await pred().catch(() => null)), JSON.stringify(await st().then((q) => q && { fps: Math.round(q.fps), err: q.err })));

  await p.goto(URL); await p.click('button:has-text("PLAY AS GUEST")'); await p.waitForSelector('.play-panel');
  await p.click('.btn-play'); await p.waitForSelector('.hud', { timeout: 60000 });
  await until((s) => s.mode === 0 && s.visible > 20, 20000, 'warm-up');
  await p.evaluate(() => document.querySelector('canvas').requestPointerLock?.());
  await startWatch();

  await stage('slide: sprint, then cr');
  // ---- slide: sprint, then crouch
  const poll = async (fn, ms) => { const t0 = Date.now(); for (;;) { const q = await pred(); if (fn(q)) return q; if (Date.now() - t0 > ms) return null; await p.waitForTimeout(40); } };
  const speedOf = () => p.evaluate(() => Math.hypot(window.__dz.pred.vx, window.__dz.pred.vz));
  let s = await goTo(X - 5, Z + 30, 2);
  await look(0);
  await keys(true, 'KeyW', 'ShiftLeft');
  for (let i = 0; i < 100 && (await speedOf()) < 7; i++) await p.waitForTimeout(50);
  await keys(true, 'KeyC');
  if (await poll((q) => q.mv === 1, 4000)) { await p.waitForTimeout(350); await shot('70-slide'); }
  await poll((q) => q.mv !== 1, 6000);
  await keys(false, 'KeyC', 'KeyW', 'ShiftLeft');
  log.slide = (await watch()).seen[1] === 1;

  await stage('vault the fence row');
  // ---- vault the fence row (fences at z = Z-30, -35, -40, x = X+4)
  s = await goTo(X + 4, Z - 24, 1.0);
  await look(0, -0.1);
  await keys(true, 'KeyW', 'ShiftLeft');
  let hurdleShot = false;
  for (let i = 0; i < 60; i++) {
    const q = await pred();
    const next = [Z - 30, Z - 35, Z - 40].find((fz) => q.z > fz + 0.2);
    if (next !== undefined && q.z - next < 1.5 && q.mv === 0) await p.keyboard.press('Space');
    if (q.mv === 3 && !hurdleShot) { await shot('71-hurdle'); hurdleShot = true; }
    if (q.z < Z - 43) break;
    await p.waitForTimeout(40);
  }
  await keys(false, 'KeyW', 'ShiftLeft');
  log.hurdle = (await watch()).seen[3] === 1; log.pastFences = (await pred()).z < Z - 41;

  await stage('mantle the crate');
  // ---- mantle the crate (X-12, Z-26, 1.5 m)
  s = await goTo(X - 12, Z - 21, 0.8, false);
  await look(0, -0.1);
  await keys(true, 'KeyW'); await p.waitForTimeout(500); await p.keyboard.press('Space'); await p.waitForTimeout(180); await shot('72-mantle');
  await p.waitForTimeout(400); await keys(false, 'KeyW');
  s = await pred(); log.mantle = (await watch()).seen[2] === 1; log.afterMantle = [+(s.x - X).toFixed(1), +s.y.toFixed(2), +(s.z - Z).toFixed(1)];

  await stage('climb the tower ladder');
  // ---- climb the tower ladder (south face of the tower at X+22, Z-22)
  s = await goTo(X + 22, Z - 16.5, 0.5, false);
  await look(0, 0.2);
  await keys(true, 'KeyW');
  if (await poll((q) => q.mv === 4, 8000)) { await poll((q) => q.y > 8, 8000); await shot('73-climb'); }
  await poll((q) => q.grounded && q.y > 10, 12000);
  await p.waitForTimeout(200);
  await keys(false, 'KeyW');
  s = await pred(); log.climb = (await watch()).seen[4] === 1; log.roofY = +s.y.toFixed(2);

  await stage('ride the zipline from ');
  // ---- ride the zipline from the roof
  await look(Math.atan2(-(X + 34 - s.x), -(Z + 28 - s.z)), -0.1);
  await p.waitForTimeout(400); await shot('74-zip-prompt');
  log.zipPrompt = await p.$eval('.prompt', (e) => e.textContent).catch(() => '');
  await p.keyboard.press('KeyE');
  if (await poll((q) => q.mode === 8, 4000)) { await p.waitForTimeout(500); await shot('75-zipline'); }
  log.zip = (await watch()).modes[8] === 1;
  await poll((q) => q.mode === 0 && q.grounded, 30000);
  s = await pred(); log.zipEnd = [+(s.x - X).toFixed(1), +(s.z - Z).toFixed(1)];

  await stage('spring pad');
  // ---- spring pad (X-30, Z+10)
  await goTo(X - 30, Z + 16, 1.5, false);
  // walk straight at the middle of the pad
  await keys(true, 'KeyW');
  for (let i = 0; i < 150; i++) { const q = await pred(); if (q.mv === 5) break; await look(yawTo(X - 30, Z + 10, q), -0.1); await p.waitForTimeout(40); }
  if (await poll((q) => q.mv === 5, 3000)) { await keys(false, 'KeyW'); await poll((q) => q.vy < 8, 5000); await shot('76-launch'); }
  await keys(false, 'KeyW');
  if (await poll((q) => q.mode === 3, 8000)) { await p.waitForTimeout(600); await shot('77-pad-glide'); }
  const w = await watch();
  log.launched = w.seen[5] === 1 && w.modes[3] === 1;
  await poll((q) => q.mode === 0 && q.grounded, 40000);
  log.hpAfterPad = (await st()).hp;
  log.maxPredictionError = +(await watch()).maxErr.toFixed(3); log.stalls = (await watch()).stalls;

  await stage('look at the real islan');
  // ---- look at the real island's ladders, ziplines and pads with the debug camera
  const spots = await p.evaluate(() => {
    const w = window.__dz.world;
    const L = w.ladders.find((l) => l.y1 - l.y0 > 5), Zp = w.zips[0], P = w.pads[0];
    return { L, Zp, P };
  });
  const cam = (x, y, z, yaw, pitch) => p.evaluate((c) => { window.__dz.cam = c; }, { x, y, z, yaw, pitch });
  if (spots.L) { const L = spots.L; await cam(L.x + L.nx * 7 + L.nz * 3, L.y0 + 3.5, L.z + L.nz * 7 - L.nx * 3, Math.atan2(L.nx * 7 + L.nz * 3, L.nz * 7 - L.nx * 3), 0.05); await p.waitForTimeout(1500); await shot('78-ladder'); }
  if (spots.Zp) { const q = spots.Zp; const dx = q.bx - q.ax, dz = q.bz - q.az, l = Math.hypot(dx, dz); await cam(q.ax - (dx / l) * 9 + (dz / l) * 4, q.ay + 2, q.az - (dz / l) * 9 - (dx / l) * 4, Math.atan2(-(dx / l * 9 - dz / l * 4), -(dz / l * 9 + dx / l * 4)), -0.05); await p.waitForTimeout(1500); await shot('79-zipline-pole'); }
  if (spots.P) { const q = spots.P; await cam(q.x + 4, q.y + 2.5, q.z + 4, Math.PI / 4, -0.35); await p.waitForTimeout(1500); await shot('80-pad'); }
  await p.evaluate(() => { window.__dz.cam = null; });

  log.errors = errs;
  console.log(JSON.stringify(log, null, 1));
  await b.close();
  const ok = log.slide && log.hurdle && log.mantle && log.climb && log.zip && log.launched && log.maxPredictionError < 0.5 && !errs.length;
  if (!ok) { console.error('MOVEMENT E2E FAILED'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
