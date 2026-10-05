# Sync Events Audit — event bus ↔ achievements ↔ arena ladder

Scope: `src/core/events.js`, `src/systems/achievements.js`, `server/arena.js`,
`server/leaderboard.js`, `src/ui/LeaderboardPanel.js`.
Method: static grep of the whole `src/` tree plus an executed Node harness
(stubbed bus) and a live scratch relay on `:2699`. Baseline commit `61b786e`.

## 1. Event bus bidirectional audit

`Events` defines 43 constants. Every constant was checked for (a) `Events.NAME`
emit/subscribe references, (b) raw-string `bus.emit('…')` / `bus.on('…')` /
`onScene(…, '…')` uses of its value. Raw-string emit/subscribe counts that
match a constant value are proof the channel is live but typo-fragile.

### A. Dead constants — defined, never emitted, never subscribed

| Constant | Value | Notes |
|---|---|---|
| `SHOP` | `shop` | Zero references repo-wide. The gear shop opens via `Events.GEAR {open:'shop'}`, not this channel. |
| `LOOT` | `loot` | Zero references repo-wide. Loot toasts ride `Events.TOAST` / `Events.ACH_EVENT`. |
| `REFERRAL_TOKEN_STATS` | `referral-token-stats` | Zero references on the bus. `referralNet.js:24` subscribes to the *relay* channel `net.on('referral-token-stats')`, which is a different emitter. |
| `REVIVE_OFFER` | `revive-offer` | Only a doc-comment reference in `RevivePanel.js:7`; no emitter, no subscriber. |

Per the file's append-only contract ("add new events, never rename") these were
**left in place**; deleting them would break the public-surface contract for
downstream forks. They are inert.

### B. Raw string literals where a constant exists

| Value | Constant | Raw emit sites | Verdict |
|---|---|---|---|
| `worldboss-spawn` | `WORLDBOSS_SPAWN` | `src/net/worldBossNet.js:19`, `:27` | Channel **works** (subscribers in `UIScene.js`/`WorldScene.js` use `Events.WORLDBOSS_SPAWN`; the literal is byte-identical). Typo risk only — see Parent work. |

Raw literal with **no** constant (consistent emit+subscribe, informational):

| Value | emit sites | subscribe site |
|---|---|---|
| `econ-ui` | `UIScene.js:623`, `economyUI.js:162`, `townfolk.js:89` | `economyUI.js:97` |

`econ-ui` is not in `Events`; it round-trips correctly because both sides use the
same literal. No constant exists to adopt, so nothing to fix.

### C. Dead listeners — subscribed, never emitted

| Constant | Value | Listener | Producer |
|---|---|---|---|
| `PARTY_KILL` | `party-kill` | `src/systems/combat.js:79` (`onPartyKill`, handler `:279`) | **None anywhere.** The live party-XP share path is `social/index.js` `onPartyXp` (`party-xp` relay message → `grantXp`), which does not emit this event. The combat handler is unreachable. |

### D. Dead emits — emitted, no subscriber on the bus

| Constant | Value | Emit site(s) | Subscriber |
|---|---|---|---|
| `TIME` | `time` | `src/systems/daynight.js:131` | none (day/night consumers read the scene directly) |
| `NET_STATE` | `net-state` | `src/net/NetworkManager.js:196,197,205` | none on the bus; NetworkManager re-emits via its own local emitter (`emit('hero'…)`) |
| `REFERRAL_STATE` | `referral-state` | `src/net/referralNet.js:49` | none on the bus; the panel consumes the relay channel directly |

These are harmless (small payloads, `bus.emit` is a no-op with no listeners) but
they inflate the event surface. Reported, not changed — all three live outside
this track's ownership.

## 2. Achievement feeding (62 achievements)

Executed harness: `achievements.js` imported against a stubbed bus +
`audio` + `arenaNet`, driven with every payload the real code emits (all
`ACH_EVENT` `k` values, `LEVEL_UP`, `PET_HATCH`, `PET_DUEL_START`, arena
`onMatch/onResult/onRating`, `PROGRESS`, plus `meta.visited`/`questState.ways`).
Result: **60/62 unlocked in one pass**; the 2 stragglers (`hunter` 100 kills,
`quests10` 10 quests) are repeat-count thresholds fed once — trivially reachable.

| Achievement(s) | Counter | Real producer |
|---|---|---|
| first_blood, hunter | `kills` | `WorldScene.js:409` `ACH_EVENT {k:'kill'}` |
| warden | `boss` | same, `{k:'kill', boss:true}` |
| lv5/lv10/lv20, gold100/gold1000 | `level`/`gold` | `ctx()` reads live player; check runs on `LEVEL_UP` + 1.5s `update()` poll (`WorldScene.js:702`) |
| first_quest, quests10 | `quests` | `questSystem.js:222` `{k:'quest'}` |
| bounty_first | `bounties` | same, `{k:'quest', bounty:isBounty}` |
| chain_done | `chains` | `questSystem.js:226` `{k:'chain'}` |
| tut_chain | `chain_tutorial` | same, with `q.chain==='tutorial'` (`data/quests.js:286` `CHAINS.tutorial`) |
| gather_first, gather_50 | `gathers` | `gathering.js:195` `{k:'gather', n}` |
| first_fish, golden_koi | `fish`/`koi` | `gathering.js:282` `{k:'fish', id:'golden_koi'}` |
| craft_first, craft_10 | `crafts` | `crafting.js:230` `{k:'craft', n}` (+ `{k:'upgrade'}`) |
| temper_first | `upgrades` | `crafting.js:222` `{k:'upgrade'}` |
| merchant | `sells` | `ShopPanel.js:202/231/240` `{k:'sell', n}` |
| all_maps, frontier | `visited` | `questSystem.js:445-446` sets `meta.visited` |
| waystones, ways6 | `ways` | `questState.ways` (scene state) |
| khet/gloomtoad/forgelord/hollowking | `boss_*` | `worldEvents.js:322` `{k:'bosskill', id:typeId}` |
| delver, delver3 | `dungeons` | `dungeons.js:528` `{k:'dungeon'}` |
| ev_first, ev_10 | `events` | `worldEvents.js:258/318` `{k:'event'}` |
| slimeking | `slimeking` | `worldEvents.js:347/359` `{k:c.def.ach}` → `data/worldEvents.js` slime event `ach:'slimeking'` |
| stargazer | `stars` | `worldEvents.js:195` `{k:'star'}` |
| caravan | `caravans` | `worldEvents.js:241` `{k:'caravan'}` |
| titan | `worldboss` | `worldEvents.js:333` `{k:'worldboss'}` |
| arena_first/win1/wins10/1200/1500 | `arena_*` | `arenaNet.onMatch/onResult/onRating` (see §3) |
| season3/5/10 | `season_best` | `syncSeasonBest()` reads `window.__econUI.seasonSystem.getState().tier` |
| pet_hatch | `hatches` | `Events.PET_HATCH` |
| pet_duel, pet_duels5 | `petduels` | `Events.PET_DUEL_START` |
| spec_* (11) | `spec_nodes`/`spec_might`/`spec_ward`/`spec_spirit`/`spec_adv` | `Events.PROGRESS` from `ModularPlayer._emitProgress` |

**Unreachable achievements: none.**

### Specialization `PROGRESS` payload — verified against the emitter

`ModularPlayer._emitProgress()` (`src/entities/ModularPlayer.js:218`) emits exactly:

```js
bus.emit(Events.PROGRESS, {
  level, statPoints, skillPoints, adv: this.prog.adv,
  paths: { ...this.prog.paths },          // keys: might, ward, spirit
  nodes: (this.prog.nodes || []).length,
});
```

- `paths` keys are `might|ward|spirit` — `SPEC_PATHS` (`data/stats.js:103`),
  `newProg()` (`:42`), respec (`:292`), and `buySpecNode` (`:257` increments
  `this.prog.paths[def.path]`; node ids are `${job}.${path}.${index}` with
  `path ∈ {might,ward,spirit}`, `data/skillTrees.js:44-46`). **Match.**
- `nodes` is a count → `spec_first`/`spec_nodes`. **Match.**
- `adv` → `spec_adv`. Emitted by `chooseClass()` (`:238`). **Match.**
- It is called from every mutation: `chooseClass` `:238`, `buySpecNode` `:259`,
  `respec` `:295`, and `:313/:323/:726`. **No missing emitter.**

Achievements reads them in `onProgress()` via `noteBest` (monotonic), so a respec
cannot reset a spec achievement — intended.

### At-risk (not proven unreachable)

`home_island` / `home_furnish` / `home_furnish5` / `home_harvest` read
`x.housing = scene.meta.housing`. `WorldScene.meta` is a **snapshot** of
`saved.ext` taken at scene create (`WorldScene.js:90`). The only runtime writer of
housing is `HomeIslandScene`, which writes `progress.ext.housing`
(`HomeIslandScene.js:229/239`) and persists it. These achievements therefore fire
only once `WorldScene.meta.housing` is refreshed from storage (a scene
reload/restart), not on return from the island. Reported as Parent work.

## 3. Arena ladder round trip (executed, live relay :2699)

**Write shape** (`server/arena.js` `setRating` `:78-92`):
`rec.progress.ext.arena = { rating, wins, losses }` (via `clean()`), persisted
through `saveChar`.

**Read shape** (`server/leaderboard.js` arena branch `:39-49`):
reads `prog.ext.arena` → `value = rating` (floor 100, default 1000),
`extras = { wins, losses, games }`.

**Render** (`src/ui/LeaderboardPanel.js`): row shows `value` + `«wins»W / «losses»L`
from `extras`, `updatedAt` footer, and auto-refreshes on `arenaNet.onResult`
when the ARENA tab is visible (`:51-56`). Additive note when every entry is the
1000 start with 0 games.

### Proof — empty case

```
GET /leaderboard?type=arena
{"ok":true,"type":"arena","updatedAt":1791227064376,"entries":[],"cached":false}
```

### Proof — real `setRating()` write then read

Executed `arena.setRating({token,name}, {rating:1387, wins:4, losses:2})` against
the scratch store:

```
setRating returned : {"rating":1387,"wins":4,"losses":2}
persisted ext.arena: {"rating":1387,"wins":4,"losses":2}
GAME: written 1387 === persisted 1387 MATCH
```

Ladder after seeding Alpha/Bravo/Charlie + one malformed row + one no-arena row
(proves desc sort, tie-break by name, and NaN/negative sanitization):

```
GET /leaderboard?type=arena&limit=25
{"ok":true,"type":"arena","updatedAt":1791227190349,"entries":[
 {"rank":1,"name":"Bravo","level":10,"job":"Wayfarer","value":1500,"extras":{"wins":5,"losses":1,"games":6}},
 {"rank":2,"name":"Whisper","level":5,"job":"Wayfarer","value":1387,"extras":{"wins":4,"losses":2,"games":6}},
 {"rank":3,"name":"Alpha","level":10,"job":"Wayfarer","value":1234,"extras":{"wins":10,"losses":3,"games":13}},
 {"rank":4,"name":"Delta","level":10,"job":"Wayfarer","value":1000,"extras":{"wins":3,"losses":0,"games":3}},
 {"rank":5,"name":"Echo","level":10,"job":"Wayfarer","value":1000,"extras":{"wins":0,"losses":0,"games":0}},
 {"rank":6,"name":"Charlie","level":10,"job":"Wayfarer","value":980,"extras":{"wins":2,"losses":8,"games":10}}
],"cached":false}
```

`Whisper` (real `setRating` write) lands at rank 2 between Bravo (1500) and
Alpha (1234). `Delta` (`rating:"abc"`, `wins:"3"`, `losses:-5`) sanitized to
1000/3/0. `Echo` (no `ext.arena`) defaults to 1000/0/0. **Round trip verified
end to end.** Scratch relay killed, `DATA_DIR` removed.

## 4. Season XP sources — doc vs code

`docs/SEASON_XP_SOURCES.md` matches `src/data/seasons.js` and
`src/systems/seasonSystem.js` exactly:

| Claim (doc) | Code | Verdict |
|---|---|---|
| `dailyXpCap 6500` | `seasons.js:13` | ✓ |
| `dungeonClear` 1200, cap 2400 | `sources.dungeonClear.base 1200`, `sourceCaps.dungeonClear 2400` | ✓ |
| `kill` 25 base, cap 2000 | `sources.kill.base 25`, `sourceCaps.kill 2000` | ✓ |
| world-boss = 20× kill base = 500 | `SEASON_XP_AWARDS.worldBoss = _KILL_BASE * 20` (`seasonSystem.js:27`) | ✓ |
| `pvpDuel` 300, cap 1500 | `sources.pvpDuel.base 300`, `sourceCaps.pvpDuel 1500` | ✓ |
| `quest` 400, cap 3000 | `sources.quest.base 400`, `sourceCaps.quest 3000` | ✓ |
| `dailyLogin` 500, cap 500 | `sources.dailyLogin.base 500`, `sourceCaps.dailyLogin 500` | ✓ |
| dungeon via `dungeon:complete` | `dungeonSystem.js:23/114/182` emits `DUNGEON_EVENTS.COMPLETE` | ✓ |
| world boss via `Events.WORLDBOSS_SLAIN` + contributors filter | `seasonSystem.js:144` | ✓ |
| arena win-only `you.delta > 0` | `seasonSystem.js:148` | ✓ |
| quest via `ACH_EVENT {k:'quest'}` | `questSystem.js:222` | ✓ |

No discrepancy.

## 5. Merge gate (foreground, real relay)

| Gate | Result |
|---|---|
| `node tools/econ_test.mjs` | **ECON OK — 35 checks passed** |
| `node tools/econ_audit_dupes.mjs` | **13 probes, 0 exploited, 0 at critical/high, 0 inconclusive** |

Both re-run after the `leaderboard.js` edit; unchanged.

## 6. Fixes applied (in ownership)

- `server/leaderboard.js:38` — removed a no-op expression in the `pets` branch:
  `(len) + (ext.pets?.active !== undefined ? 0 : 0)` → `len`. Behavior-identical
  (the added term was always 0), removes dead arithmetic.
- `docs/SYNC_EVENTS.md` — this audit (new).

No change needed in `src/core/events.js`, `src/systems/achievements.js`,
`server/arena.js`, or `src/ui/LeaderboardPanel.js`: every check passed as-is.

## 7. Parent work (outside this track's file ownership)

1. **`worldBossNet.js:19,27`** — replace raw `bus.emit('worldboss-spawn', m)`
   with `bus.emit(Events.WORLDBOSS_SPAWN, m)`; kills the typo risk on a live
   channel (constant is `src/core/events.js:44`).
2. **`combat.js:79`** — `Events.PARTY_KILL` listener is dead (no emitter exists).
   Either emit it from `social/index.js` `onPartyXp`/share path (to also get the
   `creditKill` quest credit the handler performs), or drop the subscription.
3. **Housing achievements** — `WorldScene.meta.housing` is a create-time snapshot
   (`WorldScene.js:90`); `HomeIslandScene` writes `progress.ext.housing`. Point
   `Achievements.ctx()` at the same source the island writes, or re-sync
   `meta.housing` from storage when WorldScene resumes.
4. **Dead emits** `Events.TIME` / `Events.NET_STATE` / `Events.REFERRAL_STATE`
   have no bus subscriber — either wire a consumer or stop emitting.
5. Add an `ECON_UI` constant for the `econ-ui` raw literal used in
   `UIScene.js` / `economyUI.js` / `townfolk.js` (optional hygiene).
6. `questSystem.js:194` emits `Events.PROGRESS` with `{}` (off-contract payload).
   `achievements.onProgress` guards it, but a dedicated `stat-points` event would
   be cleaner than a field-less `PROGRESS`.
