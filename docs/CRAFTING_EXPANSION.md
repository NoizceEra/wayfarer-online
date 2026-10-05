# Crafting Expansion — Rune / Transmute / Legendary Tiers

DATA + DOCS ONLY. New recipes live in `src/data/craftingRecipes.js`
(`EXTRA_RECIPES`, 12 entries). No existing file was modified. The parent
track must register them (snippet below) — nothing works until it does.

## Recipe list (all shapes match `R()` in `src/systems/crafting.js`)

### Rune brews (alchemy table)

| Recipe | Inputs | Output | Fee | Time | Unlock |
|---|---|---|---|---|---|
| Ember Rune Brew | 2 bog_essence, 3 wisp_dust, 2 empty_vial | 2 might_elixir | 40g | 10s | gather bog_essence |
| Tide Rune Brew | 2 tide_shard, 4 moonmoss, 2 empty_vial | 2 guard_elixir | 40g | 10s | gather tide_shard |
| Gale Rune Brew | 1 frost_shard, 4 bat_wing, 2 empty_vial | 2 swift_tonic | 40g | 10s | gather frost_shard |
| Fate Rune Brew | 3 grave_dust, 3 wisp_dust, 2 empty_vial | 2 clover_tea | 60g | 12s | gather grave_dust |

### Transmutations (anvil / alchemy)

| Recipe | Inputs | Output | Fee | Time | Unlock |
|---|---|---|---|---|---|
| Transmute: Scrap Steel (anvil) | 4 rust_scrap, 4 old_button, 2 tattered_cloth, 1 oak_log | 1 iron_ingot | 10g | 6s | gather rust_scrap |
| Transmute: Bone Crystal | 3 bone_shard, 2 grave_dust, 1 frost_crystal, 1 empty_vial | 2 mana_draught | 25g | 8s | gather bone_shard |
| Transmute: Tideglass | 3 crab_shell, 1 tide_shard, 2 slime_gel, 1 empty_vial | 1 greater_potion | 25g | 8s | gather crab_shell |
| Transmute: Rimefire | 2 rime_chitin, 2 frostbell, 2 cap_spore, 1 empty_vial | 3 herbal_tonic | 20g | 8s | gather rime_chitin |
| Hone Whetstones, Bulk (anvil) | 3 iron_ore, 2 slime_gel | 2 whetstone | 8g | 5s | gather iron_ore |

### Legendary feasts (campfire / alchemy)

| Recipe | Inputs | Output | Fee | Time | Unlock |
|---|---|---|---|---|---|
| Leviathan's Broth (campfire) | 1 golden_koi, 2 frost_trout, 2 frostbell, 2 oak_log | 3 ice_broth | 100g | 12s | gather golden_koi |
| Warlord's Platter (campfire) | 2 harbor_eel, 2 silver_mackerel, 3 thorn_spike, 2 oak_log | 2 fish_stew + 2 mushroom_skewer | 80g | 12s | gather harbor_eel |
| Titan's Tonic | 4 bogbloom, 2 frostbell, 2 grave_dust, 2 empty_vial | 2 greater_potion + 1 mana_draught | 80g | 12s | gather bogbloom |

## Costs and sinks

- **Gold sunk per craft:** 8–100g in fees (legendary tier 80–100g).
  Fees are destroyed (`p.gold -= fee` in `CraftSystem.start`).
- **Material sinks:** every recipe consumes 4–9 items of gathered/dropped
  stock (rare drops, trophy fish, junk) plus fuel (oak_log / empty_vial).
- **No gold minting:** `out` can only grant existing material IDs, which the
  engine adds via `addMat`. There is no code path from crafting to gold.
  Outputs vendor for less than inputs cost (e.g. Leviathan's Broth: ~102g of
  outputs for a Golden Koi alone worth 60g + 100g fee + rares), so crafts are
  net-negative in vendor terms — a sink, not a farm.
- **No AFK farm loops:** all crafts are timed station jobs (`time` 5–12s),
  one job at a time, cancelled with no output if the player moves >110px,
  changes area, or faints. Inputs are taken up front; cancel refunds inputs
  + fee, so there is no duplication vector.

## Anti-dupe notes (for the parent / server track)

1. `start()` takes inputs + fee before creating the job; `finish()` grants
   outputs once. Cancel refunds exactly `job.plan` + `job.fee` — symmetric,
   no double-grant.
2. Crafting is client-authoritative over `player.mats` + `player.gold`.
   The server economy (`server/economy.js`) validates gear/gold/inventory
   by rev, but mats are not in the rev-checked inventory. If crafting fraud
   matters, the parent must add server-side craft validation (recipe ID +
   input check + output grant as an economy mutation).
3. Outputs respect `PACK_CAP` (99/stack) via `addMat`; over-cap output is
   currently lost (existing engine behaviour, not introduced here).
4. `discoverOn` IDs are all real mat IDs, so `onMatDiscovered` fires without
   changes. Recipes with no `start: true` flag are hidden until discovered —
   the parent can alternatively grant them via quests/scrolls (would need
   new scroll items in `materials.js`, out of scope here).

## Registration snippet (parent must add — do NOT duplicate this file)

In `src/systems/crafting.js`, after the `RECIPES` declaration (before
`RECIPE_BY_ID` is built):

```js
import { EXTRA_RECIPES } from '../data/craftingRecipes.js';
RECIPES.push(...EXTRA_RECIPES.filter((r) => !RECIPES.some((e) => e.id === r.id)));
```

The `filter` guard makes re-registration idempotent. `RECIPE_BY_ID`,
`START_RECIPES`, `check/start/finish`, and the CraftPanel UI pick the new
entries up with no further changes. No new stations, buff stats, or engine
APIs are required.
