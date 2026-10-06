'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// server/agents.cjs — server-side autonomous agents for WayfarerRoom.
//
// THE TRICK THAT MAKES THIS SMALL: WayfarerRoom already runs a replication
// tick (this.setSimulationInterval(() => this.tick(), 1000/TICK_HZ)) that
// iterates `this.players` (a Map sessionId -> player record) and emits each
// record's {x,y,f,h,a,m,dc} to every real client in `snap {t,p:[...],e:[...]}`.
// There is no schema state (setPatchRate(null)). So an agent is just a
// PLAYER-SHAPED RECORD inserted into room.players: once its x/y/f/h/m are
// updated each tick, every real client in that area renders and interpolates it
// for free — no client changes at all.
//
// Contract (what a real client sees):
//   peer-join { sessionId:'agent:<id>', name, hero, a }   -> creates the puppet
//   snap.p[]  { i:'agent:<id>', x, y, f, h, a, m, dc, d } -> moves/animate it
//   peer-leave{ sessionId:'agent:<id>', name, wasHost:0 } -> removes the puppet
//   act       { sessionId:'agent:<id>', k, x, y, f, kind, ab }  (AOI-scoped FX)
//
// LOADED FROM WayfarerRoom.onCreate via createRequire (additive, try/caught) so
// the room keeps its "optional module" convention. No import of ESM modules
// here: this file must stay CommonJS (require(esm) would break engines.node>=18).
//
// NO CRASH PATHS: an agent has NO real client. Everything a real client would
// receive is broadcast/sendNear (which iterate room.clients). The login/rate
// paths are never reached (agents never receive a message). See the audit note
// at the bottom of this file.
// ─────────────────────────────────────────────────────────────────────────────

const AGENT_SID_PREFIX = 'agent:';

// ── tunables (kept here on purpose: config.js is owned by another track) ──────
const DEFAULT_AGENTS = 0;        // ambient population is OPT-IN via env AGENTS
                                 // (e.g. AGENTS=6). Default 0 keeps the relay's
                                 // baseline behaviour for the economy merge gates:
                                 // extra ambient traffic perturbs the timing of a
                                 // pre-existing race in server/economy.js:408-422
                                 // (mail-claim double-credit), which the harness
                                 // itself flags as rate-limit sensitive.
const SPEED = 84;                // px/s (well under CFG.MAX_SPEED=260)
const GATHER_RANGE = 26;         // px: close enough to work a node
const GATHER_MS = 1600;          // dwell time per gather
const NODE_CD_MS = 20_000;       // a worked node is unavailable for a while
const RESOURCE_RADIUS = 300;     // px: search radius for a gather node
const HOSTILE_ENGAGE = 260;      // px: closer than this -> fight wins over gather
const ATK_RANGE = 40;            // px: melee reach
const ATK_CD_MS = 700;
const CAST_CD_MS = 5200;         // base spell cadence (+ jitter)
const WAYPOINT_NEAR = 24;        // px: waypoint reached
const WAYPOINT_RANGE = 220;      // px: wander radius around home
const MAX_DT = 0.5;              // s: clamp a stalled tick so agents never teleport
const PRESENCE_SETTLE_MS = 400;  // wait this long after the first real client joins
                                 // before announcing agents, so the client's handlers
                                 // are registered and its peer-join is not missed

const HOME = { area: 'ow', x: 0, y: 0 }; // fresh clients join at 0,0 -> agents cluster within AOI
const FACINGS = ['down', 'left', 'right', 'up'];

// Player-like display names (distinct pool; de-duped against live names at spawn).
const NAMES = ['Bramble', 'Fenwick', 'Marrow', 'Cinder', 'Rooke', 'Hollow', 'Pike', 'Sable', 'Quillon', 'Ashby', 'Vesper', 'Dunlin'];
const SPELLS = ['emberbolt', 'frostpin', 'mend', 'quakestep', 'sparkwhip'];

// Hero look templates (merged over a defaultHero-shaped base) so an agent renders
// as an ordinary Wayfarer on every client (RemotePlayer merges defaultHero anyway).
const HERO_BASE = {
  job: 'wayfarer', body: 'knight', skin: 'sand', hair: 'mop', hairColor: 'bark',
  top: 'travel', accessory: 'scarf', weapon: 'sword', palette: 'classic',
  eyes: 'dot', eyeColor: 'ink', mark: 'none', starter: {},
};
const HERO_LOOKS = [
  { skin: 'sand', hair: 'mop', hairColor: 'bark', top: 'travel', weapon: 'sword' },
  { job: 'ranger', body: 'ranger', skin: 'tan', hair: 'ponytail', hairColor: 'ash', top: 'hunter', weapon: 'bow' },
  { job: 'mage', body: 'mage', skin: 'pale', hair: 'long', hairColor: 'plum', top: 'robe', weapon: 'wand', accessory: 'none' },
  { job: 'rogue', body: 'rogue', skin: 'deep', hair: 'buzz', hairColor: 'ink', top: 'leather', weapon: 'sai', accessory: 'none' },
];

const clampN = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const areaKey = (a) => (typeof a === 'string' && a && a.length <= 32 ? a : 'ow');
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class AgentsSystem {
  /**
   * @param {object} room  the WayfarerRoom instance (must expose players, social, areas, bcast, sendNear, clients, views)
   * @param {{count?:number, log?:object, auto?:boolean}} [opts]
   */
  constructor(room, opts = {}) {
    this.room = room;
    this.log = opts.log || { info: (...a) => console.log('[agents]', ...a), warn: (...a) => console.warn('[agents]', ...a), error: (...a) => console.error('[agents]', ...a) };
    this.agents = new Map();   // sid -> agent record (same object reference as room.players.get(sid))
    // Optional sink for a completed gather: (agentRecord, nodeKind) => void.
    // The room wires this to the SOL-find ledger so an owned agent's work can be
    // booked against its owner. Never allowed to throw into the AI loop.
    this.onGather = typeof opts.onGather === 'function' ? opts.onGather : null;
    this._seq = 0;
    this._last = Date.now();
    this._presenceAt = 0;
    this.destroyed = false;

    const env = Number(process.env.AGENTS);
    const envCount = Number.isFinite(env) && env >= 0 ? Math.floor(env) : null;
    this.target = Number.isFinite(opts.count) ? Math.max(0, opts.count | 0) : (envCount != null ? envCount : DEFAULT_AGENTS);
    // Ambient agents only populate public world shards, never private co-op rooms.
    // They are spawned once a real player is present (see tick -> _populate) so
    // that the peer-join broadcast reaches a connected client, and so they appear
    // near actual players instead of in an empty world.
    this.auto = opts.auto !== undefined ? !!opts.auto : (this.target > 0 && room.kind === 'world');
  }

  // ── public API ──────────────────────────────────────────────────────────────
  /** Spawn one agent. Returns its player-shaped record (already in room.players). */
  spawn(opts = {}) {
    if (this.destroyed) return null;
    const id = String(opts.id || `a${++this._seq}`);
    const sid = `${AGENT_SID_PREFIX}${id}`;
    if (this.agents.has(sid)) return this.agents.get(sid);
    const a = areaKey(opts.a);
    const x = clampN(opts.x, -20000, 40000, HOME.x);
    const y = clampN(opts.y, -20000, 40000, HOME.y);
    const look = HERO_LOOKS[(this._seq) % HERO_LOOKS.length];
    const name = this._uniqueName(String(opts.name || NAMES[this._seq % NAMES.length]).replace(/[^\w \-']/g, '').trim().slice(0, 14) || 'Wayfarer');
    const level = clampN(opts.level, 1, 99, 3) | 0;
    const job = String((opts.hero && opts.hero.job) || look.job || 'wayfarer').slice(0, 16);
    const hero = { ...HERO_BASE, ...look, ...(opts.hero || {}), name };
    const now = Date.now();
    const rec = {
      sid, name, token: null, hero, x, y, f: 'down', h: 100, a, m: 0,
      agent: true, ownerSid: opts.ownerSid != null ? opts.ownerSid : null,
      joinedAt: now, dc: false, lastMv: now, t: now,
      // NOTE: no `order`, no `buckets`, no `lastSave`, no `warp` — see audit note.
      b: {
        rng: mulberry32(0x9e3779b9 ^ (this._seq * 2654435761)),
        mode: 'wander', tx: null, ty: null, gatherUntil: 0,
        nextAtk: 0, nextCast: now + 1500 + Math.floor(Math.random() * 2000),
        spell: SPELLS[this._seq % SPELLS.length],
        home: { x, y, area: a },
        stats: { gathered: 0, attacks: 0, spells: 0 },
        nodes: [],
      },
    };
    rec.b.nodes = this._genNodes(rec);

    // 1) let the existing replication tick render it (this is the whole point)
    this.room.players.set(sid, rec);
    // 2) register presence exactly like a real join, so presenceOf()/`/who` work
    if (this.room.social && this.room.social.players) {
      this.room.social.players.set(sid, { name, level, job, zone: this._zoneFor(a), guild: '', party: '' });
    }
    // 3) announce the new peer to every real client (agents have no client of
    //    their own, so they cannot receive peer-join — not needed anyway)
    this.agents.set(sid, rec);
    // `agent`/`ownerSid` are the documented client contract (src/net/agentsNet.js
    // reads peer-join.agent === 1 to badge an agent vs a real player); snap.p[]
    // carries `ag` for peers already known to a client. Keep both in sync.
    try { this.room.bcast('peer-join', { sessionId: sid, name, hero, a, agent: 1, ownerSid: rec.ownerSid }); } catch (e) { this.log.error('agent peer-join failed', e.message); }
    this.log.info('agent spawn', { sid, name, a, x, y, job, level });
    return rec;
  }

  /** Remove one agent from BOTH registries and tell clients to drop the puppet. */
  despawn(sid) {
    const a = this.agents.get(sid);
    if (!a) return false;
    this.agents.delete(sid);
    this.room.players.delete(sid);
    if (this.room.social && this.room.social.players) this.room.social.players.delete(sid);
    // clear it from every recipient's AOI delta cache so nobody keeps a ghost
    for (const v of this.room.views?.values() || []) v.p?.delete(sid);
    try { this.room.bcast('peer-leave', { sessionId: sid, name: a.name, wasHost: 0 }); } catch { /* room closing */ }
    this.log.info('agent despawn', { sid, name: a.name });
    return true;
  }

  list() { return [...this.agents.values()]; }
  get(sid) { return this.agents.get(sid) || null; }

  /** Remove every agent owned by this session. Called when its owner leaves, so a
   *  departed player's agent cannot linger and keep earning to a stale session. */
  despawnForOwner(ownerSid) {
    if (!ownerSid) return 0;
    let n = 0;
    for (const a of [...this.agents.values()]) {
      if (a && a.ownerSid === ownerSid) { this.despawn(a.sid); n++; }
    }
    return n;
  }

  /** Behaviour loop, driven from WayfarerRoom.tick(). Never throws out. */
  tick(now = Date.now()) {
    if (this.destroyed) return;
    // Ambient population waits until a real client has been present and settled,
    // so its peer-join lands after the client's message handlers are wired.
    if (this.room.clients.length > 0) { if (!this._presenceAt) this._presenceAt = now; } else this._presenceAt = 0;
    if (this.auto && this.agents.size < this.target && this._presenceAt && now - this._presenceAt >= PRESENCE_SETTLE_MS) {
      try { this._populate(); } catch (e) { this.log.error('agent populate failed', e.message); }
    }
    const dt = Math.min(MAX_DT, Math.max(0, (now - this._last) / 1000));
    this._last = now;
    if (dt <= 0) return;
    for (const a of this.agents.values()) {
      try { this._behave(a, now, dt); } catch (e) { this.log.error('agent tick failed', { sid: a.sid, err: e.message }); }
    }
  }

  /** Room teardown: remove every agent from both registries and stop the loop. */
  destroy() {
    this.destroyed = true;
    for (const sid of [...this.agents.keys()]) { try { this.despawn(sid); } catch { /* closing */ } }
    this.agents.clear();
  }

  // ── population ──────────────────────────────────────────────────────────────
  // Spawn ambient agents around the first real player (same area, inside AOI) so
  // a connected client both receives the peer-join and renders the agent at once.
  _populate() {
    const anchor = this._anchor();
    if (!anchor) return; // no real player yet: agents wait (their point is to be seen)
    let guard = this.target * 2 + 8; // belt-and-braces: never loop forever
    while (!this.destroyed && this.auto && this.agents.size < this.target && guard-- > 0) {
      const i = this._seq;
      const ang = i * 2.399963;                 // golden angle -> even ring
      const rad = 40 + ((i * 53) % 5) * 30;     // 40..160 px from the anchor
      const x = Math.round(anchor.x + Math.cos(ang) * rad);
      const y = Math.round(anchor.y + Math.sin(ang) * rad);
      if (!this.spawn({ a: anchor.a, x, y })) break;
    }
  }

  _anchor() {
    for (const c of this.room.clients) {
      const p = this.room.players.get(c.sessionId);
      if (p && !p.agent) return p;
    }
    return null;
  }

  // ── behaviour ───────────────────────────────────────────────────────────────
  // Priority: (1) engage a hostile within HOSTILE_ENGAGE, (2) work the nearest
  // available gather node within RESOURCE_RADIUS, (3) wander to a waypoint.
  // A spell is cast on an independent cooldown regardless of mode.
  _behave(a, now, dt) {
    const b = a.b;
    const foe = this._nearestEnemy(a);
    if (foe && Math.hypot(foe.x - a.x, foe.y - a.y) <= HOSTILE_ENGAGE) {
      b.mode = 'fight';
      const arrived = this._advance(a, foe.x, foe.y, dt);
      if (arrived && now >= b.nextAtk) { b.nextAtk = now + ATK_CD_MS; b.stats.attacks++; this._act(a, 'atk'); }
    } else {
      const node = this._nearestNode(a, now);
      if (node && Math.hypot(node.x - a.x, node.y - a.y) <= RESOURCE_RADIUS) {
        b.mode = 'gather';
        const d = Math.hypot(node.x - a.x, node.y - a.y);
        if (d > GATHER_RANGE) { this._advance(a, node.x, node.y, dt); b.gatherUntil = 0; }
        else {
          a.m = 0;
          if (!b.gatherUntil) b.gatherUntil = now + GATHER_MS;
          if (now >= b.gatherUntil) { b.gatherUntil = 0; node.cd = now + NODE_CD_MS; b.stats.gathered++; this._act(a, 'gather', node.kind);
            try { this.onGather?.(a, node.kind); } catch (e) { this.log.error('agent onGather failed', e.message); } }
        }
      } else {
        b.mode = 'wander'; b.gatherUntil = 0;
        if (b.tx == null || Math.hypot(b.tx - a.x, b.ty - a.y) < WAYPOINT_NEAR) this._newWaypoint(a);
        this._advance(a, b.tx, b.ty, dt);
      }
    }
    if (now >= b.nextCast) {
      b.nextCast = now + Math.round(CAST_CD_MS * (0.7 + b.rng() * 0.6));
      b.stats.spells++;
      this._act(a, 'cast', b.spell);
    }
  }

  // Move one step of at most SPEED*dt toward (tx,ty). Returns true on arrival.
  _advance(a, tx, ty, dt) {
    const dx = tx - a.x, dy = ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.5) { a.m = 0; return true; }
    const step = SPEED * dt;
    const k = Math.min(step, d);
    a.x += (dx / d) * k;
    a.y += (dy / d) * k;
    a.f = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
    a.m = 1; a.lastMv = Date.now(); a.t = Date.now();
    return d <= step;
  }

  _newWaypoint(a) {
    const b = a.b;
    const ang = b.rng() * Math.PI * 2;
    const rad = 20 + b.rng() * WAYPOINT_RANGE;
    b.tx = Math.round(b.home.x + Math.cos(ang) * rad);
    b.ty = Math.round(b.home.y + Math.sin(ang) * rad);
  }

  _nearestEnemy(a) {
    const ar = this.room.areas && this.room.areas.get(a.a);
    if (!ar || !ar.enemies || !ar.enemies.size) return null;
    let best = null, bd = Infinity;
    for (const e of ar.enemies.values()) {
      const d = Math.hypot(e.x - a.x, e.y - a.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  _nearestNode(a, now) {
    let best = null, bd = Infinity;
    for (const n of a.b.nodes) {
      if (n.cd && n.cd > now) continue;
      const d = Math.hypot(n.x - a.x, n.y - a.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  _genNodes(a) {
    const kinds = ['tree', 'ore', 'herb', 'wood', 'herb', 'ore', 'tree', 'wood'];
    const nodes = [];
    for (let i = 0; i < 8; i++) {
      const ang = a.b.rng() * Math.PI * 2;
      const rad = 60 + a.b.rng() * RESOURCE_RADIUS;
      nodes.push({
        x: Math.round(a.b.home.x + Math.cos(ang) * rad),
        y: Math.round(a.b.home.y + Math.sin(ang) * rad),
        kind: kinds[i % kinds.length], cd: 0,
      });
    }
    return nodes;
  }

  // AOI-scoped action FX for nearby real clients (matches the room's own 'act' shape).
  _act(a, kind, ab) {
    const msg = { sessionId: a.sid, k: kind, x: Math.round(a.x), y: Math.round(a.y), f: a.f, kind };
    if (ab) msg.ab = String(ab).slice(0, 16);
    try { this.room.sendNear(a, 'act', msg); } catch { /* no clients / closing */ }
  }

  _uniqueName(base) {
    const taken = new Set();
    for (const p of this.room.players.values()) taken.add(String(p.name || '').toLowerCase());
    if (this.room.social && this.room.social.players) for (const p of this.room.social.players.values()) taken.add(String(p.name || '').toLowerCase());
    let n = base, i = 1;
    while (taken.has(n.toLowerCase())) n = `${base.slice(0, 12)}${++i}`;
    return n;
  }

  _zoneFor(a) { return a === 'ow' ? 'Embervale' : String(a).slice(0, 24); }
}

module.exports = { AgentsSystem, AGENT_SID_PREFIX, DEFAULT_AGENTS };

// ── null-safety audit note (what this module deliberately does NOT touch) ─────
//  * record keeps token:null and never sets lastSave -> room.persist() early-
//    returns (if !p.token) so agents are NEVER written to DATA_DIR/players.
//  * record has NO `order` and ensureAuth() carries `!q.agent`, so an agent can
//    never become an area's enemy-simulation authority (a.clientOf() is null).
//  * record has NO `buckets`/`warp`/`correctUntil`; the rate buckets and
//    anti-cheat path are only reached from onMessage handlers, which need a
//    real client. Agents receive no messages (no client, no seat).
//  * the only room calls made here are bcast/peer-join, bcast/peer-leave,
//    sendNear('act'), players/social.players mutations, and reads of areas —
//    all of which iterate room.clients (never assume a client for an agent sid).
