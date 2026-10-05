# Arena Ladder — End-to-End Loop

How a settled PvP match becomes a visible ladder row, and how each hop was verified.

## The loop

```
match settle (server/arena.js, arena:report handler)
  -> rec.progress.ext.arena = { rating, wins, losses }   (setRating -> saveChar, file-backed store)
  -> GET /leaderboard?type=arena                          (server/leaderboard.js, compute arena branch)
  -> LeaderboardPanel ARENA tab                           (src/ui/LeaderboardPanel.js, rating + W/L)
```

1. **Match settle -> `ext.arena`.** The `arena:report` handler (`server/arena.js`,
   `install()` -> `on('arena:report', ...)`) consumes the match, runs ELO
   (`eloDelta`, K=32, start 1000, floor 100), and calls `setRating()` for
   winner and loser. `setRating` writes `rec.progress.ext.arena = { rating,
   wins, losses }` back through `saveChar(token, name, rec)` — the same
   file-backed character store every other system reads. Verified by code-path
   reading (settle lines ~255-281 -> `setRating` lines ~78-92).
2. **`ext.arena` -> `/leaderboard`.** `GET /leaderboard?type=arena`
   (`server/leaderboard.js`) enumerates characters via `listAllChars()` from
   `server/store.js` (reads `DATA_DIR/players/*.json` live on every
   uncached request), takes `progress.ext.arena`, sanitizes it (finite-number
   rating, floor 100 to match `arena.js`; wins/losses clamped to >= 0
   integers), and sorts **rating desc**, ties by name. Each entry carries
   `extras: { wins, losses, games }` so the UI can render W/L. Verified live
   against a scratch relay (see Evidence).
3. **`/leaderboard` -> panel.** `LeaderboardPanel` (`src/ui/LeaderboardPanel.js`)
   fetches via `fetchLeaderboard('arena', limit)` and renders
   `<value> <W>W / <L>L` per row from `extras`. After any `arena:result`
   message it clears the 30s client cache (`clearLeaderboardCache()`) and
   re-runs its existing `refresh()` path — but only when the panel is visible
   **and** the arena tab is selected, so background tabs don't churn. Personal
   rating display stays in `ArenaPanel` (RATING + W/L), which updates from the
   same `arena:result` payload; the ladder is the public view of the same data.

## Empty / unplayed states

- **Empty ladder** (no characters on the relay): `/leaderboard?type=arena`
  returns `{ ok: true, entries: [] }`; the panel shows
  "No rankings yet — be the first!" (existing path, kept).
- **All-default ladder** (characters exist but nobody has fought: every rating
  still 1000 with 0 recorded games): rows render normally plus an explicit
  note — "No arena matches recorded yet — everyone starts at 1000. Win a duel
  to climb!" — so a fresh ladder is never mistaken for a broken one.

## Caching notes (staleness bounds)

- Server caches each `type:limit` for 60s; client caches each `type:limit`
  for 30s. A freshly settled match appears in the ladder at most ~60s late on
  a cold fetch, sooner if the panel's post-match refresh already re-fetched.
- The tab buttons and REFRESH button both clear the client cache first.

## Verification evidence (2026-10-05)

- `node --check server/leaderboard.js` -> exit 0 (3310 bytes).
- `node --check src/ui/LeaderboardPanel.js` -> exit 0 (7542 bytes).
- Scratch relay: `DATA_DIR=D:/tmp/lb-proof PORT=2699 node server/index.js`
  (stock relay, no code changes for the probe).
  - Before seeding: `GET /leaderboard?type=arena&limit=5` ->
    `{"ok":true,"type":"arena","entries":[],"cached":false}` (empty-ladder path).
  - Seeded one device file `players/<sha256(token)[0:32]>.json` with two chars
    carrying `progress.ext.arena` (`ArenaPro` 1248/5W-2L, `ArenaNewb`
    1000/0W-0L — the exact shape `setRating` persists).
  - After seeding: `GET /leaderboard?type=arena&limit=5` ->
    `entries:[{rank:1,name:ArenaPro,value:1248,extras:{wins:5,losses:2,games:7}},
    {rank:2,name:ArenaNewb,value:1000,extras:{wins:0,losses:0,games:0}}]` —
    rating-desc sort + W/L extras confirmed.
  - Panel refresh path verified by code (constructor `arenaNet.onResult`
    subscription -> `clearLeaderboardCache()` -> `refresh()`); no browser was
    driven in this pass.

## Files

- `server/leaderboard.js` — hardened arena branch (finite-number rating,
  floor 100, int W/L + `games`; `progress`/`ext` null-guards).
- `src/ui/LeaderboardPanel.js` — post-match auto-refresh subscription,
  all-default-1000 ladder note, `destroy()` (unsubscribes + removes element;
  `economyUI.destroy()` already calls it).
- `docs/ARENA_LADDER.md` — this file.
