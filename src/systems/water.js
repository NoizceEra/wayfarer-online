import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { AREAS } from '../data/zones.js';
import { hash2 } from '../world/ground.js';
import { settings } from './fxSettings.js';
import { network, riverPoint, riverHalfWidth, onBridge, BAY_X0, shoreY } from '../world/waterways.js';

// Animated water without per-frame canvas redraws:
//  - two scrolling "glint" tileSprites (ADD) over every water surface (dock bay,
//    the map's water rim) give a gentle wave shimmer, tinted moon-blue at night;
//  - lapping foam strips along the dock shoreline (alpha / offset sine, scrolled);
//  - reeds and lily pads that sway / bob (a handful of sprites, only updated when near);
//  - a wobbling mirror image of the lighthouse (+ its lamp at night) in the bay.
// Boats already bob (propsExtra.boat); this module adds nothing on top of them.

const T = CONFIG.tile;

function genTextures(scene) {
  if (!scene.textures.exists('fx.shimmer')) {
    const S = 64, tex = scene.textures.createCanvas('fx.shimmer', S, S), ctx = tex.getContext();
    const img = ctx.createImageData(S, S), d = img.data;
    const sm = (t) => t * t * (3 - 2 * t);
    const CX = 8, CY = 24; // wide, flat glints
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
      const h = (i, j) => hash2(((i % CX) + CX) % CX, ((j % CY) + CY) % CY, 31);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), e = h(xi + 1, yi + 1);
      return a + (b - a) * xf + (c - a) * yf + (a - b - c + e) * xf * yf;
    };
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n((x / S) * CX, (y / S) * CY);
      const t = Math.max(0, (v - 0.62) / 0.3);
      const i = (y * S + x) * 4; d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.min(255, Math.round(t * t * 300));
    }
    ctx.putImageData(img, 0, 0); tex.refresh();
  }
  if (!scene.textures.exists('fx.foam')) {
    const tex = scene.textures.createCanvas('fx.foam', 32, 8), c = tex.getContext();
    c.fillStyle = '#fff';
    for (let x = 0; x < 32; x++) {
      const h = hash2(x >> 1, 3, 5), w = hash2(x, 9, 6);
      if (w > 0.35) { const hh = 1 + Math.floor(h * 2.4); c.globalAlpha = 0.55 + 0.45 * h; c.fillRect(x, 4 - hh + (x % 3 === 0 ? 1 : 0), 1, hh); }
    }
    c.globalAlpha = 0.5; c.fillRect(0, 4, 32, 1);
    tex.refresh();
  }
  if (!scene.textures.exists('fx.reed')) {
    const tex = scene.textures.createCanvas('fx.reed', 14, 22), c = tex.getContext();
    const blades = [[4, 14, '#5f8a3c'], [6, 19, '#7fa04a'], [8, 16, '#5f8a3c'], [10, 12, '#7fa04a'], [7, 21, '#4f7a34']];
    for (const [x, h, col] of blades) { c.fillStyle = col; c.fillRect(x, 22 - h, 1, h); c.fillRect(x + (x % 2 ? 1 : -1), 22 - h + 2, 1, 4); }
    c.fillStyle = '#6b4422'; c.fillRect(6, 1, 2, 5); c.fillRect(9, 6, 2, 4);
    c.fillStyle = '#8a6030'; c.fillRect(6, 1, 1, 2);
    tex.refresh();
  }
  if (!scene.textures.exists('fx.lily')) {
    const tex = scene.textures.createCanvas('fx.lily', 14, 9), c = tex.getContext();
    c.fillStyle = '#2f7a3a'; c.beginPath(); c.ellipse(7, 4.5, 6, 3.4, 0, 0, 7); c.fill();
    c.fillStyle = '#4da34e'; c.beginPath(); c.ellipse(6.5, 4, 4.6, 2.3, 0, 0, 7); c.fill();
    c.clearRect(7, 4, 7, 1);
    c.fillStyle = '#ff9fc0'; c.fillRect(5, 2, 2, 2); c.fillStyle = '#ffe07a'; c.fillRect(5, 3, 1, 1);
    tex.refresh();
  }
}

export class Water {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    genTextures(scene);
    this.shim = [];      // {ts, ts2, region}
    this.foam = [];
    this.plants = [];    // reeds + lilies
    this.refl = null;
    this._built = {};
    const W = CONFIG.worldCols * T, H = CONFIG.worldRows * T;
    // overworld water rim (24 px wide, see overworld.js)
    const rim = [[0, 0, W, 24], [0, H - 24, W, 24], [0, 24, 24, H - 48], [W - 24, 24, 24, H - 48]];
    for (const [x, y, w, h] of rim) this.addShimmer(x, y, w, h, -7.9, 'over');
    this.addRiverShimmer();
    // glints sparkling on ice etc. use the shared particle pool (ambient.js)
  }

  addRiverShimmer() {
    const N = network();
    for (let i = 0; i < N.rivers.length; i++) {
      const r = N.rivers[i];
      for (let s = 0; s < r.len; s += 72) {
        const [x, y] = riverPoint(i, s);
        if (onBridge(x, y, 28)) continue;
        const hw = riverHalfWidth(i, s) + 6;
        this.addShimmer(x - hw, y - hw * 0.7, hw * 2, hw * 1.4, -7.85, 'over');
      }
    }
    const bayW = 2048 - BAY_X0, bayH = Math.max(40, shoreY(2040) + 12);
    this.addShimmer(BAY_X0 - 20, 0, bayW + 20, bayH, -7.85, 'over');
  }

  addShimmer(x, y, w, h, depth, region) {
    const mk = (sc, alpha, dd) => this.scene.add.tileSprite(x, y, w, h, 'fx.shimmer').setOrigin(0).setDepth(depth + dd).setBlendMode(Phaser.BlendModes.ADD).setTileScale(sc, sc).setAlpha(alpha).setTint(0xd2ecff);
    const ts = mk(1, 0.3, 0), ts2 = mk(1.6, 0.2, 0.01);
    this.shim.push({ ts, ts2, x, y, w, h, region });
  }

  buildDock(b) {
    const sc = this.scene, o = b.o;
    // water tileSprites of the bay get a shimmer twin right above them
    for (const ch of sc.children.list) {
      if (ch.type === 'TileSprite' && ch.texture?.key === 'tile.water' && ch.x >= o.x && ch.x < o.x + b.w) this.addShimmer(ch.x, ch.y, ch.width, ch.height, -10.9, 'dock');
    }
    // lapping foam along the shore, skipping the three piers (tiles 6-8, 18-20, 30-32)
    const y = o.y + 28 * T - 3;
    for (const [a, z] of [[0, 6], [9, 18], [21, 30], [33, 56]]) {
      for (let k = 0; k < 2; k++) {
        const ts = sc.add.tileSprite(o.x + a * T, y, (z - a) * T, 8, 'fx.foam').setOrigin(0).setDepth(-8.95 + k * 0.01).setTint(0xf2fbff).setAlpha(0.6).setTileScale(1, 1);
        this.foam.push({ ts, k, y });
      }
    }
    // reeds + lily pads
    const rnd = (i, s) => hash2(i, 1, s);
    const piers = [[5.5, 9.5], [17.5, 21.5], [29.5, 33.5]];
    const onPier = (tx) => piers.some(([a, z]) => tx > a && tx < z);
    let n = 0;
    for (let tx = 1; tx < 55; tx += 1.6 + rnd(tx | 0, 1) * 2.2) {
      if (onPier(tx)) continue;
      const px = o.x + tx * T, py = o.y + (28.35 + rnd(n, 2) * 0.5) * T;
      const c = 2 + ((rnd(n, 3) * 3) | 0);
      for (let i = 0; i < c; i++) {
        const im = sc.add.image(px + (i - c / 2) * 4 + rnd(n * 7 + i, 4) * 3, py + rnd(n * 5 + i, 5) * 3, 'fx.reed').setOrigin(0.5, 1).setDepth(py + 1).setFlipX(rnd(n + i, 6) > 0.5);
        this.plants.push({ im, kind: 'reed', ph: rnd(n * 3 + i, 7) * 6.28, x: im.x, y: im.y });
      }
      n++;
    }
    const lil = [[10, 29.7], [11.3, 30.6], [16.6, 29.5], [17.2, 30.8], [22.2, 29.8], [23.3, 30.7], [28, 29.6], [28.9, 30.5], [35, 29.6], [36.5, 30.4], [40, 29.6], [45, 29.5], [49, 30.4], [2.5, 29.8], [3.6, 31]];
    lil.forEach(([tx, ty], i) => {
      const im = sc.add.image(o.x + tx * T, o.y + ty * T, 'fx.lily').setDepth(-10.7).setFlipX(i % 2 === 0).setAlpha(0.95).setAngle((i * 47) % 360);
      this.plants.push({ im, kind: 'lily', ph: i * 1.7, x: im.x, y: im.y, a0: im.angle });
    });
    // lighthouse reflection (lighthouse stands at tile 36.6 / 27.3; shore at y = 28)
    const lx = o.x + 36.6 * T, ly = o.y + 27.3 * T, shore = o.y + 28 * T;
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const w = 26 - i * 2.4, top = ly - 14 - 14 * i; // original band top (world)
      const my = shore + (shore - (top + 14)); // mirrored top
      const r = sc.add.rectangle(lx, my, w, 14, i % 2 ? 0xd04a3a : 0xf6f2e8, 0.46 - i * 0.05).setOrigin(0.5, 0).setDepth(-10.6);
      parts.push({ r, i, x0: lx });
    }
    const lamp = sc.add.rectangle(lx, shore + (shore - (ly - 88)), 14, 10, 0xf7dc6f, 0.35).setOrigin(0.5, 0).setDepth(-10.6);
    const streak = sc.add.image(lx, shore + (shore - (ly - 93)) + 40, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe9a0).setDepth(-10.55).setScale(0.55, 2.6).setAlpha(0);
    const pool = sc.add.image(lx, shore + (shore - (ly - 93)), 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(0xffe9a0).setDepth(-10.55).setScale(1.3, 0.7).setAlpha(0);
    this.refl = { parts, lamp, streak, pool, x: lx };
  }

  update(time, dt) {
    const fx = this.fx, q = settings.q, v = fx.view, dn = fx.daynight;
    // lazily build the dock pieces once the dock area exists
    const a = this.scene.areas;
    if (a?.built?.dock && !this._built.dock) { this._built.dock = true; try { this.buildDock(a.built.dock); } catch (e) { console.error('water.buildDock', e); } }
    const night = dn.nightA;
    const show = q.shimmer;
    const tint = night > 0.4 ? 0x9cb8ff : 0xd2ecff;
    for (const s of this.shim) {
      const inView = s.x < v.right && s.x + s.w > v.x && s.y < v.bottom && s.y + s.h > v.y;
      const vis = show && inView;
      s.ts.setVisible(vis); s.ts2.setVisible(vis);
      if (!vis) continue;
      const k = time * 0.001;
      s.ts.tilePositionX = k * 5; s.ts.tilePositionY = Math.sin(k * 0.7) * 3 + k * 1.5;
      s.ts2.tilePositionX = -k * 3.2 + 20; s.ts2.tilePositionY = -k * 1.1 + Math.cos(k * 0.5) * 4;
      const pulse = 0.85 + 0.15 * Math.sin(k * 1.3);
      const base = 0.3 + 0.12 * night;
      s.ts.setAlpha(base * pulse).setTint(tint); s.ts2.setAlpha(base * 0.7 / pulse).setTint(tint);
    }
    // foam
    if (this.foam.length) {
      const k = time * 0.001;
      for (const f of this.foam) {
        const ts = f.ts;
        const inView = ts.x < v.right && ts.x + ts.width > v.x && f.y < v.bottom && f.y + 8 > v.y;
        ts.setVisible(q.foam && inView);
        if (!q.foam || !inView) continue;
        const ph = f.k * 2.1;
        const lap = 0.5 + 0.5 * Math.sin(k * 0.9 + ph);
        ts.y = f.y + lap * 3.5 - 1;
        ts.setAlpha(0.25 + 0.5 * (1 - lap) + 0.1 * f.k);
        ts.tilePositionX = k * (f.k ? -2.2 : 1.6) + f.k * 11;
      }
    }
    // plants
    if (this.plants.length && this.fx.region.id === 'dock') {
      const k = time * 0.001, wd = fx.wind;
      for (const p of this.plants) {
        const im = p.im;
        if (p.kind === 'reed') {
          im.rotation = Math.sin(k * (1.4 + wd) + p.ph) * (0.05 + 0.1 * wd) + wd * 0.05;
        } else {
          im.y = p.y + Math.sin(k * 0.9 + p.ph) * 0.6; im.x = p.x + Math.cos(k * 0.6 + p.ph) * 0.5;
          im.setAngle(p.a0 + Math.sin(k * 0.5 + p.ph) * 6);
        }
      }
    }
    // lighthouse mirror
    const R = this.refl;
    if (R && this.fx.region.id === 'dock') {
      const k = time * 0.001, lamp = dn.lamp;
      for (const p of R.parts) { p.r.x = R.x + Math.sin(k * 1.7 + p.i * 0.9) * (1.2 + 0.4 * p.i); p.r.setScale(1 + Math.sin(k * 2.3 + p.i) * 0.05, 1); }
      R.lamp.x = R.x + Math.sin(k * 1.7 + 5) * 3; R.lamp.setAlpha(0.3 + 0.55 * lamp);
      R.streak.setAlpha(lamp * (0.4 + 0.1 * Math.sin(k * 2.1))).x = R.x + Math.sin(k * 1.4) * 2;
      R.pool.setAlpha(lamp * 0.5);
    }
  }
}
