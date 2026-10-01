// Materials for the world-expansion maps (Sunscorch Desert, Whisperfen Marsh, Emberdeep
// Caverns, Hollow Depths, world events). Merged additively into data/materials.js's MATS,
// MAT_IDS (codex) and MOB_MATS (drop tables). Imported for its side effects from
// data/worldEnemies.js, which the loader + zones already pull in early.
import { MATS, MAT_IDS, MOB_MATS } from './materials.js';

const M = (id, name, kind, icon, color, trim, price, desc, extra = {}) => ({ id, name, kind, icon, color, trim, price, desc, ...extra });

const LIST = [
  // Sunscorch Desert
  M('cactus_fruit', 'Prickly Pear', 'berry', 'berries', 0xe8507a, 0x3f8a3a, 6, 'Sweet, sticky, and worth the spines.', { use: { heal: 28 } }),
  M('sun_aloe', 'Sun Aloe', 'herb', 'leaf', 0x9fe070, 0x4a8a3a, 16, 'Cooling gel from the oasis aloe.'),
  M('sunstone', 'Sunstone', 'ore', 'crystal', 0xffb03a, 0xfff0a0, 24, 'A warm amber crystal; it never quite cools.'),
  M('scarab_shell', 'Scarab Shell', 'drop', 'shell', 0xd8b030, 0xfff0a0, 14, 'Gilded and hard as brass.'),
  M('scorpion_sting', 'Scorpion Sting', 'drop', 'spike', 0xc05a2a, 0xffc090, 15, 'Curved and venomous.'),
  M('wraith_ash', 'Wraith Ash', 'drop', 'dust', 0xe8d0a0, 0xffffff, 16, 'Warm grey ash that hums faintly.'),
  M('pharaoh_seal', 'Pharaoh Seal', 'quest', 'crystal', 0xffc83a, 0xffffff, 0, 'A golden seal from the Temple of the Sunken Sun.'),
  // Whisperfen Marsh
  M('fen_lily', 'Fen Lily', 'herb', 'flower', 0xff9ad5, 0x3b7a4b, 15, 'A pale lily that blooms only in mist.'),
  M('glow_cap', 'Glowcap', 'herb', 'spore', 0x7fffb0, 0x2a6a5a, 13, 'A mushroom that shines faint green.'),
  M('bog_iron', 'Bog Iron', 'ore', 'ore', 0x6a5a4a, 0xc08a4a, 18, 'Rusty nodules dredged from peat.'),
  M('toad_slime', 'Toad Slime', 'drop', 'gel', 0x8ac060, 0xe0ffb0, 12, 'Slick and faintly warm.'),
  M('wisp_lantern', 'Wisp Lantern', 'drop', 'dust', 0xa6ff6a, 0xffffff, 17, 'A sliver of will-o-wisp light.'),
  M('gloom_spore', 'Gloom Spore', 'drop', 'spore', 0x9a70c0, 0xe0c8ff, 15, 'Dark spores; smell of old pond.'),
  // Emberdeep Caverns
  M('ember_ore', 'Ember Ore', 'ore', 'ore', 0xc0502a, 0xffa050, 26, 'Ore that glows from within.'),
  M('fire_crystal', 'Fire Crystal', 'ore', 'crystal', 0xff5a3a, 0xffd0a0, 34, 'A crystal like a frozen flame.'),
  M('obsidian_shard', 'Obsidian Shard', 'drop', 'crystal', 0x3a3048, 0x9a80c0, 22, 'Razor-edged volcanic glass.'),
  M('magma_core', 'Magma Core', 'drop', 'ore', 0xff7a3a, 0xffe0a0, 30, 'A still-molten heart of stone.'),
  M('forge_sigil', 'Forge Sigil', 'quest', 'crystal', 0xff8a3a, 0xffffff, 0, 'A searing sigil taken from the Forgelord.'),
  // Hollow Depths + events
  M('hollow_shard', 'Hollow Shard', 'drop', 'crystal', 0xb080ff, 0xf0e0ff, 36, 'A fragment of the hollow dark. Dungeons drop them.'),
  M('star_fragment', 'Star Fragment', 'ore', 'crystal', 0xc8f0ff, 0xffffff, 40, 'Fell from a shooting star, still glittering.'),
  M('caravan_spice', 'Caravan Spice', 'drop', 'dust', 0xe0783a, 0xffd8a0, 28, 'Exotic spice from a travelling merchant.'),
  M('slime_crown_gel', 'Royal Gel', 'drop', 'gel', 0x5fe0a0, 0xffffff, 30, 'Wobbles with regal dignity.'),
  M('titan_heartstone', 'Titan Heartstone', 'drop', 'ore', 0xd8a84a, 0xfff0c0, 120, 'Dropped by a world boss. Shines like a little sun.'),
];
for (const m of LIST) { MATS[m.id] = m; if (!MAT_IDS.includes(m.id)) MAT_IDS.push(m.id); }

Object.assign(MOB_MATS, {
  // desert
  dscarab: [{ id: 'scarab_shell', chance: 0.4 }], dscorpion: [{ id: 'scorpion_sting', chance: 0.4 }],
  dcobra: [{ id: 'scorpion_sting', chance: 0.25 }], dwraith: [{ id: 'wraith_ash', chance: 0.35 }],
  dcactus: [{ id: 'cactus_fruit', chance: 0.3 }], djackal: [{ id: 'tattered_cloth', chance: 0.2 }],
  dguardian: [{ id: 'sunstone', chance: 0.12 }, { id: 'scarab_shell', chance: 0.3 }],
  khet: [{ id: 'pharaoh_seal', chance: 1 }, { id: 'sunstone', chance: 1 }],
  // marsh
  mtoad: [{ id: 'toad_slime', chance: 0.4 }], mwisp: [{ id: 'wisp_lantern', chance: 0.35 }],
  mleech: [{ id: 'toad_slime', chance: 0.25 }], mserpent: [{ id: 'gloom_spore', chance: 0.25 }],
  mspore: [{ id: 'glow_cap', chance: 0.35 }], mstalker: [{ id: 'gloom_spore', chance: 0.3 }],
  mkappa: [{ id: 'fen_lily', chance: 0.2 }], gloomtoad: [{ id: 'gloom_spore', chance: 1 }, { id: 'wisp_lantern', chance: 1 }],
  // caverns
  cslime: [{ id: 'magma_core', chance: 0.18 }], cbat: [{ id: 'bat_wing', chance: 0.3 }], cimp: [{ id: 'ember_ore', chance: 0.2 }],
  cgolem: [{ id: 'obsidian_shard', chance: 0.35 }, { id: 'ember_ore', chance: 0.2 }], csalamander: [{ id: 'fire_crystal', chance: 0.15 }],
  ccyclops: [{ id: 'obsidian_shard', chance: 0.3 }], forgelord: [{ id: 'forge_sigil', chance: 1 }, { id: 'fire_crystal', chance: 1 }, { id: 'magma_core', chance: 1 }],
  // hollow depths
  hwraith: [{ id: 'hollow_shard', chance: 0.3 }], hknight: [{ id: 'hollow_shard', chance: 0.3 }], hcrawler: [{ id: 'hollow_shard', chance: 0.25 }],
  hhound: [{ id: 'hollow_shard', chance: 0.3 }], hwarden: [{ id: 'hollow_shard', chance: 1 }], hking: [{ id: 'hollow_shard', chance: 1 }],
  // events
  slimeking: [{ id: 'slime_crown_gel', chance: 1 }, { id: 'slime_gel', chance: 1 }], worldtitan: [{ id: 'titan_heartstone', chance: 1 }],
});
