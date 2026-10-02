import { econ } from '../net/economyNet.js';
import { bus, Events } from '../core/events.js';
import { el, panel } from './econDom.js';

// ClaimPanel: convert tokenPoints (earned from kills) into wayfarerTokens.
// The server deducts a gold fee (ECON.TOKEN_CLAIM_FEE) on each claim.
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

    const row = el('div', 'ec-row');
    row.appendChild(el('span', '', 'Claim:'));
    this.input = el('input');
    this.input.type = 'number'; this.input.min = '1'; this.input.step = '1'; this.input.value = '100';
    this.input.style.width = '80px';
    row.appendChild(this.input);

    const btn = el('button', '', 'Claim');
    btn.addEventListener('click', () => this.claim());
    row.appendChild(btn);
    b.appendChild(row);

    this.feeT = el('div', 'ec-fee');
    b.appendChild(this.feeT);

    const note = el('div', 'ec-dim', 'Token Points come from defeating monsters. Claiming converts them into Wayfarer Tokens. A gold fee is deducted per claim.');
    b.appendChild(note);
  }

  render() {
    const p = econ.player();
    const tp = p?.tokenPoints ?? 0;
    const wt = p?.wayfarerTokens ?? 0;
    this.statsT.innerHTML = `<b>Token Points:</b> ${tp} &nbsp; <b>Wayfarer Tokens:</b> ${wt}`;

    const feeRate = econ.cfg?.tokenClaimFee ?? 0.05;
    const amt = Math.max(0, Math.floor(Number(this.input.value) || 0));
    const fee = amt > 0 ? Math.max(1, Math.floor(amt * feeRate)) : 0;
    const net = amt - fee;
    this.feeT.innerHTML = `<span>Fee (${Math.round(feeRate * 100)}%): ${fee}g</span><span>Net tokens: ${Math.max(0, net)}</span>`;
  }

  claim() {
    const amt = Math.max(0, Math.floor(Number(this.input.value) || 0));
    if (amt <= 0) { bus.emit(Events.SYSTEM, 'Enter a positive amount.'); return; }
    const p = econ.player();
    if (!p) { bus.emit(Events.SYSTEM, 'No hero loaded.'); return; }
    if ((p.tokenPoints || 0) < amt) { bus.emit(Events.SYSTEM, `Not enough token points (${p.tokenPoints || 0}).`); return; }
    econ.send('token-claim', { amount: amt }, { rev: true, sync: true });
  }
}
