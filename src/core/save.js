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
