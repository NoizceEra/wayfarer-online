// Small canvas-UI kit for the title / profile screens: palette, text, framed panels, buttons
// with hover / pressed / keyboard-focus states, a geometric focus navigator (keyboard, d-pad,
// Tab, mouse and touch all drive the same focus) and a DOM text entry for name / code fields
// (real <input>: IME, paste, mobile soft keyboards and tab order all work).
import Phaser from 'phaser';
import { audio } from '../systems/audio.js';
import { input, isTypingTarget } from '../core/input.js';

export const C = {
  bg: 0x07140a, panel: 0x0a1c10, panelHi: 0x10281a, olive: 0x9bbc0f, oliveDk: 0x306230, oliveMid: 0x4e8a30,
  gold: 0xf4c542, goldHi: 0xfff0a0, goldDk: 0x9a7418, text: '#c8e060', textHi: '#e8f5a0', muted: '#7fa00f',
  dim: '#4a7a2a', gold_s: '#f4c542', danger: 0xc84a3a, dangerDk: 0x5a1a14, ok: '#8be04a', warn: '#e0b030', bad: '#e0604a',
};
export const FONT = { title: '"Jacquard12"', ui: '"Silkscreen"', body: '"PixelifySans"' };

export function txt(scene, parent, x, y, str, { size = 12, color = C.text, font = FONT.ui, origin = [0.5, 0.5], align = 'center', wrap = 0, stroke = null, lineSpacing = 0 } = {}) {
  const st = { fontFamily: font, fontSize: `${size}px`, color, align };
  if (wrap) st.wordWrap = { width: wrap };
  if (stroke) { st.stroke = stroke[0]; st.strokeThickness = stroke[1]; }
  if (lineSpacing) st.lineSpacing = lineSpacing;
  const t = scene.add.text(x, y, str, st).setOrigin(origin[0], origin[1]);
  parent?.add(t);
  return t;
}

export function ago(ts) {
  const n = Number(ts);
  if (!n) return '';
  const s = Math.max(0, (Date.now() - n) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  if (s < 86400 * 14) return `${Math.round(s / 86400)}d ago`;
  try { return new Date(n).toLocaleDateString(); } catch { return ''; }
}

export async function copyText(s) {
  try { await navigator.clipboard.writeText(String(s || '')); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = String(s || '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

// Jacquard12 wordmark in a gold frame, with an optional shine sweep.
// Polished: carved-gold bevel, corner diamonds, a hairline rule under the wordmark,
// a slowly breathing additive glow and a shine sweep that travels inside the frame.
export function addLogo(scene, parent, x, y, { size = 36, reduce = false, sub = 'a cozy open world' } = {}) {
  const w = Math.min(460, Math.max(220, Math.round(size * 8.6)));
  const h = Math.round(size + 28);
  const g = scene.add.container(x, y);
  parent?.add(g);
  frame(scene, g, 0, 0, w, h, { fill: 0x08140c, alpha: 0.72 });
  // carved-gold bevel: bright hairline on top, dark one below, so the plate reads as metal
  g.add(scene.add.rectangle(0, -h / 2 + 4, w - 14, 1, 0xffe9a0, 0.30));
  g.add(scene.add.rectangle(0, h / 2 - 4, w - 14, 1, 0x24160a, 0.6));
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    g.add(scene.add.rectangle(sx * (w / 2 - 4), sy * (h / 2 - 4), 4, 4, C.goldHi).setAngle(45));
  }
  let glow = null;
  if (scene.textures.exists('title.glow')) {
    glow = scene.add.image(0, 0, 'title.glow').setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.24).setDisplaySize(w * 0.92, h * 1.5);
    g.add(glow);
  }
  const title = txt(scene, g, 0, sub ? -7 : 0, 'WAYFARER ONLINE', {
    size, font: FONT.title, color: C.gold_s, stroke: ['#1a1000', Math.max(3, Math.round(size / 10))],
  });
  title.setShadow(0, 2, '#000000', 4, false, true);
  if (sub) {
    g.add(scene.add.rectangle(0, size * 0.16, Math.max(40, Math.round(w * 0.32)), 1, C.goldDk, 0.85));
    txt(scene, g, 0, size * 0.40, sub, { size: Math.max(8, Math.round(size * 0.28)), font: FONT.body, color: C.muted });
  }
  const shine = scene.add.rectangle(-w / 2, 0, Math.max(10, size * 0.30), h - 12, 0xffffff, 0.16).setBlendMode(Phaser.BlendModes.ADD);
  g.add(shine);
  const tick = (time) => {
    if (!g.active) return;
    if (reduce) { shine.setVisible(false); glow?.setAlpha(0.24); return; }
    const t = (Number(time) || 0) / 1000;
    const cyc = (t * 0.34) % 1.9;   // one pass, then a short rest off-frame
    const on = cyc <= 1;
    shine.setVisible(on);
    if (on) { shine.x = -w / 2 + cyc * w; shine.setAlpha(0.09 + 0.17 * Math.sin(cyc * Math.PI)); }
    glow?.setAlpha(0.20 + 0.07 * Math.sin(t * 1.3));
  };
  if (reduce) shine.setVisible(false);
  return { g, title, shine, w, h, tick };
}

// Dark glass panel with an olive border, inner gold hairline and corner studs.
export function frame(scene, parent, x, y, w, h, { fill = C.panel, alpha = 0.86, gold = true, stud = true } = {}) {
  const add = (o) => { parent?.add(o); return o; };
  add(scene.add.rectangle(x + 3, y + 3, w, h, 0x000000, 0.35));
  const body = add(scene.add.rectangle(x, y, w, h, fill, alpha).setStrokeStyle(2, C.oliveDk));
  if (gold) {
    add(scene.add.rectangle(x, y, w - 6, h - 6).setStrokeStyle(1, C.goldDk, 0.9));
    if (stud) for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) add(scene.add.rectangle(x + sx * (w / 2 - 3), y + sy * (h / 2 - 3), 4, 4, C.gold));
  }
  return body;
}

// ─── Buttons ────────────────────────────────────────────────────────────────
// o: {id, x, y, w, h, label, sub, kind: 'primary'|'normal'|'ghost'|'danger'|'row', size, ox, oy, onClick, adjust, enabled}
// Returns an item {id, ax, ay, w, h, enabled, setLabel, setSub, setEnabled, render, ...}; add it to a Nav.
export function makeButton(scene, parent, nav, o) {
  const { x, y, w, h, kind = 'normal', size = 12 } = o;
  const add = (g) => { parent.add(g); return g; };
  const it = {
    id: o.id, ax: (o.ox || 0) + x, ay: (o.oy || 0) + y, w, h, kind, enabled: o.enabled !== false, hover: false, pressed: false,
    onClick: o.onClick, adjust: o.adjust, visible: true,
  };
  it.shadow = add(scene.add.rectangle(x + 2, y + 3, w, h, 0x000000, 0.4));
  it.bg = add(scene.add.rectangle(x, y, w, h, C.panel).setStrokeStyle(2, C.oliveDk));
  it.hi = add(scene.add.rectangle(x, y - h / 2 + 3, w - 8, 1, 0xffffff, 0.14));
  const sub = o.sub != null;
  it.label = txt(scene, parent, o.kind === 'row' ? x - w / 2 + 10 : x, y - (sub ? Math.max(3, Math.round(h * 0.17)) : 0), o.label || '', { size, origin: [o.kind === 'row' ? 0 : 0.5, 0.5], color: C.text });
  it.sub = sub ? txt(scene, parent, x, y + Math.round(h * 0.26), o.sub, { size: Math.max(8, size - 3), font: FONT.body, color: C.muted, origin: [0.5, 0.5], wrap: w - 12 }) : null;
  it.value = o.kind === 'row' ? txt(scene, parent, x + w / 2 - 10, y, '', { size, origin: [1, 0.5], color: C.gold_s }) : null;
  it.arrL = add(scene.add.triangle(x - w / 2 - 7, y, 0, 0, 0, 8, 6, 4, C.gold).setOrigin(0.5).setVisible(false));
  it.arrR = add(scene.add.triangle(x + w / 2 + 7, y, 6, 0, 6, 8, 0, 4, C.gold).setOrigin(0.5).setVisible(false));
  it.setLabel = (s) => { it.label.setText(s); };
  it.setSub = (s) => { it.sub?.setText(s); };
  it.setValue = (s) => { it.value?.setText(s); };
  it.setEnabled = (b) => { it.enabled = b; it.render(); };
  it.setVisible = (b) => { it.visible = b; [it.shadow, it.bg, it.hi, it.label, it.sub, it.value, it.arrL, it.arrR].forEach((g) => g?.setVisible(b && !(g === it.arrL || g === it.arrR))); if (b) it.render(); else { it.bg.disableInteractive(); } if (b && it.enabled) it.bg.setInteractive({ useHandCursor: true }); };
  it.render = () => {
    const f = nav.focus === it, hot = it.hover || f;
    let fill, stroke, col, subCol;
    if (!it.enabled) { fill = 0x0b140c; stroke = 0x223a1c; col = '#4a6a3a'; subCol = '#3a5a2a'; }
    else if (kind === 'primary') { fill = it.pressed ? 0x9a7a1a : hot ? 0xf4cc50 : 0xd4a82c; stroke = hot ? C.goldHi : 0xa07818; col = '#1c2a06'; subCol = '#3a4a10'; }
    else if (kind === 'danger') { fill = it.pressed ? 0x3a100c : hot ? 0x7a2a20 : C.dangerDk; stroke = hot ? 0xff8a70 : C.danger; col = '#ffd0c4'; subCol = '#e09a8a'; }
    else if (kind === 'ghost') { fill = it.pressed ? 0x0a1a0c : hot ? 0x1c3a1a : 0x0c1e10; stroke = hot ? C.gold : 0x2e5a24; col = hot ? C.textHi : C.muted; subCol = C.dim; }
    else { fill = it.pressed ? 0x12301a : hot ? 0x24521e : 0x163a16; stroke = f ? C.gold : hot ? C.olive : C.oliveMid; col = hot ? C.textHi : C.text; subCol = hot ? C.text : C.muted; }
    it.bg.setFillStyle(fill, kind === 'ghost' ? 0.85 : 1).setStrokeStyle(f ? 3 : 2, f && kind !== 'primary' ? C.gold : stroke);
    it.label.setColor(col).setY(it.label.y + (it.pressed && !it._p ? 1 : 0) - (!it.pressed && it._p ? 1 : 0));
    it._p = it.pressed;
    it.sub?.setColor(subCol);
    it.arrL.setVisible(f && it.enabled); it.arrR.setVisible(f && it.enabled);
  };
  const press = (p) => {
    if (!it.enabled) return;
    it.pressed = true; nav.setFocus(it, true); it.render();
    it._px = p?.worldX; // for row buttons: left/right thirds adjust
  };
  it.bg.setInteractive({ useHandCursor: it.enabled });
  it.bg.on('pointerover', () => { if (!it.enabled) return; it.hover = true; nav.setFocus(it, true); it.render(); });
  it.bg.on('pointerout', () => { it.hover = false; it.pressed = false; it.render(); });
  it.bg.on('pointerdown', press);
  it.bg.on('pointerup', (p) => {
    if (!it.enabled || !it.pressed) return;
    it.pressed = false; it.render();
    if (kind === 'row' && it.adjust) {
      const lx = (p?.worldX ?? it.ax) - it.ax;
      if (lx < -it.w / 6) { it.adjust(-1); return; }
      if (lx > it.w / 6) { it.adjust(1); return; }
    }
    nav.activate(it);
  });
  nav.register(it);
  it.render();
  return it;
}

// ─── Focus navigator ────────────────────────────────────────────────────────
export class Nav {
  constructor() { this.items = []; this.focus = null; this.onFocus = null; }
  register(it) { this.items.push(it); }
  clear() { this.items = []; this.focus = null; }
  live() { return this.items.filter((i) => i.enabled && i.visible !== false && i.bg?.active); }
  setFocus(it, quiet) {
    if (this.focus === it) return;
    const prev = this.focus; this.focus = it;
    prev?.render?.(); it?.render?.();
    if (!quiet) audio.play('ui', 0.25);
    this.onFocus?.(it);
  }
  first() { const l = this.live(); if (l.length) this.setFocus(l[0], true); }
  step(d) { // linear order (Tab / Shift+Tab)
    const l = this.live(); if (!l.length) return;
    const i = Math.max(0, l.indexOf(this.focus));
    this.setFocus(l[(i + d + l.length) % l.length]);
  }
  move(dir) { // 'up' | 'down' | 'left' | 'right' — nearest item in that direction
    const l = this.live(); if (!l.length) return;
    const cur = this.focus && l.includes(this.focus) ? this.focus : null;
    if (!cur) { this.setFocus(l[0]); return; }
    const vert = dir === 'up' || dir === 'down', sgn = dir === 'up' || dir === 'left' ? -1 : 1;
    let best = null, bs = Infinity;
    for (const it of l) {
      if (it === cur) continue;
      const dx = it.ax - cur.ax, dy = it.ay - cur.ay;
      const along = vert ? dy * sgn : dx * sgn, across = vert ? Math.abs(dx) : Math.abs(dy);
      if (along < 3) continue;
      const s = along + across * 2.4;
      if (s < bs) { bs = s; best = it; }
    }
    if (!best) { // wrap vertically; stay put horizontally
      if (!vert) return;
      const sorted = [...l].sort((a, b) => (a.ay - b.ay) || (a.ax - b.ax));
      best = dir === 'down' ? sorted[0] : sorted[sorted.length - 1];
    }
    this.setFocus(best);
  }
  activate(it = this.focus) {
    if (!it || !it.enabled) return;
    audio.ui();
    it.onClick?.(it);
  }
  adjust(d) {
    const it = this.focus;
    if (it?.adjust) { it.adjust(d); return; }
    this.move(d < 0 ? 'left' : 'right');
  }
}

// ─── DOM text entry ─────────────────────────────────────────────────────────
// One reusable <input>, visually hidden: the canvas field mirrors its value. Focusing a real input
// brings up mobile soft keyboards and keeps the input manager from treating letters as hotkeys.
export class DomEntry {
  constructor() { this.el = null; this.cfg = null; }
  get active() { return !!this.cfg; }
  start(cfg) { // {value, max, upper, pattern(RegExp for allowed chars), label, onChange(v), onCommit(v), onCancel()}
    this.stop(true);
    this.cfg = cfg;
    const el = document.createElement('input');
    el.type = 'text'; el.value = cfg.value || ''; el.maxLength = cfg.max || 14;
    el.autocomplete = 'off'; el.autocapitalize = 'off'; el.spellcheck = false; el.enterKeyHint = 'done';
    el.setAttribute('aria-label', cfg.label || 'Text entry');
    el.style.cssText = 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);width:min(70vw,320px);height:30px;font-size:16px;opacity:0.02;z-index:5;border:0;padding:0 6px;background:#000;color:#fff';
    const clean = (v) => { let s = String(v); if (cfg.upper) s = s.toUpperCase(); if (cfg.pattern) s = [...s].filter((ch) => cfg.pattern.test(ch)).join(''); return s.slice(0, cfg.max || 14); };
    el.addEventListener('input', () => { const v = clean(el.value); if (v !== el.value) el.value = v; cfg.onChange?.(v); });
    el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); this.finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); this.finish(false); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); this.finish(true, e.key === 'ArrowUp' ? 'up' : 'down'); }
    });
    el.addEventListener('blur', () => { if (this.cfg && this.el === el) setTimeout(() => { if (this.cfg && this.el === el) this.finish(true); }, 0); });
    document.body.appendChild(el);
    this.el = el;
    el.focus({ preventScroll: true });
    try { el.setSelectionRange(el.value.length, el.value.length); } catch { /* ignore */ }
  }
  set(v) { if (this.el) this.el.value = v; }
  finish(commit, dir) {
    const cfg = this.cfg; if (!cfg) return;
    const v = this.el?.value ?? '';
    this.stop(true);
    if (commit) cfg.onCommit?.(v, dir); else cfg.onCancel?.();
    try { window.focus(); document.querySelector('canvas')?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }
  stop(silent) {
    const el = this.el; this.cfg = silent ? null : this.cfg; this.cfg = null; this.el = null;
    if (el) { el.remove(); }
  }
}

// Canvas-mirrored text field. Click / Enter starts a real DOM <input> (see DomEntry).
export function makeField(scene, parent, nav, entry, o) {
  const { x, y, w, h } = o;
  const add = (g) => { parent.add(g); return g; };
  const it = {
    id: o.id, ax: (o.ox || 0) + x, ay: (o.oy || 0) + y, w, h, kind: 'field',
    enabled: o.enabled !== false, visible: true, hover: false, value: o.value || '',
    onClick: () => it.edit(),
  };
  it.shadow = add(scene.add.rectangle(x + 2, y + 3, w, h, 0x000000, 0.35));
  it.bg = add(scene.add.rectangle(x, y, w, h, 0x0c2212).setStrokeStyle(2, C.oliveDk));
  it.text = txt(scene, parent, x - w / 2 + 10, y, it.value || o.placeholder || '', {
    size: o.size || 13, origin: [0, 0.5], color: it.value ? C.textHi : C.dim,
  });
  it.cursor = txt(scene, parent, 0, y, '_', { size: o.size || 13, origin: [0, 0.5], color: C.gold_s });
  it.cursor.setVisible(false);
  it.setValue = (v) => {
    it.value = String(v || '');
    it.text.setText(it.value || o.placeholder || '');
    it.text.setColor(it.value ? C.textHi : C.dim);
    it.cursor.setX(it.text.x + it.text.displayWidth + 2);
  };
  it.edit = () => {
    if (!it.enabled) return;
    nav.setFocus(it, true);
    entry.start({
      value: it.value, max: o.max || 14, upper: !!o.upper, pattern: o.pattern, label: o.label || 'Text',
      onChange: (v) => { it.setValue(v); o.onChange?.(v); },
      onCommit: (v, dir) => { it.setValue(v); o.onCommit?.(v, dir); it.render(); },
      onCancel: () => { o.onCancel?.(); it.render(); },
    });
    it.render();
  };
  it.render = () => {
    const f = nav.focus === it, hot = it.hover || f || entry.active;
    it.bg.setStrokeStyle(f ? 3 : 2, f ? C.gold : hot ? C.olive : C.oliveDk);
    it.bg.setFillStyle(hot ? 0x14301a : 0x0c2212);
    it.cursor.setVisible(f || entry.active);
    it.cursor.setX(it.text.x + it.text.displayWidth + 2);
  };
  it.bg.setInteractive({ useHandCursor: true });
  it.bg.on('pointerover', () => { it.hover = true; nav.setFocus(it, true); it.render(); });
  it.bg.on('pointerout', () => { it.hover = false; it.render(); });
  it.bg.on('pointerdown', () => it.edit());
  nav.register(it);
  it.render();
  return it;
}

// Keyboard / gamepad / Tab all drive the same Nav. Esc/B closes when `isOpen()`.
export function bindTitleNav(scene, nav, { isOpen, close } = {}) {
  const prev = input.nav;
  const api = {
    move(d) { nav.move(d < 0 ? 'up' : 'down'); },
    adjust(d) { nav.adjust(d); },
    activate() { nav.activate(); },
    back() { close?.(); },
  };
  input.nav = api;
  input.addCloser({ id: `title-nav:${scene.scene.key}`, priority: 850, isOpen: () => !!isOpen?.(), close: () => close?.(), scene });
  const onTab = (e) => {
    if (e.key !== 'Tab' || isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
    if (!scene.scene.isActive()) return;
    e.preventDefault();
    nav.step(e.shiftKey ? -1 : 1);
  };
  window.addEventListener('keydown', onTab);
  scene.events.once('shutdown', () => {
    window.removeEventListener('keydown', onTab);
    if (input.nav === api) input.nav = prev && prev !== api ? prev : null;
  });
  return api;
}
