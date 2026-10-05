import { log } from './log.js';
import { listAllChars } from './store.js';

// Leaderboard: server-computed top players from the configured character store.
// Categories: level, gold, season, pets, arena. Results are cached for 60s.
//
// GET /leaderboard?type=<type>&limit=<n>
//   type  = level | gold | season | pets | arena
//   limit = 1..100 (default 20)
// Response: { ok, type, updatedAt, entries:[{rank,name,level,job,value,extras?}] }

const CACHE_TTL_MS = 60_000;
const VALID_TYPES = new Set(['level', 'gold', 'season', 'pets', 'arena']);
const DEFAULT_LIMIT = 20;

let cache = new Map(); // `${type}:${limit}` -> { t, data }

function readPlayers() {
  try {
    return listAllChars();
  } catch (e) {
    log.warn('leaderboard read failed', { err: e.message });
    return [];
  }
}

function compute(type, limit) {
  const players = readPlayers();
  const entries = players.map((p) => {
    const prog = p.progress || {};
    const ext = (prog && typeof prog.ext === 'object' ? prog.ext : null) || {};
    let value = 0;
    let extras = {};
    switch (type) {
      case 'level': value = prog.level || 1; break;
      case 'gold': value = prog.gold || 0; break;
      case 'season': value = ext.season?.xp || 0; break;
      case 'pets': value = (ext.pets?.roster?.length || 0) + (ext.pets?.active !== undefined ? 0 : 0); break;
      case 'arena': {
        // Rating sort desc; sanitize so a malformed ext.arena can never
        // poison the sort (NaN) or the display. Floor 100 matches arena.js.
        const a = (ext.arena && typeof ext.arena === 'object') ? ext.arena : null;
        const rating = Number.isFinite(+a?.rating) ? Math.max(100, Math.round(+a.rating)) : 1000;
        const wins = Math.max(0, +a?.wins | 0);
        const losses = Math.max(0, +a?.losses | 0);
        value = rating;
        extras = { wins, losses, games: wins + losses };
        break;
      }
    }
    return {
      name: String(p.name || 'Wayfarer').slice(0, 14),
      level: prog.level || 1,
      job: (p.hero?.job?.name) || 'Wayfarer',
      value,
      extras,
    };
  });

  entries.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  const ranked = entries.slice(0, limit).map((e, i) => ({ rank: i + 1, ...e }));
  return { type, updatedAt: Date.now(), entries: ranked };
}

export function routes(app) {
  app.get('/leaderboard', (req, res) => {
    const type = String(req.query.type || 'level').toLowerCase();
    if (!VALID_TYPES.has(type)) {
      res.status(400).json({ ok: false, error: 'invalid_type', valid: [...VALID_TYPES] });
      return;
    }
    let limit = Math.floor(Math.max(1, Math.min(100, Number(req.query.limit) || DEFAULT_LIMIT)));
    if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;

    const now = Date.now();
    // One cache entry per TYPE (top 100), sliced per request: keying by
    // type+limit let a client force up to 500 full store scans per minute
    // (limit=1..100), each a synchronous read of every character file.
    const cached = cache.get(type);
    const slice = (data) => ({ ...data, entries: data.entries.slice(0, limit) });
    if (cached && now - cached.t < CACHE_TTL_MS) {
      res.json({ ok: true, ...slice(cached.data), cached: true });
      return;
    }

    try {
      const data = compute(type, 100);
      cache.set(type, { t: now, data });
      res.json({ ok: true, ...slice(data), cached: false });
    } catch (e) {
      log.error('leaderboard compute failed', { err: e.message });
      res.status(500).json({ ok: false, error: 'compute_failed' });
    }
  });
}
