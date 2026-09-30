// Camera culling for the world scene.
// Phaser 3.90 submits EVERY visible top-level game object each frame (only tilemaps are culled), which is
// ~1100 objects in town with ~150 on screen. This patches GameObject.willRender so world-camera rendering skips
// top-level objects (and whole containers: NPC + label + shadow, props, nodes) that are far outside the view.
//  - Conservative: generous margin + the object's own display size; only plain, scroll-locked world objects.
//  - Opt out per object with `obj.__nocull = true`; globally with ?cull=0 or window.__perf.cull(false).
//  - Logic, tweens, animations and physics are untouched (only rendering is skipped).
import Phaser from 'phaser';

const GO = Phaser.GameObjects.GameObject;
const CULLABLE = new Set(['Image', 'Sprite', 'Container', 'Text', 'BitmapText', 'Rectangle', 'Arc', 'Ellipse', 'TileSprite']);
const MARGIN = 112; // world px beyond the view edge (labels / shadows / tall sprites stay inside this)
export const cullStats = { enabled: true, culled: 0, tested: 0 };
let installed = false;

// Local-space half extents of a container's contents (recursive, cached by child count). Containers have no
// intrinsic size, and some (ground layers, area decor) hold children spread across the whole map.
function extent(c, depth = 0) {
  const n = c.list.length;
  if (c.__cullN === n && c.__cullEx) return c.__cullEx;
  let ex = 0, ey = 0;
  for (let i = 0; i < n; i++) {
    const o = c.list[i];
    let hw = (o.displayWidth || 0) * 0.5, hh = (o.displayHeight || 0) * 0.5;
    if (o.type === 'Container' && depth < 4) { const e = extent(o, depth + 1); hw = e[0] * Math.abs(o.scaleX || 1); hh = e[1] * Math.abs(o.scaleY || 1); }
    else if (o.type === 'Graphics' || o.type === 'ParticleEmitter' || o.type === 'Layer') { hw = hh = 1e5; } // unknown extent: never cull
    const ox = o.originX !== undefined ? Math.abs((0.5 - o.originX) * (o.displayWidth || 0)) : 0;
    const oy = o.originY !== undefined ? Math.abs((0.5 - o.originY) * (o.displayHeight || 0)) : 0;
    ex = Math.max(ex, Math.abs(o.x || 0) + hw + ox); ey = Math.max(ey, Math.abs(o.y || 0) + hh + oy);
  }
  c.__cullN = n; c.__cullEx = [ex, ey];
  return c.__cullEx;
}

export function installCull() {
  if (installed) return;
  installed = true;
  const orig = GO.prototype.willRender;
  GO.prototype.willRender = function (camera) {
    if (!orig.call(this, camera)) return false;
    if (!cullStats.enabled || this.__nocull || this.parentContainer || this.scrollFactorX !== 1 || this.scrollFactorY !== 1) return true;
    // only the world scene's camera (HUD scenes never cull)
    let ok = camera.__cullOK;
    if (ok === undefined) ok = camera.__cullOK = camera.scene?.sys?.settings?.key === 'world';
    if (!ok || !CULLABLE.has(this.type)) return true;
    cullStats.tested++;
    const v = camera.worldView;
    let hw = (this.displayWidth || 0) * 0.5, hh = (this.displayHeight || 0) * 0.5;
    if (this.type === 'Container') { const e = extent(this); hw = e[0] * Math.abs(this.scaleX || 1); hh = e[1] * Math.abs(this.scaleY || 1); }
    const ox = this.type !== 'Container' && this.originX !== undefined ? (0.5 - this.originX) * (this.displayWidth || 0) : 0;
    const oy = this.type !== 'Container' && this.originY !== undefined ? (0.5 - this.originY) * (this.displayHeight || 0) : 0;
    const cx = this.x + ox, cy = this.y + oy;
    if (cx + hw + MARGIN < v.x || cx - hw - MARGIN > v.right || cy + hh + MARGIN < v.y || cy - hh - MARGIN > v.bottom) {
      cullStats.culled++;
      return false;
    }
    return true;
  };
}
