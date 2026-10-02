#!/usr/bin/env node
// Capture REAL gameplay screenshots (1920x1080) for the promo trailer from the
// NEW build served from D:/ai-studio/wf-chain (branch blockchain/v1).
// Drives the live game with real key/pointer input, mirroring tools/smoke.mjs:
//   title -> creator -> world (+ first-run onboarding tour) -> walk -> combat ->
//   skills -> journal -> bag/gear -> craft -> world HUD.
//
//   node scripts/capture-new.mjs --url http://localhost:5619/
//
// Playwright comes from the global install (set PLAYWRIGHT_PATH).
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROMO = path.resolve(HERE, '..');
const OUTS = [
  path.join(PROMO, 'assets', 'gameplay'),
  path.join(PROMO, 'capture', 'gameplay'),
];
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const URL = arg('--url', 'http://localhost:5619/');
const VW = 1920, VH = 1080;

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, path.join('D:/ai-studio/wf-chain', 'node_modules'), '/opt/node22/lib/node_modules'].filter(Boolean);
  for (const dir of tries) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  console.error('playwright not found'); process.exit(2);
}
const { chromium } = loadPlaywright();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (const o of OUTS) fs.mkdirSync(o, { recursive: true });

const failures = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };

async function main() {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));

  let shotN = 0;
  const shot = async (name) => {
    for (const o of OUTS) await page.screenshot({ path: path.join(o, name) });
    const b = fs.statSync(path.join(OUTS[0], name)).size;
    shotN++;
    console.log(`shot ${name}  ${b} bytes`);
  };
  const press = async (k, ms = 250) => { await page.keyboard.press(k); await sleep(ms); };
  const down = async (k, ms) => { await page.keyboard.down(k); await sleep(ms); await page.keyboard.up(k); };
  const waitScene = (key, timeout = 60000) => page.waitForFunction((k) => window.__wayfarer?.scene?.isActive(k), key, { timeout });

  console.log(`load ${URL} @ ${VW}x${VH}`);
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await waitScene('title');
  await sleep(2600);                       // let the redesigned title settle/animate
  await shot('01-title.png');

  await press('Enter', 500);
  await waitScene('creator');
  await sleep(1400);
  await shot('02-creator.png');

  await press('Enter', 500);
  await waitScene('ui', 40000);
  await sleep(2500);

  // First-run onboarding tour (new): capture it as its own frame, then dismiss it.
  const tourVisible = await page.evaluate(() => !!document.querySelector('#wf-social .wf-ob'));
  console.log('onboarding tour visible:', tourVisible);
  if (tourVisible) {
    await sleep(400);
    await shot('11-tour.png');
    // The tour re-renders on a ~7Hz poll, so Playwright's actionability check never
    // settles; fire the real click handler directly through the DOM instead.
    const clicked = await page.evaluate(() => {
      const b = document.querySelector('#wf-social .wf-ob-f button');
      if (b) { b.click(); return true; }
      return false;
    });
    await page.waitForFunction(() => !document.querySelector('#wf-social .wf-ob'), null, { timeout: 5000 }).catch(() => {});
    const gone = await page.evaluate(() => !document.querySelector('#wf-social .wf-ob'));
    if (!clicked || !gone) fail('onboarding tour did not dismiss');
  }

  // Open-world / town.
  await sleep(1200);
  await shot('03-world.png');

  // Walk a bit for life, then an exploration frame.
  await down('d', 900); await down('w', 700); await sleep(900);
  await shot('04-explore.png');

  // Combat: stand next to the nearest overworld enemy and swing (real input).
  await page.evaluate(() => {
    try {
      const w = window.__wayfarer.scene.getScene('world'); const p = w.player;
      let best = null, bd = 1e9;
      w.enemies.children.each((e) => { if (e.alive && !e.areaId) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } } return true; });
      if (best) p.setPosition(best.x - 22, best.y);
      p.invulnUntil = w.time.now + 60000;
    } catch (e) { console.log('teleport fail', e.message); }
  });
  await sleep(400);
  await press('Tab', 200);
  for (let i = 0; i < 5; i++) await press('j', 210);
  await shot('05-combat.png');
  for (const k of ['1', '2', '3', '4']) await press(k, 320);
  await press('j', 200);
  await sleep(300);
  await shot('06-skill.png');

  // Quest journal (L).
  await press('l', 800);
  await shot('07-quests.png');
  await press('Escape', 450);

  // Bag / gear (I).
  await press('i', 800);
  await shot('08-gear.png');
  await press('Escape', 450);

  // Craft (U).
  await press('u', 800);
  await shot('09-craft.png');
  await press('Escape', 450);

  // Final world frame with the HUD (gold/level visible). Park the hero at the town
  // spawn, clear any status effect and heal, letting a pending respawn resolve, so
  // the end-card background is a clean LIVING scene (not a death card).
  const ensureAlive = () => page.evaluate(() => {
    const w = window.__wayfarer.scene.getScene('world'); const p = w.player;
    try { w.combat?.statuses?.clear?.(); } catch { /* no statuses */ }
    if (p.dead && w.combat?.respawn) {
      try { w.combat.respawn({ area: null, x: w.spawn?.x ?? 1024, y: w.spawn?.y ?? 1024, name: 'Thistle Town' }); } catch { /* ignore */ }
    }
    p.dead = false;
    p.setPosition(w.spawn?.x ?? 1024, w.spawn?.y ?? 1024);
    p.hp = p.effMaxHp(); p.mp = p.effMaxMp();
    p.invulnUntil = w.time.now + 120000;
  });
  await ensureAlive();
  await sleep(1000);
  await down('a', 450); await sleep(900);
  await ensureAlive();
  await sleep(500);
  const st = await page.evaluate(() => { const p = window.__wayfarer.scene.getScene('world').player; return { dead: p.dead, hp: Math.round(p.hp), gold: p.gold }; });
  console.log('final state', JSON.stringify(st));
  if (st.dead) fail('hero was dead at the final shot');
  await shot('10-world-hud.png');

  const hero = await page.evaluate(() => {
    try { const w = window.__wayfarer.scene.getScene('world'); const p = w.player; return { gold: p.gold, level: p.level, x: Math.round(p.x), y: Math.round(p.y) }; }
    catch { return null; }
  });
  console.log('hero', JSON.stringify(hero));
  await browser.close();
  console.log(`done — ${shotN} shots -> ${OUTS.join(', ')}`);
}

main()
  .catch((e) => { fail(`crash: ${e.stack || e}`); })
  .finally(() => { if (failures.length) { console.log(`\nCAPTURE FAILED (${failures.length})`); process.exit(1); } process.exit(0); });
