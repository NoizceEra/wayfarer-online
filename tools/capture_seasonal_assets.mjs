import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'seasonal');
const TARGET_URL = 'http://localhost:5176';

const WIDTH = 1280;
const HEIGHT = 720;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('=== Seasonal Halloween Asset Generator & Recorder ===');
  console.log(`Target URL: ${TARGET_URL}`);
  console.log(`Output Directory: ${OUT_DIR}`);

  console.log('Launching browser for seasonal capture...');
  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: WIDTH, height: HEIGHT },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  console.log('Navigating to http://localhost:5176...');
  await page.goto(TARGET_URL, { waitUntil: 'networkidle0' });
  await sleep(2000);

  console.log('Starting character creator...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    game.scene.start('creator', { name: 'SeasonalHero', mode: 'solo' });
  });
  await sleep(2000);

  console.log('Launching World Scene...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'SeasonalHero', job: 'wayfarer', skin: 0, hairStyle: 1, hairColor: 2, topTint: 1, accessory: 'scarf', weapon: 'sunfire_blade' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'SeasonalHero' }));
    game.scene.start('world', { mode: 'solo', name: 'SeasonalHero', hero: heroData });
  });

  console.log('Waiting 4.5s for world map rendering...');
  await sleep(4500);

  // --------------------------------------------------------------------------
  // 1. seasonal_npc_jack.png (Jack O'Lantern NPC in Thistle Town with event dialogue)
  // --------------------------------------------------------------------------
  console.log('--- Capturing 1/6: seasonal_npc_jack.png ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    const overlay = game.scene.getScene('overlay');

    if (world && world.player && world.townfolk) {
      const jackRec = world.townfolk.list?.find((r) => r.n && r.n.id === 'jack');
      if (jackRec) {
        world.player.setPosition(jackRec.day.x, jackRec.day.y + 26);
        world.player.setFacing('up');
        world.cameras.main.centerOn(jackRec.day.x, jackRec.day.y);

        world.townfolk.talk(jackRec.n, jackRec.n.lines);

        if (overlay && overlay.dlg) {
          overlay.dlg.typed = overlay.dlg.full.length;
          if (overlay.dlg.body) overlay.dlg.body.setText(overlay.dlg.full);
        }
      }
    }
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'seasonal_npc_jack.png') });
  console.log('✔ Saved [seasonal_npc_jack.png]');

  // --------------------------------------------------------------------------
  // 2. seasonal_shop_ui.png (Jack's Halloween Emporium shop window showing all 12 festive items)
  // --------------------------------------------------------------------------
  console.log('--- Capturing 2/6: seasonal_shop_ui.png ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    const overlay = game.scene.getScene('overlay');
    const ui = game.scene.getScene('ui');

    if (overlay && overlay.dlg) overlay.closeDialog();

    if (world && world.player) world.player.gold = 9999;
    if (ui && ui.shop) {
      ui.shop.show('jack');
      ui.shop.page = 0;
      ui.shop.build();
    }
  });
  await sleep(800);
  await page.screenshot({ path: path.join(OUT_DIR, 'seasonal_shop_ui.png') });
  console.log('✔ Saved [seasonal_shop_ui.png]');

  // --------------------------------------------------------------------------
  // 3. seasonal_scythe_hero.png (Hero equipped with Grim Reaper Scythe & Vampire Bat Wings in combat)
  // --------------------------------------------------------------------------
  console.log('--- Capturing 3/6: seasonal_scythe_hero.png ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    const ui = game.scene.getScene('ui');

    if (ui && ui.shop) ui.shop.close();

    if (world && world.player) {
      world.player.equip('reaper_scythe', true);
      world.player.equip('halloween_bat_wings', true);
      world.player.equip('vampire_coat', true);
      world.player.equip('jacko_helm', true);

      const spawn = world.areas.over.spawn;
      world.player.setPosition(spawn.x + 280, spawn.y + 140);
      world.cameras.main.centerOn(world.player.x, world.player.y);

      if (world.makeEnemy) {
        world.makeEnemy(world.player.x + 36, world.player.y, 'dewslime');
      }

      world.player.setFacing('right');
      world.player.attackPose();
    }
  });
  await sleep(80);
  await page.screenshot({ path: path.join(OUT_DIR, 'seasonal_scythe_hero.png') });
  console.log('✔ Saved [seasonal_scythe_hero.png]');

  // --------------------------------------------------------------------------
  // 4. seasonal_broom_hero.png (Arcanist Hero holding Witch's Broomstick & Wicked Witch Hat)
  // --------------------------------------------------------------------------
  console.log('--- Capturing 4/6: seasonal_broom_hero.png ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');

    if (world && world.player) {
      world.player.hero.body = 'sorcererorange';
      world.player.equip('witch_broom', true);
      world.player.equip('witch_hat', true);
      world.player.equip('vampire_coat', true);
      world.player.unequip('back');

      const spawn = world.areas.over.spawn;
      world.player.setPosition(spawn.x - 40, spawn.y - 20);
      world.cameras.main.centerOn(world.player.x, world.player.y);
      world.player.setFacing('down');
      world.player.refreshLook();

      world.player.castPose(0xf1c40f);
    }
  });
  await sleep(120);
  await page.screenshot({ path: path.join(OUT_DIR, 'seasonal_broom_hero.png') });
  console.log('✔ Saved [seasonal_broom_hero.png]');

  // --------------------------------------------------------------------------
  // 5. seasonal_pumpkin_hero.png (Hero wearing Pumpkin Suit & Jack-o'-Lantern Helm)
  // --------------------------------------------------------------------------
  console.log('--- Capturing 5/6: seasonal_pumpkin_hero.png ---');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');

    if (world && world.player) {
      world.player.hero.body = 'Villager';
      world.player.unequip('weapon');
      world.player.equip('pumpkin_suit', true);
      world.player.equip('jacko_helm', true);
      world.player.equip('candy_pouch', true);

      const jackRec = world.townfolk?.list?.find((r) => r.n && r.n.id === 'jack');
      if (jackRec) {
        world.player.setPosition(jackRec.day.x - 30, jackRec.day.y + 10);
        world.player.setFacing('right');
        world.cameras.main.centerOn(jackRec.day.x - 10, jackRec.day.y + 10);
      }
      world.player.refreshLook();
    }
  });
  await sleep(400);
  await page.screenshot({ path: path.join(OUT_DIR, 'seasonal_pumpkin_hero.png') });
  console.log('✔ Saved [seasonal_pumpkin_hero.png]');

  // --------------------------------------------------------------------------
  // 6. seasonal_gameplay.webm (Short 5-second video clip of player showcasing seasonal gear in town & combat)
  // --------------------------------------------------------------------------
  console.log('--- Recording 6/6: seasonal_gameplay.webm (5s clip) ---');
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

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    if (world && world.player) {
      world.player.equip('reaper_scythe', true);
      world.player.equip('halloween_bat_wings', true);
      world.player.equip('pumpkin_suit', true);
      world.player.equip('jacko_helm', true);
      world.player.setMoving(true);
    }
  });

  await page.keyboard.down('KeyD');
  await sleep(1000);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyS');
  await sleep(1000);
  await page.keyboard.up('KeyS');

  await page.evaluate(() => {
    const game = window.__wayfarer;
    const world = game.scene.getScene('world');
    if (world && world.player) {
      world.player.setMoving(false);
      const spawn = world.areas.over.spawn;
      world.player.setPosition(spawn.x + 280, spawn.y + 140);
      world.cameras.main.centerOn(world.player.x, world.player.y);
      if (world.makeEnemy) {
        world.makeEnemy(world.player.x + 30, world.player.y, 'dewslime');
        world.makeEnemy(world.player.x - 30, world.player.y + 20, 'thornmite');
      }
    }
  });

  for (let i = 0; i < 6; i++) {
    await page.evaluate((idx) => {
      const game = window.__wayfarer;
      const world = game.scene.getScene('world');
      if (world && world.player) {
        world.player.setFacing(idx % 2 === 0 ? 'right' : 'left');
        world.player.attackPose();
      }
    }, i);
    await sleep(400);
  }

  await sleep(600);

  console.log('Stopping MediaRecorder and saving WebM video...');
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

  const pathVideo = path.join(OUT_DIR, 'seasonal_gameplay.webm');
  if (base64Video) {
    const videoBuffer = Buffer.from(base64Video, 'base64');
    fs.writeFileSync(pathVideo, videoBuffer);
    console.log(`✔ Saved [seasonal_gameplay.webm] (${(videoBuffer.length / 1024).toFixed(1)} KB)`);
  } else {
    console.error('✖ Failed to record seasonal_gameplay.webm');
  }

  await browser.close();

  console.log('\n======================================================');
  console.log('SUCCESS! All 6 Seasonal Halloween assets generated into public/assets/custom/seasonal/:');
  console.log(' 1. seasonal_npc_jack.png');
  console.log(' 2. seasonal_shop_ui.png');
  console.log(' 3. seasonal_scythe_hero.png');
  console.log(' 4. seasonal_broom_hero.png');
  console.log(' 5. seasonal_pumpkin_hero.png');
  console.log(' 6. seasonal_gameplay.webm');
  console.log('======================================================');
}

main().catch((err) => {
  console.error('Fatal error generating seasonal assets:', err);
  process.exit(1);
});
