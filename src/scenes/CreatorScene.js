import Phaser from 'phaser';
import { JOBS } from '../data/jobs.js';
import { SKINS, HAIR_STYLES, HAIR_COLORS, TOPS, ACCESSORIES, WEAPONS, defaultHero } from '../data/customization.js';
import { CONFIG } from '../config.js';
import { saveHero, loadHero } from '../core/save.js';
import { audio } from '../systems/audio.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';

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
    const W = this.scale.width;
    const H = this.scale.height;

    // ── Background ────────────────────────────────────────────────
    this.cameras.main.setBackgroundColor('#0d1117');

    // Subtle dot-grid
    const gfxBg = this.add.graphics();
    gfxBg.fillStyle(0x1e2a3a, 0.5);
    const GRID = 24;
    for (let x = GRID; x < W; x += GRID) {
      for (let y = GRID; y < H; y += GRID) {
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

    // Preview scale: chunky and readable (4× small canvas → 8× wide)
    const prevScale = Math.max(4, Math.min(8, W / 160));
    // Optical center: the sprite's visual mass sits ~8 units above the
    // container origin, so shift down to truly center it in the panel.
    const prevY = panelTop + panelH / 2 + Math.round(prevScale * 8);

    this.preview = new ModularPlayer(this, prevX, prevY, this.hero);
    this.preview.setScale(prevScale);
    if (this.preview.body) this.preview.body.setEnable(false);

    const bobAmt = Math.ceil(prevScale);
    this.tweens.add({
      targets: this.preview, y: prevY + bobAmt,
      duration: 920, yoyo: true, repeat: -1, ease: 'sine.inout',
    });

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
    const NUM_ROWS  = 8;
    const DESC_H    = Math.min(54, Math.floor(panelH * 0.1));
    const rowAreaH  = panelH - PAD * 2 - DESC_H;
    const rowH      = Math.floor(rowAreaH / NUM_ROWS);
    const rowStart  = panelTop + PAD + 2;

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

      const cur  = () => values.findIndex((v) => v.id === get());
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

    // ── Build all rows ────────────────────────────────────────────
    const jobVals = Object.values(JOBS).map((j) => ({ id: j.id, name: j.name }));
    row(0, 'JOB',        jobVals,     () => this.hero.job,       (v) => { this.hero.job = v; const j = JOBS[v]; this.hero.body = j.body; this.hero.weapon = j.weapon; });
    row(1, 'SKIN',       SKINS,       () => this.hero.skin,      (v) => (this.hero.skin = v));
    row(2, 'HAIR',       HAIR_STYLES, () => this.hero.hair,      (v) => (this.hero.hair = v));
    row(3, 'HAIR COLOR', HAIR_COLORS, () => this.hero.hairColor, (v) => (this.hero.hairColor = v));
    row(4, 'OUTFIT',     TOPS,        () => this.hero.top,       (v) => (this.hero.top = v));
    row(5, 'CHARM',      ACCESSORIES, () => this.hero.accessory, (v) => (this.hero.accessory = v));
    row(6, 'WEAPON',     WEAPONS,     () => this.hero.weapon,    (v) => (this.hero.weapon = v));
    const palVals = CONFIG.palettes.map((p) => ({ id: p, name: p }));
    row(7, 'GAME BOY',   palVals,     () => this.hero.palette,   (v) => (this.hero.palette = v));

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
}
