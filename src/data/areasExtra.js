// World-expansion maps, merged additively into data/areas.js (AREAS / PORTALS / WAYSTONES /
// SIGNS). Each procedural map builds its ground, collision, props, NPCs and mobs from a
// seeded grid (world/areaGen.js) in world/areaBuildersExtra.js; `layers` here are coarse
// minimap blocks derived from the very same grid.
//   · Sunscorch Desert   Lv 13-17  dunes, two oases, mesas, Temple of the Sunken Sun
//   · Whisperfen Marsh   Lv 10-14  mist, boardwalks, will-o-wisps, toads, Gloomtoad island
//   · Emberdeep Caverns  Lv 15-19  lava, crystals, tight corridors lit by torches
//   · Hollow Depths      Lv 12-20  seeded roguelike dungeon (world/dungeons.js)
import { genDesert, genMarsh, genCavern, minimapLayers, DS, MS, CV, DESERT, MARSH, CAVERN, HOLLOW } from '../world/areaGen.js';

const DCOL = { [DS.SAND]: 0xe3cf8f, [DS.DUNE]: 0xd2b574, [DS.CLIFF]: 0xa8744a, [DS.WATER]: 0x2e86c1, [DS.PAVED]: 0xc8b088, [DS.PATH]: 0xf0dda0, [DS.GRASS]: 0x5fa04a, [DS.WALL]: 0x7a5a3a };
const MCOL = { [MS.MUD]: 0x5a6b3a, [MS.GRASS]: 0x6f9a4a, [MS.SHALLOW]: 0x3f7f7a, [MS.DEEP]: 0x1f4a52, [MS.BOARD]: 0x9a7040, [MS.REED]: 0x8aa04a, [MS.PEAT]: 0x3a3a2a };
const CCOL = { [CV.FLOOR]: 0x6a5048, [CV.HUB]: 0x8a6a50, [CV.LAVA]: 0xff6a2a, [CV.BRIDGE]: 0x4a3a50 };

const desertGrid = genDesert();
const marshGrid = genMarsh();
const cavern = genCavern();

export const EXTRA_AREAS = {
  desert: {
    id: 'desert', kind: 'outdoor', name: 'Sunscorch Desert', safe: false, lv: [13, 17], music: 'desert', builder: 'desert', bossWatch: true,
    desc: 'Rolling dunes, a spring-fed oasis and a buried temple. Sandstorms roll in without warning (Lv 13-17).',
    origin: { x: 13200, y: 0 }, size: { w: DESERT.W, h: DESERT.H },
    layers: [{ tex: 'tile.sand', color: 0xe3cf8f, r: [0, 0, DESERT.W, DESERT.H] }, ...minimapLayers(desertGrid, (c) => (c === DS.SAND ? null : DCOL[c]), 4)],
    zones: [
      { id: 'desert_camp', name: 'Mirage Oasis Camp', safe: true, lv: [1, 99], desc: 'A palm-shaded camp. Safe to rest.', rect: [DESERT.hub.x, DESERT.hub.y, DESERT.hub.w, DESERT.hub.h] },
      { id: 'desert_temple', name: 'Temple of the Sunken Sun', safe: false, lv: [16, 17], desc: 'Khet, the Sun Colossus, sleeps under the dais (Lv 16-17).', rect: [DESERT.temple.x, DESERT.temple.y, DESERT.temple.w, DESERT.temple.h] },
    ],
    spawn: DESERT.spawn, exit: DESERT.exit, waystone: DESERT.waystone,
    mobs: [['dscarab', 10, 'any'], ['dscorpion', 8, 'any'], ['dcobra', 7, 'any'], ['dcactus', 8, 'any'], ['djackal', 8, 'any'], ['dwraith', 6, 'any'], ['dguardian', 5, 'temple'], ['dwraith', 3, 'temple'], ['khet', 1, 'boss']],
    weather: 'desert',
  },
  marsh: {
    id: 'marsh', kind: 'outdoor', name: 'Whisperfen Marsh', safe: false, lv: [10, 14], music: 'marsh', builder: 'marsh', bossWatch: true,
    desc: 'Mist, boardwalks and will-o-wisps. Toads croak in the reeds; something older waits on the far island (Lv 10-14).',
    origin: { x: 15200, y: 0 }, size: { w: MARSH.W, h: MARSH.H },
    layers: [{ tex: 'tile.water', color: 0x3f7f7a, r: [0, 0, MARSH.W, MARSH.H] }, ...minimapLayers(marshGrid, (c) => (c === MS.SHALLOW ? null : MCOL[c]), 4)],
    zones: [
      { id: 'marsh_camp', name: 'Fenwatch Stilts', safe: true, lv: [1, 99], desc: 'A village on stilts above the mist. Safe to rest.', rect: [MARSH.hub.x, MARSH.hub.y, MARSH.hub.w, MARSH.hub.h] },
      { id: 'marsh_isle', name: 'Gloomtoad Isle', safe: false, lv: [13, 14], desc: 'A sunken island where the Old Gloomtoad broods (Lv 13-14).', rect: [MARSH.bossIsland.cx - 8, MARSH.bossIsland.cy - 7, 16, 14] },
    ],
    spawn: MARSH.spawn, exit: MARSH.exit, waystone: MARSH.waystone,
    mobs: [['mtoad', 10, 'any'], ['mwisp', 8, 'any'], ['mleech', 8, 'any'], ['mserpent', 6, 'any'], ['mspore', 8, 'any'], ['mstalker', 6, 'any'], ['bogleech', 6, 'any'], ['mirelurker', 4, 'any'], ['mkappa', 5, 'any'], ['mkappa', 3, 'isle'], ['mwisp', 3, 'isle'], ['gloomtoad', 1, 'boss']],
    weather: 'marsh',
  },
  caverns: {
    id: 'caverns', kind: 'dungeon', name: 'Emberdeep Caverns', safe: false, lv: [15, 19], music: 'caverns', builder: 'caverns', dark: 0.9, bossWatch: true,
    desc: 'Lava-lit tunnels beneath the world. Crystals hum, tunnels narrow, and the Forgelord waits below (Lv 15-19).',
    origin: { x: 17200, y: 0 }, size: { w: CAVERN.W, h: CAVERN.H },
    layers: minimapLayers(cavern.grid, (c) => (c === CV.ROCK ? null : CCOL[c]), 2),
    zones: [{ id: 'caverns_camp', name: 'Emberdeep Outpost', safe: true, lv: [1, 99], desc: 'A miners\' camp in a cooled chamber. Safe to rest.', rect: [CAVERN.hub.x, CAVERN.hub.y, CAVERN.hub.w, CAVERN.hub.h] }],
    spawn: CAVERN.spawn, exit: CAVERN.exit, waystone: CAVERN.waystone,
    mobs: [['cslime', 8, 'any'], ['cbat', 8, 'any'], ['cimp', 6, 'any'], ['cgolem', 4, 'any'], ['csalamander', 6, 'any'], ['ccyclops', 4, 'any'], ['forgelord', 1, 'boss']],
  },
  hollow: {
    id: 'hollow', kind: 'dungeon', name: 'Hollow Depths', safe: false, lv: [12, 20], music: 'hollow', builder: 'hollow', dark: 0.92, bossWatch: true, procedural: true,
    desc: 'A dungeon that rearranges itself every descent: 3-5 floors, traps, a warden and the Hollow King (Lv 12-20).',
    origin: { x: 19200, y: 0 }, size: { w: HOLLOW.W, h: HOLLOW.H },
    layers: [{ tex: 'tile.crypt', color: 0x4a3f66, r: [14, 10, 28, 24] }],
    spawn: [HOLLOW.W / 2, HOLLOW.H / 2], exit: [HOLLOW.W / 2, HOLLOW.H / 2],
  },
};

export const EXTRA_PORTALS = [
  { id: 'p_desert', area: 'desert', tile: { x: 112, y: 80 }, label: 'Sunscorch Gate', color: 0xffc85a },
  { id: 'p_marsh', area: 'marsh', tile: { x: 74, y: 110 }, label: 'Whisperfen Path', color: 0x7fe0a0 },
  { id: 'p_caverns', area: 'caverns', tile: { x: 11, y: 52 }, label: 'Emberdeep Descent', color: 0xff7a3a },
  { id: 'p_hollow', area: 'hollow', tile: { x: 64, y: 21 }, label: 'Hollow Depths', color: 0xb080ff },
];

export const EXTRA_WAYSTONES = [
  { id: 'desert', area: 'desert', name: 'Mirage Oasis Camp' },
  { id: 'marsh', area: 'marsh', name: 'Fenwatch Stilts' },
  { id: 'caverns', area: 'caverns', name: 'Emberdeep Outpost' },
];

export const EXTRA_SIGNS = [
  { tx: 100, ty: 82, planks: [{ dir: 'e', text: 'Sunscorch Gate - Desert', lv: 'Lv 13-17' }, { dir: 'w', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 76, ty: 106, planks: [{ dir: 's', text: 'Whisperfen Path - Marsh', lv: 'Lv 10-14' }, { dir: 'n', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 14, ty: 54, planks: [{ dir: 'w', text: 'Emberdeep Descent', lv: 'Lv 15-19' }, { dir: 'e', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 66, ty: 25, planks: [{ dir: 'n', text: 'Hollow Depths', lv: 'Lv 12-20' }, { dir: 's', text: 'Thistle Town', lv: 'safe' }] },
  { tx: 30, ty: 40, planks: [{ dir: 'w', text: 'Emberdeep Descent', lv: 'Lv 15-19' }, { dir: 'e', text: 'Thistle Town', lv: 'safe' }] },
];

// Exposed for tests / builders
export const GENS = { desertGrid, marshGrid, cavern };
