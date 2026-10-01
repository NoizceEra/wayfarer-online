#!/usr/bin/env node
// Headless regression smoke test (real key presses, no scene.start shortcuts):
//   title -> creator -> world -> open/close every panel -> combat (attack chain,
//   skills, dodge, target, potion) -> save -> reload -> Continue -> verify progress.
// Exits non-zero on any uncaught page error, console.error, stuck panel or lost progress.
//
//   npx vite build && node tools/smoke.mjs                # serves dist/ itself on :5499
//   node tools/smoke.mjs --url http://localhost:5177/     # against a running preview / deploy
//   node tools/smoke.mjs --canvas --size 390x844 --touch  # canvas renderer, phone viewport
//
// Needs Playwright (`npm i -D playwright && npx playwright install chromium`, or a global install;
// set PLAYWRIGHT_PATH to its node_modules dir and CHROMIUM_PATH to a browser binary if needed).
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const [VW, VH] = (arg('--size', '1280x720')).split('x').map(Number);
const TOUCH = flag('--touch');
const QUERY = flag('--canvas') ? '?renderer=canvas' : '';
const PORT = Number(arg('--port', 5499));
let URL = arg('--url', null);

function loadPlaywright() {
  const tries = [process.env.PLAYWRIGHT_PATH, path.join(ROOT, 'node_modules'), '/opt/node22/lib/node_modules', '/usr/local/lib/node_modules', '/usr/lib/node_modules'].filter(Boolean);
  for (const dir of tries) {
    try { return createRequire(path.join(dir, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  console.error('smoke: playwright not found (npm i -D playwright, or set PLAYWRIGHT_PATH)');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// Network noise that is expected when no relay is reachable (solo smoke): not a game bug.
const BENIGN = [/Failed to load resource/i, /WebSocket connection to .* failed/i, /ERR_(CONNECTION_REFUSED|TUNNEL_CONNECTION_FAILED|NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i];
const failures = [];
const fail = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let server = null;
async function startServer() {
  server = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
  URL = `http://localhost:${PORT}/`;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(URL); if (r.ok) return; } catch { /* booting */ } await sleep(250); }
  throw new Error('vite preview did not start (did you run `npx vite build`?)');
}

async function main() {
  if (!URL) await startServer();
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: TOUCH, isMobile: TOUCH });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fail(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !BENIGN.some((re) => re.test(m.text()))) fail(`console.error: ${m.text()}`); });

  const press = async (k, ms = 200) => { await page.keyboard.press(k); await sleep(ms); };
  const active = (key) => page.evaluate((k) => window.__wayfarer?.scene?.isActive(k), key);
  const waitScene = (key, timeout = 60000) => page.waitForFunction((k) => window.__wayfarer?.scene?.isActive(k), key, { timeout });
  const open = () => page.evaluate(() => window.__wayfarerInput.closers.filter((c) => { try { return c.isOpen(); } catch { return false; } }).map((c) => c.id));
  const hero = () => page.evaluate(() => { const w = window.__wayfarer.scene.getScene('world'); const p = w.player; return { lv: p.level, xp: p.xp, gold: p.gold, x: Math.round(p.x), y: Math.round(p.y), inv: [...p.inventory], alloc: JSON.stringify(p.prog.alloc), skills: JSON.stringify(p.prog.skills), dead: p.dead }; });
  const step = (s) => console.log(`- ${s}`);

  step(`load ${URL}${QUERY} @ ${VW}x${VH}${TOUCH ? ' touch' : ''}`);
  await page.goto(URL + QUERY);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL + QUERY);
  await waitScene('title');
  await sleep(500);

  step('title -> creator (Enter)');
  await press('Enter', 300);
  await waitScene('creator');
  await sleep(600);
  step('creator -> world (Enter)');
  await press('Enter', 300);
  await waitScene('ui');
  await sleep(2000);

  step('panels: open + Esc each');
  const panels = { i: 'equip', c: 'character', k: 'character', l: 'journal', u: 'craft', n: 'worldmap', h: 'help', p: 'social', o: 'social', g: 'social' };
  for (const [k, id] of Object.entries(panels)) {
    await press(k, 400);
    const o = await open();
    if (!o.includes(id)) fail(`key ${k}: expected panel "${id}" open, got [${o}]`);
    await press('Escape', 300);
    const o2 = await open();
    if (o2.length) { fail(`key ${k}: still open after Esc [${o2}]`); await press('Escape', 300); }
  }
  step('pause menu: Esc opens, Esc closes');
  await press('Escape', 300);
  if (!(await open()).includes('pause')) fail('Esc did not open the pause menu');
  await press('Escape', 300);
  if ((await open()).length) fail('pause menu did not close');

  step('chat: Enter, type hotkey letters, Enter (no panel may open)');
  await press('Enter', 300);
  await page.keyboard.type('ick lun', { delay: 25 });
  const leak = (await open()).filter((x) => x !== 'social');
  if (leak.length) fail(`typing in chat opened panels: [${leak}]`);
  await press('Enter', 300);

  step('combat: walk, target, attack chain, skills, dodge, potion');
  await page.keyboard.down('s'); await sleep(800); await page.keyboard.up('s');
  await page.evaluate(() => { // put the hero next to the nearest overworld enemy (travel is not under test)
    const w = window.__wayfarer.scene.getScene('world'); const p = w.player; let best = null, bd = 1e9;
    w.enemies.children.each((e) => { if (e.alive && !e.areaId) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } } return true; });
    if (best) p.setPosition(best.x - 18, best.y);
    p.invulnUntil = w.time.now + 60000;
  });
  await page.keyboard.down('d'); await sleep(60); await page.keyboard.up('d');
  await press('Tab', 150);
  for (let i = 0; i < 9; i++) await press('j', 170);
  for (const k of ['1', '2', '3', '4']) await press(k, 350);
  await press('Shift', 400);
  await page.evaluate(() => { window.__wayfarer.scene.getScene('world').player.hp = 10; });
  await press('q', 300);
  const h1 = await hero();
  if (h1.dead) fail('hero died during the invulnerable combat step');

  step('save -> reload -> Continue');
  await page.evaluate(() => { const w = window.__wayfarer.scene.getScene('world'); w.player.gainXp(150); w.grantGear('traveler_cloak', 'Smoke'); w.saveNow(); });
  const before = await hero();
  await page.reload();
  await waitScene('title');
  await sleep(500);
  await press('Enter', 300);
  await page.waitForFunction(() => window.__wayfarer.scene.isActive('creator') || window.__wayfarer.scene.isActive('world'), null, { timeout: 60000 });
  await sleep(600);
  if (await active('creator')) await press('Enter', 300);
  await waitScene('ui');
  await sleep(1500);
  const after = await hero();
  for (const k of ['lv', 'xp', 'gold', 'inv', 'alloc', 'skills']) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) fail(`save/reload lost ${k}: ${JSON.stringify(before[k])} -> ${JSON.stringify(after[k])}`);
  }
  if (Math.hypot(before.x - after.x, before.y - after.y) > 24) fail(`position not restored: ${before.x},${before.y} -> ${after.x},${after.y}`);

  step('HUD text sanity (no NaN / undefined)');
  const bad = await page.evaluate(() => {
    const out = [];
    const walk = (o, k) => { if (o.type === 'Text' && o.visible && /NaN|undefined|\[object/.test(o.text)) out.push(`${k}: ${o.text.slice(0, 60)}`); if (o.list) o.list.forEach((c) => walk(c, k)); };
    for (const s of window.__wayfarer.scene.getScenes(true)) s.children.list.forEach((o) => walk(o, s.scene.key));
    return out;
  });
  bad.forEach((b) => fail(`bad text ${b}`));

  await browser.close();
}

main()
  .catch((e) => fail(`crash: ${e.stack || e}`))
  .finally(() => {
    server?.kill();
    if (failures.length) { console.log(`\nSMOKE FAILED (${failures.length})`); process.exit(1); }
    console.log('\nSMOKE OK');
    process.exit(0);
  });
