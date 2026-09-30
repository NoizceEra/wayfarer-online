// Worn equipment art: procedural pixel overlays registered to the 16x16 hero
// body frames. Every overlay is a 28x28 canvas in sprite coordinates (+6, so
// wings / capes can poke outside the 16x16 frame), drawn per facing for
// 'down' | 'up' | 'left' ('right' is 'left' mirrored). Each style paints with a
// 4-tone ramp of the item's MAIN colour (dyeable) and TRIM colour, and gets an
// automatic 1px dark outline so all gear reads in the same chunky style as the
// Ninja Adventure bodies.
//
// Head silhouette (sprite coords): rows 2-11; x 4..11 at row 2, 3..12 row 3,
// 2..13 row 4, 1..14 rows 5-10. Eyes: rows 8-9 at x=5,10 (front) / x=4 (left).
// Body: chin row 11, torso rows 12-13, legs rows 13-15.
import { ramp } from './heroArt.js';

export const WEAR_N = 28, WEAR_O = 6;
const OUT = [0x14, 0x1b, 0x1b];
const WHITE = [250, 250, 250];

class PX {
  constructor() { this.m = new Map(); }
  p(x, y, c) { if (c) this.m.set(`${x},${y}`, c); return this; }
  clear(x, y) { this.m.delete(`${x},${y}`); return this; }
  r(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.p(x, y, c); return this; }
  sr(x0, y0, x1, y1, c) { this.r(x0, y0, x1, y1, c); this.r(15 - x1, y0, 15 - x0, y1, c); return this; }
  sp(x, y, c) { this.p(x, y, c); this.p(15 - x, y, c); return this; }
  has(x, y) { return this.m.has(`${x},${y}`); }
  // spans: [[row, x0, x1], ...]
  rows(spans, c) { for (const [y, x0, x1] of spans) this.r(x0, y, x1, y, c); return this; }
  outline() {
    const add = [];
    for (const k of this.m.keys()) {
      const [x, y] = k.split(',').map(Number);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!this.has(x + dx, y + dy)) add.push(`${x + dx},${y + dy}`);
    }
    for (const k of add) this.m.set(k, OUT);
    return this;
  }
  toCanvas(flip) {
    const cv = document.createElement('canvas'); cv.width = WEAR_N; cv.height = WEAR_N;
    const ctx = cv.getContext('2d');
    for (const [k, c] of this.m) {
      let [x, y] = k.split(',').map(Number);
      if (flip) x = 15 - x;
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x + WEAR_O, y + WEAR_O, 1, 1);
    }
    return cv;
  }
}

// ── style painters: (P, d, a, b, o) — a/b are ramps {hi,mid,lo,lo2}; d = down|up|left ──
const HEAD = {
  brim(P, d, a, b) {
    const L = d === 'left';
    P.rows([[0, 5, 10], [1, 4, 11], [2, 3, 12], [3, 3, 12]], a.mid);
    P.r(5, 0, 7, 0, a.hi); P.r(4, 1, 6, 1, a.hi); P.r(3, 2, 4, 2, a.hi);
    P.r(11, 1, 12, 3, a.lo);
    P.r(3, 3, 12, 3, b.mid); P.r(3, 3, 5, 3, b.hi);                // band
    P.r(L ? 0 : 0, 4, 15, 4, a.hi); P.r(1, 5, 14, 5, a.lo);          // brim
    for (let x = 1; x <= 14; x += 3) P.p(x, 5, a.lo2);
    P.outline();
  },
  cap(P, d, a, b, o) {
    P.rows([[1, 4, 11], [2, 3, 12], [3, 2, 13], [4, 2, 13]], a.mid);
    P.r(4, 1, 7, 1, a.hi); P.r(3, 2, 5, 2, a.hi); P.r(2, 3, 3, 3, a.hi);
    P.r(11, 2, 13, 4, a.lo);
    if (d === 'down') P.r(3, 5, 12, 5, a.lo);                        // visor
    else if (d === 'left') P.r(0, 5, 5, 5, a.lo);
    else P.r(2, 5, 13, 5, a.lo);
    for (let y = 1; y <= 3; y++) P.p(d === 'left' ? 8 : 7, y, a.lo2); // seam
    if (d === 'down' || d === 'up') P.p(8, 2, a.lo2);
    if (o?.feather) {
      const fx = d === 'left' ? 12 : 12;
      P.p(fx, 0, b.mid); P.p(fx + 1, -1, b.hi); P.p(fx + 1, 0, b.mid); P.p(fx, 1, b.lo); P.p(fx + 1, 1, b.mid); P.p(fx + 2, -2, b.hi);
    }
    P.outline();
  },
  helm(P, d, a, b, o) {
    P.rows([[1, 4, 11], [2, 3, 12], [3, 2, 13], [4, 2, 13], [5, 2, 13], [6, 2, 13]], a.mid);
    P.r(4, 1, 6, 1, a.hi); P.r(3, 2, 5, 2, a.hi); P.r(2, 3, 4, 6, a.hi);
    P.r(11, 2, 13, 6, a.lo);
    P.r(3, 6, 12, 6, a.lo);                                           // brow band
    P.p(5, 3, WHITE); P.p(10, 3, a.hi);                               // rivets
    if (d === 'down') {
      P.sr(1, 7, 2, 10, a.lo); P.sr(1, 7, 1, 10, a.hi);               // cheek guards
      P.r(7, 7, 8, 9, a.mid); P.r(7, 7, 7, 9, a.hi);                  // nose guard
    } else if (d === 'up') {
      P.r(2, 7, 13, 9, a.mid); P.r(3, 10, 12, 11, a.lo); P.r(2, 7, 4, 9, a.hi);
    } else {
      P.r(8, 7, 13, 10, a.lo); P.r(8, 7, 9, 10, a.mid); P.r(2, 6, 3, 8, a.mid);
    }
    if (o?.plume) {
      if (d === 'left') { P.r(5, -1, 12, 0, b.mid); P.r(6, -2, 11, -2, b.hi); P.r(12, 1, 14, 4, b.mid); P.r(13, 2, 14, 5, b.lo); }
      else if (d === 'up') { P.r(7, -2, 8, 3, b.mid); P.r(7, -2, 7, 2, b.hi); P.r(6, 0, 9, 1, b.mid); }
      else { P.r(6, -1, 9, 0, b.mid); P.r(7, -2, 8, -2, b.hi); P.r(7, 1, 8, 1, b.lo); }
    }
    P.outline();
  },
  horns(P, d, a, b) {
    P.rows([[1, 4, 11], [2, 3, 12], [3, 2, 13], [4, 2, 13], [5, 2, 13]], a.mid);
    P.r(4, 1, 7, 1, a.hi); P.r(3, 2, 5, 2, a.hi); P.r(2, 3, 3, 5, a.hi);
    P.r(11, 2, 13, 5, a.lo); P.r(3, 5, 12, 5, a.lo);
    if (d === 'left') {
      for (const [x, y] of [[7, 2], [6, 1], [6, 0], [5, -1], [5, -2]]) P.p(x, y, b.mid);
      for (const [x, y] of [[10, 2], [10, 1], [11, 0], [11, -1]]) P.p(x, y, b.lo);
      P.p(6, 0, b.hi);
    } else {
      const pts = [[2, 3], [1, 3], [1, 2], [0, 1], [0, 0], [0, -1], [-1, -2]];
      for (const [x, y] of pts) P.sp(x, y, b.mid);
      P.sp(0, 0, b.hi); P.sp(1, 2, b.hi);
    }
    if (d === 'down') P.r(3, 6, 12, 6, a.lo);
    P.outline();
  },
  cone(P, d, a, b, o) {
    const L = d === 'left';
    P.rows(L ? [[-1, 10, 13], [0, 8, 12], [1, 6, 12], [2, 5, 11], [3, 4, 11]] : [[-1, 8, 9], [0, 7, 8], [1, 6, 9], [2, 5, 10], [3, 4, 11]], a.mid);
    P.r(L ? 5 : 6, 2, L ? 6 : 6, 2, a.hi); P.r(4, 3, 6, 3, a.hi);
    P.r(9, 2, 11, 3, a.lo);
    P.r(1, 4, 14, 4, a.hi); P.r(2, 5, 13, 5, a.lo); P.r(3, 5, 12, 5, a.lo2);   // brim
    if (o?.stars) {
      for (const [x, y] of [[5, 2], [9, 1], [7, 3], [11, 4], [3, 4], [8, 5]]) P.p(L ? x + 1 : x, y, b.mid);
      P.p(9, 1, WHITE);
    } else P.r(4, 3, 11, 3, b.mid);                                    // band
    P.outline();
  },
  crown(P, d, a, b, o) {
    P.r(3, 3, 12, 4, a.mid); P.r(3, 3, 12, 3, a.hi); P.r(3, 4, 12, 4, a.lo);
    P.r(3, 1, 4, 2, a.mid); P.r(7, 0, 8, 2, a.mid); P.r(11, 1, 12, 2, a.mid);
    P.r(5, 2, 5, 2, a.mid); P.r(10, 2, 10, 2, a.mid);
    P.p(3, 1, a.hi); P.p(7, 0, a.hi); P.p(11, 1, a.hi);
    if (d !== 'up') {
      if (o?.gem) { P.r(7, 3, 8, 4, b.mid); P.p(7, 3, b.hi); }
      else { P.p(7, 0, b.mid); P.p(3, 1, b.mid); P.p(12, 1, b.mid); P.p(7, 3, b.mid); P.p(8, 4, b.lo); }
      P.p(5, 4, a.hi); P.p(10, 4, a.hi);
    }
    P.outline();
  },
  hood(P, d, a, b, o) {
    // cloth ring around the head; face stays visible through the opening
    P.rows([[1, 5, 10], [2, 4, 11], [3, 3, 12], [4, 2, 13], [5, 1, 14], [6, 1, 14], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 2, 13]], a.mid);
    P.r(5, 1, 7, 1, a.hi); P.r(4, 2, 6, 2, a.hi); P.r(3, 3, 5, 3, a.hi); P.r(2, 4, 4, 4, a.hi); P.r(1, 5, 2, 10, a.hi);
    P.r(12, 3, 13, 10, a.lo); P.r(13, 4, 14, 10, a.lo); P.rows([[11, 2, 13]], a.lo);
    if (d === 'down') {
      for (let y = 5; y <= 10; y++) for (let x = 4; x <= 11; x++) P.clear(x, y);
      P.r(4, 5, 11, 5, a.lo2); P.r(3, 5, 3, 10, a.lo); P.r(12, 5, 12, 10, a.lo);
      P.r(6, 11, 9, 12, a.mid); P.r(6, 11, 9, 11, a.hi);               // cowl drape over the chin
      if (o?.trimPin) P.p(7, 12, b.mid);
    } else if (d === 'up') {
      P.r(7, 3, 8, 10, a.lo);                                          // seam
    } else {
      for (let y = 5; y <= 10; y++) for (let x = 2; x <= 7; x++) P.clear(x, y);
      P.r(2, 5, 7, 5, a.lo2); P.r(8, 5, 8, 10, a.lo);
      P.r(3, 11, 6, 12, a.mid);
    }
    P.p(d === 'left' ? 3 : 4, 2, b.mid);
    P.outline();
  },
  veil(P, d, a, b) {
    P.rows([[1, 5, 10], [2, 4, 11], [3, 3, 12], [4, 2, 13], [5, 1, 14], [6, 1, 14], [7, 1, 14], [8, 1, 14], [9, 1, 14], [10, 1, 14], [11, 2, 13]], a.mid);
    P.r(5, 1, 7, 1, a.hi); P.r(4, 2, 6, 2, a.hi); P.r(1, 4, 3, 10, a.hi); P.r(12, 3, 14, 11, a.lo);
    if (d === 'down') {
      P.r(4, 8, 5, 9, OUT); P.r(10, 8, 11, 9, OUT); P.p(4, 8, [58, 36, 48]);
      P.r(6, 10, 9, 10, a.lo);
      for (const x of [3, 6, 9, 12]) { P.p(x, 12, a.mid); P.p(x, 13, a.lo); }
    } else if (d === 'left') {
      P.r(3, 8, 4, 9, OUT); P.r(5, 10, 8, 10, a.lo);
      for (const x of [4, 7, 10, 12]) { P.p(x, 12, a.mid); P.p(x, 13, a.lo); }
    } else {
      P.r(7, 3, 8, 10, a.lo);
      for (const x of [3, 6, 9, 12]) { P.p(x, 12, a.mid); P.p(x, 13, a.lo); }
    }
    P.p(6, 3, a.lo); P.p(10, 6, a.lo);
    P.outline();
  },
  band(P, d, a, b) {
    const x0 = d === 'left' ? 2 : 1, x1 = 14;
    P.r(x0, 4, x1, 4, a.hi); P.r(x0, 5, x1, 5, a.mid); P.r(x0, 5, x1, 5, a.mid);
    for (let x = x0 + 2; x <= x1 - 1; x += 3) P.p(x, 4, b.mid);
    if (d === 'up') { P.r(7, 5, 8, 8, a.mid); P.r(6, 8, 9, 9, a.lo); P.p(7, 6, b.mid); }
    else if (d === 'left') { P.r(13, 5, 15, 6, a.mid); P.r(14, 7, 15, 8, a.lo); P.p(15, 9, a.lo); }
    else { P.r(14, 5, 15, 5, a.mid); P.p(15, 6, a.mid); P.p(14, 7, a.lo); P.p(15, 8, a.lo); P.p(15, 7, a.mid); }
    P.outline();
  },
  ears(P, d, a, b) {
    const x0 = d === 'left' ? 2 : 1;
    P.r(x0, 5, 14, 5, a.lo);
    if (d === 'left') {
      P.rows([[3, 6, 9], [2, 7, 9], [1, 7, 8], [0, 7, 7]], a.mid); P.p(8, 3, b.mid); P.p(8, 2, b.mid);
      P.rows([[3, 11, 13], [2, 11, 12], [1, 12, 12]], a.lo);
    } else {
      P.rows([[3, 2, 5], [2, 3, 5], [1, 3, 4], [0, 3, 3]], a.mid);
      P.rows([[3, 10, 13], [2, 10, 12], [1, 11, 12], [0, 12, 12]], a.mid);
      if (d === 'down') { P.p(4, 3, b.mid); P.p(4, 2, b.mid); P.p(11, 3, b.mid); P.p(11, 2, b.mid); }
      P.p(3, 1, a.hi); P.p(12, 1, a.hi);
    }
    P.outline();
  },
  wreath(P, d, a, b) {
    const x0 = d === 'left' ? 3 : 2;
    for (let x = x0; x <= 13; x++) { P.p(x, 3, x % 2 ? a.mid : a.hi); P.p(x, 2, x % 3 === 0 ? a.mid : null); }
    P.p(x0 - 1, 4, a.mid); P.p(14, 4, a.lo); P.p(x0 - 1, 5, a.lo); P.p(14, 5, a.lo);
    P.p(3, 2, a.hi); P.p(12, 2, a.hi); P.p(x0 - 1, 3, a.mid);
    for (const [x, y] of [[4, 3], [8, 2], [11, 3], [2, 4], [13, 4]]) { P.p(x, y, b.mid); }
    for (const [x, y] of [[4, 3], [8, 2], [11, 3]]) P.p(x, y - 0, b.hi);
    P.p(4, 3, WHITE); P.p(11, 3, WHITE);
    P.outline();
  },
};

const FACE = {
  glasses(P, d, a, b) {
    if (d === 'up') return;
    if (d === 'down') {
      for (const x0 of [3, 9]) { P.r(x0, 7, x0 + 3, 7, a.mid); P.r(x0, 10, x0 + 3, 10, a.mid); P.r(x0, 8, x0, 9, a.mid); P.r(x0 + 3, 8, x0 + 3, 9, a.mid); }
      P.r(7, 8, 8, 8, a.mid); P.p(2, 8, a.lo); P.p(13, 8, a.lo);
      P.p(4, 8, b.hi); P.p(10, 8, b.hi);
    } else {
      P.r(2, 7, 5, 7, a.mid); P.r(2, 10, 5, 10, a.mid); P.r(2, 8, 2, 9, a.mid); P.r(5, 8, 5, 9, a.mid);
      P.r(6, 8, 10, 8, a.lo); P.p(3, 8, b.hi);
    }
  },
  shades(P, d, a, b) {
    if (d === 'up') return;
    if (d === 'down') {
      P.r(3, 8, 6, 9, a.mid); P.r(9, 8, 12, 9, a.mid); P.r(7, 8, 8, 8, a.mid);
      P.p(3, 8, b.mid); P.p(9, 8, b.mid); P.p(4, 8, b.hi); P.p(10, 8, b.hi); P.p(2, 8, a.lo); P.p(13, 8, a.lo);
      P.r(3, 7, 6, 7, a.lo2); P.r(9, 7, 12, 7, a.lo2);
    } else {
      P.r(2, 8, 5, 9, a.mid); P.r(6, 8, 10, 8, a.mid); P.p(2, 8, b.mid); P.p(3, 8, b.hi); P.r(2, 7, 5, 7, a.lo2);
    }
  },
  eyepatch(P, d, a) {
    if (d === 'up') { P.r(2, 6, 13, 6, a.mid); return; }
    if (d === 'down') { P.r(2, 6, 13, 6, a.mid); P.r(9, 7, 11, 10, a.mid); P.p(9, 7, a.hi); P.p(10, 8, a.lo); }
    else { P.r(2, 6, 13, 6, a.mid); P.r(3, 7, 5, 10, a.mid); P.p(3, 7, a.hi); }
  },
  mask(P, d, a, b) {
    if (d === 'up') { P.r(2, 7, 13, 9, a.mid); P.r(14, 8, 15, 9, a.lo); P.p(15, 10, a.lo); return; }
    if (d === 'down') {
      P.r(2, 7, 13, 9, a.mid); P.r(2, 7, 13, 7, a.hi); P.r(2, 9, 13, 9, a.lo);
      P.r(4, 8, 5, 9, null); for (const [x, y] of [[4, 8], [5, 8], [4, 9], [5, 9], [10, 8], [11, 8], [10, 9], [11, 9]]) P.clear(x, y);
      P.r(14, 8, 15, 8, a.mid); P.p(15, 9, a.lo); P.p(14, 9, a.lo);
    } else {
      P.r(1, 7, 13, 9, a.mid); P.r(1, 7, 13, 7, a.hi); P.r(1, 9, 13, 9, a.lo);
      for (const [x, y] of [[3, 8], [4, 8], [5, 8], [3, 9], [4, 9], [5, 9]]) P.clear(x, y);
      P.r(14, 8, 15, 8, a.mid); P.p(15, 9, a.lo);
    }
    P.outline();
  },
  monocle(P, d, a, b) {
    if (d === 'up') return;
    const x0 = d === 'down' ? 9 : 3;
    P.r(x0, 7, x0 + 2, 7, a.mid); P.r(x0, 10, x0 + 2, 10, a.mid); P.r(x0, 8, x0, 9, a.mid); P.r(x0 + 2, 8, x0 + 2, 9, a.mid);
    P.p(x0, 7, a.hi); P.p(x0 + 1, 8, null);
    const cx = d === 'down' ? 12 : 6;
    P.p(cx, 9, a.hi); P.p(cx, 10, a.mid); P.p(cx + (d === 'down' ? 0 : 0), 11, a.mid); P.p(cx + 1, 12, a.lo);
    if (d === 'down') P.p(11, 8, b.hi);
  },
  foxmask(P, d, a, b) {
    if (d === 'up') { P.r(1, 8, 14, 8, b.mid); P.r(14, 8, 15, 9, b.lo); P.outline(); return; }
    if (d === 'down') {
      P.rows([[6, 4, 11], [7, 3, 12], [8, 2, 13], [9, 2, 13], [10, 4, 11], [11, 6, 9]], a.mid);
      P.r(3, 7, 5, 7, a.hi); P.r(3, 8, 3, 9, a.hi);
      for (const [x, y] of [[4, 8], [5, 8], [4, 9], [5, 9], [10, 8], [11, 8], [10, 9], [11, 9]]) P.clear(x, y);
      P.r(7, 6, 8, 7, b.mid);                                              // forehead mark
      P.sp(4, 10, b.mid); P.sp(3, 9, b.mid); P.sp(3, 7, b.lo);            // cheek stripes
      P.r(7, 10, 8, 10, OUT); P.p(7, 11, b.lo); P.p(8, 11, b.lo);        // nose
    } else {
      P.rows([[6, 2, 9], [7, 1, 10], [8, 1, 10], [9, 1, 10], [10, 2, 8], [11, 3, 6]], a.mid);
      for (const [x, y] of [[3, 8], [4, 8], [5, 8], [3, 9], [4, 9], [5, 9]]) P.clear(x, y);
      P.r(3, 6, 4, 7, b.mid); P.p(2, 10, b.mid); P.p(3, 10, b.mid); P.p(1, 9, OUT);
      P.p(7, 6, b.lo); P.p(8, 9, b.lo);
    }
    P.outline();
  },
};

// Body (below the chin): torso rows 12-13, legs rows 13-15.
const torso = (d) => (d === 'left' ? [4, 11] : [3, 12]);
const BODY = {
  tunic(P, d, a, b, o) {
    const [x0, x1] = torso(d);
    P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x0, 12, x0, 14, a.hi); P.r(x1, 13, x1, 14, a.lo);
    P.r(x0, 14, x1, 14, a.lo);                                         // hem shade
    P.r(x0, 13, x1, 13, b.mid); P.r(x0, 13, x0 + 1, 13, b.hi);        // belt
    if (d === 'down') { P.r(7, 13, 8, 13, [244, 210, 90]); P.r(7, 12, 8, 12, b.lo); }
    if (d === 'left') P.p(6, 13, [244, 210, 90]);
    if (o?.stripe) P.r(x0, 12, x1, 12, b.mid);
    P.p(x0 - 1, 12, a.mid); P.p(x1 + 1, 12, a.lo);                     // sleeve caps
    P.outline();
  },
  vest(P, d, a, b) {
    const [x0, x1] = torso(d);
    if (d === 'down') {
      P.r(3, 12, 5, 14, a.mid); P.r(10, 12, 12, 14, a.mid); P.r(3, 12, 5, 12, a.hi); P.r(10, 12, 12, 12, a.hi); P.r(3, 12, 3, 14, a.hi);
      P.r(3, 14, 12, 14, b.mid);                                        // belt
      P.p(6, 12, b.hi); P.p(9, 12, b.hi); P.p(6, 13, b.mid); P.p(9, 13, b.mid); P.p(7, 14, [244, 210, 90]); P.p(8, 14, [244, 210, 90]);
      P.p(5, 13, a.lo); P.p(12, 13, a.lo); P.p(2, 12, a.mid); P.p(13, 12, a.lo);
    } else {
      P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x1, 13, x1, 14, a.lo); P.r(x0, 14, x1, 14, b.mid);
      if (d === 'up') { P.r(7, 12, 8, 13, a.lo); P.p(2, 12, a.mid); P.p(13, 12, a.lo); }
      else P.p(6, 13, b.mid);
    }
    P.outline();
  },
  smock(P, d, a, b) {
    const [x0, x1] = torso(d);
    P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x1, 13, x1, 14, a.lo);
    P.p(x0 - 1, 12, a.mid); P.p(x1 + 1, 12, a.lo);
    if (d === 'down') {
      P.r(5, 13, 10, 15, b.mid); P.r(5, 13, 10, 13, b.hi); P.r(9, 14, 10, 15, b.lo);
      P.p(4, 12, b.mid); P.p(11, 12, b.mid); P.p(6, 14, b.lo); P.p(6, 15, b.lo);
    } else if (d === 'left') { P.r(4, 13, 7, 15, b.mid); P.r(4, 13, 7, 13, b.hi); P.r(6, 14, 7, 15, b.lo); }
    else { P.r(4, 12, 5, 12, b.mid); P.r(10, 12, 11, 12, b.mid); P.r(7, 13, 8, 13, b.mid); P.r(5, 14, 10, 14, b.mid); }
    P.outline();
  },
  jerkin(P, d, a, b) {
    const [x0, x1] = torso(d);
    P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x0, 12, x0, 14, a.hi); P.r(x1, 13, x1, 14, a.lo);
    P.r(x0, 14, x1, 14, b.lo);
    if (d === 'down') {
      P.p(4, 12, b.mid); P.p(5, 12, b.mid); P.p(6, 13, b.mid); P.p(7, 13, b.hi); P.p(9, 13, b.mid);
      P.r(6, 12, 9, 12, b.lo); P.p(10, 12, b.mid); P.p(11, 12, b.mid);
    } else if (d === 'up') { P.p(4, 12, b.mid); P.p(5, 12, b.mid); P.p(6, 13, b.mid); P.p(7, 13, b.mid); P.p(8, 13, b.mid); P.p(9, 14, b.mid); }
    else { P.p(5, 12, b.mid); P.p(6, 12, b.mid); P.p(7, 13, b.mid); P.p(8, 13, b.mid); }
    P.p(x0 - 1, 12, a.mid); P.p(x1 + 1, 12, a.lo);
    P.outline();
  },
  mail(P, d, a, b) {
    const [x0, x1] = torso(d);
    P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x0, 12, x0, 14, a.hi);
    for (let y = 13; y <= 14; y++) for (let x = x0 + (y % 2); x <= x1; x += 2) P.p(x, y, a.lo);
    P.r(x0, 14, x1, 14, b.mid);
    if (d === 'left') { P.r(5, 12, 9, 13, a.hi); P.r(8, 12, 9, 13, a.mid); P.p(5, 12, WHITE); }
    else { P.r(0, 12, 3, 13, a.hi); P.r(12, 12, 15, 13, a.mid); P.p(0, 12, WHITE); P.p(1, 12, WHITE); P.r(0, 13, 3, 13, a.lo); P.r(12, 13, 15, 13, a.lo); }
    if (d === 'down') { P.r(6, 12, 9, 12, b.mid); P.p(7, 13, a.hi); }
    P.outline();
  },
  plate(P, d, a, b) {
    const [x0, x1] = torso(d);
    P.r(x0, 12, x1, 14, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x0, 12, x0 + 1, 14, a.hi); P.r(x1 - 1, 13, x1, 14, a.lo);
    P.r(x0, 14, x1, 14, b.mid);                                          // tasset trim
    if (d === 'left') { P.r(5, 11, 9, 13, a.hi); P.r(8, 12, 9, 13, a.mid); P.r(5, 11, 9, 11, b.mid); }
    else {
      P.r(0, 11, 3, 13, a.hi); P.r(12, 11, 15, 13, a.mid); P.r(0, 11, 3, 11, b.mid); P.r(12, 11, 15, 11, b.lo);
      P.r(0, 13, 3, 13, a.lo); P.r(12, 13, 15, 13, a.lo); P.p(1, 12, WHITE);
    }
    if (d === 'down') { P.r(7, 12, 8, 13, b.mid); P.p(7, 12, b.hi); P.r(3, 13, 12, 13, a.lo); P.r(7, 13, 8, 13, b.mid); }
    P.outline();
  },
  robe(P, d, a, b, o) {
    const x0 = d === 'left' ? 3 : 2, x1 = d === 'left' ? 11 : 13;
    P.r(x0, 12, x1, 15, a.mid); P.r(x0, 12, x1, 12, a.hi); P.r(x0, 12, x0 + 1, 15, a.hi); P.r(x1 - 2, 13, x1, 15, a.lo);
    P.r(x0, 15, x1, 15, b.mid); P.r(x0 + 1, 15, x0 + 2, 15, b.hi);       // hem
    if (d !== 'left') { P.r(7, 13, 8, 15, a.lo); }
    if (o?.band) { P.r(7, 12, 8, 14, b.mid); P.r(7, 12, 7, 14, b.hi); P.r(x0, 13, x1, 13, b.lo); }
    // wide sleeves
    if (d === 'left') { P.r(5, 12, 8, 14, a.mid); P.r(5, 14, 8, 14, b.mid); }
    else { P.r(0, 12, 2, 14, a.mid); P.r(13, 12, 15, 14, a.lo); P.r(0, 14, 2, 14, b.mid); P.r(13, 14, 15, 14, b.lo); }
    if (d === 'down') P.r(6, 12, 9, 12, b.mid);
    P.outline();
  },
};
BODY.robe_trim = (P, d, a, b) => BODY.robe(P, d, a, b, { band: true });

// Feet (rows 13-15). Legs: x4..7 and x8..11 (front/back), x5..9 (profile).
const FEET = {
  boots(P, d, a, b, o) {
    const tall = o?.tall;
    if (d === 'left') {
      P.r(4, 13, 9, 15, a.mid); P.r(4, 13, 9, 13, b.mid); P.r(3, 15, 4, 15, a.lo); P.r(4, 15, 9, 15, a.lo2); P.r(4, 14, 5, 14, a.hi);
    } else {
      for (const x0 of [4, 8]) {
        P.r(x0, 14, x0 + 3, 15, a.mid); P.r(x0, 14, x0 + 3, 14, b.mid); P.r(x0, 15, x0 + 3, 15, a.lo2);
        P.r(x0, 14, x0, 15, a.hi);
      }
      if (d === 'down') { P.p(3, 15, a.lo); P.p(12, 15, a.lo); }
    }
    P.outline();
  },
  sandals(P, d, a, b) {
    if (d === 'left') { P.r(3, 15, 9, 15, a.mid); P.r(5, 14, 6, 14, b.mid); P.r(8, 14, 9, 14, b.mid); P.r(3, 15, 4, 15, a.hi); }
    else for (const x0 of [4, 8]) { P.r(x0, 15, x0 + 3, 15, a.mid); P.r(x0 + 1, 14, x0 + 2, 14, b.mid); P.p(x0, 15, a.hi); }
    P.outline();
  },
  slippers(P, d, a, b) {
    if (d === 'left') { P.r(4, 14, 9, 15, a.mid); P.r(4, 15, 9, 15, a.lo); P.p(2, 14, a.mid); P.p(3, 15, a.mid); P.p(2, 13, b.mid); P.p(4, 14, a.hi); P.p(7, 14, b.mid); }
    else for (const x0 of [4, 8]) { P.r(x0, 14, x0 + 3, 15, a.mid); P.r(x0, 15, x0 + 3, 15, a.lo); P.p(x0 + 1, 14, b.mid); P.p(x0 + 2, 14, b.mid); P.p(x0, 14, a.hi); }
    if (d === 'down') { P.p(3, 14, a.mid); P.p(3, 13, b.mid); P.p(12, 14, a.mid); P.p(12, 13, b.mid); }
    P.outline();
  },
  greaves(P, d, a, b) {
    if (d === 'left') {
      P.r(4, 13, 9, 15, a.mid); P.r(4, 13, 9, 13, b.mid); P.r(4, 13, 5, 15, a.hi); P.r(8, 14, 9, 15, a.lo); P.r(3, 15, 4, 15, a.lo); P.p(6, 14, WHITE);
    } else {
      for (const x0 of [4, 8]) {
        P.r(x0, 13, x0 + 3, 15, a.mid); P.r(x0, 13, x0 + 3, 13, b.mid); P.r(x0, 13, x0, 15, a.hi); P.r(x0 + 3, 14, x0 + 3, 15, a.lo);
        P.p(x0 + 1, 14, WHITE);
      }
    }
    P.outline();
  },
};

// Back layers sit behind the body (front/side) or in front of it (from behind).
const BACK = {
  cape(P, d, a, b, o) {
    const trim = o?.trim, royal = o?.royal;
    if (d === 'up') {
      P.r(2, 11, 13, 15, a.mid); P.r(1, 13, 14, 16, a.mid); P.r(3, 11, 4, 14, a.hi); P.r(11, 12, 13, 16, a.lo);
      P.r(4, 11, 11, 11, b.mid); P.p(7, 11, [244, 210, 90]); P.p(8, 11, [244, 210, 90]);
      P.r(1, 16, 14, 16, trim ? b.mid : a.lo2); P.r(6, 12, 9, 15, a.lo);
      if (royal) for (let x = 2; x <= 13; x += 2) { P.p(x, 16, WHITE); P.p(x + 1, 16, b.lo); }
    } else if (d === 'left') {
      P.r(9, 10, 14, 15, a.mid); P.r(10, 15, 15, 16, a.mid); P.r(9, 10, 10, 14, a.hi); P.r(13, 12, 15, 16, a.lo);
      if (trim || royal) P.r(10, 16, 15, 16, b.mid);
    } else {
      P.r(1, 11, 14, 15, a.mid); P.r(-1, 12, 16, 16, a.mid); P.r(0, 11, 2, 14, a.hi); P.r(13, 12, 16, 16, a.lo);
      P.r(-1, 16, 16, 16, trim || royal ? b.mid : a.lo2);
      if (royal) for (let x = -1; x <= 16; x += 2) { P.p(x, 16, WHITE); P.p(x + 1, 16, b.lo); }
    }
    P.outline();
  },
  pack(P, d, a, b) {
    if (d === 'up') {
      P.r(3, 10, 12, 15, a.mid); P.r(3, 10, 12, 10, a.hi); P.r(11, 11, 12, 15, a.lo);
      P.r(3, 12, 12, 12, b.mid); P.r(6, 12, 9, 13, b.hi); P.p(7, 13, [244, 210, 90]); P.p(8, 13, [244, 210, 90]);
      P.r(4, 15, 11, 15, b.mid); P.p(2, 12, b.mid); P.p(13, 12, b.mid);
      P.r(7, 8, 8, 9, a.lo);                                              // bedroll peek
    } else if (d === 'left') {
      P.r(10, 9, 15, 15, a.mid); P.r(10, 9, 15, 9, a.hi); P.r(14, 10, 15, 15, a.lo); P.r(10, 12, 15, 12, b.mid); P.r(10, 15, 15, 15, b.mid);
      P.r(11, 7, 14, 8, b.lo);
    } else {
      P.r(12, 9, 15, 13, a.mid); P.r(12, 9, 15, 9, a.hi); P.r(14, 10, 15, 13, a.lo); P.r(0, 9, 3, 13, a.mid); P.r(0, 9, 3, 9, a.hi); P.r(0, 10, 1, 13, a.hi);
      P.r(12, 12, 15, 12, b.mid); P.r(0, 12, 3, 12, b.mid); P.r(6, 13, 9, 14, null);
    }
    P.outline();
  },
  quiver(P, d, a, b) {
    const feathers = (x, y) => { P.p(x, y, b.hi); P.p(x + 1, y - 1, b.mid); P.p(x + 2, y, b.lo); P.p(x + 1, y, b.mid); };
    if (d === 'up') {
      P.r(9, 10, 12, 16, a.mid); P.r(9, 10, 9, 16, a.hi); P.r(12, 11, 12, 16, a.lo); P.r(9, 12, 12, 12, b.lo);
      feathers(9, 9); feathers(11, 8);
      for (let i = 0; i < 6; i++) P.p(3 + i, 12 + Math.min(i, 3) - (i > 3 ? 0 : 0), a.lo2);  // strap
    } else if (d === 'left') {
      P.r(10, 8, 13, 15, a.mid); P.r(10, 8, 10, 15, a.hi); P.r(13, 9, 13, 15, a.lo); feathers(10, 7); feathers(12, 6);
    } else {
      P.r(12, 7, 14, 14, a.mid); P.r(12, 7, 12, 14, a.hi); P.r(14, 8, 14, 14, a.lo); feathers(12, 6); feathers(14, 5);
    }
    P.outline();
  },
};
const feather = (P, x0, y0, len, dx, dy, a, b) => {
  for (let i = 0; i < len; i++) { P.p(x0 + dx * i, y0 + dy * i, i % 2 ? a.mid : a.hi); P.p(x0 + dx * i, y0 + dy * i + 1, a.lo); }
};
function wings(P, d, a, b, kind) {
  const W = (spans, c) => { P.rows(spans, c); };
  // left wing (screen-left) in front/back; mirrored for the other side
  const side = (mirror) => {
    const M = (x0, y0, x1, y1, c) => (mirror ? P.r(15 - x1, y0, 15 - x0, y1, c) : P.r(x0, y0, x1, y1, c));
    const Pp = (x, y, c) => (mirror ? P.p(15 - x, y, c) : P.p(x, y, c));
    if (kind === 'fairy') {
      M(-3, 1, -1, 6, a.mid); M(-4, 2, -2, 5, a.hi); M(-2, 7, 0, 11, a.mid); M(-3, 8, -1, 10, a.hi); M(-1, 4, 0, 8, a.mid);
      Pp(-3, 3, b.hi); Pp(-2, 9, b.hi); Pp(-1, 5, b.mid);
      M(-3, 6, -2, 6, a.lo);
    } else if (kind === 'bat') {
      M(-5, 2, -4, 6, a.mid); M(-4, 4, -1, 6, a.mid); M(-3, 7, 0, 9, a.mid); M(-5, 6, -4, 9, a.mid); M(-2, 10, 0, 11, a.mid);
      M(-6, 3, -6, 4, a.lo); Pp(-6, 10, a.lo); Pp(-3, 10, a.lo);
      for (let i = 0; i < 6; i++) Pp(-5 + Math.floor(i * 0.9), 2 + i, b.mid);      // bone spar
      Pp(-4, 10, null); Pp(-1, 11, a.lo); M(-5, 2, -5, 2, b.hi);
    } else {
      for (let i = 0; i < 5; i++) { M(-4 + (i < 2 ? -i : i - 3), 1 + i * 2, -1, 2 + i * 2, i % 2 ? a.mid : a.hi); }
      M(-5, 1, -3, 2, a.hi); M(-6, 3, -3, 4, a.mid); M(-5, 5, -2, 6, a.hi); M(-4, 7, -1, 8, a.mid); M(-3, 9, 0, 10, a.lo);
      Pp(-5, 2, b.mid); Pp(-4, 4, b.mid); Pp(-3, 6, b.mid); M(-1, 4, 0, 10, a.mid);
    }
  };
  if (d === 'left') {
    // one wing swept up and back behind the body
    if (kind === 'fairy') { P.r(10, 1, 13, 7, a.mid); P.r(11, 0, 14, 5, a.hi); P.r(9, 8, 12, 11, a.mid); P.p(12, 3, b.hi); P.p(11, 9, b.hi); P.r(13, 7, 14, 10, a.lo); }
    else if (kind === 'bat') { P.r(11, 0, 13, 6, a.mid); P.r(12, 4, 16, 7, a.mid); P.r(10, 8, 14, 10, a.mid); P.r(14, 1, 16, 3, a.lo); P.p(15, 8, a.lo); P.p(12, 11, a.lo); P.r(11, 0, 11, 7, b.mid); P.p(16, 5, b.mid); }
    else { P.r(10, 0, 14, 2, a.hi); P.r(10, 3, 15, 5, a.mid); P.r(10, 6, 14, 8, a.hi); P.r(10, 9, 13, 11, a.mid); P.p(13, 1, b.mid); P.p(14, 4, b.mid); P.p(12, 7, b.mid); P.r(14, 6, 15, 10, a.lo); }
  } else { side(false); side(true); }
  P.outline();
}
BACK.wings_fairy = (P, d, a, b) => wings(P, d, a, b, 'fairy');
BACK.wings_bat = (P, d, a, b) => wings(P, d, a, b, 'bat');
BACK.wings_angel = (P, d, a, b) => wings(P, d, a, b, 'angel');

// Off-hand: held at the near hand (front view: screen-left), behind the body
// from behind/profile so it peeks out.
const OFFHAND = {
  round(P, d, a, b) {
    if (d === 'down') {
      P.rows([[10, -1, 2], [11, -2, 3], [12, -2, 3], [13, -2, 3], [14, -1, 2]], a.mid);
      P.r(-2, 11, -1, 13, a.hi); P.r(2, 12, 3, 13, a.lo);
      P.r(0, 12, 1, 13, b.mid); P.p(0, 12, b.hi);                        // boss
      P.p(-1, 10, b.mid); P.p(2, 10, b.mid); P.p(-2, 14, b.lo);
    } else if (d === 'up') {
      P.rows([[10, 13, 16], [11, 12, 17], [12, 12, 17], [13, 12, 17], [14, 13, 16]], a.lo); P.r(14, 11, 15, 13, a.mid); P.r(13, 12, 16, 12, b.lo);
    } else {
      P.rows([[10, 7, 9], [11, 6, 10], [12, 6, 10], [13, 6, 10], [14, 7, 9]], a.mid); P.r(6, 11, 7, 13, a.hi); P.r(9, 12, 10, 13, b.mid); P.p(8, 12, b.hi);
    }
    P.outline();
  },
  kite(P, d, a, b) {
    if (d === 'down') {
      P.rows([[9, -2, 3], [10, -2, 3], [11, -2, 3], [12, -2, 3], [13, -1, 2], [14, -1, 2], [15, 0, 1]], a.mid);
      P.r(-2, 9, -1, 12, a.hi); P.r(2, 10, 3, 12, a.lo);
      P.r(0, 9, 1, 14, b.mid); P.r(-2, 11, 3, 11, b.mid); P.p(0, 11, b.hi);
    } else if (d === 'up') {
      P.rows([[9, 12, 17], [10, 12, 17], [11, 12, 17], [12, 12, 17], [13, 13, 16], [14, 13, 16], [15, 14, 15]], a.lo); P.r(14, 9, 15, 14, b.lo);
    } else {
      P.rows([[9, 6, 9], [10, 6, 9], [11, 6, 9], [12, 6, 9], [13, 7, 9], [14, 7, 8]], a.mid); P.r(6, 9, 7, 13, a.hi); P.r(8, 10, 9, 12, b.mid);
    }
    P.outline();
  },
  tower(P, d, a, b) {
    if (d === 'down') {
      P.r(-3, 6, 3, 15, a.mid); P.r(-3, 6, -2, 15, a.hi); P.r(2, 7, 3, 15, a.lo); P.r(-3, 6, 3, 6, b.mid); P.r(-3, 15, 3, 15, b.mid);
      P.r(0, 7, 0, 14, b.mid); P.r(-3, 10, 3, 10, b.mid); P.p(0, 10, b.hi); P.p(-2, 8, WHITE); P.p(2, 12, WHITE);
    } else if (d === 'up') {
      P.r(12, 6, 18, 15, a.lo); P.r(17, 6, 18, 15, a.lo2); P.r(12, 6, 18, 6, b.lo); P.r(14, 8, 15, 12, b.lo);
    } else {
      P.r(6, 6, 10, 15, a.mid); P.r(6, 6, 7, 15, a.hi); P.r(6, 6, 10, 6, b.mid); P.r(6, 15, 10, 15, b.mid); P.r(8, 8, 8, 13, b.mid);
    }
    P.outline();
  },
  tome(P, d, a, b) {
    if (d === 'down') {
      P.r(-2, 9, 3, 14, a.mid); P.r(-2, 9, 3, 9, a.hi); P.r(3, 10, 3, 14, [240, 232, 210]); P.r(-2, 14, 3, 14, a.lo);
      P.r(-1, 10, 2, 13, a.mid); P.p(0, 11, b.mid); P.p(1, 11, b.mid); P.p(0, 12, b.hi); P.p(-1, 10, b.mid); P.p(2, 13, b.mid);
    } else if (d === 'up') {
      P.r(12, 9, 17, 14, a.lo); P.r(12, 9, 13, 14, a.lo2); P.r(14, 10, 15, 13, b.lo);
    } else {
      P.r(6, 9, 10, 14, a.mid); P.r(6, 9, 10, 9, a.hi); P.r(10, 10, 10, 14, [240, 232, 210]); P.p(7, 11, b.mid); P.p(8, 12, b.mid);
    }
    P.outline();
  },
  lantern(P, d, a, b) {
    const glow = [255, 236, 150];
    if (d === 'down') {
      P.r(-1, 5, 2, 5, b.mid); P.p(0, 4, b.mid); P.p(1, 4, b.mid);       // handle
      P.r(-2, 6, 3, 6, b.lo); P.r(-2, 7, 3, 11, a.mid); P.r(-1, 8, 2, 10, glow); P.p(0, 9, WHITE); P.r(-2, 12, 3, 12, b.lo);
      P.p(-2, 7, a.hi); P.p(3, 11, a.lo);
    } else if (d === 'up') {
      P.r(12, 6, 17, 6, b.lo); P.r(12, 7, 17, 11, a.lo); P.r(13, 8, 16, 10, a.mid); P.r(12, 12, 17, 12, b.lo);
    } else {
      P.r(6, 5, 9, 5, b.mid); P.r(6, 6, 10, 6, b.lo); P.r(6, 7, 10, 11, a.mid); P.r(7, 8, 9, 10, glow); P.p(8, 9, WHITE); P.r(6, 12, 10, 12, b.lo);
    }
    P.outline();
  },
  orb(P, d, a, b) {
    const cx = d === 'down' ? 0 : d === 'up' ? 14 : 8, cy = 10;
    P.rows([[cy - 2, cx - 1, cx + 1], [cy - 1, cx - 2, cx + 2], [cy, cx - 2, cx + 2], [cy + 1, cx - 2, cx + 2], [cy + 2, cx - 1, cx + 1]], d === 'up' ? a.lo : a.mid);
    if (d !== 'up') { P.r(cx - 2, cy - 1, cx - 1, cy, a.hi); P.p(cx - 1, cy - 1, WHITE); P.r(cx + 1, cy + 1, cx + 2, cy + 1, a.lo); P.p(cx + 2, cy - 2, b.mid); P.p(cx - 3, cy + 3, b.mid); }
    P.outline();
  },
};

// Charm: pendant at the collar.
const CHARM = {
  pendant(P, d, a, b, shape) {
    if (d === 'up') return;
    const x = d === 'left' ? 6 : 7;
    P.p(x, 11, [200, 190, 160]); if (d === 'down') P.p(x + 1, 11, [200, 190, 160]);
    const cx = x, cy = 12;
    const big = d === 'down' ? 2 : 1;
    if (shape === 'leaf') { P.r(cx, cy, cx + 1, cy + 1, a.mid); P.p(cx, cy, a.hi); P.p(cx + 1, cy + 2, a.lo); }
    else if (shape === 'feather') { P.p(cx, cy, a.hi); P.p(cx + 1, cy + 1, a.mid); P.p(cx, cy + 1, a.mid); P.p(cx + 1, cy + 2, a.lo); P.p(cx + 1, cy, b.mid); }
    else if (shape === 'clover') { P.p(cx, cy, a.mid); P.p(cx + 1, cy, a.hi); P.p(cx, cy + 1, a.lo); P.p(cx + 1, cy + 1, a.mid); P.p(cx + 1, cy + 2, b.mid); }
    else if (shape === 'fang') { P.r(cx, cy, cx + 1, cy, a.mid); P.p(cx, cy + 1, a.hi); P.p(cx + 1, cy + 1, a.mid); P.p(cx, cy + 2, b.mid); }
    else if (shape === 'locket') { P.r(cx, cy, cx + 1, cy + 2, a.mid); P.p(cx, cy, a.hi); P.p(cx + 1, cy + 1, b.hi); P.p(cx + 1, cy + 2, a.lo); }
    else { P.r(cx, cy, cx + 1, cy + 1, a.mid); P.p(cx, cy, WHITE); P.p(cx + 1, cy + 1, a.lo); P.p(cx, cy + 2, b.lo); }
    void big;
  },
};

// style name → [painter, layer, options]. layer drives draw order in ModularPlayer.
export const STYLE_DEF = {
  brim: [HEAD.brim, 'head'], cap: [HEAD.cap, 'head'], cap_feather: [(P, d, a, b) => HEAD.cap(P, d, a, b, { feather: true }), 'head'],
  helm: [HEAD.helm, 'head'], helm_plume: [(P, d, a, b) => HEAD.helm(P, d, a, b, { plume: true }), 'head'],
  horns: [HEAD.horns, 'head'], cone: [HEAD.cone, 'head'], cone_stars: [(P, d, a, b) => HEAD.cone(P, d, a, b, { stars: true }), 'head'],
  crown: [HEAD.crown, 'head'], crown_gem: [(P, d, a, b) => HEAD.crown(P, d, a, b, { gem: true }), 'head'],
  hood: [HEAD.hood, 'head'], veil: [HEAD.veil, 'head'], band: [HEAD.band, 'head'], ears: [HEAD.ears, 'head'], wreath: [HEAD.wreath, 'head'],
  glasses: [FACE.glasses, 'face'], shades: [FACE.shades, 'face'], eyepatch: [FACE.eyepatch, 'face'],
  mask: [FACE.mask, 'face'], monocle: [FACE.monocle, 'face'], foxmask: [FACE.foxmask, 'face'],
  tunic: [BODY.tunic, 'body'], vest: [BODY.vest, 'body'], smock: [BODY.smock, 'body'], jerkin: [BODY.jerkin, 'body'],
  mail: [BODY.mail, 'body'], plate: [BODY.plate, 'body'], robe: [BODY.robe, 'body'], robe_trim: [BODY.robe_trim, 'body'],
  boots: [FEET.boots, 'feet'], sandals: [FEET.sandals, 'feet'], slippers: [FEET.slippers, 'feet'], greaves: [FEET.greaves, 'feet'],
  cape: [BACK.cape, 'back'], cape_trim: [(P, d, a, b) => BACK.cape(P, d, a, b, { trim: true }), 'back'],
  cape_royal: [(P, d, a, b) => BACK.cape(P, d, a, b, { royal: true }), 'back'],
  pack: [BACK.pack, 'back'], quiver: [BACK.quiver, 'back'],
  wings_fairy: [BACK.wings_fairy, 'back'], wings_bat: [BACK.wings_bat, 'back'], wings_angel: [BACK.wings_angel, 'back'],
  round: [OFFHAND.round, 'offhand'], kite: [OFFHAND.kite, 'offhand'], tower: [OFFHAND.tower, 'offhand'],
  tome: [OFFHAND.tome, 'offhand'], lantern: [OFFHAND.lantern, 'offhand'], orb: [OFFHAND.orb, 'offhand'],
  leaf: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'leaf'), 'charm'], feather: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'feather'), 'charm'],
  clover: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'clover'), 'charm'], fang: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'fang'), 'charm'],
  gem: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'gem'), 'charm'], locket: [(P, d, a, b) => CHARM.pendant(P, d, a, b, 'locket'), 'charm'],
};

// Worn-overlay texture key for an item in a facing (main colour may be dyed).
// Returns null for slots without worn art (weapons use the real in-hand sprite).
export function wearTexture(scene, item, dir, mainTint) {
  const def = item && STYLE_DEF[item.style];
  if (!def) return null;
  const main = mainTint ?? item.colors.main, trim = item.colors.trim;
  const k = `wear.${item.style}.${dir}.${main.toString(16)}.${trim.toString(16)}`;
  if (scene.textures.exists(k)) return k;
  const P = new PX();
  const d = dir === 'right' ? 'left' : dir;
  def[0](P, d, ramp(main), ramp(trim));
  scene.textures.addCanvas(k, P.toCanvas(dir === 'right'));
  return k;
}
