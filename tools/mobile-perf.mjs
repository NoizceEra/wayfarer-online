#!/usr/bin/env node
// Repeatable mobile frame-pacing probe for the real title -> creator -> world flow.
//
//   npm run build
//   node tools/mobile-perf.mjs
//   node tools/mobile-perf.mjs --url http://localhost:5176/ --seconds 20
//
// Playwright can come from PLAYWRIGHT_PATH. On this workstation the shared cache
// is discovered automatically, so the project does not need another large browser copy.
import { createRequire } from 'module';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (key, fallback) => {
  const index = args.indexOf(key);
  return index >= 0 ? args[index + 1] : fallback;
};
const seconds = Math.max(5, Number(arg('--seconds', process.env.WAYFARER_PERF_SECONDS || 15)));
const port = Number(arg('--port', 5499));
let url = arg('--url', process.env.WAYFARER_URL || null);

function loadPlaywright() {
  const roots = [
    process.env.PLAYWRIGHT_PATH,
    path.join(ROOT, 'node_modules'),
    'D:/ai-studio/_system/cache/npm/_npx/e41f203b7505f1fb/node_modules',
    '/opt/node22/lib/node_modules',
    '/usr/local/lib/node_modules',
  ].filter(Boolean);
  for (const root of roots) {
    try { return createRequire(path.join(root, 'noop.js'))('playwright'); } catch { /* next */ }
  }
  throw new Error('Playwright not found. Set PLAYWRIGHT_PATH to a node_modules directory containing playwright.');
}

const { chromium } = loadPlaywright();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const percentile = (sorted, ratio) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
let preview = null;

async function startPreview() {
  preview = spawn(process.execPath, [path.join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], {
    cwd: ROOT,
    stdio: 'ignore',
  });
  // Vite may bind localhost through IPv6 on Windows, where 127.0.0.1 is not
  // necessarily reachable even though the preview is healthy.
  url = `http://localhost:${port}/`;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* booting */ }
    await sleep(250);
  }
  throw new Error('Vite preview did not start. Run npm run build first.');
}

async function enterWorld(page) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('title'), null, { timeout: 60000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('creator'), null, { timeout: 60000 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__wayfarer?.scene?.isActive('world'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);
}

async function main() {
  if (!url) await startPreview();
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || 'D:/ai-studio/_system/cache/playwright/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
    args: ['--no-sandbox'],
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    screen: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const errors = [];
  const benign = [
    /Failed to load resource/i,
    /WebSocket connection to .* failed/i,
    /ERR_CONNECTION_REFUSED/i,
    // Local preview is not an allowed production-relay origin. The optional
    // stats panel degrades safely, so this should not invalidate frame pacing.
    /wayfarer-relay-production\.up\.railway\.app\/stats.*blocked by CORS policy/i,
  ];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && !benign.some((pattern) => pattern.test(message.text()))) errors.push(`console.error: ${message.text()}`);
  });

  try {
    await enterWorld(page);
    await page.evaluate(() => window.__perf?.reset?.());

    // Keep world, animation, input, camera and combat paths active during sampling.
    const activity = (async () => {
      const keys = ['KeyD', 'KeyS', 'KeyA', 'KeyW'];
      const end = Date.now() + seconds * 1000;
      let index = 0;
      while (Date.now() < end) {
        const key = keys[index++ % keys.length];
        await page.keyboard.down(key);
        await page.waitForTimeout(450);
        await page.keyboard.up(key);
        await page.keyboard.press('KeyJ');
        await page.waitForTimeout(100);
      }
    })();

    const frames = await page.evaluate(async (durationMs) => {
      const values = [];
      const start = performance.now();
      let previous = start;
      await new Promise((resolve) => {
        const tick = (now) => {
          values.push(now - previous);
          previous = now;
          if (now - start >= durationMs) resolve(); else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      return values.slice(2);
    }, seconds * 1000);
    await activity;

    const sorted = frames.slice().sort((a, b) => a - b);
    const average = frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length);
    const runtime = await page.evaluate(() => ({
      activeScenes: window.__wayfarer.scene.getScenes(true).map((scene) => scene.scene.key),
      canvas: { width: window.__wayfarer.canvas.width, height: window.__wayfarer.canvas.height },
      profiler: window.__perf?.snapshot?.() || null,
    }));
    const report = {
      url,
      viewport: '390x844@2x touch',
      seconds,
      samples: frames.length,
      frameMs: {
        average: +average.toFixed(2),
        median: +percentile(sorted, 0.5).toFixed(2),
        p95: +percentile(sorted, 0.95).toFixed(2),
        p99: +percentile(sorted, 0.99).toFixed(2),
        max: +(sorted.at(-1) || 0).toFixed(2),
        over25: frames.filter((value) => value > 25).length,
        over50: frames.filter((value) => value > 50).length,
      },
      runtime,
      errors,
    };
    console.log(JSON.stringify(report, null, 2));
    if (errors.length) process.exitCode = 1;
  } finally {
    await browser.close();
    preview?.kill();
  }
}

main().catch((error) => {
  preview?.kill();
  console.error(error.stack || error);
  process.exit(1);
});
