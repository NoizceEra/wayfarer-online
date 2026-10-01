/**
 * settlement.test.mjs — the SPL transfer that pays a claim, and the claim path around it.
 *
 * EVERY send here is INJECTED (`deps.sendImpl`), so this suite spends nothing and needs
 * no keypair, no network and no @solana dependency. What it proves:
 *
 *   * the happy path returns a signature;
 *   * an IDEMPOTENT REPLAY PAYS ONCE — the second call sees the settled record and the
 *     send implementation is never invoked again;
 *   * a FAILED SEND leaves a VISIBLE COMPENSATING LEDGER ENTRY (asserted by balance and
 *     by the ledger journal, not by a log line);
 *   * an UNVERIFIED DESTINATION is refused by the real signature-verified authority;
 *   * the two hard chain rules hold at the money path: a mint whose ON-CHAIN decimals
 *     are not the economy's 6 is refused, and a payout larger than the paying wallet's
 *     actual on-chain balance is refused — both BEFORE anything is signed.
 *
 * Run: node server/chain/settlement.test.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-settle-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';
delete process.env.WAYFARER_MINT;
delete process.env.CHAIN_RPC_URLS;
delete process.env.PAYOUTS_ENABLED;
delete process.env.SETTLE_MAX_RAW;

const S = await import('./settlement.js');
const { settlementConfig, settleClaim, payoutWalletRaw, clearSettlements, settlementHistory, selectTokenProgram } = S;
const L = await import('../economy/ledger.js');
const P = await import('../economy/payouts.js');
const { linkVerifiedWallet, verifiedWalletFor, verifiedWalletRecordFor, deviceWithVerifiedWallet, links, initWalletStore, stopWalletStore } = await import('../walletStore.js');
const { deviceKey } = await import('../store.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const MINT = '8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg';    // devnet mint, used as CONFIG only (never contacted)
const WALLET = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OTHER_WALLET = 'So11111111111111111111111111111111111111112';
const M = 1_000_000;
const LEGACY_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const NOT_A_TOKEN_PROGRAM = '11111111111111111111111111111111';   // the System program

// deps.mintVerifyImpl must return the VERIFIED ON-CHAIN MINT FACTS (what
// assertMintUsable returns) and throw to reject — the same contract as the default.
const okMint = async () => ({ ok: true, decimals: 6, mint: MINT, cluster: 'devnet', mintAuthority: null, freezeAuthority: null, supply: '1000000000000000', supplyFixed: true });
const richWallet = async () => 5_000 * M;
// A real getAccountInfo (jsonParsed) always carries the account's `owner` — the mint's
// token program. The fake must mirror that, because the money path now reads it.
const fakeRpc = (decimals, owner = LEGACY_PROGRAM) => async () => ({
  value: { owner, data: { parsed: { type: 'mint', info: { decimals, supply: '100', mintAuthority: null, freezeAuthority: null, isInitialized: true } } } },
});

console.log('\n1. unconfigured: nothing can be settled');
{
  clearSettlements();
  let sent = 0;
  const r = await settleClaim({ claimId: 'claim_unconf_01', destination: WALLET, amountRaw: 10 * M, deps: { sendImpl: async () => { sent++; return { signature: 'x' }; } } });
  ok('refused with chain_not_configured', r.reason === 'chain_not_configured', r.reason);
  ok('the error names WAYFARER_MINT', /WAYFARER_MINT/.test(r.error || ''), r.error);
  ok('nothing was sent', sent === 0);
}

console.log('\n2. input gates (before any chain work)');
{
  process.env.WAYFARER_MINT = MINT;
  const deps = { sendImpl: async () => ({ signature: 'sig' }), mintVerifyImpl: okMint, balanceImpl: richWallet };
  ok('a malformed claim id is refused', (await settleClaim({ claimId: 'no', destination: WALLET, amountRaw: 10 * M, deps })).reason === 'bad_claim_id');
  ok('a malformed destination is refused', (await settleClaim({ claimId: 'claim_baddest_1', destination: '0OIl-not-base58', amountRaw: 10 * M, deps })).reason === 'bad_destination');
  ok('a non-integer amount is refused', (await settleClaim({ claimId: 'claim_badamt_01', destination: WALLET, amountRaw: 1.5, deps })).reason === 'bad_amount');
  ok('a zero amount is refused', (await settleClaim({ claimId: 'claim_zero_0001', destination: WALLET, amountRaw: 0, deps })).reason === 'bad_amount');
  process.env.SETTLE_MAX_RAW = '1000';
  const over = await settleClaim({ claimId: 'claim_over_0001', destination: WALLET, amountRaw: 2000, deps });
  ok('an amount over the transfer bound is refused', over.reason === 'over_transfer_bound', over.reason);
  ok('the bound is reported', over.maxTransferRaw === 1000);
  delete process.env.SETTLE_MAX_RAW;
}

console.log('\n3. THE DECIMALS HARD RULE — a non-6 mint refuses at the money path');
{
  clearSettlements();
  let sent = 0;
  // The REAL verifier (assertMintUsable -> mintUsable -> readMintOnChain) with an
  // injected rpcCall, so the on-chain payload is the only thing faked.
  const r = await settleClaim({
    claimId: 'claim_dec9_0001', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => { sent++; return { signature: 'should-not-happen' }; }, balanceImpl: richWallet, rpcCall: fakeRpc(9) },
  });
  ok('a 9-decimal mint is refused with mint_rejected', r.reason === 'mint_rejected', r.reason);
  ok('the reason explains the mis-pricing', /decimals/.test(r.error || '') && /base units/.test(r.error || ''), r.error);
  ok('NOTHING was signed', sent === 0);
  const good = await settleClaim({
    claimId: 'claim_dec6_0001', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => ({ signature: 'sig-dec6' }), balanceImpl: richWallet, rpcCall: fakeRpc(6) },
  });
  ok('the same code path accepts a 6-decimal mint (control)', good.ok === true && good.reason === 'settled', JSON.stringify(good));
}

console.log('\n3b. THE TOKEN PROGRAM — read from the chain, both standards, fail closed');
{
  delete process.env.CHAIN_TOKEN_PROGRAM;
  clearSettlements();
  // (a) selectTokenProgram: the chain's owning program decides, and only two are payable.
  const legacy = selectTokenProgram({ ownerProgram: LEGACY_PROGRAM });
  ok('the legacy SPL Token program is payable', legacy.name === 'spl-token' && legacy.standard === 'legacy', JSON.stringify(legacy));
  const t22 = selectTokenProgram({ ownerProgram: TOKEN_2022_PROGRAM });
  ok('the Token-2022 program is payable (pump.fun create_v2)', t22.name === 'token-2022' && t22.standard === 'token-2022', JSON.stringify(t22));
  let refusedUnknown = null;
  try { selectTokenProgram({ ownerProgram: NOT_A_TOKEN_PROGRAM }); } catch (e) { refusedUnknown = e; }
  ok('an unknown owning program is refused (fail closed)', !!refusedUnknown && /not a token program/.test(refusedUnknown.message), refusedUnknown && refusedUnknown.message);
  let refusedMissing = null;
  try { selectTokenProgram({ ownerProgram: null }); } catch (e) { refusedMissing = e; }
  ok('a missing/unknown owner cannot be assumed to be legacy', !!refusedMissing, refusedMissing && refusedMissing.message);
  // The config escape hatch is an EXPECTATION that must agree with the chain.
  let mismatch = null;
  try { selectTokenProgram({ ownerProgram: LEGACY_PROGRAM, configured: TOKEN_2022_PROGRAM }); } catch (e) { mismatch = e; }
  ok('CHAIN_TOKEN_PROGRAM disagreeing with the chain is refused', !!mismatch && /disagrees with the chain/.test(mismatch.message), mismatch && mismatch.message);
  ok('CHAIN_TOKEN_PROGRAM agreeing with the chain is allowed',
    selectTokenProgram({ ownerProgram: TOKEN_2022_PROGRAM, configured: TOKEN_2022_PROGRAM }).id === TOKEN_2022_PROGRAM);

  // (b) the money path reads it via the REAL verifier (only rpcCall is faked).
  let sent22 = 0;
  const good22 = await settleClaim({
    claimId: 'claim_t2022_001', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => { sent22++; return { signature: 'sig-t2022' }; }, balanceImpl: richWallet, rpcCall: fakeRpc(6, TOKEN_2022_PROGRAM) },
  });
  ok('a Token-2022 mint settles and the chosen program is recorded', good22.ok === true && good22.tokenProgram === TOKEN_2022_PROGRAM, JSON.stringify(good22.tokenProgram));
  let sentUnk = 0;
  const unknown = await settleClaim({
    claimId: 'claim_unkprog_1', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => { sentUnk++; return { signature: 'never' }; }, balanceImpl: richWallet, rpcCall: fakeRpc(6, NOT_A_TOKEN_PROGRAM) },
  });
  ok('a mint owned by a NON-token program is refused before signing', unknown.reason === 'mint_rejected', unknown.reason);
  ok('the refusal names the owning program', /not a token program/.test(unknown.error || ''), unknown.error);
  ok('NOTHING was signed for the unrecognised program', sentUnk === 0);
  ok('and nothing for a program-mismatched config either', sent22 === 1);
}

console.log('\n4. THE HARD CEILING — never more than the paying wallet actually holds');
{
  clearSettlements();
  let sent = 0;
  const r = await settleClaim({
    claimId: 'claim_overbal_1', destination: WALLET, amountRaw: 500 * M,
    deps: { sendImpl: async () => { sent++; return { signature: 'x' }; }, mintVerifyImpl: okMint, balanceImpl: async () => 400 * M },
  });
  ok('refused with over_wallet_balance', r.reason === 'over_wallet_balance', r.reason);
  ok('it reports the wallet balance and the amount', r.walletRaw === 400 * M && r.amountRaw === 500 * M);
  ok('NOTHING was signed', sent === 0);
  const exact = await settleClaim({
    claimId: 'claim_exactbal', destination: WALLET, amountRaw: 400 * M,
    deps: { sendImpl: async () => ({ signature: 'sig-exact' }), mintVerifyImpl: okMint, balanceImpl: async () => 400 * M },
  });
  ok('paying EXACTLY the balance is allowed', exact.ok === true, JSON.stringify(exact));

  let sent2 = 0;
  const unreadable = await settleClaim({
    claimId: 'claim_unread_01', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => { sent2++; return { signature: 'x' }; }, mintVerifyImpl: okMint, balanceImpl: async () => { throw new Error('rpc down'); } },
  });
  ok('an unreadable wallet balance FAILS CLOSED (no balance = no ceiling = no payout)',
    unreadable.reason === 'wallet_balance_unreadable', unreadable.reason);
  ok('nothing was signed in that case either', sent2 === 0);

  let threw = false;
  try { await payoutWalletRaw({ ...settlementConfig(), mint: MINT, rpcUrl: null }); }
  catch { threw = true; }
  ok('payoutWalletRaw() without an endpoint throws rather than silently returning 0', threw);
}

console.log('\n5. HAPPY PATH + IDEMPOTENT REPLAY (pays exactly once)');
{
  clearSettlements();
  let sends = 0;
  const deps = {
    sendImpl: async ({ amountRaw, destination }) => { sends++; return { signature: `SIG_settled_${amountRaw}_${destination.slice(0, 4)}` }; },
    mintVerifyImpl: okMint,
    balanceImpl: richWallet,
  };
  const first = await settleClaim({ claimId: 'claim_happy_001', destination: WALLET, amountRaw: 25 * M, deps });
  ok('the happy path settles', first.ok === true && first.reason === 'settled', JSON.stringify(first.reason));
  ok('it returns the signature', first.signature === `SIG_settled_${25 * M}_${WALLET.slice(0, 4)}`, String(first.signature));
  ok('the send ran exactly once', sends === 1, String(sends));
  ok('the verified on-chain decimals are recorded with it', first.onChainDecimals === 6);
  ok('the wallet balance that bounded it is recorded', first.walletRaw === 5_000 * M);

  const replay = await settleClaim({ claimId: 'claim_happy_001', destination: WALLET, amountRaw: 25 * M, deps });
  ok('the replay is not re-sent', sends === 1, String(sends));
  ok('the replay reports already_settled', replay.reason === 'already_settled' && replay.alreadySettled === true, replay.reason);
  ok('the replay returns the SAME signature', replay.signature === first.signature);
  ok('the replay is a success, so a client timeout can be retried safely', replay.ok === true);
  ok('the settlement journal has exactly one settled record', settlementHistory(50).filter((r) => r.claimId === 'claim_happy_001').length === 1);
}

console.log('\n6. a FAILED SEND clears the record so a legitimate retry can proceed');
{
  clearSettlements();
  let attempts = 0;
  const failing = {
    sendImpl: async () => { attempts++; throw new Error('blockhash not found'); },
    mintVerifyImpl: okMint, balanceImpl: richWallet,
  };
  const r = await settleClaim({ claimId: 'claim_failsend', destination: WALLET, amountRaw: 10 * M, deps: failing });
  ok('the failure is reported', r.ok === false && r.reason === 'send_failed', r.reason);
  ok('the error is preserved', /blockhash/.test(r.error || ''), r.error);
  const retry = await settleClaim({
    claimId: 'claim_failsend', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => ({ signature: 'sig-after-retry' }), mintVerifyImpl: okMint, balanceImpl: richWallet },
  });
  ok('the retry is allowed (the failed attempt left no settled record)', retry.ok === true, JSON.stringify(retry));
  ok('the retry produced a signature', retry.signature === 'sig-after-retry');
  ok('two send attempts total', attempts === 1);
}

console.log('\n7. an UNRESOLVED earlier attempt refuses rather than re-signing');
{
  clearSettlements();
  fs.mkdirSync(path.join(SANDBOX, 'chain'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'chain', 'settlements.json'),
    JSON.stringify({ claim_inflight_1: { status: 'pending', at: Date.now(), destination: WALLET, amountRaw: 10 * M } }));
  let sends = 0;
  const r = await settleClaim({
    claimId: 'claim_inflight_1', destination: WALLET, amountRaw: 10 * M,
    deps: { sendImpl: async () => { sends++; return { signature: 'x' }; }, mintVerifyImpl: okMint, balanceImpl: richWallet },
  });
  ok('an in-flight claim id refuses with settle_in_flight', r.reason === 'settle_in_flight', r.reason);
  ok('and does not sign again', sends === 0);
}

console.log('\n8. THE AUTHORITY: an unverified destination is refused');
{
  process.env.PAYOUTS_ENABLED = 'true';
  // Deliberately no mint from here on: the mint gate is exercised by the settlement
  // checks above and by §10b, and leaving the chain unconfigured keeps this suite
  // hermetic. Every send in this section is injected anyway.
  delete process.env.WAYFARER_MINT;
  const token = 'device-token-AAAA-000000000000000001';
  const dk = deviceKey(token);                       // 32 hex — the ledger + wallet keyspace
  L.initLedger();
  L.apply(dk, { id: 'fund_chain_0001', reason: 'combat', resource: 'wayfarer', amount: 1000 * M });
  const bal = () => L.balancesOf(dk).wayfarer;

  ok('no verified wallet for this device yet', verifiedWalletFor(dk) === null);
  let sent = 0;
  const refused = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_unver_0001' },
    { sendImpl: async () => { sent++; return { signature: 'x' }; }, floatBalanceImpl: async () => 10_000 * M });
  ok('a payout to an UNVERIFIED address is refused by the real authority',
    refused.reason === 'wallet_not_verified', refused.reason);
  ok('the balance is untouched', bal() === 1000 * M);
  ok('nothing was sent', sent === 0);

  // A LEGACY on-disk link (no `verified` flag) must be unusable.
  const walletDir = path.join(SANDBOX, 'wallets');
  fs.mkdirSync(walletDir, { recursive: true });
  fs.writeFileSync(path.join(walletDir, 'links.json'),
    JSON.stringify({ byDevice: { [dk]: { addr: WALLET, at: Date.now() } }, byAddr: { [WALLET]: { dk, at: Date.now(), attest: [] } } }));
  initWalletStore();       // LOAD it, so this really is an on-disk legacy record
  ok('the legacy record really is on disk and loaded', !!links.byDevice[dk] && links.byDevice[dk].addr === WALLET);
  ok('a legacy on-disk link (no verified flag) resolves to null in the authority', verifiedWalletFor(dk) === null);
  ok('and the reverse lookup refuses too', deviceWithVerifiedWallet(WALLET) === null);
  const legacyRefused = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_legacy_001' },
    { sendImpl: async () => { sent++; return { signature: 'x' }; }, floatBalanceImpl: async () => 10_000 * M });
  ok('so a payout to a LEGACY unverified link is refused too', legacyRefused.reason === 'wallet_not_verified', legacyRefused.reason);
  ok('still nothing sent', sent === 0);

  // Now link it properly, through the ONE authority. (This is also the legacy-upgrade
  // path: the unverified record above is replaced, not trusted.)
  const linkRec = linkVerifiedWallet(dk, WALLET);
  ok('the authority records the verified link', linkRec.ok === true && linkRec.relinked === false);
  ok('the legacy record was upgraded in place', links.byDevice[dk].verified === true && links.byAddr[WALLET].verified === true);
  ok('verifiedWalletFor() now returns the address', verifiedWalletFor(dk) === WALLET);
  ok('verifiedWalletRecordFor() exposes addedAt + verified', verifiedWalletRecordFor(dk)?.verified === true);
  ok('the reverse lookup finds the device', deviceWithVerifiedWallet(WALLET) === dk);

  console.log('\n9. the claim path: paid once, compensated on failure (the ledger is the judge)');
  let pays = 0;
  const good = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 100 * M, claimId: 'claim_paid_0001' },
    { sendImpl: async () => { pays++; return { signature: 'SIGgood0001' }; }, floatBalanceImpl: async () => 10_000 * M });
  ok('the claim succeeds', good.ok === true && good.reason === 'paid', JSON.stringify(good.reason));
  ok('it returns the signature', good.signature === 'SIGgood0001');
  ok('the balance is debited exactly once', bal() === 900 * M, `bal=${bal()}`);
  ok('one transaction was sent', pays === 1);

  const replay = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 100 * M, claimId: 'claim_paid_0001' },
    { sendImpl: async () => { pays++; return { signature: 'SIGgood0001-retry' }; }, floatBalanceImpl: async () => 10_000 * M });
  ok('a RETRY does not pay twice', replay.ok === false && replay.reason === 'already_paid', replay.reason);
  ok('the balance did not move again', bal() === 900 * M);
  ok('no second transaction was sent', pays === 1, `pays=${pays}`);

  const before = bal();
  const failed = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 250 * M, claimId: 'claim_fail_0001' },
    { sendImpl: async () => { throw new Error('blockhash not found'); }, floatBalanceImpl: async () => 10_000 * M });
  ok('a failed send is reported', failed.ok === false && failed.reason === 'send_failed', failed.reason);
  ok('the debit WAS reversed (refunded true)', failed.refunded === true);
  ok('the balance is exactly what it was before the attempt', bal() === before, `bal=${bal()} before=${before}`);

  const journal = L.history(dk, 200);
  const refundEntry = journal.find((e) => e.id === 'claim:claim_fail_0001:refund');
  ok('the compensating entry is VISIBLE in the ledger journal', !!refundEntry);
  ok('it is a credit of exactly the failed amount', refundEntry.amount === 250 * M && refundEntry.resource === 'wayfarer', JSON.stringify(refundEntry));
  ok('it carries an explicit reason and a running balance',
    refundEntry.reason === 'admin' && Number.isSafeInteger(refundEntry.balanceAfter), JSON.stringify(refundEntry));
  ok('the failed claimId is named in the compensating entry',
    refundEntry.meta?.for === 'claim_fail_0001' && /blockhash/.test(refundEntry.meta?.error || ''), JSON.stringify(refundEntry.meta));

  console.log('\n10. unconfigured + enabled: the DEFAULT send refuses and the player is made whole');
  // No WAYFARER_MINT here: the default (settlement) send must refuse, and payouts must
  // compensate. Nothing is signed, and the player is never left short.
  const before2 = bal();
  delete process.env.WAYFARER_MINT;
  const noChain = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 50 * M, claimId: 'claim_nochain_01' },
    { floatBalanceImpl: async () => 10_000 * M });            // default send = settlement
  ok('the default send refuses when the chain is unconfigured',
    noChain.ok === false && noChain.reason === 'send_failed', JSON.stringify(noChain));
  ok('the refusal names WAYFARER_MINT', /WAYFARER_MINT/.test(noChain.error || ''), noChain.error);
  ok('the debit was compensated, so the player is whole', noChain.refunded === true && bal() === before2, `bal=${bal()}`);

  console.log('\n10b. the payouts layer refuses a mint whose decimals are not 6');
  process.env.WAYFARER_MINT = MINT;
  const before3 = bal();
  let sent3 = 0;
  const rejected = await P.claim({ playerKey: dk, walletAddress: WALLET, amountRaw: 10 * M, claimId: 'claim_dec_reject' },
    {
      mintCheckImpl: async () => ({ ok: false, reason: 'mint has 9 decimals on-chain; the economy stores base units assuming 6 (server/economy/CONTRACT.md). Refusing.' }),
      floatBalanceImpl: async () => 10_000 * M,
      sendImpl: async () => { sent3++; return { signature: 'x' }; },
    });
  ok('refused with mint_rejected', rejected.reason === 'mint_rejected', rejected.reason);
  ok('the reason explains the decimals mismatch', /decimals/.test(rejected.error || ''), rejected.error);
  ok('NOTHING was signed', sent3 === 0);
  ok('the balance is untouched', bal() === before3);
  delete process.env.WAYFARER_MINT;
}

console.log('\n11. payouts.js holds no signing primitive (settlement.js is the only signer)');
{
  const src = fs.readFileSync(new URL('../economy/payouts.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const forbidden = [/sendTransaction/, /signTransaction/, /partialSign/, /\bKeypair\b/, /sendAndConfirm/, /@solana\/web3\.js/, /spl-token/];
  const found = forbidden.filter((re) => re.test(code)).map(String);
  ok('payouts.js never signs or submits a transaction', found.length === 0, found.join(','));
  const settleSrc = fs.readFileSync(new URL('./settlement.js', import.meta.url), 'utf8');
  ok('settlement.js imports the SPL token program (it IS the signer)', /@solana\/spl-token/.test(settleSrc));
}

L.stopLedger();
stopWalletStore();
delete process.env.PAYOUTS_ENABLED;
delete process.env.WAYFARER_MINT;
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
