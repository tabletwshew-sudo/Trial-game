// Drop the connection in the middle of a match: the client reconnects, rejoins the same match
// and keeps playing (same player, snapshots flowing, prediction in sync).
const { chromium } = require('playwright');
const URL = (process.env.E2E_URL || 'http://localhost:8099/') + '?q=low';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 960, height: 540 } })).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const st = () => p.evaluate(() => window.__dz && window.__dz.state);
  await p.goto(URL); await p.click('button:has-text("PLAY AS GUEST")'); await p.waitForSelector('.play-panel');
  await p.click('.btn-play'); await p.waitForSelector('.hud', { timeout: 90000 });
  for (;;) { const s = await st(); if (s && s.mode === 0) break; await p.waitForTimeout(300); }
  const before = await p.evaluate(() => ({ self: window.__dz.self, name: window.__dz.roster[window.__dz.self].name }));
  await p.keyboard.down('KeyW'); await p.waitForTimeout(1500);
  const s0 = await st();
  await p.evaluate(() => window.__dz.drop());
  await p.waitForTimeout(4000);
  await p.keyboard.up('KeyW');
  // after reconnecting, the controls still drive the same player (try a few directions in case
  // something on the warm-up island is in the way)
  let moved = 0, s2 = await st();
  for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const a = await st();
    await p.evaluate((y) => { window.__dz.input.yaw = y; }, yaw);
    await p.keyboard.down('KeyW'); await p.waitForTimeout(1200); await p.keyboard.up('KeyW');
    s2 = await st();
    moved = Math.max(moved, Math.hypot(s2.x - a.x, s2.z - a.z));
    if (moved > 2) break;
  }
  const after = await p.evaluate(() => ({ self: window.__dz.self, name: window.__dz.roster[window.__dz.self].name }));
  const log = { before, after, mode: s2.mode, moved: +moved.toFixed(1), err: +s2.err.toFixed(3), visible: s2.visible, errs };
  console.log(JSON.stringify(log));
  await b.close();
  if (after.name !== before.name || s2.mode !== 0 || moved < 1 || s2.visible < 10 || errs.length) { console.error('RECONNECT E2E FAILED'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
