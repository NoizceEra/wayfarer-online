# HUD Wiring Notes (polish track)

Targeted wiring of the additive `src/ui/hudPolish.js` helpers into the live
HUD. Only three source files were touched (plus this note); `hudPolish.js`
itself and `main.js` (`injectPolishCss()`) were already in place.

## 1. Escape + explicit close

- `src/ui/econDom.js` — `panel()` keeps its ✕ button (explicit close) and now
  also registers `attachPanelBehavior({ panelEl, onClose, inputManager:
  input, closerId: 'econ-panel-<n>' })`. Escape routes through the
  `core/input.js` closer stack when the manager exists, otherwise a local
  keydown fallback. The returned `detachCloser()` is exposed as an additive
  third field (`{ p, title, detachCloser }`); existing `{ p, title }`
  destructuring is unaffected. No-op when `onClose` is not a function.
- `src/scenes/UIScene.js` — every canvas panel already had an
  `input.addCloser` entry except two: added `minimap-large` (priority 300,
  collapses the enlarged minimap) and `worldboss` (priority 750, hides the
  banner; its ✕ dismiss button stays the explicit close). Economy DOM panels
  are covered by the pre-existing `economy` closer (priority 960) in
  `economyUI.js`, now complemented by the per-panel `econ-panel-<n>`
  registrations above.

## 2. Tab bars: `labelTabs()` + `aria-selected`

- `econDom.js` — `tabs()` sets `role="tablist"` on the bar, calls
  `labelTabs(bar, labels)` after build (sets `role="tab"`, `aria-label`,
  `aria-selected`), and re-syncs `aria-selected` inside `set()`, which
  Mail/Market panels call on every render.
- `socialDom.js` — chat/player-list tab bars are built in `ChatPanel.js` /
  `SocialPanels.js` (out of scope), so `socialRoot()` now sweeps existing
  `.wf-tabs` bars and watches via `MutationObserver` (childList for new bars,
  class-attribute filter for `wf-on` flips, which covers programmatic
  `setTab()`). The filter is class-only and `labelTabs()` never touches
  class, so the observer cannot self-trigger.

## 3. Chat/social DOM readability floors (≤560px `@media` block)

Verified against `POLISH_MIN` in `socialDom.js`'s existing media block:
panel `min(340px, …)` ✓, log `height/min-height: 90px` ✓, log `11px` ✓,
tab buttons `min-width/min-height: 44px` ✓. One fix: chat input was `12px`,
below the 13px floor — bumped to `13px` and extended to `.wf-foot input`
(player-list search). `injectPolishCss()` adds the same floors redundantly.

## 4. Canvas HUD stat-text floors (small screens)

`UIScene.create()` defines `statPx = (small ? max(px, 8) : px)` and routes
the status-panel numbers through it (`hpT`, `mpT`, `xpT`, `goldT`, `potT`,
`atkT`, `defT`). Effective value change: only `xpT` on small screens
(7px → 8px); every other stat was already ≥ 8px, and desktop sizes pass
through `statPx` unchanged, so desktop layout is pixel-identical.

## Regressions to watch

- Extra Escape closers participate in the priority stack: `minimap-large`
  (300) closes before panels; `worldboss` (750) sits below pause-sub (850)
  but above shop/equip — verify Esc ordering with several panels open.
- `econ-panel-<n>` closers call each panel's own `onClose`; if a caller
  destroys the panel node without calling `detachCloser()`, the closer's
  `isOpen` guard (display/hidden/connected) keeps it inert.
- The `socialDom.js` observer re-labels tab buttons on any class flip;
  buttons keep their text content, so no visual change is expected.
