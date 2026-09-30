// Hero art helpers: runtime palette-swap of the real 16x16 Ninja Adventure body
// sheets (so skin / outfit / hair colours recolour the actual pixel art instead
// of painting flat rectangles over it), plus pixel-authored hair overlays.
const OUTLINE = [0x14, 0x1b, 0x1b];

const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];
const mix = (c, t, a) => c.map((v, i) => Math.round(v + (t[i] - v) * a));
const key = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
export function ramp(tint) {
  const c = hex(tint);
  return { hi: mix(c, [255, 255, 255], 0.28), mid: c, lo: mix(c, [0, 0, 0], 0.3), lo2: mix(c, [0, 0, 0], 0.5) };
}

// Per body: source colour → [role, group]. group: skin | outfit | hair.
const R = (g, r) => [g, r];
export const BODY_ROLES = {
  Villager: {
    f2ad7d: R('skin', 'hi'), ef914f: R('skin', 'mid'), d14b34: R('skin', 'lo'),
    548789: R('outfit', 'mid'), '79b8ce': R('outfit', 'hi'), '4e484a': R('outfit', 'lo'),
  },
  ManGreen: {
    f1c471: R('skin', 'hi'), ef914f: R('skin', 'mid'), d78b4a: R('skin', 'lo'),
    a8a129: R('outfit', 'hi'), '56864c': R('outfit', 'mid'),
  },
  SorcererOrange: {
    f2ad7d: R('skin', 'hi'), ef914f: R('skin', 'mid'), cf736d: R('skin', 'lo'),
    e46d3a: R('outfit', 'mid'),
    '9ba7aa': R('hair', 'hi'), '5f7160': R('hair', 'mid'), '4e484a': R('hair', 'lo'),
  },
  NinjaDark: {
    ef914f: R('skin', 'mid'),
    '5f7160': R('outfit', 'mid'), '4e484a': R('outfit', 'lo'), '3b3643': R('outfit', 'lo2'),
  },
};
// Bodies whose head is bare, so the hair overlay sits on it.
export const BARE_HEAD = { Villager: true };

function srcCanvas(scene, texKey) {
  const img = scene.textures.get(texKey).getSourceImage();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

// Returns the texture key of the recoloured sheet (cached), frames 0..27.
export function bodyVariant(scene, body, skin, outfitTint, hairTint) {
  const base = `char.${body}`;
  const roles = BODY_ROLES[body];
  if (!roles || !scene.textures.exists(base)) return base;
  const vkey = `hero.${body}.${skin.toString(16)}.${outfitTint.toString(16)}.${hairTint.toString(16)}`;
  if (scene.textures.exists(vkey)) return vkey;
  const ramps = { skin: ramp(skin), outfit: ramp(outfitTint), hair: ramp(hairTint) };
  const table = new Map();
  for (const [h, [g, r]] of Object.entries(roles)) table.set(parseInt(h, 16), ramps[g][r]);
  const cv = srcCanvas(scene, base);
  const ctx = cv.getContext('2d');
  const im = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const to = table.get(key([d[i], d[i + 1], d[i + 2]]));
    if (to) { d[i] = to[0]; d[i + 1] = to[1]; d[i + 2] = to[2]; }
  }
  ctx.putImageData(im, 0, 0);
  const tex = scene.textures.addCanvas(vkey, cv);
  const cols = Math.floor(cv.width / 16), rows = Math.floor(cv.height / 16);
  for (let f = 0; f < cols * rows; f++) tex.add(f, 0, (f % cols) * 16, Math.floor(f / cols) * 16, 16, 16);
  ensureAnims(scene, vkey);
  return vkey;
}

const DIRS = ['down', 'up', 'left', 'right'];
export function ensureAnims(scene, k) {
  const A = scene.anims;
  DIRS.forEach((dir, col) => {
    const mk = (suffix, cfg) => { if (!A.exists(`${k}.${suffix}.${dir}`)) A.create({ key: `${k}.${suffix}.${dir}`, ...cfg }); };
    mk('walk', { frames: [col, col + 4, col + 8, col + 12].map((f) => ({ key: k, frame: f })), frameRate: 8, repeat: -1 });
    mk('idle', { frames: [{ key: k, frame: col }], frameRate: 1 });
    mk('attack', { frames: [{ key: k, frame: 16 + col }], frameRate: 1 });
  });
}

// ── hair overlays (20x20 canvas, sprite coords offset by 2) ──────────────
// Head silhouette x-range per sprite row (front/back view).
const SIL = { 2: [4, 11], 3: [3, 12], 4: [2, 13] };
const sil = (r) => SIL[r] || [1, 14];
const full = (a, b) => { const o = []; for (let r = a; r <= b; r++) o.push([r, ...sil(r)]); return o; };

function hairSpans(style, dir) {
  const side = dir === 'left' || dir === 'right';
  let s = [];
  if (dir === 'up') {
    const end = { crop: 6, mop: 8, bob: 10, tail: 7, bun: 6 }[style];
    s = full(2, end);
    if (style === 'tail') s.push([8, 6, 9], [9, 6, 9], [10, 6, 9], [11, 7, 8], [12, 7, 8], [13, 7, 8]);
    if (style === 'bun') s.push([0, 6, 9], [1, 5, 10]);
  } else if (side) {
    // drawn for 'left' (face toward x=small, eyes at x~3); mirrored for 'right'
    const rows = (a, b, x0, x1) => { const o = []; for (let r = a; r <= b; r++) o.push([r, x0, x1]); return o; };
    if (style === 'crop') s = [...full(2, 3), [4, 6, 13]];
    if (style === 'mop')  s = [...full(2, 4), ...rows(5, 8, 8, 14)];
    if (style === 'bob')  s = [...full(2, 4), ...rows(5, 10, 7, 14)];
    if (style === 'tail') s = [...full(2, 3), [4, 6, 13], ...rows(5, 7, 9, 14), ...rows(7, 11, 14, 15)];
    if (style === 'bun')  s = [...full(2, 3), [4, 6, 13], ...rows(5, 6, 9, 14), [0, 9, 12], [1, 8, 13]];
  } else {
    if (style === 'crop') s = [...full(2, 3), [4, 2, 4], [4, 11, 13]];
    if (style === 'mop')  s = [...full(2, 4), [5, 1, 5], [5, 7, 9], [5, 11, 14], [6, 1, 2], [6, 13, 14], [7, 1, 2], [7, 13, 14]];
    if (style === 'bob')  s = [...full(2, 4), [5, 1, 4], [5, 6, 9], [5, 11, 14], [6, 1, 2], [6, 13, 14], [7, 1, 2], [7, 13, 14], [8, 1, 2], [8, 13, 14], [9, 1, 2], [9, 13, 14], [10, 1, 2], [10, 13, 14]];
    if (style === 'tail') s = [...full(2, 3), [4, 2, 4], [4, 11, 13], [5, 14, 15], [6, 14, 15], [7, 14, 15], [8, 14, 15], [9, 14, 15]];
    if (style === 'bun')  s = [...full(2, 3), [4, 2, 4], [4, 11, 13], [0, 6, 9], [1, 5, 10]];
  }
  return s;
}

// Chibi-scaled scarf: a 2px band at the neck with a short tail.
export function scarfTexture(scene, dir) {
  const k = `hero.scarf.${dir}`;
  if (scene.textures.exists(k)) return k;
  const cv = document.createElement('canvas'); cv.width = 20; cv.height = 20;
  const ctx = cv.getContext('2d');
  const px = (x, y, c) => { ctx.fillStyle = c; ctx.fillRect(x + 2, y + 2, 1, 1); };
  const O = '#141b1b', M = '#c9601c', L = '#e88a2e', D = '#8f3f12';
  const band = (x0, x1, r) => { for (let x = x0; x <= x1; x++) { px(x, r - 0, O); } };
  const x0 = dir === 'up' || dir === 'down' ? 3 : 4, x1 = dir === 'up' || dir === 'down' ? 12 : 11;
  for (let x = x0 - 1; x <= x1 + 1; x++) { px(x, 13, O); }
  px(x0 - 1, 11, O); px(x0 - 1, 12, O); px(x1 + 1, 11, O); px(x1 + 1, 12, O);
  for (let x = x0; x <= x1; x++) { px(x, 11, L); px(x, 12, M); }
  for (let x = x0; x <= x1; x += 3) px(x, 12, D);
  const tx = { down: 10, up: 9, left: 11, right: 4 }[dir];
  const tail = dir === 'up' ? [[8, 9]] : [[tx, tx + 1]];
  void tail;
  const t0 = dir === 'up' ? 7 : tx; const tw = dir === 'up' ? 2 : 2;
  for (let r = 13; r <= 15; r++) {
    px(t0 - 1, r, O); px(t0 + tw, r, O);
    for (let x = t0; x < t0 + tw; x++) px(x, r, r === 13 ? M : D);
  }
  for (let x = t0; x < t0 + tw; x++) px(x, 16, O);
  scene.textures.addCanvas(k, cv);
  return k;
}

export function hairTexture(scene, style, dir, tint) {
  const k = `hero.hair.${style}.${dir}.${tint.toString(16)}`;
  if (scene.textures.exists(k)) return k;
  const N = 20, O = 2;
  const mask = new Set();
  for (const [r, x0, x1] of hairSpans(style, dir)) {
    for (let x = x0; x <= x1; x++) mask.add(dir === 'right' ? `${15 - x},${r}` : `${x},${r}`);
  }
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const ctx = cv.getContext('2d');
  const rp = ramp(tint);
  const px = (x, y, c) => { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(x + O, y + O, 1, 1); };
  const has = (x, y) => mask.has(`${x},${y}`);
  for (const p of mask) {
    const [x, y] = p.split(',').map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!has(x + dx, y + dy)) px(x + dx, y + dy, OUTLINE);
  }
  for (const p of mask) {
    const [x, y] = p.split(',').map(Number);
    let c = rp.mid;
    if (!has(x, y + 1)) c = rp.lo;              // underside shade
    else if (!has(x, y - 1) && y >= 3) c = rp.hi; // top edge light
    if (y === 3 && x >= 4 && x <= 6) c = rp.hi;
    px(x, y, c);
  }
  scene.textures.addCanvas(k, cv);
  return k;
}
