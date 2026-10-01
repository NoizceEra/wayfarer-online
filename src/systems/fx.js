import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { AREAS } from '../data/zones.js';
import { makeRoads, roadDist } from '../world/ground.js';
import { waterAt, onBridge } from '../world/waterways.js';
import { audio } from './audio.js';
import { settings, impl, QUALITY } from './fxSettings.js';
import { ParticlePool } from './particles.js';
import { Weather } from './weather.js';
import { Lighting } from './lighting.js';
import { Water } from './water.js';
import { Foliage } from './foliage.js';
import { Ambient } from './ambient.js';

// Visual-effects orchestrator for WorldScene. One object, three hooks:
//   this.fx = new Fx(this, { windows, spawn });   // after DayNight exists
//   this.fx.update(time, dt);                     // end of update()
//   (OverlayScene.fade calls fx.irisClose / fx.irisOpen)
// Sub-systems: weather.js, lighting.js, water.js, foliage.js, ambient.js, particles.js;
// daynight.js owns the colour grade. Settings / public console API: fxSettings.js.

const T = CONFIG.tile;
const OVER = ['town', 'meadow', 'woods', 'ruins'];

class CrtScene extends Phaser.Scene {
  constructor() { super('fxcrt'); }
  create() {
    if (!this.textures.exists('fx.scan')) {
      const tex = this.textures.createCanvas('fx.scan', 4, 4), c = tex.getContext();
      c.fillStyle = 'rgba(0,0,0,0.30)'; c.fillRect(0, 2, 4, 1);
      c.fillStyle = 'rgba(0,0,0,0.10)'; c.fillRect(0, 3, 4, 1);
      tex.refresh();
    }
    const { width: W, height: H } = this.scale;
    this.lines = this.add.tileSprite(0, 0, W, H, 'fx.scan').setOrigin(0).setDepth(1);
    this.vig = this.add.image(0, 0, 'fx.vignette').setOrigin(0).setDepth(2).setAlpha(0.55).setDisplaySize(W, H);
    this.glow = this.add.rectangle(0, 0, W, H, 0xffffff, 0.03).setOrigin(0).setDepth(3).setBlendMode(Phaser.BlendModes.ADD);
    this.scale.on('resize', this.fit, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.fit, this));
  }
  fit() {
    const { width: W, height: H } = this.scale;
    this.lines.setSize(W, H); this.vig.setDisplaySize(W, H); this.glow.setSize(W, H);
  }
  update(t) {
    this.lines.tilePositionY = (t * 0.01) % 4;
    this.glow.setAlpha(0.025 + 0.012 * Math.sin(t / 37) + 0.008 * Math.sin(t / 113));
  }
}

export class Fx {
  constructor(scene, info = {}) {
    this.scene = scene;
    // Phaser's canvas renderer probes 'multiply' support asynchronously and so always ends up
    // mapping MULTIPLY/SCREEN to source-over. Every current browser supports them; enable.
    const bm = scene.game.renderer?.blendModes;
    if (bm && scene.game.renderer.type === Phaser.CANVAS) {
      if (bm[Phaser.BlendModes.MULTIPLY] === 'source-over') bm[Phaser.BlendModes.MULTIPLY] = 'multiply';
      if (bm[Phaser.BlendModes.SCREEN] === 'source-over') bm[Phaser.BlendModes.SCREEN] = 'screen';
    }
    this.daynight = scene.daynight;
    this.view = scene.cameras.main.worldView;
    this.wind = 0.25;
    this.pool = new ParticlePool(scene, settings.q.pool);
    this.roads = makeRoads(info.spawn || scene.spawn || { x: 1024, y: 1024 });
    this.spawn = info.spawn || scene.spawn;
    this.W = CONFIG.worldCols * T; this.H = CONFIG.worldRows * T;
    this.region = { id: 'meadow', weatherKey: 'meadow', ground: 'grass', outdoor: true, puddles: true };
    this._gT = 0; this._overId = 'meadow';
    this.lighting = new Lighting(scene, this);
    this.lighting.addHouseWindows(info.windows);
    this.weather = new Weather(scene, this);
    this.water = new Water(scene, this);
    this.foliage = new Foliage(scene, this);
    this.ambient = new Ambient(scene, this, info);
    this._iris = null; this._irisObjs = null;
    this._fpsT = 0; this._lowT = 0; this._age = 0;
    this._off = settings.onChange(() => this.onSettings());
    scene.events.once('shutdown', () => this.destroy());
    impl.debug = () => this.debug();
    this.onSettings();
    if (!scene.textures.exists('fx.iris')) {
      const tex = scene.textures.createCanvas('fx.iris', 256, 256), c = tex.getContext();
      c.fillStyle = '#000'; c.fillRect(0, 0, 256, 256);
      c.globalCompositeOperation = 'destination-out';
      const g = c.createRadialGradient(128, 128, 60, 128, 128, 64);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.beginPath(); c.arc(128, 128, 64, 0, 7); c.fill();
      tex.refresh();
    }
  }

  onSettings() {
    this.pool.resize(settings.q.pool);
    if (this.pool.live.length > this.pool.cap) this.pool.clear();
    const mgr = this.scene.scene;
    if (settings.crt) {
      if (!mgr.get('fxcrt')) mgr.add('fxcrt', CrtScene, false);
      if (!mgr.isActive('fxcrt')) mgr.launch('fxcrt');
    } else if (mgr.get('fxcrt') && mgr.isActive('fxcrt')) mgr.stop('fxcrt');
  }

  destroy() {
    this._off?.();
    try { audio.musicObj?.setVolume?.(0.35); } catch { /* ignore */ }
    try { const m = this.scene.scene; if (m.get('fxcrt') && m.isActive('fxcrt')) m.stop('fxcrt'); } catch { /* ignore */ }
  }

  // ---- region / ground ----
  computeRegion(dt) {
    const s = this.scene, a = s.areas?.current, zid = s.zoneId, R = this.region;
    if (a) {
      if (a.kind === 'interior' || a.kind === 'dungeon') { R.id = 'indoor'; R.weatherKey = null; R.outdoor = false; R.puddles = false; R.ground = a.kind === 'dungeon' ? 'stone' : 'wood'; return; }
      R.outdoor = true;
      if (a.id === 'dock') { R.id = 'dock'; R.weatherKey = zid === 'dock_beach' ? 'beach' : 'dock'; }
      else if (a.id === 'frost') { R.id = 'frost'; R.weatherKey = 'frost'; }
      else if (a.id === 'desert') { R.id = 'desert'; R.weatherKey = 'desert'; } // world expansion: sandstorms
      else if (a.id === 'marsh') { R.id = 'marsh'; R.weatherKey = 'marsh'; } // mist, drizzle
      else { R.id = 'meadow'; R.weatherKey = 'meadow'; }
    } else {
      R.outdoor = true;
      if (OVER.includes(zid)) this._overId = zid;
      R.id = this._overId; R.weatherKey = R.id === 'town' ? 'meadow' : R.id;
    }
    this._gT -= dt;
    if (this._gT <= 0 && s.player) { this._gT = 0.12; R.ground = this.groundAt(s.player.x, s.player.y, R.id); }
  }

  groundAt(x, y, id) {
    if (id === 'frost') return 'snow';
    if (id === 'desert') return 'sand';
    if (id === 'marsh') return 'dirt';
    if (id === 'dock') {
      const o = AREAS.dock.origin, lx = x - o.x, ly = y - o.y;
      if (ly >= 28 * T) return 'wood';
      return (lx >= 38 * T || ly >= 24 * T) ? 'sand' : 'cobble';
    }
    if (id !== 'dock' && waterAt(x, y) && !onBridge(x, y)) return 'water';
    if (id === 'woods') return 'leaf';
    if (id === 'ruins') return 'stone';
    if (onBridge(x, y) || roadDist(this.roads, x, y) < 11) return 'dirt';
    if (id === 'town') return Math.hypot(x - this.spawn.x, y - this.spawn.y) < 86 ? 'cobble' : 'dirt';
    return 'grass';
  }

  puddleOk(x, y) {
    const id = this.region.id;
    if (id === 'dock') { const o = AREAS.dock.origin; return y - o.y < 23 * T && x - o.x < 37 * T; }
    if (id === 'frost' || id === 'indoor' || id === 'desert') return false;
    if (x < 44 || y < 44 || x > this.W - 44 || y > this.H - 44) return false;
    if (waterAt(x, y, 8) || onBridge(x, y, 12)) return false;
    if (id === 'town' && Math.hypot(x - this.spawn.x, y - this.spawn.y) < 70) return false; // cobbled plaza stays dry-looking
    return true;
  }

  // ---- update ----
  update(time, dt) {
    // visuals must never take gameplay down: log a few errors, then switch the layer off
    try { this._update(time, dt); } catch (e) {
      this._errs = (this._errs || 0) + 1;
      if (this._errs < 4) console.error('fx', e);
      if (this._errs > 30) this.update = () => {};
    }
  }

  _update(time, dt) {
    dt = Math.min(dt, 0.1);
    this._age += dt;
    this.computeRegion(dt);
    this.weather.update(time, dt);
    this.foliage.update(time);
    this.lighting.update(time, dt);
    this.water.update(time, dt);
    this.ambient.update(time, dt);
    const fb = this.scene.areas?.built?.frost;
    if (fb?.snow && !fb._fxSnow) { fb._fxSnow = true; fb.snow.stop?.(); fb.snow.setVisible(false); } // weather.js owns snowfall now
    this.pool.update(dt, this.view);
    if (this._iris) this.updateIris(dt);
    this.autoQuality(dt);
  }

  autoQuality(dt) {
    if (settings.explicit || settings.quality === 'low' || this._age < 6) return;
    this._fpsT += dt;
    if (this._fpsT < 1) return;
    this._fpsT = 0;
    const fps = this.scene.game.loop.actualFps;
    if (fps < 34) this._lowT += 1; else this._lowT = Math.max(0, this._lowT - 1);
    if (this._lowT >= 6) {
      this._lowT = 0;
      const next = settings.quality === 'high' ? 'med' : 'low';
      settings.setQuality(next, false); // session-only: the player's stored choice is untouched
    }
  }

  // ---- iris transitions (used by OverlayScene.fade) ----
  ensureIris() {
    if (this._irisObjs) return this._irisObjs;
    const sc = this.scene;
    const rects = [0, 1, 2, 3].map(() => sc.add.rectangle(0, 0, 4, 4, 0x000000, 1).setOrigin(0).setDepth(3010).setVisible(false));
    const img = sc.add.image(0, 0, 'fx.iris').setDepth(3010).setVisible(false);
    this._irisObjs = { rects, img };
    return this._irisObjs;
  }
  irisClose(ms = 300) { this._iris = { t: 0, dur: ms / 1000, dir: 1, hold: 0 }; this.ensureIris(); this.updateIris(0); }
  irisOpen(ms = 340) { if (!this._iris && !this._irisHeld) return; this._iris = { t: 0, dur: ms / 1000, dir: -1, hold: 0 }; }
  updateIris(dt) {
    const I = this._iris, { rects, img } = this.ensureIris(), v = this.view, p = this.scene.player;
    I.t += dt;
    let k = Math.min(1, I.t / I.dur);
    k = k * k * (3 - 2 * k);
    const rMax = Math.hypot(v.width, v.height) * 0.56 + 12;
    const r = I.dir > 0 ? rMax * (1 - k) : rMax * k;
    this._irisHeld = I.dir > 0 && k >= 1;
    if (I.dir > 0 && k >= 1) { I.hold += dt; if (I.hold > 4) this.irisOpen(300); } // failsafe: never stay black
    if (I.dir < 0 && k >= 1) { for (const o of rects) o.setVisible(false); img.setVisible(false); this._iris = null; return; }
    const x0 = Math.floor(v.x) - 8, y0 = Math.floor(v.y) - 8, w = Math.ceil(v.width) + 16, h = Math.ceil(v.height) + 16;
    const cx = Phaser.Math.Clamp(p ? p.x : v.centerX, v.x, v.right), cy = Phaser.Math.Clamp(p ? p.y - 10 : v.centerY, v.y, v.bottom);
    if (r < 1) { // fully closed
      img.setVisible(false);
      rects[0].setVisible(true).setPosition(x0, y0).setSize(w, h);
      for (let i = 1; i < 4; i++) rects[i].setVisible(false);
      return;
    }
    const s = r / 64, half = 128 * s;
    img.setVisible(true).setPosition(cx, cy).setScale(s);
    const L = cx - half, R = cx + half, Tp = cy - half, B = cy + half;
    const place = (o, x, y, ww, hh) => { if (ww > 0 && hh > 0) o.setVisible(true).setPosition(x, y).setSize(ww, hh); else o.setVisible(false); };
    place(rects[0], x0, y0, w, Tp - y0);
    place(rects[1], x0, B, w, y0 + h - B);
    place(rects[2], x0, Math.max(y0, Tp), L - x0, Math.min(B, y0 + h) - Math.max(y0, Tp));
    place(rects[3], R, Math.max(y0, Tp), x0 + w - R, Math.min(B, y0 + h) - Math.max(y0, Tp));
  }

  debug() {
    return {
      quality: settings.quality, region: { ...this.region }, weather: this.weather.state, forced: this.weather.forced,
      lvl: { ...this.weather.lvl }, t: this.daynight.t, night: this.daynight.nightA, lamp: this.daynight.lamp,
      particles: this.pool.live.length, cap: this.pool.cap, lights: this.lighting.srcs.length, windows: this.lighting.wins.length,
      trees: this.foliage.trees.length, chimneys: this.ambient.chimneys.length, rtVisible: this.lighting.rt.visible, wind: this.wind,
    };
  }
}

void QUALITY;
