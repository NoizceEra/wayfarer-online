/**
 * rpc.js — Solana reads over plain JSON-RPC. Zero dependencies.
 *
 * GRAFTED from FOMMO `services/SolanaService.js`, reduced to the part that earns its
 * place in Wayfarer. What was kept is the DISCIPLINE, which is the genuinely valuable
 * thing FOMMO built:
 *
 *   1. Multi-endpoint failover  (FOMMO: `SOLANA_RPC_URLS` list)
 *   2. verify-first             — never trust a client's claim about the chain; re-ask
 *                                 the chain, and require CONFIRMED + no-error + an
 *                                 exact destination/amount match.
 *   3. fail closed              — an RPC outage must never read as "verified".
 *
 * What was dropped: the token economy (mint/burn/treasury/swap/escrow) and the
 * `@solana/web3.js` dependency. web3.js is a convenience wrapper over these same HTTP
 * calls, so reads need no SDK — which keeps this layer installable in a relay that
 * ships only colyseus/express/cors.
 *
 * Deliberately NOT here: anything that signs. Signing needs a keypair, a keypair needs
 * custody, and custody needs the token economy we just decided against. This module is
 * read-only by construction: no `Keypair`, no `sendTransaction`, no authority.
 */

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

const LAMPORTS_PER_SOL = 1_000_000_000;

/** Endpoints, in failover order. */
export function endpoints() {
  const raw = [process.env.CHAIN_RPC_URLS, process.env.SOLANA_RPC_URLS, process.env.CHAIN_RPC_URL, process.env.SOLANA_RPC_URL]
    .filter(Boolean).join(',');
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Is the chain layer configured at all? Everything no-ops cleanly when it is not. */
export function chainConfigured() {
  return endpoints().length > 0;
}

/**
 * One JSON-RPC call, trying each endpoint until one answers.
 * Throws only when every endpoint failed — callers that make security decisions must
 * treat a throw as "not verified" (see `verifyConfirmedTransfer`).
 */
export async function rpcCall(method, params = [], opts = {}) {
  const urls = opts.endpoints || endpoints();
  if (!urls.length) throw new Error('chain RPC not configured (set CHAIN_RPC_URLS)');
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const errors = [];

  for (const url of urls) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await (opts.fetchImpl || fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      if (body && body.error) throw new Error(`${body.error.code ?? ''} ${body.error.message ?? 'rpc error'}`.trim());
      if (!body || !('result' in body)) throw new Error('malformed response: no result');
      return body.result;
    } catch (err) {
      errors.push(`${url}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`all RPC endpoints failed (${errors.join(' | ')})`);
}

/** SOL balance in lamports, or null when unreadable. */
export async function getSolBalance(walletAddress, opts = {}) {
  const res = await rpcCall('getBalance', [walletAddress], opts);
  return res && typeof res.value === 'number' ? res.value : null;
}

/**
 * Every SPL token (classic + Token-2022) an owner holds, as
 * `[{ mint, amount, decimals, uiAmount }]`. Zero-balance accounts are dropped.
 */
export async function getTokenAccounts(walletAddress, opts = {}) {
  const out = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    let res;
    try {
      res = await rpcCall('getTokenAccountsByOwner', [walletAddress, { programId }, { encoding: 'jsonParsed' }], opts);
    } catch {
      continue;                                   // a program with no accounts must not fail the whole read
    }
    for (const entry of res?.value || []) {
      const info = entry?.account?.data?.parsed?.info;
      if (!info) continue;
      const amount = info.tokenAmount?.amount ?? '0';
      if (amount === '0') continue;
      out.push({
        mint: info.mint,
        amount,
        decimals: info.tokenAmount?.decimals ?? 0,
        uiAmount: info.tokenAmount?.uiAmountString ?? info.tokenAmount?.uiAmount ?? '0',
      });
    }
  }
  return out;
}

/** Confirmation state of a signature, without trusting the caller. */
export async function getSignatureState(signature, opts = {}) {
  const res = await rpcCall('getSignatureStatuses', [[signature], { searchTransactionHistory: true }], opts);
  const s = res?.value?.[0];
  if (!s) return { found: false, confirmed: false, failed: false };
  const status = s.confirmationStatus;
  return {
    found: true,
    confirmed: status === 'confirmed' || status === 'finalized',
    failed: Boolean(s.err),
    error: s.err ?? null,
    slot: s.slot ?? null,
  };
}

/**
 * Verify that `signature` is a CONFIRMED, error-free transaction that actually moved at
 * least `minLamports` to `destination`.
 *
 * Returns `{ ok, reason, lamports? }` and NEVER throws: every failure mode — RPC down,
 * tx missing, tx errored, tx unconfirmed, wrong destination, underpayment, malformed
 * payload — resolves to `ok: false`. That is the whole point. A verification helper that
 * fails open is worse than no helper, because callers stop checking.
 */
export async function verifyConfirmedTransfer({ signature, destination, minLamports }, opts = {}) {
  const deny = (reason, extra = {}) => ({ ok: false, reason, ...extra });
  if (!signature || !destination) return deny('signature and destination are required');
  if (!Number.isFinite(minLamports) || minLamports <= 0) return deny('minLamports must be a positive number');

  let state;
  try { state = await getSignatureState(signature, opts); }
  catch (err) { return deny(`rpc unavailable: ${err.message}`); }
  if (!state.found) return deny('signature not found');
  if (state.failed) return deny('transaction failed on-chain', { error: state.error });
  if (!state.confirmed) return deny('transaction is not confirmed yet');

  let tx;
  try { tx = await rpcCall('getTransaction', [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }], opts); }
  catch (err) { return deny(`rpc unavailable: ${err.message}`); }
  if (!tx || !tx.meta) return deny('transaction details unavailable');
  if (tx.meta.err) return deny('transaction failed on-chain', { error: tx.meta.err });

  const keys = (tx.transaction?.message?.accountKeys || []).map((k) => (typeof k === 'string' ? k : k?.pubkey));
  const pre = tx.meta.preBalances || [];
  const post = tx.meta.postBalances || [];
  if (!keys.length || pre.length !== post.length) return deny('malformed transaction payload');

  let received = 0;
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== destination) continue;
    received += (post[i] ?? 0) - (pre[i] ?? 0);
  }
  if (received < minLamports) {
    return deny(`destination received ${received} lamports, below the required ${minLamports}`, { lamports: received });
  }
  return { ok: true, lamports: received, slot: tx.slot ?? null, blockTime: tx.blockTime ?? null };
}

/**
 * Compute the delta a specific owner saw for a specific mint in a transaction, using
 * the pre/post token balances. Used to verify SPL transfers the same way `verifyConfirmedTransfer`
 * verifies SOL.
 */
export function tokenDeltaFor(tx, owner, mint) {
  if (!tx?.meta) return null;
  const sum = (rows) => (rows || [])
    .filter((r) => r?.owner === owner && r?.mint === mint)
    .reduce((acc, r) => acc + Number(r?.uiTokenAmount?.uiAmount ?? 0), 0);
  return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
}

export const constants = { TOKEN_PROGRAM, TOKEN_2022_PROGRAM, LAMPORTS_PER_SOL };
