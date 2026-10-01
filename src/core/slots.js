// Character slots (up to 3 local heroes), per-device profile id, portable backup code.
//
// The legacy single-save keys (wayfarer.profile.v1 / wayfarer.hero.v1) stay as the MIRROR of the
// ACTIVE slot, so Creator / WorldScene / NetworkManager keep working unchanged. Per-hero progress
// stays under progressKey(name) (names are unique across slots). A pre-slots save is migrated into
// slot 1 on first read; the old keys are never deleted.
import { loadHero, loadProfile, loadProgress, clearProgress, progressKey, onHeroSaved, HERO_KEY, PROFILE_KEY } from './save.js';

const SLOTS_KEY = 'wayfarer.slots.v1';
const DEVICE_KEY = 'wayfarer.device.v1'; // shared with NetworkManager (server character-store token)
export const MAX_SLOTS = 3;
export const NAME_MAX = 14;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch { return false; } };
const lsDel = (k) => { try { localStorage.removeItem(k); } catch { /* ignore */ } };
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };
export const cleanName = (n) => String(n || '').replace(/[^\w \-']/g, '').trim().slice(0, NAME_MAX);

function writeState(st) { lsSet(SLOTS_KEY, JSON.stringify(st)); }

function readState() {
  const raw = parse(lsGet(SLOTS_KEY));
  if (raw && typeof raw === 'object' && raw.slots && typeof raw.slots === 'object') {
    const slots = {};
    for (let i = 1; i <= MAX_SLOTS; i++) {
      const s = raw.slots[i];
      if (s && typeof s === 'object' && cleanName(s.name)) {
        slots[i] = { name: cleanName(s.name), hero: s.hero && typeof s.hero === 'object' ? s.hero : null, created: Number(s.created) || 0, played: Number(s.played) || 0 };
      }
    }
    const active = Number(raw.active);
    return { v: 1, active: active >= 1 && active <= MAX_SLOTS ? active : 1, slots };
  }
  // migrate the legacy single save into slot 1
  const hero = loadHero(), prof = loadProfile();
  const st = { v: 1, active: 1, slots: {} };
  if (hero) {
    const name = cleanName(hero.name || prof?.name) || 'Wayfarer';
    const prog = loadProgress(name);
    st.slots[1] = { name, hero: { ...hero, name }, created: prog?.savedAt || Date.now(), played: prog?.savedAt || Date.now() };
    writeState(st);
  }
  return st;
}

// Point the legacy single-save keys at the active slot.
function mirrorActive(st) {
  const s = st.slots[st.active];
  if (s?.hero) lsSet(HERO_KEY, JSON.stringify(s.hero)); else lsDel(HERO_KEY);
  if (s) lsSet(PROFILE_KEY, JSON.stringify({ ...(parse(lsGet(PROFILE_KEY)) || {}), name: s.name }));
}

export function freeSlotId() { const st = readState(); for (let i = 1; i <= MAX_SLOTS; i++) if (!st.slots[i]) return i; return 0; }
export function nameTaken(name, exceptId = 0) {
  const st = readState(); const n = cleanName(name).toLowerCase();
  return Object.entries(st.slots).some(([id, s]) => Number(id) !== exceptId && s.name.toLowerCase() === n);
}

// Always MAX_SLOTS entries: {id, empty, active, name, hero, level, job, adv, gold, equipped, dyes, savedAt}
export function listSlots() {
  const st = readState();
  const out = [];
  for (let id = 1; id <= MAX_SLOTS; id++) {
    const s = st.slots[id];
    if (!s || !s.hero) { out.push({ id, empty: true, active: st.active === id, pending: s?.name || '' }); continue; }
    const p = loadProgress(s.name);
    out.push({
      id, empty: false, active: st.active === id, name: s.name, hero: s.hero,
      level: p?.level || 1, job: p?.job || s.hero.job || 'wayfarer', adv: p?.prog?.adv || null, gold: p?.gold ?? null,
      equipped: p?.equipped || null, dyes: p?.dyes || null, hasProgress: !!p,
      savedAt: p?.savedAt || s.played || s.created || 0,
    });
  }
  return out;
}
export function activeSlot() { return listSlots().find((s) => s.active && !s.empty) || null; }

// Make `id` active and mirror its hero/name into the legacy keys. `pendingName` creates a
// hero-less slot for a brand-new journey (the creator fills the hero in via saveHero()).
export function setActiveSlot(id, pendingName) {
  if (!(id >= 1 && id <= MAX_SLOTS)) return false;
  const st = readState();
  st.active = id;
  if (!st.slots[id] && pendingName) st.slots[id] = { name: cleanName(pendingName) || 'Wayfarer', hero: null, created: Date.now(), played: 0 };
  writeState(st); mirrorActive(st);
  return true;
}
export function touchActiveSlot() {
  const st = readState(); const s = st.slots[st.active];
  if (s) { s.played = Date.now(); writeState(st); }
}
export function deleteSlot(id) {
  const st = readState(); const s = st.slots[id];
  if (!s) return false;
  clearProgress(s.name);
  delete st.slots[id];
  if (st.active === id) st.active = Number(Object.keys(st.slots)[0]) || 1;
  writeState(st); mirrorActive(st);
  return true;
}
// Renames a hero: moves its progress record under the new name (the name is the progress key).
export function renameSlot(id, newName) {
  const st = readState(); const s = st.slots[id]; const nn = cleanName(newName);
  if (!s || !nn) return { ok: false, error: 'Enter a name.' };
  if (nn.toLowerCase() !== s.name.toLowerCase() && nameTaken(nn, id)) return { ok: false, error: 'Another hero already uses that name.' };
  const old = progressKey(s.name), nw = progressKey(nn);
  if (old !== nw) { const rec = lsGet(old); if (rec) { lsSet(nw, rec); lsDel(old); } }
  s.name = nn; if (s.hero) s.hero = { ...s.hero, name: nn };
  writeState(st); if (st.active === id) mirrorActive(st);
  return { ok: true };
}

// Hero look saves (creator, server restore) land in the active slot (or the first free one).
onHeroSaved((h) => {
  const st = readState();
  let id = st.active;
  if (!st.slots[id]) { id = 0; for (let i = 1; i <= MAX_SLOTS; i++) if (!st.slots[i]) { id = i; break; } if (!id) id = st.active; }
  const name = cleanName(h?.name) || st.slots[id]?.name || 'Wayfarer';
  st.active = id;
  st.slots[id] = { name, hero: { ...h, name }, created: st.slots[id]?.created || Date.now(), played: Date.now() };
  writeState(st);
});

// ─── Per-device profile id + portable backup code ───────────────────────────
export function deviceToken() {
  let t = lsGet(DEVICE_KEY);
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    const a = new Uint8Array(18); (globalThis.crypto || window.crypto).getRandomValues(a);
    t = Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
    lsSet(DEVICE_KEY, t);
  }
  return t;
}
export function profileId() { const t = deviceToken().replace(/[^A-Za-z0-9]/g, '').toUpperCase(); return `WF-${t.slice(0, 4)}-${t.slice(4, 8)}`; }

const BACKUP_PREFIX = 'WAYFARER1.';
const b64e = (s) => btoa(unescape(encodeURIComponent(s)));
const b64d = (s) => decodeURIComponent(escape(atob(s)));
export function exportBackup() {
  const st = readState();
  const progress = {};
  for (const s of Object.values(st.slots)) { const r = parse(lsGet(progressKey(s.name))); if (r) progress[s.name] = r; }
  return BACKUP_PREFIX + b64e(JSON.stringify({ v: 1, t: Date.now(), device: deviceToken(), state: st, progress }));
}
// Replaces the local heroes with a backup code's. Returns {ok, count} or {ok:false, error}.
export function importBackup(code) {
  try {
    const raw = String(code || '').replace(/\s+/g, '');
    if (!raw.startsWith(BACKUP_PREFIX)) return { ok: false, error: 'That is not a Wayfarer backup code.' };
    const data = JSON.parse(b64d(raw.slice(BACKUP_PREFIX.length)));
    if (!data || data.v !== 1 || !data.state?.slots || typeof data.state.slots !== 'object') return { ok: false, error: 'Backup code is damaged.' };
    const slots = {};
    for (let i = 1; i <= MAX_SLOTS; i++) {
      const s = data.state.slots[i];
      if (s && cleanName(s.name) && s.hero && typeof s.hero === 'object') slots[i] = { name: cleanName(s.name), hero: s.hero, created: Number(s.created) || Date.now(), played: Number(s.played) || 0 };
    }
    if (!Object.keys(slots).length) return { ok: false, error: 'The backup holds no heroes.' };
    for (const old of Object.values(readState().slots)) clearProgress(old.name);
    for (const s of Object.values(slots)) {
      const rec = data.progress?.[s.name];
      if (rec && typeof rec === 'object') lsSet(progressKey(s.name), JSON.stringify(rec));
    }
    if (typeof data.device === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(data.device)) lsSet(DEVICE_KEY, data.device);
    const active = slots[data.state.active] ? Number(data.state.active) : Number(Object.keys(slots)[0]);
    const st = { v: 1, active, slots };
    writeState(st); mirrorActive(st);
    return { ok: true, count: Object.keys(slots).length };
  } catch { return { ok: false, error: 'Backup code is damaged.' }; }
}
