// Monster defs for the world-expansion content (reuse the validated 16px Actor/Monster
// sheets with tints). Imported for side effects by data/worldEnemies.js so the loader
// sees them in ENEMY_TABLE before it collects the monster sheets.
//   X(id, name, sprite, zones, lv, hp, atk, xp, [gMin,gMax], extra)
import { ENEMY_TABLE } from './jobs.js';

const X = (id, name, sprite, zones, lv, hp, atk, xp, gold, extra = {}) => {
  ENEMY_TABLE[id] = { name, sprite, zones, lv, hp, atk, xp, gold, dmg: Math.max(3, Math.round(atk * 0.42)), ...extra };
};

// ——— Sunscorch Desert (Lv 13-17) ———
X('dscarab', 'Gilded Scarab', 'Larva', ['desert'], 13, 122, 25, 58, [8, 17], { tint: 0xffd060, ai: 'swarm', aggro: 110, social: true, spd: 1.3, items: [{ id: 'gem_yellow', chance: 0.04 }] });
X('dscorpion', 'Dune Scorpion', 'YellowsBat', ['desert'], 13, 138, 26, 62, [9, 18], { tint: 0xffb070, ai: 'charger', aggro: 95, inflict: { id: 'poison', chance: 0.4 }, items: [{ id: 'meat', chance: 0.12 }] });
X('dcobra', 'Sand Cobra', 'Snake2', ['desert'], 14, 128, 27, 64, [9, 19], { tint: 0xf2d27a, ai: 'melee', aggro: 100, inflict: { id: 'poison', chance: 0.45 }, flee: 0.2, items: [{ id: 'scroll_fire', chance: 0.03 }] });
X('dwraith', 'Mirage Wraith', 'Spirit2', ['desert'], 14, 118, 28, 68, [10, 20], { tint: 0xffe6b0, ai: 'ranged', aggro: 125, shot: 0xffd27a, inflict: { id: 'burn', chance: 0.35 }, items: [{ id: 'scroll_thunder', chance: 0.03 }] });
X('dcactus', 'Needle Cactus', 'Bamboo', ['desert'], 13, 160, 24, 60, [8, 16], { tint: 0xa8e070, ai: 'melee', aggro: 70, social: true, spd: 0.8, inflict: { id: 'bleed', chance: 0.3 }, items: [{ id: 'herb_tea', chance: 0.1 }] });
X('djackal', 'Dune Jackal', 'Racoon', ['desert'], 15, 150, 28, 70, [10, 22], { tint: 0xe8c890, ai: 'swarm', aggro: 120, social: true, spd: 1.35, flee: 0.15, drops: [{ id: 'sun_locket', chance: 0.02 }] });
X('dguardian', 'Tomb Guardian', 'Grey_Trex', ['desert'], 16, 240, 31, 84, [14, 28], { tint: 0xe0c070, scale: 1.3, ai: 'charger', aggro: 105, inflict: { id: 'stun', chance: 0.18 }, items: [{ id: 'bar_silver', chance: 0.08 }], drops: [{ id: 'sunforged_greaves', chance: 0.03 }, { id: 'sunforged_plate', chance: 0.02 }] });
X('khet', 'Khet, the Sun Colossus', 'Cyclope', ['desert'], 17, 1150, 34, 900, [260, 420], {
  tint: 0xffc860, scale: 2.5, boss: true, ai: 'boss', respawn: 150000,
  kit: { slamR: 52, len: 190, wide: 34, novaR: 100 },
  mech: [{ k: 'beams', every: 9000, spread: [0, 0.55, -0.55], len: 230, wide: 22, wind: 1500, mul: 0.75, color: 0xffc83a, status: { id: 'burn' } },
    { k: 'zones', every: 12000, n: 3, r: 30, wind: 1400, mul: 0.65, color: 0xffa030 }],
  slainMsg: 'Khet, the Sun Colossus, crumbles into sand. The temple falls silent.', hoardMsg: 'Loot: +2 potions from the colossus\' hoard.',
  drops: [{ id: 'sunforged_plate', chance: 0.55 }, { id: 'sun_crown', chance: 0.5 }, { id: 'sun_locket', chance: 0.45 }, { id: 'sunforged_greaves', chance: 0.4 }],
  items: [{ id: 'bar_gold', chance: 1 }, { id: 'chest_big', chance: 0.6 }, { id: 'scroll_fire', chance: 0.7 }],
});
X('desert_sandstalker', 'Sand Stalker', 'desert_sandstalker', ['desert'], 14, 130, 27, 65, [9, 19], { ai: 'swarm', aggro: 110, spd: 1.2, inflict: { id: 'bleed', chance: 0.3 }, items: [{ id: 'sunstone', chance: 0.04 }] });


// ——— Whisperfen Marsh (Lv 10-14) ———
X('mtoad', 'Fen Toad', 'Reptile2', ['marsh'], 10, 98, 19, 44, [6, 14], { tint: 0xbfe070, ai: 'hopper', aggro: 80, social: true, spd: 0.9, items: [{ id: 'fish_fresh', chance: 0.12 }] });
X('mwisp', 'Will-o-Wisp', 'LanternGreen', ['marsh'], 11, 84, 20, 46, [6, 14], { tint: 0xc8ff8a, ai: 'ranged', aggro: 120, shot: 0xa6ff6a, inflict: { id: 'burn', chance: 0.3 }, items: [{ id: 'scroll_plant', chance: 0.04 }] });
X('mleech', 'Mire Leech', 'Larva2', ['marsh'], 10, 92, 20, 42, [5, 12], { tint: 0x8ac060, ai: 'swarm', aggro: 100, social: true, spd: 1.25, inflict: { id: 'bleed', chance: 0.3 }, items: [{ id: 'water_drop', chance: 0.2 }] });
X('mserpent', 'Bog Serpent', 'Snake3', ['marsh'], 12, 108, 22, 50, [7, 15], { tint: 0x7a9a5a, ai: 'melee', aggro: 95, inflict: { id: 'poison', chance: 0.4 }, items: [{ id: 'gem_green', chance: 0.04 }] });
X('mspore', 'Sporeling', 'Mushroom2', ['marsh'], 10, 90, 19, 40, [5, 12], { tint: 0xb0ffa0, ai: 'hopper', aggro: 75, social: true, inflict: { id: 'slow', chance: 0.35 }, items: [{ id: 'herb_tea', chance: 0.12 }] });
X('mstalker', 'Reed Stalker', 'Lizard', ['marsh'], 12, 112, 23, 52, [7, 16], { tint: 0x90b070, ai: 'charger', aggro: 105, inflict: { id: 'bleed', chance: 0.35 }, items: [{ id: 'gem_green', chance: 0.04 }] });
X('mkappa', 'Gloom Kappa', 'KappaGreen', ['marsh'], 13, 130, 24, 58, [8, 18], { tint: 0xb090e0, ai: 'melee', aggro: 90, inflict: { id: 'slow', chance: 0.4 }, drops: [{ id: 'fox_mask', chance: 0.02 }, { id: 'fairy_wings', chance: 0.03 }], items: [{ id: 'gem_purple', chance: 0.04 }] });
X('gloomtoad', 'Old Gloomtoad', 'Reptile2', ['marsh'], 14, 720, 26, 520, [130, 210], {
  tint: 0x9ad060, scale: 2.4, boss: true, ai: 'boss', respawn: 120000,
  kit: { slamR: 50, novaR: 92 },
  mech: [{ k: 'adds', at: [0.66, 0.33], types: ['mtoad', 'mleech'], n: 3 }, { k: 'zones', every: 8500, n: 4, r: 26, wind: 1300, mul: 0.6, color: 0x70c040, status: { id: 'poison' } }],
  slainMsg: 'The Old Gloomtoad sinks into the mire with a long, tired croak.', hoardMsg: 'Loot: +2 potions from the toad\'s nest.',
  drops: [{ id: 'fox_mask', chance: 0.5 }, { id: 'fairy_wings', chance: 0.5 }, { id: 'sage_staff', chance: 0.45 }, { id: 'glimmer_orb', chance: 0.6 }],
  items: [{ id: 'gem_green', chance: 1 }, { id: 'chest_big', chance: 0.5 }],
});

// ——— Emberdeep Caverns (Lv 15-19) ———
X('cslime', 'Magma Slime', 'Slime4', ['caverns'], 15, 175, 28, 76, [10, 22], { tint: 0xff7a4a, ai: 'hopper', aggro: 85, social: true, spd: 0.9, inflict: { id: 'burn', chance: 0.35 }, items: [{ id: 'scroll_fire', chance: 0.04 }] });
X('cbat', 'Ember Bat', 'BlueBat', ['caverns'], 15, 140, 29, 74, [9, 20], { tint: 0xff9a5a, ai: 'swarm', aggro: 130, social: true, spd: 1.45, inflict: { id: 'burn', chance: 0.25 }, items: [{ id: 'feather', chance: 0.2 }] });
X('cimp', 'Cinder Imp', 'Flam', ['caverns'], 16, 150, 31, 82, [11, 24], { ai: 'ranged', aggro: 130, shot: 0xff8a3a, inflict: { id: 'burn', chance: 0.4 }, items: [{ id: 'gem_red', chance: 0.04 }], drops: [{ id: 'ember_wand', chance: 0.05 }, { id: 'ember_charm', chance: 0.05 }] });
X('cgolem', 'Obsidian Golem', 'Grey_Trex', ['caverns'], 17, 290, 32, 96, [15, 30], { tint: 0x6a5a78, scale: 1.4, ai: 'charger', aggro: 100, spd: 0.85, inflict: { id: 'stun', chance: 0.2 }, items: [{ id: 'bar_iron', chance: 0.1 }], drops: [{ id: 'stonemaul', chance: 0.04 }, { id: 'tower_shield', chance: 0.04 }] });
X('csalamander', 'Lava Salamander', 'Dragon', ['caverns'], 17, 200, 33, 92, [13, 26], { tint: 0xff8a4a, ai: 'melee', aggro: 105, inflict: { id: 'burn', chance: 0.45 }, items: [{ id: 'gem_yellow', chance: 0.05 }], drops: [{ id: 'iron_greatblade', chance: 0.05 }] });
X('ccyclops', 'Coal Cyclops', 'Cyclope2', ['caverns'], 18, 240, 35, 104, [16, 32], { tint: 0xff7050, scale: 1.25, ai: 'charger', aggro: 110, inflict: { id: 'stun', chance: 0.15 }, items: [{ id: 'bar_silver', chance: 0.08 }] });
X('forgelord', 'Forgelord Ignar', 'Beast', ['caverns'], 19, 1450, 38, 1100, [320, 520], {
  tint: 0xff9a5a, scale: 2.6, boss: true, ai: 'boss', respawn: 160000,
  kit: { slamR: 56, novaR: 104, len: 200 },
  mech: [{ k: 'zones', every: 7000, n: 5, r: 26, wind: 1200, mul: 0.7, color: 0xff6a2a, status: { id: 'burn' } }, { k: 'ring', every: 13000, r: 120, wind: 1700, mul: 0.9, color: 0xff5a1a, status: { id: 'burn' } }],
  slainMsg: 'Forgelord Ignar collapses; the forge fires gutter and go out.', hoardMsg: 'Loot: +2 potions from the Forgelord\'s stash.',
  drops: [{ id: 'tidebrand', chance: 0.45 }, { id: 'sunforged_plate', chance: 0.4 }, { id: 'tide_aegis', chance: 0.4 }, { id: 'stonemaul', chance: 0.6 }],
  items: [{ id: 'bar_mithril', chance: 1 }, { id: 'chest_big', chance: 0.6 }, { id: 'scroll_fire', chance: 0.8 }],
});
X('cavern_magmacrab', 'Magma Crab', 'cavern_magmacrab', ['caverns'], 16, 180, 29, 78, [10, 20], { ai: 'melee', aggro: 90, inflict: { id: 'burn', chance: 0.3 }, items: [{ id: 'fire_crystal', chance: 0.05 }, { id: 'magma_core', chance: 0.03 }] });
// Blender-baked cavern monsters (tools/blender_bake_monster_sheet.py): flat posterised
// 16x16 sheets in public/assets/custom/monsters, wired through CUSTOM_MONSTER_FILES.
X('cavern_emberling', 'Magma Emberling', 'cavern_emberling', ['caverns'], 15, 150, 28, 74, [9, 20], { ai: 'hopper', aggro: 90, social: true, spd: 1.05, inflict: { id: 'burn', chance: 0.4 }, items: [{ id: 'magma_core', chance: 0.05 }, { id: 'scroll_fire', chance: 0.04 }], deathFx: 'fire' });
X('cavern_gemgolem', 'Crystal Gem Golem', 'cavern_gemgolem', ['caverns'], 17, 250, 32, 92, [14, 28], { ai: 'melee', aggro: 95, social: true, spd: 0.82, inflict: { id: 'stun', chance: 0.2 }, items: [{ id: 'gem_purple', chance: 0.06 }, { id: 'fire_crystal', chance: 0.04 }], drops: [{ id: 'stonemaul', chance: 0.03 }, { id: 'tower_shield', chance: 0.03 }], deathFx: 'bones' });


// ——— Hollow Depths (level is set per floor by world/dungeons.js) ———
X('hwraith', 'Hollow Wraith', 'Spirit', ['hollow'], 12, 110, 22, 50, [8, 16], { tint: 0xc8a8ff, ai: 'ranged', aggro: 125, shot: 0xb080ff, inflict: { id: 'slow', chance: 0.4 } });
X('hknight', 'Hollow Knight', 'SkullBlue', ['hollow'], 12, 150, 23, 56, [9, 18], { tint: 0xb090ff, ai: 'melee', aggro: 110, inflict: { id: 'stun', chance: 0.15 } });
X('hcrawler', 'Dark Crawler', 'SpiderRed', ['hollow'], 12, 120, 22, 52, [8, 17], { tint: 0x8a70c0, ai: 'swarm', aggro: 115, social: true, spd: 1.3, inflict: { id: 'poison', chance: 0.3 } });
X('hhound', 'Void Hound', 'Beast2', ['hollow'], 13, 170, 25, 60, [10, 20], { tint: 0x9a80d0, ai: 'charger', aggro: 105, inflict: { id: 'bleed', chance: 0.3 } });
X('hlantern', 'Soul Lantern', 'LanternRed', ['hollow'], 12, 60, 10, 0, [0, 0], { tint: 0xd0a0ff, ai: 'ranged', aggro: 0, shot: 0xd0a0ff }); // boss-mechanic add (see world/dungeons.js)
X('hwarden', 'Hollow Warden', 'Skull', ['hollow'], 14, 820, 28, 480, [120, 200], {
  tint: 0xb080ff, scale: 2.3, boss: true, ai: 'boss', respawn: 1e9,
  kit: { slamR: 48, novaR: 90 },
  mech: [{ k: 'adds', at: [0.7, 0.4], types: ['hknight', 'hcrawler'], n: 2 }, { k: 'zones', every: 9000, n: 3, r: 26, wind: 1300, mul: 0.6, color: 0xb080ff, status: { id: 'slow' } }],
  slainMsg: 'The Hollow Warden shatters. The seal on the stairs breaks.', hoardMsg: 'Loot: +2 potions from the Warden\'s hoard.',
  drops: [{ id: 'bone_veil', chance: 0.4 }, { id: 'steel_greathelm', chance: 0.4 }, { id: 'shadow_hood', chance: 0.4 }],
  items: [{ id: 'gem_purple', chance: 1 }, { id: 'medipack', chance: 1 }],
});
X('hking', 'The Hollow King', 'SkullBlue', ['hollow'], 18, 1750, 36, 1400, [300, 480], {
  tint: 0x9a6aff, scale: 2.9, boss: true, ai: 'boss', respawn: 1e9,
  kit: { slamR: 56, novaR: 110, len: 200, wide: 36 },
  mech: [{ k: 'shield', at: [0.75, 0.5, 0.25], lantern: 'hlantern', n: 3, ringEvery: 5200 }, { k: 'beams', every: 10000, spread: [0, 0.8, -0.8, 1.6, -1.6], len: 200, wide: 20, wind: 1500, mul: 0.7, color: 0xb080ff, status: { id: 'slow' } }],
  slainMsg: 'The Hollow King crumbles. Somewhere above, a great weight lifts.', hoardMsg: 'Loot: +2 potions from the King\'s vault.',
  drops: [{ id: 'starweaver_hat', chance: 0.4 }, { id: 'sage_vestments', chance: 0.4 }, { id: 'angel_wings', chance: 0.35 }, { id: 'royal_mantle', chance: 0.4 }],
  items: [{ id: 'gem_purple', chance: 1 }, { id: 'bar_purple', chance: 1 }, { id: 'chest_big', chance: 1 }],
});
X('hollow_abysseye', 'Abyss Watcher', 'hollow_abysseye', ['hollow'], 13, 140, 24, 58, [9, 18], { ai: 'ranged', aggro: 130, shot: 0x8a2be2, inflict: { id: 'stun', chance: 0.2 }, items: [{ id: 'hollow_shard', chance: 0.05 }] });


// ——— World events ———
X('slimeking', 'Slime King Gloop', 'Slime', ['meadow'], 4, 620, 14, 420, [90, 160], {
  tint: 0x5fe0a0, scale: 3.2, boss: true, ai: 'boss', respawn: 1e9,
  kit: { slamR: 56, novaR: 96 },
  mech: [{ k: 'adds', at: [0.66, 0.33], types: ['dewslime'], n: 4 }, { k: 'zones', every: 8000, n: 3, r: 26, wind: 1300, mul: 0.6, color: 0x5fe0a0 }],
  slainMsg: 'Slime King Gloop bursts into a thousand happy puddles!', hoardMsg: 'Loot: +2 potions from the slime pile.',
  items: [{ id: 'medipack', chance: 1 }, { id: 'gem_green', chance: 0.6 }],
});
X('worldtitan', 'Ancient Thornback', 'Beast', ['meadow'], 12, 3600, 34, 1500, [400, 650], {
  tint: 0x78a84a, scale: 3.4, boss: true, ai: 'boss', respawn: 1e9,
  kit: { slamR: 62, novaR: 120, len: 220, wide: 40 },
  mech: [{ k: 'ring', every: 11000, r: 130, wind: 1800, mul: 0.8, color: 0x78c040 }, { k: 'zones', every: 6500, n: 5, r: 28, wind: 1300, mul: 0.6, color: 0x98d050, status: { id: 'poison' } }, { k: 'adds', at: [0.75, 0.5, 0.25], types: ['mossbat', 'thornmite'], n: 4 }],
  slainMsg: 'The Ancient Thornback topples with a long groan - the earth shakes.', hoardMsg: 'Loot: +2 potions from the titan\'s den.',
  drops: [{ id: 'sunforged_plate', chance: 0.6 }, { id: 'sun_crown', chance: 0.5 }, { id: 'angel_wings', chance: 0.5 }, { id: 'tide_aegis', chance: 0.5 }, { id: 'moonbow', chance: 0.5 }],
  items: [{ id: 'bar_mithril', chance: 1 }, { id: 'chest_big', chance: 1 }],
});
