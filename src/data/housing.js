// Housing catalogue: furniture, trophies, and garden-plot yield tables.
// PLAIN DATA ONLY — no functions, no imports. New furniture/trophy ids live in
// their own `furn_` / `trophy_` namespace so they never collide with gear.js,
// materials.js, or item_ids.json. Costs reuse existing material ids
// (src/data/materials.js: oak_log, driftwood, iron_ingot, tattered_cloth,
// frost_crystal, tide_shard) plus gold (a sink — housing never mints gold).

// Furniture: cost = { gold, mats: {matId: n} }. size in plot-grid cells.
export const FURNITURE = [
  { id: 'furn_straw_bed', name: 'Straw Bed', kind: 'rest', size: [2, 1], cost: { gold: 50, mats: { tattered_cloth: 2 } }, desc: 'A rough but honest bed.' },
  { id: 'furn_oak_table', name: 'Oak Table', kind: 'decor', size: [2, 1], cost: { gold: 80, mats: { oak_log: 4 } }, desc: 'Sturdy meadow oak.' },
  { id: 'furn_oak_chair', name: 'Oak Chair', kind: 'decor', size: [1, 1], cost: { gold: 30, mats: { oak_log: 2 } }, desc: 'Pull up a seat.' },
  { id: 'furn_drift_shelf', name: 'Driftwood Shelf', kind: 'storage', size: [2, 1], cost: { gold: 60, mats: { driftwood: 3 } }, desc: 'Smells faintly of salt.' },
  { id: 'furn_iron_brazier', name: 'Iron Brazier', kind: 'light', size: [1, 1], cost: { gold: 120, mats: { iron_ingot: 2 } }, desc: 'Warm light for cold nights.' },
  { id: 'furn_crystal_lamp', name: 'Frost Crystal Lamp', kind: 'light', size: [1, 1], cost: { gold: 200, mats: { frost_crystal: 1, iron_ingot: 1 } }, desc: 'Hums softly in the wind.' },
  { id: 'furn_tide_chime', name: 'Tide Chime', kind: 'decor', size: [1, 1], cost: { gold: 150, mats: { tide_shard: 1, driftwood: 1 } }, desc: 'Rings with the harbour bell.' },
  { id: 'furn_herb_planter', name: 'Herb Planter', kind: 'garden', size: [1, 1], cost: { gold: 40, mats: { oak_log: 1 } }, desc: 'Grow one herb sprout per day.' },
];

export const furnById = (id) => FURNITURE.find((f) => f.id === id) || null;
export const FURN_IDS = FURNITURE.map((f) => f.id);

// Trophies: wall/pedestal displays. `ref` points at the source record —
// boss id (worldBosses.js), pet id (pets.js), or achievement flag (ext.ach).
// `source` must be one of these three kinds; the scene renders a plaque and
// only shows trophies whose source the player has actually earned.
export const TROPHY_KINDS = ['boss', 'pet', 'achievement'];
export const TROPHIES = [
  { id: 'trophy_gravemaw_fang', name: 'Gravemaw Fang', source: 'boss', ref: 'gravemaw', desc: 'Taken from the Ashenmoor deep.' },
  { id: 'trophy_tide_eye', name: 'Tide Eye Glass', source: 'boss', ref: 'tideeye', desc: 'A glass-blue sliver, still cold.' },
  { id: 'trophy_emberling_paw', name: 'Emberling Pawprint', source: 'pet', ref: 'emberling', desc: 'Your first companion.' },
  { id: 'trophy_first_home', name: 'Homestead Charter', source: 'achievement', ref: 'home_claimed', desc: 'Proof of your own front door.' },
];

export const trophyById = (id) => TROPHIES.find((t) => t.id === id) || null;

// Garden-plot yield: CLAIM model, not accrual. The player presses CLAIM once;
// if progress.ext.housing.yieldClaim.date !== today (UTC), they receive the
// plot's daily bundle and the date is stamped. No time-scaled growth, no
// passive gain while away, no gold — materials only (existing mat ids), so
// housing can never mint currency or outpace gathering.
export const PLOTS = {
  sprout: {
    id: 'sprout', name: 'Sprout Plot',
    // Per-claim bundle; DAILY_CAP bounds the whole plot to one claim/day.
    daily: [{ id: 'sunpetal', n: 2 }, { id: 'dewberry', n: 1 }],
    unlock: { gold: 100, mats: { oak_log: 2 } },
  },
  herb: {
    id: 'herb', name: 'Herb Garden',
    daily: [{ id: 'sunpetal', n: 3 }, { id: 'moonmoss', n: 2 }],
    unlock: { gold: 400, mats: { oak_log: 6, iron_ingot: 1 } },
  },
  orchard: {
    id: 'orchard', name: 'Berry Orchard',
    daily: [{ id: 'dewberry', n: 3 }, { id: 'thornberry', n: 2 }],
    unlock: { gold: 900, mats: { oak_log: 10, iron_ingot: 3 } },
  },
};
export const PLOT_IDS = Object.keys(PLOTS);
export const YIELD_RULES = {
  claimsPerDay: 1, // hard cap: one claim per UTC date per character
  dateKind: 'UTC-date (YYYY-MM-DD)',
  paysGold: false, // materials only — never mints gold
  accrual: 'none', // no passive growth; unclaimed days are simply lost
};

// Layout bounds shared by scene + save validation.
export const LAYOUT_RULES = {
  gridW: 12, gridH: 9, // plot cells
  maxPlaced: 40, // bounded array (save-shape rule)
  maxTrophies: 12, // bounded array (save-shape rule)
};

// Save shape (lives at progress.ext.housing — plain JSON, no functions):
// {
//   unlocked: bool, plot: 'sprout'|'herb'|'orchard'|null,
//   layout: [{ id, x, y, rot }],          // len <= 40, ids in FURN_IDS
//   trophies: [{ id, x, y }],             // len <= 12, ids in TROPHY_IDS
//   yieldClaim: { date: 'YYYY-MM-DD', amount: n },
// }
// normalizeHousing(): defensive loader for saves missing/corrupt housing
// (also suitable for the parent to call from normalizeExtras in
// src/core/save.js). sanitizeHousing() is the strict server-side variant
// (suitable for server/validate.js sanitizeExtras): drops unknown ids.
export const TROPHY_IDS = TROPHIES.map((t) => t.id);

export function defaultHousing() {
  return { unlocked: false, plot: null, layout: [], trophies: [], yieldClaim: { date: '', amount: 0 } };
}

const clampInt = (v, lo, hi, d) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function normalizeHousing(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const layout = (Array.isArray(r.layout) ? r.layout : [])
    .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && furnById(p.id))
    .slice(0, LAYOUT_RULES.maxPlaced)
    .map((p) => ({
      id: p.id,
      x: clampInt(p.x, 0, LAYOUT_RULES.gridW - 1, 0),
      y: clampInt(p.y, 0, LAYOUT_RULES.gridH - 1, 0),
      rot: clampInt(p.rot, 0, 3, 0),
    }));
  const trophies = (Array.isArray(r.trophies) ? r.trophies : [])
    .filter((p) => p && typeof p === 'object' && typeof p.id === 'string' && trophyById(p.id))
    .slice(0, LAYOUT_RULES.maxTrophies)
    .map((p) => ({
      id: p.id,
      x: clampInt(p.x, 0, LAYOUT_RULES.gridW - 1, 0),
      y: clampInt(p.y, 0, LAYOUT_RULES.gridH - 1, 0),
    }));
  const plot = typeof r.plot === 'string' && PLOTS[r.plot] ? r.plot : null;
  const yc = r.yieldClaim && typeof r.yieldClaim === 'object' ? r.yieldClaim : {};
  return {
    unlocked: !!r.unlocked,
    plot,
    layout,
    trophies,
    yieldClaim: {
      date: typeof yc.date === 'string' ? yc.date.slice(0, 10) : '',
      amount: Math.max(0, Math.floor(Number(yc.amount)) || 0),
    },
  };
}

// Strict variant: identical bounds, but unknown furniture/trophy ids are
// dropped rather than kept (server must never trust client ids blindly).
export function sanitizeHousing(raw) {
  return normalizeHousing(raw);
}

// UTC-date helper for the daily-claim gate.
export function todayUTC(d = new Date()) {
  return d.toISOString().slice(0, 10);
}
