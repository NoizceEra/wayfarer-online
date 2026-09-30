import { SLOT_LABEL, RARITY, DYES, gearById, dyeById, statLine, statLabel } from '../data/gear.js';
import { BAG_SIZE } from '../core/save.js';
import { ModularPlayer } from '../entities/ModularPlayer.js';
import { audio } from '../systems/audio.js';
import { GOLD, label, box, addIcon, itemLines, Tip } from './gearUI.js';

// Equipment panel (key I or B, or the BAG button): paper doll showing the hero
// in all four facings, 8 slot boxes, a 30-slot bag with procedural icons,
// rarity-coloured tooltips with stat deltas, and equip / unequip / dye by
// click, double-click or drag. The panel is rebuilt from the player's state on
// every change, so it can never drift from what the hero is actually wearing.
const LEFT = ['head', 'face', 'body', 'feet'];
const RIGHT = ['back', 'weapon', 'offhand', 'charm'];

export class EquipPanel {
  // hooks: { player(): ModularPlayer|null, changed(): void, say(msg): void }
  constructor(scene, hooks) {
    this.scene = scene; this.hooks = hooks;
    this.open = false;
    this.sel = null; this.dyeOpen = false;
    this.dollFacing = 'down';
    this.tip = new Tip(scene);
    this.drag = null; this.pressed = null; this.lastClick = { key: '', t: 0 };
    this.onMove = (p) => this.pointerMove(p);
    this.onUp = (p) => this.pointerUp(p);
  }

  get isOpen() { return this.open; }
  toggle(force) {
    const want = force !== undefined ? force : !this.open;
    if (want === this.open) return;
    this.open = want;
    if (want) {
      this.sel = null; this.dyeOpen = false;
      this.build();
      this.scene.input.on('pointermove', this.onMove);
      this.scene.input.on('pointerup', this.onUp);
    } else {
      this.scene.input.off('pointermove', this.onMove);
      this.scene.input.off('pointerup', this.onUp);
      this.teardown();
    }
    const w = this.scene.world?.();
    if (w) w.uiModal = want || !!this.scene.shop?.isOpen;
  }
  refresh() { if (this.open) this.build(); }
  resize() { if (this.open) this.build(); }

  teardown() {
    this.tip.hide();
    this.endDrag();
    if (this.c) { this.c.destroy(); this.c = null; }
    this.doll = null;
  }

  // ── layout + build ─────────────────────────────────────────────────────
  build() {
    const s = this.scene, p = this.hooks.player();
    if (!p) return;
    this.teardown();
    const W = s.scale.width, H = s.scale.height;
    const wide = W / H > 1.0;
    const dw = wide ? 680 : 380, dh = wide ? 440 : 650;
    const k = Math.min(1, (W - 8) / dw, (H - 8) / dh);
    this.k = k;
    const c = s.add.container(W / 2, H / 2).setDepth(180).setScale(k);
    this.c = c;
    const ox = -dw / 2, oy = -dh / 2;
    this.geo = { ox, oy, dw, dh, slots: {}, bag: [] };
    c.add(box(s, ox, oy, dw, dh, 0x10140f, 0.985, 0xc8a840, 3));
    c.add(label(s, ox + 14, oy + 11, 'EQUIPMENT', 13, GOLD, { fontStyle: 'bold' }));
    c.add(label(s, ox + dw - 50, oy + 14, 'I / B · drag or click', 7, '#6f7d6a').setOrigin(1, 0));
    const x = label(s, ox + dw - 14, oy + 10, 'X', 12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.6); this.toggle(false); });
    c.add(x);

    // paper-doll area + 8 slots
    const leftX0 = ox + 12, leftW = wide ? 252 : dw - 24, topY = oy + 40;
    const S = 42;
    const slotXL = leftX0 + S / 2, slotXR = leftX0 + leftW - S / 2;
    const slotY = (i) => topY + 6 + i * 52 + S / 2;
    LEFT.forEach((sl, i) => this.slotBox(sl, slotXL, slotY(i), S));
    RIGHT.forEach((sl, i) => this.slotBox(sl, slotXR, slotY(i), S));
    const dx = leftX0 + leftW / 2, feetY = topY + 160;
    this.buildDoll(dx, feetY, p);

    // stats
    const sy = topY + 230;
    this.buildStats(leftX0, sy, leftW, p);

    // bag
    const bagX0 = wide ? ox + 280 : ox + 14;
    const bagW = wide ? dw - 280 - 12 : dw - 28;
    const bagY = wide ? oy + 62 : sy + 88;
    c.add(label(s, bagX0, bagY - 18, `BAG  ${p.inventory.length}/${BAG_SIZE}`, 10, '#c8a840', { fontStyle: 'bold' }));
    const cols = wide ? 6 : 8, cell = wide ? 44 : 40, gap = wide ? 6 : 4;
    const gridW = cols * cell + (cols - 1) * gap;
    const gx0 = bagX0 + Math.floor((bagW - gridW) / 2);
    const rows = Math.ceil(BAG_SIZE / cols);
    this.geo.bagRect = { x: gx0 - 4, y: bagY - 4, w: gridW + 8, h: rows * (cell + gap) + 4 };
    for (let i = 0; i < BAG_SIZE; i++) {
      const cx = gx0 + (i % cols) * (cell + gap) + cell / 2, cy = bagY + Math.floor(i / cols) * (cell + gap) + cell / 2;
      this.bagCell(i, cx, cy, cell, p);
    }
    // details
    const detY = bagY + rows * (cell + gap) + 6;
    this.buildDetails(bagX0, detY, bagW, oy + dh - 10 - detY, p);
    this.highlightSel();
  }

  slotBox(slot, cx, cy, S) {
    const s = this.scene, c = this.c, p = this.hooks.player();
    const id = p.equipped[slot], item = id && gearById(id);
    const bg = s.add.graphics(); c.add(bg);
    const border = item ? RARITY[item.rarity].tint : 0x4a4a32;
    bg.fillStyle(item ? 0x1b2a1b : 0x0b0f0a, 1).fillRect(cx - S / 2, cy - S / 2, S, S);
    bg.lineStyle(2, border, item ? 1 : 0.7).strokeRect(cx - S / 2 + 1, cy - S / 2 + 1, S - 2, S - 2);
    if (item) addIcon(s, c, item, p.dyes[item.id], cx, cy, 2);
    else c.add(label(s, cx, cy, SLOT_LABEL[slot], 6, '#5d6a58').setOrigin(0.5));
    c.add(label(s, cx, cy + S / 2 + 2, SLOT_LABEL[slot], 6, '#8a9a80').setOrigin(0.5, 0));
    const hit = s.add.rectangle(cx, cy, S, S, 0xffffff, 0.001).setInteractive({ useHandCursor: !!item });
    c.add(hit);
    this.geo.slots[slot] = { x: cx, y: cy, S, bg, border };
    const src = { kind: 'slot', slot };
    hit.on('pointerdown', (ptr) => this.press(src, item && item.id, ptr));
    hit.on('pointerover', (ptr) => this.hover(item, p.dyes[item?.id], ptr, slot));
    hit.on('pointermove', (ptr) => { if (!this.drag && item) this.moveTip(ptr); });
    hit.on('pointerout', () => this.tip.hide());
  }

  bagCell(i, cx, cy, cell, p) {
    const s = this.scene, c = this.c;
    const id = p.inventory[i], item = id && gearById(id);
    const bg = s.add.graphics(); c.add(bg);
    bg.fillStyle(0x0b0f0a, 1).fillRect(cx - cell / 2, cy - cell / 2, cell, cell);
    const col = item ? RARITY[item.rarity].tint : 0x3a3a2a;
    bg.lineStyle(2, col, item ? 0.95 : 0.6).strokeRect(cx - cell / 2 + 1, cy - cell / 2 + 1, cell - 2, cell - 2);
    if (item) {
      addIcon(s, c, item, p.dyes[item.id], cx, cy, 2);
      const blocked = p.equipBlockReason(item.id);
      if (blocked) c.add(s.add.rectangle(cx, cy, cell - 4, cell - 4, 0x3a0a0a, 0.35));
    }
    const hit = s.add.rectangle(cx, cy, cell, cell, 0xffffff, 0.001).setInteractive({ useHandCursor: !!item });
    c.add(hit);
    this.geo.bag[i] = { x: cx, y: cy, S: cell, bg, col };
    if (!item) return;
    const src = { kind: 'bag', idx: i };
    hit.on('pointerdown', (ptr) => this.press(src, id, ptr));
    hit.on('pointerover', (ptr) => this.hover(item, p.dyes[id], ptr));
    hit.on('pointermove', (ptr) => { if (!this.drag) this.moveTip(ptr); });
    hit.on('pointerout', () => this.tip.hide());
  }

  buildDoll(dx, feetY, p) {
    const s = this.scene, c = this.c;
    const g = s.add.graphics(); c.add(g);
    g.fillStyle(0x000000, 0.35).fillEllipse(dx, feetY + 8, 88, 22);
    g.fillStyle(0x2c3320, 1).fillEllipse(dx, feetY + 4, 84, 20);
    g.fillStyle(0xc8a840, 1).fillEllipse(dx, feetY + 2, 84, 20);
    g.fillStyle(0x4d5e2a, 1).fillEllipse(dx, feetY + 2, 76, 15);
    g.fillStyle(0x5f7535, 1).fillEllipse(dx, feetY, 62, 11);
    const doll = new ModularPlayer(s, dx, feetY, p.hero, { remote: true });
    doll.noDust = true; doll.shadow.setVisible(false);
    doll.setScale(6);
    doll.applyHero(p.hero, p.lookState());
    doll.setFacing(this.dollFacing);
    c.add(doll);
    this.doll = doll;
    const hit = s.add.rectangle(dx, feetY - 44, 110, 130, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.turn());
    c.add(hit);
    const t = label(s, dx, feetY + 24, '◄ TURN ►', 8, '#c8a840', { backgroundColor: '#2a2210', padding: { x: 6, y: 3 } }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true });
    t.on('pointerdown', () => this.turn());
    c.add(t);
  }
  turn() {
    const order = ['down', 'left', 'up', 'right'];
    this.dollFacing = order[(order.indexOf(this.dollFacing) + 1) % 4];
    this.doll?.setFacing(this.dollFacing);
    audio.play('ui', 0.4);
  }

  buildStats(x, y, w, p) {
    const s = this.scene, c = this.c;
    c.add(box(s, x, y, w, 62, 0x0b0f0a, 0.9, 0x3a3a2a, 1));
    c.add(label(s, x + 8, y + 6, `Lv ${p.level} ${p.job.name}`, 9, '#e8e4cc'));
    c.add(label(s, x + w - 8, y + 6, `${p.gold}g`, 9, GOLD).setOrigin(1, 0));
    c.add(label(s, x + 8, y + 20, `ATK ${p.effAtk()}  DEF ${p.effDef()}  HP ${p.effMaxHp()}  MP ${p.effMaxMp()}`, 8, '#aed6f1'));
    const b = p.equipBonuses();
    const parts = ['str', 'agi', 'vit', 'int', 'dex', 'luk'].filter((k) => b[k]).map((k) => `${statLabel(k)} ${b[k] > 0 ? '+' : ''}${b[k]}`);
    c.add(label(s, x + 8, y + 35, parts.length ? `Gear: ${parts.join('  ')}` : 'Gear: no stat bonuses yet', 8, parts.length ? '#9be88a' : '#6f7d6a', { wordWrap: { width: w - 16 } }));
  }

  // ── selection + details ────────────────────────────────────────────────
  selItem() {
    const p = this.hooks.player();
    if (!this.sel || !p) return null;
    const id = this.sel.kind === 'slot' ? p.equipped[this.sel.slot] : p.inventory[this.sel.idx];
    return id ? gearById(id) : null;
  }
  highlightSel() {
    const g = this.geo;
    const mark = (r, col) => { if (!r) return; r.bg.lineStyle(3, 0xfff6c8, 1).strokeRect(r.x - r.S / 2 + 1, r.y - r.S / 2 + 1, r.S - 2, r.S - 2); };
    if (this.sel?.kind === 'slot') mark(g.slots[this.sel.slot]);
    else if (this.sel?.kind === 'bag') mark(g.bag[this.sel.idx]);
  }
  buildDetails(x, y, w, h, p) {
    const s = this.scene, c = this.c;
    c.add(box(s, x, y, w, h, 0x0b0f0a, 0.92, 0x3a3a2a, 1));
    const item = this.selItem();
    if (!item) {
      c.add(label(s, x + 10, y + 10, 'Click an item for details.\nDouble-click or drag to equip.\nEquipped gear shows on your hero.', 8, '#7d8a78', { wordWrap: { width: w - 20 } }));
      return;
    }
    const R = RARITY[item.rarity], dye = p.dyes[item.id];
    const worn = this.sel.kind === 'slot';
    addIcon(s, c, item, dye, x + 26, y + 26, 2.5);
    c.add(label(s, x + 52, y + 7, item.name, 11, R.color, { fontStyle: 'bold' }));
    const block = p.equipBlockReason(item.id);
    c.add(label(s, x + 52, y + 22, `${R.name} ${SLOT_LABEL[item.slot]} · Lv ${item.lvl}${item.cls ? ` · ${item.cls.join('/')}` : ''}`, 8, block ? '#ff7a6a' : R.color));
    c.add(label(s, x + 10, y + 44, statLine(item.stats), 8, '#9be88a', { wordWrap: { width: w - 20 } }));
    if (!this.dyeOpen) c.add(label(s, x + 10, y + 58, item.desc || '', 8, '#b9b39a', { wordWrap: { width: w - 20 } }));
    // buttons
    const by = y + h - 24;
    let bx = x + 10;
    const mk = (txt, fn, bw, fill = '#35451c', col = '#e6f2c0') => {
      const b = label(s, bx, by, txt, 9, col, { backgroundColor: fill, padding: { x: 7, y: 4 } }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { audio.play('ui', 0.6); fn(); });
      c.add(b); bx += b.width + 8; return b;
    };
    mk(worn ? 'UNEQUIP' : (block ? block.toUpperCase() : 'EQUIP'), () => this.activate(), 0, worn ? '#4a3c16' : block ? '#5a2a26' : '#35451c');
    if (item.dyeable !== false) mk(this.dyeOpen ? 'DYE ▲' : 'DYE ▼', () => { this.dyeOpen = !this.dyeOpen; this.build(); }, 0, '#3a2a55', '#e0c8ff');
    if (this.dyeOpen && item.dyeable !== false) {
      const sw = 14, sy = by - sw - 6;
      c.add(box(s, x + 4, sy - 4, w - 8, sw + 8, 0x140e1f, 0.95, 0x5a3a7a, 1));
      const swatches = [{ id: null, tint: 0x555555 }, ...DYES];
      swatches.forEach((d, i) => {
        const cx = x + 12 + i * (sw + 4) + sw / 2;
        const r = s.add.rectangle(cx, sy + sw / 2, sw, sw, d.tint).setStrokeStyle(dye === d.id || (!dye && !d.id) ? 2 : 1, dye === d.id || (!dye && !d.id) ? 0xffffff : 0x000000).setInteractive({ useHandCursor: true });
        if (!d.id) c.add(label(s, cx, sy + sw / 2, '×', 10, '#fff').setOrigin(0.5));
        r.on('pointerdown', () => { audio.play('ui', 0.6); p.setDye(item.id, d.id); this.hooks.changed(); this.build(); this.hooks.say(d.id ? `${item.name} dyed ${dyeById(d.id).name}.` : `${item.name} dye removed.`); });
        r.on('pointerover', (ptr) => { this.tip.show([{ t: d.id ? dyeById(d.id).name : 'Original colour', c: '#e0b8ff', s: 9 }], ptr.x, ptr.y); });
        r.on('pointerout', () => this.tip.hide());
        c.add(r);
      });
    }
  }

  // ── actions ────────────────────────────────────────────────────────────
  activate() {
    const p = this.hooks.player(), item = this.selItem();
    if (!p || !item) return;
    if (this.sel.kind === 'slot') {
      if (p.inventory.length >= BAG_SIZE) { audio.play('error', 0.7); this.hooks.say('Bag is full!'); return; }
      if (p.unequip(this.sel.slot)) { audio.play('ui', 0.7); this.hooks.say(`Unequipped ${item.name}.`); this.sel = null; }
    } else {
      if (p.equip(item.id)) {
        audio.play('gold', 0.7); this.hooks.say(`Equipped ${item.name}.`);
        this.sel = { kind: 'slot', slot: item.slot };
      } else { audio.play('error', 0.7); this.hooks.say(`${item.name}: ${p.lastBlock || 'cannot equip'}.`); return; }
    }
    this.hooks.changed();
    this.build();
  }

  hover(item, dyeId, ptr, slot) {
    if (this.drag || !item) return;
    const p = this.hooks.player();
    const eqId = slot ? null : p.equipped[item.slot];
    this.tip.show(itemLines(item, dyeId, p, eqId), ptr.x, ptr.y);
  }
  moveTip(ptr) {
    if (!this.tip.c.visible) return;
    const W = this.scene.scale.width, H = this.scene.scale.height;
    const b = this.tip.c.getBounds();
    let x = ptr.x + 14, y = ptr.y + 10;
    if (x + b.width > W - 4) x = ptr.x - b.width - 10;
    if (y + b.height > H - 4) y = H - b.height - 4;
    this.tip.c.setPosition(Math.max(4, x), Math.max(4, y));
  }

  // click / double-click / drag
  press(src, id, ptr) {
    if (!id) return;
    this.pressed = { src, id, x: ptr.x, y: ptr.y };
  }
  pointerMove(ptr) {
    if (!this.open) return;
    if (this.pressed && !this.drag && ptr.isDown && Math.hypot(ptr.x - this.pressed.x, ptr.y - this.pressed.y) > 8) {
      const item = gearById(this.pressed.id);
      this.tip.hide();
      const p = this.hooks.player();
      this.drag = { ...this.pressed, item, ghost: this.scene.add.image(ptr.x, ptr.y, this.iconKeyOf(item, p)).setScale(2.4 * this.k).setDepth(700).setAlpha(0.9) };
      this.highlightDrop(item);
    }
    if (this.drag) this.drag.ghost.setPosition(ptr.x, ptr.y);
  }
  iconKeyOf(item, p) { return `gear.icon.${item.id}${p.dyes[item.id] && item.dyeable !== false ? `.${p.dyes[item.id]}` : ''}`; }
  highlightDrop(item) {
    const r = this.geo.slots[item.slot];
    if (r) r.bg.lineStyle(3, 0x9be88a, 1).strokeRect(r.x - r.S / 2 + 1, r.y - r.S / 2 + 1, r.S - 2, r.S - 2);
  }
  endDrag() { if (this.drag) { this.drag.ghost.destroy(); this.drag = null; } this.pressed = null; }
  toLocal(ptr) { return { x: (ptr.x - this.scene.scale.width / 2) / this.k, y: (ptr.y - this.scene.scale.height / 2) / this.k }; }
  pointerUp(ptr) {
    if (!this.open || !this.pressed) return;
    const pr = this.pressed;
    const p = this.hooks.player();
    if (this.drag) {
      const { item, src } = this.drag;
      const L = this.toLocal(ptr);
      const inRect = (r) => r && Math.abs(L.x - r.x) <= r.S / 2 && Math.abs(L.y - r.y) <= r.S / 2;
      const hitSlot = Object.keys(this.geo.slots).find((sl) => inRect(this.geo.slots[sl]));
      const onBag = L.x >= this.geo.bagRect.x && L.x <= this.geo.bagRect.x + this.geo.bagRect.w && L.y >= this.geo.bagRect.y && L.y <= this.geo.bagRect.y + this.geo.bagRect.h;
      this.endDrag();
      if (src.kind === 'bag' && hitSlot) {
        if (hitSlot !== item.slot) { audio.play('error', 0.7); this.hooks.say(`${item.name} goes in the ${SLOT_LABEL[item.slot]} slot.`); this.build(); return; }
        this.sel = src; this.activate(); return;
      }
      if (src.kind === 'slot' && (onBag || !hitSlot)) { this.sel = src; this.activate(); return; }
      this.build();
      return;
    }
    this.pressed = null;
    const key = pr.src.kind === 'slot' ? `s:${pr.src.slot}` : `b:${pr.src.idx}`;
    const now = this.scene.time.now;
    const dbl = this.lastClick.key === key && now - this.lastClick.t < 380;
    this.lastClick = { key, t: now };
    if (key !== this.selKey) this.dyeOpen = false;
    this.selKey = key;
    this.sel = pr.src;
    if (dbl) { this.activate(); return; }
    audio.play('ui', 0.4);
    this.tip.hide();
    this.build();
  }

  destroy() { this.toggle(false); this.tip.destroy(); }
}
