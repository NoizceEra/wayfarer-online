import path from 'path';
import { fileURLToPath } from 'url';

// All server knobs come from env (documented in server/README.md).
const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
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
  // ALL optional: when unset the bridge degrades honestly (the withdraw handler
  // returns status 'unconfigured' and never deducts the player's tokens).
  SOLANA_NETWORK: process.env.SOLANA_NETWORK || 'devnet',          // devnet | mainnet-beta | custom
  SOLANA_RPC: process.env.SOLANA_RPC || '',                        // RPC endpoint for the bridge
  PROGRAM_ID: process.env.PROGRAM_ID || '',                        // programs/wayfarer_token declare_id!
  MINT_ADDRESS: process.env.MINT_ADDRESS || '',                    // $WAYFARER SPL mint
  TREASURY_ADDRESS: process.env.TREASURY_ADDRESS || '',            // treasury ATA (deposit destination)
  ORACLE_KEYPAIR: process.env.ORACLE_KEYPAIR || '',                // JSON secret-key array for the mint authority signer
  TOKEN_DECIMALS: intRange(process.env.TOKEN_DECIMALS, 0, 9, 6),   // SPL decimals of $WAYFARER
  // Explicit kill switches, default OFF: even with every key above present the
  // bridge neither mints nor credits unless the operator opts in. Redeemable
  // value must stay off until the pre-launch checklist in docs/SECURITY_AUDIT.md
  // is complete (server-authoritative earning, multisig, legal review).
  BRIDGE_WITHDRAW_ENABLED: process.env.BRIDGE_WITHDRAW_ENABLED === '1',
  BRIDGE_DEPOSIT_ENABLED: process.env.BRIDGE_DEPOSIT_ENABLED === '1',
  // Per-wallet daily withdraw cap (whole tokens, net), across every character
  // bound to that wallet. The per-character cap (economy.js) still applies.
  BRIDGE_WALLET_DAILY_CAP: intRange(process.env.BRIDGE_WALLET_DAILY_CAP, 0, 1_000_000, 500),
  // Domain/app string bound into the wallet-link message (anti-phishing): a
  // signature produced for another site's challenge never verifies here.
  WALLET_BIND_DOMAIN: String(process.env.WALLET_BIND_DOMAIN || 'wayfarer-online').slice(0, 64),
};
