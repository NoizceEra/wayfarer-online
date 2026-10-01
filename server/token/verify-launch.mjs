#!/usr/bin/env node
/**
 * verify-launch.mjs — READ-ONLY verification of the Wayfarer token, launched on PUMP.FUN.
 *
 * THE MAINNET PATH IS PUMP.FUN, NOT OUR LAUNCHER. The owner launches the coin on pump.fun
 * and pastes us the contract address; THIS script is the gate that address must pass before
 * a single claim is enabled. It signs nothing, sends nothing, and never reads or prints key
 * material. It reads the mint account off-chain and reports what the CHAIN says.
 *
 * A pump.fun mint is a STANDARD SPL token (Token Program `Tokenkeg…`) with `decimals = 6`
 * and a FIXED supply of 1,000,000,000. It is the NORMAL case here, not an anomaly.
 *
 * HARD checks (a failure is a NO-GO and exits non-zero):
 *   * the account exists and is initialised
 *   * the owning program is the SPL Token Program (a Token-2022 mint is a NO-GO: the
 *     relay's payout path builds legacy-Token instructions)
 *   * decimals === 6 — if this is wrong, EVERY raw amount in the economy is wrong by
 *     orders of magnitude. Fails loudly and specifically.
 *   * on-chain supply === 1,000,000,000 * 10^6 (fixed at creation; never changes)
 * RISK checks (blocking on mainnet by default, reported on devnet):
 *   * mint authority held by something that is NOT the pump.fun `mint-authority` PDA and
 *     not burned (null) -> that holder can still INFLATE supply
 *   * a freeze authority is set -> that holder can freeze token accounts
 *
 * An ungraduated coin still holds a live mint authority (the pump.fun PDA); a graduated one
 * has burned it. Either is fine; anything else is the risk above.
 *
 * Exit: 0 = GO, 1 = NO-GO (a hard failure, or any risk while strict).
 *
 * Usage:
 *   node server/token/verify-launch.mjs --cluster devnet  --mint <MINT> [--rpc <URL>]
 *   node server/token/verify-launch.mjs --cluster mainnet --mint <MINT> \
 *        --rpc https://api.mainnet-beta.solana.com
 *
 * Writes keys/<cluster>/launch-receipt.<cluster>.json (public data only): the artifact the
 * relay and ops read afterwards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getMint, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { writeSecretFile } from './keyfile.mjs';

// pump.fun's fixed parameters (checked against pump docs / pump-public-docs, 2026-10-01).
const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
// Published address of the `['mint-authority']` PDA for the program above. The derivation
// below is self-checked against it, so a wrong program id or seed cannot silently pass.
const PUMP_MINT_AUTHORITY_PUBLISHED = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const PUMP_DECIMALS = 6;
const PUMP_SUPPLY_TOKENS = 1_000_000_000n;

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
const die = (m) => { console.error(`ERROR: ${m}`); process.exit(1); };

const cluster = String(args.cluster || '').trim();
const mintArg = String(args.mint || '').trim();
if (!/^[a-z0-9-]{3,20}$/.test(cluster)) die('--cluster is required (devnet | mainnet)');
if (!mintArg) die('--mint <base58 mint address> is required');
let mintPk;
try { mintPk = new PublicKey(mintArg); } catch { die(`--mint is not a valid base58 address: ${mintArg}`); }

const IS_MAINNET = cluster === 'mainnet' || cluster === 'mainnet-beta';
const expectedDecimals = Number(args.decimals ?? PUMP_DECIMALS);
if (!Number.isInteger(expectedDecimals) || expectedDecimals < 0 || expectedDecimals > 9) {
  die('--decimals must be 0..9');
}
const expectedSupplyTokens = BigInt(String(args.supply || PUMP_SUPPLY_TOKENS.toString()));
const expectedRawSupply = expectedSupplyTokens * (10n ** BigInt(expectedDecimals));
const expectedProgram = TOKEN_PROGRAM_ID.toBase58();
const rpc = String(args.rpc || clusterApiUrl(IS_MAINNET ? 'mainnet-beta' : cluster));
// Risks block the gate on mainnet by default (money); reported only on devnet.
const strict = args.strict ? true : (args['no-strict'] ? false : IS_MAINNET);

// ── pump.fun mint-authority PDA (self-checked) ───────────────────────────────
let pumpPda;
try {
  [pumpPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('mint-authority')], new PublicKey(PUMP_PROGRAM_ID),
  );
} catch (e) {
  die(`could not derive the pump.fun mint-authority PDA: ${e.message}`);
}
if (pumpPda.toBase58() !== PUMP_MINT_AUTHORITY_PUBLISHED) {
  die('internal: the derived pump.fun mint-authority PDA does not match the published '
    + `address (derived ${pumpPda.toBase58()}, expected ${PUMP_MINT_AUTHORITY_PUBLISHED}). `
    + 'Refusing to verify against an assumption I cannot confirm.');
}
const pumpPdaStr = pumpPda.toBase58();

const KEYS_DIR = path.join(args['keys-root'] ? String(args['keys-root']) : KEYS_ROOT, cluster);
const receiptPath = path.join(KEYS_DIR, `launch-receipt.${cluster}.json`);

const classifyAuthority = (addr) => {
  if (addr === null) return 'burned / renounced (null)';
  if (addr === pumpPdaStr) return `pump.fun mint-authority PDA (${PUMP_PROGRAM_ID})`;
  return 'EXTERNAL — not the pump.fun PDA';
};

// ── read the chain ───────────────────────────────────────────────────────────
console.log('── Wayfarer token verification (READ-ONLY, pump.fun path) ──────────');
console.log(`cluster     ${cluster}${IS_MAINNET ? '  (REAL MONEY)' : '  (devnet)'}`);
console.log(`mint        ${mintPk.toBase58()}`);
console.log(`rpc         ${rpc}`);
console.log(`expect      SPL Token program, ${expectedDecimals} decimals, supply ${expectedSupplyTokens}`);
console.log(`pump PDA    ${pumpPdaStr}  (['mint-authority'] on ${PUMP_PROGRAM_ID})`);

const conn = new Connection(rpc, 'confirmed');
let info;
let acct;
try {
  info = await getMint(conn, mintPk);
  acct = await conn.getAccountInfo(mintPk);
} catch (e) {
  console.error(`\nNO-GO  could not read the mint off-chain: ${e.message}`);
  console.error('       A failed read is never a pass — check the address, the cluster and the RPC.');
  process.exit(1);
}
if (!acct) die(`no account exists at ${mintPk.toBase58()} on ${cluster}. Nothing was launched here.`);

const actualProgram = acct.owner.toBase58();
const supplyRaw = info.supply.toString();
const authorityAddr = info.mintAuthority ? info.mintAuthority.toBase58() : null;
const freezeAddr = info.freezeAuthority ? info.freezeAuthority.toBase58() : null;

// ── HARD checks: any failure is a NO-GO ──────────────────────────────────────
const hard = [];
const h = (name, ok, detail) => hard.push({ name, ok, detail });

h('mint account exists and is initialised', info.isInitialized === true, `isInitialized=${info.isInitialized}`);
h('owner program is the SPL Token Program', actualProgram === expectedProgram,
  actualProgram === TOKEN_2022_PROGRAM_ID
    ? `${actualProgram} (Token-2022) — the relay payout path builds LEGACY Token instructions; `
      + 'a Token-2022 mint needs a code change before claims can work'
    : `${actualProgram} vs ${expectedProgram}`);
h('decimals === 6  (raw amounts depend on it)', info.decimals === expectedDecimals,
  `decimals=${info.decimals}: NOT ${expectedDecimals}. Every raw amount in the economy would be `
  + `wrong by 10^${Math.abs(info.decimals - expectedDecimals)}. Do not enable a single claim.`);
h('on-chain supply is the fixed 1,000,000,000', info.supply === expectedRawSupply,
  `${supplyRaw} raw vs ${expectedRawSupply} raw`);

// ── RISK checks: block the mainnet gate when strict ──────────────────────────
const risks = [];
const r = (name, flagged, detail, advice) => risks.push({ name, flagged, detail, advice });

r('mint authority is neither burned nor the pump.fun PDA',
  authorityAddr !== null && authorityAddr !== pumpPdaStr,
  `mintAuthority = ${authorityAddr === null ? 'null' : authorityAddr} (${classifyAuthority(authorityAddr)})`,
  'A non-null, non-platform mint authority can INFLATE the fixed supply at will. Confirm the '
  + 'holder before enabling any value, or do not proceed.');
r('a freeze authority is set',
  freezeAddr !== null,
  `freezeAuthority = ${freezeAddr === null ? 'null' : freezeAddr} (${classifyAuthority(freezeAddr)})`,
  'The holder can freeze token accounts, including the rewards wallet. Expected to be '
  + 'platform-set on pump.fun; confirm it can never be pointed at us.');

// ── report ───────────────────────────────────────────────────────────────────
console.log('\n── on chain (the source of truth) ──────────────────────────────────');
console.log(`program     ${actualProgram}`);
console.log(`decimals    ${info.decimals}`);
console.log(`supply      ${supplyRaw} raw  (= ${Number(supplyRaw) / 10 ** info.decimals} tokens)`);
console.log(`mint auth   ${authorityAddr === null ? 'null (burned)' : authorityAddr}`);
if (authorityAddr !== null) console.log(`            ${classifyAuthority(authorityAddr)}`);
console.log(`freeze auth ${freezeAddr === null ? 'null' : freezeAddr}`);
if (freezeAddr !== null) console.log(`            ${classifyAuthority(freezeAddr)}`);

console.log('\n── HARD checks ─────────────────────────────────────────────────────');
for (const c of hard) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.ok ? '' : `  -> ${c.detail}`}`);
const hardFailed = hard.filter((c) => !c.ok);

console.log('\n── RISK checks ─────────────────────────────────────────────────────');
const riskFlagged = risks.filter((x) => x.flagged);
if (!riskFlagged.length) {
  console.log('  none flagged');
} else {
  for (const x of riskFlagged) {
    console.log(`  RISK  ${x.name}`);
    console.log(`        ${x.detail}`);
    console.log(`        ${x.advice}`);
  }
}

// ── verdict ──────────────────────────────────────────────────────────────────
const blocking = hardFailed.length > 0 || (strict && riskFlagged.length > 0);
const gate = blocking ? 'NO-GO' : 'GO';
console.log(`\n==== ${gate} — ${hard.length - hardFailed.length}/${hard.length} hard checks passed, `
  + `${riskFlagged.length} risk(s) flagged${strict ? ' (strict: risks block)' : ' (reported only)'} ====`);
if (!blocking && riskFlagged.length && !strict) {
  console.log('     Non-blocking here (devnet). On mainnet these risks BLOCK: run with --cluster');
  console.log('     mainnet (strict by default) and clear them before enabling claims.');
}

// ── receipt: public data only ────────────────────────────────────────────────
const receipt = {
  cluster,
  source: 'pump.fun',
  credential: 'on-chain read-back',
  gate,
  verified: !blocking,
  verifiedAt: new Date().toISOString(),
  mint: mintPk.toBase58(),
  programId: actualProgram,
  decimals: info.decimals,
  supplyRaw,
  supplyTokens: (Number(supplyRaw) / 10 ** info.decimals).toString(),
  mintAuthority: authorityAddr,
  freezeAuthority: freezeAddr,
  mintAuthorityIsPumpPda: authorityAddr === pumpPdaStr,
  expected: {
    programId: expectedProgram,
    decimals: expectedDecimals,
    rawSupply: expectedRawSupply.toString(),
    pumpProgramId: PUMP_PROGRAM_ID,
    pumpMintAuthorityPda: pumpPdaStr,
  },
  hardChecks: hard,
  risks,
  notes: [
    'Supply is FIXED at creation and the mint authority is not ours: the relay can NEVER mint.',
    'The funded rewards wallet balance is the hard ceiling on everything the economy can pay.',
    'Metadata (name/symbol/image) is hosted by pump.fun under Metaplex Token Metadata, isMutable=false.',
  ],
  explorer: `https://explorer.solana.com/address/${mintPk.toBase58()}${IS_MAINNET ? '' : '?cluster=devnet'}`,
};
fs.mkdirSync(KEYS_DIR, { recursive: true });
const hardening = writeSecretFile(receiptPath, JSON.stringify(receipt, null, 2));
console.log(`\nreceipt     ${receiptPath}  (${hardening.enforced ? 'restricted to this user' : 'NOT restricted'})`);
console.log(`explorer    ${receipt.explorer}`);
process.exit(blocking ? 1 : 0);
