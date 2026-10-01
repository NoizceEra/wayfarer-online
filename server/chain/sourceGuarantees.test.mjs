/**
 * sourceGuarantees.test.mjs — the structural invariants, asserted on the SOURCE.
 *
 * docs/BLOCKCHAIN_V1.md §3.3 and §6.6: `server/chain/rpc.js` stays dependency-free
 * and read-only, and only the payout path may sign. `server/chain/README.md` records
 * that a test enforces the signing guarantee — this is that test, generalised to every
 * module in the chain layer so a future edit cannot quietly move a signer into a read
 * path.
 *
 * Comments are stripped first: the documentation deliberately NAMES the primitives the
 * read paths refuse to use, and scanning prose for code invariants reports the docs.
 *
 * Run: node server/chain/sourceGuarantees.test.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.dirname(HERE);

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const strip = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/[^\n]*/g, '$1');

// Word boundaries matter: `payoutKeypairPath` is a config field, not a signing key.
const SIGNING = [
  { re: /\bKeypair\b/, label: 'Keypair' },
  { re: /sendTransaction/, label: 'sendTransaction' },
  { re: /sendRawTransaction/, label: 'sendRawTransaction' },
  { re: /signTransaction/, label: 'signTransaction' },
  { re: /partialSign/, label: 'partialSign' },
  { re: /sendAndConfirm/, label: 'sendAndConfirm' },
  { re: /@solana\/web3\.js/, label: '@solana/web3.js' },
  { re: /@solana\/spl-token/, label: '@solana/spl-token' },
];
const signingHits = (src) => SIGNING.filter((s) => s.re.test(strip(src))).map((s) => s.label);

const chainModules = fs.readdirSync(HERE).filter((f) => f.endsWith('.js'));

console.log('\n1. rpc.js is IMPORT-FREE');
{
  const src = fs.readFileSync(path.join(HERE, 'rpc.js'), 'utf8');
  const imports = src.match(/^\s*import\s.+$/gm) || [];
  ok('rpc.js contains no import statement at all', imports.length === 0, imports.join(' | '));
  ok('rpc.js has no dynamic import()', !/import\s*\(/.test(strip(src)));
  ok('the whole file is a single dependency-free module', !/require\s*\(/.test(strip(src)));
}

console.log('\n2. rpc.js is SIGNING-FREE (the §3.3 guarantee)');
{
  const src = fs.readFileSync(path.join(HERE, 'rpc.js'), 'utf8');
  const hits = signingHits(src);
  ok('rpc.js contains no signing primitive', hits.length === 0, hits.join(','));
  const ns = await import('./rpc.js');
  const names = Object.keys(ns);
  ok('no exported rpc function is an action verb',
    !names.some((n) => /^(send|sign|mint|burn|transfer|keypair)/i.test(n)), names.join(','));
  ok('rpc.js exports only reads + constants',
    names.every((n) => /^(rpcCall|get|verify|tokenDelta|endpoints|chainConfigured|constants)/.test(n)), names.join(','));
}

console.log('\n3. settlement.js is the ONE signer, and nothing else in the chain layer signs');
{
  const offenders = [];
  for (const f of chainModules) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    const hits = signingHits(src);
    if (hits.length && f !== 'settlement.js') offenders.push(`${f}: ${hits.join(',')}`);
  }
  ok('no chain module except settlement.js holds a signing primitive', offenders.length === 0, offenders.join('; '));

  const settle = fs.readFileSync(path.join(HERE, 'settlement.js'), 'utf8');
  ok('settlement.js IS the signer (Keypair + spl-token + web3)', signingHits(settle).includes('Keypair')
    && signingHits(settle).includes('@solana/spl-token'));
  ok('and it signs nothing but a transfer (no mint/burn/authority calls)',
    !/\bmintTo\b|createMint|burn\(|setAuthority|approve\(/.test(strip(settle)));
}

console.log('\n4. the identity / wallet / ledger layer never signs either');
{
  for (const f of ['../wallet.js', '../walletStore.js', '../identity.js', '../economy/payouts.js', '../economy/ledger.js', './walletAuth.js', './mintConfig.js', './mintVerify.js', './status.js']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    const hits = signingHits(src);
    ok(`${path.basename(f)} holds no signing primitive`, hits.length === 0, hits.join(','));
  }
}

console.log('\n5. NO PRIVATE KEY MATERIAL is embedded anywhere');
{
  const offenders = [];
  for (const f of chainModules) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    // A Solana keypair file is a JSON array of ~64 small integers. A literal one in
    // source is a leaked secret, and must never exist.
    if (/\[\s*\d{1,3}(\s*,\s*\d{1,3}){40,}\s*\]/.test(src)) offenders.push(f);
  }
  ok('no chain module embeds a keypair array literal', offenders.length === 0, offenders.join(','));

  const secretLogs = [];
  for (const f of ['settlement.js', 'status.js', 'mintConfig.js', 'mintVerify.js', 'rpc.js', 'walletAuth.js']) {
    const src = fs.readFileSync(path.join(HERE, f), 'utf8');
    for (const line of src.split('\n')) {
      if (!/(log\.(info|warn|error|debug)|console\.log)/.test(line)) continue;
      if (/secretKey|secret\b|keypair.*json/i.test(line)) secretLogs.push(`${f}: ${line.trim()}`);
    }
  }
  ok('no chain module logs secret material (a public address is fine)', secretLogs.length === 0, secretLogs.join(' | '));
}

console.log('\n6. the read-only rule is documented where the next editor will look');
{
  const readme = fs.readFileSync(path.join(HERE, 'README.md'), 'utf8');
  ok('chain/README.md records the rpc.js signing guarantee',
    /signing primitive|signing-free|read-only by construction/i.test(readme));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
