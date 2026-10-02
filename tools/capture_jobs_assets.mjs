import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'jobs');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function recordSegment(page, outPngPath, outWebmPath, durationMs, setupFn, animateFn) {
  const pngName = outPngPath ? path.basename(outPngPath) : null;
  const webmName = outWebmPath ? path.basename(outWebmPath) : null;
  console.log(`\n--- Capturing [${pngName || 'N/A'}] & [${webmName || 'N/A'}] ---`);

  // Run initial scene setup
  if (setupFn) {
    await page.evaluate(setupFn);
    await sleep(800);
  }

  // Start MediaRecorder if webm path is requested
  if (outWebmPath) {
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
  }

  // Take screenshot if requested
  if (outPngPath) {
    await sleep(500);
    await page.screenshot({ path: outPngPath });
    console.log(`✔ Saved screenshot [${pngName}]`);
  }

  // Run animation loops during recording duration
  if (outWebmPath) {
    const startTime = Date.now();
    while (Date.now() - startTime < durationMs) {
      if (animateFn) {
        await page.evaluate(animateFn);
      }
      await sleep(300);
    }

    // Stop recorder and extract webm buffer
    console.log(`Stopping MediaRecorder and saving video [${webmName}]...`);
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
      console.log(`✔ Created clip [${webmName}] (${(videoBuffer.length / 1024).toFixed(1)} KB)`);
    } else {
      console.error(`✖ Failed to record video for ${webmName}`);
    }
  }
}

async function main() {
  console.log('=== Wayfarer Jobs Asset Generator & Recorder ===');
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
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('canvas', { timeout: 30000 });
  await sleep(1500);

  // Initial setup: Launch World Scene
  console.log('Initializing World Scene...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 'peach', hairStyle: 'crop', hairColor: 'gold', accessory: 'scarf', weapon: 'sunfire_blade' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  await sleep(3500);

  // --------------------------------------------------------------------------
  // SEGMENT 1: jobs_base_classes.png & jobs_base_classes.webm
  // Lineup of 4 Base Classes (Wayfarer, Ranger, Arcanist, Bandit) & abilities
  // --------------------------------------------------------------------------
  const baseClassesPng = path.join(OUT_DIR, 'jobs_base_classes.png');
  const baseClassesWebm = path.join(OUT_DIR, 'jobs_base_classes.webm');

  await recordSegment(
    page,
    baseClassesPng,
    baseClassesWebm,
    5000,
    // Setup function
    () => {
      const world = window.__wayfarer.scene.getScene('world');
      if (!world || !world.player) return;

      // Position main player in center of Thistle Town square
      world.player.setPosition(800, 750);
      world.cameras.main.startFollow(world.player, true, 1, 1);
      world.cameras.main.setZoom(2.2);

      // Clear previous custom nodes if any
      if (window.__jobsLineupGroup) {
        window.__jobsLineupGroup.destroy(true);
      }
      const group = world.add.group();
      window.__jobsLineupGroup = group;

      // 4 Base Classes configuration
      const classesDef = [
        { name: 'WAYFARER', job: 'wayfarer', hero: { skin: 'peach', hair: 'crop', hairColor: 'gold', accessory: 'scarf' }, color: '#f4c542', skillFx: 'fx.circleOrange', offsetX: -160 },
        { name: 'RANGER', job: 'ranger', hero: { skin: 'sand', hair: 'spiky', hairColor: 'moss', accessory: 'quiver' }, color: '#7cfc00', skillFx: 'fx.arrow', offsetX: -55 },
        { name: 'ARCANIST', job: 'arcanist', hero: { skin: 'porcelain', hair: 'long', hairColor: 'lilac', accessory: 'cape' }, color: '#00bfff', skillFx: 'fx.wisp', offsetX: 55 },
        { name: 'BANDIT', job: 'bandit', hero: { skin: 'clay', hair: 'mop', hairColor: 'raven', accessory: 'eyepatch' }, color: '#ff4500', skillFx: 'fx.slashArc', offsetX: 160 },
      ];

      window.__jobsAvatars = [];

      classesDef.forEach((cls) => {
        const px = world.player.x + cls.offsetX;
        const py = world.player.y;

        // Shadow under avatar
        const shadow = world.add.ellipse(px, py + 10, 24, 10, 0x000000, 0.4);
        group.add(shadow);

        // ModularPlayer avatar instance
        const ModularPlayerClass = world.player.constructor;
        const heroSpec = { name: cls.name, job: cls.job, ...cls.hero };
        const avatar = new ModularPlayerClass(world, px, py, heroSpec, { remote: true });
        avatar.noDust = true;
        avatar.setFacing('down');
        group.add(avatar);

        // Name plate box
        const tagBg = world.add.rectangle(px, py - 40, 85, 18, 0x10140f, 0.9).setStrokeStyle(1.5, Phaser.Display.Color.HexStringToColor(cls.color).color);
        const tagText = world.add.text(px, py - 40, cls.name, {
          fontFamily: '"Silkscreen", monospace',
          fontSize: '9px',
          color: cls.color,
          fontStyle: 'bold'
        }).setOrigin(0.5);
        group.add(tagBg);
        group.add(tagText);

        window.__jobsAvatars.push({ avatar, px, py, def: cls });
      });

      // Title Banner
      const titleBg = world.add.rectangle(world.player.x, world.player.y - 120, 360, 26, 0x10140f, 0.95).setStrokeStyle(2, 0xc8a840);
      const titleText = world.add.text(world.player.x, world.player.y - 120, 'BASE CLASSES & ABILITIES', {
        fontFamily: '"Silkscreen", monospace',
        fontSize: '12px',
        color: '#f4c542',
        fontStyle: 'bold'
      }).setOrigin(0.5);
      group.add(titleBg);
      group.add(titleText);
    },
    // Animation loop during clip recording
    () => {
      const world = window.__wayfarer.scene.getScene('world');
      if (!world || !window.__jobsAvatars) return;

      const t = Date.now() / 1000;
      window.__jobsAvatars.forEach((item, idx) => {
        // Trigger skill VFX pulses periodically
        if (Math.floor(t * 2 + idx) % 3 === 0) {
          world.spawnFx?.(item.px, item.py - 6, item.def.skillFx, 1.2);
        }
      });
    }
  );

  // --------------------------------------------------------------------------
  // SEGMENT 2: jobs_level_up.png & jobs_level_up.webm
  // EXP gain, level-up aura fanfare, stat point allocation UI
  // --------------------------------------------------------------------------
  const levelUpPng = path.join(OUT_DIR, 'jobs_level_up.png');
  const levelUpWebm = path.join(OUT_DIR, 'jobs_level_up.webm');

  await recordSegment(
    page,
    levelUpPng,
    levelUpWebm,
    5000,
    // Setup function
    () => {
      // Clean up previous lineup
      if (window.__jobsLineupGroup) {
        window.__jobsLineupGroup.destroy(true);
        window.__jobsLineupGroup = null;
      }

      const world = window.__wayfarer.scene.getScene('world');
      const charScene = window.__wayfarer.scene.getScene('character');

      if (!world || !world.player) return;

      world.player.setPosition(800, 750);
      world.player.level = 10;
      world.player.xp = 850;
      world.player.xpNext = 1000;
      world.player.prog.statPoints = 8;
      world.player.prog.skillPoints = 3;

      // Trigger Level-Up Fanfare & Aura
      world.spawnFx?.(world.player.x, world.player.y - 10, 'fx.boost', 2.2);

      if (charScene) {
        if (!charScene.panel) {
          charScene.panel = charScene.add.container(0, 0).setDepth(185).setVisible(false);
        }
        charScene.onLevelUp({ level: 10, gained: 1, statPoints: 8, skillPoints: 3, needsClass: true });
        charScene.setOpen(true);
        charScene.tab = 'char';
        // Stage stat points for allocation preview (+2 STR, +2 AGI, +2 VIT)
        charScene.stage = { str: 2, agi: 2, vit: 2, int: 0, dex: 0, luk: 0 };
        charScene.render();
      }
    },
    // Animation loop during recording
    () => {
      const world = window.__wayfarer.scene.getScene('world');
      if (world && world.player) {
        // Continuous sparkle aura around player
        if (Math.random() < 0.6) {
          world.spawnFx?.(world.player.x + (Math.random() * 20 - 10), world.player.y - 10 + (Math.random() * 20 - 10), 'fx.wisp', 0.8);
        }
      }
    }
  );

  // --------------------------------------------------------------------------
  // SEGMENT 3: jobs_advanced_specs.png & jobs_advanced_specs.webm
  // Level 10 Advanced Specializations: Knight, Elementalist, Shadowblade, Hunter
  // --------------------------------------------------------------------------
  const advSpecsPng = path.join(OUT_DIR, 'jobs_advanced_specs.png');
  const advSpecsWebm = path.join(OUT_DIR, 'jobs_advanced_specs.webm');

  await recordSegment(
    page,
    advSpecsPng,
    advSpecsWebm,
    5000,
    // Setup function
    () => {
      const world = window.__wayfarer.scene.getScene('world');
      const charScene = window.__wayfarer.scene.getScene('character');

      if (world && world.player) {
        world.player.level = 10;
        world.player.prog.adv = null;
      }

      if (charScene) {
        if (!charScene.panel) {
          charScene.panel = charScene.add.container(0, 0).setDepth(185).setVisible(false);
        }
        if (charScene.modal) charScene.closeModal();
        charScene.open = false;
        charScene.panel.setVisible(false);
        charScene.showClassModal();
      }
    },
    // Animation loop during recording
    () => {
      const world = window.__wayfarer.scene.getScene('world');
      if (world && world.player) {
        // Gentle background ambient sparkles
        if (Math.random() < 0.3) {
          world.spawnFx?.(world.player.x + (Math.random() * 40 - 20), world.player.y + (Math.random() * 40 - 20), 'fx.boost', 0.6);
        }
      }
    }
  );

  console.log('\n=== All Wayfarer Jobs Assets Captured Successfully! ===');
  await browser.close();
}

main().catch((err) => {
  console.error('Error capturing jobs assets:', err);
  process.exit(1);
});
