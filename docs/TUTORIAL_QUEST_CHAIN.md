# Tutorial Quest Chain (data-only: `src/data/quests/tutorial2.js`)

Onboarding chain **`tutorial` / “Wayfarer Basics”** (steps 1–7) plus one
optional side quest (`tut_daily`). Data only — no engine changes,
no new objective types, no new reward keys. Uses only objective types the
engine already supports (`src/systems/questSystem.js`, also listed in the header
of `src/data/quests.js`): the original 9 plus the three real hooks from
`docs/QUEST_HOOKS.md` (`skill`, `daily`, `pethatch`).

## The chain

Linear prerequisites: each chain quest requires the previous one. All `lv: 1`,
all non-repeat (one-time), giver/turn-in NPCs are existing NPCs. `tut_daily`
is NOT in the chain (no `chain`, no `pre`) — see “side quest” below.

| # | id | name | giver | objectives (engine type) | reward |
|---|----|------|-------|--------------------------|--------|
| 1 | `tut_steps` | First Steps | Pip | `explore` Thistle Plaza (`town_plaza` POI) — movement beat | 10 XP, 5g |
| 2 | `tut_blade` | First Blood | Pip | `kill` Dew Slime ×1 — first-combat beat | 20 XP, 10g |
| 3 | `tut_gather` | Golden Petals | Granny Elda | `collect` Sunpetal ×2 — gathering beat | 20 XP, 10g, 1× Empty Vial |
| 4 | `tut_brew` | Brew and Sip | Granny Elda | `craft` Herbal Tonic ×1 + `use` Herbal Tonic ×1 — crafting beat | 30 XP, 15g |
| 5 | `tut_skills` | Words of Power | Maren | `skill` Dust Dash ×1 (genuine cast) + `talk` to Maren (report back) | 20 XP, 10g |
| 6 | `tut_pet` | Egg Tales | Pet Master Li | `talk` to Pet Master Li — pet/master intro, funnels into existing `q_pet_unlock` | 20 XP, 10g |
| 7 | `tut_hatch` | First Friend | Pet Master Li | `pethatch` any wisp ×1 (genuine capture) | 30 XP, 15g |
| — | `tut_daily` | A Habit of Returns | Maren | `daily` claim ×1 — OPTIONAL SIDE QUEST, not a chain step | 15 XP, 10g |

Chain total: 150 XP, 75g, 1 vial. Side quest: +15 XP, +10g.
Added by this upgrade: 45 XP, 25g (30/15 hatch + 15/10 daily; `tut_skills`
kept its 20/10) — well under the 200 XP / 100g budget. Deliberately small
(anti-farming, see below).

## Prerequisites

- Each chain quest's `pre` = the previous quest id (`tut_steps` has none;
  `tut_hatch` requires `tut_pet`). `tut_daily` has NO `pre` and NO `chain` —
  it is available from level 1 alongside the chain and nothing depends on it,
  so a player who already claimed today (or never claims) is never stuck.
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
- **Tiny payouts** (chain 150 XP / 75g total, side +15/10): worthless to farm versus even the
  lowest bounty (`bt_slime`: ~scaled 30+lvl×14 XP per day, repeatable).
- **`kill` ×1 on a plentiful mob**: no rare-spawn camping, no AoE-farm value.
- **`collect` ×2, consumed on turn-in**: `complete()` calls `takeMat` for
  collect/deliver items, so stockpiled sunpetals are eaten, not banked.
- **`craft` + `use` pair**: the brewed tonic must actually be drunk (pack
  `onUse` hook), so a bot cannot just craft-and-stockpile through the step.
- **`skill` + `talk` pair**: the dash must genuinely be cast (`SKILL_CAST`
  fires only after the learn/cooldown guards in `WorldScene.cast`), then
  reported to Maren — a talk alone no longer suffices.
- **Chain total still tiny** (150 XP / 75g + 15/10 optional side): worthless
  to farm versus even the lowest bounty (`bt_slime`: ~scaled 30+lvl×14 XP
  per day, repeatable).
- **Daily side quest is non-repeat + once-per-day by engine**: `status()`
  returns `done` forever after one claim; no chain step depends on it.
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
- `skill` — `onSkill(id)` → `_bump('skill', id, 1)` (questSystem.js:255);
  exact-id match (`o.id === id`, questSystem.js:242). `SKILL_CAST` emitted
  from `WorldScene.cast()` (WorldScene.js:473) AFTER the learn (`skillLv`,
  base keys 1–4 start at Lv1 — ModularPlayer.js:157-161) and cooldown guards,
  so credit = a genuine cast. `tut_skills` uses `{ t:'skill', id:'dash', n:1 }`;
  `needOf` defaults `n` to 1.
- `daily` — `onDaily()` → `_bumpType('daily', 1)` (questSystem.js:256),
  id-blind: any claim credits every active `daily` objective. Guarded by
  `claimed` truthy (questSystem.js:77); `DailyRewards.claim()` emits
  (dailyRewards.js:183) once per day (`claimedDays[today]`, dailyRewards.js:121).
  `tut_daily` uses `{ t:'daily', n:1 }`.
- `pethatch` — `onPetHatch(id)` → `_bump('pethatch', id)` + id-less-only
  `_bumpType('pethatch', 1, true)` (questSystem.js:257,261-276: a quest mixing
  generic + specific steps never double-counts). `PET_HATCH` emitted on
  capture success in `petEncounter._attemptCapture` (petEncounter.js:247);
  wisps spawn from kills (petEncounter.js:92), capture needs a Wayfarer Orb
  (25g, items.js:82 — chain pays 75g before this step). `tut_hatch` uses
  generic `{ t:'pethatch', n:1 }`, so any captured line counts.
- Chain completion toasts/achievements (`complete()` questSystem.js:217-223,
  `chain: 'tutorial'`) work automatically once `TUTORIAL_CHAIN` is registered
  in `CHAINS` (needs `CHAINS['tutorial']` to exist for the name lookup;
  otherwise falls back to the raw id — harmless).

## Remaining gaps ( NOT in this change)

The beats below still have **no engine hook today**, so they stay on proxies.
Each needs a small engine addition by the owning track:

1. **Movement / steps** — no step counter or quest hook exists; `explore`
   (POI/zone proximity) is the only movement-adjacent objective. Wanted (if a
   true "walk N steps" tutorial is desired): accumulate distance in
   `WorldScene.update` and add `{ t: 'steps', n }` support. `tut_steps`
   (walk to Thistle Plaza) is the accepted substitute.
2. **First combat hit (as distinct from a kill)** — quest credit fires only on
   kill (`onKillContent`). There is no "landed a hit" hook. `tut_blade`
   (kill ×1) covers it for onboarding purposes; a hit-level objective would
   need combat.js to call something like `quests.onHit()` from the damage path.

## Known limitation: `tut_skills` class coverage — RESOLVED

No starter skill id is shared by every class (verified in `src/data/jobs.js`):
`dash` exists in wayfarer / ranger / bandit (key 3) but arcanist has `blink`
(key 3) instead. `_bump` now accepts an id list
(`Array.isArray(o.id) ? o.id.includes(id) : o.id === id`, questSystem.js),
and `tut_skills` uses `{ t:'skill', id:['dash','blink'], n:1 }` — all 4 base
classes get a genuine cast step (base abilities are retained after
specialization, so it stays valid).

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
