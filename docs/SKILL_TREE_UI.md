# Skill Tree UI

Panel: `src/ui/SkillTreePanel.js` (class `SkillTreePanel`), mounted in
`src/scenes/UIScene.js` as `this.skillTreePanel` following the ArenaPanel
precedent exactly.

## Open / close

- HUD icon `✦` (left of the arena `⚡` icon; avoids `⚔ 🏆 👥 ⚜ ⚡ 🎁`).
- Keybind: **T** (`input` action `spec`, group Panels). Chosen over a
  `/spec` chat command so no file outside this lane (`social/index.js`)
  is touched; a `/spec` alias can be added later by calling
  `uiScene.skillTreePanel?.toggle()` from the command switch.
- Escape closes via `input.addCloser({ id: 'spec', priority: 936 })`.

## Behavior

- Three columns (MIGHT green / WARD cyan / SPIRIT purple), 4 nodes each,
  with level reqs (2/5/8/12) and point costs (1/1/2/3). Prereqs chain
  down each column.
- States: **owned** (path-color fill + ★) / **available** (colored border,
  affordable) / **locked** (grey + reason: `Req Lv X`, `Needs <prior>`,
  or `No points`).
- Click a node to inspect; BUY uses a two-step confirm affordance
  (first click arms `CONFIRM?`, second click spends; arm expires after 5s,
  switching nodes disarms).
- Header shows `Lv N · M pts` from `player.level` /
  `player.prog.skillPoints`; re-renders on `LEVEL_UP` / `PROGRESS` bus events.

## Engine contract (sibling track)

All optional, every access in try/catch:

- `player.getSpecTree?.()` → override the built-in static tree.
- `player.getSpecNodes?.()` (or `prog.specNodes`, or `prog.paths` values
  flattened) → owned node ids.
- `player.buySpecNode?.(id)` → boolean.

Without `buySpecNode` the panel degrades to **read-only**: the tree is
fully inspectable, buys report `READ-ONLY — spec engine not linked yet`,
and nothing throws.

## Regressions to watch

- `node --check` both files after edits (ES modules, Phaser globals).
- UIScene size should grow only modestly (~1.2KB / ~20 lines).
- Closer priority 936 sits just above arena (935); Escape order: spec →
  arena → others.
- `KeyT` was verified unbound (`KeyJ/K/N/H` taken); rebinding-safe via
  `registerAction`.
