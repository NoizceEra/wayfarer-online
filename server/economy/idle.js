// server/economy/idle.js
// Offline ("idle") gold accrual for Wayfarer Online.
//
// PURE MODULE (see CONTRACT.md "Purity rules"):
//   - no fs / net / fetch / Date.now / randomness
//   - no imports at all (only Node built-ins would be allowed anyway)
//   - never mutates its inputs; always returns a new object
//   - deterministic: identical arguments -> identical output
//   - integer-money safe: gold is floored, never rounded up
//
// All numbers come from CONTRACT.md "Canonical numbers — FROZEN".
// Do not edit the constants below without editing the contract.

const HOUR_MS = 3600 * 1000;
const BPS = 10000; // denominator for basis-point multipliers (10000 bps = 1.00x)

/** Frozen canonical idle constants + tier table for this module's domain. */
export const IDLE = Object.freeze({
  BASE_RATE_GOLD_PER_HOUR: 120,
  BASE_CAP_HOURS: 8,
  MAX_CAP_HOURS: 24,
  HOUR_MS,
  TIER_IDS: Object.freeze(['none', 't1', 't2', 't3']),
  //  idleMultiplierBps : idle multiplier in basis points (10000 = 1.00x)
  //  capBonusHours     : hours added to BASE_CAP_HOURS before the MAX clamp
  TIERS: Object.freeze({
    none: Object.freeze({ id: 'none', idleMultiplierBps: 10000, capBonusHours: 0 }),
    t1: Object.freeze({ id: 't1', idleMultiplierBps: 11500, capBonusHours: 4 }),
    t2: Object.freeze({ id: 't2', idleMultiplierBps: 13500, capBonusHours: 8 }),
    t3: Object.freeze({ id: 't3', idleMultiplierBps: 16000, capBonusHours: 16 }),
  }),
});

/** Reject anything that is not one of the four frozen tier ids. Never default. */
function tierSpec(stakeTier) {
  if (typeof stakeTier !== 'string') {
    throw new TypeError(
      `idle: stakeTier must be a string, got ${typeof stakeTier} (${safeShow(stakeTier)}); ` +
        `expected one of ${IDLE.TIER_IDS.join(', ')}`,
    );
  }
  const spec = Object.prototype.hasOwnProperty.call(IDLE.TIERS, stakeTier)
    ? IDLE.TIERS[stakeTier]
    : undefined;
  if (!spec) {
    throw new RangeError(
      `idle: unknown stakeTier ${JSON.stringify(stakeTier)}; ` +
        `expected one of ${IDLE.TIER_IDS.join(', ')}`,
    );
  }
  return spec;
}

function safeShow(v) {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

function requireFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`idle: ${name} must be a finite number, got ${safeShow(value)}`);
  }
  return value;
}

/**
 * Hard idle cap, in hours, for a stake tier.
 * BASE_CAP_HOURS + capBonusHours(tier), clamped to MAX_CAP_HOURS.
 * @param {'none'|'t1'|'t2'|'t3'} stakeTier
 * @returns {number} 8 | 12 | 16 | 24
 */
export function idleCapHours(stakeTier) {
  const spec = tierSpec(stakeTier);
  return Math.min(IDLE.BASE_CAP_HOURS + spec.capBonusHours, IDLE.MAX_CAP_HOURS);
}

/**
 * Idle rate multiplier for a stake tier.
 * @param {'none'|'t1'|'t2'|'t3'} stakeTier
 * @returns {number} 1 | 1.15 | 1.35 | 1.6
 */
export function stakeMultiplier(stakeTier) {
  return tierSpec(stakeTier).idleMultiplierBps / BPS;
}

/** Integer gold-per-hour for a tier (computed in bps so the double is exact). */
function ratePerHourFor(spec) {
  return (IDLE.BASE_RATE_GOLD_PER_HOUR * spec.idleMultiplierBps) / BPS;
}

/**
 * Gold accrued for an offline interval.
 *
 *   ratePerHour  = BASE_RATE_GOLD_PER_HOUR * stakeMultiplier(stakeTier)
 *   capHours     = idleCapHours(stakeTier)
 *   creditedMs   = floor(min(elapsedMs, capHours * 3600 * 1000))   // clamped at 0
 *   gold         = floor(ratePerHour * creditedMs / 3600000)       // always down
 *   hitCap       = elapsedMs > capHours * 3600 * 1000
 *   elapsedMs <= 0 => gold 0, hoursCredited 0, hitCap false        // never negative
 *
 * `elapsedMs` is authoritative. If it is omitted, it is derived from
 * `nowMs - lastAccrualMs` (both must then be finite numbers); it is never
 * defaulted to a safe-looking value.
 *
 * @param {{elapsedMs:number, stakeTier:'none'|'t1'|'t2'|'t3', nowMs?:number, lastAccrualMs?:number}} input
 * @returns {{gold:number, hoursCredited:number, cappedMs:number, cappedHours:number, ratePerHour:number, hitCap:boolean}}
 */
export function accrualFor(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError(`idle: accrualFor expects an object, got ${safeShow(input)}`);
  }

  const spec = tierSpec(input.stakeTier);

  let elapsedMs = input.elapsedMs;
  if (elapsedMs === undefined || elapsedMs === null) {
    const nowMs = input.nowMs;
    const lastAccrualMs = input.lastAccrualMs;
    if (
      typeof nowMs !== 'number' ||
      !Number.isFinite(nowMs) ||
      typeof lastAccrualMs !== 'number' ||
      !Number.isFinite(lastAccrualMs)
    ) {
      throw new TypeError(
        'idle: elapsedMs is required (or supply finite nowMs and lastAccrualMs to derive it); ' +
          `got elapsedMs=${safeShow(elapsedMs)}, nowMs=${safeShow(nowMs)}, lastAccrualMs=${safeShow(lastAccrualMs)}`,
      );
    }
    elapsedMs = nowMs - lastAccrualMs;
  }
  requireFiniteNumber(elapsedMs, 'elapsedMs');

  const cappedHours = Math.min(IDLE.BASE_CAP_HOURS + spec.capBonusHours, IDLE.MAX_CAP_HOURS);
  const capMs = cappedHours * HOUR_MS;
  const ratePerHour = ratePerHourFor(spec);

  const positive = elapsedMs > 0;
  // Hard cap. Negative elapsed never becomes negative credit.
  const cappedMs = positive ? Math.floor(Math.min(elapsedMs, capMs)) : 0;
  const gold = Math.floor((ratePerHour * cappedMs) / HOUR_MS);

  return {
    gold: gold < 0 ? 0 : gold,
    hoursCredited: cappedMs / HOUR_MS,
    cappedMs,
    cappedHours,
    ratePerHour,
    hitCap: positive && elapsedMs > capMs,
  };
}

export default { IDLE, idleCapHours, stakeMultiplier, accrualFor };
