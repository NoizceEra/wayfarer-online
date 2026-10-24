import { EXTRA_AREAS, EXTRA_PORTALS, EXTRA_WAYSTONES, EXTRA_SIGNS } from "./areasExtra.js";
import { LAYOUT_SIGNS } from "./worldLayout.js";
// Expansion: enterable interiors + separate maps ("areas"). Re-exported by zones.js.
// Areas live in the SAME Phaser world but at far-apart origins (px, y≈0), so:
//  · co-op peers in a different space are simply never on screen (their world
//    coordinates are thousands of px away) — no extra sync messages needed;
//  · saved/minimap/zone code keeps working on plain coordinates.
// `layers` are tile rects [x,y,w,h] painted as TileSprites and reused by the
// minimap/world map. `solids` are blocked tile rects. Crypt walls are derived
// from its floor layers.
export const AREAS = {
  inn: {
    id: 'inn', kind: 'interior', name: 'The Sleepy Lantern Inn', safe: true, lv: [1, 1], music: 'village',
    desc: 'Warm beds, warmer stew. Innkeeper Hester will put you up for a few coins.',
    origin: { x: 3000, y: 0 }, size: { w: 18, h: 12 }, floor: 'tile.plank', wall: 'tile.wallwood', builder: 'inn',
    minimap: { floor: 0xa0703c, wall: 0x6b4426 },
  },
  cottage_a: {
    id: 'cottage_a', kind: 'interior', name: "Brom's Goods", safe: true, lv: [1, 1], music: 'village',
    desc: "Maren's brother Brom runs a little shop out of the front room.",
    origin: { x: 4200, y: 0 }, size: { w: 12, h: 9 }, floor: 'tile.plank', wall: 'tile.wallwood', builder: 'shop',
    minimap: { floor: 0xa0703c, wall: 0x6b4426 },
  },
  cottage_b: {
    id: 'cottage_b', kind: 'interior', name: "Granny Elda's Cottage", safe: true, lv: [1, 1], music: 'village',
    desc: 'Smells of herbs and woodsmoke. A cat naps somewhere.',
    origin: { x: 5400, y: 0 }, size: { w: 12, h: 9 }, floor: 'tile.plank', wall: 'tile.wallwood', builder: 'elda',
    minimap: { floor: 0xa0703c, wall: 0x6b4426 },
  },
  dock: {
    id: 'dock', kind: 'town', name: 'Coastal Dock Town', safe: true, lv: [2, 5], music: 'village_alt',
    desc: 'Harbour town: piers, boats, gulls. Crabs skitter on Driftwood Beach (Lv 2-5).',
    origin: { x: 6600, y: 0 }, size: { w: 56, h: 40 }, builder: 'dock',
    layers: [
      { tex: 'tile.water', color: 0x2e86c1, r: [0, 0, 56, 40] },
      { tex: 'tile.cobble', color: 0x8c9199, r: [0, 0, 38, 24] },
      { tex: 'tile.sand', color: 0xe3cf8f, r: [38, 0, 18, 28] },
      { tex: 'tile.sand', color: 0xe3cf8f, r: [0, 24, 38, 4] },
      { tex: 'tile.pier', color: 0x8d5a2b, r: [6, 28, 3, 10] },
      { tex: 'tile.pier', color: 0x8d5a2b, r: [18, 28, 3, 10] },
      { tex: 'tile.pier', color: 0x8d5a2b, r: [30, 28, 3, 10] },
    ],
    solids: [[0, 28, 6, 12], [9, 28, 9, 12], [21, 28, 9, 12], [33, 28, 23, 12], [6, 38, 3, 2], [18, 38, 3, 2], [30, 38, 3, 2]],
    zones: [{ id: 'dock_beach', name: 'Driftwood Beach', safe: false, lv: [2, 5], desc: 'Shore Crabs scuttle across the sand (Lv 2-5).', rect: [39, 2, 17, 24] }],
    spawn: [4.5, 12.5], exit: [1.5, 12.5], waystone: [19, 14],
    enemies: [['shorecrab', 9, 'dock_beach']],
    spawnRects: { dock_beach: [40, 3, 15, 22] },
  },
  crypt: {
    id: 'crypt', kind: 'dungeon', name: 'Crypt of Ashenmoor', safe: false, lv: [9, 13], music: 'crypt',
    desc: 'Torchlit catacombs. Bone Sentinels, Grave Bats, and something big below (Lv 9-13).',
    origin: { x: 8700, y: 0 }, size: { w: 44, h: 36 }, builder: 'crypt',
    layers: [
      { tex: 'tile.crypt', color: 0x55506a, r: [16, 28, 13, 7] },  // entry hall
      { tex: 'tile.crypt', color: 0x55506a, r: [21, 21, 3, 7] },   // stair corridor
      { tex: 'tile.crypt', color: 0x55506a, r: [11, 11, 23, 10] }, // great hall
      { tex: 'tile.crypt', color: 0x55506a, r: [2, 12, 8, 12] },   // west ossuary
      { tex: 'tile.crypt', color: 0x55506a, r: [9, 15, 3, 3] },
      { tex: 'tile.crypt', color: 0x55506a, r: [35, 12, 8, 12] },  // east ossuary
      { tex: 'tile.crypt', color: 0x55506a, r: [33, 15, 3, 3] },
      { tex: 'tile.crypt', color: 0x55506a, r: [21, 6, 3, 5] },    // warden's approach
      { tex: 'tile.crypt', color: 0x6a4a4a, r: [13, 1, 19, 5] },   // warden's chamber
    ],
    spawn: [22.5, 32.5], exit: [22.5, 34.3],
    enemies: [['bonesentinel', 4, 'w'], ['gravebat', 2, 'w'], ['bonesentinel', 4, 'e'], ['gravebat', 2, 'e'], ['bonesentinel', 5, 'hall'], ['gravebat', 3, 'hall'], ['gravemaw', 1, 'boss']],
    spawnRects: { w: [3, 13, 6, 10], e: [36, 13, 6, 10], hall: [12, 12, 21, 8], boss: [20, 2, 4, 3] },
  },
  frost: {
    id: 'frost', kind: 'outdoor', name: 'Frostpeak Pass', safe: false, lv: [11, 15], music: 'tension',
    desc: 'Wind-scoured snowfields under the peak. Frost Wisps and Rime Crawlers (Lv 11-15).',
    origin: { x: 10600, y: 0 }, size: { w: 56, h: 42 }, builder: 'frost',
    layers: [
      { tex: 'tile.snow', color: 0xeaf2f8, r: [0, 0, 56, 42] },
      { tex: 'tile.snowpack', color: 0xc3d3de, r: [1, 25, 17, 16] },
      { tex: 'tile.ice', color: 0x8fc5e6, r: [32, 8, 12, 9] },
    ],
    solids: [[32, 8, 12, 9]],
    zones: [{ id: 'frost_camp', name: 'Frostpeak Outpost', safe: true, lv: [1, 99], desc: 'A sheltered camp. Safe to rest.', rect: [1, 25, 17, 16] }],
    spawn: [4.5, 33.5], exit: [1.5, 33.5], waystone: [9, 31],
    enemies: [['frostwisp', 12, 'field'], ['rimecrawler', 10, 'field']],
    spawnRects: { field: [2, 2, 52, 21] },
  },
};

// Interiors entered from plaza houses (house = index in buildOverworld().houses)
export const DOORS = [
  { area: 'cottage_a', house: 0, label: "Brom's Goods" },
  { area: 'cottage_b', house: 1, label: "Elda's Cottage" },
  { area: 'inn', house: 2, label: 'Sleepy Lantern Inn' },
];

// Overworld gates into the big maps (tile coords on the 128x128 overworld)
export const PORTALS = [
  { id: 'p_dock', area: 'dock', tile: { x: 104, y: 98 }, label: 'Harbour Gate', color: 0x5ad1ff },
  { id: 'p_crypt', area: 'crypt', tile: { x: 40, y: 87 }, label: 'Crypt Stairs', color: 0xb37cff },
  { id: 'p_frost', area: 'frost', tile: { x: 18, y: 18 }, label: 'Frostpeak Pass', color: 0xdff6ff },
];

// Waystones (fast travel). `area: null` = overworld (offset from town spawn).
export const WAYSTONES = [
  { id: 'town', area: null, name: 'Thistle Town', offset: { x: 84, y: 58 } },
  { id: 'dock', area: 'dock', name: 'Coastal Dock Town' },
  { id: 'frost', area: 'frost', name: 'Frostpeak Outpost' },
];

// Signposts (overworld). dir: n/e/s/w arrow for each plank.
export const SIGNS = [
  { tx: 66, ty: 82, planks: [{ dir: 's', text: 'Tidehollow Ruins', lv: 'Lv 8-12' }, { dir: 'e', text: 'Harbour Gate - Dock Town', lv: 'Lv 2-5' }] },
  { tx: 83, ty: 62, planks: [{ dir: 'e', text: 'Mosswood', lv: 'Lv 4-8' }, { dir: 's', text: 'Harbour Gate - Dock Town', lv: 'Lv 2-5' }] },
  { tx: 46, ty: 52, planks: [{ dir: 'w', text: 'Frostpeak Pass', lv: 'Lv 11-15' }, { dir: 'n', text: 'Frostpeak Pass', lv: 'Lv 11-15' }] },
  { tx: 43, ty: 81, planks: [{ dir: 's', text: 'Crypt Stairs - Ashenmoor', lv: 'Lv 9-13' }, { dir: 'w', text: 'Tidehollow Ruins', lv: 'Lv 8-12' }] },
  { tx: 100, ty: 94, planks: [{ dir: 's', text: 'Harbour Gate', lv: 'Lv 2-5' }, { dir: 'w', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 22, ty: 22, planks: [{ dir: 'n', text: 'Frostpeak Pass', lv: 'Lv 11-15' }, { dir: 'e', text: 'Thistle Town', lv: 'safe' }] },
];

// Area side quests: auto-active while you stand in their area; first unfinished one is tracked.
// need: { enemy, count } or { use: interactableId }.
export const SIDE_QUESTS = [
  { id: 'sq_crabs', area: 'dock', name: 'Crab Cull', text: 'Thin out 6 Shore Crabs on Driftwood Beach for Dockmaster Orla.', need: { enemy: 'shorecrab', count: 6 }, reward: { xp: 180, gold: 90 } },
  { id: 'sq_net', area: 'dock', name: "Garrick's Net", text: "Find old Garrick's lost net in the north-east corner of Driftwood Beach.", need: { use: 'garrick_net' }, reward: { xp: 140, gold: 70 } },
  { id: 'sq_bones', area: 'crypt', name: 'Bones and Barrows', text: 'Put 8 Bone Sentinels back to rest in the Crypt.', need: { enemy: 'bonesentinel', count: 8 }, reward: { xp: 520, gold: 210 } },
  { id: 'sq_warden', area: 'crypt', name: 'Wake the Warden', text: 'Defeat Warden Gravemaw in the chamber at the top of the Crypt.', need: { enemy: 'gravemaw', count: 1 }, reward: { xp: 900, gold: 400 } },
  { id: 'sq_wisps', area: 'frost', name: 'Cold Snap', text: 'Douse 6 Frost Wisps circling the pass for Scout Ilka.', need: { enemy: 'frostwisp', count: 6 }, reward: { xp: 640, gold: 240 } },
  { id: 'sq_crawlers', area: 'frost', name: 'Rime Rot', text: 'Clear 5 Rime Crawlers out of the snowfield.', need: { enemy: 'rimecrawler', count: 5 }, reward: { xp: 780, gold: 300 } },
];

// ─── World expansion (additive): Sunscorch Desert, Whisperfen Marsh, Emberdeep Caverns, Hollow Depths ───
// Defined in data/areasExtra.js; built by world/areaBuildersExtra.js + world/dungeons.js.
Object.assign(AREAS, EXTRA_AREAS);
PORTALS.push(...EXTRA_PORTALS);
WAYSTONES.push(...EXTRA_WAYSTONES);
SIGNS.push(...EXTRA_SIGNS);
SIGNS.push(...LAYOUT_SIGNS);
