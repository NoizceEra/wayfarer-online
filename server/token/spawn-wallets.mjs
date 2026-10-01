#!/usr/bin/env node
/**
 * spawn-wallets.mjs — generate Solana keypairs with ZERO dependencies.
 *
 * Why not @solana/web3.js: this must work even when the relay's node_modules are
 * absent or broken (and it must never become a reason the money path cannot be
 * provisioned). Ed25519 + base58 are both small and are implemented here directly
 * against Node's built-in crypto, so the ONLY thing this script needs is node.
 *
 * WHAT IT PRINTS: public addresses and file paths. NEVER secret material.
 * The 64-byte secret key lands in one file, restricted to the current user
 * (icacls on Windows; see keyfile.mjs for why chmod alone is a lie there).
 *
 * Layout: keys/<cluster>/<name>.keypair.json   (keys/ is gitignored)
 *
 * Usage:
 *   node server/token/spawn-wallets.mjs --cluster mainnet --dir <keys-dir> [--force]
 *   node server/token/spawn-wallets.mjs --cluster mainnet --dir <keys-dir> --verify
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeSecretFile, describeHardening } from './keyfile.mjs';

// ── base58 (Bitcoin alphabet, as Solana uses) ────────────────────────────────
const A58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) { out = A58[Number(n % 58n)] + out; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; out = '1' + out; }
  return out;
}
function b58decode(str) {
  let n = 0n;
  for (const ch of str) {
    const i = A58.indexOf(ch);
    if (i < 0) throw new Error(`bad base58 char ${JSON.stringify(ch)}`);
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n % 256n)); n /= 256n; }
  for (const ch of str) { if (ch !== '1') break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

// ── ed25519 keypair from a 32-byte seed ──────────────────────────────────────
// PKCS8 (private) = 302e020100300506032b657004220420 || seed
// SPKI  (public, returned) = 302a300506032b6570032100      || pub32
const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
function keypairFromSeed(seed) {
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed)]), format: 'der', type: 'pkcs8',
  });
  const spki = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' });
  const pub = spki.subarray(spki.length - 32);
  // Solana keypair file = the 64-byte secret key (seed || public)
  const secret64 = Buffer.concat([Buffer.from(seed), pub]);
  return { secret64, pub, address: b58encode(pub) };
}

// ── args ─────────────────────────────────────────────────────────────────────
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const t = process.argv[i];
  if (!t.startsWith('--')) continue;
  const k = t.slice(2);
  const v = process.argv[i + 1];
  if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true;
}
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cluster = String(args.cluster || '').trim();
if (!/^[a-z0-9-]{3,20}$/.test(cluster)) {
  console.error('ERROR: --cluster must be a short lowercase label (devnet | mainnet)');
  process.exit(1);
}
const KEYS_DIR = path.resolve(args.dir
  ? String(args.dir)
  : path.join(HERE, 'keys', cluster));
const CLUSTER_DIR = path.join(KEYS_DIR, cluster);
const NAMES = ['authority', 'treasury', 'rewards', 'hot-float', 'treasury-vault'];

fs.mkdirSync(CLUSTER_DIR, { recursive: true, mode: 0o700 });

function load(kpFile) {
  const arr = JSON.parse(fs.readFileSync(kpFile, 'utf8'));
  if (!Array.isArray(arr) || arr.length !== 64) throw new Error(`${kpFile}: not a 64-byte keypair`);
  const secret64 = Buffer.from(arr);
  const pub = secret64.subarray(32);
  if (!crypto.createPublicKey(crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, secret64.subarray(0, 32)]), format: 'der', type: 'pkcs8',
  })).export({ format: 'der', type: 'spki' }).subarray(-32).equals(pub)) {
    throw new Error(`${kpFile}: public half does not match the seed (corrupt file)`);
  }
  return { file: kpFile, address: b58encode(pub) };
}

console.log(`── spawn wallets ──────────────────────────────────────────────────`);
console.log(`cluster     ${cluster}`);
console.log(`keys dir    ${CLUSTER_DIR}`);
console.log(`mode        ${args.verify ? 'VERIFY (no new keys)' : 'create'}`);
console.log('');

const rows = [];
for (const name of NAMES) {
  const file = path.join(CLUSTER_DIR, `${name}.keypair.json`);
  if (fs.existsSync(file)) {
    const { address } = load(file);
    rows.push({ name, address, state: 'existing' });
    continue;
  }
  if (args.verify) { rows.push({ name, address: '(missing)', state: 'MISSING' }); continue; }
  const seed = crypto.randomBytes(32);
  const { secret64, address } = keypairFromSeed(seed);
  const hardening = writeSecretFile(file, JSON.stringify(Array.from(secret64)));
  rows.push({ name, address, state: `new (${describeHardening(hardening)})` });
}

console.log('label            address                                         state');
for (const r of rows) {
  console.log(`${r.name.padEnd(16)} ${r.address.padEnd(47)} ${r.state}`);
}
console.log('');
console.log('Public addresses only — no secret material was printed or logged.');
console.log('The 64-byte secret key sits in <name>.keypair.json, restricted to this user.');
console.log('Back those files up somewhere you control. Lost key = lost wallet, forever.');
