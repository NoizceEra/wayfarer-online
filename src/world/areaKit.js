// Shared Phaser-side helpers for the procedural maps (desert / marsh / caverns / Hollow Depths):
// baking a whole map into one canvas texture, solid-rect collision from a class grid,
// seeded decor scattering and the dark "light map" used by cave-style areas.
import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { hash2, vnoise } from './ground.js';
import { solidRects } from './areaGen.js';

export const T = CONFIG.tile;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
export const rgb = (c, d = 0) => `rgb(${clamp(c[0] + d, 0, 255) | 0},${clamp(c[1] + d, 0, 255) | 0},${clamp(c[2] + d, 0, 255) | 0})`;
export const hex = (n) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

// Bake the whole grid into ONE canvas texture + image (depth -10). `color(cls, px, py, tx, ty)` -> [r,g,b].
// `jitter` (px) warps the class lookup so borders between biomes come out ragged, not gridded.
// `detail(paint)` then stamps decals with a tiny painter API.
export function bakeArea(scene, key, grid, o, { color, jitter = 0, detail = null, cell = 4 }) {
  const W = grid.w * T, H = grid.h * T;
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const tex = scene.textures.createCanvas(key, W, H);
  const ctx = tex.getContext();
  for (let cy = 0; cy < H / cell; cy++) {
    for (let cx = 0; cx < W / cell; cx++) {
      const px = cx * cell + cell / 2, py = cy * cell + cell / 2;
      let gx = px, gy = py;
      if (jitter) { gx += (vnoise(px / 17, py / 17, 3) - 0.5) * jitter * 2; gy += (vnoise(px / 17 + 9, py / 17, 4) - 0.5) * jitter * 2; }
      const tx = clamp(Math.floor(gx / T), 0, grid.w - 1), ty = clamp(Math.floor(gy / T), 0, grid.h - 1);
      const c = color(grid.get(tx, ty), px, py, tx, ty);
      ctx.fillStyle = rgb(c, (hash2(cx, cy, 3) - 0.5) * 8);
      ctx.fillRect(cx * cell, cy * cell, cell, cell);
    }
  }
  const paint = {
    ctx,
    dot(x, y, r, col) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); },
    rect(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); },
    ell(x, y, rx, ry, col, rot = 0) { ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, 7); ctx.fill(); },
    line(x0, y0, x1, y1, col, w = 1) { ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); },
  };
  detail?.(paint, { W, H });
  tex.refresh();
  const img = scene.add.image(o.x, o.y, key).setOrigin(0, 0).setDepth(-10);
  return { tex, img, paint };
}

// Class grid -> static solid rects via ctx.solid (centre x/y, w, h in px).
export function addGridSolids(ctx, grid, isSolid) {
  const o = ctx.o;
  const rects = solidRects(grid, isSolid);
  for (const [x, y, w, h] of rects) ctx.solid(o.x + (x + w / 2) * T, o.y + (y + h / 2) * T, w * T, h * T);
  return rects.length;
}

// Seeded helpers
export const mkRnd = (seed) => { let s = (seed >>> 0) || 1; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };

// Random tiles satisfying pred(tx,ty), spaced >= minDist tiles apart (and from `avoid` points).
export function pickTiles(rnd, grid, n, pred, { minDist = 2, avoid = [], tries = 4000, region = null } = {}) {
  const out = [];
  const rx = region ? region[0] : 1, ry = region ? region[1] : 1, rw = region ? region[2] : grid.w - 2, rh = region ? region[3] : grid.h - 2;
  for (let t = 0; t < tries && out.length < n; t++) {
    const tx = rx + Math.floor(rnd() * rw), ty = ry + Math.floor(rnd() * rh);
    if (!pred(tx, ty)) continue;
    if (out.some((p) => Math.hypot(p.tx - tx, p.ty - ty) < minDist)) continue;
    if (avoid.some((p) => Math.hypot(p.tx - tx, p.ty - ty) < (p.r || minDist))) continue;
    out.push({ tx, ty });
  }
  return out;
}

// Cave-style darkness (same machinery as the Crypt: AreaManager._light erases holes around the
// hero and every entry of b.lights). Returns nothing; sets b.rt / b.lightImg.
export function addDarkness(ctx) {
  const { scene, def, o, b } = ctx;
  b.rt = scene.add.renderTexture(o.x, o.y, def.size.w * T, def.size.h * T).setOrigin(0).setDepth(2500);
  b.lightImg = scene.make.image({ x: 0, y: 0, key: 'fx.glow', add: false });
}

// Soft additive glow + registered light (night lighting / cave light map pick it up).
export function glowAt(scene, b, x, y, scale, alpha, tint, radius = 0) {
  if (!scene.textures.exists('fx.glow')) return null;
  const g = scene.add.image(x, y, 'fx.glow').setDepth(2550).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setScale(scale).setTint(tint);
  scene.tweens.add({ targets: g, alpha: alpha * 0.6, duration: 700 + ((x * 7 + y) % 500), yoyo: true, repeat: -1, ease: 'sine.inout' });
  if (radius) b.lights.push({ x, y, r: radius });
  return g;
}

export const FONT = '"Silkscreen", monospace';
export const label = (scene, x, y, text, color = '#fff') =>
  scene.add.text(x, y, text, { fontFamily: FONT, fontSize: '8px', color, backgroundColor: '#00000088' }).setOrigin(0.5).setDepth(2790);
