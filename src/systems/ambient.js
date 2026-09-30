import { settings } from './fxSettings.js';
import { AREAS } from '../data/zones.js';
import { CONFIG } from '../config.js';

// Ambient particles, all drawn from the shared pool (see particles.js):
//   dust puffs / grass rustle / snow + sand puffs while the hero moves,
//   fading footprints in snow and sand, fireflies at night (meadow / woods),
//   chimney smoke and inn steam, torch / campfire flame flicker + embers,
//   waystone sparkles, ice glints on the Frostpeak pond, leaves falling from trees.
// Anything off-screen is skipped, everything scales with the quality preset.

const T = CONFIG.tile;
const LEAVES = {
  woods: [0x6b8f3a, 0x8aa84a, 0xc48a3a, 0xa0642c, 0x4f7a34],
  meadow: [0x7fcf5a, 0xa6d85c, 0xe0c24a, 0x5fae4f],
};
const GRASS = [0x5fae4f, 0x7fcc66, 0x4a9a44, 0x8fdc72];
const rnd = Math.random;

export class Ambient {
  constructor(scene, fx, info = {}) {
    this.scene = scene; this.fx = fx;
    this.chimneys = [];
    this.steam = [];
    for (const r of info.windows || []) {
      const c = r.parentContainer; if (!c) continue;
      if (r.getData('inn')) {
        const hw = 52, h = 38, rh = 30;
        this.chimneys.push({ x: c.x + hw - 22 + 4.5, y: c.y - h - rh - 10, d: c.y + 2, big: true, t: rnd() * 2 });
        this.chimneys.push({ x: c.x - hw + 14 + 4.5, y: c.y - h - rh - 6, d: c.y + 2, big: true, t: rnd() * 2 });
        this.steam.push({ x: c.x - hw - 8.5, y: c.y - 14, d: c.y + 2, t: rnd() * 3 });
        this.steam.push({ x: c.x + hw - 15, y: c.y - 22, d: c.y + 2, t: rnd() * 3 });
      } else if (r.getData('chim')) {
        const hw = r.x + 10, h = 9 - r.y, rh = 12 + Math.round((hw * 2) / 6);
        this.chimneys.push({ x: c.x + hw - 10.5, y: c.y - h - rh - 8, d: c.y + 2, big: false, t: rnd() * 2 });
      }
    }
    this.stepDist = 0; this.side = 1; this.puffT = 0; this.gT = 0; this.ff = 0; this.leafT = 0; this.iceT = 0; this.ffT = 0;
    this._ffDead = () => { this.ff = Math.max(0, this.ff - 1); };
    const pond = AREAS.frost;
    this.pond = pond ? { x0: pond.origin.x + 32 * T, y0: pond.origin.y + 8 * T, w: 12 * T, h: 9 * T } : null;
  }

  update(time, dt) {
    const fx = this.fx, q = settings.q, pool = fx.pool, v = fx.view, reg = fx.region;
    const amb = q.ambient, L = fx.weather?.lvl || {};
    const night = fx.daynight.nightA, lamp = fx.daynight.lamp;
    const RES = 70;
    const inView = (x, y, m = 40) => x > v.x - m && x < v.right + m && y > v.y - m && y < v.bottom + m;
    const wd = fx.wind;
    const p = this.scene.player;

    // ---------- hero: dust / grass rustle / footprints ----------
    if (p && p.body && !p.dead && !this.scene.transitioning && reg.outdoor) {
      const vx = p.body.velocity.x, vy = p.body.velocity.y, sp = Math.hypot(vx, vy);
      if (sp > 14) {
        const g = reg.ground;
        this.puffT -= dt;
        if (this.puffT <= 0) {
          this.puffT = (0.17 + rnd() * 0.07) / Math.max(0.35, amb);
          const fxp = p.x, fyp = p.y + 1;
          const wetv = L.wet || 0;
          if (g === 'grass' || g === 'leaf') {
            const pal = g === 'leaf' ? LEAVES.woods : GRASS;
            for (let i = 0; i < 3; i++) pool.spawn({ frame: g === 'leaf' && i === 0 ? 'leaf' : 'blade', x: fxp + (rnd() - 0.5) * 7, y: fyp + (rnd() - 0.5) * 2, vx: -vx * 0.15 + (rnd() - 0.5) * 40, vy: -42 - rnd() * 34, ay: 230, life: 0.32 + rnd() * 0.12, s0: 1, a0: 1, a1: 0, rot: (rnd() - 0.5) * 1.4, vr: (rnd() - 0.5) * 8, tint: pal[(rnd() * pal.length) | 0], depth: p.y + 1 }, RES);
          } else if (g === 'snow') {
            pool.spawn({ frame: 'soft', x: fxp, y: fyp, vx: -vx * 0.12, vy: -8, life: 0.55, s0: 0.14, s1: 0.5, a0: 0.6, a1: 0, tint: 0xf2f8ff, drag: 2, depth: p.y + 1 }, RES);
            pool.spawn({ frame: 'px', x: fxp + (rnd() - 0.5) * 6, y: fyp, vx: (rnd() - 0.5) * 30, vy: -30 - rnd() * 20, ay: 160, life: 0.4, s0: 1, a0: 1, a1: 0, tint: 0xffffff, depth: p.y + 1 }, RES);
          } else if (wetv > 0.45 && (g === 'stone' || g === 'dirt' || g === 'cobble')) {
            for (let i = 0; i < 3; i++) pool.spawn({ frame: 'px', x: fxp + (rnd() - 0.5) * 8, y: fyp, vx: (rnd() - 0.5) * 50, vy: -34 - rnd() * 30, ay: 260, life: 0.3, s0: 1, a0: 0.9, a1: 0, tint: 0xaecbe8, depth: p.y + 1 }, RES);
          } else {
            const tint = g === 'sand' ? 0xe0cc92 : g === 'stone' ? 0xaab4ba : g === 'cobble' ? 0xb8ae9c : g === 'wood' ? 0xb99a6a : 0xc9b27e;
            pool.spawn({ frame: 'soft', x: fxp, y: fyp, vx: -vx * 0.12 + (rnd() - 0.5) * 6, vy: -7 - rnd() * 4, life: 0.5 + rnd() * 0.15, s0: 0.14, s1: 0.5, a0: g === 'wood' ? 0.22 : 0.42, a1: 0, tint, drag: 2, depth: p.y + 1 }, RES);
          }
        }
        this.stepDist += sp * dt;
        if (this.stepDist >= 9 && q.footprints && (g === 'snow' || g === 'sand')) {
          this.stepDist = 0; this.side = -this.side;
          const h = Math.atan2(vy, vx), nx = -Math.sin(h), ny = Math.cos(h);
          pool.spawn({ frame: 'foot', x: p.x + nx * 2.4 * this.side, y: p.y + 1 + ny * 1.6 * this.side, life: 7, s0: 1, a0: 0.6, a1: 0, rot: h + Math.PI / 2, tint: g === 'snow' ? 0x8da3bb : 0x9a7f52, depth: -6 }, 100);
        }
      } else this.stepDist = 0;
    }

    // ---------- lights: flames, embers, waystone sparkles ----------
    const srcs = fx.lighting.srcs;
    const flameRate = 0.11 / Math.max(0.4, amb);
    for (const s of srcs) {
      if (s.kind === 'fire') {
        if (!inView(s.x, s.y)) continue;
        s._ft = (s._ft || 0) - dt;
        if (s._ft > 0) continue;
        s._ft = flameRate * (0.7 + rnd() * 0.6);
        pool.spawn({ frame: 'soft', x: s.x + (rnd() - 0.5) * 4, y: s.y + 2, vx: (rnd() - 0.5) * 8 + wd * 6, vy: -15 - rnd() * 14, life: 0.45 + rnd() * 0.25, s0: 0.17, s1: 0.03, a0: 0.75, a1: 0, add: true, tint: rnd() < 0.5 ? 0xffa040 : 0xff7a30, depth: s.o.depth + 2 }, RES);
        if (rnd() < 0.3) pool.spawn({ frame: 'px', x: s.x + (rnd() - 0.5) * 5, y: s.y, vx: (rnd() - 0.5) * 16 + wd * 10, vy: -28 - rnd() * 22, life: 0.6 + rnd() * 0.4, s0: 1, a0: 1, a1: 0, add: true, tint: 0xffd890, depth: s.o.depth + 2 }, RES);
      } else if (s.kind === 'magic') {
        if (!inView(s.x, s.y)) continue;
        s._ft = (s._ft || 0) - dt;
        if (s._ft > 0) continue;
        s._ft = 0.3 / Math.max(0.4, amb);
        pool.spawn({ frame: 'spark', x: s.x + (rnd() - 0.5) * 18, y: s.y + 14 + rnd() * 6, vy: -9 - rnd() * 9, life: 1.5, s0: 0.6, s1: 0.2, a0: 0.9, a1: 0, fadeIn: 0.25, swx: 6, swf: 2 + rnd() * 2, add: true, tint: 0x8fe8ff, depth: s.o.depth + 2 }, RES);
      }
    }

    // ---------- chimney smoke + inn steam ----------
    const smokeBoost = 0.55 + 0.45 * Math.max(lamp, 0.3) - (L.rain || 0) * 0.3;
    for (const c of this.chimneys) {
      if (!inView(c.x, c.y, 60)) continue;
      c.t -= dt;
      if (c.t > 0) continue;
      c.t = (c.big ? 0.75 : 1.15) / Math.max(0.35, amb * smokeBoost) * (0.7 + rnd() * 0.6);
      pool.spawn({ frame: 'soft', x: c.x + (rnd() - 0.5) * 2, y: c.y, vx: wd * 14 + 1.5, vy: -(12 + rnd() * 7), life: 2.6 + rnd() * 1.2, s0: 0.18, s1: c.big ? 0.95 : 0.78, a0: 0.5, a1: 0, fadeIn: 0.3, swx: 4, swf: 1.3, tint: night > 0.5 ? 0x6d7490 : 0xd6d8dc, depth: c.d + 40 }, RES);
    }
    for (const s of this.steam) {
      if (!inView(s.x, s.y, 40)) continue;
      s.t -= dt;
      if (s.t > 0) continue;
      s.t = 1.7 / Math.max(0.35, amb) * (0.7 + rnd() * 0.6);
      pool.spawn({ frame: 'soft', x: s.x, y: s.y, vx: wd * 8, vy: -8 - rnd() * 4, life: 1.8, s0: 0.1, s1: 0.45, a0: 0.3, a1: 0, fadeIn: 0.3, swx: 3, swf: 2, tint: 0xf4f6f8, depth: s.d + 40 }, RES);
    }

    // ---------- fireflies (meadow / woods at night, not in rain) ----------
    const ffOk = (reg.id === 'meadow' || reg.id === 'woods') && reg.outdoor && (L.rain || 0) < 0.3 && (L.fog || 0) < 0.8;
    const ffTarget = ffOk ? Math.round(q.fireflies * Math.max(0, night - 0.2) / 0.8) : 0;
    if (p && this.ff < ffTarget) {
      this.ffT -= dt;
      if (this.ffT <= 0) {
        this.ffT = 0.25 + rnd() * 0.3;
        const pr = pool.spawn({ frame: 'soft', x: p.x + (rnd() - 0.5) * v.width * 0.95, y: p.y + (rnd() - 0.5) * v.height * 0.9, vx: (rnd() - 0.5) * 6, vy: (rnd() - 0.5) * 5, life: 6 + rnd() * 5, s0: 0.12 + rnd() * 0.06, a0: 0.95, a1: 0, fadeIn: 1.2, tw: 3 + rnd() * 3, swx: 11, swy: 8, swf: 0.9 + rnd() * 1.2, add: true, tint: reg.id === 'woods' ? 0xb4ffa8 : 0xe4ff88, depth: 2620, land: this._ffDead }, 120);
        if (pr) this.ff++;
      }
    }

    // ---------- leaves falling from trees ----------
    if (q.leaves && (reg.id === 'meadow' || reg.id === 'woods') && reg.outdoor && fx.foliage) {
      this.leafT -= dt;
      if (this.leafT <= 0) {
        this.leafT = (reg.id === 'woods' ? 0.55 : 1.3) / Math.max(0.35, amb * (0.6 + wd));
        const trees = fx.foliage.trees;
        for (let i = 0; i < 8 && trees.length; i++) {
          const t = trees[(rnd() * trees.length) | 0];
          if (!inView(t.x, t.y - 20, 0)) continue;
          const pal = LEAVES[reg.id];
          pool.spawn({ frame: 'leaf', x: t.x + (rnd() - 0.5) * 20, y: t.y - 14 - rnd() * 16, vx: -3 - wd * 18 - rnd() * 6, vy: 8 + rnd() * 7, life: 2.8 + rnd() * 1.8, s0: 0.9 + rnd() * 0.4, a0: 1, a1: 0, fadeIn: 0.2, swx: 11, swy: 3, swf: 2 + rnd() * 2, rot: rnd() * 6, vr: (rnd() - 0.5) * 7, tint: pal[(rnd() * pal.length) | 0], depth: t.y + 60 }, RES);
          break;
        }
      }
    }

    // ---------- ice glints on the Frostpeak pond ----------
    if (this.pond && reg.id === 'frost') {
      const pd = this.pond;
      if (inView(pd.x0 + pd.w / 2, pd.y0 + pd.h / 2, pd.w)) {
        this.iceT -= dt;
        if (this.iceT <= 0) {
          this.iceT = 0.2 / Math.max(0.4, amb);
          pool.spawn({ frame: 'spark', x: pd.x0 + 6 + rnd() * (pd.w - 12), y: pd.y0 + 6 + rnd() * (pd.h - 12), life: 0.8, s0: 0.3 + rnd() * 0.5, s1: 0.1, a0: 1, a1: 0, fadeIn: 0.2, add: true, tint: 0xeaf8ff, depth: -9 }, RES);
        }
      }
    }
  }
}
