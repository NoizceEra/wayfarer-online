/**
 * settlement.js — the SPL transfer that pays a claim.
 *
 * **This is the only module in the relay that signs.** `rpc.js` stays read-only by
 * construction, and `server/economy/payouts.js` owns the ledger but holds no key: it
 * debits, calls `settleClaim`, and compensates if the send fails. Everything that
 * touches a keypair or a signed transaction lives here.
 *
 * SAFETY PROPERTIES
 *
 *   * VERIFY-FIRST, IN FOUR LAYERS, BEFORE ANYTHING IS SIGNED
 *       1. the mint is confirmed ON-CHAIN and has exactly 6 decimals (the economy's
 *          base-unit contract) — `mintVerify.assertMintUsable`;
 *       2. the paying wallet really holds at least the amount being sent — the TRUE
 *          hard cap, because this token can never be minted by the relay;
 *       3. the destination is a syntactically valid Solana address;
 *       4. the destination token account is derived deterministically from the
 *          destination address and, when it does not exist, is created with the
 *          payer — a caller can never redirect it.
 *   * THE TOKEN PROGRAM COMES FROM THE CHAIN, NOT AN ASSUMPTION. The mint account's
 *     owning program decides the shape of the payout: an associated token account is
 *     derived from (mint, owner, programId), so the legacy SPL Token program and
 *     Token-2022 (pump.fun's current `create_v2` standard) produce DIFFERENT addresses
 *     for the same (mint, owner). This module reads the mint's `owner` on-chain and
 *     passes that program to every spl-token helper — a transfer built for the wrong
 *     program reverts, which is exactly the bug this replaces. `CHAIN_TOKEN_PROGRAM`
 *     is an EXPECTED value only: it must agree with the chain or the send is refused.
 *     Any other owning program is fail-closed.
 *   * IDEMPOTENT ON THE CLAIM ID. A record is written before the send (status
 *     `pending`) and updated to `settled` with the signature after it. A replay finds
 *     `settled` and returns the SAME signature without signing again; a replay while a
 *     previous attempt is unresolved finds `pending` and refuses rather than double-
 *     pay. A failed send clears the record so a legitimate retry can proceed.
 *   * BOUNDED. A single transfer may never exceed `SETTLE_MAX_RAW`.
 *   * INJECTABLE. `deps.sendImpl` / `deps.balanceImpl` / `deps.mintVerifyImpl` let the
 *     tests exercise every path without spending anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';
import { log } from '../log.js';
import { mintConfig, assertChainConfigured } from './mintConfig.js';
import {
  assertMintUsable, mintUsable, tokenProgramInfo, expectedTokenProgram,
  TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID,
} from './mintVerify.js';
import { isSolanaAddress } from './walletAuth.js';

const DIR = path.join(CFG.DATA_DIR, 'chain');
const RECORD_FILE = path.join(DIR, 'settlements.json');
const CLAIM_ID_RE = /^[A-Za-z0-9_:.-]{6,160}$/;
const MAX_RECORDS = 2000;

/** Upper bound on a single transfer: 1,000 tokens at 6 decimals. Override with SETTLE_MAX_RAW. */
const DEFAULT_MAX_TRANSFER_RAW = 1_000_000_000;

const intOr = (v, d) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : d;
};

/** The chain configuration settlement signs against. */
export function settlementConfig() {
  const cfg = mintConfig();
  return {
    mint: cfg.mint,                                    // never a compiled-in default
    cluster: cfg.cluster,
    decimals: cfg.decimals,
    requiredDecimals: cfg.requiredDecimals,
    payoutKeypairPath: cfg.payoutKeypairPath,
    rpcUrl: cfg.rpcUrl,
    maxTransferRaw: intOr(process.env.SETTLE_MAX_RAW, DEFAULT_MAX_TRANSFER_RAW),
  };
}

// ── claim-id records (append-ish, atomic, bounded) ───────────────────────────
function readRecords() {
  try {
    const j = JSON.parse(fs.readFileSync(RECORD_FILE, 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}

function writeRecords(all) {
  const keys = Object.keys(all);
  // Bound the file: keep the newest MAX_RECORDS entries by timestamp.
  if (keys.length > MAX_RECORDS) {
    for (const k of keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0)).slice(0, keys.length - MAX_RECORDS)) delete all[k];
  }
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${RECORD_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, RECORD_FILE);
}

function setRecord(claimId, rec) {
  const all = readRecords();
  all[claimId] = rec;
  writeRecords(all);
}

function clearRecord(claimId) {
  const all = readRecords();
  if (claimId in all) { delete all[claimId]; writeRecords(all); }
}

/** Recent settlements, newest first (ops / debugging). Never includes key material. */
export function settlementHistory(limit = 50) {
  const all = readRecords();
  return Object.entries(all)
    .map(([claimId, rec]) => ({ claimId, ...rec }))
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

/** Test-only: forget every claim id. */
export function clearSettlements() { try { fs.rmSync(RECORD_FILE, { force: true }); } catch { /* ignore */ } }

// ── token-program selection (the authority is the CHAIN) ─────────────────────
/**
 * Choose the token program for a payout from what the chain says about the mint.
 *
 * `ownerProgram` is the mint account's on-chain `owner` field — the ONLY authority.
 * `CHAIN_TOKEN_PROGRAM` is a configured EXPECTATION (default from mintVerify), never
 * an override: a disagreement is fail-closed. Any owning program that is not one of the
 * two supported token programs throws, so nothing is ever signed against it.
 *
 * Throws (fail closed) — the caller must NOT catch-and-continue.
 * @returns {{id:string, name:string, standard:'legacy'|'token-2022'}}
 */
export function selectTokenProgram({ ownerProgram, configured = expectedTokenProgram() } = {}) {
  const info = tokenProgramInfo(ownerProgram);
  if (!info) {
    throw new Error(`mint is owned by ${ownerProgram || '(unknown program)'}, which is not a token program `
      + `the relay can pay on (legacy SPL Token ${TOKEN_PROGRAM_ID} or Token-2022 ${TOKEN_2022_PROGRAM_ID}). `
      + 'Refusing to sign a transfer against an unrecognised program.');
  }
  if (configured && configured !== info.id) {
    throw new Error(`CHAIN_TOKEN_PROGRAM=${configured} disagrees with the chain, which owns the mint with `
      + `${info.id} (${info.name}). The chain is the authority; refusing to sign against the configured program.`);
  }
  return info;
}

/**
 * Read the mint account's owning program from the chain and classify it. The owning
 * program is used ONLY to select which token program the transfer helpers target; it is
 * never trusted from configuration.
 */
async function readMintProgram(conn, mint) {
  const acct = await conn.getAccountInfo(mint);
  if (!acct) throw new Error(`mint ${String(mint)} does not exist on ${conn.rpcEndpoint || 'the configured RPC'}`);
  return selectTokenProgram({ ownerProgram: acct.owner.toBase58() });
}

// ── the paying wallet's on-chain balance (read-only, never creates) ──────────
/**
 * The paying wallet's real SPL balance, in base units, or null when it cannot be
 * read (no keypair configured). This is the true ceiling on a payout: the relay can
 * never mint, so it can never pay more than it holds.
 *
 * Read-only: the associated token account address is DERIVED (no transaction, no
 * signature) — unlike a get-or-create, this cannot accidentally sign at read time. The
 * derivation is done under the SAME program the transfer will use (read from the
 * chain), because the ATA address depends on it: deriving under the wrong program would
 * read a different, empty account and report a zero balance.
 */
export async function payoutWalletRaw(cfg = settlementConfig(), deps = {}) {
  if (deps.balanceImpl) return deps.balanceImpl(cfg);
  if (!cfg.mint) throw new Error('WAYFARER_MINT is not set');
  if (!cfg.rpcUrl) throw new Error(`no RPC endpoint for cluster "${cfg.cluster}" (set CHAIN_RPC_URLS)`);
  const keypairPath = cfg.payoutKeypairPath;
  if (!keypairPath || !fs.existsSync(keypairPath)) {
    throw new Error(`payout keypair not found at ${keypairPath || '(unset)'} — set PAYOUT_KEYPAIR_PATH to the funded rewards keypair for cluster "${cfg.cluster}"`);
  }
  const { Connection, Keypair, PublicKey } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));
  const mint = new PublicKey(cfg.mint);
  const conn = new Connection(cfg.rpcUrl, 'confirmed');
  const program = await readMintProgram(conn, mint);            // chain-authoritative
  const ata = spl.getAssociatedTokenAddressSync(mint, payer.publicKey, false, new PublicKey(program.id));
  try {
    const bal = await conn.getTokenAccountBalance(ata);
    return Number(bal.value.amount);
  } catch {
    return 0;                                   // no account yet = zero balance
  }
}

// ── the real, signing send ──────────────────────────────────────────────────
/**
 * Create-if-needed the destination token account, then transfer `amountRaw` base
 * units to it. Signs with the configured payout keypair. Never called by the tests.
 */
async function realSend({ cfg, destination, amountRaw }) {
  if (!cfg.mint) throw new Error('WAYFARER_MINT is not set');
  if (!cfg.rpcUrl) throw new Error(`no RPC endpoint for cluster "${cfg.cluster}" (set CHAIN_RPC_URLS)`);
  const keypairPath = cfg.payoutKeypairPath;
  if (!keypairPath) throw new Error('PAYOUT_KEYPAIR_PATH is not set and no default rewards keypair path could be resolved');
  if (!fs.existsSync(keypairPath)) {
    throw new Error(`payout keypair not found at ${keypairPath} — set PAYOUT_KEYPAIR_PATH to the funded rewards keypair for cluster "${cfg.cluster}"`);
  }

  const { Connection, Keypair, PublicKey } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');

  const conn = new Connection(cfg.rpcUrl, 'confirmed');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf8'))));
  const mint = new PublicKey(cfg.mint);
  const to = new PublicKey(destination);

  // WHICH TOKEN PROGRAM — FROM THE CHAIN. The mint account's owning program decides
  // the ATA derivation: (mint, owner, programId). Token-2022 (pump.fun's current
  // `create_v2` standard) and legacy SPL Token give DIFFERENT addresses for the same
  // (mint, owner), so building the transfer for the wrong program targets an account
  // that does not exist and every transfer reverts. This reads the owner on-chain
  // (never config) and fails closed on anything unrecognised or on a configured
  // CHAIN_TOKEN_PROGRAM that disagrees.
  const program = await readMintProgram(conn, mint);
  const programId = new PublicKey(program.id);

  // Verify-first: derive the destination token account from the requested owner and
  // mint UNDER THE CHAIN'S PROGRAM. Creating it with the payer is deterministic (an ATA
  // address is a function of (mint, owner, programId)), so a caller cannot redirect
  // the funds elsewhere.
  const toAta = await spl.getOrCreateAssociatedTokenAccount(conn, payer, mint, to, false, undefined, undefined, programId);
  if (String(toAta.mint) !== String(mint) || String(toAta.owner) !== String(to)) {
    throw new Error('destination token account does not match the requested mint/owner');
  }
  const fromAta = await spl.getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey, false, undefined, undefined, programId);

  const sig = await spl.transfer(conn, payer, fromAta.address, toAta.address, payer, BigInt(amountRaw), [], undefined, programId);
  await conn.confirmTransaction(sig, 'confirmed');
  return { signature: String(sig), destinationAta: String(toAta.address), mint: String(mint), tokenProgram: program.id, tokenProgramName: program.name };
}

// ── the settlement entry point ───────────────────────────────────────────────
/**
 * Pay `amountRaw` base units of the configured mint from the configured payout
 * keypair to `destination`, exactly once per `claimId`.
 *
 * deps (all optional, for tests):
 *   sendImpl, balanceImpl (returns raw base units | null),
 *   mintVerifyImpl (returns the verified on-chain mint facts, or THROWS to reject),
 *   rpcCall (forwarded to the real mint verifier)
 *
 * @returns {{ok:boolean, reason:string, signature?:string, alreadySettled?:boolean, error?:string}}
 */
export async function settleClaim({ claimId, destination, amountRaw, cfg = settlementConfig(), deps = {} } = {}) {
  if (!CLAIM_ID_RE.test(String(claimId || ''))) return { ok: false, reason: 'bad_claim_id' };
  if (!isSolanaAddress(destination)) return { ok: false, reason: 'bad_destination' };
  if (!Number.isSafeInteger(amountRaw) || amountRaw <= 0) return { ok: false, reason: 'bad_amount' };
  if (amountRaw > cfg.maxTransferRaw) {
    return { ok: false, reason: 'over_transfer_bound', maxTransferRaw: cfg.maxTransferRaw, amountRaw };
  }
  if (!cfg.mint) {
    return { ok: false, reason: 'chain_not_configured', error: 'WAYFARER_MINT is not set — there is no compiled-in mint to settle against.' };
  }
  try { assertChainConfigured(); } catch (err) { return { ok: false, reason: 'chain_not_configured', error: err.message }; }

  // 1. The mint must exist ON-CHAIN with the economy's 6 decimals. Fail closed:
  //    a different exponent would mis-price the payout by orders of magnitude.
  const mintVerify = deps.mintVerifyImpl || ((c) => assertMintUsable(c, { rpcCall: deps.rpcCall }));
  let onChain;
  try { onChain = await mintVerify(cfg); }
  catch (err) { return { ok: false, reason: 'mint_rejected', error: err.message }; }

  // 2. IDEMPOTENCY, claimed BEFORE value moves. A settled claim returns its stored
  //    signature and never signs again; an unresolved earlier attempt refuses.
  const prior = readRecords()[claimId];
  if (prior?.signature) {
    return { ok: true, reason: 'already_settled', signature: prior.signature, alreadySettled: true };
  }
  if (prior?.status === 'pending') {
    return { ok: false, reason: 'settle_in_flight', error: 'a previous attempt for this claim id has not resolved; refusing to sign again' };
  }

  // 3. THE HARD CAP: the paying wallet's real on-chain balance. The relay can never
  //    mint, so this — not the accounting float — is the true ceiling.
  let walletRaw;
  try { walletRaw = await payoutWalletRaw(cfg, deps); }
  catch (err) { return { ok: false, reason: 'wallet_balance_unreadable', error: err.message }; }
  if (walletRaw !== null && amountRaw > walletRaw) {
    return { ok: false, reason: 'over_wallet_balance', walletRaw, amountRaw,
      error: `payout of ${amountRaw} base units exceeds the paying wallet's on-chain balance of ${walletRaw}` };
  }

  setRecord(claimId, {
    status: 'pending', at: Date.now(), destination, amountRaw,
    cluster: cfg.cluster, mint: cfg.mint,
    onChainDecimals: onChain?.decimals ?? null, walletRaw,
    tokenProgram: onChain?.tokenProgram?.id ?? null,
  });

  // 4. Sign and send.
  const sendImpl = deps.sendImpl || realSend;
  let sent;
  try {
    sent = await sendImpl({ cfg, destination, amountRaw, claimId });
    if (!sent || !sent.signature) throw new Error('send returned no signature');
  } catch (err) {
    clearRecord(claimId);                   // a failed attempt must not block a retry
    log.error('settlement send failed', { claimId, err: err.message });
    return { ok: false, reason: 'send_failed', error: err.message };
  }

  const signature = String(sent.signature);
  const tokenProgram = sent.tokenProgram || onChain?.tokenProgram?.id || null;
  setRecord(claimId, {
    status: 'settled', at: Date.now(), signature, destination, amountRaw,
    cluster: cfg.cluster, mint: cfg.mint,
    onChainDecimals: onChain?.decimals ?? null, walletRaw,
    tokenProgram,
    destinationAta: sent.destinationAta || null,
  });
  log.info('settlement sent', { claimId, amountRaw, sig: signature.slice(0, 16), tokenProgram });
  return {
    ok: true, reason: 'settled', signature, amountRaw,
    onChainDecimals: onChain?.decimals ?? null, walletRaw, tokenProgram,
    record: { claimId, status: 'settled', signature, at: Date.now() },
  };
}

export { mintUsable };
