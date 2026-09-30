import Phaser from 'phaser';
import { hash2 } from '../world/ground.js';
import { audio } from './audio.js';
import { settings, impl } from './fxSettings.js';

// Per-zone weather: clear, light rain, storm (heavy rain + lightning), fog banks,
// snow / blizzard (Frostpeak), drifting leaves / pollen (Mosswood + meadow) and a
// sandstorm-lite on the dock beach. Every region keeps its own weighted schedule
// (changes every ~80-190 s); levels ease towards the target state (~3 s time
// constant) so nothing pops. All precipitation is drawn from the shared particle
// pool, fog / sand haze are three scrolling tileSprites glued to the camera.

const STATES = {
  clear:    {},
  rain:     { rain: 0.45, dark: 0.22, wind: 0.35 },
  storm:    { rain: 1, dark: 0.5, wind: 0.85, bolt: 1 },
  fog:      { fog: 1, dark: 0.12 },
  snow:     { snow: 0.55, dark: 0.06, wind: 0.2 },
  blizzard: { snow: 1, dark: 0.22, fog: 0.45, wind: 1 },
  leaves:   { leaves: 0.8, wind: 0.45 },
  pollen:   { pollen: 0.8 },
  sand:     { sand: 0.85, dark: 0.14, wind: 0.9 },
};
const SCHEDULE = {
  meadow: { clear: 46, rain: 18, storm: 7, fog: 14, pollen: 15 },
  woods:  { clear: 26, rain: 20, storm: 9, fog: 24, leaves: 21 },
  ruins:  { clear: 28, rain: 24, storm: 14, fog: 34 },
  dock:   { clear: 46, rain: 20, storm: 10, fog: 14 },
  beach:  { clear: 38, rain: 12, storm: 8, fog: 8, sand: 34 },
  frost:  { clear: 14, snow: 44, blizzard: 28, fog: 14 },
};
const INITIAL = { frost: 'snow' };
const KEYS = ['rain', 'snow', 'fog', 'leaves', 'pollen', 'sand', 'dark', 'wind', 'bolt'];
const LEAF_TINT = {
  woods: [0x6b8f3a, 0x8aa84a, 0xc48a3a, 0xa0642c, 0x4f7a34],
  meadow: [0x7fcf5a, 0xa6d85c, 0xe0c24a, 0x5fae4f],
};

function makeNoiseTex(scene, key, S, cells, octaves, lo, hi) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, S, S), ctx = tex.getContext();
  const img = ctx.createImageData(S, S), d = img.data;
  const sm = (t) => t * t * (3 - 2 * t);
  const noise = (x, y, N, seed) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = sm(x - xi), yf = sm(y - yi);
    const h = (i, j) => hash2(((i % N) + N) % N, ((j % N) + N) % N, seed);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), e = h(xi + 1, yi + 1);
    return a + (b - a) * xf + (c - a) * yf + (a - b - c + e) * xf * yf;
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let v = 0, amp = 0.55, tot = 0;
    for (let o = 0; o < octaves; o++) {
      const N = cells << o;
      v += noise((x / S) * N, (y / S) * N, N, 7 + o) * amp; tot += amp; amp *= 0.5;
    }
    v /= tot;
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    const i = (y * S + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255; d[i + 3] = Math.round(t * t * (3 - 2 * t) * 255);
  }
  ctx.putImageData(img, 0, 0); tex.refresh();
  tex.setFilter(Phaser.Textures.FilterMode.LINEAR);
}

export class Weather {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.lvl = { rain: 0, snow: 0, fog: 0, leaves: 0, pollen: 0, sand: 0, dark: 0, wind: 0, bolt: 0, wet: 0 };
    this.regions = {};
    this.key = null;
    this.forced = null;
    this.state = 'clear';
    this.acc = { rain: 0, snow: 0, leaves: 0, pollen: 0, sand: 0, rip: 0 };
    this.flashT = 99; this.nextBolt = 0; this.thunderAt = 0;
    this._audioAcc = 0; this._musicScale = 1;
    makeNoiseTex(scene, 'fx.fog', 128, 4, 3, 0.36, 0.84);
    const mk = (tint, depth) => scene.add.tileSprite(0, 0, 64, 64, 'fx.fog').setOrigin(0).setDepth(depth).setTint(tint).setAlpha(0).setVisible(false);
    this.fogA = mk(0xe8eff2, 2555); this.fogB = mk(0xe8eff2, 2565); this.sandQ = mk(0xd8b878, 2568);
    this.haze = scene.add.rectangle(0, 0, 10, 10, 0xdde6ea, 1).setOrigin(0).setDepth(2552).setAlpha(0).setVisible(false);
    this.cloud = scene.add.rectangle(0, 0, 10, 10, 0x465266, 1).setOrigin(0).setDepth(2551).setAlpha(0).setVisible(false); // overcast slate veil (desaturates under rain)
    this.sandHaze = scene.add.rectangle(0, 0, 10, 10, 0xd8b070, 1).setOrigin(0).setDepth(2553).setAlpha(0).setVisible(false);
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xd8e4ff, 1).setOrigin(0).setDepth(2990).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false);
    // puddles: world-anchored grid cells, pooled
    this.puddles = [];
    for (let i = 0; i < 36; i++) this.puddles.push(scene.add.image(0, 0, 'fx.atlas', 'puddle').setDepth(-6.5).setVisible(false).setTint(0x7c9cbc));
    this._pcx = 1e9; this._pcy = 1e9;
    this._land = (x, y) => this.ripple(x, y, 0.5);
    this.t0 = 0;
    impl.weather = () => this.state;
    impl.setWeather = (id, instant) => this.force(id, instant);
  }

  force(id, instant = false) {
    if (!id || id === 'auto') { this.forced = null; return this.state; }
    if (!STATES[id]) return this.state;
    this.forced = id;
    if (instant) for (const k of KEYS) this.lvl[k] = STATES[id][k] || 0;
    // instantly soak / dry so a screenshot or test sees the final look
    const s = STATES[id];
    this.lvl.wet = (s.rain || 0) > 0.3 ? Math.max(this.lvl.wet, 0.9) : Math.min(this.lvl.wet, 0.2);
    return id;
  }

  pick(key, prev) {
    const sched = SCHEDULE[key]; if (!sched) return 'clear';
    const t = this.fx.daynight.t;
    const dawn = t > 0.16 && t < 0.36, dusk = t > 0.62 && t < 0.82;
    let tot = 0; const w = {};
    for (const [id, base] of Object.entries(sched)) {
      let v = base;
      if (id === 'fog' && dawn) v *= 2.6;
      if (id === 'storm' && dusk) v *= 1.6;
      if (id === prev) v *= 0.3; // avoid the same weather twice in a row
      w[id] = v; tot += v;
    }
    let r = Math.random() * tot;
    for (const [id, v] of Object.entries(w)) { r -= v; if (r <= 0) return id; }
    return 'clear';
  }

  ripple(x, y, sc = 0.5) {
    this.fx.pool.spawn({ frame: 'ring', x, y, s0: 0.12 * sc, s1: 0.6 * sc, life: 0.5, a0: 0.55, a1: 0, tint: 0xe2f0ff, depth: -5, fadeIn: 0.05 }, 40);
  }

  update(time, dt) {
    const fx = this.fx, q = settings.q, L = this.lvl, v = fx.view;
    const region = fx.region;
    const key = region.weatherKey;
    // ---- schedule ----
    if (key !== this.key) this.key = key;
    let target = 'clear';
    if (key) {
      const r = this.regions[key] || (this.regions[key] = { state: INITIAL[key] || 'clear', until: time + 45000 + Math.random() * 60000 });
      if (!this.forced && time >= r.until) { r.state = this.pick(key, r.state); r.until = time + 80000 + Math.random() * 110000; }
      target = this.forced || r.state;
      // a forced state that makes no sense indoors is ignored there
    }
    this.state = target;
    const tg = STATES[target];
    const rate = key ? Math.min(1, dt / 3) : Math.min(1, dt / 0.35);
    for (const k of KEYS) {
      const goal = key ? (tg[k] || 0) : 0;
      L[k] += (goal - L[k]) * rate;
      if (Math.abs(goal - L[k]) < 0.004) L[k] = goal;
    }
    // wetness: soaks in while it rains, dries slowly afterwards
    if (L.rain > 0.15) L.wet = Math.min(1, L.wet + dt * 0.04 * L.rain);
    else L.wet = Math.max(0, L.wet - dt * (key ? 0.012 : 0.05));
    // global wind used by sway / smoke / leaves
    const base = 0.22 + 0.12 * Math.sin(time / 3100) + 0.08 * Math.sin(time / 1170 + 1.3);
    fx.wind = Math.min(1, Math.max(0, base + L.wind * 0.8));

    // ---- grade tint (overcast / wet / sand) ----
    const e = fx.daynight.extra;
    const d = L.dark, w = L.wet, sd = L.sand;
    e[0] = (1 - d * 0.72) * (1 - w * 0.13) * (1 - sd * 0.0);
    e[1] = (1 - d * 0.6) * (1 - w * 0.10) * (1 - sd * 0.14);
    e[2] = (1 - d * 0.36) * (1 - w * 0.05) * (1 - sd * 0.42);

    const qd = q.density;
    const area = (v.width * v.height) / (480 * 270);
    const pool = fx.pool;
    const night = fx.daynight.nightA;
    const dayTone = night > 0.5 ? 0x7d8fb5 : 0xb4ccee;

    // ---- rain ----
    if (L.rain > 0.02) {
      this.acc.rain += 260 * area * L.rain * qd * dt;
      const wd = fx.wind;
      while (this.acc.rain >= 1) {
        this.acc.rain -= 1;
        const vy = 300 + Math.random() * 90 + L.rain * 60;
        pool.spawn({
          frame: 'streak', x: v.x - 30 + Math.random() * (v.width + 60), y: v.y - 10 + Math.random() * (v.height + 10),
          vx: -wd * 75 - 12, vy, life: 0.32 + Math.random() * 0.3, s0: 1, sx: 1, sy: 1 + L.rain * 0.4, a0: 0.3 + L.rain * 0.22, a1: 0.25, face: true,
          tint: dayTone, depth: 2600, land: Math.random() < 0.3 * L.rain * (fx.region.ground === 'snow' ? 0 : 1) ? this._land : null, cull: true,
        }, 30);
      }
      // ripples on the baked puddles / wet ground
      this.acc.rip += dt * L.rain * 7 * qd * area;
      while (this.acc.rip >= 1) { this.acc.rip -= 1; this.ripple(v.x + Math.random() * v.width, v.y + Math.random() * v.height, 0.6); }
    }
    // ---- snow ----
    if (L.snow > 0.02) {
      this.acc.snow += 62 * area * L.snow * qd * dt;
      while (this.acc.snow >= 1) {
        this.acc.snow -= 1;
        pool.spawn({
          frame: 'flake', x: v.x - 20 + Math.random() * (v.width + 40), y: v.y - 6 + Math.random() * (v.height + 6),
          vx: -fx.wind * 38 - 4 - L.snow * 12, vy: 20 + Math.random() * 28 + L.snow * 22, life: 2.4 + Math.random() * 2.6,
          s0: 0.9 + Math.random() * 0.8, a0: 0.9, a1: 0, fadeIn: 0.5, swx: 9 + Math.random() * 10, swf: 1.4 + Math.random() * 1.6, tint: night > 0.5 ? 0xaec0e0 : 0xffffff, depth: 2600, cull: true,
        }, 30);
      }
    }
    // ---- drifting leaves (+ pollen) ----
    if (L.leaves > 0.02) {
      this.acc.leaves += 7 * area * L.leaves * qd * dt;
      const pal = LEAF_TINT.woods;
      while (this.acc.leaves >= 1) {
        this.acc.leaves -= 1;
        pool.spawn({
          frame: 'leaf', x: v.x + Math.random() * (v.width + 50), y: v.y - 8 + Math.random() * v.height * 0.6,
          vx: -14 - fx.wind * 30 - Math.random() * 12, vy: 13 + Math.random() * 13, life: 4 + Math.random() * 3.5, s0: 1 + Math.random() * 0.5,
          a0: 0.95, a1: 0, fadeIn: 0.4, swx: 10 + Math.random() * 12, swy: 6, swf: 1.8 + Math.random() * 2, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 6,
          tint: pal[(Math.random() * pal.length) | 0], depth: 2600, cull: true,
        }, 30);
      }
    }
    if (L.pollen > 0.02) {
      this.acc.pollen += 9 * area * L.pollen * qd * dt;
      while (this.acc.pollen >= 1) {
        this.acc.pollen -= 1;
        pool.spawn({
          frame: 'soft', x: v.x + Math.random() * v.width, y: v.y + Math.random() * v.height, vx: 2 + fx.wind * 8, vy: -3 - Math.random() * 6,
          life: 5 + Math.random() * 4, s0: 0.12 + Math.random() * 0.12, a0: 0.75, a1: 0, fadeIn: 1.2, tw: 2.6, swx: 7, swy: 6, swf: 1 + Math.random(), add: true,
          tint: night > 0.5 ? 0x9fb4e8 : 0xfff0a0, depth: 2600, cull: true,
        }, 30);
      }
    }
    // ---- sandstorm-lite ----
    if (L.sand > 0.02) {
      this.acc.sand += 170 * area * L.sand * qd * dt;
      while (this.acc.sand >= 1) {
        this.acc.sand -= 1;
        pool.spawn({
          frame: 'px', x: v.x - 50 + Math.random() * v.width * 0.5, y: v.y + Math.random() * v.height, vx: 170 + Math.random() * 100, vy: 8 + Math.random() * 26,
          life: 0.55 + Math.random() * 0.5, s0: 1, sx: 5 + Math.random() * 7, sy: 0.7, a0: 0.75, a1: 0.15, face: false, tint: Math.random() < 0.5 ? 0xd9bd7e : 0xc4a468, depth: 2600, cull: true,
        }, 30);
      }
    }

    // ---- fog / sand haze quads ----
    this.fitQuad(this.haze, v, 0.2 * L.fog);
    this.fitQuad(this.cloud, v, 0.3 * L.dark * (1 - 0.6 * L.fog));
    this.fitQuad(this.sandHaze, v, 0.22 * L.sand);
    const g = fx.daynight._rgb;
    const tone = (r0, g0, b0) => (((r0 * (g[0] / 255)) | 0) << 16) | (((g0 * (g[1] / 255)) | 0) << 8) | ((b0 * (g[2] / 255)) | 0);
    const fogTone = tone(236, 242, 246);
    this.haze.setFillStyle(tone(214, 224, 230), 1);
    if (L.fog > 0.02) {
      for (const [q2, sc, sp, ph] of [[this.fogA, 3, 6, 0], [this.fogB, 4.5, -4, 0.5]]) {
        q2.setVisible(true).setAlpha(Math.min(1, L.fog * 0.55)).setTint(fogTone);
        q2.setPosition(Math.floor(v.x) - 8, Math.floor(v.y) - 8).setSize(Math.ceil(v.width) + 16, Math.ceil(v.height) + 16);
        q2.setTileScale(sc, sc);
        q2.tilePositionX = (v.x + time * 0.001 * sp) / sc + ph * 128;
        q2.tilePositionY = (v.y + time * 0.0006 * sp) / sc + ph * 70;
      }
    } else { this.fogA.setVisible(false); this.fogB.setVisible(false); }
    if (L.sand > 0.02) {
      const q2 = this.sandQ;
      q2.setVisible(true).setAlpha(Math.min(0.5, L.sand * 0.42)).setTint(tone(225, 190, 120));
      q2.setPosition(Math.floor(v.x) - 8, Math.floor(v.y) - 8).setSize(Math.ceil(v.width) + 16, Math.ceil(v.height) + 16).setTileScale(2.4, 2.4);
      q2.tilePositionX = (v.x - time * 0.12) / 2.4; q2.tilePositionY = v.y / 2.4 + Math.sin(time / 900) * 6;
    } else this.sandQ.setVisible(false);

    // ---- lightning ----
    if (L.bolt > 0.6 && key) {
      if (this.nextBolt === 0) this.nextBolt = time + 2500 + Math.random() * 5000;
      if (time >= this.nextBolt) {
        this.flashT = 0; this.nextBolt = time + 6000 + Math.random() * 9000;
        this.thunderAt = time + 500 + Math.random() * 1600;
      }
    } else this.nextBolt = 0;
    if (this.flashT < 0.7) {
      this.flashT += dt;
      const t = this.flashT;
      const a = t < 0.05 ? t / 0.05 * 0.85 : t < 0.11 ? 0.85 - (t - 0.05) / 0.06 * 0.7 : t < 0.16 ? 0.15 + (t - 0.11) / 0.05 * 0.45 : Math.max(0, 0.6 * (1 - (t - 0.16) / 0.5));
      this.fitQuad(this.flash, v, a * (night > 0.5 ? 0.55 : 0.4));
    } else this.flash.setVisible(false);
    if (this.thunderAt && time >= this.thunderAt) {
      this.thunderAt = 0;
      try { if (audio.enabled) { audio.blip(58, 1.0, 'sawtooth', 0.05); audio.blip(41, 1.3, 'square', 0.035); } } catch { /* no audio */ }
    }

    // ---- puddles ----
    this.updatePuddles(time, dt, v);

    // ---- audio: rain muffles the music a little ----
    this._audioAcc += dt;
    if (this._audioAcc > 0.25) {
      this._audioAcc = 0;
      const s = 1 - 0.4 * Math.min(1, L.rain) - 0.15 * L.fog;
      const mo = audio.musicObj;
      if (mo && mo.setVolume && (Math.abs(s - this._musicScale) > 0.01 || mo !== this._lastMo)) {
        this._lastMo = mo; this._musicScale = s;
        try { mo.setVolume(0.35 * s); } catch { /* ignore */ }
      }
    }
  }

  fitQuad(o, v, alpha) {
    if (alpha < 0.005) { o.setVisible(false); return; }
    o.setVisible(true).setAlpha(alpha).setPosition(Math.floor(v.x) - 8, Math.floor(v.y) - 8).setDisplaySize(Math.ceil(v.width) + 16, Math.ceil(v.height) + 16);
  }

  updatePuddles(time, dt, v) {
    const wet = this.lvl.wet, q = settings.q;
    if (!q.puddles || wet < 0.12 || !this.fx.region.puddles) { if (this._puddlesOn) { for (const p of this.puddles) p.setVisible(false); this._puddlesOn = false; } return; }
    this._puddlesOn = true;
    const C = 44, cx0 = Math.floor((v.x - 20) / C), cy0 = Math.floor((v.y - 20) / C);
    const cx1 = Math.floor((v.right + 20) / C), cy1 = Math.floor((v.bottom + 20) / C);
    const a = Math.min(1, (wet - 0.1) * 1.5) * 0.62;
    let n = 0;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (hash2(cx, cy, 77) > 0.3) continue;
      const x = cx * C + 6 + hash2(cx, cy, 78) * (C - 12), y = cy * C + 6 + hash2(cx, cy, 79) * (C - 12);
      if (!this.fx.puddleOk(x, y)) continue;
      if (n >= this.puddles.length) break;
      const p = this.puddles[n++];
      const sc = 0.35 + hash2(cx, cy, 80) * 0.55;
      p.setPosition(x, y).setScale(sc, sc).setAlpha(a).setVisible(true);
      if (this.lvl.rain > 0.15 && Math.random() < dt * 0.9 * this.lvl.rain) this.ripple(x + (Math.random() - 0.5) * 16 * sc, y + (Math.random() - 0.5) * 6 * sc, 0.5);
    }
    for (let i = n; i < this.puddles.length; i++) this.puddles[i].setVisible(false);
  }
}
