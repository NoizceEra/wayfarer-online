import { referral } from '../net/referralNet.js';
import { econ } from '../net/economyNet.js';
import { net } from '../net/NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { loadProgress } from '../core/save.js';
import { el, escapeHtml, panel } from './econDom.js';

// REFER A FRIEND (MailPanel pattern: DOM overlay in #wf-social, Silkscreen,
// Solana palette). Shows the player's referral code with COPY, their invite
// stats (invited / gold earned), an APPLY box for a friend's code while the
// player is level <= 2 and not yet bound, and REFRESH. Payouts land via
// econ-sync {why:'referral'} and pop a toast via Events.REFERRAL_PAID.
const PAL = { bg: '#0A0E1A', green: '#14F195', purple: '#9945FF', cyan: '#03E1FF', white: '#E1E8F0', muted: '#6B7A99' };

let cssDone = false;
function injectCss() {
  if (cssDone) return; cssDone = true;
  const s = el('style');
  s.textContent = `
#ref-cta{position:fixed;left:8px;bottom:44px;z-index:51;pointer-events:auto;cursor:pointer;font:9px "Silkscreen",monospace;color:${PAL.cyan};background:#0A0E1Acc;border:1px solid #1c2c44;padding:2px 6px;border-radius:2px;display:none}
#ref-cta:hover{border-color:${PAL.cyan}}
#ref-cta.on{color:#0A0E1A;background:${PAL.cyan};border-color:${PAL.cyan}}
#wf-social .ec-ref{background:rgba(10,14,26,.94);border-color:#1c2c44;box-shadow:inset 0 0 0 1px #0d1420,0 0 18px #9945FF33;width:min(460px,calc(100vw - 16px))}
#wf-social .ec-ref .wf-title{color:${PAL.white};border-bottom-color:#1c2c44}
#wf-social .ec-ref .wf-x{color:${PAL.muted}}
#wf-social .ref-big{display:flex;flex-direction:column;align-items:center;gap:5px;padding:14px 8px 8px}
#wf-social .ref-code{font-size:26px;letter-spacing:6px;color:${PAL.white};background:#0d1420;border:2px solid ${PAL.green};box-shadow:0 0 12px #14F19555;padding:6px 14px 4px 18px}
#wf-social .ref-lbl{font-size:9px;color:${PAL.muted};letter-spacing:1px}
#wf-social .ref-stats{display:flex;gap:8px;padding:6px 8px}
#wf-social .ref-stat{flex:1;text-align:center;padding:6px 4px;background:#0d1420;border:1px solid #1c2c44}
#wf-social .ref-stat b{display:block;font-size:16px;color:${PAL.green};margin-bottom:3px}
#wf-social .ref-stat span{font-size:8px;color:${PAL.muted}}
#wf-social .ref-stat.pu b{color:${PAL.purple}}
#wf-social .ref-apply{margin:4px 8px 2px;padding:8px;background:#0d1420;border:1px solid #1c2c44}
#wf-social .ref-apply .ref-row{display:flex;gap:4px;margin:4px 0}
#wf-social .ref-apply .ref-row input{flex:1;min-width:0;font-size:14px;letter-spacing:3px;text-align:center;color:${PAL.white};background:#0A0E1A;border-color:#1c2c44;text-transform:uppercase}
#wf-social .ref-apply .ref-row input:focus{border-color:${PAL.cyan}}
#wf-social .ref-apply button{background:transparent;color:${PAL.cyan};box-shadow:none;border:1px solid #1c2c44}
#wf-social .ref-apply button:hover{background:#14F19522;color:${PAL.white};border-color:${PAL.green}}
#wf-social .ref-apply button:active{background:#14F19544}
#wf-social .ref-status{font-size:9px;color:${PAL.muted};padding:2px 10px 6px;min-height:14px}
#wf-social .ref-status.ok{color:${PAL.green}}
#wf-social .ref-status.bad{color:#f4537a}
#wf-social .ref-status .ref-dim{color:#4a5a7a}
#wf-social .ref-note{font-size:8px;color:${PAL.muted};line-height:1.6;padding:0 12px 8px;text-align:center}
#wf-social .ref-lev{color:${PAL.cyan}}
`  ;
  document.head.appendChild(s);
}

export class ReferralPanel {
  constructor() {
    injectCss();
    const { p, title } = panel('ec-ref', 'REFER A FRIEND', () => this.close());
    this.el = p; this.titleEl = title;
    this.body = el('div', 'ec-body');
    this.foot = el('div', 'ec-foot');
    p.append(this.body, this.foot);
    this.applied = false;
    this.offs = [
      referral.on('state', () => { if (this.isOpen) this.render(); }),
      referral.on('status', () => { if (this.isOpen) this.render(); }),
      econ.on('msg', () => { if (this.isOpen) this.render(); }),
    ];
  }

  get isOpen() { return this.el.style.display !== 'none'; }

  open() {
    this.el.style.display = 'flex';
    this.render();
    referral.info(); // pull a fresh state (server also pushes on join)
  }
  close() { this.el.style.display = 'none'; }
  toggle() { if (this.isOpen) this.close(); else this.open(); }

  level() {
    const lv = econ.player()?.level;
    if (Number.isFinite(lv)) return lv;
    const stored = net.name ? loadProgress(net.name) : null;
    return Number.isFinite(stored?.level) ? stored.level : null;
  }

  render() {
    const b = this.body; const f = this.foot;
    b.innerHTML = ''; f.innerHTML = '';
    const st = referral.state;

    if (!referral.online) {
      b.innerHTML = `<div class="wf-empty" style="color:${PAL.muted}">Play Online to use referrals.<br>Choose <i>Play Online</i> on the title screen.</div>`;
      return;
    }
    if (!st) { b.appendChild(el('div', 'wf-empty', 'Loading…')); return; }

    // MY CODE + COPY
    const big = el('div', 'ref-big');
    big.appendChild(el('div', 'ref-lbl', 'MY CODE'));
    const code = el('div', 'ref-code', escapeHtml(st.code || '······'));
    big.appendChild(code);
    const copy = el('button', '', 'COPY');
    copy.addEventListener('click', async () => {
      const ok = await this.copyCode(st.code || '');
      this.status(ok ? `Code copied! Tell your friends to enter it at level ${'≤'} 2.` : 'Copy failed - select the code and copy manually.', ok ? 'ok' : 'bad');
    });
    big.appendChild(copy);
    b.appendChild(big);

    // INVITED / GOLD EARNED / TREASURY
    const stats = el('div', 'ref-stats');
    stats.appendChild(el('div', 'ref-stat', `<b>${st.invited}</b><span>INVITED</span>`));
    stats.appendChild(el('div', 'ref-stat', `<b>${st.goldPaid}</b><span>GOLD EARNED</span>`));
    stats.appendChild(el('div', 'ref-stat pu', `<b>${st.treasuryGold}</b><span>REWARD POOL g</span>`));
    b.appendChild(stats);

    // APPLY box
    const lv = this.level();
    const apply = el('div', 'ref-apply');
    if (st.boundTo) {
      apply.innerHTML = `<div class="ref-status ok">Bound to ${escapeHtml(st.boundTo)}.</div>`;
    } else if (lv !== null && lv > 2) {
      apply.innerHTML = `<div class="ref-status bad" style="min-height:0;padding:4px 2px">Codes can only be entered at level 2 or below.</div>`;
    } else {
      apply.appendChild(el('div', 'ref-lbl', "ENTER A FRIEND'S CODE"));
      const row = el('div', 'ref-row');
      this.input = el('input');
      this.input.placeholder = 'XXXXXX'; this.input.maxLength = 6; this.input.spellcheck = false;
      this.input.addEventListener('input', () => { this.input.value = this.input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6); });
      this.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.apply(); });
      const btn = el('button', '', 'APPLY');
      btn.addEventListener('click', () => this.apply());
      row.append(this.input, btn);
      apply.appendChild(row);
    }
    b.appendChild(apply);

    this.statusEl = el('div', 'ref-status', this.statusMsg || '');
    if (this.statusKind) this.statusEl.classList.add(this.statusKind);
    b.appendChild(this.statusEl);

    b.appendChild(el('div', 'ref-note', `They get <span class="ref-lev">+50g</span> for joining. You get <span class="ref-lev">+150g</span> when they reach level 5 and <span class="ref-lev">+400g</span> at level 10.<br>Rewards are paid from the platform fee pool - never minted.`));

    // REFRESH + close X (panel title already has the X)
    const refresh = el('button', '', 'REFRESH');
    refresh.addEventListener('click', () => { referral.info(); this.status('Refreshing…', ''); });
    f.append(el('span', `ref-dim`, referral.online ? 'ONLINE' : 'OFFLINE'), el('span', 'ec-grow'), refresh);
  }

  async copyCode(text) {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
      throw new Error('no clipboard api');
    } catch {
      // graceful fallback: select the code so Ctrl+C works
      try {
        const range = document.createRange();
        const node = this.el.querySelector('.ref-code');
        if (!node) return false;
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel.removeAllRanges(); sel.addRange(range);
        return document.execCommand?.('copy') === true;
      } catch { return false; }
    }
  }

  status(msg, kind = '') {
    this.statusMsg = msg; this.statusKind = kind;
    if (this.statusEl) { this.statusEl.textContent = msg; this.statusEl.className = `ref-status ${kind}`; }
  }

  apply() {
    const code = (this.input?.value || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { this.status('Codes are 6 letters or digits.', 'bad'); return; }
    referral.apply(code);
    this.status('Entering code…', '');
  }

  destroy() { this.offs.forEach((o) => o()); this.el.remove(); }
}

// Optional HUD entry point for the parent to mount in UIScene (one line):
//   const { mountReferralCta } = await import('../ui/ReferralPanel.js');
//   const refCta = mountReferralCta(() => referralPanel.open());
// Shows 'REFER' next to the mail badge while online; '.on' = has a code to
// share / not bound yet. destroy() removes it.
export function mountReferralCta(onClick) {
  injectCss();
  const cta = el('div'); cta.id = 'ref-cta';
  cta.textContent = 'REFER';
  cta.addEventListener('click', () => { try { onClick(); } catch { /* ignore */ } });
  const draw = () => {
    const on = referral.online;
    cta.style.display = on ? 'block' : 'none';
    const st = referral.state;
    cta.classList.toggle('on', !!(st && !st.boundTo));
    cta.title = st?.code ? `Your referral code: ${st.code}` : 'Refer a friend - earn gold';
  };
  const offs = [
    referral.on('state', draw),
    referral.on('status', draw),
    bus.on(Events.NET_STATUS, draw),
  ];
  draw();
  return {
    el: cta,
    destroy() { offs.forEach((o) => o()); cta.remove(); },
  };
}
