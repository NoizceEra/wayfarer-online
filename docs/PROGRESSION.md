# Progression constants (Lv1-20)

Source of truth for the numbers below is the code; `node tools/progression_sim.mjs [--job ranger] [--no-quests] [--xp base,mul,exp] [--check]`
models time/XP/gold/potions per level from the real data tables and enforces guard rails with `--check`.

| Constant | Value | Where | Why |
|---|---|---|---|
| XP to next level | Lv<=20: `40 + 60*Lv^1.6` (Lv1 100, Lv5 826, Lv10 2428, Lv19 ~6.7k); tail `x (Lv/20)^1.2` | `data/stats.js` `XP_CURVE` | old `30+70*Lv^1.1` gave Lv10 in ~11 min, Lv20 in ~26 min with quests |
| Target pace (sim, with quests / grind only) | Lv5 5/11 min, Lv10 22/44, Lv15 42/84, Lv20 76/136 | sim | spec choice (Lv10) lands inside the first hour |
| Stat points | 6 at start, 3/lv (<15), 4, 5 | unchanged | RECOMMENDED button per class (`RECOMMENDED_WEIGHTS`) |
| Mob damage | `hit * 1.7 * levelMul * (1 - DEF/(DEF+50+5*Lv))`, DEF mitigation capped 60% | `data/combatMath.js` `mobHitDamage` | old flat `raw - DEF/2` made normal mobs deal 1 dmg once a hero wore any armour (idle hero beside Lv11 elite lost 0 HP in 12 s) |
| Healing potion | heals `max(45, 20% maxHP)`; price `3 + floor(Lv/4)` g (3g Lv1-3, 8g Lv20) | `systems/economy.js` | 45 HP was 8% of a Lv20 bar |
| Undo sell | buy-back at sell price for 60 s, then +25% | `economy.js` | accidental sales |
| Death | -5% of level XP and -5% gold, respawn at last attuned waystone else town | `combat.js` (unchanged) | fair; never de-levels |
| Starter weapon | tut_blade (`First Blood`) grants + auto-equips class weapon (`reward.gear:'starter_weapon'`) | `questSystem.js`, `quests/tutorial2.js` | heroes start unarmed; shop weapons cost 60-90g vs 20g start |
| Daily reward | 50..250g days 1-6, 500g + 5 tokens day 7 (unchanged, nothing gates progress) | `dailyRewards.js` | flagged: day-7 500g is ~half a Lv10 gold budget |

Sim model knobs (`MODEL` in the script): 7 s overhead per kill, 0.7 enemy hits/s x 1.4 pack x 0.65 not dodged, quests capped at 50% of a level.
