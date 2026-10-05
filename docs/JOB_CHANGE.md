# Job-Change Trial Chains

Data-only Ragnarok parallel: 8 trial chains (one per advanced job), 3 linear
steps each, opening at level 9 and completable pre-10 (all content lives in
town/meadow/woods/ruins/dock). File: `src/data/quests/jobChange.js`, exporting
`JOB_CHANGE_CHAINS` + `JOB_CHANGE_QUESTS` (mirrors `src/data/quests/tutorial2.js`
`TUTORIAL_CHAIN`/`TUTORIAL_QUESTS` pattern).

## Per-chain table

| Chain | Job (base) | Giver (verified in `src/data/quests.js`) | Steps | Trial flavor |
|---|---|---|---|---|
| `job_knight` — Trial of the Bulwark | Knight (wayfarer) | Captain Rusk (`sq_bones` giver, line 119) | talk Rusk → kill rustskull ×4 → kill tideeye ×2 | oath, hold the gate, duel |
| `job_lanternwarden` — Trial of the Lantern | Lantern Warden (wayfarer) | Pip (`q_meadow` giver, line 42) | talk Pip + explore town_plaza → collect sunpetal ×4 → kill willowisp ×4 | keep the light, rekindle |
| `job_hunter` — Trial of the Longbow | Hunter (ranger) | Forager Sable (`q_sable` giver, line 220; `NPC_SPOTS`) | talk Sable → kill thornmite ×5 → kill capling ×4 | listen, precise shots |
| `job_wildwarden` — Trial of Root and Remedy | Wildwarden (ranger) | Granny Elda (`q_elda1` giver, line 157) | collect dewberry ×5 → collect moonmoss ×4 + explore woods_glade → kill capling ×4 | know, walk, cut blight |
| `job_elementalist` — Trial of the Raw Current | Elementalist (arcanist) | Maren (`q_ruins` giver, line 54) | skill [dash,blink] ×2 → kill bogspirit ×4 → kill tideeye ×1 | spend power, waste nothing |
| `job_tidecaller` — Trial of the Turning Tide | Tidecaller (arcanist) | Dockmaster Orla (`sq_crabs` giver, line 86) | explore dock_square + talk Orla → kill shorecrab ×6 → kill bogspirit ×3 | read water, face source |
| `job_shadowblade` — Trial of the Quiet Knife | Shadowblade (bandit) | Warden Tamsin (`q_tamsin` giver, line 226; `NPC_SPOTS`) | explore ruins_altar + talk Tamsin → kill mossbat ×6 → kill rustskull ×3 | walk unheard, night hunt |
| `job_trickster` — Trial of the Crooked Smile | Trickster (bandit) | Old Tob (`q_tob` giver, line 196) | talk Tilly + talk Old Wick → collect dewberry ×5 → kill dewslime ×5 | work a crowd, slip away |

Talk targets Tilly (`q_tob` obj, line 199) and Old Wick (`q_cartographer`
giver, line 202) are established NPCs. POIs `town_plaza`, `woods_glade`,
`ruins_altar`, `dock_square` are all in `POIS` (lines 22–29). Enemy ids
(dewslime, mossbat, thornmite, capling, willowisp, bogspirit, rustskull,
tideeye, shorecrab) spawn in pre-10 zones (`worldEnemies.js`, `areas.js`).
Rewards are xp/gold/mats only (mats ids: greater_potion, guard_elixir,
empty_vial, sunpetal, moonmoss, dewberry, slime_gel — all in `materials.js`).

## Registry snippet (parent adds this — DO NOT edit other files from this lane)

In `src/data/quests.js`, mirror the tutorial2 registration:

```js
// top of file, next to the other quest imports:
import { JOB_CHANGE_CHAINS, JOB_CHANGE_QUESTS } from './quests/jobChange.js';

// next to the other QUEST_LIST.push lines (BEFORE `QUESTS_BY_ID` is built):
QUEST_LIST.push(...JOB_CHANGE_QUESTS); // job-change trials: 8 chains x 3 steps (data/quests/jobChange.js)

// next to the other Object.assign(CHAINS, ...) lines:
Object.assign(CHAINS, JOB_CHANGE_CHAINS);
```

Order matters: the push must run before
`export const QUESTS_BY_ID = Object.fromEntries(...)` (line 238), exactly like
the `TUTORIAL_QUESTS` push on line 237.

## Missing-hook notes

- **No engine changes needed.** All objectives (kill/collect/talk/explore/skill
  with id array) are handled by `questSystem.js` `_bump`/`_bumpType`/`onPack`
  (`_bump` matches `Array.isArray(o.id)`, verified line 243) and all rewards
  (xp/gold/mats) by `grant()`/`rewardLines()`.
- **No actual job promotion is wired.** These chains are trials in flavor only:
  nothing in the engine auto-promotes a player to the advanced job on
  completion, and no `jobChange` reward type exists. The parent (or a later
  task) must decide the promotion mechanic (e.g. check chain completion in the
  job UI). Out of scope for this data-only lane.
- **No `pre` link to the main story.** Chains are standalone at lv 9 (no
  `q_sigil` prerequisite) so any base class can trial its path on schedule.
  Tighten later if design wants gating.
- **`slime_gel` as a reward mat** (trickster finale) matches its use as a
  `mats` reward id elsewhere (`q_hob1` rewards `dewberry`; `slime_gel` is a
  material in `materials.js` and a crafting input) — safe.
