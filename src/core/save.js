import { ADVANCED } from '../data/jobs.js';
import { STAT_IDS, MAX_STAT, SKILL_MAX, CLASS_CHANGE_LEVEL, emptyAlloc, retroProg } from '../data/stats.js';

const PROFILE_KEY = 'wayfarer.profile.v1';
const HERO_KEY = 'wayfarer.hero.v1';
const PROGRESS_PREFIX = 'wayfarer.progress.v1.';

export function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; }
}
export function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

export function loadHero() {
  try { return JSON.parse(localStorage.getItem(HERO_KEY)) || null; } catch { return null; }
}
export function saveHero(h) { localStorage.setItem(HERO_KEY, JSON.stringify(h)); }
export function clearHero() { localStorage.removeItem(HERO_KEY); }

// Per-hero progress (solo + guest-local): survives reloads, resumes Continue.
export function progressKey(name) { return PROGRESS_PREFIX + (name || 'Wayfarer').toLowerCase(); }
export function loadProgress(name) {
  try { return JSON.parse(localStorage.getItem(progressKey(name))) || null; } catch { return null; }
}
export function saveProgress(name, p) {
  try { localStorage.setItem(progressKey(name), JSON.stringify({ savedAt: Date.now(), ...p })); } catch { /* quota */ }
}
export function clearProgress(name) { localStorage.removeItem(progressKey(name)); }

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
