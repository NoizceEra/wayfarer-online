import { agentsNet } from '../net/agentsNet.js';
import { bus, Events } from '../core/events.js';
import { audio } from '../systems/audio.js';
import { econ } from '../net/economyNet.js';

// Player-facing panel for the autonomous agent system (docs/AGENT_CLIENT.md).
//
// Where a player sees their OWN agent: the live action/zone, gather + kill
// counters, accumulated SOL, and the CLAIM button. Everything is driven by the
// three owner-only server messages via agentsNet — no polling loop; the panel
// subscribes on open and re-renders on each event.
//
// Honesty rules baked in here:
//   • eligibility shows the server's EXACT reason; the `unconfigured` state is
//     said plainly ("not set up on this server") and is never dressed up as a
//     balance shortfall.
//   • the CLAIM button is DISABLED unless the server reports the claim path is
//     enabled. Default (nothing received / offline) is disabled — the button
//     reflects the server, it never pretends a payout is possible.
//
// Colour/font rule: Solana palette only; Silkscreen labels, PixelifySans body.
const SOL = {
  green: '#14F195', purple: '#9945FF', cyan: '#03E1FF', magenta: '#DC1FFF',
  white: '#E1E8F0', muted: '#6B7A99',
  bgN: 0x0a0e1a, greenN: 0x14f195, purpleN: 0x9945ff, cyanN: 0x03e1ff,
  bar: 0x10182e, line: 0x2a3350, offN: 0x1a2137,
};
const LABEL = '"Silkscreen", monospace';
const BODY = '"PixelifySans", "Silkscreen", monospace';
const L = (size, color, extra = {}) => ({ fontFamily: LABEL, fontSize: `${size}px`, color, ...extra });
const B = (size, color, extra = {}) => ({ fontFamily: BODY, fontSize: `${size}px`, color, ...extra });

// The wire contract carries no separate "claim enabled" flag, so the server's
// `eligible` bit is the signal that the claim path is live; a claim-side reason
// (claim_disabled / unconfigured / nothing_to_claim) keeps it off regardless.
const CLAIM_OFF = /claim_disabled|claims_disabled|unconfigured|nothing_to_claim/i;
const claimAllowed = (e) => e?.eligible === true && !CLAIM_OFF.test(String(e?.reason || ''));

const num = (v) => (Number.isFinite(+v) ? +v : NaN);
function fmtNum(v, maxFrac = 6) {
  const n = num(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: maxFrac });
}
function fmtUsd(v) {
  const n = num(v);
  return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
}
function fmtDuration(ms) {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
function fmtGathers(g) {
  if (!g || typeof g !== 'object') return { total: 0, detail: '—' };
  const parts = []; let total = 0;
  for (const [k, v] of Object.entries(g)) { const n = Number(v) || 0; total += n; parts.push(`${k} ${n}`); }
  return { total, detail: parts.length ? parts.slice(0, 3).join(' · ') : '—' };
}
// Humanise a server reason. Unknown reasons are shown verbatim so the player
// always sees the exact code; the known ones get a plain sentence.
function reasonLine(e) {
  const r = String(e?.reason || '').trim();
  const low = r.toLowerCase();
  if (!r || low === 'ok' || low === 'eligible' || low === 'enabled') return null;
  // Honest "unconfigured" first: the feature simply is not set up here. This is
  // never dressed up as a balance shortfall.
  if (low.includes('unconfigured') || low.includes('not_configured') || low.includes('not configured')) {
    return "Agents aren't configured on this server yet — this is not about your balance.";
  }
  if (low === 'claim_disabled' || low === 'claims_disabled') {
    return 'The SOL claim path is disabled on this server — it is off by default.';
  }
  // A holding requirement (whatever the server's code): state the exact numbers.
  const held = num(e?.held), req = num(e?.requiredUsd);
  if (Number.isFinite(req) && req > 0) {
    return `Requires holding $${fmtUsd(req)} USD of the token — you hold $${fmtUsd(Number.isFinite(held) ? held : 0)}.`;
  }
  if (low === 'nothing_to_claim') return 'Nothing accumulated to claim yet.';
  if (low === 'below_min') return 'Below the minimum claim size.';
  return r;
}
function claimFailText(reason) {
  const r = String(reason || '').trim();
  return ({
    offline: 'you are offline',
    no_response: 'no response from the server',
    claim_disabled: 'claims are disabled on this server',
    unconfigured: 'the payout path is not configured',
    nothing_to_claim: 'nothing to claim',
    below_min: 'below the minimum claim size',
  }[r] || r || 'unknown error');
}

export class AgentPanel {
  constructor(scene) {
    this.scene = scene;
    this.container = null;
    this.unsubs = [];
    this.claimTimer = null;
    this.pending = false;
    this.claimResult = null;
    // Seed from anything agentsNet already received before the panel opened.
    const s = agentsNet.state;
    this.entitlement = s.entitlement;
    this.agent = s.agent;
    this.lastClaim = s.lastClaim;
    this.hireling = s.hireling;
    this.hirelingOptions = s.hirelingOptions || [];
    this.hirePending = false;
    this.hireCurrency = 'gold';
    this.hireTimer = null;
    this.hireResult = s.lastHire;
  }

  get visible() { return !!this.container; }
  get isOpen() { return !!this.container; }

  toggle() { if (this.visible) this.close(); else this.open(); }
  open() {
    if (this.visible) return;
    if (!this.build()) return;
    audio.play?.('ui', 0.5);
    const apply = {
      entitlement: (m) => this.applyEntitlement(m),
      state: (m) => this.applyState(m),
      claim: (m) => this.applyClaimResult(m),
      hireState: (m) => this.applyHireState(m),
      hireResult: (m) => this.applyHireResult(m),
    };
    this.unsubs = [
      agentsNet.onEntitlement(apply.entitlement),
      agentsNet.onState(apply.state),
      agentsNet.onClaimResult(apply.claim),
      agentsNet.onHireState(apply.hireState),
      agentsNet.onHireResult(apply.hireResult),
      agentsNet.onAgents(() => this.render()),
      econ.on('error', (m) => this.onHireError(m)),
      econ.on('sync', () => this.render()),
      econ.on('status', () => this.render()),
    ];
    agentsNet.requestHirelingState();
    this.render();
  }
  close() {
    this._clearTimer();
    if (this.hireTimer) clearTimeout(this.hireTimer);
    this.hireTimer = null;
    for (const u of this.unsubs) { try { u(); } catch { /* gone */ } }
    this.unsubs = [];
    if (!this.container) return;
    try { this.container.destroy(); } catch { /* gone */ }
    this.container = null;
    this.text = null;
    this.claimBtn = null;
    this.hireBtns = null;
  }
  destroy() { this.close(); }

  // ─── state application (also the entry point used by tests) ────────────
  applyEntitlement(m) { this.entitlement = m && typeof m === 'object' ? m : null; this.render(); }
  applyState(m) { this.agent = m && typeof m === 'object' ? m : null; this.render(); }
  applyHireState(m) {
    this.hireling = m?.agent || null;
    this.hirelingOptions = Array.isArray(m?.tiers) ? m.tiers : this.hirelingOptions;
    this.render();
  }
  applyHireResult(m) {
    this.hirePending = false;
    if (this.hireTimer) clearTimeout(this.hireTimer);
    this.hireTimer = null;
    this.hireResult = m && typeof m === 'object' ? m : null;
    if (m?.ok) this.hireling = m.agent || this.hireling;
    if (Array.isArray(m?.tiers)) this.hirelingOptions = m.tiers;
    this.render();
  }
  onHireError(m) {
    if (!this.hirePending) return;
    this.hirePending = false;
    if (this.hireTimer) clearTimeout(this.hireTimer);
    this.hireTimer = null;
    this.hireResult = { ok: false, reason: m?.msg || 'Hire request failed.' };
    this.render();
  }
  hire(tier) {
    if (this.hirePending || this.hireling || !econ.usable) return;
    audio.play?.('ui', 0.55);
    this.hirePending = true;
    this.hireResult = null;
    this.render();
    const sent = econ.send('agent-hire', { tier, currency: this.hireCurrency }, { rev: true, sync: true });
    if (!sent) { this.hirePending = false; this.render(); return; }
    this.hireTimer = setTimeout(() => {
      if (!this.hirePending) return;
      this.hirePending = false;
      this.hireResult = { ok: false, reason: 'No response from the server.' };
      this.render();
    }, 8000);
  }
  applyClaimResult(m) {
    this._clearTimer();
    this.pending = false;
    this.lastClaim = m && typeof m === 'object' ? m : null;
    this.claimResult = this.lastClaim;
    const ok = this.claimResult?.ok === true;
    bus.emit(Events.TOAST, {
      title: 'Agent claim',
      text: ok ? `Claimed ${fmtNum(this.claimResult.amount)} SOL` : `Claim failed — ${claimFailText(this.claimResult?.reason)}`,
      color: ok ? SOL.green : '#ff9a90',
    });
    this.render();
  }

  onClaim() {
    if (this.pending || !claimAllowed(this.entitlement)) return;
    audio.play?.('ui', 0.6);
    this.pending = true;
    this.claimResult = null;
    this.render();
    const sent = agentsNet.claim();
    if (!sent) {
      this.pending = false;
      this.claimResult = { ok: false, reason: 'offline' };
      this.render();
      return;
    }
    // A disabled/unconfigured path answers with agent-claim-result; if nothing
    // comes back, don't leave the button stuck spinning.
    this.claimTimer = setTimeout(() => {
      if (!this.pending) return;
      this.pending = false;
      this.claimResult = { ok: false, reason: 'no_response' };
      this.render();
    }, 8000);
  }

  _clearTimer() { if (this.claimTimer) { clearTimeout(this.claimTimer); this.claimTimer = null; } }

  // ─── build ─────────────────────────────────────────────────────────────
  build() {
    const s = this.scene;
    if (!s?.add?.container) return false;
    try {
      const { w: VW, h: VH } = s.view ? s.view() : { w: s.scale.width, h: s.scale.height };
      const narrow = VW <= 560; // <=560px: single column, full-width panel
      const pw = Math.min(VW - 16, narrow ? 340 : 372);
      const ph = Math.min(VH - 12, 540);
      const c = this.container = s.add.container(Math.round(VW / 2), Math.round(VH / 2)).setDepth(230);
      const left = -pw / 2, right = pw / 2, pad = 12;

      // click-outside close (swallows world clicks)
      const dim = s.add.rectangle(0, 0, VW * 2, VH * 2, 0x000000, 0.62).setInteractive();
      dim.on('pointerdown', () => this.close());
      const bg = s.add.rectangle(0, 0, pw, ph, SOL.bgN, 0.97).setStrokeStyle(2, SOL.greenN).setInteractive();
      bg.on('pointerdown', (_p, _lx, _ly, ev) => ev?.stopPropagation?.());
      const bar = s.add.rectangle(0, -ph / 2 + 15, pw - 8, 26, SOL.bar, 1);
      const title = s.add.text(left + pad, -ph / 2 + 15, 'AGENT & COMPANIONS', L(10, SOL.green, { fontStyle: 'bold' })).setOrigin(0, 0.5);
      const x = s.add.text(right - pad, -ph / 2 + 15, 'X', L(12, '#ff7a7a', { fontStyle: 'bold' })).setOrigin(0.5).setInteractive({ useHandCursor: true });
      x.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); audio.play?.('ui', 0.5); this.close(); });
      c.add([dim, bg, bar, title, x]);

      const T = this.text = {};
      let y = -ph / 2 + 36;

      T.status = s.add.text(left + pad, y, 'Checking agent status…', L(9, SOL.muted)).setOrigin(0, 0.5);
      c.add(T.status); y += 17;

      T.reason = s.add.text(left + pad, y, '', B(9, SOL.white, { wordWrap: { width: pw - pad * 2 }, lineSpacing: 2 })).setOrigin(0, 0);
      c.add(T.reason); y += 32;

      T.reasonCode = s.add.text(left + pad, y, '', L(7, SOL.muted)).setOrigin(0, 0);
      c.add(T.reasonCode); y += 15;

      c.add(this._divider(s, left, right, y)); y += 12;

      T.name = s.add.text(left + pad, y, '', L(9, SOL.cyan)).setOrigin(0, 0);
      c.add(T.name); y += 16;

      for (const key of ['action', 'zone']) {
        T[key + 'K'] = s.add.text(left + pad, y, key.toUpperCase(), L(8, SOL.muted)).setOrigin(0, 0);
        T[key] = s.add.text(right - pad, y, '—', B(10, SOL.white)).setOrigin(1, 0);
        c.add([T[key + 'K'], T[key]]); y += 17;
      }

      c.add(this._divider(s, left, right, y)); y += 12;

      T.gatheredK = s.add.text(left + pad, y, 'GATHERED', L(8, SOL.muted)).setOrigin(0, 0);
      T.gathered = s.add.text(right - pad, y, '—', B(10, SOL.white)).setOrigin(1, 0);
      c.add([T.gatheredK, T.gathered]); y += 18;

      // Counter grid: 2 columns on desktop, 1 column at <=560px.
      const cols = narrow ? 1 : 2;
      const cellW = (pw - pad * 2) / cols;
      T.cells = [];
      const cells = [['KILLS', 'kills'], ['SOL FOUND', 'sol'], ['UPTIME', 'uptime'], ['ACCUMULATED', 'accum']];
      cells.forEach(([label, key], i) => {
        const cx = left + pad + (i % cols) * cellW;
        const cy = y + Math.floor(i / cols) * 30;
        const k = s.add.text(cx, cy, label, L(7, SOL.muted)).setOrigin(0, 0);
        const v = s.add.text(cx, cy + 11, '—', B(12, key === 'sol' || key === 'accum' ? SOL.green : SOL.white)).setOrigin(0, 0);
        c.add([k, v]);
        T.cells.push({ key, v });
      });
      y += Math.ceil(cells.length / cols) * 30 + 4;

      c.add(this._divider(s, left, right, y)); y += 14;

      // Claim button: disabled unless the server reports the claim path enabled.
      const bw = Math.min(pw - pad * 2, 200), bh = 28;
      const by = y + bh / 2;
      const btnBg = s.add.rectangle(0, by, bw, bh, SOL.line, 1).setStrokeStyle(1, 0x1a1a22);
      const btnTx = s.add.text(0, by, 'CLAIM DISABLED', L(10, SOL.muted, { fontStyle: 'bold' })).setOrigin(0.5);
      btnBg.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); this.onClaim(); });
      btnBg.disableInteractive();
      this.claimBtn = { bg: btnBg, text: btnTx, w: bw, h: bh };
      c.add([btnBg, btnTx]);
      y = by + bh / 2 + 8;

      T.claimResult = s.add.text(0, y, '', B(9, SOL.muted, { align: 'center', wordWrap: { width: pw - pad * 2 } })).setOrigin(0.5, 0);
      c.add(T.claimResult);

      y += 31;
      c.add(this._divider(s, left, right, y)); y += 12;
      T.hireTitle = s.add.text(left + pad, y, 'HIRE AN AUTONOMOUS COMPANION', L(8, SOL.cyan)).setOrigin(0, 0.5);
      c.add(T.hireTitle); y += 16;
      T.hireStatus = s.add.text(left + pad, y, '', B(8, SOL.cyan)).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      T.hireStatus.on('pointerdown', (_p, _lx, _ly, ev) => {
        ev?.stopPropagation?.();
        if (this.hirePending || this.hireling) return;
        this.hireCurrency = this.hireCurrency === 'gold' ? 'wayfarer' : 'gold';
        audio.play?.('ui', 0.45);
        this.render();
      });
      c.add(T.hireStatus); y += 19;
      const gap = 5, tileW = (pw - pad * 2 - gap * 2) / 3, tileH = 38;
      this.hireBtns = [];
      for (let i = 0; i < 3; i++) {
        const tier = ['scout', 'tactician', 'veteran'][i];
        const x0 = left + pad + i * (tileW + gap) + tileW / 2;
        const bgTile = s.add.rectangle(x0, y + tileH / 2, tileW, tileH, SOL.bar, 1).setStrokeStyle(1, SOL.line);
        const label = s.add.text(x0, y + 11, ['SCOUT', 'TACTICIAN', 'VETERAN'][i], L(7, SOL.white, { align: 'center' })).setOrigin(0.5);
        const price = s.add.text(x0, y + 26, '—', B(8, SOL.green, { align: 'center' })).setOrigin(0.5);
        bgTile.on('pointerdown', (_p, _lx, _ly, ev) => { ev?.stopPropagation?.(); this.hire(tier); });
        this.hireBtns.push({ tier, bg: bgTile, label, price, x: x0, y: y });
        c.add([bgTile, label, price]);
      }
      T.hireResult = s.add.text(0, y + tileH + 8, '', B(8, SOL.muted, { align: 'center', wordWrap: { width: pw - pad * 2 } })).setOrigin(0.5, 0);
      c.add(T.hireResult);

      T.hint = s.add.text(0, ph / 2 - 10, 'WAYFARER here means in-game balance · not an on-chain transfer',
        B(7, SOL.muted, { align: 'center', wordWrap: { width: pw - pad * 2 } })).setOrigin(0.5);
      c.add(T.hint);

      return true;
    } catch (e) {
      console.warn('[AgentPanel] build no-op:', e?.message);
      try { this.container?.destroy(); } catch { /* gone */ }
      this.container = null;
      return false;
    }
  }

  _divider(s, left, right, y) {
    return s.add.rectangle((left + right) / 2, y, right - left - 8, 1, SOL.line, 1).setOrigin(0.5);
  }

  // ─── render (live, no rebuild) ─────────────────────────────────────────
  render() {
    const T = this.text;
    if (!this.container || !T) return;
    try {
      const e = this.entitlement;
      const eligible = e?.eligible === true;

      if (!e) { T.status.setText('Checking wallet-agent eligibility…').setColor(SOL.muted); }
      else if (eligible) { T.status.setText('WALLET AGENT ENTITLED').setColor(SOL.green); }
      else { T.status.setText('WALLET AGENT NOT ENTITLED').setColor(SOL.magenta); }

      const line = !e ? 'Waiting for the server…' : (reasonLine(e) || 'You are eligible to run an agent.');
      T.reason.setText(line).setColor(!e ? SOL.muted : eligible ? SOL.cyan : SOL.white);
      const raw = String(e?.reason || '').trim();
      T.reasonCode.setText(e && raw && raw.toLowerCase() !== 'ok' ? `reason: ${raw}` : '');

      const a = this.agent || {};
      T.name.setText(`AGENT · ${a.name || '—'}`);
      T.action.setText(a.action || 'idle');
      T.zone.setText(a.zone || '—');
      const g = fmtGathers(a.gathers);
      T.gathered.setText(g.detail === '—' ? '—' : `${g.total} · ${g.detail}`);

      const vals = {
        kills: a.kills != null ? fmtNum(a.kills, 0) : '—',
        sol: a.solFound != null ? fmtNum(a.solFound) : '—',
        uptime: a.uptimeMs != null ? fmtDuration(a.uptimeMs) : '—',
        accum: a.solFound != null ? `${fmtNum(a.solFound)} SOL` : '—',
      };
      for (const cell of T.cells) cell.v.setText(vals[cell.key] ?? '—');

      this._renderClaim(e);
      this._renderHirelings();

      const r = this.claimResult;
      if (!r) T.claimResult.setText('');
      else if (r.ok === true) T.claimResult.setText(`Claimed ${fmtNum(r.amount)} SOL.`).setColor(SOL.green);
      else T.claimResult.setText(`Could not claim — ${claimFailText(r.reason)}.`).setColor('#ff9a90');
    } catch (err) {
      console.warn('[AgentPanel] render no-op:', err?.message);
    }
  }

  _renderClaim(e) {
    const b = this.claimBtn;
    if (!b) return;
    const enabled = claimAllowed(e) && !this.pending;
    if (enabled) {
      b.bg.setFillStyle(SOL.greenN, 1).setStrokeStyle(1, 0x1a1a22).setInteractive({ useHandCursor: true });
      b.text.setText('CLAIM SOL').setColor('#0a0e1a');
    } else {
      b.bg.disableInteractive().setFillStyle(SOL.offN, 1).setStrokeStyle(1, SOL.line);
      b.text.setText(this.pending ? 'CLAIMING…' : 'CLAIM DISABLED').setColor(SOL.muted);
    }
  }

  _renderHirelings() {
    if (!this.hireBtns || !this.text?.hireStatus) return;
    const T = this.text;
    const gold = econ.player()?.gold;
    const wayfarer = econ.player()?.wayfarerTokens;
    const options = new Map((this.hirelingOptions || []).map((o) => [o.id, o]));
    if (this.hireling) {
      const h = this.hireling;
      if (h.kind === 'agent') T.hireStatus.setText(`${h.name} · owned autonomous agent already active`).setColor(SOL.green);
      else {
        const minutes = Math.max(1, Math.ceil((h.remainingMs || 0) / 60_000));
        T.hireStatus.setText(`${h.name} · ${String(h.tier || 'scout').toUpperCase()} · ${minutes}m remaining`).setColor(SOL.green);
      }
    } else if (!econ.usable) {
      T.hireStatus.setText('Online saved character required · tap to change payment').setColor(SOL.muted);
    } else {
      const balance = this.hireCurrency === 'wayfarer' ? fmtNum(wayfarer || 0, 0) : fmtNum(gold || 0, 0);
      T.hireStatus.setText(`PAY WITH ${this.hireCurrency === 'wayfarer' ? 'IN-GAME WAYFARER' : 'GOLD'} · ${balance}  ↻`).setColor(this.hireCurrency === 'wayfarer' ? SOL.cyan : SOL.green);
    }
    for (const btn of this.hireBtns) {
      const spec = options.get(btn.tier);
      const price = this.hireCurrency === 'wayfarer' ? spec?.wayfarerCost : spec?.goldCost ?? spec?.cost;
      btn.price.setText(spec ? `${fmtNum(price, 0)}${this.hireCurrency === 'wayfarer' ? ' WF' : 'g'} · ${Math.round(spec.durationMs / 60_000)}m` : 'Unavailable');
      const balance = this.hireCurrency === 'wayfarer' ? wayfarer : gold;
      const affordable = Number.isFinite(+balance) && +balance >= (price ?? Infinity);
      const active = !!(spec && econ.usable && !this.hireling && !this.hirePending && affordable);
      if (active) btn.bg.setFillStyle(SOL.bar, 1).setStrokeStyle(1, SOL.purpleN).setInteractive({ useHandCursor: true });
      else btn.bg.disableInteractive().setFillStyle(SOL.offN, 1).setStrokeStyle(1, SOL.line);
      btn.label.setColor(active ? SOL.white : SOL.muted);
      btn.price.setColor(active ? (this.hireCurrency === 'wayfarer' ? SOL.cyan : SOL.green) : SOL.muted);
    }
    if (!this.hireResult) T.hireResult.setText('');
    else if (this.hireResult.ok) T.hireResult.setText(`${this.hireling?.name || 'Companion'} hired — follows you and adapts to threats.`).setColor(SOL.green);
    else T.hireResult.setText(String(this.hireResult.reason || 'Hire failed.')).setColor('#ff9a90');
    if (this.hirePending) T.hireStatus.setText('Hiring companion…').setColor(SOL.cyan);
  }
}
