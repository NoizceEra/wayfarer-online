// Procedural 16x16 inventory icons in the style of hudIcons.js: flat fills on
// a shared set of 4-tone ramps, then an automatic 1px dark outline around the
// silhouette. One painter per style family; colours come from the item (and its
// dye), so a dyed cape shows up dyed in the bag too.
import { ramp } from './heroArt.js';

const OUT = [0x1a, 0x10, 0x24];
const WHITE = [255, 255, 255];
const GOLD = [232, 178, 42], WOOD = [138, 90, 43], WOODLO = [90, 58, 26], STEEL = [201, 211, 220], STEELLO = [125, 138, 154];

export class G {
  constructor() { this.p = new Array(256).fill(null); }
  px(x, y, c) { x = Math.round(x); y = Math.round(y); if (c && x >= 0 && y >= 0 && x < 16 && y < 16) this.p[y * 16 + x] = c; return this; }
  r(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, c); return this; }
  rows(spans, c) { for (const [y, x0, x1] of spans) for (let x = x0; x <= x1; x++) this.px(x, y, c); return this; }
  line(x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
    return this;
  }
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

export const ICON = {
  // head
  brim(g, a, b) { g.rows([[3, 6, 9], [4, 5, 10], [5, 4, 11], [6, 4, 11]], a.mid); g.r(4, 7, 8, 1, b.mid); g.r(1, 8, 14, 2, a.hi); g.r(2, 10, 12, 1, a.lo); g.r(5, 4, 2, 1, a.hi); },
  cap(g, a, b) { g.rows([[4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12]], a.mid); g.r(4, 4, 3, 1, a.hi); g.r(3, 5, 2, 3, a.hi); g.r(10, 6, 3, 3, a.lo); g.r(2, 9, 9, 2, a.lo); g.r(7, 5, 1, 3, a.lo2); },
  cap_feather(g, a, b) { ICON.cap(g, a, b); g.line(11, 4, 14, 0, b.mid); g.line(12, 4, 14, 2, b.hi); g.px(12, 5, b.lo); },
  helm(g, a, b) { g.rows([[3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 4], [10, 3, 4]], a.mid); g.rows([[9, 11, 12], [10, 11, 12]], a.lo); g.r(3, 4, 2, 6, a.hi); g.r(11, 5, 2, 4, a.lo); g.r(4, 7, 8, 1, OUT); g.r(7, 7, 2, 4, a.mid); g.px(5, 5, WHITE); },
  helm_plume(g, a, b) { ICON.helm(g, a, b); g.rows([[0, 6, 9], [1, 5, 10], [2, 6, 9]], b.mid); g.r(7, 0, 2, 1, b.hi); },
  horns(g, a, b) { g.rows([[5, 5, 10], [6, 4, 11], [7, 3, 12], [8, 3, 12], [9, 3, 12]], a.mid); g.r(3, 6, 2, 3, a.hi); g.r(11, 7, 2, 2, a.lo); g.line(3, 6, 1, 3, b.mid); g.line(1, 3, 2, 1, b.hi); g.line(12, 6, 14, 3, b.mid); g.line(14, 3, 13, 1, b.lo); g.r(4, 9, 8, 1, a.lo); },
  cone(g, a, b, o) { g.rows([[0, 9, 10], [1, 8, 10], [2, 7, 10], [3, 6, 10], [4, 6, 10], [5, 5, 10], [6, 5, 11], [7, 4, 11]], a.mid); g.r(5, 5, 2, 3, a.hi); g.r(1, 9, 14, 2, a.hi); g.r(2, 11, 12, 1, a.lo); g.r(5, 8, 7, 1, o ? a.mid : b.mid); if (o) { g.px(8, 3, b.mid); g.px(9, 6, b.mid); g.px(6, 5, b.mid); g.px(12, 10, b.mid); g.px(4, 10, b.mid); } },
  cone_stars(g, a, b) { ICON.cone(g, a, b, true); },
  crown(g, a, b, gem) { g.r(3, 8, 10, 4, a.mid); g.r(3, 8, 10, 1, a.hi); g.r(3, 11, 10, 1, a.lo); g.r(3, 4, 2, 4, a.mid); g.r(7, 2, 2, 6, a.mid); g.r(11, 4, 2, 4, a.mid); g.px(3, 4, a.hi); g.px(7, 2, a.hi); g.px(11, 4, a.hi); g.px(5, 7, a.mid); g.px(10, 7, a.mid); if (gem) { g.r(7, 9, 2, 2, b.mid); g.px(7, 9, b.hi); } else { g.px(7, 2, b.mid); g.px(3, 4, b.mid); g.px(12, 4, b.mid); g.px(7, 9, b.mid); g.px(8, 10, b.lo); } },
  crown_gem(g, a, b) { ICON.crown(g, a, b, true); },
  hood(g, a, b) { g.rows([[2, 6, 9], [3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 12], [10, 4, 11], [11, 4, 11]], a.mid); g.r(5, 3, 2, 1, a.hi); g.r(4, 4, 2, 1, a.hi); g.r(3, 5, 2, 5, a.hi); g.r(11, 5, 2, 6, a.lo); g.r(6, 6, 4, 4, OUT); g.r(6, 6, 4, 1, a.lo2); g.px(7, 9, [240, 200, 160]); g.px(8, 9, [240, 200, 160]); g.px(7, 7, [240, 200, 160]); g.px(8, 7, [240, 200, 160]); g.px(7, 8, [240, 200, 160]); g.px(8, 8, [240, 200, 160]); },
  veil(g, a, b) { g.rows([[2, 6, 9], [3, 5, 10], [4, 4, 11], [5, 3, 12], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 3, 12], [10, 3, 12]], a.mid); g.r(5, 3, 2, 1, a.hi); g.r(3, 5, 2, 5, a.hi); g.r(11, 4, 2, 7, a.lo); g.r(5, 6, 2, 2, OUT); g.r(9, 6, 2, 2, OUT); g.r(6, 9, 4, 1, a.lo); g.px(4, 11, a.mid); g.px(7, 11, a.mid); g.px(10, 11, a.mid); g.px(7, 12, a.lo); },
  band(g, a, b) { g.r(2, 6, 12, 3, a.mid); g.r(2, 6, 12, 1, a.hi); g.r(2, 8, 12, 1, a.lo); for (let x = 4; x < 13; x += 3) g.px(x, 7, b.mid); g.r(12, 9, 3, 2, a.mid); g.px(14, 11, a.lo); g.px(13, 12, a.lo); g.r(11, 9, 2, 1, a.hi); },
  ears(g, a, b) { g.r(2, 10, 12, 2, a.lo); g.rows([[3, 3, 3], [4, 3, 4], [5, 3, 5], [6, 3, 5], [7, 3, 5], [8, 3, 5], [9, 3, 5]], a.mid); g.rows([[3, 12, 12], [4, 11, 12], [5, 10, 12], [6, 10, 12], [7, 10, 12], [8, 10, 12], [9, 10, 12]], a.mid); g.r(4, 6, 1, 4, b.mid); g.r(11, 6, 1, 4, b.mid); g.px(3, 4, a.hi); g.px(12, 4, a.hi); },
  wreath(g, a, b) { for (let i = 0; i < 14; i++) { const t = (i / 14) * Math.PI * 2; g.px(8 + Math.cos(t) * 5.5, 8 + Math.sin(t) * 4.5, i % 2 ? a.mid : a.hi); g.px(8 + Math.cos(t) * 4.5, 8 + Math.sin(t) * 3.6, a.lo); } for (const [x, y] of [[8, 3], [13, 8], [3, 8], [5, 12], [11, 12]]) { g.px(x, y, b.mid); } g.px(8, 3, WHITE); g.px(3, 8, b.hi); },
  // face
  glasses(g, a, b) { for (const x0 of [1, 9]) { g.r(x0, 5, 6, 1, a.mid); g.r(x0, 9, 6, 1, a.mid); g.r(x0, 5, 1, 5, a.mid); g.r(x0 + 5, 5, 1, 5, a.mid); g.r(x0 + 1, 6, 4, 3, [190, 230, 255]); g.px(x0 + 1, 6, WHITE); } g.r(7, 6, 2, 1, a.mid); },
  shades(g, a, b) { g.r(1, 5, 6, 4, a.mid); g.r(9, 5, 6, 4, a.mid); g.r(7, 5, 2, 1, a.mid); g.px(2, 5, b.hi); g.px(3, 6, b.mid); g.px(10, 5, b.hi); g.px(11, 6, b.mid); g.r(1, 8, 6, 1, a.lo); g.r(9, 8, 6, 1, a.lo); },
  eyepatch(g, a) { g.line(1, 3, 14, 5, a.lo); g.line(1, 4, 14, 6, a.lo); g.disc(10, 8, 3, a.mid); g.px(9, 7, a.hi); g.px(11, 9, a.lo); },
  mask(g, a, b) { g.rows([[4, 1, 14], [5, 1, 14], [6, 1, 14], [7, 2, 13], [8, 3, 12]], a.mid); g.r(1, 4, 14, 1, a.hi); g.r(3, 6, 3, 2, OUT); g.r(10, 6, 3, 2, OUT); g.r(2, 8, 12, 1, a.lo); g.px(1, 6, a.lo); g.px(14, 6, a.lo); },
  monocle(g, a, b) { g.disc(6, 7, 3, a.mid); g.disc(6, 7, 2, [214, 243, 255]); g.px(5, 6, WHITE); g.line(8, 10, 10, 14, a.hi); g.px(10, 14, a.lo); g.px(9, 12, a.mid); },
  foxmask(g, a, b) { g.rows([[2, 3, 4], [3, 3, 5], [4, 3, 12], [5, 2, 13], [6, 2, 13], [7, 2, 13], [8, 3, 12], [9, 4, 11], [10, 5, 10], [11, 6, 9], [2, 11, 12], [3, 10, 12]], a.mid); g.r(3, 5, 2, 2, OUT); g.r(11, 5, 2, 2, OUT); g.r(7, 3, 2, 2, b.mid); g.r(3, 8, 2, 1, b.mid); g.r(11, 8, 2, 1, b.mid); g.r(7, 9, 2, 1, OUT); g.px(4, 2, b.lo); g.px(11, 2, b.lo); g.r(2, 6, 1, 2, a.hi); },
  // body
  tunic(g, a, b) { g.r(4, 2, 8, 11, a.mid); g.r(0, 3, 4, 4, a.mid); g.r(12, 3, 4, 4, a.mid); g.r(4, 2, 2, 11, a.hi); g.r(10, 4, 2, 9, a.lo); g.r(0, 6, 4, 1, a.lo); g.r(12, 6, 4, 1, a.lo); g.r(6, 2, 4, 1, a.lo2); g.r(4, 9, 8, 2, b.mid); g.r(7, 9, 2, 2, GOLD); },
  vest(g, a, b) { g.r(4, 2, 8, 11, [236, 220, 190]); g.r(0, 3, 4, 4, [236, 220, 190]); g.r(12, 3, 4, 4, [236, 220, 190]); g.r(4, 2, 3, 11, a.mid); g.r(9, 2, 3, 11, a.mid); g.r(4, 2, 1, 11, a.hi); g.r(11, 4, 1, 9, a.lo); for (let y = 3; y < 12; y += 2) { g.px(7, y, b.mid); g.px(8, y + 1, b.mid); } },
  smock(g, a, b) { ICON.tunic(g, a, a); g.r(5, 7, 6, 6, b.mid); g.r(5, 7, 6, 1, b.hi); g.r(9, 8, 2, 5, b.lo); g.px(6, 10, b.lo); g.r(5, 2, 1, 5, b.mid); g.r(10, 2, 1, 5, b.mid); },
  jerkin(g, a, b) { ICON.tunic(g, a, b); g.line(4, 3, 11, 10, b.mid); g.line(4, 4, 10, 10, b.lo); g.px(8, 2, b.hi); g.px(7, 2, b.hi); },
  mail(g, a, b) { g.r(4, 2, 8, 11, a.mid); g.r(0, 2, 5, 3, a.hi); g.r(11, 2, 5, 3, a.mid); g.r(0, 3, 3, 1, a.lo); g.r(4, 2, 2, 11, a.hi); g.r(10, 5, 2, 8, a.lo); for (let y = 6; y < 13; y++) for (let x = 5 + (y % 2); x < 11; x += 2) g.px(x, y, a.lo); g.r(4, 11, 8, 2, b.mid); g.px(5, 3, WHITE); g.r(6, 2, 4, 1, b.mid); },
  plate(g, a, b) { g.r(4, 2, 8, 11, a.mid); g.r(0, 2, 5, 4, a.hi); g.r(11, 2, 5, 4, a.mid); g.r(0, 2, 5, 1, b.mid); g.r(11, 2, 5, 1, b.lo); g.r(4, 2, 2, 11, a.hi); g.r(10, 6, 2, 7, a.lo); g.r(7, 4, 2, 5, b.mid); g.px(7, 4, b.hi); g.r(4, 11, 8, 2, b.mid); g.px(1, 3, WHITE); },
  robe(g, a, b, band) { g.rows([[1, 6, 9], [2, 5, 10], [3, 4, 11], [4, 4, 11], [5, 4, 11], [6, 4, 11], [7, 4, 11], [8, 3, 12], [9, 3, 12], [10, 2, 13], [11, 2, 13], [12, 1, 14], [13, 1, 14]], a.mid); g.r(0, 3, 4, 6, a.mid); g.r(12, 3, 4, 6, a.mid); g.r(0, 8, 4, 1, b.mid); g.r(12, 8, 4, 1, b.mid); g.r(4, 3, 2, 10, a.hi); g.r(10, 5, 2, 8, a.lo); g.r(1, 13, 14, 1, b.mid); g.r(6, 1, 4, 1, b.mid); g.r(7, 6, 2, 7, a.lo); if (band) { g.r(7, 2, 2, 11, b.mid); g.r(7, 2, 1, 11, b.hi); } },
  robe_trim(g, a, b) { ICON.robe(g, a, b, true); },
  // back
  cape(g, a, b, o) { g.rows([[1, 4, 11], [2, 4, 11], [3, 3, 12], [4, 3, 12], [5, 2, 13], [6, 2, 13], [7, 2, 13], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 0, 15], [12, 0, 15], [13, 0, 15]], a.mid); g.r(3, 3, 3, 10, a.hi); g.r(11, 6, 4, 8, a.lo); g.r(5, 1, 6, 1, b.mid); g.px(7, 1, GOLD); g.px(8, 1, GOLD); g.r(7, 4, 2, 9, a.lo); if (o) { g.r(0, 13, 16, 1, b.mid); if (o === 'royal') for (let x = 0; x < 16; x += 2) g.px(x, 13, WHITE); } },
  cape_trim(g, a, b) { ICON.cape(g, a, b, 'trim'); },
  cape_royal(g, a, b) { ICON.cape(g, a, b, 'royal'); },
  pack(g, a, b) { g.r(3, 3, 10, 11, a.mid); g.r(3, 3, 10, 2, a.hi); g.r(11, 5, 2, 9, a.lo); g.r(3, 7, 10, 2, b.mid); g.r(6, 7, 4, 3, b.hi); g.px(7, 8, GOLD); g.px(8, 8, GOLD); g.r(5, 1, 6, 2, WOOD); g.px(6, 1, WOODLO); g.r(1, 6, 2, 5, a.lo); g.r(13, 6, 2, 5, a.lo); },
  quiver(g, a, b) { g.line(3, 3, 12, 14, a.lo); g.r(6, 5, 5, 9, a.mid); g.r(6, 5, 1, 9, a.hi); g.r(10, 6, 1, 8, a.lo); g.r(6, 8, 5, 1, b.lo); for (const x of [6, 8, 10]) { g.px(x, 2, b.mid); g.px(x, 3, b.hi); g.px(x, 4, b.mid); } g.px(7, 1, b.hi); g.px(9, 1, b.hi); },
  wings_fairy(g, a, b) { g.rows([[2, 1, 3], [3, 0, 4], [4, 0, 5], [5, 1, 6], [6, 3, 7], [2, 12, 14], [3, 11, 15], [4, 10, 15], [5, 9, 14], [6, 8, 12]], a.mid); g.rows([[7, 2, 6], [8, 2, 6], [9, 3, 6], [10, 4, 6], [7, 9, 13], [8, 9, 13], [9, 9, 12], [10, 9, 11]], a.hi); g.px(2, 3, b.hi); g.px(13, 3, b.hi); g.px(4, 8, b.mid); g.px(11, 8, b.mid); g.r(7, 5, 2, 7, a.lo); g.px(1, 4, a.lo); g.px(14, 4, a.lo); },
  wings_bat(g, a, b) { g.rows([[2, 0, 2], [3, 0, 4], [4, 0, 6], [5, 1, 7], [6, 2, 7], [7, 2, 7], [8, 2, 7], [2, 13, 15], [3, 11, 15], [4, 9, 15], [5, 8, 14], [6, 8, 13], [7, 8, 13], [8, 8, 13]], a.mid); g.line(1, 2, 6, 8, b.mid); g.line(14, 2, 9, 8, b.mid); g.r(7, 5, 2, 6, a.lo); for (const x of [2, 4, 6, 9, 11, 13]) g.px(x, 9, a.lo); g.px(0, 2, b.hi); g.px(15, 2, b.hi); },
  wings_angel(g, a, b) { for (let i = 0; i < 4; i++) { g.r(1 + i, 2 + i * 2, 6 - i, 2, i % 2 ? a.mid : a.hi); g.r(9, 2 + i * 2, 6 - i, 2, i % 2 ? a.mid : a.hi); } g.r(0, 2, 3, 2, a.hi); g.r(13, 2, 3, 2, a.hi); g.px(2, 3, b.mid); g.px(13, 3, b.mid); g.px(4, 6, b.mid); g.px(11, 6, b.mid); g.r(6, 4, 4, 8, a.lo); g.px(3, 11, a.lo); g.px(12, 11, a.lo); },
  // weapons
  sword(g, a, b) { const c = a.mid.join() === '255,255,255' ? STEEL : a.mid; const r = ramp((c[0] << 16) | (c[1] << 8) | c[2]); g.line(3, 12, 12, 3, r.mid); g.line(4, 12, 12, 4, r.lo); g.line(3, 11, 11, 3, r.hi); g.line(2, 13, 5, 10, WOOD); g.line(5, 8, 8, 11, b.mid.join() === '255,255,255' ? GOLD : b.mid); g.px(1, 14, GOLD); g.px(12, 2, WHITE); },
  greatsword(g, a, b) { g.line(4, 11, 13, 2, a.mid); g.line(5, 11, 13, 3, a.lo); g.line(3, 10, 12, 2, a.hi); g.line(4, 10, 12, 3, a.mid); g.line(3, 13, 6, 10, WOOD); g.line(5, 8, 9, 12, b.mid); g.line(6, 8, 10, 12, b.lo); g.px(2, 14, GOLD); },
  axe(g, a, b) { g.line(3, 14, 11, 3, WOOD); g.line(4, 14, 12, 3, WOODLO); g.rows([[2, 8, 14], [3, 7, 14], [4, 7, 13], [5, 8, 12], [6, 9, 11]], STEEL); g.r(8, 2, 2, 3, WHITE); g.r(12, 4, 2, 2, STEELLO); },
  hammer(g, a, b) { g.line(3, 14, 10, 6, WOOD); g.line(4, 14, 11, 6, WOODLO); g.r(6, 1, 9, 5, STEELLO); g.r(6, 1, 9, 2, STEEL); g.r(13, 2, 2, 4, [90, 100, 112]); g.r(6, 5, 9, 1, [90, 100, 112]); g.r(7, 2, 2, 1, WHITE); },
  dagger(g, a, b) { const r = a.mid.join() === '255,255,255' ? ramp(0xc9d3dc) : a; g.line(5, 10, 11, 4, r.mid); g.line(6, 10, 11, 5, r.lo); g.line(5, 9, 10, 4, r.hi); g.line(3, 12, 6, 9, WOOD); g.line(6, 8, 8, 10, b.mid.join() === '255,255,255' ? GOLD : b.mid); g.px(2, 13, GOLD); g.px(11, 3, WHITE); },
  rapier(g, a, b) { g.line(4, 12, 14, 2, STEEL); g.line(5, 12, 14, 3, STEELLO); g.line(3, 13, 6, 10, WOOD); g.disc(5, 11, 2, GOLD); g.disc(5, 11, 1, b.mid.join() === '255,255,255' ? [212, 168, 32] : b.mid); g.px(14, 1, WHITE); },
  staff(g, a, b) { const r = ramp((a.mid[0] << 16) | (a.mid[1] << 8) | a.mid[2]); g.line(4, 15, 10, 4, WOOD); g.line(5, 15, 11, 4, WOODLO); g.disc(11, 3, 2, [120, 210, 255]); g.disc(11, 3, 1, WHITE); g.px(9, 5, r.mid); g.px(13, 5, r.mid); g.px(10, 1, r.hi); },
  wand(g, a, b) { g.line(3, 13, 10, 6, WOOD); g.line(4, 13, 11, 6, WOODLO); g.disc(11, 4, 2, a.mid); g.disc(11, 4, 1, a.hi); g.px(10, 3, WHITE); g.px(14, 1, a.hi); g.px(14, 7, a.hi); g.px(8, 1, a.hi); },
  bow(g, a, b) { const w = [196, 140, 70]; g.line(11, 1, 14, 8, w); g.line(14, 8, 11, 14, w); g.line(10, 1, 13, 8, [150, 100, 50]); g.line(13, 8, 10, 14, [150, 100, 50]); g.line(11, 1, 11, 14, [230, 230, 230]); g.line(2, 7, 12, 8, STEEL); g.px(2, 7, WHITE); g.px(3, 6, [200, 60, 60]); g.px(3, 8, [200, 60, 60]); if (a.mid.join() !== '255,255,255') { g.px(12, 3, a.hi); g.px(13, 12, a.hi); g.px(14, 8, a.mid); } },
  scythe(g, a, b) {
    const c = a.mid.join() === '255,255,255' ? STEEL : a.mid;
    const r = ramp((c[0] << 16) | (c[1] << 8) | c[2]);
    g.line(3, 14, 11, 4, WOOD); g.line(4, 14, 12, 4, WOODLO);
    g.px(2, 14, GOLD); g.px(3, 13, GOLD);
    g.r(10, 3, 3, 3, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.px(11, 3, b.hi); g.px(12, 5, b.lo);
    g.line(11, 2, 4, 1, r.mid); g.line(4, 1, 1, 4, r.mid); g.line(1, 4, 2, 8, r.mid); g.line(2, 8, 4, 11, r.hi);
    g.line(10, 3, 5, 2, r.hi); g.line(5, 2, 2, 4, WHITE); g.line(2, 4, 3, 8, r.hi);
    g.line(8, 4, 6, 3, r.lo); g.line(6, 3, 3, 5, r.lo); g.px(4, 11, WHITE);
  },
  halberd(g, a, b) {
    const c = a.mid.join() === '255,255,255' ? STEEL : a.mid;
    const r = ramp((c[0] << 16) | (c[1] << 8) | c[2]);
    g.line(2, 14, 10, 4, WOOD); g.line(3, 14, 11, 4, WOODLO);
    g.px(1, 14, GOLD);
    g.r(9, 4, 3, 3, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.px(10, 4, WHITE);
    g.line(11, 3, 14, 1, STEEL); g.line(12, 3, 14, 1, STEELLO); g.px(14, 1, WHITE);
    g.rows([[2, 6, 8], [3, 5, 8], [4, 6, 9]], r.mid);
    g.line(6, 2, 5, 3, r.hi); g.px(6, 2, WHITE); g.px(8, 4, r.lo);
    g.line(10, 7, 13, 8, STEEL); g.px(13, 8, STEELLO); g.px(10, 6, r.hi);
  },
  // off-hand
  round(g, a, b) { g.disc(8, 8, 6, a.mid); g.disc(8, 8, 5, a.mid); g.rows([[3, 6, 9], [4, 4, 5], [5, 3, 4], [6, 3, 3]], a.hi); g.r(11, 8, 3, 4, a.lo); g.disc(8, 8, 2, b.mid); g.px(7, 7, b.hi); for (const [x, y] of [[8, 3], [8, 13], [3, 8], [13, 8]]) g.px(x, y, b.mid); },
  kite(g, a, b) { g.rows([[1, 3, 12], [2, 2, 13], [3, 2, 13], [4, 2, 13], [5, 2, 13], [6, 3, 12], [7, 3, 12], [8, 4, 11], [9, 4, 11], [10, 5, 10], [11, 6, 9], [12, 7, 8], [13, 7, 8]], a.mid); g.r(2, 2, 2, 4, a.hi); g.r(11, 4, 2, 5, a.lo); g.r(7, 1, 2, 12, b.mid); g.r(2, 5, 12, 2, b.mid); g.px(7, 5, b.hi); },
  tower(g, a, b) { g.r(2, 1, 12, 14, a.mid); g.r(2, 1, 3, 14, a.hi); g.r(11, 2, 3, 13, a.lo); g.r(2, 1, 12, 1, b.mid); g.r(2, 14, 12, 1, b.mid); g.r(7, 2, 2, 12, b.mid); g.r(2, 7, 12, 2, b.mid); g.px(7, 7, b.hi); g.px(4, 3, WHITE); g.px(11, 11, WHITE); },
  tome(g, a, b) { g.r(2, 2, 12, 12, a.mid); g.r(2, 2, 12, 1, a.hi); g.r(2, 13, 12, 1, a.lo); g.r(12, 3, 2, 10, [240, 232, 210]); g.r(2, 2, 2, 12, a.lo); g.r(5, 4, 6, 6, b.mid); g.r(6, 5, 4, 4, a.mid); g.px(7, 6, b.hi); g.px(8, 7, b.hi); g.px(7, 7, b.mid); },
  lantern(g, a, b) { g.r(5, 1, 6, 1, b.mid); g.px(5, 2, b.mid); g.px(10, 2, b.mid); g.px(7, 0, b.mid); g.px(8, 0, b.mid); g.r(3, 3, 10, 1, b.lo); g.r(3, 4, 10, 8, a.mid); g.r(5, 5, 6, 6, [255, 236, 150]); g.r(7, 6, 2, 3, WHITE); g.r(3, 12, 10, 2, b.lo); g.px(3, 4, a.hi); g.px(12, 11, a.lo); g.r(7, 4, 2, 8, null); g.r(7, 5, 2, 6, [255, 244, 190]); g.r(4, 4, 1, 8, a.lo); g.r(11, 4, 1, 8, a.lo); },
  orb(g, a, b) { g.disc(8, 8, 5, a.mid); g.disc(7, 7, 3, a.hi); g.r(10, 10, 3, 3, a.lo); g.px(6, 6, WHITE); g.px(7, 6, WHITE); g.px(2, 3, b.mid); g.px(14, 12, b.mid); g.px(13, 2, b.mid); g.px(3, 13, b.mid); },
  spellbook(g, a, b) {
    g.rows([[2, 4, 11], [3, 3, 12]], a.mid);
    g.r(3, 4, 10, 8, a.mid);
    g.r(3, 3, 10, 1, a.hi); g.r(2, 3, 1, 9, a.hi);
    g.r(12, 4, 2, 8, [240, 230, 200]); g.r(13, 4, 1, 8, [210, 195, 160]);
    g.r(2, 12, 11, 1, a.lo);
    g.px(3, 4, GOLD); g.px(4, 4, GOLD); g.px(3, 5, GOLD);
    g.px(11, 4, GOLD); g.px(10, 4, GOLD); g.px(11, 5, GOLD);
    g.px(3, 11, GOLD); g.px(4, 11, GOLD); g.px(3, 10, GOLD);
    g.px(11, 11, GOLD); g.px(10, 11, GOLD); g.px(11, 10, GOLD);
    g.rows([[6, 7, 8], [7, 6, 9], [8, 6, 9], [9, 7, 8]], b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.r(7, 7, 2, 2, b.hi); g.px(7, 7, WHITE);
    g.line(8, 12, 9, 14, b.mid); g.px(9, 14, b.hi);
  },
  relic_cross(g, a, b) {
    g.r(7, 1, 2, 13, a.mid); g.r(2, 5, 12, 2, a.mid);
    g.rows([[1, 6, 9], [2, 6, 9]], a.hi); g.rows([[5, 1, 3], [6, 1, 3]], a.hi);
    g.rows([[5, 12, 14], [6, 12, 14]], a.mid); g.rows([[13, 6, 9], [14, 7, 8]], a.lo);
    g.line(7, 2, 7, 13, a.hi); g.line(3, 5, 12, 5, a.hi);
    g.rows([[4, 7, 8], [5, 6, 9], [6, 6, 9], [7, 7, 8]], b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.r(5, 5, 2, 2, b.hi); g.px(5, 5, WHITE);
    g.px(6, 14, GOLD); g.px(9, 14, GOLD);
  },
  orb_arcane(g, a, b) {
    g.disc(8, 8, 4, a.mid); g.disc(7, 7, 3, a.hi); g.r(9, 9, 3, 3, a.lo);
    g.px(6, 5, WHITE); g.px(7, 5, WHITE); g.px(6, 6, WHITE);
    g.rows([[4, 11, 13], [5, 9, 11], [11, 5, 7], [12, 3, 5]], b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.line(3, 11, 6, 12, b.hi); g.line(10, 4, 13, 5, b.lo);
    g.px(13, 4, GOLD); g.px(3, 12, GOLD);
    g.px(2, 4, WHITE); g.px(13, 12, a.hi); g.px(8, 2, a.hi); g.px(8, 14, a.lo);
  },
  // feet
  boots(g, a, b) { for (const [x0, dx] of [[2, 0], [9, 0]]) { g.r(x0, 3, 5, 7, a.mid); g.r(x0, 3, 5, 2, b.mid); g.r(x0, 10, 7, 3, a.mid); g.r(x0, 3, 2, 10, a.hi); g.r(x0, 12, 7, 1, a.lo2); g.r(x0 + 4, 6, 1, 6, a.lo); void dx; } },
  sandals(g, a, b) { for (const x0 of [2, 9]) { g.r(x0, 6, 5, 7, a.mid); g.r(x0, 6, 1, 7, a.hi); g.r(x0 + 4, 8, 1, 5, a.lo); g.r(x0, 8, 5, 1, b.mid); g.r(x0, 11, 5, 1, b.mid); g.r(x0 + 1, 4, 1, 3, b.mid); g.r(x0 + 3, 4, 1, 3, b.mid); } },
  slippers(g, a, b) { for (const x0 of [2, 8]) { g.r(x0, 6, 5, 6, a.mid); g.r(x0 - 1, 10, 7, 3, a.mid); g.r(x0, 6, 1, 6, a.hi); g.r(x0 - 1, 12, 7, 1, a.lo); g.px(x0 - 2, 9, a.mid); g.px(x0 - 2, 8, b.mid); g.r(x0 + 1, 7, 3, 1, b.mid); } },
  greaves(g, a, b) { for (const x0 of [2, 9]) { g.r(x0, 2, 5, 11, a.mid); g.r(x0, 2, 5, 2, b.mid); g.r(x0, 2, 2, 11, a.hi); g.r(x0 + 4, 5, 1, 8, a.lo); g.r(x0, 12, 6, 1, a.lo2); g.px(x0 + 2, 7, WHITE); g.r(x0, 8, 5, 1, b.mid); } },
  // charms
  leaf(g, a, b) { g.rows([[2, 8, 9], [3, 7, 11], [4, 6, 12], [5, 5, 12], [6, 5, 11], [7, 5, 10], [8, 5, 9], [9, 6, 8]], a.mid); g.line(4, 12, 11, 4, b.mid); g.px(8, 3, a.hi); g.px(7, 4, a.hi); g.px(6, 5, a.hi); g.line(3, 13, 6, 9, b.lo); },
  feather(g, a, b) { g.line(3, 13, 12, 2, a.mid); g.line(4, 13, 13, 3, a.lo); g.line(3, 12, 11, 2, a.hi); g.line(5, 11, 9, 11, a.mid); g.line(6, 9, 10, 9, a.hi); g.line(7, 7, 11, 7, a.mid); g.line(8, 5, 12, 5, a.hi); g.px(2, 14, b.mid); },
  clover(g, a, b) { for (const [x, y] of [[5, 5], [10, 5], [5, 9], [10, 9]]) { g.disc(x, y, 2, a.mid); g.px(x - 1, y - 1, a.hi); } g.r(7, 6, 2, 4, a.lo); g.line(8, 10, 10, 14, b.mid); g.px(8, 7, a.hi); },
  fang(g, a, b) { g.rows([[2, 5, 10], [3, 5, 10], [4, 5, 9], [5, 6, 9], [6, 6, 9], [7, 7, 9], [8, 7, 8], [9, 7, 8], [10, 8, 8], [11, 8, 8], [12, 8, 8]], a.mid); g.r(5, 2, 2, 3, a.hi); g.r(9, 5, 1, 4, b.mid); g.r(5, 2, 6, 1, b.mid); g.px(8, 1, GOLD); g.px(7, 0, GOLD); },
  gem(g, a, b) { g.rows([[2, 5, 10], [3, 3, 12], [4, 2, 13], [5, 2, 13], [6, 3, 12], [7, 4, 11], [8, 5, 10], [9, 6, 9], [10, 7, 8]], a.mid); g.r(3, 3, 3, 3, a.hi); g.r(9, 5, 4, 3, a.lo); g.r(6, 2, 4, 1, b.mid); g.px(5, 4, WHITE); g.px(4, 3, b.hi); g.line(7, 0, 7, 1, GOLD); g.line(8, 0, 8, 1, GOLD); },
  locket(g, a, b) { g.line(4, 0, 7, 4, [200, 190, 160]); g.line(11, 0, 8, 4, [200, 190, 160]); g.disc(8, 9, 4, a.mid); g.disc(8, 9, 3, a.hi); g.disc(8, 9, 2, b.mid); g.px(7, 8, WHITE); g.r(10, 10, 2, 3, a.lo); g.px(8, 4, a.lo); g.px(8, 5, a.mid); },
  amulet(g, a, b) {
    g.line(3, 1, 6, 5, GOLD); g.line(12, 1, 9, 5, GOLD);
    g.px(7, 5, GOLD); g.px(8, 5, GOLD);
    g.rows([[6, 6, 9], [7, 5, 10], [8, 4, 11], [9, 4, 11], [10, 5, 10], [11, 6, 9], [12, 7, 8]], b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.r(6, 6, 4, 1, b.hi);
    g.rows([[7, 6, 9], [8, 5, 10], [9, 5, 10], [10, 6, 9]], a.mid);
    g.r(7, 6, 3, 2, a.hi); g.px(7, 7, WHITE); g.r(9, 9, 2, 2, a.lo);
    g.px(7, 13, GOLD); g.px(8, 13, GOLD); g.px(7, 14, b.hi);
  },
  ring_gem(g, a, b) {
    g.rows([[6, 4, 11], [7, 3, 12], [8, 3, 5], [8, 10, 12], [9, 3, 5], [9, 10, 12], [10, 3, 5], [10, 10, 12], [11, 4, 11], [12, 5, 10]], GOLD);
    g.line(4, 7, 4, 10, WHITE); g.line(11, 8, 11, 11, WOODLO);
    g.rows([[8, 6, 9], [9, 6, 9], [10, 6, 9]], WOODLO);
    g.r(6, 4, 4, 2, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.rows([[1, 7, 8], [2, 6, 9], [3, 5, 10], [4, 6, 9]], a.mid);
    g.r(2, 6, 3, 2, a.hi); g.px(7, 2, WHITE); g.px(9, 4, a.lo);
    g.px(5, 5, GOLD); g.px(10, 5, GOLD);
  },
  ring_skull(g, a, b) {
    const c = a.mid.join() === '255,255,255' ? [235, 230, 220] : a.mid;
    const r = ramp((c[0] << 16) | (c[1] << 8) | c[2]);
    g.r(1, 6, 3, 6, STEEL); g.r(12, 6, 3, 6, STEELLO);
    g.line(2, 6, 2, 11, WHITE);
    g.rows([[2, 5, 10], [3, 4, 11], [4, 4, 11], [5, 4, 11]], r.mid);
    g.line(5, 2, 8, 2, r.hi); g.px(5, 3, WHITE);
    g.rows([[6, 4, 11], [7, 4, 11]], r.mid);
    g.r(5, 6, 2, 2, OUT); g.r(9, 6, 2, 2, OUT);
    g.px(7, 8, OUT); g.px(8, 8, OUT);
    g.rows([[8, 5, 10], [9, 5, 10]], r.mid);
    g.rows([[10, 6, 9], [11, 6, 9]], r.lo);
    g.px(6, 10, r.hi); g.px(8, 10, r.hi); g.px(7, 10, r.lo); g.px(9, 10, r.lo);
    g.px(5, 6, b.mid); g.px(9, 6, b.mid);
  },
  feather_charm(g, a, b) {
    g.line(3, 13, 12, 2, a.hi); g.line(4, 13, 13, 3, a.lo);
    g.rows([[3, 9, 11], [4, 8, 12], [5, 7, 12], [6, 6, 12], [7, 6, 11], [8, 5, 10], [9, 5, 9], [10, 4, 8], [11, 4, 6]], a.mid);
    g.line(9, 4, 11, 3, a.hi); g.line(7, 6, 10, 5, a.hi); g.line(6, 8, 9, 7, a.hi); g.line(5, 10, 7, 9, a.hi);
    g.px(12, 6, a.lo); g.px(11, 8, a.lo); g.px(10, 10, a.lo);
    g.r(2, 12, 3, 2, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.px(2, 12, b.hi);
    g.px(1, 14, GOLD); g.px(2, 14, b.mid); g.px(3, 14, b.hi);
  },
  // consumables
  flask_elixir(g, a, b) {
    g.r(7, 1, 2, 2, WOOD); g.px(7, 1, WOODLO);
    g.r(7, 3, 2, 3, STEEL);
    g.px(6, 3, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.px(9, 3, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.rows([[6, 5, 10], [7, 4, 11], [8, 3, 12], [9, 2, 13], [10, 2, 13], [11, 2, 13], [12, 3, 12], [13, 5, 10]], STEEL);
    g.rows([[8, 4, 11], [9, 3, 12], [10, 3, 12], [11, 3, 12], [12, 4, 11], [13, 6, 9]], a.mid);
    g.line(4, 8, 11, 8, a.hi);
    g.px(5, 9, WHITE); g.px(8, 10, WHITE); g.px(6, 11, a.hi);
    g.r(9, 12, 2, 2, a.lo); g.r(11, 10, 2, 2, a.lo);
    g.px(4, 7, WHITE); g.px(3, 9, WHITE);
  },
  scroll_magic(g, a, b) {
    g.rows([[2, 3, 5], [3, 2, 5]], WOOD);
    g.rows([[12, 10, 13], [13, 10, 12]], WOOD);
    g.rows([[3, 4, 11], [4, 3, 12], [5, 3, 12], [6, 2, 12], [7, 2, 12], [8, 2, 12], [9, 2, 12], [10, 3, 12], [11, 3, 12], [12, 4, 11]], [245, 236, 205]);
    g.line(4, 3, 11, 3, WHITE);
    g.line(3, 12, 10, 12, [200, 185, 150]);
    g.r(6, 4, 3, 8, a.mid);
    g.line(6, 4, 6, 11, a.hi);
    g.disc(7, 8, 2, b.mid.join() === '255,255,255' ? GOLD : b.mid);
    g.px(7, 8, b.hi); g.px(6, 7, WHITE);
    g.px(3, 6, [160, 140, 110]); g.px(4, 8, [160, 140, 110]); g.px(3, 10, [160, 140, 110]);
    g.px(10, 5, [160, 140, 110]); g.px(11, 7, [160, 140, 110]); g.px(10, 9, [160, 140, 110]);
  },
  bomb(g, a, b) {
    const c = a.mid.join() === '255,255,255' ? [70, 75, 85] : a.mid;
    const r = ramp((c[0] << 16) | (c[1] << 8) | c[2]);
    g.disc(7, 9, 5, r.mid); g.disc(7, 9, 4, r.lo);
    g.r(4, 6, 2, 2, r.hi);
    g.px(4, 6, WHITE); g.px(5, 6, WHITE);
    g.r(9, 11, 3, 3, r.lo2);
    g.r(6, 3, 3, 2, STEELLO); g.px(7, 3, STEEL);
    g.line(7, 2, 10, 1, WOOD); g.px(11, 2, WOODLO);
    g.disc(12, 2, 1, GOLD); g.px(12, 2, WHITE);
    g.px(14, 2, [255, 100, 30]); g.px(12, 1, [255, 100, 30]);
    g.px(13, 3, [255, 180, 50]); g.px(10, 1, [255, 180, 50]);
  },
  // elemental sigils / runes
  sigil_fire(g, a, b) {
    g.rows([[12, 4, 11], [13, 5, 10]], b.lo);
    g.rows([[11, 5, 10]], b.mid);
    g.px(7, 11, b.hi); g.px(8, 11, b.hi);
    g.rows([[2, 7, 8], [3, 6, 9], [4, 6, 9]], a.hi);
    g.rows([[5, 4, 11], [6, 3, 12], [7, 3, 12], [8, 3, 12], [9, 4, 11], [10, 4, 11]], a.mid);
    g.px(4, 4, a.mid); g.px(11, 4, a.mid);
    g.rows([[6, 6, 9], [7, 6, 9], [8, 6, 9], [9, 6, 9]], a.hi);
    g.rows([[7, 7, 8], [8, 7, 8]], WHITE);
    g.r(3, 8, 2, 3, a.lo); g.r(11, 8, 2, 3, a.lo);
    g.px(2, 3, b.hi); g.px(13, 3, b.hi);
  },
  sigil_frost(g, a, b) {
    g.rows([[7, 4, 11], [8, 4, 11]], a.mid);
    g.rows([[5, 6, 9], [6, 5, 10], [9, 5, 10], [10, 6, 9]], a.mid);
    g.line(7, 2, 7, 13, a.hi); g.line(8, 2, 8, 13, a.mid);
    g.line(2, 7, 13, 7, a.hi); g.line(2, 8, 13, 8, a.mid);
    g.px(4, 4, a.hi); g.px(11, 4, a.hi); g.px(4, 11, a.mid); g.px(11, 11, a.mid);
    g.px(3, 5, b.mid); g.px(12, 5, b.mid); g.px(3, 10, b.mid); g.px(12, 10, b.mid);
    g.r(7, 7, 2, 2, WHITE);
    g.px(6, 6, WHITE); g.px(9, 9, a.lo); g.px(6, 9, a.lo); g.px(9, 6, a.hi);
    g.px(7, 1, WHITE); g.px(8, 14, a.lo);
  },
  sigil_thunder(g, a, b) {
    g.rows([[1, 8, 11], [2, 7, 10], [3, 6, 9], [4, 5, 8], [5, 4, 8]], a.mid);
    g.rows([[6, 3, 12], [7, 5, 13]], a.mid);
    g.rows([[8, 7, 11], [9, 6, 10], [10, 5, 9], [11, 5, 8], [12, 6, 8], [13, 6, 7], [14, 6, 6]], a.mid);
    g.line(8, 2, 5, 5, a.hi); g.line(5, 5, 11, 7, WHITE);
    g.line(10, 7, 6, 11, a.hi); g.px(6, 12, WHITE); g.px(6, 13, WHITE);
    g.line(9, 3, 8, 5, a.lo); g.line(11, 8, 8, 11, a.lo); g.line(8, 12, 7, 14, a.lo2);
    g.px(3, 3, b.hi); g.px(12, 3, b.mid); g.px(2, 9, b.hi); g.px(13, 11, b.mid);
  },
  sigil_shadow(g, a, b) {
    g.rows([[2, 4, 10], [3, 3, 11], [4, 2, 7], [5, 2, 6], [6, 2, 5], [7, 2, 5], [8, 2, 5], [9, 2, 6], [10, 2, 7], [11, 3, 11], [12, 4, 10]], a.mid);
    g.line(4, 2, 10, 3, a.hi); g.line(3, 4, 3, 10, a.hi);
    g.line(4, 11, 10, 12, a.lo); g.px(10, 4, a.lo); g.px(10, 10, a.lo);
    g.disc(8, 7, 3, a.lo2);
    g.r(7, 6, 2, 3, b.hi); g.px(7, 5, b.mid); g.px(8, 9, b.mid);
    g.px(7, 7, WHITE); g.px(8, 7, WHITE);
    g.px(12, 4, b.lo); g.px(13, 7, b.mid); g.px(12, 10, b.lo);
  },
  sigil_holy(g, a, b) {
    g.rows([[3, 6, 9], [4, 4, 5], [4, 10, 11], [11, 4, 5], [11, 10, 11], [12, 6, 9]], b.mid);
    g.px(4, 4, b.hi); g.px(11, 4, b.hi); g.px(4, 11, b.lo); g.px(11, 11, b.lo);
    g.r(7, 1, 2, 14, a.mid);
    g.r(1, 7, 14, 2, a.mid);
    g.line(7, 2, 7, 13, a.hi); g.line(2, 7, 13, 7, a.hi);
    g.rows([[6, 7, 8], [7, 6, 9], [8, 6, 9], [9, 7, 8]], a.hi);
    g.r(7, 7, 2, 2, WHITE);
    g.px(6, 1, a.hi); g.px(9, 1, a.lo);
    g.px(1, 6, a.hi); g.px(1, 9, a.lo);
    g.px(14, 6, a.hi); g.px(14, 9, a.lo);
    g.px(6, 14, a.hi); g.px(9, 14, a.lo);
  },
  sigil_nature(g, a, b) {
    g.disc(8, 8, 2, a.hi);
    g.px(8, 8, WHITE);
    g.rows([[2, 7, 8], [3, 7, 10], [4, 7, 11], [5, 8, 11]], a.mid);
    g.line(7, 2, 10, 4, a.hi); g.px(11, 5, a.lo);
    g.rows([[9, 8, 12], [10, 9, 13], [11, 9, 12], [12, 9, 10]], a.mid);
    g.line(12, 9, 10, 12, a.hi); g.px(9, 12, a.lo);
    g.rows([[7, 3, 6], [8, 2, 6], [9, 3, 7], [10, 4, 7]], a.mid);
    g.line(3, 7, 3, 9, a.hi); g.px(6, 10, a.lo);
    g.px(8, 1, b.hi); g.px(13, 8, b.mid); g.px(4, 12, b.mid);
    g.px(8, 6, b.lo); g.px(10, 8, b.lo); g.px(7, 10, b.lo);
  },
};

// `mainTint` / `trimTint`: hex ints (main may be a dye). Returns a 16x16 canvas.
export function iconCanvas(item, mainTint, trimTint) {
  const a = ramp(mainTint), b = ramp(trimTint);
  const g = new G();
  (ICON[item.style] || ICON.gem)(g, a, b);
  g.outline();
  return g.canvas();
}
