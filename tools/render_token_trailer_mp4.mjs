import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_VIDEO = path.join(ROOT, 'public', 'trailer', 'wayfarer_token_trailer.mp4');
const AUDIO_FILE = path.join(ROOT, 'public', 'assets', 'audio', 'music', 'mus_token_trailer.wav');
const TARGET_URL = 'http://localhost:5176/trailer/token_trailer.html';

const FPS = 60;
const DURATION_SEC = 30;
const TOTAL_FRAMES = FPS * DURATION_SEC; // 1800 frames
const WIDTH = 1920;
const HEIGHT = 1080;

async function main() {
  console.log(`=== Wayfarer Token Trailer Renderer ===`);
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

  ffmpeg.stderr.on('data', (d) => {
    // console.log(`[ffmpeg] ${d.toString()}`);
  });

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

  // Pause timeline and videos
  await page.evaluate(() => {
    const tl = window.__timelines?.["token-trailer"] || window.__timelines?.["token_trailer"];
    if (tl) tl.pause(0);
    document.querySelectorAll('video').forEach(v => { v.pause(); v.currentTime = 0; });
  });

  await new Promise(r => setTimeout(r, 400));
  console.log(`Streaming ${TOTAL_FRAMES} frames directly into ffmpeg pipe...`);
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FPS;

    await page.evaluate((t) => {
      const tl = window.__timelines?.["token-trailer"] || window.__timelines?.["token_trailer"];
      if (tl) tl.seek(t, false);
      document.querySelectorAll('video').forEach(v => {
        if (v.duration && !isNaN(v.duration)) {
          v.currentTime = t % v.duration;
        }
      });
    }, time);

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

    const canWrite = ffmpeg.stdin.write(screenshotBuffer);
    if (!canWrite) {
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    }

    if ((i + 1) % 120 === 0 || i + 1 === TOTAL_FRAMES) {
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
  console.log(`SUCCESS! Rendered Token Trailer MP4 video at: ${OUT_VIDEO}`);

  if (fs.existsSync(OUT_VIDEO)) {
    const stats = fs.statSync(OUT_VIDEO);
    console.log(`Output Video File Size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB (${stats.size} bytes)`);
  }
}

main().catch(err => {
  console.error('Render error:', err);
  process.exit(1);
});
