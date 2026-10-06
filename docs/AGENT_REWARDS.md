# Agent SOL Rewards — capped, auditable find ledger + a claim path that pays nothing (yet)

This document describes the reward **ledger** and **claim** path for the
autonomous agent feature ("an agent finds SOL along the way"). Read the
**Honesty** section first: this change funds nothing.

Files (all new, all under `D:/ai-studio/wayfarer-online`):

| File | Role |
| --- | --- |
| `server/agentRewards.cjs` | **Pure policy** (no IO): accrual caps, claim decision, two-phase claim. Unit-testable. |
| `server/agentStore.cjs` | **Durable ledger** (IO): one JSON file under `DATA_DIR`, atomic writes, load-on-boot. |
| `docs/AGENT_REWARDS.md` | This document. |

Neither module is wired into the relay in this change, and neither can move SOL.

---

## Honesty: what is real and what is not

### What is REAL
- An **auditable per-player ledger** of "SOL found" in lamports (1 SOL = 1e9 lamports),
  written atomically to `DATA_DIR/agents/agents.json`.
- A **capped accrual**: a per-find clamp, a per-day cap, and rejection of
  `NaN` / negative / non-numeric / absurd values. The ledger can never go negative.
- A **claim decision** that refuses unless an operator has explicitly enabled
  claims **and** named a payout destination.
- A **two-phase, idempotent claim** so a crash or a double-click cannot double-pay.

### What is NOT real
- **Nothing is funded.** There is **no treasury balance** behind these lamports. The
  numbers in `agents.json` are accounting entries, not a balance anyone can spend.
- **This code never moves SOL.** It never mints, never signs a transaction, never
  calls an RPC, and never touches a keypair. The single place any value *could*
  move is a `perform()` callback that the **caller** must supply to `claim()`;
  `server/agentRewards.cjs` never supplies one.
- **The claim path is OFF by default.** With `AGENT_SOL_CLAIM_ENABLED` unset it can
  only ever return `claim_disabled` (or `unconfigured`). No payout is possible.

### What an operator must do before *any* real SOL could move
1. Decide the economics and set a real, funded treasury/escrow — **this repo has none**.
2. Set `AGENT_SOL_CLAIM_ENABLED=1` **and** `AGENT_SOL_TREASURY=<destination>`.
3. **Write and audit a real payout implementation** and pass it as `claim`'s
   `perform()` callback (the code currently has no such implementation). That
   implementation must be two-phase-aware: it will be called exactly once per
   claim id, after the intent is durably persisted and before the commit is.
4. Reconcile any claim left `pending` (see *Crash / idempotency* below) by hand —
   the ledger will not pay it again.

Until step 3 exists, enabling the flag and naming a treasury changes **nothing**:
`claim()` will return `unconfigured`, because no `perform()` is wired.

---

## `server/agentRewards.cjs` — pure policy

Amounts are lamports. All amounts are non-negative integers.

### Documented defaults (`DEFAULTS`)

| Knob | Default | Meaning |
| --- | --- | --- |
| `perFindMaxLamports` | `50_000` (0.00005 SOL) | largest single find that may be booked; anything larger is **clamped** |
| `perDayCapLamports` | `5_000_000` (0.005 SOL) | largest total bookable for one player per UTC day |
| `minClaimLamports` | `0` | a claim must be at least this big |
| `claimEnabled` | `false` | claims are OFF unless explicitly turned on |
| `findsMax` | `20` | how many recent finds a player entry keeps (bounded) |

Env overrides: `AGENT_SOL_PER_FIND_MAX_LAMPORTS`, `AGENT_SOL_PER_DAY_CAP_LAMPORTS`,
`AGENT_SOL_MIN_CLAIM_LAMPORTS` (via `capsFromEnv()`).

### `accrue(state, { lamports, dayKey, caps, at }) -> { state, accepted, reason }`
Pure — returns a **new** state, mutates nothing.
- non-number / `NaN` / `Infinity` / `<= 0` → `accepted: 0`, `reason: 'invalid'`
- `> ABSURD_LAMPORTS` (1e15) → `accepted: 0`, `reason: 'absurd'`
- `> caps.perFindMaxLamports` → **clamped** to the max (never throws)
- would exceed `caps.perDayCapLamports` → **clamped** to the day's remainder
- a **new `dayKey` resets `foundTodayLamports`** (the per-day cap is per UTC day)
- `solFoundLamports` is monotonically non-decreasing and never negative

### `canClaim(state, { enabled, configured, minClaimLamports }) -> { ok, reason }`
Gate order (first failing gate wins):
1. `enabled !== true` → `claim_disabled`
2. `configured !== true` → `unconfigured`
3. nothing available → `nothing_to_claim`
4. available `< minClaimLamports` → `below_min`
5. else → `ok` (with `claimableLamports`)

`reason ∈ 'ok' | 'claim_disabled' | 'unconfigured' | 'below_min' | 'nothing_to_claim'`.

### `claim(state, ctx) -> { state, ok, reason, amount?, id?, signature?, duplicate? }`
Two-phase and idempotent:
- **PHASE 1 — mark intent:** persist a `claim:{status:'pending'}` marker durably.
- **PHASE 2 — perform:** call `ctx.perform({ id, lamports })` — the only point where
  value could move; **caller-owned**.
- **PHASE 3 — commit:** persist the debit (`solFound -= amount`) and credit
  (`solClaimed += amount`), and record `lastClaim` for idempotent replay.

`ctx` = `{ enabled, configured, minClaimLamports, persist, perform, id?, now? }`.
`persist` and `perform` are both required; without them `claim` returns `unconfigured`.

### `capsFromEnv(env)` / `claimConfig(env)`
`claimConfig` returns `{ enabled, configured, minClaimLamports }`:
- `enabled = AGENT_SOL_CLAIM_ENABLED ∈ {'1','true','yes'}` (**default FALSE**)
- `configured = AGENT_SOL_TREASURY is a non-empty string` (a destination is named)

**The exact env var that enables claims: `AGENT_SOL_CLAIM_ENABLED`.**
Naming a treasury (`AGENT_SOL_TREASURY`) does not, by itself, move anything.

---

## `server/agentStore.cjs` — durable ledger

Follows the `server/econStore.js` conventions: its own file under `DATA_DIR`,
atomic write (**tmp file + `fsync` + `rename`** — never a half-written file),
load-on-boot that tolerates a missing/corrupt file, and **no `db.js` dependency**.

- File: `DATA_DIR/agents/agents.json`
- `DATA_DIR` mirrors `server/config.js` (`DATA_DIR` env, else `<server>/data`).
  *(This `.cjs` resolves it locally because `config.js` is ESM and this change does
  not modify `config.js` — that is parent/other-track work if it is ever wanted.)*

Shape:
```json
{
  "players": {
    "<charKey>": {
      "agentId": "", "solFoundLamports": 0, "solClaimedLamports": 0,
      "lastFindAt": 0, "foundTodayLamports": 0, "dayKey": "YYYY-MM-DD",
      "finds": [{ "lamports": 0, "at": 0 }],
      "claim": null, "lastClaim": null
    }
  },
  "global": { "totalFoundLamports": 0, "totalClaimedLamports": 0 }
}
```
`global` is for **operator visibility only**.

API: `createAgentStore({ dir, log })` →
`{ dir, file, db, load, save, entry, get, put, global, stats, recordFind, applyClaim }`.

- `recordFind(ck, { lamports, dayKey, caps, at })` — accrues via the pure policy,
  persists atomically, updates `global.totalFoundLamports`.
- `applyClaim(ck, ctx)` — runs the two-phase claim, wiring `persist → put + save`
  so the intent is on disk before any payout; updates `global.totalClaimedLamports`
  on commit. `ctx.perform` is required and caller-owned.

---

## Crash / idempotency guarantees

- **Double-click:** after a claim commits, `solFound` is spent, so a second claim
  has nothing to claim. Replaying the **same id** returns `{ ok: true, duplicate: true }`
  and does **not** call `perform` again.
- **Crash between intent and commit:** the on-disk state keeps the `pending` intent.
  Every later claim is refused with `claim_disabled`-independent reason
  **`in_progress`** — we cannot know whether the payout landed, so we **never pay
  again**. An operator reconciles it by hand. (Tested: `perform` runs exactly once
  across the crash and the retry.)
- **`perform` fails:** the intent is rolled back and nothing is recorded.
- **Commit write fails:** success is **not** reported and the pending intent stays
  on disk (still blocking) — the safe side of the two-phase boundary.

---

## Verification (throwaway, run then deleted)

`node tools/_agent_rewards_selftest.cjs` asserted 35 checks, all passing:
an `accrue` table (normal / clamped-above-max / day-cap remainder / day-cap zero /
`NaN` / negative / `Infinity` / zero / non-number string / absurd / day rollover),
every `canClaim` reason, a store write→reload round-trip (byte-identical, bounded
finds ring), the crash/idempotency proof, the commit + idempotent-replay proof, and
the default-disabled proof. `node --check` passed on all new files. Economy merge
gates `node tools/econ_test.mjs` (35/35) and `node tools/econ_audit_dupes.mjs`
(13/0) were re-run and unchanged.
