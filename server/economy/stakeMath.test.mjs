// stakeMath.test.mjs — tests for stakeMath.js
//
// REWRITTEN after the module was corrected by audit. The delegate's version asserted the
// BUGGY behaviour: it treated a 21-day span as proof of monotonicity (never reaching the
// ~260-day zone where the old formula peaked and then fell) and matched error MESSAGES
// rather than the conditions that matter. These assertions are on properties, not prose.

import { strict as assert } from 'assert';
import {
  BUDGET_TOTAL_RAW, STAKE_TIERS, TIER_IDS, EMISSION,
  lockExpiry, returnFor, budgetDaysAtFullRate, effectiveYear1Bps, year1ReturnRaw,
} from './stakeMath.js';

let passes = 0, failures = 0;
const test = (name, fn) => {
  try { fn(); console.log(`✓ ${name}`); passes++; }
  catch (err) { console.error(`✗ ${name} — ${err.message}`); failures++; }
};
const DAY = 86400000;
const M = 10 ** 6;

// ── the tier table the CONTRACT pins ─────────────────────────────────────────
test('every tier carries every field the contract pins', () => {
  for (const id of TIER_IDS) {
    const t = STAKE_TIERS[id];
    for (const f of ['id', 'minLockRaw', 'lockDays', 'idleMultiplier', 'capBonusHours', 'aprBps', 'label']) {
      assert.ok(f in t, `${id} is missing ${f}`);
    }
  }
  assert.equal(STAKE_TIERS.t1.minLockRaw, 1000 * M);
  assert.equal(STAKE_TIERS.t2.minLockRaw, 10000 * M);
  assert.equal(STAKE_TIERS.t3.minLockRaw, 50000 * M);
  assert.equal(STAKE_TIERS.t1.idleMultiplier, 1.15);
  assert.equal(STAKE_TIERS.t3.capBonusHours, 16);
});

// ── validation: refuse, never default ────────────────────────────────────────
test('an unknown tier throws', () => {
  assert.throws(() => lockExpiry(0, 'unknown'));
  assert.throws(() => lockExpiry(0, 't4'));
  assert.throws(() => lockExpiry(0, ''));
  assert.throws(() => returnFor({ tierId: 't9', amountRaw: 0, elapsedMs: 0, budgetRemainingRaw: 0 }));
});
test('a negative or fractional principal throws', () => {
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: -1, elapsedMs: 0, budgetRemainingRaw: 0 }));
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: 1.5, elapsedMs: 0, budgetRemainingRaw: 0 }));
});
test('a negative or fractional budget throws', () => {
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: 0, elapsedMs: 0, budgetRemainingRaw: -1 }));
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: 0, elapsedMs: 0, budgetRemainingRaw: 0.5 }));
});
test('a NaN or negative elapsedMs throws (it used to poison the budget)', () => {
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: M, elapsedMs: NaN, budgetRemainingRaw: M }));
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: M, elapsedMs: -1, budgetRemainingRaw: M }));
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: M, elapsedMs: Infinity, budgetRemainingRaw: M }));
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: M, budgetRemainingRaw: M }));   // elapsed missing
});
test('a budget above the lifetime budget throws', () => {
  assert.throws(() => returnFor({ tierId: 't1', amountRaw: M, elapsedMs: DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW + 1 }));
});
test('a non-finite clock throws', () => {
  assert.throws(() => lockExpiry(NaN, 't1'));
  assert.throws(() => lockExpiry(undefined, 't1'));
});

// ── lock periods ─────────────────────────────────────────────────────────────
test('lockExpiry matches the tier lock period', () => {
  assert.equal(lockExpiry(0, 't1'), 7 * DAY);
  assert.equal(lockExpiry(0, 't2'), 30 * DAY);
  assert.equal(lockExpiry(0, 't3'), 90 * DAY);
  assert.equal(lockExpiry(0, 'none'), 0);
  assert.equal(lockExpiry(1000, 't1'), 1000 + 7 * DAY);
});

// ── core arithmetic ──────────────────────────────────────────────────────────
test('zero elapsed pays exactly zero, and is not flagged exhausted', () => {
  const r = returnFor({ tierId: 't2', amountRaw: 100 * M, elapsedMs: 0, budgetRemainingRaw: BUDGET_TOTAL_RAW });
  assert.equal(r.owedRaw, 0);
  assert.equal(r.owedCappedRaw, 0);
  assert.equal(r.budgetAfterRaw, BUDGET_TOTAL_RAW);
  assert.equal(r.exhausted, false);
});
test('the hard cap holds even against a budget of 1', () => {
  const r = returnFor({ tierId: 't1', amountRaw: 1e12, elapsedMs: 100 * DAY, budgetRemainingRaw: 1 });
  assert.ok(r.owedCappedRaw <= 1);
  assert.equal(r.owedCappedRaw, 1);
  assert.equal(r.budgetAfterRaw, 0);
  assert.equal(r.partial, true);
  assert.equal(r.exhausted, true);
});
test('an empty budget pays nothing and reports exhausted', () => {
  const r = returnFor({ tierId: 't3', amountRaw: 50_000 * M, elapsedMs: 365 * DAY, budgetRemainingRaw: 0 });
  assert.equal(r.owedCappedRaw, 0);
  assert.equal(r.budgetAfterRaw, 0);
  assert.equal(r.exhausted, true);
});
test('the return is less than naive undecayed interest', () => {
  const amt = 10 ** 9;
  const r = returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 365 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW });
  assert.ok(r.owedRaw < amt * 0.06, `decay did not apply: ${r.owedRaw}`);
  assert.ok(r.owedRaw > 0, `decay overshot to zero: ${r.owedRaw}`);
  assert.ok(r.owedRaw < 0.75 * amt * 0.06, 'decay is weaker than the ~0.537 factor implies');
});
test('the budget never goes negative and never exceeds the lifetime cap', () => {
  for (const budget of [0, 1, M, BUDGET_TOTAL_RAW]) {
    for (const days of [0, 1, 400, 5000]) {
      const r = returnFor({ tierId: 't2', amountRaw: 10 ** 9, elapsedMs: days * DAY, budgetRemainingRaw: budget });
      assert.ok(r.budgetAfterRaw >= 0, `budget went negative at ${budget}/${days}`);
      assert.ok(r.owedCappedRaw <= budget, `paid more than the budget at ${budget}/${days}`);
    }
  }
});

// ── MONOTONICITY, over the range where the old formula actually failed ───────
test('owedRaw is monotonic non-decreasing across 1..3000 days', () => {
  const amt = 50_000 * M;
  let prev = -1;
  for (let d = 1; d <= 3000; d += 3) {
    const r = returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: d * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW });
    assert.ok(r.owedRaw >= prev, `regression at day ${d}: ${r.owedRaw} < ${prev}`);
    prev = r.owedRaw;
  }
});
test('a two-year lock pays more than a 260-day lock (the old peak-then-fall bug)', () => {
  const amt = 50_000 * M;
  const at260 = returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 260 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW }).owedRaw;
  const at730 = returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 730 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW }).owedRaw;
  assert.ok(at730 > at260, `${at730} should exceed ${at260}`);
});
test('the decay is real: a late span earns less than an equally long early span', () => {
  const amt = 10 ** 9;
  const early = returnFor({ tierId: 't2', amountRaw: amt, elapsedMs: 90 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW, accrueStartMs: 0, scheduleStartMs: 0 });
  const late = returnFor({ tierId: 't2', amountRaw: amt, elapsedMs: 90 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW, accrueStartMs: 720 * DAY, scheduleStartMs: 0 });
  assert.ok(late.owedRaw < early.owedRaw, `late ${late.owedRaw} should be below early ${early.owedRaw}`);
});

// ── what the sheet publishes must equal what the code pays ───────────────────
test('effectiveYear1Bps agrees with the actual year-1 payout', () => {
  for (const t of ['t1', 't2', 't3']) {
    const principal = STAKE_TIERS[t].minLockRaw;
    const paid = returnFor({ tierId: t, amountRaw: principal, elapsedMs: 365 * DAY, budgetRemainingRaw: BUDGET_TOTAL_RAW }).owedCappedRaw;
    const viaHelper = year1ReturnRaw(t, principal);
    assert.equal(paid, viaHelper, `${t}: returnFor ${paid} vs year1ReturnRaw ${viaHelper}`);
    const implied = (principal * effectiveYear1Bps(t)) / 10000;
    assert.ok(Math.abs(implied - paid) <= principal / 10000 + 1,
      `${t}: published ${effectiveYear1Bps(t)}bps implies ${Math.round(implied)} but pays ${paid}`);
  }
});
test('the published effective rate is far below the nominal rate (no overstatement)', () => {
  for (const t of ['t1', 't2', 't3']) {
    const nominal = STAKE_TIERS[t].aprBps;
    const effective = effectiveYear1Bps(t);
    assert.ok(effective < nominal, `${t}: effective ${effective} should be below nominal ${nominal}`);
    assert.ok(effective > nominal * 0.4, `${t}: effective ${effective} collapsed unexpectedly`);
  }
});

// ── the budget is a real, finite number ──────────────────────────────────────
test('the lifetime budget is finite and a small share of supply', () => {
  assert.ok(Number.isSafeInteger(BUDGET_TOTAL_RAW));
  assert.ok(BUDGET_TOTAL_RAW / EMISSION.SUPPLY_RAW <= 0.10, 'the emission is over 10% of supply');
  assert.ok(budgetDaysAtFullRate(50_000 * M, 't3') > 0);
  assert.equal(budgetDaysAtFullRate(0, 't3'), Infinity);
  assert.equal(budgetDaysAtFullRate(50_000 * M, 'none'), Infinity);
});

console.log(`==== ${passes} passed, ${failures} failed ====`);
process.exit(failures ? 1 : 0);
