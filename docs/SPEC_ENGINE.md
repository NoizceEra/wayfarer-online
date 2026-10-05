# SPEC_ENGINE — Specialization runtime contract

Owner: progression-runtime lane (`src/entities/ModularPlayer.js` + `src/data/stats.js`).
Data lane owns `src/data/skillTrees.js` (catalogue). Coordination happens ONLY
through this document. The runtime never statically imports the catalogue file,
so either lane can land first without breaking the build.

## 1. Save shape (`progress.prog`)

```
prog: {
  alloc: {str,agi,vit,int,dex,luk}, statPoints, skillPoints, skills: {id: lv}, adv,
  paths: { might: int, ward: int, spirit: int },   // NEW — invested nodes per path
  nodes: string[]                                  // NEW — owned node ids (deduped, ≤64)
}
```

- `sanitizePaths()` / `sanitizeSpecNodes()` (`stats.js`): old saves without
  `paths`/`nodes` default to `{0,0,0}` / `[]`. Malformed values clamp to
  zeros / are dropped. Complements (does not replace) `sanitizeProgression()`
  in `src/core/save.js`, which still owns the rest of the prog shape.
- `ensureSpecState(prog)` is applied in the constructor and `applyProgression()`,
  so local AND remote players always have valid spec state.

## 2. Node-def contract (what the data lane provides per node)

```
{ id: string, path: 'might'|'ward'|'spirit', reqLv: number, cost: number,
  prereq: string[], base: string|string[]|null,
  bonus: { str?… luk?… },            // flat stats — STAT_IDS keys ONLY
  skillBoost: { id: string, lv: n } }// bonus skill levels for one ability
```

- Tiers unlock at levels 2 / 4 / 6 / 8 (`reqLv`).
- One catalogue per base job; `base` names the job(s) a node belongs to.
  `null`/absent = any job (runtime treats it as pass).
- The runtime reads keys tolerantly (`normalizeSpecNode` accepts
  `level|minLevel`, `sp|points`, `requires|prev`, `job|jobs|forJob`,
  `stats`, `boost|skillId|skillLv`). Unknown node ids are ignored, never crash.

## 3. Runtime API (`ModularPlayer`)

| Method | Behaviour |
|---|---|
| `setSpecData(data)` / `specData()` | Inject the catalogue (object or `id => def` fn). Falls back to `globalThis.__WAYFARER_SKILL_TREES__`. `null` until the data lane lands → spec ops safely no-op. |
| `resolveSpecNode(id)` | Normalized def or `null`. Never throws. |
| `buySpecNode(nodeId)` | Validates: known id → not owned → under 64-cap → base-job match → `level >= reqLv` → `skillPoints >= cost` → all prereqs owned. Then deducts, pushes id, increments `paths[path]`, `recalc()`, `_emitProgress()`. Returns `true`/`false`, **never throws**. |
| `skillLv(id)` | `min(SKILL_MAX, max(base, prog.skills[id]) + specBoost)`. No spec data → identical to old behaviour. |
| `specBonus()` / `combinedBonuses()` | Owned-node flat bonuses (STAT_IDS-only) merged over `equipBonuses()` into the `computeDerived({bonus})` channel — the same channel `adv.bonus` uses via `totalStats`. Gear `atk/def/hp/mp/spd` handling untouched. |
| `classGateStatus(id)` / `chooseClass(id)` | Gate enforced in `chooseClass`. Gate sources (first hit wins): `adv.specGate ?? adv.gate ?? adv.reqSpec ?? adv.pathGate ?? catalogue.advGates[id] ?? catalogue.classGates[id]`. Shapes: `{path, points|min|need}`, `{might:n,…}`, or `'might'` (≥1). **No gate data → old behaviour** (level ≥ 10, base match). Gate errors fail open. |
| `upgradeSkill(id)` | Unchanged, backward compatible. |
| `_emitProgress()` | Old payload plus additive `paths: {...}` and `nodes: count`. Existing listeners unaffected. |

## 4. Wiring (scene / UI lane)

1. After the data lane lands: `player.setSpecData(trees)` for the local
   player (and remote puppets if their nodes arrive over the net), or set
   `globalThis.__WAYFARER_SKILL_TREES__ = trees` once at boot.
2. `progress.prog` already serializes `paths`/`nodes` (plain JSON); no save
   migration needed. No respec: purchases are permanent (see §5).

## 5. Regressions to watch

- **Saves**: pre-spec saves load with zeroed spec state and unchanged stats
  (bonuses only come from owned, known nodes). Verify: load an old save →
  derived stats byte-identical to before.
- **Remote players**: puppets share the global catalogue fallback; unknown
  node ids from newer clients are ignored, never crash. Verify mixed-version.
- **Respec-less permanence**: there is intentionally no refund path.
  `buySpecNode` has no inverse; `applyProgression` never prunes owned ids
  except sanitize/dedupe. If respec is ever added, it must decrement
  `paths[path]` symmetrically.
- **Double-spend**: duplicate buy returns `false` (owned check first).
- **Cap**: `nodes` hard-capped at 64; `skillLv` capped at `SKILL_MAX`.
- **Stat keys**: node `bonus` keys outside `str…luk` are dropped at
  normalization — data lane must not rely on `atk/hp/crit` in node bonuses
  (those channels belong to gear / advanced classes).
- **Build**: no static import of `skillTrees.js` anywhere in this lane, so a
  missing catalogue cannot break bundling.
