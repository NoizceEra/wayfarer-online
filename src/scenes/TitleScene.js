import Phaser from 'phaser';
import { loadProfile, saveProfile, loadHero, listLocalCharacters } from '../core/save.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { addTitleBackdrop } from '../systems/titleBackdrop.js';
import { setupMenuCamera } from '../core/display.js';
import {
  ensureRecoveryCode, savedRecoveryCode, continueWithCode, normalizeRecoveryCode,
  isPlausibleCode, groupCode, isFreshDevice, isRecoveryAcked, ackRecovery, localDeviceToken, fetchStatus,
} from '../net/identity.js';

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
const FOCUS_ORDER = ['name', 'play', 'online', 'host', 'join', 'creator', 'continue', 'code'];

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
    this.editing = null;      // 'name' | 'code' | 'recovery' | null (text entry mode)
    this.busy = false;
    this.toastMsg = '';
    // Identity (anon device token) — distinct from the transport 'guest' mode.
    this.recoveryValue = '';  // typed recovery code (identity, not a room code)
    this.codePanel = null;    // recovery-code panel container, when open
    this.codePanelLinked = false;
    this.hintMsg = null;      // title-screen hint currently shown in the toast

    this.build();

    // Native listener: Phaser's generic 'keydown' fired several times per press
    // for us (repeated letters while typing), so text entry uses the DOM event.
    this.domKey = (ev) => { if (!ev.repeat || this.editing) this.onKey(ev); };
    window.addEventListener('keydown', this.domKey);
    this.events.once('shutdown', () => {
      window.removeEventListener('keydown', this.domKey);
      if (this.rebuildTimer) this.rebuildTimer.remove(false);
    });
    bus.emit(Events.SYSTEM, 'title');

    // A brand-new anonymous identity gets its recovery code offered ONCE — the
    // anonymous path stays the primary flow, this is just an afterthought.
    if (isFreshDevice() && !isRecoveryAcked()) this.time.delayedCall(600, () => { this.offerRecovery(); });
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
    this.codePanel = null;    // the recovery panel lives inside root: it was just destroyed
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

    // ─── Identity row (secondary, additive): continue on this device + my code ───
    // Sits under the subtitle, above WAYFARER NAME, so the main menu geometry is
    // untouched. Both are the same "one interactive rectangle" button shape.
    {
      const secH = small || short ? 18 : 20;
      const secY = Math.round(subY + (short ? 17 : 24));
      const secW = Math.min(bw, W - 40);
      const halfW = Math.floor((secW - 8) / 2);
      const secFont = small ? '8px' : '9px';
      const specs2 = [
        { id: 'continue', label: '~ Continue' },   // identity: recover this device
        { id: 'code', label: '* My Code' },        // identity: show the recovery code
      ];
      specs2.forEach((s, i) => {
        const x = W / 2 + (i === 0 ? -(halfW / 2 + 4) : (halfW / 2 + 4));
        const bg = add(this.add.rectangle(x, secY, halfW, secH, 0x8bac0f).setStrokeStyle(2, 0x306230));
        const label = add(this.add.text(x, secY, s.label, {
          fontSize: secFont, color: '#0f380f', fontFamily: '"Silkscreen"', align: 'center',
        }).setOrigin(0.5));
        const arrowL = add(this.add.text(x - halfW / 2 - 6, secY, '>', { fontSize: '12px', color: '#9bbc0f', fontFamily: '"Silkscreen"' }).setOrigin(1, 0.5).setVisible(false));
        const arrowR = add(this.add.text(x + halfW / 2 + 6, secY, '<', { fontSize: '12px', color: '#9bbc0f', fontFamily: '"Silkscreen"' }).setOrigin(0, 0.5).setVisible(false));
        // no room for captions here; hints for these two render in the toast line
        const cap = add(this.add.text(x, secY, '', { fontSize: '1px', color: '#7fa00f' }).setOrigin(0.5).setVisible(false));
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerover', () => { this.hover = s.id; this.refresh(); });
        bg.on('pointerout', () => { if (this.hover === s.id) this.hover = null; this.pressed = null; this.refresh(); });
        bg.on('pointerdown', () => { this.pressed = s.id; this.setFocus(s.id); this.refresh(); });
        bg.on('pointerup', () => {
          if (this.pressed !== s.id) return;
          this.pressed = null; this.refresh(); audio.ui(); this.activate(s.id);
        });
        this.items[s.id] = { kind: 'btn', bg, label, arrowL, arrowR, cap, baseCap: '', y: secY };
      });
    }

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

    // Identity hints: the two secondary controls have no caption line of their
    // own, so their explanation uses the toast line while focused/hovered.
    const hint = this.editing === 'recovery' ? null
      : (this.focus === 'continue' || this.hover === 'continue') ? 'Have a recovery code? Continue your wayfarer on this device.'
        : (this.focus === 'code' || this.hover === 'code') ? 'Your recovery code — the only way back on a new phone or browser.'
          : null;
    if (hint) { this.hintMsg = hint; this.say(hint); } else if (this.hintMsg) {
      const was = this.hintMsg; this.hintMsg = null;
      if (this.toastMsg === was) this.say('');
    }
  }

  setFocus(id) {
    if (id !== 'name' && this.editing === 'name') this.editing = null;
    if (id !== 'join' && this.editing === 'code') this.editing = null;
    if (id !== 'continue' && this.editing === 'recovery') this.editing = null;
    this.focus = id;
  }

  say(s) {
    this.toastMsg = s;
    if (this.toast && this.toast.active) { this.toast.setText(s); this.toast.setVisible(!!s); }
  }

  // ─── Keyboard ───────────────────────────────────────────────────────
  onKey(ev) {
    const k = ev.key;
    // Recovery-code panel is modal: Enter/Esc acknowledge it, nothing else.
    if (this.codePanel) {
      if (k === 'Enter' || k === 'Escape') this.closeRecoveryPanel();
      ev.preventDefault?.();
      return;
    }
    if (this.editing) {
      const field = this.editing; // 'name' | 'code' | 'recovery'
      const cur = field === 'name' ? this.nameValue : field === 'recovery' ? this.recoveryValue : this.codeValue;
      if (k === 'Enter') {
        if (field === 'name') { this.editing = null; if (!this.nameValue.trim()) this.nameValue = 'Pip'; this.refresh(); }
        else if (field === 'recovery') this.doContinueWithCode();
        else this.doJoin();
      } else if (k === 'Escape') { this.editing = null; this.refresh(); }
      else if (k === 'Backspace') { this.setField(field, cur.slice(0, -1)); if (field === 'recovery') this.showTypedCode(); }
      else if (k === 'ArrowUp' || k === 'ArrowDown') { this.editing = null; this.moveFocus(k === 'ArrowUp' ? -1 : 1); }
      else if (k.length === 1 && /[\w \-']/.test(k)) {
        if (field === 'name' && cur.length < 14) this.setField('name', cur + k);
        else if (field === 'code' && cur.length < 8 && /[A-Za-z0-9]/.test(k)) this.setField('code', (cur + k).toUpperCase());
        else if (field === 'recovery' && cur.length < 20 && /[A-Za-z0-9]/.test(k)) {
          this.setField('recovery', cur + k.toUpperCase());
          this.showTypedCode();
        }
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
    if (field === 'name') this.nameValue = v;
    else if (field === 'recovery') this.recoveryValue = v;
    else this.codeValue = v;
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
    if (id === 'continue') {                      // identity: continue on this device
      if (this.editing === 'recovery') return this.doContinueWithCode();
      this.editing = 'recovery'; this.recoveryValue = ''; this.say('');
      this.showTypedCode();
      return;
    }
    if (id === 'code') return this.showCode();    // identity: show my recovery code
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

  // ─── Identity: recovery code (anon -> linked) ───────────────────────
  // Anonymous play stays the primary path: everything below is additive and
  // never blocks solo / online / co-op. Not to be confused with the transport
  // 'guest' mode above (a client in someone else's co-op room).
  showTypedCode() {
    this.say(`RECOVERY CODE: ${groupCode(this.recoveryValue)}_   Enter = continue   Esc = cancel`);
  }

  // Offer a NEW anonymous identity its recovery code exactly once.
  async offerRecovery() {
    if (this.codePanel || this.busy || !this.scene.isActive()) return;
    const token = net.token || localDeviceToken();
    if (!token) return;
    const { code, linked } = await ensureRecoveryCode(token);
    if (this.codePanel || this.busy) return;      // player moved on
    this.showRecoveryPanel(code, linked);
  }

  async showCode() {
    if (this.codePanel || this.busy) return;
    const token = net.token || localDeviceToken();
    if (!token) { this.say('No wayfarer identity yet — start a journey first.'); return; }
    this.say(savedRecoveryCode() ? 'Checking your recovery code...' : 'Creating your recovery code...');
    const { code, linked, error } = await ensureRecoveryCode(token);
    if (!code) { this.say(`Could not create a recovery code (${error || 'offline'}).`); audio.error(); return; }
    this.showRecoveryPanel(code, linked, error);
  }

  showRecoveryPanel(code, linked, error) {
    if (this.codePanel) return;
    const { W, H } = this.menuSize;
    const px = W / 2; const py = H / 2;
    const w = Math.min(W - 20, 440); const h = Math.min(H - 20, 200);
    const top = py - h / 2;
    const c = this.add.container(0, 0);
    this.root.add(c);
    c.add(this.add.rectangle(px, py, W, H, 0x000000, 0.55));   // scrim
    c.add(this.add.rectangle(px, py, w, h, 0x051208, 0.98).setStrokeStyle(2, 0x9bbc0f));
    c.add(this.add.text(px, top + 16, 'YOUR RECOVERY CODE', {
      fontSize: '12px', color: '#9bbc0f', fontFamily: '"Silkscreen"',
    }).setOrigin(0.5));
    const codeText = this.add.text(px, top + 48, groupCode(code), {
      fontSize: '18px', color: '#e8f5a0', fontFamily: '"Silkscreen"', align: 'center',
    }).setOrigin(0.5);
    c.add(codeText);
    const copyLabel = this.add.text(px, top + 76, 'TAP TO COPY', {
      fontSize: '10px', color: '#b4cc22', fontFamily: '"Silkscreen"',
    }).setOrigin(0.5);
    c.add(copyLabel);
    const hint = this.add.text(px, top + 104, linked
      ? 'Save this now (note, password manager, paper). It is the ONLY way back to these characters on another device or browser.'
      : `Not registered yet (${error || 'relay unreachable'}) — open "* My Code" again when you are online.`,
    {
      fontSize: '10px', color: linked ? '#7fa00f' : '#ffdddd', fontFamily: '"PixelifySans"',
      align: 'center', wordWrap: { width: w - 24 },
    }).setOrigin(0.5);
    c.add(hint);
    const done = this.add.rectangle(px, py + h / 2 - 20, Math.min(220, w - 40), 24, 0x8bac0f).setStrokeStyle(2, 0x306230);
    c.add(done);
    c.add(this.add.text(px, py + h / 2 - 20, linked ? 'DONE — I SAVED IT' : 'CLOSE', {
      fontSize: '11px', color: '#0f380f', fontFamily: '"Silkscreen"',
    }).setOrigin(0.5));
    codeText.setInteractive({ useHandCursor: true });
    codeText.on('pointerdown', () => this.copyCode(groupCode(code)));
    copyLabel.setInteractive({ useHandCursor: true });
    copyLabel.on('pointerdown', () => this.copyCode(groupCode(code)));
    done.setInteractive({ useHandCursor: true });
    done.on('pointerup', () => { audio.ui(); this.closeRecoveryPanel(); });
    this.codePanel = { c, linked, code: groupCode(code), copyLabel, hint };
    this.busy = true;              // modal: the menu underneath ignores clicks
  }

  closeRecoveryPanel() {
    if (!this.codePanel) return;
    const linked = this.codePanel.linked;
    try { this.codePanel.c.destroy(true); } catch { /* ignore */ }
    this.codePanel = null;
    this.busy = false;
    if (linked && !isRecoveryAcked()) { ackRecovery(); this.say('Recovery code saved. Keep it somewhere safe.'); }
    else if (!linked) this.say('Code not registered — open "* My Code" again once you are online.');
  }

  copyCode(flat) {
    const done = (ok) => {
      if (!this.codePanel) return;
      this.codePanel.copyLabel.setText(ok ? 'COPIED!' : 'COPY FAILED — WRITE IT DOWN');
      this.codePanel.hint.setText(ok ? 'Copied. Paste it into a note or password manager.' : 'Write the code down by hand — it is the only way back.');
      this.codePanel.hint.setColor(ok ? '#b4cc22' : '#ffdddd');
    };
    const legacy = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = flat; document.body.appendChild(ta); ta.select();
        const r = document.execCommand('copy'); ta.remove(); return !!r;
      } catch { return false; }
    };
    try {
      const p = navigator.clipboard?.writeText(flat);
      if (p?.then) p.then(() => done(true)).catch(() => done(legacy()));
      else done(legacy());
    } catch { done(legacy()); }
  }

  async doContinueWithCode() {
    const raw = normalizeRecoveryCode(this.recoveryValue);
    if (!isPlausibleCode(raw)) { this.say('That code looks too short — recovery codes are 20 characters.'); audio.error(); return; }
    this.busy = true; this.say('Recovering your wayfarer...');
    try {
      const token = await continueWithCode(raw);   // server MINTS a new token, never returns an existing one
      if (!net.useToken(token)) throw new Error('bad_token');
      this.editing = null;
      let n = 0;
      try { n = (await fetchStatus(net.token)).chars.length; } catch { /* the join still restores them */ }
      if (!n) n = listLocalCharacters().length;
      this.busy = false;
      this.say(n ? `Welcome back — ${n} character${n === 1 ? '' : 's'} here. Pick how to play.`
        : 'Device linked. Pick how to play — your characters load when you join.');
      this.build();
    } catch (e) {
      this.busy = false;
      this.say(e.code === 'code_unknown' || e.status === 404
        ? 'No account found for that code. Check it and try again.'
        : `Continue failed: ${e.message}`);
      audio.error();
    }
  }
}
