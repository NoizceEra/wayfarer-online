# Economy Hardening — Craft-Material Save Validation

Track scope: `server/economy.js`, `server/validate.js` (targeted patches only),
this doc (new). No other files touched. No new server→client message types.
No fee/treasury code touched.

## 1. Gap (from `docs/CRAFTING_EXPANSION.md`)

Crafting runs client-side over `player.mats` / `progress.ext.mats`. The server
persisted `ext` raw (size-bounded at 48 KB by `sanitizeExtras`, never
content-checked), so a tampered client could upload arbitrary material ids and
counts and the server stored them. Gear/gold/inventory are rev-checked;
materials were not.

## 2. Changes

### `server/validate.js` (+45 lines)

- `CAPS.matStack = 99` (== client `PACK_CAP`, `src/data/materials.js`),
  `CAPS.matGainBase = 30`, `CAPS.matGainPerSec = 0.5`: per-save gain
  allowance vs the previous server copy. ~3–4× headroom over any legit
  gather pace between saves (saves flush ≥8 s apart; a node yields 1–3).
- `isMatId()` over `server/shared/item_ids.json` `mats` (76 ids, array
  shape — unlike gear's id→meta map). Exported for the economy boundary.
- `validateSave()` mats block (mirrors the level/gold clamp pattern):
  - unknown ids dropped + reported (`mat-id …`); key count capped at
    catalogue size (`mat-keys …`); stacks capped at 99 (`mat-stack …`);
    non-counts dropped silently.
  - Subsequent saves: count per id may not exceed
    `prev + matGainBase + dt*matGainPerSec` (`mat-gain …` clamped entry).
    **Decreases (craft consumption, consumable use) are always accepted.**
  - First save: mats cleared (`first-mats …`), mirroring first-gold/
    first-level. A fresh token holds no materials.
  - All violations surface through the existing `clamped[]` → `saved`
    message + `save-clamp` violation log. No new message types.

### `server/economy.js` (+18 lines)

- `beforeSave()` mats strip at the authority boundary (runs before
  `validateSave`): unknown ids / non-counts dropped, over-cap stacks
  clamped to `CAPS.matStack`, reported via `suspicious(…, 'bad-mats', …)`.
  Mirrors the existing `econOut` dupe strip. Gain-bounding stays solely in
  `validateSave` (single source of rate logic, no divergence).
- Import line only otherwise (`isMatId`, `CAPS`).

## 3. Threat model

Attacker: tampered client, arbitrary save uploads, arbitrary message sends.
Assumptions: server copy (`store.js` per device-token+name) is truth;
gathering/crafting simulation on the client is **unobservable** by the server.

| Attack | Before | After |
|---|---|---|
| Mint unknown mat ids via save | stored raw | dropped at both layers, logged |
| Mint 9999× real mat via save | stored raw | clamped to 99, then gain-clamped to prev+allowance |
| First-save mat mint (fresh token) | stored | cleared |
| Resurrect consumed mats (craft refund fraud) | unbounded re-upload | re-upload bounded by gain allowance; bulk restore clamped + logged |
| Patient trickle (stay under allowance) | — | **NOT closed**: ~30/save/id every ~8 s remains possible |

The last row is structural: the save path cannot *prove* gathering happened.
The allowance is a rate bound + anomaly signal (`save-clamp` violations are
auditable), not a proof. Closing it requires server-authoritative
gather/craft operations (recipe id + input check + output grant as an
economy mutation) — recorded as the follow-up, deliberately out of scope
here. Grandfathered over-cap stock from before this change is clamped to 99
on next save (matches the client cap; mats are re-gatherable, unlike gear —
which is why saves filter mats but deliberately do NOT filter gear).

## 4. Anti-forge coverage (no new types)

This change emits zero new server→client types (strips are silent; clamps
reuse `saved`/`econ-error`/`econ-msg`). Verified every type `economy.js`
sends is covered:

- Swallow/no-op registered (`install()` list): `econ-state`, `econ-sync`,
  `econ-msg`, `econ-error`, `trade-open`, `trade-update`, `trade-result`,
  `trade-closed`, `trade-done`, `escrow-open/update/result/closed`,
  `market-page`, `mail-box`, `mail-unread`, `guild-info`, `guild-update`,
  `saved`, `referral-state`, `referral-paid`, `worldboss-announce/state/slain`,
  `token-spend-ok`, `wallet-bind-challenge`, `wallet-bound`,
  `token-withdraw-result`, `token-deposit-result`, `token-bridge-state`.
- Sent but not in the list, all safe by same-name registration (a specific
  handler exists, so colyseus never falls through to the `'*'` passthrough;
  a forged send only reaches the real handler, which acts on
  server-constructed payloads or as the sender itself): `trade-request`,
  `escrow-request`, `guild-invite` (each has an `on(…)` client→server
  handler in `install()`).
- Nothing was added to or removed from the swallow list.

## 5. Fee/treasury conservation review

No fee/treasury code was touched (`git diff` shows only the import line and
the `beforeSave` mats block in `economy.js`). Reviewed for conservation:

- `market-post`: `tax = max(1, ceil(price*5%))` deducted via `mutate`,
  never refunded (cancel returns the item only). Exact sink.
- `market-buy`: buyer −price, seller +price via system mail. Conserved.
- `mail-send`: `cost = gold + 5` postage deducted, recipient gets `gold`.
  5 g sink. Exact.
- `token-claim`: gold fee destroyed exactly; split
  `treasuryFee = floor(fee/2)`, `referralBonus = fee − treasuryFee`
  (sums to `fee` exactly; bonus paid in tokens via
  `referrals.payReferralTokenBonus`, treasury via `recordFee`).
- `token-withdraw`: fee `max(1, floor(amount*7.5%))`, `net = amount − fee`
  minted; `floor(fee/2)` to treasury, remainder burned. Exact.
- `guild-deposit/withdraw`: player ±gold == bank ∓gold. Conserved.
- **Observation (pre-existing, NOT introduced or fixed here):** escrow fee
  splitting uses per-side `Math.round(fee * share)`, and the two rounded
  shares can exceed the reported fee by 1 g (verified: 1 g+1 g swap and
  100 g+100 g swap each destroy fee+1). ≤1 g unreported sink per escrow,
  always a sink, never a mint. Left untouched: altering it changes
  `trade-result` amounts and is outside this track's scope.

## 6. Verification

- `node --check server/economy.js` → pass; `node --check server/validate.js`
  → pass.
- Targeted diff: `economy.js` 84850 → 86223 B (+1373, 19+/1− lines),
  `validate.js` 8426 → 11361 B (+2935, +45 lines).
- Unit probes of `validateSave` (no relay): unknown ids dropped, 999→99→
  gain-clamped with both entries reported, consumption passes clean,
  first-save cleared, mat-free saves produce no clamp noise.
- `node tools/econ_test.mjs` → **35/35 PASS** (`ECON OK — 35 checks passed`).
- `node tools/econ_audit_dupes.mjs` → **13 probes, 0 exploited,
  0 inconclusive** (`RESULT: no critical/high duplication reproduced`).
- Gate rule honored: no test expectations edited; on any regression the
  change would have been reverted (none occurred).
- Environment note: both harnesses abort with `stdin is not a tty` when
  launched as background/piped shell tasks; foreground runs with output
  redirected to a log file work (rc carries the real result).
