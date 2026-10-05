# Ability → fx → VFX contract (Wayfarer Online)

Single source of truth for how a job ability's `fx` block reaches the screen, the
per-field consumers, and the registries that must stay in lock-step. Audit
script: `audit-skillfx.mjs` (see “Reproducing” at the bottom).

## The pipeline

```
jobs.js  JOBS[*].abilities[] / ADVANCED[*].abilities[]   (data, has fx?)
   │
   ▼  WorldScene.cast(ab)              src/scenes/WorldScene.js:497
   │     lv   = player.skillLv(ab.id)        (0 → locked)
   │     cd   = player.cooldowns[ab.id]      (gate)
   │     setCd = () => { cooldowns[ab.id] = now + player.skillCd(ab)*1000;
   │                      emit PLAYER_HP; castVfx(this, ab, lv); }   :503
   │
   ├─ castFx(scene, ab, lv, setCd)     src/systems/skillFx.js:13   (damage/MP/CD)
   │     • charges fx.mp  :18-19
   │     • calls setCd()  :20            → cooldown + castVfx
   │     • branches on fx.type: aoe | shot | heal | buff | strike
   │
   └─ abilities WITHOUT fx (dash, blink, ward) are special-cased in WorldScene
         and call setCd() directly                                  :507/523/531
```

`castVfx(scene, ab, lv)` (`src/systems/skillVfx.js:782`) looks up `SK[ab.id]`
(bespoke animation); otherwise `genericCastVfx` draws a type-coloured generic
version. `impactAt(scene, e, ELEMENT_OF[ab.id])` tints per-enemy hit sparks.

**Invariant:** the VFX half (`castVfx`) is called from *inside* `setCd`, so a
skill that plays an animation always has its cooldown set in the same tick. A
skill that plays VFX but never sets a cooldown is impossible by construction.

## fx field consumers (skillFx.js `castFx`)

| fx field  | read at | meaning |
|-----------|---------|---------|
| `type`    | 37/51/85/94/100 | branch selector: aoe \| shot \| heal \| buff \| strike |
| `mp`      | 18, 19  | MP gate + charge |
| `mul`     | 43/77/114 | damage multiplier × `skillDmgMul(lv)` |
| `radius`  | 42, 110 | AoE / strike reach |
| `knock`   | 30      | knockback (via `hitOpts`) |
| `status`  | 31, 65  | `{id,chance,secs}` → `applyEnemyStatus` |
| `slow`    | 44      | AoE slow seconds |
| `pct`     | 88      | heal fraction of max HP |
| `spdMul`  | 91, 97  | speed buff |
| `secs`    | 91/97/98| duration for heal-buff / buff / ward |
| `ward`    | 98      | invuln ms |
| `atkMul`  | 97      | attack buff |
| `n`       | 58      | projectile count |
| `spread`  | 60      | fan/radial angle |
| `kind`    | 52      | projectile kind → WorldScene `kindMap` |
| `speed`   | 63      | projectile speed |
| `stagger` | 71      | per-projectile fire delay |
| `dist`    | 123     | strike dash distance |
| `element` | hitOpts | *(derived from `ELEMENT_OF`, not authored)* → `combat.damageEnemy` tint |

### Removed as dead data (this audit)

`vfx` and `shake` were the only two `fx` fields a job could set that could never
take effect. Both were read **only** inside `skillFx.js:39`:

```js
if (!hasVfx(ab.id)) { scene.spawnFx(..., fx.vfx || 'fx.explosion', 1.6);
                      if (fx.shake) scene.cameras.main.shake(120, fx.shake); }
```

`hasVfx(id)` is `!!SK[id]`. Every ability that set `vfx` (flare, sunburst,
arrowrain, meteor, fangdance) or `shake` (bash, meteor) has a **bespoke SK
entry**, so `hasVfx` was always true and the branch never ran — the fields were
silently ignored. Wiring them instead would double the visuals (the SK bodies
already draw `fx.circleOrange` / `fx.explosion` / arcs and call `shakeScreen`),
so the fields were deleted from `jobs.js`. The generic `!hasVfx` fallback (and
its `fx.explosion` default) is unchanged for any future AoE skill without bespoke
art.

## Registries verified end-to-end

- **fx.kind → kindMap → loader texture.** kinds used: `shuriken, arrow, nature,
  fire, kunai, void, holy, lightning`. All are keys of the `kindMap` in
  `WorldScene.js` and every mapped `proj.*` texture exists in `assets/loader.js`
  (verified both directions: all 10 kindMap values load).
- **fx.status.id → STATUS.** used: `burn, stun, slow, poison, bleed`; all exist in
  `src/data/combatMath.js` `STATUS`.
- **fx.vfx → loader.** none remain (all were shadowed dead data, above).
- **SK registry ↔ abilities (both directions).** 30 SK entries, 30 unique ability
  ids — no orphan animation, no ability without a reachable cast path. All
  `setEl(...)` element tokens resolve in `ELEMENT` (`phys, fire, ice, thunder,
  nature, water, shadow, holy, smoke, steel`).

## ELEMENT_OF (impact element per skill)

`ELEMENT_OF` is read **only** by `hitOpts()` for `aoe` / `strike` skills, so its
keys are exactly the AoE+strike abilities. `snare` and `smoke` were missing
(no element tint on their hits); `pierce` and `chain` were dead (shot skills
derive their element from the projectile kind in `combat.js`). Result:

| ability   | raw        | sent to combat.js |
|-----------|------------|-------------------|
| flare     | holy       | holy |
| snare     | nature     | nature |
| burst     | nature     | nature |
| smoke     | shadow     | shadow |
| bash      | phys       | phys (white) |
| sunburst  | holy       | holy |
| arrowrain | phys       | phys (white) |
| thornwall | nature     | nature |
| meteor    | fire       | fire |
| tidal     | water      | ice ← synonym |
| shadowstep| shadow     | shadow |
| fangdance | phys       | phys (white) |
| caltrops  | steel      | steel (white) |

`combat.js:166` only tints elements in its own vocabulary (`fire, ice/frost,
thunder/lightning, shadow/void, holy, nature/poison`); `skillFx.js` maps
`water → ice` and lets `phys` / `steel` fall through to the default white
damage number (the correct colour for physical/steel). The four base-job
representatives (`flare, snare, burst, smoke`) all carry a recognised element.

## Parent work (outside this audit's ownership)

- `WorldScene.js:506-518` — the `if (ab.id === 'camp')` branch is **unreachable**:
  `camp` has `fx: { type:'heal', ... }`, so `castFx` handles it and returns `true`
  at line 505. The branch (and its `fx.aura` spawn) is dead code.
- `WorldScene.js:519-528` (`ward`) and `530+` (`dash`/`blink`) are correctly the
  only paths for fx-less abilities and call `setCd()` themselves.

## Reproducing

```
node audit-skillfx.mjs      # 189 assertions, exit 0
```

The script statically parses `skillFx.js / skillVfx.js / WorldScene.js /
loader.js / combatMath.js / combat.js`, dynamically imports `jobs.js`, and
asserts every relation above both directions.
