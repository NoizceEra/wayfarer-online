'use strict';

// Standalone, side-effect-free prize accounting policy. This file deliberately
// does not connect to wallets, a database, or the arena message handlers.
// Callers must persist every transition transactionally before any payout.

const CURRENCIES = Object.freeze({
  WAYFARER: Object.freeze({ decimals: 9, unit: 'token base units' }),
  SOL: Object.freeze({ decimals: 9, unit: 'lamports' }),
  USDC: Object.freeze({ decimals: 6, unit: 'USDC base units' }),
});
const STATES = Object.freeze(['OPEN', 'LOCKED', 'SETTLEMENT_PENDING', 'SETTLED', 'VOID']);
const TRANSITIONS = Object.freeze({
  OPEN: new Set(['LOCKED', 'VOID']),
  LOCKED: new Set(['SETTLEMENT_PENDING', 'VOID']),
  SETTLEMENT_PENDING: new Set(['SETTLED', 'VOID']),
  SETTLED: new Set(),
  VOID: new Set(),
});
const DEFAULT_LIMITS = Object.freeze({
  minEntrants: 2,
  maxEntrants: 64,
  maxEntryUnits: 10_000_000_000_000n,
  maxPoolUnits: 100_000_000_000_000n,
  maxPlatformFeeBps: 2_000,
});

function amount(value, label = 'amount') {
  if (typeof value !== 'string' && typeof value !== 'bigint' && typeof value !== 'number') {
    throw new TypeError(label + ' must be an integer base-unit amount');
  }
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError(label + ' must be a non-negative safe integer');
  }
  const text = String(value);
  if (!/^(0|[1-9][0-9]*)$/.test(text)) throw new RangeError(label + ' must be an unsigned integer string');
  return BigInt(text);
}

function normalizeLimits(input = {}) {
  const limits = {
    minEntrants: input.minEntrants ?? DEFAULT_LIMITS.minEntrants,
    maxEntrants: input.maxEntrants ?? DEFAULT_LIMITS.maxEntrants,
    maxEntryUnits: amount(input.maxEntryUnits ?? DEFAULT_LIMITS.maxEntryUnits, 'maxEntryUnits'),
    maxPoolUnits: amount(input.maxPoolUnits ?? DEFAULT_LIMITS.maxPoolUnits, 'maxPoolUnits'),
    maxPlatformFeeBps: input.maxPlatformFeeBps ?? DEFAULT_LIMITS.maxPlatformFeeBps,
  };
  if (!Number.isInteger(limits.minEntrants) || limits.minEntrants < 2 ||
      !Number.isInteger(limits.maxEntrants) || limits.maxEntrants < limits.minEntrants || limits.maxEntrants > 256) {
    throw new RangeError('entrant limits must satisfy 2 <= min <= max <= 256');
  }
  if (!Number.isInteger(limits.maxPlatformFeeBps) || limits.maxPlatformFeeBps < 0 || limits.maxPlatformFeeBps > 2_000) {
    throw new RangeError('platform fee must be between 0 and 2000 basis points');
  }
  if (limits.maxEntryUnits <= 0n || limits.maxPoolUnits <= 0n) throw new RangeError('unit limits must be positive');
  return limits;
}

// Entrant IDs must already be authenticated and deduplicated by the caller.
function quotePool({ currency, entryUnits, entrantIds, platformFeeBps = 0, limits: rawLimits } = {}) {
  const meta = CURRENCIES[currency];
  if (!meta) throw new RangeError('unsupported prize currency');
  const limits = normalizeLimits(rawLimits);
  const entry = amount(entryUnits, 'entryUnits');
  if (entry === 0n || entry > limits.maxEntryUnits) throw new RangeError('entry amount is outside configured bounds');
  if (!Array.isArray(entrantIds) || entrantIds.length < limits.minEntrants || entrantIds.length > limits.maxEntrants) {
    throw new RangeError('entrant count is outside configured bounds');
  }
  const ids = entrantIds.map((id) => {
    if (typeof id !== 'string' || id.length < 1 || id.length > 160) throw new TypeError('entrant IDs must be strings up to 160 characters');
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new RangeError('entrant IDs must be unique');
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > limits.maxPlatformFeeBps) {
    throw new RangeError('platform fee exceeds configured bound');
  }
  const gross = entry * BigInt(ids.length);
  if (gross > limits.maxPoolUnits) throw new RangeError('pool exceeds configured bound');
  const fee = gross * BigInt(platformFeeBps) / 10_000n;
  const payout = gross - fee;
  return Object.freeze({
    currency, decimals: meta.decimals, unit: meta.unit,
    entryUnits: entry.toString(), entrantCount: ids.length, entrantIds: Object.freeze(ids),
    grossPoolUnits: gross.toString(), platformFeeBps, platformFeeUnits: fee.toString(),
    winnerPayoutUnits: payout.toString(), state: 'OPEN',
  });
}

// Every prerequisite defaults false; a nominal quote cannot make a payout ready.
function payoutReadiness({ enabled = false, currency, ledgerAvailable = false,
  custodyConfigured = false, treasuryFunded = false, resultVerified = false,
  idempotencyStoreAvailable = false } = {}) {
  if (!CURRENCIES[currency]) return { ready: false, reason: 'UNSUPPORTED_CURRENCY' };
  const missing = [];
  if (enabled !== true) missing.push('PAYOUTS_DISABLED');
  if (ledgerAvailable !== true) missing.push('DURABLE_LEDGER_UNAVAILABLE');
  if (custodyConfigured !== true) missing.push('CUSTODY_UNCONFIGURED');
  if (treasuryFunded !== true) missing.push('TREASURY_FUNDING_UNVERIFIED');
  if (resultVerified !== true) missing.push('MATCH_RESULT_UNVERIFIED');
  if (idempotencyStoreAvailable !== true) missing.push('IDEMPOTENCY_STORE_UNAVAILABLE');
  return missing.length ? { ready: false, reason: missing[0], missing } : { ready: true, reason: null, missing: [] };
}

// Repeating a transition to the current state is safe. Terminal states are final.
function transition(current, next) {
  if (!STATES.includes(current) || !STATES.includes(next)) throw new RangeError('unknown settlement state');
  if (current === next) return { accepted: true, idempotent: true, state: current };
  if (!TRANSITIONS[current].has(next)) return { accepted: false, idempotent: false, state: current, reason: 'INVALID_STATE_TRANSITION' };
  return { accepted: true, idempotent: false, state: next };
}

// Caller must atomically persist the returned intent keyed by matchId before a chain submission.
function settlementIntent({ matchId, winnerId, quote, readiness } = {}) {
  if (typeof matchId !== 'string' || !matchId || matchId.length > 160) throw new TypeError('matchId is required');
  if (!quote || !CURRENCIES[quote.currency]) throw new TypeError('valid pool quote required');
  if (!quote.entrantIds?.includes(winnerId)) throw new RangeError('winner must be an entrant');
  if (quote.state !== 'LOCKED') throw new RangeError('pool must be locked before settlement');
  if (readiness?.ready !== true) return { accepted: false, reason: readiness?.reason || 'PAYOUT_NOT_READY' };
  return {
    accepted: true, matchId, idempotencyKey: 'arena:' + matchId + ':' + quote.currency,
    currency: quote.currency, winnerId, amountUnits: quote.winnerPayoutUnits,
    platformFeeUnits: quote.platformFeeUnits, state: 'SETTLEMENT_PENDING',
  };
}

module.exports = Object.freeze({
  CURRENCIES, STATES,
  DEFAULT_LIMITS: Object.freeze({
    ...DEFAULT_LIMITS,
    maxEntryUnits: DEFAULT_LIMITS.maxEntryUnits.toString(),
    maxPoolUnits: DEFAULT_LIMITS.maxPoolUnits.toString(),
  }),
  quotePool, payoutReadiness, transition, settlementIntent,
});
