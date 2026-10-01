// server/economy/rates.test.mjs
import { RATE_SHEET, rateRows, idleGoldPerDay, summaryLine } from './rates.js';
import { returnFor, BUDGET_TOTAL_RAW } from './stakeMath.js';

const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertThrows = (fn, msg) => {
    let threw = false;
    try { fn(); } catch { threw = true; }
    assert(threw, msg);
};

let passed = 0, failed = 0;

const test = (name, fn) => {
    try { fn(); console.log(`ok ${name}`); passed++; }
    catch (e) { console.error(`FAIL ${name}\n    ${e.message}`); failed++; }
};

test('rateRows returns exactly 4 rows in order none, t1, t2, t3', () => {
    const rows = rateRows();
    assert(rows.length === 4, `expected 4 rows, got ${rows.length}`);
    assert(rows[0].tierId === 'none' && rows[1].tierId === 't1' &&
           rows[2].tierId === 't2' && rows[3].tierId === 't3',
           'row order mismatch');
});

test('every row matches CONTRACT canonical numbers literally', () => {
    const r = RATE_SHEET;
    // none
    assert(r.none.idleMultiplier === 1.00, 'none.idleMultiplier');
    assert(r.none.idleCapHours === 8,      'none.idleCapHours');
    assert(r.none.aprBps === 0,            'none.aprBps');
    assert(r.none.minLockRaw === 0,        'none.minLockRaw');
    assert(r.none.lockDays === 0,          'none.lockDays');
    // t1
    assert(r.t1.idleMultiplier === 1.15,   't1.idleMultiplier');
    assert(r.t1.idleCapHours === 12,       't1.idleCapHours');
    assert(r.t1.aprBps === 300,            't1.aprBps');
    assert(r.t1.minLockRaw === 1000000000, 't1.minLockRaw');
    assert(r.t1.lockDays === 7,            't1.lockDays');
    // t2
    assert(r.t2.idleMultiplier === 1.35,    't2.idleMultiplier');
    assert(r.t2.idleCapHours === 16,        't2.idleCapHours');
    assert(r.t2.aprBps === 450,             't2.aprBps');
    assert(r.t2.minLockRaw === 10000000000, 't2.minLockRaw');
    assert(r.t2.lockDays === 30,            't2.lockDays');
    // t3
    assert(r.t3.idleMultiplier === 1.60,    't3.idleMultiplier');
    assert(r.t3.idleCapHours === 24,        't3.idleCapHours');
    assert(r.t3.aprBps === 600,             't3.aprBps');
    assert(r.t3.minLockRaw === 50000000000, 't3.minLockRaw');
    assert(r.t3.lockDays === 90,            't3.lockDays');
});

test("summaryLine('t1') publishes the rate that is ACTUALLY PAID, not the nominal APR", () => {
    const s = summaryLine('t1');
    assert(s === 't1 · 1,000 WAYFARER locked 7d · +15% idle (4h extra cap) · 1.61%/yr (paid, not nominal)',
           `t1 line mismatch: ${s}`);
    assert(s.includes('1,000') && s.includes('7d') && s.includes('+15%') &&
           s.includes('4h') && s.includes('1.61%'), 't1 fragments missing');
    // The nominal rate must NOT be presented as the return: emissions decay across the span.
    assert(!s.includes('3.00%'), 't1 still publishes the nominal 3.00% as if it were paid');
});

test("summaryLine('t3') contains required fragments", () => {
    const s = summaryLine('t3');
    assert(s.includes('50,000'), 't3 missing 50,000');
    assert(s.includes('90d'),    't3 missing 90d');
    assert(s.includes('16h'),    't3 missing 16h');
    assert(s.includes('3.22%'),  't3 missing the effective 3.22%');
    assert(!s.includes('6.00%'), 't3 still publishes the nominal 6.00% as if it were paid');
});

test("summaryLine('none') does not claim a lock or a bonus", () => {
    const s = summaryLine('none');
    assert(!/locked/i.test(s),        'none claims a lock');
    assert(!/\+15%|\+35%|\+60%/.test(s), 'none claims a stake bonus');
    assert(!/WAYFARER locked/.test(s),'none mentions locked WAYFARER');
    assert(!/\d+\.\d{2}%/.test(s),    'none claims a rate');
});

test('the published rate equals what returnFor actually pays (the anti-lie check)', () => {
    for (const t of ['t1','t2','t3']) {
        const r = RATE_SHEET[t];
        const paid = returnFor({
            tierId: t,
            amountRaw: r.minLockRaw,
            elapsedMs: 365 * 86400000,
            budgetRemainingRaw: BUDGET_TOTAL_RAW,
        }).owedCappedRaw;
        const publishedTokens = Math.floor((r.minLockRaw * (r.effectiveYear1Bps / 10000)));
        // Both must land within a rounding unit of each other, or the sheet is lying.
        const diff = Math.abs(paid - publishedTokens);
        assert(diff <= r.minLockRaw / 10000 + 1,
            `${t}: sheet publishes ${publishedTokens} but the code pays ${paid}`);
    }
});

test('idleGoldPerDay is an integer, floored, and strictly increasing', () => {
    const vals = ['none','t1','t2','t3'].map(idleGoldPerDay);
    for (const v of vals) assert(Number.isInteger(v), `${v} not integer`);
    // exact floored values
    assert(vals[0] === 960,  `none expected 960, got ${vals[0]}`);    // floor(120*1.0*8)
    assert(vals[1] === 1656, `t1 expected 1656, got ${vals[1]}`);     // floor(120*1.15*12)=floor(1656.0)
    assert(vals[2] === 2592, `t2 expected 2592, got ${vals[2]}`);     // floor(120*1.35*16)
    assert(vals[3] === 4608, `t3 expected 4608, got ${vals[3]}`);     // floor(120*1.6*24)
    assert(vals[1] > vals[0] && vals[2] > vals[1] && vals[3] > vals[2],
           'not strictly increasing');
});

test('rounding is always DOWN (no path rounds a payout up)', () => {
    // t1: 120*1.15*12 = 1656.0 exactly -> check a fractional case via multiplier path:
    // direct invariant: result <= raw product, and result+1 > raw product
    const raw = 120 * 1.15 * 12;
    const v = idleGoldPerDay('t1');
    assert(v <= raw && v + 1 > raw, 'floor invariant violated');
});

test('caps are hard: t3 cap equals MAX_CAP_HOURS 24 (never above)', () => {
    assert(RATE_SHEET.t3.idleCapHours === 24, 't3 cap should be clamped at 24');
    for (const id of ['none','t1','t2','t3']) {
        assert(RATE_SHEET[id].idleCapHours <= 24, `${id} cap exceeds MAX_CAP_HOURS`);
    }
});

test('unknown tier throws in both functions (never defaults)', () => {
    assertThrows(() => idleGoldPerDay('t4'),    'idleGoldPerDay(t4) should throw');
    assertThrows(() => idleGoldPerDay('T1'),    'idleGoldPerDay(T1) should throw');
    assertThrows(() => idleGoldPerDay(''),      'idleGoldPerDay("") should throw');
    assertThrows(() => idleGoldPerDay(undefined),'idleGoldPerDay(undefined) should throw');
    assertThrows(() => idleGoldPerDay(null),    'idleGoldPerDay(null) should throw');
    assertThrows(() => summaryLine('t4'),       'summaryLine(t4) should throw');
    assertThrows(() => summaryLine(''),         'summaryLine("") should throw');
    assertThrows(() => summaryLine(undefined),  'summaryLine(undefined) should throw');
});

test('tier thresholds: one raw unit below / at / above each tier boundary', () => {
    // RATE_SHEET is data-only; thresholds are the minLockRaw values themselves.
    assert(RATE_SHEET.t1.minLockRaw - 1 === 999999999,   't1 threshold-1');
    assert(RATE_SHEET.t1.minLockRaw     === 1000000000,  't1 threshold');
    assert(RATE_SHEET.t1.minLockRaw + 1 === 1000000001,  't1 threshold+1');
    assert(RATE_SHEET.t2.minLockRaw     === 10000000000, 't2 threshold');
    assert(RATE_SHEET.t3.minLockRaw     === 50000000000, 't3 threshold');
    assert(RATE_SHEET.none.minLockRaw   === 0,           'none threshold (zero valid)');
});

test('zero is valid: none tier yields a non-negative integer everywhere', () => {
    assert(idleGoldPerDay('none') === 960, 'none daily gold');
    assert(RATE_SHEET.none.minLockRaw >= 0 && RATE_SHEET.none.lockDays >= 0,
           'none values must be non-negative');
});

test('purity: functions are deterministic and do not mutate inputs', () => {
    const before = JSON.stringify(RATE_SHEET);
    const a = summaryLine('t2');
    const b = summaryLine('t2');
    assert(a === b, 'summaryLine not deterministic');
    const x = idleGoldPerDay('t2');
    const y = idleGoldPerDay('t2');
    assert(x === y, 'idleGoldPerDay not deterministic');
    const rows1 = rateRows();
    const rows2 = rateRows();
    assert(rows1.length === rows2.length, 'rateRows unstable');
    assert(JSON.stringify(RATE_SHEET) === before, 'RATE_SHEET was mutated');
});

console.log(`==== ${passed} passed, ${failed} failed ====`);
process.exit(failed ? 1 : 0);
