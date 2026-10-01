import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CFG } from './config.js';
import { log } from './log.js';
import { initStore, flushAll, storeStats, stopStore } from './store.js';
import { WayfarerRoom, LIVE_ROOMS, STATS, setSocialModule, addRoomModule } from './WayfarerRoom.js';

// Wayfarer relay: public persistent world shards + private co-op rooms,
// area-authority enemy sync, AOI/delta replication, file-backed saves.
// Env config: see server/README.md.

// Optional additive social module (chat/party/emote/guild). If server/social.js
// exists it may export install(room), onJoin(room, client, player),
// onLeave(room, client, player) and/or routes(app).
let social = null;
try { social = await import('./social.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('social.js failed to load', { err: e.message });
}
if (social) { setSocialModule(social); log.info('social module loaded'); }
// Optional economy module (trade / market / mail / persisted guilds), same hook
// shape plus init(), flush(), beforeSave(). See server/economy.js.
let economy = null;
try { economy = await import('./economy.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('economy.js failed to load', { err: e.message });
}

// Optional wallet link + Wayfarer Marks module (cosmetic, off-chain; flags in
// server/walletStore.js). Same hook shape as economy plus afterSave().
let wallet = null;
try { wallet = await import('./wallet.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('wallet.js failed to load', { err: e.message });
}

// Identity module (guest-first, link-later): recovery-code / wallet links and
// multi-device `continue`. Optional in the same additive way as social.js — if
// server/identity.js is missing the relay behaves exactly as before.
let identity = null;
try { identity = await import('./identity.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('identity.js failed to load', { err: e.message });
}
if (identity) log.info('identity module loaded');

// Optional token-economy HTTP surface (/econ/*): rates, balance, stake, unstake, claim,
// history + the per-kill WAYFARER credit. Same additive hook shape as social/economy/
// wallet — if server/econ/index.js is missing the relay behaves exactly as before.
// ECON_ENABLED defaults off, so it loads inert: /econ/rates answers, everything that
// moves value refuses. See server/econ/index.js and docs/BLOCKCHAIN_V1.md §5 (WS A).
let econ = null;
try { econ = await import('./econ/index.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('econ/index.js failed to load', { err: e.message });
}

initStore();
if (economy) {
  try { economy.init?.(); addRoomModule(economy); log.info('economy module loaded'); } catch (e) { log.error('economy init failed', { err: e.message }); economy = null; }
}
if (wallet) {
  try { wallet.init?.(); addRoomModule(wallet); log.info('wallet/marks module loaded'); } catch (e) { log.error('wallet init failed', { err: e.message }); wallet = null; }
}
if (econ) {
  try { econ.init?.(); addRoomModule(econ); log.info('econ module loaded'); } catch (e) { log.error('econ init failed', { err: e.message }); econ = null; }
}

const app = express();
app.use(cors({ origin: CFG.CORS_ORIGIN === '*' ? true : CFG.CORS_ORIGIN.split(',') }));

let shuttingDown = false;
app.get('/health', (req, res) => {
  res.status(shuttingDown ? 503 : 200).json({ ok: !shuttingDown, game: 'wayfarer-online', uptime: Math.round(process.uptime()) });
});
app.get('/stats', (req, res) => {
  const rooms = [...LIVE_ROOMS].map((r) => r.stats());
  const mem = process.memoryUsage();
  res.json({
    ok: true, uptime: Math.round(process.uptime()),
    players: rooms.reduce((s, r) => s + r.players, 0),
    rooms, world: CFG.WORLD_NAME, maxPlayers: CFG.MAX_PLAYERS,
    counters: { ...STATS }, store: storeStats(), rssMb: Math.round(mem.rss / 1048576),
  });
});
// Resolve a 5-char display code (roomId suffix) to the full roomId (private co-op).
app.get('/rooms/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    const rooms = await matchMaker.query({ name: 'party' });
    const match = rooms.find((r) => String(r.roomId).toUpperCase().endsWith(code))
      || rooms.find((r) => String(r.roomId).toUpperCase() === code);
    if (!match) { res.status(404).json({ error: 'room_not_found' }); return; }
    res.json({ roomId: match.roomId });
  } catch (e) { res.status(500).json({ error: 'lookup_failed' }); }
});
try { social?.routes?.(app); } catch (e) { log.error('social.routes failed', { err: e.message }); }
try { economy?.routes?.(app); } catch (e) { log.error('economy.routes failed', { err: e.message }); }
try { wallet?.routes?.(app); } catch (e) { log.error('wallet.routes failed', { err: e.message }); }
// JSON identity endpoints: /identity/link, /identity/continue, /identity/status
try { identity?.routes?.(app); } catch (e) { log.error('identity.routes failed', { err: e.message }); }
// JSON token-economy endpoints: /econ/rates, /econ/balance, /econ/stake, /econ/unstake,
// /econ/claim, /econ/history
try { econ?.routes?.(app); } catch (e) { log.error('econ.routes failed', { err: e.message }); }

const httpServer = http.createServer(app);
const gameServer = new Server({
  greet: false,
  // 3s pings x2 retries: dead sockets are detected in ~6-9s (then the seat is held RECONNECT_SECONDS)
  transport: new WebSocketTransport({
    server: httpServer, pingInterval: 3000, pingMaxRetries: 2,
    // Must stay >= the largest payload the validators accept, or colyseus' 4096-byte
    // default silently kills the socket (close 1009) and the save never lands while
    // the client believes it saved. validate.js budgets quest < 24_000 + prog < 12_000
    // + hero < 6_000 = 42_000 characters, so 64 KiB covers that plus framing
    // (docs/audit/validation.md: transport-vs-app-budget).
    maxPayload: 64 * 1024,
  }),
});

gameServer.define('party', WayfarerRoom, { kind: 'party' });
// Public shards: joinOrCreate fills the oldest (lowest-numbered) shard first;
// a full shard locks itself and the matchmaker opens the next one.
gameServer.define('world', WayfarerRoom, { kind: 'world' }).sortBy({ createdAt: 1 });

gameServer.onShutdown(async () => {
  shuttingDown = true;
  log.info('shutdown: flushing store');
  await flushAll();
  try { economy?.stop?.(); } catch (e) { log.error('economy flush failed', { err: e.message }); }
  try { wallet?.stop?.(); } catch (e) { log.error('wallet flush failed', { err: e.message }); }
  // econ.stop() is async: it awaits the ledger's write-behind flush so no balance write is
  // lost, then flushes the emission budget / stake registry (state.js).
  try { await econ?.stop?.(); } catch (e) { log.error('econ flush failed', { err: e.message }); }
  stopStore();
  log.info('shutdown complete');
});

await gameServer.listen(CFG.PORT);
// Embervale-1 is always on (never auto-disposes, even when empty).
await matchMaker.createRoom('world', { persistent: true });
log.info(`wayfarer relay on :${CFG.PORT}`, { dataDir: CFG.DATA_DIR, maxPlayers: CFG.MAX_PLAYERS, tickHz: CFG.TICK_HZ, aoi: CFG.AOI_RADIUS });
