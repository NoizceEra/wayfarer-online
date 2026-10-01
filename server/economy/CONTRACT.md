# server/economy — CONTRACT (frozen)

Read ONLY this file and the ONE file you own. Reading anything else wastes your budget.

Absolute project root: `D:/ai-studio/wayfarer-online`
Your module lives in: `D:/ai-studio/wayfarer-online/server/economy/`

## The two currencies

- **gold** — soft, in-game, no chain. Earned from play and idle accrual. All FEES are
  charged in gold. Never claimable on-chain.
- **wayfarer** — the SPL token (devnet mint `8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg`).
  Accrued by play, funded by a BOUNDED emission budget, claimable to a verified wallet.

## Pinned identifiers — DO NOT INVENT YOUR OWN

Three modules are being written in parallel right now against this exact list. If your
file uses a different string for any of these, integration fails.

```
RESOURCE_KINDS   = ['gold', 'wayfarer']

LEDGER_REASONS   = ['idle', 'quest', 'harvest', 'combat', 'fee',
                    'stake_lock', 'stake_unlock', 'stake_return', 'claim', 'admin']

FEE_KEYS         = ['market_listing', 'market_sale', 'trade', 'name_change', 'respec']

STAKE_TIER_IDS   = ['none', 't1', 't2', 't3']
```

## Purity rules (all three worker modules)

- **Pure functions only.** No `fs`, no `net`, no `fetch`, no `Date.now()` inside logic
  (take `nowMs` as an argument), no randomness, no imports outside Node built-ins.
- **No mutation of inputs.** Return new objects.
- **Integer-safe money.** All token/gold amounts are integers in base units. Never use
  floats for balances. Rounding must be explicit and always DOWN (never round a payout up).
- Deterministic: the same arguments must always produce the same output.

## Canonical numbers — FROZEN, all modules must agree on these exactly

Token amounts are base units (6 decimals), so multiply UI amounts by `10**6`.

```
IDLE
  BASE_RATE_GOLD_PER_HOUR = 120
  BASE_CAP_HOURS          = 8
  MAX_CAP_HOURS           = 24

STAKE TIERS  (token amounts in base units)
  none : minLockRaw 0,             lockDays 0,  idleMultiplier 1.00, capBonusHours 0,  aprBps 0
  t1   : minLockRaw 1000*10**6,    lockDays 7,  idleMultiplier 1.15, capBonusHours 4,  aprBps 300
  t2   : minLockRaw 10000*10**6,   lockDays 30, idleMultiplier 1.35, capBonusHours 8,  aprBps 450
  t3   : minLockRaw 50000*10**6,   lockDays 90, idleMultiplier 1.60, capBonusHours 16, aprBps 600

EMISSION
  BUDGET_TOTAL_RAW     = 50000000 * 10**6     // 5% of the 1,000,000,000 supply
  DECAY_HALF_LIFE_DAYS = 180                  // effective APR halves every 180 days

FEES  (charged in GOLD, never in token)
  market_listing : 2%  of asking price, minimum 1 gold
  market_sale    : 5%  of sale price
  trade          : 2%  of the gold side, flat 0
  name_change    : flat 500 gold
  respec         : flat 250 gold
```

`idleCapHours(tier)` = `BASE_CAP_HOURS + capBonusHours(tier)`, clamped to `MAX_CAP_HOURS`.

## Module boundaries (frozen export names)

### `idle.js` — offline accrual (owner: WS-IDLE)
```js
export const IDLE = { BASE_RATE_GOLD_PER_HOUR, BASE_CAP_HOURS, MAX_CAP_HOURS, ... };
export function idleCapHours(stakeTier)              // stakeTier: 'none'|'t1'|'t2'|'t3' -> hours (number)
export function stakeMultiplier(stakeTier)           // -> number, e.g. 1.0 / 1.15 / 1.35 / 1.6
export function accrualFor({ elapsedMs, stakeTier, nowMs, lastAccrualMs })
//  -> { gold, hoursCredited, cappedMs, cappedHours, ratePerHour, hitCap }
```

### `fees.js` — soft-currency fee schedule (owner: WS-FEES)
```js
export const FEE_TABLE;                              // keyed by FEE_KEYS
export function feeFor(feeKey, amountGold)           // -> { feeGold, netGold, rate, flat }
export function describeFee(feeKey)                  // -> human string
```

### `stakeMath.js` — lock tiers + bounded emission (owner: WS-STAKE)
```js
export const STAKE_TIERS;                            // keyed by STAKE_TIER_IDS
export function lockExpiry(nowMs, tierId)            // -> ms epoch of unlock
export function returnFor({ tierId, amountRaw, elapsedMs, budgetRemainingRaw, accrueStartMs })
//  -> { owedRaw, owedCappedRaw, budgetAfterRaw, exhausted }
```

### `rates.js` — the published rate sheet (owner: WS-RATES)
```js
export const RATE_SHEET;      // rows for every tier incl. 'none': { tierId, label, idleMultiplier,
                              //   idleCapHours, aprBps, minLockRaw, lockDays }
export function rateRows();   // -> RATE_SHEET as an array, in tier order none,t1,t2,t3
export function idleGoldPerDay(stakeTier);   // -> integer gold, floored
export function summaryLine(tierId);         // -> one-line human string, e.g.
                                             //    "t1 · 1,000 WAYFARER locked 7d · +15% idle (4h extra cap) · 1.61%/yr (paid, not nominal)"
                                             //  The rate published is the EFFECTIVE year-1 rate
                                             //  (what the code actually pays), never the nominal aprBps.
```

## Non-negotiable invariants (your test MUST assert each)

1. **Rounding is always down.** A payout can never exceed what was earned; there is no
   path where a fractional unit rounds in the player's favour.
2. **Caps are hard.** Idle accrual cannot exceed the cap for its tier, however long the
   elapsed time; emission cannot exceed `budgetRemainingRaw`, ever.
3. **Unknown input is rejected, not defaulted.** An unknown `stakeTier` or `feeKey` must
   throw. Silently treating a typo as tier 'none' pays the wrong rate forever.
4. **Zero is valid, negative is not.** `elapsedMs <= 0` yields exactly 0, never negative.

## Your deliverable

1. Your ONE module file, complete and working.
2. Your ONE test file (`<module>.test.mjs`) that asserts every invariant above plus the
   boundaries (exactly-at-cap, one unit below/above a tier threshold, empty input).
3. Run it and paste the real output. A test that has never been run is not a test.

Your test must print a final line of exactly the form: `==== N passed, M failed ====`
and `process.exit(M ? 1 : 0)`.

## Forbidden

- Do NOT edit any file other than your own two files. Other modules are mid-write.
- Do NOT install packages. No new dependencies.
- Do NOT touch `server/chain/`, `server/token/`, `server/store.js`, or any `src/` file.
- Do NOT claim success without pasted test output.
