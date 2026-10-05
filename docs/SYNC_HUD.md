# SYNC_HUD — HUD/UI wiring audit (both directions) + runtime boot proof

Owned files: `src/scenes/UIScene.js`, `src/ui/hudPolish.js`, `src/systems/hudIcons.js`,
`src/systems/status.js`, this doc. Audited at commit `61b786e`.

Why this exists: a previous shipped bug (a missing `net` import in `src/ui/economyUI.js`)
threw inside `UIScene.create()`, silently killing every panel created after it plus the
separate `eventhud` / `combathud` scenes — and a build-only gate never caught it. The checks
below are the gates that would have.

## 1. Static symbol sync (imports ⊆ real exports)

Executed with esbuild (defines `import.meta.env`, Vite-only) + dynamic `import()`:
`CHECKED=19 MISSING=0`.

| Consumer | Symbol | Source module | Result |
|---|---|---|---|
| scenes/UIScene.js | `makeHudIcons`, `HUD_ABILITY_ICON` | systems/hudIcons.js | OK |
| scenes/UIScene.js | `createCombatReadability` | ui/hudPolish.js | OK |
| scenes/UIScene.js | `bus`, `Events` | core/events.js | OK |
| main.js | `injectPolishCss` | ui/hudPolish.js | OK |
| scenes/CharacterScene.js | `hudIconKey`, `HUD_ABILITY_ICON` | systems/hudIcons.js | OK |
| ui/advSkillBar.js | `hudIconKey` | systems/hudIcons.js | OK |
| ui/econDom.js | `attachPanelBehavior`, `labelTabs` | ui/hudPolish.js | OK |
| ui/socialDom.js | `labelTabs` | ui/hudPolish.js | OK |
| core/mobile.js, systems/questSystem.js | `bus`, `Events` | core/events.js | OK |
| entities/Enemy.js | `StatusSet` | systems/status.js | OK |

Real export sets (for future edits):
- `systems/hudIcons.js`: `HUD_PAL, HUD_ABILITY_ICON, hudIconKey, HUD_STATUS_ICON, hudStatusIconKey, HUD_FEEDBACK_ICON, hudFeedbackIconKey, makeHudIcons`
- `ui/hudPolish.js`: `POLISH_PALETTE, POLISH_FONTS, POLISH_MIN, HUD_ICONS, hudIconById, registerHudIcons, attachPanelBehavior, registerCloser, applyA11y, labelTabs, focusPanel, upgradeTouchTargets, ensureReadableText, POLISH_CSS_ID, injectPolishCss, polishHud, COMBAT_READ, READ_STATUS, skillSlotState, lowResourceState, statusIndicators, playerIndicators, pulseAlpha, createCombatReadability`
- `systems/status.js`: `StatusSet`

## 2. Event sync (subscriptions → real value → actually emitted)

Every bus event name subscribed in the owned files exists as a value in `core/events.js`
AND has at least one emit site in `src/`. No dead UI subscriptions.

| Owner | Subscription | events.js value | Emit site(s) |
|---|---|---|---|
| UIScene | `Events.SYSTEM` | `system` | Boss.js, WorldScene.js, economyNet.js, NetworkManager.js, many |
| UIScene | `Events.PLAYER_HP` | `player-hp` | WorldScene.js:212, systems/combat.js, crafting.js, … |
| UIScene | `Events.PLAYER_XP` | `player-xp` | WorldScene.js:213, combat.js:260,284,616 |
| UIScene | `Events.QUEST` | `quest` | WorldScene.js:211, combat.js:261,285, questSystem.js:310 |
| UIScene | `Events.ZONE` | `zone` | WorldScene.js:703 |
| UIScene | `Events.GEAR` | `gear` | economyNet.js:189, WorldScene.js:303,315,620, pack.js:34 |
| UIScene | `Events.TOAST` | `toast` | achievements.js, questSystem.js, dungeons.js, dailyRewards.js, … |
| UIScene | `Events.WORLDBOSS_SPAWN` | `worldboss-spawn` | worldBossNet.js:19,27 (**raw string literal** — see parent work) |
| UIScene | `Events.WORLDBOSS_SLAIN` | `worldboss-slain` | worldBossNet.js:37 |
| UIScene | `Events.PET_DUEL_START` | `pet-duel-start` | socialNet.js:42 |
| UIScene | `Events.DAILY_REWARD` | `daily-reward` | dailyRewards.js:98,183 |
| UIScene | `Events.JOURNAL` | `journal` | UIScene.js:791,835,865 (button / hotkey) |
| UIScene | `Events.CRAFT` | `craft` | crafting.js:124,199,210,238,248,262, UIScene.js:792,836,866 |
| UIScene (emit) | `Events.GEAR/JOURNAL/CRAFT` | — | emitted to the panels it hosts |
| hudPolish | `Events.SKILL_CAST` | `skill-cast` | WorldScene.js:504 |
| hudPolish | `Events.PLAYER_HP` | `player-hp` | see above |
| hudPolish | `Events.PLAYER_DIED` | `player-died` | combat.js:614 |
| systems/status.js | (none) | — | — |
| systems/hudIcons.js | (none) | — | — |

## 3. Controller contract — `createCombatReadability(scene, opts)`

`UIScene.create()` (line ~290) passes: `slots, getPlayer, getNow, hpBar, mpBar, small,
isMobile, statusList, anchor`. The controller reads each of these against real shapes:

| Option | Controller uses | UIScene passes | Shape check |
|---|---|---|---|
| `slots` | `slot.s.ab`, `slot.bg.x/.y/.width/.height`, `slot.bw/.bh` | `this.hotbar` records `{bg, s, cdBg, cdT, bw, bh, badgeBg, badgeT}` | OK — potion slot (`s:{}`) correctly skipped (no `.ab`) |
| `getPlayer` | fn → player | `() => this.world()?.player` | OK |
| `getNow` | fn → ms | `() => this.world()?.time?.now ?? 0` | OK |
| `hpBar` / `mpBar` | `.x/.y/.width/.height/.setStrokeStyle` | `mkBar()` → Phaser `Rectangle` | OK — frames built at bar origin |
| `isMobile` | boolean (short-circuits `readMobile()`) | `CONFIG.isMobile` | OK |
| `statusList` | fn → `[{id,left,frac}]` | `world.combat.statuses.list(now)` | OK |
| `anchor` | `{x, y}` | small/desktop variant | OK |
| `small` | **not read** | `this.small` | dead option (harmless; documented in the example) |

Harness (`controller_contract.mjs`) instantiated the controller with UIScene's exact object
shapes: `ready=true`, `slotCount=2` (potion slot skipped), `statusCount=6`, both warn frames
created, `update()` run across normal / low-HP / low-MP states with no throw.

## 4. status.js on-sprite enemy readout — binding hardening

The readout late-binds an enemy `StatusSet` by scanning active scenes for the group member
whose `.statuses === set`, reached through the debug handle `window.__wayfarer`
(`src/main.js:51`, set unconditionally in production). Honest assessment:

- The handle is present in the shipped build, so the dependency itself is not fragile.
- **The real fragility was the binding policy**: on the first scan where an `enemies` group
  existed but the owner was not found, the set was permanently resolved to `null`
  ("not an enemy") and never re-examined. Any transient miss — a status applied a frame
  before its spawner adds the enemy to the group — would *silently kill that enemy's readout
  forever*, the exact class of silent-HUD-death this audit exists to prevent.

Fix (inside `status.js` only, presentation-only, no state change):
- The hero's set is now resolved **positively** (`scene.combat.statuses === set ||
  scene.player.statuses === set) instead of being inferred from "not found".
- A miss with an `enemies` group present now **retries** on later applies, bounded by
  `MAX_TRIES=256` so a genuine non-enemy set cannot scan forever.
- Added `TRIES` WeakMap + `MAX_TRIES`; deleted the count on every successful bind.

Proof: `git diff` is +21/−2 lines, all inside `readoutWatch` plus the two module-level
constants. `diff` of the `export class StatusSet { … }` block against `HEAD` is byte-identical
→ **timer/`apply`/`tick`/`list`/`has`/`clear` state paths untouched.** A unit harness
(`status_binding2.mjs`) passes 8/8: hero set rejected, enemy set binds (scene `update`
listener installed), transient miss self-heals on a later apply, and the timer math / DoT
tick / clear behave identically.

Size: `src/systems/status.js` 10,685 → 11,848 bytes.

## 5. Runtime boot proof (real Chrome, built `dist/`)

`npm run build` → `python -m http.server 4188` in `dist/` → puppeteer
(`headless:'new'`, `--use-gl=swiftshader --enable-unsafe-swiftshader`) → `loadHero()`-free
new-player path: `title.goCreator('solo')` → wait `creator` → `Enter` → wait `ui`.

Two consecutive fresh boots:

```
active scenes       : boot, world, ui, character, overlay, combathud
world+ui+combathud  : true
ui.combatRead.ready : true
ui.hotbar slots     : present (non-empty)
pageerror count     : 0
console error count : 0
loaderror matches   : 0
BOOT PASS
```
(second run additionally showed `eventhud` active: `...overlay, eventhud, combathud`).

Keys `h, t, j, 1, q, Escape` pressed with short waits → no new errors. Server killed and all
temp scripts deleted after the run.

## Parent work / out of ownership

1. `src/net/worldBossNet.js:19,27` emits the raw string `'worldboss-spawn'` instead of
   `Events.WORLDBOSS_SPAWN`. Same value, so the subscription is not dead, but it should use
   the constant for consistency with the append-only event contract. (worldBossNet.js is not
   in this track's ownership.)
2. Cosmetic: `createCombatReadability` accepts but never reads `opts.small` (it derives
   mobile layout from `readMobile()` / `isMobile`). Harmless; either consume it or drop it
   from the call site.
