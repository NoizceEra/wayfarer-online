# REWARDS AND COMPLIANCE — risks that ship with a public reward token

**This is not legal advice. Nothing here claims that any configuration is lawful in any
jurisdiction or for any person.** It is an engineering-written risk note for the team and for
counsel, listing what changes legally the moment a token with real or perceived value is
distributed to players. Counsel decides; this document does not.

It complements `docs/EARN_AND_COMPLIANCE.md` (off-chain Marks and the optional wallet link) and
`docs/TOKENOMICS.md` (the published economy). Read all three together.

---

## 1. What actually changed

The off-chain build distributed **Marks** — non-transferable, non-purchasable cosmetics, with
`POST /wallet/claim` hard-off. That is not this product. As of `blockchain/v1`:

- `$WAYFARER` is a **real, transferable SPL token on Solana mainnet**, launched on pump.fun.
- It is **earned from play** (boss kills) and by **staking**, and it is **claimed to a
  signature-verified wallet** — i.e. it leaves the operator's control and becomes the player's
  asset, tradeable on an open market.
- The stake design pays a **bounded emission** (a "return"). Even labelled as dilution, a
  marketing reader may hear "yield".

Each of those is a distinct legal fact, not a UI detail. A transferable, market-priced,
play-earned token with a staking return is a different legal product from a cosmetic score.

---

## 2. Risk areas (non-exhaustive — counsel must expand this)

### Securities / investment-contract exposure
A transferable token, a yield, a "treasury", or marketing that presents the token as an
investment can be characterised as an investment contract or a security (Howey and analogues in
many jurisdictions). Concretely relevant here:

- **A staking return** (`TOKENOMICS.md` §3) is the single most security-flavoured element. It is
  paid from a bounded emission of the token itself — but the *label* matters less than the
  expectation created.
- **Marketing language.** "Earn money", "APY", "passive income", "rewards" framed as financial
  return, or a roadmap that implies token appreciation all increase securities and
  mis-selling exposure. See the wording rules in §4.
- **Emission is dilution, not revenue.** There is no external revenue paying the staking return;
  it is paid in newly-*distributed* (not newly-minted — the supply is fixed) tokens from a funded
  wallet. That must be described accurately and never as "yield".

### Gambling / chance-for-value
Boss kill-timing is skill-based, but any reward whose value can be cashed out, and any
randomised reward with real-world value, can fall under gambling and prize statutes. If a
paid or chance-based route to a valuable token is ever added, this area is squarely in scope.
Currently the token is earned by play, not by paying or by chance — keep it that way.

### Money transmission / virtual-asset rules
Letting players cash out, swap, or hold a balance redeemable for money or crypto can trigger
money-transmitter, e-money, and virtual-asset service rules. The relay pays tokens to wallets;
it does not run an exchange. Anything that starts to look like a redemption desk or an on-ramp
is a new regulatory product.

### Sanctions / geoblocking / screening
Wallet addresses and IPs can belong to sanctioned persons. A value-bearing distribution needs a
sanctions program: geoblock lists, address screening, and a kill-switch wired to the claimer
**before** the first payout. Tokens are permissionless once sent — they cannot be recalled.

### KYC / AML / age
Redeemable rewards typically require identity, age and source-of-funds checks. A device token is
**not** an identity, and a signature-verified wallet proves control of a key, not a person.

### Tax
If anything of value is distributed, the operator and the player may each have reporting and
withholding obligations (who is the payor, which form, which threshold). Decide this with a tax
adviser before enabling value, not after.

### Privacy
Wallet addresses are personal data in some regimes. The leaderboard defaults to a display name
and must never show an address without opt-in. Keep audit logs off the client.

### Consumer / games law and fairness
"Earn" marketing, paid random rewards, and loot-box rules vary across the EU, UK, US states and
APAC. Earning and linking must stay optional and must never affect power (a product rule and a
compliance input).

### Pump.fun-specific facts that constrain us
The mint is a standard SPL token whose **supply is fixed and whose mint authority is pump.fun's,
not ours** (`docs/LAUNCH_RUNBOOK.md` §0). Consequences for compliance and comms: we cannot mint
more (good — no hidden inflation), but we also cannot burn or recall what we send, and the token
is transferable and market-priced from birth. Treat every unit we distribute as gone.

---

## 3. Facts that make this defensible (and the lines we must not cross)

- **Free-to-play first.** The game is complete and playable with no wallet and no token; the
  token gates nothing. This must stay true.
- **No purchase, no pay-to-earn, no cash-out.** The token is earned by play and distributed from
  a funded wallet. There is no operator-run market, redemption desk, or swap.
- **Fixed supply, no operator minting.** We cannot inflate. The funded rewards wallet is the hard
  ceiling (`TOKENOMICS.md` §2).
- **Bounded emission, decaying, capped at 5 % of supply as an accounting bound** — and in
  practice bound by the funded wallet.
- **Signature-verified destination.** Payouts go only to a wallet that signed a single-use
  challenge; no client names its own destination.

Do not let marketing, a roadmap, or a Discord answer break any of the above.

---

## 4. Wording rules for launch comms (enforced, not aspirational)

- **Never** say or imply: earn money, income, salary, APY, yield, passive income, investment,
  "the price will", guaranteed return, or an expectation of profit.
- **Say instead:** "optional reward currency", "a token you can earn by playing bosses",
  "bounded emission", "not required to play".
- **PLAY FIRST applies to the launch comms too.** The token is never advertised as a
  prerequisite for anything. No copy may suggest the game is pay-to-earn or that playing
  produces income.
- State plainly that the token has **no promise of value, liquidity or listing**, and that
  rewards depend on a wallet we fund — not on a mint we control.

---

## 5. Checklist before enabling redeemable or cash-out value

Do **not** enable any redeemable, cash-out, swap, or operator-run market, and do not raise the
float beyond the blast-radius cap, until all of the following are done:

1. **Written opinion** from qualified counsel in **every** launch region, covering securities,
   gambling, money transmission, virtual-asset rules, consumer, tax, sanctions, KYC, age and
   privacy — specifically for *this* product (play-earned transferable token + staking
   emission).
2. A **named legal owner**, a kill-switch, and a geoblock/screening list wired to the claimer
   **before** the first payout.
3. **No production key material in the repo, in a client bundle, or in CI logs.** Paying keys
   live in a KMS/HSM with dual control outside the repository (`docs/LAUNCH_RUNBOOK.md` §7).
4. **KYC/age** vendor, **sanctions screening**, and a complaints/refund path.
5. **Terms of service, privacy notice, and marketing review** completed against the wording
   rules in §4.
6. **Independent threat model**: stolen device tokens, stolen wallets, support social
   engineering, replay, and float exhaustion.
7. **Tax reporting design** (payor, form, threshold).
8. A **staged flag** so the token can ship as play-only rewards while the above is in progress.

Until then: the token is an optional, play-earned reward with no promised value, payouts are
capped by the funded float, and `PAYOUTS_ENABLED` can be set to `false` to stop all signing
instantly (`docs/LAUNCH_RUNBOOK.md` §7).
