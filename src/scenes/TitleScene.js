import Phaser from 'phaser';
import { saveProfile, loadHero, loadProgress } from '../core/save.js';
import { listSlots, activeSlot, freeSlotId, setActiveSlot, nameTaken, MAX_SLOTS } from '../core/slots.js';
import { net } from '../net/NetworkManager.js';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { addTitleBackdrop, prefersReducedMotion } from '../systems/titleBackdrop.js';
import { setupMenuCamera } from '../core/display.js';
import { settings, DEFAULT_SETTINGS, UI_SCALES } from '../core/settings.js';
import { settings as fx } from '../systems/fxSettings.js';
import { input } from '../core/input.js';
import { JOBS } from '../data/jobs.js';
import { NEWS } from '../data/news.js';
import { randomName } from '../data/names.js';
import { wallet, MOBILE_HINT } from '../core/wallet.js';
import { WalletPanel } from '../ui/WalletPanel.js';
import { whenWorldReady } from '../assets/worldLoad.js';
import {
  C, FONT, txt, frame, makeButton, makeField, Nav, DomEntry, addLogo, bindTitleNav, ago, copyText,
} from '../ui/titleKit.js';

const TILE = 16;
const BODY = { knight: 'Villager', mangreen: 'ManGreen', sorcererorange: 'SorcererOrange', ninjadark: 'NinjaDark' };
const OVERWORLD = [
  { name: 'Thistle Town', rect: { x: 48, y: 48, w: 32, h: 32 } },
  { name: 'Meadowfield', rect: { x: 8, y: 8, w: 112, h: 112 } },
  { name: 'Mosswood', rect: { x: 80, y: 16, w: 40, h: 56 } },
  { name: 'Tidehollow Ruins', rect: { x: 16, y: 80, w: 48, h: 40 } },
];
const NAME_RE = /[\w \-']/;
const CODE_RE = /[A-Za-z0-9]/;
const VER = typeof __BUILD_ID__ !== 'undefined' ? String(__BUILD_ID__).split('-')[0] : '0.1.0';

function jobName(id) { return JOBS[id]?.name || 'Wayfarer'; }
function zoneName(p) {
  if (!p || p.x == null || p.y == null) return 'Thistle Town';
  const tx = Math.floor(p.x / TILE), ty = Math.floor(p.y / TILE);
  const sorted = [...OVERWORLD].sort((a, b) => (a.rect.w * a.rect.h) - (b.rect.w * b.rect.h));
  for (const z of sorted) {
    const r = z.rect;
    if (tx >= r.x && ty >= r.y && tx < r.x + r.w && ty < r.y + r.h) return z.name;
  }
  return 'Embervale';
}

export class TitleScene extends Phaser.Scene {
  constructor() { super('title'); }

  create() {
    audio.attach(this);
    audio.musicFor('title');
    this.cameras.main.setBackgroundColor('#0f380f');
    this.persist = this.sys.settings.data && typeof this.sys.settings.data === 'object' ? this.sys.settings.data : {};
    this.sys.settings.data = this.persist;
    const { W, H } = this.menuSize = setupMenuCamera(this, { minW: 320, minH: 320, maxW: 720, maxH: 720, data: this.persist });
    void W; void H;

    this.page = this.persist.page || 'home';
    this.nameDraft = this.persist.nameDraft || '';
    this.codeValue = this.persist.codeValue || '';
    this.toastMsg = this.persist.toastMsg || '';
    this.busy = false;
    this.probe = (typeof window !== 'undefined' && window.__netProbe?.()) || { up: null, players: 0, ping: null };
    this.nav = new Nav();
    this.entry = new DomEntry();
    this.logo = null;
    this.bd = null;

    this.build();
    // Restore the remembered "the user chose to link" state, then let the wallet's own change
    // event rebuild this screen. Deliberately do NOT mount wallet-marks' DOM chip here: this
    // scene already provides the wallet entry point in-canvas, so mounting the chip as well
    // would put two wallet affordances on the title screen. The signed link/relink flow is
    // still reachable — the wallet page opens WalletPanel (see buildWallet below).
    this.walletPanel = null;
    wallet.restore().catch(() => {});
    bindTitleNav(this, this.nav, { isOpen: () => this.page !== 'home', close: () => this.goPage('home') });
    this.offWallet = wallet.on('change', () => { if (this.scene.isActive()) this.build(); });
    this.events.once('shutdown', () => {
      this.entry.stop(true);
      this.bd?.destroy();
      this.offWallet?.();
      this.walletPanel?.destroy?.();
    });
    whenWorldReady().then(() => { if (this.scene.isActive() && this.page === 'home') this.build(); }).catch(() => {});
    this.pollServer();
    this.time.addEvent({ delay: 8000, loop: true, callback: () => this.pollServer() });
    bus.emit(Events.SYSTEM, 'title');
  }

  update(time, delta) {
    this.bd?.update(time, delta);
    this.logo?.tick?.(time);
  }

  goPage(page, extra = {}) {
    if (this.busy && page !== 'home') return;
    this.entry.stop(true);
    this.page = this.persist.page = page;
    Object.assign(this.persist, extra);
    Object.assign(this, extra);
    this.build();
  }

  say(s) {
    this.toastMsg = this.persist.toastMsg = s || '';
    if (this.toast && this.toast.active) { this.toast.setText(this.toastMsg); this.toast.setVisible(!!this.toastMsg); }
  }

  async pollServer() {
    if (!this.scene.isActive()) return;
    if (typeof window !== 'undefined' && window.__netProbe) {
      this.probe = window.__netProbe() || this.probe;
      this.refreshOnlineCap();
      return;
    }
    try {
      const url = CONFIG.serverUrl.replace(/^ws/, 'http');
      const t0 = performance.now();
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 4000);
      const r = await fetch(`${url}/stats`, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const j = await r.json();
      this.probe = { up: !!j.ok, players: j.players || 0, ping: Math.round(performance.now() - t0) };
    } catch { this.probe = { up: false, players: 0, ping: null }; }
    if (this.scene.isActive()) this.refreshOnlineCap();
  }

  refreshOnlineCap() {
    const p = this.probe;
    const cap = p.up == null ? 'Checking the public world…'
      : p.up ? `Server up · ${p.ping != null ? p.ping + ' ms · ' : ''}${p.players} online`
        : 'Server offline · solo still works';
    this.onlineBtn?.setSub(cap);
  }

  onlineCap() {
    const p = this.probe;
    if (p.up == null) return 'Checking the public world…';
    if (p.up) return `Server up · ${p.ping != null ? p.ping + ' ms · ' : ''}${p.players} online`;
    return 'Server offline · solo still works';
  }

  guestName() { return randomName((n) => nameTaken(n)); }

  // ─── Layout ─────────────────────────────────────────────────────────
  build() {
    this.entry.stop(true);
    this.bd?.destroy();
    if (this.root) this.root.destroy(true);
    this.root = this.add.container(0, 0);
    this.nav.clear();
    this.onlineBtn = null;
    this.toast = null;
    this.logo = null;
    const add = (o) => { this.root.add(o); return o; };
    this.bd = addTitleBackdrop(this, this.root, this.menuSize);

    const { W, H } = this.menuSize;
    this.wide = W >= 560;
    this.short = H < 420;
    this.portrait = H > W + 40;
    this.cx = W / 2;

    if (this.page === 'home') this.buildHome(add, W, H);
    else if (this.page === 'journey') this.buildJourney(add, W, H);
    else if (this.page === 'join') this.buildJoin(add, W, H);
    else if (this.page === 'news') this.buildNews(add, W, H);
    else if (this.page === 'settings') this.buildSettings(add, W, H);
    else if (this.page === 'help') this.buildHelp(add, W, H);
    else if (this.page === 'wallet') this.buildWallet(add, W, H);
    else this.buildHome(add, W, H);

    this.toast = add(txt(this, this.root, W / 2, H - 36, this.toastMsg, {
      size: 11, font: FONT.body, color: '#ffd0c4', wrap: W - 24,
    }).setVisible(!!this.toastMsg));
    this.nav.first();
  }

  footer(add, W, H, extra = '') {
    const line = extra || `v${VER}  ·  play first, earn second  ·  Ninja Adventure (CC0)`;
    add(txt(this, this.root, W / 2, H - 14, line, { size: 8, color: C.dim, wrap: W - 16 }));
  }

  buildHome(add, W, H) {
    const reduce = prefersReducedMotion();
    const hero = activeSlot();
    const pad = 16;
    const logoSize = this.short ? 22 : this.portrait ? 28 : this.wide ? 40 : 30;
    const logoY = this.short ? 28 : Math.round(H * 0.09);
    this.logo = addLogo(this, this.root, W / 2, logoY, { size: logoSize, reduce, sub: 'solo or together' });

    const colW = Math.min(this.wide && !this.portrait ? 260 : W - pad * 2, W - pad * 2);
    const bw = Math.min(300, colW);
    const bh = this.short ? 26 : 32;
    const leftX = this.wide && !this.portrait ? Math.round(W * 0.30) : W / 2;
    const rightX = this.wide && !this.portrait ? Math.round(W * 0.72) : W / 2;
    const menuTop = this.wide && !this.portrait ? Math.round(H * 0.28) : logoY + this.logo.h / 2 + 10;

    if (hero) this.drawHeroCard(add, leftX, menuTop + (this.wide && !this.portrait ? 8 : 0), Math.min(bw, 280), hero);
    else {
      frame(this, this.root, leftX, menuTop + 36, Math.min(bw, 280), 72, { alpha: 0.78 });
      txt(this, this.root, leftX, menuTop + 24, 'New here?', { size: 11, color: C.gold_s });
      txt(this, this.root, leftX, menuTop + 48, 'Hit Play. We pick a friendly name.\nWallet is optional — never required.', {
        size: 10, font: FONT.body, color: C.text, wrap: Math.min(bw, 280) - 16, lineSpacing: 2,
      });
    }

    const specs = [];
    if (hero) specs.push({ id: 'play', label: 'Continue', kind: 'primary', sub: `${hero.name} · Lv ${hero.level}`, click: () => this.continueHero(hero) });
    else specs.push({ id: 'play', label: 'Play', kind: 'primary', sub: 'One click · guest name', click: () => this.playGuest() });
    specs.push(
      { id: 'online', label: 'Play Online', sub: this.onlineCap(), click: () => this.doOnline() },
      { id: 'journey', label: 'New Journey', sub: 'Name your wayfarer', click: () => this.goPage('journey') },
      { id: 'join', label: 'Join with code', sub: "A friend's 5-letter room", click: () => this.goPage('join') },
      { id: 'host', label: 'Host co-op', sub: 'Share a room code', click: () => this.doHost() },
    );
    const btnX = rightX;
    let y = menuTop;
    if (!(this.wide && !this.portrait)) y = menuTop + (hero ? 88 : 86);
    specs.forEach((s) => {
      const b = makeButton(this, this.root, this.nav, {
        id: s.id, x: btnX, y, w: bw, h: bh, label: s.label, sub: s.sub, kind: s.kind || 'normal',
        size: this.short ? 10 : 12, onClick: s.click,
      });
      if (s.id === 'online') this.onlineBtn = b;
      y += bh + (this.short ? 6 : 8);
    });

    const rowY = Math.min(H - 58, y + 6);
    const mini = Math.min(88, Math.max(64, (W - 40) / 5));
    const extras = [
      { id: 'heroes', label: 'Heroes', click: () => this.scene.start('profile', { from: 'title' }) },
      { id: 'news', label: "What's new", click: () => this.goPage('news') },
      { id: 'settings', label: 'Settings', click: () => this.goPage('settings') },
      { id: 'help', label: 'Controls', click: () => this.goPage('help') },
      { id: 'wallet', label: wallet.state.linked ? 'Wallet' : 'Wallet', click: () => this.goPage('wallet') },
    ];
    extras.forEach((s, i) => {
      const n = extras.length;
      const x = W / 2 + (i - (n - 1) / 2) * (mini + 6);
      makeButton(this, this.root, this.nav, {
        id: s.id, x, y: rowY, w: mini, h: 22, label: s.label, kind: 'ghost', size: 8, onClick: s.click,
      });
    });
    this.footer(add, W, H, `v${VER}  ·  play first, earn second  ·  Optional: connect wallet`);
  }

  drawHeroCard(add, x, y, w, slot) {
    const h = this.short ? 78 : 92;
    const hit = add(this.add.rectangle(x, y + 4, w, h, 0x0a1c10, 0.88).setStrokeStyle(2, C.goldDk));
    add(this.add.rectangle(x, y + 4, w - 6, h - 6).setStrokeStyle(1, C.oliveDk, 0.8));
    const px = x - w / 2 + 28, py = y + 6;
    add(this.add.rectangle(px, py, 36, 44, 0x07140a).setStrokeStyle(1, C.gold));
    const body = BODY[slot.hero?.body] || BODY[JOBS[slot.hero?.job || slot.job]?.body] || 'Villager';
    const key = `char.${body}`;
    if (this.textures.exists(key)) add(this.add.sprite(px, py + 6, key, 0).setScale(1.7));
    else {
      add(this.add.rectangle(px, py + 6, 10, 16, 0x9bbc0f));
      add(this.add.circle(px, py - 8, 5, 0xc8e060));
    }
    const linked = !!(wallet.state.linked || wallet.state.connected);
    const badge = linked ? 'Wallet linked' : 'Guest';
    txt(this, this.root, x - w / 2 + 52, y - 26, slot.name, { size: 13, origin: [0, 0.5], color: C.gold_s });
    txt(this, this.root, x - w / 2 + 52, y - 10, `${jobName(slot.job)}  ·  Lv ${slot.level}`, { size: 10, origin: [0, 0.5], color: C.text });
    const zone = zoneName(loadProgress(slot.name));
    txt(this, this.root, x - w / 2 + 52, y + 8, zone, { size: 9, font: FONT.body, origin: [0, 0.5], color: C.muted });
    txt(this, this.root, x - w / 2 + 52, y + 24, slot.savedAt ? `Last played ${ago(slot.savedAt)}` : 'Ready to wander', {
      size: 9, font: FONT.body, origin: [0, 0.5], color: C.dim,
    });
    txt(this, this.root, x + w / 2 - 10, y - h / 2 + 14, badge, {
      size: 8, origin: [1, 0.5], color: linked ? C.ok : C.muted,
    });
    const it = {
      id: 'hero', ax: x, ay: y + 4, w, h, enabled: true, visible: true, bg: hit, hover: false,
      onClick: () => this.continueHero(slot),
      render: () => { hit.setStrokeStyle(this.nav.focus === it ? 3 : 2, this.nav.focus === it || it.hover ? C.gold : C.goldDk); },
    };
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => { it.hover = true; this.nav.setFocus(it, true); it.render(); });
    hit.on('pointerout', () => { it.hover = false; it.render(); });
    hit.on('pointerdown', () => this.nav.activate(it));
    this.nav.register(it);
    it.render();
  }

  panel(add, W, H, title) {
    const pw = Math.min(W - 20, 520), ph = Math.min(H - 28, 480);
    frame(this, this.root, W / 2, H / 2 - 6, pw, ph, { alpha: 0.92 });
    txt(this, this.root, W / 2, H / 2 - ph / 2 + 18, title, { size: 16, font: FONT.title, color: C.gold_s });
    return { pw, ph, cx: W / 2, top: H / 2 - ph / 2, bot: H / 2 + ph / 2 - 6 };
  }

  buildJourney(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'NEW JOURNEY');
    if (!this.nameDraft) this.nameDraft = this.persist.nameDraft = this.guestName();
    txt(this, this.root, cx, top + 44, 'Pick a name — or roll the dice.', { size: 11, font: FONT.body, color: C.muted, wrap: pw - 24 });
    const fieldW = Math.min(260, pw - 80);
    const field = makeField(this, this.root, this.nav, this.entry, {
      id: 'name', x: cx - 18, y: top + 78, w: fieldW, h: 30, value: this.nameDraft, max: 14,
      pattern: NAME_RE, label: 'Wayfarer name',
      onChange: (v) => { this.nameDraft = this.persist.nameDraft = v; },
      onCommit: (v) => { this.nameDraft = this.persist.nameDraft = v; },
    });
    makeButton(this, this.root, this.nav, {
      id: 'dice', x: cx + fieldW / 2 + 8, y: top + 78, w: 30, h: 30, label: '?', size: 14, kind: 'ghost',
      onClick: () => { const n = this.guestName(); this.nameDraft = this.persist.nameDraft = n; field.setValue(n); this.entry.set(n); },
    });
    const free = freeSlotId();
    txt(this, this.root, cx, top + 118, free ? `Slot ${free} of ${MAX_SLOTS} is free.` : 'All three slots are full — manage heroes first.', {
      size: 10, font: FONT.body, color: free ? C.muted : C.warn, wrap: pw - 32,
    });
    makeButton(this, this.root, this.nav, {
      id: 'go', x: cx, y: bot - 58, w: Math.min(240, pw - 40), h: 34, label: 'Begin', kind: 'primary',
      enabled: !!free, onClick: () => this.beginJourney(),
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildJoin(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'JOIN WITH CODE');
    txt(this, this.root, cx, top + 46, "Type the host's 5-letter room code.", { size: 11, font: FONT.body, color: C.muted, wrap: pw - 24 });
    makeField(this, this.root, this.nav, this.entry, {
      id: 'code', x: cx, y: top + 84, w: Math.min(220, pw - 40), h: 32, value: this.codeValue, max: 8,
      upper: true, pattern: CODE_RE, placeholder: 'ABCDE', label: 'Room code',
      onChange: (v) => { this.codeValue = this.persist.codeValue = v; },
      onCommit: (v) => { this.codeValue = this.persist.codeValue = v; this.doJoin(); },
    });
    makeButton(this, this.root, this.nav, {
      id: 'join', x: cx, y: bot - 58, w: Math.min(240, pw - 40), h: 34, label: 'Join', kind: 'primary',
      onClick: () => this.doJoin(),
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildNews(add, W, H) {
    const { pw, ph, cx, top, bot } = this.panel(add, W, H, "WHAT'S NEW");
    let y = top + 40;
    for (const block of NEWS) {
      txt(this, this.root, cx - pw / 2 + 18, y, `${block.date}  ·  ${block.title}`, { size: 11, origin: [0, 0.5], color: C.gold_s });
      y += 16;
      for (const line of block.items) {
        txt(this, this.root, cx - pw / 2 + 22, y, `· ${line}`, { size: 10, font: FONT.body, origin: [0, 0.5], color: C.text, wrap: pw - 44 });
        y += 14;
      }
      y += 8;
      if (y > bot - 40) break;
    }
    void ph;
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildSettings(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'SETTINGS');
    const rowW = Math.min(pw - 28, 420);
    let y = top + 48;
    const rowH = Math.min(30, Math.max(24, (bot - 60 - y) / 8));
    const row = (id, label, get, step, click) => {
      makeButton(this, this.root, this.nav, {
        id, x: cx, y, w: rowW, h: rowH - 4, label, kind: 'row', size: 10,
        onClick: click || (() => step?.(1)),
        adjust: step,
      }).setValue(get());
      y += rowH;
    };
    const pct = (k) => `${Math.round(settings.get(k) * 100)}%`;
    const vol = (k) => (d) => {
      settings.set(k, Math.round((settings.get(k) + d * 0.1) * 10) / 10);
      this.build();
    };
    row('master', 'Master volume', () => pct('master'), vol('master'));
    row('music', 'Music', () => pct('music'), vol('music'));
    row('sfx', 'Sound effects', () => pct('sfx'), vol('sfx'));
    row('uiscale', 'UI scale', () => `${settings.get('uiScale')}x`, (d) => {
      const i = UI_SCALES.indexOf(settings.get('uiScale'));
      const ni = Math.max(0, Math.min(UI_SCALES.length - 1, i + d));
      settings.set('uiScale', UI_SCALES[ni]); this.build();
    });
    row('fx', 'Effects quality', () => String(fx.quality).toUpperCase(), (d) => {
      const q = ['low', 'med', 'high']; const i = Math.max(0, q.indexOf(fx.quality));
      fx.setQuality(q[Math.max(0, Math.min(2, i + d))]); this.build();
    });
    row('shake', 'Screen shake', () => (settings.get('shake') ? 'ON' : 'OFF'), () => { settings.set('shake', !settings.get('shake')); this.build(); });
    row('motion', 'Reduce motion', () => (settings.get('reduceMotion') ? 'ON' : 'OFF'), () => { settings.set('reduceMotion', !settings.get('reduceMotion')); this.build(); });
    makeButton(this, this.root, this.nav, {
      id: 'defaults', x: cx - 70, y: bot - 22, w: 120, h: 24, label: 'Defaults', kind: 'ghost', size: 9,
      onClick: () => { for (const k of Object.keys(DEFAULT_SETTINGS)) settings.set(k, DEFAULT_SETTINGS[k]); this.build(); },
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx + 70, y: bot - 22, w: 120, h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildHelp(add, W, H) {
    const { pw, ph, cx, top, bot } = this.panel(add, W, H, 'CONTROLS & HELP');
    const lines = [
      ['Move', `${input.labelFor('moveUp')}/${input.labelFor('moveLeft')}/${input.labelFor('moveDown')}/${input.labelFor('moveRight')} · stick / d-pad`],
      ['Attack', `${input.labelFor('attack')} · gamepad A`],
      ['Talk / use', `${input.labelFor('interact')} · gamepad X`],
      ['Skills 1–6', '1 2 3 4 5 6 · LB RB LT RT L3 R3'],
      ['Bag / Character', `${input.labelFor('bag')} / ${input.labelFor('character')}`],
      ['Help / Pause', `${input.labelFor('help')} / ${input.labelFor('menu')}`],
      ['Title', 'Arrows / WASD / d-pad  ·  Enter  ·  Esc back'],
      ['Touch', 'Tap buttons · left stick in-world'],
    ];
    let y = top + 44;
    const col = pw >= 420 ? 2 : 1;
    const colW = (pw - 28) / col;
    lines.forEach((row, i) => {
      const c = i % col, r = Math.floor(i / col);
      const x = cx - pw / 2 + 18 + c * colW;
      const yy = y + r * 36;
      txt(this, this.root, x, yy, row[0], { size: 9, origin: [0, 0.5], color: C.gold_s });
      txt(this, this.root, x, yy + 10, row[1], { size: 9, font: FONT.body, origin: [0, 0.5], color: C.text, wrap: colW - 8 });
    });
    void ph;
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildWallet(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'OPTIONAL WALLET');
    const lines = [
      'You do not need a wallet to play.',
      'Play is first. A wallet is only a way to sign in later and unlock collectibles.',
      'We never pop a wallet prompt on their own. This screen is the only place that talks about it.',
      wallet.available()
        ? (wallet.state.connected
            ? (wallet.state.linked
                ? `Linked: ${wallet.shortAddress() || 'wallet'}`
                : `Connected: ${wallet.shortAddress() || 'wallet'} — not linked yet`)
            : 'A wallet adapter is ready if you want it.')
        : MOBILE_HINT,
    ];
    let y = top + 48;
    for (const line of lines) {
      txt(this, this.root, cx, y, line, { size: 11, font: FONT.body, color: C.text, wrap: pw - 36, lineSpacing: 2 });
      y += 42;
    }
    const canLink = wallet.available() && wallet.state.connected;
    if (wallet.available()) {
      makeButton(this, this.root, this.nav, {
        id: 'connect', x: cx, y: canLink ? bot - 92 : bot - 58, w: Math.min(260, pw - 40), h: 32,
        label: wallet.state.connected ? 'Disconnect' : 'Connect wallet',
        kind: wallet.state.connected ? 'ghost' : 'normal',
        onClick: async () => {
          try {
            if (wallet.state.connected) await wallet.disconnect();
            else await wallet.connect();
          } catch (e) { this.say(e.message || 'Wallet failed'); audio.error(); }
          this.build();
        },
      });
    }
    // The signed link / relink / claim flow lives in WalletPanel (wallet-marks). This page
    // owns the redesign's presentation, so it OPENS that panel instead of duplicating the
    // flow — without this button, connecting a wallet would prove nothing about ownership.
    if (canLink) {
      makeButton(this, this.root, this.nav, {
        id: 'link', x: cx, y: bot - 58, w: Math.min(260, pw - 40), h: 32,
        label: wallet.state.linked ? 'Manage wallet link' : 'Link to this device',
        kind: wallet.state.linked ? 'ghost' : 'normal',
        onClick: () => {
          try {
            if (!this.walletPanel) this.walletPanel = new WalletPanel();
            this.walletPanel.open();
          } catch (e) { this.say(e.message || 'Wallet panel unavailable'); audio.error(); }
        },
      });
    }
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back to play', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  // ─── Actions ────────────────────────────────────────────────────────
  cleanName(raw) {
    const n = String(raw || this.nameDraft || '').replace(/[^\w \-']/g, '').trim().slice(0, 14);
    return n || this.guestName();
  }

  continueHero(slot) {
    if (this.busy) return;
    setActiveSlot(slot.id);
    saveProfile({ name: slot.name });
    this.goCreator(net.connected ? (net.isHost ? 'host' : 'guest') : 'solo', slot.name);
  }

  playGuest() {
    if (this.busy) return;
    const existing = activeSlot();
    if (existing) return this.continueHero(existing);
    const name = this.guestName();
    const id = freeSlotId() || 1;
    setActiveSlot(id, name);
    saveProfile({ name });
    this.goCreator('solo', name);
  }

  beginJourney() {
    if (this.busy) return;
    const id = freeSlotId();
    if (!id) { this.scene.start('profile', { from: 'title', toast: 'All slots are full.' }); return; }
    const name = this.cleanName(this.nameDraft);
    if (nameTaken(name)) { this.say('Another hero already uses that name.'); audio.error(); return; }
    setActiveSlot(id, name);
    saveProfile({ name });
    this.goCreator('solo', name);
  }

  goCreator(mode, name) {
    const n = name || this.cleanName();
    saveProfile({ name: n });
    this.persist.page = 'home';
    this.scene.start('creator', { name: n, mode });
  }

  async doHost() {
    if (this.busy) return;
    const slot = activeSlot();
    const name = slot?.name || this.cleanName() || this.guestName();
    if (!slot) { const id = freeSlotId() || 1; setActiveSlot(id, name); }
    saveProfile({ name });
    this.busy = true; this.say('Creating room…');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      await net.host(name, hero);
      this.say(`ROOM CODE ${net.code} — tell your friends!`);
      this.time.delayedCall(1200, () => { this.busy = false; this.scene.start('creator', { name, mode: 'host' }); });
    } catch (e) {
      this.busy = false;
      this.say(`Host failed: ${e.message} (server up? try Play)`); audio.error();
    }
  }

  async doOnline() {
    if (this.busy) return;
    const slot = activeSlot();
    const name = slot?.name || this.guestName();
    if (!slot) { const id = freeSlotId() || 1; setActiveSlot(id, name); }
    saveProfile({ name });
    this.busy = true; this.say('Connecting to the public world…');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      const shard = await net.joinPublic(name, hero);
      this.busy = false;
      this.scene.start('creator', { name, mode: 'online', shard });
    } catch (e) {
      this.busy = false;
      this.say(`Online failed: ${e.message} (server up? try Play)`); audio.error();
    }
  }

  async doJoin() {
    if (this.busy) return;
    const code = String(this.codeValue || '').trim();
    if (!code) { this.say("Type your friend's room code first."); audio.error(); return; }
    const slot = activeSlot();
    const name = slot?.name || this.guestName();
    if (!slot) { const id = freeSlotId() || 1; setActiveSlot(id, name); }
    saveProfile({ name });
    this.busy = true; this.say('Joining…');
    try {
      const hero = loadHero() || { name, job: 'wayfarer' };
      await net.join(code, name, hero);
      this.busy = false; this.entry.stop(true);
      this.scene.start('creator', { name, mode: 'guest' });
    } catch (e) {
      this.busy = false;
      this.say(`Join failed: ${e.message}`); audio.error();
    }
  }
}
