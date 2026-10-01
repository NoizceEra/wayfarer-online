# `server/chain/` — the grafted chain layer

Ported from **FOMMO / Forgers Online** (`D:/ai-studio/FOMMO`, private repo, scanned 2026-09-30)
onto Wayfarer Online. This file records what was taken, what was deliberately left behind,
and why — so the decision does not have to be re-litigated later.

## Decisions this layer implements

**REVISED 2026-09-30.** A new token, treasury/rewards wallets and fees were requested
after this layer was first built. Two of the four original rules were therefore replaced;
they are recorded here rather than deleted, because the reasoning still constrains what
the new code may do.

1. **Free-to-play first, still.** Wayfarer remains playable, complete and unmodified with
   the chain layer entirely absent. Nothing in the real-time path (Colyseus rooms, the
   15 Hz loop) may ever call the chain. Earnings accrue server-side and are *claimed*.
2. ~~**No token.**~~ **SUPERSEDED** — Wayfarer now has its own token, launched via
   `server/token/launch.mjs`. `$FORGERS` is still NOT reused (its authorities are all
   renounced, so it can only be distributed, never minted).
3. ~~**No new npm dependencies.**~~ **SUPERSEDED** — signing (mint, treasury transfers,
   reward payouts, fee collection) is impossible without a keypair and transaction
   construction, so `@solana/web3.js` and `@solana/spl-token` are now dependencies of the
   relay. The original boundary is preserved in the ONE place it still matters:
   **`rpc.js` stays dependency-free and read-only**, and a test enforces it. Reading the
   chain never requires the SDK; only spending does.
4. **Wallet is a link, never the account.** A proven wallet adds `links:[{kind:'solana'}]`
   to the player document. It never becomes the identity, and it never gates entry.
   It is now also the **payout address**, which raises the stakes: `/identity/link` for
   kind `solana` REQUIRES a signature over a relay-issued challenge, and
   `/identity/continue` refuses any wallet link not marked `verified:true`. Without
   those two rules a public address was a login credential — see "Verified vulnerability"
   below.


## Kept, and why

| Ported to | From FOMMO | Why it earns its place |
|---|---|---|
| `walletAuth.js` | `services/WalletAuthService.js` | The "continue on another device" path: a player proves control of a wallet with an Ed25519 signature. Its *purpose* is account recovery, not crypto. |
| `rpc.js` | `services/SolanaService.js` (read half) | verify-first chain reads: never trust a client's claim about the chain, re-ask the chain, require CONFIRMED + no error + exact destination/amount. |
| *(pending)* `receipts.js` | `services/NftBridgeService.js` (discipline only) | Claim-based ownership receipts written to the save after a server-side re-verification. |

Three disciplines were carried over wholesale because FOMMO got them right:

- **verify-first** — the chain is the source of truth, and a client assertion is a request
  to check, not a fact.
- **fail closed** — an RPC outage must never read as "verified". `verifyConfirmedTransfer`
  returns `ok:false` on every failure path, including a network error.
- **idempotent, atomic state changes** — FOMMO's bridge ledger used an idempotency key and
  remove-then-mint ordering so an item could never exist in two places at once.

## Left behind, and why

- **The token economy** (`TokenEconomyService`, `ForgersGoldSinkService`,
  `TokenIncineratorService`, `BankService`, `PvPEscrowService`, `AuctionService`,
  `MarketService`, `TournamentService`) — ~40 Mongoose-backed services. Two independent
  reasons: they assume MongoDB (Wayfarer's store is file-backed JSON), and importing a
  buy-in/burn/gold-sink economy would invert the "free-to-play first" priority by making
  currency-bearing activity depend on a wallet.
- **`SolanaService.js`'s write half** — treasury keypairs, mint, burn, swap, escrow. This
  is custody. Wayfarer holds no keys and signs nothing; `rpc.js` is read-only by
  construction and a test asserts the source never contains a signing primitive.
- **`NftMintAdapter.js`** (Metaplex Bubblegum cNFT mint/burn) — needs `@metaplex-foundation/umi`
  + `mpl-bubblegum` and a funded mint-authority keypair. FOMMO's own `docs/NFT_BRIDGE_PLAN.md`
  records steps 2/5/6 (devnet mint, round-trip, mainnet) as **never completed**: the adapter
  throws "not configured", so it has never minted a cNFT anywhere. Grafting it would add
  weight and dependencies for a path unproven even in its original repo.
- **FOMMO's `config/nftConfig.js` item map** — it tokenizes **stat-bearing** weapons
  (e.g. `'weapon:82'` Forged Blade, +120 ATK). That is the one pattern Wayfarer must not
  import: a stat item that lives on-chain cannot be rebalanced, and it invites farming.
  If Wayfarer ever tokenizes anything, it is cosmetics or a provenance badge — never stats.

## Facts verified on-chain (not taken from docs)

- `$FORGERS` = `3XQnwspiepPaC1iCRVL57aT44noDa9LtTgqFo69xpump`, live on mainnet,
  SPL **Token-2022**, name "Forgers Online", 6 decimals, supply **999,202,393.692793**.
- **`mintAuthority: null`, `freezeAuthority: null`, `updateAuthority: null`** — all
  renounced. A game reusing this token could only *distribute* from a pre-funded treasury;
  it could never mint rewards. This is the decisive fact against reusing it, independent of
  the design preference above.

## Engine-agnostic mismatch worth recording

FOMMO's client half is **240 KB of RPG Maker MZ plugins** (`PT/js/plugins/*`) driving DOM
overlays. Wayfarer is **Phaser 3**. That code is not portable in any mechanical sense — only
its server-side protocol shape was reusable.

## Verified vulnerability: wallet link → account takeover (found and fixed)

The identity layer shipped with `kind:'solana'` links that required **no signature**, and
`/identity/continue` minted a credential for *any* linked `(kind,id)` pair. Chained
together, a wallet address — which is public on-chain — was an account-takeover payload.

Proven with a throwaway PoC before fixing (`poc_takeover.mjs`, run against the live code):

```
SETUP   victim (guest) saves a character                 -> {name:"Hero", level:42}
STEP 1  victim links a recovery code                     -> 200
STEP 2  victim links their wallet, NO SIGNATURE          -> 200
STEP 3  ATTACKER supplies only the PUBLIC address        -> 200 {"token":"ejxaJR-ZtE4…"}
STEP 4  attacker token loads the victim's character      -> {name:"Hero", level:42}
VULNERABLE: takeover succeeded with a public input.
```

The attacker never held the victim's token, code, keypair, or any signature.

**The fix** (`walletAuth.js` + `identity.js`): `POST /identity/wallet-challenge` issues a
single-use, 5-minute, CSPRNG challenge; `/identity/link` for `solana` now requires a
signature over it and stores `verified:true`; `/identity/continue` refuses any wallet link
where `verified !== true`. Re-running the identical PoC now yields
`401 wallet_signature_required` → `404 code_unknown` → attacker token resolves to `null`.

Two lessons worth keeping:

- **A link kind is a login kind.** Any id accepted by `/identity/link` can be spent by
  `/identity/continue`, so an unauthenticated link is an unauthenticated login. Decide the
  strength of the credential when designing the link, not later.
- **The worker's own test suite asserted the vulnerable behaviour** (check F: "an unsigned
  wallet link returns 200" / 44- and 32-char addresses link), so all 21 of its checks
  passed while the hole was open. A green suite proves the code matches the *author's*
  expectations, not that the expectations are safe. The check is now inverted, plus a new
  check proves a legacy unverified link on disk cannot mint a credential.

## Configuration

Everything is inert until configured, and degrades cleanly when it is not:

- `CHAIN_RPC_URLS` (comma-separated, failover order) — required for any chain read.
  `chainConfigured()` returns false and calls error out rather than pretending.
- `CHAIN_SESSION_SECRET` (≥16 chars) — required to issue wallet sessions.
  `chainSessionsEnabled()` gates on it.

Neither is set anywhere yet, so this layer currently does nothing in production.

## Tests

- `node server/chain/walletAuth.test.mjs` — 36 checks: base58 vectors against real mints,
  Ed25519 sign/verify, replay refusal, expiry, tamper, cross-key, forged/tampered/expired
  session tokens, and that the nonce is CSPRNG-backed and persisted.
- `node server/chain/rpc.test.mjs` — 33 checks against a real local JSON-RPC server:
  failover, timeouts, malformed payloads, and the fail-closed rule for every
  `verifyConfirmedTransfer` path (not found / failed / unconfirmed / wrong destination /
  underpaid / errored meta / outage).

Both run with no network access beyond loopback and no dependencies.
