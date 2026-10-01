#!/usr/bin/env node
/**
 * new-wallet.mjs — generate a Solana keypair and write it to the gitignored keys dir.
 *
 * NEVER prints secret material: it prints the PUBLIC address and the file path only.
 * The secret lives in one file with mode 0600 — move it somewhere you control and
 * back it up.
 *
 * Usage: node server/token/new-wallet.mjs --name treasury-vault
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Keypair } from '@solana/web3.js';
import { writeSecretFile, describeHardening } from './keyfile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(HERE, 'keys');

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i].startsWith('--')) {
    const k = process.argv[i].slice(2);
    const v = process.argv[i + 1];
    if (v && !v.startsWith('--')) { args[k] = v; i++; } else args[k] = true;
  }
}
const name = String(args.name || '').trim();
if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(name)) {
  console.error('ERROR: --name must be a short lowercase label (e.g. treasury-vault)');
  process.exit(1);
}

fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 });
const file = path.join(KEYS_DIR, `${name}.keypair.json`);
if (fs.existsSync(file) && !args.force) {
  console.error(`ERROR: ${file} already exists. Pass --force to overwrite (that DESTROYS the old key).`);
  process.exit(1);
}

const kp = Keypair.generate();
const hardening = writeSecretFile(file, JSON.stringify(Array.from(kp.secretKey)));

console.log(`label       ${name}`);
console.log(`address     ${kp.publicKey.toBase58()}`);
console.log(`key file    ${file}`);
console.log(`access      ${describeHardening(hardening)}`);
console.log('');
console.log('The private key was NOT printed and is NOT in any log. To read it yourself:');
console.log(`  type "${file.replace(/\//g, '\\')}"   (that is 64 numbers = the secret key)`);
console.log('Or import it into a wallet: that file is the raw keypair array.');
console.log('Keep it off C:, out of the repo, and backed up: losing it loses the wallet.');
