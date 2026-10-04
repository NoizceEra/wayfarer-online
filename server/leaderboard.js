import fs from 'fs';
import path from 'path';
import { CFG } from './config.js';
import { log } from './log.js';
import { storeDir } from './store.js';

// Leaderboard: server-computed top players from the file-backed character store.
// Categories: level, gold, season, pets, arena. Results are cached for 60s.
//
// GET /leaderboard?type=<type>&limit=<n>
//   type  = level | gold | season | pets | arena
//   limit = 1..100 (default 20)
// Response: { ok, type, updatedAt, entries:[{rank,name,level,job,value,extras?}] }

const CACHE_TTL_MS = 60_000;
const VALID_TYPES = new Set(['level', 'gold', 'season', 'pets', 'arena']);
const DEFAULT_LIMIT = 20;

let cache = new Map(); // type -> { t, entries }

function readPlayers() {
  const dir = storeDir();
  const chars = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      let doc;
      try { doc = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); }
      catch { continue; }
      if (!doc || typeof doc.chars !== 'object') continue;
      for (const lower of Object.keys(doc.chars)) {
        const c = doc.chars[lower];
        if (!c?.progress) continue;
        chars.push({ name: c.name || lower, progress: c.progress, hero: c.hero || {} });
      }
    }
  } catch (e) {
    log.warn('leaderboard read failed', { err: e.message });
  }
  return chars;
}

function compute(type, limit) {
  const players = readPlayers();
  const entries = players.map((p) => {
    const prog = p.progress;
    const ext = prog.ext || {};
    let value = 0;
    let extras = {};
    switch (type) {
      case 'level': value = prog.level || 1; break;
      case 'gold': value = prog.gold || 0; break;
      case 'season': value = ext.season?.xp || 0; break;
      case 'pets': value = (ext.pets?.roster?.length || 0) + (ext.pets?.active !== undefined ? 0 : 0); break;
      case 'arena': {
        const a = ext.arena || { rating: 1000, wins: 0, losses: 0 };
        value = a.rating || 1000;
        extras = { wins: a.wins || 0, losses: a.losses || 0 };
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
    let limit = Math.max(1, Math.min(100, Number(req.query.limit) || DEFAULT_LIMIT));
    if (!Number.isFinite(limit)) limit = DEFAULT_LIMIT;

    const now = Date.now();
    const cached = cache.get(type);
    if (cached && now - cached.t < CACHE_TTL_MS) {
      res.json({ ok: true, ...cached.data, cached: true });
      return;
    }

    try {
      const data = compute(type, limit);
      cache.set(type, { t: now, data });
      res.json({ ok: true, ...data, cached: false });
    } catch (e) {
      log.error('leaderboard compute failed', { err: e.message });
      res.status(500).json({ ok: false, error: 'compute_failed' });
    }
  });
}
