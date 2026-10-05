#!/usr/bin/env node
// Progression simulation: how long does each level take, how much gold does it
// pay, how many potions does it eat, and how does that compare with the quest
// + gather XP on offer? Pure data model: it imports the real tables
// (stats.js, combatMath.js, jobs.js, worldEnemies.js, gear.js, quests.js), so a
// numeric change in those files shows up here without editing this script.
//
//   node tools/progression_sim.mjs                 # table for a Wayfarer, Lv1-20
//   node tools/progression_sim.mjs --job ranger    # another class
//   node tools/progression_sim.mjs --to 30 --csv   # longer range, CSV rows
//   node tools/progression_sim.mjs --check         # exit 1 when a guard-rail fails (CI / pre-commit)
//
// Model (all knobs in MODEL below; documented in docs/PROGRESSION.md):
//  * the hero hunts the zone whose level band contains him (ZONE_FOR_LEVEL),
//  * a kill costs  TTK (hp / dps)  +  OVERHEAD seconds (find, chase, loot, regen),
//  * dps follows the real basic-attack chain (1 / 1.1 / 1.6x, finisher 1.5x delay),
//    ATK from computeDerived + a gear tier ladder (GEAR_LADDER),
//  * damage taken = mob hit * mobDmgMul - DEF/2, ~HITS_PER_SEC contact rate, DODGE_FRAC avoided,
//  * a potion heals POTION_HEAL (3g) -- the sim buys what the fights eat,
//  * quest XP/gold: every non-repeat quest whose level gate is met, taken once, in level order.
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (p) => import(pathToFileURL(path.join(ROOT, 'src', p)).href);

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const flag = (k) => args.includes(k);

const { JOBS, ENEMY_TABLE } = await src('data/jobs.js');
await src('data/worldEnemies.js');
const stats = await src('data/stats.js');
const { computeDerived, statPointsForLevel, START_STAT_POINTS, statCost } = stats;
// `--xp base,mul,exp` previews a different XP curve: base + mul * Lv^exp (what stats.js uses today).
const XPF = arg('--xp', null);
const xpToNext = XPF ? ((b, m, e) => (lv) => Math.round(b + m * Math.pow(Math.max(1, lv), e)))(...XPF.split(',').map(Number)) : stats.xpToNext;
const { xpMul, heroDmgMul, mobHitDamage, heroMissChance, scaleForLevel, RANKS } = await src('data/combatMath.js');
const { ZONES, AREAS } = await src('data/zones.js');
const { QUEST_LIST } = await src('data/quests.js');
const { GEAR } = await src('data/gear.js');

export const MODEL = {
  OVERHEAD_S: 7.0,        // seconds per kill that are not fighting (walk, aggro, loot, small regen)
  HITS_PER_SEC: 0.7,      // enemy attack cycle ~1.4s (Enemy PATTERNS.melee cd) while a mob is alive and adjacent
  PACK: 1.4,              // average mobs engaged at once (aggro radius 85px, dense spawns)
  DODGE_FRAC: 0.35,       // share of mob hits dodged / rolled / out-ranged (windups are telegraphed)
  POTION_HEAL: 45,        // Healing Potion (shop, 3g) -- ModularPlayer potion use
  POTION_PRICE: 3,
  HP_FLOOR: 0.35,         // the player drinks when HP would fall below this fraction
  ELITE_SHARE: 0.07,      // ~7% of spawns are elite (rollRank), 1.5% champion
  QUEST_SHARE: 0.5,       // share of available quest XP/gold a real player actually banks in that band
  GATHER_GOLD_PER_MIN: 3, // sunpetal/dewberry/log vendor value picked up on the way (min of detours)
  STAT_POLICY: 'recommended',
};

const jobId = arg('--job', 'wayfarer');
const job = JOBS[jobId];
if (!job) { console.error(`unknown job ${jobId}`); process.exit(2); }
const TO = Number(arg('--to', 20));

// Recommended stat split per class: the same table the Character panel's RECOMMENDED button uses.
const REC = stats.RECOMMENDED_WEIGHTS;

// Gear ladder: what a player who follows the intended loop (starter weapon from
// the tutorial, shop buys when affordable, quest rewards, drops) wears by level.
// Numbers are the sums of real catalogue stats of the representative items.
export const GEAR_LADDER = [
  { lv: 1, atk: 0, def: 0, hp: 0 },
  { lv: 2, atk: 3, def: 1, hp: 0 },      // starter weapon (tut_blade) + traveler cloak (q_meadow)
  { lv: 4, atk: 5, def: 4, hp: 10 },     // steel_brand / iron kite or mail (shop 140g, Lv4)
  { lv: 6, atk: 8, def: 9, hp: 25 },     // rare drops + quest gear (swift boots, glimmer orb)
  { lv: 8, atk: 9, def: 14, hp: 45 },    // tide plate / bastion / horned helm tier
  { lv: 10, atk: 12, def: 22, hp: 75 },  // first epic pieces (spec gear)
  { lv: 14, atk: 14, def: 28, hp: 110 },
  { lv: 18, atk: 16, def: 34, hp: 140 },
];
const gearAt = (lv) => GEAR_LADDER.filter((g) => g.lv <= lv).pop();

// Zone the player should be hunting at a level (intended path through the world).
export const ZONE_FOR_LEVEL = (lv) => (lv <= 3 ? 'meadow' : lv <= 7 ? 'woods' : lv <= 9 ? 'ruins' : lv <= 12 ? 'crypt' : lv <= 14 ? 'frost' : lv <= 17 ? 'desert' : 'caverns');

const zoneDef = (id) => ZONES.find((z) => z.id === id) || AREAS[id] || { lv: [1, 4] };
const mobsOfZone = (id) => Object.entries(ENEMY_TABLE).filter(([, d]) => (d.zones || []).includes(id) && !d.boss);

function allocFor(level) {
  // Spend all points by the policy weights (greedy, respecting RO-style rising cost).
  const w = REC[jobId];
  const alloc = { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 };
  let pts = START_STAT_POINTS;
  for (let l = 2; l <= level; l++) pts += statPointsForLevel(l);
  const spent = Object.fromEntries(Object.keys(alloc).map((k) => [k, 0]));
  let guard = 400;
  while (pts > 0 && guard--) {
    // pick the stat furthest below its target share of spent points
    let best = null, bd = -1e9;
    const tot = Object.values(spent).reduce((a, b) => a + b, 0) + 1;
    for (const [s, share] of Object.entries(w)) {
      const cost = statCost((job.base[s] || 5) + alloc[s]);
      if (cost > pts) continue;
      const d = share - spent[s] / tot;
      if (d > bd) { bd = d; best = { s, cost }; }
    }
    if (!best) break;
    alloc[best.s] += 1; spent[best.s] += best.cost; pts -= best.cost;
  }
  return alloc;
}

function heroAt(level) {
  const g = gearAt(level);
  const kind = jobId === 'ranger' ? 'bow' : jobId === 'arcanist' ? 'wand' : 'melee';
  const d = computeDerived({ job, level, alloc: allocFor(level), weaponKind: kind });
  const atk = (kind === 'wand' ? d.matk : d.atk) + g.atk;
  return { d, atk, def: d.def + g.def, maxHp: d.maxHp + g.hp, delayMs: d.attackDelay };
}

// Basic-attack chain: dmg multipliers 1/1.1/1.6, delays 1/1/1.5 -> avg dmg per ms.
const CHAIN_DMG = (1 + 1.1 + 1.6), CHAIN_DELAY = (1 + 1 + 1.5);
function dpsVs(h, mobLv, heroLv) {
  const miss = heroMissChance(heroLv, mobLv);
  const perHit = (h.atk + 1.5) * heroDmgMul(heroLv, mobLv) * (1 - miss);
  const crit = 1 + 0.01 * (h.d.crit || 1) * 0.5;
  return (perHit * CHAIN_DMG / (CHAIN_DELAY * h.delayMs / 1000)) * crit * 0.9; // 0.9: swing misses on moving mobs
}

function killStats(level) {
  const h = heroAt(level);
  const zid = ZONE_FOR_LEVEL(level);
  const z = zoneDef(zid);
  const mobs = mobsOfZone(zid);
  if (!mobs.length) return null;
  let xp = 0, gold = 0, ttk = 0, dmgTaken = 0, n = 0;
  for (const [, def] of mobs) {
    for (const rank of [RANKS.normal, RANKS.elite]) {
      const wRank = rank === RANKS.normal ? 1 - MODEL.ELITE_SHARE : MODEL.ELITE_SHARE;
      for (let off = 0; off <= 2; off++) {
        const lv = Math.min(Math.max(z.lv[0] + off, z.lv[0]), Math.max(z.lv[0], z.lv[1])) + rank.lv;
        const st = scaleForLevel({ ...def, lv: z.lv[0] }, lv);
        const hp = st.hp * rank.hp;
        const x = Math.max(1, Math.round(st.xp * rank.xp)) * xpMul(level, lv);
        const gld = ((st.gold[0] + st.gold[1]) / 2) * rank.gold;
        const t = hp / dpsVs(h, lv, level);
        const hit = (st.dmg != null ? st.dmg * 1.8 : st.atk * 0.45 + 1) * rank.atk;
        const perHit = mobHitDamage(hit, level, lv, h.def);
        const w = wRank / 3;
        xp += x * w; gold += gld * w; ttk += t * w; dmgTaken += t * MODEL.HITS_PER_SEC * MODEL.PACK * (1 - MODEL.DODGE_FRAC) * perHit * w;
        n += w;
      }
    }
  }
  return { zid, xp: xp / n, gold: gold / n, ttk: ttk / n, dmgTaken: dmgTaken / n, h };
}

// Non-repeat quests by gate level (levelOk: player level >= q.lv - 1).
const questPool = QUEST_LIST.filter((q) => !q.repeat && q.reward && (q.reward.xp || q.reward.gold));
const questBy = (lv) => questPool.filter((q) => (q.lv || 1) - 1 === lv - 1 || false);
function questBandReward(lv) {
  // quests that become available exactly at this level (lv-1 gate) -> banked while levelling through `lv`
  let xp = 0, gold = 0;
  for (const q of questPool) { const gate = Math.max(1, (q.lv || 1) - 1); if (gate === lv) { xp += q.reward.xp || 0; gold += q.reward.gold || 0; } }
  return { xp: xp * MODEL.QUEST_SHARE, gold: gold * MODEL.QUEST_SHARE };
}
void questBy;

const rows = [];
let cumMin = 0, cumGold = 0, xpCarry = 0;
for (let lv = 1; lv < TO; lv++) {
  const k = killStats(lv);
  if (!k) continue;
  const need = xpToNext(lv);
  const qb = questBandReward(lv); // quests unlocked at this level pay out during the level
  const gatherMin = 0; void gatherMin;
  const fromQuests = flag('--no-quests') ? 0 : Math.min(need * 0.5, qb.xp + xpCarry); // quests never skip more than 50% of a level
  xpCarry = Math.max(0, qb.xp + xpCarry - fromQuests);
  const grind = Math.max(0, need - fromQuests);
  const kills = grind / k.xp;
  const secPerKill = k.ttk + MODEL.OVERHEAD_S;
  const minutes = (kills * secPerKill) / 60 + (fromQuests > 0 ? (fromQuests / 60) * 0.0 : 0);
  const goldKills = kills * k.gold + qb.gold;
  const gather = minutes * MODEL.GATHER_GOLD_PER_MIN;
  const hpMax = k.h.maxHp;
  const dmgPerKill = k.dmgTaken;
  const hpLossFrac = dmgPerKill / hpMax;
  const potions = Math.max(0, (kills * dmgPerKill - 0.0) / MODEL.POTION_HEAL) * 0.35; // the rest regens between pulls / camp / inn
  const potionCost = potions * MODEL.POTION_PRICE;
  cumMin += minutes; cumGold += goldKills + gather - potionCost;
  rows.push({
    lv, zone: k.zid, xpNext: need, questXp: Math.round(fromQuests), killXp: +k.xp.toFixed(1), kills: Math.round(kills),
    ttk: +k.ttk.toFixed(1), mins: +minutes.toFixed(1), cumMin: +cumMin.toFixed(0), goldLv: Math.round(goldKills + gather), potions: +potions.toFixed(1),
    hpLossPerKill: +(hpLossFrac * 100).toFixed(1), cumGold: Math.round(cumGold), atk: Math.round(k.h.atk), maxHp: Math.round(hpMax), def: Math.round(k.h.def),
  });
}

if (flag('--csv')) {
  console.log(Object.keys(rows[0]).join(','));
  for (const r of rows) console.log(Object.values(r).join(','));
} else {
  console.log(`Progression sim: ${job.name}, Lv1 -> Lv${TO} (stat policy: ${MODEL.STAT_POLICY}, overhead ${MODEL.OVERHEAD_S}s/kill)\n`);
  const cols = [['lv', 'Lv'], ['zone', 'zone'], ['xpNext', 'XP>next'], ['questXp', 'questXP'], ['killXp', 'XP/kill'], ['kills', 'kills'], ['ttk', 'TTK s'], ['mins', 'min'], ['cumMin', 'cum min'], ['goldLv', 'gold'], ['cumGold', 'cum gold'], ['potions', 'potions'], ['hpLossPerKill', 'HP% /kill'], ['atk', 'ATK'], ['maxHp', 'HP'], ['def', 'DEF']];
  console.log(cols.map(([, h]) => h.padStart(9)).join(' '));
  for (const r of rows) console.log(cols.map(([k]) => String(r[k]).padStart(9)).join(' '));
  const at = (L) => rows.find((r) => r.lv === L - 1);
  console.log(`\nTime to Lv5: ${at(5)?.cumMin ?? '?'} min | Lv10: ${at(10)?.cumMin ?? '?'} min | Lv15: ${at(15)?.cumMin ?? '?'} min | Lv20: ${at(20)?.cumMin ?? '?'} min`);
}

// Guard rails (design contract; see docs/PROGRESSION.md).
if (flag('--check')) {
  const fails = [];
  const L = (n) => rows.find((r) => r.lv === n - 1);
  if (L(5) && (L(5).cumMin < 3 || L(5).cumMin > 14)) fails.push(`Lv5 at ${L(5).cumMin} min (want 3-14 with quests)`);
  if (L(10) && (L(10).cumMin < 15 || L(10).cumMin > 55)) fails.push(`Lv10 at ${L(10).cumMin} min (want 15-55: specialization inside the first hour)`);
  if (L(20) && L(20).cumMin > 200) fails.push(`Lv20 at ${L(20).cumMin} min (want <= 200)`);
  for (const r of rows) {
    if (r.mins > 15) fails.push(`Lv${r.lv} takes ${r.mins} min (cap 14: no single level should feel like a wall)`);
    if (r.mins < 0.8 && r.lv >= 3) fails.push(`Lv${r.lv} takes ${r.mins} min (floor 0.8: levels should be felt)`);
    if (r.hpLossPerKill > 28) fails.push(`Lv${r.lv}: ${r.hpLossPerKill}% HP lost per kill (too punishing)`);
    if (r.potions > 25) fails.push(`Lv${r.lv}: ${r.potions} potions per level (potion tax too high)`);
  }
  if (fails.length) { console.error('\nGUARD-RAIL FAILURES:\n - ' + fails.join('\n - ')); process.exit(1); }
  console.log('\nGuard rails: OK');
}
