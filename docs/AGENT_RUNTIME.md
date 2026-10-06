# Agent Runtime — server-side autonomous agents

`server/agents.cjs` runs autonomous agents that join the live world, move,
gather, fight and cast on their own, and are visible to real players as ordinary
player-shaped peers. **No client change is required for visibility.**

## The insight that makes this small

`server/WayfarerRoom.js` already runs a replication tick
(`setSimulationInterval(() => this.tick(), 1000/CFG.TICK_HZ)`) with
`setPatchRate(null)` (no schema state). `tick()` iterates `this.players`
(`Map sessionId -> record`) and emits each record's `{x,y,f,h,a,m,dc}` to every
real client in the AOI as `snap {t,p:[...],e:[...]}`.

So an agent is simply a **player-shaped record inserted into `room.players`**.
Once its `x/y/f/h/m` are updated each tick, the existing replication broadcasts
it to every real client for free — exactly like a real player.

## Wire contract (as observed on the wire)

```
server -> client
  peer-join  { sessionId: "agent:<id>", name, hero, a }   # creates the puppet
  snap { t, p:[ { i:"agent:<id>", x, y, f, h, a, m, dc, d } ], e:[...] }
  peer-leave { sessionId:"agent:<id>", name, wasHost:0 }  # removes the puppet
  act        { sessionId:"agent:<id>", k, x, y, f, kind, ab }   # AOI-scoped FX
```

* `sid` namespace `agent:<id>` can never collide with a real `client.sessionId`
  (Colyseus session ids are opaque and never start with `agent:`).
* `hero` is a full defaultHero-shaped object so every client renders the agent
  correctly (`RemotePlayer` merges `defaultHero()` over it anyway).
* `m` is the moving flag (1 while travelling, 0 while idle) — the client uses it
  to animate walking.
* Field-for-field identical to what a real player's record produces, so nothing
  in `WorldSync.js` / `RemotePlayer.js` treats agents specially.

## Load path

`WayfarerRoom.onCreate` loads the module with `createRequire` (CommonJS, so
`engines.node >= 18` stays honest — no `require(esm)`) inside a `try/catch`, and
constructs `new AgentsSystem(this, { log })`. A failure to load logs and nulls
`this.agents`; it can never take the room down.

`WayfarerRoom.js` touch points (targeted patches only):

1. `import { createRequire } from 'module'` + `const nodeRequire = createRequire(import.meta.url)`.
2. `onCreate` — construct the system after `hook('install', this)` (social is ready).
3. `tick()` — `try { this.agents?.tick?.(now) } catch`, before the replication loop.
4. `ensureAuth()` — added `!q.agent` to the authority predicate (see below).
5. `onDispose()` — `this.agents?.destroy?.()` before the persist loop.

## API

```js
const { AgentsSystem } = require('./agents.cjs');
const sys = new AgentsSystem(room, { count, auto, log }); // room-only form also works
sys.spawn({ id?, name?, a?, x?, y?, hero?, level?, ownerSid? }) // -> record (in room.players)
sys.despawn(sid)   // -> bool ; removes from players + social.players + every AOI view
sys.tick(now)      // behaviour loop; driven by the room tick
sys.destroy()      // room teardown: despawns all, clears state, stops the loop
sys.list()         // -> agent records
sys.get(sid)       // -> agent record | null
```

Ambient population is opt-in: set `AGENTS=<n>` (e.g. `AGENTS=6`) to place `n`
agents in a public world shard; `DEFAULT_AGENTS` is **0**. Agents spawn once a
real client has been present for `PRESENCE_SETTLE_MS` (400 ms) so the `peer-join`
lands after the client's message handlers are wired (otherwise the join handshake
race drops it), and they spawn in a ring inside AOI around that first player.

## Behaviour (priority, per tick)

1. **Fight** — a hostile (`room.areas.get(a).enemies`) within `HOSTILE_ENGAGE`
   (260 px): close to `ATK_RANGE` (40 px) and strike on `ATK_CD_MS` (700 ms).
2. **Gather** — nearest available synthetic node within `RESOURCE_RADIUS`
   (300 px): walk to it, dwell `GATHER_MS`, increment `b.stats.gathered`, put the
   node on `NODE_CD_MS` cooldown. Nodes are generated per agent around its home.
3. **Wander** — otherwise pick a waypoint within `WAYPOINT_RANGE` of home.
4. **Cast** — independent cooldown (`CAST_CD_MS` base + jitter), casts a spell
   (`b.spell`) regardless of mode.

Actions are broadcast as `act` to nearby real clients only (`sendNear`), so
players see attack/gather/cast FX. Agents read server-side area enemy state; they
do **not** mutate enemies (the area authority client owns that) and never claim
kills.

## Null-safety audit (agents have no real client)

Every call site that could assume one client per `this.players` entry:

* **`ensureAuth(key)`** — authority is chosen by lowest `order` over
  `this.players`. An agent iterated first would win via the `!best` branch. Guard:
  `!q.agent` (agents also carry no `order`). Proven by a unit test that calls the
  **real** `WayfarerRoom.prototype.ensureAuth` and by the counterfactual showing
  the unpatched predicate picks the agent. ⇒ agents never become `a.auth`, so
  `clientOf(agentSid)` (null) is never used to route enemy work.
* **`persist(p)`** (`periodicSave`, `onBeforeShutdown`, `onDispose`) — early-returns
  on `!p.token`. Agents keep `token:null` and never set `lastSave`, so **no agent
  is ever written to `DATA_DIR/players`**. Verified: zero character files after a
  relay run with an agent present.
* **`onJoin` peer-join loops (~230 / ~259)** — iterate `this.players`, so they
  include agents automatically when a real player joins mid-session. No patch
  needed; confirmed by the unit test + wire proof.
* **`sendNear` / `bcast` / `onEnemyDeath`** — iterate `this.clients` only. Agent
  `act` broadcasts pass an agent record as `p` (has `x,y,a`) but the loops only
  touch real clients. Safe.
* **`social.sendParty` / `sendTo` / `clientById`** — `clientById` returns null for
  an agent sid and every caller uses `?.send`. Agents are never added to parties.
* **rate buckets / anti-cheat (`onMove`, `correct`, `flood`)** — only reachable
  from `onMessage`, which needs a real client. Agents receive no messages.
* **`social.players`** — the agent gets a presence-shaped record
  `{name,level,job,zone,guild:'',party:''}` so `presenceOf()` and `/who` work.
* `/stats` counts `clients.length`, so agents are excluded from the player count.

## Cross-module notes (owned elsewhere — reported, not edited)

* `server/arena.js` and `server/worldBoss.js` now skip `agent` records
  (`!p.agent` in `findPlayerByName`/`resolveTarget`/`tryMatchQueue`; `who.agent`
  in the boss `ehit` handler) — these guards already exist in the working tree
  from the sibling tracks.
* `src/net/agentsNet.js` (client, another track) marks agent peers from
  `peer-join.agent === 1` / `snap.p[].ag === 1` for a *paid* agent-entitlement
  feature. This module deliberately does **not** emit those markers or the
  `agent-entitlement`/`agent-state`/`agent-claim-*` messages: world agents have no
  owner. Reconciling the two contracts is parent work.

## Verification

* `node --check server/agents.cjs` and `server/WayfarerRoom.js` — exit 0.
* `node tools/econ_test.mjs` — **35/35** (shipped default; agents off).
* `node tools/econ_audit_dupes.mjs --race-iterations 20` — **13 probes / 0 exploited
  / 0 inconclusive** (shipped default; agents off).
* Wire proof (throwaway, two real colyseus clients + live relay): agent arrived in
  `peer-join`, appeared in `snap.p`, moved ~52 px over 3 s with `m:1`, never took
  `'ow'` authority, appeared in `/who`, was excluded from the client count, logged
  no ERROR/WARN, and wrote zero character files.
* Unit proof (throwaway): spawn/despawn/list/get/tick/destroy, both registries,
  record shape, and the real patched `ensureAuth`.

### Why `AGENTS` defaults to 0

With ambient agents on, the relay's extra per-tick broadcast traffic perturbs the
timing of a **pre-existing** race in `server/economy.js:408-422` (mail-claim
double-credit: 5 double-claims / 8 settled rounds), which the dupe harness itself
flags as rate-limit sensitive. That race is not introduced here and its root cause
is outside this module's ownership; defaulting ambient population off keeps the
relay's baseline behaviour for the economy merge gates. Set `AGENTS=<n>` to turn
ambient agents on once that economy race is fixed.
