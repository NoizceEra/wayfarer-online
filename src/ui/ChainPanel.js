import { chainNet, describe, TIER_ORDER } from '../net/chainNet.js';
import { wallet } from '../core/wallet.js';
import { el, escapeHtml, fmtLeft } from './econDom.js';
import { socialRoot } from './socialDom.js';
import { input } from '../core/input.js';
import { WalletPanel } from './WalletPanel.js';

// WAYFARER token panel — the client side of the token economy (server/econ/**).
//
// Non-negotiables this file implements (docs/BLOCKCHAIN_V1.md §3, §6):
//   * the game never depends on this panel: with the relay unreachable, the
//     economy disabled or no wallet linked, it renders a calm state and the
//     player keeps playing. Nothing here throws or console.errors.
//   * no wallet is EVER prompted from here. Opening the Wallet panel is a click
//     the player makes, never something this panel does on its own, and a claim
//     never asks the wallet to sign or send anything.
//   * the published return is the EFFECTIVE year-1 rate (what a one-year lock
//     actually pays), never the nominal APR.

function injectCss() {
  if (document.getElementById('wf-chain-css')) return;
  const s = el('style'); s.id = 'wf-chain-css';
  s.textContent = `
#wf-social .wf-chain{left:50%;top:50%;transform:translate(-50%,-50%);width:min(462px,calc(100vw - 16px));max-height:86vh;display:flex;flex-direction:column}
#wf-social .wf-chain .ec-body{padding:8px 10px;overflow-y:auto;flex:1;min-height:0}
#wf-social .wf-chain .ch-bal{display:flex;gap:14px;flex-wrap:wrap;margin:2px 0 4px}
#wf-social .wf-chain .ch-bal b{display:block;font-size:15px;color:#9bbc0f}
#wf-social .wf-chain .ch-bal .g b{color:#f4c542}
#wf-social .wf-chain .ch-bal .l{font-size:8px;color:#b8a888}
#wf-social .wf-chain .ch-note{color:#b8a888;font-size:9px;line-height:1.45;margin:5px 0}
#wf-social .wf-chain .ch-h{color:#ffe8a0;font-size:9px;margin:9px 0 3px;display:flex;gap:6px;align-items:center}
#wf-social .wf-chain .ch-row{display:flex;gap:6px;align-items:center;font-size:9px;padding:2px 0;border-bottom:1px solid #2a1a0c;line-height:1.35}
#wf-social .wf-chain .ch-row .n{flex:1;color:#f4f0dc;min-width:0}
#wf-social .wf-chain .ch-rate{color:#9bbc0f;white-space:nowrap}
#wf-social .wf-chain .ch-dim{color:#8a7a60;font-size:8px}
#wf-social .wf-chain .ch-err{color:#e8564a;font-size:9px;margin:4px 0;line-height:1.35}
#wf-social .wf-chain .ch-ok{color:#9bbc0f;font-size:9px;margin:4px 0}
#wf-social .wf-chain .ch-tier{display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:6px;margin:6px 0}
#wf-social .wf-chain .ch-card{background:#120c06;border:1px solid #8a5a2b;padding:6px;cursor:pointer;font-size:9px;min-height:64px}
#wf-social .wf-chain .ch-card:hover{border-color:#ffd84a}
#wf-social .wf-chain .ch-card.on{border-color:#9bbc0f;box-shadow:inset 0 0 0 1px #9bbc0f}
#wf-social .wf-chain .ch-card .nm{color:#ffe8a0}
#wf-social .wf-chain .ch-card .rt{color:#9bbc0f;margin-top:3px}
#wf-social .wf-chain .ch-card .mn{color:#8a7a60;margin-top:3px}
#wf-social .wf-chain .ch-lock{background:#0a1e0a;border:1px solid #306230;padding:6px 8px;margin:6px 0;font-size:9px;color:#cfe8a0;line-height:1.4}
#wf-social .wf-chain .ch-hist{font-size:9px;color:#c8b890;padding:2px 0;border-bottom:1px solid #2a1a0c;display:flex;gap:6px}
#wf-social .wf-chain .ch-hist .amt{color:#9bbc0f}
#wf-social .wf-chain .ch-hist .neg{color:#e8a04a}
#wf-social .wf-chain .ec-row{margin:6px 0}
#wf-social .wf-chain .ec-grow{flex:1}
#wf-social .wf-chain .ch-dis{padding:10px 8px;background:#0a0a12;border:1px solid #3a2410;line-height:1.5}
#wf-social .wf-chain .ch-dis .t{color:#ffe8a0;font-size:10px;margin-bottom:4px}
#wf-social .wf-chain .ch-dis p{color:#b8a888;font-size:9px;margin:4px 0}
`;
  document.head.appendChild(s);
}

export class ChainPanel {
  constructor(walletPanel) {
    injectCss();
    const root = socialRoot();
    const p = el('div', 'wf-panel wf-chain'); p.style.display = 'none';
    const t = el('div', 'wf-title', '<span>WAYFARER TOKEN</span>');
    const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', () => this.close());
    t.appendChild(x);
    this.tabsBar = el('div', 'wf-tabs');
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'wf-foot');
    p.append(t, this.tabsBar, this.body, this.foot);
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(p);
    this.el = p; this.titleEl = t.querySelector('span');
    this.tab = 'rates';
    this.tier = null;          // selected stake tier (null = follow current/ min)
    this.amountIn = '';        // raw text from the amount box
    this.msg = ''; this.err = '';
    this.walletPanelInjected = walletPanel || null;
    for (const [id, label] of [['rates', 'Rates'], ['stake', 'Stake'], ['claim', 'Claim'], ['ledger', 'Ledger']]) {
      const b = el('button', '', label);
      b.dataset.tab = id;
      b.addEventListener('click', () => {
        this.tab = id;
        if (id === 'ledger' && chainNet.state.history === null && chainNet.state.enabled) chainNet.loadHistory();
        this.render();
      });
      this.tabsBar.appendChild(b);
    }
    // Re-render on any economy state change; async refresh lands here.
    this.offState = chainNet.on('state', () => { if (this.isOpen) this.render(); });
    this.offWallet = wallet.on('change', () => { if (this.isOpen) this.render(); });
  }

  get isOpen() { return this.el.style.display !== 'none'; }

  open(tab) {
    if (tab) this.tab = tab;
    this.el.style.display = 'flex';
    this.err = ''; this.msg = '';
    this.render();
    // Fire and forget: refresh() never rejects, so an unreachable relay cannot
    // produce an unhandled rejection.
    chainNet.refresh({ history: this.tab === 'ledger' });
    if (this.tab === 'ledger' && chainNet.state.history === null) chainNet.loadHistory();
  }
  close() { this.el.style.display = 'none'; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  destroy() {
    try { this.offState?.(); } catch { /* ignore */ }
    try { this.offWallet?.(); } catch { /* ignore */ }
    this.el.remove();
  }

  // The one place this panel does IO. Errors become text, never exceptions.
  async act(fn) {
    if (chainNet.state.busy) return;
    this.msg = ''; this.err = '';
    this.render();
    let res;
    try { res = await fn(); } catch { res = { ok: false, message: describe('unreachable') }; }
    if (res && res.ok) this.msg = res.message || 'Done.';
    else this.err = (res && res.message) || describe(res && res.code) || 'That did not work.';
    this.render();
  }

  // The wallet panel is created the first time the player asks for it — never
  // in a constructor, never on open, and it is only ever opened by a click.
  walletPanel() {
    if (!this.walletPanelInjected) this.walletPanelInjected = new WalletPanel();
    return this.walletPanelInjected;
  }
  openWalletPanel() {
    try { this.walletPanel().open(); } catch { this.err = 'The wallet panel is unavailable in this browser.'; this.render(); }
  }

  // ── rendering ──────────────────────────────────────────────────────────────
  render() {
    const st = chainNet.state;
    this.titleEl.textContent = `WAYFARER TOKEN · ${fmtTokens(st.balances.wayfarer)}`;
    for (const b of this.tabsBar.querySelectorAll('button')) b.classList.toggle('wf-on', b.dataset.tab === this.tab);
    this.body.innerHTML = ''; this.foot.innerHTML = '';
    this.renderBalances(st);
    if (this.tab === 'stake') this.renderStake(st);
    else if (this.tab === 'claim') this.renderClaim(st);
    else if (this.tab === 'ledger') this.renderLedger(st);
    else this.renderRates(st);
    if (this.err) this.body.appendChild(el('div', 'ch-err', escapeHtml(this.err)));
    if (this.msg) this.body.appendChild(el('div', 'ch-ok', escapeHtml(this.msg)));
    const ref = el('button', 'wf-ghost', st.refreshing ? '…' : 'Refresh');
    ref.disabled = !!st.refreshing;
    ref.addEventListener('click', () => { chainNet.refresh({ history: this.tab === 'ledger' }); });
    this.foot.append(el('span', 'ch-dim', statusLine(st)), el('span', 'ec-grow'), ref);
  }

  renderBalances(st) {
    const b = this.body;
    const row = el('div', 'ch-bal');
    row.appendChild(el('div', 'g', `<b>${fmtGold(st.balances.gold)}</b><span class="l">GOLD (ledger)</span>`));
    row.appendChild(el('div', '', `<b>${fmtTokens(st.balances.wayfarer)}</b><span class="l">WAYFARER</span>`));
    b.appendChild(row);
    if (st.enabled) {
      const s = st.stake;
      const staked = s.amountRaw > 0 && s.tier !== 'none';
      b.appendChild(el('div', 'ch-lock',
        staked
          ? `Staked: <b>${fmtTokens(s.amountRaw)} WAYFARER</b> on <b>${escapeHtml(tierLabel(st, s.tier))}</b><br>` +
            (s.unlockAt
              ? (s.unlockAt > Date.now()
                ? `Locked until ${escapeHtml(fmtWhen(s.unlockAt))} (${fmtLeft(s.unlockAt - Date.now())} left).`
                : `Lock ended ${escapeHtml(fmtWhen(s.unlockAt))}.`)
              : 'No lock period reported.')
          : 'No stake on this device.'));
    } else if (st.checked) {
      b.appendChild(el('div', 'ch-dim', 'Balances shown are the relay ledger; with the economy off they read zero.'));
    }
  }

  renderRates(st) {
    const b = this.body;
    if (!st.enabled) this.renderDisabled(b, st);
    const rows = st.rates || [];
    if (!rows.length) {
      if (st.enabled) b.appendChild(el('div', 'ch-dim', st.refreshing ? 'Loading the rate sheet…' : 'The relay served no rate sheet.'));
      return;
    }
    b.appendChild(el('div', 'ch-h', 'PUBLISHED RATES'));
    b.appendChild(el('div', 'ch-note', 'The rate below is the <b>effective year-1 rate</b> — what a one-year lock actually pays. It is not the nominal APR: returns taper as the emission budget is spent.'));
    b.appendChild(el('div', 'ch-row', '<span class="n"><b>Tier</b></span><span>Min lock</span><span>Lock</span><span class="ch-rate">Year 1</span>'));
    for (const r of rows) {
      const line = el('div', 'ch-row');
      line.innerHTML =
        `<span class="n">${escapeHtml(r.label)}${r.id === 'none' ? '' : ` <span class="ch-dim">(${escapeHtml(r.id)})</span>`}</span>` +
        `<span>${r.minLockRaw > 0 ? `${fmtTokens(r.minLockRaw)}` : '—'}</span>` +
        `<span>${r.lockDays > 0 ? `${r.lockDays}d` : '—'}</span>` +
        `<span class="ch-rate">${fmtRate(r.effectiveYear1Bps)}</span>`;
      b.appendChild(line);
      if (r.id !== 'none' && r.idleMultiplier > 1) {
        b.appendChild(el('div', 'ch-dim', `+${Math.round((r.idleMultiplier - 1) * 100)}% idle gold${r.capBonusHours ? `, +${r.capBonusHours}h idle cap` : ''}`));
      }
    }
    if (st.taper) b.appendChild(el('div', 'ch-note', escapeHtml(st.taper)));
    if (st.mint || st.cluster) {
      b.appendChild(el('div', 'ch-h', 'RELAY'));
      if (st.cluster) b.appendChild(el('div', 'ch-row', `<span class="n">Cluster</span><span>${escapeHtml(st.cluster)}</span>`));
      if (st.mint) b.appendChild(el('div', 'ch-row', `<span class="n">Mint</span><span class="ch-dim">${escapeHtml(short(st.mint))}</span>`));
      if (st.rewardsWallet) b.appendChild(el('div', 'ch-row', `<span class="n">Rewards wallet</span><span class="ch-dim">${escapeHtml(short(st.rewardsWallet))}</span>`));
      if (st.treasuryWallet) b.appendChild(el('div', 'ch-row', `<span class="n">Treasury</span><span class="ch-dim">${escapeHtml(short(st.treasuryWallet))}</span>`));
    }
  }

  // The calm state: one sentence about why, one about what still works.
  // Before the first answer lands we say so rather than guessing.
  renderDisabled(b, st) {
    const box = el('div', 'ch-dis');
    if (!st.checked) {
      box.appendChild(el('div', 't', 'Checking the relay…'));
      box.appendChild(el('p', '', 'This panel only talks to the relay when you open it. Nothing here blocks the game while it answers.'));
      b.appendChild(box);
      return;
    }
    const t = st.reason === 'unconfigured' ? 'Not configured on this relay' : 'Not enabled on this relay';
    box.appendChild(el('div', 't', t));
    box.appendChild(el('p', '', st.reason === 'relay_unreachable'
      ? 'No relay answered just now, so there is nothing to stake or claim. Solo play, gold, saves, co-op, Marks and your character are unaffected.'
      : 'Staking and claiming are switched off on this relay. Solo play, gold, saves, co-op, Marks and your character are unaffected.'));
    if (st.code && describe(st.code)) box.appendChild(el('p', '', escapeHtml(describe(st.code))));
    box.appendChild(el('p', '', 'Nothing here blocks the game: this panel only ever talks to the relay when you open it.'));
    b.appendChild(box);
  }

  renderStake(st) {
    const b = this.body;
    if (!st.enabled) { this.renderDisabled(b, st); return; }
    if (!st.flags.stake) { b.appendChild(el('div', 'ch-note', 'Staking is switched off on this relay.')); return; }
    const current = st.stake.tier !== 'none' ? st.stake.tier : null;
    const selected = this.tier || current || 't1';
    const minRaw = chainNet.minLockRaw(selected);
    b.appendChild(el('div', 'ch-h', 'STAKE'));
    b.appendChild(el('div', 'ch-note', 'Lock WAYFARER to raise the idle gold rate and cap. The rate is the effective year-1 rate (what the lock actually pays) — the relay enforces the real minimum and lock period.'));
    const grid = el('div', 'ch-tier');
    for (const id of TIER_ORDER.filter((t) => t !== 'none')) {
      const r = chainNet.rateRow(id) || { id, label: id, minLockRaw: chainNet.minLockRaw(id), lockDays: 0, effectiveYear1Bps: null };
      const card = el('div', `ch-card${selected === id ? ' on' : ''}`);
      card.innerHTML = `<div class="nm">${escapeHtml(r.label || id)}</div>` +
        `<div class="rt">${fmtRate(r.effectiveYear1Bps)}</div>` +
        `<div class="mn">min ${fmtTokens(r.minLockRaw || chainNet.minLockRaw(id))}${r.lockDays ? ` · ${r.lockDays}d` : ''}</div>`;
      card.addEventListener('click', () => { this.tier = id; this.render(); });
      grid.appendChild(card);
    }
    b.appendChild(grid);
    const row = el('div', 'ec-row');
    const amtEl = el('input');
    amtEl.type = 'text'; amtEl.inputMode = 'numeric'; amtEl.size = 10;
    amtEl.placeholder = String(Math.round(minRaw / 10 ** 6));
    amtEl.value = this.amountIn || amtEl.placeholder;
    amtEl.title = 'WAYFARER to lock';
    amtEl.addEventListener('input', () => { this.amountIn = amtEl.value; });
    const btn = el('button', '', st.busy ? '…' : `Stake ${escapeHtml(selected)}`);
    btn.disabled = !!st.busy;
    btn.addEventListener('click', () => this.submitStake(selected, minRaw));
    const un = el('button', 'wf-ghost', 'Unstake');
    un.disabled = !!st.busy || !(st.stake.amountRaw > 0);
    un.addEventListener('click', () => this.act(() => chainNet.doUnstake()));
    row.append(amtEl, el('span', 'ch-dim', 'WAYFARER'), btn, un);
    b.appendChild(row);
    if (st.stake.amountRaw > 0 && st.stake.unlockAt > Date.now()) {
      b.appendChild(el('div', 'ch-note', `Your ${escapeHtml(st.stake.tier)} stake is locked for another ${fmtLeft(st.stake.unlockAt - Date.now())}. An early unstake is refused by the relay, not by this box.`));
    }
    b.appendChild(el('div', 'ch-dim', 'The minimum above is a courtesy check only — the relay re-checks it and is the authority.'));
  }

  async submitStake(tier, minRaw) {
    const text = String(this.amountIn || '').trim().replace(/,/g, '');
    const whole = Number(text);
    if (!text || !Number.isFinite(whole) || whole <= 0 || Math.round(whole) !== whole) {
      this.err = 'Enter a whole number of WAYFARER to lock.'; this.render(); return;
    }
    const raw = Math.round(whole * 10 ** 6);
    if (raw < minRaw) {
      this.err = `${tier} needs at least ${fmtTokens(minRaw)} WAYFARER.`; this.render(); return;
    }
    const bal = chainNet.state.balances.wayfarer;
    // bal 0 is indistinguishable from "the relay gave us nothing": let the server decide then.
    if (bal > 0 && raw > bal) {
      this.err = `That is more than your WAYFARER balance (${fmtTokens(bal)}).`; this.render(); return;
    }
    await this.act(() => chainNet.doStake(tier, raw));
  }

  renderClaim(st) {
    const b = this.body;
    if (!st.enabled) { this.renderDisabled(b, st); return; }
    if (!st.flags.claim) {
      b.appendChild(el('div', 'ch-note', 'Claims are switched off on this relay. Nothing is signed and nothing moves.'));
      return;
    }
    b.appendChild(el('div', 'ch-h', 'CLAIM'));
    b.appendChild(el('div', 'ch-note', 'The relay settles a claim from its own ledger and pays the wallet this device has proven it controls. This game never asks your wallet to sign or send anything.'));
    const linked = st.linked || !!wallet.state.linked;
    const addr = st.short || wallet.shortAddress() || '';
    if (linked) {
      b.appendChild(el('div', 'ch-row', `<span class="n">Payout wallet</span><span>${escapeHtml(addr || 'linked')}</span>`));
    } else {
      b.appendChild(el('div', 'ch-note', 'No wallet is linked to this device, so there is nowhere for a payout to go. Linking is optional, free, and never asked for until you open the Wallet panel.'));
      const wrow = el('div', 'ec-row');
      const open = el('button', '', 'Open the Wallet panel');
      open.addEventListener('click', () => this.openWalletPanel());
      wrow.appendChild(open);
      b.appendChild(wrow);
      b.appendChild(el('div', 'ch-dim', 'Opened only by this click — the token panel never prompts for a wallet on its own.'));
    }
    b.appendChild(el('div', 'ch-row', `<span class="n">Ledger balance</span><span class="ch-rate">${fmtTokens(st.balances.wayfarer)} WAYFARER</span>`));
    if (st.minClaimRaw) b.appendChild(el('div', 'ch-row', `<span class="n">Relay dust floor</span><span>${fmtTokens(st.minClaimRaw)} WAYFARER</span>`));
    if (st.flags.dryRun) b.appendChild(el('div', 'ch-note', 'This relay is in dry run: a claim is recorded but nothing is signed.'));
    else if (!st.flags.payouts) b.appendChild(el('div', 'ch-note', 'Payout signing is off on this relay, so a claim may be recorded without a transfer.'));
    const row = el('div', 'ec-row');
    const btn = el('button', '', st.busy ? '…' : 'Claim to my linked wallet');
    btn.disabled = !!st.busy || !linked;
    btn.addEventListener('click', () => this.act(() => chainNet.doClaim()));
    row.appendChild(btn);
    b.appendChild(row);
    if (st.address) b.appendChild(el('div', 'ch-dim', `Relay-side destination: ${escapeHtml(short(st.address))} (display only — this panel never sends an address).`));
  }

  renderLedger(st) {
    const b = this.body;
    if (!st.enabled) { this.renderDisabled(b, st); return; }
    b.appendChild(el('div', 'ch-h', 'RECENT LEDGER'));
    if (st.history === null) { b.appendChild(el('div', 'ch-dim', 'Loading…')); return; }
    if (!st.history.length) { b.appendChild(el('div', 'ch-dim', 'No ledger entries yet. Earnings appear here as you play and stake.')); return; }
    for (const e of st.history.slice(0, 20)) {
      const pos = e.amount >= 0;
      const line = el('div', 'ch-hist');
      line.innerHTML = `<span class="${pos ? 'amt' : 'neg'}">${pos ? '+' : '−'}${e.resource === 'gold' ? fmtGold(Math.abs(e.amount)) : fmtTokens(Math.abs(e.amount))} ${escapeHtml(e.resource.toUpperCase())}</span>` +
        `<span class="n">${escapeHtml(e.reason)}</span>` +
        `<span class="ch-dim">${escapeHtml(e.at ? fmtWhen(e.at) : '')}</span>`;
      b.appendChild(line);
    }
  }
}

// ── module-level formatting helpers ──────────────────────────────────────────
// Wayfarer amounts are integer base units (6 decimals) on both sides; gold is
// whole gold. Display only, floor, never a float.
function fmtTokens(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Math.floor(n / 10 ** 6).toLocaleString('en-US');
}
const fmtGold = (n) => Math.floor(Number(n) || 0).toLocaleString('en-US');
function fmtRate(bps) {
  return typeof bps === 'number' && Number.isFinite(bps) ? `${(bps / 100).toFixed(2)}%/yr` : '—';
}
const fmtWhen = (ts) => (ts ? new Date(ts).toLocaleString() : '');
const short = (s) => (typeof s === 'string' && s.length > 12 ? `${s.slice(0, 4)}…${s.slice(-4)}` : String(s || ''));
function tierLabel(st, id) {
  const r = chainNet.rateRow(id);
  return r?.label || (id === 'none' ? 'No stake' : String(id).toUpperCase());
}
function statusLine(st) {
  if (!st.checked) return 'Checking the relay…';
  if (!st.reachable) return 'Relay unreachable — the game is unaffected.';
  if (!st.enabled) return st.reason === 'unconfigured' ? 'No chain configured on this relay.' : 'Token economy not enabled on this relay.';
  if (st.code === 'bad_token') return 'No device profile yet — play once and reload.';
  if (st.flags.dryRun) return 'Live — claims are dry-run.';
  return 'Token economy live.';
}

// ── discoverability WITHOUT pressure ─────────────────────────────────────────
// One tiny, cheap, side-effect-free helper for the in-game HUD/menu (never the
// title screen, never onboarding). It does NO IO, opens nothing, prompts for
// nothing, and returns available:false — not an error — whenever the relay is
// unreachable, the economy is off, or nothing has been checked yet. A curious
// player notices it; an uninterested one never has to.
export function chainHint() {
  try {
    const st = chainNet.state;
    // PLAY FIRST (owner rule): the token surface does not exist for a player until
    // they have CONNECTED A WALLET. Before that this returns nothing at all — not
    // "disabled", not a teaser, not a locked icon, INVISIBLE — so the pre-wallet
    // experience is a complete, finished, gold-only game.
    const linked = !!(st.balances && (st.balances.linked || st.balances.address));
    if (!linked) return { available: false, text: '', hint: '' };
    const available = !!(st.checked && st.reachable && st.enabled);
    if (!available) return { available: false, text: '', hint: 'The WAYFARER token economy is not available here.' };
    const key = input.labelFor('chain');
    const k = key && key !== '--' ? `  (${key})` : '';
    return {
      available: true,
      text: `WAYFARER ${fmtTokens(st.balances.wayfarer)}${k}`,
      hint: 'Optional token economy — open it for rates, staking and claims. Nothing here is required to play.',
    };
  } catch {
    return { available: false, text: '', hint: '' };
  }
}
export const chainPill = chainHint;   // alias: the shell may render it as a small HUD marker

// ── entry points for the shell ───────────────────────────────────────────────
// installChainPanel(scene) is the single entry point the shell calls (it mirrors
// installMarksUI). It creates the panel and registers the hotkey + Esc/B closer.
// Pass keys: [] to wire the hotkey by hand instead.
//
// This panel is HIDDEN CHROME: it is never mounted on the title/login screen,
// never auto-opens, is not part of onboarding, and is never required by any
// gate. A brand-new player reaches gameplay without ever seeing it.
let INSTANCE = null;

export function installChainPanel(uiScene, { keys = ['KeyT'] } = {}) {
  socialRoot();
  const panel = new ChainPanel();
  const offs = [];
  if (Array.isArray(keys) && keys.length) {
    const offAction = input.registerAction({ id: 'chain', label: 'WAYFARER token', group: 'Panels', keys, gameplay: true });
    if (typeof offAction === 'function') offs.push(offAction);
    offs.push(input.on('chain', () => { panel.toggle(); return true; }, { scene: uiScene }));
  }
  offs.push(input.addCloser({
    id: 'chain',
    priority: 950,
    isOpen: () => panel.isOpen,
    close: () => panel.close(),
    scene: uiScene,
  }));
  const api = {
    panel,
    open: (tab) => panel.open(tab),
    close: () => panel.close(),
    toggle: () => panel.toggle(),
    get isOpen() { return panel.isOpen; },
    anyOpen: () => panel.isOpen,
    hint: chainHint,
    destroy() {
      offs.forEach((o) => { try { o(); } catch { /* ignore */ } });
      panel.destroy();
      if (INSTANCE === api) INSTANCE = null;
    },
  };
  if (uiScene?.events?.once) uiScene.events.once('shutdown', () => api.destroy());
  INSTANCE = api;
  if (typeof window !== 'undefined') window.__chainUI = api;
  return api;
}

export const getChainPanel = () => INSTANCE;
export function openChainPanel(tab) { return INSTANCE ? INSTANCE.open(tab) : null; }
export function closeChainPanel() { return INSTANCE ? INSTANCE.close() : null; }
export function toggleChainPanel() { return INSTANCE ? INSTANCE.toggle() : null; }
export function isChainPanelOpen() { return !!INSTANCE?.isOpen; }


