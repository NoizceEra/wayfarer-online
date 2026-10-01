import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { grantLoot } from '../systems/lootUtil.js';
import { genDesert, genMarsh, genCavern, reach, DS, MS, CV, DESERT, MARSH, CAVERN, desertSolid, marshSolid, cavernSolid, fbm, rng32 } from './areaGen.js';
import { T, bakeArea, addGridSolids, pickTiles, mkRnd, mix, hex, clamp, addDarkness, glowAt, label } from './areaKit.js';
import { vnoise } from './ground.js';
import { makePropsBiome } from './propsBiome.js';

// Builders for the procedural expansion maps. Signature matches world/areaBuilders.js:
// builder(ctx) with ctx = { scene, mgr, def, b, o, P (propsExtra), solid(x,y,w,h), wall, px }.
// Mobs are placed here (not via def.enemies) so they only ever spawn on reachable ground.

const sink = (ctx) => ({ add: (r) => { ctx.solid(r.x, r.y, r.width, r.height); r.destroy(); return r; } });
const tp = (ctx, tx, ty) => ({ x: ctx.o.x + tx * T, y: ctx.o.y + ty * T });

function hubCommon(ctx, key, arch, stone, toLabel = 'To Thistle Town') {
  const { scene, mgr, def, o, P } = ctx;
  const wp = tp(ctx, def.waystone[0], def.waystone[1]);
  P.waystone(wp.x, wp.y);
  label(scene, wp.x, wp.y - 52, 'Waystone', '#9fe8ff').setScale(0.9);
  mgr.addInteract({ area: def.id, x: wp.x, y: wp.y, r: 34, label: 'Touch waystone', onUse: () => mgr.openWaystone(key) });
  const ex = tp(ctx, def.exit[0] + 0.1, def.exit[1] + 1.05);
  P.archway(ex.x, ex.y, arch, stone);
  label(scene, ex.x, ex.y - 50, toLabel, '#ffe8a0');
  mgr.addTrigger({ area: def.id, x: o.x + def.exit[0] * T, y: o.y + def.exit[1] * T, r: 12, onEnter: () => mgr.exit() });
}

// one-time chest with a rolled bundle
function lootChest(ctx, key, tx, ty, bundle, text) {
  const { scene, mgr, def, P } = ctx;
  const p = tp(ctx, tx, ty);
  let ch = P.chest(p.x, p.y, !!mgr.qs.opened[key]);
  mgr.addInteract({ area: def.id, x: p.x, y: p.y, r: 26, label: 'Open chest', onUse: () => {
    if (mgr.qs.opened[key]) { bus.emit(Events.SYSTEM, 'The chest is empty.'); return; }
    mgr.qs.opened[key] = true;
    grantLoot(scene, bundle, text || 'Chest', p.x, p.y);
    scene.spawnFx?.(p.x, p.y - 10, 'fx.spark', 1.4);
    ch.destroy(); ch = P.chest(p.x, p.y, true);
    bus.emit(Events.PLAYER_HP, scene.hpPayload());
    scene.saveNow();
  } });
}

// Mob placement: `regions` maps region name -> { pred(tx,ty), fixed?: [tx,ty] }
function spawnMobs(ctx, walk, regions, avoid, seed) {
  const { scene, def, o, b } = ctx;
  const rnd = mkRnd(seed);
  const used = [...avoid];
  for (const [type, n, rk] of def.mobs) {
    const R = regions[rk];
    if (!R) continue;
    let spots;
    if (R.fixed) spots = [{ tx: R.fixed[0], ty: R.fixed[1] }];
    else spots = pickTiles(rnd, walk.grid, n, (tx, ty) => walk.ok(tx, ty) && R.pred(tx, ty), { minDist: 2.6, avoid: used, region: R.box || null });
    for (const s of spots) {
      used.push({ tx: s.tx, ty: s.ty, r: 2.6 });
      const e = scene.makeEnemy(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.5) * T, type, def.id);
      b.enemies.push(e);
    }
  }
}

// ═══════════════════════════ Sunscorch Desert ═══════════════════════════
const SAND = hex(0xe4cc92), SANDHI = hex(0xf4e0a8), SANDLO = hex(0xd6b97a), DUNE = hex(0xd0a86a), DUNEHI = hex(0xeacb8a);
const CLIFF = hex(0xb07c4e), CLIFFHI = hex(0xd09a68), FACE = hex(0x7a4e30), PAVED = hex(0xcdb58a), WALLc = hex(0x98703f), WALLFACE = hex(0x6a4a2a);

export function buildDesert(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  const D = DESERT, g = genDesert();
  const mask = reach(g, (c) => !desertSolid(c), Math.floor(D.spawn[0]), Math.floor(D.spawn[1]));
  const walkOk = (tx, ty) => mask[ty * g.w + tx] === 1;
  b.walkable = (x, y) => walkOk(clamp(Math.floor((x - o.x) / T), 0, g.w - 1), clamp(Math.floor((y - o.y) / T), 0, g.h - 1));
  const PB = makePropsBiome(scene, sink(ctx), b.lights);
  const hubR = D.hub, tmp = D.temple;
  const inR = (r, tx, ty, m = 0) => tx >= r.x - m && tx < r.x + r.w + m && ty >= r.y - m && ty < r.y + r.h + m;

  // ——— ground ———
  bakeArea(scene, 'bake.desert', g, o, {
    jitter: 7,
    color: (cls, px, py, tx, ty) => {
      const n = fbm(px / 60, py / 60, 1, 2), n2 = vnoise(px / 19, py / 19, 2);
      const band = ((fbm(px / T / 13 + 3, py / T / 10, 21, 3) * 6.5 + (px / T) * 0.05 + (py / T) * 0.11) % 1 + 1) % 1;
      switch (cls) {
        case DS.SAND: case DS.DUNE: {
          let c = cls === DS.DUNE ? mix(DUNE, DUNEHI, n2 * 0.6) : mix(SAND, n > 0.5 ? SANDHI : SANDLO, Math.abs(n - 0.5) * 1.3);
          if (band > 0.64 && band < 0.685) c = mix(c, DUNEHI, 0.7); // sunlit dune crest
          else if (band > 0.685 && band < 0.76) c = mix(c, hex(0xa07a48), (band - 0.685) * 2.2); // shaded lee side
          return c;
        }
        case DS.CLIFF: {
          const south = g.get(tx, ty + 1) !== DS.CLIFF;
          if (south && py % T > T - 7) return mix(FACE, hex(0x5a3820), (py % T - (T - 7)) / 7 * 0.6 + n2 * 0.2);
          const strata = Math.floor(py / 5) % 3 === 0 ? 0.25 : 0;
          return mix(mix(CLIFF, CLIFFHI, n2), hex(0x8a5a38), strata);
        }
        case DS.WATER: return mix(hex(0x2a7ab8), hex(0x5cb4e0), vnoise(px / 8, py / 8, 6) * 0.7);
        case DS.GRASS: return mix(hex(0x5a9a48), hex(0x86bc5a), n2);
        case DS.PATH: return mix(hex(0xe2c890), hex(0xcdb078), vnoise(px / 7, py / 7, 9) * 0.6);
        case DS.PAVED: {
          const row = Math.floor(py / 8), seam = py % 8 === 0 || (px + (row % 2) * 8) % 16 < 1;
          return seam ? hex(0x9a8058) : mix(PAVED, hex(0xdcc69a), vnoise(px / 13, py / 13, 4));
        }
        case DS.WALL: {
          const south = g.get(tx, ty + 1) !== DS.WALL;
          if (south && py % T > T - 7) return WALLFACE;
          const row = Math.floor(py / 8), seam = py % 8 === 0 || (px + (row % 2) * 8) % 16 < 1;
          return seam ? hex(0x7a5530) : mix(WALLc, hex(0xb08a54), n2);
        }
        default: return SAND;
      }
    },
    detail: (pt) => {
      const rnd = mkRnd(4141);
      // wind ripples, pebbles, dry tufts, cracks
      for (let i = 0; i < 520; i++) {
        const x = rnd() * g.w * T, y = rnd() * g.h * T, tx = Math.floor(x / T), ty = Math.floor(y / T), c = g.get(tx, ty);
        if (c === DS.SAND || c === DS.DUNE) {
          const k = rnd();
          if (k < 0.55) pt.line(x, y, x + 6 + rnd() * 6, y + (rnd() - 0.5) * 2, 'rgba(255,240,190,0.5)', 1);
          else if (k < 0.75) { pt.dot(x, y, 1.4, '#b89a66'); pt.dot(x + 3, y + 1, 1, '#d2b684'); }
          else if (k < 0.9) { pt.line(x, y, x - 1, y - 4, '#8a9a4a'); pt.line(x, y, x + 1, y - 5, '#a0b058'); pt.line(x, y, x + 2, y - 3, '#8a9a4a'); }
          else { pt.line(x, y, x + 5, y + 3, 'rgba(120,88,50,0.5)'); pt.line(x + 5, y + 3, x + 9, y + 2, 'rgba(120,88,50,0.5)'); }
        } else if (c === DS.GRASS) {
          pt.line(x, y, x - 1, y - 5, '#3f8a3a'); pt.line(x, y, x + 1, y - 6, '#5aa848');
          if (rnd() < 0.3) pt.dot(x, y - 6, 1.3, ['#f4d03f', '#ec7063', '#fdfefe'][Math.floor(rnd() * 3)]);
        }
      }
      // water shimmer + wet shore ring
      for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
        if (g.get(tx, ty) !== DS.WATER) continue;
        if (vnoise(tx * 3.1, ty * 3.1, 8) > 0.62) pt.rect(tx * T + 3, ty * T + 6, 7, 1, 'rgba(225,245,255,0.55)');
      }
      // boss dais in the temple: concentric sun rings + rays
      const bx = D.bossSpot[0] * T + 8, by = D.bossSpot[1] * T + 8;
      pt.ell(bx, by, 62, 46, 'rgba(90,60,30,0.35)'); pt.ell(bx, by, 56, 41, '#b89460'); pt.ell(bx, by, 46, 33, '#d8b878'); pt.ell(bx, by, 34, 24, '#c9a060'); pt.ell(bx, by, 22, 15, '#ffd24a'); pt.ell(bx, by, 14, 9, '#ffe890');
      for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; pt.line(bx + Math.cos(a) * 24, by + Math.sin(a) * 17, bx + Math.cos(a) * 54, by + Math.sin(a) * 39, 'rgba(120,80,30,0.7)', 2); }
      // hub: rugs / packed sand ring around the pond
      const hx = (hubR.x + hubR.w / 2) * T, hy = (D.pond.cy) * T;
      pt.ell(hx, hy + 4, (D.pond.rx + 2.6) * T, (D.pond.ry + 2.4) * T, 'rgba(120,150,70,0.35)');
      // pond rim foam
      pt.ctx.strokeStyle = 'rgba(235,250,255,0.8)'; pt.ctx.lineWidth = 2; pt.ctx.beginPath(); pt.ctx.ellipse(D.pond.cx * T, D.pond.cy * T, D.pond.rx * T - 1, D.pond.ry * T - 1, 0, 0, 7); pt.ctx.stroke();
      pt.ctx.beginPath(); pt.ctx.ellipse(D.oasis2.cx * T, D.oasis2.cy * T, D.oasis2.rx * T - 1, D.oasis2.ry * T - 1, 0, 0, 7); pt.ctx.stroke();
    },
  });
  addGridSolids(ctx, g, desertSolid);

  // ——— hub ———
  hubCommon(ctx, 'desert', 0xffc85a, 0xb8955c);
  const hp = (tx, ty) => tp(ctx, tx, ty);
  for (const [tx, ty, col] of [[4.2, 24.4, 0xc0392b], [16.2, 24.6, 0x2e86c1], [15.6, 36.2, 0xd68910], [5.2, 37.2, 0x8e44ad]]) P.tent(hp(tx, ty).x, hp(tx, ty).y, col);
  P.campfire(hp(10.5, 36.8).x, hp(10.5, 36.8).y);
  for (const [tx, ty] of [[8.2, 34.3], [13.2, 34.6], [6.2, 28.4], [14.8, 29.6]]) P.lamp(hp(tx, ty).x, hp(tx, ty).y);
  for (const [tx, ty, v] of [[17.3, 27.2, 1], [17.2, 28.2, 0], [3.2, 27.2, 0], [3.4, 29.4, 1], [16.6, 38.2, 0]]) { const p = hp(tx, ty); if (v) P.crate(p.x, p.y, 1); else P.barrel(p.x, p.y); }
  P.palm(hp(6.4, 31.2).x, hp(6.4, 31.2).y); P.palm(hp(14.6, 31.4).x, hp(14.6, 31.4).y); P.palm(hp(10, 27.8).x, hp(10, 27.8).y); P.palm(hp(11.4, 34.6).x, hp(11.4, 34.6).y);
  P.palm(hp(8.2, 28.4).x, hp(8.2, 28.4).y); P.palm(hp(13.2, 28.8).x, hp(13.2, 28.8).y);
  // signposts
  P.signpost(hp(21.4, 28.2).x, hp(21.4, 28.2).y, [{ dir: 'e', text: 'Temple of the Sunken Sun', lv: 'Lv 16-17' }, { dir: 's', text: 'Far Oasis (aloe)', lv: 'Lv 13-16' }]);
  P.signpost(hp(36.2, 25.8).x, hp(36.2, 25.8).y, [{ dir: 'n', text: 'Obelisk Field', lv: 'Lv 14-16' }, { dir: 'e', text: 'Temple Road', lv: 'Lv 15-17' }]);
  // ——— landscape props ———
  const rnd = mkRnd(9911);
  const flat = (tx, ty) => { const c = g.get(tx, ty); return (c === DS.SAND || c === DS.DUNE) && !inR(hubR, tx, ty, 2) && !inR(tmp, tx, ty, 1) && walkOk(tx, ty); };
  const offPath = (tx, ty) => ![[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]].some(([dx, dy]) => g.get(tx + dx, ty + dy) === DS.PATH);
  for (const s of pickTiles(rnd, g, 46, (tx, ty) => flat(tx, ty) && offPath(tx, ty), { minDist: 3.4 })) PB.cactus(o.x + (s.tx + 0.5) * T + (rnd() - 0.5) * 6, o.y + (s.ty + 0.85) * T, Math.floor(rnd() * 3));
  for (const s of pickTiles(rnd, g, 16, (tx, ty) => flat(tx, ty) && offPath(tx, ty), { minDist: 6 })) PB.deadTree(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 2));
  for (const s of pickTiles(rnd, g, 34, (tx, ty) => flat(tx, ty) && offPath(tx, ty), { minDist: 4 })) PB.sandRock(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 3));
  for (const s of pickTiles(rnd, g, 12, (tx, ty) => flat(tx, ty), { minDist: 7 })) PB.skull(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.8) * T, Math.floor(rnd() * 2));
  for (const s of pickTiles(rnd, g, 14, (tx, ty) => flat(tx, ty) && offPath(tx, ty), { minDist: 7 })) PB.sandPillar(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 3));
  for (let i = 0; i < 4; i++) { const s = pickTiles(rnd, g, 1, (tx, ty) => flat(tx, ty) && offPath(tx, ty), {})[0]; if (s) PB.archRuin(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T); }
  for (let i = 0; i < 26; i++) { const s = pickTiles(rnd, g, 1, (tx, ty) => flat(tx, ty), {})[0]; if (s) PB.sandMound(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.6) * T, i); }
  // palms round the far oasis
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * 6.283 + 0.3, r = 1.1 + (i % 2) * 0.35;
    const tx = D.oasis2.cx + Math.cos(a) * (D.oasis2.rx + r + 0.8), ty = D.oasis2.cy + Math.sin(a) * (D.oasis2.ry + r + 0.4);
    if (walkOk(Math.floor(tx), Math.floor(ty)) || g.get(Math.floor(tx), Math.floor(ty)) === DS.GRASS) P.palm(o.x + tx * T, o.y + ty * T);
  }
  // obelisk field (north branch)
  for (const [tx, ty] of [[31.5, 6.6], [34.5, 5.6], [37.5, 6.8], [32.4, 10.6], [36.6, 10.8]]) PB.obelisk(hp(tx, ty).x, hp(tx, ty).y);
  P.campfire(hp(34.6, 8.6).x, hp(34.6, 8.6).y);
  lootChest(ctx, 'desert_chest_obelisk', 34.6, 6.6, { gold: [90, 150], potions: 2, gear: { rarity: 'rare', epicChance: 0.12 } }, 'Obelisk cache');

  // ——— temple ———
  const tc = (tx, ty) => hp(tmp.x + tx, tmp.y + ty);
  for (const [tx, ty] of [[3, 15], [18, 15], [3, 4], [18, 4], [9.5, 15.8], [12.5, 15.8]]) { const p = tc(tx, ty); PB.sandPillar(p.x, p.y, 2); }
  for (const [tx, ty] of [[6, 4.4], [16, 4.4]]) { const p = tc(tx, ty); PB.sunStatue(p.x, p.y); }
  for (const [tx, ty] of [[7.5, 17], [14.5, 17], [1.6, 9], [20.4, 9]]) { const p = tc(tx, ty); PB.emberBrazier(p.x, p.y); }
  label(scene, hp(D.temple.gate[0] + 1.5, D.temple.y + D.temple.h + 0.6).x, hp(0, D.temple.y + D.temple.h + 0.6).y, 'Temple of the Sunken Sun', '#ffe0a0');
  lootChest(ctx, 'desert_chest_temple', tmp.x + 19.4, tmp.y + 16.2, { gold: [160, 260], potions: 3, gear: { rarity: 'rare+', epicChance: 0.4 }, items: { gem_yellow: 1 } }, 'Temple hoard');

  // ——— tumbleweeds ———
  for (let i = 0; i < 4; i++) {
    const y = o.y + (20 + i * 8 + rnd() * 4) * T, x0 = o.x + (24 + i * 12) * T;
    const tw = PB.tumbleweed(x0, y);
    scene.tweens.add({ targets: tw, x: x0 + 360, duration: 14000 + i * 3000, repeat: -1, onRepeat: () => { tw.x = x0 - 40; } });
    scene.tweens.add({ targets: tw, angle: 720, duration: 5000, repeat: -1 });
    scene.tweens.add({ targets: tw, y: y - 6, duration: 650 + i * 70, yoyo: true, repeat: -1, ease: 'sine.inout' });
  }

  // ——— mobs ———
  const grid = { grid: g, ok: (tx, ty) => walkOk(tx, ty) && g.get(tx, ty) !== DS.WATER };
  const farFromSpawn = (tx, ty) => Math.hypot(tx - D.spawn[0], ty - D.spawn[1]) > 15;
  spawnMobs(ctx, grid, {
    any: { pred: (tx, ty) => !inR(hubR, tx, ty, 3) && !inR(tmp, tx, ty, 0) && farFromSpawn(tx, ty) && g.get(tx, ty) !== DS.GRASS },
    temple: { pred: (tx, ty) => tx > tmp.x + 1 && tx < tmp.x + tmp.w - 1 && ty > tmp.y + 6 && ty < tmp.y + tmp.h - 2 && g.get(tx, ty) === DS.PAVED && Math.hypot(tx - D.bossSpot[0], ty - D.bossSpot[1]) > 6 },
    boss: { fixed: D.bossSpot },
  }, [{ tx: D.spawn[0], ty: D.spawn[1], r: 14 }], 5150);
}

// ═══════════════════════════ Whisperfen Marsh ═══════════════════════════
export function buildMarsh(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  const M = MARSH, g = genMarsh();
  const mask = reach(g, (c) => !marshSolid(c), Math.floor(M.spawn[0]), Math.floor(M.spawn[1]));
  const walkOk = (tx, ty) => mask[ty * g.w + tx] === 1;
  b.walkable = (x, y) => { const tx = clamp(Math.floor((x - o.x) / T), 0, g.w - 1), ty = clamp(Math.floor((y - o.y) / T), 0, g.h - 1); return walkOk(tx, ty) && g.get(tx, ty) !== MS.SHALLOW; };
  const PB = makePropsBiome(scene, sink(ctx), b.lights);
  const inR = (r, tx, ty, m = 0) => tx >= r.x - m && tx < r.x + r.w + m && ty >= r.y - m && ty < r.y + r.h + m;
  const hubR = M.hub;
  const neigh = (tx, ty, cls) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(tx + dx, ty + dy) === cls);

  bakeArea(scene, 'bake.marsh', g, o, {
    jitter: 6,
    color: (cls, px, py, tx, ty) => {
      const n = fbm(px / 50, py / 50, 3, 2), n2 = vnoise(px / 17, py / 17, 4);
      switch (cls) {
        case MS.MUD: return mix(hex(0x6a7a42), hex(0x55663a), n) ;
        case MS.GRASS: return mix(hex(0x6f9c4a), hex(0x88b858), n2);
        case MS.PEAT: return mix(hex(0x4a4630), hex(0x3a3826), n2);
        case MS.REED: return mix(hex(0x7f9a48), hex(0x5e7a36), n2);
        case MS.SHALLOW: return mix(mix(hex(0x4a8a78), hex(0x6aa890), n2), hex(0x88b8a0), vnoise(px / 9, py / 9, 7) * 0.35);
        case MS.DEEP: return mix(hex(0x1d4a52), hex(0x2b6a6a), vnoise(px / 11, py / 11, 6) * 0.8);
        case MS.BOARD: {
          const horizontal = true; void horizontal;
          const seam = px % 6 === 0 || py % 16 === 0;
          return seam ? hex(0x4a2e18) : mix(hex(0x9a7040), hex(0xb08650), n2);
        }
        default: return hex(0x6a7a42);
      }
    },
    detail: (pt) => {
      const rnd = mkRnd(2727);
      for (let i = 0; i < 560; i++) {
        const x = rnd() * g.w * T, y = rnd() * g.h * T, tx = Math.floor(x / T), ty = Math.floor(y / T), c = g.get(tx, ty);
        if (c === MS.SHALLOW) {
          const k = rnd();
          if (k < 0.4) { pt.ell(x, y, 5, 2.6, '#3e8a54'); pt.ell(x - 1, y - 0.6, 3.6, 1.6, '#62b86a'); if (rnd() < 0.3) pt.dot(x + 1, y - 1, 1.4, '#ff9ad5'); }
          else if (k < 0.7) { pt.line(x, y, x + 5, y, 'rgba(225,245,240,0.4)'); }
          else pt.dot(x, y, 1.2, 'rgba(240,255,250,0.5)');
        } else if (c === MS.MUD || c === MS.PEAT) {
          const k = rnd();
          if (k < 0.4) { pt.ell(x, y, 5, 2, 'rgba(40,60,50,0.45)'); pt.ell(x - 1, y - 0.6, 3, 1.2, 'rgba(120,160,150,0.45)'); }
          else if (k < 0.75) { pt.line(x, y, x - 1, y - 4, '#6f9a3a'); pt.line(x, y, x + 1, y - 5, '#86b046'); }
          else pt.dot(x, y, 1.3, '#8a7a5a');
        } else if (c === MS.GRASS) {
          pt.line(x, y, x - 1, y - 5, '#3f7a3a'); pt.line(x, y, x + 1, y - 6, '#5aa048');
          if (rnd() < 0.25) pt.dot(x, y - 6, 1.3, ['#d8b0ff', '#f4d03f', '#ffffff'][Math.floor(rnd() * 3)]);
        }
      }
      // plank edge rails on boardwalks
      for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
        if (g.get(tx, ty) !== MS.BOARD) continue;
        if (!neigh(tx, ty, MS.BOARD) && false) continue;
        const nonBoard = (dx, dy) => g.get(tx + dx, ty + dy) !== MS.BOARD && g.get(tx + dx, ty + dy) !== 255;
        if (nonBoard(0, 1)) pt.rect(tx * T, ty * T + 13, T, 3, '#3a2412');
        if (nonBoard(0, -1)) pt.rect(tx * T, ty * T, T, 2, '#5a3a20');
      }
      // hub ring of packed boards around the village well
      const cx = (hubR.x + hubR.w / 2) * T, cy = (hubR.y + hubR.h / 2 + 1) * T;
      pt.ell(cx, cy, 70, 52, 'rgba(60,40,20,0.35)'); pt.ell(cx, cy, 64, 47, '#8a6a3c'); pt.ell(cx, cy, 58, 42, '#a07a48');
      for (let i = 0; i < 12; i++) pt.line(cx - 60 + i * 10, cy - 40, cx - 60 + i * 10, cy + 40, 'rgba(60,40,20,0.35)');
      // boss isle: muddy ring + glowing runes
      const bx = M.bossSpot[0] * T + 8, by = M.bossSpot[1] * T + 8;
      pt.ell(bx, by, 44, 30, 'rgba(60,30,80,0.4)'); pt.ell(bx, by, 34, 22, 'rgba(120,80,160,0.35)');
      for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.283; pt.dot(bx + Math.cos(a) * 28, by + Math.sin(a) * 18, 2, '#c8a0ff'); }
    },
  });
  addGridSolids(ctx, g, marshSolid);

  // ——— hub ———
  hubCommon(ctx, 'marsh', 0x7fe0a0, 0x5a6a5a);
  const hp = (tx, ty) => tp(ctx, tx, ty);
  PB.stiltHut(hp(5, 25.8).x, hp(5, 25.8).y, 0x7a5a30); PB.stiltHut(hp(14.6, 25.4).x, hp(14.6, 25.4).y, 0x5a7a4a); PB.stiltHut(hp(14.6, 36).x, hp(14.6, 36).y, 0x8a4a3a);
  P.campfire(hp(9.4, 35.4).x, hp(9.4, 35.4).y);
  for (const [tx, ty] of [[7.2, 28.6], [12.6, 28.4], [7.6, 34], [12.2, 33.6], [16.8, 31]]) PB.lanternPost(hp(tx, ty).x, hp(tx, ty).y);
  for (const [tx, ty, v] of [[3.4, 28.4, 0], [3.4, 29.6, 1], [16.6, 28.4, 0], [3.4, 37.2, 1]]) { const p = hp(tx, ty); if (v) P.crate(p.x, p.y, 1); else P.barrel(p.x, p.y); }
  P.signpost(hp(21.4, 28.4).x, hp(21.4, 28.4).y, [{ dir: 'e', text: 'Gloomtoad Isle', lv: 'Lv 13-14' }, { dir: 's', text: 'Toad Huts', lv: 'Lv 10-13' }]);
  P.signpost(hp(27.4, 26).x, hp(27.4, 26).y, [{ dir: 'n', text: 'Lantern Bog', lv: 'Lv 11-14' }, { dir: 'e', text: 'Boardwalk East', lv: 'Lv 11-14' }]);

  // ——— scenery ———
  const rnd = mkRnd(6606);
  const land = (tx, ty) => { const c = g.get(tx, ty); return (c === MS.MUD || c === MS.GRASS || c === MS.PEAT) && walkOk(tx, ty) && !inR(hubR, tx, ty, 1); };
  const offBoard = (tx, ty) => ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(tx + dx, ty + dy) === MS.BOARD) && g.get(tx, ty) !== MS.BOARD;
  for (const s of pickTiles(rnd, g, 30, (tx, ty) => land(tx, ty) && offBoard(tx, ty), { minDist: 4.5 })) PB.swampTree(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.95) * T, Math.floor(rnd() * 2));
  for (const s of pickTiles(rnd, g, 16, (tx, ty) => land(tx, ty) && offBoard(tx, ty), { minDist: 4 })) PB.giantMushroom(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 3));
  for (const s of pickTiles(rnd, g, 10, (tx, ty) => land(tx, ty) && offBoard(tx, ty), { minDist: 5 })) PB.stump(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T);
  for (const s of pickTiles(rnd, g, 120, (tx, ty) => { const c = g.get(tx, ty); return (c === MS.REED || (c === MS.MUD && neigh(tx, ty, MS.SHALLOW))) && !inR(hubR, tx, ty, 0); }, { minDist: 1.6 })) PB.reeds(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 3));
  // lantern posts along boardwalk edges (every ~7 tiles)
  let postN = 0;
  for (const s of pickTiles(rnd, g, 26, (tx, ty) => g.get(tx, ty) === MS.BOARD && (g.get(tx, ty + 1) === MS.DEEP || g.get(tx, ty - 1) === MS.DEEP || g.get(tx, ty + 1) === MS.SHALLOW || g.get(tx, ty - 1) === MS.SHALLOW) && !inR(hubR, tx, ty, 1), { minDist: 7 })) {
    const below = g.get(s.tx, s.ty + 1) !== MS.BOARD;
    PB.lanternPost(o.x + (s.tx + 0.5) * T, o.y + (s.ty + (below ? 1 : 0.05)) * T); postN++;
  }
  void postN;
  // island huts
  PB.stiltHut(hp(44, 44.6).x, hp(44, 44.6).y, 0x6a5a3a); PB.stiltHut(hp(63, 42.6).x, hp(63, 42.6).y, 0x7a4a3a);
  P.campfire(hp(46.4, 46).x, hp(46.4, 46).y); P.campfire(hp(61, 44).x, hp(61, 44).y);
  lootChest(ctx, 'marsh_chest_hut', 65.2, 44.2, { gold: [80, 140], potions: 2, gear: { rarity: 'rare', epicChance: 0.1 }, items: { gem_green: 1 } }, 'Stilt-hut cache');
  // boss isle dressing
  for (const [tx, ty] of [[62, 10], [72, 10.4], [71.6, 16.2], [62.6, 16]]) PB.giantMushroom(hp(tx, ty).x, hp(tx, ty).y, 0);
  lootChest(ctx, 'marsh_chest_isle', 69.4, 9.2, { gold: [140, 220], potions: 3, gear: { rarity: 'rare+', epicChance: 0.3 }, items: { gem_purple: 1 } }, 'Gloomtoad hoard');
  // fen fishing spots: boardwalk / mud tiles right next to open water
  for (const s of pickTiles(rnd, g, 4, (tx, ty) => walkOk(tx, ty) && (g.get(tx, ty) === MS.BOARD || g.get(tx, ty) === MS.MUD) && (neigh(tx, ty, MS.DEEP) || neigh(tx, ty, MS.SHALLOW)) && !inR(hubR, tx, ty, 2), { minDist: 14, region: [14, 4, 62, 52] })) {
    const wy = neigh(s.tx, s.ty + 1 - 1, MS.DEEP) ? 0 : 0; void wy;
    scene.gather?.addNode('fenpool', o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.6) * T, def.id);
  }
  // drifting wisps (lights)
  for (let i = 0; i < 26; i++) { const s = pickTiles(rnd, g, 1, (tx, ty) => g.get(tx, ty) !== MS.DEEP || rnd() < 0.3, {})[0]; if (s) PB.wisp(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.3) * T); }
  // permanent low mist (weather.js adds fog banks on top)
  if (scene.textures.exists('fx.fog')) {
    const mist = scene.add.tileSprite(o.x, o.y, g.w * T, g.h * T, 'fx.fog').setOrigin(0).setDepth(2380).setTint(0xcfe8dc).setAlpha(0.2);
    scene.tweens.add({ targets: mist, tilePositionX: 128, tilePositionY: 40, duration: 60000, repeat: -1 });
    b.mist = mist;
  }

  // ——— mobs ———
  const grid = { grid: g, ok: (tx, ty) => walkOk(tx, ty) && g.get(tx, ty) !== MS.SHALLOW && g.get(tx, ty) !== MS.BOARD };
  const isle = { x: M.bossIsland.cx - 7, y: M.bossIsland.cy - 6, w: 14, h: 12 };
  spawnMobs(ctx, grid, {
    any: { pred: (tx, ty) => !inR(hubR, tx, ty, 3) && !inR(isle, tx, ty, 0) && Math.hypot(tx - M.spawn[0], ty - M.spawn[1]) > 14 },
    isle: { pred: (tx, ty) => inR(isle, tx, ty, 0) && Math.hypot(tx - M.bossSpot[0], ty - M.bossSpot[1]) > 4 },
    boss: { fixed: M.bossSpot },
  }, [{ tx: M.spawn[0], ty: M.spawn[1], r: 13 }], 7171);
}

// ═══════════════════════════ Emberdeep Caverns ═══════════════════════════
export function buildCavern(ctx) {
  const { scene, mgr, def, o, P, b } = ctx;
  const C = CAVERN, cv = genCavern(), g = cv.grid;
  const mask = cv.reachMask;
  const walkOk = (tx, ty) => mask[ty * g.w + tx] === 1;
  b.walkable = (x, y) => walkOk(clamp(Math.floor((x - o.x) / T), 0, g.w - 1), clamp(Math.floor((y - o.y) / T), 0, g.h - 1));
  const PB = makePropsBiome(scene, sink(ctx), b.lights);
  const nearFloor = (tx, ty) => { for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const c = g.get(tx + i, ty + j); if (c !== CV.ROCK && c !== 255) return true; } return false; };
  const ROCKc = hex(0x1c1620), WALLc2 = hex(0x34283c), FLOORc = hex(0x6a524a), HUBc = hex(0x8a6a52);

  bakeArea(scene, 'bake.caverns', g, o, {
    jitter: 0,
    color: (cls, px, py, tx, ty) => {
      const n = fbm(px / 30, py / 30, 5, 2), n2 = vnoise(px / 9, py / 9, 6);
      switch (cls) {
        case CV.ROCK: {
          if (!nearFloor(tx, ty)) return hex(0x0c0a10);
          const south = g.get(tx, ty + 1) !== CV.ROCK && g.get(tx, ty + 1) !== 255;
          if (south && py % T > T - 6) return hex(0x1a1420);
          const row = Math.floor(py / 8), seam = py % 8 === 0 || (px + (row % 2) * 8) % 16 < 1;
          return seam ? hex(0x120e18) : mix(WALLc2, hex(0x483a52), n2);
        }
        case CV.FLOOR: return mix(mix(FLOORc, hex(0x7a6258), n), hex(0x54403a), n2 * 0.5);
        case CV.HUB: return mix(HUBc, hex(0x9a7a60), n2 * 0.8);
        case CV.LAVA: {
          const k = vnoise(px / 7 + 3, py / 7, 11);
          return mix(mix(hex(0xff5a1a), hex(0xffa030), k), hex(0xffe070), Math.max(0, vnoise(px / 5, py / 5, 12) - 0.72) * 3);
        }
        case CV.BRIDGE: return mix(hex(0x2a2230), hex(0x4a3c58), n2);
        default: return ROCKc;
      }
    },
    detail: (pt) => {
      const rnd = mkRnd(3030);
      for (let i = 0; i < 420; i++) {
        const x = rnd() * g.w * T, y = rnd() * g.h * T, tx = Math.floor(x / T), ty = Math.floor(y / T), c = g.get(tx, ty);
        if (c === CV.FLOOR || c === CV.HUB) {
          const k = rnd();
          if (k < 0.5) pt.dot(x, y, 1.2, 'rgba(30,20,20,0.55)');
          else if (k < 0.75) { pt.line(x, y, x + 5, y + 2, 'rgba(30,20,20,0.5)'); }
          else pt.dot(x, y, 1, 'rgba(255,170,90,0.4)');
        }
      }
      // lava edges: bright rim on neighbouring floor
      for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) {
        if (g.get(tx, ty) !== CV.LAVA) continue;
        for (const [dx, dy, rx, ry, rw, rh] of [[1, 0, 0, 0, 2, T], [-1, 0, T - 2, 0, 2, T], [0, 1, 0, 0, T, 2], [0, -1, 0, T - 2, T, 2]]) {
          const c = g.get(tx + dx, ty + dy);
          if (c === CV.FLOOR || c === CV.HUB || c === CV.BRIDGE) pt.rect((tx + dx) * T + rx, (ty + dy) * T + ry, rw, rh, 'rgba(255,140,50,0.55)');
        }
      }
      // hub: flagstone circle
      const hb = C.hub, cx = (hb.x + hb.w / 2) * T, cy = (hb.y + hb.h / 2) * T;
      pt.ell(cx, cy, 70, 46, 'rgba(40,30,30,0.3)'); pt.ell(cx, cy, 62, 40, '#7a5e4a'); pt.ell(cx, cy, 52, 33, '#8a6e58');
    },
  });
  addGridSolids(ctx, g, cavernSolid);
  addDarkness(ctx);

  // ——— hub ———
  hubCommon(ctx, 'caverns', 0xff7a3a, 0x5a4a52, 'To Thistle Town (surface)');
  const hp = (tx, ty) => tp(ctx, tx, ty);
  PB.forge(hp(11.8, 37.6).x, hp(11.8, 37.6).y); PB.anvil(hp(9.6, 38.8).x, hp(9.6, 38.8).y);
  P.campfire(hp(6.4, 43.4).x, hp(6.4, 43.4).y);
  for (const [tx, ty] of [[3.6, 37], [13, 41.6], [4, 44.6], [12.6, 44.6]]) PB.emberBrazier(hp(tx, ty).x, hp(tx, ty).y);
  for (const [tx, ty, v] of [[3.2, 39.2, 1], [3.2, 40.4, 0], [13.2, 43.4, 1]]) { const p = hp(tx, ty); if (v) P.crate(p.x, p.y, 1); else P.barrel(p.x, p.y); }
  PB.minecart(hp(9.6, 44.2).x, hp(9.6, 44.2).y);
  P.signpost(hp(14.4, 40.2).x, hp(14.4, 40.2).y, [{ dir: 'e', text: 'Crystal Caverns', lv: 'Lv 15-18' }, { dir: 'n', text: "Forgelord's Hall", lv: 'Lv 18-19' }]);
  // ——— lava glow + crystals + stalagmites ———
  const rnd = mkRnd(8181);
  const floorCell = (tx, ty) => (g.get(tx, ty) === CV.FLOOR) && walkOk(tx, ty);
  const lavaList = [];
  for (let ty = 0; ty < g.h; ty++) for (let tx = 0; tx < g.w; tx++) if (g.get(tx, ty) === CV.LAVA && (tx + ty * 3) % 4 === 0) lavaList.push([tx, ty]);
  for (const [tx, ty] of lavaList) { const p = hp(tx + 0.5, ty + 0.5); PB.lavaGlow(p.x, p.y, 1.0); }
  const faceBlock = (tx, ty) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(tx + dx, ty + dy) === CV.ROCK);
  for (const s of pickTiles(rnd, g, 34, (tx, ty) => floorCell(tx, ty) && faceBlock(tx, ty) && !(tx >= C.hub.x && tx < C.hub.x + C.hub.w && ty >= C.hub.y - 1 && ty < C.hub.y + C.hub.h + 1), { minDist: 4 })) PB.crystal(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 4), true);
  for (const s of pickTiles(rnd, g, 32, (tx, ty) => floorCell(tx, ty) && faceBlock(tx, ty), { minDist: 3 })) PB.stalagmite(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T, Math.floor(rnd() * 3));
  for (const s of pickTiles(rnd, g, 16, (tx, ty) => floorCell(tx, ty), { minDist: 5 })) P.bones(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.6) * T, Math.floor(rnd() * 4));
  for (const s of pickTiles(rnd, g, 14, (tx, ty) => floorCell(tx, ty) && faceBlock(tx, ty), { minDist: 6 })) P.torch(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.6) * T, false);
  for (const s of pickTiles(rnd, g, 3, (tx, ty) => floorCell(tx, ty), { minDist: 10 })) PB.minecart(o.x + (s.tx + 0.5) * T, o.y + (s.ty + 0.9) * T);
  // boss hall dressing
  const br = cv.boss;
  for (const [dx, dy] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) { const tx = br.cx + dx, ty = br.cy + dy; if (g.get(tx, ty) === CV.FLOOR) PB.emberBrazier(hp(tx, ty).x, hp(tx, ty).y); }
  lootChest(ctx, 'caverns_chest_a', br.x + 1.2, br.y + 1.3, { gold: [180, 280], potions: 3, gear: { rarity: 'rare+', epicChance: 0.4 }, items: { gem_red: 1 } }, 'Forge hoard');
  const farRoom = cv.rooms.filter((r) => r.role === 'cave').sort((a, b2) => b2.dist - a.dist)[0];
  if (farRoom) lootChest(ctx, 'caverns_chest_b', farRoom.x + farRoom.w - 1.4, farRoom.y + 1.3, { gold: [100, 180], potions: 2, gear: { rarity: 'rare', epicChance: 0.12 } }, 'Miner cache');

  // ——— mobs ———
  const grid = { grid: g, ok: (tx, ty) => walkOk(tx, ty) && g.get(tx, ty) === CV.FLOOR };
  spawnMobs(ctx, grid, {
    any: { pred: (tx, ty) => !(tx >= C.hub.x - 3 && tx < C.hub.x + C.hub.w + 3 && ty >= C.hub.y - 3 && ty < C.hub.y + C.hub.h + 3) && Math.hypot(br.cx - tx, br.cy - ty) > 7 },
    boss: { fixed: [br.cx, br.cy] },
  }, [{ tx: C.spawn[0], ty: C.spawn[1], r: 12 }], 9393);
}

export const EXTRA_BUILDERS = { desert: buildDesert, marsh: buildMarsh, caverns: buildCavern };
void Phaser; void audio; void rng32; void glowAt;
