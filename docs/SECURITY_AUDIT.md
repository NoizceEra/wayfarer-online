# Wayfarer Online — security & correctness audit

Scope: `server/*` (all modules), `server/guild/*`, `programs/wayfarer_token`, client net code and DOM
panels (`src/net/*`, `src/ui/*`). Base: master `61b786e`. Owner principle: play first, earn second;
wallet optional; nothing value-bearing may be exploitable.

Verification: `node --check` on every server file, `npx vite build`, and `node tools/econ_test.mjs`
(35/35 wire checks) pass after the fixes. Wire-level PoC scripts and a dedicated
`tools/security_test.mjs` suite were **not** delivered in this pass (see "Untested").

## Findings

| # | Sev | Area | Finding | Status |
|---|---|---|---|---|
| SC-1 | Critical | `programs/` | `mint_withdraw` accepted **any** signer as "oracle" — nobody checked it against a registered key, so anyone could mint unlimited $WAYFARER. `initialize` was also callable by anyone first. | Fixed: config stores `admin` + `oracle`, `has_one = oracle`, init restricted to the upgrade authority, per-tx + per-day caps, checked `total_minted`, `paused` (starts paused), admin `set_oracle/set_paused/set_limits/set_admin`. Not compiled locally (CI builds it). |
| V-1 | Critical | `validate.js` | `wayfarerTokens` came straight from the client save (up to 1e9), then went out through `token-withdraw`. | Fixed: server-owned; a save always keeps the previous server value. |
| V-2 | Critical | `validate.js` | The daily bridge cap (`ext.bridgeDailyClaimed`) could be reset by a save. `stake`, `stashTabs`, orb upgrades and `arena` could also be forged that way. | Fixed: `SERVER_EXT_KEYS` are always copied from the server copy. |
| V-3 | High | `validate.js` | `tokenPoints` had no limit on how much a save could add, and they feed `token-claim`. | Fixed: per-save gain allowance (`tpGainBase` 300 + 2/s); a first save starts at 0. This is a rate bound only (see residual R-1). |
| G-1 | Critical | `guild/guildService.cjs`, `index.js` | A negative `guild:contribute` amount called `deductGold(-N)`, which minted gold. Strings and floats produced NaN gold. Gold was charged before validation (create/over-cap). No rev bump. | Fixed: whole positive amounts only, validation happens before charging, only the capped amount is charged, rev bump + `econ-sync`. |
| G-2 | High | `guild/*` | Prototype pollution: `guild:promote {playerId:'__proto__'}` wrote `Object.prototype.rank` for the whole process. | Fixed: session-id format check, reserved-key refusal, own-property lookups. |
| G-3 | Medium | `guild/guildService.cjs` | Guild names had no length bound, and each guild state is broadcast to every room (traffic amplification). | Fixed: 24-char name, `[A-Z0-9]{2,4}` tag. |
| B-1 | High | `economy.js` | Race in SQLite mode (the only mode where the bridge works): `token-withdraw`/`token-deposit` awaited I/O between loading and saving a fresh record copy. Concurrent requests could each spend the same balance, or a deposit could overwrite a withdrawal. | Fixed: per-character async lock around all economy handlers. Awaits now run before the synchronous load→check→debit, and the deposit reloads the record after the RPC call. |
| B-2 | High | `economy.js`, `db.js` | Daily caps were per character, so 12 characters per device meant 12× the cap on one wallet. | Fixed: per-wallet daily cap from `bridge_withdrawals` (`BRIDGE_WALLET_DAILY_CAP`, default 500). |
| B-3 | Medium | `economy.js` | The withdraw ledger row was written only after the mint. A crash or timeout meant an untracked debit or mint. | Fixed: a `sending` row is inserted before the mint and updated to `sent`/`pending` afterwards. |
| B-4 | Medium | `economy.js` | The server instruction did not match the program (extra treasury account, wrong config offsets), no ATA was created, and decimals were trusted from env. | Fixed: account list matches the program, `CONFIG_LAYOUT` is documented, idempotent ATA create, on-chain decimals/oracle/paused/per-tx checks before sending. |
| B-5 | Medium | `economy.js` | Deposits were credited at `confirmed` commitment. | Fixed: `finalized`. |
| B-6 | Medium | `economy.js` | The wallet-link message had no domain or character binding. A relayed signature (phishing) could bind a victim's wallet and claim the victim's deposits. Nonces could be retried after a bad signature. The base58 decoder mis-sized all-'1' input, and non-canonical addresses were accepted. | Fixed: SIWS-format message (domain, chain, character, expiry), nonce consumed on any attempt, canonical base58 required. |
| B-7 | Medium | `config.js` | The bridge went live as soon as keys were present. The placeholder program ID could be used. | Fixed: `BRIDGE_WITHDRAW_ENABLED` / `BRIDGE_DEPOSIT_ENABLED` default OFF; placeholder IDs are refused, with a boot warning. |
| B-8 | Medium | `economy.js` | Staked tokens had no release path (permanent loss). | Fixed: a matured stake is returned on `econ-hello`. |
| W-1 | High | `worldBoss.js` | `onMessage('ehit'/'hit')` **replaced** the room's combat handlers (colyseus keeps one handler per type). This broke hit relaying and bypassed rate buckets. The area authority could also kill the boss instantly with any damage value and any credited player (gold + token points). | Fixed: room hooks `onEnemyHit/onHit` instead of handler override, 400/hit + 220 DPS per contributor, credited player must be in range, 45 s minimum fight, rewards bump rev + `econ-sync`. |
| R-1 | High | `referrals.js` | Milestones read the **raw** client level before validation, so a fresh alt claiming level 99 triggered lv5+lv10 payouts. | Fixed: uses the server copy's level, minimum bind age (1 h / 3 h), and a per-referrer daily cap (`REFERRER_DAILY_MAX`, 5). |
| P-1 | Medium | `WayfarerRoom.js` | The generic passthrough relayed any unhandled type, so a client could forge `welcome`, `correct`, `snap`, `notice`, `saved`, `whisper` etc. to its peers. | Fixed: allowlist `PASSTHROUGH_TYPES` (`pb-cmd`). |
| A-1 | Medium | `arena.js` | Either participant could report itself as winner. Ratings were also client-saveable (see V-2). The rematch cooldown was reset by reconnecting. | Fixed: a result settles only as a concession or when both reports agree, conflicting reports void the match, cooldown keyed per character too, maps pruned. |
| S-1 | Medium | `social.js` | `party-accept` / `duel-respond` worked without an invite, so a player could force-join a party or force a duel. | Fixed: invites/challenges tracked with a TTL. |
| X-1 | Low | `src/ui/SocialPanels.js`, `social.js` | Peer `job` (presence) was put into `innerHTML` unescaped (16-char HTML injection). | Fixed: escaped on the client, identifier-sanitized on the server. |
| N-1 | Low | `store.js`, `WayfarerRoom.js` | A character name of `__proto__`/`constructor` resolved inherited keys in the device doc. | Fixed: own-property lookups, reserved names map to `Wayfarer`. |
| D-1 | Low | `leaderboard.js` | The cache was keyed by type+limit, so a client could force about 500 full synchronous store scans per minute. | Fixed: one cache entry per type, sliced. |
| D-2 | Low | `economy.js` | Each room `install` leaked 2 intervals forever (party rooms are cheap to create). | Fixed: per-room timers cleared via a new `onDispose` hook. |
| D-3 | Low | `petDuel.js` | `turn`/`hpSync` relayed payloads of any size. | Fixed: 2 KB cap. |
| C-1 | Low | `economy.js` | A failed trade execution left `s.executing` stuck, so the trade could never complete. | Fixed. |
| I-1 | Info | `referrals.js` | The referral "token bonus" is recorded and displayed but never credited. It is not exploitable, but the UI promises something that never arrives. | Open (product decision). |
| I-2 | Info | `season.js`, `dungeonMatch.js` | These modules export no `install`, so they are inert server-side. The season leaderboard reads client-owned `ext.season.xp`, and the pets leaderboard reads client `ext.pets`. Both are forgeable but cosmetic. | Open. |
| I-3 | Info | escrow | The fee rounding can destroy fee+1 g (always a sink). | Open (known). |
| I-4 | Info | `guild/*` | The GuildService state is in memory and keyed by sessionId. Guilds bought for 2000 g vanish on reconnect or restart. | Open (correctness). |

Secrets: no private keys, seeds, keypair arrays, RPC keys or `.env` files were found in the tree or in
git history (`git log --all -p`, searched for 32+-int arrays, PEM blocks, provider key prefixes,
`ORACLE_KEYPAIR=`/`*_KEY=` assignments). Only `.env.example` with empty values and the public devnet RPC
URL are tracked. SQL is parametrized throughout (`db.js`, `referrals.js`). Store paths use sha256 of
the device token (no traversal). CORS `*` applies only to read-only GET routes with no credentials. The
HTTP limiter ignores `X-Forwarded-For` unless `TRUST_PROXY_HOPS` is set.

## Residual risks

- **R-1 (fundamental): rewards are simulated on the client.** Kills, loot, token points and items are
  produced by the client. The server only applies rate bounds, and a patient farmer (or many sybil
  devices and wallets) can stay under them. Any redeemable token value built on this can be farmed.
  Withdrawals must stay off until earning is server-authoritative (or until withdrawable value is
  limited to sources the server can prove).
- Item mint via save (any whitelisted gear id) still exists in principle (`docs/audit/dupes.md` F4
  lineage). Gold cannot grow via save (`goldPerSec` 0), so this is in-game only.
- Sybil referrals across devices remain possible. They are only paced (age + daily cap), and payouts
  come only from the fee pool.
- The overflow bucket of the HTTP limiter can be exhausted by a very large IP pool (DoS only).
- The program was not compiled here. The constraint syntax targets Anchor 0.30.1; the CI
  `anchor-build` workflow is the gate.
- A mint timeout followed by a later landing can leave a `pending` row whose mint actually succeeded.
  Operators must reconcile on-chain before re-sending.

## Pre-launch checklist (before enabling redeemable value)

1. Replace the placeholder program ID (`declare_id!` and `Anchor.toml`, currently
   `36Mtxdw…Cj9Aa`, which the server refuses) with a freshly generated keypair. Build in CI and get an
   external audit of `lib.rs`.
2. Put the upgrade authority and the `admin` role on a multisig (e.g. Squads), or make the program
   immutable once stable.
3. Keep the oracle key in a KMS/HSM or a dedicated signer service, never in a plain env var on a shared
   host. Rotate it with `set_oracle`, and fund it minimally.
4. Set conservative on-chain `max_per_tx` / `daily_cap`. Mirror them with `BRIDGE_WALLET_DAILY_CAP` and
   `ECON.TOKEN_WITHDRAW_DAILY_CAP`. Unpause only after review.
5. Monitoring and alerting: `bridge_withdrawals` rows in `sending`/`pending`, mint volume against
   caps, `anticheat` `save-clamp tp`/`tokens` spikes, and the ledger. Add a runbook for `set_paused(true)`.
6. Reconciliation job: on-chain mints against `bridge_withdrawals`, and treasury inflows against
   `bridge_deposits`.
7. Make earning server-authoritative (see R-1) before `BRIDGE_WITHDRAW_ENABLED=1` on mainnet.
8. Get legal/compliance review (securities/money-transmission, KYC/sanctions screening, ToS, regional
   restrictions) before any redeemable value. Keep the bridge devnet-only until then.
9. Use `USE_SQLITE=1` with the volume backed up. Bridge ledgers live only there.
10. Write a regression suite covering every row above (not yet delivered, see below).

## Untested

- No wire-level PoC or regression tests were written for the new findings. Only `econ_test.mjs`
  (existing behaviour) was rerun.
- SQLite-mode bridge paths, the wallet-link SIWS flow, referral pacing, arena consensus, the world-boss
  caps and the guild fixes have not been exercised end to end.
- The Anchor program was not compiled. The live mint/deposit paths were never run against a cluster.
