# Specialization Trees — data + engine contract

Data: `src/data/skillTrees.js`. Pure data + pure helpers, no Phaser.
Trees are the levels 2–9 game: by the time class change unlocks at 10, a
character has spent up to 8 skill points (1/level, `SKILL_POINTS_PER_LEVEL`)
across base-skill upgrades (`upgradeSkill`, keys 1–4) and tree nodes.

## Layout

4 base jobs × 3 paths (Might = attack, Ward = defense, Spirit = support) ×
4 linear nodes = 48 nodes. Node id: `<job>.<path>.<index>` (index 1–4).

| Job | Might (skill nodes) | Ward (skill nodes) | Spirit (skill nodes) | Stat/mult nodes used |
|---|---|---|---|---|
| wayfarer | slash+1, flare+1 | dash+1 | camp+1, camp+1 | str, crit, vit, hpMul, int, mpMul |
| ranger | shot+1, volley+1 | dash+1 | snare+1, snare+1 | dex, crit, vit, move, agi, luk, mpMul |
| arcanist | bolt+1, burst+1 | ward+1, blink+1 | blink+1, burst+1 | int, crit, vit, hpMul, mpMul |
| bandit | stab+1, fan+1 | dash+1 | smoke+1, smoke+1 | str, crit, agi, hpMul, vit, luk, aspd |

Node levels: N1 req 2, N2 req 4, N3 req 6, N4 req 8. Cost: 1 skill point each.

Duplicate skills across paths (arcanist blink in Ward N3 + Spirit N1, burst in
Might N3 + Spirit N3) are intentional: bonuses stack, still capped — see below.

## Prog fields (engine track implements)

```js
prog.trees = {
  paths: { might: <n>, ward: <n>, spirit: <n> }, // cached counts, engine-kept in sync
  nodes: ['wayfarer.might.1', /* ... */],       // purchased node ids
};
```

- `sanitizeProgression()` (src/core/save.js) must accept + clamp `trees`:
  keep only ids where `treeNodeById(id)` is non-null and node.job === jobId,
  drop dupes, recompute `paths` via `pathCounts()`. Unknown-job / unknown-id
  entries are dropped, never crash.
- `paths` is a cache of `nodes`; on any purchase/respec recompute it, do not
  hand-increment in two places.

## Purchase validation (engine calls `canBuyTreeNode`)

Buy allowed iff ALL hold, checked in this order (reason codes in parens):

1. Node exists (`unknown-node`).
2. `node.job === hero.job` — trees are per-base-job, no cross-job nodes (`wrong-job`).
3. Node not already owned (`already-owned`).
4. Linear order: node N (N>1) requires node N−1 of the same path owned (`prereq-order`).
5. `hero.level >= node.reqLevel` (2/4/6/8) (`level-gated`).
6. `prog.skillPoints >= node.cost` (1) (`no-skill-point`).

On success: `trees.nodes.push(id)`, `paths` recomputed, `skillPoints -= 1`,
emit progress event. Respec (if ever added) refunds 1 point per node and must
remove whole tails first (cannot leave N2 owned without N1).

## Effect application

- Skill nodes: effective level =
  `effSkillLvWithTrees(skillLv(id), treeSkillBonus(jobId, nodes, id))`
  where `skillLv(id)` is the existing ModularPlayer resolution
  (base abilities floor 1, advanced floor 0, purchased up to SKILL_MAX).
- Stat nodes: engine folds `treeStatBonus(jobId, nodes)` into the existing
  stat pipeline — `flat` merges into the `bonus` arg of `totalStats()`
  (alongside gear bonuses); `hpMul/mpMul` add onto the adv multiplier base
  of 1 (`(adv?.hpMul || 1) + tree.hpMul`); `crit/aspd/move` add onto the adv
  bases of 0 (`(adv?.crit || 0) + tree.crit`, etc.).

### Cap behavior (SKILL_MAX semantics)

`effSkillLvWithTrees` clamps to `SKILL_MAX` (5, src/data/stats.js).
Tree +1s never push past 5: e.g. slash at purchased Lv5 + Trail Edge (+1) =
effective 5, the tree point gives no extra damage (still gives gate count).
Excess is silently wasted — no refund; the tree UI should grey out a skill
node whose target is already at effective max. `skillDmgMul`/`skillCdMul`
apply to the effective level unchanged.

## Adv-gating table (engine checks in `chooseClass()`)

In addition to the existing checks (level ≥ `CLASS_CHANGE_LEVEL`, adv.base
matches job, no adv yet), `advGateMet(advId, prog.trees.paths)` must be ok:

| Adv class | Base | Gate |
|---|---|---|
| knight | wayfarer | Might 3+ |
| lanternwarden | wayfarer | Spirit 3+ |
| hunter | ranger | Might 3+ |
| wildwarden | ranger | Ward 2+ AND Spirit 2+ |
| elementalist | arcanist | Might 3+ |
| tidecaller | arcanist | Spirit 3+ |
| shadowblade | bandit | Might 3+ |
| trickster | bandit | Ward 2+ AND Spirit 2+ |

Rationale: bruisers (knight/hunter/elementalist/shadowblade) demand Might 3;
keepers (lanternwarden/tidecaller) demand Spirit 3; hybrids
(wildwarden/trickster) demand a Ward 2 + Spirit 2 split. A character that
spreads points evenly (2/2/2 by level 8 with 7 spendable points… actually 8
points by level 9: levels 2–9) can meet at most one gate — the choice is the
build commitment. Note skill points are shared with `upgradeSkill`, so a
gate also costs base-skill levels; that tension is intended.

`chooseClass` failure for gate reasons needs a distinct return/UI message
(currently returns boolean; engine track decides: return `{ ok, reason }` or
keep boolean + surface `advGateMet(...).missing` in the class UI).

## Reference integrity (verified 2026-10-05)

Every skill id and every stat key in skillTrees.js resolves to a real def:

- Skill ids → `JOBS[j].abilities[].id` / `ADVANCED` (trees use base only):
  slash, flare, dash, camp (jobs.js); shot, volley, snare (jobs.js);
  bolt, burst, blink, ward (jobs.js); stab, fan, smoke (jobs.js).
- Flat keys → `STAT_IDS` (stats.js): str, agi, vit, int, dex, luk.
- Derived keys → `computeDerived` adv slots (stats.js): hpMul, mpMul, crit, aspd, move.
- No `atk`/`atkMul`/`matk`/`def` keys are used anywhere in the tree data
  (those are computed outputs, not modifier slots).

## Open questions for the engine track

1. UI surface: new "Specialization" tab vs. extending the existing skill panel? (Data exposes `nodesForJob` for either.)
2. `chooseClass` currently returns boolean — extend to a reason code so the class UI can show "requires Might 3" vs "requires level 10"?
3. Flat tree stats vs. gear: merge tree `flat` into `equipBonuses()` output or pass separately into `recalc()`'s `bonus` arg? Latter is cleaner (gear öne, trees öne) but touches `ModularPlayer.recalc`.
4. Should `retroProg()` grant anything for trees on pre-existing saves (e.g. refund-equivalent points)? Recommendation: no — trees start empty, unspent skill points remain spendable.
5. Respec: supported at all? If yes, rule is tails-first removal (see above).
6. Net/playtest: 7–8 tree points by level 9 vs. base-skill upgrades — watch whether Might 3 gates feel mandatory vs. Spirit sustain in PvE tuning.
