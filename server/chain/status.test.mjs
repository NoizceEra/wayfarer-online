/**
 * status.test.mjs — GET /chain/status and the mint verification behind it.
 *
 * Runs against a REAL local HTTP JSON-RPC server (node:http) rather than a stubbed
 * module, so the request shape, the jsonParsed mint payload and the fail-closed paths
 * are actually exercised.
 *
 * The two things this suite exists to prove:
 *   1. a NON-NULL mint authority is NOT an error — the mint is a pump.fun token, whose
 *      authority is a program-derived address at creation and is burned at graduation.
 *      Both authorities are reported verbatim and classified; only an authority that is
 *      neither renounced nor the configured expected one is flagged.
 *   2. verification is ON-CHAIN and fails closed — config alone is never "reachable",
 *      and decimals other than the economy's 6 are surfaced as `decimalsOk:false`.
 *
 * Run: node server/chain/status.test.mjs
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-chain-status-'));
process.env.DATA_DIR = SANDBOX;
process.env.LOG_LEVEL = 'error';
process.env.CHAIN_STATUS_TTL_MS = '60000';        // long TTL so the cache is observable
delete process.env.WAYFARER_MINT;
delete process.env.CHAIN_RPC_URLS;
delete process.env.CHAIN_EXPECTED_MINT_AUTHORITY;

const { chainStatus, clearStatusCache, routes, bootNotice } = await import('./status.js');
const { mintConfig } = await import('./mintConfig.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const servers = [];
async function rpcServer(route) {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400).end('{}'); return; }
      calls++;
      const handler = route[msg.method];
      if (!handler) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null })); return; }
      const out = handler(msg.params);
      if (out === 'HTTP500') { res.writeHead(500).end('boom'); return; }
      if (out === 'HANG') return;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return { url: `http://127.0.0.1:${srv.address().port}`, calls: () => calls };
}

const DEVNET_MINT = '8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg';
const PUMP_AUTHORITY = 'PumpFunMintAuthorityPDA11111111111111111111';   // stands in for the pump.fun PDA
const UNKNOWN_AUTHORITY = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

// The exact shape `getAccountInfo (jsonParsed)` returns for an SPL mint.
function mintAccount({ decimals = 6, supply = '1000000000000000', mintAuthority = null, freezeAuthority = null } = {}) {
  return {
    value: {
      owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      executable: false,
      lamports: 1461600,
      data: {
        program: 'spl-token',
        parsed: { type: 'mint', info: { decimals, freezeAuthority, isInitialized: true, mintAuthority, supply } },
        space: 82,
      },
    },
  };
}

console.log('\n1. UNCONFIGURED: a clean refusal, never a lie');
{
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('configured is false', s.configured === false);
  ok('reachable is false', s.reachable === false);
  ok('mint is null (no compiled-in default)', s.mint === null);
  ok('decimals/supply are null, not invented', s.decimals === null && s.supply === null);
  ok('it carries a reason', typeof s.reason === 'string' && /WAYFARER_MINT is not set/.test(s.reason), s.reason);
  ok('checkedAt is a real timestamp', Number.isFinite(s.checkedAt) && s.checkedAt > 0);
  for (const k of ['cluster', 'configured', 'mint', 'reachable', 'decimals', 'supply', 'checkedAt']) {
    ok(`the contract key "${k}" is present`, k in s);
  }
}

console.log('\n2. CONFIGURED + reachable: the mint is verified ON-CHAIN');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ decimals: 6, supply: '1000000000000000', mintAuthority: null }) });
  process.env.WAYFARER_MINT = DEVNET_MINT;
  process.env.CHAIN_RPC_URLS = rpc.url;
  delete process.env.CHAIN_EXPECTED_MINT_AUTHORITY;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('reachable is true only after a real on-chain read', s.reachable === true, JSON.stringify(s.reason));
  ok('it reports the mint it verified', s.mint === DEVNET_MINT);
  ok('it reports the REAL on-chain decimals', s.decimals === 6, String(s.decimals));
  ok('decimalsOk is true for 6 decimals', s.decimalsOk === true);
  ok('it reports the REAL on-chain supply', s.supply === '1000000000000000', String(s.supply));
  ok('the endpoint used is reported (nothing silent)', s.rpc === rpc.url, s.rpc);
  ok('the configuration alone did not make it reachable (an RPC call happened)', rpc.calls() >= 1);
}

console.log('\n3. A PUMP.FUN MINT AUTHORITY IS NOT AN ERROR');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ mintAuthority: PUMP_AUTHORITY, freezeAuthority: null }) });
  process.env.CHAIN_RPC_URLS = rpc.url;                       // new port = new cache key
  process.env.CHAIN_EXPECTED_MINT_AUTHORITY = PUMP_AUTHORITY;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('a non-null mint authority still verifies (reachable true)', s.reachable === true, JSON.stringify(s.reason));
  ok('the mint authority is reported VERBATIM', s.mintAuthority === PUMP_AUTHORITY, String(s.mintAuthority));
  ok('the freeze authority is reported verbatim (null here)', s.freezeAuthority === null);
  ok('supplyFixed is false while an authority can still mint', s.supplyFixed === false);
  ok('the authority is classified as the expected one', /expected authority/.test(s.authorityNote || ''), s.authorityNote);
  ok('nothing calls it a failure', s.decimalsOk === true && s.reachable === true);
}

console.log('\n4. an authority that is neither renounced nor expected is SURFACED (still not a hard failure)');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ mintAuthority: UNKNOWN_AUTHORITY }) });
  process.env.CHAIN_RPC_URLS = rpc.url;
  delete process.env.CHAIN_EXPECTED_MINT_AUTHORITY;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('reachable is still true — the mint EXISTS', s.reachable === true);
  ok('mintAuthority is reported verbatim', s.mintAuthority === UNKNOWN_AUTHORITY);
  ok('supplyFixed is false', s.supplyFixed === false);
  ok('the note flags it as UNKNOWN', /^UNKNOWN/.test(s.authorityNote || ''), s.authorityNote);
}

console.log('\n5. THE DECIMALS HARD RULE is surfaced, not hidden');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ decimals: 9, supply: '123' }) });
  process.env.CHAIN_RPC_URLS = rpc.url;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('the mint still verifies (it exists)', s.reachable === true);
  ok('the REAL decimals are reported (9, not the configured 6)', s.decimals === 9, String(s.decimals));
  ok('decimalsOk is FALSE', s.decimalsOk === false);
  ok('requiredDecimals says what the economy needs (6)', s.requiredDecimals === 6);
}

console.log('\n6. FAIL CLOSED: every failure is a reason, never a lie');
{
  const dead = await rpcServer({ getAccountInfo: () => 'HTTP500' });
  process.env.CHAIN_RPC_URLS = dead.url;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('an RPC error yields reachable:false', s.reachable === false);
  ok('and a reason naming the mint/cluster', /could not be confirmed on-chain/.test(s.reason || ''), s.reason);
  ok('configured is still true (the config IS set)', s.configured === true);
  ok('the mint is still reported', s.mint === DEVNET_MINT);
  ok('decimals/supply stay null (nothing invented)', s.decimals === null && s.supply === null);
}
{
  const absent = await rpcServer({ getAccountInfo: () => ({ value: null }) });
  process.env.CHAIN_RPC_URLS = absent.url;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('a mint that does not exist on the cluster is refused', s.reachable === false);
  ok('the reason says it was not found', /not found/.test(s.reason || ''), s.reason);
}
{
  const garbage = await rpcServer({ getAccountInfo: () => ({ value: { data: { parsed: { type: 'account', info: {} } } } }) });
  process.env.CHAIN_RPC_URLS = garbage.url;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('a non-mint account is refused', s.reachable === false, JSON.stringify(s.reason));
}
{
  const unreachable = 'http://127.0.0.1:1';
  process.env.CHAIN_RPC_URLS = unreachable;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('an unreachable endpoint fails closed', s.reachable === false && typeof s.reason === 'string');
}
{
  // A configured mint with NO endpoint at all for an unknown cluster: fail closed.
  const savedCluster = process.env.CHAIN_CLUSTER;
  process.env.CHAIN_CLUSTER = 'a-cluster-with-no-endpoint';
  delete process.env.CHAIN_RPC_URLS;
  clearStatusCache();
  const s = await chainStatus({ force: true });
  ok('an unknown cluster with no CHAIN_RPC_URLS refuses instead of guessing', s.reachable === false);
  ok('and says so', /no RPC endpoint/.test(s.reason || ''), s.reason);
  process.env.CHAIN_CLUSTER = savedCluster;
}

console.log('\n7. the cache: one probe per configuration, refreshable');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({}) });
  process.env.WAYFARER_MINT = DEVNET_MINT;
  process.env.CHAIN_RPC_URLS = rpc.url;
  clearStatusCache();

  const a = await chainStatus();
  const afterFirst = rpc.calls();
  const b = await chainStatus();
  ok('a second call inside the TTL reuses the cache (no second RPC)', rpc.calls() === afterFirst, `calls=${rpc.calls()}`);
  ok('and returns the identical checkedAt', a.checkedAt === b.checkedAt);
  const c = await chainStatus({ force: true });
  ok('force:true re-probes the chain', rpc.calls() === afterFirst + 1, `calls=${rpc.calls()}`);
  ok('a forced probe returns a fresh object', typeof c.checkedAt === 'number');
}

console.log('\n8. bootNotice() is non-blocking and actually verifies on-chain');
{
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ decimals: 6, supply: '1000000000000000' }) });
  process.env.CHAIN_RPC_URLS = rpc.url;
  clearStatusCache();
  ok('bootNotice() returns immediately (undefined), never a promise', bootNotice() === undefined);
  await new Promise((r) => setTimeout(r, 80));                // let the background verify land
  ok('the background verification did reach the chain', rpc.calls() >= 1, `calls=${rpc.calls()}`);
  const s = await chainStatus();                             // no force: must come from the cache it filled
  ok('and it populated the cache with a verified result', s.reachable === true);
}
{
  delete process.env.WAYFARER_MINT;
  clearStatusCache();
  ok('bootNotice() with no mint does not throw and does not call the chain', bootNotice() === undefined);
}

console.log('\n9. the HTTP surface: routes(app)');
{
  const express = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'))('express');
  const rpc = await rpcServer({ getAccountInfo: () => mintAccount({ decimals: 6, supply: '5000000000000000' }) });
  process.env.WAYFARER_MINT = DEVNET_MINT;
  process.env.CHAIN_RPC_URLS = rpc.url;
  clearStatusCache();

  let threw = false;
  try { routes(null); } catch { threw = true; }
  ok('routes(app) refuses a non-app', threw);

  const app = express();
  routes(app);
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/chain/status`;
  const res = await fetch(url);
  const body = await res.json();
  ok('GET /chain/status answers 200', res.status === 200, String(res.status));
  ok('the body carries the contract shape',
    body.reachable === true && body.decimals === 6 && body.supply === '5000000000000000' && body.mint === DEVNET_MINT,
    JSON.stringify(body));
  ok('the body carries the pump.fun-era authority fields',
    'mintAuthority' in body && 'freezeAuthority' in body && 'supplyFixed' in body && 'decimalsOk' in body && 'authorityNote' in body);
  await new Promise((r) => server.close(r));
}

console.log('\n10. read-only: the status module never signs');
{
  const src = fs.readFileSync(new URL('./status.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1');
  // Word boundaries matter: `payoutKeypairPath` is a config field, not a signing key.
  const forbidden = [/sendTransaction/, /sendRawTransaction/, /signTransaction/, /partialSign/, /\bKeypair\b/, /sendAndConfirm/, /@solana\/web3\.js/];
  const found = forbidden.filter((re) => re.test(code)).map(String);
  ok('status.js contains no signing primitive and no SDK import', found.length === 0, found.join(','));
}

delete process.env.WAYFARER_MINT;
delete process.env.CHAIN_RPC_URLS;
for (const s of servers) s.close();
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
fs.rmSync(SANDBOX, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
