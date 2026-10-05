// Asset loader — ports the Lanternfall curation (CC0 Ninja Adventure + Kenney)
// into Wayfarer. Paths are relative to public/: assets/na/..., assets/audio/...,
// assets/light/.... Only the subset Wayfarer Online actually uses is loaded.
import { CHAR_SHEETS, MONSTER_FILES, CUSTOM_MONSTER_FILES } from './catalog.js';
import { NPC_SHEETS } from '../data/npcs.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { ITEM_LIST } from '../data/items.js';
import '../data/worldEnemies.js'; // registers the expanded monster roster into ENEMY_TABLE before we read it
import '../data/deathFx.js'; // tags every monster def with its death / hit-reaction family (deathFx)
const NA = 'assets/na';
export const DIRS = ['down', 'up', 'left', 'right'];

// Player bodies per job (see src/data/jobs.js `body`), NPC faces, monsters.
export const CHARACTERS = [
  'Knight', 'ManGreen', 'SorcererOrange', 'NinjaDark',
  'OldMan', 'Noble', 'GladiatorBlue', 'Villager', 'Woman', 'Monk',
  // expansion NPCs (inn, docks, Frostpeak, town ambient)
  'Sultan', 'OldWoman', 'OldMan2', 'Inspector', 'Hunter', 'Eskimo', 'Child', 'Villager3', 'Villager4', 'Master',
  // data-driven roster (src/data/npcs.js); every sheet validated by tools/validate_sheets.py -> catalog.js
  ...NPC_SHEETS.filter((n) => !['Sultan', 'OldWoman', 'OldMan2', 'Inspector', 'Hunter', 'Eskimo', 'Child', 'Villager3', 'Villager4', 'Master', 'Knight', 'ManGreen', 'SorcererOrange', 'NinjaDark', 'OldMan', 'Noble', 'GladiatorBlue', 'Villager', 'Woman', 'Monk'].includes(n)),
];
CHARACTERS.splice(0, CHARACTERS.length, ...new Set(CHARACTERS));
const FACE_OVERRIDE = { ManGreen: 'Faceset1.png' };

const MONSTER_SHEETS = {
  Slime: 'Slime/Slime.png',
  BlueBat: 'BlueBat/SpriteSheet.png',
  SpiderRed: 'SpiderRed/SpriteSheet.png',
  Mushroom: 'Mushroom/mushroom.png',
  LanternGreen: 'LanternGreen/SpriteSheet.png',
  Spirit: 'Spirit/SpriteSheet.png',
  Skull: 'Skull/SpriteSheet.png',
  Eye: 'Eye/Eye.png',
  // expansion enemies (see data/worldEnemies.js)
  YellowsBat: 'YellowsBat/SpriteSheet.png', SkullBlue: 'SkullBlue/SpriteSheet.png', Owl2: 'Owl2/Owl2.png',
  Grey_Trex: 'Grey_Trex/SpriteSheet.png', Flam2: 'Flam2/SpriteSheet.png', Larva2: 'Larva2/Larva2.png',
};
// Custom monster sheets from public/assets/custom/monsters
const CUSTOM_MONSTER_DIR = 'assets/custom/monsters';
const CUSTOM_MONSTER_SHEETS = {};
for (const [key, file] of Object.entries(CUSTOM_MONSTER_FILES || {})) {
  CUSTOM_MONSTER_SHEETS[key] = `${CUSTOM_MONSTER_DIR}/${file}`;
}

// Monsters referenced by the expanded ENEMY_TABLE + ambient critters (validated catalog).
const AMBIENT_MONSTERS = ['Butterfly', 'ButterflyBlue', 'Fish', 'FishRed', 'Owl', 'Owl2', 'BlueBat', 'YellowsBat'];
for (const def of Object.values(ENEMY_TABLE)) if (MONSTER_FILES[def.sprite] && !MONSTER_SHEETS[def.sprite]) MONSTER_SHEETS[def.sprite] = MONSTER_FILES[def.sprite];
for (const n of AMBIENT_MONSTERS) if (MONSTER_FILES[n] && !MONSTER_SHEETS[n]) MONSTER_SHEETS[n] = MONSTER_FILES[n];

// Side-view 2-frame animals (Actor/Animal): [key, path, frameW, frameH]. Sheets are 2 frames wide.
export const ANIMALS = [
  ['cat', 'Cat/SpriteSheet.png', 16, 16], ['catBlack', 'CatBlack/SpriteSheet.png', 16, 16], ['catWhite', 'CatWhite/SpriteSheet.png', 17, 15],
  ['dog', 'DogOrange/SpriteSheet.png', 18, 16], ['dogWhite', 'DogBlack/SpriteSheetWhite.png', 18, 17], ['dogYellow', 'DogYellow/SpriteSheet.png', 21, 17],
  ['pig', 'Pig/SpriteSheetPink.png', 16, 16], ['pigBlack', 'Pig/SpriteSheetBlack.png', 16, 16],
  ['chicken', 'Chicken/SpriteSheetWhite.png', 16, 16], ['chickenBrown', 'Chicken/SpriteSheetBrown.png', 16, 16],
  ['frog', 'Frog/SpriteSheet.png', 16, 16], ['parrotBlue', 'Parrot/SpriteSheetBlue.png', 16, 16], ['parrotRed', 'Parrot/SpriteSheetRed.png', 16, 16],
  ['cow', 'Cow/SpriteSheetWhite.png', 16, 16], ['donkey', 'Donkey/SpriteSheetGrey.png', 16, 16], ['hamster', 'Hamster/SpriteSheet.png', 15, 15],
];
export const FLAG_COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'White', 'Brown'];
// Item art (data/items.js): loaded as `item.src.<id>`, upscaled to 32px `icon32.<id>` in createAnims.
const ITEM_DIR = 'assets/na';

// [key, path, frameW, frameH, fps, loop]
const FX = [
  ['fx.slashArc', 'FX/Slash/SpriteSheetArc.png', 38, 34, 22],
  ['fx.slash01', 'FX/Slash/SpriteSheetSlash01.png', 26, 32, 22],
  ['fx.cut', 'FX/Attack/Cut/SpriteSheet.png', 32, 32, 26],
  ['fx.explosion', 'FX/Elemental/Explosion/SpriteSheet.png', 40, 40, 18],
  ['fx.spark', 'FX/Magic/Spark/SpriteSheet.png', 30, 35, 16],
  ['fx.circleOrange', 'FX/Magic/Circle/SpriteSheetOrange.png', 32, 32, 16],
  ['fx.aura', 'FX/Magic/Aura/SpriteSheet.png', 25, 24, 12, true],
  ['fx.boost', 'FX/Magic/Boost/SpriteSheet.png', 53, 35, 14],
  ['fx.shieldBlue', 'FX/Magic/Shield/SpriteSheetBlue.png', 24, 26, 16],
  ['fx.smoke', 'FX/Smoke/Smoke/SpriteSheet.png', 32, 32, 16],
  ['fx.dust', 'FX/Smoke/SmokeCircular/SpriteSheet.png', 30, 14, 18],
  // skill VFX sheets (systems/skillVfx.js)
  ['fx.flam', 'FX/Elemental/Flam/SpriteSheet.png', 25, 30, 16],
  ['fx.ice', 'FX/Elemental/Ice/SpriteSheet.png', 32, 32, 18],
  ['fx.iceB', 'FX/Elemental/Ice/SpriteSheetB.png', 32, 32, 14],
  ['fx.flake', 'FX/Elemental/Ice/SpriteSheetFlake.png', 32, 32, 14],
  ['fx.thunder', 'FX/Elemental/Thunder/SpriteSheet.png', 20, 28, 20],
  ['fx.plant', 'FX/Elemental/Plant/SpriteSheet.png', 24, 28, 16],
  ['fx.water', 'FX/Elemental/Water/SpriteSheet.png', 44, 33, 16],
  ['fx.pillar', 'FX/Elemental/WaterPillar/SpriteSheet.png', 30, 41, 14],
  ['fx.rockSpike', 'FX/Elemental/RockSpike/SpriteSheet.png', 54, 48, 18],
  ['fx.cutX', 'FX/Attack/CutX/SpriteSheet.png', 32, 32, 22],
  ['fx.slashCurved', 'FX/Attack/SlashCurved/SpriteSheet.png', 32, 32, 22],
  ['fx.slashDouble', 'FX/Attack/SlashDoubleCurved/SpriteSheet.png', 32, 32, 22],
  ['fx.circular', 'FX/Attack/CircularSlash/SpriteSheet.png', 32, 32, 22],
  ['fx.claw', 'FX/Attack/Claw/SpriteSheet.png', 32, 32, 22],
  ['fx.circleWhite', 'FX/Magic/Circle/SpriteSheetWhite.png', 32, 32, 16],
  ['fx.circleSpark', 'FX/Magic/Circle/SpriteSheetSpark.png', 32, 32, 16],
  ['fx.spirit', 'FX/Magic/Spirit/SpriteSheet.png', 32, 32, 14],
  ['fx.shieldYellow', 'FX/Magic/Shield/SpriteSheetYellow.png', 24, 26, 16],
];
const CUSTOM_FX = [
  ['fx.frostNova', 'assets/custom/fx/frost_nova.png', 48, 48, 18],
  ['fx.thunderStrike', 'assets/custom/fx/thunder_strike.png', 32, 48, 20],
  ['fx.shadowVortex', 'assets/custom/fx/shadow_vortex.png', 40, 40, 16],
  ['fx.holyRadiance', 'assets/custom/fx/holy_radiance.png', 48, 48, 18],
  ['fx.poisonBloom', 'assets/custom/fx/poison_bloom.png', 32, 32, 16],
  ['fx.whirlwind', 'assets/custom/fx/whirlwind_slash.png', 48, 48, 20],
  ['fx.earthShatter', 'assets/custom/fx/earth_shatter.png', 48, 48, 18],
  ['fx.arcaneBeam', 'assets/custom/fx/arcane_beam.png', 32, 64, 18],
  ['fx.voidCleave', 'assets/custom/fx/void_cleave.png', 40, 40, 18],
  ['fx.healingBloom', 'assets/custom/fx/healing_bloom.png', 32, 32, 16],
];
const PROJ_SHEETS = [
  ['proj.energyBall', 'FX/Projectile/EnergyBall.png', 16, 16, 12],
  ['proj.fireball', 'FX/Projectile/Fireball.png', 16, 16, 12],
  ['proj.shuriken', 'FX/Projectile/Shuriken.png', 16, 16, 16],
];
const PROJ_IMAGES = [
  ['proj.arrow', 'FX/Projectile/Arrow.png'],
  ['proj.kunai', 'FX/Projectile/Kunai.png'],
];
const WEAPONS = [
  ['weapon.sword', 'Items/Weapons/Sword/SpriteInHand.png'],
  ['weapon.bigSword', 'Items/Weapons/BigSword/SpriteInHand.png'],
  ['weapon.bow', 'Items/Weapons/Bow/Sprite.png'],
  ['weapon.wand', 'Items/Weapons/MagicWand/SpriteInHand.png'],
  ['weapon.sai', 'Items/Weapons/Sai/SpriteInHand.png'],
  ['weapon.ninjaku', 'Items/Weapons/Ninjaku/SpriteInHand.png'],
  // gear-system weapons (in-hand sprites are hilt-up; 'upright' ones are full sprites, head-up)
  ['weapon.sword2', 'Items/Weapons/Sword2/SpriteInHand.png'],
  ['weapon.katana', 'Items/Weapons/Katana/SpriteInHand.png'],
  ['weapon.rapier', 'Items/Weapons/Rapier/SpriteInHand.png'],
  ['weapon.bone', 'Items/Weapons/Bone/SpriteInHand.png'],
  ['weapon.bow2', 'Items/Weapons/Bow2/Sprite.png'],
  ['weapon.axe', 'Items/Weapons/Axe/Sprite.png'],
  ['weapon.hammer', 'Items/Weapons/Hammer/Sprite.png'],
  ['weapon.staff', 'Items/Weapons/MagicWand/Sprite.png'],
];
const ACCESSORIES = [
  ['acc.cape',   'assets/custom/accessories/cape.png'],
  ['acc.scarf',  'assets/custom/accessories/scarf.png'],
  ['acc.shades', 'assets/custom/accessories/shades.png'],
  ['acc.flower', 'assets/custom/accessories/flower.png'],
];
// Authored flora (tools/gen_flora.py): same palette as the NA set above.
const FLORA = [
  ['flora.flowerA', 'assets/custom/flora/flowerA.png'],
  ['flora.flowerB', 'assets/custom/flora/flowerB.png'],
  ['flora.tuft', 'assets/custom/flora/tuft.png'],
  ['flora.sandpatch', 'assets/custom/flora/sandpatch.png'],
];

const AUDIO = {
  // music / ambient / jingles are fetched on demand by systems/audio.js (audio.fetch) — 10MB saved at boot
  sfx: [
    'sfx_swing_1', 'sfx_swing_2', 'sfx_hit_1', 'sfx_arrow_shot', 'sfx_whoosh_dash',
    'sfx_cast_1', 'sfx_cast_2', 'sfx_fireball', 'sfx_explosion',
    'sfx_heal', 'sfx_coin', 'sfx_gold', 'sfx_pickup',
    'sfx_potion_drink', 'sfx_step_0', 'sfx_step_1',
    'sfx_ui_move', 'sfx_ui_click', 'sfx_ui_error',
    'sfx_player_hurt', 'sfx_monster_hurt', 'sfx_monster_die', 'sfx_slime',
    'sfx_alert', 'sfx_npc_blip',
    'sfx_door_open', 'sfx_boss_roar', 'sfx_impact_heavy', 'sfx_chest_unlock', 'sfx_powerup',
  ],
};

export const AI_ICONS = ['amulet', 'axe', 'boots', 'bow', 'cap', 'cape', 'chainmace', 'cloak_feather', 'crossbow', 'crown', 'crystal', 'dagger', 'firewand', 'fishing_rod', 'gauntlets', 'glasses', 'greatsword', 'greaves', 'hairflower', 'hat_wizard', 'helm', 'helm_horned', 'helm_winged', 'herb', 'hood_ranger', 'longbow', 'mask', 'plate', 'potion_hp', 'potion_mp', 'pouch', 'ring', 'robe', 'robe_white', 'sai', 'scimitar', 'shield', 'spear', 'staff_crystal', 'staff_wood', 'sword', 'throwing_knives', 'tome', 'tunic', 'vest_thief', 'wand_fire', 'warhammer', 'wings'];

// Everything the world needs (sprites, faces, items, FX, SFX). Queued AFTER the title is interactive (see BootScene).
export function preloadWorld(scene) {
  const L = scene.load;
  for (const n of AI_ICONS) L.image(`icon.ai.${n}`, `assets/custom/icons_ai/${n}.png`);
  for (const name of CHARACTERS) {
    const [sheet, face] = CHAR_SHEETS[name] || ['SpriteSheet.png', 'Faceset.png'];
    L.spritesheet(`char.${name}`, `${NA}/Actor/Character/${name}/${sheet}`, { frameWidth: 16, frameHeight: 16 });
    L.image(`face.${name}`, `${NA}/Actor/Character/${name}/${FACE_OVERRIDE[name] || face || 'Faceset.png'}`);
  }
  for (const [key, file, fw, fh] of ANIMALS) L.spritesheet(`animal.${key}`, `${NA}/Actor/Animal/${file}`, { frameWidth: fw, frameHeight: fh });
  for (const c of FLAG_COLORS) L.spritesheet(`env.flag.${c}`, `${NA}/Backgrounds/Animated/Flag/Flag${c}16x16.png`, { frameWidth: 16, frameHeight: 16 });
  L.spritesheet('env.ripple', `${NA}/Backgrounds/Animated/Water_Ripples/SpriteSheet16x16.png`, { frameWidth: 16, frameHeight: 16 });
  L.image('veh.boat', `${NA}/Backgrounds/Vehicles/Boat.png`);
  L.image('veh.sail', `${NA}/Backgrounds/Vehicles/Sail.png`);
  L.image('veh.crane', `${NA}/Backgrounds/Vehicles/Crane.png`);
  L.image('veh.net', `${NA}/Backgrounds/Vehicles/FishNetFull.png`);
  for (const it of ITEM_LIST) L.image(`item.src.${it.id}`, `${ITEM_DIR}/${it.src}`);
  // (the soft ground shadow 'char.shadow' is generated procedurally in worldLoad.js; the hard PNG is no longer used)
  for (const [name, file] of Object.entries(MONSTER_SHEETS)) {
    L.spritesheet(`mon.${name}`, `${NA}/Actor/Monster/${file}`, { frameWidth: 16, frameHeight: 16 });
  }
  for (const [name, path] of Object.entries(CUSTOM_MONSTER_SHEETS)) {
    L.spritesheet(`mon.${name}`, path, { frameWidth: 16, frameHeight: 16 });
  }
  for (const [key, path, fw, fh] of FX) L.spritesheet(key, `${NA}/${path}`, { frameWidth: fw, frameHeight: fh });
  for (const [key, path, fw, fh] of CUSTOM_FX) L.spritesheet(key, path, { frameWidth: fw, frameHeight: fh });
  for (const [key, path, fw, fh] of PROJ_SHEETS) L.spritesheet(key, `${NA}/${path}`, { frameWidth: fw, frameHeight: fh });
  for (const [key, path] of PROJ_IMAGES) L.image(key, `${NA}/${path}`);
  for (const [key, path] of WEAPONS) L.image(key, `${NA}/${path}`);
  for (const [key, path] of [...ACCESSORIES, ...FLORA]) L.image(key, path);
  // Environment flavor (flower sheet is a 20×8 strip, not a 16px grid → static)
  L.image('env.flower', `${NA}/Backgrounds/Animated/Flower/SpriteSheet16x16.png`);
  L.spritesheet('env.plant', `${NA}/Backgrounds/Animated/Plant/SpriteSheet16x16.png`, { frameWidth: 16, frameHeight: 16 });
  // World-prop tilesets (trees, houses, rocks, ruins)
  L.spritesheet('ts.nature', `${NA}/Backgrounds/Tilesets/TilesetNature.png`, { frameWidth: 16, frameHeight: 16 });
  L.spritesheet('ts.house',  `${NA}/Backgrounds/Tilesets/TilesetHouse.png`,  { frameWidth: 16, frameHeight: 16 });
  L.spritesheet('ts.ruins',  `${NA}/Backgrounds/Tilesets/TilesetVillageAbandoned.png`, { frameWidth: 16, frameHeight: 16 });
  L.image('fx.glow', 'assets/light/light_soft.png');
  for (const [folder, keys] of Object.entries(AUDIO)) {
    for (const key of keys) L.audio(key, `assets/audio/${folder}/${key}.ogg`);
  }
}

// 32x32 nearest-neighbour icon textures (`icon32.<itemId>`) centred in the square.
function makeItemIcons(scene) {
  for (const it of ITEM_LIST) {
    const src = `item.src.${it.id}`, dst = `icon32.${it.id}`;
    if (scene.textures.exists(dst) || !scene.textures.exists(src)) continue;
    const img = scene.textures.get(src).getSourceImage();
    const s = Math.max(1, Math.min(2, Math.floor(32 / Math.max(img.width, img.height))));
    const tex = scene.textures.createCanvas(dst, 32, 32);
    const c = tex.getContext();
    c.imageSmoothingEnabled = false;
    const w = img.width * s, h = img.height * s;
    c.drawImage(img, Math.round((32 - w) / 2), Math.round((32 - h) / 2), w, h);
    tex.refresh();
  }
}

function makeAnim(scene, cfg) {
  if (scene.anims.exists(cfg.key)) return;
  if (!scene.textures.exists(cfg.texture ?? cfg.key)) return;
  const { texture, ...rest } = cfg;
  try { scene.anims.create(rest); } catch { /* duplicate */ }
}

export function createAnims(scene) {
  const A = scene.anims;
  const bodies = CHARACTERS;
  for (const name of bodies) {
    const key = `char.${name}`;
    if (!scene.textures.exists(key)) continue;
    const tex = scene.textures.get(key);
    DIRS.forEach((dir, col) => {
      // Short sheets (Child/OldWoman are 4x2) only have the frames that exist.
      const walk = [col, col + 4, col + 8, col + 12].filter((f) => tex.has(f));
      makeAnim(scene, {
        key: `${key}.walk.${dir}`, texture: key,
        frames: A.generateFrameNumbers(key, { frames: walk }),
        frameRate: 8, repeat: -1,
      });
      makeAnim(scene, { key: `${key}.idle.${dir}`, texture: key, frames: [{ key, frame: col }], frameRate: 1 });
      if (tex.has(16 + col)) makeAnim(scene, { key: `${key}.attack.${dir}`, texture: key, frames: [{ key, frame: 16 + col }], frameRate: 1 });
    });
  }
  const allMonsters = { ...MONSTER_SHEETS, ...CUSTOM_MONSTER_SHEETS };
  for (const name of Object.keys(allMonsters)) {
    const key = `mon.${name}`;
    if (!scene.textures.exists(key)) continue;
    DIRS.forEach((dir, col) => {
      makeAnim(scene, {
        key: `${key}.move.${dir}`, texture: key,
        frames: A.generateFrameNumbers(key, { frames: [col, col + 4, col + 8, col + 12] }),
        frameRate: 6, repeat: -1,
      });
    });
  }
  for (const [key, , , , fps, loop] of FX) {
    makeAnim(scene, { key, frames: A.generateFrameNumbers(key), frameRate: fps, repeat: loop ? -1 : 0 });
  }
  for (const [key, , , , fps, loop] of CUSTOM_FX) {
    makeAnim(scene, { key, frames: A.generateFrameNumbers(key), frameRate: fps, repeat: loop ? -1 : 0 });
  }
  for (const [key, , , , fps] of PROJ_SHEETS) {
    makeAnim(scene, { key, frames: A.generateFrameNumbers(key), frameRate: fps, repeat: -1 });
  }
  for (const [key] of ANIMALS) {
    const k = `animal.${key}`;
    if (scene.textures.exists(k)) makeAnim(scene, { key: `${k}.walk`, texture: k, frames: A.generateFrameNumbers(k, { start: 0, end: 1 }), frameRate: 6, repeat: -1 });
  }
  for (const c of FLAG_COLORS) makeAnim(scene, { key: `env.flag.${c}`, frames: A.generateFrameNumbers(`env.flag.${c}`), frameRate: 5, repeat: -1 });
  makeAnim(scene, { key: 'env.ripple', frames: A.generateFrameNumbers('env.ripple'), frameRate: 4, repeat: -1 });
  makeItemIcons(scene);
  makeAnim(scene, { key: 'env.plant.sway', frames: A.generateFrameNumbers('env.plant'), frameRate: 5, repeat: -1 });
  // Generated fallback textures (coin, ring, ground tiles)
  const T = scene.textures;
  if (!T.exists('fx.coin')) {
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x5a3a10, 1).fillCircle(4, 4, 4);
    g.fillStyle(0xf4c542, 1).fillCircle(4, 4, 3);
    g.fillStyle(0xfff1a8, 1).fillRect(3, 2, 1, 3);
    g.generateTexture('fx.coin', 8, 8);
    g.destroy();
  }
  for (const [tkey, base, fleck] of [['tile.meadow', 0x7ec850, 0x6db844], ['tile.woods', 0x3e8e41, 0x357a38], ['tile.town', 0xc9b458, 0xbb9f45], ['tile.ruins', 0x6b7f8e, 0x5d707e]]) {
    if (T.exists(tkey)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(base, 1).fillRect(0, 0, 16, 16);
    let s = tkey.length * 7919;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 14; i++) {
      g.fillStyle(rnd() < 0.5 ? fleck : base, 1).fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 2, 1);
    }
    g.generateTexture(tkey, 16, 16);
    g.destroy();
  }
}
