#!/usr/bin/env node
/**
 * launch.mjs — DEVNET / THROWAWAY ONLY. Create a test SPL token with treasury/rewards
 * wallets so the plumbing (accounts, ATAs, receipts, payouts) can be exercised for free.
 *
 * *** THIS IS NOT THE MAINNET PATH. ***
 * The production Wayfarer token is launched on PUMP.FUN: a standard SPL mint with a FIXED
 * 6 decimals and a FIXED 1,000,000,000 supply whose mint authority is pump.fun's, not ours.
 * This launcher mints a token WE control and exists only to prove devnet flows and to
 * produce this repo's own test mints. Do not use it to create the real token, and never
 * present it as the way the token ships.
 *
 * SAFETY RULES (kept intact even though the path is devnet):
 *   * Refuses mainnet unless --i-understand-mainnet is passed explicitly.
 *   * Refuses to overwrite an existing launch unless --force.
 *   * NEVER prints secret key material — receipts contain public keys only.
 *   * Key material is CLUSTER-SCOPED: keys/<cluster>/ (gitignored, restricted to this
 *     user). A mainnet run can therefore never silently reuse a devnet keypair.
 *   * Pre-checks the payer balance and aborts before signing anything if short.
 *   * After minting, reads the mint BACK off-chain and records what the chain actually
 *     says (decimals/supply/authorities/owning program) in the receipt, not just the ask.
 *
 * Usage (devnet — costs nothing):
 *   node server/token/launch.mjs --authority "D:/path/authority.json" --cluster devnet
 * Mainnet (real SOL, real consequences — deliberate extra flag):
 *   node server/token/launch.mjs --authority ... --cluster mainnet --i-understand-mainnet
 *
 * Key layout:  <script dir>/keys/<cluster>/<name>.keypair.json  (create or reuse, per cluster)
 * Point it at the canonical ops key set instead:  --keys-root D:/ai-studio/wayfarer-online/server/token/keys
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection, Keypair, PublicKey, LAMPORTS_PER_SOL, clusterApiUrl,
} from '@solana/web3.js';
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getMint,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { writeSecretFile, describeHardening } from './keyfile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS_ROOT = path.join(HERE, 'keys');

// ── args ─────────────────────────────────────────────────────────────────────
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
const cfg = {
  cluster: String(args.cluster || 'devnet'),
  name: String(args.name || 'Wayfarer Online'),
  symbol: String(args.symbol || 'WAYFARER'),
  decimals: Number(args.decimals ?? 6),
  supply: BigInt(String(args.supply || '1000000000')),
  authorityPath: args.authority ? String(args.authority) : null,
  keysRoot: args['keys-root'] ? String(args['keys-root']) : null,
  rpc: args.rpc ? String(args.rpc) : null,
  force: Boolean(args.force),
  mainnetOk: Boolean(args['i-understand-mainnet']),
};

const IS_MAINNET = cfg.cluster === 'mainnet-beta' || cfg.cluster === 'mainnet';
const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

// Cluster-scoped key material. Every keypair this script reads or writes lives under
// keys/<cluster>/, so a mainnet run cannot pick up a devnet keypair (or vice versa).
// The label is validated so it can never escape the keys root.
if (!/^[a-z0-9-]{3,20}$/.test(cfg.cluster)) {
  die(`--cluster must be a short lowercase label (e.g. devnet | mainnet), got ${JSON.stringify(cfg.cluster)}`);
}
const KEYS_DIR = path.join(cfg.keysRoot ? cfg.keysRoot : KEYS_ROOT, cfg.cluster);

if (!cfg.authorityPath) die('--authority <keypair.json> is required (the mint authority + fee payer)');
if (!fs.existsSync(cfg.authorityPath)) die(`authority keypair not found: ${cfg.authorityPath}`);
if (!Number.isInteger(cfg.decimals) || cfg.decimals < 0 || cfg.decimals > 9) die('--decimals must be 0..9');
if (cfg.supply <= 0n) die('--supply must be > 0');

// The one gate that matters: real money must never be spent by accident.
if (IS_MAINNET && !cfg.mainnetOk) {
  die('refusing to launch on MAINNET.\n'
    + '       Creating a mint and minting supply spends REAL SOL and is irreversible.\n'
    + '       Re-run with --i-understand-mainnet once you have reviewed:\n'
    + '         * the cluster, the name/symbol/supply, and the authority keypair path\n'
    + '         * where the authority key lives and who else can read it\n'
    + '       NOTE: this script is NOT the Wayfarer mainnet path. The real token is launched\n'
    + '       on pump.fun (fixed supply, we never hold the mint authority) — see\n'
    + '       docs/LAUNCH_RUNBOOK.md before even considering mainnet here.\n'
    + '       (Prove everything on devnet first: it is free and identical in shape.)');
}

const rawToken = cfg.supply * (10n ** BigInt(cfg.decimals));
if (rawToken > (2n ** 64n - 1n)) die('supply * 10^decimals overflows u64');

const rpc = cfg.rpc || clusterApiUrl(IS_MAINNET ? 'mainnet-beta' : 'devnet');
const conn = new Connection(rpc, 'confirmed');
const authority = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(cfg.authorityPath, 'utf8'))));

const receiptPath = path.join(KEYS_DIR, `launch-receipt.${cfg.cluster}.json`);
if (fs.existsSync(receiptPath) && !cfg.force) {
  die(`a ${cfg.cluster} launch already exists (${receiptPath}).\n`
    + '       Refusing to mint a second token by accident. Pass --force to launch another.');
}

console.log('── Wayfarer token launch (DEVNET / THROWAWAY TOOLING) ──────────────');
console.log('This launcher mints a token WE control. The production Wayfarer token is launched');
console.log('on pump.fun — this is NOT the mainnet path (see docs/LAUNCH_RUNBOOK.md).');
console.log(`cluster     ${cfg.cluster}  ${IS_MAINNET ? '(REAL MONEY — see the warning below)' : '(devnet — free)'}`);
console.log(`rpc         ${rpc}`);
console.log(`token       ${cfg.name} (${cfg.symbol}), ${cfg.decimals} decimals`);
console.log(`supply      ${cfg.supply} → ${rawToken} raw units`);
console.log(`authority   ${authority.publicKey.toBase58()}   (from ${path.basename(cfg.authorityPath)})`);
console.log(`keys dir    ${KEYS_DIR}  (cluster-scoped)`);
const bal = await conn.getBalance(authority.publicKey);
console.log(`balance     ${bal / LAMPORTS_PER_SOL} SOL`);

// ── pre-flight: can this payer actually afford it? ───────────────────────────
const MINT_LEN = 82;
const TOKEN_ACCOUNT_LEN = 165;
const mintRent = await conn.getMinimumBalanceForRentExemption(MINT_LEN);
const acctRent = await conn.getMinimumBalanceForRentExemption(TOKEN_ACCOUNT_LEN);
const FEE_HEADROOM = 0.005 * LAMPORTS_PER_SOL;
const needed = mintRent + acctRent * 3 + FEE_HEADROOM;
console.log(`cost        ~${(needed / LAMPORTS_PER_SOL).toFixed(5)} SOL (mint rent + 3 token accounts + fees)`);
if (bal < needed) {
  die(`payer is short: has ${bal / LAMPORTS_PER_SOL} SOL, needs ~${(needed / LAMPORTS_PER_SOL).toFixed(5)}.\n`
    + '       devnet:  solana airdrop 1 ' + authority.publicKey.toBase58() + ' --url devnet\n'
    + '                (the public faucet rate-limits; faucet.solana.com also works)\n'
    + '       mainnet: transfer SOL to the authority wallet first');
}

// ── generate + persist the wallets ───────────────────────────────────────────
fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
function loadOrCreate(name) {
  const p = path.join(KEYS_DIR, `${name}.keypair.json`);
  if (fs.existsSync(p)) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
    console.log(`reuse       ${name.padEnd(10)} ${kp.publicKey.toBase58()}  (existing key)`);
    return kp;
  }
  const kp = Keypair.generate();
  writeSecretFile(p, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`new         ${name.padEnd(10)} ${kp.publicKey.toBase58()}  → ${path.relative(HERE, p)}`);
  return kp;
}

console.log('\n── wallets ─────────────────────────────────────────────────────────');
const mintKp = loadOrCreate('mint');
const treasury = loadOrCreate('treasury');
const rewards = loadOrCreate('rewards');
const hotFloat = loadOrCreate('hot-float');

// ── create the mint ──────────────────────────────────────────────────────────
console.log('\n── on-chain ────────────────────────────────────────────────────────');
process.stdout.write('creating mint… ');
const mint = await createMint(
  conn, authority, authority.publicKey, authority.publicKey,
  cfg.decimals, mintKp, { commitment: 'confirmed' }, TOKEN_PROGRAM_ID,
);
console.log(`done  ${mint.toBase58()}`);

process.stdout.write('treasury token account… ');
const treasuryAta = await getOrCreateAssociatedTokenAccount(
  conn, authority, mint, treasury.publicKey, false, 'confirmed', {}, TOKEN_PROGRAM_ID,
);
console.log(treasuryAta.address.toBase58());

process.stdout.write('rewards token account… ');
const rewardsAta = await getOrCreateAssociatedTokenAccount(
  conn, authority, mint, rewards.publicKey, false, 'confirmed', {}, TOKEN_PROGRAM_ID,
);
console.log(rewardsAta.address.toBase58());

process.stdout.write('hot-float token account… ');
const hotAta = await getOrCreateAssociatedTokenAccount(
  conn, authority, mint, hotFloat.publicKey, false, 'confirmed', {}, TOKEN_PROGRAM_ID,
);
console.log(hotAta.address.toBase58());

process.stdout.write(`minting ${cfg.supply} to treasury… `);
const mintSig = await mintTo(
  conn, authority, mint, treasuryAta.address, authority, rawToken,
  [], { commitment: 'confirmed' }, TOKEN_PROGRAM_ID,
);
console.log(`done  ${mintSig}`);

// ── POST-LAUNCH READ-BACK: record what the CHAIN says, not what we asked for ──
// A receipt assembled only from the request can lie (a stale mint keypair, a different
// cluster, an authority that did not take). Re-read the mint account and store the
// authoritative values; if they disagree with the request, say so on the console and
// mark receipt.verified=false rather than quietly writing a flattering receipt.
const info = await getMint(conn, mint);
const mintAcct = await conn.getAccountInfo(mint);
const onChainAuthority = info.mintAuthority ? info.mintAuthority.toBase58() : null;
const onChainFreeze = info.freezeAuthority ? info.freezeAuthority.toBase58() : null;
const onChain = {
  decimals: info.decimals,
  supply: info.supply.toString(),
  mintAuthority: onChainAuthority,
  freezeAuthority: onChainFreeze,
  ownerProgram: mintAcct ? mintAcct.owner.toBase58() : null,
  isInitialized: info.isInitialized,
  readAt: new Date().toISOString(),
  rpc,
};
const readBackOk = onChain.isInitialized === true
  && onChain.decimals === cfg.decimals
  && onChain.supply === rawToken.toString()
  && onChain.ownerProgram === TOKEN_PROGRAM_ID.toBase58()
  && onChainAuthority === authority.publicKey.toBase58()
  && onChainFreeze === authority.publicKey.toBase58();
console.log('\n── read-back (the chain is the source of truth) ───────────────────');
console.log(`decimals    ${onChain.decimals}`);
console.log(`supply      ${onChain.supply} raw`);
console.log(`mint auth   ${onChain.mintAuthority}`);
console.log(`freeze auth ${onChain.freezeAuthority}`);
console.log(`program     ${onChain.ownerProgram}`);
console.log(`read-back   ${readBackOk ? 'MATCHES the request' : 'MISMATCH — receipt.verified=false, investigate before funding'}`);

// ── receipt: PUBLIC data only, safe to share ─────────────────────────────────
const receipt = {
  cluster: cfg.cluster,
  createdAt: new Date().toISOString(),
  token: { name: cfg.name, symbol: cfg.symbol, decimals: cfg.decimals, supply: cfg.supply.toString(), rawSupply: rawToken.toString() },
  mint: mint.toBase58(),
  programId: TOKEN_PROGRAM_ID.toBase58(),
  authority: authority.publicKey.toBase58(),
  wallets: {
    treasury: { address: treasury.publicKey.toBase58(), tokenAccount: treasuryAta.address.toBase58() },
    rewards: { address: rewards.publicKey.toBase58(), tokenAccount: rewardsAta.address.toBase58() },
    hotFloat: { address: hotFloat.publicKey.toBase58(), tokenAccount: hotAta.address.toBase58() },
  },
  actuallyMinted: info.supply.toString(),
  onChain,
  verified: readBackOk,
  mintTransaction: mintSig,
  explorer: `https://explorer.solana.com/address/${mint.toBase58()}${IS_MAINNET ? '' : '?cluster=devnet'}`,
  keysDir: path.relative(path.dirname(HERE), KEYS_DIR),
};
const hardening = writeSecretFile(receiptPath, JSON.stringify(receipt, null, 2));

console.log('\n── receipt (public keys only) ──────────────────────────────────────');
console.log(`mint        ${receipt.mint}`);
console.log(`treasury    ${receipt.wallets.treasury.address}`);
console.log(`rewards     ${receipt.wallets.rewards.address}`);
console.log(`hot-float   ${receipt.wallets.hotFloat.address}`);
console.log(`supply held ${info.supply} raw (= ${cfg.supply} ${cfg.symbol})  ${readBackOk ? 'read-back OK' : 'read-back MISMATCH'}`);
console.log(`explorer    ${receipt.explorer}`);
console.log(`\nwritten to  ${receiptPath}`);
console.log(`keys in     ${KEYS_DIR}  (gitignored; ${describeHardening(hardening)} — back these up, they cannot be recovered)`);
console.log('\nNOT done here: liquidity, on-chain name/symbol/URI metadata (needs the Metaplex CLI,');
console.log('which is deliberately NOT a dependency — see docs/LAUNCH_RUNBOOK.md §5), the');
console.log('hot-float funding cap, or the earn → claim payout pipeline.');
