# Agent client — status panel + claim button

Client affordances for the autonomous agent system (`docs/AGENT_REWARDS.md`
covers the server-side reward ledger). This document describes the **client**
half only: how the browser learns which peers are agents, how a player sees
their own agent, and how the honest CLAIM button behaves.

## Files

| File | Role |
| --- | --- |
| `src/net/agentsNet.js` | **New.** Subscribe/send layer for the agent messages + agent-identity tracking. |
| `src/ui/AgentPanel.js` | **New.** Player-facing panel: eligibility, live agent state, CLAIM button. |
| `src/scenes/UIScene.js` | *Patched.* HUD icon button, closer registration, shutdown cleanup, minimap agent mark. |
| `src/net/NetworkManager.js` | *Patched.* Forwards the three incoming agent message types. |

## What already worked (do not reinvent)

Real players render from the `snap` payload: a server agent inserted into a
room's player map is already visible and moving with **no client work**. This
change adds nothing to remote traversal — it only (1) tags *which* peers are
agents and (2) shows the owning player a panel for their own agent.

## Wire contract (fixed)

Server → client, to the **owning player only**:

- `agent-entitlement { eligible, reason, held, requiredUsd, priceUsd }`
- `agent-state { sid, name, action, zone, gathers:{...}, kills, solFound, uptimeMs }`
- `agent-claim-result { ok, amount, reason }`

Client → server:

- `agent-claim {}`

Agent identity travels out of band on the existing broadcast messages:

- `peer-join` may carry `agent: 1` and `ownerSid`;
- `snap.p[]` entries may carry `ag: 1` (plus the usual `i` session id).

## `agentsNet.js`

Follows `src/net/arenaNet.js` exactly: the three incoming types are registered
per-attach with `net.onAttach(... room.onMessage(type, ...))` so they survive
reconnects, and `agent-claim` goes through the generic relay (`net.send`).

**Relayed-echo guard.** A relayed copy of a targeted message arrives tagged with
`sessionId`; every incoming handler drops messages where
`sessionId !== undefined`, matching the guard in the other net modules (and the
generic passthrough in `NetworkManager`).

API:

| Member | Meaning |
| --- | --- |
| `onEntitlement(fn)` / `onState(fn)` / `onClaimResult(fn)` | Subscribe; returns an unsubscribe. |
| `claim()` | Send `agent-claim {}`. No-op offline (`false`). |
| `state` | Read-only snapshot `{ entitlement, agent, lastClaim, agents, connected }`. |
| `isAgent(id)` / `agentIds()` / `onAgents(fn)` | Which remote sessionIds are agents (from `peer-join` / `snap`). Used by the minimap mark. |

`NetworkManager.attach()` now forwards `agent-entitlement` / `agent-state` /
`agent-claim-result` to `net.on(...)` consumers (with the same `sessionId`
echo guard); it is otherwise untouched.

## `AgentPanel.js` — states

Phaser container panel in the shared idiom (`src/ui/ArenaPanel.js`,
`src/ui/HelpOverlay.js`): Solana palette only (green `#14F195`, purple
`#9945FF`, cyan `#03E1FF`, magenta `#DC1FFF`, white `#E1E8F0`, muted `#6B7A99`,
bg `#0A0E1A`), Silkscreen labels + PixelifySans body, click-outside/Esc close,
`destroy()`-safe, and single-column at `<=560px`.

| Server says | Header | Reason line | CLAIM button |
| --- | --- | --- | --- |
| nothing yet / offline | `Checking agent status…` | `Waiting for the server…` | **DISABLED** |
| `eligible: true` | `AGENTS ENABLED` | `You are eligible to run an agent.` | **ENABLED** (`CLAIM SOL`) |
| `eligible: false`, hold shortfall | `AGENTS UNAVAILABLE` | `Requires holding $5.00 USD of the token — you hold $0.40.` | **DISABLED** |
| `eligible: false`, `reason: unconfigured` | `AGENTS UNAVAILABLE` | `Agents aren't configured on this server yet — this is not about your balance.` | **DISABLED** |
| `eligible: true`, `reason: claim_disabled` | `AGENTS ENABLED` | `The SOL claim path is disabled on this server — it is off by default.` | **DISABLED** |

The raw `reason` code is also printed (`reason: <code>`) so the exact server
reason is always visible; unknown reasons are shown verbatim.

**Honest by construction.** The button is enabled only when the server reports
`eligible === true` and the reason is not a claim-side off state
(`claim_disabled` / `unconfigured` / `nothing_to_claim`). The default is
disabled: before any entitlement arrives the button reads `CLAIM DISABLED` and
cannot be clicked. The `unconfigured` case is worded so it never implies the
player is short of funds.

Live fields: agent name, action, zone, gathered total (+ breakdown), kills,
SOL found, uptime — re-rendered from `agentsNet.onState`/`onEntitlement`/
`onClaimResult` with **no polling loop**. A claim shows `Claimed N SOL` or
`Could not claim — <reason>` and a toast.

## UIScene integration

- HUD icon `🤖` (cyan) to the right of the skill-tree icon, using the existing
  text-icon button pattern; `pointerdown` toggles `this.agentPanel`.
- Registered in `input.addCloser({ id: 'agent', ... })` so **Esc** closes it, and
  destroyed in the scene `shutdown` handler alongside the other panels/buttons.
- Minimap: a remote whose sessionId is an agent is drawn as a **magenta
  diamond** instead of the player dot (world-view marking of agents).

The nameplate marker in the 3D world (`RemotePlayer` / `WorldSync`) is *not*
touched here — those files are outside this change's ownership. `agentsNet.isAgent(id)`
is the hook a world-rendering track would use to badge a nameplate.

## Verification

`node --check` on every edited/new file; a source-diff sync proving every symbol
`AgentPanel` pulls from `agentsNet` exists; and a headless Chrome boot
(puppeteer + system Chrome) that walks title → creator → world and opens the
panel through its HUD entry point with 0 page errors.
