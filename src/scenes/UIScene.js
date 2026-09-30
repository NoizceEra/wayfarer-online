import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { PALETTES } from '../core/palette.js';
import { ZONES } from '../data/zones.js';
import { audio } from '../systems/audio.js';
import { CONFIG } from '../config.js';
import { makeHudIcons, HUD_ABILITY_ICON } from '../systems/hudIcons.js';
import { EquipPanel } from '../ui/EquipPanel.js';
import { ShopPanel } from '../ui/ShopPanel.js';
import { social } from '../systems/social/index.js';
import { installSocialUI } from '../ui/socialUI.js';
import { JournalPanel } from '../ui/JournalPanel.js';
import { CraftPanel } from '../ui/CraftPanel.js';
import { FishingGame } from '../ui/FishingGame.js';
import { Toaster } from '../ui/Toast.js';
import { input } from '../core/input.js';
import { settings, uiZoomFor } from '../core/settings.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { HelpOverlay } from '../ui/HelpOverlay.js';

// HUD: HP/MP/XP bars, hotbar with cooldown sweep (clickable), minimap,
// quest tracker, chat, party, pause (palette + mute), GB tint + scanlines,
// damage vignette + low-HP pulse, touch controls (stick + ATK/SKL/E/Q).
// Hotkeys come from core/input.js; pause menu (settings + rebind) and help
// overlay live in ui/PauseMenu.js / ui/HelpOverlay.js. UI scale = camera zoom
// (origin 0,0) so layout uses view() = window size / zoom.
export class UIScene extends Phaser.Scene {
  constructor() { super('ui'); }
  init(data) { this.initData = data; this.hero = data.hero; this.pname = data.name; this.job = data.job; }
  world() { return this.scene.get('world'); }
  // Virtual (UI-scaled) layout size. Everything in this scene is laid out in these units.
  view() { const z = this.uiZoom || 1; return { w: this.scale.width / z, h: this.scale.height / z, z }; }
  // Pointer -> scene coords (camera zoom with origin 0,0).
  pt(p) { const z = this.uiZoom || 1; return { x: p.x / z, y: p.y / z }; }
  pickUiZoom() { return uiZoomFor(this.scale.width, this.scale.height); }
  // Restart this scene (resize / UI-scale change) keeping pause page + fog of war.
  relaunch() {
    if (!this.sys.isActive()) return;
    this.scene.restart({ ...this.initData, menuPage: this.menu?.isOpen ? this.menu.page : null, keepFog: true });
  }

  // ── asset loading ────────────────────────────────────────────────────────
  preload() {
    const UI = 'assets/na/Ui';
    const TW = `${UI}/Theme/Theme_Wood`;
    const li = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
    li('ui.panel',    `${TW}/nine_path_panel.png`);
    li('ui.panel2',   `${TW}/nine_path_panel_2.png`);
    li('ui.panelBg',  `${TW}/nine_path_bg.png`);
    li('ui.cell',     `${TW}/inventory_cell.png`);
    li('ui.btn',      `${TW}/button_normal.png`);
    li('ui.btnHov',   `${TW}/button_hover.png`);
    li('ui.btnPrs',   `${TW}/button_pressed.png`);
  }

  // ability id → skill icon key
  _abilityIcon(id) { return HUD_ABILITY_ICON[id] ? `hud.${HUD_ABILITY_ICON[id]}` : null; }

  // Nineslice shorthand. Phaser 3.90's NineSlice game object has NO canvas
  // renderer (renderCanvas is a NOOP) — it only draws under WebGL. This game
  // ships a `?renderer=canvas` fallback (weak GPUs / broken WebGL), so every
  // nineslice must be backed by a plain filled Rectangle that renders in both
  // pipelines, or the whole panel goes invisible for canvas-fallback users.
  _ns(x, y, w, h, key = 'ui.panel', lw = 4, rw = 4, th = 4, bh2 = 4, ox = 0, oy = 0, depth = 100) {
    // The raw wood panel has an orange plate in its 8x8 centre that stretched
    // into orange blocks over the HUD text; use the dark-centre copy instead.
    if (key === 'ui.panel' && this.textures.exists('ui.panelHud')) key = 'ui.panelHud';
    // Backing rect is interactive so clicks on HUD panels never reach the world (no stray swings).
    const bg = this.add.rectangle(x, y, w, h, 0x2a1d10, 0.92).setOrigin(ox, oy).setDepth(depth - 1).setInteractive();
    const ns = this.add.nineslice(x, y, key, null, w, h, lw, rw, th, bh2)
      .setOrigin(ox, oy).setDepth(depth);
    // Keep the canvas-safe backing rect's visibility in sync with the nineslice.
    ns.fallbackRect = bg;
    const origSetVisible = ns.setVisible.bind(ns);
    ns.setVisible = (v) => { bg.setVisible(v); return origSetVisible(v); };
    return ns;
  }

  // Same idea, for nineslices that get added into a Container (a plain
  // scene-level rectangle from _ns() would not inherit the container's
  // transform). Returns [fallbackRect, nineslice] — add both to the container.
  _nsPair(x, y, w, h, key, lw = 4, rw = 4, th = 4, bh2 = 4, color = 0x2a1d10, alpha = 0.92) {
    const bg = this.add.rectangle(x, y, w, h, color, alpha).setOrigin(0.5);
    const ns = this.add.nineslice(x, y, key, null, w, h, lw, rw, th, bh2).setOrigin(0.5);
    return [bg, ns];
  }

  // Copy of the wood panel with its orange centre plate replaced by the dark
  // frame colour: 4px slices then give a clean frame + dark, readable interior.
  makeHudPanelTexture() {
    if (this.textures.exists('ui.panelHud') || !this.textures.exists('ui.panel')) return;
    const src = this.textures.get('ui.panel').getSourceImage();
    const w = src.width, h = src.height;
    const t = this.textures.createCanvas('ui.panelHud', w, h);
    const ctx = t.getContext();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0);
    ctx.fillStyle = '#2a1d10';
    ctx.fillRect(4, 4, w - 8, h - 8); // whole 8x8 centre slice -> uniform dark interior
    t.refresh();
  }

  create(data = {}) {
    this.uiZoom = this.pickUiZoom();
    this.cameras.main.setZoom(this.uiZoom).setOrigin(0, 0).setScroll(0, 0);
    const { w: W, h: H } = this.view();
    this.makeHudPanelTexture();
    this.keepFog = !!data.keepFog;
    this.minimapOn = true;
    this.offs = [];                       // every bus/input/settings subscription -> torn down on shutdown
    const builtFor = `${this.scale.width}x${this.scale.height}`;
    const onResize = () => {
      this.resizeTimer?.remove(false);
      this.resizeTimer = this.time.delayedCall(150, () => { if (`${this.scale.width}x${this.scale.height}` !== builtFor) this.relaunch(); });
    };
    this.scale.on('resize', onResize);
    this.offs.push(() => this.scale.off('resize', onResize));
    this.lastHp = null;
    this.small = W < 560;

    // ── GB palette tint + scanlines ─────────────────────────────────────────
    const pal = PALETTES[this.hero.palette] || PALETTES.classic;
    this.gbTint = this.add.rectangle(0, 0, W, H, pal.bg, this.hero.palette === 'modern' ? 0 : 0.06)
      .setOrigin(0).setDepth(90).setScrollFactor(0);
    this.scan = this.add.graphics().setDepth(91);
    this.drawScan();

    // ── Damage vignette ─────────────────────────────────────────────────────
    this.vignette = this.add.rectangle(0, 0, W, H, 0xcc0000, 0).setOrigin(0).setDepth(95);

    // ── Status panel (top-left) ──────────────────────────────────────────────
    makeHudIcons(this);
    const F = (size, color, extra = {}) => ({ fontFamily: '"Silkscreen", monospace', fontSize: `${size}px`, color, ...extra });
    const pw  = this.small ? 196 : 232;
    const barX = 34;               // x of bar fill (after glyph icon)
    const pbw  = pw - barX - 12;   // bar fill width
    this.hpBarW = pbw;
    this.barH = { hp: 14, mp: 11, xp: 7 };

    this._ns(8, 8, pw, 106);       // wood frame panel
    this.nameT = this.add.text(18, 15, `${this.pname} · ${this.job.name} Lv 1`, F(this.small ? 10 : 11, '#fff8e0', { fontStyle: 'bold' })).setDepth(101);

    const mkBar = (glyph, y, h, bgc, fc) => {
      this.add.image(18, y + h / 2, `hud.${glyph}`).setOrigin(0, 0.5).setDepth(102);
      this.add.rectangle(barX - 1, y - 1, pbw + 2, h + 2, 0x1a1024, 1).setOrigin(0).setDepth(101);
      this.add.rectangle(barX, y, pbw, h, bgc, 1).setOrigin(0).setDepth(102);
      return this.add.rectangle(barX, y, pbw, h, fc).setOrigin(0).setDepth(103);
    };
    this.hpBar = mkBar('heart', 32, 14, 0x3a1014, 0x4cc060);
    this.hpT   = this.add.text(barX + pbw / 2, 39, '', F(9, '#ffffff', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(0.5).setDepth(104);
    this.mpBar = mkBar('mana', 52, 11, 0x0c1a3a, 0x3a9cf0);
    this.mpT   = this.add.text(barX + pbw / 2, 57.5, '', F(8, '#ffffff', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(0.5).setDepth(104);
    this.xpBar = mkBar('xp', 69, 7, 0x2a2008, 0xffd84a);

    // gold / potions / atk+def as glyph + number
    this.add.image(18, 92, 'hud.coin').setOrigin(0, 0.5).setDepth(102);
    this.goldT = this.add.text(36, 92, '0', F(10, '#ffe27a')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(78, 92, 'hud.potion').setOrigin(0, 0.5).setDepth(102);
    this.potT  = this.add.text(96, 92, '0', F(10, '#ffb0a0')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(122, 92, 'hud.sword').setOrigin(0, 0.5).setDepth(102);
    this.atkT  = this.add.text(140, 92, '0', F(10, '#e6f2c0')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(pw - 46, 92, 'hud.shield').setOrigin(0, 0.5).setDepth(102);
    this.defT  = this.add.text(pw - 28, 92, '0', F(10, '#aed6f1')).setOrigin(0, 0.5).setDepth(102);

    // ── Zone label (top-centre; on phones: below status panel + party line) ──
    // phones: status panel bottom = 8+82=90, party line ~104; zone label y=90+4=94
    // desktop: y=14 to align with status panel top
    const zoneY = this.small ? 118 : 14;
    this._ns(W / 2, zoneY, 160, 22, 'ui.panelBg', 4, 4, 4, 4, 0.5, 0, 101);
    this.zoneT = this.add.text(W / 2, zoneY + 11, 'Thistle Town', {
      fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '10px' : '11px', color: '#ffe8a0',
    }).setOrigin(0.5).setDepth(102);

    // ── Quest tracker (top-right): framed panel, capped width, word wrap ─────
    this.questW = this.small ? 158 : 214;
    this.questPanel = this._ns(W - 8, 8, this.questW, 52, 'ui.panel', 4, 4, 4, 4, 1, 0, 100);
    this.questHead = this.add.text(W - 8 - this.questW + 10, 14, 'QUEST', {
      fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#ffd84a',
    }).setDepth(101);
    this.questT = this.add.text(W - 8 - this.questW + 10, 26, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '9px' : '10px',
      color: '#f4e0b0', lineSpacing: 2,
      wordWrap: { width: this.questW - 20, useAdvancedWrap: true },
    }).setOrigin(0, 0).setDepth(101);

    // ── Hotbar (bottom-centre) ───────────────────────────────────────────────
    this.hotbar = [];
    const cellW  = this.small ? 44 : 58;
    const cellH  = this.small ? 44 : 58;
    const cellSt = this.small ? 48 : 64;
    const hotY   = H - 8 - cellH / 2;
    const iconScale = this.small ? 2 : 3;
    const slots  = [
      ...this.job.abilities.map((a) => ({ key: a.key, name: a.name, ab: a, action: `skill${a.key}` })),
      { key: 'Q', name: 'Potion', ab: null, action: 'potion' },
    ];
    const hotTotalW = slots.length * cellSt;
    slots.forEach((s, i) => {
      const x = W / 2 - hotTotalW / 2 + i * cellSt + cellSt / 2;
      const bg = this._ns(x, hotY, cellW, cellH, 'ui.cell', 3, 3, 3, 3, 0.5, 0.5, 100);
      bg.setInteractive({ useHandCursor: true });

      const iconKey = s.ab ? this._abilityIcon(s.ab.id) : 'hud.potion';
      if (iconKey && this.textures.exists(iconKey)) {
        this.add.image(x, hotY, iconKey).setScale(iconScale).setOrigin(0.5).setDepth(101);
      }
      if (!s.ab) {
        this.potCount = this.add.text(x + cellW / 2 - 5, hotY + cellH / 2 - 4, '0', {
          fontFamily: '"Silkscreen", monospace', fontSize: '10px', color: '#ffffff',
          stroke: '#1a1024', strokeThickness: 3,
        }).setOrigin(1, 1).setDepth(104);
      }

      // key badge (top-left corner) — shows the CURRENT binding (rebindable)
      const badgeBg = this.add.rectangle(x - cellW / 2 + 3, hotY - cellH / 2 + 3, 13, 13, 0x1a1024, 0.95).setOrigin(0).setDepth(103);
      const badgeT = this.add.text(x - cellW / 2 + 5, hotY - cellH / 2 + 9.5, input.labelFor(s.action), {
        fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#ffd84a',
      }).setOrigin(0, 0.5).setDepth(104);
      badgeBg.width = Math.max(13, badgeT.width + 4);

      const cdBg = this.add.rectangle(x, hotY, cellW - 2, cellH - 2, 0x000000, 0.70)
        .setDepth(105).setVisible(false);
      const cdT  = this.add.text(x, hotY, '', {
        fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold',
        stroke: '#1a1024', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(106).setVisible(false);

      bg.on('pointerdown', () => {
        const w = this.world();
        if (!w?.player) return;
        audio.play('ui', 0.6);
        if (s.ab) w.cast(s.ab.key);
        else w.drinkPotion();
      });
      this.hotbar.push({ bg, s, cdBg, cdT, bw: cellW, bh: cellH, badgeBg, badgeT });
    });

    // ── Chat / system log (bottom-left) ─────────────────────────────────────
    // The MMO chat window (channels, whispers, scrollback) is a DOM overlay:
    // src/ui/ChatPanel.js, mounted by installSocialUI() below. say() routes
    // system lines into it.

    // ── Minimap (bottom-right): framed, fog-of-war, M toggles small/large ────
    this.mapLarge = false;
    this.buildMinimap();

    // Party line: only shown when actually in a party (solo hint lives in pause menu)
    this.partyT = this.add.text(18, this.small ? 122 : 120, net.connected ? `Party ${net.code}` : '', {
      fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#a0c4f0',
      stroke: '#1a1024', strokeThickness: 3,
    }).setDepth(101);

    // ── Pause menu (Esc / START / II button) + help overlay (H / F1 / ?) ────
    this.paused = false;
    this.menu = new PauseMenu(this, {
      onOpenChange: (open) => {
        this.paused = open;
        if (open) this.help?.close();
        const w = this.world();
        if (w) w.physics.world.isPaused = open;
      },
      resume: () => this.menu.close(),
      help: () => this.help.open(),
      leaveLabel: () => (net.connected ? 'Leave Party (solo)' : 'Leave to Title'),
      leave: () => {
        const w = this.world();
        if (net.connected && w) {
          net.leave(); this.say('Left party — continuing solo.');
          this.menu.close(); this.partyT.setText('');
        } else { net.leave(); audio.stopMusic(); this.menu.close(); this.scene.stop('world'); this.scene.start('title'); }
      },
      cyclePalette: () => {
        const keys = Object.keys(PALETTES);
        const i = (keys.indexOf(this.hero.palette) + 1) % keys.length;
        this.hero.palette = keys[i];
        const p = PALETTES[keys[i]];
        this.gbTint.setFillStyle(p.bg, keys[i] === 'modern' ? 0 : 0.12);
        this.say(`${p.name} palette`);
      },
      modeText: () => (net.connected ? `PARTY ${net.code}` : 'SOLO — HOST/JOIN FROM TITLE'),
      zoom: this.world()?.zoomCtl || null,
      applyUiScale: () => this.relaunch(),
    });
    this.help = new HelpOverlay(this);
    this.input.on('pointermove', (p) => this.menu.pointerMove(p));
    this.input.on('pointerup', () => this.menu.pointerUp());

    // Esc closes the topmost panel first (see core/input.js closers); only then pauses.
    this.offs.push(
      input.addCloser({ id: 'help', priority: 900, isOpen: () => this.help.isOpen, close: () => this.help.close() }),
      input.addCloser({ id: 'pause-sub', priority: 850, isOpen: () => this.menu.isOpen && this.menu.page !== 'main', close: () => this.menu.goto('main') }),
      input.addCloser({ id: 'shop', priority: 450, isOpen: () => !!this.shop?.isOpen, close: () => this.shop.close() }),
      input.addCloser({ id: 'equip', priority: 400, isOpen: () => !!this.equip?.isOpen, close: () => this.equip.toggle(false) }),
      input.addCloser({ id: 'pause', priority: 100, isOpen: () => this.menu.isOpen, close: () => this.menu.close() }),
      input.on('menu', () => { this.menu.open('main'); return true; }),
      input.on('help', () => { this.help.toggle(); return true; }),
      input.on('chat', () => this.openChat()),
      input.on('mute', () => { const on = audio.toggle(); this.say(`Sound ${on ? 'on' : 'muted'} (${input.labelFor('mute')})`); }),
      input.onChange(() => this.refreshKeyLabels()),
      settings.onChange((k) => { if (k === 'showFps') this.fpsT?.setVisible(settings.get('showFps')); }),
    );
    this.offs.push(
      input.addCloser({ id: 'social', priority: 950, isOpen: () => !!this.social?.anyOpen?.(), close: () => social.act('closeAll') }),
      input.addCloser({ id: 'fishing', priority: 700, isOpen: () => !!this.fishing?.isOpen, close: () => {} }),
      input.addCloser({ id: 'journal', priority: 470, isOpen: () => !!this.journal?.isOpen, close: () => this.journal.close() }),
      input.addCloser({ id: 'craft', priority: 460, isOpen: () => !!this.craftPanel?.isOpen, close: () => this.craftPanel.close() }),
    );
    const sub = (ev, fn) => this.offs.push(bus.on(ev, fn));
    sub(Events.SYSTEM,    (s) => this.say(s));
    sub(Events.PLAYER_HP, (p) => this.drawStatus(p));
    sub(Events.PLAYER_XP, (p) => this.drawXp(p));
    sub(Events.QUEST,     (q) => this.setQuest(q));
    sub(Events.ZONE,      (z) => this.zoneT.setText(z.name));
    sub(Events.SYSTEM,    (s) => {
      if (s === 'toggle-minimap') { this.mapLarge = !this.mapLarge; this.layoutMinimap(); }
    });
    sub(Events.GEAR, (m) => {
      if      (m.open === 'inventory') { this.shop?.close(); this.equip.toggle(); }
      else if (m.open === 'shop')      { this.equip.toggle(false); this.shop.show(m.shop || 'maren'); }
      else if (m.changed)              { this.equip.refresh(); this.shop.refresh(); }
    });
    this.events.once('shutdown', () => {
      this.offs.forEach((off) => { try { off(); } catch { /* ignore */ } });
      this.offs = [];
      this.resizeTimer?.remove(false);
      this.equip?.destroy(); this.shop?.destroy(); this.journal?.destroy(); this.craftPanel?.destroy(); this.fishing?.destroy(); this.toast?.destroy();
    });

    // ── HUD menu + help buttons (touch has no Esc/H) ─────────────────────────
    const hb = (x, label, cb) => {
      const r = this.add.rectangle(x, 8, 22, 20, 0x2a1d10, 0.92).setOrigin(0).setStrokeStyle(2, 0x8d5a2b).setDepth(120).setInteractive({ useHandCursor: true });
      const t = this.add.text(x + 11, 18, label, F(10, '#ffe8a0', { fontStyle: 'bold' })).setOrigin(0.5).setDepth(121);
      r.on('pointerover', () => r.setStrokeStyle(2, 0xffe07a));
      r.on('pointerout', () => r.setStrokeStyle(2, 0x8d5a2b));
      r.on('pointerdown', () => { audio.play('ui', 0.6); cb(); });
      return [r, t];
    };
    const hbX = W - 8 - this.questW - 30;
    this.menuBtn = hb(hbX, 'II', () => (this.menu.isOpen ? this.menu.close() : this.menu.open('main')));
    this.helpBtn = hb(hbX - 26, '?', () => this.help.toggle());
    this.fpsT = this.add.text(hbX - 32, 12, '', F(9, '#9bf06b', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(1, 0).setDepth(121).setVisible(settings.get('showFps'));
    this.offs.push(bus.on(Events.TOAST, (t) => this.toast?.push(t)));

    this.buildTouch();
    this.buildPanels();
    // Social UI: chat window, party frames, players/friends, emote wheel (src/ui/socialUI.js)
    this.social = installSocialUI(this, { name: this.pname, job: this.job.id, framesY: this.small ? 136 : 134 });
    // WorldScene emits the initial QUEST/HP/XP before this overlay exists —
    // pull current values so the tracker never starts empty.
    const w0 = this.world();
    if (w0?.player) {
      this.drawStatus(w0.hpPayload());
      this.drawXp(w0.xpPayload());
      this.setQuest(w0.questText());
      this.zoneT.setText(w0.zoneId ? (ZONES.find((z) => z.id === w0.zoneId)?.name || '') : '');
    }
    if (data.menuPage) this.menu.open(data.menuPage); // relaunch while paused
    { const ov = this.scene.get('overlay'); if (ov?.sys.isActive() && ov.mapBtn) ov.relayout(); } // UI scale moved the minimap / map button
  }

  refreshKeyLabels() {
    for (const h of this.hotbar || []) {
      if (!h.badgeT?.active) continue;
      h.badgeT.setText(input.labelFor(h.s.action));
      h.badgeBg.width = Math.max(13, h.badgeT.width + 4);
    }
    this.mapLbl?.setText(input.labelFor('minimap'));
  }

  drawScan() {
    this.scan.clear();
    const { w: W, h: H } = this.view();
    for (let y = 0; y < H; y += 4) this.scan.fillStyle(0x000000, 0.035).fillRect(0, y, W, 1);
  }

  say(s) {
    if (s === 'toggle-minimap') return;
    social.system(s); // -> chat window, System channel
  }

  drawStatus(p) {
    if (this.lastHp !== null && p.hp < this.lastHp && !settings.get('reduceMotion')) {
      this.vignette.setAlpha(0.45);
      this.tweens.add({ targets: this.vignette, alpha: 0, duration: 350 });
    }
    this.lastHp = p.hp;
    this.nameT.setText(`${this.pname} · ${this.job.name} Lv ${p.level}`);
    const f = Math.max(0, Math.min(1, p.hp / p.maxHp));
    this.hpBar.setDisplaySize(Math.max(f ? 1 : 0, this.hpBarW * f), this.barH.hp);
    this.hpBar.setFillStyle(f > 0.35 ? 0x4cc060 : 0xe74c3c);
    this.hpT.setText(`${Math.ceil(p.hp)}/${p.maxHp}`);
    const mf = Math.max(0, Math.min(1, p.mp / p.maxMp));
    this.mpBar.setDisplaySize(this.hpBarW * mf, this.barH.mp);
    this.mpT.setText(`${Math.floor(p.mp)}/${p.maxMp}`);
    this.goldT.setText(String(p.gold));
    this.potT.setText(String(p.potions));
    this.atkT.setText(String(p.atk));
    this.defT.setText(String(p.def));
    this.potCount?.setText(String(p.potions));
  }
  setQuest(q) {
    this.questT.setText(q);
    const h = Math.ceil(this.questT.height) + 26 + 8;
    this.questPanel.setSize(this.questW, h);
    this.questPanel.fallbackRect.setSize(this.questW, h);
  }
  drawXp(p) { this.xpBar.setDisplaySize(this.hpBarW * Math.min(1, p.xp / p.xpNext), this.barH.xp); }

  openChat() { social.act('openChat'); } // Enter -> chat input (closes on Enter/Esc)

  refreshMode() { if (this.menu?.isOpen) this.menu.build(); }

  togglePause() { this.menu.toggle(); } // back-compat

  buildTouch() {
    const { w: W, h: H } = this.view();
    this.touchUI = this.add.container(0, 0).setDepth(150);
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    this.input.addPointer(2); // stick + action button held at the same time
    // Joystick (bottom-left, dynamic origin); kept above the hotbar row
    const sx0 = 90, sy0 = H - 140;
    const base = this.add.circle(sx0, sy0, 46, 0xffffff, 0.12);
    const knob = this.add.circle(sx0, sy0, 20, 0xffffff, 0.3);
    this.touchUI.add([base, knob]);
    let stickId = null, ox = sx0, oy = sy0;
    const setKnob = (x, y) => {
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy), max = 40;
      const c = d > max ? max / d : 1;
      knob.setPosition(ox + dx * c, oy + dy * c);
      const w = this.world();
      if (w) { w.touchInput.x = (dx * c) / max; w.touchInput.y = (dy * c) / max; }
    };
    const clearKnob = () => {
      stickId = null; ox = sx0; oy = sy0; knob.setPosition(ox, oy);
      const w = this.world();
      if (w) { w.touchInput.x = 0; w.touchInput.y = 0; }
    };
    // NOTE: hitArea is in the GameObject's LOCAL frame (arc is centered at
    // 46,46 of its 92x92 frame), not world coords — a world-space circle here
    // silently eats all touches. Pointer coords go through pt() (UI scale).
    base.setInteractive(new Phaser.Geom.Circle(46, 46, 70), Phaser.Geom.Circle.Contains);
    base.on('pointerdown', (p) => { const q = this.pt(p); stickId = p.id; ox = q.x; oy = q.y; base.setPosition(ox, oy); setKnob(q.x, q.y); });
    this.input.on('pointermove', (p) => { if (p.id === stickId && p.isDown) { const q = this.pt(p); setKnob(q.x, q.y); } });
    this.input.on('pointerup',   (p) => { if (p.id === stickId) { base.setPosition(sx0, sy0); clearKnob(); } });
    this.input.on('gameout',     () => { if (stickId !== null) { base.setPosition(sx0, sy0); clearKnob(); } });
    // Action buttons (bottom-right, stacked ABOVE the minimap so they never
    // cover it; skills 1-4/potion = tap the hotbar, 5/6 = tap the class bar,
    // CHAR/SKILL/MAP/II/? are HUD buttons).
    const R = this.small ? 28 : 26;
    const mmTop = H - (this.small ? 84 : 112) - 20;
    const mkBtn = (x, y, label, cb, r = R) => {
      const c = this.add.circle(x, y, r, 0x000000, 0.5).setStrokeStyle(2, 0xffffff, 0.25).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y, label, { fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '12px' : '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      c.on('pointerdown', () => { audio.play('ui', 0.5); c.setFillStyle(0xffffff, 0.35); cb(); });
      c.on('pointerup', () => c.setFillStyle(0x000000, 0.5));
      c.on('pointerout', () => c.setFillStyle(0x000000, 0.5));
      this.touchUI.add([c, t]);
      return c;
    };
    this.touchBtns = {
      attack: mkBtn(W - 50, mmTop - R - 10, 'ATK', () => this.world()?.attack(), R + 6),
      interact: mkBtn(W - 50, mmTop - 3 * R - 28, 'E', () => this.world()?.interact()),
      potion: mkBtn(W - 50 - 2 * R - 18, mmTop - R + 2, 'Q', () => this.world()?.drinkPotion()),
      bag: mkBtn(W - 50 - 2 * R - 18, mmTop - 3 * R - 12, 'BAG', () => bus.emit(Events.GEAR, { open: 'inventory' })),
    };
    mkBtn(W - 184, H - 176, 'LOG', () => bus.emit(Events.JOURNAL, { open: 'toggle' }));
    mkBtn(W - 246, H - 110, 'CFT', () => bus.emit(Events.CRAFT, { open: 'toggle' }));
  }

  // ── equipment + shop panels (src/ui/EquipPanel.js, ShopPanel.js) ───────────
  buildPanels() {
    const w = () => this.world()?.player || null;
    const hooks = {
      player: w,
      say: (m) => this.say(m),
      changed: () => {
        const wd = this.world();
        if (!wd?.player) return;
        bus.emit(Events.PLAYER_HP, wd.hpPayload());
        wd.saveNow();
      },
    };
    this.equip = new EquipPanel(this, hooks);
    this.shop = new ShopPanel(this, hooks);
    // Content panels: Journal (L), Crafting (U), fishing mini-game, toasts.
    const wh = { world: () => this.world() };
    this.journal = new JournalPanel(this, wh);
    this.craftPanel = new CraftPanel(this, wh);
    this.fishing = new FishingGame(this);
    this.toast = new Toaster(this);
    const blocked = () => this.fishing?.isOpen || this.paused;
    input.registerAction({ id: 'journal', label: 'Quest journal', group: 'Panels', keys: ['KeyL'], gameplay: true });
    input.registerAction({ id: 'craft', label: 'Crafting', group: 'Panels', keys: ['KeyU'], gameplay: true });
    this.offs.push(
      input.on('journal', () => { if (!blocked()) { this.craftPanel.close(); bus.emit(Events.JOURNAL, { open: 'toggle' }); } return true; }),
      input.on('craft', () => { if (!blocked()) { this.journal.close(); bus.emit(Events.CRAFT, { open: 'toggle' }); } return true; }),
    );
    this.scale.on('resize', () => { this.equip.resize(); this.shop.refresh(); this.journal.resize(); this.craftPanel.resize(); });
    this.buildContentButtons();
  }

  // On phones the full-width Journal/Craft panels would sit under CharacterScene's
  // HUD buttons (separate scene above this one): lift the UI scene while they are open.
  syncRaise() {
    if (!this.small) return;
    const on = !!(this.journal?.isOpen || this.craftPanel?.isOpen);
    if (on === this._raised) return;
    this._raised = on;
    if (on) this.scene.bringToTop();
    else { if (this.scene.get('character')) this.scene.bringToTop('character'); this.scene.bringToTop('overlay'); }
  }

  // Small HUD buttons next to CHAR / SKILL (keyboard L / U also work)
  buildContentButtons() {
    const y = this.small ? 144 : 124;
    const mk = (x, txt, cb) => {
      const fill = this.add.rectangle(x, y, 62, 20, 0x9bbc0f).setStrokeStyle(1, 0x1a1a22).setDepth(120).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y, txt, { fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#3a1f00' }).setOrigin(0.5).setDepth(121);
      fill.on('pointerover', () => fill.setFillStyle(0xb8d820)); fill.on('pointerout', () => fill.setFillStyle(0x9bbc0f));
      fill.on('pointerdown', () => { audio.play('ui', 0.6); cb(); });
      return [fill, t];
    };
    mk(8 + 31 + 132, 'LOG L', () => { this.craftPanel.close(); bus.emit(Events.JOURNAL, { open: 'toggle' }); });
    mk(8 + 31 + 198, 'CRAFT U', () => { this.journal.close(); bus.emit(Events.CRAFT, { open: 'toggle' }); });
  }

  update(time, delta) {
    const dtS = (delta || 16) / 1000;
    this.fishing?.update(dtS);
    this.craftPanel?.update();
    // Hotbar cooldown sweep
    const w   = this.world();
    const now = w?.time.now ?? 0;
    for (const slot of this.hotbar) {
      const ab = slot.s.ab;
      let remain = 0, total = 1;
      if (ab && w?.player) {
        total  = w.player.skillCd(ab);
        remain = Math.max(0, ((w.player.cooldowns[ab.id] || 0) - now) / 1000);
      }
      const on = remain > 0;
      slot.cdBg.setVisible(on); slot.cdT.setVisible(on);
      if (on) {
        slot.cdBg.setDisplaySize(slot.bw, slot.bh * (remain / total));
        slot.cdT.setText(remain > 1 ? remain.toFixed(0) : remain.toFixed(1));
      }
    }
    // Low-HP pulse (steady tint with Reduce motion)
    if (this.lastHp !== null && w?.player) {
      const frac = w.player.hp / w.player.maxHp;
      if (frac < 0.3 && !w.player.dead) this.vignette.setAlpha(settings.get('reduceMotion') ? 0.15 : 0.15 + 0.1 * Math.sin(this.time.now / 200));
      else if (this.vignette.alpha < 0.2) this.vignette.setAlpha(Math.max(0, this.vignette.alpha - 0.02));
    }
    this.updateMinimap(w);
    if (this.fpsT?.visible && Math.floor(this.time.now / 500) !== this.fpsTick) {
      this.fpsTick = Math.floor(this.time.now / 500);
      this.fpsT.setText(`${Math.round(this.game.loop.actualFps)} FPS`);
    }
  }

  // ── minimap ────────────────────────────────────────────────────────────────
  buildMinimap() {
    const MAP_T = 128;                     // world is 128x128 tiles
    const COL = { water: '#2f6fb0', meadow: '#6cb850', woods: '#2f6b3a', town: '#d8c184', ruins: '#5f6f80' };
    const order = ['meadow', 'woods', 'ruins', 'town'];
    if (!this.textures.exists('hud.mapTerrain')) {
      const t = this.textures.createCanvas('hud.mapTerrain', MAP_T, MAP_T);
      const c = t.getContext();
      c.fillStyle = COL.water; c.fillRect(0, 0, MAP_T, MAP_T);
      for (const id of order) {
        const z = ZONES.find((q) => q.id === id); if (!z) continue;
        c.fillStyle = COL[id]; c.fillRect(z.rect.x, z.rect.y, z.rect.w, z.rect.h);
      }
      t.refresh(); t.setFilter(0);
    }
    // keepFog: a resize / UI-scale relaunch keeps the explored area
    if (this.keepFog && this.textures.exists('hud.mapFog')) {
      this.fogTex = this.textures.get('hud.mapFog');
      this.fogCtx = this.fogTex.getContext();
    } else {
      if (this.textures.exists('hud.mapFog')) this.textures.remove('hud.mapFog');
      this.fogTex = this.textures.createCanvas('hud.mapFog', MAP_T, MAP_T);
      this.fogCtx = this.fogTex.getContext();
      this.fogCtx.fillStyle = '#0d1018'; this.fogCtx.fillRect(0, 0, MAP_T, MAP_T);
      this.fogTex.refresh(); this.fogTex.setFilter(0);
    }
    this.fogLast = null;

    this.mapFrame = this.add.graphics().setDepth(100);
    this.mapImg = this.add.image(0, 0, 'hud.mapTerrain').setOrigin(0).setDepth(101);
    this.fogImg = this.add.image(0, 0, 'hud.mapFog').setOrigin(0).setDepth(102);
    this.mapG = this.add.graphics().setDepth(103);
    this.mapLbl = this.add.text(0, 0, input.labelFor('minimap'), { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#ffd84a',
      stroke: '#1a1024', strokeThickness: 3 }).setOrigin(1, 0).setDepth(104);
    this.mapHit = this.add.zone(0, 0, 10, 10).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(105);
    this.mapHit.on('pointerdown', () => { this.mapLarge = !this.mapLarge; this.layoutMinimap(); });
    this.layoutMinimap();
  }

  layoutMinimap() {
    const { w: W, h: H } = this.view();
    const ms = this.mapLarge ? (this.small ? 150 : 200) : (this.small ? 84 : 112);
    const x = W - ms - 14, y = H - ms - 14;
    this.mapRect = { x, y, ms };
    this.mapImg.setPosition(x, y).setDisplaySize(ms, ms);
    this.fogImg.setPosition(x, y).setDisplaySize(ms, ms);
    this.mapHit.setPosition(x - 4, y - 4).setSize(ms + 8, ms + 8);
    if (this.mapHit.input?.hitArea) { this.mapHit.input.hitArea.width = ms + 8; this.mapHit.input.hitArea.height = ms + 8; }
    this.mapLbl.setPosition(x + ms - 2, y + 2);
    const g = this.mapFrame.clear();
    g.fillStyle(0x1a1024, 1).fillRect(x - 5, y - 5, ms + 10, ms + 10);
    g.fillStyle(0x8a5a2b, 1).fillRect(x - 4, y - 4, ms + 8, ms + 8);
    g.fillStyle(0xd8b070, 1).fillRect(x - 3, y - 3, ms + 6, 1).fillRect(x - 3, y - 3, 1, ms + 6);
    g.fillStyle(0x5a3a1a, 1).fillRect(x - 3, y + ms + 2, ms + 6, 1).fillRect(x + ms + 2, y - 3, 1, ms + 6);
    g.fillStyle(0x1a1024, 1).fillRect(x - 2, y - 2, ms + 4, ms + 4);
  }

  updateMinimap(w) {
    const g = this.mapG; g.clear();
    if (!w?.player || !this.mapRect) return;
    const { x, y, ms } = this.mapRect, k = ms / 128, T = CONFIG.tile;
    const tx = w.player.x / T, ty = w.player.y / T;
    // fog-of-war: carve a soft circle whenever the player has moved 2+ tiles
    if (!this.fogLast || Math.hypot(tx - this.fogLast.x, ty - this.fogLast.y) >= 2) {
      this.fogLast = { x: tx, y: ty };
      const c = this.fogCtx;
      c.save(); c.globalCompositeOperation = 'destination-out';
      for (const [r, a] of [[22, 0.3], [19, 0.5], [16, 1]]) {
        c.fillStyle = `rgba(0,0,0,${a})`; c.beginPath(); c.arc(tx, ty, r, 0, Math.PI * 2); c.fill();
      }
      c.restore(); this.fogTex.refresh();
    }
    // zone outlines (only where explored is fine: fog covers them)
    const dot = (px, py, r, fill) => { g.fillStyle(0x1a1024, 1).fillCircle(px, py, r + 1); g.fillStyle(fill, 1).fillCircle(px, py, r); };
    for (const n of w.npcs || []) dot(x + (n.x / T) * k, y + (n.y / T) * k, 1.6, 0xffd84a);
    // quest markers: gold = quest available, green = turn-in, cyan = talk target
    if (!w.areas?.current) for (const m of w.quests?.markerList() || []) {
      if (m.area) continue;
      const mx = x + (m.x / T) * k, my = y + (m.y / T) * k, col = m.kind === 'talk' ? 0x7fdcff : m.kind === '?' ? 0x9be88a : 0xffd84a;
      g.fillStyle(0x1a1024, 1).fillTriangle(mx, my - 5, mx - 4, my + 2, mx + 4, my + 2);
      g.fillStyle(col, 1).fillTriangle(mx, my - 3.6, mx - 2.6, my + 1, mx + 2.6, my + 1);
    }
    // other players: party green (bigger), friends pink, guild gold, else blue; grey = peer inside an interior/dungeon
    const REL = { party: 0x7dff9a, friend: 0xff9ad5, guild: 0xffd84a, other: 0x5ad0ff };
    w.sync?.remotes?.forEach((r, id) => { const m = r.mapPos ? r.mapPos() : r; if (!m) return; const rel = social.relation(id); dot(x + (m.x / T) * k, y + (m.y / T) * k, rel === 'party' ? 2.6 : 2, m.grey ? 0x7a7a88 : REL[rel]); });
    const blink = 0.5 + 0.5 * Math.sin(this.time.now / 250);
    const px = x + tx * k, py = y + ty * k;
    g.fillStyle(0xffffff, 0.25 + 0.3 * blink).fillCircle(px, py, 4.5);
    dot(px, py, 2.4, 0xffffff);
  }
}
