import { econ, isTradable } from '../net/economyNet.js';
import { bus, Events } from '../core/events.js';
import { gearById, SLOTS, SLOT_LABEL, RARITY } from '../data/gear.js';
import { el, escapeHtml, panel, tabs, chip, iconUrl, rarityColor, itemName, itemTitle, fmtLeft, offlineNote } from './econDom.js';

// Market board (DOM): one server-wide auction board, reached from the
// notice-board clerks in Thistle Town and Dock Town. BROWSE (search, slot,
// rarity, price range, sort, pages, Buy now), SELL (pick a bag item, price,
// duration; 5% listing fee is a gold sink), MINE (your listings, Cancel).
// Sold items pay out by mail; unsold listings come back by mail on expiry.
export class MarketPanel {
  constructor() {
    const { p, title } = panel('ec-market ec-wide', 'MARKET BOARD', () => this.close());
    this.el = p; this.titleEl = title;
    this.tab = 'browse'; this.page = 0; this.filters = { q: '', slot: '', rarity: '', min: '', max: '', sort: 'price' };
    this.sel = null; this.result = null;
    this.tabs = tabs([['browse', 'Browse'], ['sell', 'Sell'], ['mine', 'My listings']], (id) => { this.tab = id; this.page = 0; this.render(); this.fetch(); });
    this.body = el('div', 'ec-body ec-list');
    this.foot = el('div', 'ec-foot');
    p.append(this.tabs.bar, this.body, this.foot);
    this.offs = [
      econ.on('market-page', (m) => { this.result = m; if (this.isOpen) this.render(); }),
      econ.on('sync', (m) => { if (this.isOpen && /market/.test(m.why || '')) { this.sel = null; this.fetch(); } }),
      econ.on('state', () => { if (this.isOpen) { this.render(); this.fetch(); } }),
      econ.on('status', () => { if (this.isOpen) this.render(); }),
    ];
  }
  get isOpen() { return this.el.style.display !== 'none'; }
  open(tab) {
    if (tab) this.tab = tab;
    this.el.style.display = 'flex';
    this.render(); this.fetch();
    if (econ.usable) econ.syncSave();
  }
  close() { this.el.style.display = 'none'; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  fetch() {
    if (!econ.online) return;
    if (this.tab === 'sell') return;
    const f = this.filters;
    const num = (v) => (v === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0)));
    econ.send('market-browse', this.tab === 'mine' ? { mine: 1 } : { q: f.q, slot: f.slot, rarity: f.rarity, min: num(f.min), max: num(f.max), sort: f.sort, page: this.page });
  }

  render() {
    this.tabs.set(this.tab);
    const b = this.body; const f = this.foot; b.innerHTML = ''; f.innerHTML = '';
    const p = econ.player();
    this.titleEl.textContent = `MARKET BOARD${p ? ` · ${p.gold}g` : ''}`;
    if (!econ.online) { b.appendChild(offlineNote('the market board')); return; }
    if (!econ.ready) { b.appendChild(el('div', 'wf-empty', 'Connecting to the market…')); return; }
    if (this.tab === 'browse') this.renderBrowse(b, f);
    else if (this.tab === 'sell') this.renderSell(b, f);
    else this.renderMine(b, f);
  }

  renderBrowse(b, f) {
    const flt = this.filters;
    const r1 = el('div', 'ec-row');
    const q = el('input'); q.placeholder = 'search item or seller'; q.value = flt.q; q.maxLength = 24; q.style.flex = '1';
    const slot = el('select'); slot.innerHTML = `<option value="">any slot</option>${SLOTS.map((s) => `<option value="${s}">${SLOT_LABEL[s].toLowerCase()}</option>`).join('')}`; slot.value = flt.slot;
    const rar = el('select'); rar.innerHTML = `<option value="">any rarity</option>${Object.values(RARITY).map((r) => `<option value="${r.id}">${r.name.toLowerCase()}</option>`).join('')}`; rar.value = flt.rarity;
    r1.append(q, slot, rar);
    const r2 = el('div', 'ec-row');
    const mn = el('input'); mn.type = 'number'; mn.placeholder = 'min g'; mn.value = flt.min; mn.style.width = '64px';
    const mx = el('input'); mx.type = 'number'; mx.placeholder = 'max g'; mx.value = flt.max; mx.style.width = '64px';
    const sort = el('select'); sort.innerHTML = '<option value="price">cheapest</option><option value="-price">priciest</option><option value="new">newest</option><option value="ending">ending soon</option>'; sort.value = flt.sort;
    const go = el('button', '', 'Search');
    const apply = () => { Object.assign(flt, { q: q.value.trim(), slot: slot.value, rarity: rar.value, min: mn.value, max: mx.value, sort: sort.value }); this.page = 0; this.fetch(); };
    go.addEventListener('click', apply);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') apply(); });
    for (const s of [slot, rar, sort]) s.addEventListener('change', apply);
    r2.append(el('span', 'ec-dim', 'price'), mn, el('span', 'ec-dim', '-'), mx, sort, go);
    b.append(r1, r2);
    const res = this.result && !this.result.mine ? this.result : null;
    if (!res) { b.appendChild(el('div', 'wf-empty', 'Loading…')); return; }
    if (!res.items.length) b.appendChild(el('div', 'wf-empty', 'No listings match. Try other filters, or sell something!'));
    for (const it of res.items) b.appendChild(this.row(it, it.mine ? ['yours', null] : ['Buy', () => this.buy(it)]));
    this.pager(f, res);
  }
  pager(f, res) {
    const prev = el('button', '', '‹'); prev.disabled = res.page <= 0; prev.addEventListener('click', () => { this.page = res.page - 1; this.fetch(); });
    const next = el('button', '', '›'); next.disabled = res.page >= res.pages - 1; next.addEventListener('click', () => { this.page = res.page + 1; this.fetch(); });
    f.append(prev, el('span', 'ec-dim', `page ${res.page + 1}/${res.pages} · ${res.total} listing${res.total === 1 ? '' : 's'}`), next, el('span', 'ec-grow'), el('span', 'ec-dim', 'Sales pay out by mail (V).'));
  }
  row(it, [label, fn]) {
    const r = el('div', 'wf-row');
    const url = iconUrl(it.item);
    r.innerHTML = `${url ? `<img src="${url}" alt="">` : ''}<span class="wf-name" style="color:${rarityColor(it.item)}">${escapeHtml(itemName(it.item))}</span><span class="wf-meta">Lv${it.lvl ?? '?'} · ${escapeHtml(it.seller)} · ${fmtLeft(it.left)}</span><span class="ec-price">${it.price}g</span>`;
    r.title = itemTitle(it.item);
    const a = el('div', 'wf-acts');
    if (fn) {
      // two-step: first click arms ("Sure?"), second click within 3 s acts
      const btn = el('button', label === 'Cancel' ? 'wf-danger' : '', label);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.dataset.armed) { btn.disabled = true; fn(); return; }
        btn.dataset.armed = '1'; btn.textContent = label === 'Buy' ? `Pay ${it.price}g?` : 'Sure?';
        setTimeout(() => { delete btn.dataset.armed; btn.textContent = label; }, 3000);
      });
      a.appendChild(btn);
    } else a.appendChild(el('span', 'ec-dim', label));
    r.appendChild(a);
    return r;
  }
  buy(it) {
    const p = econ.player();
    if (p && p.gold < it.price) { bus.emit(Events.SYSTEM, `You need ${it.price} gold.`); return; }
    if (p && p.inventory.length >= econ.cfg.bag) { bus.emit(Events.SYSTEM, 'Your bag is full.'); return; }
    econ.send('market-buy', { id: it.id }, { rev: true, sync: true });
  }

  renderSell(b, f) {
    const p = econ.player();
    b.appendChild(el('div', 'ec-h', 'PICK AN ITEM FROM YOUR BAG'));
    const grid = el('div', 'ec-grid');
    for (const id of p?.inventory || []) {
      if (!isTradable(id)) continue;
      const c = chip(id, () => { this.sel = id; this.price = null; this.render(); }, { small: true });
      if (this.sel === id) c.classList.add('ec-sel');
      grid.appendChild(c);
    }
    if (!grid.children.length) grid.appendChild(el('span', 'ec-dim', 'Nothing to sell (equipped gear must be unequipped first).'));
    b.appendChild(grid);
    if (!this.sel || !p?.inventory.includes(this.sel)) { this.sel = null; b.appendChild(el('div', 'ec-dim', `A ${Math.round(econ.cfg.tax * 100)}% listing fee is paid up front (not refunded). Unsold items return by mail.`)); return; }
    const g = gearById(this.sel);
    const suggest = Math.max(1, Math.round((g?.price || 10) * 0.8));
    b.appendChild(el('div', 'ec-h', `LIST <span style="color:${rarityColor(this.sel)}">${escapeHtml(itemName(this.sel))}</span>`));
    const r = el('div', 'ec-row');
    const price = el('input'); price.type = 'number'; price.min = '1'; price.max = String(econ.cfg.priceMax); price.value = String(this.price ?? suggest); price.style.width = '90px';
    const hours = el('select'); hours.innerHTML = econ.cfg.hours.map((h) => `<option value="${h}">${h}h</option>`).join(''); hours.value = String(this.hours || 24);
    const fee = el('span', 'ec-dim');
    const upd = () => { const v = Math.max(1, Math.floor(Number(price.value) || 0)); this.price = v; this.hours = Number(hours.value); fee.innerHTML = `fee <span class="ec-gold">${Math.max(1, Math.ceil(v * econ.cfg.tax))}g</span> · shop value ~${g?.price || '?'}g`; };
    price.addEventListener('input', upd); hours.addEventListener('change', upd); upd();
    r.append(el('span', 'ec-gold', 'Price'), price, el('span', 'ec-dim', 'for'), hours, fee);
    b.appendChild(r);
    const list = el('button', '', 'List item');
    list.addEventListener('click', () => {
      const v = Math.max(1, Math.floor(Number(price.value) || 0));
      const feeG = Math.max(1, Math.ceil(v * econ.cfg.tax));
      if ((p?.gold | 0) < feeG) { bus.emit(Events.SYSTEM, `The listing fee is ${feeG} gold.`); return; }
      econ.send('market-post', { item: this.sel, price: v, hours: Number(hours.value) }, { rev: true, sync: true });
    });
    f.append(el('span', 'ec-grow'), list);
  }

  renderMine(b, f) {
    const res = this.result && this.result.mine ? this.result : null;
    if (!res) { b.appendChild(el('div', 'wf-empty', 'Loading…')); return; }
    if (!res.items.length) b.appendChild(el('div', 'wf-empty', 'You have no active listings.'));
    for (const it of res.items) b.appendChild(this.row(it, ['Cancel', () => econ.send('market-cancel', { id: it.id }, { rev: true, sync: true })]));
    f.append(el('span', 'ec-dim', `${res.total}/10 listings · cancelled items return to your bag (or mail if full)`));
  }
  destroy() { this.offs.forEach((o) => o()); this.el.remove(); }
}
