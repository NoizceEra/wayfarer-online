import { CONFIG } from '../config.js';
import { net } from './NetworkManager.js';

// ─────────────────────────────────────────────────────────────────────────────
// src/net/chainNet.js — HTTP client for the WAYFARER token economy (server/econ/**).
//
// Same shape as src/net/walletApi.js: the http base is the ws base with the
// scheme swapped, every call has an AbortController timeout, and server error
// codes become friendly sentences.
//
// TWO RULES THIS FILE EXISTS TO ENFORCE
//   1. IDENTITY IS THE DEVICE TOKEN ALREADY IN USE (net.token, minted and kept
//      by NetworkManager / adopted from a recovery-code continue). This module
//      never mints a second identity. The relay resolves the player — and the
//      payout destination — from that one token.
//   2. NO CALL TAKES A WALLET ADDRESS. There is no `address`, no `to`, no
//      `destination` field on any request; safeBody() drops anything that is
//      not on the allow-list. A client cannot choose where a payout goes: the
//      server resolves it from the signature-verified link (docs/BLOCKCHAIN_V1.md
//      §3.4, §6.2). The address the relay reports back is display-only.
//
// NOTHING HERE THROWS. Every function resolves to an envelope
//   { ok, status, code, message, data }
// so the panel — and the game around it — stays alive when the relay is
// unreachable, the economy is off, or this browser has no device profile yet.
//
// ── the surface this client codes against (server/econ/**) ───────────────────
//   GET  /econ/rates      -> { ok, enabled?, rows: [rateRow], taper? }
//   GET  /chain/status    -> { ok, enabled?, configured?, mint?, cluster?,
//                              rewardsWallet?, treasuryWallet?, payoutsEnabled?,
//                              flags?{stake,claim,payouts,walletLink,dryRun} }
//   POST /econ/balance    { token }              -> { ok, balances:{gold,wayfarer},
//                              stake:{tierId,amountRaw,unlockAt}, linked, address, short }
//   POST /econ/stake      { token, tier, amountRaw } -> { ok, ... }
//   POST /econ/unstake    { token }              -> { ok, ... }
//   POST /econ/claim      { token }              -> { ok, claimId?, amountRaw?, dryRun?, message? }
//   POST /econ/history    { token, limit }       -> { ok, entries:[ledgerEntry] }
// Responses are read liberally (camel or snake, flat or nested) because this
// client must not break when a field is renamed on the relay; the normalizers
// below are the only place that reads raw JSON.
// ─────────────────────────────────────────────────────────────────────────────

const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');
const DEFAULT_TIMEOUT = 12_000;

// The ONLY body keys this client is allowed to send. Anything else is dropped
// before it leaves the browser (a destination address can never be one of them).
const SAFE_BODY_KEYS = new Set(['token', 'tier', 'amountRaw', 'limit']);

export function safeBody(body) {
  const out = {};
  if (!body || typeof body !== 'object') return out;
  for (const [k, v] of Object.entries(body)) {
    if (SAFE_BODY_KEYS.has(k) && v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

// The device token the rest of the client uses (see NetworkManager.deviceToken).
// Never invented here: if there is none this device has not played yet, and the
// caller gets a plain answer instead of a request.
function deviceToken() {
  const t = net?.token;
  return typeof t === 'string' && t.length ? t : null;
}
const NO_TOKEN = 'This browser has no saved device profile yet. Play once (even Solo) and try again.';

// ── tiny normalizers ─────────────────────────────────────────────────────────
const pick = (o, ...keys) => {
  if (!o || typeof o !== 'object') return undefined;
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const int = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const str = (v) => (typeof v === 'string' ? v : '');
const bool = (v, dflt = true) => (typeof v === 'boolean' ? v : dflt);

// A body key that is missing, or a value that looks like a Solana base58
// address/signature, means a bug — reported by the tools/ check, never thrown
// at a player.
const B58ISH = /^[1-9A-HJ-NP-Za-km-z]{32,90}$/;
export function bodyViolations(body) {
  const bad = [];
  for (const [k, v] of Object.entries(body || {})) {
    if (!SAFE_BODY_KEYS.has(k)) bad.push(`key:${k}`);
    else if (typeof v === 'string' && B58ISH.test(v)) bad.push(`value:${k}`);
  }
  return bad;
}

// ── transport ────────────────────────────────────────────────────────────────
async function http(path, { method = 'GET', body = null, timeout = DEFAULT_TIMEOUT } = {}) {
  const out = { ok: false, status: 0, code: null, message: '', data: null };
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
  try {
    const r = await fetch(`${httpBase()}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      signal: ctl ? ctl.signal : undefined,
    });
    out.status = r.status;
    const j = await r.json().catch(() => null);
    out.data = j;
    const flag = j && typeof j === 'object' ? j.ok : undefined;
    if (!r.ok || flag === false) {
      out.code = str(pick(j, 'error', 'code')) || `http_${r.status}`;
      out.message = describe(out.code) || str(pick(j, 'message', 'msg')) || `The relay answered ${r.status}.`;
    } else {
      out.ok = true;
      out.message = str(pick(j, 'message', 'msg'));
    }
  } catch (e) {
    const aborted = e && e.name === 'AbortError';
    out.code = aborted ? 'timeout' : 'unreachable';
    out.message = aborted ? 'The relay did not answer in time.' : 'The relay is unreachable right now.';
  } finally {
    if (timer) clearTimeout(timer);
  }
  return out;
}

// ── friendly text (same style as walletApi.friendly) ─────────────────────────
export function describe(code) {
  return ({
    unreachable: 'The relay is unreachable right now.',
    timeout: 'The relay did not answer in time.',
    rate_limited: 'Slow down a little.',
    bad_token: NO_TOKEN,
    not_enabled: 'The token economy is not enabled on this relay.',
    econ_disabled: 'The token economy is not enabled on this relay.',
    chain_disabled: 'The chain layer is turned off on this relay.',
    chain_unconfigured: 'This relay has no chain configured yet, so there is nothing to stake or claim.',
    mint_missing: 'This relay is missing its token mint address, so the economy is off.',
    wallet_link_disabled: 'Wallet linking is turned off on this relay.',
    wallett_link_disabled: 'Wallet linking is turned off on this relay.',
    not_linked: 'No wallet is linked to this device yet.',
    no_wallet: 'No wallet is linked to this device yet.',
    wallet_not_linked: 'No wallet is linked to this device yet.',
    unverified_destination: 'That wallet link is not signature-verified, so the relay will not pay to it. Relink from the Wallet panel.',
    bad_wallet: 'That wallet link is not usable. Relink from the Wallet panel.',
    bad_tier: 'Unknown stake tier.',
    unknown_tier: 'Unknown stake tier.',
    bad_amount: 'That amount is not a whole number of tokens.',
    bad_reason: 'The relay refused that request.',
    below_min_lock: 'That is below the minimum lock for that tier.',
    min_lock: 'That is below the minimum lock for that tier.',
    insufficient: 'Not enough WAYFARER for that stake.',
    insufficient_balance: 'Not enough WAYFARER for that stake.',
    already_staked: 'This device already has a stake. Unstake it first.',
    stake_exists: 'This device already has a stake. Unstake it first.',
    nothing_staked: 'There is no stake to release.',
    no_stake: 'There is no stake to release.',
    lock_active: 'That stake is still locked. The relay will release it when the lock ends.',
    still_locked: 'That stake is still locked. The relay will release it when the lock ends.',
    payouts_disabled: 'Claims are switched off on this relay (nothing is signed).',
    payout_disabled: 'Claims are switched off on this relay (nothing is signed).',
    below_min_claim: 'That is below the relay dust floor for a claim.',
    min_claim: 'That is below the relay dust floor for a claim.',
    float_bounds: 'The relay payout wallet is outside its safe float range, so paying is paused.',
    hot_float: 'The relay payout wallet is outside its safe float range, so paying is paused.',
    budget_exhausted: 'The emission budget for this programme is used up.',
    duplicate: 'That claim was already processed — nothing was paid twice.',
    claim_pending: 'That claim is still being settled. Check the ledger in a moment.',
    dry_run: 'This relay is in dry-run: the claim was recorded but nothing was signed.',
    bad_origin: 'This page is not an allowed origin for the relay.',
    bad_player: 'The relay does not know this device yet. Play once online and try again.',
  })[code] || '';
}

// ── endpoints ────────────────────────────────────────────────────────────────
export const getRates = () => http('/econ/rates');
export const getStatus = () => http('/chain/status');
export const getHistory = (limit = 25) => post('/econ/history', { limit });

function post(path, body) {
  const token = deviceToken();
  if (!token) return Promise.resolve({ ok: false, status: 0, code: 'bad_token', message: describe('bad_token'), data: null });
  const sent = safeBody({ token, ...(body || {}) });
  return http(path, { method: 'POST', body: sent });
}

export function getBalance() {
  return post('/econ/balance');
}
export function stake(tier, amountRaw) {
  const t = str(tier);
  const n = int(amountRaw);
  if (!['t1', 't2', 't3'].includes(t)) {
    return Promise.resolve({ ok: false, status: 0, code: 'bad_tier', message: describe('bad_tier'), data: null });
  }
  if (n === null || n <= 0) {
    return Promise.resolve({ ok: false, status: 0, code: 'bad_amount', message: describe('bad_amount'), data: null });
  }
  return post('/econ/stake', { tier: t, amountRaw: n });
}
export const unstake = () => post('/econ/unstake', {});
export const claim = () => post('/econ/claim', {});

// ── response normalizers ─────────────────────────────────────────────────────
// One place reads raw JSON. Field names may drift on the relay; the panel only
// ever sees the shapes below.
export const TIER_ORDER = ['none', 't1', 't2', 't3'];

export function normRates(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.rows) ? d.rows
    : Array.isArray(d.rates) ? d.rates
      : Array.isArray(d.sheet) ? d.sheet
        : (d.rates && typeof d.rates === 'object') ? Object.values(d.rates) : [];
  const rows = src.map((r) => {
    const id = str(pick(r, 'tierId', 'tier', 'id'));
    return {
      id,
      label: str(pick(r, 'label', 'name')) || id,
      minLockRaw: int(pick(r, 'minLockRaw', 'minLock', 'minRaw')) ?? 0,
      lockDays: int(pick(r, 'lockDays', 'days')) ?? 0,
      // The published return is the EFFECTIVE year-1 rate. The nominal aprBps is
      // deliberately NOT read: showing it would advertise a number the code
      // does not pay (docs/audit — rate sheet publishes effectiveYear1Bps).
      effectiveYear1Bps: int(pick(r, 'effectiveYear1Bps', 'effectiveBps', 'effectiveYear1AprBps', 'effectiveAprBps')),
      idleMultiplier: Number(pick(r, 'idleMultiplier', 'multiplier')) || 1,
      idleCapHours: int(pick(r, 'idleCapHours', 'capHours')) ?? 0,
      capBonusHours: int(pick(r, 'capBonusHours', 'bonusHours')) ?? 0,
    };
  }).filter((r) => r.id);
  rows.sort((a, b) => TIER_ORDER.indexOf(a.id) - TIER_ORDER.indexOf(b.id));
  return rows;
}

export function normStake(s) {
  const o = s && typeof s === 'object' ? s : {};
  const tier = str(pick(o, 'tierId', 'tier', 'id')) || 'none';
  return {
    tier: TIER_ORDER.includes(tier) ? tier : 'none',
    amountRaw: int(pick(o, 'amountRaw', 'amount', 'lockedRaw', 'locked')) ?? 0,
    unlockAt: int(pick(o, 'unlockAt', 'unlockMs', 'lockExpiry', 'unlocksAt')) ?? 0,
    since: int(pick(o, 'since', 'startedAt', 'stakedAt', 'accrueStartMs')) ?? 0,
  };
}

export function normBalance(data) {
  const d = data && typeof data === 'object' ? data : {};
  const b = (d.balances && typeof d.balances === 'object') ? d.balances
    : (d.balance && typeof d.balance === 'object') ? d.balance : d;
  const address = str(pick(d, 'address', 'wallet', 'walletAddress')).trim() || null;
  return {
    gold: int(pick(b, 'gold', 'goldRaw')) ?? 0,
    wayfarer: int(pick(b, 'wayfarer', 'wayfarerRaw', 'tokens')) ?? 0,
    stake: normStake(pick(d, 'stake', 'staked', 'lock') || {}),
    linked: bool(pick(d, 'linked', 'walletLinked'), !!address),
    address,
    short: str(pick(d, 'short', 'shortAddress')),
  };
}

export function normHistory(data) {
  const d = data && typeof data === 'object' ? data : {};
  const src = Array.isArray(d.entries) ? d.entries
    : Array.isArray(d.history) ? d.history
      : Array.isArray(d.rows) ? d.rows : [];
  return src.slice(0, 40).map((e) => {
    const o = e && typeof e === 'object' ? e : {};
    return {
      at: int(pick(o, 'at', 't', 'time', 'ts')) ?? 0,
      reason: str(pick(o, 'reason', 'kind', 'type')) || 'entry',
      resource: str(pick(o, 'resource', 'currency')) || 'wayfarer',
      amount: int(pick(o, 'amount', 'delta', 'n')) ?? 0,
      balanceAfter: int(pick(o, 'balanceAfter', 'balance')),
    };
  });
}

function normStatus(data) {
  const d = data && typeof data === 'object' ? data : {};
  const f = (d.flags && typeof d.flags === 'object') ? d.flags : {};
  const chain = (d.chain && typeof d.chain === 'object') ? d.chain : {};
  const enabledFlag = pick(d, 'enabled', 'econEnabled');
  const configured = pick(d, 'configured', 'chainConfigured') ?? pick(chain, 'configured');
  return {
    serverSaysEnabled: typeof enabledFlag === 'boolean' ? enabledFlag : null,
    configured: typeof configured === 'boolean' ? configured : null,
    mint: str(pick(d, 'mint', 'wayfarerMint', chain, 'mint')),
    cluster: str(pick(d, 'cluster', 'chainCluster', chain, 'cluster')),
    rewardsWallet: str(pick(d, 'rewardsWallet', 'rewards', chain, 'rewardsWallet')),
    treasuryWallet: str(pick(d, 'treasuryWallet', 'treasury', chain, 'treasuryWallet')),
    flags: {
      stake: bool(pick(f, 'stake') ?? pick(d, 'stakeEnabled'), true),
      claim: bool(pick(f, 'claim') ?? pick(d, 'claimEnabled'), true),
      payouts: bool(pick(f, 'payouts') ?? pick(d, 'payoutsEnabled'), false),
      walletLink: bool(pick(f, 'walletLink') ?? pick(d, 'walletLinkEnabled'), true),
      dryRun: bool(pick(f, 'dryRun') ?? pick(d, 'dryRun'), false),
    },
    taper: str(pick(d, 'taper', 'taperNote')),
    minClaimRaw: int(pick(d, 'minClaimRaw', 'minClaim')),
  };
}

// ── the live client ──────────────────────────────────────────────────────────
// Mirrors net.token for identity. `unreachable` is a normal, expected state:
// every read below degrades to "not enabled on this relay" and the game around
// it never notices.
//
// Courtesy mirror of the tier minimums in server/economy/CONTRACT.md, used ONLY
// to pre-fill the amount box and to catch a fat-fingered stake before a round
// trip. The relay re-checks and is the authority; nothing is enforced here for it.
const FALLBACK_MIN_LOCK_RAW = { t1: 1_000 * 10 ** 6, t2: 10_000 * 10 ** 6, t3: 50_000 * 10 ** 6 };

export class ChainNet {
  constructor() {
    this.handlers = new Map();
    this.state = {
      checked: false, refreshing: false, busy: false,
      reachable: false, enabled: false, reason: 'unknown',
      flags: { stake: true, claim: true, payouts: false, walletLink: true, dryRun: false },
      mint: '', cluster: '', rewardsWallet: '', treasuryWallet: '', minClaimRaw: null,
      rates: [], taper: '',
      balances: { gold: 0, wayfarer: 0 }, stake: normStake({}),
      linked: false, address: null, short: '',
      history: null, message: '', code: null, updatedAt: 0,
    };
  }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt)?.delete(fn);
  }
  emit(evt) {
    this.handlers.get(evt)?.forEach((fn) => { try { fn(this.state); } catch { /* a panel must never break the caller */ } });
  }

  rateRow(tierId) { return this.state.rates.find((r) => r.id === tierId) || null; }
  minLockRaw(tierId) {
    const r = this.rateRow(tierId);
    if (r && r.minLockRaw > 0) return r.minLockRaw;
    return FALLBACK_MIN_LOCK_RAW[tierId] || 0;
  }
  get hasDevice() { return !!deviceToken(); }

  // Never throws. Always resolves to the current state.
  async refresh({ history = false } = {}) {
    if (this.state.refreshing) return this.state;
    this.state = { ...this.state, refreshing: true };
    this.emit('state');
    try {
      const [st, rt, bl] = await Promise.all([getStatus(), getRates(), getBalance()]);
      const status = normStatus(st.ok ? st.data : null);
      const reachable = !!(st.ok || rt.ok || bl.ok);
      const ratesServed = rt.ok ? bool(pick(rt.data, 'enabled'), true) : null;
      let enabled = false;
      let reason = 'disabled';
      if (!reachable) {
        reason = 'relay_unreachable';
      } else if (status.serverSaysEnabled !== null) {
        enabled = status.serverSaysEnabled && ratesServed !== false;
      } else {
        enabled = rt.ok ? ratesServed !== false : bl.ok;
      }
      if (enabled) reason = 'ok';
      else if (reachable && st.ok && (status.configured === false || !status.mint)) reason = 'unconfigured';
      const bal = bl.ok ? normBalance(bl.data) : null;
      this.state = {
        ...this.state,
        refreshing: false, checked: true,
        reachable, enabled, reason,
        flags: status.flags,
        mint: status.mint || this.state.mint,
        cluster: status.cluster || this.state.cluster,
        rewardsWallet: status.rewardsWallet || this.state.rewardsWallet,
        treasuryWallet: status.treasuryWallet || this.state.treasuryWallet,
        minClaimRaw: status.minClaimRaw ?? this.state.minClaimRaw,
        rates: rt.ok ? normRates(rt.data) : this.state.rates,
        taper: (rt.ok && str(pick(rt.data, 'taper', 'taperNote'))) || status.taper || this.state.taper,
        balances: bal ? { gold: bal.gold, wayfarer: bal.wayfarer } : this.state.balances,
        stake: bal ? bal.stake : this.state.stake,
        linked: bal ? bal.linked : this.state.linked,
        address: bal ? (bal.address || this.state.address) : this.state.address,
        short: bal ? (bal.short || this.state.short) : this.state.short,
        code: bl.ok ? null : bl.code,
        updatedAt: Date.now(),
      };
      if (history && enabled) await this.loadHistory();
    } catch {
      // Defensive: nothing in the block above should throw, but a refresh must
      // never be the thing that breaks a game session.
      this.state = { ...this.state, refreshing: false, checked: true, reachable: false, enabled: false, reason: 'relay_unreachable' };
    }
    this.emit('state');
    return this.state;
  }

  async loadHistory(limit = 25) {
    const r = await getHistory(limit);
    this.state = { ...this.state, history: r.ok ? normHistory(r.data) : [], code: r.ok ? this.state.code : r.code };
    this.emit('state');
    return r;
  }

  async _op(fn, okMessage) {
    if (this.state.busy) return { ok: false, code: 'busy', message: 'One moment…', data: null };
    this.state = { ...this.state, busy: true };
    this.emit('state');
    let r;
    try { r = await fn(); } catch { r = { ok: false, code: 'unreachable', message: describe('unreachable'), data: null }; }
    this.state = { ...this.state, busy: false, code: r.ok ? null : r.code, message: r.ok ? (r.message || okMessage || '') : '' };
    this.emit('state');
    if (r.ok) await this.refresh({ history: true });
    return r;
  }

  doStake(tier, amountRaw) {
    return this._op(() => stake(tier, amountRaw), 'Stake recorded.');
  }
  doUnstake() {
    return this._op(() => unstake(), 'Unstake recorded.');
  }
  doClaim() {
    return this._op(() => claim());
  }
}

export const chainNet = new ChainNet();
if (typeof window !== 'undefined') window.__chainNet = chainNet; // debug / automated checks

