import { wallet, MOBILE_HINT } from '../core/wallet.js';
import { linkWallet, unlinkWallet, claimStub, walletConfig, friendly } from '../net/walletApi.js';
import { el, escapeHtml } from './econDom.js';
import { socialRoot } from './socialDom.js';
import { bus, Events } from '../core/events.js';

// Optional wallet overlay. Fully hidden path: the game never opens this on
// its own. Linking does not change gameplay, gold, items or stats.

function injectCss() {
  if (document.getElementById('wf-wallet-css')) return;
  const s = el('style'); s.id = 'wf-wallet-css';
  s.textContent = `
#wf-social .wf-wallet{left:50%;top:50%;transform:translate(-50%,-50%);width:min(420px,calc(100vw - 16px));max-height:86vh;display:flex;flex-direction:column}
#wf-social .wf-wallet .ec-body{padding:8px 10px;overflow-y:auto;flex:1}
#wf-social .wf-wallet .mk-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin:6px 0}
#wf-social .wf-wallet .mk-note{color:#b8a888;font-size:9px;line-height:1.4;margin:6px 0}
#wf-social .wf-wallet .mk-addr{color:#ffe8a0;font-size:11px}
#wf-social .wf-wallet .mk-err{color:#e8564a;font-size:9px;margin:4px 0}
#wf-social .wf-wallet .mk-ok{color:#9bbc0f;font-size:9px;margin:4px 0}
#wf-social .wf-wchip{position:fixed;right:8px;top:8px;pointer-events:auto;z-index:40;background:rgba(26,16,8,.9);border:2px solid #8a5a2b;color:#cfe8a0;font:9px Silkscreen,monospace;padding:4px 8px;cursor:pointer}
#wf-social .wf-wchip:hover{border-color:#ffd84a;color:#ffe8a0}
`;
  document.head.appendChild(s);
}

export class WalletPanel {
  constructor() {
    injectCss();
    const root = socialRoot();
    const p = el('div', 'wf-panel wf-wallet'); p.style.display = 'none';
    const t = el('div', 'wf-title', '<span>OPTIONAL WALLET</span>');
    const x = el('button', 'wf-ghost wf-x', '✕'); x.addEventListener('click', () => this.close());
    t.appendChild(x);
    this.body = el('div', 'ec-body');
    p.append(t, this.body);
    p.addEventListener('pointerdown', (e) => e.stopPropagation());
    root.appendChild(p);
    this.el = p; this.titleEl = t.querySelector('span');
    this.busy = false; this.msg = ''; this.err = ''; this.flags = null;
    this.offs = [
      wallet.on('change', () => { if (this.isOpen) this.render(); }),
    ];
    walletConfig().then((c) => { if (c?.flags) { this.flags = c.flags; if (this.isOpen) this.render(); } }).catch(() => {});
  }

  get isOpen() { return this.el.style.display !== 'none'; }
  open() { this.el.style.display = 'flex'; this.err = ''; this.msg = ''; this.render(); wallet.restore(); }
  close() { this.el.style.display = 'none'; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }
  destroy() { this.offs.forEach((o) => { try { o(); } catch { /* ignore */ } }); this.el.remove(); this.chip?.remove(); }

  async act(fn) {
    if (this.busy) return;
    this.busy = true; this.err = ''; this.msg = ''; this.render();
    try { await fn(); this.msg = 'Done.'; } catch (e) {
      this.err = friendly(e.code) || e.message || 'That did not work.';
    }
    this.busy = false; this.render();
  }

  render() {
    const b = this.body; b.innerHTML = '';
    const st = wallet.state;
    b.appendChild(el('div', 'mk-note', 'A wallet is <b>optional</b>. You can play the whole game with no account and no wallet. Linking never changes combat, gold, items or stats. This game never asks the wallet to send a transaction — only a free signature that cannot move funds.'));

    if (!wallet.available()) {
      b.appendChild(el('div', 'mk-note', 'No Solana wallet detected in this browser.'));
      if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches) {
        b.appendChild(el('div', 'mk-note', escapeHtml(MOBILE_HINT)));
      } else {
        b.appendChild(el('div', 'mk-note', 'Install Phantom, Backpack or Solflare if you want a cosmetic nameplate later. You do not need one to play.'));
      }
    } else if (!st.connected) {
      const row = el('div', 'mk-row');
      const c = el('button', '', this.busy ? '…' : 'Connect wallet');
      c.disabled = this.busy;
      c.addEventListener('click', () => this.act(() => wallet.connect()));
      row.appendChild(c);
      b.appendChild(row);
    } else {
      b.appendChild(el('div', 'mk-addr', `Connected: ${escapeHtml(wallet.shortAddress())} (${escapeHtml(st.provider || 'wallet')})`));
      b.appendChild(el('div', 'mk-note', st.linked
        ? 'Linked to this device. Cosmetics stay with the character; the wallet is just a nameplate badge.'
        : 'Not linked yet. A signature proves you hold this address. It does not cost anything and cannot move funds.'));
      const row = el('div', 'mk-row');
      if (!st.linked) {
        const link = el('button', '', this.busy ? '…' : 'Link to this device');
        link.disabled = this.busy;
        link.addEventListener('click', () => this.act(() => linkWallet('link')));
        row.appendChild(link);
        const relink = el('button', 'wf-ghost', 'Relink from another device');
        relink.disabled = this.busy;
        relink.addEventListener('click', () => this.act(() => linkWallet('relink')));
        row.appendChild(relink);
      } else {
        const un = el('button', 'wf-danger', 'Unlink');
        un.disabled = this.busy;
        un.addEventListener('click', () => this.act(() => unlinkWallet()));
        row.appendChild(un);
      }
      const disc = el('button', 'wf-ghost', 'Disconnect');
      disc.addEventListener('click', () => this.act(() => wallet.disconnect()));
      row.appendChild(disc);
      b.appendChild(row);
    }

    if (this.flags?.onchainClaim === false) {
      const row = el('div', 'mk-row');
      const claim = el('button', 'wf-ghost', 'Claim rewards (not enabled)');
      claim.addEventListener('click', () => this.act(async () => {
        try { await claimStub(); } catch (e) {
          if (e.code === 'not_enabled' || e.status === 403) {
            this.msg = 'Claims are not enabled. Marks and badges are off-chain cosmetics only.';
            this.err = '';
            return;
          }
          throw e;
        }
      }));
      row.appendChild(claim);
      b.appendChild(row);
    }
    if (this.err) b.appendChild(el('div', 'mk-err', escapeHtml(this.err)));
    if (this.msg) b.appendChild(el('div', 'mk-ok', escapeHtml(this.msg)));
    b.appendChild(el('div', 'mk-note', 'Founder / season frames are off-chain attestations on a linked wallet. They never grant power. Redeemable rewards stay off until counsel signs off — see docs/EARN_AND_COMPLIANCE.md.'));
  }

  // Tiny chip for the title screen. Never auto-opens, never auto-connects.
  mountTitleChip() {
    if (this.chip) return this.chip;
    injectCss();
    const c = el('button', 'wf-wchip', chipLabel());
    c.title = 'Optional wallet — not required to play';
    c.addEventListener('click', () => { bus.emit(Events.SYSTEM, ''); this.open(); });
    socialRoot().appendChild(c);
    this.chip = c;
    const draw = () => { c.textContent = chipLabel(); };
    this.offs.push(wallet.on('change', draw));
    wallet.restore().then(draw);
    return c;
  }
}

function chipLabel() {
  if (wallet.state.linked && wallet.shortAddress()) return `Wallet ${wallet.shortAddress()}`;
  if (wallet.state.connected) return `Wallet ${wallet.shortAddress()}`;
  return 'Wallet (optional)';
}
