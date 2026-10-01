/**
 * ledger.test.mjs — the money core's test. Written by the orchestrator, not delegated.
 *
 * Emphasis on the failures that lose or invent money: double-payment of a retried entry,
 * overdraft, fractional amounts, and value that vanishes when the process restarts.
 *
 * Run: node server/economy/ledger.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-ledger-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';

const L = await import('./ledger.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const P = 'player_TEST_0001';
const credit = (id, amount, resource = 'gold', reason = 'quest') => L.apply(P, { id, reason, resource, amount });
const debit = (id, amount, resource = 'gold', reason = 'fee') => L.apply(P, { id, reason, resource, amount: -amount });

L.initLedger();
const bal = () => L.balancesOf(P);

console.log('\n1. a new player starts at zero and creates no file');
ok('balances are zero', bal().gold === 0 && bal().wayfarer === 0);
ok('no file written for a read-only balance query', !fs.existsSync(path.join(SANDBOX, 'economy', `${P}.json`)));

console.log('\n2. credits and debits move value');
ok('a credit applies', credit('id_credit_0001', 500).applied === true);
ok('the balance reflects it', bal().gold === 500, JSON.stringify(bal()));
ok('a debit applies', debit('id_debit_0001', 200).applied === true);
ok('the balance reflects it', bal().gold === 300, JSON.stringify(bal()));
ok('the two currencies are independent',
  (credit('id_credit_wf_01', 42, 'wayfarer', 'combat').applied) && bal().wayfarer === 42 && bal().gold === 300);

console.log('\n3. IDEMPOTENCY — the property that stops a retried payout paying twice');
const first = credit('id_retry_00001', 1000);
const retry = credit('id_retry_00001', 1000);
ok('the first application lands', first.applied === true);
ok('the retry is refused', retry.applied === false);
ok('the retry reports "duplicate"', retry.reason === 'duplicate', retry.reason);
ok('the balance moved ONCE, not twice', bal().gold === 1300, `gold=${bal().gold}`);
ok('the retry returns the original entry for audit', retry.entry?.id === 'id_retry_00001' && retry.entry.seq === first.entry.seq);
ok('hasApplied agrees', L.hasApplied(P, 'id_retry_00001') === true);
ok('a RETRY OF A DEBIT also lands once', (() => {
  const before = bal().gold;
  debit('id_retry_debit01', 100);
  debit('id_retry_debit01', 100);
  return bal().gold === before - 100;
})(), `gold=${bal().gold}`);

console.log('\n4. NO OVERDRAFT — refused, never clamped to zero');
const goldBefore = bal().gold;
const over = debit('id_overdraft_01', goldBefore + 1);
ok('a debit beyond the balance is refused', over.applied === false);
ok('the refusal says "insufficient"', over.reason === 'insufficient', over.reason);
ok('the balance is UNCHANGED (not clamped to 0)', bal().gold === goldBefore, `gold=${bal().gold}`);
ok('an exactly-full debit IS allowed', (() => {
  const b = bal().gold;
  const r = debit('id_exact_full_01', b, 'gold', 'claim');
  return r.applied === true && bal().gold === 0;
})());
ok('debiting from an empty balance is refused', debit('id_empty_debit_1', 1).applied === false);

console.log('\n5. INTEGERS ONLY — fractions are rejected, never rounded');
for (const bad of [1.5, 0.000001, NaN, Infinity, -Infinity, '100', null, undefined, 2 ** 53]) {
  const r = credit(`id_bad_amount_${String(bad).slice(0, 6)}`, bad);
  ok(`amount ${String(bad).slice(0, 12)} is rejected`, r.applied === false, JSON.stringify(r.reason));
}
ok('a zero-amount entry is rejected (it is not a no-op, it is a bug)', credit('id_zero_amount1', 0).applied === false);

console.log('\n6. unknown identifiers are rejected, never defaulted');
ok('an unknown reason is rejected', L.apply(P, { id: 'id_bad_reason1', reason: 'lootbox', resource: 'gold', amount: 1 }).applied === false);
ok('an unknown resource is rejected', L.apply(P, { id: 'id_bad_resrc1', reason: 'quest', resource: 'gems', amount: 1 }).applied === false);
ok('a missing id is rejected', L.apply(P, { reason: 'quest', resource: 'gold', amount: 1 }).applied === false);
ok('a short id is rejected', L.apply(P, { id: 'abc', reason: 'quest', resource: 'gold', amount: 1 }).applied === false);
ok('a bad player key is rejected', L.apply('x', { id: 'id_bad_player1', reason: 'quest', resource: 'gold', amount: 1 }).applied === false);

console.log('\n7. reasons cannot be used in the wrong direction');
ok("'fee' cannot CREDIT", credit('id_fee_credit1', 100, 'gold', 'fee').applied === false);
ok("'idle' cannot DEBIT", L.apply(P, { id: 'id_idle_debit1', reason: 'idle', resource: 'gold', amount: -5 }).applied === false);
ok("'stake_lock' cannot CREDIT", credit('id_lock_credit1', 100, 'wayfarer', 'stake_lock').applied === false);

console.log('\n8. persistence survives a restart (the balance must not vanish)');
const snapshot = bal();
await L.flushAll();
ok('the doc file now exists', fs.existsSync(path.join(SANDBOX, 'economy', `${P}.json`)));
ok('no .tmp file is left behind', fs.readdirSync(path.join(SANDBOX, 'economy')).every((f) => !f.endsWith('.tmp')));
L._resetCache();                                   // simulate a fresh process
const reloaded = L.balancesOf(P);
ok('balances survive the reload exactly', reloaded.gold === snapshot.gold && reloaded.wayfarer === snapshot.wayfarer,
  `${JSON.stringify(reloaded)} vs ${JSON.stringify(snapshot)}`);
ok('a duplicate id is STILL refused after a restart (idempotency is durable)',
  credit('id_retry_00001', 1000).applied === false);
ok('the journal survived with balanceAfter intact', (() => {
  const h = L.history(P, 5);
  return h.length > 0 && Number.isSafeInteger(h[0].balanceAfter);
})());

console.log('\n9. journal and stats');
ok('history is newest-first', (() => {
  const h = L.history(P, 3);
  return h.length >= 2 && h[0].seq > h[1].seq;
})());
ok('refused entries are NOT journalled', !L.history(P, 500).some((e) => e.reason === 'lootbox'));
ok('stats report the player', L.ledgerStats().players >= 1);

console.log('\n10. the pinned identifiers match CONTRACT.md (cross-module agreement)');
{
  const contract = fs.readFileSync(new URL('./CONTRACT.md', import.meta.url), 'utf8');
  const reasons = (contract.match(/LEDGER_REASONS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  const kinds = (contract.match(/RESOURCE_KINDS\s*=\s*\[([\s\S]*?)\]/) || [, ''])[1]
    .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
  ok('the contract lists all 10 ledger reasons', reasons.length === 10, `got ${reasons.length}: ${reasons.join(',')}`);
  ok('every contract reason exists in ledger.js', reasons.every((r) => L.LEDGER_REASONS.includes(r)),
    reasons.filter((r) => !L.LEDGER_REASONS.includes(r)).join(',') || '');
  ok('ledger.js adds no reason the contract did not pin', L.LEDGER_REASONS.every((r) => reasons.includes(r)),
    L.LEDGER_REASONS.filter((r) => !reasons.includes(r)).join(',') || '');
  ok('the resource kinds agree exactly',
    kinds.length === L.RESOURCE_KINDS.length && kinds.every((k) => L.RESOURCE_KINDS.includes(k)),
    `${kinds.join(',')} vs ${L.RESOURCE_KINDS.join(',')}`);
}

L.stopLedger();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
