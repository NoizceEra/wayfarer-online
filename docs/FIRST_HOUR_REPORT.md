# First-hour report (new guest, Lv1-20)

Method: real key presses from title -> creator -> world (Playwright), dialogs driven with E/digit keys; travel, level-ups and
long grinds fast-forwarded with `page.evaluate`. Wall-clock times are NOT play time (the bot is slow); pacing numbers come from
`tools/progression_sim.mjs` (docs/PROGRESSION.md). Not a literal 60-minute run.

## Timeline (scripted)
- 0s title -> creator -> world: spawn in Thistle Plaza, Lv1, 146 HP, 20g, 3 potions, 6 unspent stat points, no weapon.
- Tracker said "No active quests. Look for '!'"; 7 quests available at once (Pip alone offered Field Notes + First Steps).
- First Steps (explore plaza) auto-completes on accept (spawn is inside the POI). Turn-in follow-up offered **Field Notes before First Blood**, so the tutorial chain was skipped by default.
- First fights Lv1 meadow: 7-21 XP/kill, 0-5 HP lost per kill (146 HP). Idle hero beside Lv4-12 mobs (woods/ruins, geared) lost ~0 HP in 12 s.

## Top issues found
1. Onboarding hint card was never visible: built in the zoom-3 world camera, it landed off-screen.
2. Tutorial chain bypassed (follow-up ordering) and Granny Elda (tut_gather giver) lives inside a cottage with no pointer anywhere (her '!' only exists inside; minimap skips interior NPCs) = dead end for newcomers.
3. Tracker gave no "next objective"; no arrow/marker toward quest targets.
4. Hotkeys never taught beyond move/attack (talk, skills 1-4, Q potion, C/K, H).
5. No starting weapon; first weapon 60-90g vs 20g start. Stat/skill points unspent with no guidance.
6. Combat trivial: flat DEF subtraction made normal mobs deal ~1 dmg; potions/armour/death penalty irrelevant until bosses.
7. XP curve too fast: Lv10 ~11 min, Lv20 ~26 min with quests; ~16 kills per level at every level.
8. Potion heal flat 45 (8% of Lv20 HP); sell of rare/epic had no confirm; no undo; autosave silent; no stuck option; `/tutorial` promised by a toast but not implemented; no delete-hero feature exists (so no delete-slot confirm needed); respec already two-step.
9. Not fixed: quests/tutorial duplicate Elda's hearth chain (sunpetal x2 and x4); dialog menus cap at 7 options with digits 1-5 only (options 6-7 need a click); day-7 daily 500g.

## Fixes (this branch)
Hint card repositioned/counter-scaled, 6 steps (move, attack, kill, talk, skills, board), SKIP X persists; tutorial-first quest ordering; tracker "Next: <quest> - Talk to X (NE 35 tiles)" + gold guide arrow around the hero (`/guide` toggles) incl. door pointer for Elda; Pip's text names Elda's cottage; starter weapon reward auto-equipped; RECOMMENDED stat button + recommended skill marker; new XP curve; proportional DEF + mob damage x1.7; scaling potion heal/price; sell confirm for rare/epic + 60 s undo at sell price; autosave "Progress saved" pip; first low-HP / points tips; `/stuck` + pause-menu "Stuck? Return to town" (4 s channel, no cost, not in combat/dungeon); `/tutorial`.

## Lv10-20 quick check
Zones cover Lv1-20 only (caverns 15-19, hollow 12-20); job-change chains open Lv9; crypt 9-13 and frost 11-15 recommended levels line up with sim pace (Lv10 ~min 22). Lv18-19 levels take 7-12 min (content ceiling; Lv20+ has no zones). Arena/dungeon unlocks not re-verified in play.

## Untested
Full literal hour; touch layout of hint card; /stuck warp from dungeons/areas other than overworld; live re-measure of mob damage after the 1.7x change (sim only); Esc-closers interaction with new pause row.
