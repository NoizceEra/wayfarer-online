import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_VIDEO = path.join(ROOT, 'public', 'trailer', 'wayfarer_trailer.mp4');
const TEMP_DIR = path.join(__dirname, '.temp_trailer_frames');
const TARGET_URL = 'http://localhost:5176/trailer/index.html';

const FPS = 60;
const DURATION_SEC = 18;
const TOTAL_FRAMES = FPS * DURATION_SEC; // 1080 frames
const WIDTH = 1920;
const HEIGHT = 1080;

async function runFfmpeg(inputPattern, outputVideoPath) {
  return new Promise((resolve, reject) => {
    console.log(`Encoding frames to 1080p MP4 video using ffmpeg...`);
    const args = [
      '-y',
      '-framerate', String(FPS),
      '-i', inputPattern,
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-crf', '18',
      '-preset', 'medium',
      outputVideoPath
    ];

    const ffmpeg = spawn('ffmpeg', args, { stdio: 'inherit' });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      reject(err);
    });
  });
}

async function main() {
  console.log(`=== Wayfarer Video Trailer Renderer ===`);
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Resolution: ${WIDTH}x${HEIGHT} @ ${FPS} FPS`);
  console.log(`Duration: ${DURATION_SEC}s (${TOTAL_FRAMES} frames)`);

  // Ensure output directory exists
  fs.mkdirSync(path.dirname(OUT_VIDEO), { recursive: true });

  // Re-create temp frames directory
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });

  console.log('Launching Puppeteer browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--force-device-scale-factor=1'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  console.log(`Loading page ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });

  // Ensure document fonts and images are ready
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // Pause GSAP master timeline and videos
  const hasTimeline = await page.evaluate(() => {
    const tl = window.__timelines?.["arcade-gameplay-trailer"];
    if (tl) {
      tl.pause(0);
    }
    const vids = document.querySelectorAll('video');
    vids.forEach(v => {
      v.pause();
      v.currentTime = 0;
    });
    return !!tl;
  });

  if (!hasTimeline) {
    console.warn('Warning: GSAP master timeline window.__timelines["arcade-gameplay-trailer"] not found!');
  } else {
    console.log('GSAP master timeline bound and paused at 0s.');
  }

  // Small delay for initial render settle
  await new Promise(r => setTimeout(r, 500));

  console.log(`Capturing ${TOTAL_FRAMES} frames...`);
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FPS;

    await page.evaluate((t) => {
      const tl = window.__timelines?.["arcade-gameplay-trailer"];
      if (tl) {
        tl.seek(t, false);
      }
      const vids = document.querySelectorAll('video');
      vids.forEach(v => {
        v.currentTime = t % (v.duration || 1);
      });
    }, time);

    const frameNum = String(i + 1).padStart(5, '0');
    const framePath = path.join(TEMP_DIR, `frame_${frameNum}.png`);

    await page.screenshot({
      path: framePath,
      type: 'png',
      omitBackground: false
    });

    if ((i + 1) % 120 === 0 || i + 1 === TOTAL_FRAMES) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = (((i + 1) / TOTAL_FRAMES) * 100).toFixed(1);
      console.log(`Progress: frame ${i + 1}/${TOTAL_FRAMES} (${pct}%) - ${elapsed}s elapsed`);
    }
  }

  console.log('Frame capture completed. Closing browser...');
  await browser.close();

  // Encode with ffmpeg
  const inputPattern = path.join(TEMP_DIR, 'frame_%05d.png');
  await runFfmpeg(inputPattern, OUT_VIDEO);

  // Clean up temp dir
  console.log('Cleaning up temporary frame directory...');
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  const stats = fs.statSync(OUT_VIDEO);
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
  const sizeBytes = stats.size;
  console.log(`\nSUCCESS! Video rendered to: ${OUT_VIDEO}`);
  console.log(`File size: ${sizeMB} MB (${sizeBytes} bytes)`);
}

main().catch((err) => {
  console.error('Fatal error during rendering:', err);
  process.exit(1);
});
