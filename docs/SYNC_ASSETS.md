# SYNC_ASSETS — bidirectional sprite/monster/asset reference audit

Audit track: **assets & monster data** (base commit `61b786e`). Proves every
sprite/monster/asset reference resolves **both ways** (catalogue → disk,
monster → registered sheet, sheet → user, spawn → monster, deathFx → monster)
and fixes the mismatches found.

## Owned files

| file | role |
|---|---|
| `src/assets/catalog.js` | GENERATED sheet catalogue (`CHAR_SHEETS`, `MONSTER_FILES`, `CUSTOM_MONSTER_FILES`) |
| `src/assets/loader.js` | decides which sheets/textures load into Phaser |
| `src/data/worldEnemies.js` | expansion + biome-pack monster defs, spawn lists, behaviour |
| `src/data/enemiesExtra.js` | desert/marsh/caverns/hollow/custom monster defs |
| `src/data/deathFx.js` | per-monster death/hit-reaction family |
| `docs/SYNC_ASSETS.md` | this file |

Not touched (other tracks): `src/systems/skillVfx.js`, `src/scenes/*`,
`src/data/pets.js`, `src/data/items.js`, `src/data/jobs.js`.

## Reproduce

```
node tools/audit_assets.mjs
```

It imports the **real** ESM modules (`catalog.js`, `jobs.js`, `worldEnemies.js`,
`enemiesExtra.js`, `deathFx.js`, `items.js`, `pets.js`, `areas.js`) and the
**real** loader maps (`loader.js` now exports `MONSTER_SHEETS` /
`CUSTOM_MONSTER_SHEETS`), so it audits actual runtime state, not a copy.
Every counter below is expected to be `0` except the documented exceptions.

## Resolution tables (post-fix)

### 1. Catalogue → disk (every key's file exists)

| source | keys | missing on disk |
|---|---|---|
| `MONSTER_FILES` (`public/assets/na/Actor/Monster/…`) | 66 | **0** |
| `CUSTOM_MONSTER_FILES` (`public/assets/custom/monsters/…`) | 19 | **0** |
| `ITEMS[*].src` (`public/assets/na/…`) | 96 | **0** |

The 5 item-art gaps fixed by the parent earlier are confirmed closed (0 missing).

### 2. Monster → registered sheet (forward, every def renders its real art)

103 monsters in `ENEMY_TABLE` (base + worldEnemies + enemiesExtra). Each
`def.sprite` is checked against the loader's actual registered texture set
(`mon.<sprite>`). **0 dangling.** (`Enemy.js` silently falls back to
`mon.Slime` on a miss, so this would otherwise be invisible.)

### 3. Sheet → monster (reverse, no orphaned registered sheets)

| family | registered | orphan (no user) |
|---|---|---|
| base `mon.*` (`MONSTER_SHEETS`) | 61 | **0** |
| custom `mon.*` (`CUSTOM_MONSTER_SHEETS`) | 19 | **0** |

Justified non-monster users of base sheets (excluded from "orphan"):
- **ambient critters** — `Butterfly`, `ButterflyBlue`, `Fish`, `FishRed`
  (+ `Owl`/`Owl2`/`BlueBat`/`YellowsBat`) drive `src/world/ambient.js`.
- **pet lines** — `Mouse`, `Racoon`, `Beast2`, `Axolot`, `Mollusc`, `Mollusc2`,
  `Bamboo`, `BambooYellow`, `Panda` drive `src/data/pets.js`.

### 4. Spawn lists → monster ids

`AREAS.<zone>.enemies` (10 zones; 6 populating; 39 entries) plus
`EXTRA_OVERWORLD_SPAWNS` (26 entries) = **65 spawn entries**, all resolving to
real `ENEMY_TABLE` ids. **0 dangling.**
Zones: `caverns, cottage_a, cottage_b, crypt, desert, dock, frost, hollow, inn, marsh`.

### 5. deathFx → monster

`BY_ID` maps 17 ids → families; all 17 ids exist in `ENEMY_TABLE`. Every
`def.deathFx` in the table is one of the 12 families `skillVfx.js` supports
(`slime bones ghost bug beast plant fire ice water ink blood boss`). **0 dangling, 0 unsupported.**

### 6. Loader paths → disk (no 404)

Every `mon.*` path the loader registers from the monster catalogue (61 base + 19
custom) and every `item.src.*` path (96) exists. **0 would-404.**

## Orphan decision: `slime_slime_cyan` → author the monster (not delete the entry)

Finding: `public/assets/custom/monsters/slime_slime_cyan.png` was registered in
`CUSTOM_MONSTER_FILES` but **no** monster used it — the only true orphan, and the
one custom sheet of the 19 left unwired.

Choice: **author the missing monster** (`cyanslime`), not remove the catalogue key.

Justification:
1. `catalog.js` is **generated** (`python3 tools/validate_sheets.py --emit-catalog`)
   by globbing `public/assets/custom/monsters/*.png` and validating frame layout.
   Deleting the key would be undone by the next regeneration while the PNG
   remains — the orphan would silently return.
2. The PNG is a valid, curated 64×64 / 4×4 / 1-bit-alpha sheet, committed in
   `084b2b2` alongside the other 12 biome-pack sheets of which 12 were wired and
   this one was not (pack B in `61b786e` wired all 6 of its sheets). It is
   clearly intended art, not a stray.
3. Authoring uses the art, closes the loop in **both** directions durably, and
   matches the existing convention (every custom sheet is a real monster).

Placement: meadow — the cyan slime sits with the existing meadow slimes/gels
(`dewslime`, `gelgreen`, `gelblue`) at zone tier Lv1-4. Explicit `deathFx:'slime'`
is required because the lowercase sheet name does not match the
`deathFx.js` `BY_SPRITE` regexes (which would otherwise default it to `beast`).

## Fixes (proof)

1. `src/data/worldEnemies.js`
   - added `E('cyanslime', 'Cyan Slime', 'slime_slime_cyan', ['meadow'], 38, 7, 11, [2, 5], { deathFx:'slime', items:[water_drop,grass] })`
   - `BEHAVIOUR.cyanslime = { lv:2, ai:'hopper', aggro:75, social:true, spd:0.85 }`
   - spawn: `['cyanslime', 8, 'meadow']` added to `EXTRA_OVERWORLD_SPAWNS`
   - → orphanCustom `slime_slime_cyan` → **0**
2. `src/assets/loader.js`
   - registered pet sheets so `src/data/pets.js` `mon.<Name>` keys resolve
     (was: `mon.BambooYellow`, used by nature-line pet `mossback`, never loaded —
     the pet wisp silently never spawned). Added `import { PETS }` + a
     data-driven registration loop; exported `MONSTER_SHEETS` /
     `CUSTOM_MONSTER_SHEETS` for auditability.
   - → `petSpritesDangling` (`mon.BambooYellow`) → **0**

Re-run `node tools/audit_assets.mjs`: **0** dangling sprites, **0** orphan
sheets, **0** dangling spawn ids, **0** loader 404s, **0** bad deathFx.

## Syntax checks (`node --check`, exit code)

| file | exit |
|---|---|
| `src/assets/catalog.js` | 0 |
| `src/assets/loader.js` | 0 |
| `src/data/worldEnemies.js` | 0 |
| `src/data/enemiesExtra.js` | 0 |
| `src/data/deathFx.js` | 0 |

## Byte sizes (before → after)

| file | before | after |
|---|---|---|
| `src/assets/catalog.js` | 8725 | 8725 (unchanged, generated) |
| `src/assets/loader.js` | 18780 | 19381 |
| `src/data/worldEnemies.js` | 18761 | 19317 |
| `src/data/enemiesExtra.js` | 12656 | 12656 (unchanged) |
| `src/data/deathFx.js` | 1393 | 1393 (unchanged) |

## Documented exception (residual, acceptable)

5 base `MONSTER_FILES` keys have no user and are never loaded:
`Bear`, `HeartGreen`, `KappaRed`, `MouseBlack`, `Octopus2`. These are valid
catalogue entries the loader only instantiates when used, so they cost nothing
and cause no dangling reference. `catalog.js` is regenerated from the validated
`Actor/Monster` folder, so trimming them is not durable and is intentionally left
as latent catalogue capacity. (Other unused catalog keys remain loaded only
because a monster/ambient/pet uses them.)

## Parent work (outside this track's ownership)

- `src/ui/PetBattlePanel.js:116` — `const key = \`mon.${def.sprite}\`` where
  `PETS[*].sprite` already includes the `mon.` prefix, producing `mon.mon.Mouse`.
  It falls back to a coloured rectangle for every pet battle sprite. Needs the
  prefix stripped there (same bug class as the loader fix, different file).
- `src/data/deathFx.js` `BY_SPRITE` only matches TitleCase NA sheet names;
  lowercase biome-pack sprites (e.g. `meadow_dewbeetle`, `frost_frostfox`,
  `marsh_bogleech`) fall through to the `beast` default. Reachability passes
  (0 dangling), but families for some pack monsters may be intended as
  `ice`/`water`/`plant`. Content call — not fixed here to avoid guessing.
