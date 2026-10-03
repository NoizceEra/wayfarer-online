import { matchMaker } from 'colyseus';
import { CFG } from './config.js';

// Party Finder: lists OPEN private co-op rooms for browse + quick-join.
// A party room is "open" when it was created with { open: true } (see
// WayfarerRoom.onCreate; the client side is net.host(name, hero, { open })).
// Closed rooms (the default) never appear — co-op stays code-share only.
//
// GET /party-finder -> { ok, rooms, count }   (newest first)
//   rooms[i].code       5-char join code (roomId suffix, uppercase) — the same
//                       code GET /rooms/:code resolves for the normal join flow
//   rooms[i].players    connected players (listing.clients)
//   rooms[i].maxPlayers room cap (PARTY_MAX)
//   rooms[i].hostName   host display name at open time
//   rooms[i].level      host level at open time (default 1)
//   rooms[i].area       host area key at open time (default 'ow')
//   rooms[i].createdAt  ms epoch when the room was opened
// An empty list is 200 { ok: true, rooms: [], count: 0 }; failures are JSON
// (never an HTML error page), matching the /rooms/:code route's error style.

export function routes(app) {
  app.get('/party-finder', async (req, res) => {
    try {
      const all = await matchMaker.query({ name: 'party' });
      const rooms = all
        // locked = full (or disposing): not joinable, keep it out of the list
        .filter((r) => r?.metadata?.open === true && !r.locked)
        .sort((a, b) => (Number(b.metadata?.createdAt) || 0) - (Number(a.metadata?.createdAt) || 0))
        .map((r) => ({
          code: String(r.roomId).slice(-5).toUpperCase(),
          players: Math.max(0, Number(r.clients) || 0),
          maxPlayers: Number(r.maxClients) || CFG.PARTY_MAX,
          hostName: String(r.metadata.hostName || 'Host'),
          level: r.metadata.level || 1,
          area: String(r.metadata.area || 'ow'),
          createdAt: Number(r.metadata.createdAt) || 0,
        }));
      res.json({ ok: true, rooms, count: rooms.length });
    } catch (e) {
      res.status(500).json({ error: 'party_finder_failed' });
    }
  });
}
