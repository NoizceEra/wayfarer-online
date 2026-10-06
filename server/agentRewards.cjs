'use strict';
/**
 * agentRewards.cjs — PURE reward policy for the autonomous-agent "finds SOL along
 * the way" ledger. NO IO, NO fs, NO network, NO db: every function takes plain
 * data and returns plain data (plus, for the two-phase claim, awaited callbacks
 * the caller injects). That is deliberate — it makes the money rules unit-testable
 * and impossible to accidentally wire to a real transfer from inside this file.
 *
 * ── WHAT IS REAL ────────────────────────────────────────────────────────────
 *   * a capped, auditable accrual of "SOL found" per player (lamports, integer)
 *   * a per-find clamp, a per-day cap, and rejection of NaN / negative / absurd
 *   * a claim decision that refuses unless an operator enabled it AND a payout
 *     path is configured
 *   * a two-phase, idempotent claim so a crash or a double-click cannot double-pay
 *
 * ── WHAT IS NOT REAL ────────────────────────────────────────────────────────
 *   * NOTHING is funded. There is NO treasury balance behind these lamports.
 *   * This file never moves SOL, never mints, never signs, never calls an RPC.
 *     The only place value could move is the `perform` callback the CALLER
 *     supplies to claim(); this module never supplies one.
 *   * The default is DISABLED: with AGENT_SOL_CLAIM_ENABLED unset, claim() can
 *     only ever return 'claim_disabled' / 'unconfigured'. Nothing is payable.
 *
 * Units: every amount is lamports (1 SOL = 1_000_000_000 lamports). All amounts
 * are non-negative integers; the ledger can never go negative.
 */

// ── documented defaults (all overridable; see capsFromEnv / claimConfig) ──────
const DEFAULTS = Object.freeze({
  // largest single find that may be booked (anything above is CLAMPED to this)
  perFindMaxLamports: 50_000,          // 0.00005 SOL
  // largest total that may be booked for one player in one UTC day
  perDayCapLamports: 5_000_000,        // 0.005 SOL
  // a claim must be at least this big to be allowed
  minClaimLamports: 0,
  // claims are OFF unless an operator explicitly turns them on
  claimEnabled: false,
  // how many recent finds a player entry keeps (bounded, small)
  findsMax: 20,
});

// absolute sanity ceiling: above this a "find" is treated as a bug/attack, not a
// big-but-real find, and is REJECTED (not clamped). 1_000_000 SOL.
const ABSURD_LAMPORTS = 1_000_000_000_000_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── small helpers ────────────────────────────────────────────────────────────
const intOr0 = (v) => (Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const utcDayKey = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);

/** Launch a blank, well-formed player ledger entry. */
function blankEntry(agentId = '') {
  return {
    agentId: typeof agentId === 'string' ? agentId : '',
    solFoundLamports: 0,        // accumulated, never negative
    solClaimedLamports: 0,      // accumulated, never negative
    lastFindAt: 0,
    foundTodayLamports: 0,      // resets when dayKey rolls over
    dayKey: '',                 // UTC yyyy-mm-dd that foundToday belongs to
    finds: [],                  // bounded ring of { lamports, at }
    claim: null,                // pending two-phase intent, or null
    lastClaim: null,            // last committed claim (idempotent replay key)
  };
}

/** Coerce any input into the canonical bounded shape (drops junk, never throws). */
function normalize(state) {
  const s = state && typeof state === 'object' ? state : {};
  const finds = Array.isArray(s.finds)
    ? s.finds
        .filter((f) => f && Number.isFinite(f.lamports) && f.lamports > 0)
        .slice(-DEFAULTS.findsMax)
        .map((f) => ({ lamports: intOr0(f.lamports), at: Number.isFinite(f.at) ? f.at : 0 }))
    : [];
  const pending = s.claim && typeof s.claim === 'object' && s.claim.status === 'pending'
    ? { id: String(s.claim.id || ''), lamports: intOr0(s.claim.lamports), at: Number.isFinite(s.claim.at) ? s.claim.at : 0, status: 'pending' }
    : null;
  const last = s.lastClaim && typeof s.lastClaim === 'object'
    ? { id: String(s.lastClaim.id || ''), lamports: intOr0(s.lastClaim.lamports), at: Number.isFinite(s.lastClaim.at) ? s.lastClaim.at : 0, sig: s.lastClaim.sig || null }
    : null;
  return {
    agentId: typeof s.agentId === 'string' ? s.agentId : '',
    solFoundLamports: intOr0(s.solFoundLamports),
    solClaimedLamports: intOr0(s.solClaimedLamports),
    lastFindAt: Number.isFinite(s.lastFindAt) ? s.lastFindAt : 0,
    foundTodayLamports: intOr0(s.foundTodayLamports),
    dayKey: typeof s.dayKey === 'string' && DAY_RE.test(s.dayKey) ? s.dayKey : '',
    finds,
    claim: pending,
    lastClaim: last,
  };
}

/** Lamports a player could claim right now (accrued minus any pending intent). */
function availableLamports(state) {
  const s = normalize(state);
  const held = s.claim && s.claim.status === 'pending' ? s.claim.lamports : 0;
  return Math.max(0, s.solFoundLamports - held);
}

// ── accrue ───────────────────────────────────────────────────────────────────
/**
 * Book one find. PURE: returns a NEW state, mutates nothing.
 *
 *   accrue(state, { lamports, dayKey, caps, at }) -> { state, accepted, reason }
 *
 *   accepted = lamports actually booked (integer, 0 when refused/clamped-away)
 *   reason   = 'ok' | 'invalid' | 'absurd' | 'day_cap'
 *
 * Rules (CLAMP, never throw):
 *   * non-number / NaN / Infinity / <= 0      -> accepted 0          ('invalid')
 *   * > ABSURD_LAMPORTS                       -> accepted 0          ('absurd')
 *   * lamports > caps.perFindMaxLamports      -> clamped to the max
 *   * would exceed caps.perDayCapLamports     -> clamped to the remainder
 *   * a new dayKey resets foundTodayLamports (per-day cap is per UTC day)
 *   * solFoundLamports is monotonically non-decreasing and never negative
 */
function accrue(state, opts = {}) {
  const caps = {
    perFindMaxLamports: DEFAULTS.perFindMaxLamports,
    perDayCapLamports: DEFAULTS.perDayCapLamports,
    ...(opts.caps || {}),
  };
  const at = Number.isFinite(opts.at) ? opts.at : Date.now();
  const dayKey = typeof opts.dayKey === 'string' && DAY_RE.test(opts.dayKey) ? opts.dayKey : utcDayKey(at);

  let s = normalize(state);
  // day rollover: a different UTC day starts foundToday from zero
  if (s.dayKey !== dayKey) s = { ...s, dayKey, foundTodayLamports: 0 };

  const raw = opts.lamports;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return { state: s, accepted: 0, reason: 'invalid' };
  if (raw > ABSURD_LAMPORTS) return { state: s, accepted: 0, reason: 'absurd' };

  const clamped = Math.min(Math.floor(raw), intOr0(caps.perFindMaxLamports));
  const remaining = Math.max(0, intOr0(caps.perDayCapLamports) - s.foundTodayLamports);
  const grant = Math.min(clamped, remaining);
  if (grant <= 0) return { state: s, accepted: 0, reason: 'day_cap' };

  s = {
    ...s,
    solFoundLamports: s.solFoundLamports + grant,
    foundTodayLamports: s.foundTodayLamports + grant,
    lastFindAt: at,
    finds: [...s.finds, { lamports: grant, at }].slice(-DEFAULTS.findsMax),
  };
  return { state: s, accepted: grant, reason: 'ok' };
}

// ── canClaim ─────────────────────────────────────────────────────────────────
/**
 * Decide whether a claim may proceed. PURE.
 *
 *   canClaim(state, { enabled, configured, minClaimLamports })
 *     -> { ok, reason, claimableLamports? }
 *
 *   reason ∈ 'ok' | 'claim_disabled' | 'unconfigured' | 'below_min' | 'nothing_to_claim'
 *
 * Gate order (first failing gate wins):
 *   1. enabled  === true            else 'claim_disabled'
 *   2. configured === true          else 'unconfigured'   (no payout path wired)
 *   3. claimable > 0                else 'nothing_to_claim'
 *   4. claimable >= minClaimLamports else 'below_min'
 */
function canClaim(state, opts = {}) {
  const s = normalize(state);
  if (opts.enabled !== true) return { ok: false, reason: 'claim_disabled' };
  if (opts.configured !== true) return { ok: false, reason: 'unconfigured' };
  const claimable = availableLamports(s);
  if (claimable <= 0) return { ok: false, reason: 'nothing_to_claim' };
  const min = Number.isFinite(opts.minClaimLamports) ? Math.max(0, Math.floor(opts.minClaimLamports)) : DEFAULTS.minClaimLamports;
  if (claimable < min) return { ok: false, reason: 'below_min' };
  return { ok: true, reason: 'ok', claimableLamports: claimable };
}

// ── claim (two-phase, idempotent) ────────────────────────────────────────────
/**
 * The ONLY function that can move value, and it only moves it through the
 * CALLER-supplied `perform` callback. Two-phase and idempotent so a crash or a
 * double-click can never double-pay:
 *
 *   PHASE 1  mark intent  — persist a `claim:{status:'pending'}` marker DURABLY
 *   PHASE 2  perform      — call ctx.perform({ id, lamports }); the real payout
 *   PHASE 3  commit       — persist the debit + the committed marker
 *
 *   claim(state, ctx) -> { state, ok, reason, amount?, id?, signature?, duplicate? }
 *
 * ctx = {
 *   enabled, configured, minClaimLamports,   // policy (same as canClaim)
 *   persist,   // async (nextState) => void  — MUST be durable; required
 *   perform,   // async ({id,lamports}) => { ok:true, signature? } | { ok:false, reason } — required
 *   id,        // optional caller-chosen id (idempotency key); generated if absent
 *   now,       // optional ms timestamp
 * }
 *
 * Idempotency / crash safety:
 *   * replaying a claim whose id already COMMITTED returns { ok:true, duplicate:true }
 *     and does NOT call perform again.
 *   * if an intent is left 'pending' (a crash between intent and commit), every
 *     later claim is refused with reason 'in_progress'. We cannot know whether the
 *     payout landed, so we NEVER pay again — an operator reconciles it by hand.
 *   * if perform fails, the intent is rolled back and nothing is recorded.
 *   * if the COMMIT write fails, success is NOT reported and the pending intent
 *     stays on disk (still blocking) — the safe side of the two-phase boundary.
 */
async function claim(state, ctx = {}) {
  const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
  let s = normalize(state);
  const id = typeof ctx.id === 'string' && ctx.id ? ctx.id : `${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

  // idempotent replay of an already-committed claim
  if (s.lastClaim && s.lastClaim.id === id) {
    return { state: s, ok: true, duplicate: true, amount: s.lastClaim.lamports, id, reason: 'already_claimed' };
  }
  // crash guard: an unresolved intent blocks any new claim
  if (s.claim && s.claim.status === 'pending') {
    return { state: s, ok: false, reason: 'in_progress', id: s.claim.id };
  }
  const can = canClaim(s, ctx);
  if (!can.ok) return { state: s, ok: false, reason: can.reason };
  if (typeof ctx.persist !== 'function' || typeof ctx.perform !== 'function') {
    return { state: s, ok: false, reason: 'unconfigured', detail: 'claim requires both persist() and perform()' };
  }

  const amount = can.claimableLamports;

  // ── PHASE 1: mark intent (durable before anything can move) ──
  let next = { ...s, claim: { id, lamports: amount, at: now, status: 'pending' } };
  await ctx.persist(next);

  // ── PHASE 2: perform the payout (the single, caller-owned I/O point) ──
  let res;
  try { res = await ctx.perform({ id, lamports: amount }); }
  catch (e) { res = { ok: false, reason: (e && e.message) || 'perform_failed' }; }
  if (!res || res.ok !== true) {
    next = { ...next, claim: null };                       // roll back the intent
    await ctx.persist(next);
    return { state: next, ok: false, reason: 'perform_failed', detail: res && res.reason, id };
  }

  // ── PHASE 3: commit (debit accrued, credit claimed, clear intent) ──
  const committed = {
    ...next,
    claim: null,
    solFoundLamports: Math.max(0, next.solFoundLamports - amount),
    solClaimedLamports: next.solClaimedLamports + amount,
    lastClaim: { id, lamports: amount, at: now, sig: (res && res.signature) || null },
  };
  try { await ctx.persist(committed); }
  catch (e) {
    // commit write failed: report failure, do NOT decrement; the pending intent
    // stays on disk and keeps blocking (safe).
    return { state: next, ok: false, reason: 'commit_failed', pending: true, detail: e && e.message, id };
  }
  return { state: committed, ok: true, amount, id, signature: (res && res.signature) || null };
}

// ── env helpers (documented knobs) ───────────────────────────────────────────
/**
 * Caps from env, each falling back to the documented default:
 *   AGENT_SOL_PER_FIND_MAX_LAMPORTS  (default 50000)
 *   AGENT_SOL_PER_DAY_CAP_LAMPORTS   (default 5000000)
 *   AGENT_SOL_MIN_CLAIM_LAMPORTS     (default 0)
 */
function capsFromEnv(env = process.env) {
  const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };
  return {
    perFindMaxLamports: num(env.AGENT_SOL_PER_FIND_MAX_LAMPORTS, DEFAULTS.perFindMaxLamports),
    perDayCapLamports: num(env.AGENT_SOL_PER_DAY_CAP_LAMPORTS, DEFAULTS.perDayCapLamports),
    minClaimLamports: num(env.AGENT_SOL_MIN_CLAIM_LAMPORTS, DEFAULTS.minClaimLamports),
  };
}

/**
 * Claim policy from env.
 *   enabled    = AGENT_SOL_CLAIM_ENABLED is '1' / 'true'  (DEFAULT: FALSE)
 *   configured = AGENT_SOL_TREASURY is a non-empty string (a payout destination
 *                is named). NOTE: naming a treasury does NOT fund anything and
 *                does NOT itself move SOL — see docs/AGENT_REWARDS.md.
 */
function claimConfig(env = process.env) {
  const flag = String(env.AGENT_SOL_CLAIM_ENABLED || '').toLowerCase();
  const { minClaimLamports } = capsFromEnv(env);
  return {
    enabled: flag === '1' || flag === 'true' || flag === 'yes',
    configured: typeof env.AGENT_SOL_TREASURY === 'string' && env.AGENT_SOL_TREASURY.trim().length > 0,
    minClaimLamports,
  };
}

module.exports = {
  DEFAULTS,
  ABSURD_LAMPORTS,
  blankEntry,
  normalize,
  utcDayKey,
  availableLamports,
  accrue,
  canClaim,
  claim,
  capsFromEnv,
  claimConfig,
};
