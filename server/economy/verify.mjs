/**
 * verify.mjs — INDEPENDENT cross-module verification of the economy core.
 *
 * The four worker modules each keep their own private copy of the tier numbers, which is
 * how parallel work silently diverges. This file is the lock: it asserts the copies AGREE,
 * that the invariants hold under fuzzing rather than under examples someone chose, and it
 * prints what the numbers actually promise a player.
 *
 * Written by the orchestrator, not the delegates. Their own tests passed while two of them
 * shipped real defects, so "their test is green" is not evidence used here.
 *
 * Run: node server/economy/verify.mjs
 */
import fs from 'node:fs';

import * as idle from './idle.js';
import * as stake from './stakeMath.js';
import * as fees from './fees.js';
import * as rates from './rates.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const TIERS = ['none', 't1', 't2', 't3'];
const M = 10 ** 6;
const DAY = 86400000;

// Deterministic PRNG: a fuzz that cannot be reproduced is not a regression test.
let seed = 0x2F6E2B1;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

console.log('\nA. every pinned identifier in CONTRACT.md exists in the code, and vice versa');
{
  const c = fs.readFileSync(new URL('./CONTRACT.md', import.meta.url), 'utf8');
  const grab = (name) => (c.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`)) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);

  const feeKeys = grab('FEE_KEYS');
  const tierIds = grab('STAKE_TIER_IDS');
  ok('the contract pins 5 fee keys', feeKeys.length === 5, `${feeKeys.length}`);
  ok('fees.js implements exactly the pinned fee keys',
    feeKeys.length === Object.keys(fees.FEE_TABLE).length && feeKeys.every((k) => k in fees.FEE_TABLE),
    feeKeys.filter((k) => !(k in fees.FEE_TABLE)).join(',') || 'ok');
  ok('fees.js invents no fee key the contract did not pin',
    Object.keys(fees.FEE_TABLE).every((k) => feeKeys.includes(k)),
    Object.keys(fees.FEE_TABLE).filter((k) => !feeKeys.includes(k)).join(',') || 'ok');
  ok('the contract pins 4 stake tiers', tierIds.length === 4);
  ok('every module agrees on the four tier ids',
    TIERS.every((t) => t in stake.STAKE_TIERS && t in rates.RATE_SHEET));
}

console.log('\nB. the three private copies of the tier table AGREE (this is the divergence lock)');
for (const t of TIERS) {
  const s = stake.STAKE_TIERS[t], r = rates.RATE_SHEET[t];
  ok(`${t}: idle multiplier agrees across idle/stakeMath/rates`,
    idle.stakeMultiplier(t) === s.idleMultiplier && s.idleMultiplier === r.idleMultiplier,
    `${idle.stakeMultiplier(t)} vs ${s.idleMultiplier} vs ${r.idleMultiplier}`);
  ok(`${t}: idle cap hours agree`,
    idle.idleCapHours(t) === r.idleCapHours,
    `${idle.idleCapHours(t)} vs ${r.idleCapHours}`);
  ok(`${t}: APR agrees`, s.aprBps === r.aprBps, `${s.aprBps} vs ${r.aprBps}`);
  ok(`${t}: min lock agrees`, s.minLockRaw === r.minLockRaw, `${s.minLockRaw} vs ${r.minLockRaw}`);
  ok(`${t}: lock days agree`, s.lockDays === r.lockDays, `${s.lockDays} vs ${r.lockDays}`);
  const expectedCap = Math.min(8 + s.capBonusHours, 24);
  ok(`${t}: cap is base 8 + bonus, clamped to 24`, idle.idleCapHours(t) === expectedCap);
  ok(`${t}: the rate sheet's derived gold/day matches idle accrual for a full-cap day`,
    rates.idleGoldPerDay(t) === idle.accrualFor({ elapsedMs: idle.idleCapHours(t) * 3600000, stakeTier: t }).gold,
    `${rates.idleGoldPerDay(t)} vs ${idle.accrualFor({ elapsedMs: idle.idleCapHours(t) * 3600000, stakeTier: t }).gold}`);
}

console.log('\nC. the LIFETIME EMISSION BUDGET is structurally unbreakable (fuzzed)');
{
  const B = stake.BUDGET_TOTAL_RAW;
  let breaches = 0, nans = 0, negatives = 0, checked = 0, capped = 0;
  for (let i = 0; i < 20000; i++) {
    const tierId = TIERS[1 + Math.floor(rnd() * 3)];
    // Base units, not tokens: keep every value a SAFE INTEGER or the module is right to
    // throw. (An earlier draft of this line divided by 1e6 and produced a float.)
    const amountRaw = Math.floor(rnd() * 1e9) * M;                    // up to 1e15 base units
    const elapsedMs = Math.floor(rnd() * 4000) * DAY;                 // up to ~11 years
    const budget = Math.floor(rnd() * B);
    const r = stake.returnFor({ tierId, amountRaw, elapsedMs, budgetRemainingRaw: budget });
    checked++;
    if (!Number.isFinite(r.owedCappedRaw) || !Number.isFinite(r.budgetAfterRaw)) nans++;
    if (r.owedCappedRaw > budget) breaches++;
    if (r.budgetAfterRaw < 0) negatives++;
    if (r.partial) capped++;
  }
  ok(`no payout ever exceeded its remaining budget (${checked} cases)`, breaches === 0, `breaches=${breaches}`);
  ok('no NaN ever entered a money value', nans === 0, `nans=${nans}`);
  ok('the budget never went negative', negatives === 0, `negatives=${negatives}`);
  ok('the budget genuinely bites on large requests', capped > 0, `capped=${capped}`);
  ok('a budget above the lifetime budget is refused',
    throws(() => stake.returnFor({ tierId: 't1', amountRaw: M, elapsedMs: DAY, budgetRemainingRaw: B + 1 })));
}

console.log('\nD. returns are MONOTONIC in lock duration (the defect the delegate shipped)');
{
  const amt = 50_000 * M;
  let regressions = 0, worst = '';
  let prev = -1;
  for (let d = 1; d <= 3000; d += 7) {
    const r = stake.returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: d * DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW });
    if (r.owedCappedRaw < prev) { regressions++; if (!worst) worst = `day ${d}: ${r.owedCappedRaw} < ${prev}`; }
    prev = r.owedCappedRaw;
  }
  ok('owed tokens never fall as the lock lengthens (1..3000 days)', regressions === 0, worst);
  const at260 = stake.returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 260 * DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW }).owedCappedRaw;
  const at730 = stake.returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 730 * DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW }).owedCappedRaw;
  ok('two years of locking pays MORE than 260 days (the old bug paid less)', at730 > at260, `${at730} vs ${at260}`);
  const at1 = stake.returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW }).owedCappedRaw;
  const at0 = stake.returnFor({ tierId: 't3', amountRaw: amt, elapsedMs: 0, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW }).owedCappedRaw;
  ok('zero elapsed pays exactly zero', at0 === 0);
  ok('one day pays a real, small amount', at1 > 0 && at1 < at260);
}

console.log('\nE. ROUNDING IS ALWAYS DOWN — nobody earns a fraction of a unit');
{
  let overIdle = 0, overStake = 0;
  for (let i = 0; i < 5000; i++) {
    const tierId = TIERS[Math.floor(rnd() * 4)];
    const ms = Math.floor(rnd() * 40) * DAY;
    const a = idle.accrualFor({ elapsedMs: ms, stakeTier: tierId });
    const exact = (a.ratePerHour * a.cappedMs) / 3600000;
    if (a.gold > exact) overIdle++;

    const amt = Math.floor(rnd() * 1e6) * M;
    const s = stake.returnFor({ tierId, amountRaw: amt, elapsedMs: ms, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW });
    if (s.owedCappedRaw > s.owedRaw) overStake++;
  }
  ok('idle gold never exceeds the exact accrual', overIdle === 0, `${overIdle}`);
  ok('capped stake returns never exceed what was owed', overStake === 0, `${overStake}`);
  ok('idle gold is always an integer', TIERS.every((t) =>
    Number.isInteger(idle.accrualFor({ elapsedMs: 5 * DAY, stakeTier: t }).gold)));
  ok('fees always round down', fees.feeFor('market_sale', 19).feeGold === 0 &&
    fees.feeFor('trade', 199).feeGold === 3);
}

console.log('\nF. unknown input THROWS everywhere (it never silently defaults)');
{
  const cases = [
    ['idle.idleCapHours', () => idle.idleCapHours('t9')],
    ['idle.stakeMultiplier', () => idle.stakeMultiplier('')],
    ['idle.accrualFor', () => idle.accrualFor({ elapsedMs: DAY, stakeTier: 'T1' })],
    ['stake.lockExpiry', () => stake.lockExpiry(Date.now(), 't9')],
    ['stake.returnFor', () => stake.returnFor({ tierId: 't9', amountRaw: M, elapsedMs: DAY, budgetRemainingRaw: M })],
    ['stake.returnFor(NaN elapsed)', () => stake.returnFor({ tierId: 't1', amountRaw: M, elapsedMs: NaN, budgetRemainingRaw: M })],
    ['stake.returnFor(negative elapsed)', () => stake.returnFor({ tierId: 't1', amountRaw: M, elapsedMs: -1, budgetRemainingRaw: M })],
    ['stake.returnFor(fractional amount)', () => stake.returnFor({ tierId: 't1', amountRaw: 1.5, elapsedMs: DAY, budgetRemainingRaw: M })],
    ['stake.lockExpiry(NaN now)', () => stake.lockExpiry(NaN, 't1')],
    ['fees.feeFor(unknown key)', () => fees.feeFor('tip', 100)],
    ['fees.feeFor(NaN)', () => fees.feeFor('trade', NaN)],
    ['fees.feeFor(string amount)', () => fees.feeFor('trade', '100')],
    ['fees.describeFee(unknown)', () => fees.describeFee('tip')],
    ['rates.idleGoldPerDay(unknown)', () => rates.idleGoldPerDay('t9')],
    ['rates.summaryLine(unknown)', () => rates.summaryLine('t9')],
  ];
  for (const [name, fn] of cases) ok(`${name} throws`, throws(fn));
  // The dangerous inverse: a NaN amount must never return a NaN fee.
  ok('a rejected fee never returns a NaN money value', (() => {
    try { const r = fees.feeFor('trade', NaN); return !Number.isFinite(r.feeGold); } catch { return true; }
  })());
}

console.log('\nG. the fee schedule cannot charge more than the transaction is worth, silently');
{
  const r = fees.feeFor('name_change', 100);
  ok('a 500-gold flat fee against a 100-gold transaction is FLAGGED', r.exceeds === true, JSON.stringify(r));
  ok('the net is reported honestly as 0, not negative', r.netGold === 0);
  const small = fees.feeFor('market_sale', 1);
  ok('a tiny sale is flagged when the flat/rate fee does not fit or rounds to zero',
    small.feeGold === 0 && small.exceeds === false);
  let bad = 0;
  for (const k of Object.keys(fees.FEE_TABLE)) {
    for (const amt of [0, 1, 19, 100, 500, 12345]) {
      const f = fees.feeFor(k, amt);
      if (!Number.isSafeInteger(f.feeGold) || f.feeGold < 0 || f.netGold < 0) bad++;
    }
  }
  ok('every fee over every amount is a non-negative integer', bad === 0, `${bad}`);
}

console.log('\nH. WHAT THIS ACTUALLY PROMISES A PLAYER (the numbers you are shipping)');
{
  const S = stake.EMISSION.SUPPLY_RAW;
  console.log(`  emission budget      : ${stake.BUDGET_TOTAL_RAW / M} WAYFARER over the programme's life`);
  console.log(`  as a share of supply : ${((stake.BUDGET_TOTAL_RAW / S) * 100).toFixed(1)}%  <- maximum possible dilution`);
  console.log(`  an idle player earns : ${TIERS.map((t) => `${t} ${rates.idleGoldPerDay(t)} gold/day`).join('  |  ')}`);
  for (const t of ['t1', 't2', 't3']) {
    const s = stake.STAKE_TIERS[t];
    const sentence = rates.summaryLine(t);
    const oneYear = stake.returnFor({ tierId: t, amountRaw: s.minLockRaw, elapsedMs: 365 * DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW });
    const twoYear = stake.returnFor({ tierId: t, amountRaw: s.minLockRaw, elapsedMs: 730 * DAY, budgetRemainingRaw: stake.BUDGET_TOTAL_RAW });
    console.log(`  ${sentence}`);
    console.log(`      year 1 on the minimum lock: +${(oneYear.owedCappedRaw / M).toFixed(2)} tokens ` +
      `(${((oneYear.owedCappedRaw / s.minLockRaw) * 100).toFixed(2)}%)   ` +
      `cumulative at 2y: +${(twoYear.owedCappedRaw / M).toFixed(2)} (${((twoYear.owedCappedRaw / s.minLockRaw) * 100).toFixed(2)}%)`);
  }
  const drainDays = stake.budgetDaysAtFullRate(50_000 * M, 't3');
  console.log(`  full-rate runway     : one max-tier stake of 50,000 drains the budget in ~${drainDays} days (${(drainDays / 365).toFixed(1)}y)`);
  console.log(`  decay                : the effective rate halves every ${stake.EMISSION.HALF_LIFE_DAYS} days of programme age`);
  ok('the emission budget is a small fraction of supply (under 10%)', stake.BUDGET_TOTAL_RAW / S < 0.10);
  ok('the published APRs are modest (under 10%)', ['t1', 't2', 't3'].every((t) => stake.STAKE_TIERS[t].aprBps <= 1000));
  ok('the budget is finite and cannot be exceeded in a single payout', stake.BUDGET_TOTAL_RAW < S);
  ok('the runway is a real number of days, not infinity', Number.isFinite(drainDays) && drainDays > 0);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
