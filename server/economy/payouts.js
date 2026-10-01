/**
 * payouts.js — the claim path: the ledger, the gates, and the compensating entry.
 *
 * This module moves value off the relay's hot wallet to a player. It owns the LEDGER
 * side of a payout (debit, idempotency, compensation) and every accounting gate. It
 * does NOT sign: the actual SPL transfer lives in `server/chain/settlement.js`, which
 * is the only module in the relay that touches a keypair.
 *
 *   * DRY RUN BY DEFAULT, AND IT NEVER TOUCHES THE NETWORK. Nothing is signed unless
 *     PAYOUTS_ENABLED === 'true'. The dry-run path validates the CONFIG SHAPE only
 *     (the mint parses as a base58 pubkey, the configured decimals match the economy's)
 *     and returns; it performs no RPC call at all, so an operator can preview a payout
 *     with a dead RPC. Every ON-CHAIN gate (the mint account read, the hot-wallet float
 *     read) runs on the signing path only.
 *   * VERIFIED WALLET ONLY. The destination is resolved through the ONE
 *     signature-verified authority (server/walletStore.js). An unverified address —
 *     anyone can type one — is refused, and a legacy on-disk link without the verified
 *     flag resolves to null there, so it can never receive a payout.
 *   * CHAIN-VERIFIED MINT. When a mint is configured it is checked ON-CHAIN first, and
 *     a mint whose decimals are not the economy's 6 is refused outright: the ledger
 *     stores base units, so a different exponent mis-prices every payout.
 *   * FLOAT CAP + HARD WALLET CEILING. The hot wallet holds a bounded float, not the
 *     treasury. Paying is refused if it would drop the float below HOT_FLOAT_MIN,
 *     refused entirely if the float is already above HOT_FLOAT_MAX (that means someone
 *     topped it up by mistake — sweep it by hand rather than let a leak take more), and
 *     refused if it would exceed the wallet's actual on-chain token balance. Since the
 *     relay can never mint, that balance is the true hard cap. Worst case from a stolen
 *     relay key is therefore the float.
 *   * IDEMPOTENT. The ledger debit is keyed on the claim id, so a retried claim cannot
 *     pay twice. The client may safely retry on a timeout.
 *   * COMPENSATED. Order is debit -> send. If the send fails, the debit is reversed with
 *     an explicit compensating entry. The player is never left short by a network error,
 *     and the reversal is visible in the journal rather than an invisible fixup.
 *   * DUST FLOOR. Claims below MIN_CLAIM_RAW are refused: the transaction fee would
 *     exceed the payout.
 *
 * The chain calls are INJECTABLE (`deps.sendImpl`, `deps.floatBalanceImpl`,
 * `deps.mintCheckImpl`, `deps.verifierImpl`) so the failure and refund paths can be
 * tested without spending anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CFG } from '../config.js';
import { log } from '../log.js';
import { apply, balancesOf } from './ledger.js';
import { mintConfig } from '../chain/mintConfig.js';
import { mintUsable } from '../chain/mintVerify.js';
import { isSolanaAddress } from '../chain/walletAuth.js';
import { settleClaim, payoutWalletRaw } from '../chain/settlement.js';
import { verifiedWalletFor } from '../walletStore.js';

const DIR = path.join(CFG.DATA_DIR, 'economy');
const PAYOUT_FILE = path.join(DIR, 'payouts.json');
const CLAIM_ID_RE = /^[A-Za-z0-9_:.-]{6,160}$/;

const intOr = (v, d) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : d;
};

/**
 * The payout configuration. The mint, cluster and paying key come from
 * `chain/mintConfig.js` — the mint is REQUIRED there and has NO compiled-in fallback,
 * because a hardcoded mint silently pays the wrong cluster's token. When `mint` is
 * null the chain is simply unconfigured and no money path can run.
 */
export function payoutConfig() {
  const chain = mintConfig();
  return {
    enabled: process.env.PAYOUTS_ENABLED === 'true',
    mint: chain.mint,                                              // null, never a default
    cluster: chain.cluster,
    decimals: chain.decimals,
    requiredDecimals: chain.requiredDecimals,
    hotKeypairPath: chain.payoutKeypairPath,                        // PAYOUT_KEYPAIR_PATH, or the cluster's rewards keypair
    minClaimRaw: intOr(process.env.MIN_CLAIM_RAW, 1_000_000),       // 1 token at 6 decimals
    floatMinRaw: intOr(process.env.HOT_FLOAT_MIN_RAW, 100_000_000), // 100 tokens kept as runway
    floatMaxRaw: intOr(process.env.HOT_FLOAT_MAX_RAW, 20_000_000_000), // 20,000 token CAP = blast radius
  };
}

// ── the network-free config-shape gate (dry-run safe) ────────────────────────
// The dry run may not read the chain, but it can still refuse a configuration that
// CANNOT possibly work: a mint that is not base58, or a configured exponent that is
// not the one the ledger's base units assume. That is the whole preview an operator
// needs before going live, and it costs no RPC. The ON-CHAIN check (mintVerify.js)
// remains absolute on the signing path below.
export function mintConfigShape(cfg = payoutConfig()) {
  if (!cfg.mint) return { ok: true, checked: 'mint-absent' };
  if (!isSolanaAddress(String(cfg.mint))) {
    return { ok: false, reason: `WAYFARER_MINT (${cfg.mint}) is not a valid base58 Solana address` };
  }
  if (cfg.decimals !== cfg.requiredDecimals) {
    return {
      ok: false,
      reason: `CHAIN_DECIMALS is ${cfg.decimals} but the ledger stores base units at `
        + `${cfg.requiredDecimals} decimals (server/economy/CONTRACT.md); every payout would be mis-priced`,
    };
  }
  return { ok: true, checked: 'mint-config-shape' };
}

// ── payout journal (append-only, atomic, bounded) ────────────────────────────
function readJournal() {
  try {
    const j = JSON.parse(fs.readFileSync(PAYOUT_FILE, 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch { return []; }
}

function appendJournal(record) {
  const j = readJournal();
  j.push(record);
  const trimmed = j.slice(-1000);
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${PAYOUT_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(trimmed));
    fs.renameSync(tmp, PAYOUT_FILE);
  } catch (e) {
    log.error('payout journal write failed', { err: e.message });
  }
  return record;
}

export function payoutHistory(limit = 50) { return readJournal().slice(-limit).reverse(); }

// ── the ONE verified-wallet authority, as a payout destination gate ──────────
// Fail closed: an unknown player, a malformed key, an unverified link, or only one
// side of the link marked verified all resolve to "refused". A legacy on-disk link
// (no `verified` flag) resolves to null, so it is never a payout destination.
function defaultVerifier(playerKey, walletAddress) {
  const addr = verifiedWalletFor(String(playerKey || ''));
  return typeof addr === 'string' && addr === String(walletAddress || '').trim();
}

// ── defaults that reach the chain (lazy: only loaded when paying is attempted) ────
// The signer is `server/chain/settlement.js` — the only module in the relay that holds
// a keypair. The float read is read-only and never creates anything.
const defaultSend = (opts) => settleClaim({
  claimId: opts.claimId,
  destination: opts.destination,
  amountRaw: opts.amountRaw,
  cfg: opts.cfg,
});
const defaultFloatBalance = (cfg) => payoutWalletRaw(cfg);

/**
 * Claim accrued token balance to a verified wallet.
 *
 * deps (all optional, for tests): { sendImpl, floatBalanceImpl, mintCheckImpl, verifierImpl }
 * @returns {{ok:boolean, reason:string, signature?:string, amountRaw?:number, refunded?:boolean}}
 */
export async function claim({ playerKey, walletAddress, amountRaw, claimId }, deps = {}) {
  const cfg = payoutConfig();
  const sendImpl = deps.sendImpl || defaultSend;
  const floatBalanceImpl = deps.floatBalanceImpl || defaultFloatBalance;
  const verifierImpl = deps.verifierImpl || defaultVerifier;
  const mintCheckImpl = deps.mintCheckImpl || mintUsable;

  if (!CLAIM_ID_RE.test(String(claimId || ''))) return { ok: false, reason: 'bad_claim_id' };
  if (!Number.isSafeInteger(amountRaw) || amountRaw <= 0) return { ok: false, reason: 'bad_amount' };
  if (amountRaw < cfg.minClaimRaw) {
    return { ok: false, reason: 'below_dust_floor', minimum: cfg.minClaimRaw };
  }

  // Gate 1: the destination must be a SIGNATURE-VERIFIED wallet for this exact player.
  let verified = false;
  try { verified = await verifierImpl(playerKey, walletAddress); }
  catch (e) { return { ok: false, reason: `verify_failed: ${e.message}` }; }
  if (!verified) return { ok: false, reason: 'wallet_not_verified' };

  // Gate 2: the ledger must actually owe this much.
  const bal = balancesOf(playerKey);
  if (!bal || bal.wayfarer < amountRaw) {
    return { ok: false, reason: 'insufficient', available: bal ? bal.wayfarer : 0 };
  }

  // Gate 3: the CONFIG SHAPE. Network-free, and it runs on BOTH paths so a broken
  // configuration is refused identically whether or not the operator is live.
  if (cfg.mint) {
    const shape = mintConfigShape(cfg);
    if (!shape.ok) return { ok: false, reason: 'mint_rejected', error: shape.reason };
  }

  // DRY RUN: report precisely what would happen, and move NOTHING. Reached BEFORE
  // every on-chain gate, so a preview never needs a live RPC or a reachable mint —
  // that is the entire point of a dry run. Nothing is signed and no ledger entry is
  // written (not even a zero-amount one).
  if (!cfg.enabled) {
    const rec = appendJournal({ at: Date.now(), claimId, playerKey, walletAddress, amountRaw, status: 'dry_run' });
    return { ok: false, reason: 'dry_run', wouldPay: amountRaw, note: 'set PAYOUTS_ENABLED=true to sign', record: rec };
  }

  // ── everything below this line SIGNS, so every ON-CHAIN gate is absolute ────

  // Gate 4: when a mint is configured it must be REAL and must have the economy's
  // decimals. Checked ON-CHAIN, never trusted from config, and a mismatch REFUSES
  // rather than logging: the ledger stores base units, so a mint with any other
  // exponent would mis-price every payout by orders of magnitude. (With no mint at all
  // the settlement layer refuses anyway, so this gate only ever adds a reason.)
  if (cfg.mint) {
    let mintCheck;
    try { mintCheck = await mintCheckImpl(cfg); }
    catch (e) { return { ok: false, reason: `mint_unverifiable: ${e.message}` }; }
    if (!mintCheck || !mintCheck.ok) {
      return { ok: false, reason: 'mint_rejected',
        error: (mintCheck && mintCheck.reason) || 'mint could not be verified on-chain' };
    }
  }

  // Gate 5: the float. Checked BEFORE any ledger movement so a refusal is free.
  let floatRaw = null;
  try { floatRaw = await floatBalanceImpl(cfg); }
  catch (e) { return { ok: false, reason: `float_unreadable: ${e.message}` }; }
  if (floatRaw !== null) {
    if (floatRaw > cfg.floatMaxRaw) {
      return { ok: false, reason: 'float_over_cap', floatRaw, cap: cfg.floatMaxRaw,
        advice: 'sweep the hot wallet down by hand before resuming payouts' };
    }
    // THE HARD CEILING. The relay can never mint this token, so the paying wallet's
    // real on-chain balance — not the ledger — is the true upper bound on a payout.
    if (amountRaw > floatRaw) {
      return { ok: false, reason: 'float_insufficient', floatRaw, amountRaw,
        advice: 'the paying wallet holds less than this payout; fund the rewards wallet first' };
    }
    if (floatRaw - amountRaw < cfg.floatMinRaw) {
      return { ok: false, reason: 'float_too_low', floatRaw, required: cfg.floatMinRaw + amountRaw };
    }
  }

  // Debit first, keyed on the claim id so a retry cannot pay twice.
  const debit = apply(playerKey, { id: `claim:${claimId}`, reason: 'claim', resource: 'wayfarer', amount: -amountRaw });
  if (!debit.applied) {
    return { ok: false, reason: debit.reason === 'duplicate' ? 'already_paid' : debit.reason };
  }

  let sent;
  try {
    sent = await sendImpl({ amountRaw, destination: walletAddress, claimId, playerKey, cfg });
    if (!sent || !sent.signature) {
      throw new Error(sent && sent.error ? sent.error : 'send returned no signature');
    }
  } catch (e) {
    // COMPENSATE: the debit must not stand if the value never left.
    const refund = apply(playerKey, {
      id: `claim:${claimId}:refund`, reason: 'admin', resource: 'wayfarer', amount: amountRaw,
      meta: { for: claimId, error: e.message },
    });
    const rec = appendJournal({ at: Date.now(), claimId, playerKey, walletAddress, amountRaw,
      status: 'send_failed', error: e.message, refunded: refund.applied });
    log.error('payout send failed; debit reversed', { claimId, refunded: refund.applied, err: e.message });
    return { ok: false, reason: 'send_failed', refunded: refund.applied, error: e.message, record: rec };
  }

  const rec = appendJournal({ at: Date.now(), claimId, playerKey, walletAddress, amountRaw,
    status: 'paid', signature: sent.signature });
  log.info('payout sent', { claimId, amountRaw, sig: String(sent.signature).slice(0, 16) });
  return { ok: true, reason: 'paid', signature: sent.signature, amountRaw, balances: debit.balances, record: rec };
}

/** Deterministic-ish claim id helper so retries reuse the same key. */
export function makeClaimId(playerKey) {
  return `claim_${String(playerKey).slice(0, 12)}_${crypto.randomBytes(6).toString('hex')}`;
}
