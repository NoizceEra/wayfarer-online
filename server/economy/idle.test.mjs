// server/economy/idle.test.mjs — tests for idle.js (offline accrual).
// Run: cd /d/ai-studio/wayfarer-online && node server/economy/idle.test.mjs
//
// Asserts the CONTRACT invariants (down-rounding, hard caps, unknown input throws,
// zero valid / negative not) plus the required boundaries: exactly-at-cap, one ms
// below/above the cap, empty/zero input, tier ratios.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IDLE, idleCapHours, stakeMultiplier, accrualFor } from './idle.js';

const HOUR = 3600 * 1000;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed += 1;
    console.log(`  FAIL ${name}`);
    console.log(`       ${err && err.message ? err.message : String(err)}`);
  }
}

function eq(actual, expected, msg) {
  if (!Object.is(actual, expected)) {
    throw new Error(
      `${msg ? msg + ': ' : ''}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function throws(fn, msg) {
  let threw = false;
  let value;
  try {
    value = fn();
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`${msg || 'expected throw'}: returned ${JSON.stringify(value)}`);
}

const sections = [];
let current = null;
function section(title) {
  current = { title, count: 0 };
  sections.push(current);
}
function t(name, fn) {
  if (current) current.count += 1;
  test(name, fn);
}

// ---------------------------------------------------------------- canonical numbers
console.log('\ncanonical numbers (CONTRACT, frozen)');
section('numbers');
t('BASE_RATE_GOLD_PER_HOUR is 120', () => eq(IDLE.BASE_RATE_GOLD_PER_HOUR, 120));
t('BASE_CAP_HOURS is 8', () => eq(IDLE.BASE_CAP_HOURS, 8));
t('MAX_CAP_HOURS is 24', () => eq(IDLE.MAX_CAP_HOURS, 24));
t("TIER_IDS is exactly ['none','t1','t2','t3']", () =>
  eq(JSON.stringify(IDLE.TIER_IDS), JSON.stringify(['none', 't1', 't2', 't3'])));
t("idleCapHours('none') is 8", () => eq(idleCapHours('none'), 8));
t("idleCapHours('t1') is 12", () => eq(idleCapHours('t1'), 12));
t("idleCapHours('t2') is 16", () => eq(idleCapHours('t2'), 16));
t("idleCapHours('t3') is 24 (MAX clamp)", () => eq(idleCapHours('t3'), 24));
t("idleCapHours('t3') equals MAX_CAP_HOURS exactly", () =>
  eq(idleCapHours('t3'), IDLE.MAX_CAP_HOURS));
t("stakeMultiplier('none') is 1", () => eq(stakeMultiplier('none'), 1));
t("stakeMultiplier('t1') is 1.15", () => eq(stakeMultiplier('t1'), 1.15));
t("stakeMultiplier('t2') is 1.35", () => eq(stakeMultiplier('t2'), 1.35));
t("stakeMultiplier('t3') is 1.6", () => eq(stakeMultiplier('t3'), 1.6));
t('ratePerHour none is 120', () =>
  eq(accrualFor({ elapsedMs: 0, stakeTier: 'none' }).ratePerHour, 120));
t('ratePerHour t1 is 138', () =>
  eq(accrualFor({ elapsedMs: 0, stakeTier: 't1' }).ratePerHour, 138));
t('ratePerHour t2 is 162', () =>
  eq(accrualFor({ elapsedMs: 0, stakeTier: 't2' }).ratePerHour, 162));
t('ratePerHour t3 is 192', () =>
  eq(accrualFor({ elapsedMs: 0, stakeTier: 't3' }).ratePerHour, 192));

// ---------------------------------------------------------------- zero / negative input
console.log('\nzero and negative elapsed (invariant 4: zero valid, negative is not)');
section('zero/negative');
t('elapsedMs 0 -> gold 0, hoursCredited 0, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 0, stakeTier: 'none' });
  eq(r.gold, 0, 'gold');
  eq(r.hoursCredited, 0, 'hoursCredited');
  eq(r.hitCap, false, 'hitCap');
  eq(r.cappedMs, 0, 'cappedMs');
});
t('elapsedMs 0 still reports the tier cap (cappedHours 8) and rate 120', () => {
  const r = accrualFor({ elapsedMs: 0, stakeTier: 'none' });
  eq(r.cappedHours, 8, 'cappedHours');
  eq(r.ratePerHour, 120, 'ratePerHour');
});
t('elapsedMs 0 on t3 -> gold 0, hoursCredited 0, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 0, stakeTier: 't3' });
  eq(r.gold, 0, 'gold');
  eq(r.hoursCredited, 0, 'hoursCredited');
  eq(r.hitCap, false, 'hitCap');
});
t('elapsedMs -1 -> gold 0 (not negative), hitCap false', () => {
  const r = accrualFor({ elapsedMs: -1, stakeTier: 'none' });
  eq(r.gold, 0, 'gold');
  ok(r.gold >= 0, 'gold must never be negative');
  eq(r.hoursCredited, 0, 'hoursCredited');
  eq(r.hitCap, false, 'hitCap');
});
t('elapsedMs -1e15 -> gold 0, cappedMs 0', () => {
  const r = accrualFor({ elapsedMs: -1e15, stakeTier: 't3' });
  eq(r.gold, 0, 'gold');
  eq(r.cappedMs, 0, 'cappedMs');
  eq(r.hoursCredited, 0, 'hoursCredited');
});
t('every tier: negative elapsed yields exactly 0 gold', () => {
  for (const tier of IDLE.TIER_IDS) {
    const r = accrualFor({ elapsedMs: -12345, stakeTier: tier });
    eq(r.gold, 0, `gold for ${tier}`);
    ok(!r.hitCap, `hitCap for ${tier}`);
  }
});

// ---------------------------------------------------------------- the cap boundary
console.log('\ncap boundary (invariant 2: caps are hard)');
section('cap boundary');
t('exactly AT the cap (8h, none): gold is the full cap amount 960, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 8 * HOUR, stakeTier: 'none' });
  eq(r.gold, 960, 'gold at cap = 8h * 120/h');
  eq(r.hitCap, false, 'hitCap must be false exactly at the cap');
  eq(r.cappedMs, 8 * HOUR, 'cappedMs');
  eq(r.hoursCredited, 8, 'hoursCredited');
});
t('one ms BEYOND the cap (8h+1ms, none): SAME gold 960 (hard cap, not a slope)', () => {
  const atCap = accrualFor({ elapsedMs: 8 * HOUR, stakeTier: 'none' });
  const r = accrualFor({ elapsedMs: 8 * HOUR + 1, stakeTier: 'none' });
  eq(r.gold, atCap.gold, 'gold one ms past cap');
  eq(r.gold, 960, 'gold is the cap amount');
  eq(r.hitCap, true, 'hitCap must be true past the cap');
  eq(r.cappedMs, 8 * HOUR, 'cappedMs pinned to the cap');
});
t('one ms BELOW the cap (8h-1ms, none): 959 gold, hitCap false, under the cap', () => {
  const r = accrualFor({ elapsedMs: 8 * HOUR - 1, stakeTier: 'none' });
  eq(r.gold, 959, 'gold one ms below cap');
  eq(r.hitCap, false, 'hitCap below cap');
  eq(r.cappedMs, 8 * HOUR - 1, 'cappedMs is the real elapsed');
  ok(r.gold < 960, 'just below the cap must be less than the cap amount');
});
t('30-day elapsed on none credits only 8 hours, not 720 (gold 960, not 86400)', () => {
  const r = accrualFor({ elapsedMs: 30 * 24 * HOUR, stakeTier: 'none' });
  eq(r.hoursCredited, 8, 'hoursCredited');
  eq(r.cappedMs, 8 * HOUR, 'cappedMs');
  eq(r.gold, 960, 'gold');
  ok(r.gold !== 86400, 'must not pay 30 days of accrual');
  eq(r.hitCap, true, 'hitCap');
});
t('10-year elapsed on none is still exactly 960 gold', () => {
  const r = accrualFor({ elapsedMs: 10 * 365 * 24 * HOUR, stakeTier: 'none' });
  eq(r.gold, 960, 'gold');
});
t('t1 exactly at 12h cap -> 1656 gold, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 12 * HOUR, stakeTier: 't1' });
  eq(r.gold, 1656, 'gold = 12h * 138');
  eq(r.hitCap, false, 'hitCap');
});
t('t1 one ms past 12h cap -> still 1656, hitCap true', () => {
  const r = accrualFor({ elapsedMs: 12 * HOUR + 1, stakeTier: 't1' });
  eq(r.gold, 1656, 'gold');
  eq(r.hitCap, true, 'hitCap');
});
t('t2 exactly at 16h cap -> 2592 gold, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 16 * HOUR, stakeTier: 't2' });
  eq(r.gold, 2592, 'gold = 16h * 162');
  eq(r.hitCap, false, 'hitCap');
});
t('t2 one ms past 16h cap -> still 2592, hitCap true', () => {
  const r = accrualFor({ elapsedMs: 16 * HOUR + 1, stakeTier: 't2' });
  eq(r.gold, 2592, 'gold');
  eq(r.hitCap, true, 'hitCap');
});
t('t3 exactly at 24h cap -> 4608 gold, hitCap false', () => {
  const r = accrualFor({ elapsedMs: 24 * HOUR, stakeTier: 't3' });
  eq(r.gold, 4608, 'gold = 24h * 192');
  eq(r.hitCap, false, 'hitCap');
});
t('t3 one ms past 24h cap -> still 4608, hitCap true', () => {
  const r = accrualFor({ elapsedMs: 24 * HOUR + 1, stakeTier: 't3' });
  eq(r.gold, 4608, 'gold');
  eq(r.hitCap, true, 'hitCap');
});
t('every tier: cap+1ms pays exactly the same as cap (cap is hard)', () => {
  for (const tier of IDLE.TIER_IDS) {
    const capMs = idleCapHours(tier) * HOUR;
    const at = accrualFor({ elapsedMs: capMs, stakeTier: tier });
    const past = accrualFor({ elapsedMs: capMs + 1, stakeTier: tier });
    const way = accrualFor({ elapsedMs: capMs * 1000, stakeTier: tier });
    eq(past.gold, at.gold, `gold just past cap for ${tier}`);
    eq(way.gold, at.gold, `gold far past cap for ${tier}`);
    ok(at.hitCap === false && past.hitCap === true, `hitCap flag for ${tier}`);
  }
});

// ---------------------------------------------------------------- tier ratio / rounding
console.log('\ntier ratios and down-rounding (invariant 1)');
section('ratio/rounding');
t("t3 yields exactly 1.6x the 'none' gold for identical elapsed time (1h)", () => {
  const none = accrualFor({ elapsedMs: 1 * HOUR, stakeTier: 'none' });
  const t3 = accrualFor({ elapsedMs: 1 * HOUR, stakeTier: 't3' });
  eq(none.gold, 120, 'none gold');
  eq(t3.gold, 192, 't3 gold');
  eq(t3.gold, none.gold * 1.6, 't3 = 1.6x none');
  eq(t3.gold * 5, none.gold * 8, 'exact integer ratio t3:none = 8:5');
});
t("t3 yields exactly 1.6x the 'none' gold over a full capped 8h", () => {
  const none = accrualFor({ elapsedMs: 8 * HOUR, stakeTier: 'none' });
  const t3 = accrualFor({ elapsedMs: 8 * HOUR, stakeTier: 't3' });
  eq(none.gold, 960, 'none gold');
  eq(t3.gold, 1536, 't3 gold');
  eq(t3.gold, none.gold * 1.6, 't3 = 1.6x none');
});
t('t1/t2 rates are exact over a full capped interval (integer bps, no float drift)', () => {
  const t1 = accrualFor({ elapsedMs: 12 * HOUR, stakeTier: 't1' }).gold;
  const t2 = accrualFor({ elapsedMs: 16 * HOUR, stakeTier: 't2' }).gold;
  eq(t1, 1656, 't1 12h = 12 * 138');
  eq(t2, 2592, 't2 16h = 16 * 162');
  // Naive float math drifts low: 120*12*1.15 === 1655.9999999999998 in IEEE754.
  ok(t1 >= 120 * 12 * 1.15, 'must not fall below the exact earned amount');
  ok(t2 >= 120 * 16 * 1.35, 'must not fall below the exact earned amount');
});
t('rounding is DOWN: 1 minute on t1 is 2.3 gold -> 2', () => {
  const r = accrualFor({ elapsedMs: 60000, stakeTier: 't1' });
  eq(r.gold, 2, 'floor(138 * 60000 / 3600000) = floor(2.3)');
});
t('rounding is DOWN: 1 ms is 0 gold, never 1', () => {
  for (const tier of IDLE.TIER_IDS) {
    eq(accrualFor({ elapsedMs: 1, stakeTier: tier }).gold, 0, `1ms on ${tier}`);
  }
});
t('30 minutes on none credits 0.5 hours and 60 gold (fractional hours are fine)', () => {
  const r = accrualFor({ elapsedMs: 30 * 60 * 1000, stakeTier: 'none' });
  eq(r.hoursCredited, 0.5, 'hoursCredited');
  eq(r.gold, 60, 'gold');
});
t('paid gold never exceeds the exact earned amount (floor property, all tiers)', () => {
  const probes = [
    1, 999, 1000, 60000, 1800000, HOUR - 1, HOUR, HOUR + 1, 7 * HOUR + 12345,
    30 * 24 * HOUR, HOUR * 99999,
  ];
  for (const tier of IDLE.TIER_IDS) {
    const capMs = idleCapHours(tier) * HOUR;
    for (const elapsedMs of probes) {
      const r = accrualFor({ elapsedMs, stakeTier: tier });
      const credited = Math.min(elapsedMs, capMs);
      const exact = (r.ratePerHour * credited) / HOUR;
      ok(Number.isInteger(r.gold), `gold integer for ${tier}@${elapsedMs}`);
      ok(r.gold <= exact, `gold ${r.gold} must not exceed exact ${exact} (${tier}@${elapsedMs})`);
      ok(r.gold >= 0, `gold non-negative for ${tier}@${elapsedMs}`);
      ok(Math.floor(exact) === r.gold, `gold must equal floor(exact) for ${tier}@${elapsedMs}`);
    }
  }
});

// ---------------------------------------------------------------- unknown input throws
console.log('\nunknown input is rejected, not defaulted (invariant 3)');
section('throws');
t("accrualFor throws on unknown tier 't4'", () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: 't4' }), 't4 must throw'));
t("accrualFor throws on unknown tier 'premium'", () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: 'premium' }), 'premium must throw'));
t("accrualFor throws on empty-string tier ''", () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: '' }), "'' must throw"));
t("accrualFor throws on wrong-case tier 'T1'", () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: 'T1' }), "'T1' must throw"));
t('accrualFor throws on null tier', () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: null }), 'null tier must throw'));
t('accrualFor throws on numeric tier 1', () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: 1 }), 'numeric tier must throw'));
t('accrualFor throws when stakeTier is missing', () =>
  throws(() => accrualFor({ elapsedMs: HOUR }), 'missing tier must throw'));
t('accrualFor throws on inherited prototype key (constructor)', () =>
  throws(() => accrualFor({ elapsedMs: HOUR, stakeTier: 'constructor' }), 'prototype key must throw'));
t("idleCapHours throws on unknown tier 't9'", () =>
  throws(() => idleCapHours('t9'), 'idleCapHours must throw'));
t("stakeMultiplier throws on unknown tier 'bogus'", () =>
  throws(() => stakeMultiplier('bogus'), 'stakeMultiplier must throw'));
t('unknown tier never silently defaults to none (no numeric result leaks)', () => {
  let got;
  try {
    got = idleCapHours('nope');
  } catch {
    got = 'threw';
  }
  eq(got, 'threw', 'must throw rather than return 8');
});
t('accrualFor throws when elapsedMs is missing and no clock args are given', () =>
  throws(() => accrualFor({ stakeTier: 'none' }), 'missing elapsedMs must throw'));
t('accrualFor throws on NaN elapsedMs', () =>
  throws(() => accrualFor({ elapsedMs: NaN, stakeTier: 'none' }), 'NaN must throw'));
t('accrualFor throws on Infinity elapsedMs', () =>
  throws(() => accrualFor({ elapsedMs: Infinity, stakeTier: 'none' }), 'Infinity must throw'));
t("accrualFor throws on string elapsedMs '3600000'", () =>
  throws(() => accrualFor({ elapsedMs: '3600000', stakeTier: 'none' }), 'string ms must throw'));
t('accrualFor throws on null input', () => throws(() => accrualFor(null), 'null input must throw'));
t('accrualFor throws on undefined input', () =>
  throws(() => accrualFor(undefined), 'undefined input must throw'));
t('accrualFor throws on array input', () => throws(() => accrualFor([]), 'array input must throw'));
t('accrualFor throws when only one clock arg is supplied', () =>
  throws(() => accrualFor({ stakeTier: 'none', nowMs: 1000 }), 'partial clock must throw'));

// ---------------------------------------------------------------- purity / determinism
console.log('\npurity, determinism, no input mutation');
section('purity');
t('does not mutate its input object (frozen input works, values unchanged)', () => {
  const input = Object.freeze({ elapsedMs: 3 * HOUR, stakeTier: 't2' });
  const before = JSON.stringify(input);
  const r = accrualFor(input);
  eq(JSON.stringify(input), before, 'input changed');
  eq(r.gold, 486, 'gold = 3h * 162');
  eq(input.elapsedMs, 3 * HOUR, 'elapsedMs');
  eq(input.stakeTier, 't2', 'stakeTier');
});
t('returns a fresh object each call (no shared/static state)', () => {
  const a = accrualFor({ elapsedMs: HOUR, stakeTier: 't1' });
  const b = accrualFor({ elapsedMs: HOUR, stakeTier: 't1' });
  ok(a !== b, 'must be a new object');
  eq(JSON.stringify(a), JSON.stringify(b), 'same args -> same values');
});
t('is deterministic: identical args produce deep-equal results', () => {
  const args = { elapsedMs: 5 * HOUR + 4321, stakeTier: 't3' };
  eq(
    JSON.stringify(accrualFor({ ...args })),
    JSON.stringify(accrualFor({ ...args })),
    'determinism',
  );
});
t('exact output shape: only the six contract keys', () => {
  const keys = Object.keys(accrualFor({ elapsedMs: HOUR, stakeTier: 'none' })).sort();
  eq(
    JSON.stringify(keys),
    JSON.stringify(['cappedHours', 'cappedMs', 'gold', 'hitCap', 'hoursCredited', 'ratePerHour']),
    'keys',
  );
});
t('derives elapsedMs from nowMs - lastAccrualMs when elapsedMs is omitted', () => {
  const derived = accrualFor({ stakeTier: 't1', nowMs: 10_000_000, lastAccrualMs: 10_000_000 - 2 * HOUR });
  const explicit = accrualFor({ elapsedMs: 2 * HOUR, stakeTier: 't1' });
  eq(JSON.stringify(derived), JSON.stringify(explicit), 'derived vs explicit');
  eq(derived.gold, 276, 'gold = 2h * 138');
});
t('derivation clamps a backwards clock (lastAccrualMs > nowMs) to 0, never negative', () => {
  const r = accrualFor({ stakeTier: 't2', nowMs: 1000, lastAccrualMs: 9_000_000 });
  eq(r.gold, 0, 'gold');
  ok(!r.hitCap, 'hitCap');
});
t('source is pure: no Date.now, Math.random, fetch, timers, env or non-builtin imports', () => {
  const raw = readFileSync(fileURLToPath(new URL('./idle.js', import.meta.url)), 'utf8');
  // Strip comments first: the module's own doc comment *mentions* Date.now to ban it.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  for (const bad of ['Date.now', 'Math.random', 'fetch(', 'XMLHttpRequest', 'process.env', 'setTimeout', 'setInterval', 'require(']) {
    ok(!src.includes(bad), `idle.js must not reference ${bad}`);
  }
  const imports = [...src.matchAll(/^\s*import[^;]*from\s+'([^']+)'/gm)].map((m) => m[1]);
  for (const spec of imports) {
    ok(spec.startsWith('node:'), `only node: builtin imports allowed, found '${spec}'`);
  }
});

// ---------------------------------------------------------------- summary
const total = passed + failed;
console.log('\n---------------------------------------------------------------');
for (const s of sections) {
  if (s.count) console.log(`  ${String(s.count).padStart(2)} tests  ${s.title}`);
}
console.log(`  ${String(total).padStart(2)} tests  TOTAL`);
console.log(`==== ${passed} passed, ${failed} failed ====`);

process.exit(failed ? 1 : 0);
