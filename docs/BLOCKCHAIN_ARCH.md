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
