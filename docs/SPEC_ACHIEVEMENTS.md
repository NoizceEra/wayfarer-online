# SPEC_ACHIEVEMENTS — specialization achievements

10 achievements in `src/systems/achievements.js` (total roster 52 → 62).
All follow the existing `C(id, name, desc, test, prog, reward)` pattern, pure
counter/level reads in tests, rewards in existing grant keys (`xp`, `gold`)
via the existing `questSystem.grant()` path. No new events, no new emitters,
no direct `prog` reads.

## Trigger mechanism

`ModularPlayer.buySpecNode()` and `ModularPlayer.chooseClass()` both call
`_emitProgress()`, which emits the existing `Events.PROGRESS` bus event with
`{ level, statPoints, skillPoints, adv, paths: {...prog.paths}, nodes }`.
The `Achievements` class subscribes (`this.specOff`, cleaned up in
`destroy()` alongside the other subs) and mirrors best-seen values into
counters — the same pattern `syncSeasonBest()` uses for season tiers:

- `PROGRESS.nodes` → `spec_nodes` (total nodes bought)
- `PROGRESS.paths.might/ward/spirit` → `spec_might` / `spec_ward` / `spec_spirit`
- truthy `PROGRESS.adv` → `spec_adv = 1`

`spec_focus10` additionally reads `x.level` from the existing `ctx()`
(`scene.player.level`); the existing `LEVEL_UP` subscription re-runs `check()`,
so it fires on level-up as well as on spec buys.

## Achievements

| id | name | unlock condition | reward |
|----|------|------------------|--------|
| `spec_first` | First Lesson | buy first spec node (`spec_nodes ≥ 1`) | 100 xp, 50 gold |
| `spec_might1` | Edge of Might | first Might node (`spec_might ≥ 1`) | 100 xp, 50 gold |
| `spec_ward1` | Warden's Footing | first Ward node (`spec_ward ≥ 1`) | 100 xp, 50 gold |
| `spec_spirit1` | Kindred Spirit | first Spirit node (`spec_spirit ≥ 1`) | 100 xp, 50 gold |
| `spec_might4` | Paragon of Might | all 4 Might nodes (`spec_might ≥ 4`) | 400 xp, 200 gold |
| `spec_ward4` | Bastion Unbroken | all 4 Ward nodes (`spec_ward ≥ 4`) | 400 xp, 200 gold |
| `spec_spirit4` | Spirit Ascendant | all 4 Spirit nodes (`spec_spirit ≥ 4`) | 400 xp, 200 gold |
| `spec_focus10` | Focused Path | level ≥ 10 with 3+ nodes in one path | 350 xp, 175 gold |
| `spec_adv` | New Calling | choose an advanced class (`spec_adv ≥ 1`; `chooseClass` enforces the Lv10 + path-gate checks) | 300 xp, 150 gold |
| `spec_dabbler` | Dabbler | ≥ 1 node in each of might/ward/spirit | 250 xp, 125 gold |

Paths are `might` / `ward` / `spirit` per `TREE_PATHS` (`src/data/skillTrees.js`);
each path is a linear 4-node track (levels 2/4/6/8), so `≥ 4` in a path means
full completion. Advanced-class choice is path-gated (`ADV_TREE_GATES`,
enforced inside `chooseClass()`), so `spec_adv` only ever fires on a gated
choice.

## Verification

- `node --check src/systems/achievements.js` passes.
- Only files touched: `src/systems/achievements.js`, `docs/SPEC_ACHIEVEMENTS.md`.
