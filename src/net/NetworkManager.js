import { Client } from 'colyseus.js';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';

// Thin host-relay client. Solo works with no connection; Host/Join add sync.
// Host is authoritative for enemies/flags; guests keep own XP/gold.
export class NetworkManager {
  constructor() {
    this.client = null; this.room = null;
    this.isHost = false; this.code = null;
    this.sessionId = null;
  }
  get connected() { return !!this.room; }
  async host(name, hero) {
    this.client = new Client(CONFIG.serverUrl.replace(/^ws/, 'http'));
    this.room = await this.client.create('party', { name, hero });
    const roomId = this.room.roomId; // colyseus.js 0.16: roomId (not .id)
    this.isHost = true; this.code = roomId.slice(-5).toUpperCase();
    this.sessionId = this.room.sessionId;
    this.attach();
    bus.emit(Events.NET_CONNECTED, { code: roomId, isHost: true });
    return roomId;
  }
  async join(code, name, hero) {
    this.client = new Client(CONFIG.serverUrl.replace(/^ws/, 'http'));
    const rooms = await this.client.getAvailableRooms('party');
    const match = rooms.find((r) => r.roomId.toUpperCase().endsWith(code.toUpperCase())) || rooms[0];
    if (!match) throw new Error('No rooms found — ask host for a fresh code.');
    this.room = await this.client.joinById(match.roomId, { name, hero });
    this.isHost = false; this.code = code.toUpperCase();
    this.sessionId = this.room.sessionId;
    this.attach();
    bus.emit(Events.NET_CONNECTED, { code: match.roomId, isHost: false });
  }
  attach() {
    this.room.state.players.onAdd((p, key) => {
      if (key !== this.sessionId) bus.emit(Events.NET_PLAYER_JOINED, { id: key, name: p.name, hero: safeHero(p.heroJson) });
    });
    this.room.state.players.onRemove((p, key) => bus.emit(Events.NET_PLAYER_LEFT, { id: key }));
    this.room.onMessage('input', (m) => bus.emit(Events.NET_STATE, { kind: 'input', ...m }));
    this.room.onMessage('hostSnapshot', (m) => bus.emit(Events.NET_STATE, { kind: 'hostSnapshot', ...m }));
    this.room.onMessage('result', (m) => bus.emit(Events.NET_STATE, { kind: 'result', ...m }));
    this.room.onMessage('hero', (m) => bus.emit(Events.NET_STATE, { kind: 'hero', ...m }));
    this.room.onMessage('chat', (m) => bus.emit(Events.CHAT, m));
    this.room.onLeave(() => bus.emit(Events.NET_DISCONNECTED, {}));
    // seed existing players
    this.room.state.players.forEach((p, key) => {
      if (key !== this.sessionId) bus.emit(Events.NET_PLAYER_JOINED, { id: key, name: p.name, hero: safeHero(p.heroJson) });
    });
  }
  sendPos(x, y, facing, hp) {
    if (!this.connected) return;
    this.room.send('input', { x: Math.round(x), y: Math.round(y), facing, hp });
  }
  sendSnapshot(enemies) {
    if (!this.connected || !this.isHost) return;
    this.room.send('hostSnapshot', { enemies });
  }
  pushHero(hero) {
    if (!this.connected) return;
    try { this.room.send('hero', { hero }); } catch {}
  }
  sendChat(name, text) {    if (!this.connected) { bus.emit(Events.CHAT, { name, text }); return; }
    this.room.send('chat', { name, text });
  }
  leave() { try { this.room?.leave(); } catch {} this.room = null; this.isHost = false; }
}

function safeHero(json) { try { return JSON.parse(json); } catch { return null; } }

export const net = new NetworkManager();
