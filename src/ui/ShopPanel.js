import { SHOPS, RARITY, SLOT_LABEL, gearById, sellPrice, statLine } from '../data/gear.js';
import { BAG_SIZE } from '../core/save.js';
import { audio } from '../systems/audio.js';
import { GOLD, label, box, addIcon, itemLines, Tip } from './gearUI.js';

// Market-stall shop: BUY tab (stall stock + potions) and SELL tab (your bag at
// 40% of value). Click a row to inspect, double-click / BUY / SELL to trade.
const POTION = { id: '__potion', name: 'Healing Potion', price: 3, desc: 'Restores 45 HP. Drink with Q.' };

export class ShopPanel {
  // hooks: { player(), changed(), say() }
  constructor(scene, hooks) {
    this.scene = scene; this.hooks = hooks;
    this.open = false; this.shopId = 'maren';
    this.tab = 'buy'; this.page = 0; this.sel = null;
    this.tip = new Tip(scene);
    this.lastClick = { key: '', t: 0 };
  }
  get isOpen() { return this.open; }

  show(shopId) {
    this.shopId = SHOPS[shopId] ? shopId : 'maren';
    this.tab = 'buy'; this.page = 0; this.sel = null; this.open = true;
    this.build();
    const w = this.scene.world?.();
    if (w) w.uiModal = true;
  }
  close() {
    this.open = false;
    this.tip.hide();
    this.c?.destroy(); this.c = null;
    const w = this.scene.world?.();
    if (w) w.uiModal = !!this.scene.equip?.isOpen;
  }
  refresh() { if (this.open) this.build(); }

  entries(p) {
    if (this.tab === 'buy') {
      const stock = SHOPS[this.shopId].stock.map(gearById).filter(Boolean);
      return [POTION, ...stock];
    }
    return p.inventory.map((id, i) => ({ item: gearById(id), i })).filter((e) => e.item);
  }

  build() {
    const s = this.scene, p = this.hooks.player();
    if (!p) return;
    this.tip.hide();
    this.c?.destroy();
    const W = s.scale.width, H = s.scale.height;
    const wide = W / H > 1.0;
    const dw = wide ? 560 : 380, dh = wide ? 440 : 600;
    const k = Math.min(1, (W - 8) / dw, (H - 8) / dh);
    const z = s.uiZoom || 1; // UI-scale camera zoom: keep this auto-fit panel 1:1 on screen
    const c = s.add.container(W / 2 / z, H / 2 / z).setDepth(185).setScale(k / z);
    this.c = c;
    const ox = -dw / 2, oy = -dh / 2;
    c.add(box(s, ox, oy, dw, dh, 0x10140f, 0.985, 0xc8a840, 3));
    c.add(label(s, ox + 14, oy + 11, SHOPS[this.shopId].title, wide ? 12 : 10, GOLD, { fontStyle: 'bold' }));
    c.add(label(s, ox + 14, oy + 30, `Your gold: ${p.gold}g`, 9, '#ffe27a'));
    const x = label(s, ox + dw - 14, oy + 10, 'X', 12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.6); this.close(); });
    c.add(x);
    // tabs
    const tabBtn = (t, txt, bx) => {
      const on = this.tab === t;
      const b = label(s, bx, oy + 48, txt, 10, on ? '#fff6c8' : '#b9b39a', { backgroundColor: on ? '#5a4a1a' : '#2a2210', padding: { x: 12, y: 4 } }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { if (this.tab !== t) { this.tab = t; this.page = 0; this.sel = null; audio.play('ui', 0.5); this.build(); } });
      c.add(b); return b;
    };
    const b1 = tabBtn('buy', 'BUY', ox + 14);
    tabBtn('sell', 'SELL', ox + 14 + b1.width + 6);

    // list
    const all = this.entries(p);
    const rowH = 34, pitch = 36, listY = oy + 82;
    const detH = 92;
    const rowsPer = Math.max(3, Math.floor((dh - 82 - detH - 34) / pitch));
    const pages = Math.max(1, Math.ceil(all.length / rowsPer));
    this.page = Math.min(this.page, pages - 1);
    const slice = all.slice(this.page * rowsPer, this.page * rowsPer + rowsPer);
    if (!all.length) c.add(label(s, 0, listY + 40, this.tab === 'buy' ? 'Nothing for sale.' : 'Your bag is empty.\nMonsters drop gear out in the wilds.', 9, '#7d8a78', { align: 'center' }).setOrigin(0.5, 0));
    slice.forEach((e, j) => {
      const isBuy = this.tab === 'buy';
      const item = isBuy ? e : e.item;
      const key = isBuy ? e.id : `i${e.i}`;
      const y = listY + j * pitch;
      const on = this.sel === key;
      const R = item.rarity ? RARITY[item.rarity] : null;
      const row = s.add.graphics(); c.add(row);
      row.fillStyle(on ? 0x2a3a1c : 0x0b0f0a, 1).fillRect(ox + 10, y, dw - 20, rowH);
      row.lineStyle(on ? 2 : 1, on ? 0xfff6c8 : (R ? R.tint : 0x5a5a3a), on ? 1 : 0.7).strokeRect(ox + 11, y + 1, dw - 22, rowH - 2);
      if (item.id === '__potion') {
        if (s.textures.exists('hud.potion')) c.add(s.add.image(ox + 30, y + rowH / 2, 'hud.potion').setScale(1.5));
      } else addIcon(s, c, item, p.dyes[item.id], ox + 30, y + rowH / 2, 1.8);
      c.add(label(s, ox + 52, y + 4, item.name, 10, R ? R.color : '#e8e4cc', { fontStyle: 'bold' }));
      const sub = item.id === '__potion' ? item.desc : `${SLOT_LABEL[item.slot]} · Lv ${item.lvl} · ${statLine(item.stats)}`;
      const bad = item.id !== '__potion' && (p.level < item.lvl || (item.cls && !item.cls.includes(p.job.id)));
      c.add(label(s, ox + 52, y + 19, sub, 7, bad ? '#d98a7a' : '#9fb0a0', { wordWrap: { width: dw - 150 } }));
      const price = isBuy ? item.price : sellPrice(item);
      c.add(label(s, ox + dw - 20, y + rowH / 2, isBuy ? `${price}g` : `+${price}g`, 11, isBuy && p.gold < price ? '#ff8a7a' : GOLD, { fontStyle: 'bold' }).setOrigin(1, 0.5));
      const hit = s.add.rectangle(ox + dw / 2, y + rowH / 2, dw - 20, rowH, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      c.add(hit);
      hit.on('pointerdown', () => {
        const now = s.time.now;
        const dbl = this.lastClick.key === key && now - this.lastClick.t < 380;
        this.lastClick = { key, t: now };
        this.sel = key;
        if (dbl) { this.trade(e); return; }
        audio.play('ui', 0.4); this.build();
      });
      hit.on('pointerover', (ptr) => { if (item.id !== '__potion') this.tip.show(itemLines(item, p.dyes[item.id], p, p.equipped[item.slot]), ptr.x, ptr.y); });
      hit.on('pointermove', (ptr) => { if (this.tip.c.visible) this.tip.follow(ptr.x, ptr.y); });
      hit.on('pointerout', () => this.tip.hide());
    });
    // pager
    const py = oy + dh - detH - 28;
    if (pages > 1) {
      const pb = (txt, dx, fn) => { const b = label(s, ox + dw / 2 + dx, py, txt, 10, '#e8e4cc', { backgroundColor: '#2a2210', padding: { x: 8, y: 3 } }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }); b.on('pointerdown', () => { audio.play('ui', 0.4); fn(); this.build(); }); c.add(b); };
      pb('◄', -60, () => { this.page = (this.page + pages - 1) % pages; });
      pb('►', 60, () => { this.page = (this.page + 1) % pages; });
      c.add(label(s, ox + dw / 2, py + 4, `${this.page + 1}/${pages}`, 9, '#b9b39a').setOrigin(0.5, 0));
    }
    // details + action
    const dy = oy + dh - detH - 8;
    c.add(box(s, ox + 10, dy, dw - 20, detH, 0x0b0f0a, 0.95, 0x3a3a2a, 1));
    const sel = this.selectedEntry(all);
    if (!sel) {
      c.add(label(s, ox + 20, dy + 10, this.tab === 'buy' ? 'Click an item to inspect it. Double-click to buy.' : 'Click an item to inspect it. Double-click to sell.', 8, '#7d8a78'));
    } else {
      const item = this.tab === 'buy' ? sel : sel.item;
      if (item.id === '__potion') {
        c.add(label(s, ox + 20, dy + 10, item.name, 11, '#e8e4cc', { fontStyle: 'bold' }));
        c.add(label(s, ox + 20, dy + 28, item.desc, 8, '#b9b39a'));
      } else {
        const R = RARITY[item.rarity];
        c.add(label(s, ox + 20, dy + 8, item.name, 11, R.color, { fontStyle: 'bold' }));
        c.add(label(s, ox + 20, dy + 23, `${R.name} ${SLOT_LABEL[item.slot]} · Requires Lv ${item.lvl}${item.cls ? ` · ${item.cls.join('/')} only` : ''}`, 8, R.color));
        c.add(label(s, ox + 20, dy + 37, statLine(item.stats), 9, '#9be88a', { wordWrap: { width: dw - 180 } }));
        c.add(label(s, ox + 20, dy + 52, item.desc || '', 8, '#b9b39a', { wordWrap: { width: dw - 180 } }));
      }
      const price = this.tab === 'buy' ? item.price : sellPrice(item);
      const ok = this.tab === 'sell' || p.gold >= price;
      const btn = label(s, ox + dw - 26, dy + detH / 2, this.tab === 'buy' ? `BUY  ${price}g` : `SELL  +${price}g`, 11, ok ? '#fff6c8' : '#ffb0a0', { backgroundColor: ok ? '#35451c' : '#5a2a26', padding: { x: 12, y: 8 }, fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.trade(sel));
      c.add(btn);
    }
  }

  selectedEntry(all) {
    if (this.sel == null) return null;
    if (this.tab === 'buy') return all.find((e) => e.id === this.sel) || null;
    return all.find((e) => `i${e.i}` === this.sel) || null;
  }

  trade(e) {
    const p = this.hooks.player();
    if (!p) return;
    if (this.tab === 'buy') {
      const item = e;
      if (p.gold < item.price) { audio.play('error', 0.7); this.hooks.say(`Not enough gold for ${item.name} (${item.price}g).`); return; }
      if (item.id === '__potion') p.potions += 1;
      else {
        if (p.inventory.length >= BAG_SIZE) { audio.play('error', 0.7); this.hooks.say('Your bag is full — sell something first.'); return; }
        p.inventory.push(item.id);
      }
      p.gold -= item.price;
      audio.play('gold');
      this.hooks.say(`Bought ${item.name} (-${item.price}g).`);
    } else {
      const item = e.item;
      const i = p.inventory.indexOf(item.id);
      if (i < 0) return;
      p.inventory.splice(i, 1);
      const v = sellPrice(item);
      p.gold += v;
      this.sel = null;
      audio.play('coin');
      this.hooks.say(`Sold ${item.name} (+${v}g).`);
    }
    this.hooks.changed();
    this.build();
  }

  destroy() { this.close(); this.tip.destroy(); }
}
