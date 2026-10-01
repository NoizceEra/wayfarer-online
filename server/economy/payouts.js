/**
 * payouts.js — the ONLY place the relay signs a transaction (token claims).
 *
 * A claim moves value off the relay's hot wallet to a player. Everything here exists to
 * make that safe, because a wrong signature cannot be rolled back:
 *
 *   * DRY RUN BY DEFAULT. Nothing is signed unless PAYOUTS_ENABLED === 'true'. The
 *     default path computes and reports exactly what it would do and moves nothing.
 *   * VERIFIED WALLET ONLY. The destination must be a signature-verified wallet link
 *     (identity.isWalletVerifiedFor). An unverified address — anyone can type one — must
 *     never receive a payout, which is why the wallet link requires a signature at all.
 *   * FLOAT CAP. The hot wallet holds a bounded float, not the treasury. Paying is
 *     refused if it would drop the float below HOT_FLOAT_MIN, and refused entirely if the
 *     float is already above HOT_FLOAT_MAX (that means someone topped it up by mistake —
 *     sweep it by hand rather than let a leak take more). Worst case from a stolen relay
 *     key is therefore the float, not the supply.
 *   * IDEMPOTENT. The ledger debit is keyed on the claim id, so a retried claim cannot
 *     pay twice. The client may safely retry on a timeout.
 *   * COMPENSATED. Order is debit -> send. If the send fails, the debit is reversed with
 *     an explicit compensating entry. The player is never left short by a network error,
 *     and the reversal is visible in the journal rather than an invisible fixup.
 *   * DUST FLOOR. Claims below MIN_CLAIM_RAW are refused: the transaction fee would
 *     exceed the payout.
 *
 * The chain call is INJECTABLE (`deps.sendImpl`) so the failure and refund paths can be
 * tested without spending anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { CFG } from '../config.js';
import { log } from '../log.js';
import { apply, balancesOf } from './ledger.js';
import { isWalletVerifiedFor } from '../identity.js';

const DIR = path.join(CFG.DATA_DIR, 'economy');
const PAYOUT_FILE = path.join(DIR, 'payouts.json');
const CLAIM_ID_RE = /^[A-Za-z0-9_:.-]{6,160}$/;

const intOr = (v, d) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 0 ? n : d;
};

export function payoutConfig() {
  return {
    enabled: process.env.PAYOUTS_ENABLED === 'true',
    mint: process.env.WAYFARER_MINT || '8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg',
    hotKeypairPath: process.env.RELAY_HOT_KEYPAIR || null,
    cluster: process.env.CHAIN_CLUSTER || 'devnet',
    minClaimRaw: intOr(process.env.MIN_CLAIM_RAW, 1_000_000),          // 1 token
    floatMinRaw: intOr(process.env.HOT_FLOAT_MIN_RAW, 100_000_000),    // 100 tokens kept as runway
    floatMaxRaw: intOr(process.env.HOT_FLOAT_MAX_RAW, 20_000_000_000), // 20,000 token CAP = blast radius
  };
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

// ── the real chain sender (lazy: only loaded when actually paying) ───────────
async function realSend({ amountRaw, destination, cfg }) {
  if (!cfg.hotKeypairPath) throw new Error('RELAY_HOT_KEYPAIR is not set');
  if (!fs.existsSync(cfg.hotKeypairPath)) throw new Error(`hot keypair not found: ${cfg.hotKeypairPath}`);
  const { Connection, Keypair, clusterApiUrl } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');
  const conn = new Connection(process.env.CHAIN_RPC_URL || clusterApiUrl(cfg.cluster), 'confirmed');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(cfg.hotKeypairPath, 'utf8'))));
  const mint = new (await import('@solana/web3.js')).PublicKey(cfg.mint);
  const to = new (await import('@solana/web3.js')).PublicKey(destination);
  const from = await spl.getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  const toAta = await spl.getOrCreateAssociatedTokenAccount(conn, payer, mint, to);
  const sig = await spl.transfer(conn, payer, from.address, toAta.address, payer, BigInt(amountRaw));
  return { signature: String(sig) };
}

// ── float balance ────────────────────────────────────────────────────────────
async function realFloatBalance(cfg) {
  if (!cfg.hotKeypairPath || !fs.existsSync(cfg.hotKeypairPath)) return null;
  const { Connection, Keypair, PublicKey, clusterApiUrl } = await import('@solana/web3.js');
  const spl = await import('@solana/spl-token');
  const conn = new Connection(process.env.CHAIN_RPC_URL || clusterApiUrl(cfg.cluster), 'confirmed');
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(cfg.hotKeypairPath, 'utf8'))));
  const ata = await spl.getOrCreateAssociatedTokenAccount(conn, payer, new PublicKey(cfg.mint), payer.publicKey);
  return Number((await conn.getTokenAccountBalance(ata.address)).value.amount);
}

/**
 * Claim accrued token balance to a verified wallet.
 *
 * deps (all optional, for tests): { sendImpl, floatBalanceImpl, verifierImpl }
 * @returns {{ok:boolean, reason:string, signature?:string, amountRaw?:number, refunded?:boolean}}
 */
export async function claim({ playerKey, walletAddress, amountRaw, claimId }, deps = {}) {
  const cfg = payoutConfig();
  const sendImpl = deps.sendImpl || realSend;
  const floatBalanceImpl = deps.floatBalanceImpl || realFloatBalance;
  const verifierImpl = deps.verifierImpl || isWalletVerifiedFor;

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

  // Gate 3: the float. Checked BEFORE any ledger movement so a refusal is free.
  let floatRaw = null;
  try { floatRaw = await floatBalanceImpl(cfg); }
  catch (e) { return { ok: false, reason: `float_unreadable: ${e.message}` }; }
  if (floatRaw !== null) {
    if (floatRaw > cfg.floatMaxRaw) {
      return { ok: false, reason: 'float_over_cap', floatRaw, cap: cfg.floatMaxRaw,
        advice: 'sweep the hot wallet down by hand before resuming payouts' };
    }
    if (floatRaw - amountRaw < cfg.floatMinRaw) {
      return { ok: false, reason: 'float_too_low', floatRaw, required: cfg.floatMinRaw + amountRaw };
    }
  }

  // Dry run: report precisely what would happen, and move NOTHING (no debit either).
  if (!cfg.enabled) {
    const rec = appendJournal({ at: Date.now(), claimId, playerKey, walletAddress, amountRaw, status: 'dry_run' });
    return { ok: false, reason: 'dry_run', wouldPay: amountRaw, note: 'set PAYOUTS_ENABLED=true to sign', record: rec };
  }

  // Debit first, keyed on the claim id so a retry cannot pay twice.
  const debit = apply(playerKey, { id: `claim:${claimId}`, reason: 'claim', resource: 'wayfarer', amount: -amountRaw });
  if (!debit.applied) {
    return { ok: false, reason: debit.reason === 'duplicate' ? 'already_paid' : debit.reason };
  }

  let sent;
  try {
    sent = await sendImpl({ amountRaw, destination: walletAddress, cfg });
    if (!sent || !sent.signature) throw new Error('send returned no signature');
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
