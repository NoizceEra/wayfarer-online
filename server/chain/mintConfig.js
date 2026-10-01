/**
 * mintConfig.js — the chain's CONFIGURATION surface. Configuration, not code.
 *
 * The one rule this module exists to enforce: **the mint is configuration, never a
 * default.** An earlier build compiled the devnet mint in as a fallback, which is a
 * mainnet foot-gun — the relay would silently settle against the wrong cluster's
 * token. There is now no compiled-in mint anywhere: a chain-enabled path refuses to
 * run (with a clear, actionable message) until `WAYFARER_MINT` is set.
 *
 * Nothing here touches the network and nothing here signs. It only reads env into a
 * single, coherent shape so every chain path (status, settlement, payouts) agrees on
 * which cluster, which mint and which paying key it is talking about.
 *
 *   WAYFARER_MINT       (required for any chain path)  no default
 *   CHAIN_CLUSTER       devnet | testnet | mainnet-beta            default devnet
 *   CHAIN_DECIMALS      base-unit exponent                          default 6
 *   CHAIN_RPC_URLS      comma-separated reads (failover order)      default: the
 *                       public endpoint for the CONFIGURED cluster
 *   PAYOUT_KEYPAIR_PATH the wallet the relay pays FROM              default:
 *                       server/token/keys/<cluster>/rewards.keypair.json
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { endpoints } from './rpc.js';
import { isSolanaAddress } from './walletAuth.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));   // server/chain
const SERVER_DIR = path.dirname(HERE);                       // server

export const CHAIN_CLUSTERS = ['devnet', 'testnet', 'mainnet-beta'];
export const DEFAULT_CLUSTER = 'devnet';
export const DEFAULT_DECIMALS = 6;

/**
 * The decimals the ENTIRE economy assumes. `server/economy/CONTRACT.md` stores every
 * amount as an integer in base units with 6 decimals; a mint with any other decimals
 * would mis-price every payout by orders of magnitude. The on-chain value is verified
 * by `mintVerify.js` and a mismatch is a hard refusal on every money path.
 */
export const REQUIRED_DECIMALS = 6;

// The canonical public RPC for a cluster — used ONLY when CHAIN_RPC_URLS is unset,
// and ONLY for the cluster that is explicitly configured. It is never a way to reach
// a *different* cluster: the cluster is config, and this is that cluster's endpoint.
const PUBLIC_RPC = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
};

const clean = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const intOr = (v, d) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : d;
};

/** The configured SPL mint, or null. Deliberately has NO compiled-in default. */
export function mintAddress() {
  return clean(process.env.WAYFARER_MINT);
}

/** The configured cluster. Defaults to devnet; never derails to another cluster. */
export function chainCluster() {
  return (clean(process.env.CHAIN_CLUSTER) || DEFAULT_CLUSTER).toLowerCase();
}

export function chainDecimals() {
  return intOr(process.env.CHAIN_DECIMALS, DEFAULT_DECIMALS);
}

/**
 * Path to the wallet the relay pays FROM.
 * Default: the rewards keypair the launch scripts generate for this cluster.
 */
export function payoutKeypairPath(cluster = chainCluster()) {
  const override = clean(process.env.PAYOUT_KEYPAIR_PATH);
  if (override) return path.resolve(override);
  return path.join(SERVER_DIR, 'token', 'keys', cluster, 'rewards.keypair.json');
}

/**
 * An RPC endpoint for the given cluster: the first configured endpoint, else the
 * public endpoint for that same cluster, else null. Never crosses clusters.
 */
export function rpcUrl(cluster = chainCluster()) {
  const configured = endpoints();
  if (configured.length) return configured[0];
  return PUBLIC_RPC[cluster] || null;
}

/** True only when a mint is configured. False when WAYFARER_MINT is absent. */
export function chainConfigured() {
  return mintAddress() !== null;
}

/** The whole chain configuration in one value. */
export function mintConfig() {
  const mint = mintAddress();
  const cluster = chainCluster();
  return {
    mint,                                          // string | null — never a default
    cluster,
    decimals: chainDecimals(),                     // the CONFIGURED expectation
    requiredDecimals: REQUIRED_DECIMALS,           // what the economy truly needs
    payoutKeypairPath: payoutKeypairPath(cluster),
    rpcUrl: rpcUrl(cluster),
    configured: mint !== null,
    knownCluster: CHAIN_CLUSTERS.includes(cluster),
  };
}

/**
 * Assert that a chain-enabled path may run, and return the config when it may.
 * Throws a CLEAR, ACTIONABLE error (never a silent fallback to another cluster).
 */
export function assertChainConfigured() {
  const mint = mintAddress();
  if (mint === null) {
    throw new Error(
      'chain not configured: WAYFARER_MINT is not set. There is deliberately no ' +
      'compiled-in mint — a wrong-cluster default would silently settle against the ' +
      'wrong token. Set WAYFARER_MINT to the SPL mint address, plus CHAIN_CLUSTER ' +
      `(default ${DEFAULT_CLUSTER}) and CHAIN_RPC_URLS, before enabling token claims.`,
    );
  }
  if (!isSolanaAddress(mint)) {
    throw new Error(`WAYFARER_MINT is not a valid base58 Solana address: ${mint}`);
  }
  return mintConfig();
}
