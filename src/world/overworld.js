import { CONFIG } from '../config.js';
import { makeTreeTextures } from './treeArt.js';
import { bakeGround } from './ground.js';
import { makeProps } from './props.js';

// Builds one large open world (128×128 tiles) from a baked procedural ground +
// scattered props. Zones: town (safe), meadow, woods, ruins.
// Gameplay reads zoneAt(); visuals can be re-skinned without touching rules.
export function zoneAt(tx, ty, ZONES) {
  // Smallest-area-first: enclaves (town inside meadow) win over their parent.
  const sorted = [...ZONES].sort((a, b) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h));
  for (const z of sorted) {
    const r = z.rect;
    if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return z;
  }
  return ZONES[1];
}

export function buildOverworld(scene, ZONES) {
  makeTreeTextures(scene);
  const t = CONFIG.tile;
  const W = CONFIG.worldCols * t, H = CONFIG.worldRows * t;
  const town = ZONES[0].rect;
  const spawn = { x: (town.x + town.w / 2) * t, y: (town.y + town.h / 2) * t };
  const S = spawn;
  const woodsR = ZONES.find((z) => z.id === 'woods').rect;
  const ruinsR = ZONES.find((z) => z.id === 'ruins').rect;

  // Baked procedural ground: biome colours with noise-ragged borders, roads,
  // plaza cobbles, puddles, dapple. Also exposes decal painters (flowers,
  // bushes, reeds...) and soft shadows. Replaces the old tile sprites + feather bands.
  const ground = bakeGround(scene, ZONES, S, t);
  const D = ground.D;

  // Water border + foam
  const g = scene.add.graphics().setDepth(-8);
  g.fillStyle(0x2e86c1, 1).fillRect(0, 0, W, 24).fillRect(0, H - 24, W, 24).fillRect(0, 0, 24, H).fillRect(W - 24, 0, 24, H);
  g.lineStyle(3, 0xaed6f1, 0.8).strokeRect(24, 24, W - 48, H - 48);

  let seed = 1234567;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let z = Math.imul(seed ^ (seed >>> 15), 1 | seed); z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z; return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
  const solids = scene.physics.add.staticGroup();
  const P = makeProps(scene, solids, ground);

  // Ruins pillars use real tiles; everything else is procedural.
  const useRuins  = scene.textures.exists('ts.ruins');
  const RC = 20; // TilesetVillageAbandoned 320px wide

  // Position-based hash for visual variants — never consumes the seeded rnd()
  // stream, so the placement layout stays identical.
  const vh = (tx, ty) => ((tx * 31 + ty * 17) >>> 0) & 0xFF;

  const windows = [];
  const glows = [];

  // Extra passes use their own tiny seeded generators.
  const mk = (s0) => { let s = s0; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; };
  const inZone = (x, y, id) => zoneAt(Math.floor(x / t), Math.floor(y / t), ZONES).id === id;
  const fixedDist = (x, y) => Math.hypot(x - S.x, y - S.y);

  // ---------- Thistle Town: plaza, landmark inn, cottages, stalls, well ----------
  const housePositions = [];
  const blockers = [];
  const placeHouse = (x, y, o) => {
    windows.push(P.house(x, y, o));
    housePositions.push({ x, y });
  };
  const HOUSE_MIN_DIST = 76;
  // Fixed plaza houses stand wide apart; NPC row + torches sit south in the open.
  placeHouse(S.x - 60, S.y - 32, { w: 52, h: 26, roof: 0xb03a2e, wall: 0xdcc391 });
  placeHouse(S.x + 60, S.y - 32, { w: 44, h: 24, roof: 0x2e86c1, wall: 0xe0cfa4, chimney: false });
  // Landmark: the inn, just east of Maren's stall.
  windows.push(P.inn(S.x + 172, S.y - 24));
  blockers.push({ x: S.x + 172, y: S.y - 24, r: 110 });
  // Market stalls, well, notice board
  P.stall(S.x + 80, S.y + 46, [0xc0392b, 0xf4ecd8], 0xe74c3c, 30);
  P.stall(S.x + 138, S.y + 62, [0x2e86c1, 0xf4ecd8], 0xf4d03f, 30);
  P.stall(S.x - 82, S.y + 62, [0x27ae60, 0xf4ecd8], 0xe67e22, 28);
  blockers.push({ x: S.x + 80, y: S.y + 46, r: 50 }, { x: S.x + 138, y: S.y + 62, r: 50 }, { x: S.x - 82, y: S.y + 62, r: 50 });
  P.well(S.x - 78, S.y + 26);
  P.board(S.x - 118, S.y - 22);
  blockers.push({ x: S.x - 78, y: S.y + 26, r: 40 }, { x: S.x - 118, y: S.y - 22, r: 40 });

  // Town fence runs along the inside edge: ragged, with gaps, roads stay open
  {
    const fr = mk(5150);
    const x0 = town.x * t + 22, x1 = (town.x + town.w) * t - 22, y0 = town.y * t + 26, y1 = (town.y + town.h) * t - 20;
    const runs = (a, b, gapAt, cb) => {
      let p = a;
      while (p < b - 24) {
        const len = 36 + Math.floor(fr() * 60);
        let e = Math.min(b, p + len);
        if (gapAt > p - 34 && gapAt < e + 34) {
          if (gapAt - 34 - p >= 24) e = gapAt - 34; else { p = gapAt + 34; continue; }
        }
        cb(p, e);
        p = e + (fr() < 0.4 ? 26 : 14);
        if (p > gapAt - 34 && p < gapAt + 34) p = gapAt + 34;
      }
    };
    runs(x0, x1, S.x, (a, b) => P.fence(a, y0, b, y0));
    runs(x0, x1, S.x, (a, b) => P.fence(a, y1, b, y1));
    runs(y0 + 14, y1, S.y, (a, b) => P.fence(x0, a, x0, b));
    runs(y0 + 14, y1, S.y, (a, b) => P.fence(x1, a, x1, b));
  }

  // ---------- Biome picks ----------
  const treeKind = (zone, v) => {
    if (zone === 'woods') return v % 10 < 4 ? 'pine' : v % 10 < 8 ? 'oak' : v % 10 === 8 ? 'willow' : 'birch';
    if (zone === 'ruins') return v % 2 ? 'willow' : 'pine';
    return v % 3 === 0 ? 'birch' : 'oak';
  };

  // Ground-level flora by biome (chosen by position hash, no rnd draws)
  const flora = (zone, x, y, v) => {
    if (zone === 'meadow' || zone === 'town') {
      const k = v % 11;
      if (k < 3) D.flower(x, y, v);
      else if (k < 5) D.tuft(x, y, v);
      else if (k < 7) D.clover(x, y, v);
      else if (k < 9) D.flower(x, y, v + 3);
      else D.bush(x, y, v, false);
    } else if (zone === 'woods') {
      const k = v % 7;
      if (k < 2) D.fern(x, y, v);
      else if (k < 4) D.mushroom(x, y, v);
      else if (k < 6) D.leaf(x, y, v);
      else D.bush(x, y, v, true);
    } else {
      const k = v % 6;
      if (k < 2) D.reed(x, y, v);
      else if (k < 4) D.pebble(x, y, v);
      else if (k < 5) D.rubble(x, y, v);
      else D.clover(x, y, v);
    }
  };

  for (let i = 0; i < 900; i++) {
    const tx = 2 + Math.floor(rnd() * (CONFIG.worldCols - 4));
    const ty = 2 + Math.floor(rnd() * (CONFIG.worldRows - 4));
    const zone = zoneAt(tx, ty, ZONES);
    const x = tx * t + 8, y = ty * t + 8;
    const v = vh(tx, ty);
    if (zone.id === 'town') {
      if (rnd() < 0.05) {
        const edge = Math.min(x - town.x * t, (town.x + town.w) * t - x, y - town.y * t, (town.y + town.h) * t - y);
        const ok = !housePositions.some((p) => Math.hypot(p.x - x, p.y - y) < HOUSE_MIN_DIST)
          && !blockers.some((b) => Math.hypot(b.x - x, b.y - y) < b.r)
          && fixedDist(x, y) > 130 && ground.roadDist(x, y) > 44 && edge > 52;
        if (ok) {
          const w = 34 + (v % 4) * 8, h = 22 + (v % 3) * 3;
          const roof = [0xb03a2e, 0x2e86c1, 0x7d3c98, 0x1e8449, 0xca6f1e, 0x566573][v % 6];
          const wall = [0xd9c08a, 0xe0cfa4, 0xc9b48a, 0xd8c7a0][(v >> 2) % 4];
          placeHouse(x, y, { w, h, roof, wall, chimney: v % 3 !== 0 });
        }
      } else if (rnd() < 0.06) {
        if (ground.roadDist(x, y) > 22 && fixedDist(x, y) > 100) D.flower(x, y, v);
      }
      continue;
    }
    const r = rnd();
    if (zone.id === 'woods' ? r < 0.24 : r < 0.06) {
      // Meadow keeps only ~1 in 3 of its trees (few trees); woods stay dense.
      if (zone.id !== 'meadow' || v % 3 === 0) P.tree(x, y, treeKind(zone.id, v), zone.id === 'woods' && r < 0.08);
    } else if (r < 0.32) {
      flora(zone.id, x, y, v);
    } else if (r < 0.36 && scene.textures.exists('env.plant')) {
      if (zone.id === 'meadow') scene.add.sprite(x, y, 'env.plant', 0).play('env.plant.sway').setDepth(1);
      else flora(zone.id, x, y, v + 1);
    } else if (r < 0.40) {
      // Rocks — procedural boulders; slate in the ruins, mossy elsewhere.
      const rc = scene.add.container(x, y).setDepth(y);
      if (scene.textures.exists('char.shadow')) rc.add(scene.add.image(0, 3, 'char.shadow').setScale(1.1, 1));
      else rc.add(scene.add.ellipse(0, 3, 16, 5, 0x000000, 0.22));
      const slate = zone.id === 'ruins';
      rc.add(scene.add.circle(-2, -1, 5 + (v % 3), slate ? 0x66757e : 0x7f8c8d));
      rc.add(scene.add.circle(3, -3, 3 + ((v >> 2) % 3), slate ? 0x85949c : 0x95a5a6));
      rc.add(scene.add.circle(-3, -2, 2, 0x5da24a, slate ? 0.6 : 0.85)); // moss dab
      solids.add(scene.add.rectangle(x, y, 10, 8, 0xffffff, 0));
    } else if (zone.id === 'ruins' && r < 0.46) {
      // Ruins pillars via the shared builder below (same rnd draws as before).
      const h = 14 + Math.floor(rnd() * 12);
      buildPillar(x, y, h, v);
    }
  }

  // Ruins pillar builder, shared by the scatter loop above and the dedicated
  // ruins pass further down (which uses its own seed so the main layout
  // never shifts). Function declaration so it hoists above the 900-loop.
  function buildPillar(x, y, h, v) {
    const c = scene.add.container(x, y).setDepth(y);
    ground.D.shadow(x + 3, y + 1, 18, 7, 0.22);
    if (useRuins) {
      // Column 2, rows 3-5 of TilesetVillageAbandoned is a genuine
      // standalone stackable pillar (row5=base, row4=shaft, row3=mossy cap).
      const numRows = h > 22 ? 3 : 2;
      const pillarRows = [5, 4, 3]; // ground → up: base, shaft, cap
      let isStatue = false;
      if (v % 8 === 0) {
        // Occasional big mossy statue landmark: 2-wide × 2-tall.
        isStatue = true;
        const statueRows = [4, 3]; // ground → up: base, head
        for (let i = 0; i < 2; i++) {
          c.add(scene.add.image(-8, -16 * i, 'ts.ruins', statueRows[i] * RC + 0));
          c.add(scene.add.image(8, -16 * i, 'ts.ruins', statueRows[i] * RC + 1));
        }
      } else {
        for (let i = 0; i < numRows; i++) {
          c.add(scene.add.image(0, -16 * i, 'ts.ruins', pillarRows[i] * RC + 2));
        }
      }
      solids.add(isStatue
        ? scene.add.rectangle(x, y - 16, 24, 28, 0xffffff, 0)
        : scene.add.rectangle(x, y - h / 2, 9, h, 0xffffff, 0));
    } else {
      c.add([
        scene.add.rectangle(0, -h / 2, 9, h, 0xaab7b8),
        scene.add.rectangle(0, -h, 11, 3, 0x7f8c8d),
        scene.add.rectangle(0, -h - 1, 11, 3, 0x5da24a, 0.7),
      ]);
      solids.add(scene.add.rectangle(x, y - h / 2, 9, h, 0xffffff, 0));
    }
  }

  // Dedicated ruins pass: extra pillars. Own seed, so nothing above moves.
  const prnd = mk(777001);
  for (let i = 0; i < 46; i++) {
    const tx = ruinsR.x + 2 + Math.floor(prnd() * (ruinsR.w - 4));
    const ty = ruinsR.y + 3 + Math.floor(prnd() * (ruinsR.h - 5));
    buildPillar(tx * t + 8, ty * t + 8, 14 + Math.floor(prnd() * 12), (tx * 31 + ty * 17) & 0xff);
  }

  // ---------- Biome identity passes (own seeds; layout above never shifts) ----------
  // Meadowfield: flower meadows, light bushes, corrals
  {
    const mr = mk(31415);
    for (let i = 0; i < 170; i++) {
      const x = 140 + mr() * (W - 280), y = 140 + mr() * (H - 280), v = Math.floor(mr() * 7);
      if (!inZone(x, y, 'meadow') || ground.roadDist(x, y) < 18) continue;
      D.flowerPatch(Math.round(x), Math.round(y), v, mr);
    }
    for (let i = 0; i < 90; i++) {
      const x = 140 + mr() * (W - 280), y = 140 + mr() * (H - 280), v = Math.floor(mr() * 9);
      if (!inZone(x, y, 'meadow') || ground.roadDist(x, y) < 18) continue;
      D.bush(Math.round(x), Math.round(y), v, false);
    }
    const corral = (cx, cy, w, h, gap) => {
      if (gap !== 'n') P.fence(cx, cy, cx + w, cy);
      if (gap !== 's') P.fence(cx, cy + h, cx + w, cy + h);
      else { P.fence(cx, cy + h, cx + w - 34, cy + h); }
      if (gap !== 'w') P.fence(cx, cy, cx, cy + h);
      if (gap !== 'e') P.fence(cx + w, cy, cx + w, cy + h);
      for (let k = 0; k < 7; k++) D.flower(cx + 8 + Math.round(mr() * (w - 16)), cy + 8 + Math.round(mr() * (h - 14)), k + 2);
    };
    corral(560, 540, 104, 70, 's');
    corral(1500, 1520, 120, 76, 'w');
    corral(470, 900, 90, 64, 'n');
    corral(1560, 1160, 96, 64, 's');
  }
  // Mosswood: mushrooms, ferns, fallen logs, dark bushes, fireflies
  {
    const wr = mk(27182);
    const wx = woodsR.x * t, wy = woodsR.y * t, ww = woodsR.w * t, wh = woodsR.h * t;
    for (let i = 0; i < 260; i++) {
      const x = wx + 10 + wr() * (ww - 20), y = wy + 10 + wr() * (wh - 20);
      const k = wr(); const v = Math.floor(wr() * 100);
      if (k < 0.4) { D.mushroom(Math.round(x), Math.round(y), v); if (wr() < 0.6) D.mushroom(Math.round(x + 5), Math.round(y + 2), v + 1); }
      else if (k < 0.75) D.fern(Math.round(x), Math.round(y), v);
      else if (k < 0.9) D.bush(Math.round(x), Math.round(y), v, true);
      else D.leaf(Math.round(x), Math.round(y), v);
    }
    let placed = 0;
    for (let i = 0; i < 80 && placed < 28; i++) {
      const x = wx + 24 + wr() * (ww - 48), y = wy + 24 + wr() * (wh - 48), len = 24 + Math.floor(wr() * 14), fl = wr() < 0.5;
      if (ground.roadDist(x, y) < 26) continue;
      P.log(Math.round(x), Math.round(y), len, fl);
      placed++;
    }
    if (scene.textures.exists('fx.glow')) {
      for (let i = 0; i < 38; i++) {
        const x = wx + 20 + wr() * (ww - 40), y = wy + 20 + wr() * (wh - 40);
        const f = scene.add.image(x, y, 'fx.glow').setDepth(2850).setBlendMode(Phaser.BlendModes.ADD).setTint(0xd8ff7a).setScale(0.16 + wr() * 0.1).setAlpha(0.2);
        scene.tweens.add({ targets: f, alpha: 0.85, duration: 900 + wr() * 1400, delay: wr() * 1500, yoyo: true, repeat: -1, ease: 'sine.inout' });
        scene.tweens.add({ targets: f, x: x + (wr() - 0.5) * 40, y: y + (wr() - 0.5) * 24, duration: 3000 + wr() * 3000, yoyo: true, repeat: -1, ease: 'sine.inout' });
      }
    }
  }
  // Tidehollow: reeds round the puddles, rubble, broken walls
  {
    const rr = mk(16180);
    for (const p of ground.puddles) {
      const n = 2 + Math.floor(rr() * 4);
      for (let i = 0; i < n; i++) {
        const a = rr() * 6.283, v = Math.floor(rr() * 50);
        D.reed(Math.round(p.x + Math.cos(a) * (p.w + 3)), Math.round(p.y + Math.sin(a) * (p.h + 3) + 2), v);
      }
    }
    const rx = ruinsR.x * t, ry = ruinsR.y * t, rw = ruinsR.w * t, rh = ruinsR.h * t;
    for (let i = 0; i < 120; i++) {
      const x = rx + 10 + rr() * (rw - 20), y = ry + 20 + rr() * (rh - 30), v = Math.floor(rr() * 50);
      if (rr() < 0.5) D.rubble(Math.round(x), Math.round(y), v); else D.pebble(Math.round(x), Math.round(y), v);
    }
    for (let i = 0; i < 26; i++) {
      const x = Math.round(rx + 24 + rr() * (rw - 120)), y = Math.round(ry + 70 + rr() * (rh - 100)), len = 32 + Math.floor(rr() * 40), v = Math.floor(rr() * 40);
      P.ruinWall(x, y, len, v);
    }
  }

  // Torches with night glow (plaza corners south + gate torch south-centre,
  // clear of the NPC row at y+30 and Old Tob up the middle)
  for (const [dx, dy] of [[-36, 28], [36, 28], [0, 54]]) {
    const tx = S.x + dx, ty = S.y + dy;
    scene.add.rectangle(tx, ty, 3, 12, 0x5a3a1e).setDepth(ty);
    const flame = scene.add.circle(tx, ty - 8, 3, 0xe67e22).setDepth(ty + 1);
    scene.tweens.add({ targets: flame, scale: 1.4, duration: 300, yoyo: true, repeat: -1, ease: 'sine.inout' });
    if (scene.textures.exists('fx.glow')) {
      const glow = scene.add.image(tx, ty - 8, 'fx.glow').setDepth(2900).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setScale(0.8);
      scene.tweens.add({ targets: glow, alpha: 0.3, duration: 700, yoyo: true, repeat: -1, ease: 'sine.inout' });
      glows.push(glow);
    }
    solids.add(scene.add.rectangle(tx, ty + 2, 4, 8, 0xffffff, 0));
  }

  // Town edge + biome fringe decals (the ragged baked ground already removes the seam)
  const fr2 = mk(424242);
  const decalTile = (tx, ty, p, zoneHint) => {
    if (fr2() > p) return;
    const x = tx * t + 8 + Math.round((fr2() - 0.5) * 10), y = ty * t + 8 + Math.round((fr2() - 0.5) * 10);
    const v = Math.floor(fr2() * 60);
    if (zoneHint === 'town') {
      const k = fr2();
      if (k < 0.3) D.dirtPatch(x, y, 7 + (v % 6));
      else if (k < 0.6) D.tuft(x, y, v);
      else if (k < 0.8) D.pebble(x, y, v);
      else D.flower(x, y, v);
    } else flora(zoneHint, x, y, v);
  };
  for (let ty = woodsR.y; ty < woodsR.y + woodsR.h; ty++) { decalTile(woodsR.x - 1, ty, 0.4, 'woods'); decalTile(woodsR.x - 2, ty, 0.25, 'woods'); }
  for (let tx = woodsR.x; tx < woodsR.x + woodsR.w; tx++) { decalTile(tx, woodsR.y - 1, 0.35, 'woods'); decalTile(tx, woodsR.y + woodsR.h, 0.35, 'woods'); }
  for (let tx = ruinsR.x; tx < ruinsR.x + ruinsR.w; tx++) { decalTile(tx, ruinsR.y - 1, 0.35, 'ruins'); decalTile(tx, ruinsR.y - 2, 0.2, 'ruins'); }
  for (let ty = ruinsR.y; ty < ruinsR.y + ruinsR.h; ty++) decalTile(ruinsR.x - 1, ty, 0.3, 'ruins');
  for (let tx = town.x - 2; tx <= town.x + town.w + 1; tx++) {
    for (const ty of [town.y - 2, town.y - 1, town.y, town.y + town.h - 1, town.y + town.h, town.y + town.h + 1]) decalTile(tx, ty, 0.45, 'town');
  }
  for (let ty = town.y; ty < town.y + town.h; ty++) {
    for (const tx of [town.x - 2, town.x - 1, town.x, town.x + town.w - 1, town.x + town.w, town.x + town.w + 1]) decalTile(tx, ty, 0.45, 'town');
  }
  // Town interior scatter: pebbles, tufts, flower beds beside the buildings
  for (let i = 0; i < 160; i++) {
    const x = town.x * t + 24 + Math.round(fr2() * (town.w * t - 48)), y = town.y * t + 24 + Math.round(fr2() * (town.h * t - 48)), v = Math.floor(fr2() * 60);
    if (ground.roadDist(x, y) < 18 || fixedDist(x, y) < 92) continue;
    if (fr2() < 0.5) D.pebble(x, y, v); else D.tuft(x, y, v);
  }
  for (const [dx, dy] of [[-92, -30], [-28, -20], [28, -20], [92, -30]]) {
    for (let k = 0; k < 4; k++) D.flower(S.x + dx + (k - 2) * 4, S.y + dy + (k % 2) * 3, k + dx);
  }
  ground.finish();

  scene.physics.world.setBounds(32, 32, W - 64, H - 64);
  return { spawn, solids, W, H, windows, glows };
}
