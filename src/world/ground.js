// Procedural world ground: one baked 2048x2048 canvas texture for the whole map
// (biome colours with ragged, noise-jittered borders, dirt roads, town cobbles,
// puddles) plus a tiny painter API (decals, soft shadows) that the overworld
// uses for flowers, bushes, reeds, mushrooms etc. Everything is deterministic.
import { network, roadAt, riverAt, coastSD, roadDist as wwRoadDist, shoreY } from './waterways.js';

export const hash2 = (x, y, s = 0) => {
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
const step = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
const rgb = (c, d = 0) => `rgb(${Math.max(0, Math.min(255, c[0] + d)) | 0},${Math.max(0, Math.min(255, c[1] + d)) | 0},${Math.max(0, Math.min(255, c[2] + d)) | 0})`;

// Roads, rivers and the north-coast bay now come from world/waterways.js (data/worldLayout.js).
// makeRoads / roadDist keep their old signatures (systems/fx.js uses them for footstep surfaces).
export function makeRoads() { return network().roads; }
export function roadDist(roads, x, y) { return wwRoadDist(x, y); }

const BIOME = {
  meadow: { base: [122, 196, 78], hi: [150, 214, 96], lo: [104, 178, 66] },
  woods:  { base: [46, 98, 56],  hi: [66, 122, 66],  lo: [30, 72, 44] },
  ruins:  { base: [86, 102, 114], hi: [108, 124, 134], lo: [60, 76, 92] },
  town:   { base: [186, 160, 108], hi: [206, 182, 130], lo: [160, 136, 90] },
};

export function bakeGround(scene, ZONES, S, tile) {
  const R = {};
  for (const z of ZONES) R[z.id] = { x: z.rect.x * tile, y: z.rect.y * tile, w: z.rect.w * tile, h: z.rect.h * tile };
  const WW = 128 * tile, HH = 128 * tile;
  if (scene.textures.exists('world.ground')) scene.textures.remove('world.ground');
  const tex = scene.textures.createCanvas('world.ground', WW, HH);
  const ctx = tex.getContext();
  const roads = makeRoads(S);
  const RD = {};
  const inside = (r, px, py) => Math.min(px - r.x, r.x + r.w - px, py - r.y, r.y + r.h - py);

  const colorAt = (px, py) => {
    const n1 = vnoise(px / 70, py / 70, 1), n2 = vnoise(px / 22, py / 22, 2);
    const tone = (n1 - 0.5) * 1.4 + (n2 - 0.5) * 0.5;
    const pal = (b) => (tone > 0 ? mix(b.base, b.hi, Math.min(1, tone * 1.6)) : mix(b.base, b.lo, Math.min(1, -tone * 1.6)));
    let col = pal(BIOME.meadow);
    // Meadow: slightly lighter sunlit patches
    // Woods: dark, with canopy dapple + leaf litter
    const jit = (vnoise(px / 40, py / 40, 5) - 0.5) * 46 + (vnoise(px / 11, py / 11, 6) - 0.5) * 12;
    const wW = step(-34, 34, inside(R.woods, px, py) + jit);
    if (wW > 0) {
      let c = pal(BIOME.woods);
      const d = vnoise(px / 26 + 7, py / 26, 9);
      if (d > 0.6) c = mix(c, [24, 60, 40], Math.min(1, (d - 0.6) * 4));
      else if (d < 0.22) c = mix(c, [74, 120, 64], (0.22 - d) * 2.2);
      if (hash2(px >> 2, py >> 2, 11) > 0.94) c = mix(c, [96, 72, 40], 0.55);
      col = mix(col, c, wW);
    }
    const rW = step(-34, 34, inside(R.ruins, px, py) + jit);
    if (rW > 0) {
      let c = pal(BIOME.ruins);
      const wet = vnoise(px / 44 + 3, py / 44, 12);
      if (wet > 0.56) c = mix(c, [58, 76, 94], Math.min(1, (wet - 0.56) * 4));
      const paved = vnoise(px / 90 + 3, py / 90, 13) > 0.52;
      if (paved) {
        const cx = px >> 2, cy = py >> 2, row = Math.floor(cy / 6);
        const seam = cy % 6 === 0 || (cx + (row % 2) * 4) % 8 === 0;
        c = mix(c, seam ? [48, 60, 72] : [110, 124, 134], seam ? 0.7 : 0.25 + hash2(Math.floor((cx + (row % 2) * 4) / 8), row, 14) * 0.25);
      }
      col = mix(col, c, rW);
    }
    const tW = step(-9, 9, inside(R.town, px, py) + (vnoise(px / 34, py / 34, 7) - 0.5) * 48 + (vnoise(px / 9, py / 9, 8) - 0.5) * 14);
    if (tW > 0) {
      let c = pal(BIOME.town);
      const g = vnoise(px / 30 + 5, py / 30, 15);
      if (g > 0.66) c = mix(c, [146, 186, 92], Math.min(0.7, (g - 0.66) * 4));
      col = mix(col, c, tW);
    }
    // Banks (wet sand), then roads (earth / flagstone / track with a darker rim), then water on top
    const rv = riverAt(px, py), sd = Math.min(rv.sd, coastSD(px, py));
    if (sd < 12 && sd > -2) {
      const bw = step(9 + (vnoise(px / 12, py / 12, 43) - 0.5) * 8, 0.5, sd);
      if (bw > 0) col = mix(col, mix([198,178,124], [168,148,102], vnoise(px / 6, py / 6, 44)), bw * 0.85);
    }
    const rd = roadAt(px, py, RD);
    if (rd.e < 2) {
      const roadW = step(2, -3, rd.e);
      let rc;
      if (rd.kind === 'cobble') rc = rd.id === 'crypt' ? mix([112, 118, 124], [92, 98, 106], vnoise(px / 6, py / 6, 18)) : mix([152, 146, 134], [128, 122, 110], vnoise(px / 6, py / 6, 18));
      else if (rd.kind === 'track') rc = mix([190, 170, 116], [150, 150, 96], vnoise(px / 7, py / 7, 17));
      else rc = mix([208, 184, 132], [182, 158, 110], vnoise(px / 8, py / 8, 17));
      const rimK = step(-6, -2.5, rd.e) * step(2, -1, rd.e);
      const f = 1 - rimK * (rd.kind === 'cobble' ? 0.26 : 0.15);
      rc = [rc[0] * f, rc[1] * f, rc[2] * f];
      col = mix(col, rc, roadW * (rd.kind === 'track' ? 0.8 : 0.95));
    }
    if (sd < 1.2) {
      const depth = Math.min(1, -sd / 15);
      let wc = mix([96, 178, 220], [38, 116, 174], depth);
      const rip = vnoise(px / 10 + 3, py / 5, 45);
      if (rip > 0.68) wc = mix(wc, [150, 210, 238], Math.min(1, (rip - 0.68) * 3.2) * 0.8);
      if (sd > -4.5) wc = mix(wc, [228, 245, 252], step(-4.5, -1.5, sd) * (vnoise(px / 5, py / 5, 46) > 0.36 ? 0.9 : 0.4));
      col = mix(col, wc, step(1.2, -1.2, sd));
    }
    return col;
  };

  for (let cy = 0; cy < HH / 4; cy++) {
    for (let cx = 0; cx < WW / 4; cx++) {
      const px = cx * 4 + 2, py = cy * 4 + 2;
      const c = colorAt(px, py);
      const f = (hash2(cx, cy, 3) - 0.5) * 9;
      ctx.fillStyle = rgb(c, f);
      ctx.fillRect(cx * 4, cy * 4, 4, 4);
    }
  }

  // --- Plaza cobbles (staggered flagstones in a ragged disc) ---
  const pr = 88;
  ctx.fillStyle = 'rgb(92,86,78)';
  for (let y = S.y - pr - 8; y < S.y + pr + 8; y += 6) {
    const row = Math.round((y - S.y) / 6);
    for (let x = S.x - pr - 8 + (row & 1) * 4; x < S.x + pr + 8; x += 8) {
      const cxp = x + 4, cyp = y + 3;
      const d = Math.hypot(cxp - S.x, (cyp - S.y) * 1.08);
      const lim = pr + (hash2(Math.round(cxp / 8), Math.round(cyp / 6), 21) - 0.5) * 16;
      if (d > lim) continue;
      const v = hash2(x, y, 22);
      const inner = d < 16;
      const ring = Math.abs(d - 52) < 4;
      let base = inner ? [214, 186, 120] : ring ? [120, 104, 84] : [150, 146, 138];
      ctx.fillStyle = 'rgb(88,82,74)';
      ctx.fillRect(x, y, 8, 6);
      ctx.fillStyle = rgb(base, (v - 0.5) * 34);
      ctx.fillRect(x + 1, y + 1, 6, 4);
      if (v > 0.8) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x + 1, y + 1, 6, 1); }
      if (v < 0.12) { ctx.fillStyle = 'rgba(90,150,70,0.7)'; ctx.fillRect(x + 2, y + 4, 2, 1); }
    }
  }

  // --- Puddles in the ruins (deterministic) ---
  const puddles = [];
  let ps = 90210;
  const pr2 = () => { ps = (ps * 16807) % 2147483647; return ps / 2147483647; };
  for (let i = 0; i < 38; i++) {
    const x = R.ruins.x + 28 + pr2() * (R.ruins.w - 56), y = R.ruins.y + 56 + pr2() * (R.ruins.h - 84);
    const w = 10 + pr2() * 20, h = w * (0.42 + pr2() * 0.2);
    if (riverAt(x, y).sd < w + 26 || roadAt(x, y).e < w + 8) continue; // keep puddles off rivers and roads
    puddles.push({ x, y, w, h });
    ctx.fillStyle = 'rgba(40,60,78,0.45)'; ctx.beginPath(); ctx.ellipse(x, y, w + 2, h + 2, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgb(72,102,128)'; ctx.beginPath(); ctx.ellipse(x, y, w, h, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(150,186,206,0.55)'; ctx.beginPath(); ctx.ellipse(x - w * 0.15, y - h * 0.25, w * 0.6, h * 0.4, 0, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(230,245,255,0.6)'; ctx.fillRect(Math.round(x - w * 0.4), Math.round(y - h * 0.35), Math.max(2, w * 0.35), 1);
  }

  // --- Woods: soft dapple blobs + light shafts ---
  let ds = 31337;
  const dr = () => { ds = (ds * 16807) % 2147483647; return ds / 2147483647; };
  for (let i = 0; i < 160; i++) {
    const x = R.woods.x + dr() * R.woods.w, y = R.woods.y + dr() * R.woods.h, r = 14 + dr() * 26;
    ctx.fillStyle = 'rgba(8,30,20,0.10)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.7, 0, 0, 7); ctx.fill();
  }
  for (let i = 0; i < 70; i++) {
    const x = R.woods.x + 20 + dr() * (R.woods.w - 40), y = R.woods.y + 20 + dr() * (R.woods.h - 40), r = 8 + dr() * 12;
    ctx.fillStyle = 'rgba(200,240,150,0.09)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, -0.5, 0, 7); ctx.fill();
  }

  // ---------- painter API ----------
  const dot = (x, y, r, col) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); };
  const rect = (x, y, w, h, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  const FLOWER = ['#f4d03f', '#ec7063', '#af7ac5', '#5dade2', '#fdfefe', '#f5b041', '#ff8fb1'];
  const MUSH = ['#d63c3c', '#c97b3a', '#e8d8b0', '#a06adf'];
  const D = {
    flower(x, y, v) {
      const col = FLOWER[v % FLOWER.length];
      rect(x, y, 1, 4, '#3f8a3a');
      rect(x - 2, y + 2, 2, 1, '#4fa048');
      if (v % 4 === 0) { dot(x, y, 2.4, col); dot(x, y, 1, '#f4d03f'); }
      else if (v % 4 === 1) { rect(x - 1, y - 2, 3, 3, col); rect(x - 2, y - 1, 5, 1, col); rect(x, y - 1, 1, 1, '#f9e79f'); }
      else if (v % 4 === 2) { rect(x - 1, y - 3, 3, 4, col); rect(x - 2, y - 3, 1, 2, col); rect(x + 2, y - 3, 1, 2, col); }
      else { dot(x - 1, y - 1, 1.3, col); dot(x + 1, y - 1, 1.3, col); dot(x, y - 2, 1.3, col); dot(x, y, 1.1, '#fff3b0'); }
    },
    tuft(x, y, v) {
      const cols = ['#4ea043', '#66b855', '#3a8a3a'];
      for (let i = -2; i <= 2; i++) rect(x + i, y - 2 - ((i * i + v) % 3), 1, 3 + ((i * i + v) % 3), cols[(i + v + 4) % 3]);
    },
    bush(x, y, v, dark) {
      const g1 = dark ? '#1f5a2a' : '#347f36', g2 = dark ? '#2c7136' : '#4b9b45', g3 = dark ? '#3c8a45' : '#6cc45a';
      ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.beginPath(); ctx.ellipse(x + 1, y + 4, 8, 3, 0, 0, 7); ctx.fill();
      dot(x - 4, y, 5, g1); dot(x + 4, y + 0.5, 5, g1); dot(x, y - 2, 6, g2); dot(x - 2, y - 4, 3, g3); dot(x + 3, y - 3, 2.2, g3);
      if (v % 3 === 0) { dot(x - 3, y - 1, 1, '#d63c3c'); dot(x + 2, y, 1, '#d63c3c'); dot(x + 5, y - 3, 1, '#d63c3c'); }
    },
    mushroom(x, y, v) {
      const col = MUSH[v % MUSH.length], big = v % 5 === 0 ? 1.5 : 1;
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x, y + 1, 4 * big, 1.6, 0, 0, 7); ctx.fill();
      rect(x - 1, y - 3 * big, 2, 4 * big, '#efe6d0');
      ctx.fillStyle = col; ctx.beginPath(); ctx.ellipse(x, y - 3 * big, 4 * big, 2.6 * big, 0, Math.PI, 0); ctx.fill();
      if (v % 4 !== 3) { rect(x - 2, y - 5 * big, 1, 1, '#fff'); rect(x + 1, y - 4 * big, 1, 1, '#fff'); }
    },
    fern(x, y, v) {
      ctx.strokeStyle = v % 2 ? '#3f8c4a' : '#2f7a3c'; ctx.lineWidth = 1.4;
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + i * 2.5, y - 6, x + i * 4, y - 3 + Math.abs(i)); ctx.stroke(); }
    },
    leaf(x, y, v) { rect(x, y, 2, 1, ['#a0642c', '#c48a3a', '#8a4a24', '#d4a04a'][v % 4]); rect(x + 1, y + 1, 1, 1, '#6b4422'); },
    reed(x, y, v) {
      const n = 4 + (v % 3);
      ctx.fillStyle = 'rgba(30,50,60,0.25)'; ctx.beginPath(); ctx.ellipse(x, y + 1, 6, 2, 0, 0, 7); ctx.fill();
      for (let i = 0; i < n; i++) {
        const ox = (i - n / 2) * 2.2, hh = 9 + ((i * 5 + v) % 7);
        ctx.strokeStyle = i % 2 ? '#7fa04a' : '#5f8a3c'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x + ox, y); ctx.quadraticCurveTo(x + ox + (i % 2 ? 2 : -2), y - hh / 2, x + ox + (i % 2 ? 3 : -3), y - hh); ctx.stroke();
        if (i % 3 === 0) rect(x + ox + (i % 2 ? 2 : -4), y - hh - 2, 2, 4, '#6b4422');
      }
    },
    pebble(x, y, v) {
      dot(x, y, 1.6 + (v % 2), '#8c979c'); dot(x + 3, y + 1, 1.2, '#a9b3b7'); if (v % 3 === 0) dot(x - 3, y + 1, 1, '#6f7b82');
    },
    rubble(x, y, v) {
      ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.fillRect(x - 4, y + 1, 10, 2);
      rect(x - 4, y - 3, 5, 4, '#8a969c'); rect(x + 1, y - 2, 4, 3, '#a4aeb3'); rect(x - 2, y - 4, 3, 2, '#6b7a82');
      if (v % 2) rect(x - 4, y - 4, 3, 1, '#5da24a');
    },
    clover(x, y, v) { dot(x, y, 1.2, '#3f9a48'); dot(x + 2, y + 1, 1.2, '#4fb258'); dot(x - 1, y + 2, 1.2, '#3f9a48'); if (v % 4 === 0) dot(x + 2, y - 1, 1.3, '#fdfefe'); },
    flowerPatch(x, y, v, rand) {
      const col = v % FLOWER.length, n = 6 + (v % 7);
      for (let i = 0; i < n; i++) D.flower(Math.round(x + (rand() - 0.5) * 34), Math.round(y + (rand() - 0.5) * 22), col + (rand() < 0.3 ? 1 : 0));
    },
    shadow(x, y, w, h, a = 0.2) {
      ctx.fillStyle = `rgba(20,18,30,${a * 0.5})`; ctx.beginPath(); ctx.ellipse(x, y, w / 2 + 3, h / 2 + 2, 0, 0, 7); ctx.fill();
      ctx.fillStyle = `rgba(20,18,30,${a})`; ctx.beginPath(); ctx.ellipse(x, y, w / 2, h / 2, 0, 0, 7); ctx.fill();
    },
    dirtPatch(x, y, r) {
      ctx.fillStyle = 'rgba(190,160,108,0.55)'; ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.6, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(160,132,88,0.5)'; ctx.fillRect(Math.round(x - 2), Math.round(y), 2, 1);
    },
  };
  const img = scene.add.image(0, 0, 'world.ground').setOrigin(0, 0).setDepth(-10);
  return { ctx, tex, img, roads, puddles, R, D, finish: () => tex.refresh(), roadDist: (x, y) => roadDist(roads, x, y) };
}
