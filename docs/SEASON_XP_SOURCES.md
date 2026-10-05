# Season XP Sources

How season XP is earned, what caps it, and which real client signals feed it.
Season: `season_01_remnant` · 50 tiers · 1500 XP/tier · global daily cap **6500 XP**.

## Awards table (per event → `earnXp(source, amount)`)

| Gameplay event | `source` | XP/event | Source daily cap | Max full awards/day |
|---|---|---|---|---|
| Dungeon completion | `dungeonClear` | 1200 (= config base) | 2400 | 2 clears |
| World-boss kill participation | `kill` | 500 (= 20× kill base 25) | 2000 (shared with grind kills) | 4 participations (fewer if grinding) |
| Arena match win (losses: 0) | `pvpDuel` | 300 (= config base) | 1500 | 5 wins |
| Quest completion (incl. repeatable bounties) | `quest` | 400 (= config base) | 3000 | ~7 quests |
| Daily login (existing, untouched) | `dailyLogin` | 500 | 500 | 1 |

All amounts derive from `SEASON_CONFIG` in `src/data/seasons.js` (world-boss = 20×
`kill.base`); caps live in `SEASON_CONFIG.sourceCaps` + `dailyXpCap`.

## Anti-farm enforcement (server, authoritative)

`server/season.js` → `clampXpSource()` applies, in order, per award:

1. Unknown `source` (no config/cap entry) grants **0**.
2. Per-source daily cap clips the award (overflow discarded, `sourceXp` ledger kept).
3. Global `dailyXpCap` (6500) clips whatever remains.

No `server/season.js` change was needed: all four sources above already exist in
`SEASON_CONFIG.sources`/`sourceCaps`, so the existing clamp covers them.
Client awards are requests only — the server ledger decides.

## Wiring (client)

`src/systems/seasonSystem.js` → `SeasonSystem.attachGameSources({ dungeons, arena, playerName })`
subscribes to the real completion signals and calls the existing `earnXp` path.
Idempotent (re-attach detaches first); `detachGameSources()` / `destroy()` clean up.

Parent hook (e.g. `UIScene`, which owns `dungeonSystem` + `seasonSystem`):

```js
seasonSystem.attachGameSources({
  dungeons: this.dungeonSystem,
  arena: arenaNet,          // src/net/arenaNet.js
  playerName: playerName,   // used to check world-boss contributors
});
```

## Per-source event evidence

- **Dungeon**: `DUNGEON_EVENTS.COMPLETE = 'dungeon:complete'` —
  `src/systems/dungeonSystem.js:23` (const), `:114` (`complete()` local/solo runs),
  `:182` (`handleComplete()` server-driven). Both paths emit the same event.
- **World boss**: bus `Events.WORLDBOSS_SLAIN = 'worldboss-slain'` —
  `src/core/events.js:45` (const), emitted `src/net/worldBossNet.js:37` from the
  server-authoritative `worldboss-slain { name, killerName, contributors }` broadcast.
  Participation filter: if `playerName` is supplied and a non-empty contributors
  list names others, the award is skipped.
- **Arena**: `arenaNet.onResult` — `src/net/arenaNet.js:96` (sub), `:22` (payload
  shape `{ matchId, winner, winnerName, reason, you }`). Win-only gate:
  `Number(m.you.delta) > 0` — the server sends `+delta` to the winner and `-delta`
  to the loser (`server/arena.js:274-278`). Losses award nothing. Server-side
  anti-farm already exists: same-pair rematch cooldown 60s (`PAIR_CD_MS`) and
  one-report-settles-a-match (`server/arena.js:51,263-264`).
- **Quest**: bus `Events.ACH_EVENT = 'ach-event'` with `{ k: 'quest', … }` —
  `src/core/events.js:33` (const), emitted `src/systems/questSystem.js:222` inside
  `complete()` (`:206-234`) on every successful turn-in. There is **no dedicated**
  `quest:complete` bus event (see below).

## Missing hooks (for the parent / engine owners — not faked here)

1. **No dedicated quest-completion bus event.** Quest XP keys off `ach-event` with
   `k === 'quest'`. If the engine ever emits other `k:'quest'` achievement events
   unrelated to turn-ins, they would over-award (still capped server-side).
   Suggested: emit `bus.emit('quest:complete', { id, bounty })` from
   `questSystem.complete()` and subscribe to that instead.
2. **World-boss participation identity.** The contributors list carries display
   names; pass the local `playerName` into `attachGameSources` for the
   skip-if-absent check, otherwise any slain broadcast awards. Stronger fix:
   server includes sessionIds in contributors or sends a per-participant award.
3. **Arena win relies on `you.delta` sign.** Correct per current
   `server/arena.js`, but if the result payload shape changes, the gate must follow.
4. **Dungeon solo/offline clears also award** (`complete()` fires locally). This is
   by design — the 2400/day source cap bounds it — but a stricter parent could
   pass only the networked dungeon system instance.
