# HUD Combat Feedback (combat-readability track)

Improves **combat readability on the player HUD**: skill-bar cooldown / MP
failures, low HP/MP warnings, and always-visible status/buff indicators.

Two files carry the change plus this note:

| File | Change |
| --- | --- |
| `src/systems/hudIcons.js` | +9 procedural glyphs (`burn slow stun poison bleed shieldUp boost noMp ready`) drawn in the Solana palette, plus the Solana palette keys and two id→icon maps. |
| `src/ui/hudPolish.js` | New **COMBAT READABILITY** section: pure decision helpers + a no-op-tolerant Phaser overlay controller. |
| `docs/HUD_COMBAT_FEEDBACK.md` | This note. |

Nothing else was touched — `UIScene.js`, `CombatHudScene.js`, `status.js`,
`settings.js`, `events.js`, `advSkillBar.js` and every other file are unchanged.
The track is **additive**: the host wires the controller in (below) when ready.

## Colour + font rules

Only the project's Solana palette is used for new UI:
green `#14F195`, purple `#9945FF`, cyan `#03E1FF`, magenta `#DC1FFF`,
white `#E1E8F0`, muted `#6B7A99`, bg `#0A0E1A`. The icons add matching
`sol*` keys to `HUD_PAL` (existing icons keep their old palette untouched);
`POLISH_PALETTE` already held the same values. Text uses `POLISH_FONTS.label`
(Silkscreen) for the `MP` badge / status glyphs where the labels must read, and
`POLISH_FONTS.body` (PixelifySans) is available for numbers.

## 1. Skill-bar cooldown + MP-failure clarity

- **Sources (no new state store):** `player.cooldowns[ab.id]` +
  `player.skillCd(ab)` + `player.skillLv(ab.id)` (exactly what `UIScene.update()`
  already reads), and the ability's `fx.mp` cost vs `player.mp` — the same gate
  `skillFx.castFx` uses for its `"Not enough MP!"` message.
- `skillSlotState(player, ab, now)` is pure and returns
  `{ learned, cooldown, remain, total, mpCost, canAfford, ready, brake }`.
  `brake === true` means **off cooldown but unaffordable** — the state the
  existing HUD could not show.
- The existing cooldown sweep (`cdBg`/`cdT`) is **left to the host** — this
  track does not duplicate it; it adds the two states that were missing:
  - **not-enough-MP affordance** — a magenta translucent slot overlay + `MP`
    badge (pulses; steady under `reduceMotion`) whenever `brake` is true.
  - **ready flash** — a green edge flash for `COMBAT_READ.readyFlashMs` when a
    slot comes off cooldown, and again on `Events.SKILL_CAST` for the cast slot.
    Skipped entirely under `reduceMotion`.
- `HUD_FEEDBACK_ICON = { noMp:'noMp', ready:'ready' }` exposes the new glyphs
  (`hud.noMp` = cyan mana droplet slashed magenta, `hud.ready` = green chevrons)
  if the host prefers an icon over the text badge.

> SP is a *purchase* currency (`skillPoints`), not a cast cost — abilities cost
> MP only (`fx.mp`). The "not enough MP/SP" affordance therefore covers MP.

## 2. Low-resource warnings (HP ≤ 25%, MP ≤ 15%)

- `lowResourceState({hp,maxHp,mp,maxMp,dead})` → `{ hpFrac, mpFrac, lowHp, lowMp }`.
  Dead suppresses both. Thresholds live in `COMBAT_READ` (`lowHpFrac: .25`,
  `lowMpFrac: .15`).
- The controller draws a 2px frame around the HP bar (magenta) and MP bar
  (cyan) that is visible **only** while low, so it never adds chrome in normal
  play. Frame geometry is read from the existing bar rectangles
  (`bar.x/y/width/height`), so it tracks the host's layout.
- `pulseAlpha(now, { reduceMotion, isMobile })` is pure:
  - `reduceMotion` → **steady** at `warnAlpha` (0.9), no animation.
  - `isMobile` (pass `CONFIG.isMobile`) → slower (1.6× period), gentler swing
    (0.55–0.9) so it reads on touch without nagging.
  - desktop → 0.28–0.9 sine over 1 s.
- HP/MP numbers are taken from the last **`Events.PLAYER_HP`** payload (the same
  event `UIScene.drawStatus` consumes), falling back to `player.hp/mp`.

## 3. On-HUD status / buff indicators

- Driven by the existing status system: `combat.statuses.list(now)` returns
  `[{ id, left, frac }]` (see `systems/status.js`). `statusIndicators(list)`
  maps each to a Solana-coloured square that **drains top-down** with the
  remaining seconds underneath — `burn`/`slow`/`stun`/`poison`/`bleed` show
  without opening any panel.
- `playerIndicators(player, now)` adds the two buff sources that a StatusSet
  does not hold: **Shield** from `player.invulnUntil` (Ward) and **Buff** from
  `player.buff` (empower) — both purple/green so they read as *positive*.
- Up to `COMBAT_READ.maxStatus` (6) squares are shown; each uses the matching
  `hud.<id>` texture when present and falls back to a bold glyph (`P/B/b/S/*/D/+`)
  when it is not, so the strip works even before `makeHudIcons()` has run.

The new glyphs are produced automatically: `makeHudIcons(scene)` iterates the
whole `ICONS` map, so `hud.burn`, `hud.slow`, `hud.stun`, `hud.poison`,
`hud.bleed`, `hud.shieldUp`, `hud.boost`, `hud.noMp`, `hud.ready` are created
whenever the HUD builds its icons (it already does, in `UIScene.create()`).

## Integration hooks (host — not done here)

Add **after** `UIScene` builds the hotbar (icons + bars exist):

```js
import { createCombatReadability } from '../ui/hudPolish.js';
import { CONFIG } from '../config.js';

// in create():
this.combatRead = createCombatReadability(this, {
  slots: this.hotbar,                       // {s:{ab}, bg, bw, bh} records
  getPlayer: () => this.world()?.player,
  hpBar: this.hpBar, mpBar: this.mpBar,     // origin-0 rectangles
  small: this.small,
  isMobile: CONFIG.isMobile,
  statusList: () => this.world()?.combat?.statuses?.list(this.world()?.time?.now ?? 0) || [],
  anchor: { x: 18, y: this.small ? 150 : 128 },   // status strip top-left
});
this.events.once('shutdown', () => this.combatRead.destroy());   // cleanup

// in update():
this.combatRead.update();
```

- `getNow` defaults to `scene.time.now`; set it to `world.time.now` if the two
  clocks ever diverge (cooldowns are stamped with `world.time.now`).
- `reduceMotion` defaults to `settings.get('reduceMotion')` and is re-read every
  frame, so the pause-menu toggle takes effect live without re-wiring.
- `isMobile` is **not** imported (importing `config.js` uses `import.meta.env`,
  which breaks plain-node tests); pass `CONFIG.isMobile` in, or omit it for the
  built-in coarse-pointer/`<620px` fallback (identical logic to `config.js`).

## Cleanup / no-op safety

- `createCombatReadability(null)` / any scene without `add.rectangle` returns a
  controller whose `update`/`destroy` are no-ops (`ready: false`).
- Every Phaser object it creates is tracked in `made` and destroyed by
  `destroy()`; every bus subscription (`SKILL_CAST`, `PLAYER_HP`,
  `PLAYER_DIED`) is detached by `off()` in `destroy()`. `destroy()` is
  idempotent — safe to call from `scene.events.once('shutdown', …)`.
- Every sub-section is individually `try/catch`-guarded, so a missing
  text/graphics renderer degrades one feature instead of throwing.

## Verification (falsifiable)

1. `node --check src/systems/hudIcons.js` → exit 0;
   `node --check src/ui/hudPolish.js` → exit 0.
2. Event names — every subscribed event exists in `src/core/events.js`:
   `SKILL_CAST: 'skill-cast'` (L47), `PLAYER_HP: 'player-hp'` (L5),
   `PLAYER_DIED: 'player-died'` (L38).
3. Pure helpers — a node smoke test imports both modules and asserts:
   - an unaffordable, off-cooldown skill yields `brake: true`, `ready: false`;
   - `lowResourceState` flags exactly ≤25% HP / ≤15% MP and suppresses on death;
   - `pulseAlpha` is steady under `reduceMotion`;
   - `statusIndicators` uses the Solana colours and `hud.<id>` keys, unknown ids
     fall back to muted;
   - the fake-scene controller builds, updates and `destroy()`s without error.
   Result: **55 passed, 0 failed**.
4. Expected visible change (once wired): a magenta `MP` badge on a skill whose
   cooldown finished but MP is short; a green flash when a skill recharges; a
   magenta/cyan frame pulse on the HP/MP bar when low; coloured status squares
   with countdowns beside the status panel.
