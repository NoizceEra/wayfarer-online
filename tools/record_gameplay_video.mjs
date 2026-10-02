import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLIPS_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'clips');
const TEMP_DIR = path.join(__dirname, '.temp_recording');
const MASTER_WEBM = path.join(TEMP_DIR, 'master_gameplay.webm');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

async function runFfmpegSlice(inputFile, startTimeSec, durationSec, outputFile) {
  return new Promise((resolve, reject) => {
    console.log(`Slicing clip [${path.basename(outputFile)}] from ${startTimeSec.toFixed(2)}s for ${durationSec.toFixed(2)}s...`);
    const args = [
      '-y',
      '-ss', startTimeSec.toFixed(3),
      '-i', inputFile,
      '-t', durationSec.toFixed(3),
      '-c:v', 'copy',
      '-an',
      outputFile
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
  console.log('=== Wayfarer Live Gameplay Video Recorder ===');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Clips Output Dir: ${CLIPS_DIR}`);

  // Create directories
  fs.mkdirSync(CLIPS_DIR, { recursive: true });
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
      '--autoplay-policy=no-user-gesture-required',
      '--ignore-gpu-blocklist'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT });

  console.log(`Navigating to ${TARGET_URL}...`);
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await page.waitForSelector('canvas');
  await new Promise(r => setTimeout(r, 1000));

  // Initialize Canvas Recording in Browser
  console.log('Initializing MediaRecorder on canvas stream (60 FPS)...');
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
    window.__recordStartTime = performance.now();
    recorder.start(50);
  });

  const timestamps = {};

  const getRelTimeSec = async () => {
    return await page.evaluate(() => (performance.now() - window.__recordStartTime) / 1000);
  };

  // -------------------------------------------------------------
  // SEGMENT 1: Title Screen Menu Animation
  // -------------------------------------------------------------
  console.log('Recording Segment 1: Title Screen Menu Animation...');
  timestamps.title = { start: await getRelTimeSec() };
  
  // Let title animation play for ~4 seconds
  await new Promise(r => setTimeout(r, 4200));
  timestamps.title.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // SEGMENT 2: Character Creator Selection
  // -------------------------------------------------------------
  console.log('Recording Segment 2: Character Creator Selection...');
  timestamps.creator = { start: await getRelTimeSec() };

  await page.evaluate(() => {
    const game = window.__wayfarer;
    game.scene.start('creator', { name: 'Wayfarer', mode: 'solo' });
  });
  await new Promise(r => setTimeout(r, 800));

  // Live selection changes over 4.5s
  const creatorDuration = 4500;
  const creatorStartTime = Date.now();
  let cycleIndex = 0;

  while (Date.now() - creatorStartTime < creatorDuration) {
    await page.evaluate((idx) => {
      const creatorScene = window.__wayfarer.scene.getScene('creator');
      if (creatorScene && creatorScene.hero) {
        const jobs = ['wayfarer', 'sorcerer', 'knight', 'ninja'];
        creatorScene.hero.job = jobs[idx % jobs.length];
        creatorScene.hero.hairStyle = idx % 8;
        creatorScene.hero.hairColor = idx % 6;
        creatorScene.hero.topTint = idx % 6;
        creatorScene.hero.skin = idx % 4;

        if (typeof creatorScene.buildPreview === 'function') {
          // refresh preview if method exists
          const prevX = creatorScene.cameras.main.width * 0.17;
          creatorScene.buildPreview(prevX, 60, 200, 300);
        }
        if (creatorScene.nameLabel && creatorScene.hero.job) {
          creatorScene.nameLabel.setText(`Wayfarer  ·  ${creatorScene.hero.job.toUpperCase()}`);
        }
      }
    }, cycleIndex);

    cycleIndex++;
    await new Promise(r => setTimeout(r, 600));
  }
  timestamps.creator.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // SEGMENT 3: Player Walking Through Thistle Town
  // -------------------------------------------------------------
  console.log('Recording Segment 3: Player Walking Through Thistle Town...');
  timestamps.town = { start: await getRelTimeSec() };

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 0, hairStyle: 1, hairColor: 2, topTint: 1, accessory: 'scarf', weapon: 'sword' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  // Wait for overworld to render
  await new Promise(r => setTimeout(r, 2500));

  // Live player walking loop over 5 seconds
  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    const startX = worldScene.player.x;
    const startY = worldScene.player.y;
    
    // Animate walking loop (Right, Down, Left, Up)
    const steps = 180; // 3 seconds at 60 FPS
    for (let i = 0; i < steps; i++) {
      const phase = Math.floor((i / steps) * 4);
      if (phase === 0) {
        worldScene.player.x += 1.2;
        worldScene.player.facing = 'right';
      } else if (phase === 1) {
        worldScene.player.y += 1.2;
        worldScene.player.facing = 'down';
      } else if (phase === 2) {
        worldScene.player.x -= 1.2;
        worldScene.player.facing = 'left';
      } else {
        worldScene.player.y -= 1.2;
        worldScene.player.facing = 'up';
      }

      if (worldScene.player.anims && typeof worldScene.player.playWalkAnim === 'function') {
        worldScene.player.playWalkAnim(worldScene.player.facing);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  timestamps.town.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // SEGMENT 4: Player Opening & Inspecting Gear Inventory
  // -------------------------------------------------------------
  console.log('Recording Segment 4: Player Opening & Inspecting Gear Inventory...');
  timestamps.gear = { start: await getRelTimeSec() };

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const worldScene = game.scene.getScene('world');
    if (worldScene && worldScene.player) {
      worldScene.player.equipped.head = 'viking_helm';
      worldScene.player.equipped.weapon = 'sunfire_blade';
      if (Array.isArray(worldScene.player.inventory)) {
        worldScene.player.inventory.push('arcane_hood', 'shadow_mask', 'shadow_dagger', 'sunfire_charm', 'viking_plate');
      }
      worldScene.player.applyGearVisuals();
    }
    const uiScene = game.scene.getScene('ui');
    if (uiScene && uiScene.equip && uiScene.equip.toggle) {
      uiScene.equip.toggle(true);
    }
  });

  // Cycle gear items inspection over 4.5 seconds
  const gearDuration = 4500;
  const gearStart = Date.now();
  let gearStep = 0;
  const gearHelms = ['viking_helm', 'arcane_hood', 'shadow_mask'];
  const gearWeapons = ['sunfire_blade', 'shadow_dagger', 'viking_plate'];

  while (Date.now() - gearStart < gearDuration) {
    await page.evaluate((step, helms, weapons) => {
      const worldScene = window.__wayfarer.scene.getScene('world');
      if (worldScene && worldScene.player) {
        worldScene.player.equipped.head = helms[step % helms.length];
        worldScene.player.equipped.weapon = weapons[step % weapons.length];
        worldScene.player.applyGearVisuals();
      }
    }, gearStep, gearHelms, gearWeapons);

    gearStep++;
    await new Promise(r => setTimeout(r, 900));
  }
  timestamps.gear.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // SEGMENT 5: Player Fighting Monsters in Meadowfield
  // -------------------------------------------------------------
  console.log('Recording Segment 5: Player Fighting Monsters in Meadowfield...');
  timestamps.combat = { start: await getRelTimeSec() };

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const uiScene = game.scene.getScene('ui');
    if (uiScene && uiScene.equip && uiScene.equip.toggle) {
      uiScene.equip.toggle(false);
    }

    const worldScene = game.scene.getScene('world');
    if (worldScene && worldScene.player) {
      worldScene.player.setPosition(950, 750);
      worldScene.player.facing = 'right';
      worldScene.player.applyGearVisuals();

      // Spawn monsters
      if (worldScene.makeEnemy) {
        const dew = worldScene.makeEnemy(995, 745, 'dewslime');
        if (dew) {
          dew.hp = Math.round(dew.maxHp * 0.8);
          dew.showBars && dew.showBars(true);
        }
        const thorn = worldScene.makeEnemy(920, 735, 'thornmite');
        if (thorn) {
          thorn.hp = Math.round(thorn.maxHp * 0.9);
          thorn.showBars && thorn.showBars(true);
        }
        worldScene.__monsters = [dew, thorn];
      }
    }
  });

  // Real-time combat slashes, enemy lunges, damage numbers, spark VFX, & loot drops over 5.5s
  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    for (let tick = 0; tick < 300; tick++) {
      // Enemy movements
      if (worldScene.__monsters) {
        worldScene.__monsters.forEach((m, idx) => {
          if (m && m.active) {
            m.x += (idx % 2 === 0 ? -0.3 : 0.3);
          }
        });
      }

      // Attack swings and slashes every 50 ticks
      if (tick % 45 === 10) {
        if (typeof worldScene.player.attackPose === 'function') {
          worldScene.player.attackPose();
        }
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 22, worldScene.player.y - 8, 'fx.slashArc', 1.8, 0);
          worldScene.spawnFx(worldScene.player.x + 40, worldScene.player.y - 5, 'fx.spark', 1.5);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          const dmg = Math.floor(Math.random() * 40) + 30;
          const isCrit = Math.random() > 0.4;
          worldScene.combat.floatText(
            worldScene.player.x + 40 + Math.random() * 20,
            worldScene.player.y - 25,
            isCrit ? `-${dmg} CRIT!` : `-${dmg}`,
            isCrit ? '#ff3333' : '#ffffff',
            isCrit ? 'crit' : 'normal'
          );
        }
      }

      // Spawn coins and drops halfway through
      if (tick === 120) {
        if (worldScene.spawnDrop) {
          worldScene.spawnDrop(worldScene.player.x + 45, worldScene.player.y + 15, 'sunfire_blade');
        }
        if (worldScene.combat && typeof worldScene.combat.spawnCoin === 'function') {
          worldScene.combat.spawnCoin(worldScene.player.x + 30, worldScene.player.y + 10, 25, null);
          worldScene.combat.spawnCoin(worldScene.player.x + 55, worldScene.player.y + 20, 15, null);
        }
      }

      // Move player towards loot
      if (tick > 150) {
        worldScene.player.x += 0.4;
      }

      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  timestamps.combat.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // SEGMENT 6: Player Opening & Browsing Maren's Wares Shop UI
  // -------------------------------------------------------------
  console.log("Recording Segment 6: Player Opening & Browsing Maren's Wares Shop UI...");
  timestamps.shop = { start: await getRelTimeSec() };

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const uiScene = game.scene.getScene('ui');
    if (uiScene) {
      if (uiScene.equip && uiScene.equip.toggle) {
        uiScene.equip.toggle(false);
      }
      if (uiScene.shop && typeof uiScene.shop.show === 'function') {
        uiScene.shop.show('maren');
      }
    }
  });

  // Browse shop UI items over 4.5 seconds
  const shopDuration = 4500;
  const shopStart = Date.now();
  let shopStep = 0;

  while (Date.now() - shopStart < shopDuration) {
    await page.evaluate((step) => {
      const uiScene = window.__wayfarer.scene.getScene('ui');
      if (uiScene && uiScene.shop) {
        // Trigger item select / hover highlights on shop panel if present
        const items = uiScene.shop.items || [];
        if (items.length > 0) {
          const selected = items[step % items.length];
          uiScene.shop.selectedItem = selected;
          if (typeof uiScene.shop.render === 'function') {
            uiScene.shop.render();
          }
        }
      }
    }, shopStep);

    shopStep++;
    await new Promise(r => setTimeout(r, 900));
  }
  timestamps.shop.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // Stop MediaRecorder & Retrieve Video Buffer
  // -------------------------------------------------------------
  console.log('Stopping MediaRecorder and fetching raw WebM video data...');
  const base64Video = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const recorder = window.__mediaRecorder;
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

  await browser.close();
  console.log('Browser closed. Saving master recorded video file...');

  const videoBuffer = Buffer.from(base64Video, 'base64');
  fs.writeFileSync(MASTER_WEBM, videoBuffer);
  console.log(`Saved master video to ${MASTER_WEBM} (${(videoBuffer.length / (1024 * 1024)).toFixed(2)} MB)`);

  console.log('Timestamps logged for clips:');
  console.dir(timestamps);

  // -------------------------------------------------------------
  // Slice Master Video into 6 WebM Clips using FFmpeg
  // -------------------------------------------------------------
  const clipsConfig = [
    { name: 'clip_1_title.webm', key: 'title' },
    { name: 'clip_2_creator.webm', key: 'creator' },
    { name: 'clip_3_town.webm', key: 'town' },
    { name: 'clip_4_gear.webm', key: 'gear' },
    { name: 'clip_5_combat.webm', key: 'combat' },
    { name: 'clip_6_shop.webm', key: 'shop' },
  ];

  for (const clip of clipsConfig) {
    const ts = timestamps[clip.key];
    const startTimeSec = ts.start;
    const durationSec = Math.max(0.5, ts.end - ts.start);
    const outFile = path.join(CLIPS_DIR, clip.name);

    await runFfmpegSlice(MASTER_WEBM, startTimeSec, durationSec, outFile);
    
    if (fs.existsSync(outFile)) {
      const stats = fs.statSync(outFile);
      console.log(`✔ Verified [${clip.name}] - Size: ${(stats.size / 1024).toFixed(1)} KB`);
    } else {
      throw new Error(`Failed to generate clip file: ${clip.name}`);
    }
  }

  // Clean up temp master recording file
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  console.log('\n======================================================');
  console.log('SUCCESS! All 6 gameplay video clips recorded & saved:');
  clipsConfig.forEach(c => console.log(` - ${path.join('public/assets/custom/clips', c.name)}`));
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal error recording gameplay video:', err);
  process.exit(1);
});
