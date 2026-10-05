# Player Housing — Home Island

Private, instanced home plot per character. This track owns **only three new
files** and edits nothing existing:

- `src/data/housing.js` — furniture catalogue, trophy types, plot yield table,
  layout bounds, `normalizeHousing()` / `sanitizeHousing()` / `todayUTC()`.
- `src/scenes/HomeIslandScene.js` — `HomeIslandScene` (scene key `'home'`),
  follows `GuildHallScene.js` patterns (palette, pixel buttons, ESC to leave).
- `docs/HOUSING.md` — this file.

## Design

- **Personal instance.** Entered with `init({ name, hero, mode, returnTo })`;
  no other player state is loaded or rendered. Nothing is shared or tradable.
- **Furniture placement.** 12×9 plot grid. Click a catalogue entry, then a
  cell. One of each piece per plot, 40 pieces max. Cost = gold (sink) +
  existing material ids — deducted from the local progress record in
  `tryPay()`. New furniture ids use the `furn_` prefix so they never collide
  with `gear.js` / `materials.js` / `item_ids.json`.
- **Trophies.** Three kinds: `boss` (ref → `worldBosses.js` boss id), `pet`
  (ref → `pets.js` pet id), `achievement` (ref → `ext.ach` flag). Max 12.
  The scene renders earned plaques; gating (has the player earned `ref`?) is
  parent/UI work — the catalogue only declares `{ id, name, source, ref }`.
- **Garden plot.** Tiers `sprout → herb → orchard`, each with a fixed daily
  material bundle and an unlock cost. Materials reuse existing mat ids only
  (`sunpetal`, `dewberry`, `moonmoss`, `thornberry`).
- **Portal back.** `⛩ PORTAL TO TOWN` button (or ESC/H) calls `leaveHome()`,
  which restarts `'world'` with the `returnTo` payload the scene arrived with.

## Save shape

Lives at `progress.ext.housing` — plain JSON, bounded arrays, no functions:

```js
housing: {
  unlocked: false,          // bool
  plot: null,               // null | 'sprout' | 'herb' | 'orchard'
  layout: [],               // [{ id, x, y, rot }]  len ≤ 40, id ∈ FURN_IDS
  trophies: [],             // [{ id, x, y }]        len ≤ 12, id ∈ TROPHY_IDS
  yieldClaim: { date: '', amount: 0 },  // last UTC-date claimed
}
```

`normalizeHousing()` (client) and `sanitizeHousing()` (server-strict, drops
unknown ids) enforce the bounds; both are exported from `housing.js` for the
parent to call (see missing hooks below). `x/y` are clamped to the 12×9 grid,
`rot` to 0–3, `yieldClaim.date` to 10 chars.

## Caps & anti-bot notes

- **No gold minting.** Yield pays materials only (`YIELD_RULES.paysGold:
  false`). Furniture/plot costs are gold + material *sinks*.
- **Capped daily claim, no accrual.** `claimsPerDay: 1` gated on UTC date
  (`yieldClaim.date !== todayUTC()`). There is deliberately no elapsed-time
  math: unclaimed days are lost, so botting/away-time confers nothing and
  there is no compounding to validate.
- **Rate-cap friendly.** Claim adds ≤5 common mats/day — far below gathering
  pace. Server `validateSave` gold/level rate caps are unaffected (no gold,
  no xp involved). `sanitizeHousing()` drops unknown ids so crafted ids can
  never smuggle gear into `inventory` (economy whitelist untouched).
- **Size bounded.** Layout (40) + trophies (12) + one date string fit well
  inside the server `ext` 48 KB budget (`sanitizeExtras`).
- **Anti-bot.** Claim requires the scene to be open and the button pressed —
  no offline progress, no API-claimable endpoint proposed. Recommend parent
  also gate `/home` behind town/interior (not combat) when wiring the command.

## Registration snippet (PARENT must add — this track edits no existing file)

1. **Scene registration** in `src/main.js`:

```js
import HomeIslandScene from './scenes/HomeIslandScene.js';
// add to the scene array:
scene: [BootScene, TitleScene, CreatorScene, GuildHallScene, HomeIslandScene],
```

2. **`/home` chat command** in `src/ui/economyUI.js` `installCommands`
   (next to the other `case` entries; `game` is the Phaser.Game instance —
   `game.scene.start('home', ...)` works even cross-scene since scenes share
   the SceneManager; pass `returnTo` so the portal knows where to go back):

```js
case 'home': {
  const game = window.__wayfarer;
  const world = game.scene.getScene('world');
  const payload = {
    name: world?.pname || 'Wayfarer',
    hero: world?.heroData || null,
    mode: world?.mode || 'solo',
    returnTo: { name: world?.pname, hero: world?.heroData, mode: world?.mode },
  };
  game.scene.start('home', payload);
  return true;
}
```

3. **NPC portal** (housing NPC in town, e.g. next to the market clerks in
   `src/data/npcs.js` + interaction in the town/world interaction handler):

```js
// NPC entry (town roster):
{ id: 'housing_steward', name: 'Steward Odo', text: 'Your island awaits, Wayfarer. (type /home or step in)' }
// Interaction handler:
if (npc.id === 'housing_steward') {
  this.scene.start('home', {
    name: this.pname, hero: this.heroData, mode: this.mode,
    returnTo: { name: this.pname, hero: this.heroData, mode: this.mode },
  });
}
```

4. **Save Plumbing (REQUIRED — otherwise housing silently resets).**
   `normalizeExtras()` in `src/core/save.js` builds a fixed object and drops
   unknown `ext` keys, so `ext.housing` is lost on `loadProgress` until the
   parent wires it (same file, needs the import + one line):

```js
import { normalizeHousing } from '../data/housing.js';
// inside normalizeExtras's return object:
housing: normalizeHousing(r.housing),
```

   Server `sanitizeExtras()` in `server/validate.js` currently passes `ext`
   through under a 48 KB cap, so housing survives upload as-is; optionally
   harden with `sanitizeHousing()` once the server shares the catalogue.
