#!/usr/bin/env node
/**
 * float-status.mjs — READ-ONLY ops guard for the REAL emission ceiling.
 *
 * Because the pump.fun mint has a FIXED supply and the mint authority is not ours, the relay
 * can NEVER mint a reward. The hard ceiling on everything the economy can ever pay is the
 * funded rewards wallet balance; the bounded "emission budget" in server/economy/CONTRACT.md
 * is only the ACCOUNTING bound (see docs/TOKENOMICS.md).
 *
 * The chain enforces the ceiling structurally — a transfer for more than the wallet holds
 * fails, and server/economy/payouts.js compensates the ledger debit when a send fails. This
 * script is the OPERATIONAL half: it tells ops, before enabling claims and while watching
 * them, whether the paying wallet can actually honour the configured float window.
 *
 * It signs nothing. Run it:
 *   * before flipping PAYOUTS_ENABLED on (expect GO)
 *   * on a schedule while payouts are live (a NO-GO here means top the wallet up)
 *
 * Exit: 0 = GO, 1 = NO-GO (paying wallet below the reserve, over the blast-radius cap, or
 * out of SOL for fees).
 *
 * Usage:
 *   node server/token/float-status.mjs --cluster mainnet --mint <MINT> \
 *        --rewards <ADDR> [--hot <ADDR>] [--rpc <URL>]
 *
 * Defaults for the float bounds mirror server/economy/payouts.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount } from '@solana/spl-token';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS_ROOT = path.join(HERE, 'keys');
const intOr = (v, d) => { const n = Number(v); return Number.isSafeInteger(n) && n >= 0 ? n : d; };

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (!t.startsWith('--')) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { a[key] = next; i++; } else { a[key] = true; }
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

const cluster = String(args.cluster || '').trim();
if (!/^[a-z0-9-]{3,20}$/.test(cluster)) die('--cluster is required (devnet | mainnet)');
const IS_MAINNET = cluster === 'mainnet' || cluster === 'mainnet-beta';
const rpc = String(args.rpc || clusterApiUrl(IS_MAINNET ? 'mainnet-beta' : cluster));
const KEYS_DIR = path.join(args['keys-root'] ? String(args['keys-root']) : KEYS_ROOT, cluster);

// mint: flag, else the verified receipt for this cluster (verify-launch.mjs wrote it).
let mintStr = args.mint ? String(args.mint) : null;
let receipt = null;
if (!mintStr) {
  const rp = path.join(KEYS_DIR, `launch-receipt.${cluster}.json`);
  if (fs.existsSync(rp)) { try { receipt = JSON.parse(fs.readFileSync(rp, 'utf8')); mintStr = receipt.mint; } catch { /* ignore */ } }
}
if (!mintStr) die('--mint <MINT> is required (or run verify-launch.mjs first to write a receipt)');
if (receipt && receipt.gate !== 'GO') {
  die(`the ${cluster} receipt is a ${receipt.gate} — fix that before checking the float`);
}

const rewardsStr = args.rewards ? String(args.rewards) : (process.env.REWARDS_WALLET || null);
const hotStr = args.hot ? String(args.hot) : (process.env.RELAY_HOT_WALLET || process.env.PAYOUT_WALLET || rewardsStr);
if (!rewardsStr) die('--rewards <ADDR> (or REWARDS_WALLET) is required — the wallet the owner funds');
if (!hotStr) die('--hot <ADDR> (or RELAY_HOT_WALLET) is required — the wallet the relay pays from');

const floatMinRaw = intOr(process.env.HOT_FLOAT_MIN_RAW, 100_000_000);      // 100 tokens
const floatMaxRaw = intOr(process.env.HOT_FLOAT_MAX_RAW, 20_000_000_000);   // 20,000 tokens
const minClaimRaw = intOr(process.env.MIN_CLAIM_RAW, 1_000_000);            // 1 token
const M = 10 ** 6;

const conn = new Connection(rpc, 'confirmed');
const mint = new PublicKey(mintStr);

async function tokenBalance(ownerStr) {
  const owner = new PublicKey(ownerStr);
  const ata = await getAssociatedTokenAddress(mint, owner);
  try {
    const acct = await getAccount(conn, ata);
    return { ata: ata.toBase58(), raw: Number(acct.amount), exists: true };
  } catch {
    return { ata: ata.toBase58(), raw: 0, exists: false };
  }
}

console.log('── Wayfarer float status (READ-ONLY) ───────────────────────────────');
console.log(`cluster     ${cluster}${IS_MAINNET ? '  (REAL MONEY)' : '  (devnet)'}`);
console.log(`mint        ${mintStr}`);
console.log(`rpc         ${rpc}`);
console.log(`rewards     ${rewardsStr}   <- the owner funds this; the hard ceiling`);
console.log(`hot/paying  ${hotStr}   <- the relay signs from this`);
console.log(`bounds      min ${floatMinRaw / M} / max ${floatMaxRaw / M} tokens, dust floor ${minClaimRaw / M}`);

let rewards; let hot; let hotSol = 0;
try {
  rewards = await tokenBalance(rewardsStr);
  hot = await tokenBalance(hotStr);
  hotSol = await conn.getBalance(new PublicKey(hotStr));
} catch (e) {
  console.error(`\nNO-GO  could not read the chain: ${e.message}`);
  process.exit(1);
}

console.log('\n── balances ────────────────────────────────────────────────────────');
console.log(`rewards      ${rewards.raw / M} tokens  (ata ${rewards.ata}${rewards.exists ? '' : ', NOT INITIALISED'})`);
console.log(`hot          ${hot.raw / M} tokens  (ata ${hot.ata}${hot.exists ? '' : ', NOT INITIALISED'})`);
console.log(`hot SOL      ${hotSol / LAMPORTS_PER_SOL} SOL  (fees)`);

const fail = [];
if (!rewards.exists || rewards.raw <= 0) {
  fail.push('the rewards wallet holds no tokens — nothing can ever be paid. Ask the owner to fund it.');
}
if (hot.raw < floatMinRaw) {
  fail.push(`the paying wallet is below the reserve (${hot.raw / M} < ${floatMinRaw / M} tokens): `
    + 'claims would be refused with float_too_low. Sweep more from rewards, or lower HOT_FLOAT_MIN_RAW.');
}
if (hot.raw > floatMaxRaw) {
  fail.push(`the paying wallet is OVER the blast-radius cap (${hot.raw / M} > ${floatMaxRaw / M} tokens): `
    + 'a stolen relay key could take that much. Sweep the float down or raise the cap deliberately.');
}
if (hotSol < 0.01 * LAMPORTS_PER_SOL) {
  fail.push('the paying wallet is out of SOL for transaction fees.');
}

console.log('\n── headroom ────────────────────────────────────────────────────────');
const spendable = Math.max(0, hot.raw - floatMinRaw);
console.log(`spendable above reserve : ${spendable / M} tokens`);
console.log(`claims of the dust floor : ${minClaimRaw > 0 ? Math.floor(spendable / minClaimRaw) : 'n/a'}`);
console.log(`rewards not yet swept    : ${rewards.raw / M} tokens`);

console.log(`\n==== ${fail.length ? 'NO-GO' : 'GO'} ====`);
for (const f of fail) console.log(`  - ${f}`);
process.exit(fail.length ? 1 : 0);
