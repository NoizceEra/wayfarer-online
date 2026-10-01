import { ADVANCED } from '../data/jobs.js';
import { STAT_IDS, MAX_STAT, SKILL_MAX, CLASS_CHANGE_LEVEL, emptyAlloc, retroProg } from '../data/stats.js';
import { gearById, SLOTS } from '../data/gear.js';
import { matById } from '../data/materials.js';

const PROFILE_KEY = 'wayfarer.profile.v1';
const HERO_KEY = 'wayfarer.hero.v1';
const PROGRESS_PREFIX = 'wayfarer.progress.v1.';
export const BAG_SIZE = 30;

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; }
}
export function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

export function loadHero() {
  try { return JSON.parse(localStorage.getItem(HERO_KEY)) || null; } catch { return null; }
}
export function saveHero(h) { localStorage.setItem(HERO_KEY, JSON.stringify(h)); }
export function clearHero() { localStorage.removeItem(HERO_KEY); }

// Gear state with safe defaults for any old/partial/corrupt save:
//  inventory: [itemId] (unknown ids dropped, capped to BAG_SIZE)
//  equipped:  {slot: itemId|null} for all 8 slots (legacy chest→body, trinket→charm)
//  dyes:      {itemId: dyeId}
export function normalizeGearState(s) {
  const legacy = { chest: 'body', trinket: 'charm' };
  const equipped = Object.fromEntries(SLOTS.map((k) => [k, null]));
  for (const [k, id] of Object.entries(s?.equipped || {})) {
    const slot = SLOTS.includes(k) ? k : legacy[k];
    const g = typeof id === 'string' && gearById(id);
    if (slot && g && g.slot === slot) equipped[slot] = id;
  }
  const inventory = (Array.isArray(s?.inventory) ? s.inventory : [])
    .filter((id) => typeof id === 'string' && gearById(id)).slice(0, BAG_SIZE);
  const dyes = {};
  if (s?.dyes && typeof s.dyes === 'object') {
    for (const [id, d] of Object.entries(s.dyes)) if (gearById(id) && typeof d === 'string') dyes[id] = d;
  }
  return { inventory, equipped, dyes };
}

// Per-hero progress (solo + guest-local): survives reloads, resumes Continue.
export function progressKey(name) { return PROGRESS_PREFIX + (name || 'Wayfarer').toLowerCase(); }
export function loadProgress(name) {
  try {
    const p = JSON.parse(localStorage.getItem(progressKey(name)));
    if (!p) return null;
    return { ...p, ...normalizeGearState(p), ext: normalizeExtras(p.ext) };
  } catch { return null; }
}
// Save listeners (net/NetworkManager uploads to the server-side character store).
const saveHooks = new Set();
export function onProgressSaved(fn) { saveHooks.add(fn); return () => saveHooks.delete(fn); }
export function saveProgress(name, p, opts = {}) {
  const rec = { ...p, savedAt: opts.savedAt || Date.now() };
  try { localStorage.setItem(progressKey(name), JSON.stringify(rec)); } catch { /* quota */ }
  if (!opts.silent) saveHooks.forEach((fn) => { try { fn(name, rec); } catch { /* ignore */ } });
}
export function clearProgress(name) { localStorage.removeItem(progressKey(name)); }

// Identity feature: character names that have progress on THIS device/browser.
// Used by the title screen to report what a recovery-code continue restored
// (the authoritative list still comes from the relay character store on join).
export function listLocalCharacters() {
  const names = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PROGRESS_PREFIX)) names.push(k.slice(PROGRESS_PREFIX.length));
    }
  } catch { /* private mode */ }
  return names;
}

// RPG progression ({alloc, statPoints, skillPoints, skills, adv}) stored under
// progress.prog. Old saves have none -> retroProg() grants the points the
// character would have earned by its level. Anything malformed falls back to
// defaults field-by-field, so a bad save never blocks loading.
const clampInt = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export function sanitizeProgression(raw, level, jobId) {
  const def = retroProg(level);
  if (!raw || typeof raw !== 'object') return def;
  const out = { alloc: emptyAlloc(), skills: {}, adv: null };
  for (const s of STAT_IDS) out.alloc[s] = clampInt(raw.alloc?.[s], 0, MAX_STAT, 0);
  out.statPoints = clampInt(raw.statPoints, 0, 9999, def.statPoints);
  out.skillPoints = clampInt(raw.skillPoints, 0, 999, def.skillPoints);
  if (raw.skills && typeof raw.skills === 'object') {
    for (const k of Object.keys(raw.skills).slice(0, 40)) out.skills[k] = clampInt(raw.skills[k], 0, SKILL_MAX, 0);
  }
  const adv = typeof raw.adv === 'string' ? ADVANCED[raw.adv] : null;
  if (adv && adv.base === jobId && level >= CLASS_CHANGE_LEVEL) out.adv = adv.id;
  return out;
}

// Content-depth state (quests v2, materials, recipes, achievements, bestiary,
// codex, tempering, counters) stored under progress.ext. Everything defaults
// safely so pre-ext saves load unchanged; `quests: null` tells QuestSystem to
// migrate from the legacy questState ({idx, kills, side, sideDone}).
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const cleanMap = (m, valid) => {
  const out = {};
  if (isObj(m)) for (const [k, v] of Object.entries(m)) if ((!valid || valid(k)) && Number.isFinite(Number(v)) && Number(v) > 0) out[k] = Math.min(9999, Math.floor(Number(v)));
  return out;
};
export function normalizeExtras(raw) {
  const r = isObj(raw) ? raw : {};
  const q = isObj(r.quests) ? r.quests : null;
  const flagMap = (m) => { const o = {}; if (isObj(m)) for (const k of Object.keys(m).slice(0, 400)) if (m[k]) o[k] = m[k] === true ? 1 : Number(m[k]) || 1; return o; };
  return {
    mats: cleanMap(r.mats, (k) => matById(k)),
    recipes: Array.isArray(r.recipes) ? r.recipes.filter((x) => typeof x === 'string').slice(0, 80) : [],
    ach: flagMap(r.ach),
    bestiary: (() => {
      const o = {};
      if (isObj(r.bestiary)) for (const [k, v] of Object.entries(r.bestiary).slice(0, 80)) if (isObj(v)) o[k] = { kills: Math.max(0, Math.floor(Number(v.kills)) || 0), drops: flagMap(v.drops) };
      return o;
    })(),
    codex: { mats: flagMap(r.codex?.mats), gear: flagMap(r.codex?.gear) },
    upg: cleanMap(r.upg, (k) => gearById(k)),
    counters: cleanMap(r.counters),
    visited: flagMap(r.visited),
    lore: flagMap(r.lore),
    buyback: Array.isArray(r.buyback) ? r.buyback.filter((b) => b && typeof b.id === 'string').slice(0, 10).map((b) => ({ kind: b.kind === 'mat' ? 'mat' : 'gear', id: b.id, n: Math.max(1, Math.floor(b.n) || 1), price: Math.max(0, Math.floor(b.price) || 0) })) : [],
    quests: q ? {
      active: isObj(q.active) ? q.active : {},
      done: flagMap(q.done),
      tracked: Array.isArray(q.tracked) ? q.tracked.filter((x) => typeof x === 'string').slice(0, 3) : [],
      bounty: isObj(q.bounty) ? q.bounty : {},
    } : null,
  };
}
