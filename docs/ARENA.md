# PvP Arena

New-files-only vertical: `server/arena.js` (authority) + `src/net/arenaNet.js`
(client relay) + `src/ui/ArenaPanel.js` (queue panel + rating display).
Single-writer rule: the message-type table below is canonical in
`server/arena.js` (`ARENA_TYPES`); `arenaNet.js` mirrors it verbatim.
Rename on both sides or neither.

## Protocol

All types are Colyseus room message types, all prefixed `arena:`.

### Client → server

| Type | Payload | Effect |
|---|---|---|
| `arena:queue` | `{}` | Join matchmaking queue → `arena:queued` (position). Auto-matches FIFO when ≥2 waiting. |
| `arena:leave` | `{}` | Leave queue → `arena:queued { position: 0 }`. |
| `arena:challenge` | `{ target }` (`sessionId` or player name) | Consensual challenge → target gets `arena:challenge`. 45s expiry. |
| `arena:accept` | `{ target }` (challenger `sessionId`/name) | Verify pending challenge → both get `arena:match`. Consumes the challenge. |
| `arena:decline` | `{ target }` (challenger `sessionId`/name) | Challenger gets `arena:declined`. Consumes the challenge. |
| `arena:report` | `{ matchId, winner, reason? }` (`winner` = `sessionId`) | Settle a match → both get `arena:result` + `arena:rating`. Consumes the match. |
| `arena:rating` | `{}` | Request own record → `arena:rating`. |

### Server → client

| Type | Payload | To |
|---|---|---|
| `arena:queued` | `{ position }` (1-based; `0` = not queued) | self |
| `arena:match` | `{ matchId, a, b, aName, bName }` | both (`a`,`b` are `sessionId`s) |
| `arena:challenge` | `{ from, fromName }` | target only |
| `arena:declined` | `{ from, fromName }` | challenger only |
| `arena:result` | `{ matchId, winner, winnerName, reason, you }`, `you = { rating, wins, losses, delta }` (personalized per recipient) | both |
| `arena:rating` | `{ rating, wins, losses }` | self |
| `arena:error` | `{ msg }` | sender only |

Flow notes:

- Queue is FIFO; entries for departed sessions are lazily purged on every
  match attempt. `arena:match` from the queue and from an accepted challenge
  have the identical shape — the client does not care which path made it.
- Challenge accept/decline is **anti-spoof checked**: the server only honors
  `arena:accept`/`arena:decline` when `room.arenaChallenges.get(acceptorSid).from
  === resolvedChallengerSid`. Forged accepts (no live challenge from that
  player) get `arena:error`.
- Client ignores any inbound `arena:*` payload carrying a `sessionId` field
  (relayed-echo guard — the generic passthrough tags foreign echoes that way).
- Rate limit: token bucket 8 burst / 800ms per player; over-limit arena
  messages are silently dropped.

## Rating formula

- Store: plain JSON at `rec.progress.ext.arena = { rating, wins, losses }`
  (via `loadChar`/`saveChar` from `server/store.js`); in-memory fallback for
  unsaved/guest characters so the queue works before first save.
- Start `1000`, floor `100`, K-factor `32`.
- `Ew = 1 / (1 + 10^((R_loser − R_winner)/400))`
- `delta = max(1, round(32 × (1 − Ew)))`
- Winner: `R + delta`, `wins + 1`. Loser: `R − delta`, `losses + 1`.
- Example: 1000 vs 1000 → `delta = 16`. 1200 vs 1000 (upset) → winner `+24`.

## Anti-farm notes

What the server enforces today:

1. **Participants only**: `arena:report` is accepted only from a match
   participant, and `winner` must be one of the two participants.
2. **One report settles**: the match record is deleted on first valid report —
   no double-claiming the same `matchId`.
3. **Rematch cooldown**: `PAIR_CD_MS = 60s` per sorted pair after a settled
   match; queued re-pops of the same pair within the window are re-queued, not
   matched (no instant re-queue farming).
4. **Challenge expiry**: `CHALLENGE_TTL_MS = 45s`; stale accepts are rejected,
   and a 15s sweeper notifies expired challengers.
5. **Match TTL**: unreported matches expire after 10 min (no stale `matchId`
   reuse).
6. **Rate limits** on all arena inbound (see above).

Known gaps (for a future pass, NOT implemented): no IP/device-alternate
detection, no stake on matches, no leaderboard, no win-trade graph analysis.
A same-household pair can still trade wins every 60s — acceptable for launch,
flagged here.

## Parent wiring (exact — do NOT let other tracks edit these)

The arena ships as new files only. The parent (integrator) must add:

### 1. Room module route — `server/index.js` (or wherever rooms are created)

```js
import * as arenaModule from './arena.js';
import { addRoomModule } from './WayfarerRoom.js'; // wherever addRoomModule lives
addRoomModule(arenaModule); // calls arena.install(room) per room
```

Plus optional leave-purge wherever `onLeave`/disconnect is handled:

```js
import { purge as arenaPurge } from './arena.js';
// in onLeave(room, client):
arenaPurge(room, client.sessionId);
```

(Lazy purge covers this if the hook is skipped, but the explicit call avoids
ghost queue slots.)

### 2. WayfarerRoom denylist — `server/WayfarerRoom.js`, `moduleTypes` set

Add these 12 strings verbatim so the generic `onMessage('*')` passthrough
never echoes arena traffic (which would double-deliver + spoof `sessionId`):

```js
'arena:queue', 'arena:leave', 'arena:challenge', 'arena:accept',
'arena:decline', 'arena:report', 'arena:rating', 'arena:queued',
'arena:match', 'arena:declined', 'arena:result', 'arena:error',
```

### 3. Slash command — `src/systems/social/index.js`, `command()` switch

Suggested (parent owns exact naming):

```js
case 'arena': case 'aq':
  if (!first) { arenaNet.queue(); return; }
  if (first === 'leave') return void arenaNet.leave();
  if (!restText && first) return void arenaNet.queue(); // /arena = join
  return void arenaNet.challenge(first);                 // /arena <name>
case 'aqaccept': return void arenaNet.accept(first);
case 'aqdecline': return void arenaNet.decline(first);
```

with `import { arenaNet } from '../../net/arenaNet.js';` at the top, and add
`/arena /aq /aqaccept /aqdecline` to the `/help` line. Challenge-request UI
reuse: route `arenaNet.onChallenge` → existing `PetDuelRequest`-style modal or
a bus event (parent's call).

### 4. Panel mount — scene of parent's choice (e.g. `WorldScene.js`)

```js
import { ArenaPanel } from '../ui/ArenaPanel.js';
// on scene create: this.arenaPanel = new ArenaPanel(this);
// toggle (e.g. keybind): this.arenaPanel.show() / .hide()
```

No other existing file needs changes. No build/route/migration side effects.
