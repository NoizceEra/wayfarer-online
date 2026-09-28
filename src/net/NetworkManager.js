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
    this.peers = new Map(); // sessionId -> {name, hero}; source of truth for WorldSync
  }
  get connected() { return !!this.room; }
  whenState(timeoutMs = 5000) {
    if (this.room.state) return Promise.resolve();
    return new Promise((res, rej) => {
      const t0 = Date.now();
      const t = setInterval(() => {
        if (this.room.state) { clearInterval(t); res(); }
        else if (Date.now() - t0 > timeoutMs) { clearInterval(t); rej(new Error('No state from relay (timeout).')); }
      }, 50);
    });
  }
  async host(name, hero) {
    this.client = new Client(CONFIG.serverUrl.replace(/^ws/, 'http'));
    this.room = await this.client.create('party', { name, hero });
    await this.whenState();
    const roomId = this.room.roomId; // colyseus.js 0.16: roomId (not .id)
    this.isHost = true; this.code = roomId.slice(-5).toUpperCase();
    this.sessionId = this.room.sessionId;
    this.attach();
    bus.emit(Events.NET_CONNECTED, { code: roomId, isHost: true });
    return roomId;
  }
  async join(code, name, hero) {
    this.client = new Client(CONFIG.serverUrl.replace(/^ws/, 'http'));
    const roomId = await this.resolveCode(code);
    this.room = await this.client.joinById(roomId, { name, hero });
    await this.whenState();
    this.isHost = false; this.code = code.toUpperCase();
    this.sessionId = this.room.sessionId;
    this.attach();
    bus.emit(Events.NET_CONNECTED, { code: roomId, isHost: false });
  }
  async resolveCode(code) {
    const httpBase = CONFIG.serverUrl.replace(/^ws/, 'http');
    const res = await fetch(`${httpBase}/rooms/${encodeURIComponent(String(code).toUpperCase())}`);
    if (!res.ok) throw new Error('No rooms found — ask host for a fresh code.');
    const data = await res.json();
    if (!data?.roomId) throw new Error('No rooms found — ask host for a fresh code.');
    return data.roomId;
  }
  attach() {
    // Peer presence arrives as room messages (see server onJoin/onLeave) —
    // no schema-callback API needed. Tracked in this.peers so WorldScene can
    // reconcile on entry (join events may predate world creation).
    this.room.onMessage('peer-join', (m) => {
      if (m.sessionId === this.sessionId) return;
      this.peers.set(m.sessionId, { name: m.name, hero: m.hero });
      bus.emit(Events.NET_PLAYER_JOINED, { id: m.sessionId, name: m.name, hero: m.hero });
    });
    this.room.onMessage('peer-leave', (m) => {
      this.peers.delete(m.sessionId);
      bus.emit(Events.NET_PLAYER_LEFT, { id: m.sessionId });
    });
    this.room.onMessage('input', (m) => bus.emit(Events.NET_STATE, { kind: 'input', ...m }));
    this.room.onMessage('hostSnapshot', (m) => bus.emit(Events.NET_STATE, { kind: 'hostSnapshot', ...m }));
    this.room.onMessage('result', (m) => bus.emit(Events.NET_STATE, { kind: 'result', ...m }));
    this.room.onMessage('hero', (m) => bus.emit(Events.NET_STATE, { kind: 'hero', ...m }));
    this.room.onMessage('chat', (m) => bus.emit(Events.CHAT, m));
    this.room.onLeave(() => bus.emit(Events.NET_DISCONNECTED, {}));
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
  leave() { try { this.room?.leave(); } catch {} this.room = null; this.isHost = false; this.peers.clear(); }
}

function safeHero(json) { try { return JSON.parse(json); } catch { return null; } }

export const net = new NetworkManager();

// Debug handle (co-op troubleshooting, automated tests).
if (typeof window !== 'undefined') window.__net = net;
