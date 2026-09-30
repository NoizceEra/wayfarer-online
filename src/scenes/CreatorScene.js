import Phaser from 'phaser';
import { JOBS } from '../data/jobs.js';
import { SKINS, HAIR_STYLES, HAIR_COLORS, TOPS, CREATOR_ACCESSORIES, WEAPONS, EYES, EYE_COLORS, MARKS, STARTER_SLOTS, starterChoices, defaultHero } from '../data/customization.js';
import { CONFIG } from '../config.js';
import { saveHero, loadHero } from '../core/save.js';
import { audio } from '../systems/audio.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';
import { setupMenuCamera } from '../core/display.js';

// Character Creator — proportional two-panel layout (preview left, selectors right).
// Scales from ~593px pane up to 1280px widescreen.
export class CreatorScene extends Phaser.Scene {
  constructor() { super('creator'); }
  init(data) { this.mode = data.mode || 'solo'; this.pname = data.name || 'Pip'; }

  preload() {
    const BASE = 'assets/na/Ui/Theme/Theme_Wood';
    if (!this.textures.exists('ui.arrowL'))  this.load.image('ui.arrowL',  `${BASE}/arrow_left.png`);
    if (!this.textures.exists('ui.arrowR'))  this.load.image('ui.arrowR',  `${BASE}/arrow_right.png`);
    if (!this.textures.exists('ui.arrowLH')) this.load.image('ui.arrowLH', `${BASE}/arrow_left_hover.png`);
    if (!this.textures.exists('ui.arrowRH')) this.load.image('ui.arrowRH', `${BASE}/arrow_right_hover.png`);
  }

  create() {
    // Integer-zoomed, centered logical layout (<=960x600) — see core/display.js
    const { W, H } = setupMenuCamera(this, { minW: 560, minH: 480, maxW: 960, maxH: 600, data: { name: this.pname, mode: this.mode } });

    // ── Background ────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor('#0f380f');

    // Subtle dot-grid (extends past the layout so the centered panel sits on it)
    const gfxBg = this.add.graphics();
    gfxBg.fillStyle(0x1e4a1e, 0.6);
    const GRID = 24;
    for (let x = GRID - 24 * 30; x < W + 24 * 30; x += GRID) {
      for (let y = GRID - 24 * 30; y < H + 24 * 30; y += GRID) {
        gfxBg.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    this.hero = { ...defaultHero(), ...(loadHero() || {}), name: this.pname };

    // ── Proportional panel geometry ───────────────────────────────
    // Left panel = preview, right panel = selector rows.
    const MARGIN   = Math.max(14, Math.floor(W * 0.022));
    const GAP      = Math.max(10, Math.floor(W * 0.015));
    const BTN_ZONE = 68;   // bottom strip for start button (clear of desc text)
    const TITLE_H  = 56;   // top strip for title

    const leftW  = Math.min(Math.floor(W * 0.34), 360);
    const leftX  = MARGIN;
    const rightX = leftX + leftW + GAP;
    const rightW = W - rightX - MARGIN;

    const panelTop = TITLE_H + 4;
    const panelH   = H - panelTop - BTN_ZONE - 6;

    // ── Title ─────────────────────────────────────────────────────
    this.add.text(W / 2, 28, 'CREATE YOUR WAYFARER', {
      fontSize: Math.max(16, Math.floor(W * 0.022)) + 'px',
      color: '#f4c542',
      fontFamily: '"Silkscreen", "Jersey 10", monospace',
      stroke: '#1a0800',
      strokeThickness: 4,
    }).setOrigin(0.5, 0.5);

    // Title rule
    const ruleGfx = this.add.graphics();
    ruleGfx.lineStyle(1, 0xc8a840, 0.55);
    ruleGfx.beginPath();
    ruleGfx.moveTo(MARGIN, TITLE_H - 2);
    ruleGfx.lineTo(W - MARGIN, TITLE_H - 2);
    ruleGfx.strokePath();

    // ── Helper: drawn panel ─────────────────────────────────────────
    // Drawn rects (not nineslice textures): the wood-theme nine-patch PNGs
    // render an offset two-tone look when stretched to panel size, and drawn
    // shapes are pixel-identical on WebGL and the ?renderer=canvas fallback.
    const makePanel = (cx, cy, w, h, accent = 0xc8a840) => {
      this.add.rectangle(cx, cy, w, h, 0x10140f, 0.96);
      const g = this.add.graphics();
      g.lineStyle(2, accent, 1);
      g.strokeRect(cx - w / 2, cy - h / 2, w, h);
      g.lineStyle(1, 0x000000, 0.55);
      g.strokeRect(cx - w / 2 + 2, cy - h / 2 + 2, w - 4, h - 4);
      return g;
    };

    // ── Left panel: character preview ─────────────────────────────
    makePanel(leftX + leftW / 2, panelTop + panelH / 2, leftW, panelH);

    const prevX = leftX + leftW / 2;
    this.buildPreview(prevX, panelTop, leftW, panelH);

    // "PREVIEW" chip at top of left panel
    this.add.text(prevX, panelTop + 10, 'PREVIEW', {
      fontSize: '10px', color: '#c8a840',
      fontFamily: '"Silkscreen", "Jersey 10", monospace',
      backgroundColor: '#1a0d00', padding: { x: 8, y: 3 },
    }).setOrigin(0.5, 0);

    // Name / job label at bottom of left panel (dark pill for contrast)
    this.nameLabel = this.add.text(prevX, panelTop + panelH - 8, '', {
      fontSize: '12px', color: '#ffe8a0',
      fontFamily: '"Silkscreen", "Jersey 10", monospace',
      align: 'center',
      backgroundColor: '#1a0d00', padding: { x: 8, y: 3 },
    }).setOrigin(0.5, 1);

    // ── Right panel: selectors ────────────────────────────────────
    makePanel(rightX + rightW / 2, panelTop + panelH / 2, rightW, panelH, 0x8a7a3a);

    // Layout inside right panel
    const PAD       = Math.max(8, Math.floor(rightW * 0.028));
    const NUM_ROWS  = 6;   // rows per tab (BODY / STYLE / WARDROBE)
    const TAB_H     = 26;
    const DESC_H    = Math.min(54, Math.floor(panelH * 0.1));
    const rowAreaH  = panelH - PAD * 2 - DESC_H - TAB_H;
    const rowH      = Math.floor(rowAreaH / NUM_ROWS);
    const rowStart  = panelTop + PAD + 2 + TAB_H;

    // Label column: proportional, min 70px
    const LABEL_W   = Math.max(70, Math.min(110, Math.floor(rightW * 0.30)));
    // Arrow button display size
    const ARROW_SZ  = Math.max(18, Math.min(28, Math.floor(rowH * 0.62)));

    // Description text (shared, bottom-anchored inside right panel so it can
    // never overflow under the start button)
    this.descText = this.add.text(
      rightX + rightW / 2,
      panelTop + panelH - 10,
      '', {
        fontSize: Math.max(10, Math.floor(rightW * 0.035)) + 'px',
        color: '#93a3b8',
        fontFamily: '"Silkscreen", "Jersey 10", monospace',
        align: 'center',
        wordWrap: { width: rightW - PAD * 2 - 8 },
      }
    ).setOrigin(0.5, 1);

    const refreshMeta = () => {
      this.nameLabel.setText(`${this.hero.name}  ·  ${JOBS[this.hero.job].name}`);
      this.descText.setText(JOBS[this.hero.job].desc);
    };

    // ── Selector row builder ──────────────────────────────────────
    const row = (index, label, values, get, set) => {
      const rowY    = rowStart + index * rowH;
      const centerY = rowY + rowH / 2;

      // Divider between rows
      if (index > 0) {
        const dg = this.add.graphics();
        dg.lineStyle(1, 0x2a1d08, 0.7);
        dg.beginPath();
        dg.moveTo(rightX + PAD + 2, rowY);
        dg.lineTo(rightX + rightW - PAD - 2, rowY);
        dg.strokePath();
      }

      // Label — right-aligned to its column
      this.add.text(rightX + PAD + LABEL_W, centerY, label, {
        fontSize: Math.max(9, Math.min(13, Math.floor(rowH * 0.38))) + 'px',
        color: '#c8a840',
        fontFamily: '"Silkscreen", "Jersey 10", monospace',
        fontStyle: 'bold',
      }).setOrigin(1, 0.5);

      // Thin label/value separator
      const sg = this.add.graphics();
      sg.lineStyle(1, 0x3a2810, 0.6);
      sg.beginPath();
      sg.moveTo(rightX + PAD + LABEL_W + 4, centerY - rowH * 0.28);
      sg.lineTo(rightX + PAD + LABEL_W + 4, centerY + rowH * 0.28);
      sg.strokePath();

      // Value text occupies the middle zone
      const arLX   = rightX + PAD + LABEL_W + 8 + ARROW_SZ / 2;
      const arRX   = rightX + rightW - PAD - ARROW_SZ / 2 - 2;
      const valX   = (arLX + arRX) / 2;
      const valW   = arRX - arLX - ARROW_SZ - 4;

      const baseFontSz = Math.max(10, Math.min(15, Math.floor(rowH * 0.42)));
      const vText = this.add.text(valX, centerY, '', {
        fontSize: baseFontSz + 'px',
        color: '#e8e4cc',
        fontFamily: '"Silkscreen", "Jersey 10", monospace',
        align: 'center',
      }).setOrigin(0.5);

      // Arrow buttons (real sprites)
      const arL = this.add.image(arLX, centerY, 'ui.arrowL')
        .setInteractive({ useHandCursor: true })
        .setDisplaySize(ARROW_SZ, ARROW_SZ)
        .setOrigin(0.5);

      const arR = this.add.image(arRX, centerY, 'ui.arrowR')
        .setInteractive({ useHandCursor: true })
        .setDisplaySize(ARROW_SZ, ARROW_SZ)
        .setOrigin(0.5);

      arL.on('pointerover',  () => arL.setTexture('ui.arrowLH'));
      arL.on('pointerout',   () => arL.setTexture('ui.arrowL'));
      arR.on('pointerover',  () => arR.setTexture('ui.arrowRH'));
      arR.on('pointerout',   () => arR.setTexture('ui.arrowR'));

      const cur  = () => Math.max(0, values.findIndex((v) => v.id === get()));
      const draw = () => {
        const i = cur();
        const name = values[i].name;
        vText.setFontSize(baseFontSz);
        vText.setText(`${name}  (${i + 1}/${values.length})`);
        // Shrink to fit the space between the arrows so long names never clip.
        let sz = baseFontSz;
        while (vText.width > valW && sz > 8) {
          sz -= 1;
          vText.setFontSize(sz);
        }
        refreshMeta();
      };

      const navigate = (dir) => {
        audio.play('ui', 0.7);
        const i   = cur();
        const n   = values[(i + dir + values.length) % values.length];
        set(n.id);
        draw();
        this.preview.applyHero(this.hero);
      };

      arL.on('pointerdown', () => navigate(-1));
      arR.on('pointerdown', () => navigate(1));

      // Value text itself is also clickable
      vText.setInteractive({ useHandCursor: true });
      vText.on('pointerdown', (p) => navigate(p.x < vText.x ? -1 : 1));

      draw();
      return draw;
    };

    // ── Build all rows (3 tabs; objects created per tab are shown/hidden together) ──
    const jobVals = Object.values(JOBS).map((j) => ({ id: j.id, name: j.name }));
    const pages = {};
    const page = (name, build) => {
      const start = this.children.list.length;
      build();
      pages[name] = this.children.list.slice(start);
    };
    const starterRow = (i, label, slot) => row(i, label, starterChoices(slot), () => this.hero.starter?.[slot] || 'none', (v) => {
      this.hero.starter = { ...(this.hero.starter || {}), [slot]: v === 'none' ? null : v };
      this.syncPreviewGear();
    });
    page('BODY', () => {
      row(0, 'JOB',        jobVals,     () => this.hero.job,       (v) => { this.hero.job = v; const j = JOBS[v]; this.hero.body = j.body; this.hero.weapon = j.weapon; });
      row(1, 'SKIN',       SKINS,       () => this.hero.skin,      (v) => (this.hero.skin = v));
      row(2, 'EYES',       EYES,        () => this.hero.eyes,      (v) => (this.hero.eyes = v));
      row(3, 'EYE COLOR',  EYE_COLORS,  () => this.hero.eyeColor,  (v) => (this.hero.eyeColor = v));
      row(4, 'MARKINGS',   MARKS,       () => this.hero.mark,      (v) => (this.hero.mark = v));
      row(5, 'WEAPON',     WEAPONS,     () => this.hero.weapon,    (v) => (this.hero.weapon = v));
    });
    page('STYLE', () => {
      row(0, 'HAIR',       HAIR_STYLES, () => this.hero.hair,      (v) => (this.hero.hair = v));
      row(1, 'HAIR COLOR', HAIR_COLORS, () => this.hero.hairColor, (v) => (this.hero.hairColor = v));
      row(2, 'OUTFIT DYE', TOPS,        () => this.hero.top,       (v) => (this.hero.top = v));
      row(3, 'NECKWEAR',   CREATOR_ACCESSORIES, () => this.hero.accessory, (v) => (this.hero.accessory = v));
      const palVals = CONFIG.palettes.map((p) => ({ id: p, name: p }));
      row(4, 'GAME BOY',   palVals,     () => this.hero.palette,   (v) => (this.hero.palette = v));
    });
    page('WARDROBE', () => {
      starterRow(0, 'HEADWEAR', 'head');
      starterRow(1, 'FACEWEAR', 'face');
      starterRow(2, 'BODYWEAR', 'body');
      starterRow(3, 'BACK',     'back');
      starterRow(4, 'BOOTS',    'feet');
      this.add.text(rightX + rightW / 2, rowStart + 5 * rowH + rowH / 2, 'Starter cosmetics are yours to keep.\nFind, buy and dye more in game (I).', {
        fontSize: '9px', color: '#8a9a80', fontFamily: '"Silkscreen", "Jersey 10", monospace', align: 'center',
      }).setOrigin(0.5);
    });
    // tab buttons
    const tabNames = Object.keys(pages);
    const tabW = Math.floor((rightW - PAD * 2) / tabNames.length);
    const tabBtns = {};
    const showTab = (name) => {
      this.tabName = name;
      tabNames.forEach((n) => {
        const on = n === name;
        pages[n].forEach((o) => o.setVisible(on));
        tabBtns[n].setStyle({ backgroundColor: on ? '#5a4a1a' : '#2a2210', color: on ? '#fff6c8' : '#b9a060' });
      });
    };
    tabNames.forEach((n, i) => {
      const t = this.add.text(rightX + PAD + i * tabW + tabW / 2, panelTop + PAD + 2 + TAB_H / 2, n, {
        fontSize: '11px', color: '#b9a060', fontFamily: '"Silkscreen", "Jersey 10", monospace', backgroundColor: '#2a2210', padding: { x: 4, y: 4 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.setFixedSize(tabW - 6, 22); t.setAlign('center');
      t.on('pointerdown', () => { audio.play('ui', 0.6); showTab(n); });
      tabBtns[n] = t;
    });
    showTab('BODY');

    refreshMeta();

    // ── Start button ──────────────────────────────────────────────
    const btnLabel = this.mode === 'solo' ? '▶  ENTER EMBERVALE' :
                     this.mode === 'host' ? '▶  OPEN ROOM & ENTER' :
                                            '▶  JOIN WORLD';
    const btnFontSz = Math.max(14, Math.min(22, Math.floor(W * 0.016))) + 'px';

    const start = this.add.text(W / 2, H - BTN_ZONE / 2, btnLabel, {
      fontSize: btnFontSz,
      color: '#0f380f',
      backgroundColor: '#9bbc0f',
      padding: { x: Math.floor(W * 0.022), y: 9 },
      fontFamily: '"Silkscreen", "Jersey 10", monospace',
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    start.on('pointerover',  () => start.setStyle({ backgroundColor: '#b8d820' }));
    start.on('pointerout',   () => start.setStyle({ backgroundColor: '#9bbc0f' }));

    const begin = () => {
      audio.play('level');
      saveHero(this.hero);
      audio.stopMusic();
      this.scene.start('world', { hero: this.hero, mode: this.mode, name: this.pname });
    };
    start.on('pointerdown', begin);
    this.input.keyboard.on('keydown-ENTER', begin);
  }

  // Starter cosmetics are worn by the preview (and granted on entering the world).
  syncPreviewGear() {
    if (!this.preview) return;
    const eq = {};
    for (const slot of STARTER_SLOTS) if (this.hero.starter?.[slot]) eq[slot] = this.hero.starter[slot];
    this.preview.setLook({ equipped: eq, dyes: {} });
  }

  // ── Preview panel: pedestal, big integer-scaled hero, facing + action buttons ──
  buildPreview(cx, top, w, h) {
    // Integer scale so pixels stay crisp; hero + weapon spans ~20x26 px.
    const sc = Math.max(4, Math.min(12, Math.floor((w - 48) / 22), Math.floor((h * 0.5) / 26)));
    const feetY = Math.round(top + h * 0.52);
    const gold = 0xc8a840;

    // Pedestal: stacked discs (rim, stone, olive top, gold ring) + soft shadow.
    const g = this.add.graphics();
    const rx = Math.round(11 * sc), ry = Math.round(4.6 * sc), th = Math.round(2.2 * sc);
    const gy = feetY + Math.round(1 * sc);
    g.fillStyle(0x000000, 0.28); g.fillEllipse(cx, gy + th + sc, rx * 2.3, ry * 2.4);     // ground glow/shadow
    g.fillStyle(0x0b0d08, 1);   g.fillEllipse(cx, gy + th, rx * 2, ry * 2);                // underside
    g.fillRect(cx - rx, gy, rx * 2, th);                                                   // side wall
    g.fillStyle(0x2c3320, 1);   g.fillRect(cx - rx, gy, rx * 2, th);
    g.fillStyle(0x3a4426, 1);   g.fillRect(cx - rx, gy, Math.round(rx * 0.55), th);       // lit left edge
    g.fillStyle(0x0b0d08, 1);   g.fillEllipse(cx, gy + th, rx * 2, ry * 2);
    g.fillStyle(0x2c3320, 1);   g.fillEllipse(cx, gy + th, rx * 2 - 2, ry * 2 - 2);
    g.fillStyle(gold, 1);       g.fillEllipse(cx, gy, rx * 2, ry * 2);                     // gold rim
    g.fillStyle(0x4d5e2a, 1);   g.fillEllipse(cx, gy, rx * 2 - sc * 1.4, ry * 2 - sc * 0.8);
    g.fillStyle(0x5f7535, 1);   g.fillEllipse(cx, gy - sc * 0.2, rx * 1.55, ry * 1.5);
    g.fillStyle(0x748c42, 0.8); g.fillEllipse(cx - rx * 0.2, gy - sc * 0.5, rx * 0.8, ry * 0.7);
    // soft contact shadow under the feet
    const sh = this.add.ellipse(cx, feetY + sc * 1.6, sc * 13, sc * 4, 0x000000, 0.32);
    this.tweens.add({ targets: sh, scaleX: 0.93, duration: 620, yoyo: true, repeat: -1, ease: 'sine.inout' });
    // tiny grass tufts + sparkles on the pedestal
    for (const [dx, dy] of [[-0.62, 0.3], [0.55, 0.42], [-0.3, -0.45], [0.7, -0.15]]) {
      const tx = Math.round(cx + dx * rx), ty = Math.round(gy + dy * ry);
      g.fillStyle(0x93b04f, 1); g.fillRect(tx, ty - sc, sc, sc); g.fillRect(tx + sc, ty - sc * 1.6, sc * 0.6, sc * 1.6);
    }

    this.preview = new ModularPlayer(this, cx, feetY, this.hero);
    this.syncPreviewGear();
    this.preview.setScale(sc).setDepth(10);
    if (this.preview.body) this.preview.body.setEnable(false);
    this.preview.shadow.setVisible(false);
    this.preview.noDust = true;
    this.preview.setFacing('down');
    this.previewWalk = true;
    this.preview.setMoving(true);

    // Facing + action buttons
    const mkBtn = (x, y, label, fn, wd = 34) => {
      const t = this.add.text(x, y, label, {
        fontSize: '13px', color: '#ffe8a0', fontFamily: '"Silkscreen", "Jersey 10", monospace',
        backgroundColor: '#2a2210', padding: { x: 7, y: 4 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.setFixedSize(wd, 26); t.setAlign('center');
      t.on('pointerover', () => t.setStyle({ backgroundColor: '#4a3c16' }));
      t.on('pointerout', () => t.setStyle({ backgroundColor: t.getData('on') ? '#5a4a1a' : '#2a2210' }));
      t.on('pointerdown', () => { audio.play('ui', 0.6); fn(t); });
      return t;
    };
    const rowY1 = top + h - 74, rowY2 = top + h - 44;
    const faceBtns = {};
    const setFace = (d) => {
      this.preview.setFacing(d);
      Object.entries(faceBtns).forEach(([k, b]) => { b.setData('on', k === d); b.setStyle({ backgroundColor: k === d ? '#5a4a1a' : '#2a2210', color: k === d ? '#fff6c8' : '#ffe8a0' }); });
    };
    const dirs = [['left', '<'], ['up', '^'], ['down', 'v'], ['right', '>']];
    dirs.forEach(([d, lab], i) => { faceBtns[d] = mkBtn(cx + (i - 1.5) * 40, rowY1, lab, () => { this.faceTouched = true; setFace(d); }); });
    setFace('down');
    const walkBtn = mkBtn(cx - 46, rowY2, 'WALK', (t) => {
      this.previewWalk = !this.previewWalk;
      this.preview.setMoving(this.previewWalk);
      t.setData('on', this.previewWalk); t.setStyle({ backgroundColor: this.previewWalk ? '#5a4a1a' : '#2a2210' });
    }, 62);
    walkBtn.setData('on', true); walkBtn.setStyle({ backgroundColor: '#5a4a1a' });
    mkBtn(cx + 26, rowY2, 'SWING', () => this.preview.attackPose(), 70);

    // Auto turntable until the player picks a facing themselves.
    this.faceAuto = this.time.addEvent({ delay: 2200, loop: true, callback: () => {
      if (this.faceTouched) return;
      const order = ['down', 'left', 'up', 'right'];
      setFace(order[(order.indexOf(this.preview.facing) + 1) % 4]);
    } });
  }
}
