import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CFG } from './config.js';
import { log } from './log.js';
import { initStore, flushAll, storeStats, stopStore } from './store.js';
import { WayfarerRoom, LIVE_ROOMS, STATS, setSocialModule } from './WayfarerRoom.js';

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

initStore();

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

const httpServer = http.createServer(app);
const gameServer = new Server({
  greet: false,
  // 3s pings x2 retries: dead sockets are detected in ~6-9s (then the seat is held RECONNECT_SECONDS)
  transport: new WebSocketTransport({ server: httpServer, pingInterval: 3000, pingMaxRetries: 2 }),
});

gameServer.define('party', WayfarerRoom, { kind: 'party' });
// Public shards: joinOrCreate fills the oldest (lowest-numbered) shard first;
// a full shard locks itself and the matchmaker opens the next one.
gameServer.define('world', WayfarerRoom, { kind: 'world' }).sortBy({ createdAt: 1 });

gameServer.onShutdown(async () => {
  shuttingDown = true;
  log.info('shutdown: flushing store');
  await flushAll();
  stopStore();
  log.info('shutdown complete');
});

await gameServer.listen(CFG.PORT);
// Embervale-1 is always on (never auto-disposes, even when empty).
await matchMaker.createRoom('world', { persistent: true });
log.info(`wayfarer relay on :${CFG.PORT}`, { dataDir: CFG.DATA_DIR, maxPlayers: CFG.MAX_PLAYERS, tickHz: CFG.TICK_HZ, aoi: CFG.AOI_RADIUS });
