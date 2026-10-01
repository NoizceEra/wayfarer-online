/**
 * mintConfig.test.mjs — the chain configuration surface.
 *
 * The decisive rule is §3.7 of docs/BLOCKCHAIN_V1.md: THE MINT IS CONFIGURATION,
 * NEVER A DEFAULT. A devnet address compiled in as a fallback silently pays the wrong
 * cluster, so these checks assert that (a) no mint literal exists in the source any
 * more and (b) every chain path refuses, with a clear message, until WAYFARER_MINT is
 * set.
 *
 * Run: node server/chain/mintConfig.test.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-mintcfg-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';

const ENV_KEYS = ['WAYFARER_MINT', 'CHAIN_CLUSTER', 'CHAIN_DECIMALS', 'CHAIN_RPC_URLS', 'PAYOUT_KEYPAIR_PATH'];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
const clearEnv = () => { for (const k of ENV_KEYS) delete process.env[k]; };
const restoreEnv = () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
clearEnv();

const { mintConfig, mintAddress, chainCluster, chainDecimals, payoutKeypairPath, rpcUrl,
  chainConfigured, assertChainConfigured, REQUIRED_DECIMALS, DEFAULT_CLUSTER } = await import('./mintConfig.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};
const throwsWith = (name, fn, expect) => {
  try { fn(); fail++; console.log(`  FAIL  ${name}  -> did not throw`); }
  catch (e) {
    if (expect.test(e.message)) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}  -> threw "${e.message}"`); }
  }
};

const DEVNET_MINT = '8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg';   // the address the old fallback hardcoded
const MAINNET_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // any real 32-byte base58 mint

console.log('\n1. NO MINT = NOT CONFIGURED (and no silent default)');
{
  ok('mintAddress() is null with WAYFARER_MINT unset', mintAddress() === null, String(mintAddress()));
  ok('chainConfigured() is FALSE when the mint is absent', chainConfigured() === false);
  const cfg = mintConfig();
  ok('mintConfig().mint is null', cfg.mint === null);
  ok('mintConfig().configured is false', cfg.configured === false);
  ok('the cluster still defaults (config, not a mint)', cfg.cluster === DEFAULT_CLUSTER, cfg.cluster);
  ok('requiredDecimals is the economy contract value (6)', cfg.requiredDecimals === REQUIRED_DECIMALS && REQUIRED_DECIMALS === 6);
  throwsWith('assertChainConfigured() throws', () => assertChainConfigured(), /WAYFARER_MINT is not set/);
}

console.log('\n2. the refusal is CLEAR and ACTIONABLE');
{
  let msg = '';
  try { assertChainConfigured(); } catch (e) { msg = e.message; }
  ok('it says there is deliberately no compiled-in mint', /no compiled-in mint|deliberately/.test(msg), msg);
  ok('it names WAYFARER_MINT', msg.includes('WAYFARER_MINT'));
  ok('it names the cluster knob', msg.includes('CHAIN_CLUSTER'));
  ok('it warns about paying the wrong cluster', /wrong-cluster|wrong cluster/.test(msg), msg);
}

console.log('\n3. a configured mint is surfaced verbatim');
{
  process.env.WAYFARER_MINT = DEVNET_MINT;
  ok('chainConfigured() is true', chainConfigured() === true);
  ok('mintAddress() returns the configured value', mintAddress() === DEVNET_MINT);
  const cfg = assertChainConfigured();
  ok('assertChainConfigured() returns the config', cfg.mint === DEVNET_MINT && cfg.configured === true);
  ok('decimals default to 6', cfg.decimals === 6, String(cfg.decimals));
  ok('cluster defaults to devnet', cfg.cluster === 'devnet');
  ok('the mint is NOT echoed anywhere as a secret (it is public, and identical)', cfg.mint === DEVNET_MINT);
}

console.log('\n4. a malformed mint is refused, not silently used');
{
  process.env.WAYFARER_MINT = 'not-a-solana-address';
  throwsWith('a non-base58 mint fails assertChainConfigured', () => assertChainConfigured(), /not a valid base58/);
  process.env.WAYFARER_MINT = MAINNET_MINT;
  ok('a real mint passes', assertChainConfigured().mint === MAINNET_MINT);
}

console.log('\n5. cluster + decimals + payout key are configuration');
{
  process.env.WAYFARER_MINT = DEVNET_MINT;
  process.env.CHAIN_CLUSTER = 'mainnet-beta';
  ok('chainCluster() reflects CHAIN_CLUSTER', chainCluster() === 'mainnet-beta');
  ok('the default payout key follows the cluster',
    /token[\\/]keys[\\/]mainnet-beta[\\/]rewards\.keypair\.json$/.test(payoutKeypairPath()), payoutKeypairPath());
  process.env.CHAIN_CLUSTER = 'devnet';
  ok('and follows it back to devnet',
    /token[\\/]keys[\\/]devnet[\\/]rewards\.keypair\.json$/.test(payoutKeypairPath()), payoutKeypairPath());

  process.env.PAYOUT_KEYPAIR_PATH = 'D:/some/where/custom.keypair.json';
  ok('PAYOUT_KEYPAIR_PATH overrides and is resolved to an absolute path',
    path.isAbsolute(payoutKeypairPath()) && payoutKeypairPath().replace(/\\/g, '/').endsWith('D:/some/where/custom.keypair.json'),
    payoutKeypairPath());
  delete process.env.PAYOUT_KEYPAIR_PATH;

  process.env.CHAIN_DECIMALS = '9';
  ok('CHAIN_DECIMALS is honoured', chainDecimals() === 9, String(chainDecimals()));
  process.env.CHAIN_DECIMALS = 'nonsense';
  ok('an invalid CHAIN_DECIMALS falls back to 6 rather than NaN', chainDecimals() === 6);
  delete process.env.CHAIN_DECIMALS;
  ok('requiredDecimals stays 6 regardless of the configured expectation',
    mintConfig().requiredDecimals === 6 && mintConfig().decimals === 6);
}

console.log('\n6. the RPC endpoint never crosses clusters');
{
  delete process.env.CHAIN_RPC_URLS;
  process.env.CHAIN_CLUSTER = 'devnet';
  const dev = rpcUrl();
  process.env.CHAIN_CLUSTER = 'mainnet-beta';
  const main = rpcUrl();
  ok('an unset CHAIN_RPC_URLS resolves to the CONFIGURED cluster public endpoint',
    dev === 'https://api.devnet.solana.com' && main === 'https://api.mainnet-beta.solana.com', `${dev} / ${main}`);
  ok('the two clusters are not the same endpoint (no devnet fallback on mainnet)', dev !== main);
  process.env.CHAIN_CLUSTER = 'devnet';
  process.env.CHAIN_RPC_URLS = 'https://a.example, https://b.example';
  ok('a configured list wins, in failover order', rpcUrl() === 'https://a.example', rpcUrl());
  ok('mintConfig() reports the endpoint it will use', mintConfig().rpcUrl === 'https://a.example');
  process.env.CHAIN_RPC_URLS = 'https://only.example';
  process.env.CHAIN_CLUSTER = 'some-unknown-cluster';
  ok('an UNKNOWN cluster has no endpoint at all (fail closed, no cross-cluster fallback)',
    rpcUrl() === 'https://only.example' && mintConfig().knownCluster === false);
  delete process.env.CHAIN_RPC_URLS;
  ok('an unknown cluster with no CHAIN_RPC_URLS yields null, never a devnet endpoint',
    rpcUrl() === null, String(rpcUrl()));
  process.env.CHAIN_CLUSTER = 'devnet';
}

console.log('\n7. NO COMPILED-IN MINT ANYWHERE IN THE SOURCE');
{
  const files = ['mintConfig.js', 'mintVerify.js', 'status.js', 'settlement.js', 'rpc.js', 'walletAuth.js'];
  const hits = [];
  for (const f of files) {
    const src = fs.readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
    if (src.includes(DEVNET_MINT)) hits.push(`${f}: devnet mint literal`);
    if (src.includes(MAINNET_MINT)) hits.push(`${f}: mainnet mint literal`);
  }
  const payouts = fs.readFileSync(new URL('../economy/payouts.js', import.meta.url), 'utf8');
  if (payouts.includes(DEVNET_MINT)) hits.push('economy/payouts.js: devnet mint literal');
  ok('no chain module (or payouts) contains a hardcoded mint address', hits.length === 0, hits.join('; '));
  const cfgSrc = fs.readFileSync(new URL('./mintConfig.js', import.meta.url), 'utf8');
  ok('mintConfig.js reads WAYFARER_MINT from the environment',
    cfgSrc.includes('process.env.WAYFARER_MINT'));
}

restoreEnv();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
