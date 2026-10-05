# Enemy status readability (world)

**Scope:** presentation only. Adds an on-sprite status readout for enemies carrying
`burn / poison / slow / stun` (and `shield`, mapped ahead of its catalogue entry).
Touches **only** `src/systems/status.js`. No gameplay, stat, timer, or damage path changes.

## What it does

While an enemy carries any status, a small pooled glyph (tinted diamond) is drawn above
its sprite — one per live status, centred over the head — plus, for boss / elite
(`rank.id !== 'normal'`) enemies, a pulsing tinted halo behind the sprite so the "big
scary thing is debuffed" read is stronger than for trash mobs.

## Why it can live entirely in `status.js`

`StatusSet` is constructed bare (`new StatusSet()`, `Enemy.js:50` / `combat.js:31`) and
holds no back-reference to its owner. The readout therefore **late-binds** on the first
`apply()`: it finds the owning enemy by identity (`enemy.statuses === set`) inside the
active scene's `enemies` physics group, reached through the app's existing debug/testing
handle `window.__wayfarer` (`src/main.js:51`). If that handle is absent (headless /
unit contexts) the readout is a silent no-op and nothing else in the module changes.

Binding is cached per `StatusSet` in a `WeakMap`; a scene-level `'update'` listener drives
the per-frame refresh. All readout state lives in module `WeakMap`s keyed by `StatusSet` /
`Scene`, so **no field is ever added to an enemy object** (or to `StatusSet` itself).

## Correctness guarantees

| Concern | How it is handled |
| --- | --- |
| Stale icon after a status ends | Readout is rebuilt from the live `Map` every frame; `n` glyphs shown, the rest hidden. No cached id list. |
| Icon on a dead / despawned enemy | `step()` frees the record's images the same frame `ent.dying`, `!ent.active`, or `hp <= 0`; a `scene.events.once('shutdown')` sweep recycles everything if the scene dies. |
| `statuses.clear()` (enemy leashes home) | `set.size === 0` is detected next frame and images recycle. |
| Off-screen enemies | Culled to `setVisible(false)` (kept, not freed) against `cameras.main.worldView`. |
| No per-frame allocations | `Map.forEach` with a single module-level callback + cursor (no closure/iterator/array); images come from a per-scene pool (`s.free`), capped at 48 (mobile) / 160. |

## Settings / mobile

Follows the established `skillVfx.js` gating:

- `settings.reduceMotion` (`settings.js:13`) — `calm()` disables every pulse (glyph alpha
  static at 1, halo static at 0.5). No flashing.
- `CONFIG.isMobile` (`config.js:13`) — smaller glyphs (×0.85), tighter spread, and a lower
  pool cap. (Matches `skillVfx.js:18` which scales density by 0.7 on mobile.)

## Colour provenance (no invented colours)

| Status | Glyph / halo tint | Source |
| --- | --- | --- |
| burn | `0xff8a30` | `ELEMENT.fire` — `src/systems/skillVfx.js:14` |
| poison | `0x7fe06a` | `ELEMENT.nature` — `src/systems/skillVfx.js:14` |
| slow | `0x9fe0ff` | `ELEMENT.ice` — `src/systems/skillVfx.js:14` |
| stun | `0xffee55` | `ELEMENT.thunder` — `src/systems/skillVfx.js:14` |
| shield | `0x9945ff` | Solana palette purple — `src/ui/ArenaPanel.js:8` |

`shield` has no `STATUS` entry yet (`src/data/combatMath.js:81`), so it never fires today;
it is mapped now so a future ward reads right. The existing "Shielded" float text uses
`0xd0a0ff` (`src/systems/combat.js:147`) if that is preferred when a ward is added.

## Not gameplay

The only edit to existing code is one additive line at the top of `apply()`:

```js
readoutWatch(this); // presentation hook only — the timer math below is unchanged
```

`has`, `size`, `tick`, `list`, `clear` are byte-identical to the pre-change file.
