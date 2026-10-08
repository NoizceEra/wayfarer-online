# Arena prize policy foundation

server/arenaRewards.cjs is a side-effect-free accounting policy for a possible
entry-funded arena pool. It is not connected to arena matchmaking, agent
runtime, wallets, a database, or a chain. No prize currency is currently
accepted, escrowed, or paid by this module.

## Accounting model

A pool quote uses a fixed entry amount in integer base units and a list of
unique entrant IDs. It supports:

| Currency | Precision used by the policy |
| --- | ---: |
| WAYFARER | 9 decimal places; token base units |
| SOL | 9 decimal places; lamports |
| USDC | 6 decimal places; USDC base units |

The quote computes grossPool = entry × entrant count, platformFee =
floor(grossPool × feeBps / 10,000), and winnerPayout = grossPool -
platformFee. Integer arithmetic avoids floating-point rounding; any division
remainder remains in the winner payout. The policy bounds entrant count, entry
amount, total pool, and fee (at most 20%). These defaults are guardrails, not
an approved economic configuration.

Entrant IDs must be authenticated and deduplicated before calling the policy.
The module does not decide whether an entrant is a human or an autonomous agent,
whether they are eligible, or whether their entry funds have actually arrived.

## Settlement intent and idempotency

The suggested lifecycle is OPEN → LOCKED → SETTLEMENT_PENDING → SETTLED.
OPEN and LOCKED pools may instead transition to VOID; a pending settlement
may be marked VOID only after the caller has established that the payout
cannot complete. SETTLED and VOID are terminal. Repeating the current state
is treated as an idempotent no-op, and other invalid transitions are rejected.

settlementIntent() returns a deterministic key in the form
arena:<matchId>:<currency>. A future service must store that key under a
unique constraint and persist a settlement intent in the same durable
transaction that reserves the winner's liability. It must then reconcile
submission and confirmation using the same idempotency key. A network timeout
must not cause a second payment. This module does not create or persist that
record and its state helper is not a durable state machine.

The policy refuses to create an accepted settlement intent unless all gates
are explicitly true: payouts enabled, durable ledger available, custody
configured, treasury funding verified, battle result verified, and an
idempotency store available. Every gate defaults to false.

## Current availability and production requirements

**Live prizes remain unavailable.** This policy is not integrated into active
arena code and does not accept entry deposits. Even after integration, live
prizes must remain disabled until the system has both:

1. An atomic balance ledger or escrow that records funded entries and reserves
   the pool and platform fee without allowing double-spend or overdraw.
2. Battle outcomes verified by trusted server-side simulation or another
   auditable adjudication path. Client-reported winners are not sufficient for
   payable matches.

Before enabling any currency, production work also needs a durable database
schema with unique match/idempotency constraints; deposit confirmation and
refund handling; custody and payout signing with key isolation; treasury
reconciliation and solvency monitoring; retry/recovery rules for uncertain
chain submissions; abuse controls, match eligibility and anti-collusion rules;
operator pause and dispute procedures; and operational review of the prize and
fee configuration. SOL and USDC additionally need their own funded Solana
accounts and verified token/account handling. WAYFARER needs its token-specific
custody and payout path. This code supplies none of those services.

No balances, treasury funding, wallet keys, or chain transactions are created
or implied here. In particular, a quote is arithmetic over proposed amounts,
not evidence that the pool exists or is solvent.
