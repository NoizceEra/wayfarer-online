// Pure (no Phaser) terrain generators for the procedural maps: Sunscorch Desert,
// Whisperfen Marsh, Emberdeep Caverns and the Hollow Depths dungeon floors.
// Everything is deterministic per seed so data/areasExtra.js can derive minimap
// layers at load time and the headless tests can assert connectivity in Node.
import { vnoise } from './ground.js';

export const rng32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
export const hashStr = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const fbm = (x, y, seed = 0, oct = 3) => {
  let v = 0, a = 0.5, f = 1, t = 0;
  for (let o = 0; o < oct; o++) { v += vnoise(x * f, y * f, seed + o * 7) * a; t += a; a *= 0.5; f *= 2; }
  return v / t;
};

export class Grid {
  constructor(w, h, fill = 0) { this.w = w; this.h = h; this.a = new Uint8Array(w * h).fill(fill); }
  in(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  get(x, y) { return this.in(x, y) ? this.a[y * this.w + x] : 255; }
  set(x, y, v) { if (this.in(x, y)) this.a[y * this.w + x] = v; }
  rect(x, y, w, h, v) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, v); }
  // filled ellipse; `only` (optional) = set of classes it may overwrite
  ellipse(cx, cy, rx, ry, v, only = null) {
    for (let j = Math.floor(cy - ry); j <= Math.ceil(cy + ry); j++) {
      for (let i = Math.floor(cx - rx); i <= Math.ceil(cx + rx); i++) {
        const d = ((i + 0.5 - cx) / rx) ** 2 + ((j + 0.5 - cy) / ry) ** 2;
        if (d <= 1 && (!only || only.includes(this.get(i, j)))) this.set(i, j, v);
      }
    }
  }
  // stamp a thick polyline (tile coords); fn(cls) -> new class or -1 to keep
  line(pts, r, fn) {
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
      const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
      for (let s = 0; s <= n; s++) {
        const cx = ax + (bx - ax) * (s / n), cy = ay + (by - ay) * (s / n);
        for (let j = Math.floor(cy - r); j <= Math.ceil(cy + r); j++) for (let i = Math.floor(cx - r); i <= Math.ceil(cx + r); i++) {
          if ((i + 0.5 - cx) ** 2 + (j + 0.5 - cy) ** 2 > r * r) continue;
          const nv = fn(this.get(i, j), i, j);
          if (nv >= 0) this.set(i, j, nv);
        }
      }
    }
  }
}

// BFS flood over walkable cells (4-neighbour) -> Uint8Array mask of reached cells.
export function reach(grid, walk, sx, sy) {
  const m = new Uint8Array(grid.w * grid.h);
  const q = [[sx, sy]];
  if (!grid.in(sx, sy) || !walk(grid.get(sx, sy))) return m;
  m[sy * grid.w + sx] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!grid.in(nx, ny) || m[ny * grid.w + nx] || !walk(grid.get(nx, ny))) continue;
      m[ny * grid.w + nx] = 1; q.push([nx, ny]);
    }
  }
  return m;
}

// Merge solid cells into as few tile rectangles [x, y, w, h] as possible.
export function solidRects(grid, isSolid) {
  const out = [];
  let open = new Map(); // "x:w" -> rect still growing downwards
  for (let y = 0; y <= grid.h; y++) {
    const next = new Map();
    let x = 0;
    while (x < grid.w && y < grid.h) {
      if (!isSolid(grid.get(x, y), x, y)) { x++; continue; }
      let x1 = x;
      while (x1 < grid.w && isSolid(grid.get(x1, y), x1, y)) x1++;
      const key = `${x}:${x1 - x}`;
      const r = open.get(key);
      if (r) { r[3]++; next.set(key, r); open.delete(key); } else { const nr = [x, y, x1 - x, 1]; out.push(nr); next.set(key, nr); }
      x = x1;
    }
    open = next;
  }
  return out;
}

// Coarse minimap layers (colour per block, run-length merged per row).
export function minimapLayers(grid, colorOf, block = 4) {
  const out = [];
  const bw = Math.ceil(grid.w / block), bh = Math.ceil(grid.h / block);
  for (let by = 0; by < bh; by++) {
    let run = null;
    for (let bx = 0; bx <= bw; bx++) {
      let col = null;
      if (bx < bw) {
        const cnt = new Map();
        for (let j = 0; j < block; j++) for (let i = 0; i < block; i++) {
          const c = colorOf(grid.get(bx * block + i, by * block + j));
          if (c != null) cnt.set(c, (cnt.get(c) || 0) + 1);
        }
        let best = 0;
        for (const [c, n] of cnt) if (n > best) { best = n; col = c; }
      }
      if (run && run.color === col) { run.r[2] += block; continue; }
      if (run) out.push(run);
      run = col == null ? null : { color: col, r: [bx * block, by * block, block, block] };
    }
  }
  for (const l of out) { l.r[2] = Math.min(l.r[2], grid.w - l.r[0]); l.r[3] = Math.min(l.r[3], grid.h - l.r[1]); }
  return out;
}

// ─────────────────────────── Sunscorch Desert ───────────────────────────
export const DS = { SAND: 0, DUNE: 1, CLIFF: 2, WATER: 3, PAVED: 4, PATH: 5, GRASS: 6, WALL: 7 };
export const DESERT = {
  W: 80, H: 60, spawn: [5.5, 30.5], exit: [1.5, 30.5], waystone: [10, 25.5],
  hub: { x: 2, y: 21, w: 17, h: 18 }, pond: { cx: 10.5, cy: 31, rx: 4, ry: 2.6 },
  temple: { x: 56, y: 5, w: 22, h: 20, gate: [64, 67] },
  oasis2: { cx: 52, cy: 47, rx: 6, ry: 4 },
  path: [[19, 30.5], [28, 31], [38, 28.5], [48, 32], [56, 35], [62, 30], [66, 27], [66.5, 24]],
  pathSouth: [[48, 32], [50, 41], [52, 46]],
  pathNorth: [[38, 28.5], [37, 20], [36, 13], [34, 9]],
  bossSpot: [67, 10],
};
export function genDesert() {
  const D = DESERT, W = D.W, H = D.H, g = new Grid(W, H, DS.SAND), rnd = rng32(0xD35E);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / 13 + 3, y / 10, 21, 3);
    const band = ((n * 6.5 + x * 0.05 + y * 0.11) % 1 + 1) % 1;
    g.set(x, y, band > 0.64 ? DS.DUNE : DS.SAND);
  }
  const keep = (x, y) => { // never build mesas on the hub / temple / main paths
    const inR = (r, m) => x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;
    return inR(D.hub, 2) || inR(D.temple, 2);
  };
  const pathDist = (x, y) => {
    let best = 1e9;
    for (const line of [D.path, D.pathSouth, D.pathNorth]) for (let k = 0; k < line.length - 1; k++) {
      const [ax, ay] = line[k], [bx, by] = line[k + 1];
      const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), y - (ay + dy * t)));
    }
    return best;
  };
  // sandstone mesas
  for (let k = 0; k < 40; k++) {
    const cx = 22 + rnd() * 56, cy = 2 + rnd() * 56, rx = 2 + rnd() * 5, ry = 1.6 + rnd() * 3.4;
    if (keep(cx, cy) || pathDist(cx, cy) < Math.max(rx, ry) + 3) continue;
    g.ellipse(cx, cy, rx, ry, DS.CLIFF);
  }
  // hub: packed sand camp with a spring-fed pond
  g.rect(D.hub.x, D.hub.y, D.hub.w, D.hub.h, DS.PATH);
  g.ellipse(D.pond.cx, D.pond.cy, D.pond.rx + 1.8, D.pond.ry + 1.6, DS.GRASS);
  g.ellipse(D.pond.cx, D.pond.cy, D.pond.rx, D.pond.ry, DS.WATER);
  // second oasis (fishing + palms)
  g.ellipse(D.oasis2.cx, D.oasis2.cy, D.oasis2.rx + 2.4, D.oasis2.ry + 2, DS.GRASS);
  g.ellipse(D.oasis2.cx, D.oasis2.cy, D.oasis2.rx, D.oasis2.ry, DS.WATER);
  // the Temple of the Sunken Sun: walled, paved, gate on the south side
  const T = D.temple;
  g.rect(T.x, T.y, T.w, T.h, DS.WALL);
  g.rect(T.x + 1, T.y + 1, T.w - 2, T.h - 2, DS.PAVED);
  g.rect(T.gate[0], T.y + T.h - 1, T.gate[1] - T.gate[0] + 1, 1, DS.PAVED);
  // inner colonnade niches: wall stubs that leave a cross-shaped walkway
  for (const [ox, oy] of [[4, 7], [15, 7], [4, 12], [15, 12]]) g.rect(T.x + ox, T.y + oy, 3, 2, DS.WALL);
  // roads last, so they always carve through dunes and mesas
  const carve = (c, x, y) => (c === DS.WATER || c === DS.WALL || (c === DS.PAVED) || (x >= D.hub.x && x < D.hub.x + D.hub.w && y >= D.hub.y && y < D.hub.y + D.hub.h) ? -1 : DS.PATH);
  for (const line of [D.path, D.pathSouth, D.pathNorth]) g.line(line, 1.6, carve);
  // a sheltered clearing at the end of the north path (obelisk field)
  g.ellipse(34.5, 8.5, 5, 3.5, DS.PATH, [DS.SAND, DS.DUNE, DS.CLIFF]);
  return g;
}
export const desertSolid = (c) => c === DS.CLIFF || c === DS.WATER || c === DS.WALL;

// ─────────────────────────── Whisperfen Marsh ───────────────────────────
export const MS = { MUD: 0, GRASS: 1, SHALLOW: 2, DEEP: 3, BOARD: 4, REED: 5, PEAT: 6 };
export const MARSH = {
  W: 80, H: 60, spawn: [5.5, 30.5], exit: [1.5, 30.5], waystone: [10.5, 26],
  hub: { x: 2, y: 21, w: 16, h: 18 },
  board: [[18, 30.5], [26, 28], [34, 31], [42, 29], [50, 25], [58, 20], [64, 15]],
  boardSouth: [[34, 31], [38, 39], [44, 45], [54, 47], [63, 43]],
  boardNorth: [[26, 28], [24, 20], [28, 12], [36, 9]],
  bossIsland: { cx: 67, cy: 13, r: 7 },
  bossSpot: [67, 12],
};
export function genMarsh() {
  const M = MARSH, W = M.W, H = M.H, g = new Grid(W, H, MS.MUD), rnd = rng32(0xFE44);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const n = fbm(x / 9 + 11, y / 9, 55, 3), n2 = fbm(x / 6, y / 6 + 40, 91, 2);
    let c = MS.MUD;
    if (n > 0.6) c = MS.DEEP; else if (n > 0.53) c = MS.SHALLOW;
    else if (n2 > 0.64) c = MS.GRASS; else if (n2 < 0.3) c = MS.PEAT;
    g.set(x, y, c);
  }
  // reed beds on the shore of the shallows
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (g.get(x, y) === MS.MUD && [g.get(x + 1, y), g.get(x - 1, y), g.get(x, y + 1), g.get(x, y - 1)].includes(MS.SHALLOW) && rnd() < 0.55) g.set(x, y, MS.REED);
  }
  // stilt-village island (hub) + boss island
  g.ellipse(M.hub.x + M.hub.w / 2 + 1, M.hub.y + M.hub.h / 2, M.hub.w / 2 + 3, M.hub.h / 2 + 3, MS.MUD);
  g.rect(M.hub.x, M.hub.y, M.hub.w, M.hub.h, MS.GRASS);
  g.ellipse(M.bossIsland.cx, M.bossIsland.cy, M.bossIsland.r + 2, M.bossIsland.r + 1.5, MS.MUD);
  g.ellipse(M.bossIsland.cx, M.bossIsland.cy, M.bossIsland.r, M.bossIsland.r - 1, MS.PEAT);
  // little huts islands on the south boardwalk
  for (const [cx, cy] of [[44, 45], [63, 43]]) { g.ellipse(cx, cy, 5.5, 4, MS.MUD); g.ellipse(cx, cy, 3.6, 2.6, MS.GRASS); }
  // boardwalks carve through everything but the hub grass
  const inHub = (x, y) => x >= M.hub.x && x < M.hub.x + M.hub.w && y >= M.hub.y && y < M.hub.y + M.hub.h;
  for (const line of [M.board, M.boardSouth, M.boardNorth]) g.line(line, 1.15, (c, x, y) => (inHub(x, y) ? -1 : MS.BOARD));
  // never let deep water touch the hub shore: soften
  for (let y = M.hub.y - 2; y < M.hub.y + M.hub.h + 2; y++) for (let x = M.hub.x - 2; x < M.hub.x + M.hub.w + 2; x++) if (g.get(x, y) === MS.DEEP) g.set(x, y, MS.SHALLOW);
  return g;
}
export const marshSolid = (c) => c === MS.DEEP;

// ─────────────────────────── shared room + corridor carver ───────────────────────────
// Returns { grid, rooms, edges }. Floor cells = 1 (callers may reclassify). Rooms are
// joined by a minimum spanning tree (+ `loops` extra links) with L-shaped corridors,
// so every room is reachable by construction.
export function genRooms(rnd, W, H, o = {}) {
  const { rooms: n = 9, minW = 6, maxW = 12, minH = 5, maxH = 9, corridor = 2, margin = 2, fixed = [], gap = 2, loops = 1, tries = 400 } = o;
  const grid = new Grid(W, H, 0);
  const rooms = fixed.map((r) => ({ ...r }));
  const overlaps = (a, b) => a.x - gap < b.x + b.w && a.x + a.w + gap > b.x && a.y - gap < b.y + b.h && a.y + a.h + gap > b.y;
  for (let t = 0; t < tries && rooms.length < n; t++) {
    const w = minW + Math.floor(rnd() * (maxW - minW + 1)), h = minH + Math.floor(rnd() * (maxH - minH + 1));
    const r = { x: margin + Math.floor(rnd() * (W - w - margin * 2)), y: margin + Math.floor(rnd() * (H - h - margin * 2)), w, h };
    if (rooms.some((q) => overlaps(r, q))) continue;
    rooms.push(r);
  }
  for (const r of rooms) { r.cx = Math.floor(r.x + r.w / 2); r.cy = Math.floor(r.y + r.h / 2); grid.rect(r.x, r.y, r.w, r.h, 1); }
  // Prim MST on centre distance
  const edges = [];
  const inTree = new Set([0]);
  while (inTree.size < rooms.length) {
    let best = null;
    for (const i of inTree) for (let j = 0; j < rooms.length; j++) {
      if (inTree.has(j)) continue;
      const d = Math.hypot(rooms[i].cx - rooms[j].cx, rooms[i].cy - rooms[j].cy);
      if (!best || d < best.d) best = { i, j, d };
    }
    edges.push([best.i, best.j]); inTree.add(best.j);
  }
  for (let k = 0; k < loops; k++) {
    const i = Math.floor(rnd() * rooms.length), j = Math.floor(rnd() * rooms.length);
    if (i !== j && !edges.some(([a, b]) => (a === i && b === j) || (a === j && b === i))) edges.push([i, j]);
  }
  const corr = [];
  for (const [i, j] of edges) {
    const a = rooms[i], b = rooms[j], hFirst = rnd() < 0.5;
    const pts = hFirst ? [[a.cx, a.cy], [b.cx, a.cy], [b.cx, b.cy]] : [[a.cx, a.cy], [a.cx, b.cy], [b.cx, b.cy]];
    const cells = [];
    for (let k = 0; k < 2; k++) {
      const [x0, y0] = pts[k], [x1, y1] = pts[k + 1];
      const sx = Math.sign(x1 - x0), sy = Math.sign(y1 - y0);
      let x = x0, y = y0;
      while (x !== x1 || y !== y1) {
        for (let w = 0; w < corridor; w++) { const cx = x + (sy !== 0 ? w : 0), cy = y + (sx !== 0 ? w : 0); if (grid.get(cx, cy) === 0) { grid.set(cx, cy, 2); cells.push([cx, cy]); } }
        if (x !== x1) x += sx; else y += sy;
      }
    }
    corr.push({ i, j, cells, pts });
  }
  return { grid, rooms, edges, corr };
}

// ─────────────────────────── Emberdeep Caverns ───────────────────────────
export const CV = { ROCK: 0, FLOOR: 1, LAVA: 2, BRIDGE: 3, HUB: 4 };
export const CAVERN = {
  W: 64, H: 52, spawn: [5.5, 40.5], exit: [1.5, 40.5], waystone: [8.5, 37],
  hub: { x: 2, y: 35, w: 12, h: 10 },
};
export function genCavern() {
  const C = CAVERN, rnd = rng32(0xE3BE2);
  const res = genRooms(rnd, C.W, C.H, { rooms: 9, minW: 7, maxW: 12, minH: 6, maxH: 9, corridor: 2, margin: 2, gap: 3, loops: 2, fixed: [{ ...C.hub }] });
  const { grid, rooms } = res;
  // corridors (2) + rooms (1) -> FLOOR everywhere
  for (let i = 0; i < grid.a.length; i++) if (grid.a[i] === 2) grid.a[i] = CV.FLOOR;
  grid.rect(C.hub.x, C.hub.y, C.hub.w, C.hub.h, CV.HUB);
  // graph distances from the hub
  const adj = rooms.map(() => []);
  for (const [a, b] of res.edges) { adj[a].push(b); adj[b].push(a); }
  const dist = rooms.map(() => -1); dist[0] = 0;
  const q = [0];
  while (q.length) { const v = q.shift(); for (const u of adj[v]) if (dist[u] < 0) { dist[u] = dist[v] + 1; q.push(u); } }
  let boss = 1;
  for (let i = 1; i < rooms.length; i++) if (dist[i] > dist[boss] || (dist[i] === dist[boss] && rooms[i].w * rooms[i].h > rooms[boss].w * rooms[boss].h)) boss = i;
  rooms.forEach((r, i) => { r.role = i === 0 ? 'hub' : i === boss ? 'boss' : 'cave'; r.dist = dist[i]; });
  // lava pools inside rooms (2-tile margin keeps every doorway open)
  for (const r of rooms) {
    if (r.role === 'hub') continue;
    const pools = r.role === 'boss' ? 2 : 1 + Math.floor(rnd() * 2);
    for (let k = 0; k < pools; k++) {
      const rx = 1.2 + rnd() * Math.max(0.6, (r.w - 6) / 2), ry = 1 + rnd() * Math.max(0.6, (r.h - 6) / 2);
      const cx = r.x + 3 + rnd() * Math.max(0, r.w - 6), cy = r.y + 3 + rnd() * Math.max(0, r.h - 6);
      if (r.role === 'boss' && Math.hypot(cx - r.cx, cy - r.cy) < 3.5) continue; // keep the boss arena centre clear
      grid.ellipse(cx, cy, rx, ry, CV.LAVA, [CV.FLOOR]);
    }
  }
  // one lava river cutting a corridor, with a one-tile obsidian bridge
  const cor = res.corr.filter((c) => c.cells.length > 10 && c.i !== 0).sort((a, b) => b.cells.length - a.cells.length)[0];
  if (cor) {
    const mid = Math.floor(cor.cells.length / 2);
    for (let k = mid - 2; k < mid + 2; k++) { const [x, y] = cor.cells[k]; if (grid.get(x, y) === CV.FLOOR) grid.set(x, y, CV.LAVA); }
    for (let k = mid - 2; k < mid + 2; k += 2) { const [x, y] = cor.cells[k]; grid.set(x, y, CV.BRIDGE); }
    // make the bridge continuous: pick one lane cell per column/row
    for (let k = mid - 2; k < mid + 2; k++) {
      const [x, y] = cor.cells[k];
      if (grid.get(x, y) === CV.LAVA && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid.get(x + dx, y + dy) === CV.BRIDGE)) grid.set(x, y, CV.BRIDGE);
    }
  }
  // repair: anything lava-locked from the hub is carved back open
  const walk = (c) => c !== CV.ROCK && c !== CV.LAVA;
  let m = reach(grid, walk, Math.floor(C.spawn[0]), Math.floor(C.spawn[1]));
  for (const r of rooms) {
    if (m[r.cy * grid.w + r.cx] && r.role !== 'cave') continue;
    if (!m[r.cy * grid.w + r.cx]) { grid.rect(r.cx - 1, r.cy - 1, 3, 3, CV.FLOOR); }
  }
  m = reach(grid, walk, Math.floor(C.spawn[0]), Math.floor(C.spawn[1]));
  return { grid, rooms, edges: res.edges, reachMask: m, boss: rooms[boss] };
}
export const cavernSolid = (c) => c === CV.ROCK || c === CV.LAVA;

// ─────────────────────────── Hollow Depths floors ───────────────────────────
export const HD = { ROCK: 0, FLOOR: 1, CORR: 2, STAIRS: 3, TRAP: 4, VOID: 5 };
export const HOLLOW = { W: 56, H: 44 };
// floorIndex: 0-based; floors: total; returns the full layout for that floor.
export function genHollowFloor(seed, floorIndex, floors) {
  const W = HOLLOW.W, H = HOLLOW.H;
  const rnd = rng32((seed ^ Math.imul(floorIndex + 1, 0x9e3779b1)) >>> 0);
  const finalFloor = floorIndex === floors - 1;
  const midFloor = floors >= 3 && floorIndex === Math.floor((floors - 1) / 2) && !finalFloor;
  const nRooms = 7 + Math.min(3, floorIndex) + Math.floor(rnd() * 2);
  const res = genRooms(rnd, W, H, { rooms: nRooms, minW: 6, maxW: 11, minH: 5, maxH: 8, corridor: 2, margin: 2, gap: 2, loops: 1 + Math.floor(rnd() * 2) });
  const { grid, rooms, edges, corr } = res;
  const adj = rooms.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const bfs = (s) => { const d = rooms.map(() => -1); d[s] = 0; const q = [s]; while (q.length) { const v = q.shift(); for (const u of adj[v]) if (d[u] < 0) { d[u] = d[v] + 1; q.push(u); } } return d; };
  // start room = a random peripheral leaf-ish room; goal = farthest from start
  const start = Math.floor(rnd() * rooms.length);
  const d0 = bfs(start);
  let goal = start;
  for (let i = 0; i < rooms.length; i++) if (d0[i] > d0[goal] || (d0[i] === d0[goal] && rooms[i].w * rooms[i].h > rooms[goal].w * rooms[goal].h)) goal = i;
  rooms.forEach((r, i) => { r.id = i; r.role = 'combat'; r.dist = d0[i]; });
  rooms[start].role = 'start';
  rooms[goal].role = finalFloor ? 'boss' : 'stairs';
  // treasure: a leaf (or farthest remaining) room
  const rest = rooms.filter((r) => r.role === 'combat');
  const leaves = rest.filter((r) => adj[r.id].length === 1);
  const pool = (leaves.length ? leaves : rest).sort((a, b) => b.dist - a.dist);
  if (pool[0]) pool[0].role = 'treasure';
  // mini-boss room on the middle floor: biggest remaining combat room
  if (midFloor) {
    const c = rooms.filter((r) => r.role === 'combat').sort((a, b) => b.w * b.h - a.w * a.h)[0];
    if (c) c.role = 'miniboss';
  }
  // final boss arena: enlarge the goal room a little (carve outwards when space allows)
  if (finalFloor) {
    const r = rooms[goal];
    const nx = Math.max(2, r.x - 2), ny = Math.max(2, r.y - 1), nxe = Math.min(W - 3, r.x + r.w + 2), nye = Math.min(H - 3, r.y + r.h + 1);
    grid.rect(nx, ny, nxe - nx, nye - ny, 1);
    r.x = nx; r.y = ny; r.w = nxe - nx; r.h = nye - ny; r.cx = Math.floor(r.x + r.w / 2); r.cy = Math.floor(r.y + r.h / 2);
  }
  // corridor cells -> CORR, then mark straight corridor stretches as trap lanes
  for (let i = 0; i < grid.a.length; i++) if (grid.a[i] === 2) grid.a[i] = HD.CORR;
  const traps = [];
  const nTraps = 1 + floorIndex + (rnd() < 0.5 ? 1 : 0);
  const cand = corr.filter((c) => c.cells.length >= 8 && !(c.i === start && c.j === goal)).sort(() => rnd() - 0.5);
  for (const c of cand) {
    if (traps.length >= nTraps) break;
    // skip corridors touching the start room so the landing is safe
    if (c.i === start || c.j === start) continue;
    const mid = Math.floor(c.cells.length / 2) + (rnd() < 0.5 ? -1 : 1) * Math.floor(rnd() * 2);
    const [x, y] = c.cells[Math.max(2, Math.min(c.cells.length - 3, mid))];
    if (grid.get(x, y) !== HD.CORR) continue;
    const kind = rnd() < 0.5 ? 'spikes' : 'arrows';
    traps.push({ kind, x, y, corr: c });
  }
  // a few in-room spike fields on deeper floors
  const fields = [];
  if (floorIndex >= 1) {
    for (const r of rooms) {
      if (r.role !== 'combat' || rnd() > 0.45 + floorIndex * 0.1) continue;
      const fx = r.x + 2 + Math.floor(rnd() * Math.max(1, r.w - 5)), fy = r.y + 2 + Math.floor(rnd() * Math.max(1, r.h - 5));
      fields.push({ x: fx, y: fy, w: 2, h: 2, room: r.id });
    }
  }
  const sr = rooms[start], gr = rooms[goal];
  return { W, H, grid, rooms, edges, corr, start, goal, sr, gr, traps, fields, floorIndex, floors, finalFloor, midFloor, seed };
}
export const hollowSolid = (c) => c === HD.ROCK || c === HD.VOID;
