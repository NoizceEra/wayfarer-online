import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { PALETTES } from '../core/palette.js';
import { ZONES } from '../data/zones.js';
import { audio } from '../systems/audio.js';
import { CONFIG } from '../config.js';
import { makeHudIcons, HUD_ABILITY_ICON } from '../systems/hudIcons.js';
import { gearById, statLine, SHOP_STOCK, SLOTS } from '../data/gear.js';

// HUD: HP/MP/XP bars, hotbar with cooldown sweep (clickable), minimap,
// quest tracker, chat, party, pause (palette + mute), GB tint + scanlines,
// damage vignette + low-HP pulse, touch controls (stick + ATK/SKL/E/Q).
export class UIScene extends Phaser.Scene {
  constructor() { super('ui'); }
  init(data) { this.hero = data.hero; this.pname = data.name; this.job = data.job; }
  world() { return this.scene.get('world'); }

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
    const bg = this.add.rectangle(x, y, w, h, 0x2a1d10, 0.92).setOrigin(ox, oy).setDepth(depth - 1);
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

  create() {
    const { width: W, height: H } = this.scale;
    this.minimapOn = true;
    this.lastHp = null;
    this.small = W < 560;
    this.invOpen = false; this.shopOpen = false;

    // ── GB palette tint + scanlines ─────────────────────────────────────────
    const pal = PALETTES[this.hero.palette] || PALETTES.classic;
    this.gbTint = this.add.rectangle(0, 0, W, H, pal.bg, this.hero.palette === 'modern' ? 0 : 0.06)
      .setOrigin(0).setDepth(90).setScrollFactor(0);
    this.scan = this.add.graphics().setDepth(91);
    this.drawScan();
    this.scale.on('resize', () => {
      this.gbTint.setDisplaySize(this.scale.width, this.scale.height);
      this.drawScan();
    });

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
      ...this.job.abilities.map((a) => ({ key: a.key, name: a.name, ab: a })),
      { key: 'Q', name: 'Potion', ab: null },
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

      // key badge (top-left corner)
      this.add.rectangle(x - cellW / 2 + 3, hotY - cellH / 2 + 3, 13, 13, 0x1a1024, 0.95).setOrigin(0).setDepth(103);
      this.add.text(x - cellW / 2 + 9.5, hotY - cellH / 2 + 9.5, s.key, {
        fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#ffd84a',
      }).setOrigin(0.5).setDepth(104);

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
      this.hotbar.push({ bg, s, cdBg, cdT, bw: cellW, bh: cellH });
    });

    // ── Chat / system log (bottom-left) ─────────────────────────────────────
    this.log = [];
    const logW      = this.small ? 226 : 310;
    const logH      = this.small ? 76  : 100;
    const logPanelY = H - logH - 82;
    this.logPanel = this._ns(8, logPanelY - 4, logW, logH + 10, 'ui.panelBg', 4, 4, 4, 4, 0, 0, 100);
    this.logT = this.add.text(16, logPanelY + 1, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '9px' : '10px',
      color: '#e6f2c0', wordWrap: { width: logW - 16 }, fixedHeight: logH,
    }).setDepth(101);
    this.chatHint = this.add.text(16, logPanelY - 9, 'chat', {
      fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#9bbc0f',
    }).setDepth(102).setInteractive({ useHandCursor: true });
    this.logCollapsed = this.small;
    this.chatHint.on('pointerdown', () => {
      this.logCollapsed = !this.logCollapsed;
      const vis = !this.logCollapsed;
      this.logT.setVisible(vis);
      this.logPanel.setVisible(vis);
    });
    if (this.logCollapsed) { this.logT.setVisible(false); this.logPanel.setVisible(false); }

    // ── Minimap (bottom-right): framed, fog-of-war, M toggles small/large ────
    this.mapLarge = false;
    this.buildMinimap();

    // Party line: only shown when actually in a party (solo hint lives in pause menu)
    this.partyT = this.add.text(18, this.small ? 122 : 120, net.connected ? `Party ${net.code}` : '', {
      fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#a0c4f0',
      stroke: '#1a1024', strokeThickness: 3,
    }).setDepth(101);

    // ── Pause menu (Esc) ─────────────────────────────────────────────────────
    this.paused = false;
    this.menu = this.add.container(W / 2, H / 2).setDepth(200).setVisible(false);
    const mbgW = 280, mbgH = 256;
    const [mbgFill, mbg] = this._nsPair(0, 0, mbgW, mbgH, 'ui.panelBg');
    const mt  = this.add.text(0, -mbgH / 2 + 24, '— PAUSED —', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#ffe8a0', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.modeT = this.add.text(0, mbgH / 2 - 26, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#a0c4f0',
    }).setOrigin(0.5);
    this.menu.add([mbgFill, mbg, mt, this.modeT]);

    const mkBtn = (dy, label, cb) => {
      const bw = 210, bh = 28;
      const bFill = this.add.rectangle(0, dy, bw, bh, 0x9bbc0f).setOrigin(0.5);
      const b = this.add.nineslice(0, dy, 'ui.btn', null, bw, bh, 4, 4, 2, 2).setOrigin(0.5);
      const t = this.add.text(0, dy, label, {
        fontFamily: '"Silkscreen", monospace', fontSize: '12px', color: '#3a1f00',
      }).setOrigin(0.5);
      b.setInteractive({ useHandCursor: true });
      // ui.btn* texture swap drives WebGL look; bFill colour swap covers the
      // canvas-fallback path where NineSlice never renders at all.
      b.on('pointerover',  () => { b.setTexture('ui.btnHov'); bFill.setFillStyle(0xb8d820); });
      b.on('pointerout',   () => { b.setTexture('ui.btn');    bFill.setFillStyle(0x9bbc0f); });
      b.on('pointerdown',  () => { b.setTexture('ui.btnPrs'); bFill.setFillStyle(0x7a9a0a); audio.play('ui', 0.7); cb(); });
      b.on('pointerup',    () => { b.setTexture('ui.btn');    bFill.setFillStyle(0x9bbc0f); });
      this.menu.add([bFill, b, t]);
      return t;
    };
    mkBtn(-52, 'Resume', () => this.togglePause());
    this.soundT = mkBtn(-18, `Sound: ${audio.enabled ? 'ON' : 'OFF'}`, () => {
      const on = audio.toggle();
      this.soundT.setText(`Sound: ${on ? 'ON' : 'OFF'}`);
    });
    mkBtn(16, 'Cycle Game Boy palette', () => {
      const keys = Object.keys(PALETTES);
      const i = (keys.indexOf(this.hero.palette) + 1) % keys.length;
      this.hero.palette = keys[i];
      const p = PALETTES[keys[i]];
      this.gbTint.setFillStyle(p.bg, keys[i] === 'modern' ? 0 : 0.12);
      this.say(`${p.name} palette`);
    });
    mkBtn(50, net.connected ? 'Leave Party (solo)' : 'Leave to Title', () => {
      const w = this.world();
      if (net.connected && w) {
        net.leave(); this.say('Left party — continuing solo.');
        this.togglePause(); this.partyT.setText(''); this.refreshMode();
      } else { net.leave(); audio.stopMusic(); this.scene.stop('world'); this.scene.start('title'); }
    });

    this.input.keyboard.on('keydown-ESC',   () => this.togglePause());
    this.input.keyboard.on('keydown-ENTER', () => this.openChat());
    this.input.keyboard.on('keydown-P',     () => { const on = audio.toggle(); this.say(`Sound ${on ? 'on' : 'muted'} (P)`); });

    bus.on(Events.SYSTEM,    (s) => this.say(s));
    bus.on(Events.CHAT,      (m) => this.say(`${m.name}: ${m.text}`));
    bus.on(Events.PLAYER_HP, (p) => this.drawStatus(p));
    bus.on(Events.PLAYER_XP, (p) => this.drawXp(p));
    bus.on(Events.QUEST,     (q) => this.setQuest(q));
    bus.on(Events.ZONE,      (z) => this.zoneT.setText(z.name));
    bus.on(Events.SYSTEM,    (s) => {
      if (s === 'toggle-minimap') { this.mapLarge = !this.mapLarge; this.layoutMinimap(); }
    });
    bus.on(Events.GEAR, (m) => {
      if      (m.open === 'inventory') this.toggleInventory();
      else if (m.open === 'shop')      this.openShop(m.stock || []);
      else if (m.changed)              { if (this.invOpen) this.drawInventory(); }
    });

    this.buildTouch();
    this.buildPanels();
    // WorldScene emits the initial QUEST/HP/XP before this overlay exists —
    // pull current values so the tracker never starts empty.
    const w0 = this.world();
    if (w0?.player) {
      this.drawStatus(w0.hpPayload());
      this.drawXp(w0.xpPayload());
      this.setQuest(w0.questText());
      this.zoneT.setText(w0.zoneId ? (ZONES.find((z) => z.id === w0.zoneId)?.name || '') : '');
    }
  }

  drawScan() {
    this.scan.clear();
    const { width: W, height: H } = this.scale;
    for (let y = 0; y < H; y += 4) this.scan.fillStyle(0x000000, 0.035).fillRect(0, y, W, 1);
  }

  say(s) {
    if (s === 'toggle-minimap') return;
    this.log.push(s); if (this.log.length > 6) this.log.shift();
    this.logT.setText(this.log.join('\n'));
  }

  drawStatus(p) {
    if (this.lastHp !== null && p.hp < this.lastHp) {
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

  openChat() {
    const v = window.prompt(net.connected ? 'Party chat:' : 'Say (solo log):', '');
    if (!v) return;
    net.sendChat(this.pname, v.slice(0, 120));
    if (!net.connected) this.say(`${this.pname}: ${v.slice(0, 120)}`);
  }

  refreshMode() {
    this.modeT?.setText(net.connected ? `PARTY ${net.code}` : 'SOLO — HOST/JOIN FROM TITLE');
  }

  togglePause() {
    this.paused = !this.paused;
    if (this.paused) this.refreshMode();
    this.menu.setVisible(this.paused);
    const w = this.world();
    if (w) w.physics.world.isPaused = this.paused;
  }

  buildTouch() {
    const { width: W, height: H } = this.scale;
    this.touchUI = this.add.container(0, 0).setDepth(150);
    const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
    if (!isTouch) return;
    this.input.addPointer(2); // stick + action button held at the same time
    // Joystick (bottom-left, dynamic origin)
    const base = this.add.circle(90, H - 110, 46, 0xffffff, 0.12);
    const knob = this.add.circle(90, H - 110, 20, 0xffffff, 0.3);
    this.touchUI.add([base, knob]);
    let stickId = null, ox = 90, oy = H - 110;
    const setKnob = (x, y) => {
      const dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy), max = 40;
      const c = d > max ? max / d : 1;
      knob.setPosition(ox + dx * c, oy + dy * c);
      const w = this.world();
      if (w) { w.touchInput.x = (dx * c) / max; w.touchInput.y = (dy * c) / max; }
    };
    const clearKnob = () => {
      stickId = null; knob.setPosition(ox, oy);
      const w = this.world();
      if (w) { w.touchInput.x = 0; w.touchInput.y = 0; }
    };
    // Joystick (bottom-left, dynamic origin). NOTE: hitArea is in the
    // GameObject's LOCAL frame (arc is centered at 46,46 of its 92×92 frame),
    // not world coords — a world-space circle here silently eats all touches.
    base.setInteractive(new Phaser.Geom.Circle(46, 46, 70), Phaser.Geom.Circle.Contains);
    base.on('pointerdown', (p) => { stickId = p.id; ox = p.x; oy = p.y; base.setPosition(ox, oy); setKnob(p.x, p.y); });
    this.input.on('pointermove', (p) => { if (p.id === stickId && p.isDown) setKnob(p.x, p.y); });
    this.input.on('pointerup',   (p) => { if (p.id === stickId) { base.setPosition(90, H - 110); clearKnob(); } });
    // Action buttons (bottom-right, 44px+ targets)
    const R = this.small ? 30 : 26;
    const mkBtn = (x, y, label, cb) => {
      const c = this.add.circle(x, y, R, 0x000000, 0.5).setInteractive({ useHandCursor: true });
      const t = this.add.text(x, y, label, { fontSize: this.small ? '13px' : '12px', color: '#fff', fontStyle: 'bold' }).setOrigin(0.5);
      c.on('pointerdown', () => { audio.play('ui', 0.5); cb(); });
      this.touchUI.add([c, t]);
    };
    mkBtn(W - 60,  H - 110, 'ATK', () => this.world()?.attack());
    mkBtn(W - 122, H - 80,  'SKL', () => this.world()?.cast('2'));
    mkBtn(W - 60,  H - 176, 'E',   () => this.world()?.interact());
    mkBtn(W - 122, H - 146, 'Q',   () => this.world()?.drinkPotion());
    mkBtn(W - 184, H - 110, 'BAG', () => bus.emit(Events.GEAR, { open: 'inventory' }));
  }

  // ── inventory + shop panels ────────────────────────────────────────────────
  buildPanels() {
    const { width: W, height: H } = this.scale;
    const pw = Math.min(W - 32, this.small ? 340 : 420);
    const ph = Math.min(H - 120, this.small ? 380 : 440);

    // Inventory
    this.invPanel = this.add.container(W / 2, H / 2).setDepth(180).setVisible(false);
    const [invBgFill, invBgNs] = this._nsPair(0, 0, pw, ph, 'ui.panelBg');
    this.invBg = invBgNs.setAlpha(0.97);
    this.invPanel.add(invBgFill);
    this.invTitle = this.add.text(0, -ph / 2 + 22, 'GEAR (tap to equip)', {
      fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#f4c542', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.invClose = this.add.text(pw / 2 - 24, -ph / 2 + 20, 'X', {
      fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#ffe0d0',
      backgroundColor: '#7b2d26', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.invClose.on('pointerdown', () => this.toggleInventory(false));
    this.invDetail = this.add.text(-pw / 2 + 14, ph / 2 - 52, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: '10px', color: '#e6f2c0',
      wordWrap: { width: pw - 28 },
    });
    this.invPanel.add([this.invBg, this.invTitle, this.invClose, this.invDetail]);
    this.invCells = [];
    this.invDims = { pw, ph };

    // Shop
    this.shopPanel = this.add.container(W / 2, H / 2).setDepth(180).setVisible(false);
    const [shopBgFill, shopBgNs] = this._nsPair(0, 0, pw, ph, 'ui.panelBg');
    this.shopBg = shopBgNs.setAlpha(0.97);
    this.shopPanel.add(shopBgFill);
    this.shopTitle = this.add.text(0, -ph / 2 + 22, "MAREN'S WARES", {
      fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#f4c542', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.shopGold = this.add.text(-pw / 2 + 14, -ph / 2 + 22, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: '11px', color: '#fdebd0',
    });
    this.shopClose = this.add.text(pw / 2 - 24, -ph / 2 + 20, 'X', {
      fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#ffe0d0',
      backgroundColor: '#7b2d26', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    this.shopClose.on('pointerdown', () => this.openShop(null));
    this.shopPanel.add([this.shopBg, this.shopTitle, this.shopGold, this.shopClose]);
    this.shopCells = [];
    this.shopDims = { pw, ph };
  }

  clearCells(list) { for (const c of list) c.destroy(); list.length = 0; }

  toggleInventory(force) {
    this.invOpen = force !== undefined ? force : !this.invOpen;
    if (this.invOpen) this.openShop(null);
    this.invPanel.setVisible(this.invOpen);
    if (this.invOpen) this.drawInventory();
    else this.invDetail.setText('');
  }

  drawInventory() {
    const w = this.world();
    if (!w?.player) return;
    const p = w.player;
    this.clearCells(this.invCells);
    const { pw, ph } = this.invDims;
    const cellS = this.small ? 46 : 44, gap = 6;

    // Equipped row
    SLOTS.forEach((slot, i) => {
      const id = p.equipped[slot];
      const g  = id && gearById(id);
      const x  = -pw / 2 + 30 + i * (cellS + gap + 34), y = -ph / 2 + 66;
      const [cellFill, bg] = this._nsPair(x, y, cellS, cellS, 'ui.cell', 3, 3, 3, 3, 0x1e6b2f, 1);
      bg.setTint(0x70e890);
      const lab = this.add.text(x, y + cellS / 2 + 6, slot.toUpperCase(), {
        fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#9bbc0f',
      }).setOrigin(0.5, 0);
      this.invPanel.add([cellFill, bg, lab]); this.invCells.push(cellFill, bg, lab);
      if (g && this.textures.exists(`gear.icon.${g.id}`)) {
        const ic = this.add.image(x, y, `gear.icon.${g.id}`).setScale(3);
        this.invPanel.add(ic); this.invCells.push(ic);
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.unequip(slot)) {
          audio.play('ui', 0.7);
          bus.emit(Events.PLAYER_HP, w.hpPayload());
          w.saveNow();
          this.drawInventory();
          this.invDetail.setText(`Unequipped ${g.name}.`);
        }
      });
    });

    // Inventory grid
    const cols = this.small ? 5 : 6;
    p.inventory.forEach((id, i) => {
      const g = gearById(id);
      if (!g) return;
      const cx = i % cols, cy = Math.floor(i / cols);
      const x = -pw / 2 + 30 + cx * (cellS + gap), y = -ph / 2 + 140 + cy * (cellS + gap);
      const [cellFill, bg] = this._nsPair(x, y, cellS, cellS, 'ui.cell', 3, 3, 3, 3, 0x000000, 0.7);
      this.invPanel.add([cellFill, bg]); this.invCells.push(cellFill, bg);
      if (this.textures.exists(`gear.icon.${g.id}`)) {
        const ic = this.add.image(x, y, `gear.icon.${g.id}`).setScale(2.5);
        this.invPanel.add(ic); this.invCells.push(ic);
      }
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.equip(id)) {
          audio.play('gold', 0.7);
          bus.emit(Events.PLAYER_HP, w.hpPayload());
          w.saveNow();
          this.drawInventory();
          this.invDetail.setText(`${g.name} (${g.slot}) — ${statLine(g.stats)}. ${g.desc || ''}`);
        }
      });
    });
    if (!p.inventory.length) this.invDetail.setText('Empty pockets. Monsters drop gear — Maren sells it too.');
  }

  openShop(stock) {
    this.shopOpen = !!stock;
    if (!this.shopOpen) { this.shopPanel.setVisible(false); return; }
    if (this.invOpen) this.toggleInventory(false);
    const w = this.world();
    if (!w?.player) return;
    const p = w.player;
    this.clearCells(this.shopCells);
    const { pw, ph } = this.shopDims;
    this.shopGold.setText(`${p.gold}g`);
    const rows = [...stock.map((id) => gearById(id)).filter(Boolean)];
    rows.unshift({ id: '__potion', name: 'Potion (+45 HP)', price: 3, stats: {}, desc: 'Drink with Q.' });
    const rh = this.small ? 52 : 48;
    rows.forEach((g, i) => {
      const y = -ph / 2 + 70 + i * (rh + 6);
      if (y > ph / 2 - 30) return;
      const [bgFill, bg] = this._nsPair(0, y, pw - 28, rh, 'ui.panel2', 4, 4, 4, 4, 0x000000, 0.7);
      this.shopPanel.add(bgFill); this.shopCells.push(bgFill);
      const ic = g.id === '__potion'
        ? (this.textures.exists('hud.potion')
            ? this.add.image(-pw / 2 + 34, y, 'hud.potion').setScale(2)
            : this.add.circle(-pw / 2 + 34, y, 10, 0xe74c3c))
        : this.add.image(-pw / 2 + 34, y, `gear.icon.${g.id}`).setScale(2.5);
      const nm = this.add.text(-pw / 2 + 56, y - 14, g.name, {
        fontFamily: '"Silkscreen", monospace', fontSize: '11px', color: '#fff', fontStyle: 'bold',
      });
      const st = this.add.text(-pw / 2 + 56, y + 2,
        g.id === '__potion' ? g.desc : `${statLine(g.stats)} · ${g.desc || ''}`,
        { fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#aed6f1', wordWrap: { width: pw - 150 } });
      const pr = this.add.text(pw / 2 - 30, y, `${g.price}g`, {
        fontFamily: '"Silkscreen", monospace', fontSize: '12px', color: '#f4c542', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.shopPanel.add([bg, ic, nm, st, pr]);
      this.shopCells.push(bg, ic, nm, st, pr);
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => {
        if (p.gold < g.price) { audio.play('error', 0.7); this.shopGold.setText(`${p.gold}g — not enough!`); return; }
        p.gold -= g.price;
        if (g.id === '__potion') p.potions += 1;
        else p.inventory.push(g.id);
        audio.play('gold');
        bus.emit(Events.PLAYER_HP, w.hpPayload());
        w.saveNow();
        this.shopGold.setText(`${p.gold}g`);
        this.say(`Bought ${g.name} (${g.price}g).`);
      });
    });
    this.shopPanel.setVisible(true);
  }

  update() {
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
    // Low-HP pulse
    if (this.lastHp !== null && w?.player) {
      const frac = w.player.hp / w.player.maxHp;
      if (frac < 0.3 && !w.player.dead) this.vignette.setAlpha(0.15 + 0.1 * Math.sin(this.time.now / 200));
      else if (this.vignette.alpha < 0.2) this.vignette.setAlpha(Math.max(0, this.vignette.alpha - 0.02));
    }
    this.updateMinimap(w);
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
    if (this.textures.exists('hud.mapFog')) this.textures.remove('hud.mapFog');
    this.fogTex = this.textures.createCanvas('hud.mapFog', MAP_T, MAP_T);
    this.fogCtx = this.fogTex.getContext();
    this.fogCtx.fillStyle = '#0d1018'; this.fogCtx.fillRect(0, 0, MAP_T, MAP_T);
    this.fogTex.refresh(); this.fogTex.setFilter(0);
    this.fogLast = null;

    this.mapFrame = this.add.graphics().setDepth(100);
    this.mapImg = this.add.image(0, 0, 'hud.mapTerrain').setOrigin(0).setDepth(101);
    this.fogImg = this.add.image(0, 0, 'hud.mapFog').setOrigin(0).setDepth(102);
    this.mapG = this.add.graphics().setDepth(103);
    this.mapLbl = this.add.text(0, 0, 'M', { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#ffd84a',
      stroke: '#1a1024', strokeThickness: 3 }).setOrigin(1, 0).setDepth(104);
    this.mapHit = this.add.zone(0, 0, 10, 10).setOrigin(0).setInteractive({ useHandCursor: true }).setDepth(105);
    this.mapHit.on('pointerdown', () => { this.mapLarge = !this.mapLarge; this.layoutMinimap(); });
    this.scale.on('resize', () => this.layoutMinimap());
    this.layoutMinimap();
  }

  layoutMinimap() {
    const { width: W, height: H } = this.scale;
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
    w.sync?.remotes?.forEach((r) => dot(x + (r.x / T) * k, y + (r.y / T) * k, 2, 0x5ad0ff));
    const blink = 0.5 + 0.5 * Math.sin(this.time.now / 250);
    const px = x + tx * k, py = y + ty * k;
    g.fillStyle(0xffffff, 0.25 + 0.3 * blink).fillCircle(px, py, 4.5);
    dot(px, py, 2.4, 0xffffff);
  }
}
