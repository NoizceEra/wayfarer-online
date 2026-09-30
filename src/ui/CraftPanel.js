// Crafting panel (U, or E at a station): Alchemy / Campfire / Anvil recipe
// lists with station requirement, ingredient check, gold fee and craft timer,
// plus a Pack tab to use consumables. Unknown recipes show as ??? until found.
import { audio } from '../systems/audio.js';
import { bus, Events } from '../core/events.js';
import { RECIPES, STATIONS, MAX_UPGRADE, upgradeBonus } from '../systems/crafting.js';
import { matById, KINDS } from '../data/materials.js';
import { useMat, packList, matCount } from '../systems/pack.js';
import { matIconKey } from '../systems/matArt.js';
import { GOLD, label, box } from './gearUI.js';

const TABS = [['alchemy', 'Alchemy'], ['campfire', 'Campfire'], ['anvil', 'Anvil'], ['pack', 'Pack']];

export class CraftPanel {
  constructor(scene, hooks) {
    this.scene = scene; this.hooks = hooks;
    this.open = false; this.tab = 'alchemy'; this.sel = null; this.page = 0;
    this.off = bus.on(Events.CRAFT, (m) => {
      if (m.open === 'toggle' || (m.open === undefined && !m.changed && !m.tick)) return this.toggle();
      if (m.open !== undefined) return this.toggle(!!m.open, m.station);
      if (m.changed && this.open) this.build();
    });
    this.off2 = bus.on(Events.GEAR, (m) => { if (m.changed && this.open && this.tab === 'pack') this.build(); });
  }
  get isOpen() { return this.open; }
  get w() { return this.hooks.world(); }

  toggle(force, station) {
    const want = force !== undefined ? force : !this.open;
    if (want && station) { this.tab = station; this.sel = null; this.page = 0; }
    if (want === this.open) { if (want) this.build(); return; }
    const w = this.w;
    this.open = want;
    if (want) {
      if (!w?.craft) { this.open = false; return; }
      if (!station) { const n = w.craft.nearest(); if (n) { this.tab = n.type; this.sel = null; } }
      this.build();
    } else { this.c?.destroy(); this.c = null; this.bar = null; }
    this.scene.syncRaise?.();
    if (w) w.uiModal = want || !!(this.scene.equip?.isOpen || this.scene.shop?.isOpen || this.scene.journal?.isOpen);
  }
  close() { this.toggle(false); }
  resize() { if (this.open) this.build(); }
  destroy() { this.off?.(); this.off2?.(); this.c?.destroy(); }

  rows() {
    const w = this.w, cr = w.craft;
    if (this.tab === 'pack') return packList(w).map((e) => ({ key: e.id, m: e.m, n: e.n }));
    return RECIPES.filter((r) => r.station === this.tab).map((r) => ({ key: r.id, r, known: cr.known(r.id) }));
  }

  build() {
    const s = this.scene, w = this.w;
    if (!w?.craft) return;
    this.c?.destroy();
    const W = s.scale.width, H = s.scale.height;
    const wide = W / H > 1.0 && W >= 640;
    const dw = wide ? 600 : 380, dh = wide ? 420 : 600;
    const k = Math.min(1, (W - 8) / dw, (H - 8) / dh);
    const c = s.add.container(W / 2, H / 2).setDepth(186).setScale(k);
    this.c = c;
    const ox = -dw / 2, oy = -dh / 2;
    const p = w.player, cr = w.craft;
    c.add(box(s, ox, oy, dw, dh, 0x10140f, 0.985, 0xc8a840, 3));
    c.add(label(s, ox + 14, oy + 11, 'CRAFTING', 13, GOLD, { fontStyle: 'bold' }));
    c.add(label(s, ox + 120, oy + 15, `Gold ${p.gold}g   U to close`, 8, '#ffe27a'));
    const x = label(s, ox + dw - 14, oy + 10, 'X', 12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.6); this.close(); });
    c.add(x);
    let tx = ox + 12;
    for (const [id, name] of TABS) {
      const on = this.tab === id;
      const near = id !== 'pack' && cr.near(id);
      const b = label(s, tx, oy + 38, name + (near ? ' *' : ''), 9, on ? '#fff6c8' : '#b9b39a', { backgroundColor: on ? '#5a4a1a' : '#2a2210', padding: { x: 9, y: 4 } }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { if (this.tab !== id) { this.tab = id; this.sel = null; this.page = 0; audio.play('ui', 0.5); this.build(); } });
      c.add(b); tx += b.width + 4;
    }
    c.add(label(s, ox + dw - 14, oy + 43, '* = station in reach', 7, '#7d8a78').setOrigin(1, 0));
    const top = oy + 70;
    const listW = wide ? 240 : dw - 24, listH = wide ? dh - 82 : 230;
    const detX = wide ? ox + 12 + listW + 8 : ox + 12, detY = wide ? top : top + listH + 8;
    const detW = wide ? dw - 24 - listW - 8 : dw - 24, detH = wide ? listH : dh - (detY - oy) - 12;
    this.drawList(c, ox + 12, top, listW, listH);
    this.drawDetail(c, detX, detY, detW, detH);
  }

  drawList(c, x, y, w, h) {
    const s = this.scene;
    c.add(box(s, x, y, w, h, 0x0b0f0a, 0.95, 0x3a3a2a, 1));
    const rows = this.rows();
    const pitch = 30, per = Math.max(3, Math.floor((h - 24) / pitch));
    const pages = Math.max(1, Math.ceil(rows.length / per));
    this.page = Math.min(this.page, pages - 1);
    if (!rows.some((r) => r.key === this.sel)) this.sel = rows[0]?.key ?? null;
    if (!rows.length) c.add(label(s, x + w / 2, y + 40, this.tab === 'pack' ? 'Your pack is empty.\nGather herbs, ore, fish...' : 'No recipes here.', 9, '#7d8a78', { align: 'center' }).setOrigin(0.5, 0));
    rows.slice(this.page * per, this.page * per + per).forEach((r, j) => {
      const ry = y + 4 + j * pitch, on = this.sel === r.key;
      const g = s.add.graphics(); c.add(g);
      g.fillStyle(on ? 0x2a3a1c : 0x0f140e, 1).fillRect(x + 4, ry, w - 8, pitch - 3);
      g.lineStyle(on ? 2 : 1, on ? 0xfff6c8 : 0x3a3a2a, 1).strokeRect(x + 5, ry + 1, w - 10, pitch - 5);
      if (this.tab === 'pack') {
        const im = s.add.image(x + 20, ry + pitch / 2 - 1, matIconKey(s, r.m.id)).setScale(1.4); c.add(im);
        c.add(label(s, x + 36, ry + 4, r.m.name, 9, r.m.use ? '#9be88a' : '#e8e4cc', { fontStyle: 'bold' }));
        c.add(label(s, x + 36, ry + 16, KINDS[r.m.kind], 6, '#8a9a8a'));
        c.add(label(s, x + w - 12, ry + pitch / 2 - 1, `x${r.n}`, 10, '#ffe27a', { fontStyle: 'bold' }).setOrigin(1, 0.5));
      } else {
        const rc = r.r;
        const out = rc.upgrade ? null : matById(Object.keys(rc.out)[0]);
        if (out && r.known) c.add(s.add.image(x + 20, ry + pitch / 2 - 1, matIconKey(s, out.id)).setScale(1.4));
        else c.add(label(s, x + 14, ry + 5, r.known ? '+' : '?', 14, r.known ? '#ffb04a' : '#5d6a5a', { fontStyle: 'bold' }));
        const have = r.known && cr(this).haveAll(rc);
        c.add(label(s, x + 36, ry + 4, r.known ? rc.name : '???', 9, r.known ? (have ? '#9be88a' : '#e8e4cc') : '#5d6a5a', { fontStyle: 'bold' }));
        c.add(label(s, x + 36, ry + 16, r.known ? (have ? 'Ready to craft' : 'Missing materials') : 'Undiscovered', 6, '#8a9a8a'));
      }
      const hit = s.add.rectangle(x + w / 2, ry + pitch / 2 - 1, w - 8, pitch - 3, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.sel = r.key; audio.play('ui', 0.4); this.build(); });
      c.add(hit);
    });
    if (pages > 1) {
      const py = y + h - 18;
      const pb = (txt, px, fn) => { const b = label(s, x + w / 2 + px, py, txt, 10, '#e8e4cc', { backgroundColor: '#2a2210', padding: { x: 7, y: 1 } }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }); b.on('pointerdown', () => { audio.play('ui', 0.4); fn(); this.build(); }); c.add(b); };
      pb('<', -50, () => { this.page = (this.page + pages - 1) % pages; });
      pb('>', 50, () => { this.page = (this.page + 1) % pages; });
      c.add(label(s, x + w / 2, py + 3, `${this.page + 1}/${pages}`, 8, '#b9b39a').setOrigin(0.5, 0));
    }
  }

  drawDetail(c, x, y, w, h) {
    const s = this.scene, wd = this.w, cr = wd.craft;
    c.add(box(s, x, y, w, h, 0x0b0f0a, 0.95, 0x3a3a2a, 1));
    const row = this.rows().find((r) => r.key === this.sel);
    let yy = y + 8;
    const T = (t, col = '#b9b39a', sz = 9, bold = false) => { const o = label(s, x + 10, yy, t, sz, col, { wordWrap: { width: w - 20 }, fontStyle: bold ? 'bold' : 'normal', lineSpacing: 2 }); c.add(o); yy += o.height + 4; return o; };
    // crafting-in-progress strip (always visible when a job runs)
    const job = cr.job;
    if (job) {
      T(`Crafting ${job.r.name}...`, '#ffd84a', 10, true);
      c.add(s.add.rectangle(x + 10, yy, w - 20, 9, 0x16210f).setOrigin(0, 0).setStrokeStyle(1, 0x5a7a3a));
      this.bar = s.add.rectangle(x + 11, yy + 1, 1, 7, 0x9bbc0f).setOrigin(0, 0);
      this.barMax = w - 22;
      c.add(this.bar); yy += 16;
      const b = label(s, x + 10, yy, 'Cancel', 9, '#fff', { backgroundColor: '#7b2d26', padding: { x: 9, y: 4 } }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { audio.play('ui', 0.5); cr.cancel(); });
      c.add(b); yy += 26;
    } else this.bar = null;
    if (!row) { T('Select an entry on the left.', '#7d8a78'); return; }
    if (this.tab === 'pack') {
      const m = row.m;
      T(m.name, '#fff6c8', 11, true); T(`${KINDS[m.kind]}   x${row.n}`, '#9fb0a0', 8); T(m.desc, '#d8d0b0', 9);
      T(m.price ? `Vendors pay ${m.price}g each.` : 'Quest item: cannot be sold.', GOLD, 8);
      if (m.use) {
        const b = label(s, x + 10, y + h - 30, 'USE', 11, '#fff6c8', { backgroundColor: '#35451c', padding: { x: 16, y: 6 }, fontStyle: 'bold' }).setInteractive({ useHandCursor: true });
        b.on('pointerdown', () => { useMat(wd, m.id); this.build(); });
        c.add(b);
      }
      return;
    }
    const r = row.r;
    if (!row.known) { T('???', '#5d6a5a', 12, true); T('You have not discovered this recipe.\nFind it through quests, scroll drops from monsters, or by gathering new materials.', '#8a9a8a', 9); return; }
    T(r.name, '#fff6c8', 12, true);
    const st = STATIONS[r.station];
    const near = cr.near(r.station);
    T(`Station: ${st.name} ${near ? '(in reach)' : '(go to one!)'}`, near ? '#9be88a' : '#ff8a7a', 9);
    T(r.desc || '', '#d8d0b0', 9);
    const need = cr.needs(r);
    T('');
    T('INGREDIENTS', '#ffd84a', 8, true);
    for (const [id, n] of Object.entries(need.in)) { const have = matCount(wd, id); T(`${have >= n ? '[x]' : '[ ]'} ${matById(id).name} ${have}/${n}`, have >= n ? '#9be88a' : '#ff8a7a', 9); }
    if (r.inAny) { let have = 0; for (const id of r.inAny.ids) have += matCount(wd, id); T(`${have >= r.inAny.n ? '[x]' : '[ ]'} Any fish ${Math.min(have, 99)}/${r.inAny.n}`, have >= r.inAny.n ? '#9be88a' : '#ff8a7a', 9); }
    T(`Fee: ${need.fee}g     Time: ${r.time}s`, wd.player.gold >= need.fee ? '#ffe27a' : '#ff8a7a', 9);
    if (r.upgrade) {
      const lv = need.lv;
      T(need.target ? `Target: ${need.target.name}  +${lv}${lv < MAX_UPGRADE ? ` -> +${lv + 1}` : ' (max)'}` : 'Equip something in that slot first.', need.target ? '#ffb04a' : '#ff8a7a', 9);
      if (need.target && lv < MAX_UPGRADE) { const b = upgradeBonus(r.upgrade, 1); T(`Each level: ${Object.entries(b).map(([kk, v]) => `+${v} ${kk.toUpperCase()}`).join(' ')}`, '#9be88a', 8); }
    } else {
      const outs = Object.entries(r.out).map(([id, n]) => `${matById(id).name}${n > 1 ? ` x${n}` : ''}`).join(', ');
      T(`Makes: ${outs}`, '#9be88a', 9);
    }
    const chk = cr.check(r);
    if (!chk.ok && !job) T(chk.reason, '#ff8a7a', 8);
    const btn = label(s, x + w - 14, y + h - 30, job ? 'BUSY' : 'CRAFT', 11, chk.ok ? '#fff6c8' : '#ffb0a0', { backgroundColor: chk.ok ? '#35451c' : '#5a2a26', padding: { x: 16, y: 7 }, fontStyle: 'bold' }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    btn.on('pointerdown', () => { if (cr.start(r)) this.build(); else audio.play('error', 0.5); });
    c.add(btn);
  }

  update() {
    if (!this.open) return;
    const cr = this.w?.craft;
    if (this.bar && cr?.job) this.bar.width = Math.max(1, Math.min(1, cr.job.t / cr.job.dur) * (this.barMax || 1));
  }
}
const cr = (panel) => panel.w.craft;
