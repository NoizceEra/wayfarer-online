import { Room } from 'colyseus';
import { CFG } from './config.js';
import { log } from './log.js';
import { loadChar, saveChar, TOKEN_RE } from './store.js';
import { validateSave, sanitizeHero } from './validate.js';

// One room class, two flavours:
//   kind 'world' — public persistent shard (Embervale-1 is always on, overflow
//                  shards Embervale-2.. are created when full and dispose empty)
//   kind 'party' — private co-op room joined by a 5-char code
//
// Model: "area authority". The server keeps a replicated cache of every
// player (validated positions) and of enemies per area. For each area
// (overworld 'ow' or an interior/dungeon id) exactly one connected player in
// that area is the *authority*: it simulates that area's enemies and streams
// changed fields ('esnap'). Other players route hits to it ('hit'), it
// replies with authoritative 'ehit'/'edeath'. Authority migrates instantly
// when the holder leaves the area or drops (host migration for free).
//
// Replication to clients runs at TICK_HZ with per-recipient area-of-interest
// filtering (same area + within AOI_RADIUS) and delta compression (only
// fields that changed since what *that* recipient last received).
//
// Message shapes other modules may rely on (keep stable):
//   chat {text} -> chat {name, text, sessionId}
//   peer-join {sessionId, name, hero} / peer-leave {sessionId}
//   hero {hero} -> hero {sessionId, hero}
//   result {...} -> result {...}  (broadcast passthrough)
//   any unknown type T {...} -> T {...m, sessionId} to everyone else (generic passthrough)

export const STATS = { msgsIn: 0, msgsOut: 0, joins: 0, leaves: 0, reconnects: 0, violations: 0, dropped: 0, startedAt: Date.now() };

const FACINGS = new Set(['up', 'down', 'left', 'right']);
const areaKey = (a) => (typeof a === 'string' && a && a.length <= 32 ? a : 'ow');
const clampN = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

// token bucket per client per channel
class Bucket {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.t = Date.now(); }
  take(n = 1) {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.t) / 1000) * this.rate);
    this.t = now;
    if (this.tokens < n) return false;
    this.tokens -= n; return true;
  }
}

export const LIVE_ROOMS = new Set();

let social = null; // optional additive module (server/social.js), see index.js
export function setSocialModule(m) { social = m; }
const extra = []; // more optional modules (server/economy.js): same hooks, run after social
export function addRoomModule(m) { extra.push(m); }
function hook(name, ...args) { for (const m of extra) { try { m[name]?.(...args); } catch (e) { log.error(`module.${name} failed`, { err: e.message }); } } }

export class WayfarerRoom extends Room {
  onCreate(options = {}) {
    this.kind = options.kind === 'world' ? 'world' : 'party';
    this.maxClients = this.kind === 'world' ? CFG.MAX_PLAYERS : CFG.PARTY_MAX;
    if (this.kind === 'world') {
      // lowest free shard number: Embervale-1 (persistent), overflow -2, -3, ...
      const used = new Set([...LIVE_ROOMS].filter((r) => r.kind === 'world').map((r) => r.shardIndex));
      let i = 1; while (used.has(i)) i++;
      this.shardIndex = i;
      this.displayName = `${CFG.WORLD_NAME}-${i}`;
    } else {
      this.shardIndex = 0;
      // typeable join code: roomId ends in 5 unambiguous uppercase chars (no - or _)
      const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const taken = new Set([...LIVE_ROOMS].map((r) => r.roomId.slice(-5)));
      let code;
      do { code = Array.from({ length: 5 }, () => AL[Math.floor(Math.random() * AL.length)]).join(''); } while (taken.has(code));
      this.roomId = `p${Date.now().toString(36)}${code}`;
      this.displayName = `party ${this.roomId.slice(-5).toUpperCase()}`;
    }
    LIVE_ROOMS.add(this);
    if (options.persistent) this.autoDispose = false;
    this.players = new Map();   // sessionId -> player record
    this.areas = new Map();     // areaKey -> {auth, enemies: Map id->{x,y,h,s,f,t}, dead: Map id->until}
    this.views = new Map();     // sessionId -> {p: Map sid->lastSent, e: Map id->lastSent}
    this.joinSeq = 0;
    this.setMetadata({ kind: this.kind, name: this.displayName });
    // Party Finder (server/partyFinder.js): a party room created with
    // { open: true } lists itself in GET /party-finder for quick-join.
    // Rooms without it never set metadata.open — they stay code-share-only.
    if (this.kind === 'party' && options.open === true) {
      this.setMetadata({
        open: true,
        hostName: String(options.name || 'Host').slice(0, 14),
        level: options.level || 1,
        area: String(options.area || 'ow'),
        createdAt: Date.now(),
      });
    }
    this.setPatchRate(null); // no schema state: everything is explicit messages

    const on = (type, fn, bucket = 'misc') => this.onMessage(type, (client, m) => {
      STATS.msgsIn++;
      const p = this.players.get(client.sessionId);
      if (!p) return;
      if (!p.buckets[bucket].take()) { this.flood(client, p); return; }
      try { fn(client, p, m && typeof m === 'object' ? m : {}); }
      catch (e) { log.warn('handler error', { type, err: e.message }); }
    });

    on('mv', (c, p, m) => this.onMove(c, p, m), 'mv');
    on('input', (c, p, m) => this.onMove(c, p, m), 'mv'); // legacy client shape {x,y,facing,hp}
    on('esnap', (c, p, m) => this.onEnemySnap(c, p, m), 'mv');
    on('hit', (c, p, m) => this.onHit(c, p, m), 'hit');
    on('ehit', (c, p, m) => this.onEnemyHit(c, p, m), 'hit');
    on('edeath', (c, p, m) => this.onEnemyDeath(c, p, m), 'hit');
    on('act', (c, p, m) => {
      const out = { sessionId: c.sessionId, k: String(m.k || 'atk').slice(0, 12), x: m.x | 0, y: m.y | 0, f: FACINGS.has(m.f) ? m.f : p.f, an: Number.isFinite(m.an) ? +m.an.toFixed(3) : undefined, kind: typeof m.kind === 'string' ? m.kind.slice(0, 12) : undefined, ab: typeof m.ab === 'string' ? m.ab.slice(0, 16) : undefined };
      this.sendNear(p, 'act', out, c);
    }, 'hit');
    on('hero', (c, p, m) => {
      const hero = sanitizeHero(m.hero) || {};
      p.hero = hero;
      this.bcast('hero', { sessionId: c.sessionId, hero });
    });
    on('result', (c, p, m) => this.bcast('result', m, c));
    on('chat', (c, p, m) => {
      const text = String(m.text || '').replace(/[\u0000-\u001f]/g, '').slice(0, 140);
      if (!text.trim()) return;
      this.bcast('chat', { name: p.name, text, sessionId: c.sessionId });
    }, 'chat');
    on('save', (c, p, m) => this.onSave(c, p, m), 'save');
    // client (re)entered the world: resend everything in its AOI + dead enemies
    on('resync', (c, p) => { this.views.set(c.sessionId, { p: new Map(), e: new Map() }); this.sendDeadList(c, p.a); }, 'ping');
    on('ping', (c, p, m) => { this.sendTo(c, 'pong', { c: m.c, t: Date.now(), n: this.clients.length, rn: this.displayName }); }, 'ping');
    // Generic passthrough: only for types that no explicit handler/module consumed.
    // Module-handled messages (party, trade, duel, pet-duel, social, economy, etc.)
    // are routed by their own onMessage registrations in server/social.js or
    // server/index.js; they must NOT be echoed to the whole room.
    const moduleTypes = new Set([
      'party-invite', 'party-accept', 'party-decline', 'party-leave', 'party-kick', 'party-promote', 'party-msg', 'party-xp', 'party-status',
      'whisper', 'schat', 'emote', 'presence', 'who', 'guild-create', 'guild-join', 'guild-leave', 'guild-rank', 'guild-motd', 'guild-invite',
      'trade-offer', 'trade-respond', 'trade-done', 'trade-sent',
      'duel-challenge', 'duel-accept', 'duel-decline', 'duel-start', 'duel-end', 'pvp-hit',
      'pet-duel', 'economy', 'mail', 'market', 'referral', 'world-boss', 'social-error',
    ]);
    this.onMessage('*', (client, type, m) => {
      STATS.msgsIn++;
      const p = this.players.get(client.sessionId);
      if (!p) return;
      if (!p.buckets.misc.take()) { this.flood(client, p); return; }
      if (typeof type !== 'string' || type.length > 32) return;
      if (moduleTypes.has(type)) return; // do not echo module-handled messages
      let size = 0; try { size = JSON.stringify(m ?? null).length; } catch { return; }
      if (size > 4096) return;
      const payload = m && typeof m === 'object' && !Array.isArray(m) ? { ...m, sessionId: client.sessionId } : { value: m, sessionId: client.sessionId };
      this.bcast(type, payload, client);
    });

    try { social?.install?.(this); } catch (e) { log.error('social.install failed', { err: e.message }); }
    hook('install', this);

    // simulation interval also drives this.clock (patches are off: no schema state)
    this.setSimulationInterval(() => this.tick(), Math.round(1000 / CFG.TICK_HZ));
    this.clock.setInterval(() => this.periodicSave(), 30_000);
    log.info('room created', { room: this.displayName, id: this.roomId, kind: this.kind });
  }

  // ─── helpers ───────────────────────────────────────────────────────
  sendTo(client, type, msg) { STATS.msgsOut++; try { client.send(type, msg); } catch { /* closing */ } }
  bcast(type, msg, except) { STATS.msgsOut += this.clients.length; this.broadcast(type, msg, except ? { except } : undefined); }
  clientOf(sid) { return this.clients.find((c) => c.sessionId === sid); }
  area(key) {
    let a = this.areas.get(key);
    if (!a) { a = { auth: null, enemies: new Map(), dead: new Map() }; this.areas.set(key, a); }
    return a;
  }
  // send to players in the same area within AOI of (x,y) (defaults to sender position)
  sendNear(p, type, msg, exceptClient, x = p.x, y = p.y, r = CFG.AOI_RADIUS + 64) {
    for (const c of this.clients) {
      if (c === exceptClient) continue;
      const q = this.players.get(c.sessionId);
      if (!q || q.dc || q.a !== p.a) continue;
      if (Math.hypot(q.x - x, q.y - y) > r && this.area(q.a).auth !== c.sessionId) continue;
      this.sendTo(c, type, msg);
    }
  }
  flood(client, p) {
    STATS.dropped++;
    p.drops = (p.drops || 0) + 1;
    const now = Date.now();
    if (!p.dropWin || now - p.dropWin > 10_000) { p.dropWin = now; p.drops = 1; }
    if (p.drops > 300) { log.warn('flood disconnect', { room: this.displayName, name: p.name }); client.leave(4003); }
  }
  violation(client, p, why, extra) {
    STATS.violations++;
    p.vio = (p.vio || 0) + 1;
    log.warn('anticheat', { room: this.displayName, name: p.name, why, vio: p.vio, ...extra });
  }

  // ─── lifecycle ─────────────────────────────────────────────────────
  onJoin(client, options = {}) {
    STATS.joins++;
    const name = String(options.name || 'Wayfarer').replace(/[^\w \-']/g, '').trim().slice(0, 14) || 'Wayfarer';
    const token = TOKEN_RE.test(String(options.token || '')) ? String(options.token) : null;
    const stored = token ? loadChar(token, name) : null;
    const hero = sanitizeHero(options.hero) || stored?.hero || {};
    const sx = clampN(options.x ?? stored?.progress?.x ?? 0, -20000, 40000);
    const sy = clampN(options.y ?? stored?.progress?.y ?? 0, -20000, 40000);
    const p = {
      sid: client.sessionId, name, token, hero, x: sx, y: sy, f: 'down', h: 100, a: areaKey(options.a), m: 0,
      joinedAt: Date.now(), order: ++this.joinSeq, lastSave: stored ? { progress: stored.progress } : null, lastMv: Date.now(), dc: false, vio: 0,
      warp: new Bucket(0.5, 3), buckets: {
        mv: new Bucket(40, 80), hit: new Bucket(25, 50), chat: new Bucket(1.5, 5), save: new Bucket(0.5, 4), ping: new Bucket(2, 6), misc: new Bucket(20, 60),
      },
      isCreator: this.kind === 'party' && this.players.size === 0,
    };
    this.players.set(client.sessionId, p);
    this.views.set(client.sessionId, { p: new Map(), e: new Map() });
    this.ensureAuth(p.a);

    this.sendTo(client, 'welcome', {
      sessionId: client.sessionId, room: this.displayName, kind: this.kind, code: this.roomId.slice(-5).toUpperCase(),
      t: Date.now(), tickMs: Math.round(1000 / CFG.TICK_HZ), aoi: CFG.AOI_RADIUS, n: this.clients.length,
      save: stored ? { progress: stored.progress, hero: stored.hero, savedAt: stored.savedAt, clamped: !!stored.clamped } : null,
      auth: [...this.areas].filter(([, a]) => a.auth).map(([k, a]) => [k, a.auth]),
    });
    this.sendDeadList(client, p.a);
    this.bcast('peer-join', { sessionId: client.sessionId, name: p.name, hero: p.hero, a: p.a }, client);
    for (const [sid, q] of this.players) {
      if (sid === client.sessionId) continue;
      this.sendTo(client, 'peer-join', { sessionId: sid, name: q.name, hero: q.hero, a: q.a, dc: q.dc ? 1 : 0 });
    }
    try { social?.onJoin?.(this, client, p); } catch (e) { log.error('social.onJoin failed', { err: e.message }); }
    hook('onJoin', this, client, p);
    log.info('join', { room: this.displayName, name, n: this.clients.length, saved: !!stored });
  }

  async onLeave(client, consented) {
    const p = this.players.get(client.sessionId);
    if (!p) return;
    this.persist(p);
    if (!consented) {
      // keep the seat: the client auto-reconnects with room.reconnectionToken
      p.dc = true;
      this.releaseAuth(client.sessionId);
      this.bcast('peer-status', { sessionId: client.sessionId, dc: 1 }, client);
      try {
        const back = await this.allowReconnection(client, CFG.RECONNECT_SECONDS);
        STATS.reconnects++;
        p.dc = false; p.lastMv = Date.now(); p.correctUntil = 0;
        this.views.set(back.sessionId, { p: new Map(), e: new Map() }); // full resync
        this.ensureAuth(p.a);
        this.sendTo(back, 'welcome', {
          sessionId: back.sessionId, room: this.displayName, kind: this.kind, code: this.roomId.slice(-5).toUpperCase(),
          t: Date.now(), tickMs: Math.round(1000 / CFG.TICK_HZ), aoi: CFG.AOI_RADIUS, n: this.clients.length, resumed: true,
          auth: [...this.areas].filter(([, a]) => a.auth).map(([k, a]) => [k, a.auth]),
        });
        for (const [sid, q] of this.players) if (sid !== back.sessionId) this.sendTo(back, 'peer-join', { sessionId: sid, name: q.name, hero: q.hero, a: q.a, dc: q.dc ? 1 : 0 });
        this.sendDeadList(back, p.a);
        this.bcast('peer-status', { sessionId: back.sessionId, dc: 0 }, back);
        log.info('reconnected', { room: this.displayName, name: p.name });
        return;
      } catch { /* window expired */ }
    }
    this.removePlayer(client.sessionId);
  }

  removePlayer(sid) {
    const p = this.players.get(sid);
    if (!p) return;
    STATS.leaves++;
    this.players.delete(sid);
    this.views.delete(sid);
    this.releaseAuth(sid);
    this.bcast('peer-leave', { sessionId: sid, name: p.name, wasHost: p.isCreator ? 1 : 0 });
    try { social?.onLeave?.(this, { sessionId: sid }, p); } catch (e) { log.error('social.onLeave failed', { err: e.message }); }
    hook('onLeave', this, { sessionId: sid }, p);
    log.info('leave', { room: this.displayName, name: p.name, n: this.players.size });
  }

  // graceful shutdown (SIGTERM on redeploy): persist everyone, then close with
  // a non-consented code so clients auto-reconnect to the new instance
  onBeforeShutdown() {
    for (const p of this.players.values()) this.persist(p);
    this.bcast('notice', { k: 'restart', text: 'Server restarting — reconnecting shortly…' });
    this.autoDispose = true;
    this.disconnect(4010);
  }
  onDispose() {
    LIVE_ROOMS.delete(this);
    for (const p of this.players.values()) this.persist(p);
    log.info('room disposed', { room: this.displayName });
  }

  // ─── authority ─────────────────────────────────────────────────────
  ensureAuth(key) {
    const a = this.area(key);
    const cur = a.auth && this.players.get(a.auth);
    if (cur && !cur.dc && cur.a === key) return;
    let best = null;
    for (const q of this.players.values()) if (!q.dc && q.a === key && (!best || q.order < best.order)) best = q;
    const next = best ? best.sid : null;
    if (next === a.auth) return;
    a.auth = next;
    if (next) this.bcast('auth', { a: key, sid: next });
    if (!next) { a.enemies.clear(); } // nobody simulates it: drop stale cache (dead timers kept)
  }
  releaseAuth(sid) {
    for (const [key, a] of this.areas) if (a.auth === sid) { a.auth = null; this.ensureAuth(key); if (!a.auth) this.bcast('auth', { a: key, sid: null }); }
  }
  sendDeadList(client, key) {
    const a = this.area(key); const now = Date.now();
    const ids = [];
    for (const [id, until] of a.dead) { if (until > now) ids.push([id, until - now]); else a.dead.delete(id); }
    this.sendTo(client, 'adead', { a: key, ids });
  }

  // ─── movement + anti-cheat ─────────────────────────────────────────
  onMove(client, p, m) {
    const now = Date.now();
    const dt = Math.min(2000, Math.max(16, now - p.lastMv));
    if (m.f !== undefined || m.facing !== undefined) { const f = m.f ?? m.facing; if (FACINGS.has(f)) p.f = f; }
    if (m.h !== undefined || m.hp !== undefined) p.h = clampN(m.h ?? m.hp, 0, 1e6) | 0;
    if (m.m !== undefined) p.m = m.m ? 1 : 0;
    const newArea = m.a !== undefined ? areaKey(m.a) : p.a;
    if (m.x === undefined && m.y === undefined && newArea === p.a) return;
    const x = m.x !== undefined ? clampN(m.x, -20000, 40000) : p.x;
    const y = m.y !== undefined ? clampN(m.y, -20000, 40000) : p.y;
    const dist = Math.hypot(x - p.x, y - p.y);
    const areaChange = newArea !== p.a;
    if (now < (p.correctUntil || 0) && dist > 48 && !areaChange) return; // in-flight moves after a correction
    if (areaChange || m.w) {
      if (!p.warp.take()) {
        this.violation(client, p, 'warp-rate', { dist: Math.round(dist) });
        this.correct(client, p); return;
      }
    } else if (dist > (CFG.MAX_SPEED * dt) / 1000 + 90) {
      this.violation(client, p, 'speed', { dist: Math.round(dist), dt });
      this.correct(client, p); return;
    }
    p.x = x; p.y = y; p.lastMv = now;
    // sample time: sender's server-clock stamp (clamped) beats arrival time (no relay jitter)
    p.t = Number.isFinite(m.t) ? Math.min(now, Math.max(now - 1000, m.t)) : now;
    if (areaChange) {
      const old = p.a; p.a = newArea;
      if (this.area(old).auth === p.sid) { this.area(old).auth = null; this.ensureAuth(old); if (!this.area(old).auth) this.bcast('auth', { a: old, sid: null }); }
      this.ensureAuth(newArea);
      this.views.get(p.sid)?.e.clear();
      this.sendDeadList(client, newArea);
    }
  }
  correct(client, p) {
    p.correctUntil = Date.now() + 350; p.lastMv = Date.now();
    this.sendTo(client, 'correct', { x: Math.round(p.x), y: Math.round(p.y), a: p.a });
    if (p.vio > 60) { log.warn('kick: too many violations', { name: p.name }); client.leave(4004); }
  }

  // ─── enemies ───────────────────────────────────────────────────────
  onEnemySnap(client, p, m) {
    const key = areaKey(m.a);
    const a = this.area(key);
    if (a.auth !== client.sessionId || !Array.isArray(m.e)) return;
    const arrived = Date.now();
    const now = Number.isFinite(m.t) ? Math.min(arrived, Math.max(arrived - 1000, m.t)) : arrived;
    for (const d of m.e.slice(0, 200)) {
      if (!d || typeof d.i !== 'string' || d.i.length > 64) continue;
      let e = a.enemies.get(d.i);
      if (!e) { e = { x: 0, y: 0, h: 1, s: 0, f: 'down', t: now }; a.enemies.set(d.i, e); a.dead.delete(d.i); }
      if (d.x !== undefined) { e.x = d.x | 0; e.t = now; }
      if (d.y !== undefined) { e.y = d.y | 0; e.t = now; }
      if (d.h !== undefined) e.h = d.h | 0;
      if (d.s !== undefined) e.s = d.s | 0;
      if (d.f !== undefined && FACINGS.has(d.f)) e.f = d.f;
    }
  }
  onHit(client, p, m) {
    const a = this.area(p.a);
    if (!a.auth || a.auth === client.sessionId || typeof m.i !== 'string') return;
    const d = Math.floor(Number(m.d));
    if (!Number.isFinite(d) || d < 1) return;
    if (d > 20000) { this.violation(client, p, 'dmg-cap', { d }); return; }
    const e = a.enemies.get(m.i);
    if (e && Math.hypot(e.x - p.x, e.y - p.y) > 360) { this.violation(client, p, 'hit-range', { d: Math.round(Math.hypot(e.x - p.x, e.y - p.y)) }); return; }
    const auth = this.clientOf(a.auth);
    if (auth) this.sendTo(auth, 'hit', { i: m.i, d, by: client.sessionId, kx: p.x | 0, ky: p.y | 0 });
  }
  onEnemyHit(client, p, m) {
    const a = this.area(p.a);
    if (a.auth !== client.sessionId || typeof m.i !== 'string') return;
    const e = a.enemies.get(m.i);
    if (e && m.h !== undefined) e.h = m.h | 0;
    const out = { i: m.i, d: m.d | 0, h: m.h | 0, by: typeof m.by === 'string' ? m.by : client.sessionId };
    if (e) this.sendNear(p, 'ehit', out, client, e.x, e.y);
    else this.sendNear(p, 'ehit', out, client, p.x, p.y, 1e9);
  }
  onEnemyDeath(client, p, m) {
    const a = this.area(p.a);
    if (a.auth !== client.sessionId || typeof m.i !== 'string') return;
    a.enemies.delete(m.i);
    a.dead.set(m.i, Date.now() + clampN(m.r, 1000, 600_000));
    for (const v of this.views.values()) v.e.delete(m.i);
    const by = Array.isArray(m.by) ? m.by.filter((s) => typeof s === 'string').slice(0, 16) : [];
    for (const c of this.clients) {
      if (c === client) continue;
      const q = this.players.get(c.sessionId);
      if (q && q.a === p.a) this.sendTo(c, 'edeath', { i: m.i, by, r: m.r | 0 });
    }
  }

  // ─── persistence ───────────────────────────────────────────────────
  onSave(client, p, m) {
    if (!p.token) return;
    const name = String(m.name || p.name).toLowerCase() === p.name.toLowerCase() ? p.name : null;
    if (!name) return;
    const prev = loadChar(p.token, name);
    if (extra.some((mod) => mod.beforeSave && mod.beforeSave(this, client, p, m, prev) === false)) return; // economy: stale rev
    const { rec, clamped } = validateSave(prev, m.progress);
    if (!rec) return;
    if (clamped.length) this.violation(client, p, 'save-clamp', { clamped });
    const hero = sanitizeHero(m.hero) || prev?.hero || p.hero;
    const now = Date.now();
    rec.savedAt = now;
    saveChar(p.token, name, { name, hero, progress: rec, savedAt: now, clamped: clamped.length ? clamped : undefined, rev: prev?.rev, econOut: prev?.econOut });
    p.lastSave = { progress: rec };
    this.sendTo(client, 'saved', { savedAt: now, clamped: clamped.length ? { level: rec.level, gold: rec.gold } : null });
  }
  // server-side position refresh of the last accepted save (logout, shutdown)
  persist(p) {
    if (!p.token || !p.lastSave) return;
    const prev = loadChar(p.token, p.name);
    if (!prev) return;
    if (p.a === 'ow') { prev.progress = { ...prev.progress, x: Math.round(p.x), y: Math.round(p.y) }; }
    saveChar(p.token, p.name, prev);
  }
  periodicSave() { for (const p of this.players.values()) this.persist(p); }

  // ─── replication tick ──────────────────────────────────────────────
  tick() {
    const now = Date.now();
    hook('tick', this);
    const R = CFG.AOI_RADIUS;
    for (const c of this.clients) {
      const me = this.players.get(c.sessionId);
      const view = this.views.get(c.sessionId);
      if (!me || !view || me.dc) continue;
      const isAuth = this.area(me.a).auth === c.sessionId;
      const P = [];
      for (const [sid, q] of this.players) {
        if (sid === c.sessionId) continue;
        const same = q.a === me.a;
        const near = same && (isAuth || Math.hypot(q.x - me.x, q.y - me.y) <= R);
        const last = view.p.get(sid);
        if (!near && last && now - last._t < 1000) continue; // far peers: ~1 Hz (minimap)
        const cur = { x: Math.round(q.x), y: Math.round(q.y), f: q.f, h: q.h, a: q.a, m: q.m, dc: q.dc ? 1 : 0 };
        const d = { i: sid };
        let n = 0;
        for (const k in cur) if (!last || last[k] !== cur[k]) { d[k] = cur[k]; n++; }
        if (!n) continue;
        if (d.x !== undefined || d.y !== undefined) { d.x = cur.x; d.y = cur.y; d.d = Math.max(0, now - (q.t || now)); }
        if (!near) d.far = 1;
        P.push(d);
        view.p.set(sid, { ...cur, _t: now });
      }
      const E = [];
      if (!isAuth) {
        const a = this.area(me.a);
        for (const [id, e] of a.enemies) {
          if (Math.abs(e.x - me.x) > R + 32 || Math.abs(e.y - me.y) > R + 32) continue;
          const last = view.e.get(id);
          const d = { i: id }; let n = 0;
          if (!last || last.x !== e.x || last.y !== e.y) { d.x = e.x; d.y = e.y; d.d = Math.max(0, now - e.t); n++; }
          if (!last || last.h !== e.h) { d.h = e.h; n++; }
          if (!last || last.s !== e.s) { d.s = e.s; n++; }
          if (!last || last.f !== e.f) { d.f = e.f; n++; }
          if (!n) continue;
          E.push(d);
          view.e.set(id, { x: e.x, y: e.y, h: e.h, s: e.s, f: e.f });
        }
      }
      if (P.length || E.length) this.sendTo(c, 'snap', { t: now, p: P, e: E });
    }
  }

  stats() {
    return {
      id: this.roomId, name: this.displayName, kind: this.kind, players: this.clients.length, max: this.maxClients,
      areas: [...this.areas].filter(([, a]) => a.auth).map(([k, a]) => ({ area: k, auth: this.players.get(a.auth)?.name, enemies: a.enemies.size })),
    };
  }
}
