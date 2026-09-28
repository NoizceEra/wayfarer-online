import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server, Room } from 'colyseus';
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
  }
  onLeave(client) { this.state.players.delete(client.sessionId); }
});

const PORT = Number(process.env.PORT || 2567);
gameServer.listen(PORT).then(() => console.log(`wayfarer relay on :${PORT}`));
