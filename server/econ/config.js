// server/econ/config.js — the token-economy surface's env surface.
//
// Everything here is read from process.env ON EVERY CALL (never cached at import), for
// two reasons: (1) tests can flip a flag mid-process and exercise both gates against the
// same boot, and (2) a relay operator can see the truth without reasoning about import
// order. The flags and their defaults are frozen by docs/BLOCKCHAIN_V1.md §4:
//
//   ECON_ENABLED      default OFF   — gates anything that MOVES value (stake / unstake /
//                                     claim / per-kill WAYFARER credit). Read endpoints
//                                     (rates / balance / history) always answer.
//   ECON_IDLE_GOLD    default OFF   — the owner's rule (rewards.js header): rewards are
//                                     PER-KILL ONLY. server/economy/idle.js stays in the
//                                     tree and tested, but nothing wires idle accrual, and
//                                     this module never calls idle.accrualFor().
//   PAYOUTS_ENABLED   default OFF   — payouts.js dry-runs unless this is exactly 'true'.
//                                     This module only READS it (to report the state).
//   WAYFARER_MINT     REQUIRED for the chain path. No compiled-in default (§3.7: a devnet
//                                     address baked in as a fallback silently pays the
//                                     wrong cluster).
//   CHAIN_RPC_URLS    REQUIRED for the chain path — without it chainConfigured() is false.
//
// `configured` here means exactly "the chain path can be built": a mint address AND at
// least one RPC endpoint. The ledger-only path (balance / stake / unstake) needs
// ECON_ENABLED but no chain, because it touches no RPC — see http.js.

import { endpoints } from '../chain/rpc.js';

const flag = (name, def = false) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return /^(1|true|on|yes)$/i.test(v);
};
const num = (name, def) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

/** The public mint, or null. Never a fallback: an absent mint must read as absent. */
export function wayfarerMint() {
  const s = String(process.env.WAYFARER_MINT || '').trim();
  return s || null;
}

export function cluster() {
  const c = String(process.env.CHAIN_CLUSTER || 'devnet').trim();
  return c === 'mainnet-beta' ? 'mainnet-beta' : 'devnet';
}

/** RPC endpoints configured? (CHAIN_RPC_URLS / SOLANA_RPC_URLS / *_RPC_URL, see chain/rpc.js) */
export function chainConfigured() {
  try { return endpoints().length > 0; } catch { return false; }
}

export function econEnabled() { return flag('ECON_ENABLED', false); }
export function idleGoldEnabled() { return flag('ECON_IDLE_GOLD', false); }
export function payoutsEnabled() { return process.env.PAYOUTS_ENABLED === 'true'; }
export function minClaimRaw() { return num('MIN_CLAIM_RAW', 1_000_000); }

/** Can the chain path be built at all? Missing pieces are named, never guessed. */
export function missingChainConfig() {
  const missing = [];
  if (!wayfarerMint()) missing.push('WAYFARER_MINT');
  if (!chainConfigured()) missing.push('CHAIN_RPC_URLS');
  return missing;
}
export function chainReady() { return missingChainConfig().length === 0; }

/** Rate limits, same token-bucket shape as server/wallet.js. */
export function limits() {
  return {
    ip: [num('ECON_IP_RATE', 1), num('ECON_IP_BURST', 30)],          // any /econ/* route, per IP
    action: [num('ECON_ACTION_RATE', 0.5), num('ECON_ACTION_BURST', 10)], // value-movers, per device
  };
}

/** The flag block echoed in every response so a client never has to guess. */
export function flagsPublic() {
  return {
    enabled: econEnabled(),
    configured: chainReady(),
    missing: missingChainConfig(),
    idleGold: idleGoldEnabled(),
    payoutsEnabled: payoutsEnabled(),
    cluster: cluster(),
    mint: wayfarerMint(),          // public information (a mint address, not a secret)
    minClaimRaw: minClaimRaw(),
  };
}
