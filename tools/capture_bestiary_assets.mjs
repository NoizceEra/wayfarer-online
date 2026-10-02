import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'bestiary');
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
    await sleep(600);
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
    await sleep(300);
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
      await sleep(350);
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
  console.log('======================================================');
  console.log('   Wayfarer Online — Bestiary Assets Generator & Recorder');
  console.log(`   Target URL: ${TARGET_URL}`);
  console.log(`   Output Directory: ${OUT_DIR}`);
  console.log('======================================================');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('\nLaunching Puppeteer browser...');
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
  console.log('Initializing World Scene with Wayfarer Hero...');
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
      weapon: 'sunfire_blade'
    };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  console.log('Waiting 4.5s for world map and sprites to render...');
  await sleep(4500);

  // --------------------------------------------------------------------------
  // 1. bestiary_slimes.png & bestiary_slimes.webm
  // (Meadowfield Dew Slimes & Moss Bats combat)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'bestiary_slimes.png'),
    path.join(OUT_DIR, 'bestiary_slimes.webm'),
    4500,
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      const ui = game.scene.getScene('ui');
      if (ui && ui.journal) ui.journal.close();

      world.player.setPosition(950, 750);
      world.cameras.main.centerOn(950, 750);
      world.player.setFacing('right');
      world.player.equip('sunfire_blade', true);
      world.player.equip('viking_helm', true);

      // Spawn Meadowfield Dew Slimes & Moss Bats
      if (world.makeEnemy) {
        const slime1 = world.makeEnemy(995, 745, 'dewslime');
        if (slime1) {
          slime1.hp = 18;
          slime1.showBars(true);
          slime1.setPlate(true, 1);
        }
        const slime2 = world.makeEnemy(1020, 770, 'dewslime');
        if (slime2) {
          slime2.hp = 26;
          slime2.showBars(true);
          slime2.setPlate(true, 2);
        }
        const bat1 = world.makeEnemy(970, 705, 'mossbat');
        if (bat1) {
          bat1.hp = 16;
          bat1.showBars(true);
          bat1.setPlate(true, 2);
        }
        const bat2 = world.makeEnemy(925, 715, 'mossbat');
        if (bat2) {
          bat2.hp = 22;
          bat2.showBars(true);
          bat2.setPlate(true, 3);
        }
      }

      // Attack FX & floaters
      world.player.attackPose();
      if (world.spawnFx) {
        world.spawnFx(975, 740, 'fx.slashArc', 1.8, 0);
        world.spawnFx(995, 745, 'fx.spark', 1.5);
      }
      if (world.combat && world.combat.floatText) {
        world.combat.floatText(995, 725, '-36 CRIT!', '#ff3333', 'crit');
        world.combat.floatText(970, 685, '-18', '#ffffff', 'normal');
        world.combat.floatText(1020, 750, '-22', '#ffd24a', 'crit');
        world.combat.floatText(950, 710, '+15 XP', '#c79bff', 'small');
      }

      // Drops & coins
      if (world.spawnDrop) {
        world.spawnDrop(1005, 765, 'water_flask');
        world.spawnDrop(960, 755, 'grass');
      }
      if (world.combat && world.combat.spawnCoin) {
        world.combat.spawnCoin(985, 760, 12, null);
        world.combat.spawnCoin(1010, 775, 8, null);
      }
    },
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.attackPose();
      if (world.spawnFx) {
        const randX = 970 + Math.random() * 40;
        const randY = 730 + Math.random() * 30;
        world.spawnFx(randX, randY, 'fx.slashArc', 1.6, Math.random() * 60 - 30);
        world.spawnFx(randX + 10, randY, 'fx.spark', 1.3);
      }
      if (world.combat && world.combat.floatText) {
        const dmg = Math.floor(Math.random() * 25) + 15;
        world.combat.floatText(980 + Math.random() * 40, 715 + Math.random() * 30, `-${dmg}`, '#ffffff', 'normal');
      }
    }
  );

  // --------------------------------------------------------------------------
  // 2. bestiary_forest.png & bestiary_forest.webm
  // (Mosswood Caplings & Thornmites battle)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'bestiary_forest.png'),
    path.join(OUT_DIR, 'bestiary_forest.webm'),
    4500,
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.setPosition(1350, 850);
      world.cameras.main.centerOn(1350, 850);
      world.player.setFacing('right');
      world.player.equip('iron_greatblade', true);
      world.player.equip('viking_helm', true);

      // Spawn Mosswood Caplings & Thornmites
      if (world.makeEnemy) {
        const cap1 = world.makeEnemy(1395, 855, 'capling');
        if (cap1) {
          cap1.hp = 28;
          cap1.showBars(true);
          cap1.setPlate(true, 5);
        }
        const cap2 = world.makeEnemy(1325, 890, 'capling');
        if (cap2) {
          cap2.hp = 42;
          cap2.showBars(true);
          cap2.setPlate(true, 5);
        }
        const thorn1 = world.makeEnemy(1420, 825, 'thornmite');
        if (thorn1) {
          thorn1.hp = 22;
          thorn1.showBars(true);
          thorn1.setPlate(true, 4);
        }
        const thorn2 = world.makeEnemy(1365, 810, 'thornmite');
        if (thorn2) {
          thorn2.hp = 32;
          thorn2.showBars(true);
          thorn2.setPlate(true, 4);
        }
      }

      world.player.attackPose();
      if (world.spawnFx) {
        world.spawnFx(1385, 850, 'fx.cut', 1.6);
        world.spawnFx(1420, 825, 'fx.dust', 1.4);
        world.spawnFx(1395, 840, 'fx.spark', 1.5);
      }
      if (world.combat && world.combat.floatText) {
        world.combat.floatText(1395, 830, '-48 CRIT!', '#ffd24a', 'crit');
        world.combat.floatText(1420, 795, '-24 Poisoned!', '#70c040');
        world.combat.floatText(1325, 865, 'Slowed!', '#5dade2', 'small');
      }

      if (world.spawnDrop) {
        world.spawnDrop(1405, 875, 'apple_honey');
        world.spawnDrop(1340, 895, 'herb_tea');
      }
      if (world.combat && world.combat.spawnCoin) {
        world.combat.spawnCoin(1385, 870, 18, null);
      }
    },
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.attackPose();
      if (world.spawnFx) {
        const randX = 1360 + Math.random() * 50;
        const randY = 820 + Math.random() * 40;
        world.spawnFx(randX, randY, 'fx.cut', 1.4);
        world.spawnFx(randX, randY - 10, 'fx.spark', 1.2);
      }
      if (world.combat && world.combat.floatText) {
        const dmg = Math.floor(Math.random() * 30) + 20;
        world.combat.floatText(1370 + Math.random() * 50, 810 + Math.random() * 40, `-${dmg}`, '#ffffff', 'normal');
      }
    }
  );

  // --------------------------------------------------------------------------
  // 3. bestiary_bog.png & bestiary_bog.webm
  // (Mireland Bog Spirit & Willowisp magic combat)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'bestiary_bog.png'),
    path.join(OUT_DIR, 'bestiary_bog.webm'),
    4500,
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.setPosition(600, 1200);
      world.cameras.main.centerOn(600, 1200);
      world.player.setFacing('right');
      world.player.hero.body = 'sorcererorange';
      world.player.equip('ember_wand', true);
      world.player.equip('mage_robe', true);
      world.player.equip('mage_hat', true);

      // Spawn Mireland Bog Spirit & Willowisp
      if (world.makeEnemy) {
        const bog1 = world.makeEnemy(655, 1210, 'bogspirit');
        if (bog1) {
          bog1.hp = 42;
          bog1.showBars(true);
          bog1.setPlate(true, 9);
        }
        const bog2 = world.makeEnemy(565, 1180, 'bogspirit');
        if (bog2) {
          bog2.hp = 60;
          bog2.showBars(true);
          bog2.setPlate(true, 9);
        }
        const wisp1 = world.makeEnemy(635, 1150, 'willowisp');
        if (wisp1) {
          wisp1.hp = 20;
          wisp1.showBars(true);
          wisp1.setPlate(true, 6);
        }
        const wisp2 = world.makeEnemy(675, 1170, 'willowisp');
        if (wisp2) {
          wisp2.hp = 34;
          wisp2.showBars(true);
          wisp2.setPlate(true, 6);
        }
      }

      world.player.castPose(0x6ad8ff);
      if (world.spawnFx) {
        world.spawnFx(600, 1200, 'fx.aura', 2.0);
        world.spawnFx(655, 1210, 'fx.circleOrange', 1.8);
        world.spawnFx(635, 1150, 'fx.explosion', 1.6);
        world.spawnFx(655, 1190, 'fx.flam', 1.5);
      }
      if (world.combat && world.combat.floatText) {
        world.combat.floatText(655, 1180, '-88 ARCANE CRIT!', '#c8a8ff', 'crit');
        world.combat.floatText(635, 1125, '-45 BURN!', '#ff6b35');
        world.combat.floatText(600, 1170, '+30 MP', '#5dade2', 'small');
      }

      if (world.spawnDrop) {
        world.spawnDrop(665, 1225, 'scroll_fire');
        world.spawnDrop(625, 1235, 'gem_yellow');
      }
      if (world.combat && world.combat.spawnCoin) {
        world.combat.spawnCoin(645, 1220, 32, null);
      }
    },
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.castPose(0x6ad8ff);
      if (world.spawnFx) {
        const randX = 620 + Math.random() * 50;
        const randY = 1160 + Math.random() * 50;
        world.spawnFx(randX, randY, 'fx.explosion', 1.4);
        world.spawnFx(randX, randY, 'fx.flam', 1.3);
      }
      if (world.combat && world.combat.floatText) {
        const dmg = Math.floor(Math.random() * 40) + 40;
        world.combat.floatText(620 + Math.random() * 50, 1150 + Math.random() * 50, `-${dmg} ARCANE!`, '#c8a8ff', 'crit');
      }
    }
  );

  // --------------------------------------------------------------------------
  // 4. bestiary_boss.png & bestiary_boss.webm
  // (Tidehollow Tide Eye boss encounter with spell flashes & damage numbers)
  // --------------------------------------------------------------------------
  await recordSegment(
    page,
    path.join(OUT_DIR, 'bestiary_boss.png'),
    path.join(OUT_DIR, 'bestiary_boss.webm'),
    4500,
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.setPosition(800, 1000);
      world.cameras.main.centerOn(835, 1000);
      world.player.setFacing('right');
      world.player.equip('sunfire_blade', true);
      world.player.equip('viking_helm', true);

      // Spawn Tidehollow Tide Eye Boss (scaled up boss encounter)
      if (world.makeEnemy) {
        const boss = world.makeEnemy(875, 990, 'tideeye');
        if (boss) {
          boss.isBoss = true;
          boss.vscale = 2.4;
          if (boss.setScale) boss.setScale(2.4);
          boss.maxHp = 1500;
          boss.hp = 920;
          boss.showBars(true);
          boss.setPlate(true, 12);
        }
      }

      world.player.attackPose();
      if (world.spawnFx) {
        world.spawnFx(875, 990, 'fx.circleOrange', 2.5);
        world.spawnFx(875, 990, 'fx.explosion', 2.2);
        world.spawnFx(800, 1000, 'fx.shieldBlue', 1.8);
        world.spawnFx(800, 1000, 'fx.aura', 1.6);
      }

      if (world.combat && world.combat.floatText) {
        world.combat.floatText(875, 935, '-310 TIDE BRAND CRIT!', '#00e5ff', 'crit');
        world.combat.floatText(895, 960, '-175 SPELL FLASH!', '#ffd24a', 'crit');
        world.combat.floatText(855, 975, '-82 STUN!', '#c8a8ff', 'small');
        world.combat.floatText(800, 960, '-24 BOSS HIT', '#ff6b6b', 'normal');
      }

      if (world.spawnDrop) {
        world.spawnDrop(895, 1025, 'tide_pearl');
        world.spawnDrop(855, 1035, 'tidebrand');
      }
      if (world.combat && world.combat.spawnCoin) {
        world.combat.spawnCoin(875, 1030, 120, null);
      }
    },
    () => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (!world || !world.player) return;

      world.player.attackPose();
      if (world.spawnFx) {
        world.spawnFx(875, 990, 'fx.circleOrange', 2.2);
        world.spawnFx(875 + Math.random() * 20 - 10, 990 + Math.random() * 20 - 10, 'fx.explosion', 1.8);
        world.spawnFx(800, 1000, 'fx.spark', 1.5);
      }
      if (world.combat && world.combat.floatText) {
        const critDmg = Math.floor(Math.random() * 100) + 220;
        world.combat.floatText(860 + Math.random() * 30, 930 + Math.random() * 30, `-${critDmg} SPELL CRIT!`, '#00e5ff', 'crit');
      }
    }
  );

  // --------------------------------------------------------------------------
  // 5. bestiary_ui.png
  // (Bestiary / Monster Journal UI overview showing stats, loot tables, drop chances)
  // --------------------------------------------------------------------------
  console.log('\n--- Capturing [bestiary_ui.png] (Bestiary UI Overview) ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    const ui = game.scene.getScene('ui');

    if (!world || !ui) return;

    // Populate bestiary metadata so stats, loot tables, and drop histories are unlocked
    if (!world.meta) world.meta = {};
    world.meta.bestiary = {
      dewslime: { kills: 142, drops: { water_flask: 35, grass: 50 } },
      mossbat: { kills: 88, drops: { leather_cap: 6, feather: 40 } },
      capling: { kills: 64, drops: { herb_tea: 18 } },
      thornmite: { kills: 52, drops: { apple_honey: 12 } },
      bogspirit: { kills: 41, drops: { gem_yellow: 5 } },
      willowisp: { kills: 73, drops: { scroll_plant: 9, scroll_fire: 4 } },
      tideeye: { kills: 28, drops: { tide_pearl: 10, gem_red: 6 } },
      rustskull: { kills: 35, drops: { iron_helm: 3 } },
      gravemaw: { kills: 8, drops: { tide_plate: 2, tidebrand: 1 } },
      fieldmouse: { kills: 110, drops: { nut_bag: 25 } },
      gelgreen: { kills: 95, drops: { grass: 30 } },
      gelblue: { kills: 80, drops: { water_flask: 20 } },
      shorecrab: { kills: 60, drops: { feather_charm: 4 } }
    };

    // Open Bestiary tab in JournalPanel
    if (ui.journal) {
      ui.journal.toggle(true, 'best');
      ui.journal.sel = 'tideeye'; // Highlight Tide Eye boss entry showing HP, ATK, XP, drops, gold
      ui.journal.build();
    }
  });

  await sleep(1000);
  await page.screenshot({ path: path.join(OUT_DIR, 'bestiary_ui.png') });
  console.log('✔ Saved screenshot [bestiary_ui.png]');

  await browser.close();

  console.log('\n======================================================');
  console.log('SUCCESS! All 5 Bestiary asset pairs generated in public/assets/custom/bestiary/:');
  console.log(' 1. bestiary_slimes.png & bestiary_slimes.webm');
  console.log(' 2. bestiary_forest.png & bestiary_forest.webm');
  console.log(' 3. bestiary_bog.png & bestiary_bog.webm');
  console.log(' 4. bestiary_boss.png & bestiary_boss.webm');
  console.log(' 5. bestiary_ui.png');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Fatal error generating bestiary assets:', err);
  process.exit(1);
});
