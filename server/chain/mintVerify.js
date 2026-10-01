/**
 * mintVerify.js — the ON-CHAIN half of the mint configuration.
 *
 * `mintConfig.js` says what the relay was TOLD. This module says what the chain
 * ACTUALLY says, and is the only thing a money path may trust.
 *
 * Three rules, all fail-closed:
 *
 *  1. DECIMALS. The entire economy stores integers in base units and
 *     `server/economy/CONTRACT.md` pins that to 6 decimals. A mint with any other
 *     decimals would mis-price every payout by orders of magnitude, so a mismatch is
 *     a hard refusal on every money path — never a log line. The on-chain value is
 *     the one that counts; the configured default is only an expectation.
 *
 *  2. AUTHORITY. The mint is a **pump.fun token**, not one this project minted. A
 *     pump.fun token's mint authority is a pump.fun program-derived address at
 *     creation and is burned at graduation, so a NON-NULL mint authority is
 *     EXPECTED early on and is NOT an error. Both authorities are reported verbatim.
 *     The genuinely dangerous case — worth surfacing loudly — is a mint authority
 *     held by something that is NOT the configured expected authority (an unknown
 *     key that can inflate the supply). The relay can never mint, so the wallet
 *     balance (§ settlement) is the true hard cap on payouts either way.
 *
 *  3. READ-ONLY. Everything here goes through `rpc.js`. Nothing signs.
 */

import { rpcCall } from './rpc.js';
import { mintConfig, REQUIRED_DECIMALS } from './mintConfig.js';

const envMs = Number(process.env.CHAIN_MINT_TIMEOUT_MS);
const RPC_TIMEOUT_MS = Number.isFinite(envMs) && envMs > 0 ? envMs : 8_000;

export { REQUIRED_DECIMALS };

/**
 * The mint authorities the operator expects to see (e.g. the pump.fun bonding-curve
 * authority before graduation). Comma-separated in CHAIN_EXPECTED_MINT_AUTHORITY.
 * Any authority NOT in this list is flagged as unknown/dangerous.
 */
export function expectedMintAuthorities() {
  return String(process.env.CHAIN_EXPECTED_MINT_AUTHORITY || '')
    .split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Classify a mint authority. Never throws, never calls anything dangerous.
 * @returns {{supplyFixed:boolean, authorityExpected:boolean, authorityNote:string}}
 */
export function authorityAssessment(mintAuthority, expected = expectedMintAuthorities()) {
  if (!mintAuthority) {
    return {
      supplyFixed: true,
      authorityExpected: true,
      authorityNote: 'mint authority renounced — supply is fixed and can never grow',
    };
  }
  if (expected.includes(String(mintAuthority))) {
    return {
      supplyFixed: false,
      authorityExpected: true,
      authorityNote: 'mint authority is the configured expected authority (a pump.fun-style '
        + 'pre-graduation authority): supply is not fixed yet, but only that program can mint',
    };
  }
  return {
    supplyFixed: false,
    authorityExpected: false,
    authorityNote: 'UNKNOWN mint authority: supply is NOT fixed and a key outside this relay can '
      + 'inflate the token. If this is the pump.fun bonding-curve authority, put it in '
      + 'CHAIN_EXPECTED_MINT_AUTHORITY; otherwise investigate before enabling payouts.',
  };
}

/**
 * Read the mint account from the chain. NEVER throws; every failure is `ok:false`
 * with a reason (fail closed).
 *
 * @returns {{ok:boolean, reason?:string, mint?, cluster?, rpc?, decimals?, supply?,
 *            mintAuthority?, freezeAuthority?, isInitialized?}}
 */
export async function readMintOnChain(cfg = mintConfig(), opts = {}) {
  const rpc = opts.rpcCall || rpcCall;
  const url = opts.endpoint || cfg.rpcUrl;
  if (!cfg.mint) return { ok: false, reason: 'WAYFARER_MINT is not set' };
  if (!url) return { ok: false, reason: `no RPC endpoint for cluster "${cfg.cluster}" (set CHAIN_RPC_URLS)` };

  let res;
  try {
    res = await rpc('getAccountInfo', [cfg.mint, { encoding: 'jsonParsed' }], { endpoints: [url], timeoutMs: RPC_TIMEOUT_MS });
  } catch (err) {
    return { ok: false, reason: `mint ${cfg.mint} could not be read on ${cfg.cluster} via ${url} (${err.message})` };
  }

  const parsed = res?.value?.data?.parsed;
  const info = parsed?.info;
  if (!res?.value || !info || parsed?.type !== 'mint') {
    return { ok: false, reason: `mint ${cfg.mint} not found on ${cfg.cluster} (${url})` };
  }

  const decimals = Number(info.decimals);
  if (!Number.isInteger(decimals)) return { ok: false, reason: 'mint account reports no decimals' };

  return {
    ok: true,
    mint: cfg.mint,
    cluster: cfg.cluster,
    rpc: url,
    decimals,
    supply: typeof info.supply === 'string' ? info.supply : String(info.supply ?? ''),
    mintAuthority: info.mintAuthority ?? null,
    freezeAuthority: info.freezeAuthority ?? null,
    isInitialized: info.isInitialized !== false,
    ...authorityAssessment(info.mintAuthority ?? null),
  };
}

/**
 * Non-throwing money-path gate: is this mint usable for payouts right now?
 * `ok:false` means nothing may be signed.
 */
export async function mintUsable(cfg = mintConfig(), opts = {}) {
  const m = await readMintOnChain(cfg, opts);
  if (!m.ok) return { ok: false, reason: m.reason, onChain: m };
  if (m.decimals !== REQUIRED_DECIMALS) {
    const factor = 10 ** Math.abs(m.decimals - REQUIRED_DECIMALS);
    return {
      ok: false,
      onChain: m,
      reason: `mint ${m.mint} has ${m.decimals} decimals on-chain; the economy stores base units `
        + `assuming ${REQUIRED_DECIMALS} (server/economy/CONTRACT.md), so every payout would be `
        + `mis-priced by 10^${Math.abs(m.decimals - REQUIRED_DECIMALS)} (factor ${factor}). Refusing.`,
    };
  }
  return { ok: true, onChain: m };
}

/**
 * Throwing money-path gate. Returns the VERIFIED mint facts (real on-chain decimals,
 * authorities) or throws a clear, actionable error. Used by `settlement.js` before
 * anything is signed.
 */
export async function assertMintUsable(cfg = mintConfig(), opts = {}) {
  const check = await mintUsable(cfg, opts);
  if (!check.ok) throw new Error(`mint not usable for payouts: ${check.reason}`);
  return check.onChain;
}
