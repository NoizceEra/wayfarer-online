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
 *  3. TOKEN PROGRAM. The mint account's on-chain `owner` field is the ONLY authority
 *     for which token standard backs a mint, and it decides the shape of every
 *     payout: an associated token account is derived from (mint, owner, programId),
 *     so a transfer built for the wrong program targets a different, non-existent
 *     address. Two programs are supported, both fail-closed:
 *       * legacy SPL Token  — `Tokenkeg…` (pump.fun's original `create`);
 *       * Token-2022        — `Tokenz…`  (pump.fun's current `create_v2` standard,
 *         decimals 6, native metadata).
 *     Any other owning program is NOT a token program this relay can pay on and is a
 *     hard refusal. `CHAIN_TOKEN_PROGRAM` is an EXPECTED value only: it must agree
 *     with the chain, and a disagreement refuses rather than overriding.
 *
 *  4. READ-ONLY. Everything here goes through `rpc.js`. Nothing signs.
 */

import { rpcCall } from './rpc.js';
import { mintConfig, REQUIRED_DECIMALS } from './mintConfig.js';

const envMs = Number(process.env.CHAIN_MINT_TIMEOUT_MS);
const RPC_TIMEOUT_MS = Number.isFinite(envMs) && envMs > 0 ? envMs : 8_000;

export { REQUIRED_DECIMALS };

// ── the two token programs the relay can pay on ──────────────────────────────
// A Token-2022 ATA is derived from (mint, owner, TOKEN_2022_PROGRAM_ID); a legacy one
// from (mint, owner, TOKEN_PROGRAM_ID). Same mint, same owner, DIFFERENT address — so
// the program is part of the payout's correctness, not a detail. pump.fun's `create_v2`
// (the current standard) mints on Token-2022; the legacy `create` mints on SPL Token.
export const TOKEN_PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM_ID = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const TOKEN_PROGRAMS = Object.freeze({
  [TOKEN_PROGRAM_ID]: { id: TOKEN_PROGRAM_ID, name: 'spl-token', standard: 'legacy' },
  [TOKEN_2022_PROGRAM_ID]: { id: TOKEN_2022_PROGRAM_ID, name: 'token-2022', standard: 'token-2022' },
});

/** Classify an on-chain owning program id. null when it is not a token program we pay on. */
export function tokenProgramInfo(programId) {
  return TOKEN_PROGRAMS[String(programId || '')] || null;
}

/**
 * The configured program EXPECTATION, `CHAIN_TOKEN_PROGRAM` (a program id). It is an
 * escape hatch for an operator who wants the relay to insist on a specific standard —
 * never an override: settlement still reads the mint's owning program from the chain
 * and REFUSES when the two disagree.
 */
export function expectedTokenProgram() {
  const v = String(process.env.CHAIN_TOKEN_PROGRAM || '').trim();
  return v || null;
}

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

  // The mint account's OWNER is the authority for the token program (never config).
  const ownerProgram = res.value.owner != null ? String(res.value.owner) : null;
  const tokenProgram = tokenProgramInfo(ownerProgram);

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
    ownerProgram,                                   // verbatim owning program id
    tokenProgram,                                   // {id,name,standard} | null
    programName: tokenProgram ? tokenProgram.name : null,
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
  // THE TOKEN PROGRAM, FROM THE CHAIN. The ATA for (mint, owner) is derived under the
  // program, so a transfer built for the wrong one targets a different address. Only
  // the two token programs are payable; anything else — and a configured expectation
  // that disagrees with the chain — is fail-closed.
  if (!m.tokenProgram) {
    return {
      ok: false,
      onChain: m,
      reason: `mint ${m.mint} is owned by ${m.ownerProgram || 'an unknown program'}, which is not a token `
        + `program the relay can pay on (legacy SPL Token ${TOKEN_PROGRAM_ID} or Token-2022 `
        + `${TOKEN_2022_PROGRAM_ID}). Refusing to build a transfer against an unrecognised program.`,
    };
  }
  const expected = expectedTokenProgram();
  if (expected && expected !== m.tokenProgram.id) {
    return {
      ok: false,
      onChain: m,
      reason: `CHAIN_TOKEN_PROGRAM=${expected} disagrees with the chain: mint ${m.mint} is owned by `
        + `${m.tokenProgram.id} (${m.tokenProgram.name}). The chain is the authority; refusing to `
        + 'sign against the configured program.',
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
