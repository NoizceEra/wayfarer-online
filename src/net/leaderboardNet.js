import { CONFIG } from '../config.js';

const API = (() => {
  try {
    return CONFIG.serverUrl.replace(/^ws/, 'http');
  } catch { return ''; }
})();

let cache = null;
let cacheType = null;
let cacheAt = 0;
const CACHE_MS = 30_000;

export async function fetchLeaderboard(type = 'level', limit = 20) {
  const now = Date.now();
  if (cache && cacheType === `${type}:${limit}` && now - cacheAt < CACHE_MS) return cache;
  const res = await fetch(`${API}/leaderboard?type=${encodeURIComponent(type)}&limit=${encodeURIComponent(limit)}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Leaderboard fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'leaderboard_error');
  cache = data;
  cacheType = `${type}:${limit}`;
  cacheAt = now;
  return data;
}

export function clearLeaderboardCache() {
  cache = null; cacheType = null; cacheAt = 0;
}
