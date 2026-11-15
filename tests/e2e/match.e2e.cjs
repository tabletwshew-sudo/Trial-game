// End-to-end: guest -> queue -> warm-up island -> dropship -> jump -> glide -> land.
// Needs the server running with QUEUE_TIMEOUT_S=2 WARMUP_S=14 (see docs/phase-3.md).
const { chromium } = require('playwright');
const S = process.argv[2] || 'tests/e2e/out', URL = (process.env.E2E_URL || 'http://localhost:8099/') + (process.env.E2E_Q ? `?q=${process.env.E2E_Q}` : '');
require('fs').mkdirSync(S, { recursive: true });
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errs.push(m.text()));
  const st = () => p.evaluate(() => window.__dz && window.__dz.state);
  const until = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const s = await st(); if (s && fn(s)) return s; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label + ' ' + JSON.stringify(s)); await p.waitForTimeout(150); } };
  const shot = (n) => p.screenshot({ path: `${S}/${n}.png` });
  const log = {};

  await p.goto(URL); await p.click('button:has-text("PLAY AS GUEST")'); await p.waitForSelector('.play-panel');
  await p.click('.btn-play');
  await p.waitForSelector('.game-loading'); await p.waitForTimeout(300); await shot('10-loading');
  await p.waitForSelector('.hud', { timeout: 30000 });
  log.warmup = await until((s) => s.mode === 0 && s.visible > 40, 15000, 'warmup');
  await p.waitForTimeout(1500); await shot('11-warmup');
  await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(1500);
  await shot('12-warmup-run');
  const moved = await st(); await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft');
  log.ranMetres = Math.hypot(moved.x - log.warmup.x, moved.z - log.warmup.z).toFixed(1);

  await until((s) => s.phase === 'bus', 25000, 'bus'); await p.waitForTimeout(2500); await shot('13-dropship');
  await p.keyboard.press('KeyM'); await p.waitForTimeout(600);
  await p.mouse.click(720, 420); await p.waitForTimeout(500); await shot('14-map'); await p.keyboard.press('KeyM');
  await until((s) => s.doorsOpen, 15000, 'doors'); await until((s) => Math.hypot(s.x, s.z) < 620, 40000, 'over island');
  await p.keyboard.press('Space');
  await until((s) => s.mode === 2, 5000, 'freefall');
  // steer toward the nearest town centre-ish (the middle of the island)
  const aim = () => p.evaluate(() => { const s = window.__dz.state; window.__dz.input.yaw = Math.atan2(s.x - (-140), s.z - 40); });
  await aim();
  await p.evaluate(() => { window.__dz.input.pitch = -0.5; }); await p.keyboard.down('KeyW');
  await p.waitForTimeout(1200); await shot('15-freefall');
  await p.evaluate(() => { window.__dz.input.pitch = -1.25; }); await p.waitForTimeout(1500); await shot('16-dive');
  await until((s) => s.mode === 3, 20000, 'glide');
  await aim();
  await p.evaluate(() => { window.__dz.input.pitch = -0.35; }); await p.waitForTimeout(1500); await shot('17-glide');
  log.landed = await until((s) => s.mode === 0 && s.grounded, 40000, 'land');
  await p.keyboard.up('KeyW'); await p.waitForTimeout(1200);
  await p.evaluate(() => { window.__dz.input.pitch = -0.12; }); await p.waitForTimeout(600); await shot('18-landed');
  await p.keyboard.down('KeyW'); await p.keyboard.down('ShiftLeft'); await p.waitForTimeout(2500); await shot('19-running');
  await p.keyboard.up('KeyW'); await p.keyboard.up('ShiftLeft');
  log.end = await st();
  // leave -> back in the lobby
  await p.keyboard.press('Escape'); await p.waitForSelector('.pause.open'); await shot('20-pause');
  await p.click('button:has-text("LEAVE MATCH")'); await p.waitForSelector('.play-panel');
  log.backInLobby = true; log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await b.close();
  if (errs.length) process.exit(2);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
