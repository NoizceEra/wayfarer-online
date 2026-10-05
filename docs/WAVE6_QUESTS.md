# Wave 6 — Mid-Game Quest Chains

New data module: **`src/data/quests/wave6.js`** (12 quests, 2 chains, player level 8–15).
Purely additive, data-only; no engine change.

## Exports (what the parent must import)

```js
import { WAVE6_CHAINS, WAVE6_QUESTS } from './quests/wave6.js';
```

Wire it in `src/data/quests.js` **before** `QUESTS_BY_ID` is built (next to the
existing `TUTORIAL_QUESTS` / `JOB_CHANGE_QUESTS` pushes):

```js
QUEST_LIST.push(...WAVE6_QUESTS);   // -> export const QUESTS_BY_ID = ...
Object.assign(CHAINS, WAVE6_CHAINS); // with the other Object.assign(CHAINS, ...) calls
```

- `WAVE6_QUESTS` — array of 12 quest objects (same shape as `jobChange.js` / `tutorial2.js`).
- `WAVE6_CHAINS` — `{ ashen_watch, fen_watch }` chain defs `{ id, name, zones, blurb }`.

## The two chains

### 1. `ashen_watch` — “The Ashen Watch” (Lv 8→11; Town, Tidehollow Ruins, Crypt)

| id | name | giver → turn-in | objectives | reward |
|---|---|---|---|---|
| `aw_answer` | The Watch Answers | Captain Rusk → Warden Tamsin | talk Warden Tamsin; explore `ruins_altar` | 180 xp · 75 g |
| `aw_salvage` | Salvage the Watch | Warden Tamsin | collect `rust_scrap`×4; `bone_shard`×3 | 340 xp · 140 g · guard_elixir |
| `aw_gate` | Hold the Old Gate | Warden Tamsin | kill `rustskull`×4; `bogspirit`×3 | 430 xp · 175 g · greater_potion |
| `aw_ledger` | A Ledger in Grave Dust | Captain Rusk → Granny Elda | deliver `grave_dust`×3 (`give` on accept) | 380 xp · 165 g · recipe guard_elixir |
| `aw_breach` | Into the Breach | Captain Rusk | kill `bonesentinel`×4; collect `tide_shard`×3; explore area `crypt` | 560 xp · 225 g · greater_potion×2 · +1 stat pt |
| `aw_eye` | The Eye That Watches | Warden Tamsin | kill `tideeye`×2 | 620 xp · 250 g · +2 stat pts |

### 2. `fen_watch` — “The Fen Watch” (Lv 10→13; Whisperfen Marsh)

| id | name | giver → turn-in | objectives | reward |
|---|---|---|---|---|
| `fw_lights` | Lights on the Boardwalk | Fenwarden Moss | kill `mwisp`×5; talk Herbwife Briar; explore area `marsh` | 500 xp · 175 g · herbal_tonic×2 |
| `fw_harvest` | Briar’s Basket | Herbwife Briar | collect `glow_cap`×5; `fen_lily`×3 | 540 xp · 185 g · mana_draught×2 |
| `fw_toads` | Toads on the Planks | Fenwarden Moss | kill `mtoad`×8; `mleech`×5 | 620 xp · 205 g · greater_potion |
| `fw_tonic` | A Draught for the Wardens | Herbwife Briar → Fenwarden Moss | deliver `toad_slime`×4 (`give` on accept) | 560 xp · 200 g · empty_vial×2 |
| `fw_deep` | What Feeds the Lights | Fenwarden Moss | kill `mkappa`×4; `mirelurker`×3 | 720 xp · 235 g · guard_elixir · +1 stat pt |
| `fw_gloomtoad` | The Old Gloomtoad | Fenwarden Moss | kill `gloomtoad`×1; collect `wisp_lantern`×3 | 1700 xp · 520 g · +2 stat pts |

Both chains are linear (`pre` prerequisites), non-repeat (no `repeat` flag),
one-time rewards. `ashen_watch` opens at Lv 8 and interlocks with the existing
`ashen`/`lantern` thread via Captain Rusk and Warden Tamsin; `fen_watch` opens at
Lv 10 alongside the existing `whisper` chain but from the Fenwatch stilts.

## Objective types used

Only the five the brief asks for, all handled by the engine today:

- `kill{id,n}` — `ENEMY_TABLE` type id; credit via `_bump('kill', …)`.
- `collect{id,n}` — `MATS`/`matById` id; live pack progress via `onPack` (works for
  gathered nodes **and** monster-part drops, both of which land in `meta.mats`).
- `talk{npc}` — registered NPC **name**; credit in `quests.talk()`.
- `explore{poi}` / `explore{area}` — `POIS` key (proximity) / built area id
  (`checkLoreAndExplore`; `o.area === scene.areas.current.id`).
- `deliver{id,npc}` — `MATS` id + target name; ready while the mat is in the pack,
  granted up-front by the quest’s `give:{}` and consumed at turn-in by `complete()`.
  Used exactly like the shipped `q_letter` / `q_sigil` / `q_frostnote` deliveries
  (`turnIn` points at the delivery target).

Reward fields used: `xp`, `gold`, `mats{}`, `recipes[]`, `statPoints`.

## Id verification (throwaway script, run then deleted — exit 0, PASS)

`node --check src/data/quests/wave6.js` → **exit code 0**, file size **12487 bytes**.
A throwaway ESM verifier imported `wave6.js`, extracted every referenced id, and
resolved each against the real source files. All **32** distinct ids matched:

| category | id | source (file:line) |
|---|---|---|
| mob | bogspirit | src/data/jobs.js:154 |
| mob | rustskull | src/data/jobs.js:155 |
| mob | tideeye | src/data/jobs.js:156 |
| mob | bonesentinel | src/data/worldEnemies.js:19 |
| mob | mirelurker | src/data/worldEnemies.js:115 |
| mob | mtoad | src/data/enemiesExtra.js:32 |
| mob | mwisp | src/data/enemiesExtra.js:33 |
| mob | mleech | src/data/enemiesExtra.js:34 |
| mob | mkappa | src/data/enemiesExtra.js:38 |
| mob | gloomtoad | src/data/enemiesExtra.js:39 |
| mat | bone_shard | src/data/materials.js:24 |
| mat | rust_scrap | src/data/materials.js:38 |
| mat | tide_shard | src/data/materials.js:39 |
| mat | grave_dust | src/data/materials.js:41 |
| mat | empty_vial | src/data/materials.js:47 |
| mat | herbal_tonic | src/data/materials.js:50 |
| mat | greater_potion | src/data/materials.js:51 |
| mat | mana_draught | src/data/materials.js:52 |
| mat | guard_elixir | src/data/materials.js:54 |
| mat | fen_lily | src/data/materialsExtra.js:19 |
| mat | glow_cap | src/data/materialsExtra.js:20 |
| mat | toad_slime | src/data/materialsExtra.js:22 |
| mat | wisp_lantern | src/data/materialsExtra.js:23 |
| npc | Captain Rusk | src/world/areaBuilders.js:109 |
| npc | Granny Elda | src/world/areaBuilders.js:184 |
| npc | Warden Tamsin | src/data/quests.js:19 (NPC_SPOTS) |
| npc | Fenwarden Moss | src/data/npcsExtra.js:20 |
| npc | Herbwife Briar | src/data/npcsExtra.js:22 |
| poi | ruins_altar | src/data/quests.js:25 |
| area | crypt | src/data/areas.js:48 |
| area | marsh | src/data/areasExtra.js:33 |
| recipe | guard_elixir | src/systems/crafting.js:32 |

NPC reachability (grep-confirmed, not just declared): all five givers are added
through `AreaManager.addNpc`, whose interact handler calls
`scene.quests.talk(cfg.name, …)` — Captain Rusk & Granny Elda in
`world/areaBuilders.js` (`inn` / `elda` interiors); Warden Tamsin via
`quests.js NPC_SPOTS` placed by `WorldScene`; Fenwarden Moss & Herbwife Briar via
`data/npcsExtra.js`, placed by `world/townfolk.populateArea` when the marsh builds.

## Deliberately dropped (no unverifiable ids invented)

- **No `craft` / `use` / `skill` steps.** `START_RECIPES` are only `herbal_tonic`
  and `grilled_fish` (`crafting.js`); every other recipe needs discovery, so a
  `craft` objective risks a stalled chain. `guard_elixir` is granted as a recipe
  *reward* (learnable via `RECIPE_BY_ID`) but not required to be crafted.
- **No `interact` steps.** The engine’s only registered interactable is
  `garrick_net` (`questSystem.INTERACT_NAMES`); nothing new was invented.
- **No `gear` or `lore` rewards.** Those ids live in separate catalogues
  (`data/gear.js`, `quests.js LORE`); omitted to keep every referenced id inside
  the verified mob/mat/npc/poi/area set.
- **Desert/Caverns/Hollow content not used** — those zones are Lv 13–20, outside
  the requested Lv 8–15 mid-game band; Ruins/Crypt (8–13) and Marsh (10–14) fit.
