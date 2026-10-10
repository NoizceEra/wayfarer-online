// Normal-map lighting SPIKE proof harness (puppeteer).
//
// Drives the REAL built game to the world scene, then uses the ?nlspike=1 demo
// handle (window.__nlspike) to move a single Light2D light relative to one monster
// sprite and screenshot the SAME sprite in the SAME position.
//
//   node tools/nlspike_proof.mjs --url http://localhost:5533 --tag webgl
//   node tools/nlspike_proof.mjs --url http://localhost:5533 --tag canvas --canvas
//
// Prints the sprite's screen rect + zoom + renderer + pipeline name as JSON so the
// caller can crop/measure exactly. Screenshots land in <outdir>/<tag>_*.png.
import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const URL = arg('--url', 'http://localhost:5533');
const TAG = arg('--tag', 'webgl');
const OUT = arg('--outdir', path.join(ROOT, '.scratch-blender/nlspike/shots'));
const CANVAS = flag('--canvas');
const PAUSE = flag('--pause');
const RADIUS = Number(arg('--radius', 96));
const INTENSITY = Number(arg('--intensity', 3.0));
const AMBIENT = arg('--ambient', '0x505050');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SPEC = arg('--spec', 'far:420,-260;near:22,-10');
const SHOTS = SPEC.split(';').filter(Boolean).map((s) => {
  const [name, off] = s.split(':');
  const [dx, dy] = off.split(',').map(Number);
  return { name, dx, dy };
});

const errors = [];

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-unsafe-swiftshader',
           '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist', '--disable-dev-shm-usage',
           '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
           '--disable-background-timer-throttling',
           '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  const q = CANVAS ? '?nlspike=1&renderer=canvas' : '?nlspike=1';
  const isActive = (k) => page.evaluate((kk) => window.__wayfarer?.scene?.isActive(kk), k);
  await page.goto(URL + q, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });

  // Boot -> title -> creator -> world/ui. BootScene streams world assets in the
  // background after the title paints; pressing Enter before they arrive leaves the
  // creator scene stuck at INIT, so wait for the loader to go idle and reload the
  // whole page if the transition still stalls.
  let reached = false;
  for (let attempt = 0; attempt < 3 && !reached; attempt++) {
    await page.goto(URL + q, { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction((kk) => window.__wayfarer?.scene?.isActive(kk), { timeout: 60000 }, 'title');
    await page.evaluate(() => { const g = window.__wayfarer; if (g?.loop?.wake) g.loop.wake(); });
    await page.waitForFunction(() => {
      const b = window.__wayfarer?.scene?.getScene('boot');
      return !!b && !!b.load && b.load.isLoading() === false;
    }, { timeout: 60000 }).catch(() => {});
    await sleep(900);
    for (let i = 0; i < 3 && !reached; i++) {
      await page.keyboard.press('Enter');
      try {
        await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('creator') || window.__wayfarer?.scene?.isActive('world'), { timeout: 15000 });
        if (await isActive('creator')) { await page.keyboard.press('Enter'); }
        await page.waitForFunction((kk) => window.__wayfarer?.scene?.isActive(kk), { timeout: 40000 }, 'ui');
        reached = true;
      } catch (e) { await sleep(1500); }
    }
  }
  if (!reached) throw new Error('could not reach the world scene');
  await sleep(2500);

  // Wait for the spike demo to install itself onto the world scene.
  await page.waitForFunction(() => !!window.__nlspike, { timeout: 30000 });
  await sleep(500);

  // Freeze the day/night grade at mid-morning (neutral-ish) so the comparison is
  // not polluted by a moving sun; the Light2D contribution is what changes.
  const info = await page.evaluate((rad, inten, amb, pause) => {
    const g = window.__wayfarer;
    const w = g.scene.getScene('world');
    const h = window.__nlspike;
    const dn = w.daynight || w.fx?.daynight;
    if (dn) { dn.frozen = true; dn.t = 0.40; }
    // park the sprite on the player and lock the camera so it stays put on screen
    const spr = h.sprite;
    spr.setPosition(Math.round(w.player.x) + 40, Math.round(w.player.y));
    const cam = w.cameras.main;
    cam.stopFollow();
    cam.centerOn(spr.x, spr.y - 6);
    cam.setRoundPixels(true);
    if (h.light) { h.light.radius = rad; h.light.intensity = inten; }
    h.setAmbient(amb);
    // Freeze the live world so the only thing that differs between shots is the light
    // position (moving enemies / particles / tweens otherwise contaminate the diff).
    if (pause) {
      for (const s of g.scene.scenes) {
        try { if (s.sys.isActive()) g.scene.pause(s.scene.key); } catch (e) { /* ignore */ }
      }
    }
    const z = cam.zoom, v = cam.worldView;
    const sx = (spr.x - v.x) * z, sy = (spr.y - v.y) * z;
    return {
      renderer: g.renderer.type === 2 ? 'webgl' : (g.renderer.type === 1 ? 'canvas' : String(g.renderer.type)),
      pipeline: h.pipelineName(),
      webgl: h.webgl,
      zoom: z,
      sprite: { x: spr.x, y: spr.y },
      screen: { sx, sy, rect: [Math.round(sx - 8 * z), Math.round(sy - 16 * z), Math.round(sx + 8 * z), Math.round(sy)] },
      worldView: { x: v.x, y: v.y, w: v.width, h: v.height },
      canvas: { w: g.canvas.width, h: g.canvas.height },
      radius: rad, intensity: inten, ambient: amb,
    };
  }, RADIUS, INTENSITY, AMBIENT, PAUSE);

  const shot = async (name) => { await sleep(250); await page.screenshot({ path: path.join(OUT, `${TAG}_${name}.png`) }); };

  // Capture one shot per spec entry, then a pipeline-off baseline (WebGL only).
  for (const s of SHOTS) {
    await page.evaluate((dx, dy) => { const h = window.__nlspike; h.setLight(h.sprite.x + dx, h.sprite.y + dy); }, s.dx, s.dy);
    await shot(s.name);
  }
  const unlitOk = await page.evaluate(() => window.__nlspike.setLighting(false));
  if (unlitOk) { await shot('unlit'); await page.evaluate(() => window.__nlspike.setLighting(true)); }

  console.log('PROBE_JSON=' + JSON.stringify({ tag: TAG, info, shots: SHOTS, unlitCaptured: !!unlitOk, errors }, null, 2));
  await browser.close();
}

main().catch((e) => { console.error('PROBE_CRASH', e); process.exit(1); });
