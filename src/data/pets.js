// PET / MONSTER data layer for Wayfarer Online
// Purely additive. Sprites are reused from src/assets/catalog.js MONSTER_FILES.

// ── types ───────────────────────────────────────────────────────────────────
export const TYPES = ['fire','water','nature','earth','wind','dark'];

// 6-way rock-paper-scissors:
// fire > nature > earth > water > fire  (1.5x / 0.67x)
// wind > earth > dark > wind            (1.5x / 0.67x)
// dark > fire > water > dark            (1.5x / 0.67x)
export const TYPE_CHART = {
  fire:   { nature: 1.5, earth: 0.67, water: 0.67, dark: 1.5 },
  water:  { fire: 1.5, earth: 1.5, dark: 0.67 },
  nature: { earth: 1.5, water: 1.5, fire: 0.67 },
  earth:  { water: 0.67, nature: 0.67, fire: 1.5, wind: 1.5 },
  wind:   { earth: 1.5, dark: 1.5, nature: 0.67 },
  dark:   { wind: 0.67, fire: 1.5, water: 1.5 },
};

export function typeMultiplier(atkType, defType) {
  return TYPE_CHART[atkType]?.[defType] ?? 1.0;
}

// ── moves ───────────────────────────────────────────────────────────────────
// Expanded move matrix: every type gets early/mid/late STAB, coverage, buffs,
// debuffs, heals, multi-hit, accuracy play, and high-risk high-reward attacks.
export const MOVES = {
  // ── neutral / early ──
  tackle:      { id: 'tackle',      name: 'Tackle',       type: 'nature', power: 35, accuracy: 1.0,  category: 'physical' },
  fury_swipes: { id: 'fury_swipes', name: 'Fury Swipes',  type: 'nature', power: 20, accuracy: 0.9,  category: 'physical', effect: { multiHit: { min: 2, max: 5 } } },
  pin_missile: { id: 'pin_missile', name: 'Pin Missile',  type: 'nature', power: 25, accuracy: 0.9,  category: 'physical', effect: { multiHit: { min: 2, max: 5 } } },

  // ── fire ──
  ember:       { id: 'ember',       name: 'Ember',        type: 'fire',   power: 40, accuracy: 1.0,  category: 'special' },
  flare_dash:  { id: 'flare_dash',  name: 'Flare Dash',   type: 'fire',   power: 55, accuracy: 0.95, category: 'physical', effect: { self: 'buff', stat: 'spd', amt: 1.1, turns: 3 } },
  fire_fang:   { id: 'fire_fang',   name: 'Fire Fang',    type: 'fire',   power: 65, accuracy: 0.95, category: 'physical' },
  smokescreen: { id: 'smokescreen', name: 'Smokescreen',  type: 'fire',   power: 0,  accuracy: 1.0,  category: 'status',   effect: { foe: 'debuff', stat: 'spd', amt: 0.85, turns: 3 } },
  will_o_wisp: { id: 'will_o_wisp', name: 'Will-O-Wisp',  type: 'fire',   power: 0,  accuracy: 0.85, category: 'status',   effect: { foe: 'debuff', stat: 'atk', amt: 0.7,  turns: 3 } },
  fireball:    { id: 'fireball',    name: 'Fireball',     type: 'fire',   power: 70, accuracy: 1.0,  category: 'special' },
  heat_wave:   { id: 'heat_wave',   name: 'Heat Wave',    type: 'fire',   power: 95, accuracy: 0.9,  category: 'special' },
  inferno:     { id: 'inferno',     name: 'Inferno',      type: 'fire',   power: 100, accuracy: 0.85, category: 'special' },
  overheat:    { id: 'overheat',    name: 'Overheat',     type: 'fire',   power: 130, accuracy: 0.8,  category: 'special', effect: { self: 'debuff', stat: 'atk', amt: 0.8, turns: 2 } },

  // ── water ──
  water_jet:   { id: 'water_jet',   name: 'Water Jet',    type: 'water',  power: 40, accuracy: 1.0,  category: 'special' },
  bubble_beam: { id: 'bubble_beam', name: 'Bubble Beam',  type: 'water',  power: 65, accuracy: 1.0,  category: 'special', effect: { foe: 'debuff', stat: 'spd', amt: 0.9, turns: 2 } },
  whirlpool:   { id: 'whirlpool',   name: 'Whirlpool',    type: 'water',  power: 60, accuracy: 0.9,  category: 'special', effect: { foe: 'debuff', stat: 'spd', amt: 0.9, turns: 2 } },
  aqua_tail:   { id: 'aqua_tail',   name: 'Aqua Tail',    type: 'water',  power: 80, accuracy: 0.9,  category: 'physical' },
  torrent:     { id: 'torrent',     name: 'Torrent',      type: 'water',  power: 100, accuracy: 0.85, category: 'special' },
  hydro_pump:  { id: 'hydro_pump',  name: 'Hydro Pump',   type: 'water',  power: 120, accuracy: 0.8,  category: 'special' },
  heal_mist:   { id: 'heal_mist',   name: 'Heal Mist',    type: 'water',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'heal', pct: 0.25 } },
  withdraw:    { id: 'withdraw',    name: 'Withdraw',     type: 'water',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'def', amt: 1.3, turns: 3 } },
  safeguard:   { id: 'safeguard',   name: 'Safeguard',    type: 'water',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'def', amt: 1.2, turns: 5 } },
  rain_dance:  { id: 'rain_dance',  name: 'Rain Dance',   type: 'water',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'spd', amt: 1.2, turns: 3 } },

  // ── nature ──
  vine_lash:   { id: 'vine_lash',   name: 'Vine Lash',    type: 'nature', power: 45, accuracy: 0.95, category: 'physical' },
  razor_leaf:  { id: 'razor_leaf',  name: 'Razor Leaf',   type: 'nature', power: 60, accuracy: 0.95, category: 'physical' },
  root_bind:   { id: 'root_bind',   name: 'Root Bind',    type: 'nature', power: 55, accuracy: 0.95, category: 'physical', effect: { foe: 'debuff', stat: 'spd', amt: 0.85, turns: 3 } },
  sharpen:     { id: 'sharpen',     name: 'Sharpen',      type: 'nature', power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'atk', amt: 1.2, turns: 3 } },
  spore:       { id: 'spore',       name: 'Spore',        type: 'nature', power: 0,  accuracy: 0.9,  category: 'status',   effect: { foe: 'debuff', stat: 'spd', amt: 0.7,  turns: 2 } },
  pollen:      { id: 'pollen',      name: 'Pollen',       type: 'nature', power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'heal',  pct: 0.35 } },
  synthesis:   { id: 'synthesis',   name: 'Synthesis',    type: 'nature', power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'heal',  pct: 0.5 } },
  leaf_storm:  { id: 'leaf_storm',  name: 'Leaf Storm',   type: 'nature', power: 130, accuracy: 0.8,  category: 'special' },
  solar_beam:  { id: 'solar_beam',  name: 'Solar Beam',   type: 'nature', power: 120, accuracy: 0.85, category: 'special' },

  // ── earth ──
  pebble_toss: { id: 'pebble_toss', name: 'Pebble Toss',  type: 'earth',  power: 40, accuracy: 0.95, category: 'physical' },
  mud_slap:    { id: 'mud_slap',    name: 'Mud Slap',     type: 'earth',  power: 30, accuracy: 0.9,  category: 'physical', effect: { foe: 'debuff', stat: 'spd', amt: 0.9, turns: 3 } },
  sand_attack: { id: 'sand_attack', name: 'Sand Attack',  type: 'earth',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { foe: 'debuff', stat: 'spd', amt: 0.85, turns: 3 } },
  harden:      { id: 'harden',      name: 'Harden',       type: 'earth',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'def', amt: 1.3, turns: 3 } },
  double_kick: { id: 'double_kick', name: 'Double Kick',  type: 'earth',  power: 35, accuracy: 1.0,  category: 'physical', effect: { multiHit: { min: 2, max: 2 } } },
  rock_slide:  { id: 'rock_slide',  name: 'Rock Slide',   type: 'earth',  power: 90, accuracy: 0.9,  category: 'physical' },
  earthquake:  { id: 'earthquake',  name: 'Earthquake',   type: 'earth',  power: 110, accuracy: 0.85, category: 'physical' },
  iron_shield: { id: 'iron_shield', name: 'Iron Shield',  type: 'earth',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'def', amt: 1.5, turns: 3 } },
  sandstorm:   { id: 'sandstorm',   name: 'Sandstorm',    type: 'earth',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { foe: 'debuff', stat: 'spd', amt: 0.9, turns: 3 } },

  // ── wind ──
  gust:        { id: 'gust',        name: 'Gust',         type: 'wind',   power: 40, accuracy: 1.0,  category: 'special' },
  air_slash:   { id: 'air_slash',   name: 'Air Slash',    type: 'wind',   power: 65, accuracy: 0.95, category: 'special' },
  razor_wind:  { id: 'razor_wind',  name: 'Razor Wind',   type: 'wind',   power: 80, accuracy: 0.9,  category: 'special' },
  whirlwind:   { id: 'whirlwind',   name: 'Whirlwind',    type: 'wind',   power: 60, accuracy: 1.0,  category: 'special', effect: { foe: 'debuff', stat: 'def', amt: 0.9, turns: 2 } },
  tailwind:    { id: 'tailwind',    name: 'Tailwind',     type: 'wind',   power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'spd', amt: 1.3, turns: 4 } },
  agility:     { id: 'agility',     name: 'Agility',      type: 'wind',   power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff',  stat: 'spd', amt: 1.5, turns: 2 } },
  cyclone:     { id: 'cyclone',     name: 'Cyclone',      type: 'wind',   power: 100, accuracy: 0.85, category: 'special' },
  hurricane:   { id: 'hurricane',   name: 'Hurricane',    type: 'wind',   power: 120, accuracy: 0.8,  category: 'special' },

  // ── dark ──
  bite:        { id: 'bite',        name: 'Bite',         type: 'dark',   power: 60, accuracy: 1.0,  category: 'physical' },
  shadow_bite: { id: 'shadow_bite', name: 'Shadow Bite',  type: 'dark',   power: 50, accuracy: 0.95, category: 'physical' },
  intimidate:  { id: 'intimidate',  name: 'Intimidate',   type: 'dark',   power: 0,  accuracy: 1.0,  category: 'status',   effect: { foe: 'debuff', stat: 'atk', amt: 0.8, turns: 3 } },
  roar:        { id: 'roar',        name: 'Roar',         type: 'dark',   power: 0,  accuracy: 1.0,  category: 'status',   effect: { foe: 'debuff', stat: 'atk', amt: 0.85, turns: 2 } },
  night_slash: { id: 'night_slash', name: 'Night Slash',  type: 'dark',   power: 80, accuracy: 0.95, category: 'physical' },
  void_gaze:   { id: 'void_gaze',   name: 'Void Gaze',    type: 'dark',   power: 70, accuracy: 0.9,  category: 'special', effect: { foe: 'debuff', stat: 'def', amt: 0.9, turns: 2 } },
  dark_pulse:  { id: 'dark_pulse',  name: 'Dark Pulse',   type: 'dark',   power: 90, accuracy: 1.0,  category: 'special' },
  shadow_ball: { id: 'shadow_ball', name: 'Shadow Ball',  type: 'dark',   power: 90, accuracy: 1.0,  category: 'special', effect: { foe: 'debuff', stat: 'def', amt: 0.9, turns: 2 } },
  eclipse:     { id: 'eclipse',     name: 'Eclipse',      type: 'dark',   power: 110, accuracy: 0.85, category: 'special' },
  drain_life:  { id: 'drain_life',  name: 'Drain Life',   type: 'dark',   power: 60, accuracy: 1.0,  category: 'special', effect: { drain: 0.5 } },
};

// ── pets ────────────────────────────────────────────────────────────────────
// 3 starter lines x 3 evolutions each, using only validated 64x64 MONSTER_FILES.
export const PETS = {
  // Fire starter: Emberling -> Ashfox -> Infernowarg
  emberling: {
    id: 'emberling', name: 'Emberling', sprite: 'mon.Mouse', type: 'fire',
    baseStats: { hp: 38, atk: 10, def: 6, spd: 9 },
    growth:    { hp: 7.0, atk: 2.2, def: 1.3, spd: 1.9 },
    tint: 0xff8866,
    learnset: [
      { lv: 1, moveId: 'tackle' },      { lv: 1, moveId: 'ember' },
      { lv: 3, moveId: 'bite' },        { lv: 5, moveId: 'smokescreen' },
      { lv: 8, moveId: 'flare_dash' },  { lv: 12, moveId: 'sharpen' },
      { lv: 16, moveId: 'fireball' },   { lv: 20, moveId: 'heat_wave' },
    ],
    evolutions: [{ at: 16, to: 'ashfox', condition: 'level' }],
  },
  ashfox: {
    id: 'ashfox', name: 'Ashfox', sprite: 'mon.Racoon', type: 'fire',
    baseStats: { hp: 58, atk: 16, def: 10, spd: 14 },
    growth:    { hp: 9.5, atk: 3.0, def: 1.8, spd: 2.6 },
    tint: 0xff7040,
    learnset: [
      { lv: 1, moveId: 'ember' },       { lv: 1, moveId: 'bite' },
      { lv: 1, moveId: 'flare_dash' },  { lv: 1, moveId: 'smokescreen' },
      { lv: 18, moveId: 'shadow_bite' },{ lv: 22, moveId: 'sharpen' },
      { lv: 26, moveId: 'intimidate' }, { lv: 30, moveId: 'fire_fang' },
      { lv: 34, moveId: 'night_slash' },{ lv: 38, moveId: 'inferno' },
    ],
    evolutions: [{ at: 36, to: 'infernowarg', condition: 'level' }],
  },
  infernowarg: {
    id: 'infernowarg', name: 'Infernowarg', sprite: 'mon.Beast2', type: 'fire',
    baseStats: { hp: 88, atk: 26, def: 16, spd: 21 },
    growth:    { hp: 12.0, atk: 4.0, def: 2.6, spd: 3.4 },
    tint: 0xff4422,
    learnset: [
      { lv: 1, moveId: 'ember' },       { lv: 1, moveId: 'flare_dash' },
      { lv: 1, moveId: 'intimidate' },  { lv: 1, moveId: 'fireball' },
      { lv: 38, moveId: 'void_gaze' },  { lv: 44, moveId: 'eclipse' },
      { lv: 50, moveId: 'overheat' },   { lv: 58, moveId: 'inferno' },
    ],
    evolutions: [],
  },

  // Water starter: Dewdrop -> Pondshell -> Leviarmor
  dewdrop: {
    id: 'dewdrop', name: 'Dewdrop', sprite: 'mon.Axolot', type: 'water',
    baseStats: { hp: 44, atk: 7, def: 8, spd: 7 },
    growth:    { hp: 8.2, atk: 1.6, def: 1.8, spd: 1.4 },
    tint: 0x66ccff,
    learnset: [
      { lv: 1, moveId: 'tackle' },      { lv: 1, moveId: 'water_jet' },
      { lv: 3, moveId: 'withdraw' },    { lv: 5, moveId: 'bubble_beam' },
      { lv: 8, moveId: 'mud_slap' },    { lv: 12, moveId: 'heal_mist' },
      { lv: 16, moveId: 'aqua_tail' },  { lv: 20, moveId: 'safeguard' },
    ],
    evolutions: [{ at: 16, to: 'pondshell', condition: 'level' }],
  },
  pondshell: {
    id: 'pondshell', name: 'Pondshell', sprite: 'mon.Mollusc', type: 'water',
    baseStats: { hp: 68, atk: 12, def: 16, spd: 10 },
    growth:    { hp: 11.0, atk: 2.4, def: 3.0, spd: 1.8 },
    tint: 0x44aadd,
    learnset: [
      { lv: 1, moveId: 'water_jet' },   { lv: 1, moveId: 'withdraw' },
      { lv: 1, moveId: 'bubble_beam' }, { lv: 1, moveId: 'mud_slap' },
      { lv: 18, moveId: 'pebble_toss' },{ lv: 22, moveId: 'heal_mist' },
      { lv: 26, moveId: 'safeguard' },  { lv: 30, moveId: 'whirlpool' },
      { lv: 34, moveId: 'rock_slide' }, { lv: 38, moveId: 'hydro_pump' },
    ],
    evolutions: [{ at: 36, to: 'leviarmor', condition: 'level' }],
  },
  leviarmor: {
    id: 'leviarmor', name: 'Leviarmor', sprite: 'mon.Mollusc2', type: 'water',
    baseStats: { hp: 100, atk: 18, def: 26, spd: 14 },
    growth:    { hp: 14.0, atk: 3.2, def: 4.5, spd: 2.4 },
    tint: 0x2288cc,
    learnset: [
      { lv: 1, moveId: 'water_jet' },   { lv: 1, moveId: 'withdraw' },
      { lv: 1, moveId: 'bubble_beam' }, { lv: 1, moveId: 'mud_slap' },
      { lv: 38, moveId: 'torrent' },    { lv: 44, moveId: 'earthquake' },
      { lv: 50, moveId: 'safeguard' },  { lv: 56, moveId: 'hydro_pump' },
    ],
    evolutions: [],
  },

  // Nature starter: Sprig -> Mossback -> Treantusk
  sprig: {
    id: 'sprig', name: 'Sprig', sprite: 'mon.Bamboo', type: 'nature',
    baseStats: { hp: 42, atk: 8, def: 7, spd: 8 },
    growth:    { hp: 7.8, atk: 1.9, def: 1.5, spd: 1.8 },
    tint: 0x88dd66,
    learnset: [
      { lv: 1, moveId: 'tackle' },      { lv: 1, moveId: 'vine_lash' },
      { lv: 3, moveId: 'sand_attack' }, { lv: 5, moveId: 'razor_leaf' },
      { lv: 8, moveId: 'sharpen' },     { lv: 12, moveId: 'pebble_toss' },
      { lv: 16, moveId: 'root_bind' },  { lv: 20, moveId: 'synthesis' },
    ],
    evolutions: [{ at: 16, to: 'mossback', condition: 'level' }],
  },
  mossback: {
    id: 'mossback', name: 'Mossback', sprite: 'mon.BambooYellow', type: 'nature',
    baseStats: { hp: 64, atk: 14, def: 14, spd: 11 },
    growth:    { hp: 10.5, atk: 2.8, def: 2.8, spd: 2.0 },
    tint: 0x66bb44,
    learnset: [
      { lv: 1, moveId: 'vine_lash' },   { lv: 1, moveId: 'sharpen' },
      { lv: 1, moveId: 'sand_attack' }, { lv: 1, moveId: 'razor_leaf' },
      { lv: 18, moveId: 'pebble_toss' },{ lv: 22, moveId: 'root_bind' },
      { lv: 26, moveId: 'synthesis' },  { lv: 30, moveId: 'rock_slide' },
      { lv: 34, moveId: 'leaf_storm' }, { lv: 38, moveId: 'harden' },
    ],
    evolutions: [{ at: 36, to: 'treantusk', condition: 'level' }],
  },
  treantusk: {
    id: 'treantusk', name: 'Treantusk', sprite: 'mon.Panda', type: 'nature',
    baseStats: { hp: 96, atk: 22, def: 22, spd: 14 },
    growth:    { hp: 13.5, atk: 3.6, def: 3.6, spd: 2.6 },
    tint: 0x44aa22,
    learnset: [
      { lv: 1, moveId: 'vine_lash' },   { lv: 1, moveId: 'sharpen' },
      { lv: 1, moveId: 'pebble_toss' }, { lv: 1, moveId: 'root_bind' },
      { lv: 38, moveId: 'earthquake' }, { lv: 44, moveId: 'leaf_storm' },
      { lv: 50, moveId: 'solar_beam' }, { lv: 56, moveId: 'iron_shield' },
    ],
    evolutions: [],
  },
};

// ── helpers ─────────────────────────────────────────────────────────────────
export function baseFor(id) { return PETS[id] || null; }

export function statsAt(pet, level) {
  const b = typeof pet === 'string' ? PETS[pet] : pet;
  if (!b) return null;
  const lv = Math.max(1, Math.floor(level));
  const s = {};
  for (const k of ['hp','atk','def','spd']) {
    s[k] = Math.round(b.baseStats[k] + b.growth[k] * (lv - 1));
  }
  return s;
}

export function movesFor(pet, level) {
  const b = typeof pet === 'string' ? PETS[pet] : pet;
  if (!b) return [];
  const lv = Math.max(1, Math.floor(level));
  return b.learnset.filter((e) => e.lv <= lv).map((e) => MOVES[e.moveId]).filter(Boolean);
}

export function canEvolve(petInstance) {
  const b = PETS[petInstance.id];
  if (!b || !b.evolutions.length) return false;
  return b.evolutions.some((e) => e.condition === 'level' && petInstance.level >= e.at);
}

export function evolve(petInstance) {
  const b = PETS[petInstance.id];
  if (!b) return null;
  const evo = b.evolutions.find((e) => e.condition === 'level' && petInstance.level >= e.at);
  if (!evo) return null;
  return { ...petInstance, id: evo.to, level: petInstance.level };
}

// Build a fresh starter instance for the hero's roster.
export function makePet(id, level = 5) {
  const b = PETS[id];
  if (!b) return null;
  return {
    id, level,
    xp: 0,
    stats: statsAt(b, level),
    moves: movesFor(b, level).slice(0, 4).map((m) => m.id),
    hp: statsAt(b, level).hp,
  };
}
