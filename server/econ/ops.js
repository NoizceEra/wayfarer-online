// server/econ/ops.js — the token-economy OPERATIONS, with no HTTP in them.
//
// This is the layer the HTTP surface (http.js), the relay's kill hook (index.js) and the
// tests all call, so every rule below is stated once:
//
//   * MONEY IS THE LEDGER'S JOB. Nothing here keeps a balance: reads and writes go through
//     server/economy/ledger.js (append-only journal, idempotent by entry id, integers in
//     base units, no overdraft). Every value-moving call therefore has an idempotency id,
//     and a retry returns the first outcome instead of paying twice.
//   * EMISSION IS BOUNDED. A stake's return comes from stakeMath.returnFor() against the
//     durable remaining budget in state.js. `owedCappedRaw` (never `owedRaw`) is what is
//     credited, so no argument combination can pay past the lifetime budget.
//   * UNKNOWN INPUT THROWS. An unknown tierId is a programming/input error, never a silent
//     fallback to 'none' — a typo that defaulted would pay the wrong rate forever.
//   * THE DESTINATION IS NEVER A REQUEST FIELD. A claim resolves the wallet from the ONE
//     signature-verified authority — `verifiedWalletFor` in server/walletStore.js
//     (docs/BLOCKCHAIN_V1.md §3.5) — and payouts.js re-verifies it before anything is
//     signed. A caller cannot name an address, and an unverified/legacy link resolves to
//     null so it can never be one.
//   * THE TOKEN LAYER IS OPT-IN. Until a device has a signature-verified wallet link:
//     a boss kill still pays GOLD and adds NO WAYFARER ledger entry, stake / unstake /
//     claim refuse with `wallet_not_linked` (framed as an invitation, never an error),
//     and the only trace of the token layer is `pendingOnLinkRaw` — what the device
//     WOULD have been owed, recorded and reported, never paid (pending.js).
//   * DRY RUN BY DEFAULT. payouts.claim() moves nothing unless PAYOUTS_ENABLED === 'true'.
//     This module never sets it, and passes no deps in production.

import { log } from '../log.js';
import { deviceKey } from '../store.js';
import { shortAddr } from '../validate.js';
import { apply, balancesOf, hasApplied, history as ledgerHistory } from '../economy/ledger.js';
import { claim as payoutsClaim, makeClaimId } from '../economy/payouts.js';
import { STAKE_TIERS, TIER_IDS, BUDGET_TOTAL_RAW, lockExpiry, returnFor } from '../economy/stakeMath.js';
import { ENEMY_REWARDS } from '../rewards.js';
// THE single signature-verified wallet authority (server/walletStore.js). There is
// exactly one, it is workstream B's, and nothing here builds a second one. An absent or
// unverified link resolves to null, so every gate below fails closed.
import { verifiedWalletFor } from '../walletStore.js';
import { pendingFor, recordSaveAccomplishments } from './pending.js';
import { econEnabled, chainReady, missingChainConfig, payoutsEnabled } from './config.js';
import * as state from './state.js';

// rewards.js `crypto` is a WHOLE-WAYFARER figure per kill ("20 crypto units awarded on
// kill"); the ledger holds base units with 6 decimals, so a boss's 20 becomes 20 * 10^6.
// Stated here once because it is the only unit conversion in the wiring layer.
export const CRYPTO_UNIT_RAW = 10 ** 6;

// playerKey == store.deviceKey(token): the SAME identity rule the /wallet/* routes use
// (wallet.js resolves `deviceKey(b.token)`), so one device is one ledger account here too.
export const stateKeyFor = (token) => (typeof token === 'string' && token ? deviceKey(token) : null);

const CLAIM_ID_RE = /^[A-Za-z0-9_:.-]{6,160}$/;
const VERIFIED_WALLET = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** Frozen tier spec. THROWS on anything that is not one of the four frozen ids. */
export function tierSpec(tierId) {
  if (typeof tierId !== 'string' || !Object.prototype.hasOwnProperty.call(STAKE_TIERS, tierId)) {
    throw new RangeError(`econ: unknown tierId ${JSON.stringify(tierId)}; expected one of ${TIER_IDS.join(', ')}`);
  }
  return STAKE_TIERS[tierId];
}

export const budgetRemainingRaw = () => Math.max(0, BUDGET_TOTAL_RAW - state.budgetSpentRaw());

// The OPT-IN copy. The token layer is a bonus, never a gate on play: this line is the
// same one the HTTP surface returns, so ops and HTTP can never disagree about the tone.
export const WALLET_OPT_IN = 'Link a wallet to enable crypto rewards - the whole game runs on gold without one.';

const publicStake = (s) => (s ? { tierId: s.tierId, amountRaw: s.amountRaw, lockedAtMs: s.lockedAtMs, lockUntilMs: s.lockUntilMs } : null);

// ── the wallet-link gate (THE authority, never a second lookup) ─────────────
/**
 * The signature-verified wallet address for this device, or null. Everything in this
 * module that has anything to do with WAYFARER asks THIS question and nothing else
 * (docs/BLOCKCHAIN_V1.md §3.5): an unlinked device, an unverified record and a legacy
 * on-disk link all come back null, because `verifiedWalletFor` fails closed on all
 * three. `deps.verifiedWalletImpl` exists ONLY so a test can stand in for the authority.
 */
export function linkedWallet(deviceKeyStr, deps = {}) {
  if (typeof deps.verifiedWalletImpl === 'function') {
    try { return deps.verifiedWalletImpl(deviceKeyStr) || null; } catch { return null; }
  }
  try { return verifiedWalletFor(String(deviceKeyStr || '')) || null; } catch { return null; }
}

// ── reads ───────────────────────────────────────────────────────────────────
/**
 * The balance sheet a client is allowed to see. `wayfarer` is the LIQUID balance: a locked
 * stake has already been debited out of it (reason 'stake_lock'), so the liquid balance is
 * exactly what is claimable, and a stake can never be claimed while it is locked.
 *
 * THE TOKEN LAYER IS OPT-IN. Until a signature-verified wallet link exists this is a
 * plain GOLD balance sheet: `walletLinked:false`, `address:null`, and the only trace of
 * the token layer is `pendingOnLinkRaw` — a recording of what the device would have been
 * owed, which is REPORTED and never paid. Reading your own state is never an error.
 */
export function balanceFor(playerKey) {
  const b = balancesOf(playerKey) || { gold: 0, wayfarer: 0 };
  const stake = state.stakeOf(playerKey);
  const address = linkedWallet(playerKey);
  const pending = pendingFor(playerKey);
  return {
    ok: true,
    gold: b.gold,
    wayfarer: b.wayfarer,
    stakeTier: stake ? stake.tierId : 'none',
    lockedRaw: stake ? stake.amountRaw : 0,
    lockUntilMs: stake ? stake.lockUntilMs : 0,
    claimableRaw: b.wayfarer,
    stake: publicStake(stake),
    // Top-level, so the client's marker/panel can tell a linked wallet from an unlinked
    // one without digging into `econ`. Display-only; never a credential.
    walletLinked: address !== null,
    address,
    short: address ? shortAddr(address) : null,
    // What this device would be owed if it linked a wallet NOW. Recorded, reported,
    // never paid (see pending.js).
    pendingOnLinkRaw: pending.pendingOnLinkRaw,
  };
}

export function historyFor(playerKey, limit = 50) {
  const n = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
  return { ok: true, limit: n, entries: ledgerHistory(playerKey, n) || [] };
}

// ── stake / unstake (ledger only: no RPC anywhere in this section) ──────────
/**
 * Lock the tier's MINIMUM lock (STAKE_TIERS[tierId].minLockRaw) for the tier's lock period.
 * One stake per player; release it before re-locking. Returns a refusal object rather than
 * throwing for "normal" refusals, and THROWS for an unknown tier.
 */
export function stakeNow(playerKey, tierId, nowMs = Date.now(), deps = {}) {
  const spec = tierSpec(tierId);                       // throws, never defaults
  // OPT-IN GATE: no signature-verified wallet link means the token layer does not exist
  // for this device yet. This is NOT an error and NOT a missed opportunity.
  if (!linkedWallet(playerKey, deps)) {
    return { ok: false, error: 'wallet_not_linked', message: WALLET_OPT_IN, address: null };
  }
  if (spec.minLockRaw <= 0) {
    return { ok: false, error: 'no_lock_required', message: `tier '${tierId}' locks nothing` };
  }
  const held = state.stakeOf(playerKey);
  if (held) return { ok: false, error: 'already_staked', stake: publicStake(held) };

  const amountRaw = spec.minLockRaw;
  const lockUntilMs = lockExpiry(nowMs, tierId);        // throws on a non-finite clock too
  const res = apply(playerKey, {
    id: `stake_lock:${playerKey}:${nowMs}`,
    reason: 'stake_lock', resource: 'wayfarer', amount: -amountRaw,
    meta: { tierId, lockUntilMs },
  });
  if (!res.applied && res.reason !== 'duplicate') {
    return {
      ok: false,
      error: res.reason === 'insufficient' ? 'insufficient' : res.reason,
      neededRaw: amountRaw,
      availableRaw: res.balances ? res.balances.wayfarer : 0,
    };
  }
  const stake = { tierId, amountRaw, lockedAtMs: nowMs, lockUntilMs };
  state.putStake(playerKey, stake);
  log.info('econ stake locked', { tierId, amountRaw, lockUntilMs });
  return { ok: true, stake: publicStake(stake), balances: res.balances };
}

/**
 * Release principal + emission. The emission is computed by stakeMath.returnFor over the
 * holding span, capped by the remaining lifetime budget; `effectiveYear1Bps` on the rate
 * sheet is the rate this actually pays over a one-year hold.
 */
export function unstakeNow(playerKey, nowMs = Date.now(), deps = {}) {
  if (!linkedWallet(playerKey, deps)) {
    return { ok: false, error: 'wallet_not_linked', message: WALLET_OPT_IN, address: null };
  }
  const stake = state.stakeOf(playerKey);
  if (!stake) return { ok: false, error: 'not_staked' };
  const spec = tierSpec(stake.tierId);                 // a stored bad tier is a bug, not a default
  const elapsedMs = Math.max(0, nowMs - stake.lockedAtMs);
  const budget = budgetRemainingRaw();
  const r = returnFor({
    tierId: stake.tierId, amountRaw: stake.amountRaw, elapsedMs,
    budgetRemainingRaw: budget, accrueStartMs: stake.lockedAtMs,
  });

  // Principal first. If this cannot be credited the stake stays locked — losing the
  // principal out of a bookkeeping error is not an acceptable failure mode.
  const principal = apply(playerKey, {
    id: `stake_unlock:${playerKey}:${stake.lockedAtMs}`,
    reason: 'stake_unlock', resource: 'wayfarer', amount: stake.amountRaw,
    meta: { tierId: stake.tierId, elapsedMs },
  });
  if (!principal.applied && principal.reason !== 'duplicate') {
    log.error('econ unstake: principal credit refused', { tierId: stake.tierId, reason: principal.reason });
    return { ok: false, error: `principal_${principal.reason}`, stake: publicStake(stake) };
  }

  // Emission second, only what the budget allows, and never a zero-amount ledger entry.
  let emissionRaw = 0;
  let exhausted = r.exhausted;
  if (r.owedCappedRaw > 0) {
    const emission = apply(playerKey, {
      id: `stake_return:${playerKey}:${stake.lockedAtMs}`,
      reason: 'stake_return', resource: 'wayfarer', amount: r.owedCappedRaw,
      meta: { tierId: stake.tierId, elapsedMs, owedRaw: r.owedRaw, budgetRemainingRaw: budget },
    });
    if (emission.applied || emission.reason === 'duplicate') {
      emissionRaw = r.owedCappedRaw;
      // The budget is only consumed when the credit actually happened (a duplicate means a
      // previous run already consumed it).
      if (emission.applied) state.spendBudget(r.owedCappedRaw);
    } else {
      exhausted = true;
      log.error('econ unstake: emission credit refused', { tierId: stake.tierId, reason: emission.reason });
    }
  }
  state.dropStake(playerKey);
  log.info('econ stake released', { tierId: stake.tierId, principalRaw: stake.amountRaw, emissionRaw, exhausted: !!exhausted });
  return {
    ok: true,
    released: { tierId: stake.tierId, principalRaw: stake.amountRaw, emissionRaw, elapsedMs },
    emission: { owedRaw: r.owedRaw, paidRaw: emissionRaw, budgetRemainingRaw: budgetRemainingRaw(), exhausted: !!exhausted },
    balances: balancesOf(playerKey),
  };
}

// ── combat credit: bosses pay WAYFARER, per kill ────────────────────────────
/**
 * Credit the per-kill `crypto` of server/rewards.js to the ledger, reason 'combat'.
 *
 * Called from the relay's save hook with the VALIDATED character record, so `kills` is
 * already sanitized (unknown ids dropped, values bounded ints) by validate.js. Ordinary
 * enemies carry crypto 0 and therefore pay nothing — only bosses ("it's only a certain
 * type of enemy that receives a certain amount", rewards.js header).
 *
 * DOUBLE-PAY IS IMPOSSIBLE TWICE OVER:
 *   1. the delta is computed against the per-type counts ALREADY CREDITED (state.js, on
 *      disk), so replaying the same save or an older one yields a delta of 0; and
 *   2. the entry id is derived from the CUMULATIVE credited count
 *      (`combat:<type>:<playerKey>:<n>`), and ledger.apply() refuses a duplicate id — so
 *      even a lost state file cannot pay the same kill twice.
 *
 * The credit is ALSO plausibility-capped exactly like gold in validate.js
 * (burst + perSec * elapsed), so a forged counter cannot mint bosses.
 *
 * @returns {{ok:boolean, linked:boolean, creditedRaw:number, pendingRaw:number, byType:object, skipped:string[]}}
 */
export function creditKills(playerKey, kills, nowMs = Date.now(), { enabled = econEnabled(), linked } = {}) {
  const out = { ok: true, linked: false, creditedRaw: 0, pendingRaw: 0, byType: {}, skipped: [] };
  if (!enabled) { out.ok = false; out.skipped.push('econ_disabled'); return out; }
  if (!kills || typeof kills !== 'object') { out.ok = false; out.skipped.push('no_kills'); return out; }

  // THE OPT-IN GATE (docs/BLOCKCHAIN_V1.md part 2): the WAYFARER side of a kill exists
  // ONLY for a device with a signature-verified wallet link. Gold was already credited
  // by validate.js's clamp and is untouched here. With no link this writes NO ledger
  // entry at all (not even a zero-amount one), logs nothing and errors nothing — it
  // records what the kill WOULD have been worth and returns.
  const isLinked = linked === undefined ? linkedWallet(playerKey) !== null : !!linked;
  out.linked = isLinked;

  const prev = state.combatOf(playerKey);
  const credited = { ...prev.credited };
  const dt = prev.savedAtMs > 0 ? Math.max(0, (nowMs - prev.savedAtMs) / 1000) : 0;

  for (const [type, raw] of Object.entries(kills)) {
    const spec = ENEMY_REWARDS[type];
    if (!spec || !(spec.crypto > 0)) continue;                 // trash mobs pay no token
    const n = Number.isSafeInteger(raw) && raw > 0 ? raw : 0;
    if (!n) continue;
    const already = credited[type] | 0;
    const claimed = Math.max(0, n - already);
    if (!claimed) continue;
    const cap = spec.cap.burst + Math.floor(dt * spec.cap.perSec);
    const allowed = Math.max(0, Math.min(claimed, cap));
    if (!allowed) { out.skipped.push(`${type}:over_cap`); continue; }
    if (allowed < claimed) out.skipped.push(`${type}:capped`);

    const amountRaw = allowed * spec.crypto * CRYPTO_UNIT_RAW;
    const nextCount = already + allowed;

    if (!isLinked) {
      // UNLINKED: nothing enters the ledger. The count still advances so a replayed save
      // cannot record the same kill twice, and the value lands in the retroactive record.
      credited[type] = nextCount;
      out.pendingRaw += amountRaw;
      out.byType[type] = (out.byType[type] || 0) + amountRaw;
      continue;
    }

    const res = apply(playerKey, {
      id: `combat:${type}:${playerKey}:${nextCount}`,
      reason: 'combat', resource: 'wayfarer', amount: amountRaw,
      meta: { type, count: nextCount, killed: allowed },
    });
    if (res.applied || res.reason === 'duplicate') {
      credited[type] = nextCount;
      out.creditedRaw += amountRaw;
      out.byType[type] = (out.byType[type] || 0) + amountRaw;
    } else {
      out.skipped.push(`${type}:${res.reason}`);
      log.warn('econ combat credit refused', { type, reason: res.reason });
    }
  }
  state.putCombat(playerKey, { credited, savedAtMs: nowMs });
  if (out.pendingRaw > 0) state.addPendingRaw(playerKey, out.pendingRaw);
  return out;
}

/** The character-save hook the relay calls after validate.js accepted a save. */
export function creditKillsForSave(player, info, nowMs = Date.now()) {
  const token = player?.token;
  if (typeof token !== 'string' || !token) return null;
  const playerKey = stateKeyFor(token);
  if (!playerKey) return null;

  // RETROACTIVE HOOK (part 3). While this device has NO signature-verified wallet,
  // record the one-time accomplishments of this save and what its kills would have been
  // worth. Recorded and reported; NEVER paid. Once a wallet is linked the live credit
  // below takes over, so there is nothing retroactive left to keep.
  let pending = null;
  if (linkedWallet(playerKey) === null) {
    const rec = recordSaveAccomplishments(playerKey, info?.rec, info?.raw, nowMs);
    pending = { recorded: rec.added };
  }

  const kills = info?.rec?.kills;
  if (!kills || typeof kills !== 'object') {
    return pending ? { ok: true, linked: false, creditedRaw: 0, pendingRaw: 0, byType: {}, skipped: [], pending } : null;
  }
  const out = creditKills(playerKey, kills, nowMs);
  if (pending) out.pending = pending;
  return out;
}

// ── claim ───────────────────────────────────────────────────────────────────
// THE ONE AUTHORITY. The destination is resolved through server/walletStore.js
// `verifiedWalletFor` — the same function `balanceFor` and the wallet routes use — and
// through nothing else (docs/BLOCKCHAIN_V1.md §3.5). An unlinked device, an unverified
// record and a legacy on-disk link all resolve to null, so a claim fails closed.

/**
 * Resolve the destination for a DEVICE, server-side only — no request field can name an
 * address. `deps.verifiedWalletImpl` / `deps.walletAuthorityImpl` exist ONLY so a test
 * can stand in for the authority; production passes nothing and reads the real module.
 */
export async function resolveWalletForDevice(deviceKeyStr, deps = {}) {
  let addr = null;
  try {
    if (typeof deps.verifiedWalletImpl === 'function') {
      addr = await deps.verifiedWalletImpl(deviceKeyStr);
    } else if (deps.walletAuthorityImpl !== undefined) {
      const authority = typeof deps.walletAuthorityImpl === 'function' ? await deps.walletAuthorityImpl() : deps.walletAuthorityImpl;
      if (authority && typeof authority.verifiedWalletFor === 'function') addr = await authority.verifiedWalletFor(deviceKeyStr);
    } else {
      addr = linkedWallet(deviceKeyStr);
    }
  } catch (e) {
    log.warn('econ: verified-wallet lookup failed; refusing', { err: e.message });
    return null;
  }
  // Defence in depth on top of the authority's own answer: never treat a non-address as
  // a destination, whatever a stand-in returns.
  if (typeof addr !== 'string' || !VERIFIED_WALLET.test(addr)) return null;
  return { address: addr, source: 'walletStore.verifiedWalletFor', linkedAt: null };
}

/**
 * Claim the whole liquid WAYFARER balance to the device's verified wallet.
 *
 * `deps` exists ONLY for tests (payouts.claim takes the same injection points). Production
 * calls pass nothing: the HTTP layer never forwards a body field into it.
 */
export async function claimFor(playerKey, deviceKeyStr, { claimId } = {}, deps = {}) {
  if (claimId !== undefined && !CLAIM_ID_RE.test(String(claimId))) {
    return { ok: false, error: 'bad_claim_id', message: 'claimId must be 6-160 characters of [A-Za-z0-9_:.-]' };
  }
  const id = claimId === undefined ? makeClaimId(playerKey) : String(claimId);

  let wallet;
  try { wallet = await resolveWalletForDevice(deviceKeyStr, deps); }
  catch (e) { return { ok: false, error: 'wallet_lookup_failed', message: e.message }; }
  if (!wallet) {
    // OPT-IN, never an error and never a missed opportunity: the whole game runs on gold
    // without a wallet. The code is the one the client's panel/marker already knows.
    return {
      ok: false, error: 'wallet_not_linked', message: WALLET_OPT_IN, address: null,
      reason: 'wallet_not_linked',
    };
  }

  const balance = balancesOf(playerKey) || { gold: 0, wayfarer: 0 };
  const amountRaw = balance.wayfarer;

  // IDEMPOTENCY FIRST. A client that times out and retries asks with the same claim id; the
  // honest answer is "that claim already landed", not "nothing to claim" — the ledger debit
  // is keyed on `claim:<id>`, so the ledger can answer that question authoritatively even
  // after the balance has been paid down to zero.
  if (hasApplied(playerKey, `claim:${id}`)) {
    return {
      ok: true, alreadyPaid: true, reason: 'already_paid', claimId: id,
      destination: wallet.address, amountRaw: 0, availableRaw: amountRaw,
      payoutsEnabled: payoutsEnabled(), balances: balance,
    };
  }

  if (!(amountRaw > 0)) {
    return { ok: false, error: 'nothing_to_claim', availableRaw: 0, destination: wallet.address, claimId: id };
  }

  const res = await payoutsClaim(
    { playerKey, walletAddress: wallet.address, amountRaw, claimId: id },
    deps.payoutDeps || {},
  );

  // payouts.claim answers in its own vocabulary; map it to the surface's, without losing
  // the original reason (it is what an operator will grep for).
  const dry = res.reason === 'dry_run';
  return {
    ...res,
    ok: res.ok === true,
    error: res.ok === true ? undefined : res.reason,
    dryRun: dry ? true : undefined,
    claimId: id,
    destination: wallet.address,
    amountRaw,
    payoutsEnabled: payoutsEnabled(),
    chainReady: chainReady(),
    missing: missingChainConfig(),
    spentBudgetRaw: state.budgetSpentRaw(),
  };
}
