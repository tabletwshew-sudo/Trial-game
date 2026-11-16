// Audio smoke test: every synthesised sound plays (makes output) without errors, and music runs.
const { chromium } = require('playwright');
const URL = process.env.E2E_URL || 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::ERR/.test(m.text()) && errs.push(m.text()));
  await p.goto(URL);
  await p.click('button:has-text("PLAY AS GUEST")');
  await p.waitForSelector('.play-panel');
  const calls = [
    "gun('ar', null, true)", "gun('shotgun', {x:20,y:0,z:5})", "gun('sniper', {x:300,y:0,z:0})", "gun('rocket', null, true)", "gun('smg', {x:-8,y:1,z:2})",
    "reload('start')", "reload('end')", "empty()",
    "hit('body')", "hit('head')", "hit('shield')", "hit('knock')", "hurt(true)", "elim()", "explosion({x:30,y:0,z:0})",
    "step(null,'grass',1)", "step(null,'stone',1)", "step(null,'wood',1)", "step(null,'sand',1)", "step(null,'water',1)", "step(null,'metal',1)", "step({x:5,y:0,z:5},'dirt',1)",
    "move('jump',null)", "move('land',null,1)", "move('slide',null)", "move('mantle',null)", "move('pad',null)", "move('zipgrab',null)", "move('splash',null,1)", "move('glider',null)",
    "item('pickup')", "item('ammo')", "item('heal')", "item('shield')", "item('swap')", "item('chest',{x:2,y:0,z:2})", "item('supply')", "item('revive')", "item('vault')",
    "chirp({x:10,y:5,z:10})", "ui('click')", "ui('ready')", "ui('found')", "ui('beep')", "ui('go')", "ui('victory')", "ui('defeat')",
  ];
  const silent = [];
  for (const c of calls) {
    const peak = await p.evaluate(async (c) => {
      const a = window.__audio; a.unlock(); a.listener({ x: 0, y: 0, z: 0 }, 0);
      await new Promise((r) => setTimeout(r, 30));
      new Function('a', 'a.' + c)(a);
      let m = 0;
      for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 25)); m = Math.max(m, a.level()); }
      return m;
    }, c);
    if (!(peak > 0.002)) silent.push(c + ' ' + peak);
    await p.waitForTimeout(150);
  }
  // loops: start them, they should sound; stop them, they should fade
  const loopPeak = await p.evaluate(async () => {
    const a = window.__audio; let m = 0;
    for (let i = 0; i < 12; i++) {
      a.loop('w', 'wind', 0.4, 900); a.loop('e', 'engine', 0.4, 60); a.loop('z', 'zip', 0.3, 200); a.loop('h', 'hum', 0.3, undefined, { x: 2, y: 0, z: 2 });
      a.loop('s', 'storm', 0.4, 250); a.loop('v', 'waves', 0.3, 600); a.loop('sl', 'slide', 0.3, 1000); a.loop('u', 'use', 0.3); a.sweep();
      await new Promise((r) => setTimeout(r, 40)); m = Math.max(m, a.level());
    }
    a.stopLoops(); return m;
  });
  // music
  const musicPeak = await p.evaluate(async () => { const a = window.__audio; a.setMusic('drop'); let m = 0; for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 50)); m = Math.max(m, a.level()); } a.setMusic('lobby'); return m; });
  console.log(JSON.stringify({ sounds: calls.length, silent, loopPeak: +loopPeak.toFixed(3), musicPeak: +musicPeak.toFixed(3), errs }, null, 1));
  await b.close();
  if (silent.length || loopPeak < 0.01 || musicPeak < 0.005 || errs.length) { console.error('AUDIO E2E FAILED'); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
