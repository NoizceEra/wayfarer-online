// Gear catalog: 8 equipment slots, 4 rarity tiers, stat bonuses keyed to
// STR/AGI/VIT/INT/DEX/LUK + ATK/DEF (+ hp/mp/spd), level + class gates, sell
// prices. Worn visuals are procedural pixel art layered on the hero for all four
// facings (systems/gearArt.js) — every item is authored here from a `style`
// (shape family) + `colors` (main/trim), and any dyeable item can be recoloured
// with a DYE. Icons are procedural 16px too (same file).
import { ENEMY_TABLE } from './jobs.js';
import { ZONES } from './zones.js';

export const SLOTS = ['head', 'face', 'body', 'back', 'weapon', 'offhand', 'feet', 'charm'];
export const SLOT_LABEL = {
  head: 'HEAD', face: 'FACE', body: 'BODY', back: 'BACK',
  weapon: 'WEAPON', offhand: 'OFF-HAND', feet: 'FEET', charm: 'CHARM',
};
// Old saves used chest/trinket; map them on load (core/save.js).
export const LEGACY_SLOT = { chest: 'body', trinket: 'charm' };

export const RARITY = {
  common:   { id: 'common',   name: 'Common',   color: '#d6dccb', tint: 0xd6dccb, weight: 0 },
  uncommon: { id: 'uncommon', name: 'Uncommon', color: '#6fdc6a', tint: 0x6fdc6a, weight: 1 },
  rare:     { id: 'rare',     name: 'Rare',     color: '#56a8ff', tint: 0x56a8ff, weight: 2 },
  epic:     { id: 'epic',     name: 'Epic',     color: '#c07bff', tint: 0xc07bff, weight: 3 },
};

// Dyes recolour the PRIMARY colour of a dyeable item (worn art + icon).
export const DYES = [
  { id: 'crimson', name: 'Crimson', tint: 0xc0392b },
  { id: 'ember',   name: 'Ember',   tint: 0xe67e22 },
  { id: 'sun',     name: 'Sunflower', tint: 0xf1c40f },
  { id: 'moss',    name: 'Moss',    tint: 0x58a04a },
  { id: 'teal',    name: 'Teal',    tint: 0x1abc9c },
  { id: 'sky',     name: 'Sky',     tint: 0x5dade2 },
  { id: 'tide',    name: 'Tide',    tint: 0x2e5fa8 },
  { id: 'violet',  name: 'Violet',  tint: 0x8e44ad },
  { id: 'rose',    name: 'Rose',    tint: 0xe86fa0 },
  { id: 'cocoa',   name: 'Cocoa',   tint: 0x7a4a22 },
  { id: 'sand',    name: 'Sand',    tint: 0xd9c08a },
  { id: 'snow',    name: 'Snow',    tint: 0xf1f3f5 },
  { id: 'ash',     name: 'Ash',     tint: 0x8a929a },
  { id: 'night',   name: 'Night',   tint: 0x2a2838 },
  { id: 'gold',    name: 'Gilt',    tint: 0xe2b93b },
  { id: 'plum',    name: 'Plum',    tint: 0x5b2d6e },
];
export const dyeById = (id) => DYES.find((d) => d.id === id) || null;

// `t(...)` builds an item with defaults. Fields:
//  slot rarity lvl cls[] stats{} price sell style colors{main,trim} dyeable
//  hidesHair tex kind upright (weapons) shop[] drop{enemies[]} starter desc
const M = (id, name, slot, rarity, lvl, stats, price, style, main, trim, extra = {}) => ({
  id, name, slot, rarity, lvl, stats, price, style,
  colors: { main, trim: trim ?? main },
  dyeable: true, ...extra,
});

const LIST = [
  // ── HEAD ──────────────────────────────────────────────────────────────
  M('straw_hat', 'Straw Hat', 'head', 'common', 1, { def: 1, vit: 1, hp: 10 }, 40, 'brim', 0xd9b64a, 0xb03a2e, { hidesHair: true, shop: ['maren'], starter: true, desc: 'Wide brim. Sun-faded and cozy.' }),
  M('red_bandana', 'Red Bandana', 'head', 'common', 1, { agi: 1 }, 30, 'band', 0xc0392b, 0xf4ecd8, { shop: ['dovey'], starter: true, desc: 'Keeps the hair out of your eyes.' }),
  M('traveler_hood', "Traveler's Hood", 'head', 'common', 1, { def: 1, vit: 1 }, 45, 'hood', 0x5d7a4a, 0x3c5230, { hidesHair: true, shop: ['dovey'], starter: true, desc: 'Weatherproof wool.' }),
  M('leather_cap', 'Leather Cap', 'head', 'common', 1, { def: 2 }, 55, 'cap', 0x8d5524, 0x4e2e10, { hidesHair: true, shop: ['bram'], desc: 'Stitched tight.' }),
  M('fox_ears', 'Fox Ear Band', 'head', 'uncommon', 1, { agi: 1, luk: 1 }, 90, 'ears', 0xe67e22, 0xf4ecd8, { shop: ['dovey'], desc: 'Twitches when you are lucky.' }),
  M('flower_wreath', 'Bloom Wreath', 'head', 'uncommon', 1, { luk: 2, vit: 1 }, 110, 'wreath', 0x58a04a, 0xf06292, { shop: ['dovey'], starter: true, desc: 'Fresh from the meadow.' }),
  M('ranger_cap', "Ranger's Cap", 'head', 'uncommon', 3, { dex: 2, agi: 1, def: 1 }, 120, 'cap_feather', 0x4a7a3a, 0xe74c3c, { cls: ['ranger'], hidesHair: true, drop: { enemies: ['mossbat', 'capling'] }, desc: 'A red feather for good aim.' }),
  M('iron_helm', 'Iron Helm', 'head', 'uncommon', 4, { def: 4, vit: 1 }, 120, 'helm', 0x9aa7ad, 0xc0392b, { hidesHair: true, drop: { enemies: ['thornmite', 'rustskull'] }, desc: 'Clanks. Protects.' }),
  M('mage_hat', 'Mage Hat', 'head', 'uncommon', 3, { int: 2, mp: 20, def: 1 }, 150, 'cone', 0x2e4a8d, 0xf4e042, { hidesHair: true, shop: ['dovey'], drop: { enemies: ['willowisp', 'bogspirit'] }, desc: 'Pointy. Whispers spells.' }),
  M('bone_veil', 'Bone Veil', 'head', 'rare', 6, { def: 3, vit: 2, luk: 1, hp: 15 }, 200, 'veil', 0xd5cfc1, 0x1a1a22, { hidesHair: true, hidesFace: true, drop: { enemies: ['bogspirit'] }, desc: 'Unsettling, but warm inside.' }),
  M('horned_helm', 'Horned Helm', 'head', 'rare', 7, { str: 3, def: 5 }, 260, 'horns', 0x8a9299, 0xe8dcc0, { hidesHair: true, drop: { enemies: ['rustskull', 'capling'] }, desc: 'For proper berserkers.' }),
  M('shadow_hood', 'Shadow Hood', 'head', 'rare', 6, { agi: 3, luk: 2, def: 2 }, 240, 'hood', 0x2d2a3a, 0x7d3c98, { cls: ['bandit'], hidesHair: true, drop: { enemies: ['rustskull', 'bogspirit'] }, desc: 'Nobody remembers the face.' }),
  M('steel_greathelm', 'Steel Greathelm', 'head', 'rare', 8, { def: 7, str: 2, vit: 2 }, 340, 'helm_plume', 0xc5ced3, 0xc0392b, { hidesHair: true, drop: { enemies: ['rustskull', 'tideeye'] }, desc: 'A crest to rally behind.' }),
  M('tide_crown', 'Tide Crown', 'head', 'rare', 8, { def: 2, int: 3, mp: 10, hp: 10 }, 300, 'crown_gem', 0xf4c542, 0x45c8b8, { drop: { enemies: ['tideeye'] }, desc: 'Glimmers like a wave.' }),
  M('starweaver_hat', 'Starweaver Hat', 'head', 'epic', 10, { int: 6, mp: 40, luk: 2, def: 2 }, 640, 'cone_stars', 0x5b2d9e, 0xffe066, { cls: ['arcanist'], hidesHair: true, drop: { enemies: ['tideeye'] }, desc: 'Stitched from night sky.' }),
  M('sun_crown', 'Sunforged Crown', 'head', 'epic', 10, { luk: 4, str: 2, int: 2, def: 4, hp: 20 }, 720, 'crown', 0xffc83d, 0xff6b3d, { drop: { enemies: ['tideeye'] }, desc: 'Warm to the touch.' }),

  // ── FACE ──────────────────────────────────────────────────────────────
  M('round_glasses', 'Round Specs', 'face', 'common', 1, { int: 1 }, 35, 'glasses', 0x8d6e3f, 0xbfe6ff, { shop: ['dovey'], starter: true, desc: 'Scholarly.' }),
  M('sun_shades', 'Sun Shades', 'face', 'common', 1, { dex: 1 }, 40, 'shades', 0x1a1a22, 0x6fa8dc, { shop: ['dovey'], starter: true, desc: 'Too cool for the meadow.' }),
  M('eyepatch', "Sailor's Patch", 'face', 'common', 1, { luk: 1 }, 45, 'eyepatch', 0x23232b, 0x23232b, { shop: ['dovey'], desc: 'One eye on the horizon.' }),
  M('bandit_mask', 'Bandit Mask', 'face', 'uncommon', 3, { agi: 2, dex: 1 }, 110, 'mask', 0x7b1f1f, 0x1a1a22, { cls: ['bandit'], shop: ['dovey'], drop: { enemies: ['rustskull'] }, desc: 'Two eyeholes, zero questions.' }),
  M('gold_monocle', 'Gilded Monocle', 'face', 'rare', 6, { int: 3, dex: 2 }, 230, 'monocle', 0xe8b22a, 0xd6f3ff, { drop: { enemies: ['bogspirit', 'tideeye'] }, desc: 'Sees through lies.' }),
  M('fox_mask', 'Kitsune Mask', 'face', 'epic', 9, { agi: 3, luk: 3, dex: 2 }, 560, 'foxmask', 0xf4ecd8, 0xc0392b, { drop: { enemies: ['tideeye'] }, desc: 'Festival night, every night.' }),

  // ── BODY ──────────────────────────────────────────────────────────────
  M('worn_tunic', "Traveler's Tunic", 'body', 'common', 1, { def: 1 }, 20, 'tunic', 0x8a7a5a, 0x5a3a1e, { shop: ['maren'], starter: true, desc: 'Smells like every road.' }),
  M('leather_vest', 'Leather Vest', 'body', 'common', 1, { def: 2, hp: 10 }, 45, 'vest', 0x7a4a22, 0x4e2e10, { shop: ['bram'], starter: true, desc: 'Laced up the front.' }),
  M('harvest_smock', 'Harvest Smock', 'body', 'common', 1, { vit: 1, luk: 1 }, 60, 'smock', 0xd4ac0d, 0xf4ecd8, { shop: ['maren'], starter: true, desc: 'Flour-dusted apron. Lucky.' }),
  M('ranger_jerkin', 'Ranger Jerkin', 'body', 'uncommon', 3, { agi: 2, dex: 1, def: 2 }, 130, 'jerkin', 0x4a7a3a, 0x7a4a22, { cls: ['ranger'], drop: { enemies: ['mossbat', 'thornmite'] }, desc: 'Leaf-green, quiet.' }),
  M('iron_mail', 'Iron Mail', 'body', 'uncommon', 4, { def: 4, vit: 1, hp: 10 }, 140, 'mail', 0x8d9a9b, 0x5a6a6a, { drop: { enemies: ['thornmite', 'capling'] }, desc: 'Rings softly when you walk.' }),
  M('mage_robe', 'Mage Robe', 'body', 'uncommon', 3, { int: 2, mp: 25, def: 1 }, 130, 'robe', 0x3a5a9d, 0xf4e042, { shop: ['dovey'], drop: { enemies: ['bogspirit', 'willowisp'] }, desc: 'Sleeves big enough for spells.' }),
  M('shadow_garb', 'Shadow Garb', 'body', 'rare', 6, { agi: 3, luk: 1, def: 3 }, 250, 'jerkin', 0x2d2a3a, 0x7d3c98, { cls: ['bandit'], drop: { enemies: ['rustskull'] }, desc: 'Drinks in the light.' }),
  M('tide_plate', 'Tide Plate', 'body', 'rare', 8, { def: 6, vit: 3, hp: 25 }, 320, 'plate', 0x2e86c1, 0xf4c542, { drop: { enemies: ['tideeye'] }, desc: 'Soaks hits like a sponge.' }),
  M('sage_vestments', 'Sage Vestments', 'body', 'epic', 10, { int: 6, mp: 50, def: 3, luk: 1 }, 660, 'robe_trim', 0xe8e4f0, 0xd4a820, { cls: ['arcanist'], drop: { enemies: ['tideeye'] }, desc: 'Gold thread, old magic.' }),
  M('sunforged_plate', 'Sunforged Plate', 'body', 'epic', 10, { def: 9, str: 3, vit: 4, hp: 40 }, 720, 'plate', 0xe2c14a, 0xc0392b, { drop: { enemies: ['tideeye'] }, desc: 'Polished by a dozen dawns.' }),

  // ── BACK ──────────────────────────────────────────────────────────────
  M('traveler_cloak', "Traveler's Cloak", 'back', 'common', 1, { def: 1 }, 50, 'cape', 0x5a6a8a, 0x3a4a6a, { shop: ['dovey'], starter: true, desc: 'Keeps off the dust.' }),
  M('hiking_pack', 'Hiking Pack', 'back', 'common', 1, { vit: 1 }, 55, 'pack', 0x8d5524, 0x4e2e10, { shop: ['maren'], starter: true, desc: 'Bedroll and snacks.' }),
  M('scarlet_cape', 'Scarlet Cape', 'back', 'uncommon', 1, { luk: 1, def: 1 }, 100, 'cape_trim', 0xc0392b, 0xf4c542, { shop: ['dovey'], desc: 'Flutters dramatically.' }),
  M('hunter_quiver', "Hunter's Quiver", 'back', 'uncommon', 3, { dex: 2, atk: 1 }, 100, 'quiver', 0x7a4a22, 0xecf0f1, { cls: ['ranger'], shop: ['bram'], desc: 'Fletched and ready.' }),
  M('fairy_wings', 'Fairy Wings', 'back', 'rare', 5, { agi: 3, luk: 1, spd: 6 }, 280, 'wings_fairy', 0xb8f0ff, 0xffffff, { drop: { enemies: ['willowisp'] }, desc: 'Glitter on the breeze.' }),
  M('bat_wings', 'Bat Wings', 'back', 'rare', 7, { agi: 2, str: 2, atk: 2 }, 300, 'wings_bat', 0x4a2d6a, 0xd35400, { drop: { enemies: ['mossbat', 'bogspirit'] }, desc: 'Leathery and loud.' }),
  M('royal_mantle', 'Royal Mantle', 'back', 'epic', 9, { def: 4, str: 2, luk: 2, hp: 20 }, 600, 'cape_royal', 0x7d1f8a, 0xf4ecd8, { drop: { enemies: ['tideeye', 'rustskull'] }, desc: 'Ermine trim. Very heavy.' }),
  M('angel_wings', 'Seraph Wings', 'back', 'epic', 10, { vit: 4, luk: 3, int: 2, def: 3, spd: 8 }, 760, 'wings_angel', 0xf4f4ff, 0xf4c542, { drop: { enemies: ['tideeye'] }, desc: 'Feathers that never fall.' }),

  // ── WEAPON (tex = real in-hand sprite tinted per item; kind drives attacks) ──
  M('honed_edge', 'Honed Edge', 'weapon', 'common', 1, { atk: 3 }, 60, 'sword', 0xffffff, 0xffffff, { tex: 'weapon.sword', kind: 'melee', cls: ['wayfarer'], shop: ['bram'], dyeable: false, desc: 'A decent edge.' }),
  M('steel_brand', 'Steel Brand', 'weapon', 'uncommon', 4, { atk: 5, str: 1 }, 140, 'sword', 0xffffff, 0xd4a820, { tex: 'weapon.sword2', kind: 'melee', cls: ['wayfarer'], shop: ['bram'], dyeable: false, drop: { enemies: ['thornmite', 'capling'] }, desc: 'Well balanced.' }),
  M('woodsman_axe', "Woodsman's Axe", 'weapon', 'uncommon', 3, { atk: 6, str: 2 }, 150, 'axe', 0xffffff, 0x7a4a22, { tex: 'weapon.axe', kind: 'melee', upright: true, cls: ['wayfarer'], dyeable: false, drop: { enemies: ['capling', 'thornmite'] }, desc: 'Chops trees. And slimes.' }),
  M('iron_greatblade', 'Iron Greatblade', 'weapon', 'rare', 6, { atk: 8, str: 2 }, 240, 'greatsword', 0xbfd4e6, 0xd4a820, { tex: 'weapon.bigSword', kind: 'melee', cls: ['wayfarer'], drop: { enemies: ['capling', 'rustskull'] }, desc: 'Heavy. Very heavy.' }),
  M('stonemaul', 'Stone Maul', 'weapon', 'rare', 7, { atk: 9, str: 3 }, 280, 'hammer', 0xffffff, 0x7a4a22, { tex: 'weapon.hammer', kind: 'melee', upright: true, cls: ['wayfarer'], dyeable: false, drop: { enemies: ['rustskull'] }, desc: 'Settles arguments.' }),
  M('tidebrand', 'Tidebrand', 'weapon', 'epic', 10, { atk: 12, str: 2, int: 2, mp: 10 }, 640, 'sword', 0x5ad1ff, 0x5ad1ff, { tex: 'weapon.sword', kind: 'melee', cls: ['wayfarer'], drop: { enemies: ['tideeye'] }, desc: 'Hums with the tide.' }),
  M('yew_bow', 'Yew Longbow', 'weapon', 'common', 1, { atk: 4, dex: 1 }, 90, 'bow', 0xffffff, 0xffffff, { tex: 'weapon.bow', kind: 'bow', cls: ['ranger'], shop: ['bram'], dyeable: false, desc: 'Ranged.' }),
  M('hunter_bow', "Hunter's Bow", 'weapon', 'uncommon', 4, { atk: 6, dex: 2 }, 170, 'bow', 0xffffff, 0xd4a820, { tex: 'weapon.bow2', kind: 'bow', cls: ['ranger'], dyeable: false, drop: { enemies: ['mossbat', 'willowisp'] }, desc: 'Reinforced limbs.' }),
  M('moonbow', 'Moonlit Bow', 'weapon', 'epic', 10, { atk: 11, dex: 4, agi: 2, luk: 2 }, 620, 'bow', 0x9fd8ff, 0x9fd8ff, { tex: 'weapon.bow2', kind: 'bow', cls: ['ranger'], drop: { enemies: ['tideeye'] }, desc: 'Arrows that shine.' }),
  M('ember_wand', 'Ember Wand', 'weapon', 'uncommon', 2, { atk: 5, int: 2, mp: 10 }, 140, 'wand', 0xff8d5a, 0xff8d5a, { tex: 'weapon.wand', kind: 'wand', cls: ['arcanist'], shop: ['dovey'], drop: { enemies: ['willowisp'] }, desc: 'Warm to hold.' }),
  M('frost_wand', 'Frost Wand', 'weapon', 'rare', 6, { atk: 8, int: 3, mp: 15 }, 260, 'wand', 0x7fd8ff, 0x7fd8ff, { tex: 'weapon.wand', kind: 'wand', cls: ['arcanist'], drop: { enemies: ['bogspirit'] }, desc: 'Leaves frost on the grass.' }),
  M('oak_staff', 'Oak Staff', 'weapon', 'common', 1, { atk: 4, int: 2 }, 80, 'staff', 0xffe6c0, 0x7fd8ff, { tex: 'weapon.staff', kind: 'wand', upright: true, cls: ['arcanist'], shop: ['dovey'], dyeable: false, desc: 'A walking stick that remembers.' }),
  M('sage_staff', 'Sage Staff', 'weapon', 'rare', 7, { atk: 8, int: 4, mp: 30 }, 300, 'staff', 0xb6ffb0, 0xb6ffb0, { tex: 'weapon.staff', kind: 'wand', upright: true, cls: ['arcanist'], drop: { enemies: ['bogspirit'] }, desc: 'Leafy and wise.' }),
  M('tide_staff', 'Tideglass Staff', 'weapon', 'epic', 10, { atk: 11, int: 6, mp: 50 }, 660, 'staff', 0x7fe0ff, 0x7fe0ff, { tex: 'weapon.staff', kind: 'wand', upright: true, cls: ['arcanist'], drop: { enemies: ['tideeye'] }, desc: 'A drop of the sea, frozen.' }),
  M('bone_dagger', 'Bone Dagger', 'weapon', 'common', 1, { atk: 3, dex: 1 }, 70, 'dagger', 0xffffff, 0xffffff, { tex: 'weapon.bone', kind: 'melee', cls: ['bandit'], shop: ['bram'], dyeable: false, desc: 'Quick and cheap.' }),
  M('fang_pair', 'Ember Fangs', 'weapon', 'uncommon', 2, { atk: 4, agi: 1 }, 110, 'dagger', 0xffb36b, 0xffb36b, { tex: 'weapon.sai', kind: 'melee', cls: ['bandit'], drop: { enemies: ['thornmite'] }, desc: 'Bites.' }),
  M('silver_rapier', 'Silver Rapier', 'weapon', 'uncommon', 4, { atk: 6, dex: 2 }, 160, 'rapier', 0xffffff, 0xd4a820, { tex: 'weapon.rapier', kind: 'melee', cls: ['bandit'], dyeable: false, drop: { enemies: ['rustskull', 'capling'] }, desc: 'En garde.' }),
  M('shadowfang', 'Shadowfang', 'weapon', 'rare', 6, { atk: 8, agi: 3, luk: 2 }, 270, 'dagger', 0x9a7dff, 0x9a7dff, { tex: 'weapon.katana', kind: 'melee', cls: ['bandit'], drop: { enemies: ['rustskull', 'bogspirit'] }, desc: 'Cuts the dark.' }),

  // ── OFF-HAND ──────────────────────────────────────────────────────────
  M('wooden_buckler', 'Wooden Buckler', 'offhand', 'common', 1, { def: 2 }, 50, 'round', 0x8d5524, 0xc9a83c, { shop: ['bram'], starter: true, desc: 'Small, handy.' }),
  M('wayfarer_lantern', "Wayfarer's Lantern", 'offhand', 'common', 1, { luk: 1, vit: 1 }, 65, 'lantern', 0xf4c542, 0x5a3a1e, { shop: ['maren'], starter: true, desc: 'Never goes out. Mostly.' }),
  M('spell_tome', 'Spell Tome', 'offhand', 'uncommon', 3, { int: 3, mp: 15 }, 150, 'tome', 0x7d3c98, 0xf4e042, { cls: ['arcanist'], shop: ['dovey'], desc: 'Pages turn by themselves.' }),
  M('iron_kite', 'Iron Kite Shield', 'offhand', 'uncommon', 4, { def: 4, vit: 1 }, 140, 'kite', 0x8d9a9b, 0xc0392b, { shop: ['bram'], drop: { enemies: ['thornmite', 'rustskull'] }, desc: 'Classic.' }),
  M('glimmer_orb', 'Glimmer Orb', 'offhand', 'rare', 6, { int: 4, luk: 1, mp: 20 }, 250, 'orb', 0xb388ff, 0xffffff, { drop: { enemies: ['bogspirit', 'willowisp'] }, desc: 'Floats beside you.' }),
  M('tower_shield', 'Bastion Shield', 'offhand', 'rare', 8, { def: 7, vit: 2 }, 300, 'tower', 0x5d6d7e, 0xf4c542, { drop: { enemies: ['rustskull', 'tideeye'] }, desc: 'A wall you can carry.' }),
  M('tide_aegis', 'Tide Aegis', 'offhand', 'epic', 10, { def: 9, vit: 3, int: 2, hp: 30 }, 680, 'round', 0x2e86c1, 0x76d7c4, { drop: { enemies: ['tideeye'] }, desc: 'The sea says no.' }),

  // ── FEET ──────────────────────────────────────────────────────────────
  M('leather_boots', 'Leather Boots', 'feet', 'common', 1, { def: 1 }, 40, 'boots', 0x7a4a22, 0x4e2e10, { shop: ['maren'], starter: true, desc: 'Well-walked.' }),
  M('trail_sandals', 'Trail Sandals', 'feet', 'common', 1, { agi: 1 }, 35, 'sandals', 0xc9a060, 0x7a4a22, { shop: ['dovey'], starter: true, desc: 'Breezy.' }),
  M('swift_boots', 'Swift Boots', 'feet', 'uncommon', 3, { agi: 2, spd: 10 }, 130, 'boots', 0x2e86c1, 0xecf0f1, { shop: ['bram'], desc: 'Light as a feather charm.' }),
  M('mage_slippers', 'Star Slippers', 'feet', 'uncommon', 3, { int: 1, agi: 1, mp: 10 }, 120, 'slippers', 0x5b2d9e, 0xf4e042, { shop: ['dovey'], desc: 'Curled toes, cosmic soles.' }),
  M('iron_greaves', 'Iron Greaves', 'feet', 'uncommon', 4, { def: 3, vit: 1 }, 120, 'greaves', 0x8d9a9b, 0x5a6a6a, { drop: { enemies: ['thornmite', 'rustskull'] }, desc: 'Stomp.' }),
  M('shadow_boots', 'Shadow Boots', 'feet', 'rare', 6, { agi: 3, luk: 1, spd: 12 }, 250, 'boots', 0x2d2a3a, 0x7d3c98, { drop: { enemies: ['rustskull', 'bogspirit'] }, desc: 'Silent on stone.' }),
  M('sunforged_greaves', 'Sunforged Greaves', 'feet', 'epic', 10, { def: 5, str: 2, vit: 2, spd: 8 }, 560, 'greaves', 0xe2c14a, 0xc0392b, { drop: { enemies: ['tideeye'] }, desc: 'Gleam at every step.' }),

  // ── CHARM ─────────────────────────────────────────────────────────────
  M('moss_charm', 'Moss Charm', 'charm', 'common', 1, { hp: 15, vit: 1 }, 30, 'leaf', 0x5da24a, 0x3c7a30, { shop: ['maren'], starter: true, drop: { enemies: ['dewslime'] }, desc: 'Damp but lucky.' }),
  M('feather_charm', 'Feather Charm', 'charm', 'common', 1, { spd: 12, agi: 1 }, 50, 'feather', 0xecf0f1, 0xb0b8c0, { shop: ['maren'], starter: true, drop: { enemies: ['mossbat'] }, desc: 'Light steps.' }),
  M('lucky_clover', 'Lucky Clover', 'charm', 'uncommon', 1, { luk: 2 }, 90, 'clover', 0x58c05a, 0x2f8040, { shop: ['dovey'], drop: { enemies: ['dewslime', 'mossbat'] }, desc: 'Four leaves, four wishes.' }),
  M('wolf_fang', 'Wolf Fang', 'charm', 'uncommon', 3, { str: 2, atk: 1 }, 110, 'fang', 0xf4ecd8, 0xb8ad94, { drop: { enemies: ['thornmite', 'capling'] }, desc: 'Keep it close.' }),
  M('ember_charm', 'Ember Charm', 'charm', 'uncommon', 3, { atk: 2, hp: 10, str: 1 }, 100, 'gem', 0xd35400, 0xff9a4a, { drop: { enemies: ['willowisp'] }, desc: 'Warm.' }),
  M('tide_pearl', 'Tide Pearl', 'charm', 'rare', 6, { mp: 15, hp: 15, int: 2 }, 200, 'gem', 0x76d7c4, 0xd6fff6, { drop: { enemies: ['bogspirit'] }, desc: 'A drop of calm.' }),
  M('sun_locket', 'Sun Locket', 'charm', 'epic', 9, { luk: 3, vit: 3, int: 2, str: 2 }, 600, 'locket', 0xf4c542, 0xff8d3a, { drop: { enemies: ['tideeye'] }, desc: 'Something glows inside.' }),
];

export const GEAR = Object.fromEntries(LIST.map((g) => [g.id, g]));
export const gearById = (id) => GEAR[id] || null;
export const itemsForSlot = (slot) => LIST.filter((g) => g.slot === slot);
export const sellPrice = (g) => Math.max(1, Math.floor((g.sell ?? g.price * 0.4) || 1));

// ── Shops: stalls in Thistle Town ───────────────────────────────────────
const shopStock = (id) => LIST.filter((g) => g.shop?.includes(id)).map((g) => g.id);
export const SHOPS = {
  maren: { id: 'maren', title: "MAREN'S GENERAL GOODS", stock: shopStock('maren') },
  dovey: { id: 'dovey', title: "DOVEY'S HATS & HABERDASHERY", stock: shopStock('dovey') },
  bram:  { id: 'bram',  title: "BRAM'S SMITHY & ARMS", stock: shopStock('bram') },
};
export const SHOP_STOCK = SHOPS.maren.stock; // legacy export

// ── Stats ───────────────────────────────────────────────────────────────
export const STAT_KEYS = ['str', 'agi', 'vit', 'int', 'dex', 'luk', 'atk', 'def', 'hp', 'mp', 'spd'];

// equipment: { slot: itemId|null }. Returns the summed bonuses of everything
// worn: {str,agi,vit,int,dex,luk,atk,def,hp,mp,spd}. Consumed by stats.js /
// CharacterScene and ModularPlayer.effAtk/effDef.
export function getEquipBonuses(equipment) {
  const t = Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
  for (const id of Object.values(equipment || {})) {
    const g = id && GEAR[id];
    if (!g) continue;
    for (const k of STAT_KEYS) t[k] += g.stats[k] || 0;
  }
  return t;
}

const STAT_LABEL = { str: 'STR', agi: 'AGI', vit: 'VIT', int: 'INT', dex: 'DEX', luk: 'LUK', atk: 'ATK', def: 'DEF', hp: 'HP', mp: 'MP', spd: 'SPD' };
export const statLabel = (k) => STAT_LABEL[k] || k.toUpperCase();
export function statLine(stats) {
  const parts = [];
  for (const k of STAT_KEYS) if (stats?.[k]) parts.push(`${stats[k] > 0 ? '+' : ''}${stats[k]} ${STAT_LABEL[k]}`);
  return parts.join(', ') || '—';
}

// Can this job/level wear it? Returns null if yes, else the reason.
export function equipBlock(g, level, jobId) {
  if (!g) return 'Unknown item';
  if (g.cls && jobId && !g.cls.includes(jobId)) return `${g.cls.map((c) => c[0].toUpperCase() + c.slice(1)).join('/')} only`;
  if (g.lvl > (level || 1)) return `Requires Lv ${g.lvl}`;
  return null;
}

// ── Drops: rarity-weighted by the enemy's zone level ───────────────────
const enemyLevel = (typeId) => {
  const zs = (ENEMY_TABLE[typeId]?.zones || []).map((z) => ZONES.find((zz) => zz.id === z)?.level || 1);
  return zs.length ? Math.max(...zs) : 1;
};
export function rarityWeights(zoneLevel) {
  const L = Math.max(1, zoneLevel);
  return {
    common: Math.max(24, 76 - L * 5),
    uncommon: 22 + L * 1.5,
    rare: 1.5 + L * 1.3,
    epic: Math.max(0, (L - 5) * 0.55),
  };
}
const pickWeighted = (entries) => {
  const tot = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * tot;
  for (const [v, w] of entries) { r -= w; if (r <= 0) return v; }
  return entries[entries.length - 1]?.[0] ?? null;
};
// Roll a gear drop for a slain enemy. `luck` (LUK) nudges the drop chance.
export function rollGearDrop(typeId, luck = 0) {
  const L = enemyLevel(typeId);
  const chance = Math.min(0.5, 0.07 + L * 0.008 + luck * 0.004);
  if (Math.random() > chance) return null;
  const w = rarityWeights(L);
  const rar = pickWeighted(Object.entries(w).filter(([, v]) => v > 0));
  // Droppable pool: has a drop table, level within reach of the zone
  let pool = LIST.filter((g) => g.drop && g.rarity === rar && g.lvl <= L + 4);
  if (!pool.length) pool = LIST.filter((g) => g.drop && g.lvl <= L + 4);
  if (!pool.length) return null;
  // Signature drops of this enemy are 4x as likely
  return pickWeighted(pool.map((g) => [g.id, g.drop.enemies.includes(typeId) ? 4 : 1]));
}
