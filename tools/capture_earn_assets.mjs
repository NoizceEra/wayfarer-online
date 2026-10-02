import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'earn');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

async function recordSegment(page, outPngPath, outWebmPath, durationMs, actionFn) {
  console.log(`\n--- Recording segment for [${path.basename(outPngPath)}] & [${path.basename(outWebmPath)}] ---`);

  // Start MediaRecorder in browser
  await page.evaluate(() => {
    window.__recordedChunks = [];
    const canvas = document.querySelector('canvas');
    if (!canvas) throw new Error('Canvas not found!');

    const stream = canvas.captureStream(60);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 8000000 });
    } catch (e) {
      recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 8000000 });
    }

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        window.__recordedChunks.push(e.data);
      }
    };

    window.__mediaRecorder = recorder;
    recorder.start(50);
  });

  // Execute in-game action (e.g. trigger combat drop or open panel)
  await actionFn();

  // Wait for visual setup
  await new Promise(r => setTimeout(r, 1500));

  // Capture PNG Screenshot
  console.log(`Saving screenshot: ${outPngPath}`);
  await page.screenshot({ path: outPngPath });

  // Record remaining video clip duration
  const remainingTime = Math.max(1000, durationMs - 1500);
  await new Promise(r => setTimeout(r, remainingTime));

  // Stop MediaRecorder and retrieve WebM video Base64 buffer
  console.log(`Stopping MediaRecorder and saving WebM video clip: ${outWebmPath}`);
  const base64Video = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const recorder = window.__mediaRecorder;
      if (!recorder || recorder.state === 'inactive') {
        resolve(null);
        return;
      }
      recorder.onstop = () => {
        const blob = new Blob(window.__recordedChunks, { type: 'video/webm' });
        const reader = new FileReader();
        reader.onloadend = () => {
          const base64 = reader.result.split(',')[1];
          resolve(base64);
        };
        reader.readAsDataURL(blob);
      };
      recorder.stop();
    });
  });

  if (base64Video) {
    const videoBuffer = Buffer.from(base64Video, 'base64');
    fs.writeFileSync(outWebmPath, videoBuffer);
    console.log(`✔ Created clip [${path.basename(outWebmPath)}] (${(videoBuffer.length / 1024).toFixed(1)} KB)`);
  } else {
    console.error(`✖ Failed to record video for ${outWebmPath}`);
  }
}

async function main() {
  console.log('=== Play-to-Earn Asset Generator & Recorder ===');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Output Directory: ${OUT_DIR}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('Launching Puppeteer browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 },
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  console.log(`Navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await new Promise(r => setTimeout(r, 1000));

  // Initialize Hero & Launch World Scene
  console.log('Starting Thistle Town World Scene...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 0, hairStyle: 1, hairColor: 2, topTint: 1, accessory: 'scarf', weapon: 'sunfire_blade' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  // Wait 4 seconds for World Scene map rendering
  await new Promise(r => setTimeout(r, 4000));

  // 1. Monster combat slay & WAYFARER token drop
  await recordSegment(
    page,
    path.join(OUT_DIR, 'earn_1_combat.png'),
    path.join(OUT_DIR, 'earn_1_combat.webm'),
    4000,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const worldScene = game.scene.getScene('world');
        if (window.__earnUI) {
          window.__earnUI.triggerCombatTokenDrop(worldScene);
        }
      });
    }
  );

  // 2. Offline Idle Gold Earnings Panel
  await recordSegment(
    page,
    path.join(OUT_DIR, 'earn_2_idle.png'),
    path.join(OUT_DIR, 'earn_2_idle.webm'),
    4000,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const worldScene = game.scene.getScene('world');
        if (window.__earnUI) {
          window.__earnUI.openIdlePanel(worldScene);
        }
      });
    }
  );

  // 3. Staking Lock Tiers & Yield Sheet Panel
  await recordSegment(
    page,
    path.join(OUT_DIR, 'earn_3_staking.png'),
    path.join(OUT_DIR, 'earn_3_staking.webm'),
    4000,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const worldScene = game.scene.getScene('world');
        if (window.__earnUI) {
          window.__earnUI.openStakingPanel(worldScene);
        }
      });
    }
  );

  // 4. Solana Wallet Link & Instant On-Chain Token Payout Claim UI
  await recordSegment(
    page,
    path.join(OUT_DIR, 'earn_4_payout.png'),
    path.join(OUT_DIR, 'earn_4_payout.webm'),
    4000,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const worldScene = game.scene.getScene('world');
        if (window.__earnUI) {
          window.__earnUI.openPayoutPanel(worldScene);
        }
      });
    }
  );

  await browser.close();
  console.log('\n======================================================');
  console.log('SUCCESS! All 4 Play-to-Earn assets generated & recorded into public/assets/custom/earn/:');
  console.log(' - earn_1_combat.png & earn_1_combat.webm');
  console.log(' - earn_2_idle.png & earn_2_idle.webm');
  console.log(' - earn_3_staking.png & earn_3_staking.webm');
  console.log(' - earn_4_payout.png & earn_4_payout.webm');
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal error generating earn assets:', err);
  process.exit(1);
});
