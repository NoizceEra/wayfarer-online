# Achievements Wave 3 — arena, housing, tutorial, season, pets

16 new achievements appended to `src/systems/achievements.js` (36 → 52 total).
All triggers reuse existing bump/check patterns: `bump(counter)` on an
`ACH_EVENT`-style `{k}` key, or a polled read of state the `Achievements.ctx()`
already has access to. Rewards are modest `{xp, gold, mats}` bundles granted
through the existing grant path (`questSystem.grant()`, `questSystem.js:183-197`).

## Arena (5)

| id | trigger | counter/event reused | reward |
|---|---|---|---|
| `arena_first` | enter first arena match | `arenaNet.onMatch` (`src/net/arenaNet.js:93`, same sub shape `ArenaPanel` `src/ui/ArenaPanel.js:74` uses) → `bump('arena_matches')` | 100 xp, 50g |
| `arena_win1` | win first arena match | `arenaNet.onResult` (`src/net/arenaNet.js:96`); winner-only `you.delta > 0` test copied from `seasonSystem.attachGameSources` (`src/systems/seasonSystem.js:147-152`) → `bump('arena_wins')` | 200 xp, 100g |
| `arena_wins10` | win 10 arena matches | same as above, threshold 10 | 500 xp, 250g |
| `arena_1200` | reach 1200 arena rating | `arena:rating {rating, wins, losses}` payload (`src/net/arenaNet.js:23`) via `onRating`/`onResult.you.rating` → `noteBest('arena_best')` | 400 xp, 200g |
| `arena_1500` | reach 1500 arena rating | same as above, threshold 1500 | 800 xp, 400g |

Note: losses emit `{k:'arena_loss'}`, which hits the existing `default:` no-op in
`onEvent` but still runs `check()` — same as any unhandled key today.

## Housing (4)

All four read `meta.housing` exposed via `ctx()` (`meta` is `saved.ext`, which
includes normalized housing per `src/core/save.js:138`; `WorldScene.js:90`).

| id | trigger | state reused | reward |
|---|---|---|---|
| `home_island` | unlock home island | `housing.unlocked` (shape in `src/data/housing.js:77-89`) | 150 xp, 100g |
| `home_furnish` | place first furniture | `housing.layout.length >= 1` (placed at `HomeIslandScene.js:173`) | 100 xp, 50g |
| `home_furnish5` | place 5 furniture | same, threshold 5 | 300 xp, 150g, 2x oak_log |
| `home_harvest` | claim garden yield | `housing.yieldClaim.date` set by `claimDaily()` (`HomeIslandScene.js:209-233`) | 100 xp, 2x dewberry |

Material ids (`oak_log`, `dewberry`) are existing gathering mats
(`src/systems/gathering.js:30`, `:28`).

## Tutorial (1)

| id | trigger | counter/event reused | reward |
|---|---|---|---|
| `tut_chain` | complete the tutorial questline (First Steps → Egg Tales) | `questSystem.complete()` emits `{k:'chain', id}` (`src/systems/questSystem.js:223-227`); chain id `'tutorial'` (`src/data/quests/tutorial2.js`); `onEvent 'chain'` now also bumps `chain_<id>` (same `bump` pattern) | 250 xp, 150g |

## Season (3)

Season state is owned by UIScene's `SeasonSystem` (local emitter, not bus:
`src/systems/seasonSystem.js:17`, constructed `src/scenes/UIScene.js:438`).
`check()` mirrors the best tier seen into `counters.season_best` via the shared
`window.__econUI.seasonSystem.getState()` handle (`src/ui/economyUI.js:116-120`,
`getState()` at `src/systems/seasonSystem.js:176-182`). Guarded: offline or
UI-not-ready keeps the stored best. Season is 50 tiers (`src/data/seasons.js:12`),
so all milestones are reachable.

| id | trigger | counter reused | reward |
|---|---|---|---|
| `season3` | reach season tier 3 | `season_best >= 3` | 200 xp, 100g |
| `season5` | reach season tier 5 | `season_best >= 5` | 350 xp, 175g |
| `season10` | reach season tier 10 | `season_best >= 10` | 600 xp, 300g |

## Pets (3)

| id | trigger | event reused | reward |
|---|---|---|---|
| `pet_hatch` | hatch first pet | bus `PET_HATCH` (`src/core/events.js:48`), emitted by `petMaster.js:68` and `petEncounter.js:247`; `questSystem.onPetHatch` (`questSystem.js:257`) proves the same event drives quest objectives → `bump('hatches')` | 150 xp, 75g |
| `pet_duel` | take part in a pet duel | bus `PET_DUEL_START` (`src/core/events.js:46`), emitted `src/net/socialNet.js:42` → `bump('petduels')` | 100 xp, 50g |
| `pet_duels5` | take part in 5 pet duels | same, threshold 5 | 300 xp, 150g |

## Implementation notes (all inside `src/systems/achievements.js`)

- `C()` gained an optional 6th `reward` arg; existing 36 defs untouched.
- `onEvent` gained cases `arena_match`, `arena_win`, `hatch`, `petduel`, and the
  `chain` case additionally bumps `chain_<id>` — all plain `bump()` calls.
- `arena_best` / `season_best` use `noteBest()` (monotonic max into the same
  `meta.counters` store the tests read); needed because `bump()` is
  increment-only and ratings/tiers are levels, not counts.
- Rewards granted in `check()` via `this.scene.quests.grant(reward)` with a
  guarded direct gold/XP fallback. No new reward types: only `xp`, `gold`,
  `mats` — all fields `grant()` already handles.
- New subscriptions (`arenaNet.on*`, `bus PET_HATCH`/`PET_DUEL_START`) are
  unsubscribed in `destroy()`, mirroring the existing `off`/`lvOff` pattern.
- `JournalPanel` imports `ACHIEVEMENTS` directly, so the 16 new entries appear
  with progress bars and no panel changes.
