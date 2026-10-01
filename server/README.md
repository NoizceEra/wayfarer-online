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

## Player economy (`server/economy.js`)

Direct trade, a server-wide market board, mail and persisted guilds. It is loaded
like `social.js` (optional module, `addRoomModule`) and stores its data in
`DATA_DIR/economy/` (`market.json`, `mail.json`, `guilds.json`, `names.json`, an audit
`ledger.jsonl`). Persistence code lives in `server/econStore.js`.

- **Server-authoritative.** Every operation is checked against the server's copy of the
  character (`store.js`): bag gear (`progress.inventory`) and gold. What the client
  claims is never trusted. Item ids must be in `server/shared/item_ids.json`, which is
  shared with the client. Regenerate it with `node tools/export_item_ids.mjs` after
  changing the gear catalogue (`--check` fails when the file is stale).
- **Revisions (anti-dupe).** Each character record has `rev`. The server bumps it on
  every economy mutation, and economy ops must quote the current value. A `save` that
  quotes an older rev is refused and answered with `econ-sync {stale}`, so an in-flight
  upload can't bring back items that were already traded away. Items moved out by the
  economy are remembered for 5 minutes, and a save that shows extra copies of them is
  stripped and logged as `anticheat econ-dupe`.
- **Atomic writes.** A trade, purchase, claim or deposit writes every affected file
  (economy docs and both players' device files) as one transaction. Each file is
  written as a `.txn` temp file, then `txn.json` is written as the commit point, then
  the files are renamed into place. On boot, an interrupted transaction is rolled
  forward and uncommitted `.txn` files are deleted.
- **Market.** List an item for a price with a duration of 2, 8, 24 or 48 h. A 5%
  listing fee (minimum 1g) is a gold sink and is not refunded. The seller can have at
  most 10 listings. Players can browse with search, slot, rarity, price range, sort
  and pages, then buy now or cancel. Sale gold and expired items reach the seller by
  system mail.
- **Mail.** Mailboxes are per character (device token + name). Letters are addressed
  by character name: the first device to use a name owns it. A letter can carry up to
  5 items plus gold, and costs 5g postage.
- **Guilds.** Guilds have a tag, name, ranks (leader, officer or member), a MOTD, a
  gold bank (anyone deposits, the leader withdraws) and a log. They are invite-only.
  Guild chat and nameplate tags still work through `social.js`.
- **Hardening.** Each connection has token-bucket rate limits (5/s economy ops, 3/s
  browsing). Payloads over 2 KB are dropped. Gold and items are validated strictly:
  amounts must be integers, and items must be on the whitelist and present in the
  bag. Server-to-client economy message types are swallowed so peers can't forge them
  through the generic passthrough.

| Client → server | Server → client |
| --- | --- |
| `econ-hello {rev}` | `econ-state {hasSave,rev,gold,inventory,mailUnread,guild,cfg}` |
| `trade-request {to}` / `trade-respond {from,accept}` | `trade-request {from,fromName}`, `trade-open {id,partner}` |
| `trade-offer {id,items,gold}` / `trade-lock {id,rev}` / `trade-unlock` / `trade-confirm` / `trade-cancel` | `trade-update {id,me,them}`, `trade-result {ok,id,rev,gold,inventory,delta}`, `trade-closed {id,reason}` |
| `market-browse {q,slot,rarity,min,max,sort,page,mine}` | `market-page {items,total,page,pages}` |
| `market-post {item,price,hours,rev}` / `market-buy {id,rev}` / `market-cancel {id,rev}` | `econ-sync {why,rev,gold,inventory,delta}` + `econ-msg {text}` |
| `mail-list` / `mail-read {id}` / `mail-delete {id}` / `mail-claim {id,rev}` / `mail-send {to,subject,body,gold,items,rev}` | `mail-box {mails,unread}`, `mail-unread {n,subject?,from?}` |
| `guild-create/invite/accept/decline/join/leave/kick/rank/motd/info/deposit/withdraw` | `guild-info {...}`, `guild-invite {tag,name,from}`, `guild-update` (social shape) |
| (any) | `econ-error {msg,code}`. Codes: `rate`, `invalid`, `missing`, `gold`, `bag`, `rev`, `gone`, `closed`, `nosave`, `noname` |

`GET /economy` returns the number of listings, mailboxes, guilds, active trades and
online characters.

## HTTP

| Route | Purpose |
| --- | --- |
| `GET /health` | `{ok, uptime}`. Returns 503 while shutting down. Use it as the Railway healthcheck. |
| `GET /stats` | Players, rooms and shards, area authorities, message and violation counters, store stats, RSS. |
| `GET /rooms/:code` | Turns a 5-character co-op code into a roomId. |
| `GET /wallet/config` | Feature flags + the human-readable link statement. |
| `POST /wallet/challenge` | `{token, address, action}` → single-use SIWS-style nonce + message. |
| `POST /wallet/link` | `{token, nonce, signature}` → verify ed25519 (`signMessage` only). |
| `POST /wallet/unlink` | `{token}` → drop this device's link (attestations stay on the wallet). |
| `POST /wallet/status` | `{token}` → `{linked, address, short, badges}`. |
| `POST /wallet/claim` | Stub. Always `403 {error: not_enabled}`. |
| `GET /marks/leaderboard` | Opt-in seasonal display-name board. |

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
| `MARKET_DURATION_SCALE` | `1` | Multiplies listing durations. It exists for tests: `0.001` turns 2 h into about 7 s. |
| `FEATURE_WALLET_LINK` | on | Optional wallet ↔ device link (`signMessage` only; never a transaction) |
| `FEATURE_MARKS` | on | Off-chain Wayfarer Marks + cosmetics shop |
| `FEATURE_LEADERBOARD` | on | Seasonal Marks board (opt-in display name) |
| `FEATURE_FOUNDER_BADGE` | on | Cosmetic founder frame (off-chain attestation) |
| `FEATURE_SEASON_BADGE` | on | Cosmetic season frame |
| `FEATURE_REDEEMABLE_REWARDS` | **hard-off** | Not implemented. Ignored even if set. See [docs/EARN_AND_COMPLIANCE.md](../docs/EARN_AND_COMPLIANCE.md). |
| `FEATURE_ONCHAIN_CLAIM` | **hard-off** | `/wallet/claim` always `not_enabled` |
| `MARKS_SEASON` | `s1` | Season id |
| `WALLET_DOMAIN` | empty | If set, challenge Origin host must be in this list |
| `WALLET_NONCE_TTL_S` | `300` | Link-nonce lifetime |
| `WALLET_RELINK_COOLDOWN_H` | `24` | Cooldown to move a wallet to another device |

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
