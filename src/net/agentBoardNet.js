import { CONFIG } from '../config.js';

// Client fetch for the public World-Agents board (GET /agents).
//
// The API base is derived from CONFIG.serverUrl with the ws->http scheme swap —
// exactly like src/net/leaderboardNet.js. It is NEVER built from window.location:
// the game is served from a static host, so window.location would hit the static
// site (404) instead of the relay that actually owns the agents.
const API = (() => {
  try {
    return CONFIG.serverUrl.replace(/^ws/, 'http');
  } catch { return ''; }
})();

export async function fetchAgentBoard() {
  const res = await fetch(`${API}/agents`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Agent board fetch failed: ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'agent_board_error');
  // Dollar-honest shape: { ok, updatedAt, world, agents:[...], summary:{...} }.
  // Defensive defaults so a sparse/older relay can never crash the panel.
  return {
    ok: true,
    updatedAt: Number.isFinite(data.updatedAt) ? data.updatedAt : Date.now(),
    world: data.world || null,
    agents: Array.isArray(data.agents) ? data.agents : [],
    summary: data.summary && typeof data.summary === 'object'
      ? { total: +data.summary.total || 0, gathered: +data.summary.gathered || 0, kills: +data.summary.kills || 0 }
      : { total: 0, gathered: 0, kills: 0 },
  };
}
