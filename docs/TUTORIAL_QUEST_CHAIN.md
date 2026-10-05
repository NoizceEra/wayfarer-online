# Tutorial Quest Chain (data-only: `src/data/quests/tutorial2.js`)

Onboarding chain **`tutorial` / “Wayfarer Basics”**. Data only — no engine changes,
no new objective types, no new reward keys. Uses only the 9 objective types the
engine already supports (`src/systems/questSystem.js`, also listed in the header
of `src/data/quests.js`).

## The chain

Linear prerequisites: each quest requires the previous one. All `lv: 1`,
all non-repeat (one-time), giver/turn-in NPCs are existing NPCs.

| # | id | name | giver | objectives (engine type) | reward |
|---|----|------|-------|--------------------------|--------|
| 1 | `tut_steps` | First Steps | Pip | `explore` Thistle Plaza (`town_plaza` POI) — movement beat | 10 XP, 5g |
| 2 | `tut_blade` | First Blood | Pip | `kill` Dew Slime ×1 — first-combat beat | 20 XP, 10g |
| 3 | `tut_gather` | Golden Petals | Granny Elda | `collect` Sunpetal ×2 — gathering beat | 20 XP, 10g, 1× Empty Vial |
| 4 | `tut_brew` | Brew and Sip | Granny Elda | `craft` Herbal Tonic ×1 + `use` Herbal Tonic ×1 — crafting beat | 30 XP, 15g |
| 5 | `tut_skills` | Words of Power | Maren | `talk` to Maren — skill-trainer beat (proxy, see below) | 20 XP, 10g |
| 6 | `tut_pet` | Egg Tales | Pet Master Li | `talk` to Pet Master Li — pet/master intro, funnels into existing `q_pet_unlock` | 20 XP, 10g |

Total: 120 XP, 60g, 1 vial. Deliberately small (anti-farming, see below).

## Prerequisites

- Each quest's `pre` = the previous quest id (`tut_steps` has none).
- `lv: 1` throughout, so `levelOk()` (player level ≥ q.lv − 1) always passes.
- Assumes existing world content: `town_plaza` POI (`POIS` in `quests.js`),
  `dewslime` enemy (`ENEMY_TABLE`), `sunpetal` / `herbal_tonic` / `empty_vial`
  materials (`materials.js`), NPCs Pip, Granny Elda, Maren (existing givers),
  Pet Master Li (giver of the existing `q_pet_unlock`).
- No new POIs, NPCs, items, enemies, or lore entries required.

## Rewards

See table above. Reward keys used: `xp`, `gold`, `mats` — all handled by
`QuestSystem.grant()` / `rewardLines()`. No `gear`/`recipes`/`statPoints`/`lore`
(all would also work, but were kept out to keep tutorial rewards minimal).

## Anti-bot / farming notes

- **One-time only**: no quest sets `repeat`, so `status()` returns `done`
  forever after completion; `complete()` records `done[id]` and pays once.
- **Linear `pre` gating**: later steps cannot be accepted (or farmed) without
  finishing earlier ones; a fresh bot account must walk the whole chain.
- **Tiny payouts** (120 XP / 60g total): worthless to farm versus even the
  lowest bounty (`bt_slime`: ~scaled 30+lvl×14 XP per day, repeatable).
- **`kill` ×1 on a plentiful mob**: no rare-spawn camping, no AoE-farm value.
- **`collect` ×2, consumed on turn-in**: `complete()` calls `takeMat` for
  collect/deliver items, so stockpiled sunpetals are eaten, not banked.
- **`craft` + `use` pair**: the brewed tonic must actually be drunk (pack
  `onUse` hook), so a bot cannot just craft-and-stockpile through the step.
- **No tradable reward**: no gear/recipes to mule to other accounts.

## Engine hooks reused (with evidence)

All in `src/systems/questSystem.js` unless noted; call sites verified in tree:

- `explore` — `checkLoreAndExplore()` (questSystem.js:411), polled from
  `update()` every 0.4s; POI proximity via `poiPos()`; beacons in
  `refreshBeacons()`.
- `kill` — `onKill(typeId)` → `_bump('kill', …)` (questSystem.js:246); called
  from `WorldScene.onKillContent()` (WorldScene.js:380), fed by
  `combat.js:446` (`s.onKillContent?.(ed, …)`).
- `collect` — live `matCount()` in `prog()` (questSystem.js:125) +
  `onPack()` transition detection (questSystem.js:251); consumed by
  `takeMat` in `complete()` (questSystem.js:204).
- `craft` — `onCraft(id, n)` → `_bump('craft', …)` (questSystem.js:248);
  called from `crafting.js:227` (and `:231` for upgrades).
- `use` — `onUse(id)` → `_bump('use', …)` (questSystem.js:247); called from
  `pack.js:63` (`scene.quests?.onUse(id)`).
- `talk` — `talk(name, …)` marks matching objectives complete
  (questSystem.js:507); wired through `AreaManager` NPC interaction
  (`areas.js:85`); `'?'` markers via `npcKind()` (questSystem.js:295).
- Chain completion toasts/achievements (`complete()` questSystem.js:217-223,
  `chain: 'tutorial'`) work automatically once `TUTORIAL_CHAIN` is registered
  in `CHAINS` (needs `CHAINS['tutorial']` to exist for the name lookup;
  otherwise falls back to the raw id — harmless).

## Missing hooks the parent must implement ( NOT in this change)

The requested beats below have **no engine hook today**, so they are covered
by proxies (`talk`) or omitted. Each needs a small engine addition by the
owning track — suggested wiring in parentheses:

1. **First skill cast** — `WorldScene.cast()` (WorldScene.js:464) emits no
   quest/achievement event (only `PLAYER_HP` + `castVfx`). Wanted: a new
   objective type (e.g. `{ t: 'skill', id }`) plus `quests.onSkill(id)` called
   from `cast()`, mirroring `onUse`/`onCraft`. Until then `tut_skills` is a
   `talk` proxy: it does NOT prove the player cast anything.
2. **Movement / steps** — no step counter or quest hook exists; `explore`
   (POI/zone proximity) is the only movement-adjacent objective. Wanted (if a
   true "walk N steps" tutorial is desired): accumulate distance in
   `WorldScene.update` and add `{ t: 'steps', n }` support. `tut_steps`
   (walk to Thistle Plaza) is the accepted substitute.
3. **First combat hit (as distinct from a kill)** — quest credit fires only on
   kill (`onKillContent`). There is no "landed a hit" hook. `tut_blade`
   (kill ×1) covers it for onboarding purposes; a hit-level objective would
   need combat.js to call something like `quests.onHit()` from the damage path.
4. **Pet hatch / ownership** — no pet-quest hook exists (`PET_DUEL_START` is
   duels only; `q_pet_unlock` itself is just two `collect` objectives).
   `tut_pet` is a `talk` intro that points at the existing `q_pet_unlock`;
   a true "hatch your first egg" step needs the pet system to call into quests.
5. **Daily-reward claim** — `Events.DAILY_REWARD` (`events.js:35`) is emitted
   with `{ claimed: true, … }` by `dailyRewards.js:183`, but `QuestSystem`
   never subscribes to it. Wanted: `bus.on(Events.DAILY_REWARD, …)` in the
   `QuestSystem` constructor (alongside the existing `LEVEL_UP`/`ZONE`
   subscriptions) crediting a new objective type (e.g. `{ t: 'daily', n: 1 }`).
   Deliberately NOT faked with a `talk` proxy (that would complete without the
   player claiming anything).

## Exact registration snippet (parent adds this — do NOT edit the registry here)

Order matters: `QUESTS_BY_ID` is built at `quests.js:236`, right after
`QUEST_LIST.push(...EXTRA_QUESTS)` (`:235`). The tutorial quests must be in
`QUEST_LIST` **before** that map is built, otherwise `def()` returns null and
the quests are invisible. Add the import with the other imports (top of
`src/data/quests.js`, next to the `petUnlock.js` import at `:11`):

```js
import { TUTORIAL_QUESTS, TUTORIAL_CHAIN } from './quests/tutorial2.js';
```

then, between line 235 (`QUEST_LIST.push(...EXTRA_QUESTS);`) and line 236
(`export const QUESTS_BY_ID = …`), insert:

```js
QUEST_LIST.push(...TUTORIAL_QUESTS); // onboarding chain (data/quests/tutorial2.js)
Object.assign(CHAINS, { [TUTORIAL_CHAIN.id]: TUTORIAL_CHAIN });
```

Verify after wiring: `QUESTS_BY_ID['tut_steps']` defined, journal shows
“Wayfarer Basics” chain, Pip shows `!` for a fresh save.
