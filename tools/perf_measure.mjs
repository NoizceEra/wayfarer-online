#!/usr/bin/env node
// Load/runtime measurement harness (Playwright + CDP). Serves a dist dir with brotli (like Vercel), throttles the
// network via CDP, and records requests/bytes/time at title-interactive and at world-ready, then enters the world
// and samples window.__perf (FPS, frame ms, heap, texture MB).
//
//   node tools/perf_measure.mjs --dist dist --net fast4g|slow4g|none [--canvas] [--mobile] [--cpu 4] [--label x] [--no-play]
// Prints one JSON object. Needs Playwright + chromium (see tools/smoke.mjs for PLAYWRIGHT_PATH / CHROMIUM_PATH).
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);
const DIST = path.resolve(arg('--dist', 'dist'));
const NET = arg('--net', 'none');
const CANVAS = flag('--canvas');
const MOBILE = flag('--mobile');
const CPU = Number(arg('--cpu', MOBILE ? 4 : 1));
const PORT = Number(arg('--port', 5611));
const PLAY = !flag('--no-play');
const TRAIL = arg('--trailer-wait', '0'); // seconds to keep observing after world-ready (to catch lazy trailer traffic)

const PROFILES = { // download bytes/s, upload bytes/s, latency ms
  fast4g: { downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8, latency: 170 },
  slow4g: { downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8, latency: 150 },
};

const loadPw = () => {
  for (const d of [process.env.PLAYWRIGHT_PATH, '/opt/node22/lib/node_modules'].filter(Boolean)) {
    try { return createRequire(path.join(d, 'x.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('playwright not found');
};
const { chromium } = loadPw();

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json' };
const COMPRESSIBLE = /\.(html|js|css|json|svg|ttf|webmanifest)$/;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(DIST, p);
  if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { f = path.join(DIST, 'index.html'); p = '/index.html'; }
  const ext = path.extname(f); let buf = fs.readFileSync(f);
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': p === '/index.html' || p === '/sw.js' ? 'no-cache' : 'public, max-age=31536000' };
  const ae = req.headers['accept-encoding'] || '';
  if (COMPRESSIBLE.test(f) && /br/.test(ae)) { buf = zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } }); h['Content-Encoding'] = 'br'; }
  else if (COMPRESSIBLE.test(f) && /gzip/.test(ae)) { buf = zlib.gzipSync(buf); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = buf.length; res.writeHead(200, h); res.end(buf);
});
await new Promise((r) => server.listen(PORT, r));

const kind = (u, mime) => {
  const x = u.split('?')[0];
  if (/\.js$/.test(x)) return 'js'; if (/\.css$/.test(x)) return 'css'; if (/\.html$|\/$/.test(x)) return 'html';
  if (/\.(png|webp|gif|jpg|svg)$/.test(x)) return 'img'; if (/\.(ogg|mp3|wav)$/.test(x)) return 'audio'; if (/\.(ttf|woff2?)$/.test(x)) return 'font';
  if (/\.mp4$|\.webm$/.test(x)) return 'video'; if (/\.json$/.test(x)) return 'json'; return 'other';
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext(MOBILE ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true } : { viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__lt = 0; window.__ltMarks = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt += Math.max(0, e.duration - 50); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
});
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable'); await cdp.send('Performance.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (PROFILES[NET]) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...PROFILES[NET] });
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });

const reqs = new Map();
cdp.on('Network.requestWillBeSent', (e) => { if (!reqs.has(e.requestId)) reqs.set(e.requestId, { url: e.request.url, t: e.timestamp, recv: 0, enc: 0, done: false }); });
cdp.on('Network.dataReceived', (e) => { const r = reqs.get(e.requestId); if (r) r.recv += e.dataLength; });
cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) { r.done = true; r.enc = e.encodedDataLength; } });
cdp.on('Network.loadingFailed', (e) => { const r = reqs.get(e.requestId); if (r) { r.done = true; r.failed = true; } });
const tally = () => {
  const by = {}; let n = 0, bytes = 0;
  for (const r of reqs.values()) {
    if (!r.url.startsWith('http://localhost')) continue;
    const b = r.done ? r.enc : r.recv; const k = kind(r.url);
    by[k] = by[k] || { n: 0, kb: 0 }; by[k].n++; by[k].kb += b / 1024; n++; bytes += b;
  }
  for (const k in by) by[k].kb = Math.round(by[k].kb);
  return { requests: n, kb: Math.round(bytes / 1024), by };
};

const out = { label: arg('--label', ''), dist: path.basename(DIST), net: NET, renderer: CANVAS ? 'canvas' : 'auto', mobile: MOBILE, cpu: CPU };
const URLX = `http://localhost:${PORT}/${CANVAS ? '?renderer=canvas' : ''}`;
const t0 = Date.now();
await page.goto(URLX, { waitUntil: 'commit' });
await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('title') && !document.getElementById('splash')?.offsetParent, null, { timeout: 300000, polling: 50 });
out.titleInteractive = { sec: +((Date.now() - t0) / 1000).toFixed(2), ...tally(), longTaskMs: Math.round(await page.evaluate(() => window.__lt)) };

await page.waitForFunction(() => { const g = window.__wayfarer; return g?.textures.exists('char.shadow') && g.scene.getScene('world') && !g.scene.getScene('boot').load.isLoading(); }, null, { timeout: 600000, polling: 200 });
out.worldReady = { sec: +((Date.now() - t0) / 1000).toFixed(2), ...tally() };
if (+TRAIL) { await new Promise((r) => setTimeout(r, +TRAIL * 1000)); out.afterIdle = { sec: +((Date.now() - t0) / 1000).toFixed(2), ...tally() }; }

const heap = async () => { const m = await cdp.send('Performance.getMetrics'); const g = (n) => m.metrics.find((x) => x.name === n)?.value || 0; return { jsHeapMB: +(g('JSHeapUsedSize') / 1048576).toFixed(1), domNodes: g('Nodes'), listeners: g('JSEventListeners') }; };
// Media (video) range requests are not reported by CDP dataReceived: read their transfer size from Resource Timing.
const mediaKB = () => page.evaluate(() => Math.round(performance.getEntriesByType('resource').filter((e) => /\.(mp4|webm)/.test(e.name)).reduce((s, e) => s + (e.encodedBodySize || e.transferSize || 0), 0) / 1024));
out.worldReady.videoKB = await mediaKB();
out.memTitle = await heap();
if (PLAY) {
  await cdp.send('Network.emulateNetworkConditions', { offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 0 });
  const waitScene = (k) => page.waitForFunction((s) => window.__wayfarer.scene.isActive(s), k, { timeout: 120000 });
  if (MOBILE) { await page.evaluate(() => { localStorage.clear(); }); }
  await page.keyboard.press('Enter'); await waitScene('creator'); await page.waitForTimeout(600);
  await page.keyboard.press('Enter'); await waitScene('ui'); await page.waitForTimeout(3000);
  await page.evaluate(() => window.__perf.reset());
  await page.waitForTimeout(6000);
  out.world = await page.evaluate(() => window.__perf.snapshot());
  out.memWorld = await heap();
  out.cullOn = await page.evaluate(() => window.__perf.cull());
}
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close();
process.exit(0);
