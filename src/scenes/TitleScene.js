import Phaser from 'phaser';
import { loadProfile, saveProfile, loadHero } from '../core/save.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { setupMenuCamera } from '../core/display.js';
import { canInstall, promptInstall } from '../core/pwa.js';

// Title screen — Solana-inspired teal / purple / dark aesthetic.
// Fonts: Jacquard12 (display title), Silkscreen (buttons/labels), PixelifySans (body/hints).
const FOCUS_ORDER = ['name', 'play', 'online'];

// Solana palette
const SOL = {
  bg: 0x0A0E1A,
  bgLight: 0x1A103C,
  green: '#14F195',
  greenHex: 0x14F195,
  purple: '#9945FF',
  purpleHex: 0x9945FF,
  cyan: '#03E1FF',
  cyanHex: 0x03E1FF,
  magenta: '#DC1FFF',
  white: '#E1E8F0',
  muted: '#6B7A99',
  darkText: '#0A0E1A',
  panelBg: 0x0A0E1A,
};

export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    audio.attach(this);
    audio.musicFor('title');
    // Canvas is transparent; HTML5 video behind it shows through
    const { W, H } = this.menuSize = setupMenuCamera(this, { minW: 360, minH: 420, maxW: 640, maxH: 560, data: this.sys.settings.data });

    const prof = loadProfile() || { name: '' };
    this.nameValue = (prof.name || 'Pip').slice(0, 14);
    this.codeValue = '';
    this.focus = 'play';
    this.editing = null;
    this.busy = false;
    this.toastMsg = '';

    this.build();

    this.domKey = (ev) => { if (!ev.repeat || this.editing) this.onKey(ev); };
    window.addEventListener('keydown', this.domKey);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', this.domKey);
      if (this.rebuildTimer) this.rebuildTimer.remove(false);
    });
    bus.emit(Events.SYSTEM, 'title');
  }

  onResize() {
    if (this.rebuildTimer) this.rebuildTimer.remove(false);
    this.rebuildTimer = this.time.delayedCall(60, () => { if (this.scene.isActive()) this.build(); });
  }

  // ─── Layout ─────────────────────────────────────────────────────────
  build() {
    if (this.root) this.root.destroy(true);
    if (this.blinkTimer) this.blinkTimer.remove(false);
    this.installBtn = null;
    this.root = this.add.container(0, 0);
    this.items = {};
    const add = (o) => { this.root.add(o); return o; };
    const { W, H } = this.menuSize;

    const small = W < 560;
    const short = H < 560;
    const bw = Math.min(300, W - 40);
    const bh = small || short ? 30 : 38;

    const titleY = Math.round(H * (short ? 0.10 : 0.13));
    const subY = Math.round(H * (short ? 0.18 : 0.22));
    const labelY = Math.round(H * (short ? 0.255 : 0.30));
    const fieldY = Math.round(H * (short ? 0.325 : 0.38));
    const b1Y = Math.round(H * (short ? 0.44 : 0.50));
    const bottom = H - 34;

    // Darker semi-transparent panel so video still shows through but UI is readable
    const panelTop = titleY - 34, panelBot = H - 12;
    add(this.add.rectangle(W / 2, (panelTop + panelBot) / 2, Math.min(W - 16, Math.max(bw + 64, 560)), panelBot - panelTop, SOL.panelBg, 0.55).setStrokeStyle(2, SOL.cyanHex, 0.6));

    const spacing = Math.max(bh + 16, Math.min(Math.round(H * 0.13) + 8, Math.floor((bottom - b1Y - bh / 2) / 2)));
    const capSize = small ? '11px' : '12px';
    this.cx = W / 2;

    // ─── Title ───
    add(this.add.text(W / 2, titleY, 'WAYFARER ONLINE', {
      fontSize: small ? '34px' : short ? '44px' : '56px', color: SOL.green, fontFamily: '"Jacquard12"',
    }).setOrigin(0.5).setShadow(0, 2, SOL.cyan, 0.5, false, true));

    add(this.add.text(W / 2, subY, 'a cozy open world  ~  solo or together', {
      fontSize: small ? '10px' : '13px', color: SOL.cyan, fontFamily: '"PixelifySans"',
    }).setOrigin(0.5));

    // ─── Name field ───
    add(this.add.text(W / 2 - bw / 2, labelY, 'WAYFARER NAME', {
      fontSize: small ? '9px' : '11px', color: SOL.muted, fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));

    const fieldH = small || short ? 28 : 34;
    add(this.add.rectangle(W / 2 + 3, fieldY + 3, bw, fieldH, 0x05080f));
    const fieldBorder = add(this.add.rectangle(W / 2, fieldY, bw, fieldH, SOL.greenHex).setStrokeStyle(2, SOL.cyanHex));
    const nameText = add(this.add.text(W / 2 - bw / 2 + 10, fieldY, this.nameValue, {
      fontSize: small ? '14px' : '18px', color: SOL.darkText, fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));
    const cursor = add(this.add.text(0, fieldY, '_', {
      fontSize: small ? '14px' : '18px', color: SOL.darkText, fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));
    this.blinkTimer = this.time.addEvent({ delay: 530, loop: true, callback: () => { cursor.setAlpha(cursor.alpha ? 0 : 1); } });
    fieldBorder.setInteractive({ useHandCursor: true });
    fieldBorder.on('pointerover', () => { this.hover = 'name'; this.refresh(); });
    fieldBorder.on('pointerout', () => { if (this.hover === 'name') this.hover = null; this.refresh(); });
    fieldBorder.on('pointerdown', () => { audio.ui(); this.setFocus('name'); this.editing = 'name'; this.refresh(); });
    this.items.name = { kind: 'field', border: fieldBorder, nameText, cursor, fieldW: bw };

    // ─── Subtle note under name ───
    add(this.add.text(W / 2, fieldY + fieldH / 2 + 10, 'Customize appearance in-game', {
      fontSize: small ? '9px' : '10px', color: SOL.muted, fontFamily: '"PixelifySans"',
    }).setOrigin(0.5));

    // ─── Buttons (only 2: Continue/New + Play Online) ───
    const hasHero = !!loadHero();
    const specs = [
      { id: 'play', label: hasHero ? '> Continue Journey' : '> New Journey', cap: hasHero ? '' : 'Forge your hero, then enter the world' },
      { id: 'online', label: '@ Play Online', cap: 'Public world: meet other wayfarers' },
    ];
    specs.forEach((s, i) => {
      const y = b1Y + spacing * i;
      const x = W / 2;
      add(this.add.rectangle(x + 3, y + 3, bw, bh, 0x05080f));
      const bg = add(this.add.rectangle(x, y, bw, bh, SOL.greenHex).setStrokeStyle(2, SOL.cyanHex));
      add(this.add.rectangle(x, y - Math.round(bh / 2) + 3, bw - 8, 2, 0xffffff, 0.35));
      const label = add(this.add.text(x, y, s.label, {
        fontSize: small || short ? '12px' : '16px', color: SOL.darkText, fontFamily: '"Silkscreen"', align: 'center',
      }).setOrigin(0.5));
      const arrowL = add(this.add.text(x - bw / 2 - 8, y, '>', { fontSize: '16px', color: SOL.green, fontFamily: '"Silkscreen"' }).setOrigin(1, 0.5));
      const arrowR = add(this.add.text(x + bw / 2 + 8, y, '<', { fontSize: '16px', color: SOL.green, fontFamily: '"Silkscreen"' }).setOrigin(0, 0.5));
      const cap = add(this.add.text(x, y + bh / 2 + 9, s.cap, {
        fontSize: capSize, color: SOL.muted, fontFamily: '"PixelifySans"', align: 'center', wordWrap: { width: W - 24 },
      }).setOrigin(0.5));
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => { this.hover = s.id; this.refresh(); });
      bg.on('pointerout', () => { if (this.hover === s.id) this.hover = null; this.pressed = null; this.refresh(); });
      bg.on('pointerdown', () => { this.pressed = s.id; this.setFocus(s.id); this.refresh(); });
      bg.on('pointerup', () => {
        if (this.pressed !== s.id) return;
        this.pressed = null; this.refresh(); audio.ui(); this.activate(s.id);
      });
      this.items[s.id] = { kind: 'btn', bg, label, arrowL, arrowR, cap, baseCap: s.cap, y };
    });

    // toast + help
    this.toast = add(this.add.text(W / 2, H - 50, this.toastMsg, {
      fontSize: small ? '10px' : '12px', color: '#ffb3b3', backgroundColor: '#000000aa',
      padding: { x: 8, y: 4 }, fontFamily: '"PixelifySans"', align: 'center', wordWrap: { width: W - 24 },
    }).setOrigin(0.5).setVisible(!!this.toastMsg));
    // ─── Contract address box ───
    const caY = H - 42;
    const caBox = add(this.add.rectangle(W / 2, caY, bw - 20, 18, 0x05080f, 0.85).setStrokeStyle(1, SOL.cyanHex, 0.4));
    const caText = add(this.add.text(W / 2, caY, 'CA: TBA', {
      fontSize: small ? '8px' : '10px', color: SOL.muted, fontFamily: '"Silkscreen"',
    }).setOrigin(0.5));
    caBox.setInteractive({ useHandCursor: true });
    caBox.on('pointerover', () => { caBox.setStrokeStyle(1, SOL.green, 0.8); caText.setColor(SOL.green); });
    caBox.on('pointerout', () => { caBox.setStrokeStyle(1, SOL.cyanHex, 0.4); caText.setColor(SOL.muted); });
    caBox.on('pointerup', () => { this.say('Contract address coming at launch!'); });

    add(this.add.text(W / 2, H - 22, 'Up/Down choose  Enter select  WASD move  J atk  E talk', {
      fontSize: '9px', color: SOL.muted, fontFamily: '"Silkscreen"', align: 'center', wordWrap: { width: W - 24 },
    }).setOrigin(0.5));

    // ─── Social links row ───
    const socialY = H - 18;
    const social = add(this.add.text(W - 12, socialY, '𝕏  @Wayfarer_Online', {
      fontSize: small ? '10px' : '12px', color: SOL.green, fontFamily: '"Silkscreen"',
    }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true }));
    social.on('pointerover', () => social.setColor('#ffffff'));
    social.on('pointerout', () => social.setColor(SOL.green));
    social.on('pointerup', () => window.open('https://x.com/Wayfarer_Online', '_blank', 'noopener,noreferrer'));

    const docs = add(this.add.text(12, socialY, '📖 Docs', {
      fontSize: small ? '10px' : '12px', color: SOL.cyan, fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true }));
    docs.on('pointerover', () => docs.setColor('#ffffff'));
    docs.on('pointerout', () => docs.setColor(SOL.cyan));
    docs.on('pointerup', () => window.open('/docs/', '_blank', 'noopener,noreferrer'));

    // ─── PWA install button ───
    this.installBtn = null;
    if (canInstall()) this.showInstallButton(W, H, small);
    this.installListener = () => { if (canInstall() && !this.installBtn) this.showInstallButton(W, H, small); };
    window.addEventListener('wf-can-install', this.installListener);
    this.events.once('shutdown', () => window.removeEventListener('wf-can-install', this.installListener));

    this.refresh();
  }

  showInstallButton(W, H, small) {
    if (this.installBtn) return;
    const btnW = small ? 120 : 150;
    const btnH = small ? 22 : 26;
    const y = H - 64;
    const x = W / 2;
    const g = this.add.container(x, y);
    g.setDepth(10);
    const bg = this.add.rectangle(0, 0, btnW, btnH, SOL.greenHex).setStrokeStyle(2, SOL.cyanHex);
    const label = this.add.text(0, 0, '⬇️ Install App', {
      fontSize: small ? '10px' : '12px', color: SOL.darkText, fontFamily: '"Silkscreen"', align: 'center',
    }).setOrigin(0.5);
    g.add([bg, label]);
    this.root.add(g);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => { bg.setFillStyle(0x0db87a); label.setScale(1.05); });
    bg.on('pointerout', () => { bg.setFillStyle(SOL.greenHex); label.setScale(1); });
    bg.on('pointerdown', () => { bg.setFillStyle(0x0aa86c); label.setY(1); });
    bg.on('pointerup', async () => {
      bg.setFillStyle(SOL.greenHex); label.setY(0);
      audio.ui();
      const accepted = await promptInstall();
      if (accepted) { g.setVisible(false); this.installBtn = null; }
    });
    this.installBtn = g;
  }

  // ─── State → visuals ────────────────────────────────────────────────
  refresh() {
    if (!this.items) return;
    for (const id of FOCUS_ORDER) {
      const it = this.items[id];
      if (!it) continue;
      const focused = this.focus === id;
      const hot = this.hover === id;
      if (it.kind === 'btn') {
        const pressed = this.pressed === id;
        it.bg.setFillStyle(pressed ? 0x0db87a : hot || focused ? SOL.greenHex : 0x0db87a);
        it.bg.setStrokeStyle(focused ? 3 : 2, focused ? SOL.cyanHex : SOL.purpleHex);
        it.label.setY(it.y + (pressed ? 1 : 0));
        it.arrowL.setVisible(focused); it.arrowR.setVisible(focused);
        let cap = it.baseCap;
        it.cap.setText(cap); it.cap.setColor((focused || hot) ? SOL.cyan : SOL.muted);
      } else {
        const editing = this.editing === 'name';
        it.border.setStrokeStyle(focused || editing ? 3 : 2, focused || editing ? SOL.cyanHex : SOL.purpleHex);
        it.border.setFillStyle(editing || hot ? 0x0db87a : SOL.greenHex);
        it.nameText.setText(this.nameValue);
        it.cursor.setX(it.nameText.x + it.nameText.displayWidth + 2);
        it.cursor.setVisible(editing || focused);
      }
    }
  }

  setFocus(id) {
    if (id !== 'name' && this.editing === 'name') this.editing = null;
    this.focus = id;
  }

  say(s) {
    this.toastMsg = s;
    if (this.toast && this.toast.active) { this.toast.setText(s); this.toast.setVisible(!!s); }
  }

  // ─── Keyboard ───────────────────────────────────────────────────────
  onKey(ev) {
    const k = ev.key;
    if (this.editing) {
      const field = this.editing;
      const cur = this.nameValue;
      if (k === 'Enter') {
        this.editing = null; if (!this.nameValue.trim()) this.nameValue = 'Pip'; this.refresh();
      } else if (k === 'Escape') { this.editing = null; this.refresh(); }
      else if (k === 'Backspace') { this.setField('name', cur.slice(0, -1)); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { this.editing = null; this.moveFocus(k === 'ArrowUp' ? -1 : 1); }
      else if (k.length === 1 && /[\w \-']/.test(k)) {
        if (cur.length < 14) this.setField('name', cur + k);
      }
      ev.preventDefault?.();
      return;
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') this.moveFocus(-1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') this.moveFocus(1);
    else if (k === 'Enter' || k === ' ') { audio.ui(); this.activate(this.focus); }
  }

  setField(field, v) {
    if (field === 'name') this.nameValue = v;
    this.refresh();
  }

  moveFocus(d) {
    const i = FOCUS_ORDER.indexOf(this.focus);
    this.focus = FOCUS_ORDER[(i + d + FOCUS_ORDER.length) % FOCUS_ORDER.length];
    this.refresh();
  }

  // ─── Actions ────────────────────────────────────────────────────────
  cleanName() { return (this.nameValue.trim() || 'Pip').slice(0, 14); }

  activate(id) {
    if (this.busy) return;
    if (id === 'name') { this.editing = 'name'; this.refresh(); return; }
    if (id === 'play') {
      const hasHero = !!loadHero();
      // New Journey always goes through creator first
      if (!hasHero) return this.goCreator('solo');
      // Continue Journey skips creator and goes straight to world
      return this.goWorld('solo');
    }
    if (id === 'online') return this.doOnline();
  }

  goCreator(mode) {
    const name = this.cleanName();
    saveProfile({ name });
    this.scene.start('creator', { name, mode });
  }

  goWorld(mode) {
    const name = this.cleanName();
    saveProfile({ name });
    // Continue: skip creator, go straight to gameplay
    this.scene.start('world', { name, mode, hero: loadHero() });
  }

  async doOnline() {
    const name = this.cleanName();
    saveProfile({ name });
    this.busy = true; this.say('Connecting to the public world...');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      const shard = await net.joinPublic(name, hero);
      this.busy = false;
      this.scene.start('creator', { name, mode: 'online', shard });
    } catch (e) {
      this.busy = false;
      this.say(`Online failed: ${e.message} (server up? try Solo)`); audio.error();
    }
  }
}
