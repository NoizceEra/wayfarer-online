import Phaser from 'phaser';
import { ZONES, AREAS, PORTALS, WAYSTONES } from '../data/zones.js';
import { CONFIG } from '../config.js';
import { DialogBox } from '../ui/DialogBox.js';

const FONT = '"Silkscreen", monospace';
const T = CONFIG.tile;
const ZONE_COL = { town: 0xc9b458, meadow: 0x7ec850, woods: 0x3e8e41, ruins: 0x6b7f8e };
const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;

// Screen-space layer above the HUD for the world expansion: scene fades and
// loading cards, zone title banners + danger warnings, NPC dialogue/menus
// (innkeeper, waystone travel, level-range confirm), interaction prompt, boss
// bar, the N world map, and the area minimap (drawn over the HUD minimap
// while inside an interior/dungeon/town map, since those live off-grid).
export class OverlayScene extends Phaser.Scene {
  constructor() { super('overlay'); }
  world() { return this.scene.get('world'); }

  create() {
    const { width: W, height: H } = this.scale;
    this.ready = true;
    this.dlg = null;
    this.mapOpen = false;

    this.fadeRect = this.add.rectangle(0, 0, W, H, 0x000000, 1).setOrigin(0).setDepth(1000).setAlpha(0).setVisible(false); // fill alpha 1; GameObject alpha animates
    this.fadeText = this.add.text(W / 2, H / 2 - 8, '', { fontFamily: FONT, fontSize: '14px', color: '#ffe8a0' }).setOrigin(0.5).setDepth(1001).setVisible(false);
    this.fadeBarBg = this.add.rectangle(W / 2 - 80, H / 2 + 14, 160, 6, 0x000000, 1).setStrokeStyle(1, 0x5a4a2a).setOrigin(0, 0.5).setDepth(1001).setVisible(false);
    this.fadeBar = this.add.rectangle(W / 2 - 79, H / 2 + 14, 158, 4, 0x9bbc0f).setOrigin(0, 0.5).setDepth(1002).setVisible(false);

    this.bannerT = this.add.text(W / 2, H * 0.24, '', { fontFamily: FONT, fontSize: '22px', color: '#ffe8a0', stroke: '#000', strokeThickness: 4, align: 'center' }).setOrigin(0.5).setDepth(400).setAlpha(0);
    this.bannerS = this.add.text(W / 2, H * 0.24 + 26, '', { fontFamily: FONT, fontSize: '11px', color: '#fff', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5).setDepth(400).setAlpha(0);
    this.warnT = this.add.text(W / 2, 70, '', { fontFamily: FONT, fontSize: '12px', color: '#ffb3a0', backgroundColor: '#5a1010cc', padding: { x: 10, y: 5 }, align: 'center' }).setOrigin(0.5).setDepth(410).setAlpha(0);

    this.promptT = this.add.text(W / 2, H - 92, '', { fontFamily: FONT, fontSize: '11px', color: '#fff8e0', backgroundColor: '#000000aa', padding: { x: 8, y: 4 } }).setOrigin(0.5).setDepth(300).setVisible(false);

    // world map button (works on touch too)
    this.mapBtn = this.add.text(W - 12, W < 560 ? 76 : H - 104, 'MAP [N]', { fontFamily: FONT, fontSize: '9px', color: '#ffe8a0', backgroundColor: '#2a1d10dd', padding: { x: 6, y: 4 } })
      .setOrigin(1, W < 560 ? 0 : 1).setDepth(300).setInteractive({ useHandCursor: true });
    this.mapBtn.on('pointerdown', () => this.toggleMap());

    this.bossG = this.add.graphics().setDepth(350);
    this.bossT = this.add.text(W / 2, 60, '', { fontFamily: FONT, fontSize: '10px', color: '#ffd0d0', stroke: '#000', strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(351).setVisible(false);
    this.mmG = this.add.graphics().setDepth(500);

    this.dlgC = this.add.container(0, 0).setDepth(600).setVisible(false);
    this.mapC = this.add.container(0, 0).setDepth(700).setVisible(false);

    this.input.keyboard.on('keydown-N', () => this.toggleMap());
    this.input.keyboard.on('keydown-X', () => { if (this.mapOpen) this.toggleMap(false); else if (this.dlg) this.closeDialog(true); });
    this.input.keyboard.on('keydown-ESC', () => { if (this.mapOpen) this.toggleMap(false); });
    for (let i = 1; i <= 5; i++) this.input.keyboard.on(`keydown-${['ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][i - 1]}`, () => this.pick(i - 1));
    const confirmKey = () => {
      if (!this.dlg || this.time.now - this.dlg.t0 < 250) return;
      if (DialogBox.skip(this.dlg)) return;
      if (!this.dlg.options.length || this.dlg.options.length === 1) this.pick(0);
    };
    this.input.keyboard.on('keydown-E', confirmKey);
    this.input.keyboard.on('keydown-SPACE', confirmKey);
    this.scale.on('resize', () => this.relayout());
  }

  relayout() {
    const { width: W, height: H } = this.scale;
    this.fadeRect.setSize(W, H);
    this.fadeText.setPosition(W / 2, H / 2 - 8);
    this.fadeBarBg.setPosition(W / 2 - 80, H / 2 + 14); this.fadeBar.setPosition(W / 2 - 79, H / 2 + 14);
    this.bannerT.setPosition(W / 2, H * 0.24); this.bannerS.setPosition(W / 2, H * 0.24 + 26);
    this.warnT.setPosition(W / 2, 70);
    this.promptT.setPosition(W / 2, H - 92);
    this.mapBtn.setPosition(W - 12, W < 560 ? 76 : H - 104).setOrigin(1, W < 560 ? 0 : 1);
    this.bossT.setPosition(W / 2, W < 560 ? 124 : 60);
    if (this.dlg) this.drawDialog();
    if (this.mapOpen) this.drawMap();
  }

  // ——— transitions ———
  fade(go, { label, loading, quick, done } = {}) {
    const w = this.world();
    this.fadeRect.setVisible(true).setAlpha(0);
    this.tweens.add({
      targets: this.fadeRect, alpha: 1, duration: quick ? 200 : 320,
      onComplete: () => {
        try { go?.(); } catch (e) { console.error(e); }
        const hold = loading ? (quick ? 380 : 850) : 80;
        if (label) {
          this.fadeText.setText(label).setVisible(true);
          if (!quick) {
            this.fadeBarBg.setVisible(true); this.fadeBar.setVisible(true).setScale(0, 1);
            this.tweens.add({ targets: this.fadeBar, scaleX: 1, duration: hold });
          }
        }
        this.time.delayedCall(hold, () => {
          this.fadeText.setVisible(false); this.fadeBarBg.setVisible(false); this.fadeBar.setVisible(false);
          this.tweens.add({
            targets: this.fadeRect, alpha: 0, duration: quick ? 220 : 340,
            onComplete: () => { this.fadeRect.setVisible(false); done?.(); },
          });
        });
      },
    });
    void w;
  }

  banner(title, sub, color = 0xffe8a0) {
    this.bannerT.setText(title).setColor(hex(color));
    this.bannerS.setText(sub || '');
    this.tweens.killTweensOf([this.bannerT, this.bannerS]);
    this.bannerT.setAlpha(0); this.bannerS.setAlpha(0);
    this.tweens.add({ targets: [this.bannerT, this.bannerS], alpha: 1, duration: 500, hold: 1800, yoyo: true });
  }

  warn(text) {
    this.warnT.setText(text);
    this.tweens.killTweensOf(this.warnT);
    this.warnT.setAlpha(0);
    this.tweens.add({ targets: this.warnT, alpha: 1, duration: 250, hold: 2800, yoyo: true });
  }

  setPrompt(t) {
    if (!t) { this.promptT.setVisible(false); return; }
    this.promptT.setText(t).setVisible(true);
  }

  // ——— dialogue / menus ———
  dialog({ name, text, options, danger, face, title }) {
    const w = this.world();
    if (this.mapOpen) this.toggleMap(false);
    DialogBox.stop(this.dlg);
    this.dlg = { name, text, options: options || [], danger, face, title, t0: this.time.now };
    if (w) w.uiLock = true;
    this.drawDialog();
  }
  drawDialog() {
    const { width: W, height: H } = this.scale;
    this.dlgC.removeAll(true);
    DialogBox.draw(this, this.dlgC, this.dlg, W, H, (i) => this.pick(i)); // portrait + typewriter (src/ui/DialogBox.js)
  }
  pick(i) {
    const d = this.dlg;
    if (!d || this.time.now - d.t0 < 120) return;
    if (DialogBox.skip(d)) return; // first press finishes the typewriter line
    const opts = d.options.length ? d.options : [{ label: 'OK' }];
    const o = opts[i];
    if (!o) return;
    this.closeDialog();
    o.cb?.();
  }
  closeDialog() {
    const w = this.world();
    DialogBox.stop(this.dlg);
    this.dlg = null;
    this.dlgC.setVisible(false).removeAll(true);
    if (w) { w.uiLock = false; w.uiLockUntil = w.time.now + 260; }
  }

  // ——— world map ———
  toggleMap(force) {
    const w = this.world();
    if (!w?.player || this.dlg) return;
    this.mapOpen = force !== undefined ? force : !this.mapOpen;
    if (w) { w.uiLock = this.mapOpen; if (!this.mapOpen) w.uiLockUntil = w.time.now + 200; }
    this.mapC.setVisible(this.mapOpen);
    if (this.mapOpen) this.drawMap(); else this.mapC.removeAll(true);
  }

  drawMap() {
    const w = this.world();
    const { width: W, height: H } = this.scale;
    this.mapC.removeAll(true);
    const wide = W >= 560;
    const pw = Math.min(W - 16, wide ? 680 : 420), ph = Math.min(H - 16, 460);
    const cx = W / 2, cy = H / 2;
    const bg = this.add.rectangle(cx, cy, pw, ph, 0x1d1408, 1).setStrokeStyle(3, 0x8d5a2b).setInteractive();
    bg.on('pointerdown', (p, lx, ly, ev) => ev?.stopPropagation?.());
    const title = this.add.text(cx, cy - ph / 2 + 16, 'WORLD MAP OF EMBERVALE', { fontFamily: FONT, fontSize: '14px', color: '#f4c542', fontStyle: 'bold' }).setOrigin(0.5);
    const close = this.add.text(cx + pw / 2 - 14, cy - ph / 2 + 14, 'X', { fontFamily: FONT, fontSize: '13px', color: '#ffe0d0', backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    close.on('pointerdown', () => this.toggleMap(false));
    const S = Math.min(ph - 70, wide ? pw * 0.5 : pw - 24);
    const mx = wide ? cx - pw / 2 + 18 : cx - S / 2, my = cy - ph / 2 + 38;
    const s = S / 128;
    const g = this.add.graphics();
    g.fillStyle(0x2e86c1, 1).fillRect(mx, my, S, S);
    g.fillStyle(0x7ec850, 1).fillRect(mx + 2 * s, my + 2 * s, S - 4 * s, S - 4 * s);
    const items = [bg, title, close, g];
    const order = [...ZONES].sort((a, b) => (b.rect.w * b.rect.h) - (a.rect.w * a.rect.h));
    for (const z of order) {
      if (z.id === 'meadow') continue;
      g.fillStyle(ZONE_COL[z.id] || 0x888888, 1).fillRect(mx + z.rect.x * s, my + z.rect.y * s, z.rect.w * s, z.rect.h * s);
      g.lineStyle(1, 0x000000, 0.35).strokeRect(mx + z.rect.x * s, my + z.rect.y * s, z.rect.w * s, z.rect.h * s);
    }
    g.lineStyle(2, 0x000000, 0.6).strokeRect(mx, my, S, S);
    const lab = (x, y, str, color = '#fff', size = '8px') => { const t = this.add.text(x, y, str, { fontFamily: FONT, fontSize: size, color, stroke: '#000', strokeThickness: 3, align: 'center' }).setOrigin(0.5); items.push(t); return t; };
    lab(mx + 28 * s, my + 62 * s, 'Meadowfield\nLv 1-4', '#eaffd0');
    for (const z of ZONES) {
      if (z.id === 'meadow') continue;
      const lv = z.lv[0] === z.lv[1] ? '' : `\nLv ${z.lv[0]}-${z.lv[1]}`;
      lab(mx + (z.rect.x + z.rect.w / 2) * s, my + (z.rect.y + z.rect.h / 2) * s, `${z.name}${lv}`, '#fff');
    }
    // portals
    const here = w.areas?.current?.id || null;
    for (const p of PORTALS) {
      const x = mx + p.tile.x * s, y = my + p.tile.y * s;
      const def = AREAS[p.area];
      g.fillStyle(p.color, 1).fillTriangle(x, y - 6, x - 5, y + 3, x + 5, y + 3);
      g.lineStyle(1, 0x000000, 1).strokeTriangle(x, y - 6, x - 5, y + 3, x + 5, y + 3);
      lab(x, y - 22, `${def.name}\nLv ${def.lv[0]}-${def.lv[1]}`, def.lv[0] > 8 ? '#ffb09a' : '#c8ffb8');
    }
    // waystones (attuned = cyan)
    const ways = w.questState?.ways || {};
    const ws = WAYSTONES.find((q) => !q.area);
    const wpx = w.areas.over.spawn.x + ws.offset.x, wpy = w.areas.over.spawn.y + ws.offset.y;
    g.fillStyle(ways.town ? 0x5ad1ff : 0x555555, 1).fillRect(mx + (wpx / T) * s - 2, my + (wpy / T) * s - 2, 4, 4);
    // player
    let px, py, where;
    if (!here) { px = mx + (w.player.x / T) * s; py = my + (w.player.y / T) * s; where = 'Overworld'; }
    else {
      const p = PORTALS.find((q) => q.area === here) || null;
      const r = w.areas.returnPos[here] || w.areas.over.spawn;
      px = p ? mx + p.tile.x * s : mx + (r.x / T) * s; py = p ? my + p.tile.y * s + 8 : my + (r.y / T) * s;
      where = AREAS[here].name;
    }
    const dot = this.add.circle(px, py, 4, 0xffffff).setStrokeStyle(2, 0xe74c3c);
    items.push(dot);
    this.tweens.add({ targets: dot, scale: 1.6, duration: 600, yoyo: true, repeat: -1 });
    lab(px, py + 11, 'YOU', '#ffeb80', '7px');

    // legend
    const lx = wide ? mx + S + 18 : cx - pw / 2 + 14, lw = wide ? pw - S - 54 : pw - 28;
    let ly = wide ? my : my + S + 10;
    const row = (str, color, bold) => { const t = this.add.text(lx, ly, str, { fontFamily: FONT, fontSize: '9px', color, wordWrap: { width: lw }, fontStyle: bold ? 'bold' : 'normal' }); items.push(t); ly += t.height + 4; };
    row(`You are in: ${where}`, '#ffeb80', true);
    row(`Your level: ${w.player.level}`, '#aed6f1');
    ly += 4;
    const list = [...ZONES.filter((z) => z.id !== 'meadow' || true).map((z) => ({ n: z.name, lv: z.lv, safe: z.safe })), ...Object.values(AREAS).filter((a) => a.kind !== 'interior').map((a) => ({ n: a.name, lv: a.lv, safe: a.safe }))];
    if (wide || ph > 330) for (const z of list) {
      const lvl = w.player.level;
      const col = z.safe ? '#c8ffb8' : lvl < z.lv[0] - 1 ? '#ff9a7a' : lvl > z.lv[1] + 3 ? '#9aa0a8' : '#ffe8a0';
      row(`${z.n}  ${z.lv[0] === z.lv[1] ? 'safe' : `Lv ${z.lv[0]}-${z.lv[1]}`}${z.safe && z.lv[0] !== z.lv[1] ? ' (town)' : ''}`, col);
    }
    ly += 4;
    if (wide) { row('Red = above your level', '#ff9a7a'); row('Gold = on level', '#ffe8a0'); row('Grey = outlevelled', '#9aa0a8'); row('Waystone (cyan): fast travel', '#5ad1ff'); }
    const hint = this.add.text(cx, cy + ph / 2 - 12, 'N / X to close', { fontFamily: FONT, fontSize: '8px', color: '#9b8a70' }).setOrigin(0.5);
    items.push(hint);
    this.mapC.add(items);
  }

  // ——— per-frame: area minimap + boss bar ———
  update() {
    const w = this.world();
    const { width: W, height: H } = this.scale;
    this.small = W < 560;
    const g = this.mmG;
    g.clear();
    this.bossG.clear();
    const inWorld = w && w.player && w.areas;
    this.mapBtn.setVisible(!!inWorld && !this.dlg);
    if (!inWorld) { this.bossT.setVisible(false); return; }
    const a = w.areas.current;
    // boss bar
    const boss = w.areas.boss;
    if (boss && boss.active && boss.hp > 0) {
      const bw = Math.min(260, W - 40), bx = W / 2 - bw / 2, by = this.small ? 128 : 64;
      this.bossG.fillStyle(0x000000, 0.75).fillRect(bx - 2, by - 2, bw + 4, 12);
      this.bossG.fillStyle(0x5a1010, 1).fillRect(bx, by, bw, 8);
      this.bossG.fillStyle(boss.phase === 2 ? 0xff5a3a : 0xc0392b, 1).fillRect(bx, by, bw * Phaser.Math.Clamp(boss.hp / boss.maxHp, 0, 1), 8);
      this.bossT.setPosition(W / 2, by - 4).setText(boss.def.name + (boss.phase === 2 ? '  (enraged)' : '')).setVisible(true);
    } else this.bossT.setVisible(false);
    // area minimap
    const ui = this.scene.get('ui');
    if (!a || (ui && ui.minimapOn === false)) return;
    const small = W < 560;
    const ms = small ? 64 : 84;
    const px0 = W - ms - 16, py0 = H - ms - 16, pw = ms + 16;
    g.fillStyle(0x2a1d10, 1).fillRect(px0, py0, pw, pw);
    g.lineStyle(2, 0x8d5a2b, 1).strokeRect(px0 + 1, py0 + 1, pw - 2, pw - 2);
    const inner = ms;
    const sc = inner / Math.max(a.size.w, a.size.h);
    const ox = px0 + 8 + (inner - a.size.w * sc) / 2, oy = py0 + 8 + (inner - a.size.h * sc) / 2;
    if (a.kind === 'interior') {
      g.fillStyle(a.minimap.wall, 1).fillRect(ox, oy, a.size.w * sc, 2 * sc);
      g.fillStyle(a.minimap.floor, 1).fillRect(ox, oy + 2 * sc, a.size.w * sc, (a.size.h - 2) * sc);
    } else {
      g.fillStyle(0x0d0c11, 1).fillRect(ox, oy, a.size.w * sc, a.size.h * sc);
      for (const l of a.layers) g.fillStyle(l.color, 1).fillRect(ox + l.r[0] * sc, oy + l.r[1] * sc, l.r[2] * sc, l.r[3] * sc);
      for (const z of a.zones || []) { if (!z.safe) continue; g.lineStyle(1, 0x9bbc0f, 0.9).strokeRect(ox + z.rect[0] * sc, oy + z.rect[1] * sc, z.rect[2] * sc, z.rect[3] * sc); }
    }
    const tx = (x) => ox + ((x - a.origin.x) / T) * sc, ty = (y) => oy + ((y - a.origin.y) / T) * sc;
    // exit / npcs / enemies / player
    for (const i of w.areas.interacts) {
      if (i.area !== a.id) continue;
      g.fillStyle(i.ref ? 0xf1c40f : 0x5ad1ff, 1).fillCircle(tx(i.x), ty(i.y), 1.4);
    }
    for (const t of w.areas.triggers) if (t.area === a.id) g.fillStyle(0x2ecc71, 1).fillRect(tx(t.x) - 1.5, ty(t.y) - 1.5, 3, 3);
    g.fillStyle(0xe74c3c, 1);
    w.enemies.children.each((e) => { if (e.active && e.areaId === a.id) g.fillCircle(tx(e.x), ty(e.y), e.isBoss ? 2.6 : 1.2); return true; });
    g.fillStyle(0xffffff, 1).fillCircle(tx(w.player.x), ty(w.player.y), 2.4);
  }
}
