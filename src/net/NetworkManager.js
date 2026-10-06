import { Client } from 'colyseus.js';
import { CONFIG } from '../config.js';
import { bus, Events } from '../core/events.js';
import { loadProgress, saveProgress, loadHero, saveHero, onProgressSaved } from '../core/save.js';
import { installNetStatus } from './netStatus.js';

// Relay client. Solo works with no connection; three ways online:
//   joinPublic()  - persistent public world (Embervale-1, overflow shards)
//   host()/join() - private co-op room by 5-char code
// Enemies are simulated by one "area authority" per area (see server/WayfarerRoom.js);
// isAuthority(areaId) says whether this client runs that area's enemies.
//
// Robustness: auto-reconnect with exponential backoff (resumes the same seat
// via room.reconnectionToken; falls back to a fresh join after a server
// restart), RTT/clock sync via ping, save upload to the server character
// store keyed by an anonymous device token (localStorage stays the fallback).
//
// Generic API for other net modules (e.g. socialNet.js):
//   net.on(type, fn) -> off()   handlers survive reconnects
//   net.send(type, payload)     unknown types are relayed to the room by the server
const DEVICE_KEY = 'wayfarer.device.v1';
const CONSENTED = 4000;

function deviceToken() {
  try {
    let t = localStorage.getItem(DEVICE_KEY);
    if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
      const a = new Uint8Array(18); (globalThis.crypto || window.crypto).getRandomValues(a);
      t = Array.from(a, (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[b & 63]).join('');
      localStorage.setItem(DEVICE_KEY, t);
    }
    return t;
  } catch { return null; }
}
const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const areaKey = (areaId) => areaId || 'ow';

export class NetworkManager {
  constructor() {
    this.client = null; this.room = null;
    this.isHost = false;           // created the private room (display only; authority is per area)
    this.code = null;              // private: 5-char code; public: shard name (e.g. Embervale-1)
    this.kind = null;              // 'world' | 'party' | null
    this.roomName = null;
    this.sessionId = null;
    this.status = 'offline';
    this.peers = new Map();        // sessionId -> {name, hero, a, dc}
    this.authority = new Map();    // areaKey -> sessionId
    this.handlers = new Map();     // type -> Set(fn)
    this.ping = null; this.players = 0;
    this.clockOffset = 0; this.clockSamples = [];
    this.name = null; this.hero = null;
    this.leaving = false;
    this.inWorld = false;          // WorldSync attached (skip save restore mid-game)
    this.lastSaveSent = 0; this.pendingSave = null;
    this.stats = { snaps: 0, bytesApprox: 0, corrections: 0, reconnects: 0 };
    this.token = typeof window !== 'undefined' ? deviceToken() : null;
    onProgressSaved((name, rec) => this.queueSave(name, rec));
  }

  get connected() { return !!this.room && this.status === 'online'; }
  get isPublic() { return this.kind === 'world'; }
  serverNow() { return performance.now() + this.clockOffset; }
  isAuthority(areaId) {
    if (!this.connected) return true;
    return this.authority.get(areaKey(areaId)) === this.sessionId;
  }
  authorityOf(areaId) { return this.authority.get(areaKey(areaId)) || null; }

  setStatus(status) {
    this.status = status;
    bus.emit(Events.NET_STATUS, { status, ping: this.ping, players: this.players, room: this.roomName, kind: this.kind });
  }

  joinOptions(name, hero) {
    const prog = loadProgress(name);
    return { name, hero, token: this.token, x: prog?.x, y: prog?.y };
  }
  newClient() { this.client = new Client(httpBase()); return this.client; }

  // ─── entry points ──────────────────────────────────────────────────
  async joinPublic(name, hero) {
    this.name = name; this.hero = hero;
    this.setStatus('connecting');
    try {
      const room = await this.newClient().joinOrCreate('world', this.joinOptions(name, hero));
      await this.adopt(room, 'world');
      bus.emit(Events.NET_CONNECTED, { code: room.roomId, isHost: false, public: true });
      return this.roomName;
    } catch (e) { this.setStatus('offline'); throw e; }
  }
  async host(name, hero, opts = {}) {
    this.name = name; this.hero = hero;
    this.setStatus('connecting');
    try {
      // opts.open: list the room in GET /party-finder (Party Finder); without it
      // the room stays private/code-share-only. All other opts are ignored.
      const createOpts = this.joinOptions(name, hero);
      if (opts.open) createOpts.open = true;
      const room = await this.newClient().create('party', createOpts);
      this.isHost = true;
      await this.adopt(room, 'party');
      bus.emit(Events.NET_CONNECTED, { code: room.roomId, isHost: true });
      return room.roomId;
    } catch (e) { this.setStatus('offline'); throw e; }
  }
  async join(code, name, hero) {
    this.name = name; this.hero = hero;
    this.setStatus('connecting');
    try {
      this.newClient();
      const roomId = await this.resolveCode(code);
      const room = await this.client.joinById(roomId, this.joinOptions(name, hero));
      this.isHost = false;
      await this.adopt(room, 'party');
      bus.emit(Events.NET_CONNECTED, { code: roomId, isHost: false });
    } catch (e) { this.setStatus('offline'); throw e; }
  }
  async resolveCode(code) {
    const res = await fetch(`${httpBase()}/rooms/${encodeURIComponent(String(code).toUpperCase())}`);
    if (!res.ok) throw new Error('No rooms found — ask host for a fresh code.');
    const data = await res.json();
    if (!data?.roomId) throw new Error('No rooms found — ask host for a fresh code.');
    return data.roomId;
  }

  // Wire a freshly joined/reconnected room and wait for the server 'welcome'.
  adopt(room, kind, { resumed = false } = {}) {
    this.room = room; this.kind = kind; this.leaving = false;
    this.roomId = room.roomId;
    this.sessionId = room.sessionId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('No welcome from relay (timeout).')), 6000);
      this.onWelcome = (m) => { clearTimeout(t); resolve(m); };
      this.attach(room);
    }).then((m) => {
      this.onWelcome = null;
      this.applyWelcome(m, resumed);
      this.setStatus('online');
      this.startPing();
      return m;
    });
  }

  applyWelcome(m, resumed) {
    this.sessionId = m.sessionId || this.room.sessionId;
    this.roomName = m.room; this.players = m.n || 1;
    this.code = this.kind === 'world' ? m.room : m.code;
    this.authority = new Map(m.auth || []);
    this.clockOffset = (m.t || Date.now()) - performance.now(); this.clockSamples = [];
    // Server character store: newer (or anti-cheat clamped) copy wins over localStorage.
    const s = m.save;
    if (s && !this.inWorld && !resumed && this.name) {
      const local = loadProgress(this.name);
      if (s.progress && (!local || (s.savedAt || 0) > (local.savedAt || 0) || s.clamped)) {
        saveProgress(this.name, s.progress, { silent: true, savedAt: s.savedAt });
      }
      if (s.hero && !loadHero()) saveHero(s.hero);
    }
  }

  attach(room) {
    const emit = (type, m) => {
      this.handlers.get(type)?.forEach((fn) => { try { fn(m); } catch (e) { console.error(e); } });
    };
    room.onMessage('welcome', (m) => { if (this.onWelcome) this.onWelcome(m); else { this.applyWelcome(m, true); } emit('welcome', m); });
    room.onMessage('peer-join', (m) => {
      if (m.sessionId === this.sessionId) return;
      const known = this.peers.has(m.sessionId);
      this.peers.set(m.sessionId, { name: m.name, hero: m.hero, a: m.a || 'ow', dc: !!m.dc });
      if (!known) bus.emit(Events.NET_PLAYER_JOINED, { id: m.sessionId, name: m.name, hero: m.hero, a: m.a || 'ow' });
      emit('peer-join', m);
    });
    room.onMessage('peer-leave', (m) => {
      const p = this.peers.get(m.sessionId);
      this.peers.delete(m.sessionId);
      bus.emit(Events.NET_PLAYER_LEFT, { id: m.sessionId });
      if (m.wasHost && this.kind === 'party') bus.emit(Events.SYSTEM, `${p?.name || 'The host'} left — the world carries on.`);
      emit('peer-leave', m);
    });
    room.onMessage('peer-status', (m) => { const p = this.peers.get(m.sessionId); if (p) p.dc = !!m.dc; emit('peer-status', m); });
    room.onMessage('auth', (m) => {
      const prev = this.authority.get(m.a);
      if (m.sid) this.authority.set(m.a, m.sid); else this.authority.delete(m.a);
      if (m.a === 'ow' && m.sid === this.sessionId && prev && prev !== this.sessionId && this.peers.size) {
        bus.emit(Events.SYSTEM, 'Host migration: you now simulate the overworld.');
      }
      emit('auth', m);
    });
    room.onMessage('snap', (m) => { this.stats.snaps++; emit('snap', m); });
    for (const type of ['adead', 'hit', 'ehit', 'edeath', 'act', 'saved', 'notice']) room.onMessage(type, (m) => emit(type, m));
    // autonomous agent system (src/net/agentsNet.js): server->client messages are
    // addressed to the owning player only; mirror the generic-relay echo guard so a
    // relayed copy (tagged with sessionId) is not re-delivered here.
    for (const type of ['agent-entitlement', 'agent-state', 'agent-claim-result']) {
      room.onMessage(type, (m) => { if (m && typeof m === 'object' && m.sessionId !== undefined) return; emit(type, m); });
    }
    room.onMessage('correct', (m) => { this.stats.corrections++; emit('correct', m); });
    room.onMessage('pong', (m) => this.onPong(m));
    // legacy shapes still forwarded on NET_STATE for older listeners
    room.onMessage('hero', (m) => { const p = this.peers.get(m.sessionId); if (p) p.hero = m.hero; bus.emit(Events.NET_STATE, { kind: 'hero', ...m }); emit('hero', m); });
    room.onMessage('result', (m) => { bus.emit(Events.NET_STATE, { kind: 'result', ...m }); emit('result', m); });
    room.onMessage('chat', (m) => { bus.emit(Events.CHAT, m); emit('chat', m); });
    // anything else (social/party/emote/... modules): generic passthrough,
    // but drop module-handled echoes that include a sessionId to avoid double-processing.
    room.onMessage('*', (type, m) => {
      if (typeof type !== 'string') return;
      if (m && typeof m === 'object' && m.sessionId !== undefined) return;
      emit(type, m);
      bus.emit(Events.NET_STATE, { kind: type, ...(m && typeof m === 'object' ? m : { value: m }) });
    });
    // custom handlers registered with net.on() for types without a built-in handler above
    room.onLeave((code) => this.onRoomLeave(room, code));
    room.onError((code, msg) => console.warn('[net] room error', code, msg));
    // module hooks (src/net/socialNet.js registers its typed handlers here on every (re)attach)
    for (const fn of this._attachListeners || []) { try { fn(room); } catch (e) { console.error(e); } }
  }

  // onAttach(fn): fn(room) runs each time a room is attached (host/join/reconnect); returns an unsubscribe.
  onAttach(fn) {
    (this._attachListeners ||= []).push(fn);
    if (this.room) fn(this.room);
    return () => { const i = this._attachListeners.indexOf(fn); if (i >= 0) this._attachListeners.splice(i, 1); };
  }
  offAttach(fn) {
    const i = this._attachListeners.indexOf(fn); if (i >= 0) this._attachListeners.splice(i, 1);
  }

  // ─── generic API ───────────────────────────────────────────────────
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  send(type, payload) {
    if (!this.connected) return false;
    // socket already closing (network drop, before onLeave fires): don't send, the browser logs an error per call
    if (this.room.connection && this.room.connection.isOpen === false) return false;
    try { this.room.send(type, payload); return true; } catch { return false; }
  }

  // ─── clock + ping ──────────────────────────────────────────────────
  startPing() {
    clearInterval(this.pingTimer);
    const tick = () => this.send('ping', { c: performance.now() });
    tick(); setTimeout(tick, 300); setTimeout(tick, 700);
    this.pingTimer = setInterval(tick, 2000);
  }
  onPong(m) {
    const now = performance.now();
    const rtt = Math.max(0, now - m.c);
    this.ping = this.ping == null ? rtt : Math.round(this.ping * 0.7 + rtt * 0.3);
    if (m.n) this.players = m.n;
    if (m.rn) this.roomName = m.rn;
    // offset from the lowest-RTT recent sample (least queuing noise); slew, don't jump
    this.clockSamples.push({ rtt, off: m.t + rtt / 2 - now });
    if (this.clockSamples.length > 10) this.clockSamples.shift();
    const best = this.clockSamples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    const diff = best.off - this.clockOffset;
    this.clockOffset += Math.abs(diff) > 250 ? diff : Math.max(-4, Math.min(4, diff));
    bus.emit(Events.NET_STATUS, { status: this.status, ping: this.ping, players: this.players, room: this.roomName, kind: this.kind });
  }

  // ─── reconnection ──────────────────────────────────────────────────
  onRoomLeave(room, code) {
    if (room !== this.room) return; // stale room object
    clearInterval(this.pingTimer);
    if (this.leaving || code === CONSENTED) { this.resetRoom(); this.setStatus('offline'); bus.emit(Events.NET_DISCONNECTED, { code }); return; }
    this.reconnect(code);
  }
  async reconnect(code) {
    if (this.reconnecting) return;
    this.reconnecting = true;
    // 4010 = server restarting: the old seat dies with the process, go straight to a fresh join
    let token = code === 4010 ? null : this.room?.reconnectionToken;
    const kind = this.kind; const roomId = this.roomId;
    this.room = null;
    this.setStatus('reconnecting');
    const t0 = Date.now();
    let attempt = 0;
    while (!this.leaving && Date.now() - t0 < 90_000) {
      const delay = Math.min(8000, 400 * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      await sleep(attempt === 0 ? 250 : delay);
      if (this.leaving) break;
      attempt++;
      try {
        // 1) resume the held seat (network blip): same sessionId, peers keep us
        if (token && attempt <= 5) {
          const room = await this.client.reconnect(token);
          await this.adopt(room, kind, { resumed: true });
          this.finishReconnect(true); return;
        }
        // 2) seat gone (server restarted / window expired): fresh join
        const opts = this.joinOptions(this.name, this.hero);
        let room;
        if (kind === 'world') room = await this.newClient().joinOrCreate('world', opts);
        else room = await this.newClient().joinById(roomId, opts);
        this.dropAllPeers();
        await this.adopt(room, kind);
        this.finishReconnect(false); return;
      } catch (e) {
        console.warn(`[net] reconnect attempt ${attempt} failed:`, e?.message || e);
        if (/disposed|not found|expired/i.test(String(e?.message))) token = null; // seat is gone
        if (kind === 'party' && attempt > 6) break; // private room is gone for good
      }
    }
    this.reconnecting = false;
    this.resetRoom();
    this.setStatus('offline');
    bus.emit(Events.SYSTEM, kind === 'party' ? 'Co-op room closed — continuing solo.' : 'Lost connection — continuing solo (rejoin from the title screen).');
    bus.emit(Events.NET_DISCONNECTED, { code });
  }
  finishReconnect(resumed) {
    this.reconnecting = false;
    this.stats.reconnects++;
    bus.emit(Events.NET_RECONNECTED, { resumed });
    bus.emit(Events.SYSTEM, resumed ? 'Reconnected.' : `Reconnected to ${this.roomName}.`);
    if (this.pendingSave) this.flushSave(true);
  }
  dropAllPeers() {
    for (const id of [...this.peers.keys()]) { this.peers.delete(id); bus.emit(Events.NET_PLAYER_LEFT, { id }); }
  }
  resetRoom() {
    this.dropAllPeers();
    this.room = null; this.isHost = false; this.kind = null; this.code = null; this.roomName = null;
    this.authority.clear(); this.reconnecting = false;
  }

  // ─── gameplay messages ─────────────────────────────────────────────
  sendMove(delta) { this.send('mv', delta); }
  sendPos(x, y, facing, hp) { this.send('mv', { x: Math.round(x), y: Math.round(y), f: facing, h: hp }); } // legacy
  pushHero(hero) {
    this.hero = hero;
    // Include the pets sub-snapshot so the server can build real pet duel teams.
    const pets = (typeof window !== 'undefined' && window.__socialUI?.petPanel)
      ? window.__socialUI.petPanel.getRoster?.()
      : undefined;
    this.send('hero', { hero, meta: pets !== undefined ? { pets } : undefined });
  }
  // helper for pet duel and other meta snapshots
  petSnapshot() {
    return (typeof window !== 'undefined' && window.__socialUI?.petPanel)
      ? { roster: window.__socialUI.petPanel.getRoster?.() || [] }
      : { roster: [] };
  }
  sendChat(name, text) {
    if (!this.connected) { bus.emit(Events.CHAT, { name, text }); return; }
    this.room.send('chat', { name, text });
  }

  // ─── server saves ──────────────────────────────────────────────────
  queueSave(name, rec) {
    if (!this.name || String(name).toLowerCase() !== String(this.name).toLowerCase()) return;
    this.pendingSave = rec;
    this.flushSave(false);
  }
  flushSave(force) {
    if (!this.pendingSave || !this.connected) return;
    const now = Date.now();
    if (!force && now - this.lastSaveSent < 8000) {
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.flushSave(true), 8000 - (now - this.lastSaveSent));
      return;
    }
    this.lastSaveSent = now;
    // rev: economy revision (src/net/economyNet.js); the server refuses saves quoting an old one
    this.send('save', { name: this.name, progress: this.pendingSave, hero: this.hero || loadHero(), rev: this.econRev });
    this.pendingSave = null;
  }

  leave() {
    this.leaving = true;
    this.flushSave(true);
    clearInterval(this.pingTimer);
    try { this.room?.leave(true); } catch { /* ignore */ }
    this.resetRoom();
    this.setStatus('offline');
  }
}

export const net = new NetworkManager();

// Debug handle (co-op troubleshooting, automated tests).
if (typeof window !== 'undefined') { window.__net = net; installNetStatus(net); }
