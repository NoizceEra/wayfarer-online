# HUD/UX Improvements — Audit + Polish Plan

Scope: HUD/UX audit of `src/scenes/UIScene.js` (canvas HUD), `src/ui/socialDom.js`
+ `src/ui/econDom.js` (DOM panels), `src/core/input.js` (hotkeys/closers).
No existing files were modified. The additive module `src/ui/hudPolish.js`
exports optional helpers the parent can wire later (see Integration Hooks).

Read against commit workspace Oct 2026. All predicates below are falsifiable:
run the Measure, compare Before → After.

## P0 (ship-blockers)

### P0-1. Economy panels have no Escape / outside-click close path
- File: `src/ui/econDom.js` → `panel()` wires only the ✕ button and
  `pointerdown stopPropagation`. `input.addCloser()` is never called for
  `.ec-panel` instances.
- Predicate: open any `.ec-panel` (`#wf-social .ec-panel`, `display !== 'none'`),
  dispatch `keydown { key: 'Escape' }` on `document`. **Before:** panel stays
  open (`display !== 'none'`). **After (wired):** `display === 'none'`.
- Fix: `attachPanelBehavior({ panelEl, onClose, inputManager: input })` from
  `hudPolish.js` at each `panel()` call site (parent change, not done here).

### P0-2. Mobile chat input is 12px — below the 13px no-zoom floor
- File: `src/ui/socialDom.js` mobile CSS:
  `#wf-social .wf-inrow input{font-size:12px;…}`.
- Predicate: viewport `max-width:560px`, computed style
  `getComputedStyle(document.querySelector('#wf-social .wf-inrow input')).fontSize`.
  **Before:** `12px`. **After:** `>= 13px`.
- Fix: `injectPolishCss()` + `ensureReadableText()` floor inputs to 13px
  (additive override; original rule untouched).

### P0-3. Tab buttons have no selected-state exposed to assistive tech
- File: `src/ui/socialDom.js` + `src/ui/econDom.js` `tabs()`: `button.wf-on`
  class only; no `role=tab` / `aria-selected` / `aria-label`.
- Predicate: `document.querySelectorAll('#wf-social .wf-tabs button[aria-selected="true"]').length`
  with a tab active. **Before:** `0`. **After:** `1` (exactly the active tab).
- Fix: `labelTabs(bar)` from `hudPolish.js` after each `tabs()` build and on
  every `set(id)`.

### P0-4. Canvas HUD stat text is 7–9px — unreadable on phones
- File: `src/scenes/UIScene.js`: `hpT` 9px, `mpT` 8px, `xpT` 7px Silkscreen
  with 3px stroke; `nameT` 10px on `small` screens.
- Predicate: in-game screenshot/text config — `hpT.style.fontSize`.
  **Before:** `9px`. **After:** `>= 11px` on `small` layouts (parent change;
  helper does not restyle canvas text, only DOM).
- Recommendation: bump `F(9…)` → `F(11…)` for hp/mp and xp `7→9px` when
  `this.small`, or add a DOM mirror for screen readers (no canvas aria exists).

### P0-5. Item chips expose no accessible name for icon-only content
- File: `src/ui/econDom.js` `chip()`: `<img … alt="">` + `title=` only;
  `title` is not reliably announced on touch readers.
- Predicate: `document.querySelector('.ec-chip').getAttribute('aria-label')`.
  **Before:** `null`. **After:** non-empty string (item name + rarity).
- Fix: `applyA11y(chipEl, { label: itemTitle(id) })` at chip creation (parent).

## P1 (should-fix soon)

### P1-1. Canvas HUD has zero DOM/aria mirror
- `UIScene` HP/MP/XP/gold/potions/atk/def exist only as Phaser Text.
  Screen readers see nothing.
- Predicate: with HUD visible, count of `#wf-social [aria-label*=Health]`
  (or similar live region). **Before:** `0`. **After:** `>= 1` live region
  updated on stat change (parent wires `HUD_ICONS` metadata + a visually-hidden
  live region).

### P1-2. No visible focus ring on canvas hotbar; DOM focus ring is low-contrast on wood
- DOM `:focus-visible` is `2px #ffe66d` (ok on dark, weak on `#9bbc0f`
  buttons). Canvas hotbar slots have no focus indicator at all.
- Predicate: Tab to a hotbar-adjacent DOM button, computed
  `outlineColor`. **Before:** `#ffe66d`. **After (polish CSS):** `#03E1FF`
  (cyan, passes on both wood and Solana bg).

### P1-3. Zone label + quest tracker can overlap status panel on ≤560px
- `UIScene`: `zoneY = small ? 118 : 14`; status panel is 106 tall at y=8
  (bottom=114) and party line sits ~104–118. 4px clearance at 360px wide.
- Predicate: at 360×640, `questPanel.getBounds()` vs `zoneT` bounds overlap
  area. **Before:** clearance `< 8px`. **After:** `>= 8px` gap or stacked
  layout (parent layout tweak).

### P1-4. Toast/alert stacking has no timeout/queue contract
- `Toast.js` / `WorldBossAlert` / `.ec-toast` (`top:96px`) can overlap the
  zone label and each other; no documented max-visible or dismiss time.
- Predicate: fire 3 toasts, count visible `.wf-toast` after 5s.
  **Before:** indeterminate (all persist / overlap). **After:** `<= 2` visible,
  oldest auto-dismissed (parent policy).

### P1-5. Outside-click shade exists only for the emote wheel
- `.wf-shade` is wheel-only; `.wf-list` and `.ec-panel` trap no outside click
  and have no shade, so mis-taps hit the game canvas behind.
- Predicate: with `.ec-panel` open, `document.querySelector('#wf-social .wf-shade')`.
  **Before:** `null`. **After:** shade present while modal panels open OR
  `closeOnOutsideClick: true` wired (parent choice).

## P2 (nice-to-have)

### P2-1. Required fonts not referenced: Jacquard12 / PixelifySans absent
- All DOM CSS uses `Silkscreen` only; `index.html` font loading for
  Jacquard12/PixelifySans unverified in scope.
- Predicate: `document.fonts.check('12px Jacquard12')`. **Before:** `false`.
  **After:** `true` (parent adds `<link>`/font-face; polish module already
  falls back to Silkscreen).

### P2-2. Palette drift: wood `#2a1d10/#8a5a2b` vs Solana bg `#0A0E1A`
- HUD canvas backing `0x2a1d10`, DOM panels `rgba(26,16,8,.9)` — warm wood,
  not the Solana theme the product targets for new surfaces.
- Predicate: computed `backgroundColor` of `#wf-social .wf-panel`.
  **Before:** `rgba(26, 16, 8, 0.9)`. **After (opt-in):** polish accent class
  or theme var `--wf-bg: #0A0E1A` on new panels (existing panels unchanged).

### P2-3. Canvas tween/pulse animations ignore reduced-motion
- DOM CSS honors `prefers-reduced-motion`; canvas damage vignette / low-HP
  pulse in `UIScene` has no such guard.
- Predicate: with OS reduced-motion on, low-HP pulse amplitude.
  **Before:** `> 0`. **After:** `0` (static vignette; parent change).

## Verified already-OK (no action)
- Mobile chat panel width `min(340px, 100vw-16px)` ≥ 340px ✔
- Mobile log height `90px` + `min-height:90px` ≥ 90px ✔
- Mobile log font `11px` ≥ 11px ✔
- Mobile tab buttons `min 44×44px` ✔ (general buttons too)
- `input.addCloser` Escape-stack exists and `menu` handles topmost-close ✔
  (panels just need to register — P0-1)
- `panel()` already sets `role=dialog` + `aria-labelledby` + close
  `aria-label` ✔

## Integration hooks (parent must add — not done here)
1. `import { polishHud, attachPanelBehavior, injectPolishCss } from '../ui/hudPolish.js'`
   in the social/economy UI bootstrap; call `injectPolishCss()` once at startup.
2. After each `tabs()` build + on `set(id)`: `labelTabs(bar)`.
3. After each `panel()`/`chip()` creation: `attachPanelBehavior({ panelEl: p,
   onClose, inputManager: input })` and `applyA11y(chipEl, { label: itemTitle(id) })`.
4. Optional one-shot pass: `polishHud({ inputManager: input })` returns
   `{ css, tabsLabelled, touchUpgraded, readableFixed, closers }`.
5. Canvas text sizes (`hpT/mpT/xpT`), zone-label layout, toast queue policy,
   live-region mirror, and font `<link>`s are parent edits outside this module.
