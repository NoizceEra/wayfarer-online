/**
 * status.js — the chain's visible status surface: `GET /chain/status`.
 *
 * Additive `routes(app)` shape, exactly like `server/wallet.js`, so the relay can
 * mount it without knowing anything about it.
 *
 * What it answers (the contract keys first):
 *   { cluster, configured, mint, reachable, decimals, supply, checkedAt }
 * plus, for a pump.fun-era launch:
 *   rpc             the endpoint actually used
 *   mintAuthority   verbatim, as the chain reports it (null = renounced)
 *   freezeAuthority verbatim
 *   supplyFixed     true only when the mint authority is renounced
 *   authorityNote   plain-language explanation of the authority state
 *   decimalsOk      true only when the ON-CHAIN decimals equal REQUIRED_DECIMALS (6)
 *   reason          present only when reachable is false
 *
 * The rules it obeys:
 *   * VERIFY-FIRST — the mint is confirmed ON-CHAIN via `rpc.js` (getAccountInfo,
 *     jsonParsed). Configuration alone is never reported as reachable.
 *   * FAIL CLOSED — every failure path (no mint, no endpoint, RPC down, mint absent,
 *     malformed payload) returns `reachable:false` WITH a reason. It never lies.
 *   * A non-null mint authority is NOT an error. This is a pump.fun token: its mint
 *     authority is a program-derived address at creation and is burned at graduation.
 *     Both authorities are reported verbatim and classified; only an authority that
 *     is neither renounced nor the configured expected one is flagged loudly.
 *   * NEVER BLOCKS BOOT — importing this module does no I/O. The on-chain check
 *     happens lazily on the first request (and, once, in the background at boot) and
 *     is cached.
 *   * READ-ONLY — only `rpc.js` reads are used. Nothing here signs or sends.
 */

import { log } from '../log.js';
import { mintConfig, chainConfigured } from './mintConfig.js';
import { readMintOnChain, REQUIRED_DECIMALS } from './mintVerify.js';

const envMs = Number(process.env.CHAIN_STATUS_TTL_MS);
const CACHE_TTL_MS = Number.isFinite(envMs) && envMs >= 0 ? envMs : 60_000;

let cache = null;      // { key, at, value }
let inflight = null;   // { key, promise } — one probe at a time per configuration

/** The shape every refusing answer shares. */
function blank(now, cfg) {
  return {
    cluster: cfg.cluster,
    configured: cfg.configured,
    mint: cfg.mint,
    reachable: false,
    decimals: null,
    supply: null,
    checkedAt: now,
    rpc: cfg.rpcUrl,
    mintAuthority: null,
    freezeAuthority: null,
    supplyFixed: false,
    decimalsOk: false,
    authorityNote: null,
    requiredDecimals: REQUIRED_DECIMALS,
  };
}

async function probe(now) {
  const cfg = mintConfig();

  if (!cfg.mint) {
    return {
      ...blank(now, cfg),
      reason: 'WAYFARER_MINT is not set — the chain layer has no mint to verify. '
        + 'Set WAYFARER_MINT (and CHAIN_CLUSTER + CHAIN_RPC_URLS) to enable token claims.',
    };
  }

  const m = await readMintOnChain(cfg);
  if (!m.ok) {
    return { ...blank(now, cfg), rpc: cfg.rpcUrl, reason: `mint could not be confirmed on-chain: ${m.reason}` };
  }

  const decimalsOk = m.decimals === REQUIRED_DECIMALS;
  if (!decimalsOk) {
    // Reported, not hidden: this mint cannot back the economy's base units.
    log.warn('chain: mint decimals do not match the economy contract', {
      mint: m.mint, cluster: m.cluster, onChain: m.decimals, required: REQUIRED_DECIMALS,
    });
  }

  return {
    cluster: m.cluster,
    configured: true,
    mint: m.mint,
    reachable: true,
    decimals: m.decimals,                     // the ON-CHAIN value is the source of truth
    supply: m.supply,
    checkedAt: now,
    rpc: m.rpc,
    mintAuthority: m.mintAuthority,           // verbatim; non-null is EXPECTED for pump.fun
    freezeAuthority: m.freezeAuthority,
    supplyFixed: m.supplyFixed === true,
    authorityNote: m.authorityNote,
    decimalsOk,
    requiredDecimals: REQUIRED_DECIMALS,
  };
}

/**
 * The cached status. Pass `{ force: true }` to bypass the cache (tests / ops).
 * Never throws: a probe that throws is turned into a fail-closed answer.
 */
export async function chainStatus({ force = false, now = Date.now() } = {}) {
  const cfg = mintConfig();
  const key = `${cfg.cluster}|${cfg.mint || ''}|${cfg.rpcUrl || ''}`;

  if (!force && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  if (inflight && inflight.key === key) return inflight.promise;

  const promise = (async () => {
    let value;
    try {
      value = await probe(now);
    } catch (err) {
      // probe() is written not to throw; this is the belt to its braces.
      value = { ...blank(now, cfg), reason: `chain status probe failed: ${err.message}` };
    }
    cache = { key, at: Date.now(), value };
    return value;
  })();

  inflight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inflight && inflight.promise === promise) inflight = null;
  }
}

/** Drop the cache (tests). */
export function clearStatusCache() { cache = null; inflight = null; }

/**
 * One clear boot line about chain configuration. Called by the relay at startup so
 * an operator sees, in the log, whether the chain layer is on — never a crash, and
 * never more than one line.
 */
export function bootNotice() {
  const cfg = mintConfig();
  if (!cfg.mint) {
    log.info('chain: WAYFARER_MINT is not set — chain features are DISABLED (claims refuse; '
      + '/chain/status reports configured:false). Set WAYFARER_MINT to enable.');
    return;
  }
  log.info('chain: mint configured — verifying on-chain', {
    cluster: cfg.cluster, mint: cfg.mint, rpc: cfg.rpcUrl,
    expectedDecimals: cfg.decimals, requiredDecimals: REQUIRED_DECIMALS,
    payoutKeypair: cfg.payoutKeypairPath,
  });
  // Background verification: visible, but never a boot dependency.
  Promise.resolve()
    .then(() => chainStatus({ force: true }))
    .then((s) => {
      if (!s.reachable) {
        log.warn('chain: mint NOT verified on-chain', { mint: cfg.mint, cluster: cfg.cluster, reason: s.reason });
        return;
      }
      log.info('chain: mint verified on-chain', {
        mint: s.mint, cluster: s.cluster, decimals: s.decimals, supply: s.supply,
        decimalsOk: s.decimalsOk, mintAuthority: s.mintAuthority, freezeAuthority: s.freezeAuthority,
        supplyFixed: s.supplyFixed,
      });
      if (!s.decimalsOk) {
        log.warn('chain: mint decimals are NOT 6 — every money path will refuse',
          { onChain: s.decimals, required: REQUIRED_DECIMALS });
      }
      if (s.mintAuthority && String(s.authorityNote || '').startsWith('UNKNOWN')) {
        log.warn('chain: mint authority is UNKNOWN', { mintAuthority: s.mintAuthority, note: s.authorityNote });
      }
    })
    .catch((err) => log.warn('chain: background mint verification failed', { err: err.message }));
}

/** Mount `GET /chain/status` on an express app (additive, like wallet.routes). */
export function routes(app) {
  if (!app || typeof app.get !== 'function') {
    throw new Error('chainStatus.routes(app): express app required');
  }
  app.get('/chain/status', (req, res) => {
    const force = String(req.query?.refresh || '') === '1';
    chainStatus({ force })
      .then((status) => res.json(status))
      .catch((err) => {
        log.error('chain status route failed', { err: err.message });
        const cfg = mintConfig();
        res.json({ ...blank(Date.now(), cfg), reason: `chain status failed: ${err.message}` });
      });
  });
  log.info('chain status route ready', { path: '/chain/status', configured: chainConfigured() });
}
