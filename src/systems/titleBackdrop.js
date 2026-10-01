// Animated title backdrop: a procedural pixel-art valley with parallax ridges, a slow
// day -> dusk -> night -> dawn loop, clouds, stars, moon/sun, fireflies, lantern + window glow,
// birds, occasional falling leaves / snow and a few silhouettes (villagers, a ninja, a cat) strolling
// along the ridge. All art is drawn once to tiny canvases (phase-1 safe: no files); the walkers use the
// Ninja Adventure sheets that stream in during phase 2 and appear as soon as they exist.
//
//   const bd = addTitleBackdrop(scene, root, menu);  // call bd.update(time, delta) from Scene.update
//   bd.destroy();                                    // (root.destroy(true) also removes the objects)
//
// Reduced motion (Settings or the OS preference) renders ONE static dusk frame and never updates.
import Phaser from 'phaser';
import { settings } from '../core/settings.js';
import { settings as fx } from './fxSettings.js';
import { worldReady } from '../assets/worldLoad.js';

const TW = 480, TH = 270;     // sky/art grid
const RW = 600;               // ridge strip width (extra room for parallax drift)
const PERIOD = 200;           // seconds per full day cycle
const START_P = 0.3;          // first impression: golden dusk, like the original art
const hash = (x, y = 0) => { let h = (x * 374761393 + y * 668265263) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const mixCol = (a, b, t) => {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t), g = lerp((a >> 8) & 255, (b >> 8) & 255, t), bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
};
const css = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Time-of-day keyframes (p: 0 = noon, 0.34 = dusk, 0.5-0.78 = night, 0.9 = dawn).
const KEYS = [
  { p: 0.00, top: 0x4e9aa8, mid: 0x9ccf98, hor: 0xe4eca8, ridge: 0xffffff, cloud: 0xffffff, star: 0.0, dark: 0.0 },
  { p: 0.22, top: 0x3a8878, mid: 0xc5c868, hor: 0xf6d65e, ridge: 0xffe4ae, cloud: 0xffe6a8, star: 0.0, dark: 0.1 },
  { p: 0.34, top: 0x16402e, mid: 0x78982e, hor: 0xe0ae48, ridge: 0xe0b070, cloud: 0xf0b868, star: 0.25, dark: 0.55 },
  { p: 0.48, top: 0x07142a, mid: 0x0c2a34, hor: 0x1c4a36, ridge: 0x4a6a86, cloud: 0x40507a, star: 1.0, dark: 1.0 },
  { p: 0.78, top: 0x060e1e, mid: 0x0b2230, hor: 0x1a3e38, ridge: 0x3c5a78, cloud: 0x36466a, star: 1.0, dark: 1.0 },
  { p: 0.90, top: 0x2a4a62, mid: 0x8a8a74, hor: 0xe8a868, ridge: 0xc8b0a2, cloud: 0xe8b0a0, star: 0.2, dark: 0.45 },
  { p: 1.00, top: 0x4e9aa8, mid: 0x9ccf98, hor: 0xe4eca8, ridge: 0xffffff, cloud: 0xffffff, star: 0.0, dark: 0.0 },
];
function todAt(p) {
  let i = 0;
  while (i < KEYS.length - 2 && p > KEYS[i + 1].p) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = smooth(clamp01((p - a.p) / (b.p - a.p)));
  return {
    top: mixCol(a.top, b.top, t), mid: mixCol(a.mid, b.mid, t), hor: mixCol(a.hor, b.hor, t),
    ridge: mixCol(a.ridge, b.ridge, t), cloud: mixCol(a.cloud, b.cloud, t),
    star: lerp(a.star, b.star, t), dark: lerp(a.dark, b.dark, t),
  };
}

let clock = 0; // seconds of title time; survives scene rebuilds (resize) so the sky does not jump back

// ─── procedural textures (created once per game) ────────────────────────────
function canvasTex(scene, key, w, h, draw) {
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, w, h);
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  draw(c, (x, y, ww, hh, col) => { c.fillStyle = col; c.fillRect(x | 0, y | 0, ww | 0, hh | 0); });
  tex.refresh();
  return key;
}

// Ridge profile (also used to stand walkers on the near ridge).
const RIDGES = [
  { key: 'title.ridge0', base: 176, amp: 8, freq: 0.021, seed: 1.3, fill: '#3c7a3a', rim: '#86b84e', pines: 26, k: 0.28 },
  { key: 'title.ridge1', base: 200, amp: 9, freq: 0.027, seed: 4.1, fill: '#2a6232', rim: '#58a043', pines: 34, k: 0.55 },
  { key: 'title.ridge2', base: 231, amp: 7, freq: 0.019, seed: 7.7, fill: '#17491f', rim: '#36803a', pines: 22, k: 1.0 },
];
const ridgeTopAt = (r, x) => Math.round(r.base + Math.sin(x * r.freq + r.seed) * r.amp + Math.sin(x * r.freq * 2.3 + r.seed * 2) * r.amp * 0.4);
const LANTERN_X = 150;      // wayfarer + lantern on the near ridge (texture x)
const CABIN_X = 430;        // cabin with a lit window on the middle ridge

function makeRidge(scene, r, idx) {
  canvasTex(scene, r.key, RW, TH, (c, rect) => {
    const tops = [];
    for (let x = 0; x < RW; x++) {
      const y = ridgeTopAt(r, x);
      tops.push(y);
      rect(x, y, 1, TH - y, r.fill);
      rect(x, y, 1, 1, r.rim);
      if (hash(x, idx + 11) > 0.55) rect(x, y + 1, 1, 1, r.rim);
    }
    // speckle texture + darker lower body
    for (let i = 0; i < RW * 6; i++) {
      const x = Math.floor(hash(i, 21 + idx) * RW), y = tops[x] + 2 + Math.floor(hash(i, 31 + idx) * (TH - tops[x] - 2));
      if (y < TH) { c.globalAlpha = 0.18; rect(x, y, 1, 1, hash(i, 5) > 0.5 ? '#000' : r.rim); }
    }
    c.globalAlpha = 0.28; rect(0, r.base + 22, RW, TH, '#000'); c.globalAlpha = 1;
    for (let i = 0; i < r.pines; i++) {
      const x = Math.floor(hash(i, r.seed * 7) * (RW - 8)) + 4;
      if (idx === 2 && Math.abs(x - LANTERN_X) < 14) continue;
      if (idx === 1 && Math.abs(x - CABIN_X) < 16) continue;
      const y = tops[x];
      const h = 9 + Math.floor(hash(i, r.seed + 4) * 9) + (idx === 2 ? 4 : 0);
      for (let k = 0; k < h; k++) {
        const half = Math.floor((h - k) / 3) + (k > h - 3 ? 0 : 0);
        rect(x - half, y - k, 1 + 2 * half, 1, k % 3 === 0 ? r.fill : r.fill);
        if (half > 0) { c.globalAlpha = 0.5; rect(x - half, y - k, 1, 1, r.rim); c.globalAlpha = 1; }
      }
      rect(x, y - h - 1, 1, 1, r.rim);
    }
    if (idx === 1) { // little cabin with a chimney (window glow is a separate additive sprite)
      const y = tops[CABIN_X];
      rect(CABIN_X - 7, y - 9, 15, 10, '#3a2a1a'); rect(CABIN_X - 7, y - 9, 15, 1, '#5a4228');
      for (let k = 0; k < 6; k++) rect(CABIN_X - 9 + k, y - 15 + k, 19 - 2 * k, 1, '#241810');
      rect(CABIN_X + 4, y - 17, 3, 5, '#2a1c12');
      rect(CABIN_X - 3, y - 7, 4, 4, '#ffd34a'); // window (always a lit pixel patch, brighter at night via glow)
      rect(CABIN_X + 3, y - 5, 3, 5, '#1c120b');
    }
    if (idx === 2) { // wayfarer + lantern silhouette
      const px = LANTERN_X, py = tops[px];
      const dk = '#04120a';
      rect(px - 2, py - 12, 4, 10, dk); rect(px - 3, py - 15, 6, 4, dk);
      rect(px - 1, py - 2, 1, 2, dk); rect(px + 1, py - 2, 1, 2, dk);
      rect(px + 4, py - 14, 1, 10, dk);
      rect(px + 5, py - 9, 3, 4, '#ffd34a'); rect(px + 6, py - 8, 1, 2, '#fff6c0');
    }
  });
  return tops0(r);
}
const topCache = {};
function tops0(r) { return (topCache[r.key] ||= Array.from({ length: RW }, (_, x) => ridgeTopAt(r, x))); }

function makeGlow(scene) {
  return canvasTex(scene, 'title.glow', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,0.45)'); g.addColorStop(0.6, 'rgba(255,255,255,0.12)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
}
function makeSky(scene) {
  if (scene.textures.exists('title.sky')) return;
  scene.textures.createCanvas('title.sky', 2, 160);
}
function paintSky(scene, tod) {
  const tex = scene.textures.get('title.sky');
  const c = tex.getContext();
  const H = 160;
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    const col = t < 0.55 ? mixCol(tod.top, tod.mid, t / 0.55) : mixCol(tod.mid, tod.hor, (t - 0.55) / 0.45);
    c.fillStyle = css(col); c.fillRect(0, y, 2, 1);
  }
  tex.refresh();
}
function makeStars(scene) {
  canvasTex(scene, 'title.stars', TW, TH, (c, rect) => {
    for (let i = 0; i < 150; i++) {
      const x = hash(i, 3) * TW, y = hash(i, 9) * TH * 0.62;
      rect(x, y, 1, 1, hash(i, 5) > 0.82 ? '#fff6c0' : hash(i, 6) > 0.5 ? '#a8d4b0' : '#7fa88f');
    }
  });
  canvasTex(scene, 'title.stars2', TW, TH, (c, rect) => { // sparser/brighter set that twinkles
    for (let i = 0; i < 26; i++) {
      const x = hash(i, 13) * TW, y = hash(i, 19) * TH * 0.55;
      rect(x, y, 1, 1, '#ffffff'); if (hash(i, 7) > 0.6) { rect(x - 1, y, 3, 1, '#d8f0c0'); rect(x, y - 1, 1, 3, '#d8f0c0'); }
    }
  });
}
function makeCelestials(scene) {
  canvasTex(scene, 'title.sun', 24, 24, (c, rect) => {
    for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
      const d = Math.hypot(x, y);
      if (d <= 8) rect(12 + x, 12 + y, 1, 1, d < 5.5 ? '#fffbd0' : '#ffe27a');
    }
  });
  canvasTex(scene, 'title.moon', 20, 20, (c, rect) => {
    for (let y = -8; y <= 8; y++) for (let x = -8; x <= 8; x++) {
      if (Math.hypot(x, y) <= 7 && Math.hypot(x + 3, y - 1) > 6) rect(10 + x, 10 + y, 1, 1, Math.hypot(x, y) < 5 ? '#f4f1d0' : '#d8d6b0');
    }
  });
}
function makeCloud(scene, i) {
  const key = `title.cloud${i}`;
  const w = [64, 80, 52][i], h = [20, 24, 16][i];
  canvasTex(scene, key, w, h, (c, rect) => {
    const blobs = [];
    const n = 5 + i;
    for (let b = 0; b < n; b++) blobs.push({ x: w * (0.15 + 0.7 * hash(b, 40 + i)), y: h * (0.45 + 0.2 * hash(b, 50 + i)), rx: w * (0.12 + 0.1 * hash(b, 60 + i)), ry: h * (0.22 + 0.16 * hash(b, 70 + i)) });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let hit = false, top = false;
      for (const b of blobs) {
        const d = ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2;
        if (d <= 1) { hit = true; if (((x - b.x) / b.rx) ** 2 + ((y + 2 - b.y) / b.ry) ** 2 <= 1) top = true; }
      }
      if (hit) rect(x, y, 1, 1, top ? '#ffffff' : '#c8d6d0');
    }
  });
  return key;
}
function makeSprites(scene) {
  canvasTex(scene, 'title.bird0', 7, 4, (c, rect) => { rect(0, 2, 2, 1, '#0a160c'); rect(2, 1, 1, 1, '#0a160c'); rect(3, 2, 1, 1, '#0a160c'); rect(4, 1, 1, 1, '#0a160c'); rect(5, 2, 2, 1, '#0a160c'); });
  canvasTex(scene, 'title.bird1', 7, 4, (c, rect) => { rect(0, 1, 2, 1, '#0a160c'); rect(2, 2, 1, 1, '#0a160c'); rect(3, 3, 1, 1, '#0a160c'); rect(4, 2, 1, 1, '#0a160c'); rect(5, 1, 2, 1, '#0a160c'); });
  canvasTex(scene, 'title.leaf0', 3, 2, (c, rect) => { rect(0, 0, 3, 2, '#a8b830'); rect(1, 0, 1, 1, '#e0c850'); });
  canvasTex(scene, 'title.leaf1', 3, 2, (c, rect) => { rect(0, 0, 3, 2, '#d49a38'); rect(2, 1, 1, 1, '#8a5a20'); });
  canvasTex(scene, 'title.leaf2', 3, 2, (c, rect) => { rect(0, 0, 3, 2, '#6a9a2a'); rect(0, 1, 1, 1, '#3a6a20'); });
  canvasTex(scene, 'title.flake', 3, 3, (c, rect) => { rect(1, 0, 1, 3, '#ffffff'); rect(0, 1, 3, 1, '#e8f4ff'); });
  canvasTex(scene, 'title.mote', 4, 4, (c) => {
    const g = c.createRadialGradient(2, 2, 0, 2, 2, 2);
    g.addColorStop(0, 'rgba(255,248,180,1)'); g.addColorStop(1, 'rgba(255,230,120,0)');
    c.fillStyle = g; c.fillRect(0, 0, 4, 4);
  });
  // shooting star: a 1px-proud streak with a bright head on the RIGHT (the angle is
  // set per shot, so one texture covers every direction).
  canvasTex(scene, 'title.streak', 20, 3, (c) => {
    const g = c.createLinearGradient(0, 0, 20, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.6, 'rgba(214,236,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,1)');
    c.fillStyle = g; c.fillRect(0, 1, 20, 1);
    c.fillStyle = 'rgba(255,255,255,0.85)'; c.fillRect(19, 0, 1, 3);
  });
  canvasTex(scene, 'title.vignette', 128, 128, (c) => {
    const g = c.createRadialGradient(64, 64, 34, 64, 64, 92);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,10,4,0.75)');
    c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  });
}

const WALKER_BODIES = ['Villager', 'ManGreen', 'NinjaDark', 'SorcererOrange', 'Child', 'OldMan', 'Knight', 'NinjaBlue', 'Monk'];
const WALKER_ANIMALS = ['cat', 'catBlack', 'dog'];

export function prefersReducedMotion() {
  try { if (settings.get('reduceMotion')) return true; } catch { /* ignore */ }
  try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

// Adds the backdrop to `root`, sized to cover the visible area of the zoomed menu camera.
export function addTitleBackdrop(scene, root, menu) {
  const { W: mw, H: mh, zoom, pw, ph } = menu;
  const vw = pw / zoom, vh = ph / zoom;
  const cx = mw / 2, cy = mh / 2;
  const left = cx - vw / 2, top = cy - vh / 2, bottom = cy + vh / 2;
  const sr = Math.max(vw / TW, Math.min(vh / TH, (vw / TW) * 1.6));   // ridge pixel scale
  const reduce = prefersReducedMotion();
  const low = fx.quality === 'low' || reduce;
  const canvasRenderer = scene.sys.game.renderer.type === Phaser.CANVAS;
  const add = (o) => { root.add(o); return o; };

  makeSky(scene); makeGlow(scene); makeStars(scene); makeCelestials(scene); makeSprites(scene);
  const cloudKeys = [0, 1, 2].map((i) => makeCloud(scene, i));
  RIDGES.forEach((r, i) => makeRidge(scene, r, i));

  // sky + stars (cover the whole visible area)
  const sky = add(scene.add.image(cx, cy, 'title.sky').setDisplaySize(vw + 4, vh + 4));
  const starS = Math.max(vw / TW, vh / TH);
  const stars = add(scene.add.image(cx, cy, 'title.stars').setScale(starS));
  const stars2 = add(scene.add.image(cx, cy, 'title.stars2').setScale(starS));
  const horizonY = bottom - (TH - 184) * sr;           // top of the far ridge
  const skyH = Math.max(40, horizonY - top);

  // sun, moon (+ glows)
  const sunGlow = add(scene.add.image(0, 0, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setScale((vw / 128) * 0.55));
  const sun = add(scene.add.image(0, 0, 'title.sun').setScale(sr * 1.15));
  const moon = add(scene.add.image(0, 0, 'title.moon').setScale(sr * 1.1));
  const moonGlow = add(scene.add.image(0, 0, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0x9ac8d8).setScale((vw / 128) * 0.28));

  // clouds
  const clouds = [];
  const nClouds = low ? 3 : 6;
  for (let i = 0; i < nClouds; i++) {
    const img = add(scene.add.image(left + hash(i, 90) * vw, top + skyH * (0.08 + 0.5 * hash(i, 91)), cloudKeys[i % 3]).setScale(sr * (0.9 + hash(i, 92) * 0.9)));
    clouds.push({ img, v: (2.2 + hash(i, 93) * 4) * sr, a: 0.55 + hash(i, 94) * 0.4 });
  }

  // birds
  const birds = [];
  if (!low) for (let i = 0; i < 4; i++) birds.push({ img: add(scene.add.image(-99, -99, 'title.bird0').setScale(sr * 1.1).setVisible(false)), i, t: 0, y: 0 });
  let flockT = 6 + Math.random() * 10, flock = null;

  // ridges (parallax) with attached glow sprites
  const layers = RIDGES.map((r) => {
    const img = add(scene.add.image(cx, bottom + 1, r.key).setOrigin(0.5, 1).setScale(sr));
    return { r, img, k: r.k };
  });
  const attach = (layerIdx, tx, ty, item, rel) => ({ layer: layers[layerIdx], tx, ty, item, rel });
  const attached = [];
  const lanternTop = tops0(RIDGES[2])[LANTERN_X], cabinTop = tops0(RIDGES[1])[CABIN_X];
  const lanternGlow = add(scene.add.image(0, 0, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffd060).setScale(sr * 0.5));
  attached.push(attach(2, LANTERN_X + 6.5, lanternTop - 7, lanternGlow));
  const winGlow = add(scene.add.image(0, 0, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffc050).setScale(sr * 0.32));
  attached.push(attach(1, CABIN_X - 1, cabinTop - 5, winGlow));
  // mist between the layers
  const mist = [0, 1].map((i) => {
    const m = add(scene.add.image(cx, bottom - (TH - (RIDGES[i + 1].base - 4)) * sr, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setScale((vw / 128) * 1.2, sr * 0.55).setAlpha(0.18));
    return m;
  });

  // chimney smoke (a few puffs rising from the cabin)
  const smoke = [];
  if (!low) for (let i = 0; i < 4; i++) smoke.push(attach(1, CABIN_X + 5, cabinTop - 18, add(scene.add.image(0, 0, 'title.glow').setTint(0xb8c8b0).setAlpha(0).setScale(sr * 0.1)), { i }));

  // walkers on the near ridge (silhouettes of the real sprite sheets, once phase 2 has loaded them)
  const walkers = [];
  const nearTops = tops0(RIDGES[2]);
  const spawnWalker = (w, first) => {
    const animal = Math.random() < 0.28;
    const body = WALKER_BODIES.filter((b) => scene.textures.exists(`char.${b}`));
    const animals = WALKER_ANIMALS.filter((b) => scene.textures.exists(`animal.${b}`));
    if (animal && animals.length) { w.kind = 'animal'; w.name = animals[Math.floor(Math.random() * animals.length)]; }
    else if (body.length) { w.kind = 'char'; w.name = body[Math.floor(Math.random() * body.length)]; }
    else { w.wait = 4; return; }
    w.dir = Math.random() < 0.5 ? 1 : -1;
    w.x = first ? RW * (0.2 + Math.random() * 0.6) : (w.dir > 0 ? 30 : RW - 30);
    w.v = (w.kind === 'animal' ? 9 : 7) + Math.random() * 4;
    w.wait = 0; w.pause = first ? 0 : 0;
    const key = w.kind === 'animal' ? `animal.${w.name}` : `char.${w.name}`;
    w.sprite.setTexture(key, 0).setVisible(true);
    w.sprite.setScale(sr * (w.kind === 'animal' ? 0.9 : 0.95));
    if (w.kind === 'char') w.sprite.setTint(0x0a1a0e); else w.sprite.setTint(0x0a1a0e);
  };
  if (!reduce) {
    for (let i = 0; i < (low ? 1 : 2); i++) {
      const s = add(scene.add.sprite(-99, -99, 'title.glow').setOrigin(0.5, 0.92).setVisible(false));
      walkers.push({ sprite: s, wait: 2 + i * 6, x: 0, dir: 1, v: 8, kind: '', name: '' });
    }
  }
  const playWalk = (w) => {
    const dirName = w.dir > 0 ? 'right' : 'left';
    const k = w.kind === 'animal' ? `animal.${w.name}.walk` : `char.${w.name}.walk.${dirName}`;
    if (scene.anims.exists(k)) { if (w.sprite.anims.currentAnim?.key !== k) w.sprite.play(k); }
    if (w.kind === 'animal') w.sprite.setFlipX(w.dir < 0);
  };

  // fireflies + weather particles
  const motes = [];
  const nMotes = low ? (reduce ? 10 : 8) : Math.round(26 * (vw * vh) / (960 * 540) * 0.6 + 14);
  for (let i = 0; i < Math.min(nMotes, 46); i++) {
    const bx = left + hash(i, 1) * vw, by = top + vh * (0.5 + hash(i, 2) * 0.45);
    motes.push({ img: add(scene.add.image(bx, by, 'title.mote').setBlendMode(Phaser.BlendModes.ADD).setScale(sr * 1.1)), bx, by, a: 0.4 + hash(i, 4) * 0.8, b: 0.3 + hash(i, 6) * 0.7, ph: hash(i, 8) * 6.28, amp: 10 + hash(i, 9) * 26 });
  }
  const parts = [];
  if (!low) {
    const keys = ['title.leaf0', 'title.leaf1', 'title.leaf2'];
    for (let i = 0; i < 26; i++) parts.push({ img: add(scene.add.image(0, 0, keys[i % 3]).setScale(sr * 0.9).setVisible(false)), on: false, vx: 0, vy: 0, ph: 0, spin: 0 });
  }
  let weather = { kind: null, until: 0, next: 12 + Math.random() * 10 };

  // shooting stars — rare, night only, two pooled streaks that fade as they fall
  const streaks = [];
  if (!low) for (let i = 0; i < 2; i++) streaks.push({ img: add(scene.add.image(-99, -99, 'title.streak').setBlendMode(Phaser.BlendModes.ADD).setVisible(false)), on: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  let streakT = 9 + Math.random() * 18;

  const vignette = add(scene.add.image(cx, cy, 'title.vignette').setDisplaySize(vw + 4, vh + 4));

  // ─── per-frame ────────────────────────────────────────────────────────
  const mapX = (a, off) => a.layer.img.x + (a.tx - RW / 2) * sr;
  const mapY = (a) => a.layer.img.y - (TH - a.ty) * sr;
  let tintAcc = 99, skyAcc = 99, lastP = -1, pointerX = 0, driftT = 0, tod = todAt(START_P);

  const applyTod = (p, force) => {
    tod = todAt(p);
    if (force || skyAcc > 0.12) { skyAcc = 0; paintSky(scene, tod); }
    const night = tod.star, dark = tod.dark;
    stars.setAlpha(night * 0.95); stars2.setAlpha(night);
    // ridges: far ones take more of the horizon colour (aerial perspective)
    layers.forEach((l, i) => {
      const haze = i === 0 ? 0.28 : i === 1 ? 0.12 : 0;
      l.img.setTint(mixCol(tod.ridge, tod.hor, haze * (1 - dark * 0.6)));
    });
    clouds.forEach((c) => { c.img.setTint(tod.cloud); });
    // celestial bodies along their arcs
    const q = p > 0.5 ? p - 1 : p;
    const sunY = 0.34 + 1.35 * Math.pow(Math.abs(q), 1.15);
    const sx = left + vw * (0.62 - q * 0.55);
    const sy = top + skyH * Math.min(1.05, sunY);
    sun.setPosition(sx, sy).setVisible(sy < horizonY + 8).setAlpha(clamp01(1.25 - sunY));
    sunGlow.setPosition(sx, sy).setAlpha(clamp01((1.15 - sunY) * 0.55) * (1 - night * 0.8)).setTint(mixCol(0xfff0a0, 0xff9a40, clamp01(sunY * 1.6 - 0.3)));
    const u = clamp01((p - 0.33) / 0.6);
    const mx = left + vw * (0.18 + 0.64 * u), my = top + skyH * (0.82 - 0.66 * Math.sin(u * Math.PI));
    const mAlpha = clamp01(night * 1.4) * (u > 0 && u < 1 ? 1 : 0);
    moon.setPosition(mx, my).setAlpha(mAlpha).setVisible(mAlpha > 0.02);
    moonGlow.setPosition(mx, my).setAlpha(mAlpha * 0.5);
    mist.forEach((m, i) => m.setTint(mixCol(tod.hor, tod.mid, 0.4)).setAlpha(0.1 + 0.2 * (1 - dark * 0.5)));
    const glowA = clamp01(0.25 + dark * 0.95);
    lanternGlow.setAlpha(glowA); winGlow.setAlpha(clamp01(0.15 + dark));
    const dim = clamp01(1 - dark * 0.85);
    motes.forEach((m) => { m.dim = clamp01(0.12 + dark * 0.95); });
    birds.forEach((b) => { b.vis = dim; });
    walkers.forEach((w) => { w.sprite.setTint(mixCol(0x0a1a0e, 0x142436, dark)); });
  };

  // initial paint
  applyTod(reduce ? START_P : ((START_P + clock / PERIOD) % 1), true);
  layers.forEach((l) => { l.img.x = cx; });
  attached.forEach((a) => { a.item.setPosition(mapX(a), mapY(a)); });
  if (reduce) { // static frame: place fireflies and clouds, nothing ever moves
    motes.forEach((m) => m.img.setAlpha(clamp01(m.dim) * 0.8));
    birds.forEach((b) => b.img.setVisible(false));
    smoke.forEach((s) => s.item.setVisible(false));
  }

  const onPointer = (p) => { pointerX = clamp01(p.x / Math.max(1, scene.scale.width)) - 0.5; };
  if (!reduce) scene.input.on('pointermove', onPointer);

  const bd = {
    alive: true,
    update(time, delta) {
      if (!this.alive || reduce) return;
      const dt = Math.min(0.1, delta / 1000);
      clock += dt; driftT += dt; tintAcc += dt; skyAcc += dt;
      const p = (START_P + clock / PERIOD) % 1;
      if (tintAcc > (canvasRenderer ? 1.0 : 0.25) || lastP < 0) { tintAcc = 0; lastP = p; applyTod(p); }
      const t = clock;
      // gentle camera drift + pointer parallax (per-layer factor)
      const dx = (Math.sin(t * 0.09) * 10 + pointerX * -16) * sr, dy = Math.sin(t * 0.06) * 1.6 * sr;
      layers.forEach((l) => { l.img.x = cx + dx * l.k; l.img.y = bottom + 1 + dy * l.k; });
      attached.forEach((a) => { a.item.setPosition(mapX(a), mapY(a)); });
      stars.x = cx + dx * 0.05; stars2.x = cx + dx * 0.05;
      stars2.setAlpha(tod.star * (0.55 + 0.45 * Math.sin(t * 2.3)));
      // flicker
      const fl = 0.85 + 0.15 * Math.sin(t * 9.3) * Math.sin(t * 5.1 + 1);
      lanternGlow.setScale(sr * 0.5 * fl);
      winGlow.setScale(sr * 0.32 * (0.95 + 0.05 * Math.sin(t * 3.7)));
      // clouds
      for (const c of clouds) {
        c.img.x += c.v * dt;
        const half = c.img.displayWidth / 2;
        if (c.img.x - half > left + vw) c.img.x = left - half;
        c.img.setAlpha(c.a * (1 - tod.dark * 0.55));
      }
      // smoke
      smoke.forEach((s, i) => {
        const ph = ((t * 0.18 + i / smoke.length) % 1);
        s.item.setPosition(mapX(s) + ph * 6 * sr + Math.sin(t + i) * sr, mapY(s) - ph * 22 * sr);
        s.item.setAlpha(Math.sin(ph * Math.PI) * 0.28).setScale(sr * (0.1 + ph * 0.22));
      });
      // fireflies
      for (const m of motes) {
        m.img.x = m.bx + Math.sin(t * m.a + m.ph) * m.amp;
        m.img.y = m.by + Math.cos(t * m.b + m.ph * 1.7) * m.amp * 0.6 - Math.sin(t * 0.4 + m.ph) * 6;
        m.img.setAlpha(m.dim * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * (1.1 + m.b) + m.ph * 3))));
      }
      // birds
      if (birds.length) {
        flockT -= dt;
        if (!flock && flockT <= 0 && tod.dark < 0.7) {
          flock = { x: left - 20, y: top + skyH * (0.2 + Math.random() * 0.35), v: (22 + Math.random() * 10) * sr };
          flockT = 30 + Math.random() * 30;
        }
        if (flock) {
          flock.x += flock.v * dt;
          birds.forEach((b, i) => {
            const bx = flock.x - i * 11 * sr, by = flock.y + Math.sin(t * 1.5 + i) * 3 * sr + (i % 2) * 6 * sr - i * 2 * sr;
            b.img.setPosition(bx, by).setVisible(true).setTexture(Math.floor(t * 5 + i) % 2 ? 'title.bird1' : 'title.bird0').setAlpha(b.vis ?? 1);
          });
          if (flock.x - 4 * 11 * sr > left + vw) { flock = null; birds.forEach((b) => b.img.setVisible(false)); }
        }
      }
      // shooting stars (night only)
      if (streaks.length) {
        streakT -= dt;
        if (streakT <= 0) {
          streakT = 14 + Math.random() * 26;
          const s = streaks.find((x) => !x.on);
          if (s && tod.star > 0.55) {
            const sp = (110 + Math.random() * 90) * sr;
            s.on = true; s.life = 0.85 + Math.random() * 0.5;
            s.x = left + vw * (0.1 + Math.random() * 0.85); s.y = top + skyH * (0.04 + Math.random() * 0.34);
            s.vx = -sp * (0.7 + Math.random() * 0.4); s.vy = sp * (0.35 + Math.random() * 0.3);
            s.img.setPosition(s.x, s.y).setVisible(true).setAlpha(tod.star)
              .setScale(sr * (0.7 + Math.random() * 0.5))
              .setAngle(Math.atan2(s.vy, s.vx) * (180 / Math.PI));
          }
        }
        for (const s of streaks) {
          if (!s.on) continue;
          s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
          s.img.setPosition(s.x, s.y).setAlpha(clamp01(s.life * 1.3) * clamp01(tod.star));
          if (s.life <= 0 || s.x < left - 40 || s.y > top + skyH + 24) { s.on = false; s.img.setVisible(false); }
        }
      }
      // walkers
      if (worldReady()) {
        for (const w of walkers) {
          if (w.wait > 0) { w.wait -= dt; if (w.wait <= 0) { spawnWalker(w, false); playWalk(w); } continue; }
          if (!w.kind) { w.wait = 3; continue; }
          w.x += w.dir * w.v * dt;
          const xi = Math.max(0, Math.min(RW - 1, Math.round(w.x)));
          const l = layers[2];
          w.sprite.setPosition(l.img.x + (w.x - RW / 2) * sr, l.img.y - (TH - nearTops[xi]) * sr + 1);
          playWalk(w);
          if (w.x < 10 || w.x > RW - 10) { w.sprite.setVisible(false); w.sprite.stop(); w.kind = ''; w.wait = 10 + Math.random() * 25; }
        }
      }
      // falling leaves / snow now and then
      if (parts.length) {
        weather.next -= dt;
        if (!weather.kind && weather.next <= 0) {
          weather = { kind: tod.dark > 0.8 && Math.random() < 0.6 ? 'snow' : 'leaf', until: t + 16 + Math.random() * 8, next: 0 };
        } else if (weather.kind && t > weather.until) weather = { kind: null, until: 0, next: 24 + Math.random() * 30 };
        for (let i = 0; i < parts.length; i++) {
          const pt = parts[i];
          if (!pt.on) {
            if (weather.kind && Math.random() < dt * 3) {
              pt.on = true; pt.kind = weather.kind;
              pt.img.setTexture(weather.kind === 'snow' ? 'title.flake' : `title.leaf${i % 3}`).setVisible(true).setPosition(left + Math.random() * (vw + 80) - 40, top - 6);
              pt.vx = (weather.kind === 'snow' ? 6 : 18) + Math.random() * 10; pt.vy = (weather.kind === 'snow' ? 14 : 20) + Math.random() * 12;
              pt.ph = Math.random() * 6.28; pt.spin = (Math.random() - 0.5) * 4;
            }
            continue;
          }
          pt.ph += dt * 2.2;
          pt.img.x += (pt.vx + Math.sin(pt.ph) * 14) * dt * sr;
          pt.img.y += pt.vy * dt * sr;
          pt.img.rotation += pt.spin * dt;
          pt.img.setAlpha(pt.kind === 'snow' ? 0.9 : 0.95);
          if (pt.img.y > bottom + 6 || pt.img.x > left + vw + 50) { pt.on = false; pt.img.setVisible(false); }
        }
      }
    },
    destroy() {
      this.alive = false;
      try { scene.input.off('pointermove', onPointer); } catch { /* scene gone */ }
    },
  };
  return bd;
}
