# World Agents board

A **public, read-only** view of the autonomous agents currently in the world. It
makes the agent feature *seen*: real players open an in-game panel backed by a
single HTTP endpoint, and anyone can fetch the same JSON.

- **Server:** `server/agentBoard.cjs` — one route, `GET /agents`
  (CommonJS, loaded by `server/index.js` like `guilds.cjs`).
- **Client fetch:** `src/net/agentBoardNet.js` (`fetchAgentBoard()`).
- **In-game UI:** `src/ui/AgentBoardPanel.js`, opened from the `📡` HUD icon in
  `src/scenes/UIScene.js`.

Nothing here writes, spawns, despawns or mutates agents. It reads the world
room's own [`AgentsSystem`](./AGENT_RUNTIME.md) (`room.agents.list()`) plus the
room's social presence map (for a display level). See
[`AGENT_RUNTIME.md`](./AGENT_RUNTIME.md) for how agents are created and run.

## `GET /agents`

No query parameters. Always `200`; JSON, `no-store`-style live data.

```jsonc
{
  "ok": true,
  "updatedAt": 1759800000000,        // server ms when computed
  "world": "Embervale-1",            // public world-shard name (same as /stats.world)
  "agents": [
    {
      "id": "agent:3",               // namespaced agent id; NEVER a real session id
      "name": "Marrow",              // display name (<=14 chars)
      "job": "ranger",               // hero job (<=16 chars)
      "level": 3,                    // display level, or null if unknown
      "zone": "Embervale",           // friendly zone label ('ow' -> 'Embervale')
      "area": "ow",                  // raw area key the agent is in
      "action": "gather",            // wander | gather | fight | follow | arena | idle
      "gathered": 7,                 // completed gathers (integer, >= 0)
      "kills": 0,                    // see "Kills" below — always 0 on this server
      "uptimeMs": 84210,             // ms since the agent spawned
      "ownerBacked": false           // BOOLEAN ONLY: true if an owner's agent/hireling
    }
  ],
  "summary": { "total": 12, "gathered": 61, "kills": 0 }
}
```

Only public **world** shards are read. Private party rooms are excluded on
purpose — their room ids are join credentials (see the note on `/stats` in
`server/index.js`).

### Degradation

- **Zero agents** (the shipped default — ambient agents are opt-in via
  `AGENTS=<n>`) returns an empty `agents` array, `summary.total: 0`, and `200`.
  It is a normal state, not an error.
- Any internal compute failure also returns an empty `200` board
  (`{ ok:true, agents:[], summary:{total:0,...} }`) rather than a `500`: an
  honest empty board beats an error page on a public surface.
- Results are memoized for **1 second** (mirrors the cached-route convention in
  `server/leaderboard.js`, with a shorter TTL because agent state changes every
  tick). Fresh enough to feel live, cheap enough to absorb refresh bursts.

## Honesty rules (do not weaken)

This is a public, unauthenticated surface. It is honest by construction:

1. **No price, ever.** No token price, no USD value, no market data of any kind
   is present in the response or is inferred client-side.
2. **No SOL, ever.** The board exposes no SOL/token amount and never says or
   implies anything is *claimable*. The SOL claim path is **disabled by
   default** on this server (`agentRewards.claimConfig()`); a find ledger exists
   server-side (`agentStore.cjs`) but it is owner-keyed and is never surfaced
   here.
3. **Owner data is a boolean, nothing more.** `ownerBacked` is `true` for an
   owner's agent/hireling and `false` for an ambient agent. There is **no**
   wallet address, device token, owner session id, owner name, or any other
   identifying field — not even the owner's presence in aggregate.
4. **`id` is the agent's own namespaced id** (`agent:<n>`), which cannot collide
   with and cannot reveal a real client's Colyseus session id.
5. **No fabrication.** Every field is read from live server state. Unknown
   values are `null`/omitted, never guessed.

### Kills

Agents read server-side area enemy state but **do not mutate it** and never
claim kills (see "Behaviour" in `AGENT_RUNTIME.md`). The runtime therefore keeps
no kill counter, and this board reports the honest value: `kills: 0`. The field
is present so the shape is stable; it is not a placeholder for real numbers.

## Client

- `src/net/agentBoardNet.js` derives its API base from `CONFIG.serverUrl` with a
  `ws`→`http` scheme swap (exactly like `src/net/leaderboardNet.js`). It is
  **never** built from `window.location` — the game is served from a static host,
  so `window.location` would hit the static site (404) instead of the relay that
  owns the agents.
- `src/ui/AgentBoardPanel.js` is a DOM overlay in the shared social idiom
  (`#wf-social` root, `src/ui/socialDom.js`). It renders one row per agent —
  **name · job Lv · zone · action · gathered · kills** plus a summary line — and
  refreshes on a 5-second interval while open. When the board is empty it shows
  the friendly, honest state **"No agents in the world right now."**; if the
  fetch fails it says the board is unreachable and never fabricates rows.
- `src/scenes/UIScene.js` registers a `📡` HUD icon next to the agent icon that
  toggles the panel, an `input.addCloser({ id:'agent-board', ... })` entry so
  **Esc** closes it, and destroys both the button and the panel in the scene's
  `shutdown` handler.

## Verification

- `node --check` on every touched file.
- A relay spawned as a child with `AGENTS=1` (its own port + `DATA_DIR`), a real
  Colyseus client joining the world shard to trigger ambient population, then
  `GET /agents` returning real rows.
- A headless Chrome boot of the built client: opening the panel renders the agent
  rows with zero page errors.
