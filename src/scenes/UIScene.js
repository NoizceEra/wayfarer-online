import Phaser from 'phaser';
import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { PALETTES } from '../core/palette.js';
import { ZONES } from '../data/zones.js';
import { audio } from '../systems/audio.js';
import { CONFIG } from '../config.js';
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
    const SP = `${UI}/Skill_Icon/Spell`;
    const SW = `${UI}/Skill_Icon/Items_Weapon`;
    const JA = `${UI}/Skill_Icon/Job_Action`;
    const RE = `${UI}/Receptacle`;
    const li = (k, p) => { if (!this.textures.exists(k)) this.load.image(k, p); };
    li('ui.panel',    `${TW}/nine_path_panel.png`);
    li('ui.panel2',   `${TW}/nine_path_panel_2.png`);
    li('ui.panelBg',  `${TW}/nine_path_bg.png`);
    li('ui.cell',     `${TW}/inventory_cell.png`);
    li('ui.btn',      `${TW}/button_normal.png`);
    li('ui.btnHov',   `${TW}/button_hover.png`);
    li('ui.btnPrs',   `${TW}/button_pressed.png`);
    li('ui.heart',    `${RE}/IconHeart.png`);
    li('icon.slash',  `${SP}/Cut.png`);
    li('icon.flare',  `${SP}/BookFire.png`);
    li('icon.dash',   `${SP}/Mist.png`);
    li('icon.camp',   `${SP}/Heal.png`);
    li('icon.shot',   `${SW}/Arrow.png`);
    li('icon.volley', `${SP}/Explosion.png`);
    li('icon.snare',  `${SP}/Counter.png`);
    li('icon.bolt',   `${SP}/Fireball.png`);
    li('icon.burst',  `${SP}/RockSpike.png`);
    li('icon.blink',  `${SP}/Vision.png`);
    li('icon.ward',   `${SP}/DefenseUpgrade.png`);
    li('icon.stab',   `${SW}/Kunai.png`);
    li('icon.fan',    `${SW}/Shuriken.png`);
    li('icon.smoke',  `${SP}/Camouflage.png`);
    li('icon.potion', `${JA}/Potion.png`);
  }

  // ability id → skill icon key
  _abilityIcon(id) {
    const M = {
      slash: 'icon.slash', flare: 'icon.flare', dash: 'icon.dash',  camp: 'icon.camp',
      shot:  'icon.shot',  volley:'icon.volley', snare:'icon.snare',
      bolt:  'icon.bolt',  burst: 'icon.burst',  blink:'icon.blink', ward: 'icon.ward',
      stab:  'icon.stab',  fan:   'icon.fan',    smoke:'icon.smoke',
    };
    return M[id] || null;
  }

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
    const pw  = this.small ? 184 : 220;
    const barX = 28;               // x of bar fill (after heart icon)
    const pbw  = pw - barX - 10;  // bar fill width
    this.hpBarW = pbw;

    this._ns(8, 8, pw, 82);       // wood frame panel

    const fName  = { fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '10px' : '11px', color: '#fff8e0', fontStyle: 'bold' };
    const fTiny  = { fontFamily: '"Silkscreen", monospace', fontSize: '8px',  color: '#d8c090' };

    this.nameT = this.add.text(16, 14, `${this.pname} · ${this.job.name} Lv 1`, fName).setDepth(101);

    // HP row: heart icon · dark bg · green fill · number overlay
    this.add.image(17, 34, 'ui.heart').setOrigin(0, 0.5).setDepth(101).setScale(0.9);
    this.hpBarBg = this.add.rectangle(barX, 29, pbw, 10, 0x2a0800, 0.95).setOrigin(0).setDepth(101);
    this.hpBar   = this.add.rectangle(barX, 29, pbw, 10, 0x4caf50).setOrigin(0).setDepth(102);
    this.hpT     = this.add.text(barX + 2, 30, '', { fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#ffffff' }).setDepth(103);

    // MP row
    this.mpBarBg = this.add.rectangle(barX, 43, pbw, 8, 0x001020, 0.95).setOrigin(0).setDepth(101);
    this.mpBar   = this.add.rectangle(barX, 43, pbw, 8, 0x2196f3).setOrigin(0).setDepth(102);

    // XP row
    this.xpBarBg = this.add.rectangle(barX, 55, pbw, 5, 0x160e00, 0.95).setOrigin(0).setDepth(101);
    this.xpBar   = this.add.rectangle(barX, 55, pbw, 5, 0xf1c40f).setOrigin(0).setDepth(102);

    this.goldT = this.add.text(16, 64, '', fTiny).setDepth(101);

    // ── Zone label (top-centre; on phones: below status panel + party line) ──
    // phones: status panel bottom = 8+82=90, party line ~104; zone label y=90+4=94
    // desktop: y=14 to align with status panel top
    const zoneY = this.small ? 94 : 14;
    this._ns(W / 2, zoneY, 160, 22, 'ui.panelBg', 4, 4, 4, 4, 0.5, 0, 101);
    this.zoneT = this.add.text(W / 2, zoneY + 11, 'Thistle Town', {
      fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '10px' : '11px', color: '#ffe8a0',
    }).setOrigin(0.5).setDepth(102);

    // ── Quest tracker (top-right) ────────────────────────────────────────────
    const questW = this.small ? 148 : 208;
    this._ns(W - 8, 8, questW, 40, 'ui.panel', 4, 4, 4, 4, 1, 0, 100);
    this.questT = this.add.text(W - 16, 14, '', {
      fontFamily: '"Silkscreen", monospace', fontSize: this.small ? '9px' : '10px',
      color: '#f4e0b0', wordWrap: { width: questW - 16 }, align: 'right',
    }).setOrigin(1, 0).setDepth(101);

    // ── Hotbar (bottom-centre) ───────────────────────────────────────────────
    this.hotbar = [];
    const cellW  = this.small ? 48 : 58;
    const cellH  = this.small ? 48 : 54;
    const cellSt = this.small ? 52 : 62;
    const hotY   = H - 36;
    const slots  = [
      ...this.job.abilities.map((a) => ({ key: a.key, name: a.name, ab: a })),
      { key: 'Q', name: 'Potion', ab: null },
    ];
    const hotTotalW = slots.length * cellSt;
    slots.forEach((s, i) => {
      const x = W / 2 - hotTotalW / 2 + i * cellSt + cellSt / 2;
      const bg = this._ns(x, hotY, cellW, cellH, 'ui.cell', 3, 3, 3, 3, 0.5, 0.5, 100);
      bg.setInteractive({ useHandCursor: true });

      // Skill icon (24×24 source, scaled to cell interior)
      const iconKey = s.ab ? this._abilityIcon(s.ab.id) : 'icon.potion';
      const iconScale = (cellW - 14) / 24;
      if (iconKey && this.textures.exists(iconKey)) {
        this.add.image(x, hotY - 2, iconKey).setScale(iconScale).setOrigin(0.5).setDepth(101);
      }

      this.add.text(x, hotY - cellH / 2 + 4, s.key, {
        fontFamily: '"Silkscreen", monospace', fontSize: '8px', color: '#9bbc0f',
      }).setOrigin(0.5, 0).setDepth(102);

      this.add.text(x, hotY + cellH / 2 - 12, s.name.split(' ')[0], {
        fontFamily: '"Silkscreen", monospace', fontSize: '7px', color: '#c8b878',
      }).setOrigin(0.5, 0).setDepth(102);

      const cdBg = this.add.rectangle(x, hotY, cellW - 2, cellH - 2, 0x000000, 0.70)
        .setDepth(103).setVisible(false);
      const cdT  = this.add.text(x, hotY, '', {
        fontFamily: '"Silkscreen", monospace', fontSize: '14px', color: '#fff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(104).setVisible(false);

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
    const logPanelY = H - logH - 62;
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

    // ── Minimap (bottom-right) ───────────────────────────────────────────────
    this.mapSize = this.small ? 64 : 84;
    const ms = this.mapSize;
    // panel top-left so its inner content centre == original ox/oy = (W - ms/2 - 8, H - ms/2 - 8)
    this.mapBg = this._ns(W - ms - 16, H - ms - 16, ms + 16, ms + 16, 'ui.panel', 4, 4, 4, 4, 0, 0, 100);
    this.mapG  = this.add.graphics().setDepth(101);

    // ── Party line (left, under panel; lower on phones to clear zone label) ──
    // phones: status panel bottom y=90, zone label y=94..116, so party at 120
    // desktop: status panel bottom y=90, so party at 96
    this.partyT = this.add.text(
      16, this.small ? 120 : 96,
      net.connected ? `Party ${net.code}` : (this.small ? 'Solo' : 'Solo — Host/Join from Title'),
      { fontFamily: '"Silkscreen", monospace', fontSize: '9px', color: '#a0c4f0' },
    ).setDepth(101);

    // ── Pause menu (Esc) ─────────────────────────────────────────────────────
    this.paused = false;
    this.menu = this.add.container(W / 2, H / 2).setDepth(200).setVisible(false);
    const mbgW = 280, mbgH = 256;
    const [mbgFill, mbg] = this._nsPair(0, 0, mbgW, mbgH, 'ui.panelBg');
    const mt  = this.add.text(0, -mbgH / 2 + 24, '— PAUSED —', {
      fontFamily: '"Silkscreen", monospace', fontSize: '16px', color: '#ffe8a0', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.menu.add([mbgFill, mbg, mt]);

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
        this.togglePause(); this.partyT.setText('Solo — Host/Join from Title');
      } else { net.leave(); audio.stopMusic(); this.scene.stop('world'); this.scene.start('title'); }
    });

    this.input.keyboard.on('keydown-ESC',   () => this.togglePause());
    this.input.keyboard.on('keydown-ENTER', () => this.openChat());
    this.input.keyboard.on('keydown-P',     () => { const on = audio.toggle(); this.say(`Sound ${on ? 'on' : 'muted'} (P)`); });

    bus.on(Events.SYSTEM,    (s) => this.say(s));
    bus.on(Events.CHAT,      (m) => this.say(`${m.name}: ${m.text}`));
    bus.on(Events.PLAYER_HP, (p) => this.drawStatus(p));
    bus.on(Events.PLAYER_XP, (p) => this.drawXp(p));
    bus.on(Events.QUEST,     (q) => this.questT.setText('◆ ' + q));
    bus.on(Events.ZONE,      (z) => this.zoneT.setText(z.name));
    bus.on(Events.SYSTEM,    (s) => {
      if (s === 'toggle-minimap') { this.minimapOn = !this.minimapOn; this.mapBg.setVisible(this.minimapOn); }
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
      this.questT.setText('◆ ' + w0.questText());
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
    this.hpBar.setDisplaySize(this.hpBarW * (p.hp / p.maxHp), 10);
    this.hpBar.setFillStyle(p.hp / p.maxHp > 0.35 ? 0x4caf50 : 0xe74c3c);
    this.hpT.setText(`${p.hp}/${p.maxHp}`);
    this.mpBar.setDisplaySize(this.hpBarW * (p.mp / p.maxMp), 8);
    this.goldT.setText(`${p.gold}g · ${p.potions}x pot · ATK${p.atk} DEF${p.def}`);
  }
  drawXp(p) { this.xpBar.setDisplaySize(this.hpBarW * (p.xp / p.xpNext), 5); }

  openChat() {
    const v = window.prompt(net.connected ? 'Party chat:' : 'Say (solo log):', '');
    if (!v) return;
    net.sendChat(this.pname, v.slice(0, 120));
    if (!net.connected) this.say(`${this.pname}: ${v.slice(0, 120)}`);
  }

  togglePause() {
    this.paused = !this.paused;
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
        ? (this.textures.exists('icon.potion')
            ? this.add.image(-pw / 2 + 34, y, 'icon.potion').setScale(1.1)
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
        total  = ab.cd;
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
    // Minimap: zone rects + player/NPC dots
    this.mapG.clear();
    if (!this.minimapOn) return;
    const { width: W, height: H } = this.scale;
    // ox/oy = content centre, same as original formula
    const ms = this.mapSize, ox = W - ms / 2 - 8, oy = H - ms / 2 - 8, s = ms / 128;
    for (const z of ZONES) {
      const c = z.id === 'town' ? 0xc9b458 : z.id === 'meadow' ? 0x7ec850 : z.id === 'woods' ? 0x3e8e41 : 0x6b7f8e;
      this.mapG.fillStyle(c, 0.9).fillRect(ox - 42 + z.rect.x * s, oy - 42 + z.rect.y * s, z.rect.w * s, z.rect.h * s);
    }
    if (w?.player) {
      const px = ox - 42 + (w.player.x / 16) * s, py = oy - 42 + (w.player.y / 16) * s;
      this.mapG.fillStyle(0xffffff, 1).fillCircle(px, py, 2.5);
      // NPC dots
      this.mapG.fillStyle(0xf1c40f, 1);
      for (const n of w.npcs || []) this.mapG.fillCircle(ox - 42 + (n.x / 16) * s, oy - 42 + (n.y / 16) * s, 1.5);
    }
  }
}
