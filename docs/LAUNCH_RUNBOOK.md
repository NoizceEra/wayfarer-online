# LAUNCH RUNBOOK — Wayfarer Online `$WAYFARER`

**The owner's goal, verbatim:** *"all I have to do is place the contract address and fund
the rewards wallet."*

**The mainnet path is PUMP.FUN.** The owner launches the coin on pump.fun; we do not launch
it, we do not hold its mint authority, and we never attach metadata. This runbook is the
exact ordered sequence for tomorrow, with the commands, the expected output, the go/no-go
checks and the rollback.

> **PLAY FIRST — this applies to the launch comms too.** The token is never advertised as a
> prerequisite for anything. The game is fully playable with no wallet and no token, earning
> never gates combat, gold, saves or co-op, and no launch copy may promise income, yield or
> an investment return. Say "optional reward currency", never "earn money".

---

## 0. The two hard truths (read before anything else)

1. **Supply is FIXED and the mint authority is not ours.** A pump.fun mint is a standard SPL
   token created with `decimals = 6` and a total supply of exactly `1,000,000,000`. The mint
   authority is a pump.fun PDA (`['mint-authority']`) at creation and is burned at
   graduation. **The relay can NEVER mint a reward.** There is no mint path, no `mintTo`, no
   treasury that can be reprinted. The rewards wallet balance is the hard ceiling on every
   token the economy can ever pay.
2. **That ceiling must be enforced, and it is — twice.**
   - **By the chain:** a transfer for more than the paying wallet holds simply fails; nothing
     can overdraw it.
   - **By the relay:** `server/economy/payouts.js` debits the ledger *before* the send,
     refuses when the float would drop below `HOT_FLOAT_MIN_RAW`, refuses outright when the
     float is above `HOT_FLOAT_MAX_RAW`, and reverses the debit with a visible compensating
     entry if the send fails.
   - **By ops:** `server/token/float-status.mjs` is the pre-enable and monitoring gate below.
     If it says NO-GO, claims cannot be honoured — top the wallet up before enabling.

---

## 1. Who does what

| Step | Owner (2 actions, plus funding) | Ops |
|---|---|---|
| 1 | **Launch the coin on pump.fun** (name/symbol/image are yours; decimals 6, supply 1,000,000,000 are fixed by pump.fun) | — |
| 2 | **Paste us the contract address (mint)** | **Verify it** with `verify-launch.mjs` (§3) — read-only, the gate |
| 3 | **Acquire tokens and send them to the rewards wallet** `Bh9MynmswmZVeeSUDgDdfjTGRYpvyrJ7XDhuQ8JRaeMJ` | Set the relay env (§4) |
| 4 | — | Enable earn, sweep a bounded float, enable payouts, watch the first claim (§5) |

The owner's entire obligation is: **launch → paste → fund**. Everything else is ops.

Metadata (name/symbol/URI) is **not** a step: pump.fun hosts it under Metaplex Token Metadata
with `isMutable = false`. There is no "attach metadata" task, and no Metaplex CLI to install.
The one thing to check is that the name/symbol/image pump.fun shows is what you meant
(`verify-launch.mjs` records that it is pump.fun-hosted).

---

## 2. Owner step 1–3 (the exact actions)

1. **Launch on pump.fun.** Take the name, ticker (`WAYFARER`) and image from the brand kit.
   Do not promise utility, yield or price in the description.
2. **Paste the contract address to ops.** That is the mint address.
3. **Fund the rewards wallet.** Buy/acquire `$WAYFARER` and send it to:

   ```
   rewards wallet (mainnet):  Bh9MynmswmZVeeSUDgDdfjTGRYpvyrJ7XDhuQ8JRaeMJ
   ```

   This balance *is* the reward budget. Fund it with the amount you are willing to distribute;
   nothing refills it. Also send a small amount of SOL to the wallet the relay will pay from
   (the hot-float wallet, `8EdtikWmSTTQPAhKDKgZrBcKxH6Lc1xqwNHMRxdqixHc`) so it can pay
   transaction fees.

The other mainnet wallets, for reference (public addresses; the secret halves are in the
gitignored `server/token/keys/mainnet/` and must be backed up off this disk):

| Wallet | Address | Role |
|---|---|---|
| rewards | `Bh9MynmswmZVeeSUDgDdfjTGRYpvyrJ7XDhuQ8JRaeMJ` | the funded reward budget (the ceiling) |
| hot-float | `8EdtikWmSTTQPAhKDKgZrBcKxH6Lc1xqwNHMRxdqixHc` | the relay's small paying float |
| treasury | `8NbYQhYak8AH9CPb5ZFWnxfy52VPJ8fuYd2siQbkf25T` | holding / operations |
| treasury-vault | `FcAEFWnWbu656CEkhEJgFaSafmkytokUN42bp8vCsRRV` | cold storage |
| authority | `7WkbcV9cprn7ECWaivn9MBKRSHY2DF6TU59ZpSWLj6Kc` | ordinary ops key — **NOT** a mint authority |

---

## 3. Ops step 1 — verify the mint (the gate)

Run **immediately** after the address is pasted. Read-only, safe, non-zero exit on a problem.

```bash
node server/token/verify-launch.mjs \
  --cluster mainnet \
  --mint <PASTED_MINT_ADDRESS> \
  --rpc https://api.mainnet-beta.solana.com
```

What it does: reads the mint off-chain and asserts the things that break the economy if wrong.

- **HARD (NO-GO, exit 1):** owner program is a token program the relay can pay on; `decimals === 6`; supply is
  exactly `1,000,000,000 * 10^6`; the account is initialised. A wrong `decimals` is called out
  because every raw amount in the economy would then be off by orders of magnitude.
  > **UPDATE (this workstream).** This check used to require the LEGACY SPL Token Program and
  > treat Token-2022 as a NO-GO. That was wrong: pump.fun's current standard, `create_v2`, mints
  > a **Token-2022** coin (decimals 6, native metadata), and the relay's payout path now selects
  > the token program from the mint's on-chain owner. BOTH legacy SPL Token and Token-2022 are
  > accepted; any OTHER owning program is still a NO-GO. `program` is reported verbatim.
- **RISK (blocks on mainnet by default):** the mint authority is held by something that is
  neither burned (`null`) nor pump.fun's `mint-authority` PDA
  (`TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM`) — that holder could inflate supply; and a
  freeze authority being set — that holder could freeze accounts.

Expected **GO** on a real pump.fun mint (a graduated coin burns the mint authority):

```
==== GO — 4/4 hard checks passed, 0 risk(s) flagged (strict: risks block) ====
```

It writes `server/token/keys/mainnet/launch-receipt.mainnet.json` (public data only) from what
the chain says. Ops and the relay read that file afterwards.

**Demo — the same tool against the live devnet mint** (devnet is our own throwaway mint, so its
authority is ours and is reported as an EXTERNAL-authority RISK, which is *expected* on devnet):

```
$ node server/token/verify-launch.mjs --cluster devnet \
    --mint 8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg --rpc https://api.devnet.solana.com

── Wayfarer token verification (READ-ONLY, pump.fun path) ──────────
cluster     devnet  (devnet)
mint        8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg
rpc         https://api.devnet.solana.com
expect      SPL Token program, 6 decimals, supply 1000000000
pump PDA    TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM  (['mint-authority'] on 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P)

── on chain (the source of truth) ──────────────────────────────────
program     TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA
decimals    6
supply      1000000000000000 raw  (= 1000000000 tokens)
mint auth   BAwazRZjsgw5iD3aiuM2TW7zawjaJfENbV3JPnjr5m4f
            EXTERNAL — not the pump.fun PDA
freeze auth BAwazRZjsgw5iD3aiuM2TW7zawjaJfENbV3JPnjr5m4f
            EXTERNAL — not the pump.fun PDA

── HARD checks ─────────────────────────────────────────────────────
  PASS  mint account exists and is initialised
  PASS  owner program is the SPL Token Program
  PASS  decimals === 6  (raw amounts depend on it)
  PASS  on-chain supply is the fixed 1,000,000,000
...
==== GO — 4/4 hard checks passed, 2 risk(s) flagged (reported only) ====
```

### Go/no-go summary

| Check | Command | GO means |
|---|---|---|
| Mint verified | `verify-launch.mjs` | exit 0, `==== GO ====` |
| Float funded | `float-status.mjs` (§5) | exit 0, `==== GO ====` |
| Relay healthy | `curl -s $RELAY/health` | `{"ok":true,...}` |
| Wallet sessions | `CHAIN_SESSION_SECRET` set (≥16) | `/wallet/challenge` issues a nonce |

**NO-GO** (stop, do not enable anything): any HARD failure, any mainnet RISK, `float-status`
NO-GO, or a missing `WAYFARER_MINT`.

---

## 4. Ops step 2 — set the relay environment

Values below are **examples** — never commit real secrets. `CHAIN_SESSION_SECRET` and the
keypair paths are the only sensitive ones.

### 4a. The complete launch surface (`docs/BLOCKCHAIN_V1.md` §4)

```bash
# ── identity of the token (REQUIRED for any chain path) ──
WAYFARER_MINT=<PASTED_MINT_ADDRESS>            # the pump.fun mint. NO compiled-in default.
CHAIN_CLUSTER=mainnet-beta                     # devnet | mainnet-beta
CHAIN_RPC_URLS=https://api.mainnet-beta.solana.com,https://solana-rpc.publicnode.com
CHAIN_SESSION_SECRET=<at-least-16-random-chars>   # wallet sessions; generate, do not reuse

# ── economy switches ──
ECON_ENABLED=true                              # earn/stake/claim (default OFF)
ECON_IDLE_GOLD=false                           # keep idle gold OFF (owner's rule, §3.9)

# ── signing / payouts (default OFF = dry run, nothing signed) ──
PAYOUTS_ENABLED=true                           # flip this LAST, after the float check
PAYOUT_KEYPAIR_PATH=<path to the paying wallet keypair>   # see 4b — the code reads a different name
MIN_CLAIM_RAW=1000000                          # dust floor: 1 token
HOT_FLOAT_MIN_RAW=100000000                    # 100 tokens kept as runway
HOT_FLOAT_MAX_RAW=20000000000                  # 20,000 tokens = blast-radius ceiling

# ── display / ops (public addresses, shown in the client and /chain/status) ──
REWARDS_WALLET=Bh9MynmswmZVeeSUDgDdfjTGRYpvyrJ7XDhuQ8JRaeMJ
TREASURY_WALLET=8NbYQhYak8AH9CPb5ZFWnxfy52VPJ8fuYd2siQbkf25T
```

### 4b. What the code actually reads today (verified in this tree)

`server/economy/payouts.js` is the only place the relay signs. It reads these names, and two
differ from §4 — **set the names the code reads or the switch does nothing**:

| §4 name | read by code as | Note |
|---|---|---|
| `PAYOUT_KEYPAIR_PATH` | **`RELAY_HOT_KEYPAIR`** | the paying wallet keypair path |
| `CHAIN_RPC_URLS` | `CHAIN_RPC_URL` (sender); `rpc.js` reads `CHAIN_RPC_URLS`/`SOLANA_RPC_URL(S)` | set both |
| `WAYFARER_MINT` | `WAYFARER_MINT` | **but it has a compiled-in devnet fallback** — always set it explicitly |
| `ECON_ENABLED` / `ECON_IDLE_GOLD` / `REWARDS_WALLET` / `TREASURY_WALLET` | *nothing yet* | spec §4 vars; no code reads them in this tree — display/ops only for now |

> **Two blockers to fix in the settlement workstream before mainnet payouts are enabled:**
> 1. `payouts.js` falls back to the devnet mint when `WAYFARER_MINT` is unset, which is exactly
>    the foot-gun §3.7 forbids. It must fail closed with no default. Until then: always set
>    `WAYFARER_MINT`, and treat a typo'd mint as a real risk.
> 2. It keys the paying wallet off `RELAY_HOT_KEYPAIR`, not `PAYOUT_KEYPAIR_PATH`.
>
> (Both are in `server/economy/payouts.js`, owned by the chain-settlement workstream — this
> runbook documents the reality rather than editing another workstream's file.)

### 4c. Required before the first claim can succeed

Plainly, a claim cannot succeed unless **all** of these are true:

1. `WAYFARER_MINT` is set to the verified pump.fun mint (**never** rely on the default).
2. `CHAIN_CLUSTER=mainnet-beta` and `CHAIN_RPC_URLS` (and `CHAIN_RPC_URL` for the sender).
3. `CHAIN_SESSION_SECRET` is set (≥16 chars) — without it there is no wallet session, so no
   signature-verified link, so **no payout destination** (payouts refuse an unverified wallet).
4. `PAYOUTS_ENABLED=true` — otherwise every claim is a dry run that signs nothing.
5. `RELAY_HOT_KEYPAIR` points at a wallet that **holds tokens and a little SOL**.
6. `ECON_ENABLED=true`, and the player's accrued balance ≥ `MIN_CLAIM_RAW`.
7. The float is inside `[HOT_FLOAT_MIN_RAW, HOT_FLOAT_MAX_RAW]`.

---

## 5. Ops step 3 — enable earn, sweep a bounded float, enable payouts, watch the first claim

Do these in order. Each step is reversible (see §7).

**1. Set everything except `PAYOUTS_ENABLED`.** Redeploy the relay. Confirm boot:

```bash
curl -s "$RELAY/health"      # {"ok":true,"game":"wayfarer-online","uptime":...}
```

**2. Enable earn.** `ECON_ENABLED=true`. Players accrue off-chain in the ledger; nothing is
signed. Idle gold stays off.

**3. Sweep a bounded float — do NOT point the relay at the funded rewards wallet directly.**
Move a bounded amount from the funded rewards wallet to the hot-float wallet so a stolen relay
key can only ever take the float:

```bash
spl-token transfer <MINT> <AMOUNT> 8EdtikWmSTTQPAhKDKgZrBcKxH6Lc1xqwNHMRxdqixHc \
  --owner server/token/keys/mainnet/rewards.keypair.json --url https://api.mainnet-beta.solana.com
# keep it inside [HOT_FLOAT_MIN_RAW, HOT_FLOAT_MAX_RAW] = [100, 20000] tokens
```

**4. Check the float (the ceiling gate).**

```bash
node server/token/float-status.mjs --cluster mainnet --mint <MINT> \
  --rewards Bh9MynmswmZVeeSUDgDdfjTGRYpvyrJ7XDhuQ8JRaeMJ \
  --hot 8EdtikWmSTTQPAhKDKgZrBcKxH6Lc1xqwNHMRxdqixHc
```

GO prints the balances, the spendable headroom above the reserve, and how many dust-floor
claims that funds. NO-GO (below reserve / over cap / no SOL) means **fix it before step 5**.

**5. Enable payouts** — `PAYOUTS_ENABLED=true`, redeploy. This is the only switch that signs.

**6. Watch the first claim.** A player with a signature-verified wallet links it
(`/wallet/challenge` → sign → `/wallet/link`, Ed25519 over a single-use 5-minute nonce), then
claims. Confirm:

- the payout journal gains a `paid` entry with a signature;
- the explorer shows the transfer to the player's wallet;
- the ledger shows the debit (`claim:<claimId>`) and **no** compensating refund entry;
- `float-status` still reads GO.

Re-run `float-status.mjs` on a schedule while payouts are live.

---

## 6. Manual metadata note (not required)

There is **no Metaplex step**. pump.fun attaches name/symbol/URI under Metaplex Token Metadata
with `isMutable = false` at creation, and `verify-launch.mjs` records that fact. If a change is
ever needed it is a pump.fun/platform action, not ours — and it would require the Metaplex CLI,
which is deliberately **not** a dependency of this repo. (Token-2022's
`spl-token initialize-metadata` cannot be used either: it only works on a Token-2022 mint
created with `--enable-metadata`, and pump.fun owns the metadata for a `$WAYFARER` mint — a
`create_v2` coin IS Token-2022, but its metadata is pump.fun's, not ours to re-initialize.)

---

## 7. ROLLBACK — how to stop paying and stop earning instantly

Earn and payouts are independent switches, so each can be turned off alone.

| Want to stop | Do | Effect |
|---|---|---|
| **Paying (fastest, keep earning)** | Set `PAYOUTS_ENABLED=false` and redeploy | Every claim becomes a dry run: it reports what it *would* pay and signs nothing. Balances are untouched. |
| **Earning entirely** | Set `ECON_ENABLED=false` and redeploy | No accrual, no stake, no claim surface. The read-only rate sheet may still serve. |
| **Both, immediately, no deploy** | Take the relay down / scale the service to 0 | Nothing accrues or pays; play itself keeps working offline/from saves. |
| **Drain the blast radius** | Sweep the hot-float wallet back to cold storage | Worst case from a leaked key is then ~0, not the float. |
| **Sweep the float out** | `spl-token transfer <MINT> <BALANCE> <COLD_ADDRESS> --owner <hot-float.keypair.json> --url <mainnet RPC>` | Moves the paying float to treasury-vault (`FcAEFWnWbu656CEkhEJgFaSafmkytokUN42bp8vCsRRV`) or another cold wallet. |

Order for a real incident: **`PAYOUTS_ENABLED=false`** first (stops signing), then sweep the
float, then investigate. Never leave a large float on the relay key.

Also note: pods/relays that lose `WAYFARER_MINT` must **not** silently fall back — see §4b
blocker 1. Until that is fixed, a misconfigured deploy is a rollback trigger of its own.

---

## 8. Devnet tooling (not the mainnet path)

`server/token/launch.mjs` and `spawn-wallets.mjs` are **devnet / throwaway tooling**. They mint
a token *we* control to prove the plumbing for free; they are **not** how `$WAYFARER` ships.
`launch.mjs` keeps every safety gate (refuses mainnet without `--i-understand-mainnet`, refuses
to overwrite a receipt without `--force`, never prints secrets, pre-checks the payer balance,
reads the mint back off-chain into the receipt) — but do not use it for the real token.

The live devnet mint for pipeline testing is `8q4tDsGTD1J2xNzpm4YVCY1QEpXGwMDhE3BkCdCd5xWg`
(6 decimals, supply 1,000,000,000, our authority) — that is why `verify-launch.mjs` flags its
authority as an EXTERNAL-authority RISK on devnet.
