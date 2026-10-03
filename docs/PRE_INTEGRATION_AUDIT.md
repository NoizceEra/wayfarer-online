# Pre-Integration Audit Report — Wayfarer Online

**Commit base:** 545de10778c26fcfe059abfd6b80e705e70bedbc  
**Delegation:** deleg_96560453 (new files + partial UIScene/economyUI wiring)  
**Audit scope:** Guild, Season Pass, World Boss, LFG/Dungeon, Mobile UX backups, file integrity.  
**Status:** DO NOT DEPLOY until P0/P1 items below are resolved.  

---

## 1. Guild System — Collision with existing GuildTab.js / economy.js guild

### Findings
- `src/ui/economyUI.js` still imports and renders the legacy `src/ui/GuildTab.js` via `social.registerAction('renderGuildTab', ...)` and registers legacy `/ginvite /gaccept /gkick ...` commands that talk to `server/economy.js` (`econ.send('guild-invite', ...)`).
- The new guild system (`src/systems/guildSystem.js`, `src/net/guildNet.js`, `server/guild/guildService.cjs`) uses **colon-prefixed** messages (`guild:create`, `guild:invite`, `guild:contribute`, …).
- The legacy economy guild system uses **hyphen-prefixed** messages (`guild-invite`, `guild-create`, `guild-rank`, …).
- There is **no overlap in message type strings**, so the two systems will not crash each other, but they create two independent guild namespaces.
- `server/index.js` now wires the new `GuildService`, but `server/economy.js` is still loaded and still handles legacy guild messages.
- `src/ui/GuildPanel.js` and sub-pages are instantiated in both `UIScene.js` and `installEconomyUI`, but only `UIScene.js` actually opens it via the HUD icon.

### P0/P1 issues
- **P1 — Duplicate guild systems:** Players can be in an economy guild (legacy) and a progression guild (new) simultaneously with different tags/members/banks. Pick one system and migrate/deprecate the other before release.
- **P1 — `client.playerName` undefined:** `server/guild/guildService.cjs` reads `client.playerName || client.sessionId`. Colyseus `Client` has no `playerName` property. Use the `player` object from `room.players.get(client.sessionId).name`.
- **P1 — `offBroadcast` undefined:** `src/net/guildNet.js` and `src/net/seasonNet.js` `bindTransport` closures reference `offBroadcast`, which is never defined or returned by `onBroadcast`. The `unbind` function throws when called.
- **P2 — `GuildPanelBase.enterHall()` usually no-ops:** It checks `this.scene.scene.get('GuildHallScene')` and only then `scene.launch`. `scene.get()` returns a registered class, but the condition will be false until the scene is already running. Should be `if (this.scene.scene.get('GuildHallScene')) this.scene.scene.launch(...)` — actually this is fine because registered scenes exist, but verify.
- **P2 — `GuildHallScene.claimDaily()` is a stub:** It computes gold and shows a toast but never grants gold to the player (`TODO: wire to economy server`).

### Recommended resolution
1. Decide whether guilds live in economy.js or guildService.cjs. Recommended: extend economy.js with progression data because it already owns persistence/authority, or make guildService.cjs the sole authority and remove economy.js guild handlers.
2. In `guildService.cjs`, replace `client.playerName` with `room.players.get(client.sessionId).name`.
3. In `guildNet.js` / `seasonNet.js`, capture the unsubscribe returned by `onBroadcast((fn) => { ... })` and store it: `this.unbind = onBroadcast(handler);`.
4. Wire `GuildHallScene.claimDaily()` to the economy server or remove the button until implemented.

---

## 2. Season Pass — Duplicates / diverges from Daily Rewards

### Findings
- `src/systems/dailyRewards.js` already grants daily login gold + streak rewards.
- `src/data/seasons.js` defines a `dailyLogin` XP source worth 500 XP.
- `src/systems/seasonSystem.js` exposes `earnXp('dailyLogin', 500)` but it is **never called** from `DailyRewards` or anywhere else in the codebase.
- `UIScene.js` wires `seasonSystem` to net and creates `SeasonPanel`, but no gameplay source calls `this.seasonSystem.earnXp(...)`.
- `server/season.js` keeps season state in a `Map` keyed by `client.sessionId`. Session IDs change on reconnect, so season progress is lost.
- `server/season.js` has no persistence hook (no `beforeSave`, no SQLite, no load from `progress.ext`).

### P1/P2 issues
- **P1 — Season pass is non-functional:** No XP is ever earned. Daily login does not feed season XP.
- **P1 — Progress not persisted:** `client.sessionId` is ephemeral. Use `ck` (device token + character name) or persist in character save.
- **P2 — Duplicate daily reward concept:** `dailyLogin` season XP and `DailyRewards` both represent the same daily-login loop. Either merge them or make season XP an additional reward on top of daily rewards.

### Recommended resolution
1. In `DailyRewards.claimToday()`, after granting gold/tokens, call `this.scene.seasonSystem?.earnXp('dailyLogin', 500)`.
2. In `WorldScene`/combat/quest/dungeon completion handlers, call `seasonSystem.earnXp(source, amount)`.
3. In `server/season.js`, replace `client.sessionId` with the character key (`ck`) and load/save season state from the character record or a SQLite table.

---

## 3. World Boss — Alert conflicts with Boss.js / message types

### Findings
- `src/net/worldBossNet.js` listens to `worldboss-announce`, `worldboss-state`, `worldboss-slain`. These do **not** conflict with `src/entities/Boss.js`, which is the local crypt mini-boss and emits no network messages.
- `server/worldBoss.js` is already loaded at HEAD; `server/index.js` still loads it. The new integration adds a HUD alert in `UIScene.js`.
- `server/worldBoss.js` hooks `room.onMessage('ehit', ...)` and `room.onMessage('hit', ...)`, which is consistent with the existing area-authority combat system.
- `UIScene.js` subscribes to `Events.WORLDBOSS_SPAWN` and `Events.WORLDBOSS_SLAIN`.

### P1/P2 issues
- **P1 — Hardcoded teleport coordinates:** `WorldBossAlert.onTeleport` teleports to `(1620, 840)` regardless of which boss or area the server announced. Use the `x`, `y`, `area` from the broadcast.
- **P1 — Wrong zone label:** `WorldBossAlert.show()` reads `data.zone`, but the server payload uses `area`. It will display “Unknown Zone”.
- **P1 — `room.area(state.area).auth` assumption:** `server/worldBoss.js` relies on `room.area(...)` returning an object with `.auth`. `WayfarerRoom` has this, but verify that `state.area` (currently `'ruins'`) matches area keys used by the room.
- **P2 — Countdown UX is misleading:** The alert computes `spawnAt = expiresAt - 30min` and shows “Spawns in…”, but `worldboss-announce` is sent when the boss is already active. The alert should show time remaining until despawn, or change the label.

### Recommended resolution
1. Pass server `x`, `y`, `area` through to `WorldBossAlert.show()` and use them for teleport and label.
2. Change `WorldBossAlert` label from “Spawns in” to “Active for” and compute from `expiresAt`.
3. Consider using `src/data/worldBosses.js` spawn windows/rotation instead of the single hardcoded Gravemaw schedule.

---

## 4. LFG / Dungeon System — Relies on missing APIs

### Findings
- `src/systems/dungeonSystem.js` is a client coordinator. It defines `startLocal`, queue stubs, and wave logic.
- `server/dungeonMatch.js` is a matchmaker scaffold. It binds `lfg:queue`, `lfg:cancel`, `lfg:accept`.
- `src/ui/LFGPanel.js` is wired in both `UIScene.js` and `installEconomyUI`.
- `server/index.js` now imports and loads `dungeonMatch.js` via `addRoomModule`.

### P0/P1 issues
- **P0 — `/lfg` command toggles old PartyFinderPanel:** `economyUI.js` case `'partyfinder' / 'finder' / 'lfg'` does `window.__econUI?.partyFinder?.toggle(uiScene)`, which is the legacy panel, not the new `LFGPanel`. The new panel is also not exposed on `__econUI`.
- **P1 — Matchmaker does not create a dungeon room:** `DungeonMatchmaker.createDungeonRoom()` only sends `dungeon:enter` to matched clients. There is no actual Colyseus room creation, no dungeon map, no combat wiring.
- **P1 — No server-side dungeon runner:** `dungeonSystem.js` can run a local prototype, but there is no authoritative dungeon instance.
- **P2 — UI state mismatch:** `LFGPanel` transitions `idle → queued → ready`, but the only way to reach `ready` is via `handleMatch()` from server `dungeon:match`, which `dungeonMatch.js` never sends. It sends `lfg:queued`, `lfg:waiting`, `dungeon:enter`.

### Recommended resolution
1. Expose new LFG panel on `__econUI` and update `/lfg` command to toggle it.
2. Decide if LFG is MVP-local-only (use `startLocal`) or needs real matchmaking. If real, implement room creation + handoff.
3. Align server messages with `dungeonSystem.handleMatch` / `handleEnter` expectations, or simplify the UI to react to `dungeon:enter` directly.

---

## 5. Mobile UX `.mobile` backups — Safe to merge?

### Findings
- Three `.mobile` backup files exist: `src/core/input.js.mobile`, `src/scenes/UIScene.js.mobile`, `src/ui/socialDom.js.mobile`.
- They are **not imported anywhere** in the modified `index.html`, `UIScene.js`, or `main.js`.
- The actual mobile implementation was appended to `src/core/input.js` (new `MobileInput` class + `isMobile`).
- `src/scenes/UIScene.js.mobile` imports `{ SocialDom } from '../ui/socialDom.js'`, but `src/ui/socialDom.js` does **not** export a `SocialDom` class. This file would fail if ever loaded.
- `.mobile` extension is not a known module extension, so these files cannot be imported by Node/bundler as-is.

### Verdict
- The `.mobile` files are **safe to keep as inert backups** but are not wired and one is broken. They do not affect the build because they are not imported.
- However, they add clutter and could confuse future integrators.

### Recommended resolution
1. Either delete the `.mobile` files or rename/import them correctly.
2. If keeping them, fix `UIScene.js.mobile` to import `SocialDom` from `../ui/socialDom.js.mobile` or inline it.

---

## 6. File-size / full-rewrite corruption

### Findings
- No file in the working tree is unusually large or zero-length (except empty directories).
- `src/scenes/UIScene.js` grew from ~45 KB to ~50 KB (legitimate additions, not corruption).
- `src/core/input.js` grew from ~25 KB to ~31 KB (MobileInput appended).
- `server/index.js` grew from ~7 KB to ~8.7 KB (new module loading).
- `docs/index.html` modified but not related to feature wiring.
- All new source files pass `node --check` except the `.mobile` files, which fail due to unknown extension (expected).

### Verdict
- No file-size corruption detected. Subagent did partial targeted edits, not destructive full rewrites of existing modules.

---

## 7. Additional integration gaps

- **Season panel wiring incomplete:** `SeasonPanel` is created but no HUD icon in `installEconomyUI` wires it to the old economy flow; only `UIScene.js` has an icon.
- **Guild panel wiring incomplete:** `GuildPanel` is created in `installEconomyUI` but not exposed on `__econUI`; only `UIScene.js` has a HUD icon and references it directly.
- **Slash commands advertised but unimplemented:** `economyUI.js` help text mentions `/season`, `/guild`, `/boss` but no cases exist.
- **Server modules not wired consistently:** `server/index.js` loads `dungeonMatch` and `season` but does not call `routes` for them in the snippet captured (diff was truncated). Verify the full diff.
- **`GuildSystem` / `SeasonSystem` `onBroadcast` wrapper:** The `net.onAttach((room) => { room.onMessage('*', ...) })` pattern will create duplicate listeners on every reconnect and never unsubscribes. This leaks memory and causes duplicate events.

---

## Recommended pre-deploy checklist

| Priority | Item |
|----------|------|
| P0 | Fix `/lfg` command to toggle the new `LFGPanel`, or expose new panels on `__econUI`. |
| P0 | Add missing `/season`, `/guild`, `/boss` slash-command cases in `economyUI.js` (or remove from help text). |
| P0 | Fix `offBroadcast` undefined in `guildNet.js` / `seasonNet.js`. |
| P0 | Fix `UIScene.js.mobile` import of `SocialDom` from `socialDom.js` (class not exported). |
| P1 | Resolve duplicate guild systems: make economy.js or guildService.cjs the single authority. |
| P1 | Replace `client.playerName` with `room.players.get(client.sessionId).name` in guild service. |
| P1 | Persist season state by character key (`ck`) instead of `client.sessionId`. |
| P1 | Wire season XP calls from `DailyRewards` and gameplay sources. |
| P1 | Implement actual dungeon room creation, or scope LFG to local-only / placeholder. |
| P1 | Use server-provided `area/x/y` in `WorldBossAlert` teleport and label. |
| P1 | Fix `WorldBossAlert` countdown label for already-active bosses. |
| P1 | Verify `room.area(state.area).auth` contract in `server/worldBoss.js`. |
| P1 | Prevent duplicate `room.onMessage('*')` listeners on reconnect. |
| P2 | Delete or fix unused `.mobile` backup files. |
| P2 | Implement or remove `GuildHallScene.claimDaily()` stub. |
| P2 | Decide whether `MobileInput` should stay in `input.js` or move to `input.js.mobile`. |

---

*Audit performed on 2026-10-03. Files inspected: 35+ source files across client, server, and docs.*
