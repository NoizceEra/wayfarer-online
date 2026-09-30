import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { AREAS } from '../data/zones.js';
import { settings } from './fxSettings.js';

// Real dynamic lighting at night.
//  - a camera-sized RenderTexture ("darkness") is filled with deep blue and soft holes
//    are ERASEd with the shared light_soft texture (fx.glow) around the player lantern,
//    torches, campfires, waystones, lamps, house/inn windows and the lighthouse beam;
//  - the existing additive glow sprites (props register them with fx.glow) are discovered
//    by scanning the display list, taken over (their own alpha tweens are replaced by a
//    night-dependent flicker) and given a hot "bloom" core on high quality;
//  - windows of houses get a warm pane that switches on at dusk.
// The RT is 1 texel per world pixel (the camera zoom upscales it), so a full-screen
// darkness pass costs ~a dozen draw calls. In daylight nothing is rendered at all.

const FIRE_TINTS = new Set([0xffa050, 0xffb060, 0xffa040]);
const tmpM = new Phaser.GameObjects.Components.TransformMatrix();
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function genTextures(scene) {
  if (!scene.textures.exists('fx.win')) {
    const tex = scene.textures.createCanvas('fx.win', 24, 24), c = tex.getContext();
    const g = c.createRadialGradient(12, 12, 1, 12, 12, 12);
    g.addColorStop(0, 'rgba(255,236,170,0.9)'); g.addColorStop(0.45, 'rgba(255,200,110,0.35)'); g.addColorStop(1, 'rgba(255,170,80,0)');
    c.fillStyle = g; c.fillRect(0, 0, 24, 24);
    c.fillStyle = 'rgba(255,240,180,0.95)'; c.fillRect(7, 7, 10, 10);
    c.fillStyle = 'rgba(120,70,20,0.55)'; c.fillRect(11.5, 7, 1, 10); c.fillRect(7, 11.5, 10, 1);
    tex.refresh();
  }
  if (!scene.textures.exists('fx.beam')) {
    const tex = scene.textures.createCanvas('fx.beam', 128, 48), c = tex.getContext();
    const g = c.createLinearGradient(0, 0, 128, 0);
    g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.beginPath(); c.moveTo(0, 22); c.lineTo(128, 0); c.lineTo(128, 48); c.lineTo(0, 26); c.closePath(); c.fill();
    const m = c.createLinearGradient(0, 0, 0, 48); // soften the edges
    c.globalCompositeOperation = 'destination-in';
    m.addColorStop(0, 'rgba(255,255,255,0)'); m.addColorStop(0.5, 'rgba(255,255,255,1)'); m.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = m; c.fillRect(0, 0, 128, 48);
    tex.refresh();
  }
}

function lightTex(scene, key, r, g, b) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, 128, 128), c = tex.getContext();
  const gr = c.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`); gr.addColorStop(0.18, `rgba(${r},${g},${b},0.72)`);
  gr.addColorStop(0.45, `rgba(${r},${g},${b},0.3)`); gr.addColorStop(0.75, `rgba(${r},${g},${b},0.07)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  c.fillStyle = gr; c.fillRect(0, 0, 128, 128); tex.refresh();
}
const LIGHTS = { warm: [215, 172, 112], fire: [228, 142, 72], cool: [90, 172, 218], pale: [200, 190, 160] };
const RS = 0.62; // light radii are authored for glow sprites; the light map wants them tighter at our zoom

export class Lighting {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    genTextures(scene);
    for (const [k, c] of Object.entries(LIGHTS)) lightTex(scene, 'fx.l.' + k, c[0], c[1], c[2]);
    const cam = scene.cameras.main;
    // light map: dark blue base + additive coloured lights, MULTIPLYed over the scene
    // (same result on WebGL and the canvas fallback; no ERASE blend needed)
    this.rt = this.makeRT(64, 64);
    this.hole = scene.make.image({ x: 0, y: 0, key: 'fx.l.warm', add: false }).setBlendMode(Phaser.BlendModes.ADD);
    this.beamErase = scene.make.image({ x: 0, y: 0, key: 'fx.beam', add: false }).setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD);
    this.srcs = [];          // tracked glow-based lights
    this.wins = [];          // window lights {x,y,img}
    this.beacons = [];       // lighthouse beams
    this._scannedAreas = -1;
    this._acc = 0;
    this._rtSize = '';
    void cam;
    this.managed = [
      { x0: 0, y0: 0, x1: CONFIG.worldCols * CONFIG.tile, y1: CONFIG.worldRows * CONFIG.tile },
      ...Object.values(AREAS).filter((a) => a.kind === 'town' || a.kind === 'outdoor').map((a) => ({
        x0: a.origin.x, y0: a.origin.y, x1: a.origin.x + a.size.w * CONFIG.tile, y1: a.origin.y + a.size.h * CONFIG.tile,
      })),
    ];
    this.scan();
  }

  // (WebGL RenderTextures draw into the wrong region after resize() in Phaser 3.90, so a size
  // change recreates the texture instead; that only happens on zoom / window changes.)
  makeRT(w, h) {
    return this.scene.add.renderTexture(0, 0, w, h).setOrigin(0).setDepth(2340).setBlendMode(Phaser.BlendModes.MULTIPLY).setVisible(false);
  }

  inManaged(x, y) { return this.managed.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1); }

  addHouseWindows(windows) {
    for (const r of windows || []) {
      const c = r.parentContainer; if (!c) continue;
      const pts = [];
      if (r.getData('inn')) { // Sleepy Lantern Inn (w 104, h 38)
        const hw = 52, h = 38;
        pts.push([-hw + 15, -15.5], [hw - 15, -15.5], [-hw - 8.5, -9.5], [0, -h - 8.5], [-36, -24.5], [-16, -24.5], [18, -24.5], [38, -24.5]);
      } else {
        const hw = r.x + 10, h = 9 - r.y;
        pts.push([-hw + 9, -h + 10], [hw - 10, -h + 10]);
      }
      for (const [lx, ly] of pts) {
        const img = scene_add(this.scene, c, lx, ly);
        this.wins.push({ x: c.x + lx, y: c.y + ly, img, ph: Math.random() * 6.28, on: 0, inn: !!r.getData('inn') });
      }
    }
  }

  // Discover glow sprites (fx.glow + ADD) created by props / builders.
  scan() {
    const sc = this.scene;
    let built = 0; if (sc.areas) for (const k in sc.areas.built) built++;
    if (built === this._scannedAreas) return;
    this._scannedAreas = built;
    for (const o of sc.children.list) {
      if (o.type !== 'Image' || o.texture?.key !== 'fx.glow' || o.blendMode !== Phaser.BlendModes.ADD || o.getData('fxL')) continue;
      let x = o.x, y = o.y;
      if (o.parentContainer) { o.getWorldTransformMatrix(tmpM); x = tmpM.tx; y = tmpM.ty; }
      if (!this.inManaged(x, y)) continue;
      o.setData('fxL', 1);
      const sc0 = o.scaleX, tint = o.isTinted ? o.tintTopLeft : 0xffffff;
      let kind = 'lamp';
      if (sc0 < 0.3 && tint === 0xd8ff7a) kind = 'fly';
      else if (sc0 >= 2.2) kind = 'beacon';
      else if (tint === 0x66ddff) kind = 'magic';
      else if (FIRE_TINTS.has(tint) || (tint === 0xffffff && !o.parentContainer && o.depth >= 2850)) kind = 'fire';
      if (tint === 0xffffff && kind !== 'beacon') o.setTint(kind === 'fire' ? 0xffb070 : 0xffd890);
      // replace the prop's own alpha yoyo tween (x/y wander tweens of fireflies stay)
      for (const tw of sc.tweens.getTweensOf(o)) if (tw.data?.some((d) => d.key === 'alpha')) tw.remove();
      const s = { o, x, y, kind, base: Math.max(0.25, o.alpha), ph: Math.random() * 6.28, sc0, tint, core: null };
      s.r = kind === 'fly' ? 0 : Math.min(150, 64 * sc0 * (kind === 'lamp' ? 1.55 : 1.75));
      this.srcs.push(s);
      if (kind === 'beacon') this.addBeacon(s);
    }
  }

  addBeacon(s) {
    const img = this.scene.add.image(s.x, s.y, 'fx.beam').setOrigin(0, 0.5).setBlendMode(Phaser.BlendModes.ADD).setTint(0xffeeb0).setDepth(2420).setAlpha(0).setVisible(false);
    img.setScale(2.6, 1.6);
    this.beacons.push({ img, x: s.x, y: s.y, s });
    s.o.setScale(1.3); s.r = 70; // tame the huge lamp halo; the beam carries the reach
  }

  get darkness() { return this.fx.daynight.nightA; }

  update(time, dt) {
    const q = settings.q;
    const dn = this.fx.daynight;
    const lamp = dn.lamp * (1 - dn.indoor);
    const night = dn.nightA * (1 - dn.indoor);
    this.scan();
    const cam = this.scene.cameras.main, v = cam.worldView, p = this.scene.player;
    const wet = this.fx.weather?.lvl?.dark || 0;

    // ---- glow sprites: night-dependent flicker ----
    for (const s of this.srcs) {
      const o = s.o;
      if (!o.active) continue;
      let a;
      if (s.kind === 'fly') a = s.base * (0.35 + 0.65 * Math.sin(time / 420 + s.ph) ** 2) * night * (1 - wet * 0.8) * 3;
      else if (s.kind === 'fire') { const f = 1 + Math.sin(time / 130 + s.ph) * 0.12 + Math.sin(time / 57 + s.ph * 2) * 0.08; a = s.base * (0.22 + 0.78 * lamp) * f; o.setScale(s.sc0 * (0.94 + 0.06 * f)); }
      else if (s.kind === 'magic') a = s.base * (0.55 + 0.45 * Math.sin(time / 500 + s.ph) * 0.5 + 0.22 * lamp);
      else a = s.base * lamp * (1 + Math.sin(time / 900 + s.ph) * 0.04);
      o.setAlpha(a).setVisible(a > 0.01);
      if (q.bloom && s.kind !== 'fly' && s.kind !== 'magic') {
        if (!s.core) s.core = this.scene.add.image(s.x, s.y, 'fx.glow').setBlendMode(Phaser.BlendModes.ADD).setTint(s.kind === 'fire' ? 0xffe0a0 : 0xfff0c8).setDepth(o.depth + 1).setScale(s.sc0 * 0.28);
        s.core.setAlpha(a * 0.75).setVisible(a > 0.01);
        if (o.parentContainer) { o.getWorldTransformMatrix(tmpM); s.core.setPosition(tmpM.tx, tmpM.ty); } else s.core.setPosition(o.x, o.y);
      } else if (s.core) { s.core.destroy(); s.core = null; }
    }
    // ---- windows ----
    for (const w of this.wins) {
      const on = Math.min(1, lamp * 1.25);
      const a = on * (0.85 + Math.sin(time / 1400 + w.ph) * 0.06);
      w.img.setAlpha(a).setVisible(a > 0.02);
    }
    // ---- lighthouse beams ----
    for (const b of this.beacons) {
      const a = lamp * 0.3;
      b.img.setAlpha(a).setVisible(a > 0.01).setRotation(time * 0.0007 + 1);
    }

    // ---- darkness RT ----
    let rt = this.rt;
    if (!q.lighting || night < 0.015 || !p) {
      rt.setVisible(false);
      this._skip = true;
      return;
    }
    rt.setVisible(true);
    this._acc += dt;
    const step = 1 / (q.lightHz || 30);
    if (!this._skip && this._acc < step) return; // holes stay registered to the RT, which stays put between redraws
    this._acc = 0; this._skip = false;
    const mw = Math.ceil(v.width) + 32, mh = Math.ceil(v.height) + 32;
    if (rt.width !== mw || rt.height !== mh) { rt.destroy(); rt = this.rt = this.makeRT(mw, mh).setVisible(true); }
    const ox = Math.floor(v.x) - 16, oy = Math.floor(v.y) - 16;
    rt.setPosition(ox, oy);
    const nc = this.fx.daynight.nightColor; // deep blue base, eases in with night
    rt.fill(((nc[0] | 0) << 16) | ((nc[1] | 0) << 8) | (nc[2] | 0), 1);
    const hole = this.hole;
    const cap = q.lights;
    let used = 0;
    rt.beginDraw(); // one batched pass for every light
    const put = (o, x, y) => rt.batchDraw(o, x, y);
    const draw = (x, y, r, a = 1, tex = 'fx.l.warm') => {
      if (used >= cap) return;
      r *= RS;
      if (x + r < ox || x - r > ox + mw || y + r < oy || y - r > oy + mh) return;
      used++;
      if (hole.texture.key !== tex) hole.setTexture(tex);
      hole.setScale((r * 2) / 128).setAlpha(a);
      put(hole, x - ox, y - oy);
    };
    // player lantern
    const fl = 1 + Math.sin(time / 140) * 0.025 + Math.sin(time / 53) * 0.015;
    draw(p.x, p.y - 6, (76 + 30 * night) * fl, 1);
    draw(p.x, p.y - 6, 52 * fl, 0.6, 'fx.l.pale');
    // world lights
    for (const s of this.srcs) {
      if (s.kind === 'fly' || !s.o.active || !s.o.visible) continue;
      const a = Math.min(1, s.o.alpha * 1.9);
      const f = s.kind === 'fire' ? 1 + Math.sin(time / 130 + s.ph) * 0.05 : 1;
      draw(s.x, s.y, s.r * f, a, s.kind === 'magic' ? 'fx.l.cool' : s.kind === 'fire' ? 'fx.l.fire' : 'fx.l.warm');
    }
    for (const w of this.wins) {
      if (!w.img.visible) continue;
      draw(w.x, w.y + (w.inn ? 18 : 14), w.inn ? 44 : 32, Math.min(1, w.img.alpha * 0.9));
    }
    for (const b of this.beacons) {
      if (!b.img.visible) continue;
      const e = this.beamErase;
      if (e.texture.key !== 'fx.beam') e.setTexture('fx.beam');
      e.setPosition(b.x, b.y).setRotation(b.img.rotation).setScale(2.6, 1.6).setAlpha(Math.min(1, b.img.alpha * 3));
      put(e, b.x - ox, b.y - oy);
    }
    rt.endDraw();
  }

  destroy() { this.rt.destroy(); }
}

// add a window pane image into the house container
function scene_add(scene, c, lx, ly) {
  const img = scene.add.image(lx, ly, 'fx.win').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0).setVisible(false).setScale(1.1);
  c.add(img);
  return img;
}

void sstep;
