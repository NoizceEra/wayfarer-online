// server/econ/econ.test.mjs — the token-economy surface's test suite.
//
// Covers, against the REAL modules (real ledger files in a temp DATA_DIR, real express app
// over a real socket, real stakeMath/payouts):
//   * unknown tier THROWS and is never defaulted;
//   * a claim refuses an absent / unverified wallet link, and cannot name its own
//     destination;
//   * a claim is IDEMPOTENT on its claim id — a second identical call pays once;
//   * ECON_ENABLED off refuses every value-moving call while /econ/rates still answers;
//   * an unconfigured chain refuses cleanly (503 econ_unconfigured, missing pieces named)
//     and /econ/rates still answers;
//   * stake/unstake move value through the ledger, emission is paid from the bounded
//     budget and can never exceed it;
//   * per-kill combat credit pays bosses only, cannot be replayed, and is plausibility
//     capped;
//   * ECON_IDLE_GOLD defaults off and no idle entry is ever written.
//
// Run:  node server/econ/econ.test.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

// ── environment BEFORE any server module is imported (CFG.DATA_DIR is read at import) ──
const TMP = process.env.ECON_TEST_DIR || fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'wf-econ-'));
process.env.DATA_DIR = TMP;
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';
process.env.ECON_IP_BURST = '100000';
process.env.ECON_ACTION_BURST = '100000';
process.env.ECON_IP_RATE = '100000';
process.env.ECON_ACTION_RATE = '100000';
for (const k of ['ECON_ENABLED', 'ECON_IDLE_GOLD', 'PAYOUTS_ENABLED', 'WAYFARER_MINT',
  'CHAIN_RPC_URLS', 'CHAIN_RPC_URL', 'SOLANA_RPC_URLS', 'SOLANA_RPC_URL']) delete process.env[k];

const express = (await import('express')).default;
const ledger = await import('../economy/ledger.js');
const state = await import('./state.js');
const ops = await import('./ops.js');
const econHttp = await import('./http.js');
const cfg = await import('./config.js');
const SM = await import('../economy/stakeMath.js');
const rates = await import('../economy/rates.js');
const { b58encode } = await import('../validate.js');

// ── tiny harness (same final-line convention as server/economy/*.test.mjs) ──
let pass = 0; let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail === undefined ? '' : ` :: ${JSON.stringify(detail)}`}`); }
};
const near = (a, b, slack = 2000) => Math.abs(a - b) <= slack;

const TOKEN = crypto.randomBytes(18).toString('base64url');       // 24 chars, exactly the /wallet/* shape
ok('token shape matches TOKEN_RE and deviceKey', /^[A-Za-z0-9_-]{16,64}$/.test(TOKEN), TOKEN);
const DK = ops.stateKeyFor(TOKEN);
const WALLET = b58encode(crypto.randomBytes(32));                 // syntactically valid base58 pubkey
const DAY = 86_400_000;
const TOK = 10 ** 6;

// ── the surface, over a real socket ──
const app = express();
econHttp.routes(app);
const srv = app.listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const BASE = `http://127.0.0.1:${srv.address().port}`;
const call = async (method, p, body) => {
  const r = await fetch(BASE + p, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { status: r.status, body: await r.json() };
};
const post = (p, body) => call('POST', p, body);

ledger.initLedger();
state.initState();

// ── A. defaults ─────────────────────────────────────────────────────────────
console.log('\nA. flags and defaults (docs/BLOCKCHAIN_V1.md §4)');
ok('ECON_ENABLED defaults OFF', cfg.econEnabled() === false);
ok('ECON_IDLE_GOLD defaults OFF (owner rule: per-kill only)', cfg.idleGoldEnabled() === false);
ok('PAYOUTS_ENABLED defaults OFF (dry run)', cfg.payoutsEnabled() === false);
ok('chain unconfigured by default, and says what is missing',
  cfg.chainReady() === false && cfg.missingChainConfig().includes('WAYFARER_MINT') && cfg.missingChainConfig().includes('CHAIN_RPC_URLS'),
  cfg.missingChainConfig());

// ── B. rates answer while disabled ──────────────────────────────────────────
console.log('\nB. GET /econ/rates answers with the economy DISABLED');
let r = await call('GET', '/econ/rates');
ok('200 while disabled', r.status === 200, r.status);
ok('4 tier rows in order', JSON.stringify(r.body.rows.map((x) => x.tierId)) === JSON.stringify(['none', 't1', 't2', 't3']), r.body.rows?.map((x) => x.tierId));
ok('rows carry the effective (paid) year-1 rate, not nominal', r.body.rows[1].effectiveYear1Bps < r.body.rows[1].aprBps, r.body.rows[1]);
ok('emission budget starts untouched', r.body.emission.budgetRemainingRaw === SM.BUDGET_TOTAL_RAW, r.body.emission);
ok('flags say disabled', r.body.econ.enabled === false && r.body.econ.configured === false, r.body.econ);
ok('idleGold reported false', r.body.idleGold === false);
ok('taper note published', typeof r.body.taperNote === 'string' && r.body.taperNote.includes('taper'), r.body.taperNote);

// ── C. reads answer while disabled ──────────────────────────────────────────
console.log('\nC. reads answer with the economy DISABLED');
r = await post('/econ/balance', { token: TOKEN });
ok('balance 200', r.status === 200, r.status);
ok('balance shape {gold, wayfarer, stakeTier, lockedRaw, lockUntilMs, claimableRaw}',
  ['gold', 'wayfarer', 'stakeTier', 'lockedRaw', 'lockUntilMs', 'claimableRaw'].every((k) => k in r.body), Object.keys(r.body));
ok('fresh device is empty and unstaked', r.body.gold === 0 && r.body.wayfarer === 0 && r.body.stakeTier === 'none' && r.body.lockedRaw === 0, r.body);
r = await post('/econ/history', { token: TOKEN, limit: 10 });
ok('history 200 with no entries', r.status === 200 && Array.isArray(r.body.entries) && r.body.entries.length === 0, r.body);
r = await post('/econ/balance', { token: 'short' });
ok('bad token refused 400', r.status === 400 && r.body.error === 'bad_token', r.body);
r = await post('/econ/history', { token: TOKEN, limit: 9999 });
ok('bad limit refused 400', r.status === 400 && r.body.error === 'bad_limit', r.body);

// ── D. disabled refuses everything that moves value ─────────────────────────
console.log('\nD. ECON_ENABLED off refuses value-moving calls');
for (const [p, body] of [['/econ/stake', { token: TOKEN, tierId: 't1' }], ['/econ/unstake', { token: TOKEN }], ['/econ/claim', { token: TOKEN }]]) {
  const res = await post(p, body);
  ok(`${p} -> 403 econ_disabled`, res.status === 403 && res.body.error === 'econ_disabled', { status: res.status, body: res.body });
}

// ── E. enabled but chain unconfigured ───────────────────────────────────────
console.log('\nE. enabled + chain UNCONFIGURED: ledger paths work, the chain path refuses cleanly');
process.env.ECON_ENABLED = 'true';
r = await post('/econ/claim', { token: TOKEN });
ok('claim -> 503 econ_unconfigured', r.status === 503 && r.body.error === 'econ_unconfigured', { status: r.status, body: r.body });
ok('refusal names the missing vars', Array.isArray(r.body.missing) && r.body.missing.includes('WAYFARER_MINT') && r.body.missing.includes('CHAIN_RPC_URLS'), r.body.missing);
ok('refusal says nothing was signed', String(r.body.message).includes('Nothing was signed'), r.body.message);
r = await call('GET', '/econ/rates');
ok('rates still answer', r.status === 200 && r.body.rows.length === 4, r.status);
r = await post('/econ/stake', { token: TOKEN, tierId: 't1' });
ok('stake reaches the ledger (no chain needed) -> insufficient, not a config error',
  r.status === 409 && r.body.error === 'insufficient', { status: r.status, body: r.body });

// ── F. configured: stake / unstake / balance ────────────────────────────────
console.log('\nF. configured: stake and unstake through the real ledger');
process.env.WAYFARER_MINT = 'So11111111111111111111111111111111111111112';
const OTHER_RPC = ['CHAIN_RPC_URL', 'SOLANA_RPC_URL', 'SOLANA_RPC_URLS'];
for (const k of OTHER_RPC) delete process.env[k];
process.env.CHAIN_RPC_URLS = 'https://example.invalid';
ok('chainReady() now true', cfg.chainReady() === true, cfg.missingChainConfig());
ok('flags report configured + cluster', cfg.flagsPublic().configured === true && cfg.flagsPublic().cluster === 'devnet', cfg.flagsPublic());

const seed = ledger.apply(DK, { id: 'admin:test:seed:0001', reason: 'admin', resource: 'wayfarer', amount: 2_000 * TOK, meta: { why: 'test fixture' } });
ok('fixture: admin credit of 2,000 WAYFARER', seed.applied === true && seed.balances.wayfarer === 2_000 * TOK, seed.balances);
r = await post('/econ/balance', { token: TOKEN });
ok('balance reports 2,000 liquid, unstaked, all claimable',
  r.body.wayfarer === 2_000 * TOK && r.body.claimableRaw === 2_000 * TOK && r.body.stakeTier === 'none', r.body);

r = await post('/econ/stake', { token: TOKEN, tierId: 't9' });
ok('unknown tier -> 400 unknown_tier (never defaulted)', r.status === 400 && r.body.error === 'unknown_tier', { status: r.status, body: r.body });
let threw = null;
try { ops.stakeNow(DK, 't9'); } catch (e) { threw = e; }
ok('ops.stakeNow throws a RangeError on an unknown tier', threw instanceof RangeError, threw && threw.message);
try { ops.stakeNow(DK, undefined); } catch (e) { threw = e; }
ok('ops.stakeNow throws on a missing tier', threw instanceof RangeError, threw && threw.message);
r = await post('/econ/stake', { token: TOKEN, tierId: 'none' });
ok("tier 'none' is known but locks nothing -> 409 no_lock_required", r.status === 409 && r.body.error === 'no_lock_required', { status: r.status, body: r.body });

const t0 = Date.now();
r = await post('/econ/stake', { token: TOKEN, tierId: 't1' });
const staked = r.body;
ok('stake t1 -> 200', r.status === 200 && r.body.ok === true, r.body);
ok('locks exactly the tier MINIMUM (1,000 WAYFARER)',
  staked.stake.amountRaw === SM.STAKE_TIERS.t1.minLockRaw && staked.stake.amountRaw === 1_000 * TOK, staked.stake);
ok('lockUntilMs is the tier lock period (7d)', near(staked.stake.lockUntilMs, t0 + 7 * DAY, 5000), { until: staked.stake.lockUntilMs, t0 });
ok('principal left the liquid balance', staked.balance.wayfarer === 1_000 * TOK, staked.balance);
ok('locked principal is NOT claimable', staked.balance.claimableRaw === 1_000 * TOK && staked.balance.lockedRaw === 1_000 * TOK, staked.balance);
ok('stakeTier reported', staked.balance.stakeTier === 't1', staked.balance);
r = await post('/econ/stake', { token: TOKEN, tierId: 't2' });
ok('second stake refused (one stake at a time) -> already_staked', r.status === 409 && r.body.error === 'already_staked', { status: r.status, body: r.body });

const tUn = Date.now();
r = await post('/econ/unstake', { token: TOKEN });
ok('unstake -> 200', r.status === 200 && r.body.ok === true, r.body);
ok('principal fully released', r.body.released.principalRaw === 1_000 * TOK, r.body.released);
ok('an immediate unstake earns ~0 emission (emission is an integral over time)',
  r.body.released.emissionRaw === 0 && r.body.emission.owedRaw === 0, r.body.emission);
ok('balance restored', near(r.body.balance.wayfarer, 2_000 * TOK, 1), r.body.balance);
ok('stake cleared', r.body.balance.stakeTier === 'none' && r.body.balance.lockedRaw === 0, r.body.balance);
ok('unstake records elapsedMs', Number.isSafeInteger(r.body.released.elapsedMs) && r.body.released.elapsedMs >= 0, r.body.released);
r = await post('/econ/unstake', { token: TOKEN });
ok('unstaking with nothing staked -> not_staked', r.status === 409 && r.body.error === 'not_staked', { status: r.status, body: r.body });

r = await post('/econ/history', { token: TOKEN, limit: 20 });
const reasons = r.body.entries.map((e) => e.reason);
ok('history shows the ledger journal, newest first',
  reasons[0] === 'stake_unlock' && reasons.includes('stake_lock') && reasons.includes('admin'), reasons);
ok('NO idle entry exists (ECON_IDLE_GOLD off, per-kill only)', !reasons.includes('idle'), reasons);

// ── G. emission over a 30-day hold, paid from the bounded budget ────────────
console.log('\nG. emission for a 30-day hold is paid from the budget and bounded by it');
const budgetBefore = state.budgetSpentRaw();
const holdStart = Date.now();
ops.stakeNow(DK, 't1', holdStart);
const un = ops.unstakeNow(DK, holdStart + 30 * DAY);
ok('emission paid > 0 after 30 days', un.ok === true && un.released.emissionRaw > 0, un.released);
ok('emission equals the budget consumed', state.budgetSpentRaw() - budgetBefore === un.released.emissionRaw, { spent: state.budgetSpentRaw() - budgetBefore, paid: un.released.emissionRaw });
ok('emission never exceeds what was owed', un.emission.paidRaw <= un.emission.owedRaw, un.emission);
ok('not exhausted while the budget holds', un.emission.exhausted === false);
ok('budget remaining decreased by exactly the emission', un.emission.budgetRemainingRaw === SM.BUDGET_TOTAL_RAW - state.budgetSpentRaw(), un.emission);
ok('principal returned as well', un.balances.wayfarer > 2_000 * TOK, un.balances);

// ── I. claim: refusal, dry run, idempotency ─────────────────────────────────
console.log('\nI. claim: unverified link refuses, default is dry-run, the claim id is idempotent');
const fakeAuthority = () => ({ links: { byDevice: { [DK]: { addr: WALLET, at: 1 } } } });
const noWallet = await ops.claimFor(DK, DK, { claimId: 'econ_test_nolink_1' }, { walletAuthorityImpl: () => ({ links: { byDevice: {} } }) });
ok('absent wallet link -> no_verified_wallet', noWallet.ok === false && noWallet.error === 'no_verified_wallet', noWallet);
const unverified = await ops.claimFor(DK, DK, { claimId: 'econ_test_unverified_1' }, {
  walletAuthorityImpl: fakeAuthority,
  payoutDeps: { verifierImpl: async () => false },   // identity.js does not know this link
});
ok('address present in wallet.js but NOT signature-verified -> wallet_not_verified',
  unverified.ok === false && unverified.error === 'wallet_not_verified', unverified);

let sends = 0;
const fakeSend = async () => { sends++; return { signature: `sig${sends}` }; };
const dry = await ops.claimFor(DK, DK, { claimId: 'econ_test_dry_1' }, {
  walletAuthorityImpl: fakeAuthority,
  payoutDeps: { verifierImpl: async () => true, sendImpl: fakeSend, floatBalanceImpl: async () => null },
});
ok('PAYOUTS_ENABLED unset -> dry_run, nothing signed', dry.ok === false && dry.error === 'dry_run' && dry.dryRun === true, dry);
ok('dry run moved no money and sent nothing', sends === 0 && dry.amountRaw === 2_000 * TOK + un.released.emissionRaw, { sends, amountRaw: dry.amountRaw });
ok('destination came from the server-side link, not the request', dry.destination === WALLET, dry.destination);

const balBeforeClaim = ledger.balancesOf(DK).wayfarer;
process.env.PAYOUTS_ENABLED = 'true';
const payDeps = {
  walletAuthorityImpl: fakeAuthority,
  payoutDeps: { verifierImpl: async () => true, sendImpl: fakeSend, floatBalanceImpl: async () => 10_000_000_000 },
};
const paid1 = await ops.claimFor(DK, DK, { claimId: 'econ_test_claim_1' }, payDeps);
ok('PAYOUTS_ENABLED=true signs and pays', paid1.ok === true && paid1.signature === 'sig1' && sends === 1, paid1);
ok('balance debited exactly by the payout', ledger.balancesOf(DK).wayfarer === balBeforeClaim - paid1.amountRaw, { before: balBeforeClaim, after: ledger.balancesOf(DK).wayfarer, amount: paid1.amountRaw });
const paid2 = await ops.claimFor(DK, DK, { claimId: 'econ_test_claim_1' }, payDeps);
ok('SAME claim id again -> already_paid, nothing paid twice', paid2.alreadyPaid === true && paid2.reason === 'already_paid' && sends === 1, { paid2, sends });
ok('same-id retry did not move the balance', ledger.balancesOf(DK).wayfarer === balBeforeClaim - paid1.amountRaw, ledger.balancesOf(DK));
const claimEntries = (ledger.history(DK, 50) || []).filter((e) => e.reason === 'claim' && String(e.id).includes('econ_test_claim_1'));
ok('exactly one claim debit in the journal for that id', claimEntries.length === 1, claimEntries.length);
ledger.apply(DK, { id: 'admin:test:seed:claim2', reason: 'admin', resource: 'wayfarer', amount: 100 * TOK, meta: { why: 'test fixture' } });
const paid3 = await ops.claimFor(DK, DK, { claimId: 'econ_test_claim_2' }, payDeps);
ok('a DIFFERENT claim id pays again (keyed on the id, not a global latch)', paid3.ok === true && sends === 2, { paid3, sends });
r = await post('/econ/claim', { token: TOKEN, claimId: 'bad id!' });
ok('malformed claimId refused 400', r.status === 400 && r.body.error === 'bad_claim_id', { status: r.status, body: r.body });
delete process.env.PAYOUTS_ENABLED;

// ── J. per-kill combat credit ───────────────────────────────────────────────
console.log('\nJ. kill credit: bosses only, replayed saves cannot double-pay, forged counts are capped');
const TOKEN2 = crypto.randomBytes(18).toString('base64url');
const DK2 = ops.stateKeyFor(TOKEN2);
const n0 = Date.now();
const kr = ops.creditKills(DK2, { forgelord: 1, fieldmouse: 5, nosuchenemy: 3 }, n0);
ok('boss kill credits 20 WAYFARER (rewards.js crypto=20), trash mobs pay nothing',
  kr.ok === true && kr.creditedRaw === 20 * TOK && Object.keys(kr.byType).join(',') === 'forgelord', kr);
ok('unknown enemy id ignored', kr.skipped.length === 0, kr.skipped);
ok('ledger holds it', ledger.balancesOf(DK2).wayfarer === 20 * TOK, ledger.balancesOf(DK2));
const kr2 = ops.creditKills(DK2, { forgelord: 1, fieldmouse: 5, nosuchenemy: 3 }, n0 + 1000);
ok('REPLAY of the same save credits nothing', kr2.ok === true && kr2.creditedRaw === 0, kr2);
ok('replayed save left the balance alone', ledger.balancesOf(DK2).wayfarer === 20 * TOK, ledger.balancesOf(DK2));
const kr3 = ops.creditKills(DK2, { forgelord: 50 }, n0 + 2000);
ok('forged 50-boss claim capped to the plausibility bound (burst 1)', kr3.creditedRaw === 20 * TOK && kr3.skipped.includes('forgelord:capped'), kr3);
ok('combat entries carry reason "combat" and a cumulative-count id',
  (ledger.history(DK2, 20) || []).filter((e) => e.reason === 'combat').every((e) => /^combat:forgelord:/.test(e.id)),
  (ledger.history(DK2, 20) || []).map((e) => e.id));
const viaSave = ops.creditKillsForSave({ token: TOKEN2, name: 'Test' }, { rec: { kills: { redclaw: 1 } } }, n0 + 3000);
ok('the character-save hook credits the boss crypto (redclaw=5)', viaSave.creditedRaw === 5 * TOK, viaSave);
const exempt = ops.creditKills(ops.stateKeyFor(crypto.randomBytes(18).toString('base64url')), { forgelord: 1 }, n0, { enabled: false });
ok('ECON_ENABLED off -> no combat credit at all', exempt.ok === false && exempt.creditedRaw === 0 && exempt.skipped.includes('econ_disabled'), exempt);

// ── K. durability ───────────────────────────────────────────────────────────
console.log('\nK. state persists (stakes + budget survive a reload)');
ledger.apply(DK2, { id: 'admin:test:seed:k1', reason: 'admin', resource: 'wayfarer', amount: 2_000 * TOK, meta: { why: 'test fixture' } });
const kStake = ops.stakeNow(DK2, 't1', Date.now());
ok('K fixture: stake accepted', kStake.ok === true, kStake);
state.flushState();
const spentNow = state.budgetSpentRaw();
state._resetState();                                   // simulate a fresh process: cache dropped
ok('stake reloaded from disk', state.stakeOf(DK2)?.tierId === 't1', state.stakeOf(DK2));
ok('budget reloaded from disk', state.budgetSpentRaw() === spentNow, { onDisk: state.budgetSpentRaw(), before: spentNow });
const reloaded = await ops.unstakeNow(DK2, Date.now());
ok('the reloaded stake can still be released', reloaded.ok === true && reloaded.released.principalRaw === 1_000 * TOK, reloaded);

// ── L. the shutdown hook (index.js awaits econ.stop()) ──────────────────────
// A signal only reaches this code where Node can deliver SIGINT/SIGTERM (Colyseus registers
// both); on Windows a `kill` is a hard TerminateProcess and no handler can run. So the hook is
// exercised directly here, through the same entry point gameServer.onShutdown calls.
console.log('\nL. the shutdown hook (index.js awaits econ.stop()) flushes everything');
const econIndex = await import('./index.js');
const TOKEN3 = crypto.randomBytes(18).toString('base64url');
const DK3 = ops.stateKeyFor(TOKEN3);
ledger.apply(DK3, { id: 'admin:test:seed:shutdown', reason: 'admin', resource: 'wayfarer', amount: 1_500 * TOK, meta: { why: 'test fixture' } });
const lStake = ops.stakeNow(DK3, 't1', Date.now());
ok('L fixture: stake accepted (fresh docs, nothing on disk yet)', lStake.ok === true, lStake);
await econIndex.stop();
const diskState = JSON.parse(fs.readFileSync(path.join(TMP, 'econ', 'state.json'), 'utf8'));
ok('stop() wrote state.json holding the live stake', diskState.stakes[DK3]?.tierId === 't1', diskState.stakes);
ok('stop() wrote the emission budget too', diskState.budgetSpentRaw === state.budgetSpentRaw(), { onDisk: diskState.budgetSpentRaw, live: state.budgetSpentRaw() });
const diskLedger = JSON.parse(fs.readFileSync(path.join(TMP, 'economy', `${DK3}.json`), 'utf8'));
ok('stop() wrote the ledger file with the stake debit applied', diskLedger.balances.wayfarer === 500 * TOK, diskLedger.balances);

// ── H. the budget is a HARD ceiling (last: it drains the programme budget) ──
console.log('\nH. the emission budget is a hard ceiling');
const spent = state.budgetSpentRaw();
state.spendBudget(SM.BUDGET_TOTAL_RAW - spent);
ok('budget now empty', Math.max(0, SM.BUDGET_TOTAL_RAW - state.budgetSpentRaw()) === 0);
ledger.apply(DK, { id: 'admin:test:seed:ceiling', reason: 'admin', resource: 'wayfarer', amount: 2_000 * TOK, meta: { why: 'test fixture' } });
const hStake = ops.stakeNow(DK, 't1', Date.now());
ok('H fixture: stake accepted', hStake.ok === true, hStake);
const exhausted = ops.unstakeNow(DK, Date.now() + 30 * DAY);
ok('exhausted budget pays NO emission', exhausted.released.emissionRaw === 0 && exhausted.emission.exhausted === true, exhausted);
ok('principal is STILL returned in full', exhausted.released.principalRaw === 1_000 * TOK, exhausted.released);
ok('budget remaining floored at 0', exhausted.emission.budgetRemainingRaw === 0, exhausted.emission);
r = await call('GET', '/econ/rates');
ok('rates report the empty budget', r.body.emission.budgetRemainingRaw === 0, r.body.emission);
ok('rate sheet still served while the budget is empty', r.status === 200 && r.body.rows.length === 4, r.status);
ok('idle gold is reported off on the sheet', r.body.idleGold === false);
ok('rates rows are the rates.js rows', JSON.stringify(r.body.rows) === JSON.stringify(rates.rateRows()));

// ── shutdown ────────────────────────────────────────────────────────────────
await new Promise((r2) => srv.close(r2));
state.stopState();
ledger.stopLedger();
console.log(`\nDATA_DIR used: ${TMP}`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
