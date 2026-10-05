# Housing Portal — Steward Odo

In-world portal NPC that sends the player to the private home-island instance
(`HomeIslandScene`, scene key `'home'`, registered in `src/main.js`).

## Location

- **Thistle Town plaza**, next to the market-board clerk Posey and the notice
  board: spawn-relative offset `[-134, -28]` (Posey is at `[-150, -40]`,
  the notice board prop is at roughly `spawn + (-118, -22)`).
- Placed automatically by `installTownfolk()` in `src/world/townfolk.js`
  (all `area: 'town'` entries in `src/data/npcs.js`).

## NPC entry shape (`src/data/npcs.js`)

Follows the standard roster schema (`id, name, title, sheet, role, area,
at, face, night, lines`). Sheet `'OldMan'` is an existing validated
`Actor/Character` folder:

```js
{ id: 'housing_steward', name: 'Steward Odo', title: 'Home Steward', sheet: 'OldMan', role: 'quest', area: 'town', at: [-134, -28], face: 'right', night: 'stay',
  lines: ['Your home island awaits across the water, Wayfarer. Say the word and I will send you there.', 'The island grows with you - furniture, trophies, and a daily garden harvest.', 'Reach level 3 and the crossing is yours. The portal remembers your way back.'] },
```

## Interaction (`src/world/townfolk.js`, `finalOptions()`)

One targeted patch: when `n.id === 'housing_steward'`, the final dialog page
offers **"Visit your home island"**, which calls:

```js
scene.scene.start('home', {
  name: scene.pname, hero: scene.heroData, mode: scene.mode,
  returnTo: { name: scene.pname, hero: scene.heroData, mode: scene.mode },
});
```

This matches `HomeIslandScene.init({ name, hero, mode, returnTo })`. The
portal-back button / `H` / `ESC` in the home scene uses `returnTo` to restart
`'world'` with the same payload.

## Unlock rule

- **Requires player level ≥ 3.** Below that, Odo re-opens the dialog with:
  *"The crossing is not ready for you yet - reach level 3 first."*
- **No gold changes hands** (no fee, no minting — nothing to sink).
