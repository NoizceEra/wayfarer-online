// Asset loader — ports the Lanternfall curation (CC0 Ninja Adventure + Kenney)
// into Wayfarer. Paths are relative to public/: assets/na/..., assets/audio/...,
// assets/light/.... Only the subset Wayfarer Online actually uses is loaded.
const NA = 'assets/na';
export const DIRS = ['down', 'up', 'left', 'right'];

// Player bodies per job (see src/data/jobs.js `body`), NPC faces, monsters.
export const CHARACTERS = [
  'Knight', 'ManGreen', 'SorcererOrange', 'NinjaDark',
  'OldMan', 'Noble', 'GladiatorBlue', 'Villager', 'Woman', 'Monk',
  // expansion NPCs (inn, docks, Frostpeak, town ambient)
  'Sultan', 'OldWoman', 'OldMan2', 'Inspector', 'Hunter', 'Eskimo', 'Child', 'Villager3', 'Villager4', 'Master',
];
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
  music: ['mus_title', 'mus_village', 'mus_forest', 'mus_ruins', 'mus_tension', 'mus_gameover', 'mus_victory', 'mus_crypt', 'mus_boss', 'mus_village_alt'],
  ambient: ['amb_wind'],
  jingles: ['jng_levelup1', 'jng_levelup2', 'jng_success3'],
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

export function preload(scene) {
  const L = scene.load;
  for (const name of CHARACTERS) {
    L.spritesheet(`char.${name}`, `${NA}/Actor/Character/${name}/SpriteSheet.png`, { frameWidth: 16, frameHeight: 16 });
    L.image(`face.${name}`, `${NA}/Actor/Character/${name}/${FACE_OVERRIDE[name] || 'Faceset.png'}`);
  }
  L.image('char.shadow', `${NA}/Actor/Character/Shadow.png`);
  for (const [name, file] of Object.entries(MONSTER_SHEETS)) {
    L.spritesheet(`mon.${name}`, `${NA}/Actor/Monster/${file}`, { frameWidth: 16, frameHeight: 16 });
  }
  for (const [key, path, fw, fh] of FX) L.spritesheet(key, `${NA}/${path}`, { frameWidth: fw, frameHeight: fh });
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
  for (const name of Object.keys(MONSTER_SHEETS)) {
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
  for (const [key, , , , fps] of PROJ_SHEETS) {
    makeAnim(scene, { key, frames: A.generateFrameNumbers(key), frameRate: fps, repeat: -1 });
  }
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
