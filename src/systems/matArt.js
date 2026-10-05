// Procedural 16x16 material icons (same flat-ramp + 1px outline look as iconArt.js).
import { ramp } from './heroArt.js';
import { matById } from '../data/materials.js';

const OUT = [0x1a, 0x10, 0x24];
const W = [255, 255, 255];

export class G {
  constructor() { this.p = new Array(256).fill(null); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < 16 && y < 16) this.p[y * 16 + x] = c; return this; }
  r(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); return this; }
  rows(spans, c) { for (const [y, x0, x1] of spans) for (let x = x0; x <= x1; x++) this.px(x, y, c); return this; }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1; for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c); return this; }
  disc(cx, cy, r, c) { for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) this.px(cx + x, cy + y, c); return this; }
  get(x, y) { return x < 0 || y < 0 || x > 15 || y > 15 ? null : this.p[y * 16 + x]; }
  outline() {
    const add = [];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if (this.get(x, y)) continue;
      if (this.get(x - 1, y) || this.get(x + 1, y) || this.get(x, y - 1) || this.get(x, y + 1)) add.push(y * 16 + x);
    }
    for (const i of add) this.p[i] = OUT;
    return this;
  }
  canvas() {
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 16;
    const ctx = cv.getContext('2d');
    this.p.forEach((c, i) => { if (c) { ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`; ctx.fillRect(i % 16, (i / 16) | 0, 1, 1); } });
    return cv;
  }
}

const PAINT = {
  flower(g, a, b) { g.line(8, 15, 8, 8, b.mid); g.line(8, 13, 11, 11, b.lo); g.line(8, 12, 5, 10, b.mid); for (const [x, y] of [[8, 4], [5, 6], [11, 6], [6, 9], [10, 9]]) g.disc(x, y, 2, a.mid); g.disc(8, 7, 1, a.hi); g.px(8, 7, W); g.px(5, 5, a.hi); g.px(11, 5, a.hi); },
  leaf(g, a, b) { g.rows([[2, 8, 10], [3, 6, 12], [4, 5, 13], [5, 4, 13], [6, 4, 12], [7, 4, 11], [8, 5, 10], [9, 6, 9]], a.mid); g.line(3, 13, 11, 4, b.mid); g.r(6, 4, 3, 2, a.hi); g.line(3, 13, 5, 11, b.lo); g.px(7, 5, W); },
  berries(g, a, b) { g.line(8, 2, 8, 6, b.mid); g.rows([[2, 6, 7], [3, 7, 10], [3, 5, 6]], b.mid); g.disc(5, 9, 3, a.mid); g.disc(11, 9, 3, a.mid); g.disc(8, 12, 2, a.mid); g.px(4, 8, a.hi); g.px(10, 8, a.hi); g.px(7, 11, a.hi); g.px(6, 11, a.lo); g.px(12, 11, a.lo); },
  log(g, a, b) { g.r(2, 5, 12, 7, a.mid); g.r(2, 5, 12, 2, a.hi); g.r(2, 11, 12, 1, a.lo); g.disc(13, 8, 3, b.mid); g.disc(13, 8, 2, a.hi); g.px(13, 8, a.lo); g.px(3, 8, a.lo); g.px(6, 9, a.lo); g.px(8, 7, a.lo2); },
  ore(g, a, b) { g.rows([[3, 5, 10], [4, 3, 12], [5, 2, 13], [6, 2, 13], [7, 3, 13], [8, 3, 12], [9, 4, 12], [10, 5, 11], [11, 6, 10]], a.mid); g.r(3, 4, 4, 2, a.hi); g.r(9, 8, 4, 3, a.lo); for (const [x, y] of [[5, 7], [9, 6], [7, 9], [11, 5]]) { g.px(x, y, b.mid); g.px(x + 1, y, b.hi); } },
  bone(g, a, b) { g.line(4, 12, 12, 4, a.mid); g.line(5, 12, 12, 5, a.hi); g.line(4, 11, 11, 4, a.lo); g.disc(3, 13, 2, a.mid); g.disc(13, 3, 2, a.mid); g.disc(3, 11, 1, a.hi); g.disc(11, 3, 1, a.hi); g.px(5, 14, b.mid); g.px(14, 5, b.mid); },
  crystal(g, a, b) { g.rows([[1, 7, 8], [2, 6, 9], [3, 5, 10], [4, 5, 10], [5, 5, 10], [6, 5, 10], [7, 5, 10], [8, 5, 10], [9, 6, 9], [10, 7, 8]], a.mid); g.r(5, 3, 2, 6, a.hi); g.r(9, 4, 2, 5, a.lo); g.px(6, 3, W); g.px(6, 4, W); g.rows([[8, 1, 3], [9, 1, 3]], a.lo); g.px(12, 6, b.mid); g.px(13, 7, b.hi); g.px(3, 11, b.mid); },
  fish(g, a, b) { g.rows([[5, 4, 11], [6, 3, 12], [7, 2, 12], [8, 2, 12], [9, 3, 12], [10, 4, 11]], a.mid); g.rows([[6, 12, 14], [7, 13, 14], [8, 13, 14], [9, 12, 14], [5, 13, 14], [10, 13, 14]], a.lo); g.r(3, 8, 9, 2, b.mid); g.r(4, 5, 7, 1, a.hi); g.px(4, 7, W); g.px(4, 6, OUT); g.line(6, 6, 6, 9, a.lo); g.line(8, 6, 8, 9, a.lo); g.px(9, 4, a.lo); g.px(8, 3, a.lo); },
  gel(g, a, b) { g.rows([[4, 6, 9], [5, 5, 10], [6, 4, 11], [7, 3, 12], [8, 3, 12], [9, 2, 13], [10, 2, 13], [11, 3, 12], [12, 4, 11]], a.mid); g.r(5, 6, 3, 2, b.mid); g.px(6, 5, W); g.r(9, 10, 3, 2, a.lo); g.px(5, 9, b.mid); },
  wing(g, a, b) { g.rows([[3, 11, 13], [4, 8, 13], [5, 6, 13], [6, 4, 12], [7, 3, 11], [8, 3, 9], [9, 3, 7], [10, 3, 4]], a.mid); g.line(3, 10, 12, 4, b.mid); g.line(5, 9, 11, 6, b.lo); g.r(11, 4, 2, 2, a.hi); g.px(4, 8, b.hi); g.px(3, 9, a.lo); g.px(3, 10, a.lo); },
  spike(g, a, b) { g.rows([[1, 10, 11], [2, 9, 11], [3, 9, 10], [4, 8, 10], [5, 7, 9], [6, 6, 9], [7, 6, 8], [8, 5, 8], [9, 5, 7], [10, 4, 7], [11, 4, 6], [12, 3, 5]], a.mid); g.line(10, 1, 4, 12, b.mid); g.r(2, 13, 4, 2, a.lo); g.px(4, 11, b.hi); },
  spore(g, a, b) { g.rows([[3, 5, 10], [4, 3, 12], [5, 2, 13], [6, 2, 13], [7, 3, 12]], b.mid); g.r(6, 8, 4, 5, a.mid); g.r(6, 8, 1, 5, a.hi); g.r(9, 9, 1, 4, a.lo); for (const [x, y] of [[4, 5], [8, 4], [11, 6], [6, 6]]) g.px(x, y, a.hi); g.px(2, 12, a.mid); g.px(13, 11, a.mid); g.px(11, 14, a.mid); },
  dust(g, a, b) { g.rows([[7, 5, 10], [8, 3, 12], [9, 2, 13], [10, 2, 13], [11, 3, 12], [12, 5, 10]], a.mid); g.r(5, 8, 4, 2, a.hi); g.r(9, 10, 4, 2, a.lo); for (const [x, y] of [[3, 4], [8, 3], [12, 5], [6, 5], [10, 2]]) g.px(x, y, b.mid); g.px(8, 4, a.hi); },
  vial(g, a, b) { g.r(6, 1, 4, 2, [150, 100, 60]); g.r(7, 3, 2, 3, b.mid); g.rows([[6, 7, 8], [7, 5, 10], [8, 4, 11], [9, 4, 11], [10, 4, 11], [11, 4, 11], [12, 5, 10], [13, 6, 9]], b.mid); g.rows([[8, 5, 10], [9, 5, 10], [10, 5, 10], [11, 5, 10], [12, 6, 9]], a.mid); g.r(5, 8, 2, 1, a.hi); g.px(5, 9, W); g.r(9, 11, 2, 1, a.lo); g.px(7, 4, W); },
  bread(g, a, b) { g.rows([[5, 3, 12], [6, 2, 13], [7, 2, 13], [8, 2, 13], [9, 2, 13], [10, 3, 12], [11, 4, 11]], b.mid); g.r(4, 6, 8, 4, a.mid); g.r(3, 5, 10, 1, a.hi); g.r(5, 7, 1, 2, a.hi); g.r(9, 7, 1, 2, a.lo); g.px(7, 8, a.hi); g.px(11, 6, a.lo2); },
  bowl(g, a, b) { g.rows([[5, 3, 12], [6, 2, 13]], a.mid); g.r(3, 5, 10, 1, b.mid); g.rows([[7, 2, 13], [8, 3, 12], [9, 3, 12], [10, 4, 11], [11, 5, 10]], [150, 100, 70]); g.r(3, 7, 10, 1, [190, 140, 100]); g.px(6, 5, a.hi); g.px(9, 6, a.lo); g.px(10, 4, b.hi); g.px(5, 3, W); g.px(8, 2, W); },
  ingot(g, a, b) { g.rows([[5, 4, 13], [6, 3, 12], [7, 2, 12], [8, 2, 11], [9, 2, 11], [10, 3, 10]], a.mid); g.r(4, 5, 9, 1, a.hi); g.r(3, 6, 9, 1, a.hi); g.r(3, 9, 9, 1, b.mid); g.r(11, 6, 2, 2, b.mid); g.px(5, 7, W); g.px(6, 7, W); },
  scroll(g, a, b) { g.r(3, 3, 10, 10, b.mid); g.r(3, 3, 10, 1, [255, 248, 224]); g.r(2, 2, 2, 12, a.mid); g.r(12, 2, 2, 12, a.mid); g.r(2, 2, 12, 1, a.hi); g.r(2, 13, 12, 1, a.lo); for (const y of [5, 7, 9]) g.r(5, y, 6, 1, a.lo); g.px(10, 11, a.mid); },
  letter(g, a, b) { g.r(2, 4, 12, 9, a.mid); g.r(2, 4, 12, 1, a.hi); g.line(2, 5, 8, 9, a.lo); g.line(13, 5, 8, 9, a.lo); g.r(2, 12, 12, 1, a.lo); g.disc(8, 9, 2, b.mid); g.px(7, 8, b.hi); },
  shell(g, a, b) { g.rows([[3, 6, 9], [4, 4, 11], [5, 3, 12], [6, 2, 13], [7, 2, 13], [8, 3, 12], [9, 4, 11], [10, 5, 10]], a.mid); g.r(4, 4, 3, 2, a.hi); for (const x of [5, 8, 10]) g.line(8, 10, x, 4, a.lo); g.r(3, 9, 3, 1, b.mid); g.px(5, 4, W); g.px(11, 8, a.lo); },
  cloth(g, a, b) { g.rows([[3, 3, 12], [4, 2, 13], [5, 2, 13], [6, 3, 13], [7, 3, 12], [8, 2, 12], [9, 3, 13], [10, 4, 13], [11, 5, 12], [12, 5, 10]], a.mid); g.r(3, 4, 4, 2, a.hi); g.line(4, 8, 11, 8, a.lo); g.px(3, 6, b.mid); g.px(12, 9, b.mid); g.px(8, 12, b.mid); g.px(6, 11, a.lo); },
  // Wave 2 expanded materials / relics
  rune_slab(g, a, b) {
    g.rows([[2, 4, 11], [3, 3, 12], [4, 3, 12], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 12], [10, 3, 12], [11, 3, 12], [12, 3, 12], [13, 4, 11]], a.mid);
    g.line(4, 2, 11, 2, a.hi); g.line(3, 3, 3, 12, a.hi);
    g.line(12, 3, 12, 12, a.lo); g.line(4, 13, 11, 13, a.lo);
    g.px(5, 4, a.lo); g.px(10, 11, a.lo); g.px(4, 8, a.lo2);
    g.line(7, 4, 7, 10, b.mid); g.line(8, 4, 8, 10, b.hi);
    g.px(7, 4, W); g.px(8, 4, W); g.px(7, 10, W); g.px(8, 10, W);
    g.line(5, 5, 7, 7, b.hi); g.line(10, 5, 8, 7, b.hi);
    g.px(5, 5, W); g.px(10, 5, W);
    g.line(5, 9, 7, 7, b.mid); g.line(10, 9, 8, 7, b.mid);
    g.px(7, 7, W); g.px(8, 7, W);
    g.px(6, 6, b.lo); g.px(9, 6, b.lo); g.px(6, 8, b.lo); g.px(9, 8, b.lo);
  },
  elemental_core(g, a, b) {
    g.disc(8, 8, 3, a.mid); g.disc(8, 8, 2, a.hi);
    g.px(7, 6, W); g.px(8, 6, W); g.px(7, 7, W);
    g.disc(9, 10, 1, a.lo);
    g.r(7, 1, 2, 2, b.hi); g.px(6, 2, b.mid); g.px(9, 2, b.mid);
    g.r(7, 13, 2, 2, b.lo); g.px(6, 13, b.mid); g.px(9, 13, b.mid);
    g.line(6, 2, 3, 5, b.hi); g.line(3, 5, 2, 8, b.hi); g.line(2, 8, 3, 11, b.mid); g.line(3, 11, 6, 13, b.lo);
    g.line(9, 2, 12, 5, b.hi); g.line(12, 5, 13, 8, b.mid); g.line(13, 8, 12, 11, b.lo); g.line(12, 11, 9, 13, b.lo);
    g.px(2, 8, W); g.px(13, 8, b.hi);
    g.px(8, 8, W); g.px(5, 7, a.hi); g.px(11, 9, a.hi);
  },
  phoenix_feather(g, a, b) {
    g.line(3, 13, 11, 3, b.hi); g.line(3, 14, 5, 12, b.mid); g.px(12, 2, W);
    g.rows([[3, 9, 11], [4, 7, 11], [5, 5, 10], [6, 4, 9], [7, 3, 8], [8, 3, 7], [9, 2, 6], [10, 3, 5], [11, 3, 4]], a.mid);
    g.line(6, 7, 10, 4, a.hi); g.line(5, 8, 8, 6, a.hi); g.px(8, 5, W); g.px(9, 4, W);
    g.rows([[4, 11, 12], [5, 10, 13], [6, 9, 12], [7, 8, 11], [8, 8, 10], [9, 7, 9], [10, 6, 8]], a.lo);
    g.line(9, 5, 12, 5, a.hi); g.px(12, 6, a.hi); g.px(11, 7, a.mid);
    g.px(13, 1, W); g.px(14, 3, b.hi); g.px(1, 9, a.hi); g.px(1, 8, b.hi); g.px(6, 2, b.mid); g.px(10, 11, a.hi); g.px(13, 9, b.hi);
  },
  void_shard(g, a, b) {
    g.rows([[2, 7, 8], [3, 6, 10], [4, 5, 11], [5, 4, 12], [6, 4, 12], [7, 3, 13], [8, 3, 12], [9, 4, 11], [10, 5, 10], [11, 5, 9], [12, 6, 8], [13, 7, 7]], a.mid);
    g.line(4, 5, 7, 13, a.lo2); g.line(5, 5, 6, 11, a.lo);
    g.line(7, 2, 7, 9, a.lo); g.line(7, 9, 9, 11, a.mid); g.line(8, 3, 11, 7, a.lo2);
    g.line(7, 2, 10, 4, b.hi); g.px(7, 2, W); g.px(8, 2, W);
    g.line(10, 4, 13, 7, b.hi); g.line(13, 7, 11, 10, b.mid); g.px(12, 6, W);
    g.line(6, 3, 4, 6, b.mid); g.px(4, 6, b.hi);
    g.line(7, 5, 9, 7, b.hi); g.px(8, 6, W);
    g.px(2, 4, b.mid); g.px(2, 3, b.hi); g.px(13, 11, b.mid); g.px(14, 10, b.hi); g.px(4, 13, b.lo);
    g.px(12, 3, W); g.px(3, 8, b.hi);
  },
};

export function matCanvas(m) {
  const a = ramp(m.color), b = ramp(m.trim ?? m.color);
  const g = new G();
  (PAINT[m.icon] || PAINT.shell)(g, a, b);
  g.outline();
  return g.canvas();
}
// Texture key `mat.icon.<id>` (created on demand).
export function matIconKey(scene, id) {
  const k = `mat.icon.${id}`;
  if (!scene.textures.exists(k)) {
    const m = matById(id);
    if (!m) return 'char.shadow';
    scene.textures.addCanvas(k, matCanvas(m));
  }
  return k;
}
