# Quest Hooks — skill cast, daily claim, pet hatch

Three onboarding beats in `src/data/quests/tutorial2.js` (`tut_steps`…`tut_pet`)
previously used talk/explore proxies because the quest engine had no hooks for
them. The hooks below close that gap. All credit flows through the normal
`QuestSystem._bump` path (progress caps, `notifyObj`, `changed`), so completion,
turn-in, tracker, and journal behaviour is identical to existing types
(`kill`, `craft`, …).

## New objective types

| `t`        | Shape                        | Credited by                              | Example                              |
|------------|------------------------------|------------------------------------------|--------------------------------------|
| `skill`    | `{ t:'skill', id, n? }`      | `QuestSystem.onSkill(id)`                | `{ t: 'skill', id: 'bolt', n: 3 }` — cast Bolt 3 times |
| `daily`    | `{ t:'daily', n? }`          | `QuestSystem.onDaily()`                  | `{ t: 'daily' }` — claim the daily reward once |
| `pethatch` | `{ t:'pethatch', id?, n? }`  | `QuestSystem.onPetHatch(id?)`            | `{ t: 'pethatch' }` — hatch/capture any pet; `{ t:'pethatch', id:'emberling' }` — that line only |

`needOf` default `n` is 1. `daily` ignores `id` (a claim credits every active
`daily` objective). `onPetHatch(id)` credits both id-specific steps matching
`id` and generic id-less steps — but never double-counts one quest that mixes
both (generic branch skips steps with an `id`).

## Bus events and payloads

| Event | String | Emitted by | Payload |
|-------|--------|------------|---------|
| `Events.SKILL_CAST` | `'skill-cast'` | `WorldScene.cast()` (src/scenes/WorldScene.js), right after the learn/cooldown guards, before any skill branch — covers `camp`, `ward`, `dash`/`blink`, `snare`/`smoke`, and the default bolt/burst path | `{ id }` — ability id, e.g. `{ id: 'bolt' }` |
| `Events.DAILY_REWARD` | `'daily-reward'` (pre-existing) | `DailyRewards.claim()` (src/systems/dailyRewards.js:183, untouched) | `{ claimed: true, day, gold, tokens }`; quest credit fires only when `claimed` is truthy |
| `Events.PET_HATCH` | `'pet-hatch'` | `PetEncounterSystem._attemptCapture` success (src/systems/petEncounter.js) — capture is the in-engine hatch-complete moment; the `petMaster.js` starter-hatch flow is out of scope and untouched | `{ id }` — pet line id, e.g. `{ id: 'emberling' }` |

## QuestSystem wiring

- Constructor subscribes (auto-removed in `destroy()` via `this.offs`):
  `SKILL_CAST → onSkill(e.id)`, `DAILY_REWARD → onDaily()` (claimed only),
  `PET_HATCH → onPetHatch(e?.id)`.
- `objText()` covers the three types for tracker/journal/dialogue text.
- `notifyObj()` progress pops include `skill` alongside `kill`/`use`/`craft`.

## Tutorial upgrades this unblocks

- `tut_skills`-style step: replace the talk-to-trainer proxy with
  `{ t: 'skill', id: '<first-art>', n: 1 }`.
- Daily-reward step: `{ t: 'daily' }`.
- Pet step: `{ t: 'pethatch' }` (funnels into the existing `q_pet_unlock`
  chain; data edits are a separate track — this doc covers the engine only).
