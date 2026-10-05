// Player settings (pause menu > Settings), persisted in localStorage.
// Other modules read `settings.get('reduceMotion')` etc. and may subscribe
// with settings.onChange((key, value) => ...).
const LS = 'wayfarer.settings.v1';

function osPrefersReducedMotion() {
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}
export const DEFAULT_SETTINGS = {
  master: 1,          // 0..1
  music: 0.7,         // 0..1
  sfx: 0.9,           // 0..1
  showFps: false,
  haptics: true,      // navigator.vibrate on hits / level-up (touch devices)
  shake: true,        // camera shake
  reduceMotion: osPrefersReducedMotion(), // no shake, no flashing vignette / pulses (defaults to the OS preference)
  largeText: false,   // DOM panels 20% larger (ui/theme.js)
  uiScale: 1,         // HUD + panels zoom (0.75..2)
};
export const UI_SCALES = [0.75, 1, 1.25, 1.5, 2];

function sanitize(k, v) {
  const d = DEFAULT_SETTINGS[k];
  if (typeof d === 'boolean') return typeof v === 'boolean' ? v : d;
  if (typeof d === 'number') {
    const n = Number(v);
    if (!Number.isFinite(n)) return d;
    if (k === 'uiScale') return UI_SCALES.includes(n) ? n : d;
    return Math.max(0, Math.min(1, n));
  }
  return d;
}

class Settings {
  constructor() {
    this.v = { ...DEFAULT_SETTINGS };
    this.fns = new Set();
    try {
      const raw = JSON.parse(window.localStorage.getItem(LS) || '{}');
      if (raw && typeof raw === 'object') for (const k of Object.keys(DEFAULT_SETTINGS)) if (k in raw) this.v[k] = sanitize(k, raw[k]);
    } catch { /* storage blocked / corrupt: defaults */ }
  }
  get(k) { return this.v[k]; }
  all() { return { ...this.v }; }
  set(k, val) {
    if (!(k in DEFAULT_SETTINGS)) return;
    const nv = sanitize(k, val);
    if (this.v[k] === nv) return;
    this.v[k] = nv;
    this.save();
    this.fns.forEach((fn) => { try { fn(k, nv); } catch (e) { console.error(e); } });
  }
  reset() { for (const k of Object.keys(DEFAULT_SETTINGS)) this.set(k, DEFAULT_SETTINGS[k]); }
  save() { try { window.localStorage.setItem(LS, JSON.stringify(this.v)); } catch { /* ignore */ } }
  onChange(fn) { this.fns.add(fn); return () => this.fns.delete(fn); }
  get shakeOn() { return this.v.shake && !this.v.reduceMotion; }
}

export const settings = new Settings();

// Camera zoom for the HUD scenes: the largest UI_SCALES entry <= the setting
// that still leaves at least a 360x300 logical layout on this window.
export function uiZoomFor(w, h) {
  const want = settings.get('uiScale');
  const opts = UI_SCALES.filter((z) => z <= want && (z <= 1 || (w / z >= 360 && h / z >= 300)));
  return opts.length ? opts[opts.length - 1] : 1;
}

// Wrap a camera's shake() so the Screen shake / Reduce motion settings apply
// to every caller (combat, bosses, skills) without touching them.
export function applyShakeSetting(cam) {
  if (!cam || cam.__shakeWrapped) return;
  const orig = cam.shake.bind(cam);
  cam.shake = (...args) => (settings.shakeOn ? orig(...args) : cam);
  cam.__shakeWrapped = true;
}
