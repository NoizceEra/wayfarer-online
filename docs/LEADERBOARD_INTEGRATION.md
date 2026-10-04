# Leaderboard Integration

## Files added / changed

| File | Purpose |
|------|---------|
| `server/leaderboard.js` | Computes top players from the file-backed store with 60s caching. |
| `server/index.js` | Imports and registers `leaderboard.routes(app)`. |
| `src/net/leaderboardNet.js` | Client fetch helper + 30s client cache. |
| `src/ui/LeaderboardPanel.js` | DOM overlay with category tabs and ranked list. |
| `src/ui/economyUI.js` | Instantiates panel, wires `/leaderboard` slash command, exposes `window.__econUI.leaderboardPanel`. |
| `docs/LEADERBOARD_INTEGRATION.md` | This document. |

## API

`GET /leaderboard?type=<type>&limit=<n>`

Types:
- `level` — player level
- `gold` — gold held
- `season` — season pass XP (`ext.season.xp`)
- `pets` — number of pets in roster
- `arena` — arena rating (`ext.arena.rating`)

Response:
```json
{
  "ok": true,
  "type": "level",
  "updatedAt": 1696396800000,
  "entries": [
    { "rank": 1, "name": "Pip", "level": 12, "job": "Wayfarer", "value": 12 }
  ],
  "cached": false
}
```

## Slash command

`/leaderboard` or `/lb` toggles the panel.

## Style

Uses the shared Solana pixel palette via `#wf-social` overlay (Silkscreen font, wood/dark panels).
