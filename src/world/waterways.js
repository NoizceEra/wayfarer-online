// Overworld road / river / coast geometry (pure functions, no Phaser).
// Control points come from data/worldLayout.js (tile coords); here they are smoothed (Catmull-Rom),
// wobbled with value noise, and put into a bucket grid so a per-pixel "how far is the nearest road /
// river" query touches only a handful of segments. Used by:
//   ground.js        bakes roads, rims, rivers, foam and the north-coast bay into the ground texture
//   overworld.js     keeps scatter props off roads and out of the water, builds the water collision
//   spawner.js       keeps enemy spawns out of the water
//   riverFx.js       glints / reeds along the rivers
//   UIScene/Overlay  minimap + world map overlays
import { ROADS, RIVERS, BRIDGES } from '../data/worldLayout.js';

const T = 16;
const WORLD = 128 * T;
const TOWN = { x: 1024, y: 1024 }; // Thistle Town centre (town rect 48..80 tiles)

// --- tiny deterministic noise (own copy, so this module has no imports from ground.js) ---
const hash2 = (x, y, s = 0) => {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const sm = (t) => t * t * (3 - 2 * t);
export const vnoise = (x, y, s = 0) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
};
const step01 = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Catmull-Rom through control points (tile coords -> px), n samples per control segment
function dense(ptsTile, n = 8) {
  const p = ptsTile.map(([x, y]) => [x * T, y * T]);
  const out = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(0, i - 1)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(p.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((a) => 0.5 * ((2 * p1[a]) + (-p0[a] + p2[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (-p0[a] + 3 * p1[a] - 3 * p2[a] + p3[a]) * t3)));
    }
  }
  out.push(p[p.length - 1]);
  return out;
}

const bridgeDist = (x, y) => {
  let d = 1e9;
  for (const b of BRIDGES) d = Math.min(d, Math.hypot(b.x * T - x, b.y * T - y));
  return d;
};

// lateral wobble along a dense polyline (zero near bridges, the town and the ends)
function wobble(pts, amp, seed, freq) {
  const n = pts.length;
  return pts.map((q, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
    const endF = Math.min(1, Math.min(i, n - 1 - i) / 5);
    const bridgeF = step01(40, 110, bridgeDist(q[0], q[1]));
    const townF = step01(230, 330, Math.hypot(q[0] - TOWN.x, q[1] - TOWN.y));
    const o = (vnoise(i * freq, seed * 7.3, seed) - 0.5) * 2 * amp * endF * bridgeF * townF;
    return [q[0] + nx * o, q[1] + ny * o];
  });
}

// bucket grid over segments
const CELL = 32;
const GN = Math.ceil(WORLD / CELL) + 1;
function makeIndex(items, pad) {
  const cells = new Array(GN * GN);
  const segs = [];
  items.forEach((it, owner) => {
    const P = it.pts;
    for (let i = 0; i < P.length - 1; i++) {
      const id = segs.length;
      const s = { ax: P[i][0], ay: P[i][1], bx: P[i + 1][0], by: P[i + 1][1], owner, i };
      segs.push(s);
      const x0 = Math.max(0, Math.floor((Math.min(s.ax, s.bx) - pad) / CELL)), x1 = Math.min(GN - 1, Math.floor((Math.max(s.ax, s.bx) + pad) / CELL));
      const y0 = Math.max(0, Math.floor((Math.min(s.ay, s.by) - pad) / CELL)), y1 = Math.min(GN - 1, Math.floor((Math.max(s.ay, s.by) + pad) / CELL));
      for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) (cells[cy * GN + cx] ||= []).push(id);
    }
  });
  return { cells, segs };
}

let NET = null;
export function network() {
  if (NET) return NET;
  const roads = ROADS.map((r, k) => {
    const track = r.kind === 'track';
    const pts = wobble(dense(r.pts, 8), track ? 5 : 7, 11 + k, 0.17);
    return { id: r.id, kind: r.kind, hw: track ? 6.5 : r.kind === 'cobble' ? 12 : 11, pts };
  });
  const rivers = RIVERS.map((r, k) => {
    const pts = wobble(dense(r.pts, 10), 9, 51 + k, 0.09);
    let len = 0; const cum = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(len); }
    return { id: r.id, name: r.name, w0: r.w[0], w1: r.w[1], pts, cum, len };
  });
  NET = { roads, rivers, roadIdx: makeIndex(roads, 52), riverIdx: makeIndex(rivers, 64), bridges: BRIDGES.map((b) => ({ ...b, px: b.x * T, py: b.y * T, hl: (b.len * T) / 2, hw: (b.w || 36) / 2 })) };
  return NET;
}

function nearest(idx, pts, x, y, cb) {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  if (cx < 0 || cy < 0 || cx >= GN || cy >= GN) return;
  const list = idx.cells[cy * GN + cx];
  if (!list) return;
  for (let k = 0; k < list.length; k++) {
    const s = idx.segs[list[k]];
    const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (y - s.ay) * dy) / l2));
    cb(Math.hypot(x - (s.ax + dx * t), y - (s.ay + dy * t)), s, t);
  }
}

// Nearest road: { d: centre-line distance, e: d - half width, kind, hw }. d = 999 when farther than ~50px.
const ROAD_RES = { d: 999, e: 999, kind: null, hw: 0, id: null };
export function roadAt(x, y, out = ROAD_RES) {
  const N = network();
  out.d = 999; out.e = 999; out.kind = null; out.hw = 0; out.id = null;
  nearest(N.roadIdx, null, x, y, (d, s) => {
    const r = N.roads[s.owner];
    const hw = r.hw + (vnoise(x / 16, y / 16, 16) - 0.5) * (r.kind === 'track' ? 3 : 6);
    if (d - hw < out.e) { out.e = d - hw; out.kind = r.kind; out.hw = hw; out.id = r.id; }
    if (d < out.d) out.d = d;
  });
  return out;
}
export function roadDist(x, y) { return roadAt(x, y, { d: 999, e: 999, kind: null, hw: 0 }).d; }

// Signed distance to the nearest river edge (negative = water). { sd, t (0..1 along the river), id, hw }
const RIV_RES = { sd: 999, t: 0, id: null, hw: 0 };
export function riverAt(x, y, out = RIV_RES) {
  const N = network();
  out.sd = 999; out.t = 0; out.id = null; out.hw = 0;
  nearest(N.riverIdx, null, x, y, (d, s, tt) => {
    const r = N.rivers[s.owner];
    const along = (r.cum[s.i] + (r.cum[s.i + 1] - r.cum[s.i]) * tt) / r.len;
    const hw = (r.w0 + (r.w1 - r.w0) * along) + (vnoise(x / 26, y / 26, 41) - 0.5) * 7;
    if (d - hw < out.sd) { out.sd = d - hw; out.t = along; out.id = r.id; out.hw = hw; }
  });
  return out;
}

// North-coast bay (Lookout Mara's lighthouse stands on the headland at x~1860)
const BAY_X0 = 1380;
export const LIGHTHOUSE = { x: 1861, y: 114 };
export function shoreY(x) {
  if (x < BAY_X0 - 60) return 24;
  const bump = step01(BAY_X0, BAY_X0 + 190, x);
  const head = Math.exp(-(((x - LIGHTHOUSE.x) / 46) ** 2));
  return 24 + (66 * bump - 38 * head * bump) + (vnoise(x / 28, 3, 77) - 0.5) * 8 * bump;
}
export function coastSD(x, y) { return x < BAY_X0 - 60 ? 999 : y - shoreY(x); }

// Combined signed distance to open water (rivers + bay).
export function waterSD(x, y) { return Math.min(riverAt(x, y).sd, coastSD(x, y)); }

export function onBridge(x, y, pad = 0) {
  for (const b of network().bridges) if (Math.abs(x - b.px) <= b.hl + pad && Math.abs(y - b.py) <= b.hw + pad) return true;
  return false;
}
// Is (x,y) water the hero cannot cross (bridge decks are dry)? margin > 0 keeps spawns away from the shore.
export function waterAt(x, y, margin = 0) {
  if (x < 0 || y < 0 || x > WORLD || y > WORLD) return false;
  return waterSD(x, y) < -1 + margin && !onBridge(x, y);
}
export function nearestDry(x, y, margin = 6) {
  if (!waterAt(x, y, margin)) return { x, y };
  for (let r = 8; r < 400; r += 8) {
    for (let a = 0; a < 16; a++) {
      const px = x + Math.cos((a / 16) * 6.283) * r, py = y + Math.sin((a / 16) * 6.283) * r;
      if (px > 40 && py > 40 && px < WORLD - 40 && py < WORLD - 40 && !waterAt(px, py, margin)) return { x: px, y: py };
    }
  }
  return { x, y };
}

// Collision rectangles (px) for all open water: 8px rows, merged horizontally, then vertically.
export function waterRects(cell = 8) {
  const rows = [];
  for (let gy = 0; gy < WORLD / cell; gy++) {
    const y = gy * cell + cell / 2;
    let run = null;
    const runs = [];
    for (let gx = 0; gx < WORLD / cell; gx++) {
      const x = gx * cell + cell / 2;
      const wet = x > 24 && y > 24 && x < WORLD - 24 && y < WORLD - 24 && waterSD(x, y) < -1.5 && !onBridge(x, y);
      if (wet) { if (!run) { run = { x0: gx, x1: gx + 1 }; runs.push(run); } else run.x1 = gx + 1; } else run = null;
    }
    rows.push(runs);
  }
  const out = [];
  const open = new Map();
  for (let gy = 0; gy <= rows.length; gy++) {
    const runs = rows[gy] || [];
    const keep = new Map();
    for (const r of runs) {
      const k = r.x0 + ':' + r.x1;
      const prev = open.get(k);
      if (prev) { prev.gy1 = gy + 1; keep.set(k, prev); } else { const n = { x0: r.x0, x1: r.x1, gy0: gy, gy1: gy + 1 }; keep.set(k, n); out.push(n); }
    }
    open.clear(); for (const [k, v] of keep) open.set(k, v);
  }
  return out.map((r) => ({ x: r.x0 * cell, y: r.gy0 * cell, w: (r.x1 - r.x0) * cell, h: (r.gy1 - r.gy0) * cell }));
}

// A point along a river at arc-length s (px), for gliding glints / placing things. Returns [x, y, tx, ty].
export function riverPoint(i, s) {
  const r = network().rivers[i];
  s = Math.max(0, Math.min(r.len - 0.01, s));
  let lo = 0, hi = r.cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
  const t = (s - r.cum[lo]) / ((r.cum[hi] - r.cum[lo]) || 1);
  const a = r.pts[lo], b = r.pts[hi];
  const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
  return [a[0] + dx * t, a[1] + dy * t, dx / l, dy / l];
}
export function riverHalfWidth(i, s) { const r = network().rivers[i]; return r.w0 + (r.w1 - r.w0) * (s / r.len); }

export { T as TILE };
