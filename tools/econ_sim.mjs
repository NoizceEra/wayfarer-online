#!/usr/bin/env node
// Faucet / sink model of the gold economy (docs/ECONOMY.md explains the numbers).
//
//   node tools/econ_sim.mjs            # table per level band, typical + grinder profiles
//   node tools/econ_sim.mjs --json     # machine-readable
//   node tools/econ_sim.mjs --check    # exit 1 if the server caps (server/validate.js)
//                                      # would flag a legit grinder, or leave > 4x headroom
//
// Uses the real client data (enemy gold/xp, gear drop rolls, material drops,
// quest rewards, vendor prices) via Monte-Carlo kills. Assumptions (tunable):
//   - a player fights mobs of their own level (content tops out ~Lv 19, MAX_LEVEL 50)
//   - kills/hour: typical 240 (travel, quests, town), grinder 540 (non-stop pulls)
//   - gear drops are sold to vendors (40%), materials sold at vendor price
//   - bosses: typical 1/h, grinder 3/h at their level; world events 1/h
//   - sinks (typical player): potions/tonics, inn, crafting fees, tempering,
//     one vendor upgrade per level up to Lv 10, death penalty 5% (1 death/h),
//     market tax on 1 listing/h (avg sale = 4x vendor value of a drop)
import { ENEMY_TABLE } from '../src/data/jobs.js';
import '../src/data/zones.js';
import { GEAR, SHOPS, rollGearDrop, sellPrice } from '../src/data/gear.js';
import { rollMatDrops, matById } from '../src/data/materials.js';
import { QUEST_LIST } from '../src/data/quests.js';
import { xpToNext, MAX_LEVEL } from '../src/data/stats.js';
import { CAPS, ECON, goldRateCap, wealthCap } from '../server/validate.js';

const args = process.argv.slice(2);
const JSON_OUT = args.includes('--json');
const CHECK = args.includes('--check');
const N = 4000; // Monte-Carlo kills per level

const mobs = Object.entries(ENEMY_TABLE).filter(([, e]) => !e.boss && e.gold && e.gold[1] > 0);
const bosses = Object.entries(ENEMY_TABLE).filter(([, e]) => e.boss);
const ZL = { meadow: 1, woods: 4, ruins: 8, dock_beach: 3, crypt: 9, frost: 12, desert: 13, marsh: 10, caverns: 15, hollow: 12 };
const lvOf = (e) => e.lv ?? Math.max(...e.zones.map((z) => ZL[z] || 1));
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const near = (list, L) => {
  const cap = Math.min(L, 19);
  for (let w = 1; w < 20; w++) { const s = list.filter(([, e]) => Math.abs(lvOf(e) - cap) <= w); if (s.length) return s; }
  return list;
};

function perKill(L) {
  const pool = near(mobs, L);
  let gold = 0, gear = 0, mats = 0, xp = 0, items = 0;
  for (let i = 0; i < N; i++) {
    const [id, e] = pool[i % pool.length];
    gold += rnd(e.gold[0], e.gold[1]);
    xp += e.xp;
    const g = rollGearDrop(id, 0);
    if (g) { gear += sellPrice(GEAR[g]); items += GEAR[g].price; }
    for (const m of rollMatDrops(id, 0)) mats += matById(m)?.price || 0;
  }
  return { gold: gold / N, gear: gear / N, mats: mats / N, xp: xp / N, itemValue: items / N };
}
function bossGold(L) {
  const pool = near(bosses, L);
  return pool.reduce((s, [, e]) => s + (e.gold[0] + e.gold[1]) / 2, 0) / pool.length;
}
// quest gold spread over the level each quest is meant for
const questGoldAt = {};
for (const q of QUEST_LIST) questGoldAt[q.lv || 1] = (questGoldAt[q.lv || 1] || 0) + (q.reward?.gold || 0);
const shopPrices = Object.values(SHOPS).flatMap((s) => s.stock).map((id) => GEAR[id].price).sort((a, b) => a - b);
const avgShop = shopPrices.reduce((a, b) => a + b, 0) / shopPrices.length;

const PROFILES = {
  typical: { kph: 240, bossPerH: 1, eventPerH: 1, deathsPerH: 1, listingsPerH: 1 },
  grinder: { kph: 540, bossPerH: 3, eventPerH: 1, deathsPerH: 0.2, listingsPerH: 0 },
};

function simulate(name) {
  const P = PROFILES[name];
  const rows = [];
  let wealth = 0, hours = 0, earnedTotal = 0;
  for (let L = 1; L < MAX_LEVEL; L++) {
    const k = perKill(L);
    const xpH = k.xp * P.kph + 0; // quest xp ignored: makes levelling look slower, i.e. conservative caps
    const hInLevel = xpToNext(L) / xpH;
    const faucet = {
      coins: k.gold * P.kph,
      vendorGear: k.gear * P.kph,
      mats: k.mats * P.kph,
      bosses: bossGold(L) * P.bossPerH,
      events: (L >= 4 ? 300 : 0) * P.eventPerH,
    };
    const quests = questGoldAt[L] || 0; // one-off, spread over the level
    const fH = Object.values(faucet).reduce((a, b) => a + b, 0) + quests / hInLevel;
    // sinks per hour (typical player behaviour; grinder spends ~nothing)
    const spend = name === 'grinder' ? 0.15 : 1;
    const sink = {
      potions: spend * (L < 10 ? 10 * 3 : 6 * 22),            // Hester potions early, tonics later
      inn: spend * 10,
      craft: spend * (L >= 3 ? 20 : 0),                       // fees for ~4 brews/meals
      temper: spend * (L >= 6 && L <= 30 ? (375 * 3 + 200) / 25 / hInLevel : 0), // 3 slots to +5 + mats, over Lv 6-30
      vendorGear: spend * (L <= 10 ? avgShop / hInLevel : 0), // one shop upgrade per level early
      death: 0, // filled below (needs wealth)
      marketTax: spend * P.listingsPerH * Math.ceil(4 * k.itemValue * 0.4 * ECON.MARKET_TAX),
      dyes: spend * (L >= 5 ? 0.5 * (ECON.DYE_BASE + ECON.DYE_PER_LVL * Math.min(L, 19)) : 0),
    };
    let net = fH - Object.values(sink).reduce((a, b) => a + b, 0);
    const deathLoss = P.deathsPerH * 0.05 * Math.max(0, wealth + net * hInLevel / 2);
    sink.death = deathLoss; net -= deathLoss;
    const sH = Object.values(sink).reduce((a, b) => a + b, 0);
    wealth = Math.max(0, wealth + net * hInLevel);
    earnedTotal += fH * hInLevel;
    hours += hInLevel;
    rows.push({ L, hInLevel: +hInLevel.toFixed(2), hours: +hours.toFixed(1), faucetPerH: Math.round(fH), sinkPerH: Math.round(sH), netPerH: Math.round(net), wealth: Math.round(wealth), earnedTotal: Math.round(earnedTotal), itemValuePerH: Math.round(k.itemValue * P.kph), faucet, sink });
  }
  return rows;
}

const out = { typical: simulate('typical'), grinder: simulate('grinder') };

// ── cap check: what server/validate.js allows vs what a legit grinder makes ──
const problems = [];
for (const r of out.grinder) {
  const capH = goldRateCap(r.L) * 3600;
  const needH = r.faucetPerH * 1.25; // + selling a full bag at once is covered by goldBase
  if (capH < needH) problems.push(`Lv${r.L}: gold cap ${capH}/h < grinder ${Math.round(needH)}/h (legit players would get bound gold)`);
  if (r.L <= 19 && capH > 6 * r.faucetPerH) problems.push(`Lv${r.L}: gold cap ${capH}/h is >6x a grinder's ${r.faucetPerH}/h (too loose)`);
  if (wealthCap(r.L) < r.earnedTotal * 0.6 && r.L <= 30) problems.push(`Lv${r.L}: first-save wealth cap ${wealthCap(r.L)} < 60% of all gold a grinder earned (${r.earnedTotal})`);
}

if (JSON_OUT) { console.log(JSON.stringify({ ...out, caps: CAPS, problems }, null, 1)); process.exit(CHECK && problems.length ? 1 : 0); }

const pad = (v, n) => String(v).padStart(n);
for (const name of ['typical', 'grinder']) {
  console.log(`\n== ${name} (${PROFILES[name].kph} kills/h) ==`);
  console.log(' Lv  h/lvl   hours  faucet/h  sink/h  net/h   wealth  earned  cap/h  wealthCap');
  for (const r of out[name]) {
    if (![1, 2, 3, 5, 8, 10, 12, 15, 19, 25, 30, 40, 49].includes(r.L)) continue;
    console.log(`${pad(r.L, 3)} ${pad(r.hInLevel, 6)} ${pad(r.hours, 7)} ${pad(r.faucetPerH, 9)} ${pad(r.sinkPerH, 7)} ${pad(r.netPerH, 6)} ${pad(r.wealth, 8)} ${pad(r.earnedTotal, 7)} ${pad(goldRateCap(r.L) * 3600, 6)} ${pad(wealthCap(r.L), 9)}`);
  }
  const r19 = out[name].find((r) => r.L === 19); const r10 = out[name].find((r) => r.L === 10);
  const t = r19.faucet; const tot = Object.values(t).reduce((a, b) => a + b, 0);
  console.log(`  Lv19 faucet mix: ${Object.entries(t).map(([k, v]) => `${k} ${Math.round(100 * v / tot)}%`).join(', ')}`);
  console.log(`  Lv10 sinks/h: ${Object.entries(r10.sink).map(([k, v]) => `${k} ${Math.round(v)}`).join(', ')}`);
}
console.log(problems.length ? `\nCAP PROBLEMS:\n  ${problems.join('\n  ')}` : '\ncaps OK: every legit grinder level fits under the server gold-rate cap, with < 6x headroom in the content range');
process.exit(CHECK && problems.length ? 1 : 0);
