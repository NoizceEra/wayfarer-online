# Season Pass Integration Notes

## Overview

A 50-tier season pass with free and premium reward tracks. Players earn season
XP from daily login, kills, quests, dungeon clears, and PvP duels. Premium
upgrades cost a one-time gold fee. Daily and per-source XP caps resist bot
farming.

## Files Added

- `src/data/seasons.js` — 50-tier reward table, XP sources, caps, and helpers.
- `src/systems/seasonSystem.js` — Client coordinator (state, events, net bridge).
- `src/net/seasonNet.js` — Client network layer for season messages.
- `src/ui/SeasonPanel.js` — Phaser season pass UI panel.
- `server/season.js` — Authoritative XP ledger, caps, claiming, premium upgrade.
- `docs/SEASON_INTEGRATION.md` — This file.

## Reward Types

- Gold
- Token points
- Premium revive tokens
- Pet rename tags
- Stash expanders
- Cosmetics (cape, halo, weapon FX, aura, trail, title)

## XP Sources and Daily Caps

| Source | Base XP | Daily Cap |
|---|---|---|
| Daily login | 500 | 500 |
| Monster kill | 25 | 2,000 |
| Quest complete | 400 | 3,000 |
| Dungeon clear | 1,200 | 2,400 |
| PvP duel | 300 | 1,500 |

**Total daily XP cap:** 6,500

## Premium Upgrade

- Cost: `2,500` gold (one-time)
- Stored in `SEASON_CONFIG.premiumCostGold`
- Server verifies balance and deducts gold before flagging the account

## Server Wiring

In the Colyseus room module (e.g. `server/rooms/wayfarer.js`):

```js
import { SeasonService } from '../season.js';

const seasonService = new SeasonService({
  getPlayerGold: (playerId) => getGold(playerId),
  deductPlayerGold: (playerId, amount) => spendGold(playerId, amount),
  awardReward: (playerId, reward) => deliverReward(playerId, reward),
});

onCreate(options) {
  seasonService.bindToRoom(this);
}
```

### Restoring progress on reconnect

Load saved season state when a client joins:

```js
onJoin(client, options) {
  const saved = loadSeason(client.sessionId);
  seasonService.loadPlayerState(client.sessionId, saved);
  client.send('season:state', seasonService.getState(client.sessionId));
}
```

## Client Wiring

In `HUDScene.js` or `UIScene.js`:

```js
import SeasonSystem from '../systems/seasonSystem.js';
import SeasonPanel from '../ui/SeasonPanel.js';

// In create()
const seasonIcon = this.add.text(W - 68, pad, '🏆', { fontSize: '18px', color: '#14f195' })
  .setInteractive({ useHandCursor: true });

this.seasonSystem = new SeasonSystem(this, { send, onBroadcast });
this.seasonPanel = new SeasonPanel(this, cx, cy, {
  seasonSystem: this.seasonSystem,
  onClaim: (tier, track) => this.seasonSystem.claim(tier, track),
  onUpgrade: () => this.seasonSystem.upgradePremium(),
});

seasonIcon.on('pointerdown', () => this.seasonPanel.open());
```

### Reporting XP from gameplay

Call the coordinator when relevant events occur:

```js
this.seasonSystem.earnXp('dailyLogin', 500);
this.seasonSystem.earnXp('kill', 25);
this.seasonSystem.earnXp('quest', 400);
this.seasonSystem.earnXp('dungeonClear', 1200);
this.seasonSystem.earnXp('pvpDuel', 300);
```

The client sends the request; the server clamps against caps and returns the
actual granted amount.

## Anti-Farm Rules

- **Daily XP cap:** 6,500 XP per calendar day (UTC).
- **Per-source caps:** Each source has its own cap (see table above).
- **Server-authoritative:** All XP, tier, and claim state is tracked server-side.
- **Calendar rollover:** On a new UTC day, daily and source counters reset.

## Verification

```bash
node --check src/data/seasons.js
node --check src/systems/seasonSystem.js
node --check src/net/seasonNet.js
node --check src/ui/SeasonPanel.js
node --check server/season.js
```

## Notes

- No `TitleScene.js` or `GameScene.js` / `WorldScene.js` files are modified by
  this feature. Wire it through `HUDScene.js` / `UIScene.js` instead.
- Cosmetic rewards are IDs only; the rendering layer should map each cosmetic
  ID to an in-game visual when assets are available.
- Reward delivery uses the `awardReward` callback so the economy/save layer
  decides how gold, tokens, items, and cosmetics are persisted.
