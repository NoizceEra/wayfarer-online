# World Boss Integration Notes

## Overview

This document describes how the world boss rotation and public event system is
integrated into Wayfarer Online. It covers the server scheduler, client network
layer, HUD alert, boss entity, and slash-command wiring.

## Files Added / Modified

### New files

- `src/data/worldBosses.js` — Boss definitions, spawn windows, loot tables, and reward helpers.
- `src/ui/WorldBossAlert.js` — HUD alert panel with countdown and teleport button.
- `src/entities/Boss.js` — Client-side world boss entity and health bar.
- `docs/WORLDBOSS_INTEGRATION.md` — This file.

### Extended files

- `server/worldBoss.js` — Replaces the previous stub with `WorldBossService`, a
  full scheduler that handles rotation, announcements, spawning, despawn,
  participation tracking, and reward distribution.
- `src/net/worldBossNet.js` — Client network layer that listens for server
  broadcasts and emits events consumed by UI scenes.
- `src/ui/economyUI.js` — Registers `WorldBossAlert`, `Boss` entity, slash
  commands, and event wiring.

## Server Scheduler

`WorldBossService` runs in the Colyseus server process and is started once the
room is created.

1. **Rotation** — Three bosses rotate in order: `void_leviathan`,
   `solar_phoenix`, `glitch_titan`.
2. **Spawn windows** — Defined in `src/data/worldBosses.js` as UTC minutes of
   day: 01:00–03:00, 07:00–09:00, 13:00–15:00, 19:00–22:00.
3. **Announcement** — A public broadcast is sent 15 minutes before spawn.
4. **Spawn** — The boss appears at its configured zone and coordinates.
5. **Despawn** — If not killed within 60 minutes, the boss despawns.
6. **Defeat** — When HP reaches zero, rewards are distributed and a defeated
   broadcast is sent.

### Server broadcast types

| Type | Payload | Purpose |
|---|---|---|
| `world-boss:announce` | boss metadata + spawn/despawn timestamps | Public warning |
| `world-boss:spawn` | full boss stats + location | Spawn entity in world |
| `world-boss:damage` | playerId, amount, currentHp, maxHp | Update HP bars |
| `world-boss:defeated` | bossId, top contributors | Event ended, killed |
| `world-boss:despawned` | bossId, reason | Event ended, timeout |

### Participation scoring

Damage and heals are recorded per player. When the boss is defeated, rewards
are rolled per participant using `rollWorldBossLoot()` and passed to the
server's `rewardPlayer` callback. Top damage dealers are ranked for the public
leaderboard.

Tiers:
- `slayer` — highest damage dealer
- `combatant` — 5,000+ damage
- `participant` — everyone else

## Client Network Layer

`WorldBossNet` extends `Phaser.Events.EventEmitter` and keeps the current
public-event state. It exposes:

- `getStatus()` — current event state
- `getCurrentBoss()` — current/announced boss data
- `getHealthPercent()` — 0–1 HP ratio
- `getTimeToSpawn()` — ms until spawn
- `getTimeRemaining()` — ms until despawn
- `sendDamage(amount)` / `sendHeal(amount)` — request combat actions

Events emitted: `announce`, `spawn`, `damage`, `defeated`, `despawned`,
`rewards`.

## HUD Alert

`WorldBossAlert` is a fixed-position panel that appears when an announcement is
received. It shows:

- boss name and zone
- countdown to spawn
- **TELEPORT NOW** button that moves the player to the boss location
- dismiss button

The alert follows the existing Solana palette and pixel-button style.

## Boss Entity

`Boss` is a `Phaser.GameObjects.Container` rendered in the world scene. It
includes:

- procedural placeholder art colored per boss
- nameplate and title
- green health bar
- floating damage numbers on hit

## Slash Commands

Registered in `EconomyUI`:

- `/boss` — shows next spawn timer or current boss HP/status
- `/boss tp` — teleports the player to the active boss

## Integration Steps for Maintainers

1. Import `WorldBossService` in the Colyseus room module:
   ```js
   import { WorldBossService } from './worldBoss.js';
   ```
2. Instantiate it when the room is created, providing `broadcast`,
   `rewardPlayer`, and `getOnlinePlayers` callbacks.
3. Route incoming `world-boss:damage` and `world-boss:heal` messages to the
   service's `recordDamage()` and `recordHeal()` methods.
4. In the client, create `EconomyUI` in `HUDScene` or `UIScene` and call
   `install({ send, onBroadcast })`.
5. Add the economy UI instance to the scene's update loop if you want the
   alert timer to tick live.

## Verification

Run syntax checks on the new and modified JS files:

```bash
node --check server/worldBoss.js
node --check src/net/worldBossNet.js
node --check src/entities/Boss.js
node --check src/ui/WorldBossAlert.js
node --check src/ui/economyUI.js
node --check src/data/worldBosses.js
```

## Notes

- The system does not modify `TitleScene.js` or `WorldScene.js` / `GameScene.js`
  directly. Wiring into the active scenes is done through `EconomyUI`.
- Placeholder boss art is procedural. Replace texture keys (`boss.void_leviathan`,
  `boss.solar_phoenix`, `boss.glitch_titan`) with real spritesheets when assets
  are available.
- Reward delivery uses a server-provided callback so the economy/save layer
  decides how gold, tokens, and items are persisted.
