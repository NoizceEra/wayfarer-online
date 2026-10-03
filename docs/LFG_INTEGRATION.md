# LFG / Dungeon Integration Notes

## Files Added

- `src/data/dungeons.js` — dungeon metadata, mob packs, bosses, loot tables.
- `src/ui/LFGPanel.js` — Phaser LFG panel UI.
- `src/systems/dungeonSystem.js` — client coordinator (local + network stubs).
- `server/dungeonMatch.js` — Colyseus-compatible matchmaking scaffold.

## How to Wire (no TitleScene/WorldScene edits required)

### 1. Open the panel from a HUD icon

In `UIScene.js` or `HUDScene.js`, add an LFG icon next to the wallet icon:

```js
import LFGPanel from '../ui/LFGPanel.js';
import DungeonSystem from '../systems/dungeonSystem.js';

// in create()
const lfgIcon = this.add.text(W - 40, pad + 40, '⚔', { fontSize: '18px', color: '#14f195' })
  .setInteractive({ useHandCursor: true });
this.lfgPanel = new LFGPanel(this, cx, cy);
this.lfgPanel.onQueue = (req) => this.dungeonSystem.queue(req.dungeonId, req.role, req.groupMode);
this.lfgPanel.onAccept = (dungeonId) => this.dungeonSystem.acceptMatch();
this.dungeonSystem = new DungeonSystem(this.scene.get('GameScene'), /* net */ null);
this.dungeonSystem.on('dungeon:matchReady', () => this.lfgPanel.markReady());
lfgIcon.on('pointerdown', () => this.lfgPanel.open());
```

### 2. Server wiring

Inside your Colyseus room module (e.g. `server/rooms/wayfarer.js`):

```js
const { createMatchmaker } = require('../dungeonMatch.js');
const dungeonMatchmaker = createMatchmaker();

onCreate(options) {
  dungeonMatchmaker.bindToRoom(this);
}
```

### 3. Running the dungeon

`DungeonSystem` can generate local waves for prototyping:

```js
const run = this.dungeonSystem.startLocal('ruins_of_nebula', 1);
this.dungeonSystem.on('dungeon:waveStart', ({ wave }) => { /* spawn wave */ });
this.dungeonSystem.on('dungeon:complete', ({ rewards }) => { /* reward player */ });
```

## Design Decisions

- Uses Solana palette (`#14f195`, `#9945ff`, `#03e1ff`, `#dc1fff`) and panel opacity `0.55`.
- Uses pixel font fallbacks: `Jacquard12`, `Silkscreen`, `PixelifySans` with `Courier New` fallback.
- No on-chain code; gold and token rewards are off-chain/server-authoritative.
- `DungeonSystem` is network-optional: pass a `net` object with `send`/`on` to enable server queues, or use `startLocal()` for instant solo runs.
- Three dungeons with ascending level/difficulty: `ruins_of_nebula` (5), `solar_forge` (12), `vault_of_shadows` (18).

## Verification

```bash
node --check src/data/dungeons.js
node --check src/ui/LFGPanel.js
node --check src/systems/dungeonSystem.js
node --check server/dungeonMatch.js
```
