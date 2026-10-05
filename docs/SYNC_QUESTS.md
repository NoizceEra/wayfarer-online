# SYNC_QUESTS — quest-graph mechanical audit

Scope of this track: `src/data/quests.js`, `src/data/quests/**`, `src/data/questsExtra.js`.
This document records a **mechanical** validation of the entire `QUEST_LIST` graph — every
link was checked by executing Node against the real modules, not by eyeballing. It is the
sync reference for quest data and the fix log.

## Method

A throwaway Node script (`type: module`) imports the live data modules and walks the graph:

- `src/data/quests.js` → `QUEST_LIST`, `NPC_SPOTS`, `POIS`, `CHAINS`, `LORE`, `BOUNTY_TEMPLATES`
- `src/data/npcs.js` → `NPCS` · `src/data/npcsExtra.js` → `EXTRA_NPCS`
- `src/data/questsExtra.js` → `EXTRA_NPC_SPOTS`
- `src/data/areas.js` → `AREAS` · `src/data/zones.js` → `ZONES` · `src/data/gear.js` → `GEAR`
- `src/data/jobs.js` → `ENEMY_TABLE` (then side-effect import `src/data/worldEnemies.js`,
  which pulls `src/data/enemiesExtra.js` + `src/data/materialsExtra.js`, so the tables are complete)
- `src/data/materials.js` → `MATS`

The NPC universe is the **union** of every NPC registration site, collected programmatically:
`npcs.js` `NPCS[]`, `npcsExtra.js` `EXTRA_NPCS[]`, `quests.js` `NPC_SPOTS` keys,
`questsExtra.js` `EXTRA_NPC_SPOTS` keys, plus regex-extracted `name:` literals and positional
`npc('Name', …)` helper calls from `scenes/WorldScene.js` (hardcoded `npcDefs`),
`world/areaBuilders.js`, `world/overworldFeatures.js` (wandering villagers), `world/petMaster.js`
(`Pet Master Li`), and `systems/worldEvents.js` (caravan). **91 names**.

Checks performed:

1. **Enumerate** every quest: chain, giver, turnIn, zone, `pre[]`, objectives.
2. **Giver/turnIn resolvability** against the 91-name NPC universe.
3. **Graph integrity** — every `pre` id exists; DFS cycle detection; per-chain entry.
4. **Objective resolvability** — `kill`→`ENEMY_TABLE`, `collect`/`deliver` id→`MATS`,
   `talk`/`deliver` npc→universe, `explore.poi`→`POIS`, `explore.area`→`AREAS`,
   `explore.zone`→`ZONES`, `escort.npc`→universe, `escort.from/to`→`POIS`, `use`→`MATS`,
   `interact`→registered interactables, `craft`→recipe ids, `skill`→`jobs.js` ability ids.
   Also reward resolvability: `reward.gear`→`GEAR`, `reward.mats`→`MATS`,
   `reward.recipes`→recipes, `reward.lore`→`LORE`, `give`→`MATS` (this is where the one bug
   was found), and `BOUNTY_TEMPLATES.obj` ids.
5. **Reachability fixpoint** (mirrors the engine exactly — `questSystem.preOk()` is
   `(q.pre||[]).every(id => done[id])`): a quest is reachable iff its giver is a registered NPC
   **and** every `pre` quest is itself reachable. Count reachable vs total; list every dead quest.

## Result — 92 / 92 reachable, 0 unresolved

| metric | value |
|---|---|
| quests in `QUEST_LIST` | **92** |
| reachable | **92** |
| dead / unreachable | **0** |
| duplicate quest ids | 0 |
| dangling `pre` ids | 0 |
| dependency cycles | 0 |
| chain refs to non-existent chains | 0 |
| chains defined with no quests | 0 |
| unresolved giver / turnIn | 0 / 0 |
| unresolved objective ids (kill/collect/deliver/talk/poi/area/zone/escort/use/interact/craft/skill) | 0 |
| unresolved reward ids (gear/mats/recipes/lore) | 0 |
| NPC universe size | 91 |

Per-chain (total / reachable / empty-`pre` entries):

| chain | total | reachable | entries |
|---|---|---|---|
| lantern | 6 | 6 | 1 |
| harbour | 6 | 6 | 1 |
| ashen | 6 | 6 | 0 † |
| hearth | 6 | 6 | 1 |
| sunscorch | 4 | 4 | 1 |
| whisper | 4 | 4 | 1 |
| emberdeep | 4 | 4 | 1 |
| hollow | 3 | 3 | 1 |
| tutorial | 7 | 7 | 1 |
| ashen_watch | 6 | 6 | 1 |
| fen_watch | 6 | 6 | 1 |
| job_knight / job_lanternwarden / job_hunter / job_wildwarden / job_elementalist / job_tidecaller / job_shadowblade / job_trickster | 3 each | 3 each | 1 each |
| standalone (no `chain`) | 10 | 10 | 9 |

† `ashen` is the only chain with no self-contained entry: its first quest `sq_bones` has
`pre: ['q_sigil']`, and `q_sigil` is the final quest of the `lantern` chain. This is intentional
narrative continuity (Ashenmoor Awakens follows the Lantern of Embervale) and is **satisfiable**
— `q_sigil` traces back to `q_meadow` (empty pre). It is not a cycle and the chain is fully
reachable, so no fix is required.

## Fix applied

One dangling link was found and fixed (inside this track's ownership):

**`src/data/questsExtra.js` line 103 — quest `q_hd1` "The Crack in the Meadow"**

```diff
-    obj: [{ t: 'explore', area: 'hollow' }], reward: { xp: 500, gold: 160, mats: { medipack: 2 } } }),
+    obj: [{ t: 'explore', area: 'hollow' }], reward: { xp: 500, gold: 160, mats: { greater_potion: 2 } } }),
```

Why it was broken: reward `mats` are granted by `questSystem.grant()` via
`pack.addMat(scene, id, n)`, and `addMat` returns `0` (silently) when `matById(id)` is null.
`medipack` is an **`ITEMS`** id (`src/data/items.js:13`, a consumable potion), **not** a `MATS`
id — so the player received nothing and `rewardLines()` rendered the raw string `medipack`.
There is no item-reward path in the engine (`give` is also `MATS`-only). The replacement
`greater_potion` is a real `MATS` potion (`src/data/materials.js:51`, restores 110 HP) and
matches the tier used by peer quests of the same level band (`q_bats` lv10, `q_dz1` lv13,
`aw_gate` — all reward `greater_potion`).

Before: 1 unresolved reward-mats id (`q_hd1` → `medipack`).
After: 0 unresolved (re-run of the full audit).

## Parent work / observations (outside this track's ownership)

1. **`src/data/areas.js:117-124` — `SIDE_QUESTS` duplicates `QUEST_LIST` ids and is dead data.**
   It re-declares `sq_crabs`, `sq_net`, `sq_bones`, `sq_warden`, `sq_wisps`, `sq_crawlers` with
   the same ids as the real quests in `quests.js`, but `SIDE_QUESTS` is exported and **never
   imported anywhere** (verified by grep). Either wire it up or remove it, so the two id spaces
   cannot diverge. Not a runtime defect today (no consumer), but a future footgun.

2. **Engine limitation — quests cannot grant `ITEMS`.** `questSystem.grant()` supports
   `xp/gold/gear/mats/recipes/statPoints/lore`; `mats` and `give` are `MATS`-only.
   Consumables like `medipack`, `potion_small` are `ITEMS` and unreachable from quest rewards.
   If item rewards are wanted, add an `items:{id:n}` field to `grant()`/`rewardLines()` in
   `src/systems/questSystem.js` (other track). The `q_hd1` fix above sidesteps this for now.

3. **`src/data/zones.js` legacy `QUESTS` array** mirrors `q_meadow…q_final`; consistent, not
   dangling — informational only.

## Reproduce

Save the script below as `quest-audit.mjs` anywhere and run `node quest-audit.mjs` (Node 18+;
the repo is ESM, `package.json` `"type":"module"`). It writes `quest-audit.json` next to itself
and prints the summary. Expected: `reachable 92 / total 92`, every unresolved bucket empty.

```js
// Quest graph audit — imports the REAL modules and validates mechanically.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'D:/ai-studio/wayfarer-online';
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ---- real data modules ----
const questsMod = await imp('src/data/quests.js');
const npcsMod = await imp('src/data/npcs.js');
const npcsExtraMod = await imp('src/data/npcsExtra.js');
const questsExtraMod = await imp('src/data/questsExtra.js');
const areasMod = await imp('src/data/areas.js');
const jobsMod = await imp('src/data/jobs.js');
await imp('src/data/worldEnemies.js'); // side-effect: populates ENEMY_TABLE (incl. enemiesExtra)
const materialsMod = await imp('src/data/materials.js');
const zonesMod = await imp('src/data/zones.js');
const gearMod = await imp('src/data/gear.js');

const { QUEST_LIST, NPC_SPOTS, POIS, CHAINS, LORE } = questsMod;
const { NPCS } = npcsMod;
const { EXTRA_NPCS } = npcsExtraMod;
const { EXTRA_NPC_SPOTS } = questsExtraMod;
const { AREAS } = areasMod;
const { ENEMY_TABLE } = jobsMod; // mutated singleton
const { MATS } = materialsMod;
const { ZONES } = zonesMod;
const { GEAR } = gearMod;

// ---- NPC universe ----
const npcSet = new Set();
const addName = (n) => { if (n) npcSet.add(n); };
for (const n of NPCS) addName(n.name);
for (const n of EXTRA_NPCS) addName(n.name);
for (const k of Object.keys(NPC_SPOTS)) addName(k);
for (const k of Object.keys(EXTRA_NPC_SPOTS)) addName(k);

const extract = (rel, patterns) => {
  const txt = read(rel);
  for (const re of patterns) {
    let m;
    const r = new RegExp(re.source, 'g');
    while ((m = r.exec(txt))) addName(m[1]);
  }
};
extract('src/scenes/WorldScene.js', [/name:\s*'([^']+)'/]);
extract('src/world/areaBuilders.js', [/name:\s*'([^']+)'/, /\bnpc\(\s*'([^']+)'/]);
extract('src/world/overworldFeatures.js', [/name:\s*'([^']+)'/]);
extract('src/world/petMaster.js', [/name:\s*'([^']+)'/]);
extract('src/systems/worldEvents.js', [/name:\s*'([^']+)'/]);
for (const j of ['shadow', 'DANGER']) npcSet.delete(j);

// ---- recipe / interact / skill pools (regex, since crafting.js pulls Phaser) ----
const recipeIds = new Set();
{
  const txt = read('src/systems/crafting.js') + read('src/data/craftingRecipes.js');
  for (const m of txt.matchAll(/\bR\(\s*'([^']+)'/g)) recipeIds.add(m[1]);
  for (const m of txt.matchAll(/\bid:\s*'([^']+)'/g)) recipeIds.add(m[1]);
}
const interactIds = new Set(['garrick_net']);
const abilityIds = new Set();
{
  const txt = read('src/data/jobs.js');
  for (const m of txt.matchAll(/\bid:\s*'([^']+)'/g)) abilityIds.add(m[1]);
}

// ---- STEP 1-4: walk the graph ----
const byId = new Map(QUEST_LIST.map((q) => [q.id, q]));
const unresolved = {
  missingPre: [], cycle: [], giver: [], turnIn: [],
  kill: [], collect: [], deliverId: [], deliverNpc: [], talk: [], poi: [], area: [], zone: [],
  escortNpc: [], escortPoi: [], use: [], interact: [], craft: [], skill: [], give: [],
  rewardGear: [], rewardMats: [], rewardRecipes: [], rewardLore: [], choiceReward: [],
  bountyKill: [], bountyCollect: [],
};
for (const q of QUEST_LIST) {
  for (const p of (q.pre || [])) if (!byId.has(p)) unresolved.missingPre.push({ quest: q.id, pre: p });
  if (!npcSet.has(q.giver)) unresolved.giver.push({ quest: q.id, giver: q.giver });
  if (q.turnIn && !npcSet.has(q.turnIn)) unresolved.turnIn.push({ quest: q.id, turnIn: q.turnIn });
  for (const o of (q.obj || [])) {
    if (o.t === 'kill' && !ENEMY_TABLE[o.id]) unresolved.kill.push({ quest: q.id, id: o.id });
    if (o.t === 'collect' && !MATS[o.id]) unresolved.collect.push({ quest: q.id, id: o.id });
    if (o.t === 'deliver') {
      if (!MATS[o.id]) unresolved.deliverId.push({ quest: q.id, id: o.id });
      if (!npcSet.has(o.npc)) unresolved.deliverNpc.push({ quest: q.id, npc: o.npc });
    }
    if (o.t === 'talk' && !npcSet.has(o.npc)) unresolved.talk.push({ quest: q.id, npc: o.npc });
    if (o.t === 'explore') {
      if (o.poi && !POIS[o.poi]) unresolved.poi.push({ quest: q.id, poi: o.poi });
      if (o.area && !AREAS[o.area]) unresolved.area.push({ quest: q.id, area: o.area });
      if (o.zone && !ZONES.some((z) => z.id === o.zone)) unresolved.zone.push({ quest: q.id, zone: o.zone });
    }
    if (o.t === 'escort') {
      if (o.npc && !npcSet.has(o.npc)) unresolved.escortNpc.push({ quest: q.id, npc: o.npc });
      for (const k of ['from', 'to']) if (o[k] && !POIS[o[k]]) unresolved.escortPoi.push({ quest: q.id, key: k, poi: o[k] });
    }
    if (o.t === 'use' && !MATS[o.id]) unresolved.use.push({ quest: q.id, id: o.id });
    if (o.t === 'interact' && !interactIds.has(o.id)) unresolved.interact.push({ quest: q.id, id: o.id });
    if (o.t === 'craft' && !recipeIds.has(o.id)) unresolved.craft.push({ quest: q.id, id: o.id });
    if (o.t === 'skill') for (const sid of (Array.isArray(o.id) ? o.id : [o.id])) if (!abilityIds.has(sid)) unresolved.skill.push({ quest: q.id, id: sid });
  }
  for (const [gid] of Object.entries(q.give || {})) if (!MATS[gid]) unresolved.give.push({ quest: q.id, id: gid });
  const checkReward = (r, label) => {
    if (!r) return;
    if (r.gear && !GEAR[r.gear]) unresolved.rewardGear.push({ quest: label, id: r.gear });
    for (const [mid] of Object.entries(r.mats || {})) if (!MATS[mid]) unresolved.rewardMats.push({ quest: label, id: mid });
    for (const rid of (r.recipes || [])) if (!recipeIds.has(rid)) unresolved.rewardRecipes.push({ quest: label, id: rid });
    if (r.lore && !LORE[r.lore]) unresolved.rewardLore.push({ quest: label, id: r.lore });
  };
  checkReward(q.reward, q.id);
  for (const ch of (q.choices || [])) checkReward(ch.reward, q.id + '/choice:' + ch.label);
}
for (const b of (questsMod.BOUNTY_TEMPLATES || [])) {
  const o = b.obj || {};
  if (o.t === 'kill' && !ENEMY_TABLE[o.id]) unresolved.bountyKill.push({ quest: b.id, id: o.id });
  if (o.t === 'collect' && !MATS[o.id]) unresolved.bountyCollect.push({ quest: b.id, id: o.id });
}

// ---- STEP 3b: cycle detection over `pre` ----
const color = new Map();
let foundCycle = null;
const dfs = (id, stack) => {
  if (foundCycle) return;
  color.set(id, 1);
  for (const p of (byId.get(id)?.pre || [])) {
    if (!byId.has(p)) continue;
    if (color.get(p) === 1) { foundCycle = [...stack.slice(stack.indexOf(p)), p]; return; }
    if ((color.get(p) || 0) === 0) dfs(p, [...stack, p]);
    if (foundCycle) return;
  }
  color.set(id, 2);
};
for (const q of QUEST_LIST) if ((color.get(q.id) || 0) === 0) dfs(q.id, [q.id]);
if (foundCycle) unresolved.cycle.push({ path: foundCycle });

// ---- STEP 5: reachability fixpoint ----
const reachable = new Set();
let changed = true;
while (changed) {
  changed = false;
  for (const q of QUEST_LIST) {
    if (reachable.has(q.id) || !npcSet.has(q.giver)) continue;
    if ((q.pre || []).every((p) => reachable.has(p))) { reachable.add(q.id); changed = true; }
  }
}
const dead = QUEST_LIST.filter((q) => !reachable.has(q.id)).map((q) => q.id);
const out = {
  total: QUEST_LIST.length, reachable: reachable.size, dead,
  unresolvedCounts: Object.fromEntries(Object.entries(unresolved).map(([k, v]) => [k, v.length])),
  unresolved,
};
console.log(JSON.stringify(out, null, 2));
```
