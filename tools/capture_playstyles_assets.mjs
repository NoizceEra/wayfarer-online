import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'playstyles');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordSegment(page, outPngPath, outWebmPath, durationMs, actionFn) {
  console.log(`\n--- Recording segment for [${path.basename(outPngPath)}] & [${path.basename(outWebmPath)}] ---`);

  // Start MediaRecorder in browser canvas stream
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

  // Execute setup / in-game action
  await actionFn();

  // Wait for visual setup & animations
  await sleep(1500);

  // Capture PNG Screenshot
  console.log(`Saving screenshot: ${outPngPath}`);
  await page.screenshot({ path: outPngPath });

  // Record remaining video clip duration
  const remainingTime = Math.max(1000, durationMs - 1500);
  await sleep(remainingTime);

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
  console.log('=== Earning Playstyles Asset Generator & Recorder ===');
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
  await sleep(1000);

  // Initialize Hero & Launch World Scene
  console.log('Starting World Scene...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 0, hairStyle: 1, hairColor: 2, topTint: 1, accessory: 'scarf', weapon: 'sunfire_blade' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  // Wait 4 seconds for World Scene map rendering
  await sleep(4000);

  // --------------------------------------------------------------------------
  // 1. playstyle_1_crafting.png & playstyle_1_crafting.webm
  // (Crafting food/potions at Lotte/Wren merchants)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'playstyle_1_crafting.png'),
    path.join(OUT_DIR, 'playstyle_1_crafting.webm'),
    4500,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const world = game.scene.getScene('world');
        const ui = game.scene.getScene('ui');

        // Close any active modal
        if (ui.equip?.isOpen) ui.equip.toggle(false);
        if (ui.journal?.isOpen) ui.journal.close();

        if (world && world.player && world.townfolk) {
          // Position near Lotte / Wren merchants in Thistle Town
          const lotteRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'lotte');
          if (lotteRec) {
            world.player.setPosition(lotteRec.day.x + 24, lotteRec.day.y + 16);
            world.player.setFacing('left');
            world.cameras.main.centerOn(world.player.x, world.player.y);
          }
        }

        // Open Crafting Panel on alchemy / campfire tab
        if (ui && ui.craftPanel) {
          ui.craftPanel.toggle(true, 'alchemy');
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // 2. playstyle_2_trading.png & playstyle_2_trading.webm
  // (Posey's Market Board UI, listing items & mail gold payouts)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'playstyle_2_trading.png'),
    path.join(OUT_DIR, 'playstyle_2_trading.webm'),
    4500,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const world = game.scene.getScene('world');
        const ui = game.scene.getScene('ui');

        if (ui.craftPanel?.isOpen) ui.craftPanel.close();

        if (world && world.player && world.townfolk) {
          // Position near Posey's Market Board clerk
          const poseyRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'posey');
          if (poseyRec) {
            world.player.setPosition(poseyRec.day.x + 20, poseyRec.day.y + 16);
            world.player.setFacing('left');
            world.cameras.main.centerOn(world.player.x, world.player.y);
          }
        }

        // Setup mock economy online state and market / mail listings
        if (window.__econUI) {
          const { market, mail } = window.__econUI;
          market.open('browse');
          market.result = {
            page: 0, pages: 1, total: 4,
            items: [
              { item: 'sunfire_blade', price: 1250, seller: 'PoseyMarket', lvl: 10, left: 86400 },
              { item: 'vampire_coat', price: 850, seller: 'LotteBaker', lvl: 8, left: 43200 },
              { item: 'potion_small', price: 25, seller: 'WrenHerbs', lvl: 1, left: 72000 },
              { item: 'reaper_scythe', price: 2500, seller: 'JackLantern', lvl: 15, left: 100000 }
            ]
          };
          market.render();

          // Prepare mail inbox with gold payouts
          mail.box = {
            unread: 2,
            mails: [
              { id: 'm1', subject: 'Market Sale Payout: Sunfire Blade (+1,250g)', from: 'Posey Market Board', at: Date.now() - 1800000, sys: true, gold: 1250, items: [] },
              { id: 'm2', subject: 'Market Sale Payout: Capling Leather (+350g)', from: 'Posey Market Board', at: Date.now() - 7200000, sys: true, gold: 350, items: [] }
            ]
          };
        }
      });

      // Switch to Mail Panel after 2 seconds during the recording clip
      await sleep(2000);
      await page.evaluate(() => {
        if (window.__econUI) {
          window.__econUI.market.close();
          window.__econUI.mail.open('inbox');
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // 3. playstyle_3_questing.png & playstyle_3_questing.webm
  // (Quill's Notice Board quest log & reward claim)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'playstyle_3_questing.png'),
    path.join(OUT_DIR, 'playstyle_3_questing.webm'),
    4500,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const world = game.scene.getScene('world');
        const ui = game.scene.getScene('ui');

        if (window.__econUI) {
          window.__econUI.mail.close();
          window.__econUI.market.close();
        }

        if (world && world.player && world.townfolk) {
          // Position near Quill (Scribe) & Thistle Town Notice Board
          const quillRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'quill');
          if (quillRec) {
            world.player.setPosition(quillRec.day.x + 24, quillRec.day.y + 16);
            world.player.setFacing('left');
            world.cameras.main.centerOn(world.player.x, world.player.y);
          }
        }

        // Open Journal Panel on Active Quests
        if (ui && ui.journal) {
          ui.journal.toggle(true, 'active');
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // 4. playstyle_4_battling.png & playstyle_4_battling.webm
  // (Active combat slaying monsters & WAYFARER token drops)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'playstyle_4_battling.png'),
    path.join(OUT_DIR, 'playstyle_4_battling.webm'),
    4500,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const world = game.scene.getScene('world');
        const ui = game.scene.getScene('ui');

        if (ui.journal?.isOpen) ui.journal.close();

        if (world && world.player) {
          // Move to meadowfield combat spawn
          const spawn = world.areas.over.spawn;
          world.player.setPosition(spawn.x + 280, spawn.y + 140);
          world.cameras.main.centerOn(world.player.x, world.player.y);

          // Equip sunfire blade & attack posture
          world.player.equip('sunfire_blade', true);
          world.player.setFacing('right');
          world.player.attackPose();

          // Spawn enemies
          if (world.makeEnemy) {
            world.makeEnemy(world.player.x + 36, world.player.y - 8, 'dewslime');
            world.makeEnemy(world.player.x + 60, world.player.y + 16, 'capling');
          }

          // Trigger combat WAYFARER token drop UI
          if (window.__earnUI) {
            window.__earnUI.triggerCombatTokenDrop(world);
          }
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // 5. playstyle_5_hybrid.png & playstyle_5_hybrid.webm
  // (Character inventory, stat growth & idle yield indicator)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'playstyle_5_hybrid.png'),
    path.join(OUT_DIR, 'playstyle_5_hybrid.webm'),
    4500,
    async () => {
      await page.evaluate(() => {
        const game = window.__wayfarer;
        const world = game.scene.getScene('world');
        const ui = game.scene.getScene('ui');

        if (world && world.player) {
          // Give player some gear and stats for hybrid representation
          world.player.equip('sunfire_blade', true);
          world.player.equip('jacko_helm', true);
        }

        // Open Equipment / Character Stats Panel
        if (ui && ui.equip) {
          ui.equip.toggle(true);
        }

        // Open Idle Yield Earnings Panel
        if (window.__earnUI) {
          window.__earnUI.openIdlePanel(world);
        }
      });
    }
  );

  await browser.close();

  console.log('\n======================================================');
  console.log('SUCCESS! All 5 Earning Playstyle assets generated & recorded in public/assets/custom/playstyles/:');
  console.log(' - playstyle_1_crafting.png & playstyle_1_crafting.webm');
  console.log(' - playstyle_2_trading.png & playstyle_2_trading.webm');
  console.log(' - playstyle_3_questing.png & playstyle_3_questing.webm');
  console.log(' - playstyle_4_battling.png & playstyle_4_battling.webm');
  console.log(' - playstyle_5_hybrid.png & playstyle_5_hybrid.webm');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Fatal error generating playstyle assets:', err);
  process.exit(1);
});
