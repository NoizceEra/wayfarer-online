#!/usr/bin/env node
/**
 * launch.mjs — create the Wayfarer token (SPL) with its treasury/rewards wallets.
 *
 * Parameterised on purpose: the devnet mint is throwaway, so the name/symbol/supply
 * decision does not have to be made before the plumbing is proven. Re-run with
 * different flags for the real thing.
 *
 * SAFETY RULES (this script touches money for real on mainnet):
 *   * Refuses mainnet unless --i-understand-mainnet is passed explicitly.
 *   * Refuses to overwrite an existing launch unless --force.
 *   * NEVER prints secret key material — receipts contain public keys only.
 *   * Writes keys to a gitignored dir (server/keys/), mode 0600.
 *   * Pre-checks the payer balance and aborts before signing anything if short.
 *
 * Usage (devnet — costs nothing):
 *   node server/token/launch.mjs --authority "D:/path/authority.json"
 * Mainnet (real SOL, real consequences — deliberate extra flag):
 *   node server/token/launch.mjs --authority ... --cluster mainnet-beta --i-understand-mainnet
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
const KEYS_DIR = path.join(HERE, 'keys');

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
  rpc: args.rpc ? String(args.rpc) : null,
  force: Boolean(args.force),
  mainnetOk: Boolean(args['i-understand-mainnet']),
};

const IS_MAINNET = cfg.cluster === 'mainnet-beta' || cfg.cluster === 'mainnet';
const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

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

console.log('── Wayfarer token launch ───────────────────────────────────────────');
console.log(`cluster     ${cfg.cluster}  ${IS_MAINNET ? '(REAL MONEY)' : '(devnet — free)'}`);
console.log(`rpc         ${rpc}`);
console.log(`token       ${cfg.name} (${cfg.symbol}), ${cfg.decimals} decimals`);
console.log(`supply      ${cfg.supply} → ${rawToken} raw units`);
console.log(`authority   ${authority.publicKey.toBase58()}   (from ${path.basename(cfg.authorityPath)})`);
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
const info = await getMint(conn, mint);

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
console.log(`supply held ${info.supply} raw (= ${cfg.supply} ${cfg.symbol})`);
console.log(`explorer    ${receipt.explorer}`);
console.log(`\nwritten to  ${receiptPath}`);
console.log(`keys in     ${KEYS_DIR}  (gitignored; ${describeHardening(hardening)} — back these up, they cannot be recovered)`);
console.log('\nNOT done here: mainnet, liquidity, on-chain name/symbol metadata, the hot-float');
console.log('funding cap, or the earn → claim payout pipeline.');
