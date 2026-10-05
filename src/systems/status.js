import { STATUS } from '../data/combatMath.js';
import { CONFIG } from '../config.js';
import { settings } from '../core/settings.js';

// Timed status effects (poison / burn / bleed / slow / stun) for the hero and
// for enemies. Pure bookkeeping — the owner decides what a tick does.

// ── On-sprite status readout (WORLD presentation only) ───────────────────────
// A StatusSet is built bare by its owner (`new StatusSet()` in Enemy.js:50 and
// combat.js:31), so the set holds no back-reference to the enemy it belongs to.
// The readout therefore binds itself the first time a status lands: the owning
// enemy is located by identity (enemy.statuses === set) inside that scene's live
// `enemies` group, reached through the app's existing debug/testing handle
// (src/main.js:51 `window.__wayfarer`). If that handle is absent (headless runs,
// throwaway harnesses) the readout is a silent no-op and nothing else changes.
//
// It never mutates the enemy, its stats, or any status timer: it only reads the
// live StatusSet each frame and drives a small scene-level image pool. All readout
// state lives in module WeakMaps keyed by the StatusSet / scene, so NO new field
// is ever written to an enemy (or Scene) state object.
//
// Colours are copied verbatim from the established element palette so a world
// status reads the same hue as its skill VFX (no invented colours):
//   burn   0xff8a30  ELEMENT.fire     src/systems/skillVfx.js:14
//   poison 0x7fe06a  ELEMENT.nature   src/systems/skillVfx.js:14
//   slow   0x9fe0ff  ELEMENT.ice      src/systems/skillVfx.js:14
//   stun   0xffee55  ELEMENT.thunder  src/systems/skillVfx.js:14
//   shield 0x9945ff  Solana palette purple   src/ui/ArenaPanel.js:8
//            (no STATUS.shield exists yet — mapped now so a future ward reads right;
//             the established "Shielded" float text is 0xd0a0ff, combat.js:147)
const HUE = { burn: 0xff8a30, poison: 0x7fe06a, slow: 0x9fe0ff, stun: 0xffee55, shield: 0x9945ff };

const MOBILE = !!CONFIG.isMobile;                 // config.js:13 (coarse pointer / <620px)
const CAP = MOBILE ? 48 : 160;                    // pooled images per scene
const calm = () => !!settings.get('reduceMotion'); // settings.js:13 — no pulse when on

const OWNER = new WeakMap();   // StatusSet -> binding record | null (resolved non-enemy)
const SCENES = new WeakMap();  // Phaser.Scene -> { arr, free, made, on }
// Late-binding safety: a set that is transiently absent from every `enemies`
// group (e.g. applied a frame before its spawner adds the enemy) must NOT be
// poison-pilled to `null` on the first miss, or its readout dies forever. We
// retry on later applies and only give up after a bounded number of misses so
// a genuine non-enemy set cannot scan the scene graph endlessly.
const TRIES = new WeakMap();   // StatusSet -> miss count (enemy group present, owner not found)
const MAX_TRIES = 256;

function diamond(c, cx, cy, r) {
  c.beginPath(); c.moveTo(cx, cy - r); c.lineTo(cx + r, cy); c.lineTo(cx, cy + r); c.lineTo(cx - r, cy); c.closePath();
}
function ensureTex(scene) {
  if (!scene.textures.exists('wf.status.glyph')) {
    const t = scene.textures.createCanvas('wf.status.glyph', 9, 9);
    if (t) { const c = t.getContext(); c.clearRect(0, 0, 9, 9);
      c.fillStyle = '#000000'; diamond(c, 4.5, 4.5, 4.5); c.fill();  // dark rim
      c.fillStyle = '#ffffff'; diamond(c, 4.5, 4.2, 2.6); c.fill();  // tinted body
      t.refresh(); }
  }
  if (!scene.textures.exists('wf.status.halo')) {
    const t = scene.textures.createCanvas('wf.status.halo', 24, 24);
    if (t) { const c = t.getContext(); c.clearRect(0, 0, 24, 24); const g = c.createRadialGradient(12, 12, 0, 12, 12, 12);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.62, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.82, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 24, 24); t.refresh(); }
  }
}
function grab(scene, s, key) {
  let im = s.free.pop();
  if (!im) {
    if (s.made >= CAP) return null;
    im = scene.add.image(0, 0, key); s.made += 1;
  }
  return im.setTexture(key).setActive(true).setVisible(true).setAlpha(1).setScale(1).setAngle(0).clearTint().setBlendMode(0).setOrigin(0.5);
}
function give(s, im) { im.setVisible(false).setActive(false); s.free.push(im); }

function bindScene(scene, rec) {
  let s = SCENES.get(scene);
  if (!s) {
    s = { arr: [], free: [], made: 0, on: null };
    s.on = () => step(scene, s);
    scene.events.on('update', s.on);
    scene.events.once('shutdown', () => {
      scene.events.off('update', s.on);
      for (let i = 0; i < s.arr.length; i++) freeRec(s, s.arr[i]);
      s.arr.length = 0; SCENES.delete(scene);
    });
    SCENES.set(scene, s);
    ensureTex(scene);
  }
  if (!rec.linked) { s.arr.push(rec); rec.linked = true; }
  rec.dead = false;
}

// Module-level map callback + cursor: Map.forEach with a stable function keeps the
// per-frame status walk allocation-free (no closure / iterator / array per tick).
let CUR = null;
function eachStatus(st, id) {
  const r = CUR;
  if (r.now >= st.until) return;                    // expired this frame (tick prunes next)
  const e = r.ent;
  const col = HUE[id] != null ? HUE[id] : ((STATUS[id] && STATUS[id].color) || 0xffffff);
  if (r.col < 0) r.col = col;
  let it = r.items[r.n];
  if (!it) { it = grab(r.scene, r.pool, 'wf.status.glyph'); if (!it) return; r.items[r.n] = it; }
  const count = r.set.map.size || 1;
  const spread = MOBILE ? 5 : 6;
  const sc = (MOBILE ? 0.85 : 1) * (r.strong ? 1.45 : 1) * (e.vscale || 1);
  const headY = e.y + (e.hpBarY != null ? e.hpBarY : -18) - (r.strong ? 7 : 5);
  const a = r.calm ? 1 : 0.72 + 0.28 * Math.sin(r.now / 130 + r.n);
  it.setPosition(e.x - ((count - 1) * spread) / 2 + r.n * spread, headY)
    .setTint(col).setScale(sc).setAlpha(a).setDepth((e.depth || 10) + 46).setVisible(true);
  r.n += 1;
}

function drawRec(scene, s, r) {
  const e = r.ent;
  const now = scene.time.now;
  r.now = now; r.calm = calm(); r.strong = !!e.isBoss || !!(e.rank && e.rank.id && e.rank.id !== 'normal');
  r.n = 0; r.col = -1;
  CUR = r;
  r.set.map.forEach(eachStatus);
  CUR = null;
  const items = r.items;
  for (let i = r.n; i < items.length; i++) { const it = items[i]; if (it) it.setVisible(false); }
  // Boss / elite keep a pulsing tinted halo behind the sprite (stronger read than trash).
  if (r.strong && r.n > 0 && r.col >= 0) {
    if (!r.halo) r.halo = grab(scene, s, 'wf.status.halo');
    if (r.halo) {
      const sc = (MOBILE ? 1.1 : 1.4) * (e.isBoss ? 2.2 : 1.7) * (e.vscale || 1);
      const a = r.calm ? 0.5 : 0.38 + 0.22 * Math.sin(now / 190);
      r.halo.setPosition(e.x, e.y - 6).setTint(r.col).setScale(sc, sc * 0.72)
        .setBlendMode(1).setDepth((e.depth || 10) + 44).setAlpha(a).setVisible(true);
    }
  } else if (r.halo) r.halo.setVisible(false);
}

function hideRec(r) {
  for (let i = 0; i < r.items.length; i++) { const it = r.items[i]; if (it) it.setVisible(false); }
  if (r.halo) r.halo.setVisible(false);
  r.n = 0;
}
function freeRec(s, r) {
  for (let i = 0; i < r.items.length; i++) { const it = r.items[i]; if (it) { give(s, it); r.items[i] = null; } }
  if (r.halo) { give(s, r.halo); r.halo = null; }
  r.n = 0; r.linked = false; r.dead = true;
}

function step(scene, s) {
  const arr = s.arr;
  const cam = scene.cameras && scene.cameras.main;
  const wv = cam && cam.worldView;
  for (let i = 0; i < arr.length; i++) {
    const r = arr[i], e = r.ent;
    // Dead / despawned / cleared: recycle images the same frame so nothing lingers.
    if (!e || !e.active || e.dying || (e.hp != null && e.hp <= 0) || r.set.size === 0) {
      freeRec(s, r);
      arr[i] = arr[arr.length - 1]; arr.pop(); i--;
      continue;
    }
    if (wv && (e.x < wv.x - 40 || e.x > wv.right + 40 || e.y < wv.y - 40 || e.y > wv.bottom + 40)) { hideRec(r); continue; }
    drawRec(scene, s, r);
  }
}

// Bind a set to its owning enemy (once). Late-bound so headless/unit contexts no-op.
function readoutWatch(set) {
  const cur = OWNER.get(set);
  if (cur === null) return;                 // resolved: not an enemy (hero set — HUD owns that)
  if (cur !== undefined) {                  // known enemy: re-link if it was recycled
    if (cur.dead && cur.ent && cur.ent.active) bindScene(cur.scene, cur);
    return;
  }
  const w = typeof window !== 'undefined' ? window.__wayfarer : null; // src/main.js:51
  const mgr = w && w.scene;
  const scenes = mgr && mgr.getScenes ? mgr.getScenes(true) : null;
  if (!scenes || !scenes.length) return;    // app not up yet — retry on a later apply
  let sawGroup = false;
  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i];
    // The hero owns its own StatusSet (the HUD draws that readout) — resolve it
    // positively instead of guessing "not an enemy" and ignore it.
    if (sc && ((sc.combat && sc.combat.statuses === set) || (sc.player && sc.player.statuses === set))) {
      OWNER.set(set, null); TRIES.delete(set); return;
    }
    const grp = sc && sc.enemies;
    const list = grp && grp.getChildren ? grp.getChildren() : null;
    if (!list) continue;
    sawGroup = true;
    for (let j = 0; j < list.length; j++) {
      const e = list[j];
      if (e && e.statuses === set && e.active) {
        const rec = { set, ent: e, scene: sc, pool: null, items: [], halo: null, n: 0, col: -1,
                      strong: false, calm: false, now: 0, linked: false, dead: false };
        OWNER.set(set, rec);
        TRIES.delete(set);
        bindScene(sc, rec);                    // creates the scene pool on first enemy status
        rec.pool = SCENES.get(sc);
        return;
      }
    }
  }
  if (!sawGroup) return;                       // app/group not up yet — retry, count nothing
  // Group present but owner not listed yet: retry on later applies (transient
  // spawn ordering) and give up only after a bounded number of misses.
  const t = (TRIES.get(set) || 0) + 1;
  if (t >= MAX_TRIES) { OWNER.set(set, null); TRIES.delete(set); }
  else TRIES.set(set, t);
}

export class StatusSet {
  constructor() { this.map = new Map(); }

  // Returns true if the status is new (not just refreshed).
  apply(id, now, { secs, dmg = 0 } = {}) {
    readoutWatch(this); // presentation hook only — the timer math below is unchanged
    const def = STATUS[id];
    if (!def) return false;
    const dur = (secs ?? def.secs) * 1000;
    const cur = this.map.get(id);
    if (cur && now < cur.until) {
      cur.until = Math.max(cur.until, now + dur);
      cur.dur = Math.max(cur.dur, cur.until - now);
      cur.dmg = Math.max(cur.dmg, dmg);
      return false;
    }
    this.map.set(id, { id, until: now + dur, dur, next: now + (def.tick || 0), dmg });
    return true;
  }

  has(id, now) { const s = this.map.get(id); return !!s && now < s.until; }
  get size() { return this.map.size; }

  // Expires finished effects and calls onDot(id, dmg) for every DoT tick due.
  tick(now, onDot) {
    for (const [id, s] of this.map) {
      if (now >= s.until) { this.map.delete(id); continue; }
      const def = STATUS[id];
      if (def.tick && now >= s.next) { s.next += def.tick; if (s.dmg > 0) onDot(id, s.dmg); }
    }
  }

  // [{id, left (ms), frac (0..1 remaining)}]
  list(now) {
    const out = [];
    for (const s of this.map.values()) if (now < s.until) out.push({ id: s.id, left: s.until - now, frac: (s.until - now) / s.dur });
    return out;
  }

  clear() { this.map.clear(); }
}
