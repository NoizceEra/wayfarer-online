# Daily Reward — UX & Input-Safety Notes

## The defect (fixed)

About 1.2 s after a player entered the world, the Daily Reward card auto-opened:

`src/systems/dailyRewards.js` `bootCheck()` → `bus.emit(Events.DAILY_REWARD, { open: true, auto: true })`
→ `UIScene` → `UIScene.openDailyReward()` → `src/ui/DailyRewardPanel.js` shows
`#wf-social .wf-panel.dr-panel`.

That card is a **centred DOM modal** with `pointer-events: auto` (`src/ui/socialDom.js`,
`#wf-social .wf-panel{pointer-events:auto}`). Because `#wf-social` is `position:fixed;inset:0`
at `z-index:20`, the panel sits **over the canvas** and swallows pointer events before Phaser
ever sees them. Phaser processes input top-scene-first and bails on the first capturing scene,
so `WorldScene`'s `pointerdown` handler (the attack / click path) never ran.

Net effect: an **unrequested** auto-open silently disabled all world input (attacks, clicks)
until the player noticed the card and dismissed it. This was **not** a `pointerOnHud()` problem
— that check returned `false` throughout; the DOM overlay never let the event reach Phaser.

## The fix (least-surprising)

The reward feature is kept and stays discoverable; only the *unrequested modal* was removed.

1. `src/systems/dailyRewards.js` — `bootCheck()` no longer emits `{ open: true }`. It emits
   `{ ready: true, auto: true }` instead: the same eligibility decision, announced without
   grabbing the screen.
2. `src/scenes/UIScene.js` — the `DAILY_REWARD` listener treats `ready` as a **non-blocking
   notification**: it resumes the pulsing 🎁 HUD icon and pushes a toast
   ("A daily reward is ready — tap 🎁 to claim"). `open` is still honoured, so any deliberate
   caller can open the panel exactly as before.

Nothing else changed: `DailyRewardPanel.js` and `socialDom.js` are untouched, and the panel's
own `✕` / Esc close behaviour is unchanged.

## How the reward is reached now

- **HUD button**: the 🎁 icon (top-right, `UIScene.buildDailyReward`) opens the card on demand.
  It pulses cyan (`#03e1ff`) whenever a claim is available, and is greyed (`#6b7a99`) otherwise.
- **Toast nudge**: on entry, when a claim is available, a toast points the player at the icon.
- **Claim**: opening the card and pressing **CLAIM** credits gold (+ token points on day 7),
  persists via `WorldScene.saveNow()`, and the button switches to a disabled "ALREADY CLAIMED".

Because the card now only appears when the player asks for it, world input (attacks/clicks) is
available immediately on entering the world.

## Verification (real headless-Chrome runs)

Built to a scratch `outDir`, served with `python -m http.server`, driven by real
`page.mouse.click()` at a fixed viewport point `(640, 360)`; the world's `fireShot`/`attack`
were instrumented to record what real clicks produced.

| Build | Panel state at 1.7 s | 3 real clicks @ (640,360) |
|-------|---------------------|---------------------------|
| before | `.dr-panel` `display:flex`; `elementFromPoint` = `.dr-d < .dr-day < .dr-strip < .dr-body` (panel) | 0 shots, 0 attacks |
| after  | no `.dr-panel`; `elementFromPoint` = canvas | 3/3 attacks, arrows fired at the measured angle/speed |

After the fix the reward was still reachable and claimable via the 🎁 HUD button, and the
login → world flow produced no page errors.
