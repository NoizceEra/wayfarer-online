# Controls & Slash Commands UX

In-game discoverability for Wayfarer Online. A new player must be able to answer
*"what are the controls, and what can I do here?"* without leaving the game.

Owner surface (this doc + implementation): `src/ui/HelpOverlay.js`, `src/ui/PauseMenu.js`.
Read-only sources of truth for the lists below: `src/core/input.js`,
`src/scenes/UIScene.js`, `src/systems/social/index.js`, `src/ui/economyUI.js`.

## How to open the reference

| Entry point | Source |
|---|---|
| `H` / `F1` keyboard | `src/core/input.js:53` (`help` action) → `src/scenes/UIScene.js:348` |
| `?` HUD button (touch) | `src/scenes/UIScene.js:406` |
| Pause menu → **Controls & commands [H]** | `src/ui/PauseMenu.js:105` |
| Gamepad `START` → Pause → Help | `src/core/input.js:69` (PAD menu) |

The overlay has two tabs: **CONTROLS** (live from the input registry) and
**COMMANDS** (slash commands). Closing follows the shared panel pattern:
**Esc** (registered as an `input.addCloser`, `src/scenes/UIScene.js:334`),
the **X** button, or a **click outside** the panel (the dim layer's
`pointerdown`). `H`/`F1` toggles it. Opening pushes the `help` modal so
gameplay input is blocked; keys are changed in **Pause → Controls** (rebind
page lives in `PauseMenu.buildControls`, `src/ui/PauseMenu.js:175`).

## Controls (grouped) — extracted keybinds

Every row below is produced at runtime from the input registry (`input.list()`),
so rebinds and actions registered by other modules appear automatically. The
group fence comes from each action's `group` field; the overlay orders them
Movement → Combat / Skills → World → Panels → Social → System.

### Movement — `src/core/input.js`
| Action | Default keys | Line |
|---|---|---|
| Move up | `W` / `↑` | 32 |
| Move down | `S` / `↓` | 33 |
| Move left | `A` / `←` | 34 |
| Move right | `D` / `→` | 35 |

### Combat / Skills
| Action | Default keys | Line |
|---|---|---|
| Attack | `J` (also left-click) | `src/core/input.js:36` |
| Skill 1–4 | `1` `2` `3` `4` | `src/core/input.js:37-40` |
| Skill 5 (class) | `5` | `src/core/input.js:41` |
| Skill 6 (class) | `6` | `src/core/input.js:42` |
| Drink potion | `Q` | `src/core/input.js:43` |
| Dodge roll | `Shift` (L/R) | `src/systems/combat.js:71` |
| Cycle target | `Tab` | `src/systems/combat.js:72` |
| Eat food / potion | `F` | `src/world/townfolk.js:141` |
| Read scroll | `Y` | `src/world/townfolk.js:142` |

### World
| Action | Default keys | Line |
|---|---|---|
| Talk / use | `E` | `src/core/input.js:44` |
| Confirm dialog | `Space` | `src/core/input.js:45` |
| Close map / dialog | `X` | `src/core/input.js:46` |

### Panels
| Action | Default keys | Line |
|---|---|---|
| Bag / equipment (inventory) | `I` / `B` | `src/core/input.js:47` |
| Character | `C` | `src/core/input.js:48` |
| Skills | `K` | `src/core/input.js:49` |
| World map | `N` | `src/core/input.js:50` |
| Minimap size | `M` | `src/core/input.js:51` |
| Chat | `Enter` | `src/core/input.js:52` |
| Quest journal | `L` | `src/scenes/UIScene.js:807` |
| Crafting | `U` | `src/scenes/UIScene.js:808` |
| **Skill tree / spec** | `T` | `src/scenes/UIScene.js:809` |

### Social
| Action | Default keys | Line |
|---|---|---|
| Party panel | `P` | `src/ui/socialUI.js:36` |
| Players / friends | `O` | `src/ui/socialUI.js:37` |
| Emote wheel | `G` | `src/ui/socialUI.js:38` |
| Pet panel | `\` (Backslash) | `src/ui/socialUI.js:39` |
| Mailbox | `V` | `src/ui/economyUI.js:55` |

### System
| Action | Default keys | Line |
|---|---|---|
| Help / hotkeys | `H` / `F1` | `src/core/input.js:53` |
| Close / pause menu | `Esc` (reserved, cannot be rebound) | `src/core/input.js:54` |
| Mute sound | *(unbound)* | `src/core/input.js:55` |
| Zoom in | `=` / `Num+` | `src/core/input.js:56` |
| Zoom out | `-` / `Num-` | `src/core/input.js:57` |
| Zoom: auto fit | `0` / `Num0` | `src/core/input.js:58` |

Settings itself has **no hotkey** — open it via `Esc` → *Settings*.
Leaderboard and the economy panels are reached by slash command (below) or the
market-board clerks; they have no dedicated key.

### Gamepad (fixed, `src/core/input.js:62-70`) and Touch
Gamepad: L-stick/D-pad move · A attack · X talk/use · Y potion · LB/RB/LT/RT
skills 1–4 · L3/R3 skills 5–6 · SELECT bag · START menu · B back/close.
Touch: left-stick move · tap HUD hotbar for attack/skills · X button interact ·
CHAR/SKILL/MAP/BAG buttons for panels · ENTER/`II`/`?` for chat/menu/help.

## Slash commands (type in chat, opened with `Enter`)

Source: the dispatch switch in `src/systems/social/index.js:505-557` and the
economy wrapper in `src/ui/economyUI.js:136-221`.

**Chat / channels** — `/say` `/s`, `/party` `/p`, `/world` `/y` `/yell`
`/global`, `/guild` `/g`, `/w` `/whisper` `/tell` `/msg <name> <msg>`,
`/r` `/reply <msg>`, `/me <text>`, `/emote` `/e <id>` (emote ids also work bare),
`/who` `/online` `/players`.

**Party** — `/invite` `/inv <name>`, `/accept` `/join`, `/decline`, `/leave`,
`/kick <name>`, `/promote` `/lead <name>`.

**Friends / ignore** — `/friend` `/addfriend <name>`, `/unfriend <name>`,
`/friends`, `/ignore <name>`, `/unignore <name>`.

**Trade** — `/trade` `/tr <name>` (+ `accept|decline|cancel`), `/escrow`
`/esc <name>` (+ `accept|decline|cancel`), `/gift` `/give <name> [gold]`.

**Duels / arena** — `/duel` `/dt <name>`, `/dtaccept`, `/dtdecline`, `/dtend`
`/yield`, `/petduel` `/pd <name>`, `/pda`, `/pdd`, `/arena` `/aq [name|leave]`,
`/aqaccept`, `/aqdecline`.

**Guilds** — `/gcreate <TAG> <name>`, `/gjoin <TAG>`, `/gleave`, `/ginvite <name>`,
`/gaccept`, `/gdecline`, `/gkick <name>`, `/gpromote <name>`, `/gdemote <name>`,
`/gleader <name>`, `/gmotd <text>`, `/gdeposit <gold>`, `/gwithdraw <gold>`,
`/ginfo` `/guildinfo`.

**Economy / panels** — `/mail` `/mailbox [name]`, `/claim`, `/sinks`
`/tokensinks`, `/bridge` `/tokenbridge`, `/refer` `/referral`, `/finder`
`/partyfinder`, `/lfg` `/dungeon`, `/season` `/pass`, `/guild`, `/leaderboard`
`/lb`, `/market` `/ah` `/auction`, `/boss` (`/boss tp` teleports), `/pets` `/pet`,
`/petbattle` `/pvb`, `/home`.

**Misc** — `/roll [n]`, `/filter`, `/time` `/timestamps`, `/clear`, `/help` `/?`.

The overlay's COMMANDS tab lists each of these with a one-line description and
paginates (see below).

## Mobile-safe behaviour (<=560px)

The overlay is a Phaser canvas panel, so it mirrors the *behaviour* of
`src/ui/socialDom.js`'s `@media (max-width:560px)` rules (single column, larger
tap targets) rather than its CSS:

- **Single column** at `pw < 560` (controls) / `pw < 600` (commands); two
  columns otherwise (`HelpOverlay.buildControls` / `buildCommands`).
- **Pagination** when rows exceed the panel: a `◀ PREV` / `NEXT ▶` chip pair and
  an `n / m` counter appear in the footer. Chips are 80x18 canvas hit areas.
  This is the same paginate-when-it-doesn't-fit approach as the pause menu's
  rebind page (`src/ui/PauseMenu.js:185-208`).
- **Wheel** pages the list on desktop; touch uses the chips.
- The panel is capped at `min(viewport-12, 660x470)` and always centred, so it
  never overflows the smallest supported layout.

## First-run nudge

`OnboardingHint` (`src/ui/OnboardingHint.js`, steps defined in
`src/systems/onboarding.js:8-13`) covers **Move / Strike / Slay / Notice Board**
only — it never points at the help reference or chat commands. A minimal,
non-duplicating nudge was therefore added: the first time the overlay is ever
opened it shows a one-line tip strip ("NEW · every key, plus chat commands that
start with /"), gated once by `localStorage['wayfarer.help.seen.v1']`. It does
not repeat the movement/attack steps the onboarding card already teaches.

> Constraint: a *spawn-time* nudge ("press H for controls") would belong in
> `systems/onboarding.js` STEPS, which is outside this track's file ownership.
> Recommend adding a `help` step there in the onboarding track.

## Known discrepancies (flagged, not invented)

- `src/systems/onboarding.js:127` tells the player they "can restart with
  `/tutorial`", but **no `/tutorial` case exists** in either command switch —
  that command does not work. Either implement it (social or onboarding track)
  or fix the toast text.
- `/market` (`economyUI.js:150`) is informational only — the market board is an
  NPC interaction, not a panel. Keep it described as "where to find it".
