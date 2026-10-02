#!/usr/bin/env node
// Re-capture ONLY the title shot for the promo, then hand off to a full re-render.
//
// Why this exists: the promo's frames were captured from the new build BEFORE the title
// screen was collapsed to a single entry button. Its hook frame (3.5s) still shows the
// removed two-choice menu (PLAY / PLAY ONLINE / NEW JOURNEY / JOIN WITH CODE / HOST CO-OP),
// so the video's first impression advertises a screen the game no longer has.
//
//   node scripts/recapture-title.mjs --url http://localhost:5619/
//
// Writes the same two destinations the main capture script does, so the composition picks
// the new image up with no src changes.
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

const main = async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`  pageerror: ${e.message}`));

  console.log(`load ${URL} @ ${VW}x${VH}`);
  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());   // fresh visitor: the true first-run title
  await page.goto(URL);
  await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('title'), null, { timeout: 60000 });
  await sleep(2600);                                  // let the title settle + animate

  // Read the menu back off the live title so the capture cannot silently drift again.
  const labels = await page.evaluate(() => {
    const out = [];
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (typeof o.label === 'string') out.push(o.label);
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
    };
    try { walk(window.__wayfarer?.scene?.getScene('title')?.nav); } catch { /* best effort */ }
    return out;
  });
  const hasPlayOnline = labels.some((l) => /play online/i.test(l));
  const hasEnter = labels.some((l) => /enter embervale/i.test(l));
  console.log(`title menu labels: ${JSON.stringify(labels)}`);
  console.log(`introduces the ONE-BUTTON title? enter=${hasEnter} removedPlayOnline=${!hasPlayOnline}`);
  if (!hasEnter || hasPlayOnline) console.log('  WARN the captured title may not match the shipped one-button screen');

  for (const o of OUTS) {
    await page.screenshot({ path: path.join(o, '01-title.png') });
    console.log(`shot 01-title.png -> ${o}  ${fs.statSync(path.join(o, '01-title.png')).size} bytes`);
  }
  await browser.close();
  console.log(hasEnter && !hasPlayOnline ? 'TITLE RECAPTURE OK' : 'TITLE RECAPTURE OK (with warning)');
};
main().catch((e) => { console.error(e); process.exit(1); });
