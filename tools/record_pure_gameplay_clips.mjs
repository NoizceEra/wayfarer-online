import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const CLIPS_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'clips', 'pure_gameplay');
const TEMP_DIR = path.join(__dirname, '.temp_pure_recording');
const MASTER_WEBM = path.join(TEMP_DIR, 'master_pure_gameplay.webm');
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
  console.log('=== Wayfarer Pure Gameplay Clips Recorder ===');
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

  // Hide DOM video/gif splash & overlays for pure canvas recording
  await page.evaluate(() => {
    const bgVideo = document.getElementById('bg-video');
    if (bgVideo) bgVideo.remove();
    const bgGif = document.getElementById('bg-gif');
    if (bgGif) bgGif.remove();
    const splash = document.getElementById('splash');
    if (splash) splash.remove();
    document.body.style.background = '#0a0e1a';
  });

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

  // Helper to ensure Phaser UI overlays are hidden for pure gameplay footage
  const hideUIOverlays = async () => {
    await page.evaluate(() => {
      const game = window.__wayfarer;
      if (!game) return;
      ['ui', 'overlay', 'eventhud', 'combathud'].forEach(sName => {
        const s = game.scene.getScene(sName);
        if (s && s.scene) {
          s.scene.setVisible(false);
        }
      });
    });
  };

  // -------------------------------------------------------------
  // CLIP 1: clip_1_town.webm (Player walking around Thistle Town overworld)
  // -------------------------------------------------------------
  console.log('Recording Clip 1: clip_1_town.webm...');
  
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = {
      name: 'Wayfarer',
      job: 'wayfarer',
      skin: 0,
      hairStyle: 1,
      hairColor: 2,
      topTint: 1,
      accessory: 'scarf',
      weapon: 'honed_edge',
      starter: { head: 'straw_hat', body: 'worn_tunic', offhand: 'wayfarer_lantern', weapon: 'honed_edge' }
    };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  await new Promise(r => setTimeout(r, 2500));
  await hideUIOverlays();

  timestamps.town = { start: await getRelTimeSec() };

  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    // Position player near Thistle Town plaza center
    worldScene.player.setPosition(2700, 1860);

    const steps = 300; // ~5 seconds at 60 FPS
    for (let i = 0; i < steps; i++) {
      const phase = Math.floor((i / steps) * 4);
      if (phase === 0) {
        worldScene.player.x += 1.3;
        worldScene.player.facing = 'right';
      } else if (phase === 1) {
        worldScene.player.y += 1.3;
        worldScene.player.facing = 'down';
      } else if (phase === 2) {
        worldScene.player.x -= 1.3;
        worldScene.player.facing = 'left';
      } else {
        worldScene.player.y -= 1.3;
        worldScene.player.facing = 'up';
      }

      if (worldScene.player.anims && typeof worldScene.player.playWalkAnim === 'function') {
        worldScene.player.playWalkAnim(worldScene.player.facing);
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 500));
  timestamps.town.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // CLIP 2: clip_2_meadow.webm (Active combat in Meadowfield slaying slimes & mites)
  // -------------------------------------------------------------
  console.log('Recording Clip 2: clip_2_meadow.webm...');

  await page.evaluate(() => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    worldScene.player.setPosition(950, 750);
    worldScene.player.facing = 'right';

    // Spawn enemies
    if (worldScene.makeEnemy) {
      const dew1 = worldScene.makeEnemy(1000, 745, 'dewslime');
      if (dew1) { dew1.hp = Math.round(dew1.maxHp * 0.7); }
      const dew2 = worldScene.makeEnemy(1040, 760, 'dewslime');
      if (dew2) { dew2.hp = Math.round(dew2.maxHp * 0.9); }
      const thorn1 = worldScene.makeEnemy(920, 730, 'thornmite');
      if (thorn1) { thorn1.hp = Math.round(thorn1.maxHp * 0.8); }
      worldScene.__monsters = [dew1, dew2, thorn1];
    }
  });

  await hideUIOverlays();
  timestamps.meadow = { start: await getRelTimeSec() };

  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    const steps = 300; // 5 seconds
    for (let tick = 0; tick < steps; tick++) {
      // Monster slight movements
      if (worldScene.__monsters) {
        worldScene.__monsters.forEach((m, idx) => {
          if (m && m.active) {
            m.x += (idx % 2 === 0 ? -0.4 : 0.4);
          }
        });
      }

      // Attack swings and slashes
      if (tick % 40 === 10) {
        if (typeof worldScene.player.attackPose === 'function') {
          worldScene.player.attackPose();
        }
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 24, worldScene.player.y - 8, 'fx.slashArc', 1.8, 0);
          worldScene.spawnFx(worldScene.player.x + 42, worldScene.player.y - 5, 'fx.spark', 1.5);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          const dmg = Math.floor(Math.random() * 35) + 35;
          const isCrit = tick % 80 === 10;
          worldScene.combat.floatText(
            worldScene.player.x + 40 + Math.random() * 15,
            worldScene.player.y - 25,
            isCrit ? `-${dmg} CRIT!` : `-${dmg}`,
            isCrit ? '#ff3333' : '#ffffff',
            isCrit ? 'crit' : 'normal'
          );
        }
      }

      // Defeat monster and drop loot halfway through
      if (tick === 110) {
        if (worldScene.__monsters && worldScene.__monsters[0]) {
          const m = worldScene.__monsters[0];
          if (typeof worldScene.spawnFx === 'function') {
            worldScene.spawnFx(m.x, m.y, 'fx.explosion', 1.4);
          }
          m.destroy();
        }
        if (worldScene.spawnDrop) {
          worldScene.spawnDrop(worldScene.player.x + 45, worldScene.player.y + 15, 'sunfire_blade');
          worldScene.spawnDrop(worldScene.player.x + 65, worldScene.player.y + 25, 'moss_charm');
        }
        if (worldScene.combat && typeof worldScene.combat.spawnCoin === 'function') {
          worldScene.combat.spawnCoin(worldScene.player.x + 35, worldScene.player.y + 10, 25, null);
          worldScene.combat.spawnCoin(worldScene.player.x + 55, worldScene.player.y + 20, 15, null);
        }
      }

      // Walk forward to collect loot
      if (tick > 140) {
        worldScene.player.x += 0.5;
        worldScene.player.facing = 'right';
        if (worldScene.player.anims && typeof worldScene.player.playWalkAnim === 'function') {
          worldScene.player.playWalkAnim('right');
        }
      }

      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 500));
  timestamps.meadow.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // CLIP 3: clip_3_mosswood.webm (Exploring Mosswood forest & Mireland bog with elemental spells)
  // -------------------------------------------------------------
  console.log('Recording Clip 3: clip_3_mosswood.webm...');

  await page.evaluate(() => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    // Position player in Mosswood forest / bog area
    worldScene.player.setPosition(2750, 1050);
    worldScene.player.equipped.weapon = 'sage_staff';
    worldScene.player.equipped.head = 'flower_wreath';
    worldScene.player.equipped.body = 'mage_robe';
    worldScene.player.applyGearVisuals();

    // Spawn forest enemies
    if (worldScene.makeEnemy) {
      const wisp = worldScene.makeEnemy(2820, 1040, 'willowisp');
      const bog = worldScene.makeEnemy(2780, 1080, 'bogspirit');
      worldScene.__forestEnemies = [wisp, bog];
    }
  });

  await hideUIOverlays();
  timestamps.mosswood = { start: await getRelTimeSec() };

  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    const steps = 300; // 5 seconds
    for (let tick = 0; tick < steps; tick++) {
      worldScene.player.x += 0.4;
      worldScene.player.facing = 'right';

      // Cast Nature/Elemental Spells in sequence
      if (tick === 30) {
        // Moss Burst AoE
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.aura', 2.0);
          worldScene.spawnFx(worldScene.player.x + 30, worldScene.player.y - 5, 'fx.circleOrange', 1.8);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 30, worldScene.player.y - 30, '-88 MOSS BURST', '#58a04a', 'big');
        }
      }

      if (tick === 100) {
        // Ember Bolt projectile spell
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 40, worldScene.player.y - 10, 'fx.spark', 2.0);
          worldScene.spawnFx(worldScene.player.x + 70, worldScene.player.y - 10, 'fx.explosion', 1.6);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 70, worldScene.player.y - 25, '-105 EMBER BOLT', '#ff8d5a', 'crit');
        }
      }

      if (tick === 180) {
        // Wisp Blink teleport
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.dust', 2.0);
        }
        worldScene.player.x += 50;
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.boost', 2.0);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 30, 'WISP BLINK', '#7fe0ff', 'small');
        }
      }

      if (tick === 240) {
        // Sunburst radiant spell
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.explosion', 2.2);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 20, worldScene.player.y - 35, '-142 RADIANT BURST', '#ffe066', 'big');
        }
      }

      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 500));
  timestamps.mosswood.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // CLIP 4: clip_4_boss.webm (Epic Tidehollow Tide Eye boss encounter)
  // -------------------------------------------------------------
  console.log('Recording Clip 4: clip_4_boss.webm...');

  await page.evaluate(() => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    // Position player in Tidehollow Ruins boss arena
    worldScene.player.setPosition(800, 2600);
    worldScene.player.facing = 'right';
    worldScene.player.equipped.weapon = 'tidebrand';
    worldScene.player.equipped.head = 'steel_greathelm';
    worldScene.player.equipped.body = 'tide_plate';
    worldScene.player.applyGearVisuals();

    // Spawn Tide Eye boss
    if (worldScene.makeEnemy) {
      const boss = worldScene.makeEnemy(910, 2590, 'tideeye');
      if (boss) {
        boss.setScale(2.2);
        boss.hp = 850;
        boss.maxHp = 1000;
        if (typeof boss.setPlate === 'function') boss.setPlate(true, 12);
        worldScene.__tideBoss = boss;
      }
    }
  });

  await hideUIOverlays();
  timestamps.boss = { start: await getRelTimeSec() };

  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    const steps = 330; // 5.5 seconds
    for (let tick = 0; tick < steps; tick++) {
      const boss = worldScene.__tideBoss;

      // Boss floats up/down slightly
      if (boss && boss.active) {
        boss.y += Math.sin(tick * 0.1) * 0.6;
      }

      // Boss attacks with energy beam / projectiles
      if (tick % 60 === 15) {
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 20, worldScene.player.y - 10, 'fx.spark', 2.2);
        }
      }

      // Player dodges boss beam at tick 50
      if (tick === 50) {
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y, 'fx.dust', 1.8);
        }
        worldScene.player.x -= 30; // Dodge roll back
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 30, 'DODGE!', '#9bd0ff', 'big');
        }
      }

      // Player counters with heavy attack combo at tick 110 & 200
      if (tick === 110) {
        worldScene.player.x += 45; // Rush in
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 30, worldScene.player.y - 10, 'fx.slashArc', 2.4, 0);
          worldScene.spawnFx(boss ? boss.x : worldScene.player.x + 40, worldScene.player.y - 15, 'fx.spark', 2.0);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(boss ? boss.x : worldScene.player.x + 40, worldScene.player.y - 35, '-165 CRIT!', '#ff3333', 'crit');
        }
      }

      if (tick === 200) {
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 20, worldScene.player.y - 10, 'fx.explosion', 2.5);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(boss ? boss.x : worldScene.player.x + 40, worldScene.player.y - 40, '-220 TIDEBURST!', '#5ad1ff', 'crit');
        }
      }

      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 500));
  timestamps.boss.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // CLIP 5: clip_5_gear.webm (Hero equipped with Grim Reaper Scythe, Witch Broom & Sunfire Blade in battle)
  // -------------------------------------------------------------
  console.log('Recording Clip 5: clip_5_gear.webm...');

  await page.evaluate(() => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    worldScene.player.setPosition(950, 750);
    worldScene.player.facing = 'right';

    // Spawn battle target monsters
    if (worldScene.makeEnemy) {
      const m1 = worldScene.makeEnemy(1000, 745, 'bonesentinel');
      const m2 = worldScene.makeEnemy(1040, 760, 'rustskull');
      worldScene.__gearTargets = [m1, m2];
    }
  });

  await hideUIOverlays();
  timestamps.gear = { start: await getRelTimeSec() };

  // Phase 1: Grim Reaper Scythe (0 - 2s)
  // Phase 2: Witch Broom (2 - 4s)
  // Phase 3: Sunfire Blade (4 - 6s)
  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    // --- PHASE 1: Grim Reaper Scythe ---
    worldScene.player.equipped.weapon = 'reaper_scythe';
    worldScene.player.equipped.head = 'shadow_hood';
    worldScene.player.equipped.body = 'shadow_garb';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, 'GRIM REAPER SCYTHE', '#9a7dff', 'big');
    }

    for (let tick = 0; tick < 110; tick++) {
      if (tick % 40 === 10) {
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 25, worldScene.player.y - 10, 'fx.slashArc', 2.2, 0);
          worldScene.spawnFx(worldScene.player.x + 45, worldScene.player.y - 5, 'fx.spark', 1.8);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 45, worldScene.player.y - 25, '-175 CRIT!', '#9a7dff', 'crit');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    // --- PHASE 2: Witch Broom ---
    worldScene.player.equipped.weapon = 'witch_broom';
    worldScene.player.equipped.head = 'starweaver_hat';
    worldScene.player.equipped.body = 'mage_robe';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, "WITCH'S BROOM", '#ffe066', 'big');
    }

    for (let tick = 0; tick < 110; tick++) {
      if (tick % 40 === 10) {
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 20, worldScene.player.y - 10, 'fx.circleOrange', 2.0);
          worldScene.spawnFx(worldScene.player.x + 50, worldScene.player.y - 10, 'fx.aura', 1.8);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 50, worldScene.player.y - 25, '-150 SPELL BURST', '#ffe066', 'big');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    // --- PHASE 3: Sunfire Blade ---
    worldScene.player.equipped.weapon = 'sunfire_blade';
    worldScene.player.equipped.head = 'sun_crown';
    worldScene.player.equipped.body = 'sunforged_plate';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, 'SUNFIRE BLADE', '#ff6b3d', 'big');
    }

    for (let tick = 0; tick < 120; tick++) {
      if (tick % 40 === 10) {
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 30, worldScene.player.y - 8, 'fx.slashArc', 2.4, 0);
          worldScene.spawnFx(worldScene.player.x + 50, worldScene.player.y - 5, 'fx.explosion', 1.6);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 50, worldScene.player.y - 25, '-210 SUNFIRE CRIT!', '#ff6b3d', 'crit');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 500));
  timestamps.gear.end = await getRelTimeSec();

  // -------------------------------------------------------------
  // CLIP 6: clip_6_classes.webm (Ranger, Arcanist & Bandit ability showcase)
  // -------------------------------------------------------------
  console.log('Recording Clip 6: clip_6_classes.webm...');

  await page.evaluate(() => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    worldScene.player.setPosition(950, 750);
    worldScene.player.facing = 'right';

    if (worldScene.makeEnemy) {
      const dummy1 = worldScene.makeEnemy(1020, 740, 'thornmite');
      const dummy2 = worldScene.makeEnemy(1050, 760, 'capling');
      worldScene.__classTargets = [dummy1, dummy2];
    }
  });

  await hideUIOverlays();
  timestamps.classes = { start: await getRelTimeSec() };

  // Phase 1: Ranger (0 - 2.5s)
  // Phase 2: Arcanist (2.5 - 5s)
  // Phase 3: Bandit (5 - 7.5s)
  await page.evaluate(async () => {
    const worldScene = window.__wayfarer.scene.getScene('world');
    if (!worldScene || !worldScene.player) return;

    // --- RANGER SHOWCASE ---
    worldScene.player.job = { id: 'ranger', name: 'Ranger' };
    worldScene.player.equipped.weapon = 'hunter_bow';
    worldScene.player.equipped.head = 'ranger_cap';
    worldScene.player.equipped.body = 'ranger_jerkin';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, 'CLASS: RANGER', '#6fdc6a', 'big');
    }

    for (let tick = 0; tick < 150; tick++) {
      if (tick === 20) {
        // Leaf Volley
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        for (let a = -2; a <= 2; a++) {
          if (typeof worldScene.spawnFx === 'function') {
            worldScene.spawnFx(worldScene.player.x + 30 + a * 10, worldScene.player.y - 10 + a * 5, 'fx.spark', 1.5);
          }
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 60, worldScene.player.y - 30, 'LEAF VOLLEY (5x)', '#6fdc6a', 'crit');
        }
      }
      if (tick === 75) {
        // Snare Trap
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 50, worldScene.player.y + 10, 'fx.aura', 1.8);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 50, worldScene.player.y - 20, 'SNARE TRAP', '#58a04a', 'small');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    // --- ARCANIST SHOWCASE ---
    worldScene.player.job = { id: 'arcanist', name: 'Arcanist' };
    worldScene.player.equipped.weapon = 'tide_staff';
    worldScene.player.equipped.head = 'starweaver_hat';
    worldScene.player.equipped.body = 'sage_vestments';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, 'CLASS: ARCANIST', '#56a8ff', 'big');
    }

    for (let tick = 0; tick < 150; tick++) {
      if (tick === 20) {
        // Ember Bolt & Moss Burst
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.circleOrange', 2.2);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 30, worldScene.player.y - 30, '-135 MOSS BURST', '#56a8ff', 'crit');
        }
      }
      if (tick === 75) {
        // Wisp Blink & Tide Ward
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.boost', 2.0);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 25, 'TIDE WARD SHIELD', '#7fe0ff', 'small');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }

    // --- BANDIT SHOWCASE ---
    worldScene.player.job = { id: 'bandit', name: 'Bandit' };
    worldScene.player.equipped.weapon = 'shadowfang';
    worldScene.player.equipped.head = 'bandit_mask';
    worldScene.player.equipped.body = 'shadow_garb';
    worldScene.player.applyGearVisuals();
    if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
      worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 45, 'CLASS: BANDIT', '#c07bff', 'big');
    }

    for (let tick = 0; tick < 160; tick++) {
      if (tick === 20) {
        // Fang Stab flurry
        if (typeof worldScene.player.attackPose === 'function') worldScene.player.attackPose();
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x + 20, worldScene.player.y - 8, 'fx.slashArc', 2.0, 0);
          worldScene.spawnFx(worldScene.player.x + 35, worldScene.player.y - 5, 'fx.slashArc', 2.0, Math.PI / 2);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x + 40, worldScene.player.y - 30, 'FANG STAB FLURRY', '#c07bff', 'crit');
        }
      }
      if (tick === 80) {
        // Smoke Pouch & Crow Fan
        if (typeof worldScene.spawnFx === 'function') {
          worldScene.spawnFx(worldScene.player.x, worldScene.player.y - 8, 'fx.dust', 2.5);
        }
        if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
          worldScene.combat.floatText(worldScene.player.x, worldScene.player.y - 25, 'SMOKE POUCH BLIND', '#8e44ad', 'small');
        }
      }
      await new Promise(r => requestAnimationFrame(r));
    }
  });

  await new Promise(r => setTimeout(r, 1500));
  timestamps.classes.end = await getRelTimeSec();

  // Wait 1.5s extra for stream buffer flush
  await new Promise(r => setTimeout(r, 1500));

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
  // Slice Master Video into 6 WebM Pure Gameplay Clips using FFmpeg
  // -------------------------------------------------------------
  const clipsConfig = [
    { name: 'clip_1_town.webm', key: 'town' },
    { name: 'clip_2_meadow.webm', key: 'meadow' },
    { name: 'clip_3_mosswood.webm', key: 'mosswood' },
    { name: 'clip_4_boss.webm', key: 'boss' },
    { name: 'clip_5_gear.webm', key: 'gear' },
    { name: 'clip_6_classes.webm', key: 'classes' },
  ];

  console.log('\nProcessing FFmpeg slices...');
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
  console.log('SUCCESS! All 6 pure gameplay video clips recorded & saved:');
  clipsConfig.forEach(c => {
    const p = path.join(CLIPS_DIR, c.name);
    const s = fs.statSync(p);
    console.log(` - ${p} (${(s.size / (1024 * 1024)).toFixed(2)} MB)`);
  });
  console.log('======================================================');
}

main().catch(err => {
  console.error('Fatal error recording pure gameplay clips:', err);
  process.exit(1);
});
