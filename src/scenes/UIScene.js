import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { PALETTES } from '../core/palette.js';
import { ZONES } from '../data/zones.js';
import { audio } from '../systems/audio.js';
import { CONFIG } from '../config.js';
import { makeHudIcons, HUD_ABILITY_ICON } from '../systems/hudIcons.js';
import { createAdvBar, updateAdvBar } from '../ui/advSkillBar.js';
import { createCombatReadability } from '../ui/hudPolish.js';
import { EquipPanel } from '../ui/EquipPanel.js';
import { ShopPanel } from '../ui/ShopPanel.js';
import { social } from '../systems/social/index.js';
import { installSocialUI } from '../ui/socialUI.js';
import { installEconomyUI } from '../ui/economyUI.js';
import { JournalPanel } from '../ui/JournalPanel.js';
import { CraftPanel } from '../ui/CraftPanel.js';
import { FishingGame } from '../ui/FishingGame.js';
import { Toaster } from '../ui/Toast.js';
import { input } from '../core/input.js';
import { settings, uiZoomFor } from '../core/settings.js';
import { PauseMenu } from '../ui/PauseMenu.js';
import { HelpOverlay } from '../ui/HelpOverlay.js';
import { WalletPanel } from '../ui/WalletPanel.js';
import { DailyRewardPanel } from '../ui/DailyRewardPanel.js';
import LFGPanel from '../ui/LFGPanel.js';
import SeasonPanel from '../ui/SeasonPanel.js';
import GuildPanel from '../ui/GuildPanel.js';
import { WorldBossAlert } from '../ui/WorldBossAlert.js';
import { ArenaPanel } from '../ui/ArenaPanel.js';
import { SkillTreePanel } from '../ui/SkillTreePanel.js';
import { ArenaChallengeModal } from '../ui/ArenaChallengeModal.js';
import { arenaNet } from '../net/arenaNet.js';
import { agentsNet } from '../net/agentsNet.js';
import { AgentPanel } from '../ui/AgentPanel.js';
import { AgentBoardPanel } from '../ui/AgentBoardPanel.js';
import DungeonSystem from '../systems/dungeonSystem.js';
import SeasonSystem from '../systems/seasonSystem.js';
import GuildSystem from '../systems/guildSystem.js';
import { DailyRewards } from '../systems/dailyRewards.js';
import { econ } from '../net/economyNet.js';
import { fullscreenSupported, isFullscreen, toggleFullscreen } from '../core/mobile.js';

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
    // Small-screen legibility floor: canvas stat numbers never render below
    // 8px on phones; desktop sizes pass through untouched so layout is stable.
    const statPx = (px) => (this.small ? Math.max(px, 8) : px);

    this._ns(8, 8, pw, 106);       // wood frame panel
    this.nameT = this.add.text(18, 15, `${this.pname} · ${this.job.name} Lv 1`, F(this.small ? 10 : 11, '#fff8e0', { fontStyle: 'bold' })).setDepth(101);

    const mkBar = (glyph, y, h, bgc, fc) => {
      this.add.image(18, y + h / 2, `hud.${glyph}`).setOrigin(0, 0.5).setDepth(102);
      this.add.rectangle(barX - 1, y - 1, pbw + 2, h + 2, 0x1a1024, 1).setOrigin(0).setDepth(101);
      this.add.rectangle(barX, y, pbw, h, bgc, 1).setOrigin(0).setDepth(102);
      return this.add.rectangle(barX, y, pbw, h, fc).setOrigin(0).setDepth(103);
    };
    this.hpBar = mkBar('heart', 32, 14, 0x3a1014, 0x4cc060);
    this.hpT   = this.add.text(barX + pbw / 2, 39, '', F(statPx(9), '#ffffff', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(0.5).setDepth(104);
    this.mpBar = mkBar('mana', 52, 11, 0x0c1a3a, 0x3a9cf0);
    this.mpT   = this.add.text(barX + pbw / 2, 57.5, '', F(statPx(8), '#ffffff', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(0.5).setDepth(104);
    this.xpBar = mkBar('xp', 69, 7, 0x2a2008, 0xffd84a);
    // A percentage makes the thin XP bar useful at a glance, especially on a
    // phone where exact XP totals would compete with the resource readout.
    this.xpT = this.add.text(barX + pbw, 72.5, '0%', F(statPx(7), '#2a1d10', { fontStyle: 'bold' }))
      .setOrigin(1, 0.5).setDepth(104);

    // gold / potions / atk+def as glyph + number
    this.add.image(18, 92, 'hud.coin').setOrigin(0, 0.5).setDepth(102);
    this.goldT = this.add.text(36, 92, '0', F(statPx(10), '#ffe27a')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(78, 92, 'hud.potion').setOrigin(0, 0.5).setDepth(102);
    this.potT  = this.add.text(96, 92, '0', F(statPx(10), '#ffb0a0')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(122, 92, 'hud.sword').setOrigin(0, 0.5).setDepth(102);
    this.atkT  = this.add.text(140, 92, '0', F(statPx(10), '#e6f2c0')).setOrigin(0, 0.5).setDepth(102);
    this.add.image(pw - 46, 92, 'hud.shield').setOrigin(0, 0.5).setDepth(102);
    this.defT  = this.add.text(pw - 28, 92, '0', F(statPx(10), '#aed6f1')).setOrigin(0, 0.5).setDepth(102);

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
    // narrow / portrait screens: slide the hotbar left so it never sits under the bottom-right minimap
    const mmLeft = W - (this.small ? 84 : 112) - 14 - 8;
    let hotX0 = W / 2 - hotTotalW / 2;
    if (hotX0 + hotTotalW > mmLeft) hotX0 = Math.max(6, mmLeft - hotTotalW);
    slots.forEach((s, i) => {
      const x = hotX0 + i * cellSt + cellSt / 2;
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

      // Cooldowns drain down from the slot's top edge. Keeping a fixed edge
      // avoids the old centre-shrinking mask, which made remaining time harder
      // to judge during busy combat.
      const cdBg = this.add.rectangle(x, hotY - cellH / 2 + 1, cellW - 2, cellH - 2, 0x000000, 0.70)
        .setOrigin(0.5, 0).setDepth(105).setVisible(false);
      const cdT  = this.add.text(x, hotY, '', {
        fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold',
        stroke: '#1a1024', strokeThickness: 3,
      }).setOrigin(0.5).setDepth(106).setVisible(false);

      bg.on('pointerover', () => this.setHotbarHint(`${input.labelFor(s.action)} · ${s.name}`));
      bg.on('pointerout', () => this.setHotbarHint(''));
      bg.on('pointerdown', () => {
        const w = this.world();
        if (!w?.player) return;
        audio.play('ui', 0.6);
        if (s.ab) w.cast(s.ab.key);
        else w.drinkPotion();
      });
      this.hotbar.push({ bg, s, cdBg, cdT, bw: cellW, bh: cellH, badgeBg, badgeT });
    });

    // A compact contextual label confirms what a hotbar icon does without
    // permanently adding another row of text to the combat HUD.
    this.hotbarHint = this.add.text(W / 2, hotY - cellH / 2 - (this.small ? 10 : 12), '', F(8, '#fff0b2', {
      backgroundColor: '#1a1024cc', padding: { x: 4, y: 2 },
      stroke: '#1a1024', strokeThickness: 2,
    })).setOrigin(0.5, 1).setDepth(130).setVisible(false);

    createAdvBar(this, W / 2, hotY - cellH / 2 - (this.small ? 24 : 26), this.small ? 34 : 40); // class skills 5/6

    // ── Combat readability (ui/hudPolish.js) ────────────────────────────────
    // Cooldown/MP clarity on the hotbar, low-HP/MP warning frames and the
    // player status strip. Pure presentation: it reads cooldowns/MP/statuses
    // that already exist and never mutates gameplay state. destroy() is owned
    // by the shutdown handler below.
    // Anchor: right of the resource panel on desktop (that column is always
    // free); on phones the top row is taken, so tuck it above the hotbar.
    this.combatRead = createCombatReadability(this, {
      slots: this.hotbar,
      getPlayer: () => this.world()?.player,
      getNow: () => this.world()?.time?.now ?? 0,
      hpBar: this.hpBar,
      mpBar: this.mpBar,
      isMobile: CONFIG.isMobile,
      statusList: () => {
        const w = this.world();
        return w?.combat?.statuses?.list(w?.time?.now ?? 0) || [];
      },
      anchor: this.small ? { x: 10, y: hotY - cellH / 2 - 42 } : { x: 8 + pw + 12, y: 12 },
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
      input.addCloser({ id: 'wallet', priority: 880, isOpen: () => this.walletPanel?.isOpen, close: () => this.walletPanel?.close() }),
      input.addCloser({ id: 'daily-reward', priority: 870, isOpen: () => this.dailyPanel?.isOpen, close: () => this.dailyPanel?.close() }),
      input.addCloser({ id: 'lfg', priority: 940, isOpen: () => !!this.lfgPanel?.visible, close: () => this.lfgPanel?.close() }),
      input.addCloser({ id: 'season', priority: 930, isOpen: () => !!this.seasonPanel?.visible, close: () => this.seasonPanel?.close() }),
      input.addCloser({ id: 'guild', priority: 920, isOpen: () => !!this.guildPanel?.visible, close: () => this.guildPanel?.close() }),
      input.addCloser({ id: 'arena', priority: 935, isOpen: () => !!this.arenaPanel?.container, close: () => this.arenaPanel?.hide() }),
      input.addCloser({ id: 'spec', priority: 936, isOpen: () => !!this.skillTreePanel?.container, close: () => this.skillTreePanel?.hide() }),
      input.addCloser({ id: 'agent', priority: 925, isOpen: () => !!this.agentPanel?.visible, close: () => this.agentPanel?.close() }),
      input.addCloser({ id: 'agent-board', priority: 924, isOpen: () => !!this.agentBoardPanel?.visible, close: () => this.agentBoardPanel?.close() }),
      input.addCloser({ id: 'pause-sub', priority: 850, isOpen: () => this.menu.isOpen && this.menu.page !== 'main', close: () => this.menu.goto('main') }),
      input.addCloser({ id: 'shop', priority: 450, isOpen: () => !!this.shop?.isOpen, close: () => this.shop.close() }),
      input.addCloser({ id: 'equip', priority: 400, isOpen: () => !!this.equip?.isOpen, close: () => this.equip.toggle(false) }),
      // pause is drawn above every panel (it can be opened over one from the HUD II button), so it closes first
      input.addCloser({ id: 'pause', priority: 800, isOpen: () => this.menu.isOpen, close: () => this.menu.close() }),
      input.on('menu', () => { this.menu.open('main'); return true; }),
      input.on('help', () => { this.help.toggle(); return true; }),
      input.on('chat', () => this.openChat()),
      input.on('mute', () => { const on = audio.toggle(); this.say(`Sound ${on ? 'on' : 'muted'} (${input.labelFor('mute')})`); }),
      input.onChange(() => this.refreshKeyLabels()),
      settings.onChange((k) => { if (k === 'showFps') this.fpsT?.setVisible(settings.get('showFps')); }),
    );
    this.offs.push(
      input.addCloser({ id: 'social', priority: 950, isOpen: () => !!this.social?.anyOpen?.(), close: () => social.act('closeAll') }),
      input.addCloser({ id: 'pet-duel-request', priority: 960, isOpen: () => !!this.social?.petDuelReq?.container, close: () => this.social?.petDuelReq?.hide?.() }),
      input.addCloser({ id: 'arena-challenge', priority: 965, isOpen: () => !!this.arenaChallenge?.container, close: () => this.arenaChallenge?._decline?.() }),
      input.addCloser({ id: 'fishing', priority: 700, isOpen: () => !!this.fishing?.isOpen, close: () => this.fishing.end('cancel') }),
      input.addCloser({ id: 'journal', priority: 470, isOpen: () => !!this.journal?.isOpen, close: () => this.journal.close() }),
      input.addCloser({ id: 'craft', priority: 460, isOpen: () => !!this.craftPanel?.isOpen, close: () => this.craftPanel.close() }),
      // Large minimap (M / tap) collapses before anything else closes; the
      // world-boss banner dismisses (its ✕ button stays the explicit close).
      input.addCloser({ id: 'minimap-large', priority: 300, isOpen: () => !!this.mapLarge, close: () => { this.mapLarge = false; this.layoutMinimap(); } }),
      input.addCloser({ id: 'worldboss', priority: 750, isOpen: () => !!this.worldBossAlert?.visible, close: () => this.worldBossAlert?.hide() }),
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
      this.combatRead?.destroy(); // detaches its bus handlers + frees its HUD objects
      this.resizeTimer?.remove(false);
      this.equip?.destroy(); this.shop?.destroy(); this.journal?.destroy(); this.craftPanel?.destroy(); this.fishing?.destroy(); this.toast?.destroy(); this.walletPanel?.destroy();
      this.dailyPanel?.destroy(); this.dailyRewards?.destroy();
      this.partyFinderBtn?.destroy(); this.lfgBtn?.destroy(); this.seasonBtn?.destroy(); this.guildBtn?.destroy(); this.arenaBtn?.destroy(); this.specBtn?.destroy(); this.worldBossBtn?.destroy(); this.agentBtn?.destroy(); this.agentBoardBtn?.destroy();
      this.lfgPanel?.destroy(); this.seasonPanel?.destroy(); this.guildPanel?.destroy(); this.arenaPanel?.destroy(); this.skillTreePanel?.destroy(); this.arenaChallenge?.destroy(); this.worldBossAlert?.destroy(); this.agentPanel?.destroy(); this.agentBoardPanel?.destroy();
      this.dungeonSystem?.destroy(); this.seasonSystem?.destroy(); this.guildSystem?.destroy();
    });
    // Mail unread indicator for the touch HUD
    this.offs.push(
      econ.on('mail-unread', () => { if (this.mailBtnText) this.mailBtnText.setText(econ.mailUnread ? `✉ ${econ.mailUnread}` : '✉'); })
    );

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
    // touch: fullscreen toggle next to the menu / help buttons (hidden where the API is missing, e.g. iPhone Safari, or already installed)
    if (('ontouchstart' in window || navigator.maxTouchPoints > 0) && fullscreenSupported() && !document.documentElement.classList.contains('wf-standalone')) {
      this.fsBtn = hb(hbX - 52, isFullscreen() ? '><' : '[]', () => {});
      // fullscreen needs a *user activation*: on touch that is granted at touchend (pointerup), not touchstart
      this.fsBtn[0].removeAllListeners('pointerdown');
      this.fsBtn[0].on('pointerup', () => { audio.play('ui', 0.6); toggleFullscreen(); setTimeout(() => this.fsBtn?.[1]?.setText(isFullscreen() ? '><' : '[]'), 400); });
    }
    this.fpsT = this.add.text(hbX - (this.fsBtn ? 58 : 32), 12, '', F(9, '#9bf06b', { stroke: '#1a1024', strokeThickness: 3 })).setOrigin(1, 0).setDepth(121).setVisible(settings.get('showFps'));
    this.offs.push(bus.on(Events.TOAST, (t) => this.toast?.push(t)));

    this.buildTouch();
    this.buildPanels();
    this.buildWalletRewards();
    this.buildDailyReward();
    // Social UI: chat window, party frames, players/friends, emote wheel (src/ui/socialUI.js)
    this.social = installSocialUI(this, { name: this.pname, job: this.job.id, framesY: this.small ? 136 : 134 });
    this.economy = installEconomyUI(this); // trade / market board / mail / guild tab (src/ui/economyUI.js)

    // ── Feature panels: LFG, season pass, guild, world boss alert ─────────────
    this.dungeonSystem = new DungeonSystem(this.world(), net);
    const onceAttach = (handler) => {
      let off = null;
      let attached = false;
      const hook = (room) => {
        if (attached) return;
        attached = true;
        const h = (type, payload) => handler(type, payload);
        room.onMessage('*', (type, payload) => h(type, payload));
        off = () => room.onMessage('*', () => {});
      };
      const detach = net.onAttach(hook);
      return () => { detach(); off?.(); };
    };
    this.seasonSystem = new SeasonSystem(this, { send: (t, p) => net.send(t, p), onBroadcast: onceAttach });
    this.seasonSystem.attachGameSources?.({ dungeons: this.dungeonSystem, arena: arenaNet, playerName: this.pname });
    this.guildSystem = new GuildSystem(this, { send: (t, p) => net.send(t, p), onBroadcast: onceAttach });
    const cx = W / 2, cy = H / 2;
    this.lfgPanel = new LFGPanel(this, cx, cy);
    this.lfgPanel.onQueue = (req) => this.dungeonSystem.queue(req.dungeonId, req.role, req.groupMode);
    this.lfgPanel.onAccept = () => this.dungeonSystem.acceptMatch();
    this.seasonPanel = new SeasonPanel(this, cx, cy, { seasonSystem: this.seasonSystem, onClaim: (tier, track) => this.seasonSystem.claim(tier, track), onUpgrade: () => this.seasonSystem.upgradePremium() });
    this.guildPanel = new GuildPanel(this, cx, cy, this.guildSystem);
    this.arenaPanel = new ArenaPanel(this);
    this.skillTreePanel = new SkillTreePanel(this);
    this.agentPanel = new AgentPanel(this);
    this.arenaChallenge = new ArenaChallengeModal(this);
    // Arena wires: server-resolved combat result -> toast; rating packet -> refresh.
    this.offs.push(
      arenaNet.onChallenge((m) => { this.arenaChallenge?.show(m || {}); }),
      arenaNet.onDeclined((m) => {
        this.arenaChallenge?.hide();
        this.say(`${m?.fromName || 'Opponent'} declined the arena duel.`);
      }),
      arenaNet.onResult((m) => {
        // Rating packets can arrive immediately before combat-result; the panel
        // correlates them by matchId and presents both together.
        arenaNet.refreshRating();
      }),
      arenaNet.onCombatResult((m) => {
        const won = !!arenaNet.sessionId() && m?.winner === arenaNet.sessionId();
        const line = m?.disputed || m?.status === 'disputed' || !m?.winner
          ? 'Arena result disputed or unverified. No rating change was applied.'
          : `Arena duel ${won ? 'won' : 'lost'}${m?.reason ? ` (${m.reason})` : ''}.`;
        this.toast?.push({ title: 'Arena result', text: line, color: won ? '#14f195' : '#03e1ff' });
        this.say(line);
      }),
      arenaNet.onError((m) => { this.say(`Arena: ${m?.msg || 'unavailable'}`); }),
    );
    this.worldBossAlert = new WorldBossAlert(this, W / 2, 110, {
      onTeleport: () => {
        const d = this._worldBossData;
        const w = this.world();
        if (d && w?.player) { w.player.x = d.x; w.player.y = d.y; this.say(`Teleported to ${d.name} in ${(d.area || 'ruins').toUpperCase()}.`); }
      },
      onDismiss: () => {},
    });
    // World boss server broadcasts
    this._worldBossSpawnOff = sub(Events.WORLDBOSS_SPAWN, (d) => {
      if (!d || !this.worldBossAlert) return;
      this._worldBossData = d;
      this.worldBossAlert.show({ name: d.name, zone: d.area, area: d.area, x: d.x, y: d.y, spawnAt: d.expiresAt - 30*60*1000, expiresAt: d.expiresAt });
    });
    this._worldBossSlainOff = sub(Events.WORLDBOSS_SLAIN, (d) => { this.say(`${d.name} defeated by ${d.killerName || 'heroes'}!`); this.worldBossAlert?.hide(); });
    this.offs.push(this._worldBossSpawnOff, this._worldBossSlainOff);

    // Pet duel challenge listener: must live after social UI mounts so the request modal exists.
    this._petDuelOff = bus.on(Events.PET_DUEL_START, (payload) => {
      const challenger = payload?.challenger ?? payload;
      if (this.social?.petDuelReq) this.social.petDuelReq.show(challenger);
      else social.system(`${challenger} wants a pet duel — /pda to accept, /pdd to decline.`);
    });
    this.offs.push(this._petDuelOff);
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
    // An empty tracker looked like a rendering failure. Give a short next
    // action while retaining the compact fixed HUD footprint.
    this.questT.setText(q || `No active quest\nJournal [${input.labelFor('journal')}]`);
    const h = Math.ceil(this.questT.height) + 26 + 8;
    this.questPanel.setSize(this.questW, h);
    this.questPanel.fallbackRect.setSize(this.questW, h);
  }
  drawXp(p) {
    const frac = Math.max(0, Math.min(1, p.xp / Math.max(1, p.xpNext)));
    this.xpBar.setDisplaySize(this.hpBarW * frac, this.barH.xp);
    this.xpT?.setText(`${Math.floor(frac * 100)}%`);
  }

  setHotbarHint(text) {
    if (!this.hotbarHint?.active) return;
    this.hotbarHint.setText(text);
    this.hotbarHint.setVisible(!!text);
  }

  openChat() { social.act('openChat'); } // Enter -> chat input (closes on Enter/Esc)

  refreshMode() { if (this.menu?.isOpen) this.menu.build(); }

  togglePause() { this.menu.toggle(); } // back-compat


  // ─── Wallet + Rewards HUD icons (top-right) ───
  buildWalletRewards() {
    const { w: W } = this.view();
    const iconSize = 22;
    const gap = 6;
    const baseX = W - 12;
    const startY = 72; // below quest panel header area

    // Wallet icon
    this.walletBtn = this.add.text(baseX, startY, '🔐', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#ffd84a',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.walletBtn.on('pointerover', () => this.walletBtn.setBackgroundColor('#3a2d20ee'));
    this.walletBtn.on('pointerout', () => this.walletBtn.setBackgroundColor('#2a1d10dd'));
    this.walletBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.walletPanel.toggle(); });

    // Rewards icon
    this.rewardsBtn = this.add.text(baseX - iconSize - gap, startY, '🏆', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#7dff9a',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.rewardsBtn.on('pointerover', () => this.rewardsBtn.setBackgroundColor('#3a2d20ee'));
    this.rewardsBtn.on('pointerout', () => this.rewardsBtn.setBackgroundColor('#2a1d10dd'));
    this.rewardsBtn.on('pointerdown', () => { audio.play('ui', 0.6); bus.emit('econ-ui', { panel: 'claim' }); });

    // Party finder icon (left of rewards)
    this.partyFinderBtn = this.add.text(baseX - (iconSize + gap) * 2, startY, '👥', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#03e1ff',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.partyFinderBtn.on('pointerover', () => this.partyFinderBtn.setBackgroundColor('#3a2d20ee'));
    this.partyFinderBtn.on('pointerout', () => this.partyFinderBtn.setBackgroundColor('#2a1d10dd'));
    this.partyFinderBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.economy?.partyFinder?.toggle(this); });


    // LFG icon
    this.lfgBtn = this.add.text(baseX - (iconSize + gap) * 3, startY, '⚔', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#14f195',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.lfgBtn.on('pointerover', () => this.lfgBtn.setBackgroundColor('#3a2d20ee'));
    this.lfgBtn.on('pointerout', () => this.lfgBtn.setBackgroundColor('#2a1d10dd'));
    this.lfgBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.lfgPanel?.open(); });

    // Season pass icon
    this.seasonBtn = this.add.text(baseX - (iconSize + gap) * 4, startY, '🏆', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#ffd84a',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.seasonBtn.on('pointerover', () => this.seasonBtn.setBackgroundColor('#3a2d20ee'));
    this.seasonBtn.on('pointerout', () => this.seasonBtn.setBackgroundColor('#2a1d10dd'));
    this.seasonBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.seasonPanel?.open(); });

    // Guild icon
    this.guildBtn = this.add.text(baseX - (iconSize + gap) * 5, startY, '⚜', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#9945ff',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.guildBtn.on('pointerover', () => this.guildBtn.setBackgroundColor('#3a2d20ee'));
    this.guildBtn.on('pointerout', () => this.guildBtn.setBackgroundColor('#2a1d10dd'));
    this.guildBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.guildPanel?.open(); });
    // Arena icon
    this.arenaBtn = this.add.text(baseX - (iconSize + gap) * 6, startY, '⚡', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#dc1fff',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.arenaBtn.on('pointerover', () => this.arenaBtn.setBackgroundColor('#3a2d20ee'));
    this.arenaBtn.on('pointerout', () => this.arenaBtn.setBackgroundColor('#2a1d10dd'));
    this.arenaBtn.on('pointerdown', () => { audio.play('ui', 0.6); if (this.arenaPanel?.container) this.arenaPanel.hide(); else this.arenaPanel?.show(); });
    // Skill-tree icon (✦ unused by ⚔ 🏆 👥 ⚜ ⚡ 🎁)
    this.specBtn = this.add.text(baseX - (iconSize + gap) * 7, startY, '✦', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#14f195',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.specBtn.on('pointerover', () => this.specBtn.setBackgroundColor('#3a2d20ee'));
    this.specBtn.on('pointerout', () => this.specBtn.setBackgroundColor('#2a1d10dd'));
    this.specBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.skillTreePanel?.toggle(); });
    // Agent icon (right of the skill-tree icon): opens the autonomous-agent panel.
    this.agentBtn = this.add.text(baseX - (iconSize + gap) * 8, startY, '🤖', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#03e1ff',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.agentBtn.on('pointerover', () => this.agentBtn.setBackgroundColor('#3a2d20ee'));
    this.agentBtn.on('pointerout', () => this.agentBtn.setBackgroundColor('#2a1d10dd'));
    this.agentBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.agentPanel?.toggle(); });
    // World-agents board icon (📡): a PUBLIC, read-only view of the autonomous
    // agents currently in the world (src/ui/AgentBoardPanel.js, GET /agents).
    this.agentBoardBtn = this.add.text(baseX - (iconSize + gap) * 9, startY, '📡', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#14f195',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.agentBoardBtn.on('pointerover', () => this.agentBoardBtn.setBackgroundColor('#3a2d20ee'));
    this.agentBoardBtn.on('pointerout', () => this.agentBoardBtn.setBackgroundColor('#2a1d10dd'));
    this.agentBoardBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.agentBoardPanel?.toggle(); });
    this.walletPanel = new WalletPanel(this);
    this.agentBoardPanel = new AgentBoardPanel();
  }

  // —— Daily login reward HUD icon + panel
  buildDailyReward() {
    const { w: W } = this.view();
    const iconSize = 22;
    const gap = 6;
    const baseX = W - 12 - iconSize - gap - 22; // left of wallet icon
    const startY = 72;

    this.dailyBtn = this.add.text(baseX, startY, '🎁', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#e1e8f0',
      backgroundColor: '#2a1d10dd', padding: { x: 4, y: 2 },
    }).setOrigin(1, 0).setDepth(110).setInteractive({ useHandCursor: true });
    this.dailyBtn.on('pointerover', () => this.dailyBtn.setBackgroundColor('#3a2d20ee'));
    this.dailyBtn.on('pointerout', () => this.dailyBtn.setBackgroundColor('#2a1d10dd'));
    this.dailyBtn.on('pointerdown', () => { audio.play('ui', 0.6); this.openDailyReward(); });

    this.dailyPanel = new DailyRewardPanel();
    this.dailyRewards = new DailyRewards(this.world());

    // Listen for auto-open request from DailyRewards boot check.
    this.dailyRewardOff = bus.on(Events.DAILY_REWARD, (e) => {
      if (e?.open && !this.dailyPanel.isOpen) this.openDailyReward();
    });
    this.offs.push(this.dailyRewardOff);

    // Pulse / glow when claimable.
    this.dailyPulse = this.tweens.add({
      targets: this.dailyBtn,
      alpha: { from: 1, to: 0.55 },
      duration: 700,
      yoyo: true,
      repeat: -1,
      paused: true,
    });
    this.updateDailyRewardBtn();
  }

  openDailyReward() {
    this.dailyPanel.open(this, this.dailyRewards);
    this.dailyPulse?.pause();
    this.dailyBtn.setAlpha(1);
  }

  updateDailyRewardBtn() {
    if (!this.dailyBtn?.active) return;
    const claimable = this.dailyRewards?.isClaimableToday();
    if (claimable) {
      this.dailyBtn.setColor('#03e1ff');
      this.dailyPulse?.resume();
    } else {
      this.dailyBtn.setColor('#6b7a99');
      this.dailyPulse?.pause();
      this.dailyBtn.setAlpha(1);
    }
  }

  buildTouch() {
    const { w: W, h: H } = this.view();
    this.touchUI = this.add.container(0, 0).setDepth(150);
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    this.input.addPointer(4); // stick + several action buttons held at the same time (5 touch pointers)
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
    // LOG / CRAFT: a second column left of BAG / Q (same rows) so nothing overlaps at 844x390, 390x844, 768x1024
    const qx = W - 50 - 2 * R - 18, colX = qx - 2 * R - 14;
    mkBtn(colX, mmTop - 3 * R - 12, 'LOG', () => bus.emit(Events.JOURNAL, { open: 'toggle' }));
    mkBtn(colX, mmTop - R + 2, 'CFT', () => bus.emit(Events.CRAFT, { open: 'toggle' }));
    mkBtn(colX - 2 * R - 14, mmTop - 3 * R - 12, 'CHT', () => this.openChat());
    const [mailC, mailT] = (() => {
      const x = colX - 2 * R - 14, y = mmTop - R + 2;
      const c = this.add.circle(x, y, R, 0x000000, 0.5).setStrokeStyle(2, 0xffffff, 0.25).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y, '✉', { fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '12px' : '11px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      c.on('pointerdown', () => { audio.play('ui', 0.5); c.setFillStyle(0xffffff, 0.35); this.openMail(); });
      c.on('pointerup', () => c.setFillStyle(0x000000, 0.5));
      c.on('pointerout', () => c.setFillStyle(0x000000, 0.5));
      this.touchUI.add([c, t]);
      return [c, t];
    })();
    this.mailBtn = mailC; this.mailBtnText = mailT;
    if (econ.mailUnread) this.mailBtnText.setText(`✉ ${econ.mailUnread}`);
  }
  openMail() { this.economy?.mail?.toggle(); }

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
    input.registerAction({ id: 'spec', label: 'Skill tree', group: 'Panels', keys: ['KeyT'], gameplay: true });
    this.offs.push(
      input.on('journal', () => { if (!blocked()) { this.craftPanel.close(); bus.emit(Events.JOURNAL, { open: 'toggle' }); } return true; }),
      input.on('craft', () => { if (!blocked()) { this.journal.close(); bus.emit(Events.CRAFT, { open: 'toggle' }); } return true; }),
      input.on('spec', () => { if (!blocked()) this.skillTreePanel?.toggle(); return true; }),
    );
    this.scale.on('resize', () => { this.equip.resize(); this.shop.refresh(); this.journal.resize(); this.craftPanel.resize(); });
    this.buildContentButtons();
  }

  // On phones the full-width Journal/Craft panels would sit under CharacterScene's
  // HUD buttons (separate scene above this one): lift the UI scene while they are open.
  syncRaise() {
    if (!this.small) return;
    // (bag / shop are full-screen on phones too: CHAR/SKILL buttons used to cover their header + HEAD slot)
    const on = !!(this.journal?.isOpen || this.craftPanel?.isOpen || this.equip?.isOpen || this.shop?.isOpen);
    if (on === !!this._raised) return;
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
    this.combatRead?.update(); // cooldown/MP badges, low-resource warnings, status strip
    this.syncRaise(); // no-op unless a full-screen panel opened/closed (phones)
    if (this.dailyRewards && Math.floor(time / 1000) !== this._dailySec) {
      this._dailySec = Math.floor(time / 1000);
      this.updateDailyRewardBtn();
    }
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
    updateAdvBar(this, w, now);
    // Low-HP pulse (steady tint with Reduce motion)
    if (this.lastHp !== null && w?.player) {
      const frac = w.player.hp / w.player.maxHp;
      if (frac < 0.3 && !w.player.dead) this.vignette.setAlpha(settings.get('reduceMotion') ? 0.15 : 0.15 + 0.1 * Math.sin(this.time.now / 200));
      else if (this.vignette.alpha < 0.2) this.vignette.setAlpha(Math.max(0, this.vignette.alpha - 0.02));
    }
    this.updateMinimap(w);
    this.worldBossAlert?.update();
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
    w.sync?.remotes?.forEach((r, id) => {
      const m = r.mapPos ? r.mapPos() : r; if (!m) return;
      const mx = x + (m.x / T) * k, my = y + (m.y / T) * k;
      // Agents are marked apart from players: a magenta diamond (Solana accent)
      // so a peer that is an autonomous agent reads as an agent at a glance.
      if (agentsNet.isAgent(id)) {
        g.fillStyle(0x1a1024, 1).fillTriangle(mx, my - 4, mx - 4, my, mx + 4, my).fillTriangle(mx, my + 4, mx - 4, my, mx + 4, my);
        g.fillStyle(0xdc1fff, 1).fillTriangle(mx, my - 3, mx - 3, my, mx + 3, my).fillTriangle(mx, my + 3, mx - 3, my, mx + 3, my);
        return;
      }
      const rel = social.relation(id); dot(mx, my, rel === 'party' ? 2.6 : 2, m.grey ? 0x7a7a88 : REL[rel]);
    });
    const blink = 0.5 + 0.5 * Math.sin(this.time.now / 250);
    const px = x + tx * k, py = y + ty * k;
    g.fillStyle(0xffffff, 0.25 + 0.3 * blink).fillCircle(px, py, 4.5);
    dot(px, py, 2.4, 0xffffff);
  }
}
