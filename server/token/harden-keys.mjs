#!/usr/bin/env node
/**
 * harden-keys.mjs — apply real access restrictions to every key file, and VERIFY it.
 *
 * Run this after any key generation, and after checking out a repo that contains keys.
 * Reports what was actually enforced per file (never claims more than it verified).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hardenFile, describeHardening } from './keyfile.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(HERE, 'keys');

if (!fs.existsSync(KEYS_DIR)) {
  console.log(`no keys dir at ${KEYS_DIR} — nothing to harden`);
  process.exit(0);
}

const files = fs.readdirSync(KEYS_DIR).filter((f) => f.endsWith('.json'));
console.log(`hardening ${files.length} file(s) in ${KEYS_DIR}\n`);

let bad = 0;
for (const f of files.sort()) {
  const p = path.join(KEYS_DIR, f);
  const res = hardenFile(p);
  if (!res.enforced) bad++;
  console.log(`${res.enforced ? 'OK  ' : 'FAIL'}  ${f.padEnd(30)} ${describeHardening(res)}`);
}

console.log('');
if (bad) {
  console.log(`${bad} file(s) could NOT be restricted — treat those keys as exposed.`);
  process.exit(1);
}
console.log('All key files are restricted to the current user.');
console.log('Storing keys under a project folder is still not custody: move them off C:,');
console.log('keep them out of any repo, and back them up somewhere that survives this disk.');
