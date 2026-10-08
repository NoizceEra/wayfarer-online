import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_VIDEO = path.join(ROOT, 'public', 'trailer', 'wayfarer_agent_arena_promo.mp4');
const AUDIO_FILE = path.join(ROOT, 'public', 'assets', 'audio', 'music', 'mus_boss.ogg');

const FPS = 30; // 30 FPS for fast, crisp rendering
const DURATION_SEC = 30;
const TOTAL_FRAMES = FPS * DURATION_SEC; // 900 frames
const WIDTH = 1920;
const HEIGHT = 1080;

// Simple static HTTP server to serve assets cleanly to Puppeteer
function startStaticServer(port = 5279) {
  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.ogg': 'audio/ogg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm'
  };

  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/') reqPath = '/trailer/agent_arena_trailer.html';
    
    const filePath = path.join(ROOT, 'public', reqPath);
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
      fs.createReadStream(filePath).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Static server running on http://localhost:${port}`);
      resolve(server);
    });
  });
}

async function main() {
  console.log(`=== Wayfarer Agent Arena Promo Trailer Renderer ===`);
  const PORT = 5279;
  const server = await startStaticServer(PORT);
  const TARGET_URL = `http://localhost:${PORT}/trailer/agent_arena_trailer.html`;

  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Resolution: ${WIDTH}x${HEIGHT} @ ${FPS} FPS`);
  console.log(`Duration: ${DURATION_SEC}s (${TOTAL_FRAMES} frames)`);

  fs.mkdirSync(path.dirname(OUT_VIDEO), { recursive: true });

  const hasAudio = fs.existsSync(AUDIO_FILE);
  console.log(`Audio File: ${hasAudio ? AUDIO_FILE : 'None'}`);

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', String(FPS),
    '-i', '-'
  ];

  if (hasAudio) {
    ffmpegArgs.push('-i', AUDIO_FILE);
  }

  ffmpegArgs.push(
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'fast'
  );

  if (hasAudio) {
    ffmpegArgs.push('-c:a', 'aac', '-b:a', '192k', '-shortest');
  }

  ffmpegArgs.push(OUT_VIDEO);

  console.log('Spawning ffmpeg process with stdin pipe...');
  const ffmpeg = spawn('ffmpeg', ffmpegArgs);

  const ffmpegDone = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    ffmpeg.on('error', reject);
  });

  console.log('Launching Puppeteer browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  console.log(`Loading page ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  });

  // Pause timeline
  await page.evaluate(() => {
    const tl = window.__timelines?.["agent_arena_trailer"];
    if (tl) tl.pause(0);
  });

  await new Promise(r => setTimeout(r, 400));
  console.log(`Streaming ${TOTAL_FRAMES} frames directly into ffmpeg pipe...`);
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FPS;

    await page.evaluate((t) => {
      const tl = window.__timelines?.["agent_arena_trailer"];
      if (tl) tl.seek(t, false);
    }, time);

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

    // Pipe buffer directly into ffmpeg stdin
    const canWrite = ffmpeg.stdin.write(screenshotBuffer);
    if (!canWrite) {
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    }

    if ((i + 1) % 60 === 0 || i + 1 === TOTAL_FRAMES) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = (((i + 1) / TOTAL_FRAMES) * 100).toFixed(1);
      const fpsReal = ((i + 1) / (Date.now() - startTime) * 1000).toFixed(1);
      console.log(`Progress: frame ${i + 1}/${TOTAL_FRAMES} (${pct}%) - ${elapsed}s elapsed (${fpsReal} FPS)`);
    }
  }

  console.log('Frame capture completed. Closing browser & flushing ffmpeg...');
  await browser.close();
  ffmpeg.stdin.end();

  await ffmpegDone;
  server.close();
  console.log(`SUCCESS! Rendered Promotional Trailer MP4 video at: ${OUT_VIDEO}`);

  if (fs.existsSync(OUT_VIDEO)) {
    const stats = fs.statSync(OUT_VIDEO);
    console.log(`Output Video File Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (${stats.size} bytes)`);
  }
}

main().catch(err => {
  console.error('Render error:', err);
  process.exit(1);
});
