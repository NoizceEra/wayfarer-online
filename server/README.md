# Wayfarer relay

A Colyseus server with two kinds of room:

- **Public world** `world`: persistent shards. `Embervale-1` is created at boot and never
  auto-disposes. When a shard reaches `MAX_PLAYERS`, the matchmaker opens `Embervale-2`,
  `Embervale-3` and so on. Overflow shards dispose once they are empty.
- **Private co-op** `party`: a room joined by a 5-character code (`GET /rooms/:code`).

```bash
npm install
npm start          # ws://localhost:2567
```

## How sync works

- **Area authority.** Each area (the overworld `ow`, or an interior or dungeon id) has
  exactly one authority: a connected player who is in that area. The authority simulates
  the area's enemies and streams only the fields that changed (`esnap`). Other players
  send their hits to the authority (`hit`). The authority replies with `ehit` and
  `edeath`. When the authority leaves the area or drops, another player in the area takes
  over at once, so host migration needs no extra step. On a kill, everyone who hit the
  enemy in the last 20 s gets XP, gold and quest credit. Each player rolls loot locally,
  so drops are per player.
- **Replication.** At `TICK_HZ`, each client gets a `snap` built for that client:
  - Players and enemies in the same area within `AOI_RADIUS` are sent at full rate.
  - Players who are far away, or in another area, are sent at about 1 Hz, for the minimap.
  - Only fields that changed since that client's last update are sent (delta compression).
  - Samples carry the sender's server-clock timestamp. Clients interpolate with a 100 ms
    buffer and extrapolate briefly when a sample is late.
- **Anti-cheat (light).**
  - Moves are checked against `MAX_SPEED`. A move that fails the check is rejected with
    `correct`, which snaps the client back.
  - Teleports (area changes, respawns, waystones) are rate-limited.
  - Hits are range-checked, and damage is capped.
  - Every message type has a token-bucket rate limit. A client that floods is disconnected.
  - Saved characters are sanitised, and level and gold gains are capped relative to the
    previous save. A save that breaks a cap is clamped and logged as `anticheat`.
- **Reconnect.** A client that drops keeps its seat for `RECONNECT_SECONDS`. The client
  retries with backoff and resumes the same session. After a server restart the client
  joins again from scratch, and its character is restored from the store.
- **Persistence.** Characters are stored per anonymous device token. The client generates
  the token and keeps it in localStorage; the server stores only a sha256 of it. The file
  is `DATA_DIR/players/<hash>.json`. Writes go to a temp file first and are then renamed
  into place, so a crash never leaves a half-written file. The server writes behind every
  `SAVE_FLUSH_MS` and flushes on graceful shutdown. The file stores level, xp, gold,
  inventory, equipment, dyes, quest state and position. localStorage stays the client's
  fallback. On join, the newer copy wins; a copy clamped by anti-cheat always wins.

## HTTP

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ok, uptime}`. Returns 503 while shutting down. Use it as the Railway healthcheck. |
| `GET /stats` | Players, rooms and shards, area authorities, message and violation counters, store stats, RSS. |
| `GET /rooms/:code` | Turns a 5-character co-op code into a roomId. |

## Environment

| Var | Default | Meaning |
| --- | --- | --- |
| `PORT` | `2567` | HTTP/WebSocket port (Railway injects it) |
| `DATA_DIR` | `server/data` | Character store root. On Railway, **mount a volume** here, for example `/data`. |
| `MAX_PLAYERS` | `40` | Players per public shard before overflow |
| `PARTY_MAX` | `8` | Players per private co-op room |
| `WORLD_NAME` | `Embervale` | Shard name prefix |
| `TICK_HZ` | `15` | Replication rate |
| `AOI_RADIUS` | `400` | Full-rate interest radius (px) |
| `RECONNECT_SECONDS` | `30` | How long a dropped seat is held |
| `SAVE_FLUSH_MS` | `5000` | Store write-behind interval |
| `MAX_SPEED` | `260` | Movement validation ceiling (px/s) |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn` or `error` |
| `CORS_ORIGIN` | `*` | Comma-separated allowed origins for the HTTP routes |

## Deploy (Railway)

- The root `railway.json` builds only `server/` and starts `npm --prefix server start`.
  Its healthcheck is `/health`. You can also point a service at `server/` and use the
  `Dockerfile`.
- Add a **Volume** mounted at `/data`, then set `DATA_DIR=/data`. Without a volume,
  characters are lost on every redeploy. Clients still keep their localStorage copy.
- A redeploy sends SIGTERM. The server then saves every player, closes rooms with code
  4010, and flushes the store. Clients show "Reconnecting…" and rejoin the new instance
  on their own.
- The client connects through `VITE_SERVER_URL`, for example
  `wss://your-relay.up.railway.app`. Set it in Vercel.

## Extending (social and other modules)

- **Unknown message types are passed through.** When a client sends type `T` with
  payload `{...}`, every other client in the room receives `T` with `{..., sessionId}`.
  The server caps the payload at 4 KB and rate-limits it. On the client, use
  `net.on(T, fn)` and `net.send(T, payload)`. Handlers registered with `net.on` survive
  reconnects.
- **An optional `server/social.js` is loaded when it exists.** It can export any of these:
  - `install(room)`, called after the built-in handlers. It can register or override
    `room.onMessage(...)` handlers.
  - `onJoin(room, client, player)`
  - `onLeave(room, client, player)`
  - `routes(app)`, to add Express routes.

  The `player` record includes `name`, `sid`, `a` (the area key), `x` and `y`.
- **Stable shapes:**
  - `chat {text}` becomes `chat {name, text, sessionId}` for everyone.
  - `peer-join {sessionId, name, hero, a}`
  - `peer-leave {sessionId, name, wasHost}`
  - `hero {sessionId, hero}`
  - `result` is passed through unchanged.
