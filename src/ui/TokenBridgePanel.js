import bs58 from 'bs58';
import { econ } from '../net/economyNet.js';
import { bus, Events } from '../core/events.js';
import { el, panel, escapeHtml } from './econDom.js';

// TokenBridgePanel — links a Solana wallet to the account (ed25519 signature
// challenge) and moves Wayfarer Tokens across the devnet bridge:
//   withdraw: in-game Wayfarer Tokens -> on-chain $WAYFARER (7.5% fee)
//   deposit:  on-chain $WAYFARER       -> in-game Wayfarer Tokens (paste a tx sig)
// All authority is server-side (server/economy.js). Accessible via /bridge.
const SOL = { green: '#14f195', purple: '#9945ff', cyan: '#03e1ff', dim: '#6b7a99', text: '#e8e6ff' };
const FONT = '"Silkscreen", monospace';

// window.solana / phantom / solflare provider (mirrors WalletPanel's lookup)
function getProvider() {
  if (typeof window === 'undefined') return null;
  const p = window.phantom?.solana || window.solflare || window.solana;
  return p?.isPhantom || p?.isSolflare ? p : null;
}

let cssDone = false;
function injectCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  const s = el('style');
  s.textContent = `
#wf-social .ec-bridge{border-color:${SOL.purple}}
#wf-social .ec-bridge .wf-title{border-bottom:1px solid ${SOL.purple}}
#wf-social .ec-bridge .wf-title span{color:${SOL.green};font-family:${FONT}}
#wf-social .ec-banner{padding:6px 8px;margin:4px 0;font-size:8px;line-height:1.5;border:1px solid}
#wf-social .ec-banner.warn{color:#ffd84a;border-color:#8a5a2b;background:rgba(138,90,43,.16)}
#wf-social .ec-banner.ok{color:${SOL.green};border-color:${SOL.green};background:rgba(20,241,149,.09)}
#wf-social .ec-banner.bad{color:#ff8f8f;border-color:#7a2a2a;background:rgba(122,42,42,.16)}
#wf-social .ec-bridge .ec-sol{color:${SOL.green}}
#wf-social .ec-bridge .ec-addr{color:${SOL.cyan};word-break:break-all}
#wf-social .ec-bar{position:relative;height:8px;background:#120c1c;border:1px solid ${SOL.purple};margin:3px 0}
#wf-social .ec-bar>i{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,${SOL.purple},${SOL.green});display:block}
#wf-social .ec-bridge table{width:100%;border-collapse:collapse;font-size:8px}
#wf-social .ec-bridge th,#wf-social .ec-bridge td{text-align:left;padding:2px 4px;border-bottom:1px solid #3a2410}
#wf-social .ec-bridge td.st-sent{color:${SOL.green}}
#wf-social .ec-bridge td.st-pending{color:#ffd84a}
#wf-social .ec-bridge td.st-failed{color:#ff8f8f}
#wf-social .ec-bridge input{color:${SOL.text};background:#0d0a17;border:1px solid ${SOL.purple}}
#wf-social .ec-bridge button{background:${SOL.purple};color:#0a0e1a;box-shadow:none}
#wf-social .ec-bridge button:hover{background:${SOL.green}}
#wf-social .ec-bridge button:disabled{background:#2a2340;color:#7d7794}
`;
  document.head.appendChild(s);
}

export class TokenBridgePanel {
  constructor() {
    injectCss();
    const { p, title } = panel('ec-bridge', 'SOLANA TOKEN BRIDGE', () => this.close());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.linkAddress = null;   // address awaiting a signed challenge
    this.linkMessage = null;
    this.build();
    this._offs = [
      econ.on('state', () => this.render()),
      econ.on('sync', () => this.render()),
      econ.on('status', () => this.render()),
      econ.on('token-bridge-state', () => this.render()),
      econ.on('wallet-bound', () => this.render()),
      econ.on('wallet-bind-challenge', (m) => this.onChallenge(m)),
      econ.on('token-withdraw-result', (m) => this.result('withdraw', m)),
      econ.on('token-deposit-result', (m) => this.result('deposit', m)),
      econ.on('error', () => this.setBusy(false)),
    ];
  }

  get isOpen() { return this.el.style.display !== 'none'; }
  open(preset) {
    this.el.style.display = 'flex';
    if (preset?.link) this.startLink(true);
    if (econ.online) econ.getBridgeState();
    this.render();
  }
  close() { this.el.style.display = 'none'; }
  toggle() { this.isOpen ? this.close() : this.open(); }
  destroy() { this.close(); this.el.remove(); for (const off of this._offs || []) { try { off(); } catch { /* ignore */ } } }

  build() {
    const b = this.body; b.innerHTML = '';
    this.banner = el('div', 'ec-banner');
    b.appendChild(this.banner);

    // ── wallet link ──
    b.appendChild(el('div', 'ec-h', 'LINKED WALLET'));
    this.walletT = el('div', 'ec-dim');
    b.appendChild(this.walletT);
    this.linkBtn = el('button', '', 'Link wallet');
    this.linkBtn.addEventListener('click', () => this.startLink(false));
    b.appendChild(this.linkBtn);

    // ── balance + daily cap ──
    b.appendChild(el('div', 'ec-h', 'IN-GAME BALANCE'));
    this.balT = el('div', 'ec-row ec-sol');
    b.appendChild(this.balT);
    this.capT = el('div', 'ec-dim');
    b.appendChild(this.capT);
    this.capBar = el('div', 'ec-bar');
    this.capBar.appendChild(el('i'));
    b.appendChild(this.capBar);

    // ── withdraw ──
    b.appendChild(el('div', 'ec-h', 'WITHDRAW (in-game -> on-chain)'));
    const wRow = el('div', 'ec-row');
    this.wIn = el('input'); this.wIn.type = 'number'; this.wIn.min = '1'; this.wIn.step = '1'; this.wIn.value = '100'; this.wIn.style.width = '80px';
    this.wIn.addEventListener('input', () => this.renderPreview());
    this.wBtn = el('button', '', 'Withdraw');
    this.wBtn.addEventListener('click', () => this.withdraw());
    wRow.append(this.wIn, this.wBtn);
    b.appendChild(wRow);
    this.wFeeT = el('div', 'ec-fee');
    b.appendChild(this.wFeeT);

    // ── deposit ──
    b.appendChild(el('div', 'ec-h', 'DEPOSIT (on-chain -> in-game)'));
    const dRow = el('div', 'ec-row');
    this.dIn = el('input'); this.dIn.type = 'text'; this.dIn.placeholder = 'Solana transaction signature'; this.dIn.style.flex = '1';
    this.dBtn = el('button', '', 'Credit');
    this.dBtn.addEventListener('click', () => this.deposit());
    dRow.append(this.dIn, this.dBtn);
    b.appendChild(dRow);
    this.dHint = el('div', 'ec-dim', 'Send $WAYFARER to the treasury, then paste the transaction signature here.');
    b.appendChild(this.dHint);

    // ── history ──
    b.appendChild(el('div', 'ec-h', 'RECENT WITHDRAWALS'));
    this.wdList = el('div', 'ec-list');
    b.appendChild(this.wdList);
    b.appendChild(el('div', 'ec-h', 'RECENT DEPOSITS'));
    this.depList = el('div', 'ec-list');
    b.appendChild(this.depList);
  }

  // ── render ──
  render() {
    if (!this.body) return;
    const st = econ.bridge || {};
    const p = econ.player();
    const tokens = p?.wayfarerTokens ?? st.tokenBalance ?? 0;

    // banner
    const online = econ.online && econ.ready;
    if (!online) {
      this._banner('bad', 'Play Online to use the token bridge.');
    } else if (econ.bridge && st.configured === false) {
      this._banner('warn', 'Bridge unconfigured on this server — withdrawals are disabled and nothing is deducted. Wallet linking and deposits may still be unavailable.');
    } else if (econ.bridge && st.configured) {
      this._banner('ok', `Bridge live on ${escapeHtml(st.network || 'devnet')}. Withdraw fee ${Math.round((st.withdrawFee ?? 0.075) * 100)}%.`);
    } else {
      this._banner('warn', 'Reading bridge state...');
    }

    const addr = st.address || '';
    this.walletT.innerHTML = addr
      ? `Linked: <span class="ec-addr">${escapeHtml(addr)}</span>`
      : 'No wallet linked to this character yet.';
    this.linkBtn.textContent = addr ? 'Relink wallet' : 'Link wallet';
    this.linkBtn.disabled = !online;

    this.balT.innerHTML = `<b class="ec-sol">Wayfarer Tokens</b>: ${tokens}`;
    const cap = st.dailyCap ?? econ.cfg?.tokenWithdrawDailyCap ?? 500;
    const claimed = st.claimedToday ?? econ.sinksState?.dailyClaimed ?? 0;
    const pct = cap > 0 ? Math.min(100, Math.round((claimed / cap) * 100)) : 0;
    this.capT.textContent = `Daily cap: ${claimed}/${cap} (${pct}%)`;
    const bar = this.capBar.firstChild;
    if (bar) { bar.style.width = `${pct}%`; bar.style.background = pct >= 100 ? '#ff8f8f' : ''; }

    const configured = !!st.configured;
    this.wBtn.disabled = this._busy || !online || !configured || !addr;
    this.wBtn.title = !configured ? 'The bridge is not configured on this server.' : !addr ? 'Link a wallet first.' : '';
    this.dBtn.disabled = this._busy || !online || st.depositConfigured === false || !addr;
    this.dBtn.title = !addr ? 'Link the wallet that sent the deposit first.' : '';
    this.dHint.textContent = addr
      ? 'Only transfers from your linked wallet to the treasury can be credited.'
      : 'Link the wallet that will send the deposit before claiming it.';

    this.renderPreview();
    this.renderRows('withdrawals', this.wdList, 'no withdrawals yet');
    this.renderRows('deposits', this.depList, 'no deposits yet');
  }

  _banner(kind, text) {
    this.banner.className = `ec-banner ${kind}`;
    this.banner.innerHTML = text;
  }

  renderPreview() {
    const st = econ.bridge || {};
    const rate = st.withdrawFee ?? 0.075;
    const amt = Math.max(0, Math.floor(Number(this.wIn?.value) || 0));
    const fee = amt > 0 ? Math.max(1, Math.floor(amt * rate)) : 0;
    const net = Math.max(0, amt - fee);
    if (this.wFeeT) this.wFeeT.innerHTML = `<span>Fee (${Math.round(rate * 100)}%): ${fee}</span><span>You receive: ${net} $WAYFARER</span>`;
  }

  renderRows(which, host, empty) {
    if (!host) return;
    const st = econ.bridge || {};
    const rows = which === 'withdrawals' ? (st.pendingWithdrawals || []) : (st.deposits || []);
    host.innerHTML = '';
    if (!rows.length) { host.appendChild(el('div', 'ec-dim', empty)); return; }
    const t = el('table');
    const head = which === 'withdrawals' ? ['when', 'net', 'fee', 'status'] : ['when', 'amount', 'sig'];
    const tr = el('tr');
    for (const h of head) tr.appendChild(el('th', '', h));
    t.appendChild(tr);
    for (const r of rows) {
      const row = el('tr');
      const when = r.created_at ? new Date((r.created_at | 0) * 1000).toLocaleDateString() : (r.confirmed_at ? new Date((r.confirmed_at | 0) * 1000).toLocaleDateString() : '-');
      if (which === 'withdrawals') {
        row.appendChild(el('td', '', when));
        row.appendChild(el('td', '', String(r.net ?? 0)));
        row.appendChild(el('td', '', String(r.fee ?? 0)));
        row.appendChild(el('td', `st-${escapeHtml(r.status || '')}`, escapeHtml(r.status || '-')));
      } else {
        row.appendChild(el('td', '', when));
        row.appendChild(el('td', '', String(r.amount ?? 0)));
        row.appendChild(el('td', '', `<span class="ec-addr">${escapeHtml(String(r.signature || '').slice(0, 12))}…</span>`));
      }
      t.appendChild(row);
    }
    host.appendChild(t);
  }

  // ── wallet link ──
  async startLink(autoconnect) {
    const provider = getProvider();
    if (!provider) { bus.emit(Events.SYSTEM, 'Phantom / Solflare not found. Install a Solana wallet.'); return; }
    if (!econ.online) { bus.emit(Events.SYSTEM, 'Play Online to link a wallet.'); return; }
    try {
      let addr = provider.publicKey?.toString?.();
      if (!addr && autoconnect) {
        const resp = await provider.connect();
        addr = resp?.publicKey?.toString?.();
      }
      if (!addr) { bus.emit(Events.SYSTEM, 'Wallet did not report an address.'); return; }
      this.linkAddress = addr;
      this.linkMessage = null;
      this._banner('warn', `Approve the signature request in ${provider.isPhantom ? 'Phantom' : 'your wallet'} to prove you own ${addr.slice(0, 4)}...${addr.slice(-4)}.`);
      econ.walletChallenge(addr);
      bus.emit(Events.SYSTEM, 'Check your wallet for a signature request.');
    } catch (e) {
      this._banner('bad', `Wallet connect failed: ${escapeHtml(e?.message || 'rejected')}`);
    }
  }

  async onChallenge(m) {
    if (!m?.message || !m?.address) return;
    const provider = getProvider();
    if (!provider) return;
    // stay on the challenge we requested (ignore a stale one for another address)
    if (this.linkAddress && m.address !== this.linkAddress) return;
    this.linkAddress = m.address;
    this.linkMessage = m.message;
    try {
      const encoded = new TextEncoder().encode(m.message);
      const resp = await provider.signMessage(encoded, 'utf8');
      const sigBytes = resp?.signature || resp;
      const signature = bs58.encode(sigBytes instanceof Uint8Array ? sigBytes : Uint8Array.from(sigBytes));
      econ.walletBind(m.address, signature);
    } catch (e) {
      this._banner('bad', `Signature rejected: ${escapeHtml(e?.message || 'cancelled')}`);
      this.linkAddress = null;
    }
  }

  // ── withdraw / deposit ──
  withdraw() {
    const amt = Math.max(0, Math.floor(Number(this.wIn.value) || 0));
    if (amt <= 0) { bus.emit(Events.SYSTEM, 'Enter a positive token amount.'); return; }
    this.setBusy(true);
    econ.requestWithdraw(amt);
  }

  deposit() {
    const sig = String(this.dIn.value || '').trim();
    if (!sig) { bus.emit(Events.SYSTEM, 'Paste a transaction signature.'); return; }
    this.setBusy(true);
    econ.requestDeposit(sig);
  }

  setBusy(on) { this._busy = !!on; if (this.wBtn) this.wBtn.disabled = !!on; if (this.dBtn) this.dBtn.disabled = !!on; }

  result(kind, m) {
    if (!m) return;
    this.setBusy(false);
    if (kind === 'withdraw') {
      if (m.status === 'unconfigured') this._banner('bad', escapeHtml(m.reason || 'Bridge unconfigured. Nothing was deducted.'));
      else if (m.status === 'sent') this._banner('ok', `Withdraw sent: ${m.net} $WAYFARER (fee ${m.fee}). Sig ${String(m.signature || '').slice(0, 10)}…`);
      else if (m.status === 'pending') this._banner('warn', `Withdraw queued: ${m.net} $WAYFARER. ${escapeHtml(m.reason || '')}`);
      else this._banner('bad', escapeHtml(m.reason || 'Withdraw failed.'));
    } else {
      if (m.ok) this._banner('ok', `Deposit credited: ${m.credited} Wayfarer Token${m.credited !== 1 ? 's' : ''}.`);
      else this._banner('bad', escapeHtml(m.reason || 'Deposit failed.'));
    }
    if (econ.online) econ.getBridgeState();
    this.render();
  }
}
