# Spec Respec (gold sink)

Reset a character's specialization (Might / Ward / Spirit) for gold.
Engine: `ModularPlayer.resetSpec()` / `respecCost()` (`src/entities/ModularPlayer.js`).
UI: RESPEC button in `SkillTreePanel` (`src/ui/SkillTreePanel.js`).

## Rules

- **Level gate:** requires level >= 10 (`CLASS_CHANGE_LEVEL`, the same gate as
  `chooseClass`). Below 10 → returns `false`, no charge.
- **Cost:** `500g × (times-respecced + 1)` — 500g first, 1000g second, 1500g
  third, … via `respecCost()`.
- **Gold gate:** if current gold < cost → returns `false`, no charge, nothing cleared.
- **Idle no-op:** if no spec nodes are owned and all path counters are zero →
  returns `false` (no charge for an empty reset).
- **On success:** `prog.nodes` cleared, `prog.paths` zeroed
  (`{might:0, ward:0, spirit:0}`), `prog.respecs` incremented, derived stats
  recomputed (`recalc()`), progress emitted (`_emitProgress()`).
- **No skill-point refund:** skill points spent via `buySpecNode` are NOT
  returned (no refund path exists anywhere in the codebase). Respec wipes the
  nodes; the points stay spent.
- **Never throws:** all paths return `true`/`false`; unexpected errors → `false`.
- **Advanced class untouched:** `prog.adv` is NOT cleared (class choice is permanent).

## Gold path (evidence)

Player gold is a plain number on the player object (`this.gold = 20` at
`ModularPlayer` construction). There is NO `spendGold`/`addGold` helper —
every existing deduction is a guarded direct subtraction:

- `src/world/townfolk.js:81` — `if (p.gold < it.price) {...} p.gold -= it.price;`
- `src/world/areaBuilders.js:103` — `if (p.gold < 3) {...} else { p.gold -= 3; ... }`

`resetSpec()` reuses exactly this path: `if (gold < cost) return false;`
then `this.gold = gold - cost` (floored, non-finite-safe).

## Persistence decision: session-local counter (documented limitation)

`prog.respecs` (int, sanitized inline in `resetSpec`/`respecCost`, defaults 0)
is kept on `prog` but is **session-local — it does NOT survive save/load**:

- `sanitizeProgression` (`src/core/save.js:70-86`) rebuilds `prog`
  field-by-field (`alloc/statPoints/skillPoints/skills/adv/paths/nodes`) and
  **drops unknown subfields**, so `respecs` is lost on `applyProgression`.
- `ensureSpecState` (`src/data/stats.js:133-138`) only repairs
  `paths`/`nodes`.
- Per task scope, `stats.js`/`save.js` were NOT touched, so after a reload the
  counter resets to 0 and the next respec costs 500g again.

To persist it later: add `out.respecs = clampInt(raw.respecs, 0, 999, 0)` in
`sanitizeProgression` (and `newProg`), or mirror the count into a whitelisted
`ext` field — `normalizeExtras` likewise drops unknown keys, so that also
needs an explicit slot.
