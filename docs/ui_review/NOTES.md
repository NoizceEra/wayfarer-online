# UI review notes

Contact sheets (each tile is labelled with the screen name): `before-*.png` is master 61b786e, `after-390x844.png` is this branch.
Regenerate with `node tools/ui_review.mjs --url <preview> --size WxH [--canvas] --out <dir>` (45 screens per run).

## Findings (before) and fixes

- Phone HUD collided: pause/help buttons sat on the status panel name, quest/zone/party/shortcut rows overlapped, buff row and party frames shared a y, event ticker and boss bar covered the stat rows. Fixed with `src/ui/hudLayout.js` (zones plus one shared top-centre stack: hint, banner, events, boss, target).
- Onboarding hint was clipped off-screen (world-camera zoom maths) and used navy/purple. Now on the HUD grid, olive/gold.
- 9 emoji pills at fixed y=72 overlapped the quest panel when it grew, and rendered differently per OS. Now 28px icon pills (hudIcons `menu*` glyphs), row under the quest panel, vertical rail on phones, with a hover/tap label.
- Solana navy/teal/purple panels (spec tree, arena, LFG, season, guild, wallet, daily reward, party finder, referral, help, revive, title) remapped to the wood palette. The spec tree overflowed at 390 and 844x390 and now fits.
- Toasts were canvas objects under DOM panels. Now a DOM layer at z-index 90 with aria-live.
- Contrast: dim text #8a7a60 (4.5:1) and #6b7a99 (4.3:1) raised to #a89a7e (6.8:1). Text under 9px (10px on phones) is floored by a MutationObserver in theme.js.
- Focus ring: one cream ring with an ink halo, visible on olive buttons and on dark panels.
- Modals above panels: pause and help hide DOM panels (`#wf-social.wf-dimmed`). DOM panels get an explicit z contract.
- Reduce motion now also covers the onboarding pulse, the daily gift pulse, the badge pulses, the minimap blink, DOM animations and the trailer video. The default follows `prefers-reduced-motion`. New `largeText` setting (DOM panels 1.2x).
- Colour is no longer the only cue: the daily gift badge is a gold dot with "!", badge toasts carry a star, and `RARITY_CUE` in theme.js has glyph+label per rarity.

## Not done / known

- Title: only re-coloured (trailer contrast, autoplay-blocked and data-saver fallbacks not yet reworked).
- Pause settings has no UI toggle for `largeText` (setting exists).
- The EventHud boss bar and big "WORLD BOSS" banner still draw above open panels (separate scenes).
- 1920x1080 and `?renderer=canvas` captures: harness runs, but only the before sets at 1280x720, 844x390 and 390x844 (WebGL) are in the sheets.
