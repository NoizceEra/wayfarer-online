// Materials + consumables catalogue (gathered, dropped, crafted, quest items).
// Own namespace from gear.js: these live in `player.mats = {id: count}` so they
// never eat bag slots. Icons are procedural 16px (systems/matArt.js) using
// `icon` (painter id) + `color`/`trim`. `price` = vendor sell value.
// `use` = consumable effect: {heal, mp, buff:{stat, amt, secs, name}}
export const KINDS = {
  herb: 'Herb', berry: 'Berry', wood: 'Wood', ore: 'Ore', fish: 'Fish', drop: 'Monster part',
  crafted: 'Crafted', food: 'Food', potion: 'Potion', quest: 'Quest item', scroll: 'Recipe scroll', junk: 'Junk',
};

const M = (id, name, kind, icon, color, trim, price, desc, extra = {}) => ({ id, name, kind, icon, color, trim, price, desc, ...extra });

const LIST = [
  // gathered: herbs / berries / wood / ore / fish
  M('sunpetal', 'Sunpetal', 'herb', 'flower', 0xf4c542, 0x58a04a, 3, 'A golden meadow flower. Base of most tonics.'),
  M('moonmoss', 'Moonmoss', 'herb', 'leaf', 0x3fb6a8, 0x1f6b62, 6, 'Pale glowing moss from Mosswood.'),
  M('bogbloom', 'Bogbloom', 'herb', 'flower', 0x9b59b6, 0x3b6b3b, 9, 'Sickly-sweet bloom from the ruins.'),
  M('frostbell', 'Frostbell', 'herb', 'flower', 0x9fd8ff, 0x4a8fb0, 14, 'A bell-shaped flower that never thaws.'),
  M('dewberry', 'Dewberry', 'berry', 'berries', 0xc0392b, 0x3f7a3a, 2, 'Sweet and juicy. Eat raw or bake.', { use: { heal: 12 } }),
  M('thornberry', 'Thornberry', 'berry', 'berries', 0x6c3483, 0x3f7a3a, 4, 'Tart woodland berry.', { use: { heal: 18 } }),
  M('oak_log', 'Oak Log', 'wood', 'log', 0x8d5a2b, 0xc9a06a, 3, 'Seasoned hardwood. Fuels forge and fire.'),
  M('driftwood', 'Driftwood', 'wood', 'log', 0xb9a27c, 0xe3d6b4, 4, 'Salt-bleached and dry.'),
  M('iron_ore', 'Iron Ore', 'ore', 'ore', 0x8a929a, 0xd9793a, 8, 'Rust-flecked ore from the old stones.'),
  M('bone_shard', 'Bone Shard', 'ore', 'bone', 0xe8e0c8, 0xa89f84, 10, 'Brittle grave-bone, strangely dense.'),
  M('frost_crystal', 'Frost Crystal', 'ore', 'crystal', 0x8fd8ff, 0xe8f8ff, 16, 'Cold to the touch; hums in the wind.'),
  M('pond_carp', 'Pond Carp', 'fish', 'fish', 0xd98a3a, 0xf4d08a, 5, 'A plump carp.', { use: { heal: 15 } }),
  M('silver_mackerel', 'Silver Mackerel', 'fish', 'fish', 0xb8c6d4, 0x5d7a94, 9, "The harbour's pride.", { use: { heal: 20 } }),
  M('harbor_eel', 'Harbour Eel', 'fish', 'fish', 0x4a6a5a, 0xa9c8a0, 14, 'Slippery, and worth it.'),
  M('frost_trout', 'Frost Trout', 'fish', 'fish', 0x7fb8d8, 0xe8f4ff, 18, 'Icy-blue trout from the pass.'),
  M('golden_koi', 'Golden Koi', 'fish', 'fish', 0xf4c542, 0xfff0a0, 60, 'A legend among anglers. Rare!'),
  // monster parts
  M('slime_gel', 'Slime Gel', 'drop', 'gel', 0x6fdc9a, 0xd0ffe0, 2, 'Wobbly and faintly sweet.'),
  M('bat_wing', 'Bat Wing', 'drop', 'wing', 0x5a4a7a, 0x9a88c0, 3, 'Leathery and light.'),
  M('thorn_spike', 'Thorn Spike', 'drop', 'spike', 0xb7472a, 0xf0a070, 4, 'Needle-sharp.'),
  M('cap_spore', 'Cap Spore', 'drop', 'spore', 0xd8c090, 0x9a4a3a, 4, 'Dusty mushroom spores.'),
  M('wisp_dust', 'Wisp Dust', 'drop', 'dust', 0x9ae8b0, 0xffffff, 6, 'Faintly glowing powder.'),
  M('bog_essence', 'Bog Essence', 'drop', 'vial', 0x5a9a7a, 0xc8ffe0, 9, 'Murky essence of the ruins.'),
  M('rust_scrap', 'Rust Scrap', 'drop', 'ore', 0x9a5a3a, 0xd98a5a, 6, 'Flaking iron from skull armour.'),
  M('tide_shard', 'Tide Shard', 'drop', 'crystal', 0x3a8fd8, 0xbfe4ff, 12, 'Glass-blue sliver from a Tide Eye.'),
  M('crab_shell', 'Crab Shell', 'drop', 'shell', 0xe08a4a, 0xffd0a0, 6, 'Hard and orange.'),
  M('grave_dust', 'Grave Dust', 'drop', 'dust', 0x9a94b0, 0xe0daf0, 12, 'Ashenmoor grit.'),
  M('frost_shard', 'Frost Shard', 'drop', 'crystal', 0xb8e8ff, 0xffffff, 18, 'Splinter of a Frost Wisp.'),
  M('rime_chitin', 'Rime Chitin', 'drop', 'shell', 0x9fc8e0, 0xeaf6ff, 20, 'Plate-like shell of a Rime Crawler.'),
  M('old_button', 'Old Button', 'junk', 'shell', 0x8a8a7a, 0xc8c8b0, 1, 'Somebody lost this. Vendor trash.'),
  M('tattered_cloth', 'Tattered Cloth', 'junk', 'cloth', 0x8a7a6a, 0xb8a890, 2, 'Good for rags.'),
  // crafted
  M('empty_vial', 'Empty Vial', 'crafted', 'vial', 0xd8ecf4, 0xffffff, 1, "A glass vial. Sold at Maren's."),
  M('iron_ingot', 'Iron Ingot', 'crafted', 'ingot', 0xaab4be, 0x6a747e, 22, 'Smelted and ready for the anvil.'),
  M('whetstone', 'Whetstone', 'crafted', 'ingot', 0x9a8a7a, 0xd8c8b0, 12, 'Keeps the edge keen.'),
  M('herbal_tonic', 'Herbal Tonic', 'potion', 'vial', 0x58c070, 0xd0ffd8, 10, 'Restores 40 HP.', { use: { heal: 40 } }),
  M('greater_potion', 'Greater Potion', 'potion', 'vial', 0xe74c3c, 0xffd0c8, 28, 'Restores 110 HP.', { use: { heal: 110 } }),
  M('mana_draught', 'Mana Draught', 'potion', 'vial', 0x3a9cf0, 0xc8e4ff, 24, 'Restores 40 MP.', { use: { mp: 40 } }),
  M('might_elixir', 'Elixir of Might', 'potion', 'vial', 0xe67e22, 0xffe0b0, 30, '+6 ATK for 3 minutes.', { use: { buff: { stat: 'atk', amt: 6, secs: 180, name: 'Might' } } }),
  M('guard_elixir', 'Elixir of Warding', 'potion', 'vial', 0x5d8fd8, 0xd8e8ff, 30, '+5 DEF for 3 minutes.', { use: { buff: { stat: 'def', amt: 5, secs: 180, name: 'Warding' } } }),
  M('swift_tonic', 'Swift Tonic', 'potion', 'vial', 0xf1c40f, 0xfff6c0, 26, '+25 speed for 2 minutes.', { use: { buff: { stat: 'spd', amt: 25, secs: 120, name: 'Swiftness' } } }),
  M('clover_tea', 'Four-Leaf Tea', 'potion', 'vial', 0x58a04a, 0xe8ffd8, 32, '+8 LUK for 5 minutes (better drops).', { use: { buff: { stat: 'luk', amt: 8, secs: 300, name: 'Fortune' } } }),
  M('berry_tart', 'Berry Tart', 'food', 'bread', 0xc0392b, 0xf4d08a, 14, 'Restores 35 HP; +30 max HP for 5 min.', { use: { heal: 35, buff: { stat: 'hp', amt: 30, secs: 300, name: 'Well Fed' } } }),
  M('grilled_fish', 'Grilled Fish', 'food', 'bowl', 0xd98a3a, 0xf4e0b0, 16, 'Restores 60 HP.', { use: { heal: 60 } }),
  M('fish_stew', 'Fish Stew', 'food', 'bowl', 0xb8743a, 0xffd890, 26, 'Restores 70 HP; +4 DEF for 4 min.', { use: { heal: 70, buff: { stat: 'def', amt: 4, secs: 240, name: 'Hearty' } } }),
  M('mushroom_skewer', 'Mushroom Skewer', 'food', 'bread', 0x9a4a3a, 0xd8c090, 12, 'Restores 45 HP; +3 ATK for 4 min.', { use: { heal: 45, buff: { stat: 'atk', amt: 3, secs: 240, name: 'Spirited' } } }),
  M('ice_broth', 'Frostbell Broth', 'food', 'bowl', 0x7fb8d8, 0xeaf6ff, 34, 'Restores 90 HP; +20 speed for 3 min.', { use: { heal: 90, buff: { stat: 'spd', amt: 20, secs: 180, name: 'Chilled' } } }),
  // quest items (no sell value)
  M('sealed_letter', 'Sealed Letter', 'quest', 'letter', 0xf0e0c0, 0xc0392b, 0, 'A wax-sealed letter. Not yours to read.'),
  M('lantern_oil', 'Lantern Oil', 'quest', 'vial', 0xf4c542, 0xfff0a0, 0, 'A flask of clear lamp oil.'),
  M('frost_note', 'Frost Note', 'quest', 'letter', 0xdff0ff, 0x4a8fb0, 0, "A note from Captain Rusk, for Scout Ilka."),
  M('tide_sigil', 'Tide Sigil', 'quest', 'crystal', 0x3a8fd8, 0xffffff, 0, 'A cold, pulsing sigil.'),
  // recipe scrolls (auto-learn on pickup)
  M('scroll_greater', 'Scroll: Greater Potion', 'scroll', 'scroll', 0xe74c3c, 0xf0e0c0, 40, 'Teaches Greater Potion.', { learn: 'greater_potion' }),
  M('scroll_stew', 'Scroll: Fish Stew', 'scroll', 'scroll', 0xb8743a, 0xf0e0c0, 40, 'Teaches Fish Stew.', { learn: 'fish_stew' }),
  M('scroll_might', 'Scroll: Elixir of Might', 'scroll', 'scroll', 0xe67e22, 0xf0e0c0, 50, 'Teaches Elixir of Might.', { learn: 'might_elixir' }),
  M('scroll_clover', 'Scroll: Four-Leaf Tea', 'scroll', 'scroll', 0x58a04a, 0xf0e0c0, 60, 'Teaches Four-Leaf Tea.', { learn: 'clover_tea' }),
];

export const MATS = Object.fromEntries(LIST.map((m) => [m.id, m]));
export const matById = (id) => MATS[id] || null;
export const MAT_IDS = LIST.map((m) => m.id);
export const isConsumable = (m) => !!(m && m.use);

// Monster part drops: typeId -> [{id, chance}] (rolled per kill; goes straight to the pack).
export const MOB_MATS = {
  dewslime: [{ id: 'slime_gel', chance: 0.45 }, { id: 'old_button', chance: 0.05 }],
  mossbat: [{ id: 'bat_wing', chance: 0.4 }, { id: 'tattered_cloth', chance: 0.05 }],
  thornmite: [{ id: 'thorn_spike', chance: 0.4 }, { id: 'scroll_clover', chance: 0.012 }],
  capling: [{ id: 'cap_spore', chance: 0.4 }],
  willowisp: [{ id: 'wisp_dust', chance: 0.35 }, { id: 'scroll_greater', chance: 0.015 }],
  bogspirit: [{ id: 'bog_essence', chance: 0.35 }],
  rustskull: [{ id: 'rust_scrap', chance: 0.4 }, { id: 'scroll_might', chance: 0.012 }],
  tideeye: [{ id: 'tide_shard', chance: 0.3 }],
  shorecrab: [{ id: 'crab_shell', chance: 0.45 }, { id: 'scroll_stew', chance: 0.02 }],
  bonesentinel: [{ id: 'bone_shard', chance: 0.3 }, { id: 'grave_dust', chance: 0.3 }],
  gravebat: [{ id: 'bat_wing', chance: 0.35 }, { id: 'grave_dust', chance: 0.25 }],
  gravemaw: [{ id: 'bone_shard', chance: 1 }, { id: 'grave_dust', chance: 1 }],
  frostwisp: [{ id: 'frost_shard', chance: 0.3 }, { id: 'wisp_dust', chance: 0.2 }],
  rimecrawler: [{ id: 'rime_chitin', chance: 0.3 }],
};
export function rollMatDrops(typeId, luk = 0) {
  const out = [];
  for (const d of MOB_MATS[typeId] || []) if (Math.random() < Math.min(0.95, d.chance * (1 + luk * 0.01))) out.push(d.id);
  return out;
}

export const PACK_CAP = 99; // per stack
