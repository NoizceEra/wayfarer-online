import { gearById, SLOTS } from '../data/gear.js';

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
    return { ...p, ...normalizeGearState(p) };
  } catch { return null; }
}
export function saveProgress(name, p) {
  try { localStorage.setItem(progressKey(name), JSON.stringify({ savedAt: Date.now(), ...p })); } catch { /* quota */ }
}
export function clearProgress(name) { localStorage.removeItem(progressKey(name)); }
