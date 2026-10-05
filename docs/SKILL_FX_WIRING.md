# Skill FX Wiring — base-job abilities

Wire the base-job abilities in `src/data/jobs.js` to the existing VFX pipelines so the
animations already authored in `src/systems/skillVfx.js` (SK registry) actually play.

## The mechanism (why an `fx` block is required)

`WorldScene.cast()` (src/scenes/WorldScene.js:503-505) runs:

```js
const setCd = () => { ...; castVfx(this, ab, lv); };   // castVfx -> skillVfx.castVfx -> SK[ab.id]
if (castFx(this, ab, lv, setCd)) return;               // skillFx.castFx
```

`skillFx.castFx()` returns `false` immediately for an ability with no `fx`
(`if (!fx) return false;`) **before** `setCd()` runs, so `castVfx()` — and therefore the
bespoke `SK[ab.id]` animation — is never reached. An ability with `fx` calls `setCd()`,
which fires `castVfx()`, which looks up `SK[ab.id]` and plays the authored animation
(`skillVfx.js:782`). Adding an `fx` block is what makes the already-built animation play;
the `fx` block's `type` also decides the damage/cost shape in `skillFx.castFx`.

All fields used below are read by `skillFx.js` (`castFx`):
`type` ∈ {`aoe`,`shot`,`heal`,`buff`,`strike`}; `aoe`: `radius,mul,vfx,knock,slow,shake,status`;
`shot`: `kind,n,spread,mul,speed,stagger,status`; `heal`: `pct,mp,spdMul,secs`; `buff`: `secs,atkMul,spdMul,ward,mp`.

## Coverage

`FX COVERAGE: 12/16` base-job abilities now carry an `fx` block (4 already did: `flare`,
`volley`, `bolt`, `fan`; 8 added here). The 4 remaining are the pure **movement** abilities
(`wayfarer.dash`, `ranger.dash`, `bandit.dash`, `arcanist.blink`) — deliberately fx-less, see below.

## Blocks added (8)

| ability | fx block |
|---|---|
| `wayfarer.slash` | `{ type:'shot', n:1, spread:0, mul:1.25, kind:'shuriken', mp:8 }` |
| `wayfarer.camp`  | `{ type:'heal', pct:0.32, mp:0 }` |
| `ranger.shot`    | `{ type:'shot', n:1, spread:0, mul:1.35, kind:'arrow', mp:8 }` |
| `ranger.snare`   | `{ type:'aoe', radius:70, mul:0.6, slow:4, mp:12 }` |
| `arcanist.burst` | `{ type:'aoe', radius:60, mul:1.4, mp:25 }` |
| `arcanist.ward`  | `{ type:'buff', secs:3, ward:3, mp:20 }` |
| `bandit.stab`    | `{ type:'shot', n:1, spread:0, mul:1.3, kind:'kunai', mp:8 }` |
| `bandit.smoke`   | `{ type:'aoe', radius:70, mul:1.0, mp:12, status:{ id:'stun', chance:1, secs:1.5 } }` |

Each was chosen to reproduce the legacy behaviour that previously ran in the
`WorldScene.cast()` fall-through, while no longer skipping the SK animation:

- `slash` / `shot` / `stab`: single-target, `mp:8` (legacy cost 8, legacy damage
  `(effAtk+4)·dm` ≈ `mul 1.25-1.35`). Kinds match the real projectile textures
  (`proj.shuriken`, `proj.arrow`, `proj.kunai`) and the legacy projectiles.
- `camp`: `heal`, free (`mp:0`, legacy was free), `pct 0.32` ≈ legacy 40 HP over 10 s on a
  120 max-HP Wayfarer. `SK.camp` still renders the 10 s campfire + heal crosses.
- `snare`: `aoe` root — `slow:4` matches legacy 4 s root; `mul:0.6` = `caltrops` precedent.
- `burst`: `aoe`, legacy radius 56 / cost 25 → radius 60 / `mp:25`, `mul:1.4` ≈ legacy `(effAtk+6)·dm`.
- `ward`: `buff` with `ward:3` → `p.invulnUntil = now + 3·1000·dm`, exactly the legacy
  `3000·dm` shield; `mp:20` matches legacy. `atkMul`/`spdMul` omitted (neutral, `buffMul` → 1).
- `smoke`: legacy = 70-radius 1.5 s stun + `effAtk` damage → `mul:1.0` + `status:{stun,chance:1,secs:1.5}`.

`vfx` is intentionally omitted on the `aoe` blocks: it is only a fallback used when
`!hasVfx(id)`, and all of these ids have a bespoke `SK` entry, so it would be dead data
(same as the existing `thornwall`/`tidal`/`caltrops` blocks).

### Balance

Every new damaging block stays far below the level-10 ultimates: basic `mul` 1.25-1.35 vs
`meteor` 2.2 / `pierce` 2.8 / `fangdance` 2.0. Costs match the abilities' legacy values.

## Deliberately fx-less (parent work): the 4 movement abilities

`wayfarer.dash`, `ranger.dash`, `bandit.dash`, `arcanist.blink` were **not** wired.

`skillFx.js` has no `dash`/`blink` type. Its only movement type is `strike`, which:
- tweens the player's position (`scene.tweens.add({targets:p, x/y})`, line 121-125), i.e. it
  **bypasses the arcade physics collider** (`WorldScene.js:97 this.physics.add.collider(this.player, solids)`),
  so a dash/blink could punch through walls / out of an interior room (legacy `dash` uses
  `body.setVelocity` and legacy `blink` clamps to `areas.bounds()` + checks `areas.blockedAt`);
- always **deals damage** within `fx.radius`;
- forces `attackPose()` and shadow-coloured impact sparks.

That is a damaging dash-*strike* (as used by the advanced `shadowstep`), not a free
mobility dash/blink, so it does not faithfully cover the base abilities — converting 3 core
defensive dashes and a keep-away teleport into resource-free damaging attacks would be a
balance + collision regression. Per the task rule ("upgrade dash only if an existing type
covers it, otherwise document it as parent work") these stay fx-less until a proper type exists.

**Proposed parent patch** (in `src/systems/skillFx.js`, not this track): add a wall-aware
`dash` type — move the player with `body.setVelocity(cos(a)*SPEED)` for ~250 ms (or reuse
`areas.bounds()`/`areas.blockedAt()` clamping as `blink` does), set `p.invulnUntil = now+350`,
play `SK[ab.id]`, and take no `radius`/`mul`. Then a base `dash` fx would be e.g.
`{ type:'dash', dist:64, mp:0 }`. Until then the legacy `WorldScene.cast()` branches
(534-547) still drive these four correctly (they were never broken — only their SK animation
stays dark).

## Verification (real output)

```
$ grep -o 'fx\.[a-zA-Z]*' src/assets/loader.js | sort -u      # 44 real texture keys, used as ALLOWED_VFX
$ grep -n '^  [a-z]*:' src/systems/skillVfx.js | sed -n '1,40p'   # SK registry confirms bespoke anims for
      slash, flare, dash, camp, shot, volley, snare, bolt, burst, blink, ward, stab, fan, smoke, bash, ...
$ node --check src/data/jobs.js         # exit 0
$ node --check .fxcheck.mjs             # exit 0
$ wc -c src/data/jobs.js                # 10954  (before: 10440, +514)
$ node .fxcheck.mjs
FX COVERAGE: 12/16
WITH FX   : wayfarer.slash, wayfarer.flare, wayfarer.camp, ranger.shot, ranger.volley, ranger.snare,
            arcanist.bolt, arcanist.burst, arcanist.ward, bandit.stab, bandit.fan, bandit.smoke
WITHOUT FX: wayfarer.dash, ranger.dash, arcanist.blink, bandit.dash
KINDS USED: shuriken,arrow,nature,fire,kunai,void
STATUS USED: burn,stun
ALL FIELD VALUES IN ALLOWED SETS: OK    # vfx ∈ loader fx.* keys, kind ∈ scene.fireShot kindMap,
                                        # status.id ∈ STATUS (data/combatMath.js)
```

`ALLOWED_KIND` = the keys `WorldScene.fireShot()` actually maps
(`ice,lightning,void,nature,holy,fire,energy,shuriken,arrow,kunai`). The brief's suggested
`water|shadow|thunder|phys` are not real kinds — they have no `proj.*` texture and no
`speedMap` entry, so they would silently fall back to `proj.energyBall`; real kinds were
used instead so the projectiles render as intended.
