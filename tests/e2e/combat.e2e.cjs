// Combat end-to-end on the warm-up island: aim at a bot and shoot it, pick up loot,
// switch slots, get in a car and drive. Start the server with QUEUE_TIMEOUT_S=2 WARMUP_S=300.
const { chromium } = require('playwright');
const S = process.argv[2] || 'tests/e2e/out', URL = (process.env.E2E_URL || 'http://localhost:8099/') + (process.env.E2E_Q ? `?q=${process.env.E2E_Q}` : '');
require('fs').mkdirSync(S, { recursive: true });
const K = { F: 1, SPRINT: 32, FIRE: 128, ADS: 256, USE: 1024 };
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 1 })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errs.push(m.text()));
  const st = () => p.evaluate(() => window.__dz && window.__dz.state);
  const shot = (n) => p.screenshot({ path: `${S}/${n}.png` });
  const until = async (fn, ms, label) => { const t0 = Date.now(); for (;;) { const s = await st(); if (s && await fn(s)) return s; if (Date.now() - t0 > ms) throw new Error('timeout: ' + label + ' ' + JSON.stringify(s)); await p.waitForTimeout(120); } };
  const log = {};

  await p.goto(URL); await p.click('button:has-text("PLAY AS GUEST")'); await p.waitForSelector('.play-panel');
  await p.click('.btn-play'); await p.waitForSelector('.hud', { timeout: 60000 });
  await until((s) => s.mode === 0 && s.visible > 40 && s.inv[0] > 0, 20000, 'loadout');
  // count hit markers / damage numbers as they appear
  await p.evaluate(() => { window.__hits = 0; window.__nums = 0; new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('dnum')) window.__nums++; }).observe(document.querySelector('.dmg-nums'), { childList: true }); new MutationObserver(() => { if (document.querySelector('.hitmark.show')) window.__hits++; }).observe(document.querySelector('.hitmark'), { attributes: true }); });
  await p.waitForTimeout(800); await shot('30-holding-weapon');

  // ---- shoot the nearest bot (walk up close first so every gun is in range)
  const aimAtNearest = () => p.evaluate(() => {
    const dz = window.__dz, me = dz.pred, A = dz.actors;
    let best = -1, bd = 1e9;
    A.forEach((a, i) => { if (i === dz.self || !a.visible || a.mode !== 0) return; const d = Math.hypot(a.x - me.x, a.z - me.z); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return null;
    const a = A[best];
    const ox = me.x + Math.cos(dz.input.yaw) * 0.75, oz = me.z - Math.sin(dz.input.yaw) * 0.75, oy = me.y + 1.62;
    dz.input.yaw = Math.atan2(-(a.x - ox), -(a.z - oz));
    dz.input.pitch = Math.atan2(a.y + 1.1 - oy, Math.hypot(a.x - ox, a.z - oz));
    return { idx: best, dist: bd };
  });
  let target = await aimAtNearest();
  for (let i = 0; i < 40 && target && target.dist > 6; i++) { await p.keyboard.down('KeyW'); await p.waitForTimeout(150); target = await aimAtNearest(); }
  await p.keyboard.up('KeyW');
  log.targetDist = target && target.dist.toFixed(1);
  for (let i = 0; i < 24; i++) {
    await aimAtNearest();
    await p.evaluate((F) => { window.__dz.input.keys |= F; }, K.FIRE);
    await p.waitForTimeout(60);
    await p.evaluate((F) => { window.__dz.input.keys &= ~F; }, K.FIRE);
    await p.waitForTimeout(110);
    if (i === 2) await shot('31-firing');
  }
  await p.waitForTimeout(300); await shot('32-after-fire');
  log.hits = await p.evaluate(() => window.__hits); log.damageNumbers = await p.evaluate(() => window.__nums);
  log.feed = await p.$$eval('.feed-line', (els) => els.map((e) => e.textContent));

  // ---- aim down sights
  await p.evaluate((A) => { window.__dz.input.keys |= A; }, K.ADS); await p.waitForTimeout(700); await shot('33-ads');
  await p.evaluate((A) => { window.__dz.input.keys &= ~A; }, K.ADS);

  // ---- walk to the nearest weapon on the ground and pick it up
  const before = (await st()).inv.filter((x) => x).length;
  const goTo = async (getTarget, close, label) => {
    for (let i = 0; i < 120; i++) {
      const r = await p.evaluate(getTarget);
      if (!r) throw new Error('no ' + label);
      if (r.dist < close) { await p.keyboard.up('KeyW'); return r; }
      await p.keyboard.down('KeyW');
      await p.waitForTimeout(100);
    }
    throw new Error('could not reach ' + label);
  };
  await goTo(() => {
    const dz = window.__dz, me = dz.pred;
    let best = null, bd = 1e9;
    for (const it of dz.loot.items.values()) { const d = Math.hypot(it.x - me.x, it.z - me.z); if (it.item <= 15 && d < bd) { bd = d; best = it; } }
    if (!best) return null;
    dz.input.yaw = Math.atan2(-(best.x - me.x), -(best.z - me.z)); dz.input.pitch = -0.3;
    return { dist: bd, item: best.item };
  }, 1.4, 'loot');
  await p.waitForTimeout(250); await shot('34-pickup-prompt');
  log.prompt = await p.$eval('.prompt', (e) => e.textContent);
  await p.keyboard.press('KeyE'); await p.waitForTimeout(600);
  log.invBefore = before; log.invAfter = (await st()).inv.filter((x) => x).length;
  await p.keyboard.press('Digit2'); await p.waitForTimeout(400);
  log.slotAfterKey2 = (await st()).slot;
  await shot('35-hotbar');

  // ---- get in a car and drive
  await goTo(() => {
    const dz = window.__dz, me = dz.pred;
    let best = null, bd = 1e9;
    for (const [id, c] of dz.cars.cars) { const d = Math.hypot(c.root.position.x - me.x, c.root.position.z - me.z); if (d < bd) { bd = d; best = c; } }
    if (!best) return null;
    dz.input.yaw = Math.atan2(-(best.root.position.x - me.x), -(best.root.position.z - me.z));
    return { dist: bd };
  }, 2.8, 'car');
  await p.keyboard.press('KeyE');
  const inCar = await until((s) => s.veh >= 0 && s.mode === 4, 3000, 'enter car');
  await p.keyboard.down('KeyW'); await p.waitForTimeout(1800); await shot('36-driving'); await p.waitForTimeout(800);
  await p.keyboard.up('KeyW');
  const drove = await st();
  log.droveMetres = Math.hypot(drove.x - inCar.x, drove.z - inCar.z).toFixed(1);
  await p.keyboard.press('KeyE');
  await until((s) => s.mode === 0 && s.veh === -1, 3000, 'exit car');
  await p.waitForTimeout(500); await shot('37-out-of-car');

  log.errs = errs;
  console.log(JSON.stringify(log, null, 1));
  await b.close();
  const ok = log.hits > 0 && log.invAfter >= log.invBefore && log.slotAfterKey2 === 1 && Number(log.droveMetres) > 5 && !errs.length;
  if (!ok) { console.error('FAIL: expectations not met'); process.exit(2); }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
