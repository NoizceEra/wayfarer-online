# Mobile UX Integration Notes

## Files Added / Modified

- `src/core/input.js` — New virtual joystick + action button input manager (`MobileInput`, `isMobile`).
- `src/scenes/UIScene.js` — New mobile-only overlay scene with joystick, action buttons, chat toggle, and orientation hint.
- `src/ui/socialDom.js` — New DOM-based chat/social panel with large mobile touch targets.
- `docs/MOBILE_INTEGRATION.md` — This file.

## What Changed

### Larger touch targets
- Chat toggle button in `UIScene.js` is 56 px (72 px hit area).
- Chat close, send, and message rows in `socialDom.js` are at least 44 px tall; on screens ≤640 px they scale to 52–56 px.
- Action buttons in `MobileInput` default to 72 px with a 1.4× invisible hit zone.

### On-screen action buttons
- `MobileInput.createActionButtons()` adds:
  - **Attack** (⚔) — bottom-right cluster.
  - **Interact** (✋) — above the attack button.
  - **Dodge / roll** (↷) — quick dash when pressed.
- Button visuals follow the Solana pixel palette.

### Virtual joystick refinements
- Configurable deadzone (default 22 % radius) with scaled re-normalization.
- Joystick re-centers on first touch and stays within a 3.5× capture zone.
- Knob alpha / position reset on release.

### Orientation lock hints
- `UIScene.js` displays a centered hint when the device is in portrait.
- Hint is hidden automatically when the device rotates to landscape.

## Wiring

`TitleScene.js`, `GameScene.js`, and `HUDScene.js` were not modified. To activate the mobile overlay, register `UIScene` in `src/main.js`:

```js
import UIScene from './scenes/UIScene.js';

const config = {
  scene: [TitleScene, GameScene, HUDScene, UIScene],
  // ...
};
```

`UIScene` automatically detects mobile via `isMobile()` and only renders controls when touch / mobile UA is detected. On desktop it runs as an empty scene.

## Verification

Run syntax checks on the modified files:

```bash
node --check src/core/input.js
node --check src/scenes/UIScene.js
node --check src/ui/socialDom.js
```

`npm run build` is not required to finish, but the existing Vite build remains unaffected because these new files are not imported by the unchanged scene list.
