// Asset/monster bidirectional sync audit — imports the real ESM data modules.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const ex = (p) => fs.existsSync(p);
const R = {};

const { CHAR_SHEETS, MONSTER_FILES, CUSTOM_MONSTER_FILES } = await imp('src/assets/catalog.js');
const { ENEMY_TABLE } = await imp('src/data/jobs.js');
const { EXTRA_OVERWORLD_SPAWNS } = await imp('src/data/worldEnemies.js');
await imp('src/data/enemiesExtra.js');
await imp('src/data/deathFx.js');
const { ITEM_LIST } = await imp('src/data/items.js');
const { PETS } = await imp('src/data/pets.js');
const { AREAS } = await imp('src/data/areas.js');

// ---- STEP 1: catalogue file existence ----
R.missingMonsterFiles = [];
for (const [k, f] of Object.entries(MONSTER_FILES))
  if (!ex(path.join(PUB, 'assets/na/Actor/Monster', f))) R.missingMonsterFiles.push(`${k} -> ${f}`);
R.missingCustomFiles = [];
for (const [k, f] of Object.entries(CUSTOM_MONSTER_FILES))
  if (!ex(path.join(PUB, 'assets/custom/monsters', f))) R.missingCustomFiles.push(`${k} -> ${f}`);
R.missingItemArt = [];
for (const it of ITEM_LIST) {
  const p = path.join(PUB, 'assets/na', it.src);
  if (!ex(p)) R.missingItemArt.push(`${it.id} -> ${it.src}`);
}
R.itemCount = ITEM_LIST.length;

// ---- loader registration — import the REAL maps from loader.js (no phaser import) ----
const { MONSTER_SHEETS, CUSTOM_MONSTER_SHEETS } = await imp('src/assets/loader.js');
const baseRegistered = new Set(Object.keys(MONSTER_SHEETS));
const customRegistered = new Set(Object.keys(CUSTOM_MONSTER_SHEETS));
const registered = new Set([...baseRegistered, ...customRegistered]);
R.baseRegistered = [...baseRegistered].sort();
R.customRegistered = [...customRegistered].sort();
// ambient critter sheets the loader always loads (world/ambient.js) — not monsters, excluded from orphan report
const AMBIENT = ['Butterfly', 'ButterflyBlue', 'Fish', 'FishRed', 'Owl', 'Owl2', 'BlueBat', 'YellowsBat'];

// ---- STEP 6: every path the loader registers from the monster/item data resolves on disk ----
R.loader404 = [];
for (const [k, f] of Object.entries(MONSTER_SHEETS))
  if (!ex(path.join(PUB, 'assets/na/Actor/Monster', f))) R.loader404.push(`mon.${k} -> ${f}`);
for (const [k, p] of Object.entries(CUSTOM_MONSTER_SHEETS))
  if (!ex(path.join(PUB, p))) R.loader404.push(`mon.${k} -> ${p}`);
for (const it of ITEM_LIST)
  if (!ex(path.join(PUB, 'assets/na', it.src))) R.loader404.push(`item.src.${it.id} -> ${it.src}`);

// ---- STEP 2: every monster sprite resolves ----
R.danglingSprites = [];            // would silently fall back to mon.Slime in Enemy.js
R.noSheetAtAll = [];
for (const [id, def] of Object.entries(ENEMY_TABLE)) {
  const s = def.sprite;
  if (!s) { R.noSheetAtAll.push(id + ' (no sprite field)'); continue; }
  const known = (s in MONSTER_FILES) || (s in CUSTOM_MONSTER_FILES) || (s in CHAR_SHEETS);
  if (!known) R.noSheetAtAll.push(`${id} -> sprite '${s}' not in catalog`);
  if (!registered.has(s)) R.danglingSprites.push(`${id} -> mon.${s} (${known ? 'catalog key but NOT registered by loader' : 'unknown key'})`);
}
R.enemyCount = Object.keys(ENEMY_TABLE).length;

// ---- STEP 3: REVERSE orphans (registered sheets no monster uses) ----
const usersOf = {};
for (const [id, def] of Object.entries(ENEMY_TABLE)) (usersOf[def.sprite] ||= []).push(id);
R.orphanCustom = [...customRegistered].filter((k) => !usersOf[k]).sort();
const petBase = new Set(Object.values(PETS).map((p) => String(p.sprite || '').replace(/^mon\./, '')));
R.petBase = [...petBase].filter((k) => MONSTER_FILES[k]).sort();
R.orphanBase = [...baseRegistered].filter((k) => !usersOf[k] && !AMBIENT.includes(k) && !petBase.has(k)).sort();
R.ambientBase = [...baseRegistered].filter((k) => !usersOf[k] && AMBIENT.includes(k)).sort();
// informational: full catalog keys never used by any monster
R.unusedCatalogKeys = Object.keys(MONSTER_FILES).filter((k) => !usersOf[k] && !AMBIENT.includes(k) && !petBase.has(k)).sort();

// ---- STEP 4: spawn lists ----
R.danglingSpawns = [];
const pushSpawn = (list, where) => {
  for (const e of list || []) {
    const id = Array.isArray(e) ? e[0] : e;
    if (!ENEMY_TABLE[id]) R.danglingSpawns.push(`${where}: '${id}'`);
  }
};
for (const [zone, a] of Object.entries(AREAS)) pushSpawn(a.enemies, `AREAS.${zone}.enemies`);
pushSpawn(EXTRA_OVERWORLD_SPAWNS, 'EXTRA_OVERWORLD_SPAWNS');
R.spawnCount = Object.values(AREAS).reduce((n, a) => n + ((a.enemies || []).length), 0) + (EXTRA_OVERWORLD_SPAWNS || []).length;
R.zones = Object.keys(AREAS).sort();

// ---- STEP 5: deathFx ----
const SUPPORTED = ['slime', 'bones', 'ghost', 'bug', 'beast', 'plant', 'fire', 'ice', 'water', 'ink', 'blood', 'boss'];
R.badDeathFx = [];
for (const [id, def] of Object.entries(ENEMY_TABLE))
  if (!SUPPORTED.includes(def.deathFx)) R.badDeathFx.push(`${id} -> '${def.deathFx}'`);
// BY_ID keys parsed from source (module does not export it)
const dfxSrc = fs.readFileSync(path.join(ROOT, 'src/data/deathFx.js'), 'utf8');
const byIdBlock = dfxSrc.slice(dfxSrc.indexOf('const BY_ID'), dfxSrc.indexOf('};', dfxSrc.indexOf('const BY_ID')));
R.byIdKeys = [...byIdBlock.matchAll(/(\w+)\s*:/g)].map((m) => m[1]).filter((k) => k !== 'const' && k !== 'BY_ID');
R.byIdDangling = R.byIdKeys.filter((k) => !ENEMY_TABLE[k]);

// ---- STEP 6 (extra): cross-system pet sheet usage ----
const petSrc = fs.readFileSync(path.join(ROOT, 'src/data/pets.js'), 'utf8');
R.petSprites = [...petSrc.matchAll(/sprite:\s*'([^']+)'/g)].map((m) => m[1]);
R.petSpritesDangling = R.petSprites
  .map((s) => s.replace(/^mon\./, ''))
  .filter((s) => !registered.has(s));

// ---- output ----
const dump = (k) => { const v = R[k]; console.log(`\n## ${k} (${Array.isArray(v) ? v.length : v})`); if (Array.isArray(v)) v.forEach((x) => console.log('   - ' + x)); else console.log('   ' + JSON.stringify(v)); };
console.log(JSON.stringify({
  itemCount: R.itemCount, enemyCount: R.enemyCount, spawnCount: R.spawnCount,
  registeredBase: R.baseRegistered.length, registeredCustom: R.customRegistered.length,
  missingMonsterFiles: R.missingMonsterFiles.length, missingCustomFiles: R.missingCustomFiles.length,
  missingItemArt: R.missingItemArt.length, loader404: R.loader404.length, danglingSprites: R.danglingSprites.length,
  noSheetAtAll: R.noSheetAtAll.length, orphanCustom: R.orphanCustom.length,
  orphanBase: R.orphanBase.length, danglingSpawns: R.danglingSpawns.length,
  badDeathFx: R.badDeathFx.length, byIdDangling: R.byIdDangling.length,
  petSpritesDangling: R.petSpritesDangling.length, unusedCatalogKeys: R.unusedCatalogKeys.length,
}, null, 1));
for (const k of ['missingMonsterFiles', 'missingCustomFiles', 'missingItemArt', 'loader404', 'danglingSprites', 'noSheetAtAll',
  'orphanCustom', 'orphanBase', 'ambientBase', 'petBase', 'danglingSpawns', 'badDeathFx', 'byIdDangling',
  'petSprites', 'petSpritesDangling', 'unusedCatalogKeys']) dump(k);
