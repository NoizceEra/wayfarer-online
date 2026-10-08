import path from 'path';
import { fileURLToPath } from 'url';

// All server knobs come from env (documented in server/README.md).
const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const bool = (v, d = false) => v === undefined ? d : /^(1|true|yes|on)$/i.test(String(v).trim());
const intRange = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export const CFG = {
  PORT: num(process.env.PORT, 2567),
  DATA_DIR: path.resolve(process.env.DATA_DIR || path.join(here, 'data')),
  MAX_PLAYERS: num(process.env.MAX_PLAYERS, 40),       // per public world shard
  PARTY_MAX: num(process.env.PARTY_MAX, 8),            // per private co-op room
  WORLD_NAME: process.env.WORLD_NAME || 'Embervale',   // shards: Embervale-1, Embervale-2, ...
  TICK_HZ: num(process.env.TICK_HZ, 15),               // replication rate to clients
  AOI_RADIUS: num(process.env.AOI_RADIUS, 400),        // px: full-rate players/enemies inside this
  RECONNECT_SECONDS: num(process.env.RECONNECT_SECONDS, 30),
  SAVE_FLUSH_MS: num(process.env.SAVE_FLUSH_MS, 5000),  // store write-behind interval
  MAX_SPEED: num(process.env.MAX_SPEED, 260),          // px/s ceiling for movement validation
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',          // debug | info | warn | error
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
  // ─── Solana token bridge (in-game Wayfarer Tokens <-> devnet $WAYFARER) ───
  // Bridge settings are optional; withdrawals also require the explicit
  // ENABLE_TOKEN_WITHDRAWALS operator switch below.
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'devnet',          // devnet | mainnet-beta | custom
  SOLANA_RPC: process.env.SOLANA_RPC || '',                        // RPC endpoint for the bridge
  PROGRAM_ID: process.env.PROGRAM_ID || '',                        // programs/wayfarer_token declare_id!
  MINT_ADDRESS: process.env.MINT_ADDRESS || '',                    // $WAYFARER SPL mint
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || '',            // treasury ATA (deposit destination)
  ORACLE_KEYPAIR: process.env.ORACLE_KEYPAIR || '',                // JSON secret-key array for the mint authority signer
  // External token payouts stay disabled until issuance and settlement use a
  // durable, server-authoritative reward ledger.
  ENABLE_TOKEN_WITHDRAWALS: bool(process.env.ENABLE_TOKEN_WITHDRAWALS, false),
  TOKEN_DECIMALS: intRange(process.env.TOKEN_DECIMALS, 0, 9, 6),   // SPL decimals of $WAYFARER
  // ─── agent entitlement gate (server/agentGate.cjs) ───
  // A wallet-bound player who HOLDS >= AGENT_MIN_USD of $WAYFARER gets an
  // autonomous agent. The gate is OFF unless an operator sets a price: with no
  // AGENT_TOKEN_PRICE_USD the gate reports 'unconfigured' and NEVER invents a
  // market value. Requires SOLANA_RPC + MINT_ADDRESS + AGENT_TOKEN_PRICE_USD.
  AGENT_MIN_USD: num(process.env.AGENT_MIN_USD, 50),               // USD a bound wallet must hold (default $50)
  AGENT_TOKEN_PRICE_USD: num(process.env.AGENT_TOKEN_PRICE_USD, 0), // operator-set $WAYFARER price in USD; 0 = unconfigured
};
