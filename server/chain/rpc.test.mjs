/**
 * rpc.test.mjs — independent test for the grafted chain reads.
 *
 * Runs against a REAL local HTTP JSON-RPC server (node:http), not a stubbed module, so
 * the request shapes, encodings and failover path are actually exercised. The point of
 * the security checks below is the fail-closed rule: an RPC that is down, lying, or
 * malformed must never produce `ok: true`.
 *
 * Run: node server/chain/rpc.test.mjs
 */

import http from 'node:http';

process.env.CHAIN_RPC_URLS = 'http://127.0.0.1:1/placeholder';
const {
  rpcCall, getSolBalance, getTokenAccounts, getSignatureState,
  verifyConfirmedTransfer, tokenDeltaFor, endpoints, chainConfigured, constants,
} = await import('./rpc.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? '  -> ' + detail : ''}`); }
};

const servers = [];
async function startServer(handler) {
  const srv = http.createServer(handler);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  servers.push(srv);
  return `http://127.0.0.1:${srv.address().port}`;
}
function rpcServer(route) {
  return startServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let msg; try { msg = JSON.parse(body); } catch { res.writeHead(400).end('{}'); return; }
      const handler = route[msg.method];
      if (!handler) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: null })); return; }
      const out = handler(msg.params);
      if (out === 'HANG') return;                                  // never respond
      if (out === 'HTTP500') { res.writeHead(500).end('boom'); return; }
      if (out === 'GARBAGE') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"jsonrpc":"2.0"}'); return; }
      if (out && out.__rpcError) { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: out.__rpcError.code, message: out.__rpcError.message } })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: out }));
    });
  });
}

const DEST = 'DestWa11etAddre55Wa11etAddre55Wa11etAddre55';
const OTHER = '0therWa11etAddre550therWa11etAddre550ther';

// A transaction where `destination` gains `lamports`, in the shape getTransaction returns.
function makeTx({ destination = DEST, lamports = 1_000_000_000, err = null, extraDelta = 0 } = {}) {
  const keys = ['SenderWa11et1111111111111111111111111111', destination, 'Sysvar1111111111111111111111111111111111'];
  return {
    slot: 452_000_000,
    blockTime: 1_790_000_000,
    meta: {
      err,
      preBalances: [5_000_000_000, 0, 100],
      postBalances: [5_000_000_000 - lamports - 5000, lamports + extraDelta, 100],
      preTokenBalances: [], postTokenBalances: [],
    },
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  };
}

const goodState = { value: [{ slot: 452_000_000, err: null, confirmationStatus: 'finalized' }] };

console.log('\n1. request shape and failover');
{
  let seen = null;
  const url = await rpcServer({ getBalance: (params) => { seen = params; return { value: 42 }; } });
  const bal = await getSolBalance('So11111111111111111111111111111111111111112', { endpoints: [url] });
  ok('getBalance returns the lamport value', bal === 42, `got ${bal}`);
  ok('the wallet address is sent as the first param', seen?.[0] === 'So11111111111111111111111111111111111111112');
}
{
  const bad = await rpcServer({ getBalance: () => 'HTTP500' });
  const good = await rpcServer({ getBalance: () => ({ value: 7 }) });
  ok('a failing endpoint fails over to the next one', (await getSolBalance('w', { endpoints: [bad, good] })) === 7);
}
{
  const dead = await rpcServer({ getBalance: () => 'GARBAGE' });
  let threw = false;
  try { await getSolBalance('w', { endpoints: [dead] }); } catch { threw = true; }
  ok('a malformed response is an error, not a silent zero', threw);
}
{
  const dead = await rpcServer({ getBalance: () => 'HANG' });
  const t0 = Date.now();
  let threw = false;
  try { await getSolBalance('w', { endpoints: [dead], timeoutMs: 300 }); } catch { threw = true; }
  ok('a hanging endpoint times out instead of stalling forever', threw && Date.now() - t0 < 5000, `${Date.now() - t0}ms`);
}
{
  let threw = false;
  try { await getSolBalance('w', { endpoints: ['http://127.0.0.1:1'] }); } catch { threw = true; }
  ok('an unreachable endpoint errors rather than returning null-as-success', threw);
  ok('an rpc-level error object is surfaced as a failure', await (async () => {
    const u = await rpcServer({ getBalance: () => ({ __rpcError: { code: -32602, message: 'Invalid param' } }) });
    try { await rpcCall('getBalance', ['w'], { endpoints: [u] }); return false; } catch { return true; }
  })());
}

console.log('\n2. balances and token accounts');
{
  const url = await rpcServer({
    getTokenAccountsByOwner: (params) => {
      const programId = params[1].programId;
      if (programId === constants.TOKEN_2022_PROGRAM) {
        return { value: [{ account: { data: { parsed: { info: { mint: 'Mint2022', tokenAmount: { amount: '5', decimals: 0, uiAmountString: '5' } } } } } }] };
      }
      return { value: [
        { account: { data: { parsed: { info: { mint: 'MintA', tokenAmount: { amount: '1000000', decimals: 6, uiAmountString: '1' } } } } } },
        { account: { data: { parsed: { info: { mint: 'MintZero', tokenAmount: { amount: '0', decimals: 6, uiAmountString: '0' } } } } } },
        { account: { data: {} } },
      ] };
    },
  });
  const accts = await getTokenAccounts('owner', { endpoints: [url] });
  ok('classic SPL holdings are returned', accts.some((a) => a.mint === 'MintA'));
  ok('Token-2022 holdings are returned too', accts.some((a) => a.mint === 'Mint2022'));
  ok('zero-balance accounts are filtered out', !accts.some((a) => a.mint === 'MintZero'));
  ok('malformed account entries are skipped, not crashed on', accts.length === 2, `got ${accts.length}`);
}

console.log('\n3. verifyConfirmedTransfer — the fail-closed rule');
const base = { signature: 'Sig1111111111111111111111111111111111111111111111111111111111111', destination: DEST, minLamports: 1_000_000_000 };
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => makeTx() });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('a confirmed, error-free, correctly-paid transfer verifies', v.ok === true, JSON.stringify(v));
  ok('the received amount is reported', v.lamports === 1_000_000_000, `got ${v.lamports}`);
}
{
  const url = await rpcServer({ getSignatureStatuses: () => ({ value: [null] }), getTransaction: () => makeTx() });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('an unknown signature is refused', v.ok === false && /not found/.test(v.reason), JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => ({ value: [{ err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'finalized' }] }), getTransaction: () => makeTx() });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('a failed transaction is refused', v.ok === false && /failed on-chain/.test(v.reason), JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => ({ value: [{ err: null, confirmationStatus: 'processed' }] }), getTransaction: () => makeTx() });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('an UNCONFIRMED transaction is refused', v.ok === false && /not confirmed/.test(v.reason), JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => makeTx({ destination: OTHER }) });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('a transfer to the WRONG destination is refused', v.ok === false && /below the required/.test(v.reason), JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => makeTx({ lamports: 999_999 }) });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('an UNDERPAYMENT is refused', v.ok === false && v.lamports === 999_999, JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => makeTx({ err: { InstructionError: [1, 'Custom'] }, lamports: 5_000_000_000 }) });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('a tx whose meta carries an error is refused even if lamports moved', v.ok === false, JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => 'GARBAGE' });
  const v = await verifyConfirmedTransfer(base, { endpoints: [url] });
  ok('a malformed getTransaction payload is refused, not trusted', v.ok === false, JSON.stringify(v));
}
{
  const v = await verifyConfirmedTransfer(base, { endpoints: ['http://127.0.0.1:1'] });
  ok('an RPC OUTAGE returns ok:false (fail closed, never fail open)', v.ok === false && /rpc unavailable/.test(v.reason), JSON.stringify(v));
}
{
  const url = await rpcServer({ getSignatureStatuses: () => goodState, getTransaction: () => makeTx() });
  const v = await verifyConfirmedTransfer({ ...base, minLamports: 0 }, { endpoints: [url] });
  ok('a non-positive minLamports is refused rather than treated as "any amount"', v.ok === false, JSON.stringify(v));
  const v2 = await verifyConfirmedTransfer({ destination: DEST, minLamports: 1 }, { endpoints: [url] });
  ok('a missing signature is refused', v2.ok === false, JSON.stringify(v2));
}

console.log('\n4. token deltas (for non-SOL transfers)');
{
  const tx = { meta: {
    preTokenBalances: [{ owner: 'o1', mint: 'M1', uiTokenAmount: { uiAmount: 3 } }],
    postTokenBalances: [{ owner: 'o1', mint: 'M1', uiTokenAmount: { uiAmount: 10 } }, { owner: 'o2', mint: 'M1', uiTokenAmount: { uiAmount: 5 } }],
  } };
  ok('the owner delta is computed from pre/post balances', tokenDeltaFor(tx, 'o1', 'M1') === 7, `got ${tokenDeltaFor(tx, 'o1', 'M1')}`);
  ok('another owner is unaffected', tokenDeltaFor(tx, 'o2', 'M1') === 5);
  ok('an unrelated mint yields zero', tokenDeltaFor(tx, 'o1', 'M9') === 0);
  ok('a missing meta yields null', tokenDeltaFor({}, 'o1', 'M1') === null);
}

console.log('\n5. configuration and the read-only guarantee');
{
  const saved = process.env.CHAIN_RPC_URLS;
  process.env.CHAIN_RPC_URLS = 'https://a.example, https://b.example';
  ok('endpoints() splits and trims a comma list', endpoints().length === 2 && endpoints()[1] === 'https://b.example');
  ok('chainConfigured() is true when endpoints exist', chainConfigured());
  delete process.env.CHAIN_RPC_URLS;
  ok('chainConfigured() is false with no endpoints', chainConfigured() === false);
  let threw = false;
  try { await rpcCall('getBalance', ['w']); } catch { threw = true; }
  ok('an unconfigured chain errors instead of pretending', threw);
  process.env.CHAIN_RPC_URLS = saved;
}
{
  const ns = await import('./rpc.js');
  const names = Object.keys(ns);
  // Read-only by construction: no exported action verb (send/sign/mint/burn/transfer as
  // the leading verb) and no signing primitive anywhere in the source.
  ok('no exported function is a signing/moving action',
    !names.some((n) => /^(send|sign|mint|burn|transfer|keypair)/i.test(n)), names.join(','));
  const src = (await import('node:fs')).readFileSync(new URL('./rpc.js', import.meta.url), 'utf8');
  // Strip comments first — the doc comment intentionally NAMES the primitives this module
  // refuses to use, and scanning prose for code invariants reports the documentation.
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
  const forbidden = ['sendTransaction', 'sendRawTransaction', 'signTransaction', 'partialSign', 'Keypair', 'sendAndConfirm'];
  const found = forbidden.filter((f) => code.includes(f));
  ok('the source never signs or submits a transaction', found.length === 0, `found: ${found.join(',')}`);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
for (const s of servers) s.close();
process.exit(fail ? 1 : 0);
