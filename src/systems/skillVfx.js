import Phaser from 'phaser';
import { CONFIG } from '../config.js';
import { settings } from '../core/settings.js';
import { settings as fxs } from './fxSettings.js';
import { audio } from './audio.js';

// Skill / combat VFX toolkit: pooled additive particles, rings + ground decals, afterimages,
// shot trails, hit-sparks, per-skill cast effects, level-up pillar, enemy death / hit reactions
// and boss entrances. Everything is cosmetic (damage lives in skillFx.js / WorldScene.cast),
// honours `window.__fx.quality` (density + pool cap) and settings.reduceMotion / settings.shake.

const ADD = Phaser.BlendModes.ADD;
export const ELEMENT = {
  phys: 0xfff1b0, fire: 0xff8a30, ice: 0x9fe0ff, thunder: 0xffee55, nature: 0x7fe06a,
  water: 0x5ac0ff, shadow: 0xb27aff, holy: 0xfff0a0, smoke: 0x8890a0, steel: 0xdfe8f0,
};
const rnd = (a, b) => a + Math.random() * (b - a);
const dens = () => Math.max(0.25, fxs.q.density * (CONFIG.isMobile ? 0.7 : 1));
const cnt = (k) => Math.max(1, Math.round(k * dens()));
const calm = () => !!settings.get('reduceMotion');

// ── procedural textures (white, tinted at use) ──────────────────────────────
function cvs(scene, key, w, h, draw, nearest = false) {
  if (scene.textures.exists(key)) return;
  const t = scene.textures.createCanvas(key, w, h);
  draw(t.getContext(), w, h);
  t.refresh();
  // pixel shapes stay crisp; soft gradients (dot/disc/ring/streak/beam) must filter LINEAR or the global
  // pixelArt NEAREST turns every scaled-up glow into a stair-stepped block. (FilterMode: 0 = LINEAR, 1 = NEAREST)
  t.setFilter(nearest ? Phaser.Textures.FilterMode.NEAREST : Phaser.Textures.FilterMode.LINEAR);
}
function ensureTex(scene) {
  if (scene.textures.exists('vfx.bubble')) return;
  const radial = (c, w, stops) => { const g = c.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); stops.forEach(([o, col]) => g.addColorStop(o, col)); c.fillStyle = g; c.fillRect(0, 0, w, w); };
  cvs(scene, 'vfx.dot', 16, 16, (c) => radial(c, 16, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.8)'], [1, 'rgba(255,255,255,0)']]));
  cvs(scene, 'vfx.disc', 64, 64, (c) => radial(c, 64, [[0, 'rgba(255,255,255,.9)'], [0.6, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]));
  cvs(scene, 'vfx.bubble', 64, 64, (c) => radial(c, 64, [[0, 'rgba(255,255,255,.04)'], [0.7, 'rgba(255,255,255,.14)'], [0.93, 'rgba(255,255,255,.75)'], [1, 'rgba(255,255,255,0)']]));
  cvs(scene, 'vfx.ring', 64, 64, (c) => { c.strokeStyle = 'rgba(255,255,255,.95)'; c.lineWidth = 4; c.beginPath(); c.arc(32, 32, 28, 0, Math.PI * 2); c.stroke(); c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = 9; c.beginPath(); c.arc(32, 32, 27, 0, Math.PI * 2); c.stroke(); });
  cvs(scene, 'vfx.streak', 24, 4, (c) => { const g = c.createLinearGradient(0, 0, 24, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(255,255,255,1)'); c.fillStyle = g; c.fillRect(0, 1, 24, 2); c.fillStyle = 'rgba(255,255,255,.35)'; c.fillRect(0, 0, 24, 4); });
  cvs(scene, 'vfx.beam', 16, 64, (c) => { const g = c.createLinearGradient(0, 0, 0, 64); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.75, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,.95)'); c.fillStyle = g; const h = c.createLinearGradient(0, 0, 16, 0); h.addColorStop(0, 'rgba(255,255,255,0)'); h.addColorStop(0.5, 'rgba(255,255,255,1)'); h.addColorStop(1, 'rgba(255,255,255,0)'); c.fillRect(0, 0, 16, 64); c.globalCompositeOperation = 'destination-in'; c.fillStyle = h; c.fillRect(0, 0, 16, 64); });
  cvs(scene, 'vfx.cross', 9, 9, (c) => { c.fillStyle = '#fff'; c.fillRect(3, 0, 3, 9); c.fillRect(0, 3, 9, 3); c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(5, 4, 1, 5); }, true);
  cvs(scene, 'vfx.star', 9, 9, (c) => { c.fillStyle = '#fff'; c.fillRect(4, 0, 1, 9); c.fillRect(0, 4, 9, 1); c.fillRect(3, 3, 3, 3); }, true);
  cvs(scene, 'vfx.thorn', 8, 14, (c) => { c.fillStyle = '#fff'; for (let y = 0; y < 14; y++) { const w = Math.max(1, Math.round(((y + 1) / 14) * 8)); c.fillRect(4 - w / 2, y, w, 1); } }, true);
  cvs(scene, 'vfx.caltrop', 7, 7, (c) => { c.fillStyle = '#fff'; c.fillRect(3, 0, 1, 7); c.fillRect(0, 3, 7, 1); c.fillRect(1, 1, 1, 1); c.fillRect(5, 1, 1, 1); c.fillRect(1, 5, 1, 1); c.fillRect(5, 5, 1, 1); }, true);
  cvs(scene, 'vfx.bone', 7, 3, (c) => { c.fillStyle = '#fff'; c.fillRect(1, 1, 5, 1); c.fillRect(0, 0, 1, 3); c.fillRect(6, 0, 1, 3); }, true);
  cvs(scene, 'vfx.leaf', 5, 5, (c) => { c.fillStyle = '#fff'; c.fillRect(1, 0, 3, 1); c.fillRect(0, 1, 5, 3); c.fillRect(1, 4, 3, 1); }, true);
  cvs(scene, 'vfx.chip', 3, 3, (c) => { c.fillStyle = '#fff'; c.fillRect(0, 0, 3, 3); }, true);
}

// ── pooled particles ─────────────────────────────────────────────────────────
function pool(scene) {
  let P = scene.__vfxPool;
  if (!P) {
    P = { free: [], active: 0 };
    scene.__vfxPool = P;
    scene.events.once('shutdown', () => { scene.__vfxPool = null; scene.__vfxFlash = null; });
  }
  return P;
}
function grab(scene, key = 'vfx.dot', frame) {
  ensureTex(scene);
  const P = pool(scene);
  if (P.active >= fxs.q.pool) return null;
  let im = P.free.pop();
  if (!im || !im.scene) im = scene.add.image(0, 0, key);
  im.setTexture(key, frame).setActive(true).setVisible(true).setAlpha(1).setScale(1).setAngle(0).setOrigin(0.5).clearTint().setBlendMode(0).setDepth(2650).setFlip(false, false);
  P.active += 1;
  return im;
}
function release(scene, im) {
  const P = scene.__vfxPool;
  if (!P || !im.scene) return;
  im.setVisible(false).setActive(false);
  P.free.push(im);
  P.active = Math.max(0, P.active - 1);
}

// One particle flying on a ballistic path. o: vx,vy (px/s), g, life(ms), s0,s1, a0,a1, color, blend, rot(deg/s), key, depth, sx,sy (stretch)
function fly(scene, x, y, o = {}) {
  const im = grab(scene, o.key || 'vfx.dot', o.frame);
  if (!im) return null;
  const life = o.life || 500, vx = o.vx || 0, vy = o.vy || 0, g = o.g || 0;
  im.setPosition(x, y).setTint(o.color ?? 0xffffff).setBlendMode(o.blend ?? ADD).setDepth(o.depth ?? 2650);
  if (o.angle != null) im.setAngle(o.angle);
  const s0 = o.s0 ?? 1, s1 = o.s1 ?? 0, a0 = o.a0 ?? 1, a1 = o.a1 ?? 0, rot = o.rot || 0, a00 = im.angle;
  scene.tweens.addCounter({
    from: 0, to: 1, duration: life,
    onUpdate: (tw) => {
      const t = tw.getValue(), sec = (life * t) / 1000;
      im.setPosition(x + vx * sec, y + vy * sec + 0.5 * g * sec * sec);
      const s = s0 + (s1 - s0) * t;
      im.setScale(s * (o.sx || 1), s * (o.sy || 1)).setAlpha(a0 + (a1 - a0) * t);
      if (rot) im.setAngle(a00 + rot * sec);
    },
    onComplete: () => release(scene, im),
  });
  return im;
}

function burst(scene, x, y, o = {}) {
  const n = o.raw ? o.n : cnt(o.n || 8);
  const a0 = o.angle ?? 0, spread = o.spread ?? Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = spread >= Math.PI * 2 ? Math.random() * Math.PI * 2 : a0 + (Math.random() - 0.5) * spread;
    const sp = rnd(...(o.speed || [30, 90]));
    const col = Array.isArray(o.color) ? o.color[(Math.random() * o.color.length) | 0] : o.color;
    fly(scene, x + (o.jx ? rnd(-o.jx, o.jx) : 0), y + (o.jy ? rnd(-o.jy, o.jy) : 0), {
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + (o.up ? -o.up : 0), g: o.g ?? 0, life: rnd(...(o.life || [250, 500])),
      s0: rnd(...(o.size || [0.6, 1])), s1: o.s1 ?? 0, color: col, blend: o.blend, key: o.key, a0: o.a0, a1: o.a1, rot: o.rot ? rnd(-o.rot, o.rot) : 0, depth: o.depth,
      angle: o.key === 'vfx.streak' ? Phaser.Math.RadToDeg(a) : undefined, sx: o.key === 'vfx.streak' ? (o.len || 1) : undefined,
    });
  }
}

// Expanding ring. ground rings are squashed (iso floor); screen-facing ones are not.
function ring(scene, x, y, o = {}) {
  const im = grab(scene, 'vfx.ring');
  if (!im) return null;
  const r = o.r || 40, sq = o.squash ?? 0.62;
  im.setPosition(x, y).setTint(o.color ?? 0xffffff).setBlendMode(o.blend ?? ADD).setDepth(o.depth ?? 2640).setAlpha(o.a ?? 0.9);
  const s0 = (o.from ?? 0.2) * (r * 2) / 64, s1 = (r * 2) / 64;
  im.setScale(s0, s0 * sq);
  scene.tweens.add({ targets: im, scaleX: s1, scaleY: s1 * sq, alpha: 0, duration: (o.dur || 420) * 1.25, ease: o.ease || 'sine.out', onComplete: () => release(scene, im) });
  return im;
}
function glow(scene, x, y, o = {}) {
  const im = grab(scene, 'vfx.disc');
  if (!im) return null;
  const r = o.r || 24;
  im.setPosition(x, y).setTint(o.color ?? 0xffffff).setBlendMode(o.blend ?? ADD).setDepth(o.depth ?? 2660).setAlpha(o.a ?? 0.85);
  const s = (r * 2) / 64;
  im.setScale(s * (o.from ?? 0.4), s * (o.from ?? 0.4) * (o.squash ?? 1));
  scene.tweens.add({ targets: im, scaleX: s, scaleY: s * (o.squash ?? 1), alpha: o.end ?? 0, duration: o.dur || 300, ease: o.ease || 'quad.out', onComplete: () => release(scene, im) });
  return im;
}
// Lingering ground mark (scorch / glow / puddle / thorn patch).
function decal(scene, x, y, o = {}) {
  const im = grab(scene, 'vfx.disc');
  if (!im) return null;
  const r = o.r || 40, s = (r * 2) / 64;
  im.setPosition(x, y).setTint(o.color ?? 0x000000).setBlendMode(o.blend ?? 0).setDepth(3).setAlpha(0).setScale(s * 0.6, s * 0.6 * 0.62);
  scene.tweens.add({
    targets: im, alpha: o.a ?? 0.45, scaleX: s, scaleY: s * 0.62, duration: 160, ease: 'quad.out',
    onComplete: () => scene.tweens.add({ targets: im, alpha: 0, duration: o.ms || 1600, delay: o.hold ?? 300, onComplete: () => release(scene, im) }),
  });
  return im;
}
// Tapered streak from (x,y) along angle (rad).
function streak(scene, x, y, ang, len, o = {}) {
  const im = grab(scene, 'vfx.streak');
  if (!im) return null;
  im.setOrigin(1, 0.5).setPosition(x, y).setRotation(ang).setTint(o.color ?? 0xffffff).setBlendMode(o.blend ?? ADD).setDepth(o.depth ?? 2655);
  im.setScale(len / 24, o.w ?? 1);
  scene.tweens.add({ targets: im, alpha: 0, scaleY: (o.w ?? 1) * 0.3, duration: o.dur || 160, onComplete: () => release(scene, im) });
  return im;
}
function anim(scene, x, y, key, o = {}) {
  if (!scene.anims.exists(key)) return null;
  const s = scene.add.sprite(x, y, key, 0).setDepth(o.depth ?? 2700).setScale(o.scale ?? 1).setAngle(o.angle ?? 0).setAlpha(o.alpha ?? 1).setFlipX(!!o.flipX);
  if (o.tint != null) s.setTint(o.tint);
  if (o.blend != null) s.setBlendMode(o.blend);
  if (o.origin) s.setOrigin(...o.origin);
  s.play(o.rate ? { key, frameRate: o.rate } : key);
  s.once('animationcomplete', () => s.destroy());
  return s;
}
function afterimage(scene, p, tint = 0x9fd0ff, alpha = 0.55, life = 260) {
  const sp = p.sprite;
  if (!sp || !sp.texture) return;
  const im = grab(scene, sp.texture.key, sp.frame.name);
  if (!im) return;
  im.setPosition(p.x, p.y - 8).setTint(tint).setAlpha(alpha).setBlendMode(ADD).setDepth((p.depth || 10) - 0.2).setFlipX(sp.flipX);
  scene.tweens.add({ targets: im, alpha: 0, duration: life, onComplete: () => release(scene, im) });
}
// Looped afterimage trail while `ms` elapse.
function trail(scene, p, ms, tint, every = 35) {
  if (fxs.quality === 'low') every *= 2;
  const ev = scene.time.addEvent({ delay: every, loop: true, callback: () => afterimage(scene, p, tint) });
  scene.time.delayedCall(ms, () => ev.remove(false));
  afterimage(scene, p, tint, 0.7);
}

// screen-space flash (subtle) + shake, both silenced by Reduce motion / shake off
export function flashScreen(scene, color = 0xffffff, a = 0.25, ms = 160) {
  if (calm()) return;
  let r = scene.__vfxFlash;
  if (!r || !r.scene) {
    r = scene.add.rectangle(0, 0, 9000, 9000, 0xffffff, 0).setScrollFactor(0).setDepth(9000).setBlendMode(ADD);
    scene.__vfxFlash = r;
  }
  r.setPosition(scene.scale.width / 2, scene.scale.height / 2).setFillStyle(color, 1);
  scene.tweens.killTweensOf(r);
  r.setAlpha(a);
  scene.tweens.add({ targets: r, alpha: 0, duration: ms });
}
export function shakeScreen(scene, ms = 120, amt = 0.004) {
  if (settings.shakeOn) scene.cameras.main.shake(ms, amt);
}

// ── elements: hit-spark colour follows the most recent skill ───────────────
const ctx = { el: 'phys', until: 0 };
const setEl = (scene, el, ms = 800) => { ctx.el = el; ctx.until = scene.time.now + ms; };

export function hitSpark(scene, x, y, crit = false) {
  const el = scene.time.now < ctx.until ? ctx.el : 'phys';
  const c = ELEMENT[el] || ELEMENT.phys;
  const big = crit ? 1.5 : 1;
  burst(scene, x, y, { n: crit ? 9 : 5, speed: [40, 110 * big], life: [160, 320], size: [0.5, 0.9], color: [c, 0xffffff], key: 'vfx.streak', len: 0.9 });
  glow(scene, x, y, { r: 10 * big, color: c, dur: 140, a: 0.9 });
  if (el === 'fire') burst(scene, x, y, { n: 3, speed: [10, 40], up: 25, life: [300, 500], color: [0xff6020, 0xffcc40], g: -30 });
  else if (el === 'ice') burst(scene, x, y, { n: 3, key: 'vfx.star', speed: [20, 60], life: [300, 450], color: 0xdff6ff, size: [0.6, 0.9] });
  else if (el === 'thunder') streak(scene, x + 6, y - 8, -0.9, 18, { color: 0xffffff, dur: 100 });
  else if (el === 'nature') burst(scene, x, y, { n: 3, key: 'vfx.leaf', speed: [20, 60], life: [350, 550], color: 0x8fe070, size: [0.8, 1.1], g: 60, blend: 0, rot: 400 });
  if (crit) ring(scene, x, y + 5, { r: 21, from: 0.35, color: 0xffe57a, dur: 220, a: 0.8 });
}

// Small, reusable feedback for an evasive roll. It deliberately uses the shared
// VFX pool so dodges remain readable without creating a new object every frame.
export function dodgeVfx(scene, p, perfect = false) {
  if (!scene || !p?.active) return;
  ensureTex(scene);
  const color = perfect ? 0xffffff : 0x8fdcff;
  ring(scene, p.x, p.y + 2, { r: perfect ? 30 : 22, from: 0.3, color, dur: perfect ? 260 : 200, a: perfect ? 0.95 : 0.7 });
  trail(scene, p, perfect ? 180 : 130, perfect ? 0xd9f6ff : 0x86cfff, perfect ? 30 : 42);
  if (perfect) burst(scene, p.x, p.y - 8, { n: 5, key: 'vfx.star', color: [0xffffff, 0x8fdcff], speed: [28, 68], life: [180, 320], size: [0.55, 0.9] });
}

// ── shot trails + muzzle ────────────────────────────────────────────────────
const TRAIL = {
  arrow: { c: [0xfff4c8, 0xffffff], len: 14, key: 'streak' },
  kunai: { c: [0xdfe8f0, 0xffffff], len: 12, key: 'streak' },
  shuriken: { c: [0xdfe8f0, 0x8fb0d0], len: 8, key: 'spark' },
  fire: { c: [0xff7a20, 0xffd040], len: 0, key: 'ember' },
  energy: { c: [0x8fd0ff, 0xffffff], len: 0, key: 'ember' },
};
export function attachShotFx(scene, s, kind) {
  const T = TRAIL[kind] || TRAIL.energy;
  const every = fxs.quality === 'low' ? 80 : 38;
  const ev = scene.time.addEvent({
    delay: every, loop: true,
    callback: () => {
      if (!s.active) { ev.remove(false); return; }
      const ang = s.rotation || 0, col = T.c[(Math.random() * T.c.length) | 0];
      if (T.key === 'streak') streak(scene, s.x, s.y, ang, T.len * (s.scale || 1), { color: col, dur: 170, w: 0.9 });
      else if (T.key === 'ember') fly(scene, s.x + rnd(-2, 2), s.y + rnd(-2, 2), { vx: rnd(-14, 14), vy: rnd(-22, 4), life: rnd(220, 380), s0: rnd(0.45, 0.8), color: col, g: kind === 'fire' ? -30 : 0 });
      else fly(scene, s.x, s.y, { life: 200, s0: 0.5, color: col });
    },
  });
  s.once('destroy', () => ev.remove(false));
}
function muzzle(scene, p, a, color, big = 1) {
  const x = p.x + Math.cos(a) * 10, y = p.y - 8 + Math.sin(a) * 10;
  glow(scene, x, y, { r: 14 * big, color, dur: 150 });
  burst(scene, x, y, { n: 5, angle: a, spread: 0.9, speed: [50, 120], life: [120, 240], color: [color, 0xffffff], key: 'vfx.streak', len: 0.8 });
}

// ── reusable composites ─────────────────────────────────────────────────────
function windup(scene, p, color, ms = 160) {
  const x = p.x, y = p.y - 8;
  ring(scene, x, p.y + 2, { r: 22, from: 1, color, dur: ms + 60, ease: 'quad.in', a: 0.7 });
  glow(scene, x, y, { r: 18, from: 1.3, color, dur: ms + 40, a: 0.6, end: 0.1 });
  p.castPose?.(color);
}
// Persistent pulsing aura under the hero while a buff lasts (one at a time).
function aura(scene, p, color, secs, o = {}) {
  p.__aura?.stop?.(); p.__auraImg && release(scene, p.__auraImg);
  const im = grab(scene, 'vfx.disc');
  if (!im) return;
  p.__auraImg = im;
  im.setTint(color).setBlendMode(ADD).setDepth((p.depth || 10) - 0.4);
  const r = o.r || 20, s = (r * 2) / 64, pulse = !calm();
  const tw = scene.tweens.addCounter({
    from: 0, to: 1, duration: secs * 1000,
    onUpdate: (t) => {
      if (!p.active) return;
      const k = t.getValue() * secs, pu = pulse ? 0.5 + 0.5 * Math.sin(k * 6) : 0.5, fade = Math.min(1, (secs - k) / 0.6);
      im.setPosition(p.x, p.y + 2).setScale(s * (1 + 0.14 * pu), s * 0.55 * (1 + 0.14 * pu)).setAlpha((0.5 + 0.3 * pu) * fade);
      if (Math.random() < 0.08 * dens()) fly(scene, p.x + rnd(-8, 8), p.y - 2, { vx: 0, vy: -rnd(18, 34), life: 500, s0: 0.5, color: o.spark ?? color, key: o.key });
    },
    onComplete: () => { release(scene, im); if (p.__auraImg === im) p.__auraImg = null; },
  });
  p.__aura = tw;
}
function healCrosses(scene, x, y, color = 0x58e07a, n = 5, spread = 14) {
  for (let i = 0; i < cnt(n); i++) {
    fly(scene, x + rnd(-spread, spread), y + rnd(-2, 8), { key: 'vfx.cross', vx: rnd(-6, 6), vy: -rnd(28, 50), life: rnd(650, 950), s0: rnd(1.2, 1.7), s1: 1, a0: 1, color, blend: 0, depth: 2800 });
  }
}
function pillar(scene, x, y, color, h = 70, w = 26, dur = 900, a = 0.8) {
  const im = grab(scene, 'vfx.beam');
  if (!im) return;
  im.setOrigin(0.5, 1).setPosition(x, y).setTint(color).setBlendMode(ADD).setDepth(2620).setAlpha(0);
  im.setScale(w / 16 * 0.3, 0.1);
  scene.tweens.add({
    targets: im, scaleX: w / 16, scaleY: h / 64, alpha: a, duration: dur * 0.3, ease: 'quad.out',
    onComplete: () => scene.tweens.add({ targets: im, scaleX: w / 16 * 0.2, alpha: 0, duration: dur * 0.7, ease: 'quad.in', onComplete: () => release(scene, im) }),
  });
}
const sweepRing = (scene, x, y, r, color, dur = 420) => { ring(scene, x, y + 2, { r, color, dur }); ring(scene, x, y + 2, { r: r * 0.72, color: 0xffffff, dur: dur * 0.8, a: 0.3 }); };
function radial(scene, x, y, n, r0, r1, o = {}) {
  for (let i = 0; i < cnt(n); i++) {
    const a = (i / cnt(n)) * Math.PI * 2 + (o.off || 0);
    streak(scene, x + Math.cos(a) * r1, y + Math.sin(a) * r1 * 0.66, a, r1 - r0, { color: o.color ?? 0xffffff, dur: o.dur || 240, w: o.w ?? 1.2 });
  }
}

// ── per-skill cast effects ──────────────────────────────────────────────────
// Each receives (scene, p, a /* facing rad */, ctx { lv, radius, secs }). `ab.fx` carries radius/secs.
const SK = {
  // — Wayfarer —
  slash(scene, p, a) {
    setEl(scene, 'phys');
    windup(scene, p, ELEMENT.phys, 60);
    anim(scene, p.x + Math.cos(a) * 14, p.y - 8 + Math.sin(a) * 14, 'fx.slashCurved', { scale: 1.6, angle: Phaser.Math.RadToDeg(a) + 90, tint: 0xfff1c0 });
    streak(scene, p.x + Math.cos(a) * 26, p.y - 8 + Math.sin(a) * 26, a, 30, { color: 0xffffff, w: 1.6 });
  },
  flare(scene, p) {
    setEl(scene, 'holy');
    windup(scene, p, 0xffc860, 120);
    anim(scene, p.x, p.y - 4, 'fx.circleOrange', { scale: 2, blend: ADD, alpha: 0.75 });
    sweepRing(scene, p.x, p.y, 62, 0xffd060, 460);
    decal(scene, p.x, p.y + 2, { r: 52, color: 0xffb040, blend: ADD, a: 0.4, ms: 1100 });
    burst(scene, p.x, p.y - 4, { n: 14, speed: [25, 70], up: 30, life: [500, 900], color: [0xffd860, 0xffffff, 0xff9a30], g: -20, size: [0.6, 1.1] });
    radial(scene, p.x, p.y - 4, 8, 12, 42, { color: 0xfff0a0 });
    flashScreen(scene, 0xffe0a0, 0.1, 140);
  },
  dash(scene, p, a) {
    setEl(scene, 'phys');
    trail(scene, p, 260, 0xa8d8ff);
    for (let i = 0; i < 2; i++) anim(scene, p.x - Math.cos(a) * i * 6, p.y + 1, 'fx.dust', { scale: 1.3, tint: 0xe8e0b8, alpha: 0.8, depth: (p.depth || 10) - 0.5, flipX: Math.cos(a) < 0 });
    for (let i = 0; i < 4; i++) streak(scene, p.x - Math.cos(a) * 4, p.y - 12 + i * 4, a, 26 + i * 4, { color: 0xbfe4ff, dur: 240, w: 0.9 });
  },
  camp(scene, p) {
    setEl(scene, 'fire');
    windup(scene, p, 0xffa040, 100);
    const x = p.x, y = p.y + 4, secs = 10;
    glow(scene, x, y, { r: 62, color: 0xff9030, from: 0.3, dur: 500, a: 0.5 });
    const warm = grab(scene, 'vfx.disc');
    const flame = scene.add.sprite(x, y - 4, 'fx.flam', 0).setDepth(2600).setScale(1.2).setBlendMode(ADD).setAlpha(0.95);
    const flame2 = scene.add.sprite(x + 2, y - 2, 'fx.flam', 2).setDepth(2599).setScale(0.9).setTint(0xffd080).setAlpha(0.8);
    if (scene.anims.exists('fx.flam')) { flame.play({ key: 'fx.flam', repeat: -1, frameRate: 11 }); flame2.play({ key: 'fx.flam', repeat: -1, frameRate: 9, startFrame: 3 }); }
    if (warm) warm.setPosition(x, y + 2).setTint(0xff8a30).setBlendMode(ADD).setDepth(3).setScale(1.6, 0.9);
    let t = 0;
    const ev = scene.time.addEvent({
      delay: 120, loop: true,
      callback: () => {
        t += 0.12;
        if (warm) warm.setAlpha(0.32 + (calm() ? 0 : 0.12 * Math.sin(t * 9)));
        if (Math.random() < 0.7 * dens()) fly(scene, x + rnd(-4, 4), y - 10, { vx: rnd(-10, 10), vy: -rnd(24, 44), life: rnd(600, 1000), s0: rnd(0.35, 0.7), color: [0xffc040, 0xff6020, 0xffe080][(Math.random() * 3) | 0], g: -10 });
        if (Math.random() < 0.1) fly(scene, x + rnd(-3, 3), y - 12, { vx: rnd(-6, 6), vy: -rnd(16, 26), life: 1300, s0: 0.8, s1: 2.0, a0: 0.25, color: 0x99a0a8, blend: 0 });
      },
    });
    for (let i = 0; i < 10; i++) scene.time.delayedCall(700 + i * 1000, () => { if (p.active) { healCrosses(scene, p.x, p.y - 6, 0x58e07a, 2, 10); ring(scene, p.x, p.y + 2, { r: 18, color: 0x7aff9a, dur: 500, a: 0.5 }); } });
    scene.time.delayedCall(secs * 1000, () => {
      ev.remove(false);
      scene.tweens.add({ targets: [flame, flame2], alpha: 0, duration: 400, onComplete: () => { flame.destroy(); flame2.destroy(); } });
      if (warm) scene.tweens.add({ targets: warm, alpha: 0, duration: 400, onComplete: () => release(scene, warm) });
    });
  },
  // — Ranger —
  shot(scene, p, a) { setEl(scene, 'phys', 1100); windup(scene, p, 0xc8ffb0, 40); muzzle(scene, p, a, 0xfff4c8); },
  volley(scene, p, a) {
    setEl(scene, 'nature', 1100);
    windup(scene, p, 0x9fe88a, 80);
    for (let i = -2; i <= 2; i++) { muzzle(scene, p, a + i * 0.15, i ? 0xb8f090 : 0xfff4c8, 0.7); streak(scene, p.x + Math.cos(a + i * 0.3) * 40, p.y - 8 + Math.sin(a + i * 0.3) * 40, a + i * 0.3, 40, { color: 0xbfffa0, dur: 220, w: 0.8 }); }
    burst(scene, p.x, p.y - 8, { n: 6, key: 'vfx.leaf', blend: 0, color: 0x7fe06a, speed: [30, 80], life: [400, 600], g: 60, angle: a, spread: 1.4, rot: 500 });
  },
  snare(scene, p) {
    setEl(scene, 'nature');
    windup(scene, p, 0x9a7a40, 100);
    sweepRing(scene, p.x, p.y, 70, 0xf0d080, 480);
    decal(scene, p.x, p.y + 2, { r: 66, color: 0x3a2410, a: 0.4, ms: 1800, hold: 1200 });
    for (let i = 0; i < cnt(12); i++) {
      const ang = (i / cnt(12)) * Math.PI * 2, rr = 52 + rnd(-6, 6);
      const x = p.x + Math.cos(ang) * rr, y = p.y + Math.sin(ang) * rr * 0.66;
      scene.time.delayedCall(i * 18, () => {
        const th = grab(scene, 'vfx.thorn');
        if (!th) return;
        th.setOrigin(0.5, 1).setPosition(x, y).setTint(0xd0a868).setDepth(y < p.y ? 7 : 11).setScale(0.8, 0.1);
        scene.tweens.add({ targets: th, scaleX: 1.6, scaleY: 1.8, duration: 140, ease: 'back.out', onComplete: () => scene.tweens.add({ targets: th, alpha: 0, delay: 1100, duration: 350, onComplete: () => release(scene, th) }) });
      });
    }
    anim(scene, p.x, p.y - 6, 'fx.plant', { scale: 2.6, alpha: 0.8 });
    burst(scene, p.x, p.y, { n: 10, speed: [30, 80], life: [300, 600], color: [0x8a6a30, 0xb89a50], blend: 0, g: 100, up: 40, size: [0.6, 1] });
  },
  // — Arcanist —
  bolt(scene, p, a) { setEl(scene, 'fire', 1100); windup(scene, p, 0xff7a30, 100); muzzle(scene, p, a, 0xff8a30, 1.2); },
  burst(scene, p) {
    setEl(scene, 'nature');
    windup(scene, p, 0x7fe06a, 100);
    sweepRing(scene, p.x, p.y, 58, 0x7fe06a, 440);
    decal(scene, p.x, p.y + 2, { r: 48, color: 0x2f9040, a: 0.45, ms: 1400 });
    for (let i = 0; i < cnt(8); i++) { const ang = (i / cnt(8)) * Math.PI * 2; anim(scene, p.x + Math.cos(ang) * 34, p.y - 6 + Math.sin(ang) * 22, 'fx.plant', { scale: 1.2, angle: Phaser.Math.RadToDeg(ang) + 90, alpha: 0.9 }); }
    burst(scene, p.x, p.y - 6, { n: 18, key: 'vfx.leaf', blend: 0, color: [0x7fe06a, 0xb8f090, 0x3fa050], speed: [40, 100], life: [500, 900], g: 40, rot: 500, size: [0.9, 1.4], jy: 4 });
    shakeScreen(scene, 100, 0.0025);
  },
  blink(scene, p) {
    setEl(scene, 'shadow');
    const ox = p.x, oy = p.y;
    afterimage(scene, p, 0xc9a0ff, 0.8, 380);
    ring(scene, ox, oy - 8, { r: 26, from: 1, color: 0xb27aff, dur: 240, ease: 'quad.in', squash: 1 });
    glow(scene, ox, oy - 8, { r: 26, color: 0xe0c0ff, dur: 260, a: 0.9 });
    burst(scene, ox, oy - 8, { n: 10, speed: [30, 90], life: [300, 500], color: [0xb27aff, 0xffffff], key: 'vfx.star', size: [0.7, 1] });
    scene.time.delayedCall(30, () => {
      if (!p.active) return;
      const x = p.x, y = p.y - 8;
      anim(scene, x, y, 'fx.spark', { scale: 1.3, blend: ADD });
      ring(scene, x, y, { r: 30, color: 0xe0c0ff, dur: 320, squash: 1 });
      glow(scene, x, y, { r: 30, color: 0xffffff, dur: 220, a: 0.9 });
      streak(scene, ox, oy - 8, Math.atan2(y - (oy - 8), x - ox), Math.hypot(x - ox, y - oy + 8), { color: 0xc9a0ff, dur: 260, w: 1.6 });
      burst(scene, x, y, { n: 10, speed: [30, 100], life: [300, 500], color: [0xb27aff, 0xffffff], key: 'vfx.star', size: [0.7, 1] });
      flashScreen(scene, 0xd0b0ff, 0.08, 120);
    });
  },
  ward(scene, p, a, c) {
    setEl(scene, 'water');
    windup(scene, p, 0x6ab8ff, 80);
    const secs = c.secs || 3, im = grab(scene, 'vfx.bubble');
    const sp = anim(scene, p.x, p.y - 8, 'fx.shieldBlue', { scale: 1.9, alpha: 0.9, blend: ADD });
    sp && scene.tweens.addCounter({ from: 0, to: 1, duration: 500, onUpdate: () => sp.active && sp.setPosition(p.x, p.y - 8) });
    ring(scene, p.x, p.y + 2, { r: 30, color: 0x6ab8ff, dur: 400 });
    if (im) {
      im.setTint(0x7cc8ff).setBlendMode(ADD).setDepth((p.depth || 10) + 0.5).setScale(0.1);
      scene.tweens.addCounter({
        from: 0, to: 1, duration: secs * 1000,
        onUpdate: (t) => {
          if (!p.active) return;
          const k = t.getValue() * secs, fade = Math.min(1, (secs - k) / 0.5), grow = Math.min(1, k / 0.15), pu = calm() ? 0.5 : 0.5 + 0.5 * Math.sin(k * 7);
          im.setPosition(p.x, p.y - 8).setScale((34 / 64) * (0.4 + 0.6 * grow) * (1 + 0.04 * pu)).setAlpha((0.6 + 0.3 * pu) * fade);
          if (Math.random() < 0.05 * dens()) fly(scene, p.x + rnd(-14, 14), p.y - 8 + rnd(-14, 14), { vy: -14, life: 500, s0: 0.5, color: 0xcfeaff, key: 'vfx.star' });
        },
        onComplete: () => { release(scene, im); ring(scene, p.x, p.y - 8, { r: 30, color: 0x9fd8ff, dur: 260, squash: 1, from: 0.8 }); },
      });
    }
  },
  // — Bandit —
  stab(scene, p, a) {
    setEl(scene, 'phys');
    windup(scene, p, 0xffd9a0, 40);
    anim(scene, p.x + Math.cos(a) * 18, p.y - 8 + Math.sin(a) * 18, 'fx.cutX', { scale: 1.1, tint: 0xffe8c0 });
    streak(scene, p.x + Math.cos(a) * 30, p.y - 8 + Math.sin(a) * 30, a, 34, { color: 0xffffff, w: 1.2 });
  },
  fan(scene, p, a) {
    setEl(scene, 'steel', 1100);
    windup(scene, p, 0xdfe8f0, 60);
    for (let i = -1; i <= 1; i++) { muzzle(scene, p, a + i * 0.3, 0xdfe8f0, 0.7); streak(scene, p.x + Math.cos(a + i * 0.3) * 34, p.y - 8 + Math.sin(a + i * 0.3) * 34, a + i * 0.3, 34, { color: 0xffffff, dur: 200, w: 0.8 }); }
    burst(scene, p.x, p.y - 8, { n: 6, speed: [40, 100], angle: a, spread: 1.2, life: [200, 350], color: [0xdfe8f0, 0xff6050], key: 'vfx.star', size: [0.6, 1] });
  },
  smoke(scene, p) {
    setEl(scene, 'smoke');
    windup(scene, p, 0x8890a0, 80);
    for (let i = 0; i < cnt(8); i++) {
      const ang = (i / cnt(8)) * Math.PI * 2, d = 10 + (i % 2) * 26;
      anim(scene, p.x + Math.cos(ang) * d, p.y - 6 + Math.sin(ang) * d * 0.6, 'fx.smoke', { scale: 1.6 + (i % 3) * 0.4, tint: i % 2 ? 0x6a6470 : 0x8a8294, alpha: 0.85, depth: 2690 });
    }
    sweepRing(scene, p.x, p.y, 72, 0x9a94a8, 500);
    decal(scene, p.x, p.y + 2, { r: 60, color: 0x1a1024, a: 0.4, ms: 1600, hold: 600 });
    burst(scene, p.x, p.y - 4, { n: 16, speed: [30, 90], life: [600, 1000], color: [0x5a5464, 0x7a7488, 0x3a3444], blend: 0, size: [1, 2], s1: 2.4, a0: 0.6 });
  },
  // — Advanced: Knight —
  bash(scene, p, a, c) {
    setEl(scene, 'phys');
    windup(scene, p, 0xffe8b0, 100);
    const R = c.radius || 44;
    sweepRing(scene, p.x, p.y, R + 12, 0xffe0a0, 360);
    decal(scene, p.x, p.y + 2, { r: R, color: 0x2a1a0a, a: 0.4, ms: 1200 });
    for (let i = 0; i < cnt(5); i++) { const ang = (i / cnt(5)) * Math.PI * 2 + 0.4; anim(scene, p.x + Math.cos(ang) * R * 0.7, p.y + Math.sin(ang) * R * 0.5 - 4, 'fx.rockSpike', { scale: 0.55, alpha: 0.95, origin: [0.5, 0.85] }); }
    burst(scene, p.x, p.y, { n: 14, speed: [50, 120], up: 50, life: [350, 600], color: [0x8a6a4a, 0xc0a078, 0x6a5038], blend: 0, g: 240, size: [0.8, 1.4], key: 'vfx.chip' });
    anim(scene, p.x + Math.cos(a) * 16, p.y - 8 + Math.sin(a) * 16, 'fx.circular', { scale: 1.8, tint: 0xfff0c0 });
    shakeScreen(scene, 140, 0.005);
  },
  bulwark(scene, p, a, c) {
    setEl(scene, 'holy');
    windup(scene, p, 0xffe070, 100);
    anim(scene, p.x, p.y - 8, 'fx.shieldYellow', { scale: 2.2, blend: ADD, alpha: 0.95 });
    sweepRing(scene, p.x, p.y, 34, 0xffd860, 400);
    pillar(scene, p.x, p.y, 0xffe080, 46, 26, 700, 0.6);
    aura(scene, p, 0xffd040, c.secs || 8, { r: 22, spark: 0xfff0a0 });
    burst(scene, p.x, p.y - 8, { n: 10, key: 'vfx.star', speed: [25, 70], life: [400, 700], color: [0xffe070, 0xffffff], size: [0.7, 1.1] });
    flashScreen(scene, 0xfff0b0, 0.08, 150);
  },
  // — Lantern Warden —
  beacon(scene, p) {
    setEl(scene, 'holy');
    windup(scene, p, 0xfff0a0, 120);
    pillar(scene, p.x, p.y + 2, 0xfff0a0, 110, 34, 1100, 0.85);
    anim(scene, p.x, p.y - 6, 'fx.circleWhite', { scale: 2, blend: ADD, alpha: 0.75 });
    sweepRing(scene, p.x, p.y, 50, 0xfff0a0, 520);
    healCrosses(scene, p.x, p.y - 6, 0x7aff9a, 9, 20);
    burst(scene, p.x, p.y - 6, { n: 14, key: 'vfx.star', speed: [15, 50], up: 50, life: [600, 1000], color: [0xffffff, 0xffe880], g: -30, size: [0.6, 1.1], jx: 12 });
    aura(scene, p, 0xffe880, 2.4, { r: 20 });
    flashScreen(scene, 0xfff6c0, 0.12, 200);
  },
  sunburst(scene, p, a, c) {
    setEl(scene, 'holy');
    windup(scene, p, 0xffe070, 140);
    const R = c.radius || 78;
    glow(scene, p.x, p.y - 6, { r: R * 0.9, color: 0xfff0b0, dur: 380, a: 0.8, from: 0.2 });
    anim(scene, p.x, p.y - 8, 'fx.explosion', { scale: Math.min(2, R / 38), tint: 0xffe8a0 });
    sweepRing(scene, p.x, p.y, R, 0xffe070, 520);
    ring(scene, p.x, p.y + 2, { r: R * 0.5, color: 0xffffff, dur: 340 });
    radial(scene, p.x, p.y - 6, 14, 14, R * 0.75, { color: 0xfff0a0, dur: 360, w: 1.6 });
    decal(scene, p.x, p.y + 2, { r: R * 0.8, color: 0xffd860, blend: ADD, a: 0.35, ms: 1200 });
    burst(scene, p.x, p.y - 6, { n: 22, speed: [50, 140], life: [500, 900], color: [0xffe880, 0xffffff, 0xffb040], size: [0.7, 1.3] });
    flashScreen(scene, 0xfff2c0, 0.22, 220); shakeScreen(scene, 120, 0.003);
  },
  // — Hunter —
  pierce(scene, p, a) {
    setEl(scene, 'phys', 1100);
    windup(scene, p, 0xfff4c8, 160);
    muzzle(scene, p, a, 0xffffff, 1.8);
    streak(scene, p.x + Math.cos(a) * 190, p.y - 8 + Math.sin(a) * 190, a, 190, { color: 0xfff4c8, dur: 420, w: 4.5 });
    streak(scene, p.x + Math.cos(a) * 190, p.y - 8 + Math.sin(a) * 190, a, 190, { color: 0xffffff, dur: 300, w: 1.8 });
    ring(scene, p.x + Math.cos(a) * 12, p.y - 8 + Math.sin(a) * 12, { r: 16, color: 0xffffff, dur: 220, squash: 1 });
    shakeScreen(scene, 70, 0.002);
  },
  arrowrain(scene, p, a, c) {
    setEl(scene, 'phys', 1200);
    windup(scene, p, 0xc8ffb0, 120);
    const R = c.radius || 84, cx = p.x, cy = p.y;
    decal(scene, cx, cy + 2, { r: R, color: 0x1a1a10, a: 0.22, ms: 1100, hold: 600 });
    ring(scene, cx, cy + 2, { r: R, color: 0xc8ffb0, dur: 500, a: 0.5 });
    const n = cnt(22);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R * 0.92;
      const x = cx + Math.cos(ang) * rr, y = cy + Math.sin(ang) * rr * 0.66;
      scene.time.delayedCall(80 + i * 13, () => {
        const ar = grab(scene, scene.textures.exists('proj.arrow') ? 'proj.arrow' : 'vfx.thorn');
        if (!ar) return;
        ar.setBlendMode(0).setDepth(2650).setRotation(Math.PI / 2 + rnd(-0.12, 0.12)).setPosition(x + 6, y - 90).setScale(1.3);
        scene.tweens.add({
          targets: ar, x, y: y - 4, duration: 230, ease: 'quad.in',
          onComplete: () => {
            burst(scene, x, y, { n: 3, speed: [20, 60], life: [160, 280], color: [0xfff4c8, 0xffffff], key: 'vfx.streak', len: 0.6, up: 20 });
            anim(scene, x, y + 2, 'fx.dust', { scale: 0.7, tint: 0xe8e0b8, alpha: 0.7, depth: 9 });
            scene.tweens.add({ targets: ar, alpha: 0, delay: 450, duration: 250, onComplete: () => release(scene, ar) });
          },
        });
      });
    }
  },
  // — Wildwarden —
  thornwall(scene, p, a, c) {
    setEl(scene, 'nature');
    windup(scene, p, 0x7fe06a, 100);
    const R = c.radius || 66;
    sweepRing(scene, p.x, p.y, R, 0x7fe06a, 460);
    decal(scene, p.x, p.y + 2, { r: R, color: 0x58d070, blend: ADD, a: 0.3, ms: 2400, hold: 1200 });
    const n = cnt(18);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2, rr = R * (0.86 + rnd(-0.06, 0.06));
      const x = p.x + Math.cos(ang) * rr, y = p.y + Math.sin(ang) * rr * 0.66;
      scene.time.delayedCall(i * 14, () => {
        const th = grab(scene, 'vfx.thorn');
        if (!th) return;
        th.setOrigin(0.5, 1).setPosition(x, y).setTint(i % 2 ? 0x58d070 : 0x9af080).setDepth(y < p.y ? 7 : 11).setScale(0.5, 0.1);
        scene.tweens.add({ targets: th, scaleX: 2.2, scaleY: 2.8, duration: 170, ease: 'back.out', onComplete: () => scene.tweens.add({ targets: th, alpha: 0, scaleY: 0.3, delay: 1500, duration: 400, onComplete: () => release(scene, th) }) });
      });
    }
    anim(scene, p.x, p.y - 6, 'fx.plant', { scale: 3, alpha: 0.75 });
    burst(scene, p.x, p.y - 4, { n: 14, key: 'vfx.leaf', blend: 0, color: [0x7fe06a, 0x3fa050], speed: [40, 100], life: [500, 800], g: 50, rot: 400 });
    shakeScreen(scene, 90, 0.002);
  },
  wildmend(scene, p, a, c) {
    setEl(scene, 'nature');
    windup(scene, p, 0x7fe06a, 100);
    healCrosses(scene, p.x, p.y - 6, 0x58e07a, 8, 16);
    sweepRing(scene, p.x, p.y, 34, 0x7fe06a, 440);
    for (let i = 0; i < cnt(10); i++) {
      const ang = Math.random() * Math.PI * 2;
      fly(scene, p.x + Math.cos(ang) * 14, p.y - 4 + Math.sin(ang) * 8, { key: 'vfx.leaf', blend: 0, color: [0x7fe06a, 0xb8f090][i % 2], vx: -Math.sin(ang) * 50, vy: -rnd(30, 60), life: rnd(600, 900), s0: 1.1, s1: 0.7, a0: 1, rot: 500 });
    }
    aura(scene, p, 0x58e07a, c.secs || 5, { r: 20 });
    for (let i = 0; i < 4; i++) streak(scene, p.x - 8, p.y - 14 + i * 4, Math.PI, 22, { color: 0xc8ffb0, dur: 300, w: 0.8 });
  },
  // — Elementalist —
  meteor(scene, p, a, c) {
    setEl(scene, 'fire', 1000);
    windup(scene, p, 0xff6a20, 200);
    const R = c.radius || 72, x = p.x, y = p.y;
    // telegraph, then a fireball drops from the sky and detonates (skillFx delays damage to match)
    decal(scene, x, y + 2, { r: R, color: 0xff3010, blend: ADD, a: 0.3, ms: 500, hold: 200 });
    ring(scene, x, y + 2, { r: R, from: 1, color: 0xff6a20, dur: 280, ease: 'quad.in', a: 0.8 });
    const m = grab(scene, 'vfx.disc');
    const f = scene.add.sprite(x + 50, y - 150, 'proj.fireball', 0).setDepth(2900).setScale(3.2).setRotation(Math.PI * 0.75);
    if (scene.anims.exists('proj.fireball')) f.play('proj.fireball');
    if (m) m.setTint(0xff7a20).setBlendMode(ADD).setDepth(2880).setPosition(f.x, f.y).setScale(1.1);
    scene.tweens.add({
      targets: f, x, y: y - 6, duration: 250, ease: 'quad.in',
      onUpdate: () => {
        m && m.setPosition(f.x, f.y);
        fly(scene, f.x + rnd(-4, 4), f.y + rnd(-4, 4), { vx: rnd(-10, 10), vy: rnd(-10, 10), life: 300, s0: 1, color: [0xff7a20, 0xffd040][Math.random() < 0.5 ? 0 : 1], depth: 2880 });
      },
      onComplete: () => {
        f.destroy(); m && release(scene, m);
        anim(scene, x, y - 10, 'fx.explosion', { scale: Math.min(2, R / 34) });
        anim(scene, x, y - 6, 'fx.flam', { scale: R / 28 });
        sweepRing(scene, x, y, R, 0xff7a20, 480);
        glow(scene, x, y - 6, { r: R, color: 0xffb060, dur: 300, a: 0.9 });
        decal(scene, x, y + 2, { r: R * 0.85, color: 0x1a0a04, a: 0.6, ms: 3000, hold: 2000 });
        burst(scene, x, y - 6, { n: 26, speed: [60, 170], up: 40, life: [500, 1000], color: [0xff6020, 0xffc040, 0xffe880], g: 120, size: [0.7, 1.4] });
        burst(scene, x, y, { n: 10, speed: [50, 130], up: 70, life: [400, 700], color: [0x7a5a3a, 0xa08060], blend: 0, g: 280, key: 'vfx.chip', size: [1, 1.6] });
        flashScreen(scene, 0xffa860, 0.22, 240); shakeScreen(scene, 200, 0.007);
      },
    });
  },
  chain(scene, p, a) {
    setEl(scene, 'thunder', 1100);
    windup(scene, p, 0xffe040, 100);
    anim(scene, p.x + Math.cos(a) * 12, p.y - 10 + Math.sin(a) * 12, 'fx.thunder', { scale: 1.6, angle: Phaser.Math.RadToDeg(a), blend: ADD });
    for (let i = -2; i <= 2; i++) muzzle(scene, p, a + i * 0.14, i % 2 ? 0xff9a30 : 0xffe040, 0.8);
    burst(scene, p.x, p.y - 8, { n: 8, key: 'vfx.star', color: [0xffe040, 0xffffff], speed: [40, 110], angle: a, spread: 1.6, life: [200, 380] });
  },
  // — Tidecaller —
  tidal(scene, p, a, c) {
    setEl(scene, 'water');
    windup(scene, p, 0x5ac0ff, 100);
    const R = c.radius || 66;
    sweepRing(scene, p.x, p.y, R, 0x5ac0ff, 520);
    decal(scene, p.x, p.y + 2, { r: R, color: 0x2a78d0, a: 0.4, ms: 1800, hold: 500 });
    const n = cnt(8);
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const s = anim(scene, p.x, p.y - 4, 'fx.water', { scale: 1.2, alpha: 0.95, flipX: Math.cos(ang) < 0, depth: 2690 });
      s && scene.tweens.add({ targets: s, x: p.x + Math.cos(ang) * R * 0.75, y: p.y - 4 + Math.sin(ang) * R * 0.5, duration: 520, ease: 'quad.out' });
    }
    burst(scene, p.x, p.y - 4, { n: 18, speed: [50, 130], life: [400, 700], color: [0x9fe0ff, 0xffffff, 0x5ac0ff], up: 20, g: 160, size: [0.6, 1.2] });
    shakeScreen(scene, 90, 0.0022);
  },
  mist(scene, p) {
    setEl(scene, 'water');
    windup(scene, p, 0x9fe0ff, 100);
    anim(scene, p.x, p.y - 2, 'fx.pillar', { scale: 1.6, alpha: 0.6, origin: [0.5, 0.9], depth: 2620 });
    for (let i = 0; i < cnt(7); i++) {
      const ang = (i / cnt(7)) * Math.PI * 2;
      anim(scene, p.x + Math.cos(ang) * 14, p.y - 6 + Math.sin(ang) * 8, 'fx.smoke', { scale: 1.5, tint: 0xbfeaff, alpha: 0.55, depth: 2690 });
    }
    healCrosses(scene, p.x, p.y - 6, 0x7af0d0, 9, 18);
    sweepRing(scene, p.x, p.y, 44, 0x9fe0ff, 500);
    burst(scene, p.x, p.y - 6, { n: 14, speed: [10, 40], up: 40, life: [700, 1100], color: [0xcfeaff, 0xffffff], g: -10, size: [0.6, 1], jx: 14 });
    aura(scene, p, 0x7fd8ff, 2.2, { r: 20 });
  },
  // — Shadowblade —
  shadowstep(scene, p, a) {
    setEl(scene, 'shadow');
    const ox = p.x, oy = p.y;
    trail(scene, p, 200, 0x9a70e0, 22);
    anim(scene, ox, oy - 4, 'fx.smoke', { scale: 1.3, tint: 0x3a2a58, alpha: 0.9 });
    burst(scene, ox, oy - 6, { n: 8, speed: [30, 90], life: [250, 450], color: [0xb27aff, 0x3a2a58], size: [0.8, 1.3], blend: 0 });
    for (let i = 0; i < 3; i++) streak(scene, ox + Math.cos(a) * 10, oy - 14 + i * 5, a, 40, { color: 0xc9a0ff, dur: 260, w: 1 });
    scene.time.delayedCall(210, () => {
      if (!p.active) return;
      anim(scene, p.x, p.y - 4, 'fx.smoke', { scale: 1.1, tint: 0x3a2a58, alpha: 0.8 });
      burst(scene, p.x, p.y - 8, { n: 6, key: 'vfx.star', speed: [30, 90], life: [250, 450], color: [0xc9a0ff, 0xffffff] });
    });
  },
  fangdance(scene, p, a, c) {
    setEl(scene, 'phys');
    windup(scene, p, 0xdfe8f0, 40);
    const R = c.radius || 42;
    anim(scene, p.x, p.y - 8, 'fx.circular', { scale: Math.min(2, R / 16), tint: 0xffe8e8, blend: ADD });
    anim(scene, p.x, p.y - 8, 'fx.slashDouble', { scale: R / 18, angle: 180, tint: 0xffd0d0 });
    // two spinning crescents
    for (let k = 0; k < 2; k++) {
      const g = scene.add.graphics({ x: p.x, y: p.y - 8 }).setDepth(2710).setBlendMode(ADD);
      g.lineStyle(3, k ? 0xffb0b0 : 0xffffff, 0.95).beginPath().arc(0, 0, R * 0.8, 0, 1.9).strokePath();
      g.lineStyle(7, 0xff6060, 0.25).beginPath().arc(0, 0, R * 0.8, 0.2, 1.7).strokePath();
      g.setRotation(k * Math.PI);
      scene.tweens.add({ targets: g, rotation: g.rotation + Math.PI * 3, alpha: 0, scale: 1.25, duration: 330, ease: 'quad.out', onComplete: () => g.destroy() });
    }
    sweepRing(scene, p.x, p.y, R + 10, 0xffc0c0, 300);
    burst(scene, p.x, p.y - 8, { n: 12, speed: [60, 130], life: [180, 340], color: [0xffffff, 0xff8080], key: 'vfx.streak', len: 0.8 });
    shakeScreen(scene, 80, 0.0022);
  },
  // — Trickster —
  caltrops(scene, p, a, c) {
    setEl(scene, 'steel');
    windup(scene, p, 0xb8b8c8, 60);
    const R = c.radius || 70;
    decal(scene, p.x, p.y + 2, { r: R, color: 0x1a1024, a: 0.25, ms: 2400, hold: 1400 });
    const n = cnt(18);
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * R * 0.92;
      const x = p.x + Math.cos(ang) * rr, y = p.y + Math.sin(ang) * rr * 0.66;
      const ct = grab(scene, 'vfx.caltrop');
      if (!ct) break;
      ct.setTint(i % 3 ? 0xc0c4d0 : 0x808690).setBlendMode(0).setDepth(4).setPosition(p.x, p.y - 8).setScale(1.8);
      const top = Math.min(p.y - 8, y) - 22;
      scene.tweens.add({ targets: ct, x, duration: 300 + (i % 4) * 30, ease: 'sine.out', angle: rnd(-200, 200) });
      scene.tweens.add({
        targets: ct, y: top, duration: 150, ease: 'quad.out',
        onComplete: () => scene.tweens.add({
          targets: ct, y, duration: 160 + (i % 4) * 20, ease: 'quad.in',
          onComplete: () => { burst(scene, x, y, { n: 1, speed: [10, 30], life: [200, 300], color: 0xe0e0f0, size: [0.5, 0.8] }); scene.tweens.add({ targets: ct, alpha: 0, delay: 1700, duration: 500, onComplete: () => release(scene, ct) }); },
        }),
      });
    }
    sweepRing(scene, p.x, p.y, R, 0x9a94a8, 420);
    anim(scene, p.x, p.y, 'fx.dust', { scale: 2, tint: 0xd0c8b0, alpha: 0.6, depth: 9 });
  },
  feint(scene, p, a, c) {
    setEl(scene, 'shadow');
    windup(scene, p, 0xe0a0ff, 60);
    afterimage(scene, p, 0xc070ff, 0.8, 420);
    for (const off of [-9, 9]) scene.time.delayedCall(40, () => { const im = grab(scene, p.sprite.texture.key, p.sprite.frame.name); if (im) { im.setPosition(p.x + off, p.y - 8).setTint(0xb060f0).setBlendMode(ADD).setAlpha(0.6).setDepth((p.depth || 10) - 0.2).setFlipX(p.sprite.flipX); scene.tweens.add({ targets: im, x: p.x, alpha: 0, duration: 320, onComplete: () => release(scene, im) }); } });
    aura(scene, p, 0xc070ff, c.secs || 6, { r: 21, spark: 0xffe080 });
    for (let i = 0; i < cnt(6); i++) fly(scene, p.x + rnd(-10, 10), p.y - 2, { key: 'vfx.star', color: 0xffe080, vy: -rnd(40, 70), life: 600, s0: 1, s1: 0.6, blend: ADD });
    sweepRing(scene, p.x, p.y, 34, 0xc070ff, 420);
  },
};
export const hasVfx = (id) => !!SK[id];
export const ELEMENT_OF = {
  flare: 'holy', bash: 'phys', sunburst: 'holy', arrowrain: 'phys', thornwall: 'nature', burst: 'nature', meteor: 'fire',
  tidal: 'water', fangdance: 'phys', caltrops: 'steel', pierce: 'phys', chain: 'thunder', shadowstep: 'shadow',
};

function genericCastVfx(scene, p, ab) {
  const fx = ab?.fx;
  if (!fx) return;
  const type = fx.type;
  const color = type === 'heal' ? 0x6ff0a4 : type === 'buff' ? 0xb99bff : type === 'strike' ? 0xa9d9ff : type === 'shot' ? 0xffdfa0 : 0xbfe9ff;
  if (type === 'shot') {
    muzzle(scene, p, scene.facingAngle(), color, fx.n > 1 ? 1.15 : 0.9);
    return;
  }
  windup(scene, p, color, type === 'strike' ? 80 : 130);
  if (type === 'heal' || type === 'buff') {
    glow(scene, p.x, p.y - 8, { r: 22, color, dur: 280, a: 0.7 });
    ring(scene, p.x, p.y + 2, { r: 30, color, dur: 360, a: 0.65 });
  } else if (type === 'aoe') {
    ring(scene, p.x, p.y + 2, { r: Math.min(fx.radius || 40, 64), color, dur: 280, a: 0.55 });
  } else if (type === 'strike') {
    afterimage(scene, p, 0x9fdcff, 0.6, 220);
  }
}

// Entry point: called from WorldScene.cast on a successful cast (via the setCd hook).
export function castVfx(scene, ab, lv) {
  const fn = SK[ab.id];
  const p = scene.player;
  if (!p) return;
  try {
    ensureTex(scene);
    if (fn) fn(scene, p, scene.facingAngle(), { lv, radius: ab.fx?.radius, secs: ab.fx?.secs });
    else genericCastVfx(scene, p, ab);
  } catch (e) { console.error('skillVfx', ab.id, e); }
}
// Used by skillFx.js for per-enemy impact sparks during AoE/strike skills.
export function impactAt(scene, e, el) {
  if (el) setEl(scene, el, 500);
  hitSpark(scene, e.x, e.y - 8, false);
}
// skillFx.js: impact delay (ms) so damage lines up with the fall of the meteor / arrows.
export const SKILL_DELAY = { meteor: 250, arrowrain: 320 };

// ── level-up ────────────────────────────────────────────────────────────────
export function levelUpFx(scene, p) {
  if (!scene || !p?.active) return;
  ensureTex(scene);
  const x = p.x, y = p.y;
  pillar(scene, x, y + 2, 0xfff0a0, 150, 40, 1500, 0.85);
  pillar(scene, x, y + 2, 0xffffff, 120, 14, 1200, 0.9);
  sweepRing(scene, x, y, 46, 0xffe070, 600);
  ring(scene, x, y + 2, { r: 70, color: 0xffffff, dur: 800, a: 0.6 });
  glow(scene, x, y - 8, { r: 40, color: 0xfff0a0, dur: 500, a: 0.9 });
  anim(scene, x, y - 10, 'fx.boost', { scale: 1.6, blend: ADD });
  burst(scene, x, y, { n: 26, key: 'vfx.star', color: [0xffe880, 0xffffff, 0xffb040], speed: [20, 70], up: 80, life: [900, 1500], g: -20, size: [0.8, 1.4], jx: 18 });
  for (let i = 0; i < 6; i++) scene.time.delayedCall(i * 140, () => p.active && burst(scene, p.x, p.y, { n: 4, key: 'vfx.star', color: [0xffe880, 0xffffff], speed: [5, 25], up: 60 + i * 10, life: [700, 1000], g: -30, jx: 12 }));
  aura(scene, p, 0xffe070, 2.2, { r: 22 });
  flashScreen(scene, 0xfff6c0, 0.18, 260);
  scene.time.delayedCall(10, () => p.active && p.levelPose?.());
}

// ── enemy hit reactions + death effects (families from def.deathFx, see data/deathFx.js) ──
const FAM = {
  slime: { c: [0x6fe08a, 0x9ff0b0], chip: 'vfx.dot', g: 200 },
  bones: { c: [0xf4ecd8, 0xc8c0a8], chip: 'vfx.bone', g: 260 },
  ghost: { c: [0xbfe8ff, 0xffffff], chip: 'vfx.dot', g: -40 },
  bug: { c: [0xb8d060, 0x7a9a30], chip: 'vfx.chip', g: 220 },
  beast: { c: [0x9a7a5a, 0xc8b090], chip: 'vfx.chip', g: 200 },
  plant: { c: [0x7fe06a, 0x3fa050], chip: 'vfx.leaf', g: 80 },
  fire: { c: [0xff7a20, 0xffd040], chip: 'vfx.dot', g: -30 },
  ice: { c: [0xbfe8ff, 0xffffff], chip: 'vfx.star', g: 120 },
  water: { c: [0x5ac0ff, 0x9fe0ff], chip: 'vfx.dot', g: 200 },
  ink: { c: [0x2a2040, 0x5a4a7a], chip: 'vfx.dot', g: 200 },
  boss: { c: [0xc0a078, 0x6a5038], chip: 'vfx.chip', g: 240 },
  blood: { c: [0xc03030, 0x801818], chip: 'vfx.dot', g: 200 },
};
const famOf = (e) => FAM[e.def?.deathFx] || FAM.beast;

export function hitReact(e, crit = false) {
  const s = e.scene;
  if (!s || !e.active || !s.textures.exists('vfx.dot')) return;
  if (fxs.quality === 'low' && Math.random() < 0.5) return;
  const f = famOf(e), type = e.def?.deathFx;
  burst(s, e.x, e.y - 6 * (e.vscale || 1), {
    n: crit ? 6 : 3, key: f.chip, color: f.c, speed: [25, 70], up: 30, g: f.g, life: [260, 480], size: [0.8, 1.3], blend: type === 'ghost' || type === 'fire' ? ADD : 0, rot: type === 'bones' ? 600 : 0,
  });
  if (type === 'ghost' && e.sprite) s.tweens.add({ targets: e.sprite, alpha: 0.35, duration: 50, yoyo: true, repeat: 1, onComplete: () => e.sprite && e.sprite.setAlpha(1) });
}

// Returns true when it handled the sprite's death animation itself (Enemy.die then only
// fades the shadow and destroys the container).
export function deathFx(e) {
  const s = e.scene;
  if (!s || !s.textures.exists('vfx.dot')) return false;
  ensureTex(s);
  const type = e.def?.deathFx || 'beast', f = FAM[type] || FAM.beast, sc = e.vscale || 1;
  const x = e.x, y = e.y - 6 * sc, gy = e.y + 2;
  const sp = e.sprite;
  const fade = (props, ms, cb) => s.tweens.add({ targets: sp, ...props, duration: ms, onComplete: cb });
  switch (type) {
    case 'slime':
      decal(s, x, gy, { r: 16 * sc, color: f.c[0], blend: 0, a: 0.6, ms: 2000, hold: 1400 });
      burst(s, x, y, { n: 10, key: 'vfx.dot', color: f.c, blend: 0, speed: [30, 90], up: 50, g: 260, life: [300, 550], size: [0.7, 1.4] });
      ring(s, x, gy, { r: 22 * sc, color: f.c[1], dur: 300, a: 0.6 });
      return false;
    case 'bones':
      sp.stop(); sp.setTintFill(0xffffff);
      burst(s, x, y, { n: 10, key: 'vfx.bone', color: [0xf4ecd8, 0xd8d0b8, 0xffffff], blend: 0, speed: [40, 110], up: 70, g: 320, life: [600, 900], size: [1, 1.6], rot: 700, a1: 0.2 });
      burst(s, x, y, { n: 4, key: 'vfx.dot', color: 0xfff6d8, speed: [10, 40], life: [200, 350] });
      anim(s, x, y, 'fx.smoke', { scale: 0.9 * sc, tint: 0xd8d0b8, alpha: 0.6 });
      s.tweens.add({ targets: sp, x: { from: -1.5, to: 1.5 }, duration: 40, yoyo: true, repeat: 2 });
      fade({ scaleY: 0.05, scaleX: 1.2 * sc, y: sp.y + 5 * sc, alpha: 0 }, 220);
      return true;
    case 'ghost':
      sp.stop(); sp.setTint(0xbfe8ff).setBlendMode(ADD);
      ring(s, x, y, { r: 26 * sc, color: 0xbfe8ff, dur: 600, squash: 1 });
      burst(s, x, y, { n: 10, key: 'vfx.dot', color: f.c, speed: [8, 28], up: 50, g: -40, life: [700, 1100], size: [0.8, 1.4] });
      fade({ y: sp.y - 26, scaleX: 0.7 * sc, scaleY: 1.5 * sc, alpha: 0 }, 780);
      return true;
    case 'bug':
      sp.stop(); sp.setTintFill(0xffffff);
      decal(s, x, gy, { r: 14 * sc, color: 0x6a8a20, blend: 0, a: 0.6, ms: 1800, hold: 1100 });
      burst(s, x, y, { n: 10, key: 'vfx.chip', color: f.c, blend: 0, speed: [30, 100], up: 30, g: 280, life: [300, 500], size: [0.9, 1.5] });
      s.time.delayedCall(60, () => e.active && sp.setTint(0x556a20));
      fade({ scaleY: 0.18 * sc, scaleX: 1.7 * sc, y: sp.y + 5 * sc }, 110, () => e.active && fade({ alpha: 0 }, 420));
      return true;
    case 'plant':
      burst(s, x, y, { n: 12, key: 'vfx.leaf', color: f.c, blend: 0, speed: [30, 90], up: 40, g: 60, life: [600, 1000], size: [1, 1.5], rot: 500 });
      return false;
    case 'fire':
      anim(s, x, y, 'fx.flam', { scale: 1.3 * sc, blend: ADD });
      burst(s, x, y, { n: 14, color: f.c, speed: [30, 100], up: 40, g: -30, life: [400, 800], size: [0.7, 1.3] });
      return false;
    case 'ice':
      anim(s, x, y, 'fx.ice', { scale: 1.3 * sc });
      burst(s, x, y, { n: 12, key: 'vfx.star', color: f.c, speed: [40, 110], up: 30, g: 160, life: [500, 800], size: [0.8, 1.4], rot: 300 });
      return false;
    case 'water':
    case 'ink':
      anim(s, x, y, 'fx.water', { scale: 0.9 * sc, alpha: type === 'ink' ? 0.5 : 0.9, tint: type === 'ink' ? 0x3a2a60 : undefined });
      burst(s, x, y, { n: 12, key: 'vfx.dot', color: f.c, blend: 0, speed: [30, 100], up: 50, g: 260, life: [350, 600], size: [0.8, 1.5] });
      decal(s, x, gy, { r: 18 * sc, color: f.c[0], blend: 0, a: 0.4, ms: 1600, hold: 900 });
      return false;
    case 'blood':
      burst(s, x, y, { n: 10, key: 'vfx.dot', color: f.c, blend: 0, speed: [30, 100], up: 40, g: 240, life: [300, 550], size: [0.8, 1.4] });
      decal(s, x, gy, { r: 14 * sc, color: 0x801818, blend: 0, a: 0.5, ms: 1600, hold: 1000 });
      return false;
    case 'boss':
      burst(s, x, y, { n: 18, key: 'vfx.chip', color: f.c, blend: 0, speed: [50, 150], up: 80, g: 300, life: [600, 1000], size: [1.2, 2] });
      ring(s, x, gy, { r: 50 * sc, color: 0xc0a078, dur: 600 });
      anim(s, x, gy, 'fx.dust', { scale: 3 * sc, tint: 0xd0c8b0, alpha: 0.8, depth: 9 });
      return false;
    default: // beast: dust + fur puff
      anim(s, x, gy, 'fx.dust', { scale: 1.3 * sc, tint: 0xd8d0b8, alpha: 0.7, depth: 9 });
      burst(s, x, y, { n: 8, key: 'vfx.chip', color: f.c, blend: 0, speed: [30, 90], up: 40, g: 240, life: [300, 500], size: [0.8, 1.3] });
      return false;
  }
}

// ── boss entrance: camera pan/zoom + banner + music sting ───────────────────
const BOSS_TITLE = { gravemaw: 'Warden of Ashenmoor', redclaw: 'Terror of the Tideline', glacierwyrm: 'Wyrm of Frostpeak' };
let bannerStyle = false;
function banner(name, title) {
  if (typeof document === 'undefined') return;
  if (!bannerStyle) {
    bannerStyle = true;
    const st = document.createElement('style');
    st.textContent = `.wf-boss{position:fixed;left:0;right:0;top:22%;z-index:60;text-align:center;pointer-events:none;font-family:"Silkscreen",monospace;opacity:0}
.wf-boss .bar{height:2px;margin:0 auto;width:0;background:linear-gradient(90deg,transparent,#ff5a3a,transparent)}
.wf-boss .t{color:#ffd8c0;font-size:11px;letter-spacing:4px;text-transform:uppercase;text-shadow:0 2px 0 #1a1024;margin:8px 0 2px}
.wf-boss .n{color:#fff;font-size:clamp(20px,5vw,34px);letter-spacing:3px;text-shadow:0 3px 0 #7a1a1a,0 0 18px #ff3a2a}
.wf-boss.on{animation:wfBoss 2.6s ease-out forwards}.wf-boss.on .bar{animation:wfBar 2.6s ease-out forwards}
@keyframes wfBoss{0%{opacity:0;transform:scale(1.25)}12%{opacity:1;transform:scale(1)}78%{opacity:1}100%{opacity:0;transform:translateY(-10px)}}
@keyframes wfBar{0%{width:0}25%{width:min(520px,80vw)}100%{width:min(520px,80vw)}}
@media (prefers-reduced-motion:reduce){.wf-boss.on{animation:wfBossR 2.6s linear forwards}.wf-boss.on .bar{animation:none;width:min(520px,80vw)}@keyframes wfBossR{0%,85%{opacity:1}100%{opacity:0}}}`;
    document.head.appendChild(st);
  }
  const d = document.createElement('div');
  d.className = 'wf-boss';
  d.innerHTML = '<div class="bar"></div><div class="t"></div><div class="n"></div><div class="bar"></div>';
  d.querySelector('.t').textContent = title;
  d.querySelector('.n').textContent = name;
  document.body.appendChild(d);
  void d.offsetWidth;
  d.classList.add('on');
  setTimeout(() => d.remove(), 2800);
}
// procedural sting (low drone + brass-ish stab) through the Phaser audio context; respects sfx volume
function sting(scene) {
  try {
    const ac = scene.sound?.context;
    if (!ac || audio.enabled === false) return;
    const vol = 0.22 * (audio.sfxVol?.() ?? 1);
    if (vol <= 0) return;
    const t = ac.currentTime, out = ac.createGain();
    out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(vol, t + 0.05); out.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
    out.connect(ac.destination);
    [[55, 'sawtooth'], [82.4, 'sawtooth'], [116.5, 'square'], [110, 'triangle']].forEach(([fr, ty], i) => {
      const o = ac.createOscillator(), g = ac.createGain(), fl = ac.createBiquadFilter();
      o.type = ty; o.frequency.setValueAtTime(fr * 1.06, t); o.frequency.exponentialRampToValueAtTime(fr, t + 0.25);
      fl.type = 'lowpass'; fl.frequency.setValueAtTime(1400, t); fl.frequency.exponentialRampToValueAtTime(200, t + 2);
      g.gain.value = i === 3 ? 0.4 : 0.6; o.connect(fl); fl.connect(g); g.connect(out); o.start(t); o.stop(t + 2.3);
    });
    const m = audio.musicObj; // duck the zone music under the sting
    if (m?.setVolume) { const v = 0.35 * audio.musicVol(); m.setVolume(v * 0.25); scene.time.delayedCall(2200, () => { try { m.setVolume(0.35 * audio.musicVol()); } catch { /* gone */ } }); }
  } catch { /* audio is optional */ }
}
export function bossIntro(scene, boss) {
  if (!scene || !boss || boss.__introDone) return;
  boss.__introDone = true;
  ensureTex(scene);
  const cam = scene.cameras.main, p = scene.player;
  banner(boss.def?.name || 'Boss', BOSS_TITLE[boss.typeId] || boss.def?.title || 'Guardian');
  sting(scene);
  ring(scene, boss.x, boss.y + 2, { r: 90, color: 0xff5a3a, dur: 700 });
  burst(scene, boss.x, boss.y - 10, { n: 14, color: [0xff6030, 0xffc080], speed: [40, 110], up: 40, life: [500, 900], g: -10 });
  flashScreen(scene, 0xff5a3a, 0.12, 300);
  if (calm() || !p) return;
  // look at the boss by easing the follow offset, nudge the zoom, then ease back
  const z0 = cam.zoom, dx = Phaser.Math.Clamp(boss.x - p.x, -140, 140) * 0.7, dy = Phaser.Math.Clamp(boss.y - p.y, -110, 110) * 0.7;
  const off = { x: cam.followOffset.x, y: cam.followOffset.y };
  scene.tweens.add({ targets: off, x: -dx, y: -dy, duration: 550, ease: 'sine.inout', onUpdate: () => cam.setFollowOffset(off.x, off.y) });
  cam.zoomTo(z0 * 1.18, 550, 'Sine.easeInOut');
  scene.time.delayedCall(1500, () => {
    scene.tweens.add({ targets: off, x: 0, y: 0, duration: 600, ease: 'sine.inout', onUpdate: () => cam.setFollowOffset(off.x, off.y), onComplete: () => cam.setFollowOffset(0, 0) });
    cam.zoomTo(z0, 600, 'Sine.easeInOut');
  });
}
