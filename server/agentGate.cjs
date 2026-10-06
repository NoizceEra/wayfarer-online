'use strict';
// ─────────────────────────────────────────────────────────────────────────
// server/agentGate.cjs — token-holding ENTITLEMENT GATE
//
// A wallet-bound player who HOLDS at least AGENT_MIN_USD (default $50) of the
// project token is entitled to an autonomous agent. This module is ONLY the
// gate: it answers "is this session's bound wallet eligible?" and nothing else
// (the agent runtime lives in server/agents.cjs).
//
// HONESTY CONTRACT (do not weaken):
//   * No RPC, no mint, no price, or no bound wallet => 'unconfigured'/'no_wallet'
//     and the feature stays OFF. A price is NEVER invented and a balance is
//     NEVER fabricated.
//   * A failed RPC lookup is status 'error' and is NEVER eligible.
//   * Only PUBLIC wallet addresses are handled here; no key material is read,
//     logged or stored anywhere in this file.
//
// The pure decision (evaluateHolding) is exported separately from the IO
// (fetchHolding) so it can be unit-tested with no network and no env. This file
// is CommonJS (.cjs) on purpose: the ESM server modules (config.js, db.js) are
// loaded lazily via import() inside entitlementFor only, so `require`-ing this
// file never pulls in the relay's ESM graph or better-sqlite3.
// ─────────────────────────────────────────────────────────────────────────

// How long a holding lookup is cached per (rpc|mint|owner|decimals) so a hot
// entitlement loop cannot hammer the RPC. Successful AND failed lookups are
// cached (a failing node is not retried every tick). Overridable via env.
const HOLDING_TTL_MS = Number(process.env.AGENT_HOLDING_TTL_MS) > 0
  ? Number(process.env.AGENT_HOLDING_TTL_MS) : 60_000;

// Documented fallback SPL decimals, used only when the chain cannot tell us the
// mint's decimals (the jsonParsed RPC response normally carries them). Mirrors
// CFG.TOKEN_DECIMALS' default; NOT a silent 9.
const DEFAULT_DECIMALS = 6;

const CACHE = new Map(); // key -> { at, result }

// Drop the whole cache. Exported for tests and for an operator that wants the
// next entitlement check to hit the chain immediately.
function clearCache() { CACHE.clear(); }

// ── pure decision (no IO, no env) ──────────────────────────────────────────
// evaluateHolding({ tokenAmount, priceUsd, minUsd }) -> { eligible, usdValue, reason }
// reason: 'ok' | 'below_min' | 'unconfigured' | 'no_wallet'
function evaluateHolding({ tokenAmount, priceUsd, minUsd } = {}) {
  // No wallet bound / no holding read at all.
  if (tokenAmount === null || tokenAmount === undefined || tokenAmount === '') {
    return { eligible: false, usdValue: 0, reason: 'no_wallet' };
  }
  const price = Number(priceUsd);
  const min = Number(minUsd);
  // Both a positive price and a positive threshold must be configured. Without
  // a price we cannot value a holding, so refuse rather than guess one.
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(min) || min <= 0) {
    return { eligible: false, usdValue: 0, reason: 'unconfigured' };
  }
  const amount = Number(tokenAmount);
  // A non-finite or negative quantity is a broken read, not a real holding.
  if (!Number.isFinite(amount) || amount < 0) {
    return { eligible: false, usdValue: 0, reason: 'unconfigured' };
  }
  const usdValue = amount * price;
  // >= min is eligible; the tiny epsilon keeps a value that is exactly at the
  // threshold in intent (e.g. 0.1 * 500) from slipping under on float error.
  if (usdValue + 1e-9 < min) return { eligible: false, usdValue, reason: 'below_min' };
  return { eligible: true, usdValue, reason: 'ok' };
}

// ── IO: read the owner's balance of `mint` from `rpc` ──────────────────────
// fetchHolding({ address, rpc, mint, owner, decimals }) ->
//   { status: 'ok' | 'unconfigured' | 'error', tokenAmount }
// `owner` (falling back to `address`) is the wallet whose token accounts we
// read. If any of rpc/mint/owner is empty this returns 'unconfigured' with NO
// network call, mirroring economy.js's bridgeConfigured degradation.
async function fetchHolding({ address, rpc, mint, owner, decimals } = {}) {
  const who = owner || address || '';
  if (!rpc || !mint || !who) return { status: 'unconfigured', tokenAmount: 0 };

  const fallback = Number.isFinite(Number(decimals)) && Number(decimals) >= 0
    ? Number(decimals) : DEFAULT_DECIMALS;
  const key = `${rpc}|${mint}|${who}|${fallback}`;
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < HOLDING_TTL_MS) return hit.result;

  const call = (method, params) => rpcCall(rpc, method, params, globalThis.fetch);
  let result;
  try {
    // jsonParsed token accounts carry uiAmount (already decimal-scaled) and the
    // mint's decimals per account, so we read 6 rather than assume it.
    const res = await call('getTokenAccountsByOwner', [who, { mint }, { encoding: 'jsonParsed' }]);
    const accounts = Array.isArray(res?.value) ? res.value : [];
    let total = 0;
    let decimalsSeen = null;
    let rawSum = null;
    for (const acct of accounts) {
      const ta = acct?.account?.data?.parsed?.info?.tokenAmount;
      if (!ta) continue;
      const d = Number(ta.decimals);
      if (Number.isFinite(d)) decimalsSeen = d;
      const ui = ta.uiAmount !== null && ta.uiAmount !== undefined ? Number(ta.uiAmount) : Number(ta.uiAmountString);
      if (Number.isFinite(ui)) { total += ui; continue; }
      const raw = Number(ta.amount);
      if (Number.isFinite(raw)) rawSum = (rawSum || 0) + raw;
    }
    // Only if the RPC handed back raw integers (no uiAmount) do we need decimals
    // from the mint itself, then the documented fallback.
    if (rawSum !== null) {
      let d = decimalsSeen;
      if (d === null) d = await readMintDecimals(call, mint);
      if (d === null) d = fallback;
      total += rawSum / Math.pow(10, d);
    }
    result = { status: 'ok', tokenAmount: total };
  } catch {
    // A failed lookup is NEVER a holding. Report 'error'; the gate stays closed.
    result = { status: 'error', tokenAmount: 0 };
  }
  prune();
  CACHE.set(key, { at: Date.now(), result });
  return result;
}

// Minimal JSON-RPC POST. `fetchImpl` is resolved at call time (globalThis.fetch)
// so the no-network tests can stub it and prove this path is never taken.
async function rpcCall(rpc, method, params, fetchImpl) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch unavailable');
  const res = await fetchImpl(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res || !res.ok) throw new Error(`rpc http ${res ? res.status : 'no response'}`);
  const body = await res.json();
  if (body && body.error) throw new Error(body.error.message || 'rpc error');
  return body ? body.result : null;
}

async function readMintDecimals(call, mint) {
  try {
    const info = await call('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);
    const d = Number(info?.value?.data?.parsed?.info?.decimals);
    return Number.isFinite(d) ? d : null;
  } catch { return null; }
}

function prune() {
  if (CACHE.size < 256) return;
  const t = Date.now();
  for (const [k, v] of CACHE) if (t - v.at >= HOLDING_TTL_MS) CACHE.delete(k);
}

// ── session wiring ─────────────────────────────────────────────────────────
// entitlementFor(room, sid) -> { eligible, reason, held, requiredUsd, priceUsd }
// Resolves the session's bound wallet (the same binding economy.js uses), reads
// its token holding, then applies the pure decision. `reason` is the
// evaluateHolding enum plus 'error' (the RPC is configured but the lookup
// failed) — an error is never eligible.
// opts.cfg / opts.db are test-only dependency injection.
async function entitlementFor(room, sid, opts = {}) {
  const cfg = opts.cfg || (await loadCfg());
  const dbm = 'db' in opts ? opts.db : (await loadDb());
  const price = Number(cfg?.AGENT_TOKEN_PRICE_USD) || 0;
  const min = Number(cfg?.AGENT_MIN_USD) || 0;
  const out = { eligible: false, reason: 'unconfigured', held: 0, requiredUsd: min, priceUsd: price > 0 ? price : null };

  const p = room && room.players && typeof room.players.get === 'function' ? room.players.get(sid) : null;
  let address = '';
  try { if (p?.token && dbm?.getWalletForToken) address = dbm.getWalletForToken(p.token)?.address || ''; } catch { address = ''; }
  if (!address) { out.reason = 'no_wallet'; return out; }

  // With no price (or no threshold) the gate cannot value anything: report
  // 'unconfigured' WITHOUT touching the RPC — the feature stays off.
  if (!(price > 0) || !(min > 0)) return out;

  const holding = await fetchHolding({
    address, owner: address,
    rpc: cfg?.SOLANA_RPC, mint: cfg?.MINT_ADDRESS, decimals: cfg?.TOKEN_DECIMALS,
  });
  if (holding.status === 'unconfigured') { out.reason = 'unconfigured'; return out; }
  if (holding.status === 'error') { out.reason = 'error'; return out; }

  const ev = evaluateHolding({ tokenAmount: holding.tokenAmount, priceUsd: price, minUsd: min });
  out.eligible = ev.eligible;
  out.reason = ev.reason;
  out.held = holding.tokenAmount;
  return out;
}

let _cfg = null;
async function loadCfg() {
  if (!_cfg) { try { _cfg = (await import('./config.js')).CFG; } catch { _cfg = {}; } }
  return _cfg;
}
let _db;
async function loadDb() {
  if (_db === undefined) { try { _db = await import('./db.js'); } catch { _db = null; } }
  return _db;
}

module.exports = {
  evaluateHolding,
  fetchHolding,
  entitlementFor,
  clearCache,
  HOLDING_TTL_MS,
  DEFAULT_DECIMALS,
};
