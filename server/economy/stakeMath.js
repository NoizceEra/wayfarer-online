// stakeMath.js — lock tiers + the BOUNDED emission budget.
//
// WHY THIS MODULE EXISTS: a token with no external revenue cannot pay "yield". Any return
// here is an EMISSION, i.e. dilution of everyone who is not staking. So this module's job
// is to make that emission provably finite and to make the taper real:
//   * the LIFETIME budget is capped (BUDGET_TOTAL_RAW = 5% of supply) and enforced
//     structurally — no argument combination can pay out more;
//   * the rate DECAYS over the programme's life, so emissions taper instead of running at
//     full rate until the budget dies abruptly.
//
// CORRECTED after independent audit. The first version was written by a delegate and its
// own 9 tests passed, but it carried two defects no self-test caught:
//   1. It computed `owed = principal * apr(elapsed) * elapsedDays`, sampling the DECAYED
//      rate at the END of the span. That is not monotonic: f(d) = d * 2^(-d/180) peaks at
//      d = 180/ln2 ≈ 260 days, so a player who locked for two years earned LESS than one
//      who claimed at 260 days. The longer you locked, the less you got.
//   2. It never validated `elapsedMs`. NaN or negative elapsed propagated straight into
//      owedCappedRaw/budgetAfterRaw, poisoning the budget with NaN and corrupting every
//      later payout.
// Both are fixed by INTEGRATING the decayed rate across the span (monotonic, asymptotically
// bounded) and by validating every numeric input.

const DAY_MS = 86400000;
const HALF_LIFE_DAYS = 180;
const LN2 = Math.LN2;
const SUPPLY_RAW = 1_000_000_000 * 10 ** 6;

/** Lifetime emission budget. Hard ceiling on everything this programme ever pays. */
export const BUDGET_TOTAL_RAW = 50_000_000 * 10 ** 6;     // 5% of supply

/** Frozen tier table. Carries every field the CONTRACT pins, so sibling modules can be
 *  checked against THIS object rather than each keeping its own private copy. */
export const STAKE_TIERS = Object.freeze({
  none: Object.freeze({ id: 'none', minLockRaw: 0,               lockDays: 0,  idleMultiplier: 1.00, capBonusHours: 0,  aprBps: 0,   label: 'No stake' }),
  t1:   Object.freeze({ id: 't1',   minLockRaw: 1_000 * 10 ** 6,   lockDays: 7,  idleMultiplier: 1.15, capBonusHours: 4,  aprBps: 300, label: 'Tier 1' }),
  t2:   Object.freeze({ id: 't2',   minLockRaw: 10_000 * 10 ** 6,  lockDays: 30, idleMultiplier: 1.35, capBonusHours: 8,  aprBps: 450, label: 'Tier 2' }),
  t3:   Object.freeze({ id: 't3',   minLockRaw: 50_000 * 10 ** 6,  lockDays: 90, idleMultiplier: 1.60, capBonusHours: 16, aprBps: 600, label: 'Tier 3' }),
});

export const TIER_IDS = Object.freeze(['none', 't1', 't2', 't3']);

function tier(tierId) {
  if (typeof tierId !== 'string' || !Object.prototype.hasOwnProperty.call(STAKE_TIERS, tierId)) {
    throw new RangeError(`stakeMath: unknown tierId ${JSON.stringify(tierId)}; expected one of ${TIER_IDS.join(', ')}`);
  }
  return STAKE_TIERS[tierId];
}

function requireCount(v, name) {
  if (!Number.isSafeInteger(v) || v < 0) {
    throw new TypeError(`stakeMath: ${name} must be a non-negative safe integer, got ${JSON.stringify(v)}`);
  }
  return v;
}

function requireFinite(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new TypeError(`stakeMath: ${name} must be a finite number, got ${JSON.stringify(v)}`);
  }
  return v;
}

/** Unlock timestamp for a tier. Throws on an unknown tier or a non-finite clock. */
export function lockExpiry(nowMs, tierId) {
  const t = tier(tierId);
  requireFinite(nowMs, 'nowMs');
  return nowMs + t.lockDays * DAY_MS;
}

/**
 * Integral of the decayed rate factor across the day-interval [s0Days, s1Days]:
 *   ∫ 2^(-x/H) dx  =  (H/ln2) * ( 2^(-s0/H) - 2^(-s1/H) )
 * Exact, strictly positive for s1 > s0, bounded by (H/ln2) * 2^(-s0/H) as s1 → ∞.
 * Integrating (rather than sampling the rate at the end) is what makes the return
 * monotonic in elapsed time.
 */
function decayedDayFactor(s0Days, s1Days) {
  if (!(s1Days > s0Days)) return 0;
  return (HALF_LIFE_DAYS / LN2) * (2 ** (-s0Days / HALF_LIFE_DAYS) - 2 ** (-s1Days / HALF_LIFE_DAYS));
}

/**
 * Emission owed for one accrual span.
 *
 * @param {object} p
 * @param {string} p.tierId              one of TIER_IDS
 * @param {number} p.amountRaw           principal locked, base units (non-negative int)
 * @param {number} p.elapsedMs           length of the accrual span (>= 0)
 * @param {number} p.budgetRemainingRaw  remaining lifetime emission budget
 * @param {number} [p.accrueStartMs]     when this span began (default 0)
 * @param {number} [p.scheduleStartMs]   epoch the decay clock runs from; defaults to
 *                                       accrueStartMs, i.e. this span starts at full rate.
 *                                       Pass the programme epoch to taper across its life.
 * @returns {{owedRaw:number, owedCappedRaw:number, budgetAfterRaw:number, exhausted:boolean,
 *            partial:boolean, effectiveAprBps:number, spanDays:number}}
 *   partial / exhausted: the remaining budget cut this payout short (or is empty)
 */
export function returnFor({
  tierId, amountRaw, elapsedMs, budgetRemainingRaw, accrueStartMs = 0, scheduleStartMs = null,
} = {}) {
  const t = tier(tierId);
  requireCount(amountRaw, 'amountRaw');
  requireCount(budgetRemainingRaw, 'budgetRemainingRaw');
  requireFinite(elapsedMs, 'elapsedMs');
  if (elapsedMs < 0) throw new RangeError(`stakeMath: elapsedMs must not be negative, got ${elapsedMs}`);
  requireFinite(accrueStartMs, 'accrueStartMs');
  const from = scheduleStartMs === null ? accrueStartMs : scheduleStartMs;
  requireFinite(from, 'scheduleStartMs');

  // A budget above the lifetime budget means a corrupt caller. Refuse rather than pay
  // against a number that could never legitimately exist.
  if (budgetRemainingRaw > BUDGET_TOTAL_RAW) {
    throw new RangeError(`stakeMath: budgetRemainingRaw ${budgetRemainingRaw} exceeds the lifetime budget ${BUDGET_TOTAL_RAW}`);
  }

  const spanDays = elapsedMs / DAY_MS;
  const s0Days = (accrueStartMs - from) / DAY_MS;
  const s1Days = s0Days + spanDays;

  const apr = t.aprBps / 10000;
  const factor = decayedDayFactor(s0Days, s1Days);
  const owedRaw = Math.max(0, Math.floor((amountRaw * apr * factor) / 365));

  const owedCappedRaw = Math.min(owedRaw, budgetRemainingRaw);   // HARD ceiling
  const budgetAfterRaw = budgetRemainingRaw - owedCappedRaw;
  const partial = owedCappedRaw < owedRaw;
  const exhausted = partial;                                     // budget cut it short / empty

  return {
    owedRaw,
    owedCappedRaw,
    budgetAfterRaw,
    exhausted,
    partial,
    effectiveAprBps: spanDays > 0 ? (t.aprBps * factor) / spanDays : 0,
    spanDays,
  };
}

/** Days one tier can be paid at full rate before the lifetime budget is gone. Used to
 *  sanity-check a published APR against what the budget can actually fund. */
export function budgetDaysAtFullRate(amountRaw, tierId) {
  const t = tier(tierId);
  if (t.aprBps === 0 || amountRaw <= 0) return Infinity;
  const perDay = (amountRaw * (t.aprBps / 10000)) / 365;
  return Math.floor(BUDGET_TOTAL_RAW / perDay);
}

/**
 * The rate a stake ACTUALLY earns in its first year, in basis points.
 *
 * This is not the nominal `aprBps`. The decay applies across the span, so a one-year hold
 * accrues the integral of the decaying rate, not a year at the headline rate: the factor
 * over 365 days is ~0.537 of nominal. Publishing `aprBps` as "APR" therefore overstated
 * every tier by roughly 2x (3.00% advertised vs 1.61% actually paid). The rate sheet
 * publishes THIS number instead, so the figure on screen is the figure the code pays.
 */
export function effectiveYear1Bps(tierId) {
  const t = tier(tierId);
  if (t.aprBps === 0) return 0;
  const factor = decayedDayFactor(0, 365);
  return Math.round((t.aprBps * factor) / 365);
}

/** Exact tokens earned in the first year on a given principal — what a player is promised. */
export function year1ReturnRaw(tierId, principalRaw) {
  const t = tier(tierId);
  requireCount(principalRaw, 'principalRaw');
  const factor = decayedDayFactor(0, 365);
  return Math.max(0, Math.floor((principalRaw * (t.aprBps / 10000) * factor) / 365));
}

export const EMISSION = Object.freeze({ BUDGET_TOTAL_RAW, HALF_LIFE_DAYS, SUPPLY_RAW, DAY_MS, LN2 });

export default { STAKE_TIERS, TIER_IDS, BUDGET_TOTAL_RAW, EMISSION, lockExpiry, returnFor, budgetDaysAtFullRate, effectiveYear1Bps, year1ReturnRaw };
