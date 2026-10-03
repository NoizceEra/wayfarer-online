# Guild Progression & Guild Hall Integration Notes

## Overview

This adds real guild progression to Wayfarer Online: ranks, permissions,
guild EXP/levels, a gold treasury, contribution limits, and member perks that
boost token-point earning, reduce market fees, and increase daily gold
rewards. A new instanced `GuildHallScene` provides a visual hall and a daily
bonus claim.

All costs are in gold only. No crypto is used for guild actions.

## Files Added

- `src/data/guilds.cjs` — Guild data model: ranks, permissions, EXP curve,
  upgrade costs, treasury helpers, and the three perks. `.cjs` because the
  package is `"type": "module"` and server code uses CommonJS.
- `src/net/guildNet.js` — Client network layer for guild messages.
- `src/systems/guildSystem.js` — Client coordinator that wires `GuildNet` to the
  save/registry and exposes `applyTokenPoints`, `applyMarketFee`,
  `applyDailyGold`.
- `src/ui/GuildPanel.js` — Thin orchestrator for guild UI sub-pages.
- `src/ui/guild/*.js` — Split guild panel pages (home, members, upgrades,
  create, base helpers) to keep each file under 10KB.
- `src/scenes/GuildHallScene.js` — Instanced guild hall scene scaffold.
- `server/guild/guildCore.cjs`, `server/guild/guildAuth.cjs`,
  `server/guild/guildService.cjs`, `server/guilds.cjs` — Server-side guild
  handlers.
- `docs/GUILD_INTEGRATION.md` — This file.

## Data Model

### Ranks & Permissions

| Rank | Permissions |
|---|---|
| `member` | none |
| `officer` | invite, kick, promote, demote, edit MOTD |
| `leader` | all (invite, kick, promote, demote, edit MOTD, upgrade hall, manage treasury) |

### Levels & Treasury

- Max guild level: **10**.
- Level upgrade cost: `1000 * (level + 1)^1.6` gold from treasury.
- EXP curve: `500 * (level - 1)^1.8`.
- Members can contribute personal gold to guild EXP/treasury (daily cap
  **5,000** gold per member, 1 EXP per gold).

### Perks

| Perk | Lv.1 | Lv.2 | Lv.3 |
|---|---|---|---|
| Token Insight | +2% token points | +5% token points | +10% token points |
| Merchant License | -10% market fee | -20% market fee | -30% market fee |
| Coffers | +5% daily gold | +10% daily gold | +15% daily gold |

Perk upgrade costs scale by level from the treasury.

## Client/Server Message Contract

| Type | Direction | Payload | Purpose |
|---|---|---|---|
| `guild:create` | C→S | `{ name, tag }` | Create a guild (costs 2,000 player gold) |
| `guild:leave` | C→S | `{}` | Leave current guild |
| `guild:invite` | C→S | `{ playerId }` | Invite a player (officer+) |
| `guild:acceptInvite` | C→S | `{ guildId }` | Accept a pending invite |
| `guild:declineInvite` | C→S | `{ guildId }` | Decline a pending invite |
| `guild:promote` | C→S | `{ playerId }` | Promote member to officer (leader) |
| `guild:demote` | C→S | `{ playerId }` | Demote officer to member (leader) |
| `guild:kick` | C→S | `{ playerId }` | Remove a member (officer+, with rank checks) |
| `guild:upgradeLevel` | C→S | `{}` | Upgrade guild level from treasury |
| `guild:upgradePerk` | C→S | `{ perkId }` | Upgrade a perk from treasury |
| `guild:contribute` | C→S | `{ amount }` | Donate personal gold to guild |
| `guild:state` | S→C | `{ guildId, guild }` | Full guild snapshot |
| `guild:created` | S→C | `{ guild }` | Ack creation |
| `guild:joined` | S→C | `{ guild }` | Ack join |
| `guild:left` | S→C | `{ guildId }` | Ack leave |
| `guild:invite` | S→C | `{ guildId, guildName, from }` | Incoming invite |
| `guild:inviteSent` | S→C | `{ targetId }` | Ack outgoing invite |
| `guild:inviteAccepted` | S→C | `{ guildId }` | Ack invite accept |
| `guild:memberUpdated` | S→C | `{ guildId, playerId, member }` | Member meta changed |
| `guild:memberRemoved` | S→C | `{ guildId, playerId }` | Member removed |
| `guild:promoted` | S→C | `{ guildId, rank }` | Self promoted |
| `guild:demoted` | S→C | `{ guildId, rank }` | Self demoted |
| `guild:upgraded` | S→C | `{ guild }` | Guild level increased |
| `guild:perkUpgraded` | S→C | `{ guildId, perkId, level }` | Perk increased |
| `guild:contributed` | S→C | `{ guildId, playerId, amount, guild, member }` | Contribution ack |
| `guild:error` | S→C | `{ type, message }` | Error response |

## Integration Steps

### 1. Register `GuildHallScene` in `main.js`

```js
import GuildHallScene from './scenes/GuildHallScene.js';

const config = {
  // ... existing config
  scene: [TitleScene, GameScene, HUDScene, GuildHallScene],
};
```

### 2. Add GuildSystem to `HUDScene` (or `UIScene`)

```js
import GuildSystem from '../systems/guildSystem.js';
import GuildPanel from '../ui/GuildPanel.js';

// In create()
this.guildSystem = new GuildSystem(this, { send, onBroadcast });
this.guildPanel = new GuildPanel(this, cx, cy, this.guildSystem);

// Optional HUD icon
const guildIcon = this.add.text(W - 40, pad + 70, '⚔', { fontSize: '18px', color: '#14F195' })
  .setInteractive({ useHandCursor: true });
guildIcon.on('pointerdown', () => this.guildPanel.open());
```

### 3. Wire server handlers in your Colyseus room

```js
const { GuildService } = require('./guilds.cjs');

onCreate(options) {
  this.guildService = new GuildService({
    broadcast: (type, payload) => this.broadcast(type, payload),
    sendTo: (playerId, type, payload) => {
      const client = this.clients.find((c) => c.sessionId === playerId);
      if (client) client.send(type, payload);
    },
    deductGold: (playerId, amount) => {
      // Return true if the player has enough personal gold.
      return this.economy.spend(playerId, 'gold', amount);
    },
  });
  this.guildService.bindToRoom(this);
}
```

### 4. Apply guild bonuses in economy code

Wherever token points, market fees, or daily gold are calculated, call:

```js
const finalTokens = guildSystem.applyTokenPoints(baseTokens);
const finalFee = guildSystem.applyMarketFee(baseFeeRate);
const finalDailyGold = guildSystem.applyDailyGold(baseGold);
```

## Guild Hall Scene

`GuildHallScene` is launched from `GuildPanel` via `ENTER GUILD HALL` or `HALL`.
It receives `guildSystem` in `init()` and renders:

- A guild crest placeholder colored by the Solana palette.
- Guild name, tag, and hall level.
- Three perk pedestals showing current perk levels.
- A **CLAIM DAILY GUILD BONUS** button (currently local; wire to server economy
  for persistence).
- An **ESC** shortcut to return to the world.

The scene does not modify `TitleScene.js` or `GameScene.js` directly.

## Design Decisions

- Gold-only economy for guild actions keeps guild progression off-chain and
  server-authoritative.
- The client computes bonus values from the guild snapshot; the server remains
  the source of truth for contributions and upgrades.
- `GuildSystem` persists a minimal guild summary to the game save so the UI can
  show tag/perks quickly on reload, but the authoritative state comes from the
  server.
- Perks are capped at level 3; guild level is capped at 10.
- Contribution cap prevents a single wealthy player from maxing a guild in one
  day.

## Verification

Run syntax checks on the new files:

```bash
node --check src/data/guilds.cjs
node --check src/net/guildNet.js
node --check src/systems/guildSystem.js
node --check src/ui/GuildPanel.js
node --check src/ui/guild/GuildPanelBase.js
node --check src/ui/guild/GuildHomePage.js
node --check src/ui/guild/GuildCreatePage.js
node --check src/ui/guild/GuildMembersPage.js
node --check src/ui/guild/GuildUpgradesPage.js
node --check src/scenes/GuildHallScene.js
node --check server/guild/guildCore.cjs
node --check server/guild/guildAuth.cjs
node --check server/guild/guildService.cjs
node --check server/guilds.cjs
```

## Notes

- `TitleScene.js` and `GameScene.js` are not modified. All wiring is done in
  `main.js`, `HUDScene` (or `UIScene`), and the Colyseus room.
- Replace procedural hall art with real sprites/tilemaps when assets are ready.
- The daily-gold button in the hall is a scaffold; connect it to the economy
  server to persist last-claim timestamps.
