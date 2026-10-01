import Phaser from 'phaser';
import { loadProfile, saveProfile, loadHero } from '../core/save.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { addTitleBackdrop } from '../systems/titleBackdrop.js';
import { setupMenuCamera } from '../core/display.js';
import { wallet } from '../core/wallet.js';
import { WalletPanel } from '../ui/WalletPanel.js';

// Title screen — pixel-art Game Boy aesthetic.
// Fonts: Jacquard12 (display title), Silkscreen (buttons/labels), PixelifySans (body/hints).
//
// Input notes (why clicks used to feel flaky):
//  * Layout was built once for the launch size and never rebuilt, so after a
//    window resize the drawn buttons and the canvas no longer agreed. The scene
//    now rebuilds itself on scale 'resize'.
//  * Name / room-code entry relied on window.prompt(), which many browsers and
//    embedded webviews silently suppress (click "does nothing"). Text entry is
//    now in-canvas and keyboard driven.
//  * Each button is ONE interactive rectangle (no stacked decorative objects
//    above it), with hover / pressed / keyboard-focus states.
const FOCUS_ORDER = ['name', 'play', 'online', 'host', 'join', 'creator'];

export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    audio.attach(this);
    audio.musicFor('title');
    this.cameras.main.setBackgroundColor('#0f380f');
    // Integer-zoomed, centered logical layout (640x560 max) — see core/display.js
    const { W, H } = this.menuSize = setupMenuCamera(this, { minW: 360, minH: 420, maxW: 640, maxH: 560, data: this.sys.settings.data });

    const prof = loadProfile() || { name: '' };
    this.nameValue = (prof.name || 'Pip').slice(0, 14);
    this.codeValue = '';
    this.focus = 'play';      // keyboard focus item
    this.editing = null;      // 'name' | 'code' | null (text entry mode)
    this.busy = false;
    this.toastMsg = '';

    this.build();

    // Optional wallet chip — never auto-connects, never required to play.
    this.walletPanel = new WalletPanel();
    this.walletPanel.mountTitleChip();
    wallet.restore();

    // Native listener: Phaser's generic 'keydown' fired several times per press
    // for us (repeated letters while typing), so text entry uses the DOM event.
    this.domKey = (ev) => { if (!ev.repeat || this.editing) this.onKey(ev); };
    window.addEventListener('keydown', this.domKey);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', this.domKey);
      if (this.rebuildTimer) this.rebuildTimer.remove(false);
      this.walletPanel?.destroy();
    });
    bus.emit(Events.SYSTEM, 'title');
  }

  onResize() {
    // Debounce: RESIZE mode fires many events while dragging a window edge.
    if (this.rebuildTimer) this.rebuildTimer.remove(false);
    this.rebuildTimer = this.time.delayedCall(60, () => { if (this.scene.isActive()) this.build(); });
  }

  // ─── Layout ─────────────────────────────────────────────────────────
  build() {
    if (this.root) this.root.destroy(true);
    if (this.blinkTimer) this.blinkTimer.remove(false);
    this.root = this.add.container(0, 0);
    this.items = {};
    const add = (o) => { this.root.add(o); return o; };
    addTitleBackdrop(this, this.root, this.menuSize);

    const { W, H } = this.menuSize; // logical centered layout (camera zoom handled by setupMenuCamera)
    const small = W < 560;
    const short = H < 560;
    const bw = Math.min(300, W - 40);
    const bh = small || short ? 30 : 38;

    const titleY = Math.round(H * (short ? 0.10 : 0.13));
    const subY = Math.round(H * (short ? 0.18 : 0.22));
    const labelY = Math.round(H * (short ? 0.255 : 0.30));
    const fieldY = Math.round(H * (short ? 0.325 : 0.38));
    const b1Y = Math.round(H * (short ? 0.44 : 0.50));
    const bottom = H - 34; // keep clear of help text / toast
    // dark glass panel behind the menu column so olive text stays readable on the sky
    const panelTop = titleY - 34, panelBot = H - 12;
    add(this.add.rectangle(W / 2, (panelTop + panelBot) / 2, Math.min(W - 16, Math.max(bw + 64, 560)), panelBot - panelTop, 0x051208, 0.68).setStrokeStyle(2, 0x3e7a2a, 0.9));
    const spacing = Math.max(bh + 10, Math.min(Math.round(H * 0.115) + 8, Math.floor((bottom - b1Y - bh / 2) / 4)));
    const capSize = small ? '11px' : '12px';
    this.cx = W / 2;

    add(this.add.text(W / 2, titleY, 'WAYFARER ONLINE', {
      fontSize: small ? '34px' : short ? '44px' : '56px', color: '#9bbc0f', fontFamily: '"Jacquard12"',
    }).setOrigin(0.5));
    add(this.add.text(W / 2, subY, 'a cozy open world  ~  solo or together', {
      fontSize: small ? '10px' : '13px', color: '#8bac0f', fontFamily: '"PixelifySans"',
    }).setOrigin(0.5));

    // ─── Name field ───
    add(this.add.text(W / 2 - bw / 2, labelY, 'WAYFARER NAME', {
      fontSize: small ? '9px' : '11px', color: '#6b8c0f', fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));
    const fieldH = small || short ? 28 : 34;
    add(this.add.rectangle(W / 2 + 3, fieldY + 3, bw, fieldH, 0x0a1e0a));
    const fieldBorder = add(this.add.rectangle(W / 2, fieldY, bw, fieldH, 0x9bbc0f).setStrokeStyle(2, 0x306230));
    const nameText = add(this.add.text(W / 2 - bw / 2 + 10, fieldY, this.nameValue, {
      fontSize: small ? '14px' : '18px', color: '#0f380f', fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));
    const cursor = add(this.add.text(0, fieldY, '_', {
      fontSize: small ? '14px' : '18px', color: '#0f380f', fontFamily: '"Silkscreen"',
    }).setOrigin(0, 0.5));
    this.blinkTimer = this.time.addEvent({ delay: 530, loop: true, callback: () => { cursor.setAlpha(cursor.alpha ? 0 : 1); } });
    fieldBorder.setInteractive({ useHandCursor: true });
    fieldBorder.on('pointerover', () => { this.hover = 'name'; this.refresh(); });
    fieldBorder.on('pointerout', () => { if (this.hover === 'name') this.hover = null; this.refresh(); });
    fieldBorder.on('pointerdown', () => { audio.ui(); this.setFocus('name'); this.editing = 'name'; this.refresh(); });
    this.items.name = { kind: 'field', border: fieldBorder, nameText, cursor, fieldW: bw };

    // ─── Buttons + captions ───
    const specs = [
      { id: 'play', label: loadHero() ? '> Continue Journey' : '> New Journey', cap: '' },
      { id: 'online', label: '@ Play Online', cap: 'Public world: meet other wayfarers' },
      { id: 'host', label: '+ Host Co-op', cap: 'Host: get a room code to share' },
      { id: 'join', label: '~ Join Co-op', cap: "Join: enter a friend's code" },
      { id: 'creator', label: '* Character Creator', cap: '' },
    ];
    specs.forEach((s, i) => {
      const y = b1Y + spacing * i;
      const x = W / 2;
      add(this.add.rectangle(x + 3, y + 3, bw, bh, 0x0a1e0a));
      const bg = add(this.add.rectangle(x, y, bw, bh, 0x8bac0f).setStrokeStyle(2, 0x306230));
      add(this.add.rectangle(x, y - Math.round(bh / 2) + 3, bw - 8, 2, 0xb4cc22, 0.55));
      const label = add(this.add.text(x, y, s.label, {
        fontSize: small || short ? '12px' : '16px', color: '#0f380f', fontFamily: '"Silkscreen"', align: 'center',
      }).setOrigin(0.5));
      const arrowL = add(this.add.text(x - bw / 2 - 8, y, '>', { fontSize: '16px', color: '#9bbc0f', fontFamily: '"Silkscreen"' }).setOrigin(1, 0.5));
      const arrowR = add(this.add.text(x + bw / 2 + 8, y, '<', { fontSize: '16px', color: '#9bbc0f', fontFamily: '"Silkscreen"' }).setOrigin(0, 0.5));
      const cap = add(this.add.text(x, y + bh / 2 + 9, s.cap, {
        fontSize: capSize, color: '#7fa00f', fontFamily: '"PixelifySans"', align: 'center', wordWrap: { width: W - 24 },
      }).setOrigin(0.5));
      // the background rectangle itself is the hit area: one object, no overlap games
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
      fontSize: small ? '10px' : '12px', color: '#ffdddd', backgroundColor: '#000000aa',
      padding: { x: 8, y: 4 }, fontFamily: '"PixelifySans"', align: 'center', wordWrap: { width: W - 24 },
    }).setOrigin(0.5).setVisible(!!this.toastMsg));
    add(this.add.text(W / 2, H - 16, 'Up/Down choose  Enter select  WASD move  J atk  E talk', {
      fontSize: '9px', color: '#4a7a2a', fontFamily: '"Silkscreen"', align: 'center', wordWrap: { width: W - 24 },
    }).setOrigin(0.5));

    this.refresh();
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
        it.bg.setFillStyle(pressed ? 0x6a8c0f : hot || focused ? 0x9bbc0f : 0x8bac0f);
        it.bg.setStrokeStyle(focused ? 3 : 2, focused ? 0xe8f5a0 : 0x306230);
        it.label.setY(it.y + (pressed ? 1 : 0));
        it.arrowL.setVisible(focused); it.arrowR.setVisible(focused);
        let cap = it.baseCap;
        if (id === 'join' && this.editing === 'code') cap = `CODE: ${this.codeValue}_   Enter = join   Esc = cancel`;
        it.cap.setText(cap); it.cap.setColor(id === 'join' && this.editing === 'code' ? '#e8f5a0' : (focused || hot) ? '#b4cc22' : '#7fa00f');
      } else {
        const editing = this.editing === 'name';
        it.border.setStrokeStyle(focused || editing ? 3 : 2, focused || editing ? 0xe8f5a0 : 0x306230);
        it.border.setFillStyle(editing || hot ? 0xb4cc22 : 0x9bbc0f);
        it.nameText.setText(this.nameValue);
        it.cursor.setX(it.nameText.x + it.nameText.displayWidth + 2);
        it.cursor.setVisible(editing || focused);
      }
    }
  }

  setFocus(id) {
    if (id !== 'name' && this.editing === 'name') this.editing = null;
    if (id !== 'join' && this.editing === 'code') this.editing = null;
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
      const field = this.editing; // 'name' | 'code'
      const cur = field === 'name' ? this.nameValue : this.codeValue;
      if (k === 'Enter') {
        if (field === 'name') { this.editing = null; if (!this.nameValue.trim()) this.nameValue = 'Pip'; this.refresh(); }
        else this.doJoin();
      } else if (k === 'Escape') { this.editing = null; this.refresh(); }
      else if (k === 'Backspace') { this.setField(field, cur.slice(0, -1)); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { this.editing = null; this.moveFocus(k === 'ArrowUp' ? -1 : 1); }
      else if (k.length === 1 && /[\w \-']/.test(k)) {
        if (field === 'name' && cur.length < 14) this.setField('name', cur + k);
        else if (field === 'code' && cur.length < 8 && /[A-Za-z0-9]/.test(k)) this.setField('code', (cur + k).toUpperCase());
      }
      ev.preventDefault?.();
      return;
    }
    if (k === 'ArrowUp' || k === 'w' || k === 'W') this.moveFocus(-1);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') this.moveFocus(1);
    else if (k === 'Enter' || k === ' ') { audio.ui(); this.activate(this.focus); }
    else if (k === 'c' || k === 'C') this.activate('creator');
  }

  setField(field, v) {
    if (field === 'name') this.nameValue = v; else this.codeValue = v;
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
    if (id === 'play') return this.goCreator('solo');
    if (id === 'creator') return this.goCreator(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo');
    if (id === 'host') return this.doHost();
    if (id === 'online') return this.doOnline();
    if (id === 'join') {
      if (this.editing === 'code') return this.doJoin();
      this.editing = 'code'; this.say(''); this.refresh();
    }
  }

  goCreator(mode) {
    const name = this.cleanName();
    saveProfile({ name });
    this.scene.start('creator', { name, mode });
  }

  async doHost() {
    const name = this.cleanName();
    saveProfile({ name });
    this.busy = true; this.say('Creating room...');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      await net.host(name, hero);
      this.say(`ROOM CODE ${net.code} -- tell your friends!  Starting...`);
      setTimeout(() => { this.busy = false; this.scene.start('creator', { name, mode: 'host' }); }, 1400);
    } catch (e) {
      this.busy = false;
      this.say(`Host failed: ${e.message} (server up? try Solo)`); audio.error();
    }
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

  async doJoin() {
    const code = this.codeValue.trim();
    if (!code) { this.say("Type your friend's room code first."); audio.error(); return; }
    const name = this.cleanName();
    saveProfile({ name });
    this.busy = true; this.say('Joining...');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      await net.join(code, name, hero);
      this.busy = false; this.editing = null;
      this.scene.start('creator', { name, mode: 'guest' });
    } catch (e) {
      this.busy = false;
      this.say(`Join failed: ${e.message}`); audio.error();
    }
  }
}
