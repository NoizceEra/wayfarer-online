import { SHOPS, RARITY, SLOT_LABEL, gearById, sellPrice, statLine } from '../data/gear.js';
import { BAG_SIZE } from '../core/save.js';
import { audio } from '../systems/audio.js';
import { bus, Events } from '../core/events.js';
import { matById, KINDS } from '../data/materials.js';
import { matIconKey } from '../systems/matArt.js';
import { addMat, takeMat, packList } from '../systems/pack.js';
import { shopStock, MAT_STOCK, restockIn, pushBuyback, buybackCost, matSellValue } from '../systems/economy.js';
import { GOLD, label, box, addIcon, itemLines, Tip } from './gearUI.js';

// Market-stall shop: BUY (rotating stall stock + potions + materials), GEAR
// (sell your bag at 40%), MATS (sell gathered materials / junk) and BACK
// (buy back what you sold, +25%). Click a row to inspect, double-click or use
// the button to trade. Stock rotates every 10 minutes.
const POTION = { id: '__potion', name: 'Healing Potion', price: 3, desc: 'Restores 45 HP. Drink with Q.', special: true };
const TABS = [['buy', 'BUY'], ['sell', 'GEAR'], ['mats', 'MATS'], ['back', 'BUYBACK']];

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
  get world() { return this.scene.world?.(); }
  get meta() { return this.world?.meta; }

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
    if (w) w.uiModal = !!(this.scene.equip?.isOpen || this.scene.journal?.isOpen || this.scene.craftPanel?.isOpen);
  }
  refresh() { if (this.open) this.build(); }

  // Normalised rows: {key, kind, item?, mat?, n?, name, sub, price, bad?}
  entries(p) {
    const meta = this.meta;
    if (this.tab === 'buy') {
      const out = [{ key: POTION.id, kind: 'potion', name: POTION.name, sub: POTION.desc, price: POTION.price, desc: POTION.desc }];
      for (const m of MAT_STOCK[this.shopId] || []) { const mm = matById(m.id); if (mm) out.push({ key: `m:${m.id}`, kind: 'mat', mat: mm, name: mm.name, sub: mm.desc, price: m.price, desc: mm.desc }); }
      for (const id of shopStock(this.shopId)) {
        const g = gearById(id);
        out.push({ key: id, kind: 'gear', item: g, name: g.name, price: g.price, sub: `${SLOT_LABEL[g.slot]} · Lv ${g.lvl} · ${statLine(g.stats)}`, bad: p.level < g.lvl || (g.cls && !g.cls.includes(p.job.id)) });
      }
      return out;
    }
    if (this.tab === 'sell') {
      return p.inventory.map((id, i) => ({ id, i })).filter((e) => gearById(e.id)).map((e) => {
        const g = gearById(e.id);
        return { key: `i${e.i}`, kind: 'gear', item: g, name: g.name, price: sellPrice(g), sub: `${SLOT_LABEL[g.slot]} · Lv ${g.lvl} · ${statLine(g.stats)}`, slotIndex: e.i, bad: p.level < g.lvl || (g.cls && !g.cls.includes(p.job.id)) };
      });
    }
    if (this.tab === 'mats') {
      return packList(this.world).filter((e) => e.m.kind !== 'quest').map((e) => ({ key: `m:${e.id}`, kind: 'mat', mat: e.m, n: e.n, name: e.m.name, price: matSellValue(e.id), sub: `${KINDS[e.m.kind]} · owned ${e.n}`, desc: e.m.desc }));
    }
    return (meta?.buyback || []).map((b, i) => {
      const g = b.kind === 'gear' ? gearById(b.id) : null, m = b.kind === 'mat' ? matById(b.id) : null;
      if (!g && !m) return null;
      return { key: `b${i}`, kind: b.kind, item: g, mat: m, bb: b, bbIndex: i, name: (g || m).name + (b.n > 1 ? ` x${b.n}` : ''), price: buybackCost(b), sub: 'Sold earlier. Buy back for +25%.', desc: (g || m).desc };
    }).filter(Boolean);
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
    const c = s.add.container(W / 2, H / 2).setDepth(185).setScale(k);
    this.c = c;
    const ox = -dw / 2, oy = -dh / 2;
    const buying = this.tab === 'buy' || this.tab === 'back';
    c.add(box(s, ox, oy, dw, dh, 0x10140f, 0.985, 0xc8a840, 3));
    c.add(label(s, ox + 14, oy + 11, SHOPS[this.shopId].title, wide ? 12 : 10, GOLD, { fontStyle: 'bold' }));
    c.add(label(s, ox + 14, oy + 30, `Your gold: ${p.gold}g`, 9, '#ffe27a'));
    if (this.tab === 'buy') {
      const ms = restockIn(), mm = Math.floor(ms / 60000), ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
      c.add(label(s, ox + dw - 50, oy + 32, `Restock in ${mm}:${ss}`, 7, '#8a9a8a').setOrigin(1, 0));
    }
    const x = label(s, ox + dw - 14, oy + 10, 'X', 12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.6); this.close(); });
    c.add(x);
    let tx = ox + 14;
    for (const [t, txt] of TABS) {
      const on = this.tab === t;
      const b = label(s, tx, oy + 48, txt, 10, on ? '#fff6c8' : '#b9b39a', { backgroundColor: on ? '#5a4a1a' : '#2a2210', padding: { x: 10, y: 4 } }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { if (this.tab !== t) { this.tab = t; this.page = 0; this.sel = null; audio.play('ui', 0.5); this.build(); } });
      c.add(b); tx += b.width + 5;
    }
    if (this.tab === 'mats') {
      const jb = label(s, ox + dw - 14, oy + 48, 'SELL ALL JUNK', 9, '#fff6c8', { backgroundColor: '#5a3a1a', padding: { x: 8, y: 5 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
      jb.on('pointerdown', () => this.sellJunk());
      c.add(jb);
    }

    // list
    const all = this.entries(p);
    const rowH = 34, pitch = 36, listY = oy + 82;
    const detH = 92;
    const rowsPer = Math.max(3, Math.floor((dh - 82 - detH - 34) / pitch));
    const pages = Math.max(1, Math.ceil(all.length / rowsPer));
    this.page = Math.min(this.page, pages - 1);
    const slice = all.slice(this.page * rowsPer, this.page * rowsPer + rowsPer);
    const emptyMsg = { buy: 'Nothing for sale.', sell: 'Your bag is empty.\nMonsters drop gear out in the wilds.', mats: 'No materials to sell.\nGather herbs, ore and fish, or fight monsters.', back: 'Nothing to buy back.' }[this.tab];
    if (!all.length) c.add(label(s, 0, listY + 40, emptyMsg, 9, '#7d8a78', { align: 'center' }).setOrigin(0.5, 0));
    slice.forEach((e, j) => {
      const y = listY + j * pitch;
      const on = this.sel === e.key;
      const R = e.item ? RARITY[e.item.rarity] : null;
      const row = s.add.graphics(); c.add(row);
      row.fillStyle(on ? 0x2a3a1c : 0x0b0f0a, 1).fillRect(ox + 10, y, dw - 20, rowH);
      row.lineStyle(on ? 2 : 1, on ? 0xfff6c8 : (R ? R.tint : 0x5a5a3a), on ? 1 : 0.7).strokeRect(ox + 11, y + 1, dw - 22, rowH - 2);
      if (e.kind === 'potion') { if (s.textures.exists('hud.potion')) c.add(s.add.image(ox + 30, y + rowH / 2, 'hud.potion').setScale(1.5)); }
      else if (e.mat) c.add(s.add.image(ox + 30, y + rowH / 2, matIconKey(s, e.mat.id)).setScale(1.7));
      else if (e.item) addIcon(s, c, e.item, p.dyes[e.item.id], ox + 30, y + rowH / 2, 1.8);
      c.add(label(s, ox + 52, y + 4, e.name, 10, R ? R.color : '#e8e4cc', { fontStyle: 'bold' }));
      c.add(label(s, ox + 52, y + 19, e.sub || '', 7, e.bad ? '#d98a7a' : '#9fb0a0', { wordWrap: { width: dw - 150 } }));
      c.add(label(s, ox + dw - 20, y + rowH / 2, buying ? `${e.price}g` : `+${e.price}g`, 11, buying && p.gold < e.price ? '#ff8a7a' : GOLD, { fontStyle: 'bold' }).setOrigin(1, 0.5));
      const hit = s.add.rectangle(ox + dw / 2, y + rowH / 2, dw - 20, rowH, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      c.add(hit);
      hit.on('pointerdown', () => {
        const now = s.time.now;
        const dbl = this.lastClick.key === e.key && now - this.lastClick.t < 380;
        this.lastClick = { key: e.key, t: now };
        this.sel = e.key;
        if (dbl) { this.trade(e, 1); return; }
        audio.play('ui', 0.4); this.build();
      });
      hit.on('pointerover', (ptr) => { if (e.item) this.tip.show(itemLines(e.item, p.dyes[e.item.id], p, p.equipped[e.item.slot]), ptr.x, ptr.y); });
      hit.on('pointermove', (ptr) => { if (this.tip.c.visible) { const W2 = s.scale.width, b = this.tip.c.getBounds(); this.tip.c.setPosition(Math.max(4, ptr.x + 14 + b.width > W2 - 4 ? ptr.x - b.width - 10 : ptr.x + 14), Math.max(4, Math.min(ptr.y + 10, s.scale.height - b.height - 4))); } });
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
    const sel = all.find((e) => e.key === this.sel) || null;
    if (!sel) {
      c.add(label(s, ox + 20, dy + 10, buying ? 'Click an item to inspect it. Double-click to buy.' : 'Click an item to inspect it. Double-click to sell.', 8, '#7d8a78'));
    } else if (sel.item) {
      const item = sel.item, R2 = RARITY[item.rarity];
      c.add(label(s, ox + 20, dy + 8, item.name, 11, R2.color, { fontStyle: 'bold' }));
      c.add(label(s, ox + 20, dy + 23, `${R2.name} ${SLOT_LABEL[item.slot]} · Requires Lv ${item.lvl}${item.cls ? ` · ${item.cls.join('/')} only` : ''}`, 8, R2.color));
      c.add(label(s, ox + 20, dy + 37, statLine(item.stats), 9, '#9be88a', { wordWrap: { width: dw - 180 } }));
      c.add(label(s, ox + 20, dy + 52, item.desc || '', 8, '#b9b39a', { wordWrap: { width: dw - 180 } }));
    } else {
      c.add(label(s, ox + 20, dy + 10, sel.name, 11, '#e8e4cc', { fontStyle: 'bold' }));
      c.add(label(s, ox + 20, dy + 28, sel.desc || '', 8, '#b9b39a', { wordWrap: { width: dw - 180 } }));
      if (sel.mat) c.add(label(s, ox + 20, dy + 62, `${KINDS[sel.mat.kind]}${this.tab === 'mats' ? `   owned ${sel.n}` : ''}`, 8, '#8a9a8a'));
    }
    if (sel) {
      const ok = buying ? p.gold >= sel.price : true;
      const verb = buying ? (this.tab === 'back' ? 'BUY BACK' : 'BUY') : 'SELL';
      const btn = label(s, ox + dw - 26, dy + (this.tab === 'mats' && (sel.n || 0) > 1 ? 28 : detH / 2), `${verb}  ${buying ? '' : '+'}${sel.price}g`, 11, ok ? '#fff6c8' : '#ffb0a0', { backgroundColor: ok ? '#35451c' : '#5a2a26', padding: { x: 12, y: 8 }, fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
      btn.on('pointerdown', () => this.trade(sel, 1));
      c.add(btn);
      if (this.tab === 'mats' && (sel.n || 0) > 1) {
        const all2 = label(s, ox + dw - 26, dy + 64, `SELL ALL x${sel.n}  +${sel.price * sel.n}g`, 9, '#fff6c8', { backgroundColor: '#5a3a1a', padding: { x: 10, y: 6 }, fontStyle: 'bold' }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
        all2.on('pointerdown', () => this.trade(sel, sel.n));
        c.add(all2);
      }
    }
  }

  sellJunk() {
    const w = this.world, p = this.hooks.player();
    if (!w || !p) return;
    let total = 0, n = 0;
    for (const e of packList(w)) {
      if (e.m.kind !== 'junk') continue;
      const v = e.m.price * e.n;
      takeMat(w, e.id, e.n);
      pushBuyback(w.meta, { kind: 'mat', id: e.id, n: e.n, price: e.m.price });
      total += v; n += e.n;
    }
    if (!n) { this.hooks.say('No junk to sell.'); audio.play('error', 0.5); return; }
    p.gold += total;
    audio.play('coin');
    bus.emit(Events.ACH_EVENT, { k: 'sell', n });
    this.hooks.say(`Sold ${n} junk items (+${total}g).`);
    this.hooks.changed(); this.build();
  }

  trade(e, qty = 1) {
    const p = this.hooks.player(), w = this.world;
    if (!p || !w) return;
    const meta = w.meta;
    if (this.tab === 'buy') {
      if (p.gold < e.price) { audio.play('error', 0.7); this.hooks.say(`Not enough gold for ${e.name} (${e.price}g).`); return; }
      if (e.kind === 'potion') p.potions += 1;
      else if (e.kind === 'mat') { if (!addMat(w, e.mat.id, 1, { quiet: true })) return; }
      else {
        if (p.inventory.length >= BAG_SIZE) { audio.play('error', 0.7); this.hooks.say('Your bag is full — sell something first.'); return; }
        p.inventory.push(e.item.id);
      }
      p.gold -= e.price;
      audio.play('gold');
      this.hooks.say(`Bought ${e.name} (-${e.price}g).`);
    } else if (this.tab === 'sell') {
      const item = e.item;
      const i = p.inventory.indexOf(item.id);
      if (i < 0) return;
      p.inventory.splice(i, 1);
      p.gold += e.price;
      pushBuyback(meta, { kind: 'gear', id: item.id, n: 1, price: e.price });
      this.sel = null;
      audio.play('coin');
      bus.emit(Events.ACH_EVENT, { k: 'sell', n: 1 });
      this.hooks.say(`Sold ${item.name} (+${e.price}g).`);
    } else if (this.tab === 'mats') {
      const n = Math.min(qty, e.n);
      if (!takeMat(w, e.mat.id, n)) return;
      p.gold += e.price * n;
      pushBuyback(meta, { kind: 'mat', id: e.mat.id, n, price: e.price });
      if (n >= e.n) this.sel = null;
      audio.play('coin');
      bus.emit(Events.ACH_EVENT, { k: 'sell', n });
      this.hooks.say(`Sold ${e.mat.name}${n > 1 ? ` x${n}` : ''} (+${e.price * n}g).`);
    } else {
      const b = e.bb;
      const cost = e.price;
      if (p.gold < cost) { audio.play('error', 0.7); this.hooks.say(`Not enough gold to buy back (${cost}g).`); return; }
      if (b.kind === 'gear') {
        if (p.inventory.length >= BAG_SIZE) { audio.play('error', 0.7); this.hooks.say('Your bag is full.'); return; }
        p.inventory.push(b.id);
      } else if (!addMat(w, b.id, 1, { quiet: true })) return;
      p.gold -= cost;
      b.n -= 1;
      if (b.n <= 0) meta.buyback.splice(e.bbIndex, 1);
      this.sel = null;
      audio.play('gold');
      this.hooks.say(`Bought back ${(e.item || e.mat).name} (-${cost}g).`);
    }
    this.hooks.changed();
    this.build();
  }

  destroy() { this.close(); this.tip.destroy(); }
}
