/**
 * HomeIslandScene.js — personal instanced housing scene for Wayfarer Online.
 * A private home plot: furniture layout grid, trophy plaques, a garden plot
 * with a capped DAILY CLAIM (no passive accrual, no gold payout), and a
 * portal back to town. Progression persists under progress.ext.housing
 * (see src/data/housing.js + docs/HOUSING.md).
 *
 * The scene is inert until the parent registers it (NOT done here — see
 * docs/HOUSING.md for the exact snippet: scene registration, /home command,
 * NPC portal). All state flows through init(data) so nothing here depends on
 * globals: data = { name, hero, mode, returnTo }.
 */

import Phaser from 'phaser';
import { FURNITURE, furnById, TROPHIES, PLOTS, YIELD_RULES, LAYOUT_RULES, normalizeHousing, todayUTC } from '../data/housing.js';
import { loadProgress, saveProgress } from '../core/save.js';

const SOL = {
  bg: 0x0a0e1a,
  panel: 0x161b22,
  grass: 0x1d3a24,
  plot: 0x2a1f14,
  green: '#14F195',
  greenHex: 0x14f195,
  purple: '#9945FF',
  purpleHex: 0x9945ff,
  cyan: '#03E1FF',
  white: '#E1E8F0',
  muted: '#6B7A99',
  gold: '#FFD84A',
  red: '#FF6B6B',
};

const CELL = 48; // px per layout cell

export class HomeIslandScene extends Phaser.Scene {
  constructor() {
    super({ key: 'home' });
  }

  // data: { name, hero, mode, returnTo?: {name, mode, hero} }
  // returnTo is the town/world payload to restore on portal-back; when absent
  // we fall back to restarting 'world' with our own payload, then 'title'.
  init(data) {
    this.pname = data?.name || 'Wayfarer';
    this.hero = data?.hero || null;
    this.mode = data?.mode || 'solo';
    this.returnTo = data?.returnTo || null;
    this.selected = null; // selected furniture id for placement
    this.housing = normalizeHousing(loadProgress(this.pname)?.ext?.housing);
  }

  create() {
    const W = this.cameras.main.width;
    const H = this.cameras.main.height;
    const cx = W / 2;

    this.add.rectangle(cx, H / 2, W, H, SOL.bg);
    this.add.text(cx, 28, '🏠  HOME ISLAND  (private instance)', {
      fontFamily: '"Courier New", monospace', fontSize: '16px', color: SOL.gold, fontStyle: 'bold',
    }).setOrigin(0.5);

    // Layout grid (plot cells), centered; origin stored for click mapping.
    const gw = LAYOUT_RULES.gridW * CELL;
    const gh = LAYOUT_RULES.gridH * CELL;
    this.gridX = cx - gw / 2;
    this.gridY = 70;
    this.add.rectangle(cx, this.gridY + gh / 2, gw, gh, SOL.grass, 1)
      .setStrokeStyle(2, SOL.greenHex, 0.5);
    this.add.grid(cx, this.gridY + gh / 2, gw, gh, CELL, CELL, 0x000000, 0, SOL.greenHex, 0.12);

    // Garden plot marker (bottom-left corner cell block) when unlocked.
    if (this.housing.plot && PLOTS[this.housing.plot]) {
      const p = PLOTS[this.housing.plot];
      this.add.text(this.gridX + 6, this.gridY + gh - 22,
        `🌱 ${p.name} — claim: ${p.daily.map((d) => `${d.n}x ${d.id}`).join(', ')} / day`, {
        fontFamily: '"Courier New", monospace', fontSize: '11px', color: SOL.green,
      });
    }

    this.renderPlaced();

    // Furniture catalogue strip (click to select, then click a grid cell).
    let fx = this.gridX;
    const fy = this.gridY + gh + 26;
    this.add.text(this.gridX, fy - 16, 'FURNITURE (click, then click a plot cell):', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: SOL.muted,
    });
    for (const f of FURNITURE) {
      const owned = this.housing.layout.some((l) => l.id === f.id);
      const label = `${owned ? '✓ ' : ''}${f.name} (${f.cost.gold}g)`;
      const t = this.add.text(fx, fy, label, {
        fontFamily: '"Courier New", monospace', fontSize: '10px',
        color: this.selected === f.id ? SOL.gold : SOL.white,
        backgroundColor: this.selected === f.id ? '#3a2f10' : '#161b22',
        padding: { x: 6, y: 4 },
      }).setInteractive({ useHandCursor: true });
      t.on('pointerdown', () => { this.selected = f.id; this.refreshCatalogue(); });
      t.setData('furnId', f.id);
      fx += t.width + 8;
      if (fx > this.gridX + gw - 80) break; // strip overflow: first row only
    }

    // Grid clicks → place selected furniture.
    this.input.on('pointerdown', (ptr) => this.onGridClick(ptr));

    // Daily-claim + portal-back buttons.
    const by = H - 76;
    this.claimBtn = this.createPixelButton(cx - 150, by, 'CLAIM DAILY HARVEST', () => this.claimDaily(), 280);
    this.portalBtn = this.createPixelButton(cx + 150, by, '⛩ PORTAL TO TOWN', () => this.leaveHome(), 280);

    this.toast = this.add.text(cx, H - 36, '', {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: SOL.muted,
    }).setOrigin(0.5);

    this.claimLabel = this.add.text(cx - 150, by - 24, this.claimStatus(), {
      fontFamily: '"Courier New", monospace', fontSize: '10px', color: SOL.cyan,
    }).setOrigin(0.5);

    this.input.keyboard.on('keydown-ESC', () => this.leaveHome());
    this.input.keyboard.on('keydown-H', () => this.leaveHome());
  }

  renderPlaced() {
    this.placedLayer?.destroy(true);
    this.placedLayer = this.add.container(0, 0);
    for (const p of this.housing.layout) {
      const f = furnById(p.id);
      if (!f) continue;
      const [w, h] = f.size;
      const x = this.gridX + (p.x + w / 2) * CELL;
      const y = this.gridY + (p.y + h / 2) * CELL;
      const r = this.add.rectangle(x, y, w * CELL - 4, h * CELL - 4, SOL.panel, 0.92)
        .setStrokeStyle(1, SOL.purpleHex, 0.7);
      const label = this.add.text(x, y, f.name, {
        fontFamily: '"Courier New", monospace', fontSize: '9px', color: SOL.white,
      }).setOrigin(0.5);
      this.placedLayer.add([r, label]);
    }
    for (const t of this.housing.trophies) {
      const def = TROPHIES.find((x) => x.id === t.id);
      if (!def) continue;
      const x = this.gridX + (t.x + 0.5) * CELL;
      const y = this.gridY + (t.y + 0.5) * CELL;
      const star = this.add.text(x, y, `🏆 ${def.name}`, {
        fontFamily: '"Courier New", monospace', fontSize: '9px', color: SOL.gold,
      }).setOrigin(0.5);
      this.placedLayer.add(star);
    }
  }

  refreshCatalogue() {
    // Recreate the scene so selection highlight + ownership ticks update.
    this.scene.restart({ name: this.pname, hero: this.hero, mode: this.mode, returnTo: this.returnTo });
  }

  onGridClick(ptr) {
    if (!this.selected) return;
    const gx = Math.floor((ptr.x - this.gridX) / CELL);
    const gy = Math.floor((ptr.y - this.gridY) / CELL);
    if (gx < 0 || gy < 0 || gx >= LAYOUT_RULES.gridW || gy >= LAYOUT_RULES.gridH) return;
    const def = furnById(this.selected);
    if (!def) return;
    if (this.housing.layout.length >= LAYOUT_RULES.maxPlaced) {
      return this.showToast(`Plot full (${LAYOUT_RULES.maxPlaced} pieces max).`);
    }
    if (this.housing.layout.some((l) => l.id === def.id)) {
      return this.showToast(`${def.name} is already placed (one per plot).`);
    }
    if (!this.tryPay(def.cost)) {
      return this.showToast(`Need ${def.cost.gold}g + materials for ${def.name}.`);
    }
    this.housing.layout.push({ id: def.id, x: gx, y: gy, rot: 0 });
    this.persist();
    this.selected = null;
    this.renderPlaced();
    this.showToast(`Placed ${def.name}.`);
    this.scene.restart({ name: this.pname, hero: this.hero, mode: this.mode, returnTo: this.returnTo });
  }

  // Deduct gold + materials from the local progress record. Returns false if
  // unaffordable (no partial deduction). Parent economy code may wrap this.
  tryPay(cost) {
    const p = loadProgress(this.pname);
    if (!p) return false;
    const gold = Math.max(0, Math.floor(Number(cost?.gold)) || 0);
    if ((p.gold || 0) < gold) return false;
    const mats = cost?.mats || {};
    for (const [id, n] of Object.entries(mats)) {
      if ((p.ext?.mats?.[id] || 0) < n) return false;
    }
    p.gold -= gold;
    p.ext = p.ext || {};
    p.ext.mats = p.ext.mats || {};
    for (const [id, n] of Object.entries(mats)) p.ext.mats[id] -= n;
    saveProgress(this.pname, p);
    return true;
  }

  claimStatus() {
    if (!this.housing.plot) return 'No garden plot — unlock via the housing NPC in town.';
    const today = todayUTC();
    if (this.housing.yieldClaim.date === today) return `Claimed today (${today}). Back tomorrow.`;
    return `Ready to claim (${YIELD_RULES.claimsPerDay}/day cap).`;
  }

  // Capped daily claim: at most one payout per UTC date; unclaimed days are
  // lost (no accrual math anywhere). Pays MATERIALS only — never gold.
  claimDaily() {
    if (!this.housing.plot || !PLOTS[this.housing.plot]) {
      return this.showToast('No garden plot yet — unlock one in town first.');
    }
    const today = todayUTC();
    if (this.housing.yieldClaim.date === today) {
      return this.showToast(`Already claimed today (${today}).`);
    }
    const plot = PLOTS[this.housing.plot];
    const p = loadProgress(this.pname);
    if (!p) return this.showToast('No save found.');
    p.ext = p.ext || {};
    p.ext.mats = p.ext.mats || {};
    let total = 0;
    for (const d of plot.daily) {
      p.ext.mats[d.id] = Math.min(9999, (p.ext.mats[d.id] || 0) + d.n);
      total += d.n;
    }
    this.housing.plot = p.ext.housing?.plot || this.housing.plot;
    this.housing.yieldClaim = { date: today, amount: total };
    p.ext.housing = this.housing;
    saveProgress(this.pname, p);
    this.claimLabel?.setText(this.claimStatus());
    this.showToast(`Harvested ${plot.daily.map((d) => `${d.n}x ${d.id}`).join(', ')}.`);
  }

  persist() {
    const p = loadProgress(this.pname);
    if (!p) return;
    p.ext = p.ext || {};
    p.ext.housing = this.housing;
    saveProgress(this.pname, p);
  }

  createPixelButton(x, y, label, onClick, width = 240) {
    const container = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, width, 28, SOL.purpleHex, 0.9)
      .setStrokeStyle(1, SOL.greenHex, 0.6);
    bg.setInteractive({ useHandCursor: true });
    const text = this.add.text(0, 0, label, {
      fontFamily: '"Courier New", monospace', fontSize: '11px', color: '#ffffff', fontStyle: 'bold',
    }).setOrigin(0.5);
    bg.on('pointerover', () => bg.setFillStyle(0x7a3ad6));
    bg.on('pointerout', () => bg.setFillStyle(SOL.purpleHex));
    bg.on('pointerdown', () => { bg.setFillStyle(0x5e2db3); onClick(); });
    bg.on('pointerup', () => bg.setFillStyle(0x7a3ad6));
    container.add([bg, text]);
    return container;
  }

  showToast(message) {
    this.toast?.setText(message);
  }

  // Portal back to town: restore the world scene with the payload we arrived
  // with (returnTo), else our own payload, else fall back to title.
  leaveHome() {
    this.persist();
    const target = this.returnTo || (this.hero
      ? { hero: this.hero, mode: this.mode, name: this.pname }
      : null);
    if (target && this.scene.get('world')) return this.scene.start('world', target);
    if (target) return this.scene.start('world', target);
    return this.scene.start('title');
  }
}

export default HomeIslandScene;
