import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Room, matchMaker } from 'colyseus';
import { Schema, type, MapSchema } from '@colyseus/schema';

// Thin relay: holds positions + region + chat; game rules stay in the client
// (host authoritative). Max 8 wayfarers per room (larger than Lanternfall's 4).
class PlayerState extends Schema {
  constructor() {
    super();
    this.name = '';
    this.heroJson = '{}';
    this.x = 0; this.y = 0;
    this.facing = 'down';
    this.hp = 100;
    this.isHost = false;
  }
}
type('string')(PlayerState.prototype, 'name');
type('string')(PlayerState.prototype, 'heroJson');
type('number')(PlayerState.prototype, 'x');
type('number')(PlayerState.prototype, 'y');
type('string')(PlayerState.prototype, 'facing');
type('number')(PlayerState.prototype, 'hp');
type('boolean')(PlayerState.prototype, 'isHost');

class PartyState extends Schema {
  constructor() { super(); this.players = new MapSchema(); this.seq = 0; }
}
type({ map: PlayerState })(PartyState.prototype, 'players');
type('number')(PartyState.prototype, 'seq');

const app = express();
app.use(cors());
app.get('/health', (req, res) => res.json({ ok: true, game: 'wayfarer-online' }));
// Resolve a 5-char display code (roomId suffix) to the full Colyseus roomId
// so guests can join with client.joinById (colyseus.js 0.16 has no
// getAvailableRooms on the client).
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
const httpServer = http.createServer(app);
const gameServer = new Server({ server: httpServer });

gameServer.define('party', class extends Room {
  onCreate() {
    this.maxClients = 8;
    this.setState(new PartyState());
    this.onMessage('input', (client, m) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.x = m.x | 0; p.y = m.y | 0; p.facing = String(m.facing || 'down'); p.hp = m.hp | 0;
      this.broadcast('input', { sessionId: client.sessionId, ...m }, { except: client });
    });
    this.onMessage('hostSnapshot', (client, m) => {
      this.state.seq += 1;
      this.broadcast('hostSnapshot', m, { except: client });
    });
    this.onMessage('result', (client, m) => this.broadcast('result', m, { except: client }));
    this.onMessage('hero', (client, m) => {
      const p = this.state.players.get(client.sessionId);
      if (!p) return;
      p.heroJson = JSON.stringify(m.hero || {});
      this.broadcast('hero', { sessionId: client.sessionId, hero: m.hero });
    });
    this.onMessage('chat', (client, m) => {
      const p = this.state.players.get(client.sessionId);
      this.broadcast('chat', { name: p?.name || '???', text: String(m.text || '').slice(0, 140) });
    });
  }
  onJoin(client, options) {
    const p = new PlayerState();
    p.name = String(options?.name || 'Wayfarer').slice(0, 14);
    p.heroJson = JSON.stringify(options?.hero || {});
    p.isHost = this.clients.length === 1;
    this.state.players.set(client.sessionId, p);
    const hero = options?.hero || {};
    // peer presence via messages (robust across colyseus.js versions)
    this.broadcast('peer-join', { sessionId: client.sessionId, name: p.name, hero }, { except: client });
    for (const other of this.clients) {
      if (other.sessionId === client.sessionId) continue;
      const q = this.state.players.get(other.sessionId);
      let qhero = {};
      try { qhero = JSON.parse(q?.heroJson || '{}'); } catch {}
      client.send('peer-join', { sessionId: other.sessionId, name: q?.name || '???', hero: qhero });
    }
  }
  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.broadcast('peer-leave', { sessionId: client.sessionId });
  }
});

const PORT = Number(process.env.PORT || 2567);
gameServer.listen(PORT).then(() => console.log(`wayfarer relay on :${PORT}`));
