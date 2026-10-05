#!/usr/bin/env node
// Visual QA harness: screenshots every screen/panel at one viewport.
//   node tools/ui_review.mjs --url http://localhost:5621/ --size 1280x720 [--canvas] [--touch] --out /tmp/shots/1280x720-webgl
// Output: <out>/NN-name.png + report.json (page errors, per-panel DOM/canvas overflow findings).
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const [VW, VH] = arg('--size', '1280x720').split('x').map(Number);
const URL = arg('--url', 'http://localhost:5621/');
const OUT = arg('--out', `/tmp/ui_review/${VW}x${VH}`);
const CANVAS = args.includes('--canvas');
const TOUCH = args.includes('--touch') || VW < 900;
const ONLY = arg('--only', '');
fs.mkdirSync(OUT, { recursive: true });
const { chromium } = createRequire('/opt/node22/lib/node_modules/noop.js')('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { size: `${VW}x${VH}`, canvas: CANVAS, errors: [], shots: [], findings: [] };
let n = 0;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: VW, height: VH }, hasTouch: TOUCH, isMobile: TOUCH, deviceScaleFactor: 1 });
const page = await ctx.newPage();
page.on('pageerror', (e) => report.errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|ERR_/.test(m.text())) report.errors.push(`console: ${m.text()}`); });

const shot = async (name, wait = 350) => {
  if (ONLY && !name.includes(ONLY)) return;
  await sleep(wait);
  const f = `${String(++n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, f) });
  report.shots.push(f);
  // DOM panels clipped outside the viewport
  const clip = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('#wf-social *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (!el.classList.contains('ec-panel') && !el.classList.contains('wf-panel') && !/panel|modal/i.test(el.className?.toString?.() || '')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) continue;
      if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.push(`${el.className} ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out.slice(0, 5);
  }).catch(() => []);
  if (clip.length) report.findings.push({ shot: f, clipped: clip });
};
const ev = (fn, a) => page.evaluate(fn, a);
const press = async (k, ms = 250) => { await page.keyboard.press(k); await sleep(ms); };
const waitScene = (k, t = 60000) => page.waitForFunction((s) => window.__wayfarer?.scene?.isActive(s), k, { timeout: t });
const closeAll = async () => { for (let i = 0; i < 4; i++) { await ev(() => { const o = window.__wayfarerInput?.closers?.filter((c) => { try { return c.isOpen(); } catch { return false; } }); if (o?.length) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); }); await page.keyboard.press('Escape'); await sleep(120); } await ev(() => { const u = window.__wayfarer.scene.getScene('ui'); if (u?.menu?.isOpen) u.menu.close(); }); await sleep(150); };
const step = async (name, fn, wait) => {
  if (ONLY && !name.includes(ONLY)) return;
  try { await fn(); await shot(name, wait); } catch (e) { report.errors.push(`step ${name}: ${e.message.split('\n')[0]}`); }
  try { await closeAll(); } catch { /* ignore */ }
};
const ui = (code) => ev(`(() => { const ui = window.__wayfarer.scene.getScene('ui'); const w = window.__wayfarer.scene.getScene('world'); const ov = window.__wayfarer.scene.getScene('overlay'); const ch = window.__wayfarer.scene.getScene('character'); return (${code}); })()`);

await page.goto(URL + (CANVAS ? '?renderer=canvas' : ''));
await page.evaluate(() => localStorage.clear());
await page.goto(URL + (CANVAS ? '?renderer=canvas' : ''));
await ev(() => { document.getElementById('splash-tip')?.textContent; });
await shot('boot-splash', 0);
await waitScene('title');
await ev(() => { try { window.__wayfarer.loop.targetFps = 24; } catch { /* ignore */ } }); // software GL is slow: fewer frames, same layout
await sleep(1200);
await shot('title', 0);
// creator
await press('Enter', 300);
await waitScene('creator');
await sleep(1500);
for (const tab of ['BODY', 'STYLE', 'WARDROBE']) {
  await step(`creator-${tab.toLowerCase()}`, async () => ev((t) => { const s = window.__wayfarer.scene.getScene('creator'); const o = s.children.list.find((c) => c.type === 'Text' && c.text === t); o?.emit('pointerdown'); }, tab));
}
await press('Enter', 300);
await waitScene('ui');
await sleep(2500);
await shot('hud-town-fresh', 0);
await ev(() => { const w = window.__wayfarer.scene.getScene('world'); w.player.invulnUntil = w.time.now + 1e9; });

await step('hud-town', async () => { await ev(() => { const o = window.__wayfarer.scene.getScene('ui'); o.onboarding?.skip?.(); }); await sleep(300); });
await step('character-C', () => press('c', 500));
await step('skills-K', () => press('k', 500));
await step('spec-tree', () => ui('ui.skillTreePanel.show()'), 600);
await step('equipment-I', () => press('i', 500));
await step('shop', () => ui("ui.shop.show('maren')"), 500);
await step('crafting-U', () => press('u', 500));
await step('journal-L', () => press('l', 500));
await step('worldmap-N', () => press('n', 500));
await step('minimap-large-M', () => press('m', 500));
await step('party-P', () => press('p', 500));
await step('friends-O', () => press('o', 500));
await step('emotes-G', () => press('g', 500));
await step('chat-Enter', async () => { await press('Enter', 300); await page.keyboard.type('hello wayfarers', { delay: 10 }); });
await step('pets', () => ui('window.__socialUI.petPanel.open()'), 500);
await step('mail', () => ev(() => window.__econUI.mail.open()), 500);
await step('market', () => ev(() => window.__econUI.market.open()), 500);
await step('trade', () => ev(() => window.__econUI.trade.open?.() ?? window.__econUI.trade.show?.()), 500);
await step('guild', () => ev(() => window.__econUI.guildPanel.open()), 500);
await step('arena', () => ui('ui.arenaPanel.show()'), 500);
await step('season-pass', () => ev(() => window.__econUI.seasonPanel.open()), 500);
await step('lfg', () => ev(() => window.__econUI.lfgPanel.open()), 500);
await step('party-finder', () => ev(() => window.__econUI.partyFinder.open()), 500);
await step('leaderboard', () => ev(() => window.__econUI.leaderboardPanel.open()), 500);
await step('referral', () => ev(() => window.__econUI.referral.open()), 500);
await step('token-sinks', () => ev(() => window.__econUI.sinks.open()), 500);
await step('claim', () => ev(() => window.__econUI.claim.open()), 500);
await step('wallet', () => ui('ui.walletPanel.open()'), 500);
await step('bridge', () => ev(() => window.__econUI.bridge.open({})), 500);
await step('daily-reward', () => ui('ui.dailyPanel.open(w, ui.dailyRewards)'), 500);
await step('pause-menu', () => press('Escape', 500));
await step('pause-settings', async () => { await press('Escape', 400); await ui("ui.menu.goto('settings')"); }, 500);
await step('pause-controls', async () => { await press('Escape', 400); await ui("ui.menu.goto('controls')"); }, 500);
await step('help-H', () => press('h', 500));
await step('toasts', async () => { await ui("(ui.toast.push({ title: 'Achievement', text: 'First Blood', sub: 'Defeat your first monster', badge: true }), ui.say('System: autosaved'), 1)"); }, 700);
await step('dialog', () => ui("ov.dialog({ name: 'Maren', text: 'Welcome, wayfarer! The road east is dangerous after dusk. Take a few potions with you and keep your guard up.', options: [{ label: 'Browse wares' }, { label: 'Any work?' }, { label: 'Goodbye' }] })"), 700);
await step('boss-banner', () => ui("ui.worldBossAlert.show({ name: 'Ashen Colossus', area: 'Emberfields', expiresAt: Date.now() + 600000 })"), 700);
// combat
await ev(() => { const w = window.__wayfarer.scene.getScene('world'); const p = w.player; let best = null, bd = 1e9; w.enemies.children.each((e) => { if (e.alive && !e.areaId) { const d = Math.hypot(e.x - p.x, e.y - p.y); if (d < bd) { bd = d; best = e; } } return true; }); if (best) p.setPosition(best.x - 18, best.y); });
await press('Tab', 150);
await step('hud-combat', async () => { for (let i = 0; i < 4; i++) await press('j', 150); await press('1', 150); await ev(() => { const w = window.__wayfarer.scene.getScene('world'); w.player.hp = Math.max(1, Math.round(w.player.maxHp * 0.4)); }); });
await step('death', () => ui('(w.player.invulnUntil = 0, w.combat.onPlayerDeath(), 1)'), 1500);
await sleep(4500);
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify({ shots: report.shots.length, errors: report.errors, findings: report.findings.length }));
await browser.close();
process.exit(0);
