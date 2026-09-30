import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { AREAS } from '../data/zones.js';

const T = CONFIG.tile;

// Ambient life: non-hostile, no physics bodies, no collision cost.
//  · fliers (butterflies by day, owls/bats/fireflies at night, parrots) are POOLED: a fixed
//    handful that live around the camera and are recycled to a fresh spot when they drift off-screen;
//  · ground critters (cats/dogs/pigs/chickens in Thistle Town + Dock Town) and crabs/fish/boats/flags/ripples are
//    placed once and only SIMULATED while on-screen (camera view + margin) and in the current space;
//    everything else is hidden.
// WorldScene: `scene.life = new AmbientLife(scene, areas, { spawn })` (from overworldFeatures) and
// `scene.life.update(time, delta)` each frame.
export class AmbientLife {
  constructor(scene, areas, info) {
    this.scene = scene; this.areas = areas; this.spawn = info.spawn;
    this.fliers = []; this.ground = []; this.decor = [];
    this.builtAreas = new Set();
    this.rnd = Math.random;
    this._makeFliers();
    this._makeTown(info.spawn);
  }

  get here() { return this.areas.current ? this.areas.current.id : null; }
  get night() { return !!this.scene.daynight?.isNight; }

  // ——— helpers ———
  _sprite(tex, x, y, frame = 0) {
    const s = this.scene.add.sprite(x, y, tex, frame).setOrigin(0.5, 1).setDepth(y);
    return s;
  }
  _free(x, y) { // not inside a solid body (houses, trees, walls)
    const p = this.scene.physics;
    return p.overlapRect(x - 5, y - 4, 10, 6, false, true).length === 0;
  }

  // ——— pooled fliers (overworld only) ———
  _makeFliers() {
    const s = this.scene;
    const mk = (tex, kind, n, opt) => {
      for (let i = 0; i < n; i++) {
        if (!s.textures.exists(tex)) return;
        const sp = this._sprite(tex, -999, -999).setVisible(false);
        if (kind === 'butterfly') sp.setScale(0.7);
        this.fliers.push({ sp, kind, tex, a: Math.random() * 6.28, ph: Math.random() * 10, spd: 14 + Math.random() * 10, ...opt });
      }
    };
    mk('mon.Butterfly', 'butterfly', 4, { day: true, alt: 'mon.Butterfly' });
    mk('mon.ButterflyBlue', 'butterfly', 3, { day: true, alt: 'mon.ButterflyBlue' });
    mk('mon.Owl', 'owl', 1, { night: true, spd: 12 });
    mk('mon.Owl2', 'owl', 2, { night: true, spd: 12 });
    mk('mon.BlueBat', 'bat', 4, { night: true, spd: 26 });
    mk('animal.parrotBlue', 'bird', 1, { day: true, spd: 34, side: true });
    mk('animal.parrotRed', 'bird', 1, { day: true, spd: 34, side: true });
    // fireflies: tiny glowing dots after dark (no texture needed)
    if (!s.textures.exists('px.firefly')) {
      const g = s.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xfff3a0, 0.35).fillCircle(3, 3, 3).fillStyle(0xfffbd0, 1).fillCircle(3, 3, 1.4);
      g.generateTexture('px.firefly', 6, 6); g.destroy();
    }
    for (let i = 0; i < 12; i++) {
      const sp = s.add.image(-999, -999, 'px.firefly').setDepth(2400).setVisible(false).setBlendMode(Phaser.BlendModes.ADD);
      this.fliers.push({ sp, kind: 'firefly', night: true, a: Math.random() * 6.28, ph: Math.random() * 10, spd: 7 + Math.random() * 4 });
    }
  }
  _respawn(f, v) {
    const m = 30;
    f.sp.x = v.x + Math.random() * v.width; f.sp.y = v.y + Math.random() * v.height;
    if (f.kind === 'bird' || f.kind === 'bat') { // enter from a side edge
      const left = Math.random() < 0.5;
      f.sp.x = left ? v.x - m : v.right + m; f.a = left ? 0 : Math.PI;
      f.sp.y = v.y + Math.random() * v.height;
    }
    f.life = 0;
  }
  _updateFliers(dt, time) {
    const s = this.scene, cam = s.cameras.main;
    const v = cam.worldView;
    const out = new Phaser.Geom.Rectangle(v.x - 60, v.y - 60, v.width + 120, v.height + 120);
    const active = this.here === null;
    const night = this.night;
    for (const f of this.fliers) {
      const on = active && ((f.night && night) || (f.day && !night));
      if (!on) { if (f.sp.visible) f.sp.setVisible(false); f.placed = false; continue; }
      if (!f.placed || !Phaser.Geom.Rectangle.Contains(out, f.sp.x, f.sp.y)) { this._respawn(f, v); f.placed = true; f.sp.setVisible(true); }
      f.ph += dt;
      // heading wobble
      f.a += Math.sin(f.ph * (f.kind === 'butterfly' ? 3 : 1.2) + f.spd) * dt * (f.kind === 'butterfly' || f.kind === 'firefly' ? 4 : 0.6);
      let sp = f.spd;
      if (f.kind === 'bird') f.a = Math.cos(f.a) >= 0 ? 0 : Math.PI;
      const vx = Math.cos(f.a) * sp, vy = Math.sin(f.a) * sp * (f.kind === 'bird' ? 0.15 : 1);
      f.sp.x += vx * dt; f.sp.y += vy * dt;
      if (f.kind === 'firefly') { f.sp.setAlpha(0.35 + 0.65 * Math.abs(Math.sin(f.ph * 2.2 + f.spd))); continue; }
      if (f.side) {
        f.sp.setFlipX(vx > 0);
        if (f.sp.anims.currentAnim?.key !== `${f.tex}.walk`) f.sp.play(`${f.tex}.walk`);
      } else {
        const dir = Math.abs(vx) > Math.abs(vy) ? (vx > 0 ? 'right' : 'left') : (vy > 0 ? 'down' : 'up');
        const key = `${f.tex}.move.${dir}`;
        if (s.anims.exists(key) && f.sp.anims.currentAnim?.key !== key) f.sp.play(key, true);
      }
      // flyers render above ground props
      f.sp.setDepth(f.kind === 'butterfly' ? f.sp.y + 40 : 2300);
    }
  }

  // ——— ground critters ———
  _addGround(tex, x, y, o = {}) {
    if (!this.scene.textures.exists(tex)) return null;
    const sp = this._sprite(tex, x, y);
    const c = { sp, tex, area: o.area ?? null, home: { x, y }, r: o.r ?? 34, spd: o.spd ?? 15, wait: Math.random() * 3, tx: null, ty: null, mode: o.mode || 'walk', scale: o.scale, flipDefault: o.flip ?? false, tint: o.tint, sway: 0 };
    if (o.tint) sp.setTint(o.tint);
    if (o.scale) sp.setScale(o.scale);
    sp.setFrame(0);
    this.ground.push(c);
    return c;
  }
  _updateGround(dt, time) {
    const v = this.scene.cameras.main.worldView;
    const here = this.here;
    for (const c of this.ground) {
      const sp = c.sp;
      const vis = c.area === here && sp.x > v.x - 40 && sp.x < v.right + 40 && sp.y > v.y - 40 && sp.y < v.bottom + 60;
      if (!vis) { if (sp.visible) { sp.setVisible(false); sp.anims.stop(); } continue; }
      if (!sp.visible) sp.setVisible(true);
      if (c.mode === 'crab') { this._crab(c, dt, time); continue; }
      if (c.mode === 'fish') { this._fish(c, dt, time); continue; }
      const sleeping = this.night && (c.tex.includes('cat') || c.tex.includes('dog'));
      if (c.wait > 0 || sleeping) {
        c.wait -= dt; sp.anims.stop(); sp.setFrame(1);
        if (sleeping) sp.setAlpha(0.9);
        continue;
      }
      sp.setAlpha(1);
      if (c.tx === null) {
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * 6.28, d = 10 + Math.random() * c.r;
          const tx = c.home.x + Math.cos(a) * d, ty = c.home.y + Math.sin(a) * d;
          if (this._free(tx, ty)) { c.tx = tx; c.ty = ty; break; }
        }
        if (c.tx === null) { c.wait = 2; continue; }
        c.t = 0;
      }
      const dx = c.tx - sp.x, dy = c.ty - sp.y, d = Math.hypot(dx, dy);
      c.t += dt;
      if (d < 2 || c.t > 5) { c.tx = null; c.wait = 1.5 + Math.random() * 4; continue; }
      sp.x += (dx / d) * c.spd * dt; sp.y += (dy / d) * c.spd * dt;
      sp.setFlipX(c.flipDefault ? dx < 0 : dx > 0);
      sp.setDepth(sp.y);
      if (sp.anims.currentAnim?.key !== `${c.tex}.walk` || !sp.anims.isPlaying) sp.play(`${c.tex}.walk`, true);
    }
  }
  _crab(c, dt, time) {
    const sp = c.sp;
    if (c.wait > 0) { c.wait -= dt; sp.anims.stop(); return; }
    if (c.tx === null) {
      const a = Math.random() < 0.5 ? 0 : Math.PI, d = 10 + Math.random() * c.r;
      c.tx = c.home.x + Math.cos(a) * d + (Math.random() - 0.5) * 10; c.ty = c.home.y + (Math.random() - 0.5) * 16; c.t = 0;
    }
    const dx = c.tx - sp.x, dy = c.ty - sp.y, d = Math.hypot(dx, dy);
    c.t += dt;
    if (d < 2 || c.t > 4) { c.tx = null; c.wait = 0.6 + Math.random() * 2.5; return; }
    sp.x += (dx / d) * 26 * dt; sp.y += (dy / d) * 10 * dt; sp.setDepth(sp.y);
    const key = `mon.YellowsBat.move.${dx > 0 ? 'right' : 'left'}`;
    if (sp.anims.currentAnim?.key !== key || !sp.anims.isPlaying) sp.play(key, true);
  }
  _fish(c, dt, time) {
    const sp = c.sp, r = c.rect;
    if (c.tx === null) {
      c.tx = r.x + 8 + Math.random() * (r.width - 16); c.ty = r.y + 8 + Math.random() * (r.height - 16); c.t = 0;
    }
    const dx = c.tx - sp.x, dy = c.ty - sp.y, d = Math.hypot(dx, dy);
    c.t += dt;
    if (d < 3 || c.t > 9) { c.tx = null; return; }
    sp.x += (dx / d) * c.spd * dt; sp.y += (dy / d) * c.spd * dt * 0.6;
    sp.setDepth(-5 + sp.y * 0.0001); // just above water tiles, below piers and boats
    const key = `${c.tex}.move.${dx > 0 ? 'right' : 'left'}`;
    if (sp.anims.currentAnim?.key !== key || !sp.anims.isPlaying) sp.play(key, true);
    sp.setAlpha(0.85);
  }

  // ——— Thistle Town (overworld) ———
  _makeTown(sp0) {
    const at = (dx, dy) => ({ x: sp0.x + dx, y: sp0.y + dy });
    const add = (tex, dx, dy, o) => { const p = at(dx, dy); return this._addGround(tex, p.x, p.y, o); };
    add('animal.cat', -132, 62, { r: 30 }); add('animal.catBlack', 158, -72, { r: 26 }); add('animal.catWhite', 14, -54, { r: 24 });
    add('animal.dog', -54, 132, { r: 46, spd: 22 }); add('animal.dogYellow', 112, 112, { r: 44, spd: 22 }); add('animal.dogWhite', -190, -44, { r: 36, spd: 20 });
    add('animal.pig', -176, 104, { r: 28 }); add('animal.pig', 186, 64, { r: 26 }); add('animal.pigBlack', 160, 150, { r: 26 });
    for (const [dx, dy] of [[-148, 120], [-136, 136], [-160, 132], [140, -100], [152, -114], [-30, -112]]) add(Math.random() < 0.5 ? 'animal.chicken' : 'animal.chickenBrown', dx, dy, { r: 22, spd: 12 });
    add('animal.hamster', 86, -28, { r: 14, spd: 18 }); add('animal.cow', -210, 130, { r: 18, spd: 8 }); add('animal.donkey', 210, 120, { r: 16, spd: 8 });
    // flags on the plaza poles
    const pole = (dx, dy, color) => {
      const p = at(dx, dy);
      const g = this.scene.add.rectangle(p.x, p.y - 12, 2, 28, 0x5a3a1e).setDepth(p.y);
      const f = this.scene.add.sprite(p.x + 9, p.y - 22, `env.flag.${color}`).setDepth(p.y + 1);
      if (this.scene.anims.exists(`env.flag.${color}`)) f.play({ key: `env.flag.${color}`, startFrame: Math.floor(Math.random() * 4) });
      this.decor.push(g, f);
    };
    pole(-64, 4, 'Red'); pole(64, 4, 'Blue'); pole(-140, -80, 'Green'); pole(140, -82, 'Yellow'); pole(0, 150, 'White');
  }

  // ——— areas built lazily (Dock Town, Frostpeak) ———
  buildArea(id, ctx) {
    if (this.builtAreas.has(id)) return;
    this.builtAreas.add(id);
    const s = this.scene, o = AREAS[id].origin;
    const px = (tx, ty) => ({ x: o.x + tx * T, y: o.y + ty * T });
    if (id === 'dock') {
      // boats bobbing in the slips (Backgrounds/Vehicles) + animated water ripples
      const slips = [[13.5, 35.2, 'veh.boat', true], [25.5, 34.2, 'veh.boat', false], [44, 33.5, 'veh.boat', true], [2.6, 34.6, 'veh.sail', false]];
      for (const [tx, ty, tex, sail] of slips) {
        if (!s.textures.exists(tex)) continue;
        const p = px(tx, ty);
        const boat = s.add.image(p.x, p.y, tex).setOrigin(0.5, 0.85).setDepth(p.y - 6);
        this.decor.push(boat);
        s.tweens.add({ targets: boat, y: p.y + 2, angle: { from: -1.5, to: 1.5 }, duration: 1500 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: Math.random() * 900 });
        if (sail && s.textures.exists('veh.sail')) {
          const mast = s.add.image(p.x, p.y - 14, 'veh.sail').setOrigin(0.5, 1).setDepth(p.y - 5).setScale(0.8);
          this.decor.push(mast);
          s.tweens.add({ targets: mast, y: p.y - 12, angle: { from: -1.5, to: 1.5 }, duration: 1500 + Math.random() * 700, yoyo: true, repeat: -1, ease: 'sine.inOut', delay: Math.random() * 900 });
        }
      }
      const waterRects = [[0, 28, 6, 12], [9, 28, 9, 12], [21, 28, 9, 12], [33, 28, 23, 12]];
      for (const [x, y, w, h] of waterRects) {
        for (let i = 0; i < Math.round(w * h / 18); i++) {
          const p = px(x + 0.5 + Math.random() * (w - 1), y + 0.5 + Math.random() * (h - 1));
          const r = s.add.sprite(p.x, p.y, 'env.ripple').setDepth(-9).setAlpha(0.3);
          if (s.anims.exists('env.ripple')) r.play({ key: 'env.ripple', startFrame: Math.floor(Math.random() * 4) });
          this.decor.push(r);
        }
        // fish under the surface
        const rect = new Phaser.Geom.Rectangle(o.x + x * T, o.y + y * T, w * T, h * T);
        for (let i = 0; i < Math.max(2, Math.round(w / 4)); i++) {
          const tex = Math.random() < 0.5 ? 'mon.Fish' : 'mon.FishRed';
          const p = px(x + 1 + Math.random() * (w - 2), y + 1 + Math.random() * (h - 2));
          const c = this._addGround(tex, p.x, p.y, { area: id, mode: 'fish', scale: 0.8 });
          if (c) { c.rect = rect; c.spd = 10 + Math.random() * 8; c.sp.setOrigin(0.5, 0.5); }
        }
      }
      // crabs on Driftwood Beach (harmless cousins of the hostile Shore Crab)
      for (let i = 0; i < 9; i++) {
        const p = px(40 + Math.random() * 14, 3 + Math.random() * 21);
        const c = this._addGround('mon.YellowsBat', p.x, p.y, { area: id, mode: 'crab', r: 22, scale: 0.6, tint: 0xff9a7a });
        if (c) c.sp.setOrigin(0.5, 1);
      }
      // harbour animals
      for (const [a, tx, ty] of [['animal.cat', 12, 12], ['animal.dogYellow', 22, 17], ['animal.catBlack', 30, 13], ['animal.chicken', 27, 10], ['animal.chickenBrown', 28.5, 10.8], ['animal.pig', 8, 20]]) {
        const p = px(tx, ty); this._addGround(a, p.x, p.y, { area: id, r: 30 });
      }
      for (const [tx, ty, col] of [[17, 27.6, 'Red'], [29, 27.6, 'Blue'], [5, 27.6, 'Yellow']]) {
        const p = px(tx, ty);
        this.decor.push(s.add.rectangle(p.x, p.y - 12, 2, 28, 0x5a3a1e).setDepth(p.y), s.add.sprite(p.x + 9, p.y - 22, `env.flag.${col}`).setDepth(p.y + 1).play({ key: `env.flag.${col}`, startFrame: Math.floor(Math.random() * 4) }));
      }
    }
    if (id === 'frost') {
      for (const [a, tx, ty] of [['animal.dogWhite', 6, 36], ['animal.catWhite', 11, 32], ['animal.hamster', 14, 35]]) {
        const p = px(tx, ty); this._addGround(a, p.x, p.y, { area: id, r: 20 });
      }
      for (const [tx, ty, col] of [[3, 33, 'Blue'], [16.5, 32, 'White']]) {
        const p = px(tx, ty);
        this.decor.push(s.add.rectangle(p.x, p.y - 12, 2, 28, 0x5a3a1e).setDepth(p.y), s.add.sprite(p.x + 9, p.y - 22, `env.flag.${col}`).setDepth(p.y + 1).play({ key: `env.flag.${col}`, startFrame: Math.floor(Math.random() * 4) }));
      }
    }
  }

  update(time, delta) {
    const dt = Math.min(0.05, delta / 1000);
    this._updateFliers(dt, time);
    this._updateGround(dt, time);
  }
}
