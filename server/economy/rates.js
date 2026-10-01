// rates.js — the published rate sheet, shown to players.
//
// SINGLE SOURCE OF TRUTH. The first version of this file (written by a delegate) kept its
// own private copy of the tier numbers, so the same table existed in three modules and any
// change would silently diverge. It now DERIVES every row from stakeMath.js (tiers, APR) and
// idle.js (multiplier, cap), so there is exactly one copy of the numbers in the codebase.
//
// IT PUBLISHES WHAT IS ACTUALLY PAID. The nominal `aprBps` is not what a staker receives:
// emissions decay across the holding span, so a one-year hold earns the integral of a
// decaying rate, about 0.537 of nominal. The sheet therefore prints the year-1 EFFECTIVE
// rate (see stakeMath.effectiveYear1Bps) instead of the headline APR. Advertising 3.00%
// APR while the code paid 1.61% was the single most misleading thing in this economy.

import { STAKE_TIERS, TIER_IDS, effectiveYear1Bps, year1ReturnRaw, EMISSION } from './stakeMath.js';
import { IDLE, idleCapHours, stakeMultiplier } from './idle.js';

export const TAPER_NOTE =
  `Returns taper: the effective rate halves every ${EMISSION.HALF_LIFE_DAYS} days of programme age, ` +
  `and the lifetime emission budget is capped at ${EMISSION.BUDGET_TOTAL_RAW / 10 ** 6} WAYFARER ` +
  `(${((EMISSION.BUDGET_TOTAL_RAW / EMISSION.SUPPLY_RAW) * 100).toFixed(1)}% of supply). ` +
  `The figure shown is what a one-year lock actually pays, not a headline APR.`;

export const RATE_SHEET = Object.freeze(
  Object.fromEntries(TIER_IDS.map((id) => {
    const t = STAKE_TIERS[id];
    return [id, Object.freeze({
      tierId: id,
      label: t.label,
      idleMultiplier: t.idleMultiplier,
      idleCapHours: idleCapHours(id),
      apyNominalBps: t.aprBps,                       // internal only, never published as the return
      aprBps: t.aprBps,                              // kept: the CONTRACT pins this field name
      effectiveYear1Bps: effectiveYear1Bps(id),      // what is actually paid, and published
      minLockRaw: t.minLockRaw,
      lockDays: t.lockDays,
      capBonusHours: t.capBonusHours,
    })];
  })),
);

/** Rows in display order: none, t1, t2, t3. */
export function rateRows() { return TIER_IDS.map((id) => RATE_SHEET[id]); }

function row(tierId) {
  if (typeof tierId !== 'string' || !Object.prototype.hasOwnProperty.call(RATE_SHEET, tierId)) {
    throw new RangeError(`rates: unknown tierId ${JSON.stringify(tierId)}; expected one of ${TIER_IDS.join(', ')}`);
  }
  return RATE_SHEET[tierId];
}

/** Gold a player banking a FULL capped idle day earns at this tier. */
export function idleGoldPerDay(stakeTier) {
  const r = row(stakeTier);
  return Math.floor(IDLE.BASE_RATE_GOLD_PER_HOUR * r.idleMultiplier * r.idleCapHours);
}

/** Tokens a first-year lock on the tier's minimum principal actually pays. */
export function year1Tokens(stakeTier) {
  const r = row(stakeTier);
  return year1ReturnRaw(stakeTier, r.minLockRaw);
}

/**
 * One-line summary for the UI. The rate shown is the effective year-1 rate, because that is
 * what the player will actually receive.
 *   t1 · 1,000 WAYFARER locked 7d · +15% idle (4h extra cap) · 1.61%/yr (paid)
 */
export function summaryLine(tierId) {
  const r = row(tierId);
  if (tierId === 'none') {
    return `none · no lock · base idle only (${idleGoldPerDay('none')} gold/day)`;
  }
  const whole = r.minLockRaw / 10 ** 6;
  const bonus = Math.round((r.idleMultiplier - 1) * 100);
  const extraCap = r.idleCapHours - IDLE.BASE_CAP_HOURS;
  const pct = (r.effectiveYear1Bps / 100).toFixed(2);
  return `${tierId} · ${whole.toLocaleString('en-US')} WAYFARER locked ${r.lockDays}d · ` +
    `+${bonus}% idle (${extraCap}h extra cap) · ${pct}%/yr (paid, not nominal)`;
}

export { stakeMultiplier, idleCapHours };

export default { RATE_SHEET, rateRows, idleGoldPerDay, year1Tokens, summaryLine, TAPER_NOTE };
