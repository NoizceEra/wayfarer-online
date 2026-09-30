// Display helpers: integer camera zoom for the world, centered/scaled layout
// for menu scenes. All zooms are integers so pixel art never smears.
const KEY = 'wayfarer.zoom'; // 'fit' | '1'..'6'
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 6;

function readPref() {
  try {
    const v = window.localStorage.getItem(KEY);
    if (v === 'fit' || v == null) return 'fit';
    const n = parseInt(v, 10);
    return n >= MIN_ZOOM && n <= MAX_ZOOM ? n : 'fit';
  } catch { return 'fit'; }
}
function writePref(v) {
  try { window.localStorage.setItem(KEY, String(v)); } catch { /* storage blocked: ignore */ }
}

// Best integer zoom for a window: aim for ~400-480 logical px wide, >=220 tall.
export function fitZoom(w, h) {
  return Math.max(2, Math.min(4, Math.floor(Math.min(w / 400, h / 220))));
}

// Installs world-camera zoom handling on a scene: applies the saved/fit zoom,
// re-applies on window resize, and binds - / = / 0 keys.
export function installWorldZoom(scene) {
  const cam = () => scene.cameras.main;
  let pref = readPref();
  const apply = () => {
    const z = pref === 'fit' ? fitZoom(scene.scale.width, scene.scale.height) : pref;
    cam().setZoom(z);
    scene.registry.set('worldZoom', { zoom: z, fit: pref === 'fit' });
  };
  const set = (v) => { pref = v; writePref(v); apply(); };
  const step = (d) => {
    const cur = cam().zoom;
    set(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(cur) + d)));
  };
  const onKey = (e) => {
    if (/^(INPUT|TEXTAREA)$/.test(e.target?.tagName || '')) return;
    const k = e.key;
    if (k === '-' || k === '_') step(-1);
    else if (k === '=' || k === '+') step(1);
    else if (k === '0') set('fit');
  };
  apply();
  scene.scale.on('resize', apply);
  scene.input.keyboard.on('keydown', onKey);
  scene.events.once('shutdown', () => {
    scene.scale.off('resize', apply);
    scene.input.keyboard?.off('keydown', onKey);
  });
  return { apply, set };
}

// Menu-scene layout: choose an integer zoom so the logical layout (at most
// maxW x maxH) fits the window, then center the camera on that layout.
// Returns { W, H, zoom } = logical size to lay content out in (0..W, 0..H).
// Content is centered in the window; extra window area shows the backdrop.
export function setupMenuCamera(scene, { minW, minH, maxW = 1e9, maxH = 1e9, data } = {}) {
  const pw = scene.scale.width, ph = scene.scale.height;
  const zoom = Math.max(1, Math.floor(Math.min(pw / minW, ph / minH)));
  const W = Math.min(maxW, pw / zoom);
  const H = Math.min(maxH, ph / zoom);
  const cam = scene.cameras.main;
  cam.setZoom(zoom);
  cam.setScroll(W / 2 - pw / 2, H / 2 - ph / 2);
  cam.setRoundPixels(true);
  const key = `${zoom}|${W}|${H}`;
  const onResize = () => {
    const nz = Math.max(1, Math.floor(Math.min(scene.scale.width / minW, scene.scale.height / minH)));
    const nW = Math.min(maxW, scene.scale.width / nz), nH = Math.min(maxH, scene.scale.height / nz);
    if (`${nz}|${nW}|${nH}` !== key) { scene.scene.restart(data); return; }
    cam.setScroll(W / 2 - scene.scale.width / 2, H / 2 - scene.scale.height / 2);
  };
  scene.scale.on('resize', onResize);
  scene.events.once('shutdown', () => scene.scale.off('resize', onResize));
  return { W, H, zoom, pw, ph };
}
