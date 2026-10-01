# Wayfarer Online — `blockchain/v1` (the token launch build)

**Owner's goal, verbatim:** *"build out everything to where all I have to do is place the
contract address and fund the rewards wallet."*

Everything in this document exists to make that sentence true. If a change makes the
launch need one more manual step than *paste the mint address* + *send tokens to the
rewards wallet*, that change is wrong.

---

## 1. What this branch is

`blockchain/v1` = `integration/wayfarer` (the whole finish wave: title/login redesign,
optional wallet + off-chain Marks, overworld roads/rivers/landmarks, co-op shared PvE,
economy audit + exploit fixes) **merged with** `axiom/token-staking-wip` (token launch
scripts, `server/chain/`, `server/economy/`, `server/identity.js`).

Both parents are verified green on their own tests. The merge itself is verified by
`npx vite build` + a booted relay + `/health`, `/stats`, `/economy`, `/wallet/config`,
`/identity/link`.

`master` (@ `6fc0c35`) is the live production build and contains **none** of this. Nothing
here ships until it is merged to `master`, which auto-deploys Vercel (client) and Railway
(relay).

---

## 2. The two layers — do not confuse them

| Layer | What it is | Chain access? |
|---|---|---|
| **Identity + Marks** (`server/identity.js`, `server/wallet.js`, `server/walletStore.js`, `server/marks.js`) | Guest-first device identity, recovery codes, **optional** signature-verified wallet link, off-chain cosmetic currency (Marks) | **none** — signs nothing, costs nothing |
| **Token economy** (`server/economy/*`, `server/chain/*`, `server/econ/*`) | `WAYFARER` SPL token: earn from play, stake, bounded emission, claim to a verified wallet | **yes**, but only on an explicit server-side claim, never in the 15 Hz game loop |

A player who never touches a wallet must never notice either layer exists.

---

## 3. Decisions that are already made (do not re-litigate)

1. **Free-to-play first.** Gameplay, saves, co-op and gold are fully playable with the
   chain layer absent *and* with it present but unconfigured.
2. **The chain is never in the hot path.** No room tick, no `esnap`, no combat call may
   touch RPC. Earnings accrue server-side in the ledger and are **claimed**.
3. **`rpc.js` stays dependency-free and read-only.** A test enforces that its source
   contains no signing primitive. Only the payout path may sign.
4. **A wallet is a link, never the account.** It never gates entry, never becomes the
   identity. A wallet address is *public*, so a link is only a credential once it carries
   an Ed25519 signature over a relay-issued, single-use, expiring challenge.
   *(A signed-in-as-anyone takeover via an unsigned link was found and fixed on this
   branch — see `server/chain/README.md`. Never accept an unsigned wallet link.)*
5. **One source of truth for "is this device's wallet verified".** Two wallet-link
   implementations arrived with the merge (`/wallet/*` from the integration side,
   `/identity/*` from the WIP side). **`server/wallet.js` + `walletStore.js` is the
   authority** — it is what the shipped client codes against. `server/identity.js` keeps
   recovery codes; its `solana` kind must read the verified link from the authority, never
   keep a second copy. Any payout path must resolve the destination through that one
   authority.
6. **Payouts fail closed.** Dry-run unless `PAYOUTS_ENABLED === 'true'`. Refuse an
   unverified destination. Refuse when the float is outside
   `[HOT_FLOAT_MIN_RAW, HOT_FLOAT_MAX_RAW]`. Refuse below `MIN_CLAIM_RAW`. Debit the
   ledger *before* sending, keyed on a claim id, so a retry cannot pay twice; compensate
   visibly on a failed send.
7. **The mint is configuration, never a default.** A devnet address compiled in as a
   fallback is a mainnet foot-gun: it silently pays the wrong cluster. `WAYFARER_MINT`
   must be **required** for any chain-enabled path, and the process must say so plainly
   when it is missing.
8. **Integer money, round down, reject unknown input.** `server/economy/CONTRACT.md` is
   frozen: all amounts are integers in base units, rounding is always down, an unknown
   `stakeTier`/`feeKey` throws rather than defaulting. Curve numbers live in exactly one
   place per module and `server/economy/verify.mjs` cross-checks the copies.
9. **Rewards are per-kill, not per-hour.** The owner's rule (recorded in
   `server/rewards.js`): *"Remove idle gold accumulation, it should only be per-kill. The
   same goes for the cryptocurrency rewards distribution, it's only a certain type of
   enemy that receives a certain amount."* `server/economy/idle.js` therefore stays in the
   tree and tested, but **idle accrual is OFF by default** (`ECON_IDLE_GOLD=false`). Staking
   still earns: its return is paid from the bounded emission budget, which is what
   `stakeMath.returnFor` computes. Do not re-enable idle gold without the owner saying so.
10. **No private key material in the repo, ever.** `server/token/keys/` and
    `*.keypair.json` are gitignored. Never print a secret, never log one, never commit one.
    Public addresses are fine.

---

## 4. Environment (`server/`), the complete launch surface

Nothing below is set anywhere yet. The chain layer must degrade *quietly and visibly*
(one log line, no crash) when these are absent.

| Var | Required for | Meaning / default |
|---|---|---|
| `WAYFARER_MINT` | any chain path | The SPL mint (base58). **No compiled-in default.** |
| `CHAIN_CLUSTER` | chain paths | `devnet` \| `mainnet-beta`. Default `devnet`. |
| `CHAIN_RPC_URLS` | chain reads | Comma-separated, failover order. Without it `chainConfigured()` is false. |
| `CHAIN_SESSION_SECRET` | wallet sessions | ≥16 chars. Without it `chainSessionsEnabled()` is false. |
| `ECON_ENABLED` | earn/stake/claim | Default **off**. Read-only rate sheet may serve regardless. |
| `ECON_IDLE_GOLD` | idle accrual | Default **off** (owner's rule, §3.9). |
| `PAYOUTS_ENABLED` | signing | Default **off** → dry run, nothing is signed. |
| `PAYOUT_KEYPAIR_PATH` | signing | Path to the wallet the relay pays **from**. Default: the rewards keypair. |
| `MIN_CLAIM_RAW` | signing | Dust floor. Default `1_000_000` (1 token). |
| `HOT_FLOAT_MIN_RAW` / `HOT_FLOAT_MAX_RAW` | signing | Blast-radius bounds on the paying wallet. |
| `REWARDS_WALLET` / `TREASURY_WALLET` | display, ops | Public addresses shown in the client and `/chain/status`. |

`REWARDS_WALLET`/`TREASURY_WALLET` are optional in the strict sense (the relay can run
without them), but they are what the owner funds and must be discoverable without reading
the source.

---

## 5. Workstreams

Each workstream owns its files outright. **Do not edit a file another workstream owns** —
if a change needs it, note it in your report instead.

| WS | Owner files | Deliverable |
|---|---|---|
| **A** relay economy surface | `server/econ/**` (new), `server/index.js` | HTTP API + kill-credit hook wiring `server/economy/*` into the relay |
| **B** chain settlement | `server/chain/**`, `server/economy/payouts.js`, `server/identity.js`, `server/wallet.js`, `server/walletStore.js` | mint config, boot verification, the SPL transfer that pays a claim, and the single verified-wallet authority |
| **C** client chain UI | `src/ui/ChainPanel.js` (new), `src/net/chainNet.js` (new) | rates / balance / stake / claim panel, wallet-aware, harmless with no wallet |
| **D** launch ops | `server/token/**`, `docs/**` | mainnet-ready launch, mint metadata, `verify-launch.mjs`, runbook |
| **E** economy hardening | `server/economy.js`, `server/validate.js`, `tools/econ_audit_*.mjs` | close the open `econout-equipped-bypass` exploit + settle the inconclusive race probes |

---

## 6. Invariants every workstream must preserve (and test)

1. Solo play is unchanged with the chain layer absent, unconfigured, and configured.
2. No client can cause a payout: the destination is resolved server-side from a
   *signature-verified* link, never from a request body field.
3. No source string, log line or error message contains secret key material.
4. Amounts are integers in base units; every rounding path rounds down.
5. Unknown tier/fee/resource keys throw.
6. `server/chain/rpc.js` remains import-free and signing-free.
7. The client never imports from `server/` or `tools/` (Vercel does not upload them).
8. Every claim is idempotent on its claim id, and a failed send leaves a visible
   compensating ledger entry.

Report **real command output** for every claim. A test that has not been run is not a test.
