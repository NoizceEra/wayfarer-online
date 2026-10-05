// Crafting expansion (DATA ONLY): rune brews, transmutations, and legendary
// feasts. Every entry uses the exact recipe shape supported by
// src/systems/crafting.js `R(id, name, station, o)`:
//
//   { id, name, station, fee, time, in, out, [inAny], [discoverOn], [desc] }
//
// - station: 'campfire' | 'anvil' | 'alchemy' (STATIONS keys only)
// - in/out keys must be material IDs from src/data/materials.js (MATS).
//   Outputs are existing mats only — no new items, no gold minting.
// - inAny: { ids, n } any-of inputs (fish only, matching existing usage).
// - discoverOn: a real mat ID that auto-teaches the recipe on first gather.
// - fee: gold sunk per craft. time: seconds at the station.
//
// All recipes are NET SINKS: inputs + fee are destroyed, outputs are existing
// consumables/materials with vendor value well below input value.
export const EXTRA_RECIPES = [
  // ── Rune brews (alchemy): rare drops + vials -> double elixir batches ──
  {
    id: 'ember_rune_brew',
    name: 'Ember Rune Brew',
    station: 'alchemy',
    in: { bog_essence: 2, wisp_dust: 3, empty_vial: 2 },
    out: { might_elixir: 2 },
    fee: 40,
    time: 10,
    discoverOn: 'bog_essence',
    desc: 'Rune-etched batch of Elixir of Might. Sinks bog essence and wisp dust.',
  },
  {
    id: 'tide_rune_brew',
    name: 'Tide Rune Brew',
    station: 'alchemy',
    in: { tide_shard: 2, moonmoss: 4, empty_vial: 2 },
    out: { guard_elixir: 2 },
    fee: 40,
    time: 10,
    discoverOn: 'tide_shard',
    desc: 'Rune-etched batch of Elixir of Warding. Sinks tide shards.',
  },
  {
    id: 'gale_rune_brew',
    name: 'Gale Rune Brew',
    station: 'alchemy',
    in: { frost_shard: 1, bat_wing: 4, empty_vial: 2 },
    out: { swift_tonic: 2 },
    fee: 40,
    time: 10,
    discoverOn: 'frost_shard',
    desc: 'Rune-etched batch of Swift Tonic. Sinks frost shards and wings.',
  },
  {
    id: 'fate_rune_brew',
    name: 'Fate Rune Brew',
    station: 'alchemy',
    in: { grave_dust: 3, wisp_dust: 3, empty_vial: 2 },
    out: { clover_tea: 2 },
    fee: 60,
    time: 12,
    discoverOn: 'grave_dust',
    desc: 'Rune-etched batch of Four-Leaf Tea. Sinks grave dust.',
  },
  // ── Transmutations (anvil/alchemy): surplus + junk -> refined stock ──
  {
    id: 'transmute_scrap_steel',
    name: 'Transmute: Scrap Steel',
    station: 'anvil',
    in: { rust_scrap: 4, old_button: 4, tattered_cloth: 2, oak_log: 1 },
    out: { iron_ingot: 1 },
    fee: 10,
    time: 6,
    discoverOn: 'rust_scrap',
    desc: 'Smelts junk and scrap into a usable Iron Ingot.',
  },
  {
    id: 'transmute_bone_crystal',
    name: 'Transmute: Bone Crystal',
    station: 'alchemy',
    in: { bone_shard: 3, grave_dust: 2, frost_crystal: 1, empty_vial: 1 },
    out: { mana_draught: 2 },
    fee: 25,
    time: 8,
    discoverOn: 'bone_shard',
    desc: 'Crystallises grave-matter into Mana Draughts.',
  },
  {
    id: 'transmute_tideglass',
    name: 'Transmute: Tideglass',
    station: 'alchemy',
    in: { crab_shell: 3, tide_shard: 1, slime_gel: 2, empty_vial: 1 },
    out: { greater_potion: 1 },
    fee: 25,
    time: 8,
    discoverOn: 'crab_shell',
    desc: 'Fuses shore salvage into a Greater Potion.',
  },
  {
    id: 'transmute_rimefire',
    name: 'Transmute: Rimefire',
    station: 'alchemy',
    in: { rime_chitin: 2, frostbell: 2, cap_spore: 2, empty_vial: 1 },
    out: { herbal_tonic: 3 },
    fee: 20,
    time: 8,
    discoverOn: 'rime_chitin',
    desc: 'Burns chitin and spores down into Herbal Tonics.',
  },
  {
    id: 'whetstone_bulk',
    name: 'Hone Whetstones (Bulk)',
    station: 'anvil',
    in: { iron_ore: 3, slime_gel: 2 },
    out: { whetstone: 2 },
    fee: 8,
    time: 5,
    discoverOn: 'iron_ore',
    desc: 'Bulk-hones two whetstones for tempering.',
  },
  // ── Legendary feasts (campfire): trophy fish + rares -> feast batches ──
  {
    id: 'leviathan_broth',
    name: "Leviathan's Broth",
    station: 'campfire',
    in: { golden_koi: 1, frost_trout: 2, frostbell: 2, oak_log: 2 },
    out: { ice_broth: 3 },
    fee: 100,
    time: 12,
    discoverOn: 'golden_koi',
    desc: 'A trophy-kettle broth. Sinks a Golden Koi and 100g.',
  },
  {
    id: 'warlord_platter',
    name: "Warlord's Platter",
    station: 'campfire',
    in: { harbor_eel: 2, silver_mackerel: 2, thorn_spike: 3, oak_log: 2 },
    out: { fish_stew: 2, mushroom_skewer: 2 },
    fee: 80,
    time: 12,
    discoverOn: 'harbor_eel',
    desc: 'A war-feast: stews and skewers for the whole party.',
  },
  {
    id: 'titan_tonic',
    name: "Titan's Tonic",
    station: 'alchemy',
    in: { bogbloom: 4, frostbell: 2, grave_dust: 2, empty_vial: 2 },
    out: { greater_potion: 2, mana_draught: 1 },
    fee: 80,
    time: 12,
    discoverOn: 'bogbloom',
    desc: 'Legendary restoratives. Sinks high-zone herbs and grave dust.',
  },
];

export default EXTRA_RECIPES;
