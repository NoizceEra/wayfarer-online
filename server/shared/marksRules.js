// Wayfarer Marks: rules engine + cosmetic catalogue (pure ES module, no deps).
//
// CANONICAL COPY: server/shared/marksRules.js. src/data/marksRules.js must be a
// byte-identical copy (Vercel does not upload server/); `node tools/test_wallet_marks.mjs`
// fails when they drift. Edit here, then: cp server/shared/marksRules.js src/data/marksRules.js
//
// Marks are an OFF-CHAIN, NON-TRANSFERABLE, NON-PURCHASABLE progress currency.
// Every player earns them (guest or wallet-linked) for playing. They buy
// COSMETICS ONLY (titles, nameplate frames, name colours). Nothing here
// grants gold, XP, items, stats or any other power.
//
// The server runs evaluate() on every accepted character save, with the
// server-validated level (validate.js caps) and the save's milestone data
// (progress.ext: achievements + counters). The client runs the same code
// locally so solo/offline players see Marks accrue; the server recomputes
// from milestones when they come online and is the authority for balance,
// shop entitlements and leaderboards.
//
// Anti-farm (all enforced here, so client and server agree):
//  - no per-kill income at all (trivial kills earn nothing)
//  - one-time awards (achievements, level milestones, first clears) are once
//    per DEVICE, so new characters on the same device never re-earn them
//  - repeatable sources (dungeon/boss repeats, world events, quest chains)
//    use per-character counter baselines, a minimum interval between
//    credited increments (rate cap vs elapsed time), diminishing returns per
//    day, and per-source daily caps
//  - variety rule: until the day has earnings from 2+ distinct categories,
//    repeatable sources are capped at half their daily cap
//  - global daily cap; one-time awards that hit a cap are deferred (re-tried
//    on a later save), repeatable increments past a cap are dropped
//  - level gates: boss/dungeon credit requires a plausible (validated) level
//  - daily login requires 5 minutes of real activity (server-tracked)

export const MARKS_VERSION = 1;

export const MARKS_CFG = {
  DAILY_CAP: 250,
  HISTORY_MAX: 40,
  VARIETY_MIN_CATEGORIES: 2,
  DAILY_ACTIVE_MINUTES: 5,
  ACH_RATE_SEC: 15,          // at most 1 new achievement credited per 15 s of elapsed time (+2 burst)
};

// source id -> {cat, label, marks, cap(per day), [repeat: {minSec, decay}]}
export const SOURCES = {
  daily:       { cat: 'login',  label: 'Daily login (5 min of play)', marks: 25, cap: 25 },
  level:       { cat: 'growth', label: 'Level milestone',            marks: 20, cap: 100 },
  achievement: { cat: 'feats',  label: 'Achievement',                 marks: 10, cap: 80 },
  boss_first:  { cat: 'bosses', label: 'First boss clear',            marks: 40, cap: 120 },
  dungeon_first: { cat: 'dungeons', label: 'First dungeon clear',     marks: 50, cap: 50 },
  dungeon:     { cat: 'dungeons', label: 'Dungeon clear',             marks: 10, cap: 30, repeat: { minSec: 180, decay: 0.5 } },
  boss:        { cat: 'bosses', label: 'Boss defeated',               marks: 6,  cap: 18, repeat: { minSec: 60, decay: 0.5 } },
  chain:       { cat: 'quests', label: 'Questline completed',         marks: 30, cap: 90, repeat: { minSec: 120, decay: 1 } },
  event:       { cat: 'events', label: 'World event',                 marks: 6,  cap: 30, repeat: { minSec: 90, decay: 0.7 } },
};

export const LEVEL_MILESTONES = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 90, 99];

// first-clear counters (progress.ext.counters key) -> {name, minLevel}
export const FIRST_CLEARS = {
  boss:           { name: 'a boss',                 minLevel: 5,  src: 'boss_first' },
  slimeking:      { name: 'Slime King Gloop',       minLevel: 2,  src: 'boss_first' },
  boss_gloomtoad: { name: 'Old Gloomtoad',          minLevel: 9,  src: 'boss_first' },
  boss_hwarden:   { name: 'Hollow Warden',          minLevel: 9,  src: 'boss_first' },
  boss_khet:      { name: 'Khet, the Sun Colossus', minLevel: 12, src: 'boss_first' },
  boss_hking:     { name: 'The Hollow King',        minLevel: 13, src: 'boss_first' },
  boss_forgelord: { name: 'Forgelord Ignar',        minLevel: 14, src: 'boss_first' },
  worldboss:      { name: 'a world boss',           minLevel: 8,  src: 'boss_first' },
  dungeons:       { name: 'the Hollow Depths',      minLevel: 8,  src: 'dungeon_first' },
};
// repeatable counters -> source (+ level gate)
export const REPEATS = {
  dungeons: { src: 'dungeon', minLevel: 8 },
  boss:     { src: 'boss', minLevel: 5 },
  chains:   { src: 'chain', minLevel: 1 },
  events:   { src: 'event', minLevel: 3 },
};

// Achievement ids that award Marks (mirror of src/systems/achievements.js;
// unknown ids are ignored). Level/gold ones are gated on validated values.
export const ACHIEVEMENT_IDS = [
  'first_blood', 'hunter', 'lv5', 'lv10', 'lv20', 'gold100', 'gold1000', 'first_quest', 'quests10',
  'chain_done', 'bounty_first', 'gather_first', 'gather_50', 'first_fish', 'golden_koi', 'craft_first',
  'craft_10', 'temper_first', 'all_maps', 'waystones', 'warden', 'merchant', 'frontier', 'ways6', 'khet',
  'gloomtoad', 'forgelord', 'delver', 'delver3', 'hollowking', 'ev_first', 'ev_10', 'slimeking',
  'stargazer', 'caravan', 'titan',
];
const ACH_GATES = { lv5: { level: 5 }, lv10: { level: 10 }, lv20: { level: 20 }, gold100: { gold: 100 }, gold1000: { gold: 1000 }, khet: { level: 12 }, forgelord: { level: 14 }, hollowking: { level: 13 }, delver: { level: 8 }, delver3: { level: 8 } };

// Cosmetics: kind = title | frame | color. `badge` items are never sold; they
// are granted (founder / season attestations for linked wallets).
export const COSMETICS = [
  { id: 't_wayfarer',   kind: 'title', name: 'the Wayfarer',      cost: 50 },
  { id: 't_slime',      kind: 'title', name: 'Slime Whisperer',   cost: 120 },
  { id: 't_delver',     kind: 'title', name: 'Delver',            cost: 200 },
  { id: 't_lore',       kind: 'title', name: 'Lorekeeper',        cost: 300 },
  { id: 't_hollow',     kind: 'title', name: 'Hollow-Born',       cost: 500 },
  { id: 'f_bronze',     kind: 'frame', name: 'Bronze frame',      cost: 80,  color: '#c07a3a', bg: '#2a1608cc' },
  { id: 'f_verdant',    kind: 'frame', name: 'Verdant frame',     cost: 150, color: '#6ad04a', bg: '#0a2410cc' },
  { id: 'f_tide',       kind: 'frame', name: 'Tidal frame',       cost: 220, color: '#4ab0e8', bg: '#081a2acc' },
  { id: 'f_sunfire',    kind: 'frame', name: 'Sunfire frame',     cost: 300, color: '#ffb02a', bg: '#2a1404cc' },
  { id: 'f_starlit',    kind: 'frame', name: 'Starlit frame',     cost: 600, color: '#c8a8ff', bg: '#140a2acc' },
  { id: 'c_ember',      kind: 'color', name: 'Ember name',        cost: 100, color: '#ff8a5a' },
  { id: 'c_frost',      kind: 'color', name: 'Frost name',        cost: 100, color: '#9fd8ff' },
  { id: 'c_gold',       kind: 'color', name: 'Gilded name',       cost: 400, color: '#ffd84a' },
  // granted badges (frames), never purchasable
  { id: 'b_founder',    kind: 'frame', name: 'Founder frame',     cost: 0, badge: true, color: '#ffe9a8', bg: '#3a1a40cc' },
  { id: 'b_season1',    kind: 'frame', name: 'Season 1 frame',    cost: 0, badge: true, color: '#9bbc0f', bg: '#1a2a08cc' },
];
export const COSMETIC_BY_ID = Object.fromEntries(COSMETICS.map((c) => [c.id, c]));
export const COSMETIC_KINDS = ['title', 'frame', 'color'];

// ─── helpers ─────────────────────────────────────────────────────────
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10); // UTC day
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const int0 = (v) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 1e6) : 0; };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function newDoc() {
  return {
    v: MARKS_VERSION, balance: 0, earned: 0, spent: 0,
    once: {},            // one-time award keys (per device): 'ach:hunter', 'lvl:10', 'first:boss_khet'
    chars: {},           // charLower -> {c: {counter: n}, t: lastObservedMs}
    day: { date: '', total: 0, src: {}, cats: {}, rep: {} },
    history: [],         // newest first: {t, src, n, label}
    owned: [], equipped: {}, badges: [],
    season: { id: '', earned: 0 },
    active: { date: '', min: 0 },
    daily: '',           // last UTC day the daily login was awarded
  };
}

// Repair any stored/local doc into the current shape (never throws).
export function normalizeDoc(d) {
  const n = newDoc();
  if (!isObj(d)) return n;
  n.balance = int0(d.balance); n.earned = int0(d.earned); n.spent = int0(d.spent);
  if (isObj(d.once)) for (const k of Object.keys(d.once).slice(0, 2000)) if (typeof k === 'string' && k.length <= 64) n.once[k] = int0(d.once[k]) || 1;
  if (isObj(d.chars)) {
    for (const [k, v] of Object.entries(d.chars).slice(0, 24)) {
      if (!isObj(v)) continue;
      const c = {};
      if (isObj(v.c)) for (const [ck, cv] of Object.entries(v.c).slice(0, 64)) c[ck] = int0(cv);
      n.chars[String(k).slice(0, 24)] = { c, t: int0(v.t) };
    }
  }
  if (isObj(d.day) && typeof d.day.date === 'string') {
    n.day.date = d.day.date.slice(0, 10); n.day.total = int0(d.day.total);
    for (const key of ['src', 'cats', 'rep']) if (isObj(d.day[key])) for (const [k, v] of Object.entries(d.day[key]).slice(0, 32)) n.day[key][k] = int0(v);
  }
  if (Array.isArray(d.history)) n.history = d.history.filter(isObj).slice(0, MARKS_CFG.HISTORY_MAX).map((h) => ({ t: int0(h.t), src: String(h.src || '').slice(0, 24), n: int0(h.n), label: String(h.label || '').slice(0, 80) }));
  if (Array.isArray(d.owned)) n.owned = [...new Set(d.owned.filter((id) => typeof id === 'string' && hasOwn(COSMETIC_BY_ID, id) && !COSMETIC_BY_ID[id].badge))];
  if (Array.isArray(d.badges)) n.badges = [...new Set(d.badges.filter((id) => typeof id === 'string' && hasOwn(COSMETIC_BY_ID, id) && COSMETIC_BY_ID[id].badge))];
  if (isObj(d.equipped)) for (const k of COSMETIC_KINDS) if (typeof d.equipped[k] === 'string' && hasOwn(COSMETIC_BY_ID, d.equipped[k])) n.equipped[k] = d.equipped[k];
  if (isObj(d.season)) n.season = { id: String(d.season.id || '').slice(0, 16), earned: int0(d.season.earned) };
  if (isObj(d.active)) n.active = { date: String(d.active.date || '').slice(0, 10), min: int0(d.active.min) };
  n.daily = typeof d.daily === 'string' ? d.daily.slice(0, 10) : '';
  return n;
}

function rollDay(doc, now) {
  const today = dayOf(now);
  if (doc.day.date !== today) doc.day = { date: today, total: 0, src: {}, cats: {}, rep: {} };
  return doc.day;
}

// How many of `want` marks from source `src` fit today's caps.
function room(doc, src) {
  const s = SOURCES[src];
  const day = doc.day;
  let cap = s.cap;
  if (s.repeat && Object.keys(day.cats).filter((c) => c !== 'login').length < MARKS_CFG.VARIETY_MIN_CATEGORIES) cap = Math.floor(cap / 2);
  return Math.max(0, Math.min(cap - (day.src[src] || 0), MARKS_CFG.DAILY_CAP - day.total));
}

function credit(doc, src, n, label, now, season, out) {
  if (n <= 0) return 0;
  const day = doc.day;
  day.total += n; day.src[src] = (day.src[src] || 0) + n;
  day.cats[SOURCES[src].cat] = 1;
  doc.balance += n; doc.earned += n;
  if (season) { if (doc.season.id !== season) doc.season = { id: season, earned: 0 }; doc.season.earned += n; }
  doc.history.unshift({ t: now, src, n, label });
  doc.history.length = Math.min(doc.history.length, MARKS_CFG.HISTORY_MAX);
  out.push({ src, n, label });
  return n;
}

// One-time award (deferred, not lost, when it does not fully fit today's caps).
function once(doc, key, src, label, now, season, out) {
  if (doc.once[key]) return;
  const want = SOURCES[src].marks;
  if (room(doc, src) < want) return; // try again on a later save / day
  doc.once[key] = now;
  credit(doc, src, want, label, now, season, out);
}

// Clean a client-reported milestone claim: {ach:{id:ts}, counters:{k:n}}.
// (Same shape as progress.ext in the client save.)
export function cleanClaim(ext) {
  const out = { ach: {}, counters: {} };
  if (!isObj(ext)) return out;
  if (isObj(ext.ach)) for (const id of ACHIEVEMENT_IDS) if (ext.ach[id]) out.ach[id] = 1;
  if (isObj(ext.counters)) {
    const keys = new Set([...Object.keys(FIRST_CLEARS), ...Object.keys(REPEATS)]);
    for (const k of keys) if (hasOwn(ext.counters, k)) out.counters[k] = Math.min(int0(ext.counters[k]), 99999);
  }
  return out;
}

// Evaluate a save. ctx = {char, level, gold, claim (cleanClaim output), now, season}
// level/gold MUST be server-validated values on the server. Mutates doc,
// returns {awards: [{src,n,label}], flags: [string]} (flags = dropped/suspicious).
export function evaluate(doc, ctx) {
  const now = ctx.now || Date.now();
  const season = ctx.season || '';
  const out = []; const flags = [];
  rollDay(doc, now);
  const level = Math.max(1, int0(ctx.level));
  const gold = int0(ctx.gold);
  const claim = ctx.claim || { ach: {}, counters: {} };
  const ck = String(ctx.char || 'wayfarer').toLowerCase().slice(0, 24);

  // level milestones (validated level)
  for (const L of LEVEL_MILESTONES) if (level >= L) once(doc, `lvl:${L}`, 'level', `Reached level ${L}`, now, season, out);

  // achievements: known ids, gated, rate-limited by elapsed time for this char
  const ch = doc.chars[ck];
  const elapsed = ch ? Math.max(0, (now - ch.t) / 1000) : 0;
  let achBudget = ch ? 2 + Math.floor(elapsed / MARKS_CFG.ACH_RATE_SEC) : 6; // first sight: small backfill burst
  for (const id of ACHIEVEMENT_IDS) {
    if (!claim.ach[id] || doc.once[`ach:${id}`]) continue;
    const g = ACH_GATES[id];
    if (g && ((g.level && level < g.level) || (g.gold && gold < g.gold))) { flags.push(`ach-gate:${id}`); continue; }
    if (achBudget <= 0) { flags.push('ach-rate'); break; } // the rest are deferred
    const before = out.length;
    once(doc, `ach:${id}`, 'achievement', `Achievement: ${id.replace(/_/g, ' ')}`, now, season, out);
    if (out.length > before) achBudget--;
  }

  // first clears (counter >= 1, level gate)
  for (const [k, fc] of Object.entries(FIRST_CLEARS)) {
    if ((claim.counters[k] || 0) < 1 || doc.once[`first:${k}`]) continue;
    if (level < fc.minLevel) { flags.push(`first-gate:${k}`); continue; }
    once(doc, `first:${k}`, fc.src, `First clear: ${fc.name}`, now, season, out);
  }

  // repeatables: per-character baselines, rate cap, diminishing returns, caps
  if (!ch) {
    // first sight of this character: baseline only (no backfill for repeatables)
    doc.chars[ck] = { c: { ...claim.counters }, t: now };
  } else {
    for (const [k, r] of Object.entries(REPEATS)) {
      const cur = claim.counters[k] || 0;
      const prev = ch.c[k] || 0;
      if (cur < prev) { ch.c[k] = cur; continue; } // character reset / older save: re-baseline down, never credit
      let inc = cur - prev;
      ch.c[k] = cur;
      if (!inc) continue;
      if (level < r.minLevel) { flags.push(`rep-gate:${k}`); continue; }
      const s = SOURCES[r.src];
      const allowed = 1 + Math.floor(elapsed / s.repeat.minSec);
      if (inc > allowed) { flags.push(`rep-rate:${k} ${inc}>${allowed}`); inc = allowed; }
      for (let i = 0; i < inc; i++) {
        const nth = doc.day.rep[r.src] || 0;
        const amt = Math.max(1, Math.floor(s.marks * s.repeat.decay ** nth));
        const fit = Math.min(amt, room(doc, r.src));
        if (fit <= 0) { flags.push(`cap:${r.src}`); break; }
        doc.day.rep[r.src] = nth + 1;
        credit(doc, r.src, fit, s.label, now, season, out);
      }
    }
    ch.t = now;
  }
  // bound per-device character baselines (new chars beyond 12 evict the oldest)
  const names = Object.keys(doc.chars);
  if (names.length > 12) { names.sort((a, b) => doc.chars[a].t - doc.chars[b].t); for (const n of names.slice(0, names.length - 12)) delete doc.chars[n]; }
  return { awards: out, flags };
}

// Daily login award: call once the server has seen DAILY_ACTIVE_MINUTES of activity today.
export function awardDaily(doc, now = Date.now(), season = '') {
  rollDay(doc, now);
  const today = dayOf(now);
  if (doc.daily === today) return [];
  const out = [];
  const fit = Math.min(SOURCES.daily.marks, room(doc, 'daily'));
  if (fit <= 0) return out;
  doc.daily = today;
  credit(doc, 'daily', fit, 'Daily login', now, season, out);
  return out;
}

// Count one active minute (server: player moved during the last minute).
// Returns true when today's activity just reached the daily-login threshold.
export function tickActive(doc, now = Date.now()) {
  const today = dayOf(now);
  if (doc.active.date !== today) doc.active = { date: today, min: 0 };
  doc.active.min = Math.min(1440, doc.active.min + 1);
  return doc.active.min >= MARKS_CFG.DAILY_ACTIVE_MINUTES && doc.daily !== today;
}

export function buy(doc, id) {
  const c = COSMETIC_BY_ID[id];
  if (!c || !hasOwn(COSMETIC_BY_ID, id)) return { ok: false, reason: 'unknown' };
  if (c.badge) return { ok: false, reason: 'badge' };
  if (doc.owned.includes(id)) return { ok: false, reason: 'owned' };
  if (doc.balance < c.cost) return { ok: false, reason: 'balance' };
  doc.balance -= c.cost; doc.spent += c.cost;
  doc.owned.push(id);
  return { ok: true };
}

export function canWear(doc, id) { return doc.owned.includes(id) || doc.badges.includes(id); }

export function equip(doc, kind, id) {
  if (!COSMETIC_KINDS.includes(kind)) return { ok: false, reason: 'kind' };
  if (id === null || id === '' || id === undefined) { delete doc.equipped[kind]; return { ok: true }; }
  const c = COSMETIC_BY_ID[id];
  if (!c || !hasOwn(COSMETIC_BY_ID, id) || c.kind !== kind) return { ok: false, reason: 'unknown' };
  if (!canWear(doc, id)) return { ok: false, reason: 'locked' };
  doc.equipped[kind] = id;
  return { ok: true };
}

// Public, render-ready look for nameplates (no ids a client could abuse).
export function lookOf(doc) {
  const e = doc.equipped || {};
  const t = COSMETIC_BY_ID[e.title]; const f = COSMETIC_BY_ID[e.frame]; const c = COSMETIC_BY_ID[e.color];
  const look = {};
  if (t && canWear(doc, t.id)) look.title = t.name;
  if (f && canWear(doc, f.id)) { look.frame = f.color; look.bg = f.bg; }
  if (c && canWear(doc, c.id)) look.color = c.color;
  return look;
}

// Today's progress for the UI.
export function todayOf(doc, now = Date.now()) {
  const today = dayOf(now);
  const day = doc.day.date === today ? doc.day : { total: 0, src: {}, cats: {} };
  const variety = Object.keys(day.cats).filter((c) => c !== 'login').length >= MARKS_CFG.VARIETY_MIN_CATEGORIES;
  const src = {};
  for (const [k, s] of Object.entries(SOURCES)) src[k] = { n: day.src[k] || 0, cap: s.repeat && !variety ? Math.floor(s.cap / 2) : s.cap, label: s.label };
  return { date: today, total: day.total, cap: MARKS_CFG.DAILY_CAP, variety, src, activeMin: doc.active.date === today ? doc.active.min : 0, daily: doc.daily === today };
}
