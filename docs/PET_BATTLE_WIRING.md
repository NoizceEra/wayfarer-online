# PET BATTLE — wild encounter wiring

How the turn-based **PET BATTLE** panel (`src/ui/PetBattlePanel.js`) is reached
from gameplay, so the 16 panel fixes are live in the shipped client instead of
being tree-shaken away.

## The regression this fixes

`PetBattlePanel` had no importer. Rollup tree-shook it out of every production
chunk, so the string `PET BATTLE` appeared in **no** built chunk and wild/PvP pet
battles were unreachable in the shipped client. (`docs/PETS_UX.md` §3 flagged
this: *"Nothing imports `PetBattlePanel`"*.)

## The wiring (smallest hook that works)

The panel is now imported by the **existing** wild-encounter system and opened
through it — no parallel battle system.

| Layer | File | Change |
|---|---|---|
| Encounter / battle opener | `src/systems/petEncounter.js` | imports `PetBattlePanel`; adds `challengeWild()` / `startBattle(wisp)` / `_playerTeam()`; registers the `petBattle` action; persists the battle result back to the roster |
| Gameplay hook | `src/scenes/WorldScene.js` | wires the `petBattle` action to `petEncounter.challengeWild()` |
| Result hand-off | `src/ui/PetBattlePanel.js` | `close()` passes the finished `PetBattle` to `hooks.onClose(panel, battle)` (the engine is side-effect-free by design, so the opener persists XP/levels) |

### Player flow

1. In the world, press the **`petBattle`** action (**`R`** by default; rebindable,
   listed in the Help overlay under **World → "Battle wild pet"**).
2. `PetEncounterSystem.challengeWild()`:
   * if a wild **wisp** is within interact range, it is challenged directly;
   * otherwise one is **conjured** at the player's feet (`_conjureWisp()` reuses
     `_spawnWisp`), so the battle is reachable anywhere — not only on the 6.5%
     kill-roll that normally spawns a wisp.
3. `startBattle(wisp)` builds the **player team from the live roster**
   (`progress.ext.pets.roster`) and the opponent from the wisp's pet id (level =
   hero level, `isWild: true`), then opens `PetBattlePanel` on the **UI scene**
   (screen-space modal must render above the HUD, and only the UI scene exposes
   `view()`).
4. The battle runs on the existing real-time synchronous turn-based `PetBattle`
   engine. On close, `_persistBattleResult()` writes level / xp / stats back onto
   the real roster (pets are left at full HP — there is no pet-heal UI yet).

If the roster is empty, the action prints *"You need a pet to battle — hatch one
from the Pet Master first."* instead of opening an empty panel.

## Not wired (honest status)

* **PvP pet duels.** `net/petDuelNet.js` + `systems/social/index.js` deliver the
  `PET_DUEL_START` payload and `PetDuelRequest` shows the challenge prompt, but
  accepting a duel does **not** open `PetBattlePanel`. Fixing that needs
  `systems/social/index.js` (or `net/**`), which is outside this change's file
  set, and it needs the server-authoritative team snapshot (`aTeam`/`bTeam`)
  plumbed into the panel. Left as-is; the wild-battle path above is the reachable
  one.

## Verification

* `node --check` on all three touched files.
* A scratch production build (`vite build --outDir <scratch>`) and a grep of the
  output chunks: `PET BATTLE` now appears in the built game chunk (previously
  absent).
* Boot the scratch build in Chrome, press the `petBattle` action, and read the
  panel's real display list (title, pet rows, HP values, move buttons) with no
  page errors.
