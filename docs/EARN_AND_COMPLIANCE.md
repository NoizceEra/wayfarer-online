# Wayfarer Marks, optional wallet link, and compliance

This document describes how Wayfarer Online handles **optional** wallet linking and
**off-chain Wayfarer Marks**. It is a design note for the team and for counsel.
**It is not legal advice. It does not claim that any configuration is lawful in
any jurisdiction.**

Nothing in the current build pays real money, mints a token, swaps, stakes, or
submits an on-chain transaction.

## Product design (this build)

- **Playable with no account and no wallet.** Guests earn Marks, buy cosmetics,
  and finish the game. The title screen never auto-prompts a wallet. Earning
  never gates combat, exploration, gold, XP, or items.
- **Optional wallet link.** A player may connect an injected Solana provider
  (Phantom / Backpack / Solflare) and **sign a message** that binds that
  address to this browser's anonymous device token. The message states that the
  signature does not cost anything and cannot move funds. The client never
  calls `signTransaction`, never holds a seed or private key, and never talks
  to an RPC for this feature.
- **One wallet per device, one device per wallet.** Unlink is unsigned (device
  possession). Moving a wallet to a new device is a fresh `relink` signature
  with a cooldown. Nonces are single-use, short-lived, and rate-limited.
- **Wayfarer Marks** are an off-chain, non-transferable, non-purchasable
  progress counter keyed by device. Every player earns them (guest or linked)
  for playing: first-clear bosses/dungeons, quest chains, achievements, daily
  login (5 active minutes), world events, level milestones. The server is
  authoritative when online; solo/offline the same rules run locally and the
  server recomputes from milestones later.
- **Anti-farm.** No per-kill income. One-time awards are once per device.
  Repeatable sources use per-character baselines, minimum intervals,
  diminishing returns, per-source daily caps, a variety rule, and a global
  daily cap. Level gates use the server-validated level. Trivial kills are
  ignored.
- **Sinks.** Marks spend only in the in-game Marks Shop, on **cosmetics**
  (titles, nameplate frames, name colours). They never grant gold, XP, stats,
  items, or power.
- **Optional perks (flags).** Founder / season nameplate frames are off-chain
  attestations on a linked wallet. The seasonal Marks leaderboard shows a
  display name; the wallet address is never public unless the player opts in.
- **Hard-off stubs.** `POST /wallet/claim` always returns `not_enabled`.
  `FEATURE_REDEEMABLE_REWARDS` and `FEATURE_ONCHAIN_CLAIM` are hard-off in
  `flagsPublic()` regardless of env. Do not ship a build that flips them
  without the checklist below.

## Feature flags

Cosmetic / non-value flags default **on**. Value-bearing flags default **off**
and are ignored by this build even if set.

| Env | Default | Meaning |
| --- | --- | --- |
| `FEATURE_WALLET_LINK` | on | Optional SIWS-style device link (`signMessage` only) |
| `FEATURE_MARKS` | on | Off-chain Marks + cosmetics shop |
| `FEATURE_LEADERBOARD` | on | Seasonal opt-in display-name board |
| `FEATURE_FOUNDER_BADGE` | on | Cosmetic frame if first-linked before `FOUNDER_CUTOFF` |
| `FEATURE_SEASON_BADGE` | on | Cosmetic frame at `SEASON_BADGE_MARKS` this season |
| `FEATURE_REDEEMABLE_REWARDS` | **off / hard-off** | Not implemented |
| `FEATURE_ONCHAIN_CLAIM` | **off / hard-off** | `/wallet/claim` always 403 `not_enabled` |
| `MARKS_SEASON` | `s1` | Season id on Marks docs and the board |
| `WALLET_DOMAIN` | empty | If set, challenge `Origin` host must match (comma-separated) |
| `WALLET_NONCE_TTL_S` | 300 | Challenge lifetime |
| `WALLET_RELINK_COOLDOWN_H` | 24 | Move-wallet cooldown |

## Signed-voucher format (not implemented)

If counsel ever approves a redeemable or collectible claim, a **voucher** is a
server-issued, off-chain statement the client could present to a future
claimer. This build does **not** issue vouchers, does **not** store signing
keys, and does **not** contain on-chain programs.

A voucher **would** be a canonical JSON object, UTF-8, field order as below,
signed with Ed25519 over the bytes of that JSON:

```json
{
  "v": 1,
  "iss": "wayfarer.online",
  "sub": "<base58 solana address>",
  "aud": "wayfarer-claim",
  "jti": "<opaque unique id>",
  "iat": 0,
  "nbf": 0,
  "exp": 0,
  "nonce": "<opaque>",
  "kind": "attest",
  "ids": ["founder", "season:s1"],
  "season": "s1",
  "device": "<16-hex prefix of device key>",
  "stmt": "Off-chain attestation only. Not a security, not redeemable, cannot move funds."
}
```

- `kind` is `attest` (cosmetic) or, only after legal sign-off, a future
  `claim` kind with an explicit `asset` id and `amount` of 0 until a real
  asset exists.
- The signature is 64-byte Ed25519, base58, over the exact JSON the server
  stored. Verification is the same SPKI-prefix path as wallet link
  (`302a300506032b6570032100` + 32-byte pubkey).
- Vouchers are **not** transactions, **not** tokens, and **not** transferable
  by players. A future claimer would re-check server-side attestations, KYC
  gates, geoblocks, and remaining balance before doing anything else.
- Until that exists, `POST /wallet/claim` returns `{ ok: false, error: "not_enabled" }`.

## Risk areas (non-exhaustive)

Counsel should treat the following as open questions **before** any
redeemable, cash-out, tradable, or on-chain reward is enabled. This list is
not complete.

- **Securities / investment contracts.** A transferable token, a yield, a
  profit share, a “player treasury”, or a scheme where Marks are marketed as
  valuable can look like an investment contract (Howey and analogues). Marks
  in this build are non-transferable cosmetics. Changing that is a new
  product.
- **Gambling / loot / chance-for-value.** If a spend of Marks (or a wallet
  action) can produce a prize with real-world value, many gambling and prize
  statutes may apply. Cosmetics-only avoids that only while they stay
  without cash value and without secondary markets the operator runs.
- **Money transmission / stored value.** Letting players cash out, swap, or
  hold a balance redeemable for money or crypto can trigger money-transmitter,
  e-money, and virtual-asset rules.
- **Sanctions / geoblocking.** Wallet addresses and IPs can be used by
  sanctioned persons. Any value-bearing feature needs a sanctions program
  (geoblock, address screening, kill-switch).
- **KYC / AML / age.** Redeemable rewards typically need identity, age, and
  source-of-funds checks; a device token is not an identity.
- **Regional consumer / games law.** Loot boxes, paid random rewards, and
  “earn” marketing have specific rules (e.g. various EU, UK, US state, and
  APAC regimes). Marketing copy must not promise income.
- **Tax.** If anything of value is distributed, the operator and the player
  may have reporting and withholding obligations.
- **Privacy.** Wallet addresses are personal data in some regimes; the
  leaderboard defaults to a display name and never shows the address unless
  opted in. Audit logs hash IPs per process and must not be shipped to the
  client.
- **Consumer fairness / pay-to-win.** Earning and linking must stay optional
  and must not affect power. That is a product rule and a compliance input.

## Checklist before enabling redeemable rewards

Do **not** flip `FEATURE_REDEEMABLE_REWARDS` or `FEATURE_ONCHAIN_CLAIM`, ship
a mint, a swap, a stake, a payout, or a live voucher signer until all of the
following are done:

1. Written opinion from qualified counsel in every launch region covering
   securities, gambling, money transmission, consumer, tax, sanctions, KYC,
   age, and privacy.
2. A named legal owner, a kill-switch, and a geoblock list wired to the
   claimer **before** keys exist.
3. No production private keys or seeds in this repository, in client
   bundles, or in CI logs. Signing keys live in a KMS/HSM with dual control.
4. KYC/age vendor, sanctions screening, and a complaints / refund path.
5. Terms of service, privacy notice, and marketing review (no “earn money”,
   no APY, no investment language).
6. Independent threat model: stolen device tokens, stolen wallets, support
   social engineering, replay, and insolvency of any prize pool.
7. Tax reporting design (who is the payor, which form, which threshold).
8. A staged flag: cosmetics-only in production until the above is signed.

Until then, Marks remain a score, the shop remains paint, and `/wallet/claim`
stays `not_enabled`.
