import { CONFIG } from '../config.js';

// Visual-effects settings shared by weather / lighting / particles / water.
// Exposed as `window.__fx` so the pause-menu agent (or the console) can drive it:
//   __fx.quality            'low' | 'med' | 'high'   (persisted in localStorage)
//   __fx.setQuality(q)
//   __fx.crt / __fx.setCrt(bool)                      CRT scanline overlay (persisted)
//   __fx.isNight()  __fx.time()  __fx.setTime(t0..1)  __fx.weather()  __fx.setWeather(id|null)
// Everything degrades gracefully when storage is blocked.

const QKEY = 'wayfarer.fxq';
const CKEY = 'wayfarer.crt';

export const QUALITY = {
  low:  { pool: 130, lighting: false, sway: false, shimmer: false, foam: false, footprints: false, fireflies: 0,  puddles: false, bloom: false, density: 0.4, lights: 0,  ambient: 0.35, leaves: false, lightHz: 30 },
  med:  { pool: 260, lighting: true,  sway: true,  shimmer: true,  foam: true,  footprints: true,  fireflies: 8,  puddles: true,  bloom: false, density: 0.7, lights: 14, ambient: 0.7,  leaves: true,  lightHz: 30 },
  high: { pool: 480, lighting: true,  sway: true,  shimmer: true,  foam: true,  footprints: true,  fireflies: 16, puddles: true,  bloom: true,  density: 1.0, lights: 28, ambient: 1.0,  leaves: true,  lightHz: 60 },
};

const read = (k) => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* storage blocked */ } };

const storedQ = read(QKEY);
export const settings = {
  quality: QUALITY[storedQ] ? storedQ : (CONFIG.isMobile ? 'low' : 'high'),
  explicit: !!QUALITY[storedQ], // false => Fx may auto-lower quality when FPS tanks (not persisted)
  crt: read(CKEY) === '1',
  listeners: new Set(),
  get q() { return QUALITY[this.quality]; },
  setQuality(q, persist = true) {
    if (!QUALITY[q]) return this.quality;
    if (!persist && ['low', 'med', 'high'].indexOf(q) < ['low', 'med', 'high'].indexOf(this.quality)) this._autoLowered = true; // perf governor may recover it (core/perf.js)
    this.quality = q;
    if (persist) { write(QKEY, q); this.explicit = true; }
    this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    return q;
  },
  setCrt(on) {
    this.crt = !!on; write(CKEY, this.crt ? '1' : '0');
    this.listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
    return this.crt;
  },
  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); },
};

// Stubs until a WorldScene wires real handlers (Fx overwrites `impl`).
export const impl = {};
if (typeof window !== 'undefined') {
  window.__fx = {
    get quality() { return settings.quality; },
    setQuality: (q) => settings.setQuality(q),
    qualities: Object.keys(QUALITY),
    get crt() { return settings.crt; },
    setCrt: (on) => settings.setCrt(on),
    toggleCrt: () => settings.setCrt(!settings.crt),
    isNight: () => !!impl.isNight?.(),
    time: () => impl.time?.() ?? null,
    setTime: (t) => impl.setTime?.(t),
    weather: () => impl.weather?.() ?? 'clear',
    setWeather: (id, instant) => impl.setWeather?.(id, instant),
    weatherIds: ['clear', 'rain', 'storm', 'fog', 'snow', 'blizzard', 'leaves', 'pollen', 'sand'],
    debug: () => impl.debug?.(),
  };
}
