import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { CFG } from './config.js';
import { log } from './log.js';
import { publicApiRateLimit } from './httpRateLimit.js';
import { initStore, flushAll, storeStats, stopStore, initSqlite, loadChar, saveChar } from './store.js';
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
let worldBoss = null;
try { worldBoss = await import('./worldBoss.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('worldBoss.js failed to load', { err: e.message });
}
let partyFinder = null;
try { partyFinder = await import('./partyFinder.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('partyFinder.js failed to load', { err: e.message });
}
let referrals = null;
try { referrals = await import('./referrals.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('referrals.js failed to load', { err: e.message });
}
let petDuel = null;
try { petDuel = await import('./petDuel.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('petDuel.js failed to load', { err: e.message });
}
let dungeonMatch = null;
try { dungeonMatch = await import('./dungeonMatch.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('dungeonMatch.js failed to load', { err: e.message });
}
let season = null;
try { season = await import('./season.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('season.js failed to load', { err: e.message });
}
let guilds = null;
try { guilds = await import('./guilds.cjs'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('guilds.cjs failed to load', { err: e.message });
}
let leaderboard = null;
try { leaderboard = await import('./leaderboard.js'); } catch (e) {
  if (e?.code !== 'ERR_MODULE_NOT_FOUND') log.error('leaderboard.js failed to load', { err: e.message });
}

await initSqlite();
initStore();
if (economy) {
  try { economy.init?.(); addRoomModule(economy); log.info('economy module loaded'); } catch (e) { log.error('economy init failed', { err: e.message }); economy = null; }
}
if (worldBoss) {
  try { worldBoss.init?.(); addRoomModule(worldBoss); log.info('world boss module loaded'); } catch (e) { log.error('world boss init failed', { err: e.message }); worldBoss = null; }
}
if (partyFinder) {
  try { partyFinder.init?.(); addRoomModule(partyFinder); log.info('party finder module loaded'); } catch (e) { log.error('party finder init failed', { err: e.message }); partyFinder = null; }
}
if (referrals) {
  try { referrals.init?.(); addRoomModule(referrals); log.info('referrals module loaded'); } catch (e) { log.error('referrals init failed', { err: e.message }); referrals = null; }
}
if (petDuel) {
  try { addRoomModule(petDuel); log.info('pet duel module loaded'); } catch (e) { log.error('pet duel init failed', { err: e.message }); petDuel = null; }
}
if (dungeonMatch) {
  try { dungeonMatch.init?.(); addRoomModule(dungeonMatch); log.info('dungeon match module loaded'); } catch (e) { log.error('dungeon match init failed', { err: e.message }); dungeonMatch = null; }
}
if (season) {
  try { season.init?.(); addRoomModule(season); log.info('season module loaded'); } catch (e) { log.error('season init failed', { err: e.message }); season = null; }
}
if (guilds) {
  try {
    const { GuildService } = guilds;
    const guildService = new GuildService({
      broadcast: (type, payload) => { for (const r of LIVE_ROOMS) { try { r.broadcast(type, payload); } catch {} } },
      sendTo: (sid, type, payload) => {
        for (const r of LIVE_ROOMS) {
          const c = r.clients.find((x) => x.sessionId === sid);
          if (c) { try { c.send(type, payload); } catch {} break; }
        }
      },
      deductGold: (sid, amount) => {
        for (const r of LIVE_ROOMS) {
          const p = r.players.get(sid);
          if (!p || !p.token) continue;
          const rec = loadChar(p.token, p.name);
          if (!rec || (rec.progress.gold || 0) < amount) return false;
          rec.progress.gold -= amount;
          saveChar(p.token, p.name, rec);
          return true;
        }
        return false;
      },
      logger: log,
    });
    addRoomModule({ install: (room) => guildService.bindToRoom(room), onJoin: () => {}, onLeave: () => {} });
    log.info('guilds module loaded');
  } catch (e) { log.error('guilds init failed', { err: e.message }); guilds = null; }
}

const app = express();
app.use(cors({ origin: CFG.CORS_ORIGIN === '*' ? true : CFG.CORS_ORIGIN.split(',') }));
// Set TRUST_PROXY_HOPS to the exact number of trusted reverse proxies in
// front of this service (usually 1 on a single platform edge). Keep Express's
// default untrusted-proxy behavior when unset so clients cannot spoof req.ip.
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
app.set('trust proxy', Number.isInteger(trustProxyHops) && trustProxyHops > 0 && trustProxyHops <= 8 ? trustProxyHops : false);
app.use(publicApiRateLimit);

let shuttingDown = false;
app.get('/health', (req, res) => {
  res.status(shuttingDown ? 503 : 200).json({ ok: !shuttingDown, game: 'wayfarer-online', uptime: Math.round(process.uptime()) });
});
app.get('/stats', (req, res) => {
  const allRooms = [...LIVE_ROOMS];
  // Party room IDs are join credentials; expose only public world shard
  // details and keep aggregate counts for the status pill.
  const rooms = allRooms.filter((r) => r.kind === 'world').map((r) => r.stats());
  const mem = process.memoryUsage();
  res.json({
    ok: true, uptime: Math.round(process.uptime()),
    players: allRooms.reduce((s, r) => s + r.clients.length, 0),
    rooms, privateRooms: allRooms.filter((r) => r.kind === 'party').length,
    world: CFG.WORLD_NAME, maxPlayers: CFG.MAX_PLAYERS,
    counters: { ...STATS }, store: storeStats(), rssMb: Math.round(mem.rss / 1048576),
  });
});
// Resolve a 5-char display code (roomId suffix) to the full roomId (private co-op).
app.get('/rooms/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toUpperCase();
    if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(code)) {
      res.status(400).json({ error: 'invalid_room_code' });
      return;
    }
    const rooms = await matchMaker.query({ name: 'party' });
    const match = rooms.find((r) => String(r.roomId).toUpperCase().endsWith(code))
      || rooms.find((r) => String(r.roomId).toUpperCase() === code);
    if (!match) { res.status(404).json({ error: 'room_not_found' }); return; }
    res.json({ roomId: match.roomId });
  } catch (e) { res.status(500).json({ error: 'lookup_failed' }); }
});
try { social?.routes?.(app); } catch (e) { log.error('social.routes failed', { err: e.message }); }
try { economy?.routes?.(app); } catch (e) { log.error('economy.routes failed', { err: e.message }); }
try { worldBoss?.routes?.(app); } catch (e) { log.error('worldBoss.routes failed', { err: e.message }); }
try { partyFinder?.routes?.(app); } catch (e) { log.error('partyFinder.routes failed', { err: e.message }); }
try { referrals?.routes?.(app); } catch (e) { log.error('referrals.routes failed', { err: e.message }); }
try { dungeonMatch?.routes?.(app); } catch (e) { log.error('dungeonMatch.routes failed', { err: e.message }); }
try { season?.routes?.(app); } catch (e) { log.error('season.routes failed', { err: e.message }); }
try { leaderboard?.routes?.(app); } catch (e) { log.error('leaderboard.routes failed', { err: e.message }); }

const httpServer = http.createServer(app);
const gameServer = new Server({
  greet: false,
  // 3s pings x2 retries: dead sockets are detected in ~6-9s (then the seat is held RECONNECT_SECONDS)
  // Save payloads have independently bounded quest/prog/ext fields that can
  // exceed ws-transport's 4 KiB default when combined. Keep a firm frame cap
  // while allowing the full sanitized save shape through to validateSave().
  transport: new WebSocketTransport({ server: httpServer, maxPayload: 128 * 1024, pingInterval: 3000, pingMaxRetries: 2 }),
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
  stopStore();
  log.info('shutdown complete');
});

await gameServer.listen(CFG.PORT);
// Embervale-1 is always on (never auto-disposes, even when empty).
await matchMaker.createRoom('world', { persistent: true });
log.info(`wayfarer relay on :${CFG.PORT}`, { dataDir: CFG.DATA_DIR, maxPlayers: CFG.MAX_PLAYERS, tickHz: CFG.TICK_HZ, aoi: CFG.AOI_RADIUS });
