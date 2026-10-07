# PETS UX — roster & battle UI contract

How the pet UI is laid out, which invariants must never be broken, and how it was
verified. Companion to `docs/SYNC_ASSETS.md` (asset side) and `src/data/pets.js`
(data side).

## 1. Data invariants (do not break)

| Rule | Why |
|---|---|
| `PETS[id].sprite` is **already a full texture key** (`'mon.Mouse'`). Never re-prefix it. Resolve the raw value first, then fall back to `` `mon.${sprite}` ``, then to a colour block. | Re-prefixing yields `mon.mon.Mouse`, `textures.exists()` returns false and the sprite silently renders as nothing (or a grey box). This is the historical failure mode in this feature. |
| **Roster identity is the array INDEX, not `p.slot`.** `makePet()` never sets `slot`. | Keying selection / release / evolve on `p.slot` makes every entry compare equal (`undefined === undefined`): every row renders as "selected", and releasing the 3rd pet deletes the 1st. `p.slot` is only *written* back densely after a release, for consumers like the battle team builder. |
| Pet data lives at `progress.ext.pets` and must survive `normalizeExtras()` (client) and the server sanitize. | Otherwise the roster vanishes on reload. |
| Pet lines are **3-stage level evolutions** (`PETS[id].evolutions`). Stage labels are derived from that chain — never hardcode them. | `stageInfo()` in `PetPanel.js` walks the chain from its root. |
| Pet battles are **real-time synchronous turn-based** (owner requirement). | Don't turn them into an async/queued flow. |
| `net/NetworkManager.js` reads the roster through `window.__socialUI.petPanel.getRoster()`. | `PetPanel` must expose `getRoster()`/`setRoster()` (the `roster` accessor alone is not enough — `getRoster?.()` returned `undefined` and every hero snapshot sent an empty pet list). |
| pet-duel messages carrying `sessionId` are passthrough echoes and must be ignored; `pet-duel` stays in the server moduleTypes blocklist. | Handled in `server/petDuel.js` / `petDuelNet.js` — not in the UI. |

## 2. Roster panel (`src/ui/PetPanel.js`)

Layout is computed from `scene.view()` (UI-scaled units) and adapts to both axes:

* `compact` = `W/H < 1` or `W < 560` (portrait / phone).
* Panel: `pw = min(W-12, compact ? 360 : 560)`, `ph = min(H-12, compact ? 640 : 470)`.
* Wide: roster list in a left column, detail pane beside it.
  Compact: list on top, **detail pane anchored to the panel bottom** (`detY = contentBottom - detH`).
* Row budget: `visible = min(roster.length, floor(listAvail / 42))` and
  `rowH = min(58, floor(listAvail / visible))`. If the roster is longer than the
  space allows, the panel prints `+N more` instead of clipping.
* The detail stack is a fixed offset table (`name/meta/bar/hint/stats/caption/input/b1/b2`);
  if the pane is shorter than the stack needs, every offset is scaled by
  `h / needed` so nothing can spill outside the box.

Rendered per row: sprite, name, `Lv n type`, `HP cur/max`, an `ACTIVE` tag and an
`EVOLVE` tag when eligible. Detail pane: name, `TYPE · Lv n · Stage n/total`, XP bar,
`XP x/y · → Next @ LvN` (or `READY TO EVOLVE` / `final form`), `HP/ATK/DEF/SPD`, a
free nickname input, and `SET ACTIVE` / `RELEASE` / `EVOLVE` / `PREMIUM RENAME · 10`.

**Disabled states are real**: a disabled button is drawn dimmed with no hit area at
all (`SET ACTIVE` when the pet is already active, `RELEASE` when it is the only pet).
A tap can never fire a pointless action.

The nickname `<input>` is positioned with `rect.left + x * (rect.width/canvas.width) * uiZoom`.
On Phaser 3.90 `canvas.width === clientWidth` (the `resolution` config is a no-op),
so the backing-store ratio is 1 and the math holds at any `devicePixelRatio`.

## 3. Battle panel (`src/ui/PetBattlePanel.js`)

> **Status: not wired.** Nothing imports `PetBattlePanel`, so Rollup tree-shakes it
> out of the production bundle — wild pet battles are not reachable in the shipped
> client today (capture uses `CapturePrompt`). Wiring it needs a file outside the
> pet-UI set (e.g. `petEncounter.js` / `WorldScene.js`). Verified via a scratch
> probe entry that imports the real module.

* Vertical budget is stacked from the panel bottom: `secY → moveY → logTop → arena`,
  so the battle log can never overlap the SWITCH/ITEM/FLEE row (it did, on every
  viewport) and the controls can never sit inside the arena.
* Move buttons are sized to the panel: `colW = clamp((pw-24-gap*(n-1))/n, 58, 140)`;
  the secondary row uses `clamp((pw-24-16)/3, 74, 110)`. A 4-move row used to run
  off the left edge of a 390px-wide screen (`x = -25`).
* Pet cards scale with the arena (`k = clamp(arenaH/344, 0.55, 1)`), so short
  viewports shrink the sprites, name, badge and HP bar together.
* **Animation key**: monsters only have `mon.<Name>.move.<dir>` (there is no
  `.idle.<dir>` — 0 idle animations exist for monsters, 320 move ones). Playing
  `idle.down` silently did nothing and the sprite sat frozen on frame 0.
* **Real disable**: `_setBusy(true)` calls `disableInteractive()` on every action
  button and dims the plate + label; `setInteractive(false)` never disabled
  anything because Phaser's `enable()` only ever sets `input.enabled = true`.
* `_rebuildSprites()` destroys the *whole* pet card (sprite, platform, name, type
  badge, HP bar) — previously the old name/HP bar stayed on screen after a switch.
* `close()` destroys the switch sub-menu (it lives outside the panel container and
  used to be left behind on screen).

## 4. Pet-duel prompt (`src/ui/PetDuelRequest.js`)

* Pushes `input` modal `petDuelReq` (gameplay keys blocked) and adds a
  click-swallowing backdrop.
* Registers an `input.addCloser({ id: 'pet-duel-request', priority: 970 })` that
  calls `_decline()`. `UIScene` also registers an id-`pet-duel-request` closer
  (priority 960) which only calls `hide()`; `addCloser()` de-dupes by id so this
  one replaces it, and 970 outranks the generic `social` aggregator (950) — with a
  lower priority Escape closed the no-op `social` closer first and left the prompt
  on screen. Declining (not just hiding) tells the server, so the challenger does
  not have to wait out its 45s timeout.

## 5. Verification

The panel is canvas-rendered, so checks read the real display list rather than
screenshots:

* every `PETS[*].sprite` → `scene.textures.exists(key)` **and** a non-transparent
  pixel count on the source image (proves the texture is not blank);
* every roster row → an `Image` child of the panel container with that texture key
  (not the colour-block fallback), plus a sample of real canvas pixels under the
  sprite (non-modal pixel count) to prove it is drawn;
* child `getBounds()` vs the panel rect for containment (nothing off-panel), and
  pairwise rect tests for the log-vs-buttons overlap;
* `anims.currentAnim.key` on the battle sprites to prove they animate;
* `input.enabled` + fill/label colour on the move buttons while busy;
* `getRoster()` type/length, and `_release`/`_setActive` roster diffs.

Run at 1280x720 and 390x844 (`deviceScaleFactor: 2`) against a scratch build
(`npx vite build --outDir <scratch>`) served by `python -m http.server`; the repo
`dist/` is never written.

Note: `vite dev` currently fails to boot the game —
`src/data/guilds.cjs` declares `GUILD_RANKS` without exporting it, so the guild UI's
named import throws and the `gameplay` chunk never loads. The production build is
unaffected. Fixing that is outside the pet-UI file set.
