import { trade } from '../systems/trade.js';
import { econ, isTradable } from '../net/economyNet.js';
import { el, escapeHtml, panel, chip } from './econDom.js';
import { socialRoot } from './socialDom.js';

// Escrow trade window (DOM). Provides secure, server-guaranteed trading with
// a 2.5% platform fee deducted from the total gold exchanged.
//
// Flow: Player A initiates → both add offers → both LOCK → both CONFIRM →
// server validates → executes atomic swap → fee deducted → result broadcast.
//
// Coexists with the direct trust-based TradePanel (no fee, instant).
export class TradeEscrowPanel {
  constructor() {
    const { p, title } = panel('ec-escrow', 'ESCROW TRADE', () => trade.cancelEscrow());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.buildToast();
    this.off = trade.on((ev) => this.onEvent(ev));
  }
  get isOpen() { return this.el.style.display !== 'none'; }
  close() { if (trade.escrowActive) trade.cancelEscrow(); this.hide(); }
  hide() { this.el.style.display = 'none'; }
  show() { this.el.style.display = 'flex'; this.render(); }

  onEvent(ev) {
    if (ev.kind === 'escrow-request') this.showToast(ev.request);
    else if (ev.kind === 'escrow-open') { this.showToast(null); this.show(); }
    else if (ev.kind === 'escrow-update') { if (this.isOpen) this.render(); else this.show(); }
    else if (ev.kind === 'escrow-result') {
      if (ev.ok) {
        this.showSuccess(ev);
        setTimeout(() => this.hide(), 3500);
      } else {
        this.showFailure(ev);
      }
    } else if (ev.kind === 'escrow-closed') {
      this.hide();
    }
  }

  render() {
    const s = trade.escrowSession;
    if (!s) { this.hide(); return; }
    this.titleEl.textContent = `ESCROW TRADE WITH ${s.partner.name.toUpperCase()}`;
    const b = this.body; b.innerHTML = '';

    const st = (x) => (
      x.confirmed ? '<span class="ec-status ok">CONFIRMED</span>' :
      x.locked ? '<span class="ec-status on">LOCKED</span>' :
      '<span class="ec-status">editing</span>'
    );

    const cols = el('div', 'ec-cols');
    const mine = el('div');
    const theirs = el('div');
    mine.appendChild(el('div', 'ec-h', `YOUR OFFER <span class="ec-tag">${st(s.me)}</span>`));
    theirs.appendChild(el('div', 'ec-h', `${escapeHtml(s.partner.name.toUpperCase())} <span class="ec-tag">${st(s.them)}</span>`));

    const g1 = el('div', 'ec-grid');
    const g2 = el('div', 'ec-grid');
    s.me.items.forEach((id, i) => g1.appendChild(chip(id, s.me.locked ? null : () => {
      const items = s.me.items.slice(); items.splice(i, 1); trade.offerEscrow(items, s.me.gold);
    }, { small: true })));
    s.them.items.forEach((id) => g2.appendChild(chip(id, null, { small: true })));
    if (!s.me.items.length) g1.appendChild(el('span', 'ec-dim', 'click bag items below'));
    if (!s.them.items.length) g2.appendChild(el('span', 'ec-dim', 'no items'));
    mine.appendChild(g1); theirs.appendChild(g2);

    const goldRow = el('div', 'ec-row');
    goldRow.appendChild(el('span', 'ec-gold', 'Gold'));
    const gi = el('input');
    gi.type = 'number'; gi.min = '0'; gi.step = '1'; gi.value = String(s.me.gold || 0);
    gi.style.width = '80px'; gi.disabled = s.me.locked;
    gi.addEventListener('change', () => {
      const v = Math.max(0, Math.floor(Number(gi.value) || 0));
      if (v !== s.me.gold) trade.offerEscrow(s.me.items, v);
    });
    goldRow.appendChild(gi);
    mine.appendChild(goldRow);
    theirs.appendChild(el('div', 'ec-row', `<span class="ec-gold">Gold ${s.them.gold | 0}</span>`));
    cols.append(mine, theirs);
    b.appendChild(cols);

    // Fee display
    const feeBlock = this.buildFeeBlock(s);
    b.appendChild(feeBlock);

    // Bag
    const p = econ.player();
    b.appendChild(el('div', 'ec-h', `YOUR BAG <span class="ec-tag ec-gold">${p ? p.gold : 0}g</span>`));
    const bag = el('div', 'ec-grid');
    const left = [...(p?.inventory || [])];
    for (const id of s.me.items) { const i = left.indexOf(id); if (i >= 0) left.splice(i, 1); }
    for (const id of left) {
      const ok = isTradable(id) && !s.me.locked && s.me.items.length < econ.cfg.tradeItems;
      bag.appendChild(chip(id, ok ? () => trade.offerEscrow([...s.me.items, id], s.me.gold) : null, { small: true }));
    }
    if (!left.length) bag.appendChild(el('span', 'ec-dim', 'bag empty (equipped gear cannot be traded)'));
    b.appendChild(bag);

    b.appendChild(el('div', 'ec-dim', 'Lock your offer, then both confirm. The server validates inventories, executes the swap atomically, and deducts a 2.5% fee from the total gold exchanged.'));

    // Footer
    const f = this.foot; f.innerHTML = '';
    const lock = el('button', '', s.me.locked ? 'Unlock' : 'Lock offer');
    lock.addEventListener('click', () => (s.me.locked ? trade.unlockEscrow() : trade.lockEscrow()));
    const conf = el('button', '', s.me.confirmed ? 'Waiting…' : 'Confirm trade');
    conf.disabled = !(s.me.locked && s.them.locked) || s.me.confirmed;
    conf.addEventListener('click', () => trade.confirmEscrow());
    const cancel = el('button', 'wf-danger', 'Cancel');
    cancel.addEventListener('click', () => trade.cancelEscrow());
    f.append(lock, conf, el('span', 'ec-grow'), cancel);
  }

  buildFeeBlock(s) {
    const totalGold = (s.me.gold | 0) + (s.them.gold | 0);
    const fee = totalGold > 0 ? Math.max(1, Math.ceil(totalGold * 0.025)) : 0;
    const netA = (s.them.gold | 0) - (fee > 0 && s.me.gold + s.them.gold > 0 ? Math.round(fee * (s.them.gold / totalGold)) : 0);
    const netB = (s.me.gold | 0) - (fee > 0 && s.me.gold + s.them.gold > 0 ? Math.round(fee * (s.me.gold / totalGold)) : 0);

    const block = el('div', 'ec-fee');
    block.style.cssText = 'background:rgba(0,0,0,.25);border:1px solid #3a2410;padding:6px 8px;margin:6px 0;font-size:9px';
    block.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <span style="color:#ffd84a">Platform fee (2.5%): <b>${fee}g</b></span>
        <span style="color:#8aa070">You will receive: <b>${netA}g</b> + ${s.them.items.length} item(s)</span>
        <span style="color:#8aa070">They will receive: <b>${netB}g</b> + ${s.me.items.length} item(s)</span>
      </div>
    `;
    return block;
  }

  showSuccess(ev) {
    const b = this.body;
    const s = ev.session;
    if (!s) return;
    const got = s.them.items.map((id) => ({ name: id, id }));
    const goldGot = s.them.gold - (ev.fee ? Math.round(ev.fee * (s.them.gold / ((s.me.gold + s.them.gold) || 1))) : 0);
    b.innerHTML = '';
    b.appendChild(el('div', 'ec-h', 'TRADE COMPLETE ✓'));
    const msg = el('div', '', `
      <div style="color:#7dff9a;font-size:11px;margin:8px 0">Escrow executed successfully!</div>
      <div style="color:#b8d48a;font-size:9px">You received: <b>${goldGot}g</b> + ${got.length} item(s)</div>
      <div style="color:#8aa070;font-size:9px;margin-top:4px">Platform fee: ${ev.fee || 0}g</div>
    `);
    b.appendChild(msg);
    this.foot.innerHTML = '';
    const close = el('button', '', 'Close');
    close.addEventListener('click', () => this.hide());
    this.foot.appendChild(close);
  }

  showFailure(ev) {
    const b = this.body;
    b.innerHTML = '';
    b.appendChild(el('div', 'ec-h', 'TRADE FAILED ✗'));
    b.appendChild(el('div', '', `<div style="color:#e74c3c;font-size:11px;margin:8px 0">${escapeHtml(ev.reason || 'Unknown error')}</div><div style="color:#8aa070;font-size:9px">Your items and gold have been refunded.</div>`));
    this.foot.innerHTML = '';
    const close = el('button', '', 'Close');
    close.addEventListener('click', () => this.hide());
    this.foot.appendChild(close);
  }

  buildToast() {
    const t = this.toast = el('div', 'wf-panel ec-toast');
    t.style.display = 'none';
    this.toastText = el('span');
    const ok = el('button', '', 'Escrow Trade');
    ok.addEventListener('click', () => trade.respondEscrow(true));
    const no = el('button', 'wf-danger', 'Decline');
    no.addEventListener('click', () => trade.respondEscrow(false));
    t.append(this.toastText, ok, no);
    socialRoot().appendChild(t);
  }

  showToast(req) {
    if (!req) { this.toast.style.display = 'none'; return; }
    this.toastText.innerHTML = `<b style="color:#ffe8a0">${escapeHtml(req.fromName)}</b> wants to escrow trade`;
    this.toast.style.display = 'flex';
  }

  destroy() { this.off(); this.el.remove(); this.toast.remove(); }
}
