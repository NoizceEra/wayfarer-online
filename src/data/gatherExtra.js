// Gather nodes for the expansion maps. Merged into systems/gathering.js
// (NODE_TYPES / FISH_TABLES / AREA_PLAN). Art reuses the procedural node painters
// (herb / bush / ore / crystal / fish kinds) with new colours.
export const EXTRA_NODE_TYPES = {
  cactus: { kind: 'bush', mat: 'cactus_fruit', label: 'Pick Prickly Pear', yield: [2, 3], respawn: 70, color: 0xe8507a },
  aloe: { kind: 'herb', mat: 'sun_aloe', label: 'Cut Sun Aloe', yield: [1, 2], respawn: 85, color: 0x9fe070 },
  sunstone: { kind: 'crystal', mat: 'sunstone', label: 'Mine Sunstone', yield: [1, 2], respawn: 160, color: 0xffb03a },
  oasis: { kind: 'fish', spot: 'oasis', label: 'Fish in the Oasis', respawn: 20, color: 0x4ac0d0 },
  fenlily: { kind: 'herb', mat: 'fen_lily', label: 'Pick Fen Lily', yield: [1, 2], respawn: 80, color: 0xff9ad5 },
  glowcap: { kind: 'herb', mat: 'glow_cap', label: 'Pick Glowcap', yield: [1, 2], respawn: 75, color: 0x7fffb0 },
  bogiron: { kind: 'ore', mat: 'bog_iron', label: 'Dredge Bog Iron', yield: [1, 2], respawn: 130, color: 0x8a6a4a },
  fenpool: { kind: 'fish', spot: 'fen', label: 'Fish in the Fen', respawn: 20, color: 0x4a9a8a },
  emberore: { kind: 'ore', mat: 'ember_ore', label: 'Mine Ember Ore', yield: [1, 2], respawn: 140, color: 0xc0502a },
  starcrystal: { kind: 'crystal', mat: 'star_fragment', label: 'Collect Star Fragment', yield: [1, 2], respawn: 99999, color: 0xc8f0ff }, // world event (systems/worldEvents.js)
  firecrystal: { kind: 'crystal', mat: 'fire_crystal', label: 'Mine Fire Crystal', yield: [1, 2], respawn: 170, color: 0xff5a3a },
};
export const EXTRA_FISH = {
  oasis: { pond_carp: 48, harbor_eel: 36, golden_koi: 3, old_button: 7, tattered_cloth: 6 },
  fen: { pond_carp: 40, harbor_eel: 42, golden_koi: 3.5, old_button: 9, tattered_cloth: 7 },
};
// Map plans: scatter [node, count, rect(tiles, relative to the area origin)], fixed [node, tx, ty].
// Builders mark unreachable tiles (mesa pockets, deep water) via b.walkable so nodes never land there.
export const EXTRA_AREA_PLAN = {
  desert: {
    scatter: [['cactus', 14, [20, 2, 58, 56]], ['aloe', 6, [44, 40, 16, 14]], ['aloe', 3, [2, 22, 16, 16]], ['sunstone', 8, [22, 2, 56, 56]], ['sunstone', 3, [58, 7, 18, 16]]],
    fixed: [['oasis', 10.5, 27.6], ['oasis', 6.3, 31.2], ['oasis', 52, 42.2], ['oasis', 58.6, 47.2]],
  },
  marsh: {
    scatter: [['fenlily', 12, [18, 2, 60, 56]], ['glowcap', 12, [18, 2, 60, 56]], ['bogiron', 7, [18, 2, 60, 56]], ['glowcap', 3, [2, 22, 15, 16]]],
    fixed: [], // fen fishing spots are placed by the builder next to real water
  },
  caverns: {
    scatter: [['emberore', 10, [2, 2, 60, 48]], ['firecrystal', 8, [2, 2, 60, 48]], ['emberore', 2, [2, 35, 12, 10]]],
    fixed: [],
  },
};
