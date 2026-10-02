import Phaser from 'phaser';
import { saveProfile, loadHero, loadProgress, listLocalCharacters } from '../core/save.js';
import { listSlots, activeSlot, freeSlotId, setActiveSlot, nameTaken, MAX_SLOTS, exportBackup, importBackup } from '../core/slots.js';
import { net } from '../net/NetworkManager.js';
// Guest-first identity: the device recovery code is the "account without a wallet" path.
// Plain-language UI over src/net/identity.js — no crypto vocabulary anywhere a player can see.
import { ensureRecoveryCode, continueWithCode, isFreshDevice, ackRecovery, isRecoveryAcked } from '../net/identity.js';
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
// Public X / Twitter account, shown clickable in the footer. Kept here as the single
// source for the canvas; index.html carries the same handle in its meta tags and DOM
// splash (static HTML cannot import from here, so keep the two in step).
const SOCIAL_URL = 'https://x.com/Wayfarer_Online';
const SOCIAL_HANDLE = '@Wayfarer_Online';
const openSocial = () => {
  try { window.open(SOCIAL_URL, '_blank', 'noopener,noreferrer'); } catch { /* popup blocked; the handle is still visible */ }
};

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
    // recovery/backup page state (in-memory only; a resize restart re-fetches)
    this.recoverCode = '';
    this.recoverLinked = false;
    this.recoverState = 'idle';   // idle | busy | ready | offline
    this.restoreDraft = '';
    this.probe = (typeof window !== 'undefined' && window.__netProbe?.()) || { up: null, players: 0, ping: null };
    this.nav = new Nav();
    this.entry = new DomEntry();
    this.logo = null;
    this.bd = null;

    // Appear softly the first time this scene instance paints (page changes inside the
    // title are a light panel fade instead — see build()).
    if (!prefersReducedMotion() && !this.persist.shown) this.cameras.main.fadeIn(300, 7, 20, 10);
    this.persist.shown = true;

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
    this._panelFade = page !== this.page;
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
    this.onlineBtn?.setSub(this.enterSub(this._primaryHero));
  }

  // The sub-line of the ONE Enter button. Because there is no longer a mode to choose,
  // the button itself has to say which world you are about to walk into — that is the
  // trade for removing the choice at the door.
  enterSub(hero) {
    const p = this.probe;
    const world = p?.up == null ? 'checking the world…'
      : p.up ? `public world · ${p.players} online`
        : 'offline · solo';
    return hero ? `${hero.name} · Lv ${hero.level} · ${world}` : `one key · ${world}`;
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
    if (this.root) { this.tweens.killTweensOf(this.root); this.root.destroy(true); }
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
    else if (this.page === 'keep') this.buildKeep(add, W, H);
    else if (this.page === 'recover') this.buildRecover(add, W, H);
    else this.buildHome(add, W, H);

    this.toast = add(txt(this, this.root, W / 2, H - 36, this.toastMsg, {
      size: 11, font: FONT.body, color: '#ffd0c4', wrap: W - 24,
    }).setVisible(!!this.toastMsg));
    this.nav.first();
    // panel-level cross-fade between title pages (never the first paint: the camera fades in instead)
    if (this._panelFade) {
      this._panelFade = false;
      if (!prefersReducedMotion()) {
        this.root.setAlpha(0);
        this.tweens.add({ targets: this.root, alpha: 1, duration: 170, ease: 'Sine.easeOut' });
      }
    }
  }

  footer(add, W, H, extra = '') {
    const line = extra || `v${VER}  ·  play first, earn second  ·  no wallet needed`;
    add(txt(this, this.root, W / 2, H - 14, line, { size: 8, color: C.dim, wrap: W - 16 }));
    // X / Twitter. Canvas text, but a real link: pointerdown opens it in a new tab.
    // Kept on its own line so a long handle can never reflow the version line.
    const link = txt(this, this.root, W / 2, H - 27, SOCIAL_HANDLE, { size: 8, color: C.gold_s, wrap: W - 16 });
    link.setInteractive({ useHandCursor: true });
    link.on('pointerover', () => link.setColor(C.textHi));
    link.on('pointerout', () => link.setColor(C.gold_s));
    link.on('pointerdown', () => openSocial());
  }

  buildHome(add, W, H) {
    const reduce = prefersReducedMotion();
    const hero = activeSlot();
    const pad = 16;
    const twoCol = this.wide && !this.portrait;
    const logoSize = this.short ? 22 : this.portrait ? 28 : this.wide ? 40 : 30;
    const logoY = this.short ? 28 : Math.round(H * 0.09);
    this.logo = addLogo(this, this.root, W / 2, logoY, { size: logoSize, reduce, sub: 'a cozy open world · solo or together' });

    const colW = Math.min(twoCol ? 268 : W - pad * 2, W - pad * 2);
    const bw = Math.min(300, colW);
    const bh = this.short ? 26 : 32;
    const leftX = twoCol ? Math.round(W * 0.30) : W / 2;
    const rightX = twoCol ? Math.round(W * 0.72) : W / 2;
    const menuTop = twoCol ? Math.round(H * 0.28) : logoY + this.logo.h / 2 + 10;
    const cardW = Math.min(bw, 280);
    const cardH = this.short ? 84 : 96;

    // ── left column (two-column layouts) / top block: Continue card, or a welcome card ──
    if (hero) {
      this.drawHeroCard(add, leftX, menuTop + (twoCol ? 8 : 0), cardW, hero);
      if (twoCol) {
        // a returning player can still start a fresh guest in one key — the left column has room
        makeButton(this, this.root, this.nav, {
          id: 'guest', x: leftX, y: menuTop + 8 + (this.short ? 39 : 46) + 24, w: Math.min(cardW, 240),
          h: this.short ? 24 : 28, label: 'Play as guest', kind: 'ghost', size: 9, onClick: () => this.playFreshGuest(),
        });
      }
    } else {
      const cy = menuTop + (twoCol ? 8 : 0) + cardH / 2;
      frame(this, this.root, leftX, cy, cardW, cardH, { alpha: 0.78 });
      txt(this, this.root, leftX, cy - cardH / 2 + 16, 'New here?', { size: 11, color: C.gold_s });
      txt(this, this.root, leftX, cy - 6, 'Hit Play — we pick a friendly name for you.\nNo sign-up, no wallet, nothing to install.', {
        size: 10, font: FONT.body, color: C.text, wrap: cardW - 18, lineSpacing: 2,
      });
      txt(this, this.root, leftX, cy + cardH / 2 - 26, 'Your hero lives in this browser.\n“Keep your hero” saves a code to carry them anywhere.', {
        size: 9, font: FONT.body, color: C.gold_s, wrap: cardW - 18, lineSpacing: 2,
      });
    }

    // ONE BUTTON. There is no solo/co-op mode to pick, because Embervale is one world and
    // whether other players are in it with you is a fact about the network, not a decision
    // at the door. We try the public world and fall back to solo silently — offline is not
    // an error, and the relay's own disconnect path already says "continuing solo".
    // Playing with friends is an action you take IN the world (the PEOPLE panel: message /
    // party / trade), which is why a door-level co-op mode was never needed.
    const specs = [];
    this._primaryHero = hero || null;
    specs.push({
      id: 'play', label: 'Enter Embervale', kind: 'primary', sub: this.enterSub(hero),
      click: () => this.enterWorld(hero),
    });
    specs.push(
      { id: 'journey', label: 'New Journey', sub: 'name and shape your wayfarer', click: () => this.goPage('journey') },
      { id: 'join', label: 'Join a friend', sub: "their 5-letter room code", click: () => this.goPage('join') },
      { id: 'host', label: 'Host a room', sub: 'invite friends with a code', click: () => this.doHost() },
    );

    // single-column layouts only get the extra guest row when it genuinely fits
    const need = bh + (this.short ? 6 : 8);
    const btnsTop = twoCol ? menuTop : menuTop + (hero ? 84 : cardH + 18);
    if (hero && !twoCol && btnsTop + (specs.length + 1) * need <= H - 66) {
      specs.splice(1, 0, { id: 'guest', label: 'Play as guest', sub: 'one key · fresh name', click: () => this.playFreshGuest() });
    }

    let y = btnsTop;
    specs.forEach((s) => {
      const b = makeButton(this, this.root, this.nav, {
        id: s.id, x: rightX, y, w: bw, h: bh, label: s.label, sub: s.sub, kind: s.kind || 'normal',
        size: this.short ? 10 : 12, onClick: s.click,
      });
      if (s.id === 'play') this.onlineBtn = b;
      y += need;
    });

    // secondary row: the account-less "keep your hero" path sits right here, next to Heroes
    const rowY = Math.min(H - 58, y + 6);
    const extras = [
      { id: 'heroes', label: 'Heroes', click: () => this.scene.start('profile', { from: 'title' }) },
      { id: 'keep', label: 'Keep your hero', click: () => this.goPage('keep') },
      { id: 'news', label: "What's new", click: () => this.goPage('news') },
      { id: 'settings', label: 'Settings', click: () => this.goPage('settings') },
      { id: 'help', label: 'Controls', click: () => this.goPage('help') },
    ];
    const mini = Math.min(88, Math.max(60, (W - 24) / extras.length - 6));
    const esz = W < 520 ? 7 : 8;
    extras.forEach((s, i) => {
      const n = extras.length;
      const x = W / 2 + (i - (n - 1) / 2) * (mini + 6);
      makeButton(this, this.root, this.nav, {
        id: s.id, x, y: rowY, w: mini, h: 22, label: s.label, kind: 'ghost', size: esz, onClick: s.click,
      });
    });
    this.footer(add, W, H);
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
    const badge = linked ? 'Wallet linked' : 'No wallet needed';
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
    const rowH = Math.min(30, Math.max(24, (bot - 60 - y) / 9));
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
    // The wallet lives HERE — one clearly-labelled, strictly-optional line, never on the
    // first-run path and never popped automatically. Nothing about it is needed to play.
    makeButton(this, this.root, this.nav, {
      id: 'wallet', x: cx, y, w: rowW, h: rowH - 4, label: 'Wallet (optional)', kind: 'row', size: 10,
      onClick: () => this.goPage('wallet'),
    }).setValue(wallet.state.linked ? 'Linked' : wallet.state.connected ? 'Connected' : 'Not linked');
    y += rowH;
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
    const { pw, cx, top, bot } = this.panel(add, W, H, 'WALLET (OPTIONAL)');
    const lines = [
      'Nothing here is needed to play. Wayfarer Online is a complete game with no wallet, no account and no sign-up.',
      'A wallet is only ever used to sign in on another device and to unlock cosmetic rewards later. It never changes combat, gold, items or stats.',
      'The game never opens a wallet prompt by itself — this page is the only place that mentions it.',
      wallet.available()
        ? (wallet.state.connected
            ? (wallet.state.linked
                ? `Linked: ${wallet.shortAddress() || 'wallet'}`
                : `Connected: ${wallet.shortAddress() || 'wallet'} — not linked yet`)
            : 'A wallet is available in this browser if you want it.')
        : MOBILE_HINT,
    ];
    let y = top + 40;
    for (const line of lines) {
      const t = txt(this, this.root, cx, y, line, { size: 9, font: FONT.body, color: C.text, wrap: pw - 36, lineSpacing: 3 });
      y += Math.max(24, Math.min(46, t.height + 8));
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

  // ─── Keep your hero: the account-less backup / recovery path ─────────
  // Plain language on purpose. A player who never touches a wallet (or a token, or a
  // chain) still gets a real, portable account: a local travel code AND, for people who
  // play Online, the relay recovery code from src/net/identity.js.
  buildKeep(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'KEEP YOUR HERO');
    const fresh = isFreshDevice() && !isRecoveryAcked();
    let y = top + 38;
    const para = (s, color = C.text, size = 10, gap = 6) => {
      const t = txt(this, this.root, cx, y, s, { size, font: FONT.body, color, wrap: pw - 36, lineSpacing: 3 });
      y += t.height + gap;
    };
    para('No account, no wallet, no sign-up — your hero lives in this browser.');
    para('Save this travel code and your hero follows you to another device: a new phone, a library PC, a fresh browser.', C.gold_s);
    if (fresh) para('New device — copy it once now and you are set up for good.', C.textHi, 9);

    this.keepCode = exportBackup();
    const codeW = Math.min(pw - 32, 380);
    frame(this, this.root, cx, y + 15, codeW, 30, { gold: true, stud: false, alpha: 0.9 });
    txt(this, this.root, cx, y + 15, `${this.keepCode.slice(0, 32)}…`, { size: 9, color: C.textHi, wrap: codeW - 20 });
    y += 36;
    makeButton(this, this.root, this.nav, {
      id: 'copy', x: cx, y, w: Math.min(280, pw - 40), h: 28, label: 'Copy my travel code', kind: 'primary', size: 10,
      onClick: () => this.copyTravel(),
    });
    y += 32;
    para('Already have a code from another device?', C.muted, 9, 4);
    makeField(this, this.root, this.nav, this.entry, {
      id: 'travel', x: cx, y: y + 13, w: Math.min(320, pw - 40), h: 26, value: this.restoreDraft, max: 8000,
      placeholder: 'Paste a travel code', label: 'Travel code',
      onChange: (v) => { this.restoreDraft = v; },
      onCommit: (v) => this.restoreTravel(v),
    });
    y += 46;   // clear the field box (it spans y..y+26) before the button under it
    makeButton(this, this.root, this.nav, {
      id: 'restore', x: cx, y, w: Math.min(280, pw - 40), h: 28, label: 'Bring my heroes here', kind: 'normal', size: 10,
      onClick: () => this.restoreTravel(this.nav.items.find((i) => i.id === 'travel')?.value || ''),
    });
    makeButton(this, this.root, this.nav, {
      id: 'recover', x: cx, y: bot - 50, w: Math.min(300, pw - 40), h: 24, label: 'Keep this hero online? Get a recovery code', kind: 'ghost', size: 9,
      onClick: () => this.goPage('recover'),
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back to play', kind: 'ghost', size: 10,
      onClick: () => this.goPage('home'),
    });
  }

  buildRecover(add, W, H) {
    const { pw, cx, top, bot } = this.panel(add, W, H, 'RECOVERY CODE');
    let y = top + 38;
    const para = (s, color = C.text, size = 10, gap = 6) => {
      const t = txt(this, this.root, cx, y, s, { size, font: FONT.body, color, wrap: pw - 36, lineSpacing: 3 });
      y += t.height + gap;
    };
    para('Playing Online keeps a copy of your heroes on the server, tied to this device.');
    para('If this browser is ever cleared, or you move to a new device, this code picks them back up. No password, no email, no wallet.', C.gold_s);

    const codeW = Math.min(pw - 32, 380);
    if (this.recoverState === 'ready' && this.recoverCode) {
      frame(this, this.root, cx, y + 15, codeW, 30, { gold: true, stud: false, alpha: 0.9 });
      txt(this, this.root, cx, y + 15, this.recoverCode, { size: 11, color: C.textHi, wrap: codeW - 20 });
      y += 36;
      makeButton(this, this.root, this.nav, {
        id: 'copyr', x: cx, y, w: Math.min(280, pw - 40), h: 28, label: 'Copy my recovery code', kind: 'primary', size: 10,
        onClick: () => this.copyRecovery(),
      });
      y += 30;
      if (!this.recoverLinked) para('Not synced with the server yet — it links itself next time you play Online.', C.warn, 9, 4);
      y += 4;
    } else {
      const msg = this.recoverState === 'offline'
        ? 'The server is not reachable right now. Your travel code (previous screen) still works offline.'
        : 'Getting your recovery code…';
      para(msg, this.recoverState === 'offline' ? C.warn : C.muted, 9, 4);
    }
    para('I already have a code', C.muted, 9, 4);
    makeField(this, this.root, this.nav, this.entry, {
      id: 'rcode', x: cx, y: y + 13, w: Math.min(320, pw - 40), h: 26, value: '', max: 64, upper: true,
      placeholder: 'ABCD-EFGH-JKLM-NPQR-STVW', label: 'Recovery code',
      onCommit: (v) => this.useRecovery(v),
    });
    y += 46;   // clear the field box (it spans y..y+26) before the button under it
    makeButton(this, this.root, this.nav, {
      id: 'use', x: cx, y, w: Math.min(280, pw - 40), h: 28, label: 'Use my recovery code', kind: 'normal', size: 10,
      onClick: () => this.useRecovery(this.nav.items.find((i) => i.id === 'rcode')?.value || ''),
    });
    makeButton(this, this.root, this.nav, {
      id: 'back', x: cx, y: bot - 22, w: Math.min(240, pw - 40), h: 24, label: 'Back', kind: 'ghost', size: 10,
      onClick: () => this.goPage('keep'),
    });
    if (this.recoverState === 'idle') this.time.delayedCall(0, () => this.fetchRecovery());
  }

  async copyTravel() {
    const ok = await copyText(this.keepCode || exportBackup());
    this.say(ok ? 'Travel code copied — keep it somewhere safe (a note, a password manager).' : 'Could not copy — select the code above yourself.');
    if (!ok) audio.error();
  }

  async copyRecovery() {
    const ok = await copyText(this.recoverCode);
    if (ok) { try { ackRecovery(); } catch { /* private mode */ } }
    this.say(ok ? 'Recovery code copied — that is your sign-in, with no password.' : 'Could not copy — type it out and keep it safe.');
    if (!ok) audio.error();
  }

  restoreTravel(code) {
    const v = String(code || '').trim();
    if (!v) { this.say('Paste a travel code first.'); audio.error(); return; }
    const r = importBackup(v);
    if (!r.ok) { this.say(r.error || 'That code did not work.'); audio.error(); return; }
    this.restoreDraft = '';
    this.say(`Welcome here — ${r.count} hero${r.count === 1 ? '' : 'es'} moved onto this device.`);
    this.goPage('home');
  }

  async fetchRecovery() {
    if (this.recoverState !== 'idle') return;
    if (!net.token) { this.recoverState = 'offline'; if (this.page === 'recover') this.build(); return; }
    this.recoverState = 'busy';
    if (this.page === 'recover') this.build();
    let state = 'offline', code = '', linked = false;
    try {
      const r = await ensureRecoveryCode(net.token);
      code = r.code || ''; linked = !!r.linked;
      // A locally minted code is still worth showing: it links itself the next time the
      // player reaches the relay, and it works forever even if the server never answers.
      state = code ? 'ready' : 'offline';
    } catch { /* relay unreachable and no code: the travel code still works offline */ }
    this.recoverCode = code; this.recoverLinked = linked; this.recoverState = state;
    if (this.scene.isActive() && this.page === 'recover') this.build();
  }

  async useRecovery(raw) {
    if (this.busy) return;
    const code = String(raw || '').trim();
    if (!isPlausibleCode(code)) { this.say('That does not look like a full recovery code.'); audio.error(); return; }
    this.busy = true; this.say('Looking up your heroes…');
    try {
      const token = await continueWithCode(code);
      const ok = net.useToken(token);
      const names = listLocalCharacters();
      this.busy = false;
      this.say(!ok ? 'That code could not be applied on this device.'
        : names.length ? `Code accepted — this device now answers to ${names.length} of your hero${names.length === 1 ? '' : 'es'}.`
          : 'Code accepted. Your heroes will be waiting next time you enter Embervale.');
      try { ackRecovery(); } catch { /* private mode */ }
      this.goPage('home');
    } catch (e) {
      this.busy = false;
      this.say(e?.code === 'not_found' || e?.status === 404
        ? 'No heroes match that code — check for a typo.'
        : `That code did not work (${e?.code || e?.message || 'unreachable'}).`);
      audio.error();
    }
  }

  // ─── Actions ────────────────────────────────────────────────────────
  cleanName(raw) {
    const n = String(raw || this.nameDraft || '').replace(/[^\w \-']/g, '').trim().slice(0, 14);
    return n || this.guestName();
  }

  // A short camera dip before leaving the title for the creator/world. Never blocks:
  // reduced motion (or a missing camera) starts the next scene at once, and a timer is
  // the safety net so a resize mid-fade can never strand the player on the title.
  fadeInto(fn) {
    const cam = this.cameras?.main;
    if (prefersReducedMotion() || !cam) { fn(); return; }
    let done = false;
    const run = () => { if (done) return; done = true; this.busy = false; try { fn(); } catch (e) { console.error(e); } };
    this.busy = true;
    try { cam.fadeOut(190, 7, 20, 10); } catch { run(); return; }
    try { cam.once('camerafadeoutcomplete', run); } catch { run(); return; }
    this.time.delayedCall(700, run);
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

  // The one-key guest path for a player who already has heroes: brand-new wayfarer,
  // generated name, first free slot, straight into the creator. Never asks for anything.
  playFreshGuest() {
    if (this.busy) return;
    const id = freeSlotId();
    if (!id) { this.scene.start('profile', { from: 'title', toast: 'All three heroes are full — rename or delete one first.' }); return; }
    const name = this.guestName();
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
    this.fadeInto(() => this.scene.start('creator', { name: n, mode }));
  }

  // THE one entry point. Tries the public world; if no relay answers, enters solo. The
  // player never picks a mode and never sees a failure for being offline — they just get
  // Embervale, with or without other wayfarers in it.
  async enterWorld(hero) {
    if (this.busy) return;
    const slot = activeSlot();
    const name = slot?.name || this.guestName();
    if (!slot) { const id = freeSlotId() || 1; setActiveSlot(id, name); }
    saveProfile({ name });
    // already in a room (joined/hosted from the Heroes or Join pages): keep that world
    if (net.connected) return this.goCreator(net.isHost ? 'host' : 'guest', name);
    this.busy = true;
    this.say('Entering Embervale…');
    try {
      const h = loadHero() || hero || { name, job: 'wayfarer' };
      const shard = await net.joinPublic(name, h);
      this.busy = false;
      return this.scene.start('creator', { name, mode: 'online', shard });
    } catch {
      // No relay answered — that is the solo path, not an error. Fall through.
    }
    this.busy = false;
    this.goCreator('solo', name);
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
