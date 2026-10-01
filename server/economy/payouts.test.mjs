/**
 * payouts.test.mjs — tests for the money-out path, with the chain injected.
 *
 * The two cases that actually cost money if wrong:
 *   1. a RETRIED claim paying twice (client retries after a timeout),
 *   2. a send that FAILS after the ledger was already debited.
 * Both are asserted by balance, not by reading a log line.
 *
 * Run: node server/economy/payouts.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-payouts-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';
delete process.env.PAYOUTS_ENABLED;                    // start disabled: dry run is the default
delete process.env.RELAY_HOT_KEYPAIR;

const L = await import('./ledger.js');
const P = await import('./payouts.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const PLAYER = 'player_PAYOUT_01';
const WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const M = 1_000_000;                                    // 1 token in base units
const GOOD_FLOAT = 10_000 * M;                          // inside [min, max]

L.initLedger();
// Fund the player: 1,000 tokens accrued from play.
L.apply(PLAYER, { id: 'fund_0000000001', reason: 'combat', resource: 'wayfarer', amount: 1000 * M });
const bal = () => L.balancesOf(PLAYER).wayfarer;

const deps = (over = {}) => ({
  sendImpl: async () => ({ signature: 'SIG_dry_' + Math.random().toString(36).slice(2, 10) }),
  floatBalanceImpl: async () => GOOD_FLOAT,
  verifierImpl: async () => true,
  ...over,
});

console.log('\n1. DRY RUN is the default and moves nothing');
{
  let sent = 0;
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_dry_0001' },
    deps({ sendImpl: async () => { sent++; return { signature: 'x' }; } }));
  ok('the claim reports dry_run', r.reason === 'dry_run', r.reason);
  ok('it states what it WOULD pay', r.wouldPay === 10 * M);
  ok('the balance is untouched', bal() === 1000 * M, `bal=${bal()}`);
  ok('no transaction was sent', sent === 0);
}

console.log('\n2. an UNVERIFIED wallet is refused (the destination gate)');
{
  let sent = 0;
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_unver_001' },
    deps({ verifierImpl: async () => false, sendImpl: async () => { sent++; return { signature: 'x' }; } }));
  ok('refused with wallet_not_verified', r.reason === 'wallet_not_verified', r.reason);
  ok('the balance is untouched', bal() === 1000 * M);
  ok('nothing was sent', sent === 0);
}
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_verr_0001' },
    deps({ verifierImpl: async () => { throw new Error('link index unreadable'); } }));
  ok('a verifier ERROR fails closed', r.ok === false && /verify_failed/.test(r.reason), r.reason);
}

console.log('\n3. input and balance gates');
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 0.5 * M, claimId: 'claim_dust_0001' }, deps());
  ok('a sub-1-token claim is refused as dust', r.reason === 'below_dust_floor', r.reason);
}
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 5000 * M, claimId: 'claim_over_0001' }, deps());
  ok('claiming more than the balance is refused', r.reason === 'insufficient', r.reason);
  ok('the refusal reports what IS available', r.available === 1000 * M, String(r.available));
}
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'short' }, deps());
  ok('a malformed claim id is refused', r.reason === 'bad_claim_id', r.reason);
}

console.log('\n4. the FLOAT CAP (the blast radius from a stolen relay key)');
// The float is an ON-CHAIN read, so it is a SIGNING-PATH gate only: a dry run never
// touches the network (see payouts.js). Enable payouts for this section so the float
// gates are actually reached; every case below refuses BEFORE the debit, and the
// injected sendImpl is never called, so no balance moves.
process.env.PAYOUTS_ENABLED = 'true';
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_fcap_0001' },
    deps({ floatBalanceImpl: async () => 50_000 * M }));
  ok('a float OVER the cap refuses to pay', r.reason === 'float_over_cap', r.reason);
  ok('the refusal tells you to sweep by hand', /sweep/.test(r.advice || ''));
  ok('the balance is untouched', bal() === 1000 * M);
}
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 100 * M, claimId: 'claim_flow_0001' },
    deps({ floatBalanceImpl: async () => 150 * M }));     // 150 - 100 = 50 < min(100)
  ok('a payout that would breach the float MINIMUM is refused', r.reason === 'float_too_low', r.reason);
  ok('the balance is untouched', bal() === 1000 * M);
}
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_furk_0001' },
    deps({ floatBalanceImpl: async () => { throw new Error('rpc down'); } }));
  ok('an unreadable float refuses rather than assuming a balance', r.ok === false && /float_unreadable/.test(r.reason), r.reason);
}
delete process.env.PAYOUTS_ENABLED;

console.log('\n5. the happy path');
process.env.PAYOUTS_ENABLED = 'true';
let sendCount = 0;
{
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 100 * M, claimId: 'claim_paid_0001' },
    deps({ sendImpl: async () => { sendCount++; return { signature: 'SIGgood0001' }; } }));
  ok('the claim succeeds', r.ok === true && r.reason === 'paid', JSON.stringify(r.reason));
  ok('it returns the signature', r.signature === 'SIGgood0001');
  ok('the balance is debited EXACTLY once', bal() === 900 * M, `bal=${bal()}`);
  ok('one transaction was sent', sendCount === 1);
}

console.log('\n6. A RETRIED CLAIM MUST NOT PAY TWICE');
{
  const before = bal();
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 100 * M, claimId: 'claim_paid_0001' },
    deps({ sendImpl: async () => { sendCount++; return { signature: 'SIGgood0001-retry' }; } }));
  ok('the retry is refused', r.ok === false);
  ok('it reports already_paid', r.reason === 'already_paid', r.reason);
  ok('the balance did NOT move again', bal() === before, `bal=${bal()}`);
  ok('no SECOND transaction was sent', sendCount === 1, `sendCount=${sendCount}`);
}

console.log('\n7. a FAILED SEND is compensated (the player is never left short)');
{
  const before = bal();
  const r = await P.claim({ playerKey: PLAYER, walletAddress: WALLET, amountRaw: 250 * M, claimId: 'claim_fail_0001' },
    deps({ sendImpl: async () => { throw new Error('blockhash not found'); } }));
  ok('the claim reports failure', r.ok === false && r.reason === 'send_failed', r.reason);
  ok('the debit WAS reversed (refunded true)', r.refunded === true);
  ok('the balance is exactly what it was before the attempt', bal() === before, `bal=${bal()} before=${before}`);
  ok('the error is preserved for the log', /blockhash/.test(r.error || ''));
}

console.log('\n8. the journal records every outcome');
{
  const h = P.payoutHistory(50);
  // Only genuine payout ATTEMPTS are journalled. Refusals that happen before any value
  // moves (unverified wallet, dust, float, insufficient) are deliberately absent: the
  // journal is a record of money movement, not of rejected requests. Exactly three
  // attempts were made here: one dry run, one paid, one failed send.
  ok('exactly the three real payout attempts are journalled', h.length === 3, `n=${h.length}`);
  ok('every journalled status is a real attempt',
    h.every((e) => ['dry_run', 'paid', 'send_failed'].includes(e.status)), h.map((e) => e.status).join(','));
  ok('it is newest-first', h[0].at >= h[h.length - 1].at);
  ok('the successful payout is recorded as paid', h.some((e) => e.status === 'paid' && e.signature === 'SIGgood0001'));
  ok('the failed payout is recorded with refunded:true', h.some((e) => e.status === 'send_failed' && e.refunded === true));
  ok('a dry run is recorded as dry_run', h.some((e) => e.status === 'dry_run'));
  ok('refusals before the debit are NOT journalled as payouts',
    !h.some((e) => e.status === 'paid' && e.claimId === 'claim_unver_001'));
}

console.log('\n9. the ledger journal explains the money, not just the payout journal');
{
  const j = L.history(PLAYER, 200);
  ok('the successful claim has a claim debit', j.some((e) => e.reason === 'claim' && e.amount === -100 * M));
  ok('the refund has an explicit admin credit', j.some((e) => e.reason === 'admin' && e.amount === 250 * M));
  ok('every entry carries a running balance', j.every((e) => Number.isSafeInteger(e.balanceAfter)));
}

console.log('\n10. config defaults are safe');
{
  const cfg = P.payoutConfig();
  ok('payouts are enabled only via the env flag', cfg.enabled === true);   // we set it above
  const saved = process.env.PAYOUTS_ENABLED;
  delete process.env.PAYOUTS_ENABLED;
  ok('with the flag unset, enabled is false', P.payoutConfig().enabled === false);
  process.env.PAYOUTS_ENABLED = saved;
  ok('the float cap is a bounded number, not infinity', Number.isSafeInteger(cfg.floatMaxRaw) && cfg.floatMaxRaw > 0);
  ok('the dust floor exists', cfg.minClaimRaw > 0);
}

L.stopLedger();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
