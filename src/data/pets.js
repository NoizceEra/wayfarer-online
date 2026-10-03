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
export const MOVES = {
  tackle:     { id: 'tackle',     name: 'Tackle',     type: 'nature', power: 35, accuracy: 1.0,  category: 'physical' },
  ember:      { id: 'ember',      name: 'Ember',      type: 'fire',   power: 40, accuracy: 1.0,  category: 'special' },
  water_jet:  { id: 'water_jet',  name: 'Water Jet',  type: 'water',  power: 40, accuracy: 1.0,  category: 'special' },
  vine_lash:  { id: 'vine_lash',  name: 'Vine Lash',  type: 'nature', power: 45, accuracy: 0.95, category: 'physical' },
  pebble_toss:{ id: 'pebble_toss',name: 'Pebble Toss',type: 'earth',  power: 40, accuracy: 0.95, category: 'physical' },
  gust:       { id: 'gust',       name: 'Gust',       type: 'wind',   power: 40, accuracy: 1.0,  category: 'special' },
  shadow_bite:{ id: 'shadow_bite',name: 'Shadow Bite',type: 'dark',   power: 50, accuracy: 0.95, category: 'physical' },
  flare_dash: { id: 'flare_dash', name: 'Flare Dash', type: 'fire',   power: 55, accuracy: 0.95, category: 'physical', effect: { self: 'buff', stat: 'spd', amt: 1.1, turns: 3 } },
  mud_slap:   { id: 'mud_slap',   name: 'Mud Slap',   type: 'earth',  power: 30, accuracy: 0.9,  category: 'physical', effect: { foe: 'debuff', stat: 'spd', amt: 0.9, turns: 3 } },
  heal_mist:  { id: 'heal_mist',  name: 'Heal Mist',  type: 'water',  power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'heal', pct: 0.25 } },
  sharpen:    { id: 'sharpen',    name: 'Sharpen',    type: 'nature', power: 0,  accuracy: 1.0,  category: 'status',   effect: { self: 'buff', stat: 'atk', amt: 1.2, turns: 3 } },
  void_gaze:  { id: 'void_gaze',  name: 'Void Gaze',  type: 'dark',   power: 70, accuracy: 0.9,  category: 'special',  effect: { foe: 'debuff', stat: 'def', amt: 0.9, turns: 2 } },
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
      { lv: 1, moveId: 'tackle' }, { lv: 4, moveId: 'ember' },
      { lv: 8, moveId: 'flare_dash' }, { lv: 14, moveId: 'sharpen' },
      { lv: 22, moveId: 'void_gaze' },
    ],
    evolutions: [{ at: 16, to: 'ashfox', condition: 'level' }],
  },
  ashfox: {
    id: 'ashfox', name: 'Ashfox', sprite: 'mon.Racoon', type: 'fire',
    baseStats: { hp: 58, atk: 16, def: 10, spd: 14 },
    growth:    { hp: 9.5, atk: 3.0, def: 1.8, spd: 2.6 },
    tint: 0xff7040,
    learnset: [
      { lv: 1, moveId: 'ember' }, { lv: 18, moveId: 'shadow_bite' },
      { lv: 26, moveId: 'flare_dash' }, { lv: 34, moveId: 'sharpen' },
    ],
    evolutions: [{ at: 36, to: 'infernowarg', condition: 'level' }],
  },
  infernowarg: {
    id: 'infernowarg', name: 'Infernowarg', sprite: 'mon.Beast2', type: 'fire',
    baseStats: { hp: 88, atk: 26, def: 16, spd: 21 },
    growth:    { hp: 12.0, atk: 4.0, def: 2.6, spd: 3.4 },
    tint: 0xff4422,
    learnset: [
      { lv: 1, moveId: 'ember' }, { lv: 38, moveId: 'void_gaze' },
      { lv: 46, moveId: 'flare_dash' }, { lv: 54, moveId: 'shadow_bite' },
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
      { lv: 1, moveId: 'tackle' }, { lv: 4, moveId: 'water_jet' },
      { lv: 9, moveId: 'heal_mist' }, { lv: 15, moveId: 'mud_slap' },
      { lv: 24, moveId: 'gust' },
    ],
    evolutions: [{ at: 16, to: 'pondshell', condition: 'level' }],
  },
  pondshell: {
    id: 'pondshell', name: 'Pondshell', sprite: 'mon.Mollusc', type: 'water',
    baseStats: { hp: 68, atk: 12, def: 16, spd: 10 },
    growth:    { hp: 11.0, atk: 2.4, def: 3.0, spd: 1.8 },
    tint: 0x44aadd,
    learnset: [
      { lv: 1, moveId: 'water_jet' }, { lv: 20, moveId: 'heal_mist' },
      { lv: 28, moveId: 'pebble_toss' }, { lv: 36, moveId: 'mud_slap' },
    ],
    evolutions: [{ at: 36, to: 'leviarmor', condition: 'level' }],
  },
  leviarmor: {
    id: 'leviarmor', name: 'Leviarmor', sprite: 'mon.Mollusc2', type: 'water',
    baseStats: { hp: 100, atk: 18, def: 26, spd: 14 },
    growth:    { hp: 14.0, atk: 3.2, def: 4.5, spd: 2.4 },
    tint: 0x2288cc,
    learnset: [
      { lv: 1, moveId: 'water_jet' }, { lv: 40, moveId: 'heal_mist' },
      { lv: 48, moveId: 'pebble_toss' }, { lv: 56, moveId: 'mud_slap' },
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
      { lv: 1, moveId: 'tackle' }, { lv: 4, moveId: 'vine_lash' },
      { lv: 8, moveId: 'sharpen' }, { lv: 13, moveId: 'gust' },
      { lv: 21, moveId: 'heal_mist' },
    ],
    evolutions: [{ at: 16, to: 'mossback', condition: 'level' }],
  },
  mossback: {
    id: 'mossback', name: 'Mossback', sprite: 'mon.BambooYellow', type: 'nature',
    baseStats: { hp: 64, atk: 14, def: 14, spd: 11 },
    growth:    { hp: 10.5, atk: 2.8, def: 2.8, spd: 2.0 },
    tint: 0x66bb44,
    learnset: [
      { lv: 1, moveId: 'vine_lash' }, { lv: 19, moveId: 'pebble_toss' },
      { lv: 27, moveId: 'sharpen' }, { lv: 35, moveId: 'heal_mist' },
    ],
    evolutions: [{ at: 36, to: 'treantusk', condition: 'level' }],
  },
  treantusk: {
    id: 'treantusk', name: 'Treantusk', sprite: 'mon.Panda', type: 'nature',
    baseStats: { hp: 96, atk: 22, def: 22, spd: 14 },
    growth:    { hp: 13.5, atk: 3.6, def: 3.6, spd: 2.6 },
    tint: 0x44aa22,
    learnset: [
      { lv: 1, moveId: 'vine_lash' }, { lv: 38, moveId: 'pebble_toss' },
      { lv: 46, moveId: 'heal_mist' }, { lv: 54, moveId: 'sharpen' },
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
