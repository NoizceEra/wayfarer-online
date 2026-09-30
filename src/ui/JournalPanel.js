// Journal (L): Active / Available / Done / Lore / Bestiary / Codex / Feats.
// Generic list + detail layout; each tab supplies rows + a detail builder.
import { audio } from '../systems/audio.js';
import { bus, Events } from '../core/events.js';
import { ENEMY_TABLE } from '../data/jobs.js';
import { ZONES, AREAS } from '../data/zones.js';
import { gearById, GEAR, SLOT_LABEL, RARITY, statLine } from '../data/gear.js';
import { MATS, MAT_IDS, KINDS, MOB_MATS, matById } from '../data/materials.js';
import { CHAINS, LORE } from '../data/quests.js';
import { ACHIEVEMENTS } from '../systems/achievements.js';
import { matIconKey } from '../systems/matArt.js';
import { objText, rewardLines, MAX_ACTIVE, MAX_TRACKED } from '../systems/questSystem.js';
import { RECIPES } from '../systems/crafting.js';
import { GOLD, label, box, addIcon } from './gearUI.js';

const TABS = [
  ['active', 'Active'], ['avail', 'Available'], ['done', 'Done'], ['lore', 'Lore'], ['best', 'Bestiary'], ['codex', 'Codex'], ['feats', 'Feats'],
];
const zoneName = (id) => ZONES.find((z) => z.id === id)?.name || AREAS[id]?.name || id || '?';

export class JournalPanel {
  // hooks: { world() }
  constructor(scene, hooks) {
    this.scene = scene; this.hooks = hooks;
    this.open = false; this.tab = 'active'; this.sel = null; this.page = 0; this.confirm = null;
    this.onWheel = (p, objs, dx, dy) => { if (this.open) { this.page = Math.max(0, this.page + (dy > 0 ? 1 : -1)); this.build(); } };
    this.off = bus.on(Events.JOURNAL, (m) => {
      if (m.open === 'toggle' || m.open === undefined) this.toggle();
      else this.toggle(!!m.open, m.tab);
    });
    this.off2 = bus.on(Events.QUEST_CHANGED, () => { if (this.open) this.build(); });
  }
  get isOpen() { return this.open; }
  get w() { return this.hooks.world(); }

  toggle(force, tab) {
    const want = force !== undefined ? force : !this.open;
    if (tab) { this.tab = tab; this.sel = null; this.page = 0; }
    if (want === this.open) { if (want && tab) this.build(); return; }
    if (want && this.scene.chatBlocked?.()) return;
    this.open = want;
    const w = this.w;
    if (want) {
      if (!w?.quests) { this.open = false; return; }
      this.confirm = null;
      this.build();
      this.scene.input.on('wheel', this.onWheel);
    } else {
      this.scene.input.off('wheel', this.onWheel);
      this.c?.destroy(); this.c = null;
    }
    this.scene.syncRaise?.();
    if (w) w.uiModal = want || !!(this.scene.equip?.isOpen || this.scene.shop?.isOpen || this.scene.craftPanel?.isOpen);
  }
  close() { this.toggle(false); }
  resize() { if (this.open) this.build(); }
  destroy() { this.off?.(); this.off2?.(); this.c?.destroy(); this.scene.input.off('wheel', this.onWheel); }

  // ——— tab data ———
  tabRows() {
    const w = this.w, q = w.quests, meta = w.meta;
    switch (this.tab) {
      case 'active': {
        const ids = q.activeIds();
        const rows = ids.map((id) => {
          const d = q.def(id), ready = q.isReady(id);
          return { key: id, title: d.name, sub: ready ? `Turn in: ${q.turnNpc(d)}` : `${Math.round(q.pct(id) * 100)}%  ${d.chain ? CHAINS[d.chain].name : d.repeat ? 'Bounty' : 'Quest'}`, color: ready ? '#9be88a' : '#e8e4cc', badge: q.s.tracked.includes(id) ? '>' : ready ? '?' : '' };
        });
        rows.unshift({ head: `Active ${ids.length}/${MAX_ACTIVE}   Tracked ${q.s.tracked.length}/${MAX_TRACKED}` });
        return rows;
      }
      case 'avail': {
        const avail = q.available(), locked = q.lockedList();
        const rows = [{ head: 'Ready to accept' }];
        if (!avail.length) rows.push({ note: 'Nothing right now. Explore, talk to townsfolk!' });
        for (const d of avail) rows.push({ key: d.id, title: d.name, sub: `${d.giver} - ${zoneName(d.zone)}`, color: '#ffd84a', badge: '!' });
        const bl = q.offeredBounties().filter((b) => q.bountyStatus(b) === 'offer');
        if (bl.length) rows.push({ head: 'Notice board (Thistle Town)' });
        for (const b of bl) rows.push({ key: `b:${b.tpl}`, title: b.name, sub: `Bounty - ${zoneName(b.zone)}`, color: '#ffb04a', badge: '$', bounty: b });
        rows.push({ head: `Locked (${locked.length})` });
        for (const d of locked.slice(0, 40)) rows.push({ key: d.id, title: d.name, sub: q.levelOk(d) ? 'Finish the previous quest' : `Needs level ${Math.max(1, d.lv - 1)}`, color: '#7d8a78', badge: 'x' });
        return rows;
      }
      case 'done': {
        const list = q.doneList().sort((a, z) => (meta.quests.done[z.id] || 0) - (meta.quests.done[a.id] || 0));
        if (!list.length) return [{ note: 'No quests completed yet.' }];
        return list.map((d) => ({ key: d.id, title: d.name, sub: d.chain ? CHAINS[d.chain].name : 'Quest', color: '#b9c8a8', badge: 'v' }));
      }
      case 'lore': {
        const ids = Object.keys(LORE);
        const got = ids.filter((id) => meta.lore[id]);
        const rows = [{ head: `Pages found ${got.length}/${ids.length}` }];
        for (const id of ids) rows.push(meta.lore[id] ? { key: id, title: LORE[id].name, sub: '', color: '#d8c8ff' } : { key: id, title: '???', sub: 'Undiscovered', color: '#5d6a5a', locked: true });
        return rows;
      }
      case 'best': {
        const ids = Object.keys(ENEMY_TABLE);
        const seen = ids.filter((id) => meta.bestiary[id]?.kills > 0);
        const rows = [{ head: `Species ${seen.length}/${ids.length}` }];
        for (const id of ids) {
          const b = meta.bestiary[id];
          rows.push(b?.kills > 0 ? { key: id, title: ENEMY_TABLE[id].name, sub: `Defeated ${b.kills}`, color: '#e8e4cc', icon: `mon:${id}` } : { key: id, title: '???', sub: 'Not yet defeated', color: '#5d6a5a', locked: true });
        }
        return rows;
      }
      case 'codex': {
        const gearIds = Object.keys(meta.codex.gear).filter((id) => gearById(id));
        const rows = [{ head: `Materials ${MAT_IDS.filter((id) => meta.codex.mats[id]).length}/${MAT_IDS.length}` }];
        for (const id of MAT_IDS) rows.push(meta.codex.mats[id] ? { key: `m:${id}`, title: MATS[id].name, sub: KINDS[MATS[id].kind], color: '#e8e4cc', icon: `mat:${id}` } : { key: `m:${id}`, title: '???', sub: '', color: '#5d6a5a', locked: true });
        rows.push({ head: `Gear seen ${gearIds.length}` });
        for (const id of gearIds) { const g = gearById(id); rows.push({ key: `g:${id}`, title: g.name, sub: `${SLOT_LABEL[g.slot]} - ${RARITY[g.rarity].name}`, color: RARITY[g.rarity].color, icon: `gear:${id}` }); }
        return rows;
      }
      case 'feats': {
        const a = w.ach;
        const rows = [{ head: `Unlocked ${a.count()}/${ACHIEVEMENTS.length}` }];
        for (const x of ACHIEVEMENTS) {
          const on = !!meta.ach[x.id];
          const pr = a.progress(x);
          rows.push({ key: x.id, title: x.name, sub: on ? 'Unlocked' : `${pr.cur}/${pr.need}`, color: on ? '#ffd84a' : '#9aa89a', badge: on ? '*' : '' });
        }
        return rows;
      }
      default: return [];
    }
  }

  detail(row) {
    const w = this.w, q = w.quests, meta = w.meta;
    const L = [], acts = [];
    const add = (t, c = '#b9b39a', s = 8, b = false) => L.push({ t, c, s, b });
    const questDetail = (d, id) => {
      add(d.name, '#fff6c8', 11, true);
      if (d.chain) add(CHAINS[d.chain].name, '#c8a8ff', 8);
      else if (d.repeat) add('Daily bounty', '#ffb04a', 8);
      add(`Giver: ${d.giver}${q.turnNpc(d) !== d.giver ? `   Turn in: ${q.turnNpc(d)}` : ''}`, '#e8e4cc', 8);
      add(`Zone: ${zoneName(d.zone)}   Level ${d.lv}+`, '#9fb0a0', 8);
      add('');
      add(d.story, '#d8d0b0', 8);
      add('');
      add('OBJECTIVES', '#ffd84a', 8, true);
      const act = q.isActive(id);
      d.obj.forEach((o, i) => {
        const p = act ? q.prog(id, i) : null;
        const cnt = o.n > 1 ? ` ${p ? p.cur : 0}/${o.n}` : p?.done ? ' (done)' : '';
        add(`${p?.done ? '[x]' : '[ ]'} ${objText(o)}${cnt}`, p?.done ? '#9be88a' : '#e8e4cc', 9);
      });
      add('');
      add('REWARDS', '#ffd84a', 8, true);
      add(rewardLines(d.reward).join(', ') || '-', '#9be88a', 9);
      if (d.choices) add(`Plus a choice: ${d.choices.map((c) => c.label).join(' / ')}`, '#b9b39a', 8);
      if (act && q.isReady(id)) add(`Ready! Return to ${q.turnNpc(d)}.`, '#9be88a', 10, true);
    };
    if (!row || row.head || row.note) { add(this.tab === 'active' ? 'No active quest selected.\nPress L to close. Talk to townsfolk with a ! over their head.' : 'Select an entry on the left.', '#7d8a78', 9); return { L, acts }; }
    switch (this.tab) {
      case 'active': {
        const d = q.def(row.key); if (!d) break;
        questDetail(d, row.key);
        const tr = q.s.tracked.includes(row.key);
        acts.push({ label: tr ? 'Untrack' : 'Track on HUD', cb: () => { q.track(row.key); } });
        const conf = this.confirm === row.key;
        acts.push({ label: conf ? 'Really abandon?' : 'Abandon', color: '#7b2d26', cb: () => { if (conf) { q.abandon(row.key); this.sel = null; this.confirm = null; } else { this.confirm = row.key; this.build(); } } });
        break;
      }
      case 'avail': {
        if (row.bounty) {
          const b = row.bounty;
          add(b.name, '#fff6c8', 11, true); add('Daily bounty', '#ffb04a', 8);
          add(`Zone: ${zoneName(b.zone)}`, '#9fb0a0', 8); add(''); add(b.offer, '#d8d0b0', 9); add('');
          add('REWARDS', '#ffd84a', 8, true); add(rewardLines(b.reward).join(', '), '#9be88a', 9); add('');
          add('Accept it at the notice board in Thistle Town.', '#e8e4cc', 8);
          break;
        }
        const d = q.def(row.key); if (!d) break;
        questDetail(d, row.key);
        if (q.status(row.key) === 'locked') { add(''); add(q.levelOk(d) ? `Requires: ${d.pre.map((p) => q.def(p)?.name).join(', ')}` : `Requires level ${Math.max(1, d.lv - 1)}`, '#ff8a7a', 9); }
        else { add(''); add(`Talk to ${d.giver} to accept.`, '#ffd84a', 9); }
        break;
      }
      case 'done': { const d = q.def(row.key); if (d) questDetail(d, row.key); break; }
      case 'lore': { const l = LORE[row.key]; if (l && !row.locked) { add(l.name, '#e0d0ff', 11, true); add(''); add(l.text, '#d8d0b0', 9); } else add('Undiscovered. Explore new zones and finish questlines.', '#7d8a78', 9); break; }
      case 'best': {
        if (row.locked) { add('Defeat this monster to record it.', '#7d8a78', 9); break; }
        const e = ENEMY_TABLE[row.key], b = meta.bestiary[row.key] || { kills: 0, drops: {} };
        add(e.name, '#fff6c8', 11, true);
        add(`Defeated: ${b.kills}`, '#e8e4cc', 9);
        add(`Found in: ${(e.zones || []).map(zoneName).join(', ') || '?'}`, '#9fb0a0', 8);
        add(`HP ${e.hp}   ATK ${e.atk}   XP ${e.xp}   Gold ${e.gold[0]}-${e.gold[1]}`, '#e8e4cc', 8);
        add(''); add('DROPS', '#ffd84a', 8, true);
        const all = new Set();
        for (const d of e.drops || []) all.add(d.id);
        for (const g of Object.values(GEAR)) if (g.drop?.enemies?.includes(row.key)) all.add(g.id);
        for (const d of MOB_MATS[row.key] || []) all.add(d.id);
        const seen = Object.keys(b.drops || {});
        for (const id of seen) add(`- ${(gearById(id) || matById(id))?.name || id}`, '#9be88a', 9);
        const hidden = [...all].filter((id) => !seen.includes(id)).length;
        if (hidden) add(`- ${hidden} unknown drop${hidden > 1 ? 's' : ''} (???)`, '#5d6a5a', 9);
        if (!all.size && !seen.length) add('- none known', '#5d6a5a', 9);
        break;
      }
      case 'codex': {
        if (row.locked) { add('Discover this material to record it.', '#7d8a78', 9); break; }
        if (row.key.startsWith('m:')) {
          const m = MATS[row.key.slice(2)];
          add(m.name, '#fff6c8', 11, true); add(`${KINDS[m.kind]}`, '#9fb0a0', 8); add(m.desc, '#d8d0b0', 9);
          add(m.price ? `Sells for ${m.price}g` : 'Quest item (not for sale)', GOLD, 9);
          const uses = RECIPES.filter((r) => r.in?.[m.id] || r.inAny?.ids.includes(m.id)).map((r) => r.name);
          if (uses.length) { add(''); add('USED IN', '#ffd84a', 8, true); add(uses.join(', '), '#e8e4cc', 8); }
          const mk = RECIPES.filter((r) => r.out?.[m.id]).map((r) => `${r.name} (${r.station})`);
          if (mk.length) { add(''); add('CRAFTED AT', '#ffd84a', 8, true); add(mk.join(', '), '#e8e4cc', 8); }
          add(`In pack: ${meta.mats[m.id] || 0}`, '#9be88a', 8);
        } else {
          const g = gearById(row.key.slice(2));
          add(g.name, RARITY[g.rarity].color, 11, true); add(`${RARITY[g.rarity].name} ${SLOT_LABEL[g.slot]}  Lv ${g.lvl}`, '#9fb0a0', 8);
          add(statLine(g.stats), '#9be88a', 9); if (g.desc) add(g.desc, '#d8d0b0', 8);
          if (meta.upg[g.id]) add(`Tempered +${meta.upg[g.id]}`, '#ffb04a', 9);
        }
        break;
      }
      case 'feats': {
        const a = ACHIEVEMENTS.find((x) => x.id === row.key); if (!a) break;
        const on = meta.ach[a.id];
        add(a.name, on ? '#ffd84a' : '#e8e4cc', 11, true); add(a.desc, '#d8d0b0', 9);
        const p = w.ach.progress(a);
        add(on ? `Unlocked ${new Date(on).toLocaleDateString()}` : `Progress ${p.cur}/${p.need}`, on ? '#9be88a' : '#9fb0a0', 9);
        break;
      }
      default: break;
    }
    return { L, acts };
  }

  // ——— drawing ———
  build() {
    const s = this.scene, w = this.w;
    if (!w?.quests) return;
    this.c?.destroy();
    const W = s.scale.width, H = s.scale.height;
    const wide = W / H > 1.0 && W >= 640;
    const dw = wide ? 640 : 380, dh = wide ? 440 : 620;
    const k = Math.min(1, (W - 8) / dw, (H - 8) / dh);
    const c = s.add.container(W / 2, H / 2).setDepth(186).setScale(k);
    this.c = c;
    const ox = -dw / 2, oy = -dh / 2;
    c.add(box(s, ox, oy, dw, dh, 0x10140f, 0.985, 0xc8a840, 3));
    c.add(label(s, ox + 14, oy + 11, 'JOURNAL', 13, GOLD, { fontStyle: 'bold' }));
    c.add(label(s, ox + 110, oy + 15, `Quests ${w.quests.activeCount()}/${MAX_ACTIVE}   Feats ${w.ach.count()}/${ACHIEVEMENTS.length}   L to close`, 7, '#7d8a78'));
    const x = label(s, ox + dw - 14, oy + 10, 'X', 12, '#ffe0d0', { backgroundColor: '#7b2d26', padding: { x: 7, y: 3 } }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    x.on('pointerdown', () => { audio.play('ui', 0.6); this.close(); });
    c.add(x);
    // tabs (two rows on narrow)
    let tx = ox + 12, ty = oy + 38;
    for (const [id, name] of TABS) {
      const on = this.tab === id;
      const b = label(s, tx, ty, name, 9, on ? '#fff6c8' : '#b9b39a', { backgroundColor: on ? '#5a4a1a' : '#2a2210', padding: { x: 7, y: 4 } }).setInteractive({ useHandCursor: true });
      if (tx + b.width > ox + dw - 10) { tx = ox + 12; ty += 24; b.setPosition(tx, ty); }
      b.on('pointerdown', () => { if (this.tab !== id) { this.tab = id; this.sel = null; this.page = 0; this.confirm = null; audio.play('ui', 0.5); this.build(); } });
      c.add(b); tx += b.width + 4;
    }
    const top = ty + 28;
    const listW = wide ? 222 : dw - 24, listH = wide ? dh - (top - oy) - 12 : 232;
    const detX = wide ? ox + 12 + listW + 8 : ox + 12, detY = wide ? top : top + listH + 8;
    const detW = wide ? dw - 24 - listW - 8 : dw - 24, detH = wide ? listH : dh - (detY - oy) - 12;
    this.drawList(c, ox + 12, top, listW, listH);
    this.drawDetail(c, detX, detY, detW, detH);
  }

  drawList(c, x, y, w, h) {
    const s = this.scene;
    c.add(box(s, x, y, w, h, 0x0b0f0a, 0.95, 0x3a3a2a, 1));
    const rows = this.tabRows();
    const pitch = 26, per = Math.max(3, Math.floor((h - 26) / pitch));
    const pages = Math.max(1, Math.ceil(rows.length / per));
    this.page = Math.min(this.page, pages - 1);
    // keep selection valid; auto-select first selectable
    if (this.sel == null || !rows.some((r) => r.key === this.sel)) this.sel = rows.find((r) => r.key)?.key ?? null;
    const slice = rows.slice(this.page * per, this.page * per + per);
    slice.forEach((r, j) => {
      const ry = y + 4 + j * pitch;
      if (r.head) { c.add(label(s, x + 8, ry + 6, r.head.toUpperCase(), 7, '#ffd84a')); return; }
      if (r.note) { c.add(label(s, x + 8, ry + 6, r.note, 8, '#7d8a78', { wordWrap: { width: w - 16 } })); return; }
      const on = this.sel === r.key;
      const g = s.add.graphics(); c.add(g);
      g.fillStyle(on ? 0x2a3a1c : 0x0f140e, 1).fillRect(x + 4, ry, w - 8, pitch - 3);
      g.lineStyle(on ? 2 : 1, on ? 0xfff6c8 : 0x3a3a2a, 1).strokeRect(x + 5, ry + 1, w - 10, pitch - 5);
      let lx = x + 10;
      if (r.icon) {
        const [kind, id] = r.icon.split(':');
        let im = null;
        if (kind === 'mat') { im = s.add.image(lx + 8, ry + pitch / 2 - 1, matIconKey(s, id)); im.setScale(1.1); }
        else if (kind === 'gear') { const it = gearById(id); if (it) im = addIcon(s, c, it, null, lx + 8, ry + pitch / 2 - 1, 1.1); }
        else if (kind === 'mon') {
          const key = `mon.${ENEMY_TABLE[id].sprite}`;
          if (s.textures.exists(key)) { im = s.add.image(lx + 8, ry + pitch / 2 - 1, key, 0); im.setScale(Math.min(1, 16 / Math.max(im.width, 1)) * 1.0); }
        }
        if (im) { if (kind !== 'gear') c.add(im); if (r.locked) im.setTint(0x000000); }
        lx += 20;
      } else if (r.badge) { c.add(label(s, lx + 2, ry + 5, r.badge, 11, r.color, { fontStyle: 'bold' })); lx += 14; }
      c.add(label(s, lx, ry + 3, r.title, 9, r.color, { fontStyle: 'bold', fixedWidth: w - (lx - x) - 10 }));
      if (r.sub) c.add(label(s, lx, ry + 14, r.sub, 6, '#8a9a8a', { fixedWidth: w - (lx - x) - 10 }));
      const hit = s.add.rectangle(x + w / 2, ry + pitch / 2 - 1, w - 8, pitch - 3, 0xffffff, 0.001).setInteractive({ useHandCursor: true });
      hit.on('pointerdown', () => { this.sel = r.key; this.confirm = null; audio.play('ui', 0.4); this.build(); });
      c.add(hit);
    });
    if (pages > 1) {
      const py = y + h - 18;
      const pb = (txt, px, fn) => { const b = label(s, x + w / 2 + px, py, txt, 10, '#e8e4cc', { backgroundColor: '#2a2210', padding: { x: 7, y: 1 } }).setOrigin(0.5, 0).setInteractive({ useHandCursor: true }); b.on('pointerdown', () => { audio.play('ui', 0.4); fn(); this.build(); }); c.add(b); };
      pb('<', -50, () => { this.page = (this.page + pages - 1) % pages; });
      pb('>', 50, () => { this.page = (this.page + 1) % pages; });
      c.add(label(s, x + w / 2, py + 3, `${this.page + 1}/${pages}`, 8, '#b9b39a').setOrigin(0.5, 0));
    }
    this._rows = rows;
  }

  drawDetail(c, x, y, w, h) {
    const s = this.scene;
    c.add(box(s, x, y, w, h, 0x0b0f0a, 0.95, 0x3a3a2a, 1));
    const row = (this._rows || []).find((r) => r.key === this.sel);
    const { L, acts } = this.detail(row);
    let yy = y + 8;
    const limit = y + h - (acts.length ? 34 : 8);
    for (const l of L) {
      if (l.t === '') { yy += 5; continue; }
      const t = label(s, x + 10, yy, l.t, l.s || 9, l.c, { wordWrap: { width: w - 20 }, fontStyle: l.b ? 'bold' : 'normal', lineSpacing: 2 });
      if (yy + t.height > limit) { t.destroy(); c.add(label(s, x + 10, limit - 10, '...', 9, '#7d8a78')); break; }
      c.add(t); yy += t.height + 3;
    }
    let ax = x + 10;
    acts.forEach((a) => {
      const b = label(s, ax, y + h - 28, a.label, 9, '#fff6c8', { backgroundColor: a.color || '#35451c', padding: { x: 9, y: 5 }, fontStyle: 'bold' }).setInteractive({ useHandCursor: true });
      b.on('pointerdown', () => { audio.play('ui', 0.6); a.cb(); this.build(); });
      c.add(b); ax += b.width + 8;
    });
  }
}
