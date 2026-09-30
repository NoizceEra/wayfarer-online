import { settings } from './fxSettings.js';
import { sunAt } from './daynight.js';

// Tree / bush wind sway (shader-free: a tiny rotation of the crown sprite, only for
// trees inside the camera view) and time-of-day shadow casting for tree shadows
// (long, pointing away from the sun at dawn / dusk, short and faint at noon, gone at
// night or under heavy cloud).

export class Foliage {
  constructor(scene, fx) {
    this.scene = scene; this.fx = fx;
    this.trees = [];
    this._scanned = -1;
    this.scan();
  }

  scan() {
    let built = 0; if (this.scene.areas) for (const k in this.scene.areas.built) built++;
    if (built === this._scanned) return;
    this._scanned = built;
    for (const c of this.scene.children.list) {
      if (c.type !== 'Container' || !c.list || c.getData?.('fxTree')) continue;
      if (!c.getData('tree')) continue;
      let im = null, sh = null, gr = null;
      for (const o of c.list) {
        const k = o.texture?.key;
        if (k === 'char.shadow') sh = o;
        else if (k && k.startsWith('tree.')) im = o;
        else if (o.type === 'Graphics') gr = o;
      }
      im = im || gr; // image trees sway their crown sprite, procedural trees their Graphics
      if (!im) continue;
      c.setData('fxTree', 1);
      this.trees.push({
        c, im, sh, x: c.x, y: c.y, ph: (c.x * 0.013 + c.y * 0.007) % 6.283,
        sx0: sh ? sh.scaleX : 1, sy0: sh ? sh.scaleY : 1, sa0: sh ? sh.alpha : 1, big: im.texture?.key === 'tree.big',
      });
    }
  }

  update(time) {
    this.scan();
    const fx = this.fx, v = fx.view;
    const sun = sunAt(fx.daynight.t);
    const L = fx.weather?.lvl;
    const cloud = L ? Math.min(1, L.dark * 1.3 + L.fog * 0.3) : 0;
    const len = 1 + Math.pow(1 - sun.elev, 1.6) * 2.6;
    const off = -sun.dir * len * 6.5;
    const shA = Math.min(1, sun.elev * 2.6) * (1 - cloud * 0.75) * (1 - fx.daynight.indoor);
    const k = time * 0.001, wd = fx.wind;
    const sway = settings.q.sway;
    const x0 = v.x - 40, x1 = v.right + 40, y0 = v.y - 40, y1 = v.bottom + 90;
    const speed = 0.9 + wd * 1.8, amp = (0.018 + 0.05 * wd);
    for (const t of this.trees) {
      if (t.x < x0 || t.x > x1 || t.y < y0 || t.y > y1) continue;
      if (sway) t.im.rotation = (Math.sin(k * speed + t.ph) + 0.35 * Math.sin(k * speed * 2.3 + t.ph * 1.7)) * amp * (t.big ? 0.75 : 1);
      else if (t.im.rotation) t.im.rotation = 0;
      const sh = t.sh;
      if (sh) {
        sh.x = off * (t.big ? 1.3 : 1);
        sh.setScale(t.sx0 * (0.85 + 0.3 * len), t.sy0 * 0.92);
        sh.alpha = t.sa0 * shA;
      }
    }
  }
}
