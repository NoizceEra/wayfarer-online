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
const TMP_DIR = fs.mkdtempSync(path.join(ROOT, 'tmp_trailer_render_'));
const PALETTE_PNG = path.join(TMP_DIR, 'palette.png');

const FPS = 60;
const WIDTH = 1920;
const HEIGHT = 1080;

// Static file server with range request support
function createStaticServer() {
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
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range && (ext === '.webm' || ext === '.mp4')) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': contentType,
      };
      res.writeHead(206, head);
      file.pipe(res);
      return;
    }

    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  });

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port;
      console.log(`Static render server listening on http://localhost:${port}`);
      resolve({ server, port });
    });
  });
}

async function renderLogoCard(targetUrl) {
  console.log('\n--- 1. Rendering Jacquard12 Logo Card Intro (3.0s @ 60 FPS) ---');
  const logoMp4 = path.join(TMP_DIR, 'seg_0_logo.mp4');
  const LOGO_FRAMES = 180; // 3.0 seconds * 60 FPS

  const ffmpegArgs = [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-framerate', String(FPS),
    '-i', '-',
    '-vf', 'format=yuv420p,setsar=1',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-color_range', '1',
    '-colorspace', 'bt709',
    '-color_trc', 'bt709',
    '-color_primaries', 'bt709',
    '-crf', '18',
    '-preset', 'fast',
    '-an',
    logoMp4
  ];

  const ffmpeg = spawn('ffmpeg', ffmpegArgs);
  const ffmpegDone = new Promise((resolve, reject) => {
    ffmpeg.on('close', (code) => code === 0 ? resolve() : reject(new Error(`Logo card ffmpeg exited code ${code}`)));
    ffmpeg.on('error', reject);
  });

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => { if (document.fonts) await document.fonts.ready; });

  for (let i = 0; i < LOGO_FRAMES; i++) {
    const t = i / FPS;
    await page.evaluate((time) => {
      if (window.setTrailerTime) window.setTrailerTime(time);
    }, t);

    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    const canWrite = ffmpeg.stdin.write(buf);
    if (!canWrite) await new Promise(res => ffmpeg.stdin.once('drain', res));
  }

  await browser.close();
  ffmpeg.stdin.end();
  await ffmpegDone;

  console.log(`Logo Card Intro rendered: ${logoMp4}`);
  return logoMp4;
}

function processGameplaySegments(logoMp4) {
  console.log('\n--- 2. Processing Raw Gameplay Clips ---');

  const clipsDir = path.join(PUBLIC_DIR, 'assets', 'custom', 'clips', 'pure_gameplay');
  
  // Total 30.0 seconds sequence:
  // seg 0: logoMp4 (3.0s)
  // seg 1: clip_3_town.webm (start: 1.0s, dur: 7.5s) -> 3.0s - 10.5s
  // seg 2: clip_5_combat.webm (start: 2.0s, dur: 9.0s) -> 10.5s - 19.5s
  // seg 3: clip_4_gear.webm (start: 0.5s, dur: 3.5s) -> 19.5s - 23.0s
  // seg 4: clip_6_shop.webm (start: 0.5s, dur: 3.5s) -> 23.0s - 26.5s
  // seg 5: clip_5_combat.webm (start: 14.0s, dur: 3.5s) -> 26.5s - 30.0s
  const rawSegments = [
    { type: 'file', path: logoMp4, start: 0, dur: 3.0 },
    { type: 'clip', file: 'clip_3_town.webm', start: 1.0, dur: 7.5 },
    { type: 'clip', file: 'clip_5_combat.webm', start: 2.0, dur: 9.0 },
    { type: 'clip', file: 'clip_4_gear.webm', start: 0.5, dur: 3.5 },
    { type: 'clip', file: 'clip_6_shop.webm', start: 0.5, dur: 3.5 },
    { type: 'clip', file: 'clip_5_combat.webm', start: 14.0, dur: 3.5 }
  ];

  const processedFiles = [];

  rawSegments.forEach((seg, idx) => {
    const outFile = path.join(TMP_DIR, `seg_${idx}_encoded.mp4`);
    const inFile = seg.type === 'file' ? seg.path : path.join(clipsDir, seg.file);

    console.log(`Processing Segment ${idx}: ${seg.file || 'logo'} [${seg.start}s - ${seg.start + seg.dur}s]`);

    const cmd = `ffmpeg -y -hide_banner -loglevel error -ss ${seg.start} -t ${seg.dur} -i "${inFile}" -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=60,format=yuv420p" -color_range 1 -colorspace bt709 -color_trc bt709 -color_primaries bt709 -c:v libx264 -preset fast -crf 18 -an "${outFile}"`;
    execSync(cmd, { stdio: 'inherit' });
    processedFiles.push(outFile);
  });

  // Concat list
  const listFile = path.join(TMP_DIR, 'concat_list.txt');
  const listLines = processedFiles.map(f => `file '${f.replace(/\\/g, '/')}'`);
  fs.writeFileSync(listFile, listLines.join('\n') + '\n');

  console.log('\n--- 3. Concatenating into 1080p 60 FPS MP4 Trailer ---');
  const concatCmd = `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${listFile}" -c copy -movflags +faststart "${OUT_MP4}"`;
  execSync(concatCmd, { stdio: 'inherit' });

  const stats = fs.statSync(OUT_MP4);
  console.log(`SUCCESS! Pure gameplay trailer MP4 rendered: ${OUT_MP4} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

function convertMp4ToGif() {
  console.log(`\n--- 4. Converting MP4 to Optimized GIF Fallback ---`);
  console.log(`Input: ${OUT_MP4}`);
  console.log(`Output: ${OUT_GIF}`);

  // Pass 1: Palette Generation
  console.log('Generating optimized color palette...');
  const paletteCmd = `ffmpeg -y -hide_banner -loglevel error -i "${OUT_MP4}" -vf "fps=15,scale=800:-1:flags=lanczos,palettegen=stats_mode=diff" "${PALETTE_PNG}"`;
  execSync(paletteCmd, { stdio: 'inherit' });

  // Pass 2: GIF Encoding with uniform color space
  console.log('Encoding high-quality GIF fallback...');
  const gifCmd = `ffmpeg -y -hide_banner -loglevel error -i "${OUT_MP4}" -i "${PALETTE_PNG}" -filter_complex "fps=15,scale=800:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${OUT_GIF}"`;
  execSync(gifCmd, { stdio: 'inherit' });

  const stats = fs.statSync(OUT_GIF);
  console.log(`SUCCESS! Optimized GIF rendered: ${OUT_GIF} (${(stats.size / (1024 * 1024)).toFixed(2)} MB)`);
}

async function main() {
  const { server, port } = await createStaticServer();
  const targetUrl = `http://localhost:${port}/trailer/pure_gameplay_trailer.html`;

  try {
    const logoMp4 = await renderLogoCard(targetUrl);
    processGameplaySegments(logoMp4);
    convertMp4ToGif();

    console.log('\n==================================================');
    console.log('PURE GAMEPLAY TRAILER RENDER COMPLETE!');
    console.log(`MP4: ${OUT_MP4} (${fs.statSync(OUT_MP4).size} bytes)`);
    console.log(`GIF: ${OUT_GIF} (${fs.statSync(OUT_GIF).size} bytes)`);
    console.log('==================================================\n');
  } finally {
    server.close();
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error('Fatal error during pure gameplay trailer rendering:', err);
  process.exit(1);
});
