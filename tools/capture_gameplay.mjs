import puppeteer from 'puppeteer';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);
const OUT_DIR = path.join(ROOT, 'public', 'assets', 'custom', 'shots');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log('Launching browser for gameplay capture...');

  const browser = await puppeteer.launch({
    headless: 'new',
    defaultViewport: { width: 1920, height: 1080 },
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  // 1. Title Screen
  console.log('Capturing Shot 1: Title Screen...');
  await page.goto('http://localhost:5176', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_1_title.png') });

  // 2. Character Creator Scene
  console.log('Transitioning to Scene 2: Character Creator...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    game.scene.start('creator', { name: 'Wayfarer', mode: 'solo' });
  });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_2_creator.png') });

  // 3. Launch World Scene directly with full hero parameters
  console.log('Transitioning to Scene 3: Thistle Town Overworld...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const heroData = { name: 'Wayfarer', job: 'wayfarer', skin: 0, hairStyle: 0, hairColor: 0, topTint: 0, accessory: 'none', weapon: 'sword' };
    localStorage.setItem('wayfarer_hero', JSON.stringify(heroData));
    localStorage.setItem('wayfarer_profile', JSON.stringify({ name: 'Wayfarer' }));
    game.scene.start('world', { mode: 'solo', name: 'Wayfarer', hero: heroData });
  });

  // Wait 4.5 seconds for world scene to load tilemaps, player, & rendering
  console.log('Waiting 4.5s for world map rendering...');
  await new Promise(r => setTimeout(r, 4500));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_3_town.png') });

  // 4. Inventory & Gear Panel
  console.log('Opening Gear & Inventory HUD in Scene 4...');
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
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_4_gear.png') });

  // 5. Meadow Exploration & Combat
  console.log('Transitioning to Scene 5: Meadow Exploration & Combat...');
  await page.evaluate(() => {
    const game = window.__wayfarer;
    const uiScene = game.scene.getScene('ui');
    if (uiScene && uiScene.equip && uiScene.equip.toggle) {
      uiScene.equip.toggle(false);
    }
    
    const worldScene = game.scene.getScene('world');
    if (worldScene && worldScene.player) {
      worldScene.player.x = 950;
      worldScene.player.y = 750;
      worldScene.player.facing = 'right';
      worldScene.player.applyGearVisuals();

      // Spawn active monsters: Dew Slime and Thornmite
      if (worldScene.makeEnemy) {
        const dew = worldScene.makeEnemy(995, 745, 'dewslime');
        if (dew) {
          dew.hp = Math.round(dew.maxHp * 0.45);
          dew.showBars(true);
          dew.setPlate(true, worldScene.player.level);
        }

        const thorn = worldScene.makeEnemy(915, 735, 'thornmite');
        if (thorn) {
          thorn.hp = Math.round(thorn.maxHp * 0.65);
          thorn.showBars(true);
          thorn.setPlate(true, worldScene.player.level);
        }
      }

      // Attack animation and weapon slash VFX
      if (typeof worldScene.player.attackPose === 'function') {
        worldScene.player.attackPose();
      }
      if (typeof worldScene.spawnFx === 'function') {
        worldScene.spawnFx(worldScene.player.x + 22, worldScene.player.y - 8, 'fx.slashArc', 1.6, 0);
        worldScene.spawnFx(995, 738, 'fx.spark', 1.4);
      }
      if (worldScene.combat && typeof worldScene.combat.floatText === 'function') {
        worldScene.combat.floatText(995, 720, '-42 CRIT!', '#ff3333', 'crit');
        worldScene.combat.floatText(915, 710, '-28', '#ffffff', 'normal');
      }

      // Loot drops & coins
      if (worldScene.spawnDrop) {
        worldScene.spawnDrop(1005, 765, 'sunfire_blade');
        worldScene.spawnDrop(930, 775, 'shadow_dagger');
        worldScene.spawnDrop(970, 785, 'moss_charm');
      }
      if (worldScene.combat && typeof worldScene.combat.spawnCoin === 'function') {
        worldScene.combat.spawnCoin(960, 760, 15, null);
        worldScene.combat.spawnCoin(985, 770, 25, null);
        worldScene.combat.spawnCoin(940, 768, 10, null);
      }
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_5_combat.png') });

  // 6. Merchant Shop UI
  console.log('Opening Shop Merchant UI in Scene 6...');
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
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: path.join(OUT_DIR, 'shot_6_shop.png') });

  await browser.close();
  console.log('SUCCESS! Captured 6 distinct actual gameplay scenes into public/assets/custom/shots/!');
}

main().catch(err => {
  console.error('Capture error:', err);
  process.exit(1);
});
