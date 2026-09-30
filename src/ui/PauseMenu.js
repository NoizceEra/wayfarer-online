import { input } from '../core/input.js';
import { settings, UI_SCALES, DEFAULT_SETTINGS } from '../core/settings.js';
import { audio } from '../systems/audio.js';

// Pause menu (Esc / START / HUD menu button) with three pages:
//   main     – resume, settings, controls, help, palette, leave
//   settings – volume sliders, zoom, UI scale, FPS, shake, reduce motion
//   controls – rebind every input action (click a key chip, press a key)
// Keyboard/gamepad navigation: up/down move, left/right adjust, Enter/A activate.
// Lives in UIScene; uses the scene's virtual (UI-scaled) coordinates.
const FONT = '"Silkscreen", monospace';
const T = (size, color, extra = {}) => ({ fontFamily: FONT, fontSize: `${size}px`, color, ...extra });
const OLIVE = 0x9bbc0f, OLIVE_HI = 0xb8d820, OLIVE_DN = 0x7a9a0a;
const FOCUS = 0xffe07a;

export class PauseMenu {
  // hooks: { onOpenChange(open), resume(), leave(), leaveLabel(), cyclePalette(), modeText(), help(), zoom: {get,step,set}, applyUiScale() }
  constructor(scene, hooks) {
    this.scene = scene; this.hooks = hooks;
    this.isOpen = false; this.page = 'main';
    this.c = null; this.items = []; this.focus = 0;
    this.msg = ''; this.ctrlPage = 0; this.capturing = null;
    this.offChange = input.onChange(() => { if (this.isOpen && this.page === 'controls' && !this.capturing) this.build(); });
    scene.events.once('shutdown', () => this.destroy());
  }

  open(page = 'main') {
    if (!this.isOpen) { this.isOpen = true; input.pushModal('pause'); this.hooks.onOpenChange?.(true); }
    this.page = page; this.focus = 0; this.msg = '';
    this.build();
    input.nav = this.navApi();
  }
  close() {
    if (!this.isOpen) return;
    this.cancelCapture();
    this.isOpen = false;
    input.popModal('pause');
    if (input.nav?.owner === this) input.nav = null;
    this.c?.destroy(); this.c = null; this.items = [];
    this.hooks.onOpenChange?.(false);
  }
  toggle() { if (this.isOpen) this.close(); else this.open('main'); }
  goto(page) { this.cancelCapture(); this.page = page; this.focus = 0; this.msg = ''; this.ctrlPage = 0; this.build(); }
  destroy() { this.close(); this.offChange?.(); }

  navApi() {
    return {
      owner: this,
      move: (d) => { if (!this.items.length || this.capturing) return; this.focus = (this.focus + d + this.items.length) % this.items.length; this.drawFocus(); audio.play('ui', 0.3); },
      adjust: (d) => { const it = this.items[this.focus]; if (it?.adjust && !this.capturing) { it.adjust(d); } },
      activate: () => { const it = this.items[this.focus]; if (it && !this.capturing) { audio.play('ui', 0.6); it.activate(); } },
      back: () => { if (this.page !== 'main') this.goto('main'); else this.close(); },
    };
  }

  // ── building blocks ──────────────────────────────────────────────────────
  add(o) { this.c.add(o); return o; }
  button(x, y, w, h, label, cb, { size = 11, color = OLIVE, text = '#3a1f00', adjust } = {}) {
    const s = this.scene;
    const fill = this.add(s.add.rectangle(x, y, w, h, color).setStrokeStyle(1, 0x1a1a22).setInteractive({ useHandCursor: true }));
    const t = this.add(s.add.text(x, y, label, T(size, text)).setOrigin(0.5));
    const hi = color === OLIVE ? OLIVE_HI : color;
    fill.on('pointerover', () => fill.setFillStyle(hi));
    fill.on('pointerout', () => fill.setFillStyle(color));
    fill.on('pointerdown', () => { fill.setFillStyle(OLIVE_DN); audio.play('ui', 0.7); cb(); });
    fill.on('pointerup', () => fill?.active && fill.setFillStyle(color));
    const item = { obj: fill, activate: cb, adjust, t };
    this.items.push(item);
    return item;
  }
  drawFocus() {
    this.items.forEach((it, i) => { if (it.obj?.active) it.obj.setStrokeStyle(i === this.focus ? 2 : 1, i === this.focus ? FOCUS : 0x1a1a22); });
  }

  build() {
    const s = this.scene;
    this.c?.destroy();
    this.items = [];
    const { w: VW, h: VH } = s.view();
    const pw = this.page === 'controls' ? Math.min(VW - 16, VW >= 640 ? 600 : 380) : Math.min(VW - 16, 300);
    const ph = this.page === 'main' ? 300 : Math.min(VH - 16, this.page === 'controls' ? 470 : 380);
    this.c = s.add.container(Math.round(VW / 2), Math.round(VH / 2)).setDepth(200);
    this.pw = pw; this.ph = ph;
    // body swallows clicks so they never reach the world / HUD below
    this.add(s.add.rectangle(0, 0, VW * 2, VH * 2, 0x000000, 0.45).setInteractive());
    const [f, n] = s._nsPair(0, 0, pw, ph, 'ui.panelBg');
    this.add(f.setInteractive()); this.add(n);
    if (this.page === 'main') this.buildMain(pw, ph);
    else if (this.page === 'settings') this.buildSettings(pw, ph);
    else this.buildControls(pw, ph);
    this.focus = Math.min(this.focus, Math.max(0, this.items.length - 1));
    this.drawFocus();
  }

  title(txt, ph) { this.add(this.scene.add.text(0, -ph / 2 + 20, txt, T(15, '#ffe8a0', { fontStyle: 'bold' })).setOrigin(0.5)); }
  footer(txt, ph, color = '#a0c4f0') { return this.add(this.scene.add.text(0, ph / 2 - 14, txt, T(8, color, { align: 'center', wordWrap: { width: this.pw - 20 } })).setOrigin(0.5)); }

  buildMain(pw, ph) {
    this.title('— PAUSED —', ph);
    const h = this.hooks;
    const rows = [
      ['Resume', () => h.resume()],
      ['Settings', () => this.goto('settings')],
      ['Controls / rebind keys', () => this.goto('controls')],
      [`Help & hotkeys [${input.labelFor('help')}]`, () => h.help()],
      ['Cycle Game Boy palette', () => h.cyclePalette()],
      [h.leaveLabel(), () => h.leave()],
    ];
    rows.forEach(([label, cb], i) => this.button(0, -ph / 2 + 58 + i * 34, 220, 26, label, cb, { size: 10 }));
    this.footer(h.modeText(), ph);
  }

  buildSettings(pw, ph) {
    const s = this.scene;
    this.title('SETTINGS', ph);
    const L = -pw / 2 + 16, R = pw / 2 - 16;
    let y = -ph / 2 + 50;
    const rowH = Math.min(30, (ph - 110) / 10);
    const label = (txt) => this.add(s.add.text(L, y, txt, T(10, '#f4e0b0')).setOrigin(0, 0.5));
    const slider = (key, txt) => {
      label(txt);
      const tw = Math.min(110, pw - 170), tx = R - tw - 34;
      const track = this.add(s.add.rectangle(tx, y, tw, 8, 0x1a1024).setOrigin(0, 0.5).setStrokeStyle(1, 0x5a4a2a).setInteractive({ useHandCursor: true }));
      const fill = this.add(s.add.rectangle(tx, y, 1, 8, OLIVE).setOrigin(0, 0.5));
      const knob = this.add(s.add.rectangle(tx, y, 6, 14, 0xffe8a0).setStrokeStyle(1, 0x1a1024));
      const val = this.add(s.add.text(R, y, '', T(9, '#ffe8a0')).setOrigin(1, 0.5));
      const draw = () => { const v = settings.get(key); fill.width = Math.max(1, tw * v); knob.x = tx + tw * v; val.setText(`${Math.round(v * 100)}%`); };
      const setFromPtr = (p) => { const lx = p.x / s.uiZoom - (this.c.x + tx); settings.set(key, Math.round(Math.max(0, Math.min(1, lx / tw)) * 20) / 20); draw(); };
      track.on('pointerdown', (p) => { setFromPtr(p); this.dragging = setFromPtr; audio.play('ui', 0.4); });
      draw();
      const item = { obj: track, activate: () => {}, adjust: (d) => { settings.set(key, Math.round((settings.get(key) + d * 0.1) * 10) / 10); draw(); audio.play('ui', 0.4); } };
      this.items.push(item);
      y += rowH;
    };
    const stepper = (txt, get, step) => {
      label(txt);
      const val = this.add(s.add.text(R - 34, y, get(), T(10, '#ffe8a0')).setOrigin(0.5));
      const refresh = () => val.setText(get());
      const minus = this.button(R - 70, y, 20, 18, '-', () => { step(-1); refresh(); }, { size: 11, adjust: (d) => { step(d); refresh(); } });
      this.button(R - 2 + -8, y, 20, 18, '+', () => { step(1); refresh(); }, { size: 11, adjust: (d) => { step(d); refresh(); } });
      void minus;
      y += rowH;
    };
    const toggle = (key, txt) => {
      label(txt);
      const b = this.button(R - 30, y, 56, 18, settings.get(key) ? 'ON' : 'OFF', () => { settings.set(key, !settings.get(key)); b.t.setText(settings.get(key) ? 'ON' : 'OFF'); }, { size: 9 });
      b.adjust = () => b.activate();
      y += rowH;
    };
    slider('master', 'Master volume');
    slider('music', 'Music');
    slider('sfx', 'Sound effects');
    const z = this.hooks.zoom;
    stepper(`World zoom (${input.labelFor('zoomReset')} = fit)`, () => { const p = z?.get?.(); return p === 'fit' || p == null ? 'FIT' : `${p}x`; }, (d) => z?.step(d));
    stepper('UI scale', () => `${settings.get('uiScale')}x`, (d) => {
      const i = UI_SCALES.indexOf(settings.get('uiScale'));
      const ni = Math.max(0, Math.min(UI_SCALES.length - 1, i + d));
      if (ni !== i) { settings.set('uiScale', UI_SCALES[ni]); this.hooks.applyUiScale?.(); }
    });
    toggle('showFps', 'Show FPS');
    if (navigator.vibrate) toggle('haptics', 'Haptic vibration');
    toggle('shake', 'Screen shake');
    toggle('reduceMotion', 'Reduce motion');
    const by = ph / 2 - 36;
    this.button(-62, by, 110, 22, 'DEFAULTS', () => {
      const scale = settings.get('uiScale');
      for (const k of Object.keys(DEFAULT_SETTINGS)) if (k !== 'uiScale') settings.set(k, DEFAULT_SETTINGS[k]);
      this.hooks.zoom?.set('fit');
      if (scale !== DEFAULT_SETTINGS.uiScale) { settings.set('uiScale', DEFAULT_SETTINGS.uiScale); this.hooks.applyUiScale?.(); return; }
      this.build();
    }, { size: 9, color: 0xc0705a });
    this.button(62, by, 110, 22, 'BACK', () => this.goto('main'), { size: 9 });
    this.footer('Arrows/d-pad: move · Left/Right: adjust · Esc: back', ph, '#8a9a70');
  }

  buildControls(pw, ph) {
    const s = this.scene;
    this.title('CONTROLS', ph);
    const acts = input.list();
    const twoCol = pw >= 560;
    const rowH = 17;
    const top = -ph / 2 + 44;
    const usable = ph - 44 - 64;
    const perCol = Math.max(4, Math.floor(usable / rowH));
    const perPage = perCol * (twoCol ? 2 : 1);
    const pages = Math.max(1, Math.ceil(acts.length / perPage));
    this.ctrlPage = Math.min(this.ctrlPage, pages - 1);
    const colW = twoCol ? (pw - 24) / 2 : pw - 20;
    acts.slice(this.ctrlPage * perPage, (this.ctrlPage + 1) * perPage).forEach((a, i) => {
      const col = twoCol ? Math.floor(i / perCol) : 0;
      const x0 = -pw / 2 + 12 + col * (colW + 4), y = top + (i % perCol) * rowH + rowH / 2;
      this.add(s.add.rectangle(x0 + colW / 2, y, colW, rowH - 2, 0x000000, i % 2 ? 0.15 : 0.28));
      this.add(s.add.text(x0 + 4, y, a.label, T(8, a.custom ? '#ffe07a' : '#e6f2c0')).setOrigin(0, 0.5));
      for (let slot = 0; slot < 2; slot++) {
        const k = a.keys[slot];
        const cw = 58, cx = x0 + colW - 4 - cw / 2 - (1 - slot) * (cw + 4);
        const capturingThis = this.capturing && this.capturing.id === a.id && this.capturing.slot === slot;
        const txt = capturingThis ? '...' : k ? input.tokenLabel(k) : '+';
        const locked = a.id === 'menu' && k === 'Escape';
        const b = this.button(cx, y, cw, rowH - 3, txt, () => { if (!locked) this.beginCapture(a, slot); else this.say('Esc always opens/closes menus.'); },
          { size: 8, color: capturingThis ? FOCUS : locked ? 0x7a7a52 : k ? 0xd8c890 : 0x5a5a48, text: '#1a1024' });
        void b;
      }
    });
    const by = ph / 2 - 40;
    if (pages > 1) {
      this.button(-pw / 2 + 40, by, 56, 20, '< PREV', () => { this.ctrlPage = (this.ctrlPage - 1 + pages) % pages; this.build(); }, { size: 8 });
      this.button(pw / 2 - 40, by, 56, 20, 'NEXT >', () => { this.ctrlPage = (this.ctrlPage + 1) % pages; this.build(); }, { size: 8 });
    }
    this.button(-60, by, 108, 20, 'RESET ALL', () => { input.resetBindings(); this.say('Controls reset to defaults.'); this.build(); }, { size: 8, color: 0xc0705a });
    this.button(60, by, 108, 20, 'BACK', () => this.goto('main'), { size: 8 });
    this.msgT = this.footer(this.capturing
      ? `Press a key for "${this.capturing.label}"  ·  Esc cancel  ·  Backspace clear`
      : this.msg || 'Click a key to rebind. Saved automatically.', ph, this.capturing ? '#ffe07a' : '#a0c4f0');
  }

  say(m) { this.msg = m; if (this.msgT?.active) this.msgT.setText(m); }

  beginCapture(a, slot) {
    this.capturing = { id: a.id, slot, label: a.label };
    this.build();
    input.captureNext((token) => {
      const cap = this.capturing; this.capturing = null;
      if (!cap) return;
      if (token === 'Escape') { this.msg = 'Cancelled.'; this.build(); return; }
      if (token === 'Backspace' || token === 'Delete') { input.unbind(cap.id, cap.slot); this.msg = `Cleared ${cap.label}.`; this.build(); return; }
      const r = input.bind(cap.id, cap.slot, token);
      this.msg = r.ok ? `${cap.label} = ${input.tokenLabel(token)}${r.stolenFrom.length ? `  (removed from ${r.stolenFrom.join(', ')})` : ''}` : r.reason;
      audio.play(r.ok ? 'ui' : 'error', 0.6);
      this.build();
    });
  }
  cancelCapture() { if (this.capturing) { this.capturing = null; input.cancelCapture(); } }

  // slider drag (called from UIScene pointermove/up)
  pointerMove(p) { if (this.dragging && p.isDown) this.dragging(p); }
  pointerUp() { this.dragging = null; }
}
