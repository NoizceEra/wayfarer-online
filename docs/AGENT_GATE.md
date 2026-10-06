# Agent entitlement gate

`server/agentGate.cjs` decides whether a wallet-bound player is entitled to an
autonomous agent. **This module is the gate only** — the agent runtime itself
lives in `server/agents.cjs` (a separate track). The gate answers one question
and nothing else: *does this session's bound Solana wallet hold at least
`AGENT_MIN_USD` of the project token?*

## Honesty contract (do not weaken)

- **No price is ever invented.** With no `AGENT_TOKEN_PRICE_USD` the gate
  returns `reason: 'unconfigured'` and the feature stays OFF.
- **No balance is ever fabricated.** A failed RPC lookup is `status: 'error'`
  and is **never** eligible.
- **No RPC call is made when unconfigured.** Missing `SOLANA_RPC` /
  `MINT_ADDRESS` / wallet owner short-circuits to `'unconfigured'` before any
  network call, mirroring the token bridge's `unconfigured` degradation in
  `server/economy.js`.
- Only **public wallet addresses** are handled. No key material is read, logged
  or stored anywhere in this module.

## Exported API

| Export | Signature | Notes |
| --- | --- | --- |
| `evaluateHolding` | `({ tokenAmount, priceUsd, minUsd }) -> { eligible, usdValue, reason }` | **Pure.** `reason ∈ 'ok' \| 'below_min' \| 'unconfigured' \| 'no_wallet'`. |
| `fetchHolding` | `async ({ address, rpc, mint, owner, decimals }) -> { status, tokenAmount }` | `status ∈ 'ok' \| 'unconfigured' \| 'error'`. `owner` falls back to `address`. |
| `entitlementFor` | `async (room, sid) -> { eligible, reason, held, requiredUsd, priceUsd }` | Resolves the session's bound wallet, fetches, evaluates. Adds `reason: 'error'`. |
| `clearCache` | `() -> void` | Drop the holding cache. |
| `HOLDING_TTL_MS` | `number` | Cache TTL (default 60000). |
| `DEFAULT_DECIMALS` | `number` | Fallback SPL decimals (6). |

### `reason` values

| reason | meaning |
| --- | --- |
| `ok` | Holding is worth `>= requiredUsd`. Eligible. |
| `below_min` | Holding is worth `< requiredUsd`. |
| `unconfigured` | No price / no threshold / no RPC / no mint decided the gate. Feature off. |
| `no_wallet` | The session has no bound wallet (or no character token). Feature off. |
| `error` | RPC is configured but the lookup failed. `entitlementFor` only. Never eligible. |

`evaluateHolding` treats a `null`/`undefined`/`''` `tokenAmount` as `no_wallet`,
a non-finite or negative `tokenAmount` as `unconfigured`, and a missing /
non-positive `priceUsd` or `minUsd` as `unconfigured`. The comparison is
`usdValue >= minUsd` (exactly at the threshold is eligible).

## Decimals

Token accounts are read with `getTokenAccountsByOwner` + `encoding: jsonParsed`,
so the mint's real decimals come back in the response (`uiAmount` sums are
already decimal-scaled). Only if the RPC hands back raw integer amounts does the
module read the mint's decimals via `getAccountInfo`; the `decimals` argument to
`fetchHolding` (default `CFG.TOKEN_DECIMALS`, itself default **6**) is the last
resort. It never silently assumes 9.

## Caching

A holding lookup is cached per `(rpc|mint|owner|decimals)` for **60 000 ms**
(override with `AGENT_HOLDING_TTL_MS`). Successful **and** failed lookups are
cached, so a failing node is not retried on every tick. The gate is a pure read
— it never writes.

## Enabling the gate (operator env vars)

The gate turns ON only when all of these are set on the relay:

| Env var | Required | Default | Meaning |
| --- | --- | --- | --- |
| `SOLANA_RPC` | yes | `''` | RPC endpoint used to read the holding. |
| `MINT_ADDRESS` | yes | `''` | SPL mint of the project token. |
| `AGENT_TOKEN_PRICE_USD` | yes | `0` | Operator-set token price in USD. **No price => unconfigured.** |
| `AGENT_MIN_USD` | no | `50` | USD value a bound wallet must hold. |
| `AGENT_HOLDING_TTL_MS` | no | `60000` | Holding-lookup cache TTL. |
| `TOKEN_DECIMALS` | no | `6` | Fallback decimals if the chain cannot tell us. |

The wallet owner comes from the existing wallet binding (the same
`wallets` table `server/economy.js` populates via `wallet-bind`); no new schema
is needed — `db.js` is unchanged.

`AGENT_TOKEN_PRICE_USD` is **operator-supplied on purpose**: there is no
price oracle in this module, so an operator must publish the price they want the
gate to use. Leaving it unset keeps every player non-entitled rather than
guessing a market value.

## Usage

```js
const { entitlementFor } = require('./agentGate.cjs');

const ent = await entitlementFor(room, sid);
if (ent.eligible) {
  // spawn the agent (server/agents.cjs)
} else {
  // ent.reason explains why: 'unconfigured' | 'no_wallet' | 'below_min' | 'error'
}
```

## Testing

The pure decision is exported separately from the IO, so it is unit-testable
with no network and no env: `evaluateHolding` needs no stubs at all, and
`fetchHolding` can be exercised by stubbing `globalThis.fetch`.
