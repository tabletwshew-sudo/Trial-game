// Touch controls end-to-end on an emulated phone (landscape): the joystick moves you, dragging on
// the right looks round, the fire button fires, tapping a hotbar slot switches to it, and the
// layout editor moves a button and saves it. Start the server with QUEUE_TIMEOUT_S=2 WARMUP_S=300.
const { chromium, devices } = require('playwright');
const S = process.argv[2] || 'tests/e2e/out', URL = (process.env.E2E_URL || 'http://localhost:8099/') + '?q=low';
require('fs').mkdirSync(S, { recursive: true });
const K = { F: 1, SPRINT: 32, FIRE: 128 };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const { defaultBrowserType, ...phone } = devices['Pixel 7 landscape'];
  const ctx = await b.newContext({ ...phone });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errs.push(m.text()));
  const st = () => p.evaluate(() => window.__dz && window.__dz.state);
  const shot = (n) => p.screenshot({ path: `${S}/${n}.png` });
  const until = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const s = await st(); if (s && await fn(s)) return s; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label + ' ' + JSON.stringify(s)); await p.waitForTimeout(120); } };
  // real multi-touch through the DevTools protocol (the page sees pointer events with pointerType "touch")
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y, id]) => ({ x, y, id, radiusX: 8, radiusY: 8, force: 1 })) });
  const vw = phone.viewport.width, vh = phone.viewport.height;
  const btnAt = (id) => p.$eval(`.tb-${id}`, (e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
  const log = { viewport: `${vw}x${vh}` };

  await p.goto(URL); await shot('70-mobile-login');
  await p.click('button:has-text("PLAY AS GUEST")'); await p.waitForSelector('.play-panel');
  await p.waitForTimeout(600); await shot('71-mobile-lobby');
  await p.click('.btn-play'); await p.waitForSelector('.hud', { timeout: 60000 });
  await until((s) => s.mode === 0 && s.inv[0] > 0, 30000, 'loadout');
  await p.waitForTimeout(1200);
  log.touchUi = await p.$eval('.touch-ui', (e) => e.classList.contains('on'));
  log.bodyTouch = await p.evaluate(() => document.body.classList.contains('touch'));
  await shot('72-touch-hud');

  // ---- joystick: thumb down on the left, push all the way up -> forward + sprint
  const s0 = await st();
  const jx = vw * 0.15, jy = vh * 0.7;
  await touch('touchStart', [[jx, jy, 1]]);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', [[jx, jy - i * 14, 1]]); await p.waitForTimeout(16); }
  log.stickKeys = await p.evaluate(() => window.__dz.input.keys);
  // ---- second finger: drag on the right to look round while running
  const yaw0 = await p.evaluate(() => window.__dz.input.yaw);
  await touch('touchStart', [[jx, jy - 84, 1], [vw * 0.6, vh * 0.35, 2]]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [[jx, jy - 84, 1], [vw * 0.6 + i * 10, vh * 0.35, 2]]); await p.waitForTimeout(16); }
  log.yawChange = +(await p.evaluate((y0) => window.__dz.input.yaw - y0, yaw0)).toFixed(3);
  await shot('73-running-and-looking');
  await touch('touchEnd', [[jx, jy - 84, 1]]);
  await p.waitForTimeout(1200);
  const s1 = await st();
  await touch('touchEnd', []);
  log.moved = +Math.hypot(s1.x - s0.x, s1.z - s0.z).toFixed(1);
  log.keysAfterRelease = await p.evaluate(() => window.__dz.input.keys);

  // ---- fire button: held = fire bit
  const [fx, fy] = await btnAt('fire');
  await touch('touchStart', [[fx, fy, 3]]); await p.waitForTimeout(80);
  log.fireKeys = await p.evaluate(() => window.__dz.input.keys);
  await shot('74-firing');
  await touch('touchEnd', []);

  // ---- hotbar: tap the pickaxe tile, then the first slot
  const tiles = await p.$$eval('.slot-tile', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }));
  await touch('touchStart', [[tiles[0][0], tiles[0][1], 4]]); await touch('touchEnd', []);
  await until((s) => s.slot === 5, 4000, 'pickaxe from the hotbar');
  log.pickaxeSlot = (await st()).slot;
  await touch('touchStart', [[tiles[1][0], tiles[1][1], 5]]); await touch('touchEnd', []);
  await until((s) => s.slot === 0, 4000, 'slot 1 from the hotbar');
  log.slotAfter = (await st()).slot;

  // ---- menu button opens the pause menu, which has the layout editor
  const [mx, my] = await btnAt('menu');
  await touch('touchStart', [[mx, my, 6]]); await touch('touchEnd', []);
  await p.waitForTimeout(300);
  log.menuOpen = await p.$eval('.pause', (e) => e.classList.contains('open'));
  log.touchHiddenInMenu = await p.$eval('.touch-ui', (e) => !e.classList.contains('on'));
  await shot('75-pause-menu');
  await p.tap('button:has-text("EDIT TOUCH LAYOUT")');
  await p.waitForTimeout(300);
  log.editing = await p.$eval('.touch-ui', (e) => e.classList.contains('editing') && e.classList.contains('on'));

  // ---- editor: drag the jump button left, make it bigger, hide the emote... then save
  const [jbx, jby] = await btnAt('jump');
  await touch('touchStart', [[jbx, jby, 7]]);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[jbx - i * 12, jby - i * 4, 7]]); await p.waitForTimeout(16); }
  await touch('touchEnd', []);
  await p.tap('.touch-editbar button:has-text("+")'); await p.tap('.touch-editbar button:has-text("+")');
  const [jbx2, jby2] = await btnAt('jump');
  log.jumpMoved = [+(jbx2 - jbx).toFixed(0), +(jby2 - jby).toFixed(0)];
  log.jumpSize = await p.$eval('.tb-jump', (e) => e.getBoundingClientRect().width);
  await shot('76-layout-editor');
  await p.tap('.touch-editbar button:has-text("SAVE")');
  await p.waitForTimeout(300);
  log.saved = await p.evaluate(() => JSON.parse(localStorage.getItem('dz.touchLayout') || 'null')?.btn?.jump);
  log.backInGame = await p.evaluate(() => window.__dz.input.locked && !document.querySelector('.pause.open'));
  await shot('77-after-save');

  // ---- held upright: ask to turn the phone
  await p.setViewportSize({ width: vh, height: vw }); await p.waitForTimeout(400);
  log.rotateHint = await p.$eval('.touch-rotate', (e) => getComputedStyle(e).display !== 'none');
  await shot('78-portrait');
  await p.setViewportSize({ width: vw, height: vh });

  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await b.close();
  const ok = log.touchUi && (log.stickKeys & K.F) && (log.stickKeys & K.SPRINT) && Math.abs(log.yawChange) > 0.05 && log.moved > 3 && (log.fireKeys & K.FIRE)
    && log.pickaxeSlot === 5 && log.slotAfter === 0 && log.menuOpen && log.editing && log.jumpMoved[0] < -60 && log.saved && log.backInGame && log.rotateHint && !errs.length;
  if (!ok) { console.error('FAIL'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
