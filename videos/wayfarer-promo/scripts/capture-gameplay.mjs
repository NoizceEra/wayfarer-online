#!/usr/bin/env node
// Capture REAL gameplay screenshots for the promo trailer (1920x1080).
// Drives the live game with real key presses: title -> creator -> world -> panels -> combat.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const ROOT = 'D:/ai-studio/wf-chain';
const OUT = 'D:/ai-studio/wf-chain/videos/wayfarer-promo/capture/gameplay';
const URL = process.env.GAME_URL || 'https://wayfareronline.fun/';
const VW = 1920, VH = 1080;

function loadPlaywright() {
  return createRequire('D:/ai-studio/wayfarer-online/videos/wayfarer-promo/node_modules/noop.js')('playwright-core');
}
const { chromium } = loadPlaywright();
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({ executablePath: EDGE, args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: VW, height: VH } })).newPage();
  const shot = async (name) => { await page.screenshot({ path: path.join(OUT, name) }); console.log('shot', name); };
  const press = async (k, ms = 300) => { await page.keyboard.press(k); await sleep(ms); };
  const waitScene = (key, timeout = 60000) => page.waitForFunction((k) => window.__wayfarer?.scene?.isActive(k), key, { timeout });

  await page.goto(URL);
  await page.evaluate(() => localStorage.clear());
  await page.goto(URL);
  await waitScene('title');
  await sleep(2500);
  await shot('01-title.png');

  await press('Enter', 600);
  await waitScene('creator');
  await sleep(1200);
  await shot('02-creator.png');

  await press('Enter', 600);
  try { await waitScene('ui', 30000); } catch { console.log('ui scene wait timeout, continuing'); }
  await sleep(4000);
  await shot('03-world.png');

  // walk a bit for life
  await page.keyboard.down('d'); await sleep(900); await page.keyboard.up('d');
  await page.keyboard.down('w'); await sleep(600); await page.keyboard.up('w');
  await sleep(800);
  await shot('04-explore.png');

  // teleport near enemy + fight for combat shot
  await page.evaluate(() => {
    try {
      const w = window.__wayfarer.scene.getScene('world'); const p = w.player;
      let best = null, bd = 1e9;
      w.enemies.children.each((e) => { if (e.alive && !e.areaId) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } } return true; });
      if (best) p.setPosition(best.x - 26, best.y);
    } catch (e) { console.log('teleport fail', e); }
  });
  await sleep(400);
  await press('Tab', 200);
  await press('j', 250);
  await press('j', 250);
  await shot('05-combat.png');
  for (let i = 0; i < 4; i++) await press('j', 200);
  await press('1', 400);
  await shot('06-skill.png');

  // journal (quests) panel
  await press('l', 700);
  await shot('07-quests.png');
  await press('Escape', 400);

  // equip / gear panel (earn/gear)
  await press('i', 700);
  await shot('08-gear.png');
  await press('Escape', 400);

  // craft panel
  await press('u', 700);
  await shot('09-craft.png');
  await press('Escape', 400);

  // final world shot with HUD (earn/gold visible)
  await page.keyboard.down('a'); await sleep(700); await page.keyboard.up('a');
  await sleep(800);
  await shot('10-world-hud.png');

  const hero = await page.evaluate(() => {
    try { const w = window.__wayfarer.scene.getScene('world'); const p = w.player; return { gold: p.gold, level: p.level, x: Math.round(p.x), y: Math.round(p.y) }; }
    catch { return null; }
  });
  console.log('hero', JSON.stringify(hero));
  await browser.close();
  console.log('done ->', OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
