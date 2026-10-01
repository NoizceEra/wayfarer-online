import { trade } from '../systems/trade.js';
import { econ, isTradable } from '../net/economyNet.js';
import { el, escapeHtml, panel, chip } from './econDom.js';
import { socialRoot } from './socialDom.js';

// Direct trade window (DOM). Opens when a trade session starts (request via
// the player context menu or /trade name). Left: your offer, right: theirs,
// below: your bag (click to add, click an offered item to take it back).
// LOCK freezes your offer; when both are locked, CONFIRM; the server swaps
// atomically. Any offer change unlocks both sides.
export class TradePanel {
  constructor() {
    const { p, title } = panel('ec-trade', 'TRADE', () => trade.cancel());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.buildToast();
    this.off = trade.on((ev) => this.onEvent(ev));
  }
  get isOpen() { return this.el.style.display !== 'none'; }
  close() { if (trade.active) trade.cancel(); this.hide(); }
  hide() { this.el.style.display = 'none'; }
  show() { this.el.style.display = 'flex'; this.render(); }

  onEvent(ev) {
    if (ev.kind === 'request') this.showToast(ev.request);
    else if (ev.kind === 'open') { this.showToast(null); this.show(); }
    else if (ev.kind === 'update') { if (this.isOpen) this.render(); else this.show(); }
    else if (ev.kind === 'result') { if (ev.ok) this.hide(); else this.render(); }
    else if (ev.kind === 'closed') this.hide();
  }

  render() {
    const s = trade.session;
    if (!s) { this.hide(); return; }
    this.titleEl.textContent = `TRADE WITH ${s.partner.name.toUpperCase()}`;
    const b = this.body; b.innerHTML = '';
    const st = (x) => (x.confirmed ? '<span class="ec-status ok">CONFIRMED</span>' : x.locked ? '<span class="ec-status on">LOCKED</span>' : '<span class="ec-status">editing</span>');
    const cols = el('div', 'ec-cols');
    const mine = el('div'); const theirs = el('div');
    mine.appendChild(el('div', 'ec-h', `YOUR OFFER <span class="ec-tag">${st(s.me)}</span>`));
    theirs.appendChild(el('div', 'ec-h', `${escapeHtml(s.partner.name.toUpperCase())} <span class="ec-tag">${st(s.them)}</span>`));
    const g1 = el('div', 'ec-grid'); const g2 = el('div', 'ec-grid');
    s.me.items.forEach((id, i) => g1.appendChild(chip(id, s.me.locked ? null : () => {
      const items = s.me.items.slice(); items.splice(i, 1); trade.offer(items, s.me.gold);
    }, { small: true })));
    s.them.items.forEach((id) => g2.appendChild(chip(id, null, { small: true })));
    if (!s.me.items.length) g1.appendChild(el('span', 'ec-dim', 'click bag items below'));
    if (!s.them.items.length) g2.appendChild(el('span', 'ec-dim', 'no items'));
    mine.appendChild(g1); theirs.appendChild(g2);
    const goldRow = el('div', 'ec-row');
    goldRow.appendChild(el('span', 'ec-gold', 'Gold'));
    const gi = el('input'); gi.type = 'number'; gi.min = '0'; gi.step = '1'; gi.value = String(s.me.gold || 0); gi.style.width = '80px'; gi.disabled = s.me.locked;
    gi.addEventListener('change', () => { const v = Math.max(0, Math.floor(Number(gi.value) || 0)); if (v !== s.me.gold) trade.offer(s.me.items, v); });
    goldRow.appendChild(gi);
    mine.appendChild(goldRow);
    theirs.appendChild(el('div', 'ec-row', `<span class="ec-gold">Gold ${s.them.gold | 0}</span>`));
    cols.append(mine, theirs);
    b.appendChild(cols);

    const p = econ.player();
    b.appendChild(el('div', 'ec-h', `YOUR BAG <span class="ec-tag ec-gold">${p ? p.gold : 0}g</span>`));
    const bag = el('div', 'ec-grid');
    const left = [...(p?.inventory || [])];
    for (const id of s.me.items) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
    for (const id of left) {
      const ok = isTradable(id) && !s.me.locked && s.me.items.length < econ.cfg.tradeItems;
      bag.appendChild(chip(id, ok ? () => trade.offer([...s.me.items, id], s.me.gold) : null, { small: true }));
    }
    if (!left.length) bag.appendChild(el('span', 'ec-dim', 'bag empty (equipped gear cannot be traded)'));
    b.appendChild(bag);
    b.appendChild(el('div', 'ec-dim', 'Lock your offer, then both confirm. Changing an offer unlocks both sides. The server checks both bags before swapping.'));

    const f = this.foot; f.innerHTML = '';
    const lock = el('button', '', s.me.locked ? 'Unlock' : 'Lock offer');
    lock.addEventListener('click', () => (s.me.locked ? trade.unlock() : trade.lock()));
    const conf = el('button', '', s.me.confirmed ? 'Waiting…' : 'Confirm trade');
    conf.disabled = !(s.me.locked && s.them.locked) || s.me.confirmed;
    conf.addEventListener('click', () => trade.confirm());
    const cancel = el('button', 'wf-danger', 'Cancel');
    cancel.addEventListener('click', () => trade.cancel());
    f.append(lock, conf, el('span', 'ec-grow'), cancel);
  }

  buildToast() {
    const t = this.toast = el('div', 'wf-panel ec-toast'); t.style.display = 'none';
    this.toastText = el('span');
    const ok = el('button', '', 'Trade'); ok.addEventListener('click', () => trade.respond(true));
    const no = el('button', 'wf-danger', 'Decline'); no.addEventListener('click', () => trade.respond(false));
    t.append(this.toastText, ok, no);
    socialRoot().appendChild(t);
  }
  showToast(req) {
    if (!req) { this.toast.style.display = 'none'; return; }
    this.toastText.innerHTML = `<b style="color:#ffe8a0">${escapeHtml(req.fromName)}</b> wants to trade`;
    this.toast.style.display = 'flex';
  }
  destroy() { this.off(); this.el.remove(); this.toast.remove(); }
}
