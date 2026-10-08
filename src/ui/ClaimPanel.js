import { econ } from '../net/economyNet.js';
import { el, panel } from './econDom.js';

// Claims stay visible while conversion is paused until reward points are
// server-issued and cannot be forged through client saves.
export class ClaimPanel {
  constructor() {
    const { p, title } = panel('ec-claim', 'CLAIM TOKENS', () => this.close());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.build();
    this.off = econ.on('sync', (m) => { if (m?.why === 'token-claim') this.render(); });
  }
  get isOpen() { return this.el.style.display !== 'none'; }
  open() { this.el.style.display = 'flex'; this.render(); }
  close() { this.el.style.display = 'none'; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  destroy() { this.close(); this.el.remove(); if (this.off) this.off(); }

  build() {
    const b = this.body;
    b.innerHTML = '';
    this.statsT = el('div', 'ec-dim');
    b.appendChild(this.statsT);

    this.claimBtn = el('button', '', 'Claims temporarily paused');
    this.claimBtn.disabled = true;
    b.appendChild(this.claimBtn);
    this.feeT = el('div', 'ec-dim', 'Token points are not yet verified by the server, so they cannot be converted into redeemable Wayfarer Tokens. Existing token balances are preserved.');
    b.appendChild(this.feeT);
  }

  render() {
    const p = econ.player();
    const tp = p?.tokenPoints ?? 0;
    const wt = p?.wayfarerTokens ?? 0;
    this.statsT.innerHTML = `<b>Token Points:</b> ${tp} &nbsp; <b>Wayfarer Tokens:</b> ${wt}`;

    this.claimBtn.disabled = true;
  }
}
