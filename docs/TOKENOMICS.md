# TOKENOMICS — Wayfarer Online, as published to players

Every number in this document is **derived from the frozen sources**, never invented. Where a
rate is stated, the module it comes from is named. The canonical numbers are frozen in
`server/economy/CONTRACT.md`; the code that implements them is `server/economy/*.js`; the
per-kill table is `server/rewards.js`. `server/economy/verify.mjs` cross-checks every copy and
must print `==== 70 passed, 0 failed ====` before this document may be published.

---

## 1. The two currencies — do not confuse them

| | **Gold** | **WAYFARER** (`$WAYFARER`) |
|---|---|---|
| What it is | soft, in-game currency | the SPL token |
| On chain? | **no** — off-chain ledger only | yes, a standard SPL mint (6 decimals) |
| Earned by | play (per-kill) and optional idle accrual | play (boss kills) and staking |
| Fees | **every fee is charged in gold** | never charged in token |
| Claimable? | never | yes, to a signature-verified wallet |

Sources: `server/economy/CONTRACT.md` §"The two currencies"; `server/economy/fees.js`.

`$WAYFARER` is launched on **pump.fun**: total supply **fixed at 1,000,000,000**, `decimals = 6`,
mint authority pump.fun's (burned at graduation). **We can never mint.** The game is fully
playable — gold, saves, co-op, progression — with no wallet and no token; nothing here gates
combat, exploration or items.

---

## 2. The two bounds (accounting vs real)

There are **two** ceilings, and they are not the same thing:

- **Accounting bound — `BUDGET_TOTAL_RAW = 50,000,000 * 10^6`** = **5.0 % of supply**, the
  maximum dilution the stake-return formula will ever compute. It is enforced *structurally*:
  `stakeMath.returnFor` caps every payout at the remaining budget and refuses a budget above
  the lifetime total. *(`server/economy/stakeMath.js`, `CONTRACT.md` §EMISSION.)*
- **Real bound — the funded rewards wallet balance.** Because the mint authority is not ours,
  **no code can mint a reward**. The economy can never pay out one raw unit more than the
  rewards wallet actually holds. The accounting bound is only reachable if the owner funds the
  wallet that far; in practice the wallet balance binds first.

Half-life: the effective rate **halves every 180 days** of programme age
(`EMISSION.HALF_LIFE_DAYS = 180`), so emissions taper instead of stopping abruptly.

---

## 3. Stake tiers and their **effective** year-1 rate

The published figure is the rate the code **actually pays** in year 1 — the integral of the
decaying rate, **not** the nominal `aprBps`. Publishing the nominal 3.00 % while the code paid
1.61 % was the single most misleading thing in an earlier draft; the rate sheet now prints the
effective number (`server/economy/rates.js` → `stakeMath.effectiveYear1Bps`).

| Tier | Lock | Extra idle cap | Idle multiplier | **Effective year-1 rate** | Nominal `aprBps` (internal only) | Year-1 return on the minimum lock |
|---|---|---|---|---|---|---|
| `none` | — | — | ×1.00 | — (no token return) | 0 | — |
| `t1` | 1,000 WAYFARER, 7 d | +4 h (cap 12 h) | ×1.15 | **1.61 %/yr** | 300 bps (3.00 %) | **+16.11 tokens** (1.61 %) |
| `t2` | 10,000 WAYFARER, 30 d | +8 h (cap 16 h) | ×1.35 | **2.42 %/yr** | 450 bps (4.50 %) | **+241.65 tokens** (2.42 %) |
| `t3` | 50,000 WAYFARER, 90 d | +16 h (cap 24 h) | ×1.60 | **3.22 %/yr** | 600 bps (6.00 %) | **+1,610.97 tokens** (3.22 %) |

Cumulative at two years, on the minimum lock: t1 +20.06 (2.01 %), t2 +300.91 (3.01 %),
t3 +2,006.04 (4.01 %). Idle caps: base 8 h + tier bonus, clamped to 24 h
(`idle.idleCapHours`, `CONTRACT.md` §STAKE TIERS).

Read the effective-rate rows straight off `rates.summaryLine`:

```
t1 · 1,000 WAYFARER locked 7d · +15% idle (4h extra cap) · 1.61%/yr (paid, not nominal)
t2 · 10,000 WAYFARER locked 30d · +35% idle (8h extra cap) · 2.42%/yr (paid, not nominal)
t3 · 50,000 WAYFARER locked 90d · +60% idle (16h extra cap) · 3.22%/yr (paid, not nominal)
```

These returns are an **emission** — they dilute everyone who is not staking, which is why the
budget is finite and the rate decays. "Yield" is never a safe word for this; say *bounded
emission*, never *APY* or *earn money*.

---

## 4. Idle gold (soft currency, off by default)

Idle accrual is **gold only, never token**, and is **OFF by default**
(`ECON_IDLE_GOLD=false`, the owner's per-kill rule, `BLOCKCHAIN_V1.md` §3.9). When enabled it
accrues at `BASE_RATE_GOLD_PER_HOUR = 120` gold/h, capped at `BASE_CAP_HOURS = 8` plus the tier
bonus, clamped to `MAX_CAP_HOURS = 24` (`server/economy/idle.js`). A full capped day is:

| Tier | Idle cap | Gold per capped day |
|---|---|---|
| `none` | 8 h | 960 |
| `t1` | 12 h | 1,656 |
| `t2` | 16 h | 2,592 |
| `t3` | 24 h | 4,608 |

Source: `rates.idleGoldPerDay`, cross-checked against `idle.accrualFor` in `verify.mjs`.

---

## 5. Fee schedule — all fees are charged in **GOLD**, never in token

Source: `server/economy/fees.js` (`FEE_TABLE`), frozen in `CONTRACT.md` §FEES.

| Fee key | Charge | Notes |
|---|---|---|
| `market_listing` | **2 %** of asking price, minimum 1 gold | not refunded (a gold sink) |
| `market_sale` | **5 %** of sale price | |
| `trade` | **2 %** of the gold side (flat 0) | |
| `name_change` | **flat 500 gold** | |
| `respec` | **flat 250 gold** | |

Rules the code enforces: amounts are non-negative safe integers; fees always round **down**; an
unknown `feeKey` **throws** rather than defaulting; a fee larger than the transaction is
flagged (`exceeds:true`) instead of silently clamped, so the action is refused before it is
charged. No fee is ever denominated in `$WAYFARER`.

---

## 6. The per-kill reward rule (per-kill only)

**Owner's rule, verbatim** (`server/rewards.js`): *"Remove idle gold accumulation, it should
only be per-kill. The same goes for the cryptocurrency rewards distribution, it's only a
certain type of enemy that receives a certain amount."*

- **Ordinary enemies pay NO token.** Across the 84-type roster, only boss types carry a non-zero
  `crypto` value; every other type has `crypto: 0`. Gold is awarded per kill per type (max
  single-kill gold is 650, a world boss: `MAX_GOLD_PER_KILL`).
- **Bosses pay token**, tiered by HP. From `server/rewards.js`:

| Boss type | Token units per kill | Boss |
|---|---|---|
| `redclaw` | 5 | Old Redclaw (hp 330) |
| `glacierwyrm` | 10 | Glacier Wyrm (hp 980) |
| `gloomtoad` | 10 | Old Gloomtoad (hp 720) |
| `gravemaw` | 10 | Warden Gravemaw (hp 640) |
| `hwarden` | 10 | Hollow Warden (hp 820) |
| `slimeking` | 10 | Slime King Gloop (hp 620) |
| `forgelord` | 20 | Forgelord Ignar (hp 1450) |
| `hking` | 20 | The Hollow King (hp 1750) |
| `khet` | 20 | Khet, the Sun Colossus (hp 1150) |
| `worldtitan` | 20 | Ancient Thornback (hp 3600) |

- **Nothing accrues with time.** Emission is bounded because bosses are timer-gated
  (`BOSS_SLOT_MS = 10 min`, `src/data/worldEvents.js`), so a player can only kill so many per
  hour. The relay credits each type at that type's own value and refuses claims above what a
  real player could have killed (`cap: { perSec, burst }` per type).
- The `crypto` column is **data and accounting**; it is the input the claim path (below) pays
  from the funded wallet.

---

## 7. The claim flow — signature-verified wallet only

A wallet is a **link, never the account**, and it is only a credential once it carries a
signature (`BLOCKCHAIN_V1.md` §3.4–3.5; `server/chain/README.md`).

1. **Verify.** The client asks the relay for a challenge (`/wallet/challenge`); the relay issues
   a **single-use, 5-minute, CSPRNG** nonce. The player signs it (`signMessage` only — never a
   transaction). `/wallet/link` verifies the Ed25519 signature and stores `verified: true`.
   An unsigned link must never be accepted — an unsigned wallet link was previously an
   account-takeover payload (proven and fixed; see `server/chain/README.md`).
2. **Resolve server-side.** The payout destination is resolved **from the verified link**, never
   from a request body field. No client can name its own destination.
3. **Fail closed.** `server/economy/payouts.js` refuses unless: the destination is a verified
   wallet for that exact player; the ledger owes at least the claimed amount; the claim is at or
   above `MIN_CLAIM_RAW` (default 1 token); and the paying float is inside
   `[HOT_FLOAT_MIN_RAW, HOT_FLOAT_MAX_RAW]`. `PAYOUTS_ENABLED !== 'true'` means **dry run** —
   it reports what it would do and signs nothing.
4. **Idempotent.** The ledger debit is keyed on the claim id, so a retried claim cannot pay
   twice. Order is debit → send; if the send fails, the debit is reversed with a **visible**
   compensating entry, never an invisible fixup.
5. **Bounded.** The wallet holds a bounded float, not the whole budget, so the worst case from a
   leaked relay key is the float — not the supply. The chain itself refuses any transfer larger
   than the wallet holds.

Nothing in the real-time game loop (Colyseus rooms, the 15 Hz tick) touches the chain;
earnings accrue server-side and are **claimed**.

---

## 8. Where every number comes from

| Number / rule | Source module |
|---|---|
| Two currencies, fee keys, tier ids, frozen constants | `server/economy/CONTRACT.md` |
| Idle rate/caps, gold-per-day | `server/economy/idle.js` |
| Stake tiers, decay, budget, effective year-1 rate | `server/economy/stakeMath.js` |
| Published rate sheet, effective (not nominal) rate | `server/economy/rates.js` |
| Fee schedule | `server/economy/fees.js` |
| Per-kill gold + boss token amounts | `server/rewards.js` |
| Claim gate, float bounds, dry-run default | `server/economy/payouts.js` |
| Wallet-link signature requirement | `server/chain/walletAuth.js`, `server/chain/README.md` |
| Fixed supply / no mint authority / metadata | `docs/LAUNCH_RUNBOOK.md`, `server/token/verify-launch.mjs` |
| Cross-module lock | `server/economy/verify.mjs` |
