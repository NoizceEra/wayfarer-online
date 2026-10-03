# Wayfarer Online — Blockchain Escrow Trading Architecture

## Overview

This document describes the in-game escrow trading system that allows players to trade items and gold securely with a 2.5% platform fee. The architecture supports both a server-authoritative implementation (immediate) and a Solana blockchain integration (future phase).

---

## 1. Data Flow

```
┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│ Player A │        │  Server  │        │  Escrow  │        │ Player B │
└────┬─────┘        └────┬─────┘        └────┬─────┘        └────┬─────┘
     │                   │                   │                   │
     │ Right-click → "Escrow Trade"           │                   │
     │───────────────────────────────────────>│                   │
     │                   │ create escrow       │                   │
     │                   │────────────────────>│                   │
     │                   │                   │                   │
     │                   │ escrow-id + session │                   │
     │<───────────────────────────────────────│                   │
     │                   │                   │ invite Player B    │
     │                   │───────────────────────────────────────>│
     │                   │                   │                   │
     │ Add items/gold    │                   │                   │
     │ Lock offer        │                   │                   │
     │───────────────────────────────────────>│                   │
     │                   │ update escrow A-side│                   │
     │                   │────────────────────>│                   │
     │                   │                   │ notify B          │
     │                   │───────────────────────────────────────>│
     │                   │                   │                   │
     │                   │                   │      Review + Confirm
     │                   │                   │<───────────────────│
     │                   │ validate both bags │                   │
     │                   │────────────────────>│                   │
     │                   │                   │                   │
     │                   │ execute swap        │                   │
     │                   │ + deduct 2.5% fee   │                   │
     │                   │────────────────────>│                   │
     │                   │                   │                   │
     │  Trade result (success + delta)         │                   │
     │<───────────────────────────────────────│                   │
     │                   │                   │                   │  Trade result
     │                   │                   │                   │<───────────────────
     │                   │                   │                   │
     │                   │ mark completed      │                   │
     │                   │────────────────────>│                   │
     │                   │                   │                   │
```

### Phase-by-Phase Flow

| Phase | Actor | Action | State |
|-------|-------|--------|-------|
| 1 | Player A | Right-click Player B → "Escrow Trade" | `pending` |
| 2 | Server | Create escrow record, reserve session | `awaiting_offers` |
| 3 | Player A | Drag items / set gold → Lock Offer | `a_locked` |
| 4 | Player B | Review offer → Lock Offer → Confirm | `b_locked` |
| 5 | Server | Validate inventories, check bag space | `validating` |
| 6 | Server | Atomic swap + fee deduction | `executing` |
| 7 | Server | Persist to DB, notify both | `completed` |
| 8 | Both | Receive items/gold (net of fee) | `done` |

---

## 2. Fee Model

- **Rate**: 2.5% of the total gold value exchanged
- **Calculation**: `fee = ceil((gold_A + gold_B) * 0.025)`
- **Collection**: Deducted proportionally from each party's gold receipt
  - If A sends 100g and B sends 0g: fee = 3g, A receives 0g, B receives 97g
  - If A sends 100g and B sends 50g: fee = 4g (ceil(150 * 0.025))
    - A receives 50g - (4g * 50/150) = 49g (rounded)
    - B receives 100g - (4g * 100/150) = 97g (rounded)
- **Minimum fee**: 1 gold (if any gold is exchanged)
- **Item-only trades**: No fee (0 gold exchanged = 0 fee)

### Fee Distribution

Collected fees are tracked in the escrow ledger and can be:
1. Burned (deflationary economy)
2. Sent to a platform treasury wallet
3. Distributed to stakers (future tokenomics)

For this implementation, fees accumulate in a server-side treasury record.

---

## 3. Smart Contract Concept (Solana Program)

### Program ID: `wayfarer_escrow_v1`

### Accounts

```rust
#[account]
pub struct Escrow {
    pub initiator: Pubkey,        // Player A wallet
    pub counterparty: Pubkey,     // Player B wallet
    pub state: EscrowState,       // enum
    pub a_offer: Offer,           // items + gold
    pub b_offer: Offer,           // items + gold
    pub created_at: i64,
    pub locked_at: Option<i64>,
    pub completed_at: Option<i64>,
    pub fee_basis_points: u16,    // 250 = 2.5%
    pub fee_collected: u64,       // lamports/gold units
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Offer {
    pub gold: u64,
    pub items: Vec<ItemTransfer>, // SPL token mints + amounts
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ItemTransfer {
    pub mint: Pubkey,             // SPL token mint address for the item
    pub amount: u64,              // usually 1 for NFT-like items
}

pub enum EscrowState {
    Pending,
    ALocked,
    BLocked,
    Confirmed,
    Executed,
    Cancelled,
    Refunded,
}
```

### Instructions

| Instruction | Accounts | Description |
|-------------|----------|-------------|
| `initiate_escrow` | Initiator, Counterparty, Escrow PDA, System Program | Creates escrow, sets state to Pending |
| `lock_offer_a` | Initiator, Escrow PDA, Token Accounts | Deposits items/gold into escrow vault, locks A's offer |
| `lock_offer_b` | Counterparty, Escrow PDA, Token Accounts | Deposits items/gold into escrow vault, locks B's offer |
| `confirm_trade` | Either party, Escrow PDA | Signals readiness; both must confirm |
| `execute_trade` | Authority (server oracle), Escrow PDA, All token accounts, Treasury | Atomically swaps assets, deducts fee, distributes remainder |
| `cancel_trade` | Either party (before both lock), or Authority | Returns deposited assets, sets state to Cancelled |
| `claim_refund` | Either party, Escrow PDA | Claims assets if trade expired or was cancelled |
| `expire_escrow` | Authority, Escrow PDA | Automatically expires after timeout (e.g., 5 minutes) |

### Token Model

- **Gold**: Represented as an SPL token (`WAYFARER_GOLD_MINT`) with 6 decimals
- **Items**: Each gear/item is an SPL token (fungible or non-fungible via Token-2022)
- **Escrow Vault**: A PDA-derived token account holds all assets during the trade
- **Treasury**: A fixed address that receives fee tokens

### Security

- **PDA seeds**: `[b"escrow", initiator.key().as_ref(), counterparty.key().as_ref(), escrow_id.as_ref()]`
- **Authority**: The server acts as the oracle, signing `execute_trade` and `expire_escrow` after validating game state
- **Timeout**: Escrows auto-expire after 5 minutes of inactivity; assets are refunded
- **Re-entrancy**: All state changes happen before token transfers (checks-effects-interactions)

---

## 4. Server Implementation

### Database Schema

See `server/db.js` for the added `escrows` table:

```sql
CREATE TABLE IF NOT EXISTS escrows (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  a_sid TEXT NOT NULL,
  a_ck TEXT NOT NULL,
  a_name TEXT NOT NULL,
  b_sid TEXT NOT NULL,
  b_ck TEXT NOT NULL,
  b_name TEXT NOT NULL,
  a_items TEXT NOT NULL DEFAULT '[]',
  a_gold INTEGER NOT NULL DEFAULT 0,
  b_items TEXT NOT NULL DEFAULT '[]',
  b_gold INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'pending',
  fee_rate REAL NOT NULL DEFAULT 0.025,
  fee_collected INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  locked_at INTEGER,
  completed_at INTEGER,
  cancelled_at INTEGER,
  cancel_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_escrow_room ON escrows(room_id);
CREATE INDEX IF NOT EXISTS idx_escrow_state ON escrows(state);
CREATE INDEX IF NOT EXISTS idx_escrow_player ON escrows(a_ck, b_ck);
```

### State Machine

```
pending → awaiting_offers → a_locked → both_locked → confirmed → completed
   ↓           ↓                ↓           ↓            ↓
cancelled   cancelled      cancelled   cancelled    failed
```

### Validation Rules

1. Both players must be online in the same room
2. Both players must have saved characters
3. Offered items must exist in the respective inventories
4. Offered gold must not exceed available gold
5. After swap, neither inventory may exceed `BAG_SIZE`
6. After swap, neither gold may exceed `GOLD_MAX`
7. Fee must be ≥ 1 gold if any gold is exchanged

### API Endpoints

No REST endpoints needed; all communication goes through Colyseus WebSocket messages:

| Message | Direction | Payload |
|---------|-----------|---------|
| `escrow-request` | C→S | `{to: sid}` |
| `escrow-respond` | C→S | `{from: sid, accept: bool}` |
| `escrow-offer` | C→S | `{id, items, gold}` |
| `escrow-lock` | C→S | `{id, rev}` |
| `escrow-unlock` | C→S | `{id}` |
| `escrow-confirm` | C→S | `{id}` |
| `escrow-cancel` | C→S | `{id}` |
| `escrow-open` | S→C | `{id, partner: {sid, name}}` |
| `escrow-update` | S→C | `{id, me, them, fee}` |
| `escrow-result` | S→C | `{ok, id, rev, gold, inventory, delta, partner, fee}` |
| `escrow-closed` | S→C | `{id, reason}` |

---

## 5. Client Implementation

### UI Panels

1. **Trade Initiation**: Right-click player → "Escrow Trade" (new menu item)
2. **Escrow Panel**: `TradeEscrowPanel.js`
   - Left side: Your offer (items + gold input)
   - Right side: Partner's offer (read-only until they lock)
   - Center: Fee display (calculated in real-time)
   - Bottom: Lock / Confirm / Cancel buttons
   - Status indicator: pending → locked → confirmed → completed
3. **Success State**: Toast notification with net receipts
4. **Failure State**: Error panel with reason and automatic refund info

### Fee Display UI

```
┌─────────────────────────────────────────┐
│  ESCROW TRADE WITH PlayerB              │
├──────────────────┬──────────────────────┤
│ YOUR OFFER       │ THEIR OFFER          │
│ [item] [item]    │ [item]               │
│ Gold: [ 100  ]   │ Gold: 50g            │
│                  │                      │
│ Status: LOCKED   │ Status: LOCKED       │
├──────────────────┴──────────────────────┤
│  Platform Fee (2.5%): 4g                │
│  You will receive: 46g + Iron Sword     │
│  They will receive: 97g + Leather Boots │
├─────────────────────────────────────────┤
│  [Unlock]  [Confirm Trade]  [Cancel]   │
└─────────────────────────────────────────┘
```

### Client State Machine

```javascript
class EscrowSystem {
  // States: idle → requesting → open → editing → locked → confirmed → done
  // Events: request, open, update, result, closed
}
```

---

## 6. Integration with Existing Systems

### Economy Module (`server/economy.js`)

The escrow system reuses:
- `charRec()` / `stateOf()` for server-side inventory validation
- `mutate()` for atomic inventory/gold changes
- `commit()` for durable multi-file writes
- `ledger()` for audit logging
- Rate-limiting token buckets

### Trade System (`src/systems/trade.js`)

The escrow panel coexists with the existing `TradePanel`:
- `TradePanel`: Direct trust-based trade (no fee, instant)
- `TradeEscrowPanel`: Secure escrow trade (2.5% fee, server-guaranteed)

### Wallet Integration (`src/ui/WalletPanel.js`)

Future blockchain phase:
- When a Solana wallet is connected, escrow trades can settle on-chain
- The server acts as oracle, signing `execute_trade` after validation
- Gold/items become SPL tokens transferred via the program

---

## 7. Security Considerations

| Threat | Mitigation |
|--------|------------|
| Client spoofing inventory | Server validates against its copy; rev-check prevents stale saves |
| Duplication | `econOut` tracking + `beforeSave` dupe guard |
| Race condition | Atomic `commit()` writes all files together; never half-applied |
| Fee evasion | Fee calculated server-side; client only displays it |
| Timeout griefing | 5-minute idle timeout auto-cancels and refunds |
| Double-spend | Rev number increments on every mutation; old revs rejected |
| Sybil attacks | Device-key + name identity; no anonymous escrow trades |

---

## 8. Future Roadmap

| Phase | Feature |
|-------|---------|
| 1 (Now) | Server-authoritative escrow with 2.5% fee, SQLite tracking |
| 2 | On-chain settlement for wallet-connected players (optional) |
| 3 | SPL token gold standard; gear as NFTs |
| 4 | DAO treasury governance for fee allocation |
| 5 | Cross-shard / cross-world escrow via Solana |

---

## 9. File Inventory

| File | Purpose |
|------|---------|
| `docs/BLOCKCHAIN_ARCH.md` | This document |
| `server/db.js` | Escrow table schema + queries |
| `server/economy.js` | Escrow message handlers + execution logic |
| `src/systems/trade.js` | Escrow client state machine |
| `src/ui/TradeEscrowPanel.js` | Escrow trade UI panel |
| `src/ui/economyUI.js` | Panel registration + keybinds |
| `src/ui/SocialPanels.js` | Context menu "Escrow Trade" option |

---

*Document version: 1.0*  
*Last updated: 2026-10-01*

## 10. Referral Token Bonus (new)

When a referred player claims Wayfarer Tokens, the existing 5% token-claim fee is split:

- **2.5% to the referrer** as a Wayfarer Token bonus.
- **2.5% to the treasury** (same fee pool that funds gold referral rewards).

The claiming player still pays the full 5% fee in gold; the split only changes where the fee goes.
Bonuses are recorded in `referral_token_bonuses(referrer, invitee, amount, source_claim, paid_at)`.
The referrer's running total is returned in `referral-state.tokenBonusPaid` and can be inspected
via `referral-token-stats`.

## 11. Holder Staking Preview (mock/devnet)

A preview/mock staking system lets players lock Wayfarer Tokens in-game for drop-rate perks.
This is **not on-chain yet**; locked tokens are deducted from `progress.wayfarerTokens` and held
in `progress.ext.stake { amount, lockedUntil, tier, dropRate }` by the server.

| Shop entry | Tokens | Lock | Drop-rate perk |
|---|---|---|---|
| `stake_bronze` | 100 | 7 days | +5% |
| `stake_silver` | 500 | 14 days | +10% |
| `stake_gold` | 2000 | 30 days | +15% |

Client sends `token-stake {tier, amount}`; server validates the tier/amount, checks the balance,
refuses an overlapping active stake, and replies with `econ-sync` carrying the updated token
balance and the new `stake` record. The ReferralPanel and WalletPanel display the active stake.

*Document version: 1.1*  
*Last updated: 2026-10-02*

## 12. Token bridge (in-game Wayfarer Tokens <-> devnet $WAYFARER)

The bridge links a Solana wallet to a character and moves currency across the
boundary. It is devnet-only and **honestly degrades**: when the Solana env is
not configured nothing is minted and nothing is deducted.

### 12.1 Wallet binding (proof of ownership)

Ownership is proven with an ed25519 signature over a server-issued challenge
(no wallet address is trusted just because a client claims it):

| Direction | Message | Payload |
|---|---|---|
| C→S | `wallet-bind-challenge` | `{address}` |
| S→C | `wallet-bind-challenge` | `{address, nonce, message}` |
| C→S | `wallet-bind` | `{address, signature}` (base58) |
| S→C | `wallet-bound` | `{address}` — or `econ-error {msg, code}` |

- The nonce challenge is single-use and expires after **5 minutes**.
- The server verifies the base58 ed25519 signature of `message` against the
  claimed address with **node:crypto** (`crypto.verify(null, msg, ed25519Key,
  sig)`); the 32-byte base58 public key is wrapped in a DER SPKI key. No extra
  dependency is required.
- On success the binding is written with `bindWallet(playerId, address)`
  (db.js `wallets` table). One wallet maps to one account: a second character
  claiming an already-bound address is refused (`address_taken`).
- **Persistence:** the `wallets` table lives in the SQLite store, so wallet
  linking requires `USE_SQLITE=1`. Without it the server answers
  `econ-error code 'db_unavailable'` and the panel says so.

### 12.2 Withdraw (in-game → on-chain)

`token-withdraw {amount, rev}` → `token-withdraw-result {ok, amount, fee, net, status, reason?}`

- Requires a bound wallet (`econ-error code 'wallet'` otherwise).
- `fee = max(1, floor(amount * ECON.TOKEN_WITHDRAW_FEE))` with
  `ECON.TOKEN_WITHDRAW_FEE = 0.075` (7.5%); `net = amount - fee`.
- The **daily cap shares the exact fields token-claim uses**
  (`progress.ext.bridgeDailyClaimed`, `ECON.TOKEN_WITHDRAW_DAILY_CAP = 500`),
  so claiming and withdrawing draw on the same daily allowance.
- **Unconfigured** (`SOLANA_RPC` / `PROGRAM_ID` / `MINT_ADDRESS` /
  `ORACLE_KEYPAIR` missing): returns `status: 'unconfigured'` and **does not
  deduct** the player's tokens.
- **Configured**: the tokens are deducted, the daily cap is reserved, and a row
  is written to `bridge_withdrawals(ck, address, amount, fee, net, status,
  signature, reason, created_at)`. `status` is `'sent'` when the on-chain
  `mint_withdraw` transaction confirmed (signature persisted) or `'pending'`
  when it could not be sent (reason recorded; an operator must settle it).
- **Fee split:** 50% of the fee is burned, 50% is credited to the fee treasury
  via `referrals.recordFee` (same pattern as token-claim).

On-chain mint: the server dynamically imports `@solana/web3.js`, derives the
`config` (`[b"config"]`) and `mint` (`[b"mint"]`) PDAs, reads the mint/treasury
from the config account, derives the player ATA, and submits a
`global:mint_withdraw` instruction (Anchor discriminator
`sha256("global:mint_withdraw")[0..8]` + `u64` amount scaled by
`TOKEN_DECIMALS`) signed by the oracle keypair.

> **Unverified:** the live mint path has not been exercised against a deployed
> devnet program (no deployed program / funded oracle keypair is available in
> this repo). If `@solana/web3.js` is not resolvable on the server the mint is
> skipped and the row stays `pending`. Adding `@solana/web3.js` to
> `server/package.json` is required for a Railway deploy (it currently resolves
> only from the repo-root `node_modules`).

### 12.3 Deposit (on-chain → in-game)

`token-deposit {signature}` → `token-deposit-result {ok, amount, credited, reason?}`

- The server fetches the parsed transaction from the configured RPC and sums the
  `postTokenBalances - preTokenBalances` deltas for the treasury ATA owned by the
  `$WAYFARER` mint. The whole-token amount (raw / 10^decimals) is credited to
  `progress.wayfarerTokens`.
- The treasury is `TREASURY_ADDRESS` when set, else the ATA of the `config` PDA.
- **Replay guard:** `bridge_deposits(signature PRIMARY KEY, ck, address, amount,
  status, confirmed_at)`. A reused signature is refused before crediting.
- **Unconfigured:** returns `ok:false, reason:'unconfigured'` and credits nothing.

> **Unverified:** the deposit verifier has not run against a real devnet
> transaction.

### 12.4 Bridge state

`token-bridge-state {}` → `token-bridge-state {configured, depositConfigured,
dbReady, address, network, withdrawFee, dailyCap, claimedToday, tokenBalance,
pendingWithdrawals[], deposits[]}` — polled by `TokenBridgePanel` on open.

### 12.5 Client

- `src/net/economyNet.js`: `walletChallenge`, `walletBind`, `requestWithdraw`,
  `requestDeposit`, `getBridgeState`, plus listeners for the new server types.
- `src/ui/TokenBridgePanel.js` (new): Solana palette + pixel fonts; wallet link,
  in-game balance, daily-cap bar, withdraw form with 7.5% fee/net preview,
  deposit-by-signature form, recent withdrawals/deposits, and an unconfigured
  banner. Opened by `/bridge` and by WalletPanel's "Link to account" action.
- `src/ui/WalletPanel.js`: adds the "Link to account" button.
- `src/ui/economyUI.js`: registers the panel (anyOpen/closer/destroy) + `/bridge`.

### 12.6 Forgery protection

Every new server→client type (`wallet-bind-challenge`, `wallet-bound`,
`token-withdraw-result`, `token-deposit-result`, `token-bridge-state`) is added
to the swallow list at the top of `server/economy.js` so a client cannot forge
it for its peers over the generic `'*'` passthrough.

*Document version: 1.2*  
*Last updated: 2026-10-02*
