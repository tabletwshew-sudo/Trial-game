const { chromium } = require('playwright');
const S = process.argv[2] || 'tests/e2e/out', URL = process.env.E2E_URL || 'http://localhost:8099/';
require('fs').mkdirSync(S, { recursive: true });
let dbg = () => {};
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const errs = [];
  const mk = async () => { const c = await b.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1 }); const p = await c.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !/fonts\.g/.test(m.text()) && errs.push(m.text())); return p; };
  const A = await mk(), B = await mk();
  dbg = async () => { console.error('errs', errs); await A.screenshot({ path: `${S}/fail-A.png` }); await B.screenshot({ path: `${S}/fail-B.png` }); };
  const register = async (p, name) => {
    await p.goto(URL); await p.waitForSelector('.login-card');
    await p.click('text=New here? Create an account');
    await p.fill('input[placeholder=Username]', name); await p.fill('input[placeholder=Password]', 'secret123');
    await p.click('button:has-text("CREATE ACCOUNT")');
    await p.waitForSelector('.play-panel'); await p.waitForTimeout(1200);
  };
  await A.goto(URL); await A.waitForSelector('.login-card'); await A.waitForTimeout(600);
  await A.screenshot({ path: `${S}/01-login.png` });
  await register(A, 'Maya'); await register(B, 'Jordan');
  await A.screenshot({ path: `${S}/02-lobby-solo.png` });

  // bad login check
  // friends: A adds B
  await A.click('.friends-btn'); await A.fill('.addrow input', 'jordan'); await A.click('.addrow button');
  await B.waitForSelector('.friends-btn .badge'); await B.click('.friends-btn');
  await B.click('.friend.req button:has-text("Accept")');
  await A.waitForSelector('.friend.lobby'); await A.screenshot({ path: `${S}/03-friends.png` });
  // invite
  await A.click('.friend.lobby button:has-text("Invite")');
  await B.waitForSelector('.invite'); await B.screenshot({ path: `${S}/04-invite.png` });
  await B.click('.invite button:has-text("Join")');
  await A.waitForFunction(() => document.querySelectorAll('.slot:not(.empty)').length === 2);
  await A.click('.friends-head .x');
  await B.click('.btn-play'); // ready up
  await A.waitForSelector('.nametag.ready + .nametag.ready, .nametag.ready ~ .nametag.ready');
  await A.waitForTimeout(1500);
  await A.screenshot({ path: `${S}/05-party-ready.png` });
  await B.screenshot({ path: `${S}/05b-member-view.png` });
  // locker
  await A.click('.tabs button:has-text("LOCKER")'); await A.click('.skin >> nth=3'); await A.waitForTimeout(1800);
  await A.screenshot({ path: `${S}/06-locker.png` });
  await A.click('.tabs button:has-text("PLAY")'); await A.waitForTimeout(400);
  // queue
  await A.click('.btn-play'); await A.waitForSelector('.btn-play.searching'); await A.waitForTimeout(700);
  await A.screenshot({ path: `${S}/07-queue.png` });
  // both players load into the SAME match, on the same team
  await A.waitForSelector('.hud', { timeout: 60000 }); await B.waitForSelector('.hud', { timeout: 60000 });
  const team = await A.$$eval('.mate b', els => els.map(e => e.textContent));
  const stats = (await A.$eval('.alive b', e => e.textContent)) + ' players';
  await A.waitForFunction(() => window.__dz && window.__dz.state.mode === 0 && window.__dz.state.visible > 40);
  await B.waitForFunction(() => window.__dz && window.__dz.state.mode === 0 && window.__dz.state.visible > 40);
  // A runs; B must see A at (nearly) the same place A thinks they are
  await A.keyboard.down('KeyW'); await A.keyboard.down('ShiftLeft'); await A.waitForTimeout(1500);
  await A.keyboard.up('KeyW'); await A.keyboard.up('ShiftLeft'); await A.waitForTimeout(700);
  const a = await A.evaluate(() => ({ idx: window.__dz.self, ...window.__dz.state }));
  const seen = await B.evaluate((idx) => { const s = window.__dz.actors[idx]; return { x: s.x, z: s.z, visible: s.visible, mates: document.querySelectorAll('.mate').length }; }, a.idx);
  const seenGap = Math.hypot(seen.x - a.x, seen.z - a.z);
  if (!seen.visible || seenGap > 1.5 || seen.mates !== 4) throw new Error('players out of sync: ' + JSON.stringify({ a, seen }));
  await B.screenshot({ path: `${S}/09-b-sees-a.png` });
  // A leaves; back in the lobby, still in the party. B keeps playing.
  await A.keyboard.press('Escape'); await A.waitForSelector('.pause.open'); await A.click('button:has-text("LEAVE MATCH")');
  await A.waitForSelector('.play-panel');
  await A.waitForFunction(() => document.querySelectorAll('.slot:not(.empty)').length === 2);
  await B.waitForFunction((idx) => !window.__dz.actors[idx].visible, a.idx);
  await A.reload(); await A.waitForSelector('.play-panel');
  const persisted = await A.$eval('.chip.me', e => e.textContent);
  console.log(JSON.stringify({ team, stats, seenGap: seenGap.toFixed(2), persisted, errs }, null, 1));
  await b.close();
})().catch(async e => { console.error('FAIL', e.message.split('\n')[0]); await dbg(); process.exit(1); });
