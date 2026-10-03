// Enemy defs for the expansion maps (Driftwood Beach, Crypt, Frostpeak).
// Merged into the shared ENEMY_TABLE (read lazily by Enemy.js) so the original
// jobs.js table stays untouched. Extra optional fields understood by Enemy /
// WorldScene: scale, tint, dmg (contact damage override), drops [{id,chance}]
// (existing gear ids), boss, respawn (ms).
import { ENEMY_TABLE } from './jobs.js';
import { AREAS } from './areas.js';
import { giveItem, ITEMS } from './items.js';
import './enemiesExtra.js'; // world-expansion monsters (desert / marsh / caverns / Hollow Depths / world events)
import './materialsExtra.js'; // their gather + drop materials

Object.assign(ENEMY_TABLE, {
  // — Driftwood Beach (Dock Town) —
  shorecrab: {
    name: 'Shore Crab', sprite: 'YellowsBat', hp: 44, atk: 8, xp: 15, gold: [3, 8], dmg: 3, zones: ['dock_beach'],
    drops: [{ id: 'feather_charm', chance: 0.04 }, { id: 'leather_cap', chance: 0.03 }],
  },
  // — Crypt of Ashenmoor —
  bonesentinel: {
    name: 'Bone Sentinel', sprite: 'SkullBlue', hp: 105, atk: 19, xp: 44, gold: [6, 14], dmg: 7, zones: ['crypt'],
    drops: [{ id: 'iron_helm', chance: 0.06 }, { id: 'iron_greatblade', chance: 0.04 }, { id: 'bone_veil', chance: 0.05 }],
  },
  gravebat: {
    name: 'Grave Bat', sprite: 'Owl2', hp: 72, atk: 17, xp: 38, gold: [5, 12], dmg: 6, zones: ['crypt'],
    drops: [{ id: 'mage_hat', chance: 0.05 }, { id: 'tide_pearl', chance: 0.04 }],
  },
  // Mini-boss: telegraphed Bone Slam / Grave Charge / (phase 2) Dirge Nova — see entities/Boss.js
  gravemaw: {
    name: 'Warden Gravemaw', sprite: 'Grey_Trex', hp: 640, atk: 26, xp: 420, gold: [140, 220], dmg: 10,
    scale: 2.1, boss: true, respawn: 90000, zones: ['crypt'],
    drops: [{ id: 'tide_plate', chance: 1 }, { id: 'tidebrand', chance: 0.4 }, { id: 'tide_crown', chance: 0.35 }],
  },
  // — Frostpeak Pass —
  frostwisp: {
    name: 'Frost Wisp', sprite: 'Flam2', hp: 88, atk: 20, xp: 46, gold: [7, 15], dmg: 8, zones: ['frost'],
    drops: [{ id: 'mage_robe', chance: 0.05 }, { id: 'ember_wand', chance: 0.04 }, { id: 'tide_pearl', chance: 0.04 }],
  },
  rimecrawler: {
    name: 'Rime Crawler', sprite: 'Larva2', hp: 130, atk: 22, xp: 54, gold: [8, 18], dmg: 9, zones: ['frost'],
    drops: [{ id: 'iron_mail', chance: 0.06 }, { id: 'iron_greatblade', chance: 0.05 }, { id: 'ember_charm', chance: 0.04 }],
  },
});

// ——— Monster roster expansion (Actor/Monster, all sheets validated 64x64 by tools/validate_sheets.py) ———
// Zone tiers: meadow Lv1-4, woods 4-8, beach (dock_beach) 2-5, ruins 8-12, crypt 9-13, frost 11-15.
// `E(id, name, sprite, zones, hp, atk, xp, [goldMin, goldMax], extra)`; `tint` recolours reused sheets.
const E = (id, name, sprite, zones, hp, atk, xp, gold, extra = {}) => {
  ENEMY_TABLE[id] = { name, sprite, hp, atk, xp, gold, zones, dmg: Math.max(2, Math.round(atk * 0.42)), ...extra };
};
// meadow
E('fieldmouse', 'Field Mouse', 'Mouse', ['meadow'], 22, 5, 7, [1, 3], { items: [{ id: 'nut_bag', chance: 0.12 }] });
E('gelgreen', 'Green Gel', 'Slime2', ['meadow'], 34, 6, 9, [1, 4], { items: [{ id: 'grass', chance: 0.15 }] });
E('gelblue', 'Dew Gel', 'Slime3', ['meadow'], 40, 7, 11, [2, 5], { items: [{ id: 'water_flask', chance: 0.1 }] });
E('gorselizard', 'Gorse Lizard', 'Lizard', ['meadow'], 32, 7, 10, [1, 5], { items: [{ id: 'feather', chance: 0.08 }] });
E('burrower', 'Burrower', 'Mole', ['meadow'], 38, 8, 12, [2, 6], { items: [{ id: 'rock', chance: 0.15 }] });
E('meadowcap', 'Bluecap', 'Mushroom2', ['meadow', 'woods'], 40, 8, 13, [2, 6], { items: [{ id: 'herb_tea', chance: 0.1 }] });
// woods
E('stinger', 'Gold Stinger', 'SpiderYellow', ['woods'], 44, 9, 15, [2, 7], { items: [{ id: 'apple_honey', chance: 0.1 }] });
E('bramblesnake', 'Bramble Snake', 'Snake2', ['woods'], 48, 10, 17, [3, 8], { items: [{ id: 'branch', chance: 0.15 }] });
E('hootling', 'Hootling', 'Owl', ['woods'], 40, 11, 18, [3, 8], { items: [{ id: 'feather', chance: 0.25 }] });
E('fernlizard', 'Fern Lizard', 'Lizard2', ['woods'], 52, 11, 19, [3, 9], { items: [{ id: 'gem_green', chance: 0.03 }] });
E('lilykappa', 'Lily Kappa', 'KappaGreen', ['woods'], 58, 12, 21, [4, 9], { items: [{ id: 'herb_tea', chance: 0.12 }, { id: 'gem_green', chance: 0.03 }] });
E('pondaxolot', 'Pond Axolotl', 'Axolot', ['woods'], 50, 10, 18, [3, 8], { items: [{ id: 'water_drop', chance: 0.2 }] });
E('bamboolet', 'Bamboolet', 'Bamboo', ['woods'], 60, 11, 22, [4, 9], { items: [{ id: 'branch', chance: 0.2 }] });
E('mossbear', 'Moss Bear', 'Panda', ['woods'], 88, 13, 28, [5, 12], { scale: 1.25, items: [{ id: 'meat', chance: 0.25 }] });
// beach (Dock Town)
E('sandadder', 'Sand Adder', 'Snake', ['dock_beach'], 46, 9, 16, [3, 8], { items: [{ id: 'shrimp', chance: 0.1 }] });
E('beachsnail', 'Beach Snail', 'Mollusc', ['dock_beach'], 52, 8, 16, [3, 8], { items: [{ id: 'fish_fresh', chance: 0.12 }] });
E('tideoctopus', 'Tide Octopus', 'Octopus', ['dock_beach'], 50, 9, 17, [3, 9], { items: [{ id: 'calamari', chance: 0.12 }] });
E('bandit_racoon', 'Bandit Raccoon', 'GoldRacoon', ['dock_beach'], 56, 10, 19, [6, 14], { items: [{ id: 'silver_coin', chance: 0.25 }] });
// ruins
E('mudmollusc', 'Mud Mollusc', 'Mollusc2', ['ruins'], 82, 14, 28, [4, 11], { items: [{ id: 'bar_copper', chance: 0.06 }] });
E('reedoctopus', 'Reed Octopus', 'GreenOctopus', ['ruins'], 86, 15, 30, [5, 12], { items: [{ id: 'octopus_leg', chance: 0.12 }] });
E('mirefiend', 'Mire Fiend', 'Reptile', ['ruins'], 98, 17, 34, [6, 13], { items: [{ id: 'gem_yellow', chance: 0.04 }] });
E('embercyclops', 'Ember Cyclops', 'Cyclope', ['ruins'], 112, 18, 38, [6, 14], { scale: 1.2, items: [{ id: 'bar_iron', chance: 0.06 }, { id: 'scroll_fire', chance: 0.03 }] });
E('ruinlantern', 'Ruin Lantern', 'LanternRed', ['ruins'], 72, 17, 32, [5, 12], { items: [{ id: 'scroll_fire', chance: 0.04 }] });
E('rexling', 'Rexling', 'TRex', ['ruins'], 120, 19, 40, [7, 15], { items: [{ id: 'meat', chance: 0.2 }] });
// crypt
E('ashghost', 'Ash Ghost', 'Spirit2', ['crypt'], 86, 18, 40, [5, 12], { items: [{ id: 'scroll_home', chance: 0.03 }] });
E('bloodheart', 'Blood Heart', 'HeartRed', ['crypt'], 96, 19, 42, [6, 13], { items: [{ id: 'heart_charm', chance: 0.08 }] });
E('gravedigger', 'Gravedigger', 'Mole2', ['crypt'], 102, 18, 41, [6, 14], { items: [{ id: 'tool_shovel', chance: 0.03 }, { id: 'bar_silver', chance: 0.04 }] });
E('bloodeye', 'Blood Eye', 'Eye2', ['crypt'], 90, 20, 44, [6, 14], { items: [{ id: 'gem_red', chance: 0.04 }] });
E('cryptadder', 'Crypt Adder', 'Snake4', ['crypt'], 80, 19, 40, [5, 12], { items: [{ id: 'gem_purple', chance: 0.03 }] });
E('shadehound', 'Shade Beast', 'Beast2', ['crypt'], 118, 20, 46, [7, 15], { scale: 1.2, items: [{ id: 'bar_iron', chance: 0.06 }] });
// frost
E('icejelly', 'Ice Jelly', 'AxolotBlue', ['frost'], 100, 20, 48, [7, 16], { items: [{ id: 'scroll_ice', chance: 0.04 }] });
E('frostgel', 'Frost Gel', 'Slime3', ['frost'], 110, 20, 46, [7, 16], { tint: 0xbfe8ff, items: [{ id: 'water_drop', chance: 0.25 }] });
E('glaciersnail', 'Glacier Snail', 'Mollusc2', ['frost'], 140, 21, 52, [8, 18], { tint: 0xbfe0ff, items: [{ id: 'bar_silver', chance: 0.05 }] });
E('rimelizard', 'Rime Lizard', 'Reptile2', ['frost'], 122, 22, 54, [8, 18], { tint: 0xd8f0ff, items: [{ id: 'gem_yellow', chance: 0.04 }] });
E('snowspecter', 'Snow Specter', 'Spirit', ['frost'], 112, 22, 56, [8, 18], { tint: 0xc8e8ff, items: [{ id: 'scroll_ice', chance: 0.05 }] });
E('yeti', 'Mountain Yeti', 'Beast', ['frost'], 172, 24, 62, [10, 22], { scale: 1.4, tint: 0xf0f8ff, items: [{ id: 'meat', chance: 0.3 }, { id: 'bar_mithril', chance: 0.04 }] });
// New mini-bosses (Boss pattern from entities/Boss.js, reusing big-scaled 16px monster sheets)
ENEMY_TABLE.redclaw = {
  name: 'Old Redclaw', sprite: 'RedOctopus', hp: 330, atk: 15, xp: 210, gold: [70, 120], dmg: 6,
  scale: 2.2, boss: true, respawn: 80000, zones: ['dock_beach'],
  drops: [{ id: 'feather_charm', chance: 1 }, { id: 'tide_pearl', chance: 0.4 }],
  items: [{ id: 'gold_cup', chance: 0.5 }, { id: 'sushi', chance: 0.8 }],
};
ENEMY_TABLE.glacierwyrm = {
  name: 'Glacier Wyrm', sprite: 'DragonYellow', hp: 980, atk: 30, xp: 760, gold: [220, 360], dmg: 13,
  scale: 2.4, tint: 0x9fd8ff, boss: true, respawn: 100000, zones: ['frost'],
  drops: [{ id: 'tide_plate', chance: 0.6 }, { id: 'tide_crown', chance: 0.5 }, { id: 'tidebrand', chance: 0.5 }],
  items: [{ id: 'bar_mithril', chance: 1 }, { id: 'chest_big', chance: 0.5 }, { id: 'scroll_thunder', chance: 0.6 }],
};

// ——— Custom Biome Monsters (12 new monsters across 6 biomes) ———
// Meadowfield
E('dewbeetle', 'Dew Beetle', 'meadow_dewbeetle', ['meadow'], 28, 6, 8, [1, 4], { items: [{ id: 'grass', chance: 0.18 }, { id: 'water_drop', chance: 0.12 }] });
E('quillkin', 'Meadow Quillkin', 'meadow_quillkin', ['meadow'], 36, 7, 10, [2, 5], { items: [{ id: 'feather', chance: 0.15 }, { id: 'nut_bag', chance: 0.1 }] });
// Mosswood
E('brambleboar', 'Bramble Boar', 'forest_brambleboar', ['woods'], 65, 12, 22, [3, 8], { items: [{ id: 'meat', chance: 0.25 }, { id: 'branch', chance: 0.2 }] });
E('moss_treant', 'Mosswood Treant', 'forest_treant', ['woods'], 85, 13, 26, [4, 10], { items: [{ id: 'branch', chance: 0.3 }, { id: 'herb_tea', chance: 0.15 }], drops: [{ id: 'iron_helm', chance: 0.03 }] });
// Whisperfen Marsh
E('bogleech', 'Bog Leech', 'marsh_bogleech', ['marsh'], 96, 20, 45, [6, 14], { items: [{ id: 'water_drop', chance: 0.25 }, { id: 'fish_fresh', chance: 0.12 }] });
E('mirelurker', 'Mire Lurker', 'marsh_mirelurker', ['marsh'], 120, 22, 52, [7, 16], { items: [{ id: 'gem_green', chance: 0.05 }, { id: 'scroll_plant', chance: 0.04 }], drops: [{ id: 'fox_mask', chance: 0.02 }] });
// Driftwood Beach
E('coralcrab', 'Spiny Coral Crab', 'beach_coralcrab', ['dock_beach'], 48, 9, 16, [3, 8], { items: [{ id: 'shrimp', chance: 0.15 }, { id: 'tide_pearl', chance: 0.04 }], drops: [{ id: 'leather_cap', chance: 0.04 }] });
E('reefjelly', 'Bioluminescent Reef Jelly', 'beach_reefjelly', ['dock_beach'], 42, 8, 14, [2, 7], { items: [{ id: 'water_flask', chance: 0.12 }, { id: 'feather_charm', chance: 0.03 }] });
// Crypt of Ashenmoor
E('shadowwraith', 'Shadow Wraith', 'crypt_shadowwraith', ['crypt'], 95, 20, 46, [6, 14], { items: [{ id: 'scroll_home', chance: 0.04 }, { id: 'gem_purple', chance: 0.04 }], drops: [{ id: 'bone_veil', chance: 0.05 }] });
E('bonehound', 'Bone Hound', 'crypt_bonehound', ['crypt'], 110, 21, 48, [6, 15], { items: [{ id: 'bar_iron', chance: 0.06 }], drops: [{ id: 'iron_greatblade', chance: 0.04 }] });
// Frostpeak Pass
E('frostfox', 'Arctic Frost Fox', 'frost_frostfox', ['frost'], 105, 21, 50, [7, 16], { items: [{ id: 'feather', chance: 0.2 }, { id: 'gem_yellow', chance: 0.04 }], drops: [{ id: 'ember_charm', chance: 0.04 }] });
E('icegolem', 'Glacier Brute', 'frost_icegolem', ['frost'], 160, 24, 60, [9, 20], { scale: 1.2, items: [{ id: 'bar_silver', chance: 0.06 }, { id: 'scroll_ice', chance: 0.05 }], drops: [{ id: 'iron_mail', chance: 0.06 }] });

// Extra overworld spawns [type, count, zone]; WorldScene.spawnEnemies reads this list.
export const EXTRA_OVERWORLD_SPAWNS = [
  ['fieldmouse', 10, 'meadow'], ['gelgreen', 10, 'meadow'], ['gelblue', 8, 'meadow'], ['gorselizard', 8, 'meadow'], ['burrower', 6, 'meadow'], ['meadowcap', 6, 'meadow'],
  ['dewbeetle', 8, 'meadow'], ['quillkin', 6, 'meadow'],
  ['stinger', 8, 'woods'], ['bramblesnake', 8, 'woods'], ['hootling', 6, 'woods'], ['fernlizard', 6, 'woods'], ['lilykappa', 5, 'woods'], ['pondaxolot', 5, 'woods'], ['bamboolet', 6, 'woods'], ['mossbear', 3, 'woods'],
  ['brambleboar', 6, 'woods'], ['moss_treant', 4, 'woods'],
  ['mudmollusc', 6, 'ruins'], ['reedoctopus', 5, 'ruins'], ['mirefiend', 5, 'ruins'], ['embercyclops', 4, 'ruins'], ['ruinlantern', 4, 'ruins'], ['rexling', 3, 'ruins'],
];
// Area spawn additions (merged into data/areas.js AREAS[*].enemies / spawnRects).
AREAS.dock.enemies.push(['sandadder', 3, 'dock_beach'], ['beachsnail', 3, 'dock_beach'], ['tideoctopus', 3, 'dock_beach'], ['bandit_racoon', 2, 'dock_beach'], ['coralcrab', 4, 'dock_beach'], ['reefjelly', 4, 'dock_beach'], ['redclaw', 1, 'beach_boss']);
AREAS.dock.spawnRects.beach_boss = [50, 15, 4, 6];
AREAS.crypt.enemies.push(['ashghost', 3, 'w'], ['bloodheart', 3, 'e'], ['gravedigger', 2, 'w'], ['bloodeye', 3, 'hall'], ['cryptadder', 3, 'e'], ['shadehound', 2, 'hall'], ['shadowwraith', 3, 'hall'], ['bonehound', 3, 'w']);
AREAS.frost.enemies.push(['icejelly', 5, 'field'], ['frostgel', 5, 'field'], ['glaciersnail', 4, 'field'], ['rimelizard', 4, 'field'], ['snowspecter', 4, 'field'], ['yeti', 3, 'field'], ['frostfox', 4, 'field'], ['icegolem', 3, 'field'], ['glacierwyrm', 1, 'wyrm']);
AREAS.frost.spawnRects.wyrm = [44, 18, 8, 5];

// Item drops (data/items.js ids) from def.items; plus a small generic food/resource roll.
export function rollItemDrops(scene, ed) {
  const def = ed.def;
  const got = [];
  for (const d of def.items || []) if (ITEMS[d.id] && Math.random() < d.chance) got.push(d.id);
  if (!got.length && Math.random() < 0.06) got.push(def.boss ? 'medipack' : ['onigiri', 'fish_fresh', 'nut_bag'][Math.floor(Math.random() * 3)]);
  for (const id of got) {
    giveItem(scene, id, 1);
    scene.damageNumber?.(ed.x + 6, ed.y - 16, `+${ITEMS[id].name}`, '#9fe8ff');
  }
  return got;
}
// Combat behaviour for every enemy (base table in jobs.js + the ones above).
//  lv      — level the base stats are tuned for (instances roll lv..lv+2 within the zone range)
//  ai      — hopper (slow lunge) | swarm (fast darting, circles) | charger (long wind-up dash)
//            | ranged (kites + fires orbs) | melee (standard lunge)
//  aggro   — proactive aggro radius (px); social — pulls nearby kin into the fight
//  flee    — HP fraction below which it runs away (then returns when healed a bit)
//  inflict — status applied on hit {id, chance}; spd — move speed multiplier
const BEHAVIOUR = {
  dewslime:     { lv: 1,  ai: 'hopper',  aggro: 70,  social: true,  spd: 0.8 },
  mossbat:      { lv: 2,  ai: 'swarm',   aggro: 95,  social: true,  spd: 1.35, flee: 0.2 },
  thornmite:    { lv: 4,  ai: 'charger', aggro: 90,  inflict: { id: 'poison', chance: 0.35 } },
  capling:      { lv: 5,  ai: 'melee',   aggro: 70,  flee: 0.25, inflict: { id: 'slow', chance: 0.3 } },
  willowisp:    { lv: 6,  ai: 'ranged',  aggro: 115, inflict: { id: 'burn', chance: 0.4 }, shot: 0xa6ff6a },
  bogspirit:    { lv: 9,  ai: 'melee',   aggro: 95,  social: true, inflict: { id: 'slow', chance: 0.35 } },
  rustskull:    { lv: 8,  ai: 'charger', aggro: 100, social: true, inflict: { id: 'bleed', chance: 0.35 } },
  tideeye:      { lv: 10, ai: 'ranged',  aggro: 130, inflict: { id: 'stun', chance: 0.18 }, shot: 0x6ad8ff },
  shorecrab:    { lv: 3,  ai: 'melee',   aggro: 75,  social: true, flee: 0.2, inflict: { id: 'bleed', chance: 0.25 } },
  bonesentinel: { lv: 10, ai: 'melee',   aggro: 100, social: true, spd: 0.85, inflict: { id: 'stun', chance: 0.15 } },
  gravebat:     { lv: 9,  ai: 'swarm',   aggro: 120, social: true, spd: 1.4, inflict: { id: 'bleed', chance: 0.3 } },
  gravemaw:     { lv: 13, ai: 'boss' },
  frostwisp:    { lv: 12, ai: 'ranged',  aggro: 125, inflict: { id: 'slow', chance: 0.5 }, shot: 0xbfe8ff },
  rimecrawler:  { lv: 13, ai: 'charger', aggro: 95,  social: true, inflict: { id: 'poison', chance: 0.3 } },
  // 12 new custom biome monsters
  dewbeetle:    { lv: 2,  ai: 'hopper',  aggro: 70,  social: true,  spd: 0.85 },
  quillkin:     { lv: 3,  ai: 'charger', aggro: 80,  inflict: { id: 'bleed', chance: 0.25 } },
  brambleboar:  { lv: 5,  ai: 'charger', aggro: 95,  social: true,  spd: 1.1,  inflict: { id: 'bleed', chance: 0.3 } },
  moss_treant:  { lv: 6,  ai: 'melee',   aggro: 85,  spd: 0.75,     inflict: { id: 'stun', chance: 0.15 } },
  bogleech:     { lv: 11, ai: 'swarm',   aggro: 105, social: true,  spd: 1.25, inflict: { id: 'bleed', chance: 0.35 } },
  mirelurker:   { lv: 12, ai: 'melee',   aggro: 100, inflict: { id: 'poison', chance: 0.4 } },
  coralcrab:    { lv: 4,  ai: 'melee',   aggro: 80,  social: true,  inflict: { id: 'bleed', chance: 0.25 } },
  reefjelly:    { lv: 3,  ai: 'hopper',  aggro: 75,  social: true,  spd: 0.85, inflict: { id: 'slow', chance: 0.3 } },
  shadowwraith: { lv: 11, ai: 'ranged',  aggro: 125, shot: 0xb080ff, inflict: { id: 'slow', chance: 0.4 } },
  bonehound:    { lv: 10, ai: 'charger', aggro: 110, social: true,  spd: 1.3,  inflict: { id: 'bleed', chance: 0.35 } },
  frostfox:     { lv: 12, ai: 'swarm',   aggro: 120, social: true,  spd: 1.4,  flee: 0.2, inflict: { id: 'slow', chance: 0.35 } },
  icegolem:     { lv: 13, ai: 'melee',   aggro: 90,  spd: 0.8,      inflict: { id: 'stun', chance: 0.2 } },
};
for (const [id, b] of Object.entries(BEHAVIOUR)) if (ENEMY_TABLE[id]) Object.assign(ENEMY_TABLE[id], b);

// Roll a def-level gear drop (for enemies not listed in gear.js drop tables).
export function rollDefDrop(typeId, gearById) {
  const def = ENEMY_TABLE[typeId];
  if (!def || !def.drops) return null;
  for (const d of def.drops) {
    if (gearById(d.id) && Math.random() < d.chance) return d.id;
  }
  return null;
}
