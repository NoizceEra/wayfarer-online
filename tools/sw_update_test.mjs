#!/usr/bin/env node
// Service-worker update test: serves build A, loads it (SW installs + precaches), swaps the served dir to build B
// (any dir whose sw.js differs), triggers reg.update(), expects the "New version available" prompt, accepts it and
// verifies the page is controlled by B's worker, old shell caches are gone, and /trailer + media never entered a cache.
//   node tools/sw_update_test.mjs --a distA --b distB [--port 5618]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const A = path.resolve(arg('--a')), B = path.resolve(arg('--b')), PORT = Number(arg('--port') || 5618);
let cur = A;
const { chromium } = createRequire('/opt/node22/lib/node_modules/x.js')('playwright');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(cur, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(cur, 'index.html');
  const noCache = f.endsWith('sw.js') || f.endsWith('index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));
const out = {};
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1000, height: 600 } })).newPage();
await page.goto(`http://localhost:${PORT}/?renderer=canvas`);
await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('title'), null, { timeout: 60000 });
await page.waitForFunction(() => navigator.serviceWorker.controller || window.__swReg?.active, null, { timeout: 30000 });
const ver = () => page.evaluate(() => new Promise((res) => { navigator.serviceWorker.addEventListener('message', (e) => e.data?.type === 'VERSION' && res(e.data.build), { once: true }); (navigator.serviceWorker.controller || window.__swReg.active).postMessage('GET_VERSION'); setTimeout(() => res(null), 3000); }));
out.versionA = await ver();
await page.waitForTimeout(3000);
out.cachesA = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
out.trailerInCaches = await page.evaluate(async () => { for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) if (/trailer|\.mp4|\.webp/.test(r.url)) return r.url; return null; });
cur = B;
await page.evaluate(() => window.__swReg.update());
out.promptShown = await page.waitForSelector('#wf-update', { timeout: 20000 }).then(() => true).catch(() => false);
if (out.promptShown) {
  await page.click('#wf-update button:not(.ghost)');
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('title'), null, { timeout: 60000 }).catch(() => {});
  out.versionB = await ver();
  out.cachesB = await page.evaluate(async () => { const o = {}; for (const k of await caches.keys()) o[k] = (await (await caches.open(k)).keys()).length; return o; });
}
console.log(JSON.stringify(out, null, 1));
await browser.close(); server.close(); process.exit(0);
