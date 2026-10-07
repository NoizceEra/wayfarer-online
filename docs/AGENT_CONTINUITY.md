# Agent Continuity — persistent companions + social presence

Two behaviours that make an autonomous agent feel like a persistent companion
rather than a disposable NPC:

* **(A) Continuity** — an OWNED agent's progress survives a relay restart, so a
  returning wallet-holder gets the SAME companion back (same name, level, kills,
  gathered resources, accrued SOL-find total) instead of a fresh spawn.
* **(B) Social presence** — when a real player comes within a modest radius, the
  agent acknowledges them once, through the existing `act` message, and then cools
  down so it never spams.

Owned by: `server/agents.cjs`, `server/agentStore.cjs`, `server/agentPersist.cjs`.
Documented here. No other file is touched.

---

## (A) Continuity — what is persisted, where, and why it is stable

### Keyed by the owner's STABLE device token, never the sessionId

An agent record inserted into `room.players` has `token: null` on purpose (so the
relay's `persist()` / `periodicSave()` early-return on it and **no agent row is
ever written to `DATA_DIR/players`**). Continuity therefore does NOT use
`rec.token`. At spawn, `agents.cjs` resolves the owner's current session to its
player record and reads `owner.token` — the same STABLE identity
`server/store.js` hashes for saves and `WayfarerRoom._recordAgentFind` uses for
the SOL ledger. That token is held in `rec.b.persistKey` (server-only state; never
transmitted) and is the only key used for agent progress.

* Ambient agents (`ownerSid == null`) → `persistKey == null` → never persisted.
* Gold-hired companions (`hireling: true`) → `persistKey == null` → never
  persisted (a temporary contract is not a companion).
* A wallet-entitled OWNED agent → `persistKey == owner.token` → persisted.

### One store, one format

Progress is stored in the **existing** `server/agentStore.cjs` file,
`DATA_DIR/agents/agents.json`, in a new `progress` section beside the existing SOL
ledger. Same file, same atomic write (`tmp` + `fsync` + `rename`), same
load-on-boot tolerance for a missing/corrupt file — no second store format.

```json
{
  "players":  { "<ownerDeviceToken>": { "solFoundLamports": 0, "...": "SOL-find ledger (unchanged)" } },
  "progress": {
    "<ownerDeviceToken>": {
      "name": "Bramble",
      "hero": { "job": "ranger", "body": "ranger", "skin": "tan", "...": "primitive display fields only" },
      "base": 3,                 "level": 5,             "gathered": 27,
      "kills": 4,                "attacks": 12,          "spells": 9,
      "solFoundLamports": 48000, "updatedAt": 1700000000000
    }
  },
  "global": { "totalFoundLamports": 0, "totalClaimedLamports": 0 }
}
```

The `progress` shape, the level curve, and the restore rule are defined and
defended by the pure module `server/agentPersist.cjs` (no IO — mirroring the
`agentRewards.cjs` split). `agentStore.cjs` owns the IO:
`progress(ck)` (read), `saveProgress(ck, snap)` (atomic write),
`progressStats()` (operator visibility). `stats()` also reports `agents` (count).

### Where the numbers come from

| Field | Source |
| --- | --- |
| `gathered` | `b.stats.gathered`, incremented on each completed gather |
| `kills` | `b.stats.kills`, incremented when a hostile the agent was engaged with leaves the area's enemy set (local bookkeeping — it credits NO quest, arena, bounty or world-boss system) |
| `base` | the agent's level at first spawn (`opts.level`, owner-derived; persisted so the curve is restart-stable) |
| `level` | `computeLevel(base, gathered, kills)` — `clamp(base + floor(gathered/8) + floor(kills/4), 1, 99)` |
| `solFoundLamports` | a **read-only mirror** of `agentStore.get(ownerToken).solFoundLamports`; the reward ledger stays authoritative |
| `name`, `hero` | the companion's identity, restored unless a live player already holds the name |

Because `level` is a pure function of `(base, gathered, kills)` and all three are
persisted, the restore is exact and restart-stable — no hidden counter to drift.

### Write policy

Progress is written per agent, debounced to at most one write per `SAVE_MIN_MS`
(400 ms) with a trailing flush, plus an immediate flush on `despawn()` (owner
left, hire expired, room disposed). A relay killed mid-run therefore loses at
most the last few hundred ms of work; everything already flushed is restored on
the next boot from the same `DATA_DIR`.

### What continuity deliberately does NOT change

* `rec.token` stays `null`; `lastSave` is never set → `persist()`/`periodicSave()`
  still early-return → no agent row in `DATA_DIR/players`.
* Agents remain excluded from area authority (`ensureAuth` `!q.agent`), arena
  matchmaking/resolve, and world-boss credit. Nothing here touches those paths.
* The SOL-find ledger keeps its caps, and the claim path stays **disabled by
  default**; continuity adds no new way to move SOL. `solFoundLamports` here is a
  mirror, not a second balance.

---

## (B) Social presence — the greeting rule

When a REAL player is within `GREET_RADIUS` (120 px) of an agent, in the same
area, the agent plays a one-off acknowledgement and then stops for a while.

* **Message:** the existing `act` message (`{ sessionId:'agent:<id>', k, x, y, f,
  kind, ab }`) sent through `sendNear` (AOI-scoped; iterates real clients only),
  tagged with an extra `greet: 1` field so it is distinguishable from combat acts.
  No new message type is invented, and no client change is required.
* **Animation:** the client's remote-`act` handler (`src/net/WorldSync.js
  onAct`) only animates `k:'atk'` (an arm/weapon raise) and `k:'shot'`. The
  greeting therefore uses `k:'atk'` — the one gesture the existing client path
  actually plays — read as an acknowledgement; `greet:1` marks its intent. (A
  bespoke "wave" animation would need a client change, which is out of scope
  here.)
* **Cooldown:** at most once per `GREET_CD_MS` (15 s) per `(agent, player)` pair.
  The cooldown map (`b.greetLast`, keyed by the player's sessionId) is pruned to
  live clients each tick, so it stays bounded.
* **Never sends to a non-existent client:** the loop iterates `room.clients`, and
  `_act` → `room.sendNear` also iterates `room.clients`. An agent has no client of
  its own, so a greeting can never be addressed to one. Agents in an arena match
  skip greeting so gestures never mix into a duel.

Tunables live next to the other agent constants in `server/agents.cjs`
(`GREET_RADIUS`, `GREET_CD_MS`, `SAVE_MIN_MS`).

---

## Verification (real runs)

* `node --check server/agents.cjs server/agentStore.cjs server/agentPersist.cjs`
  — clean.
* End-to-end restart proof on a real relay (child process, `cwd=server`): an owned
  agent is driven to gather and to record a kill, the relay is stopped, and a NEW
  relay with the same `DATA_DIR` restores the companion's level/kills/gathered —
  see the task's evidence capture for the exact before/after numbers.
* Greeting fires exactly once and then cools down within the cooldown window.
* `node tools/econ_test.mjs` — **35 checks passed** (shipped default; ambient
  agents off).
