import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch (e) {
  puppeteer = (await import('file:///C:/Users/vclin_jjufoql/node_modules/puppeteer/lib/puppeteer/puppeteer.js')).default;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const PUBLIC_DIR = path.join(ROOT, 'public');
const OUT_MP4 = path.join(PUBLIC_DIR, 'trailer', 'wayfarer_login_bg.mp4');
const OUT_GIF = path.join(PUBLIC_DIR, 'trailer', 'wayfarer_login_bg.gif');
const PALETTE_PNG = path.join(__dirname, '.tmp_palette.png');

const PORT = 5188;
const FPS = 60;
const DURATION_SEC = 30;
const TOTAL_FRAMES = FPS * DURATION_SEC; // 1800 frames
const WIDTH = 1920;
const HEIGHT = 1080;

// Simple static file server for local rendering
function createStaticServer(rootPort) {
  const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2'
  };

  const server = http.createServer((req, res) => {
    let reqPath = req.url.split('?')[0];
    if (reqPath === '/') reqPath = '/trailer/pure_gameplay_trailer.html';
    
    let filePath = path.join(PUBLIC_DIR, reqPath);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(ROOT, reqPath);
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(rootPort, () => {
      console.log(`Static render server listening on http://localhost:${rootPort}`);
      resolve(server);
    });
  });
}

async function renderMp4(targetUrl) {
  console.log(`\n=== 1. Rendering Pure Gameplay MP4 Video ===`);
  console.log(`Resolution: ${WIDTH}x${HEIGHT} @ ${FPS} FPS`);
  console.log(`Duration: ${DURATION_SEC}s (${TOTAL_FRAMES} frames)`);
  console.log(`Output: ${OUT_MP4}`);

  fs.mkdirSync(path.dirname(OUT_MP4), { recursive: true });

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', String(FPS),
    '-i', '-',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-crf', '18',
    '-preset', 'fast',
    '-an', // Silent, no audio stream
    '-movflags', '+faststart',
    OUT_MP4
  ];

  console.log('Spawning ffmpeg process for MP4 encoding...');
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
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });

  console.log(`Loading page ${targetUrl}...`);
  await page.goto(targetUrl, { waitUntil: 'networkidle0' });

  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  });

  // Pre-load / buffer videos
  await page.evaluate(() => {
    document.querySelectorAll('video').forEach(v => {
      v.play().catch(() => {});
      v.pause();
    });
  });

  await new Promise(r => setTimeout(r, 1000));

  console.log(`Capturing ${TOTAL_FRAMES} frames at 60 FPS...`);
  const startTime = Date.now();

  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const time = i / FPS;

    await page.evaluate((t) => {
      if (typeof window.setTrailerTime === 'function') {
        window.setTrailerTime(t);
      } else {
        const tl = window.tl || window.__timelines?.["pure-gameplay-trailer"];
        if (tl) tl.seek(t, false);
      }
    }, time);

    // Wait a tick for video frame seek settling
    await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));

    const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 95 });

    const canWrite = ffmpeg.stdin.write(screenshotBuffer);
    if (!canWrite) {
      await new Promise(resolve => ffmpeg.stdin.once('drain', resolve));
    }

    if ((i + 1) % 120 === 0 || i + 1 === TOTAL_FRAMES) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const pct = (((i + 1) / TOTAL_FRAMES) * 100).toFixed(1);
      const realFps = ((i + 1) / ((Date.now() - startTime) / 1000)).toFixed(1);
      console.log(`Progress: frame ${i + 1}/${TOTAL_FRAMES} (${pct}%) - ${elapsed}s elapsed (${realFps} FPS)`);
    }
  }

  console.log('Frame capture completed. Closing browser and waiting for ffmpeg...');
  await browser.close();
  ffmpeg.stdin.end();

  await ffmpegDone;

  const stats = fs.statSync(OUT_MP4);
  console.log(`MP4 Render complete: ${OUT_MP4} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

function convertMp4ToGif() {
  console.log(`\n=== 2. Converting MP4 to Optimized GIF Fallback ===`);
  console.log(`Input: ${OUT_MP4}`);
  console.log(`Output: ${OUT_GIF}`);

  if (fs.existsSync(PALETTE_PNG)) {
    fs.rmSync(PALETTE_PNG, { force: true });
  }

  // Pass 1: Generate palette
  console.log('Generating optimized color palette...');
  const paletteCmd = `ffmpeg -y -i "${OUT_MP4}" -vf "fps=15,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" "${PALETTE_PNG}"`;
  execSync(paletteCmd, { stdio: 'inherit' });

  // Pass 2: Generate GIF with palette
  console.log('Encoding optimized GIF...');
  const gifCmd = `ffmpeg -y -i "${OUT_MP4}" -i "${PALETTE_PNG}" -filter_complex "fps=15,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle" "${OUT_GIF}"`;
  execSync(gifCmd, { stdio: 'inherit' });

  if (fs.existsSync(PALETTE_PNG)) {
    fs.rmSync(PALETTE_PNG, { force: true });
  }

  const stats = fs.statSync(OUT_GIF);
  console.log(`GIF Conversion complete: ${OUT_GIF} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

async function main() {
  const server = await createStaticServer(PORT);
  const targetUrl = `http://localhost:${PORT}/trailer/pure_gameplay_trailer.html`;

  try {
    await renderMp4(targetUrl);
    convertMp4ToGif();

    console.log('\n========================================');
    console.log('ALL TASKS COMPLETED SUCCESSFULLY!');
    console.log(`MP4: ${OUT_MP4} (${fs.existsSync(OUT_MP4) ? fs.statSync(OUT_MP4).size + ' bytes' : 'MISSING'})`);
    console.log(`GIF: ${OUT_GIF} (${fs.existsSync(OUT_GIF) ? fs.statSync(OUT_GIF).size + ' bytes' : 'MISSING'})`);
    console.log('========================================\n');
  } finally {
    server.close();
  }
}

main().catch(err => {
  console.error('Fatal error during rendering:', err);
  process.exit(1);
});
