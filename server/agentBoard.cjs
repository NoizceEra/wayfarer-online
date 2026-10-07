'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// server/agentBoard.cjs — PUBLIC, read-only board of autonomous agents.
//
// WHAT THIS IS: one GET route (GET /agents) that describes the LIVE agents
// currently in the public world shard(s), so the agent feature is actually SEEN
// over HTTP and can be rendered in-game (src/ui/AgentBoardPanel.js). It reads
// the room's own AgentsSystem (`room.agents.list()` — see server/agents.cjs)
// plus the room's social presence map for a display level. Nothing here writes,
// spawns, despawns or mutates anything.
//
// HONESTY CONTRACT (do not weaken — this is a public surface):
//   * NO price, NO token amount, NO SOL field of any kind. A find ledger exists
//     server-side (agentStore.cjs) but it is owner-keyed and NEVER surfaced here.
//   * Owner data is reduced to a single BOOLEAN (`ownerBacked`). No wallet, no
//     device token, no owner session id, no owner name — nothing identifying.
//   * `id` is the agent's own namespaced session id ('agent:<n>'), which can
//     never collide with (or reveal) a real client's session id.
//   * The SOL claim path is DISABLED by default on this server; the board never
//     says or implies anything is claimable.
//   * ZERO agents is a normal, healthy state: an empty list and HTTP 200, never
//     an error. A compute failure also degrades to an empty 200 list, because an
//     honest empty board beats an error page.
//
// CommonJS (.cjs) on purpose: server/index.js (ESM) loads it with a dynamic
// import, matching the existing optional-module convention (server/guilds.cjs),
// and it pulls in no ESM graph of its own.
// ─────────────────────────────────────────────────────────────────────────────

// Short memo so a burst of refreshes cannot storm the handler. Kept tiny: the
// board is meant to feel live (the client polls on an interval). Mirrors the
// cached-route convention in server/leaderboard.js, just with a shorter TTL
// because agent state changes every tick rather than every day.
const CACHE_TTL_MS = 1000;
let cache = null; // { t, data }

const numOr0 = (v) => (Number.isFinite(+v) ? Math.max(0, Math.floor(+v)) : 0);
// Friendly zone label — mirrors AgentsSystem._zoneFor exactly so the board and
// the in-world presence line never disagree. 'ow' is the overworld = Embervale.
const zoneLabel = (area) => (area === 'ow' ? 'Embervale' : String(area || 'ow').slice(0, 24));

// A single agent -> public row. `presence` is the room's social record
// ({name,level,job,zone,...}) or null; it is the only place a display LEVEL
// lives (the player-shaped agent record itself carries no level field).
function agentRow(rec, presence, now) {
  const stats = (rec && rec.b && rec.b.stats) || {};
  const hero = (rec && rec.hero) || {};
  const joinedAt = Number(rec && rec.joinedAt);
  const levelRaw = presence && presence.level != null ? presence.level : (rec && rec.level);
  return {
    // 'agent:<n>' — a namespaced id that is safe to expose and cannot be a real
    // session id. Never the owner's session id.
    id: String((rec && rec.sid) || ''),
    name: String((rec && rec.name) || 'Wayfarer').slice(0, 14),
    job: String(hero.job || (presence && presence.job) || 'wayfarer').slice(0, 16),
    level: Number.isFinite(+levelRaw) ? Math.max(1, Math.floor(+levelRaw)) : null,
    zone: zoneLabel(rec && rec.a),
    area: String((rec && rec.a) || 'ow').slice(0, 32),
    // Behaviour mode from the runtime: wander | gather | fight | follow | arena.
    action: String((rec && rec.b && rec.b.mode) || 'idle').slice(0, 24),
    gathered: numOr0(stats.gathered),
    // Agents do not claim kills on this server (they never mutate area enemy
    // state — see docs/AGENT_RUNTIME.md), so this is the real, honest value.
    kills: numOr0(stats.kills),
    uptimeMs: Number.isFinite(joinedAt) ? Math.max(0, now - joinedAt) : 0,
    // BOOLEAN ONLY. Ambient agents are false; an owner's agent/hireling is true.
    // The owner's identity (sid/wallet/device/name) is deliberately NOT included.
    ownerBacked: !!(rec && rec.ownerSid),
  };
}

// Pure: (iterable of rooms, { world, now }) -> public board object.
// Only public 'world' rooms are read: party room ids are join credentials
// (see the note in server/index.js /stats) and must never be exposed.
function buildBoard(rooms, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const all = rooms && typeof rooms[Symbol.iterator] === 'function' ? [...rooms] : [];
  const agents = [];
  for (const room of all) {
    if (!room || room.kind !== 'world') continue;
    const sys = room.agents;
    if (!sys || typeof sys.list !== 'function') continue;
    let list;
    try { list = sys.list(); } catch { continue; } // a broken room never breaks the board
    const presence = room.social && room.social.players;
    for (const rec of list || []) {
      if (!rec || rec.agent !== true) continue; // only genuine agent records
      agents.push(agentRow(rec, presence && typeof presence.get === 'function' ? presence.get(rec.sid) : null, now));
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  return {
    ok: true,
    updatedAt: now,
    world: opts.world != null ? String(opts.world) : null,
    agents,
    summary: {
      total: agents.length,
      gathered: agents.reduce((s, a) => s + a.gathered, 0),
      kills: agents.reduce((s, a) => s + a.kills, 0),
    },
  };
}

function emptyBoard(world) {
  return { ok: true, updatedAt: Date.now(), world: world != null ? String(world) : null, agents: [], summary: { total: 0, gathered: 0, kills: 0 } };
}

// Mount into server/index.js: app.get('/agents', ...). Same style as the other
// routes there: a single handler, res.json(...), and an honest degraded result
// instead of a 500 on failure.
//   deps = { rooms: LIVE_ROOMS (any iterable), worldName: CFG.WORLD_NAME }
function routes(app, deps = {}) {
  const roomsRef = deps.rooms;
  const worldName = deps.worldName;
  app.get('/agents', (req, res) => {
    try {
      const now = Date.now();
      if (cache && now - cache.t < CACHE_TTL_MS) { res.json(cache.data); return; }
      const data = buildBoard(roomsRef, { world: worldName, now });
      cache = { t: now, data };
      res.json(data);
    } catch (e) {
      // Never 500 a public board. Zero agents (or a compute hiccup) is an empty
      // list + 200, exactly like a healthy empty world.
      res.json(emptyBoard(worldName));
    }
  });
}

module.exports = { routes, buildBoard, agentRow, zoneLabel, CACHE_TTL_MS };
