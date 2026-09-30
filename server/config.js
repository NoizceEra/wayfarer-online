import path from 'path';
import { fileURLToPath } from 'url';

// All server knobs come from env (documented in server/README.md).
const here = path.dirname(fileURLToPath(import.meta.url));
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

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
};
