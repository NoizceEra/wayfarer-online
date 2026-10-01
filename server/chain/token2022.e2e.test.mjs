/**
 * token2022.e2e.test.mjs — the REAL end-to-end proof, on devnet, that the payout path
 * now works on a pump.fun-style Token-2022 mint AND still works on a legacy SPL mint.
 *
 * It is OFF by default so the hermetic chain suite stays hermetic (no network, no
 * funds): set CHAIN_E2E_DEVNET=1 to run it. On a machine with no devnet reach it prints
 * SKIP and exits 0 — it never fails the suite for a network reason, and it never fakes
 * a result.
 *
 *   CHAIN_E2E_DEVNET=1 node server/chain/token2022.e2e.test.mjs
 *
 * What it does, all on DEVNET (free, never mainnet):
 *   1. creates a throwaway Token-2022 mint (decimals 6) and a legacy SPL mint;
 *   2. funds a payer with a devnet airdrop (retried; SKIPs if it cannot);
 *   3. runs the REAL settlement path (no injected send) against each mint, prints the
 *      real transaction signature, and reads the destination's ATA back ON-CHAIN to
 *      confirm the exact amount arrived;
 *   4. shows the legacy ATA for the same destination is NOT the one that received the
 *      Token-2022 payout — i.e. the old bug would have targeted a different address.
 *
 * Keys live under server/token/keys/devnet/ (gitignored); no secret is ever printed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.dirname(HERE);
const RPC = process.env.CHAIN_E2E_RPC || 'https://api.devnet.solana.com';

if (process.env.CHAIN_E2E_DEVNET !== '1') {
  console.log('SKIP  token2022.e2e.test.mjs — set CHAIN_E2E_DEVNET=1 to run the real devnet settlement proof');
  process.exit(0);
}

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-e2e-'));
const KEYS_DIR = path.join(SERVER, 'token', 'keys', 'devnet');
const PAYER_PATH = path.join(KEYS_DIR, 'rewards.keypair.json');

const { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl } = await import('@solana/web3.js');
const spl = await import('@solana/spl-token');

let pass = 0, fail = 0, skipped = null;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sig = (s) => `https://explorer.solana.com/tx/${s}?cluster=devnet`;

process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';
process.env.CHAIN_CLUSTER = 'devnet';
process.env.CHAIN_RPC_URLS = RPC;

const conn = new Connection(RPC, 'confirmed');

// ── payer keypair (gitignored); never print its contents ─────────────────────
fs.mkdirSync(KEYS_DIR, { recursive: true });
let payer;
if (fs.existsSync(PAYER_PATH)) {
  payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(PAYER_PATH, 'utf8'))));
} else {
  payer = Keypair.generate();
  fs.writeFileSync(PAYER_PATH, JSON.stringify([...payer.secretKey]));
  console.log(`  created a throwaway devnet payer at ${PAYER_PATH} (gitignored)`);
}
console.log(`  payer ${payer.publicKey.toBase58()}`);

// ── fund the payer (airdrop; retried, then SKIP honestly) ────────────────────
async function fund(pubkey, lamports) {
  const have = await conn.getBalance(pubkey);
  if (have >= lamports) return have;
  for (let i = 0; i < 5; i++) {
    try {
      const s = await conn.requestAirdrop(pubkey, Math.max(lamports - have, LAMPORTS_PER_SOL));
      await conn.confirmTransaction(s, 'confirmed');
      return await conn.getBalance(pubkey);
    } catch (e) {
      console.log(`  airdrop attempt ${i + 1} failed (${e.message}); retrying`);
      await sleep(2000 * (i + 1));
    }
  }
  return await conn.getBalance(pubkey);
}
const balance = await fund(payer.publicKey, 2 * LAMPORTS_PER_SOL).catch(() => 0);
if (balance < 0.05 * LAMPORTS_PER_SOL) {
  skipped = `devnet airdrop unavailable (payer holds ${balance} lamports)`;
  console.log(`\nSKIP  ${skipped} — the hermetic proof in server/chain/tokenProgram.test.mjs still stands`);
  fs.rmSync(SANDBOX, { recursive: true, force: true });
  process.exit(0);
}
console.log(`  payer balance ${balance / LAMPORTS_PER_SOL} SOL\n`);

// ── create the mints and a payer token balance ───────────────────────────────
async function makeMint(programId, label) {
  const mint = await spl.createMint(conn, payer, payer.publicKey, null, 6, undefined, undefined, programId);
  const ata = await spl.getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey, false, undefined, undefined, programId);
  await spl.mintTo(conn, payer, mint, ata.address, payer, 50_000_000n, [], undefined, programId);
  const info = await conn.getAccountInfo(mint);
  console.log(`  ${label} mint ${mint.toBase58()}  owner=${info.owner.toBase58()}`);
  return mint;
}

async function runStandard({ label, programId, programName }) {
  console.log(`\n── ${label} ──────────────────────────────────────────`);
  const mint = await makeMint(programId, label);
  const dest = Keypair.generate().publicKey;                 // public key only
  const PAY_RAW = 1_234_567;                                 // 1.234567 tokens
  const claimId = `e2e_${label.replace(/[^a-z0-9]/gi, '')}_${Date.now()}`;

  process.env.WAYFARER_MINT = mint.toBase58();
  process.env.PAYOUT_KEYPAIR_PATH = PAYER_PATH;
  process.env.SETTLE_MAX_RAW = String(10_000_000);
  const { settleClaim, clearSettlements } = await import('./settlement.js');
  clearSettlements();

  const res = await settleClaim({ claimId, destination: dest.toBase58(), amountRaw: PAY_RAW });
  console.log(`  settleClaim -> ${JSON.stringify({ ok: res.ok, reason: res.reason, sig: res.signature, tokenProgram: res.tokenProgram })}`);
  ok(`${label}: settleClaim reports ok`, res.ok === true && res.reason === 'settled', JSON.stringify(res.error || res.reason));
  ok(`${label}: it signed against ${programName}`, res.tokenProgram === programId.toBase58(), String(res.tokenProgram));
  if (res.signature) console.log(`  tx ${sig(res.signature)}`);

  // read the destination's ATA back ON-CHAIN, under the mint's program
  const destAta = spl.getAssociatedTokenAddressSync(mint, dest, false, programId);
  let amount = null;
  try { amount = Number((await conn.getTokenAccountBalance(destAta)).value.amount); } catch { amount = null; }
  console.log(`  dest ata ${destAta.toBase58()}  amount=${amount}`);
  ok(`${label}: the destination ATA received EXACTLY ${PAY_RAW} base units`, amount === PAY_RAW, `got ${amount}`);

  // the OTHER program's ATA for the same destination: distinct, and NOT credited
  const otherProgram = programId.equals(spl.TOKEN_2022_PROGRAM_ID) ? spl.TOKEN_PROGRAM_ID : spl.TOKEN_2022_PROGRAM_ID;
  const otherAta = spl.getAssociatedTokenAddressSync(mint, dest, false, otherProgram);
  console.log(`  other-program ata ${otherAta.toBase58()}  (${otherAta.equals(destAta) ? 'SAME' : 'DIFFERENT from the credited one'})`);
  ok(`${label}: the wrong-program ATA is a DIFFERENT address (the old bug target)`, !otherAta.equals(destAta));
  return { mint: mint.toBase58(), signature: res.signature, destAta: destAta.toBase58(), amount };
}

let t22 = null, legacy = null;
try {
  t22 = await runStandard({ label: 'token-2022', programId: spl.TOKEN_2022_PROGRAM_ID, programName: 'Token-2022' });
} catch (e) { ok('token-2022: the run completed', false, e.message); }
try {
  legacy = await runStandard({ label: 'legacy-spl', programId: spl.TOKEN_PROGRAM_ID, programName: 'the legacy SPL Token program' });
} catch (e) { ok('legacy-spl: the run completed', false, e.message); }

console.log('\n==== REAL DEVNET E2E RESULT ====');
if (t22) console.log(`  token-2022  mint=${t22.mint}  ata=${t22.destAta}  amount=${t22.amount}  tx=${t22.signature}`);
if (legacy) console.log(`  legacy-spl  mint=${legacy.mint}  ata=${legacy.destAta}  amount=${legacy.amount}  tx=${legacy.signature}`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
