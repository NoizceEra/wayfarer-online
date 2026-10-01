// server/rewards.test.mjs - run: node server/rewards.test.mjs
import assert from 'node:assert/strict';
import { ENEMY_REWARDS, MAX_GOLD_PER_KILL, ROSTER_SIZE, rewardFor, paysCrypto } from './rewards.js';
import { ENEMY_TABLE } from '../src/data/jobs.js';
await import('../src/data/worldEnemies.js'); // merges the rest in, exactly as the game does

let n = 0;
const t = (name, fn) => { try { fn(); n++; console.log('  ok   ' + name); } catch (e) { console.log('  FAIL ' + name + ' :: ' + e.message); process.exitCode = 1; } };

// Importing jobs.js alone shows 8 types. The roster is 84 - a table built from the short
// list would silently omit every boss and every expansion enemy.
t('roster is the FULL merged list, not the jobs.js subset', () => {
  assert.equal(Object.keys(ENEMY_TABLE).length, ROSTER_SIZE, 'client ' + Object.keys(ENEMY_TABLE).length + ' vs table ' + ROSTER_SIZE);
  assert.ok(ROSTER_SIZE > 8, 'roster collapsed to the jobs.js subset');
});
t('every client enemy has a reward, and there are no extras', () => {
  const miss = Object.keys(ENEMY_TABLE).filter((k) => !ENEMY_REWARDS[k]);
  assert.deepEqual(miss, [], 'missing: ' + miss.join(','));
  const extra = Object.keys(ENEMY_REWARDS).filter((k) => !ENEMY_TABLE[k]);
  assert.deepEqual(extra, [], 'extra: ' + extra.join(','));
});
t('per-kill gold mirrors the client ranges exactly', () => {
  for (const [id, c] of Object.entries(ENEMY_TABLE)) assert.deepEqual(ENEMY_REWARDS[id].gold, c.gold, id);
});
// The bug this guards: a flat per-kill ceiling clamped every boss kill to trash value.
t('MAX_GOLD_PER_KILL covers the biggest real kill, bosses included', () => {
  const hi = Math.max(...Object.values(ENEMY_REWARDS).map((r) => r.gold[1]));
  assert.equal(MAX_GOLD_PER_KILL, hi);
  assert.ok(hi >= 400, 'ceiling ' + hi + ' would clamp a boss kill');
});
t('crypto goes to a subset only, with more than one amount', () => {
  const payers = Object.entries(ENEMY_REWARDS).filter(([, r]) => r.crypto > 0);
  assert.ok(payers.length > 0 && payers.length < ROSTER_SIZE, 'not a subset: ' + payers.length + '/' + ROSTER_SIZE);
  assert.ok(new Set(payers.map(([, r]) => r.crypto)).size > 1, 'single flat crypto amount');
});
// A rule that pays nobody is also a failure: ordinary kills must still earn.
t('ordinary enemies still earn gold and pay no crypto', () => {
  const norm = Object.entries(ENEMY_TABLE).filter(([, v]) => !v.boss && (v.hp || 0) < 200);
  assert.ok(norm.length > 0);
  for (const [id] of norm) assert.equal(ENEMY_REWARDS[id].crypto, 0, id + ' should not pay crypto');
  // A few ambient/decorative types are worth nothing by design (hlantern, candlekin, ...).
  // That is fine; what must never happen is the whole ordinary tier paying nothing, which
  // would mean the clamp, not the design, is deciding what a kill is worth.
  const earning = norm.filter(([id]) => ENEMY_REWARDS[id].gold[1] > 0);
  assert.ok(earning.length >= Math.ceil(norm.length * 0.8), 'only ' + earning.length + '/' + norm.length + ' ordinary types earn gold');
});
// Bosses are timer-gated, so more than one between saves is not plausible.
t('boss claims are capped at one per save', () => {
  for (const [id, v] of Object.entries(ENEMY_TABLE)) {
    if (!v.boss) continue;
    assert.equal(ENEMY_REWARDS[id].cap.burst, 1, id + ' burst ' + ENEMY_REWARDS[id].cap.burst);
  }
});
t('no time-based accrual field anywhere; every type can earn', () => {
  for (const [id, r] of Object.entries(ENEMY_REWARDS)) {
    for (const k of Object.keys(r)) assert.ok(!/perHour|idle|tick|accru/i.test(k), id + ' has ' + k);
    assert.ok(r.cap.perSec > 0, id + ' can never earn');
  }
});
t('unknown ids degrade safely', () => {
  assert.deepEqual(rewardFor('not_a_real_enemy'), { gold: [0, 0], crypto: 0, cap: { perSec: 0, burst: 0 } });
  assert.equal(paysCrypto('not_a_real_enemy'), false);
});
console.log(n + ' passed');
