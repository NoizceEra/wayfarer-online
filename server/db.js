import Database from 'better-sqlite3';
import path from 'path';
import { CFG } from './config.js';
import { log } from './log.js';
import { deviceKey } from './store.js';

const DB_PATH = path.join(CFG.DATA_DIR, 'wayfarer.db');
let db = null;

export function initDb() {
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_key TEXT UNIQUE NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      hero TEXT NOT NULL DEFAULT '{}',
      progress TEXT NOT NULL DEFAULT '{}',
      rev INTEGER NOT NULL DEFAULT 0,
      econ_out TEXT NOT NULL DEFAULT '[]',
      saved_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(player_id, name_lower)
    );
    CREATE TABLE IF NOT EXISTS economy (
      char_id INTEGER PRIMARY KEY REFERENCES characters(id) ON DELETE CASCADE,
      gold INTEGER NOT NULL DEFAULT 0,
      inventory TEXT NOT NULL DEFAULT '[]',
      equipped TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_char_player ON characters(player_id);
    CREATE INDEX IF NOT EXISTS idx_char_name ON characters(name_lower);

    -- Escrow trading system (secure trades with 2.5% platform fee)
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
    CREATE INDEX IF NOT EXISTS idx_escrow_created ON escrows(created_at);

    -- Treasury for accumulated escrow fees
    CREATE TABLE IF NOT EXISTS treasury (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      total_fees INTEGER NOT NULL DEFAULT 0,
      total_trades INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    INSERT OR IGNORE INTO treasury (id) VALUES (1);

    -- Wallet bindings (Solana addresses linked to player accounts)
    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      chain TEXT NOT NULL DEFAULT 'solana',
      address TEXT NOT NULL,
      bound_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(player_id, chain, address)
    );
    -- Referral rewards (REFER-A-FRIEND; payouts drawn from the fee treasury)
    CREATE TABLE IF NOT EXISTS referrals (
      code TEXT PRIMARY KEY,
      player TEXT UNIQUE,
      name TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      invited_count INTEGER NOT NULL DEFAULT 0,
      gold_paid INTEGER NOT NULL DEFAULT 0,
      token_bonus_paid INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS referral_milestones (
      referrer TEXT,
      invitee TEXT,
      milestone TEXT,
      gold INTEGER NOT NULL DEFAULT 0,
      paid_at INTEGER,
      PRIMARY KEY(referrer, invitee, milestone)
    );
    CREATE TABLE IF NOT EXISTS referral_token_bonuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer TEXT NOT NULL,
      invitee TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      source_claim INTEGER NOT NULL DEFAULT 0,
      paid_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_referral_token_referrer ON referral_token_bonuses(referrer);
    CREATE INDEX IF NOT EXISTS idx_referral_token_pair ON referral_token_bonuses(referrer, invitee);
    CREATE INDEX IF NOT EXISTS idx_wallet_address ON wallets(address);
    CREATE INDEX IF NOT EXISTS idx_wallet_player ON wallets(player_id);

    -- Token bridge withdrawals (in-game Wayfarer Tokens -> on-chain $WAYFARER).
    -- status: 'pending' (mint not sent yet) | 'sent' (signature persisted) | 'failed'
    CREATE TABLE IF NOT EXISTS bridge_withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ck TEXT NOT NULL,
      address TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      fee INTEGER NOT NULL DEFAULT 0,
      net INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      signature TEXT,
      reason TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_bridge_wd_ck ON bridge_withdrawals(ck);

    -- Token bridge deposits (on-chain $WAYFARER -> in-game). signature is the
    -- PRIMARY KEY: a reused transaction signature is refused (replay guard).
    CREATE TABLE IF NOT EXISTS bridge_deposits (
      signature TEXT PRIMARY KEY,
      ck TEXT NOT NULL,
      address TEXT,
      amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'confirmed',
      confirmed_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_bridge_dep_ck ON bridge_deposits(ck);
  `);
  // Older SQLite installs predate the economy revision fields. Migrate them
  // in place so enabling this store never resets revisions or dupe history.
  const characterColumns = new Set(db.pragma('table_info(characters)').map((column) => column.name));
  if (!characterColumns.has('rev')) db.exec('ALTER TABLE characters ADD COLUMN rev INTEGER NOT NULL DEFAULT 0');
  if (!characterColumns.has('econ_out')) db.exec("ALTER TABLE characters ADD COLUMN econ_out TEXT NOT NULL DEFAULT '[]'");
  log.info('db ready', { path: DB_PATH });
}

// db handle for optional modules (server/referrals.js creates its own tables)
export function getDb() { return db; }

function getPlayerId(dkey) {
  let row = db.prepare('SELECT id FROM players WHERE device_key = ?').get(dkey);
  if (!row) {
    const ins = db.prepare('INSERT INTO players (device_key) VALUES (?)');
    const info = ins.run(dkey);
    row = { id: info.lastInsertRowid };
  }
  return row.id;
}

export function loadCharDb(token, name) {
  if (!token || !name) return null;
  const dkey = deviceKey(token);
  const row = db.prepare(`
    SELECT c.hero, c.progress, c.rev, c.econ_out, c.saved_at, e.gold, e.inventory, e.equipped
    FROM characters c
    LEFT JOIN economy e ON e.char_id = c.id
    JOIN players p ON p.id = c.player_id
    WHERE p.device_key = ? AND c.name_lower = ?
  `).get(dkey, String(name).toLowerCase());
  if (!row) return null;
  const rec = {
    name, hero: JSON.parse(row.hero), progress: JSON.parse(row.progress), savedAt: row.saved_at,
    rev: row.rev || 0, econOut: JSON.parse(row.econ_out || '[]'),
  };
  if (row.gold !== null) {
    rec.progress = rec.progress || {};
    rec.progress.gold = row.gold;
    rec.progress.inventory = JSON.parse(row.inventory || '[]');
    rec.progress.equipped = JSON.parse(row.equipped || '{}');
  }
  return rec;
}

export function saveCharDb(token, name, rec) {
  if (!token || !name) return false;
  const dkey = deviceKey(token);
  const playerId = getPlayerId(dkey);
  const lower = String(name).toLowerCase();
  const hero = JSON.stringify(rec.hero || {});
  const progress = JSON.stringify(rec.progress || {});
  const savedAt = rec.savedAt || Date.now();
  const upsert = db.prepare(`
    INSERT INTO characters (player_id, name, name_lower, hero, progress, rev, econ_out, saved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, name_lower) DO UPDATE SET
      hero=excluded.hero, progress=excluded.progress, rev=excluded.rev,
      econ_out=excluded.econ_out, saved_at=excluded.saved_at
  `);
  upsert.run(playerId, name, lower, hero, progress, rec.rev || 0, JSON.stringify(rec.econOut || []), savedAt);
  // lastInsertRowid is stale when the upsert took the DO UPDATE path (it keeps
  // the rowid of the last plain INSERT on the connection): always resolve the
  // char id from the unique key instead.
  const charId = db.prepare('SELECT id FROM characters WHERE player_id=? AND name_lower=?').get(playerId, lower).id;
  const prog = rec.progress || {};
  if (prog.gold !== undefined || prog.inventory !== undefined || prog.equipped !== undefined) {
    const gold = Number(prog.gold) || 0;
    const inventory = JSON.stringify(prog.inventory || []);
    const equipped = JSON.stringify(prog.equipped || {});
    db.prepare(`
      INSERT INTO economy (char_id, gold, inventory, equipped, updated_at)
      VALUES (?, ?, ?, ?, unixepoch())
      ON CONFLICT(char_id) DO UPDATE SET
        gold=excluded.gold, inventory=excluded.inventory, equipped=excluded.equipped, updated_at=excluded.updated_at
    `).run(charId, gold, inventory, equipped);
  }
  return true;
}

export function listCharsDb(token) {
  if (!token) return [];
  const dkey = deviceKey(token);
  return db.prepare(`
    SELECT c.name, c.saved_at FROM characters c
    JOIN players p ON p.id = c.player_id
    WHERE p.device_key = ?
    ORDER BY c.saved_at DESC
  `).all(dkey);
}

export function listAllCharsDb() {
  return db.prepare(`
    SELECT c.name, c.hero, c.progress, c.rev, c.econ_out, c.saved_at,
      e.gold, e.inventory, e.equipped
    FROM characters c
    LEFT JOIN economy e ON e.char_id = c.id
    ORDER BY c.saved_at DESC
  `).all().map((row) => {
    const progress = JSON.parse(row.progress);
    if (row.gold !== null) {
      progress.gold = row.gold;
      progress.inventory = JSON.parse(row.inventory || '[]');
      progress.equipped = JSON.parse(row.equipped || '{}');
    }
    return { name: row.name, hero: JSON.parse(row.hero), progress, rev: row.rev || 0, econOut: JSON.parse(row.econ_out || '[]'), savedAt: row.saved_at };
  });
}

export function dbStats() {
  const players = db.prepare('SELECT COUNT(*) AS n FROM players').get().n;
  const chars = db.prepare('SELECT COUNT(*) AS n FROM characters').get().n;
  return { players, characters: chars };
}

// ─── escrow helpers ───────────────────────────────────────────────────────
export function createEscrow({ id, roomId, aSid, aCk, aName, bSid, bCk, bName }) {
  db.prepare(`INSERT INTO escrows (id, room_id, a_sid, a_ck, a_name, b_sid, b_ck, b_name, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', unixepoch())`).run(id, roomId, aSid, aCk, aName, bSid, bCk, bName);
}

export function loadEscrow(id) {
  const row = db.prepare('SELECT * FROM escrows WHERE id = ?').get(id);
  if (!row) return null;
  return {
    ...row,
    a_items: JSON.parse(row.a_items),
    b_items: JSON.parse(row.b_items),
  };
}

export function updateEscrowOffers(id, { aItems, aGold, bItems, bGold }) {
  const sets = [];
  const vals = [];
  if (aItems !== undefined) { sets.push('a_items = ?'); vals.push(JSON.stringify(aItems)); }
  if (aGold !== undefined) { sets.push('a_gold = ?'); vals.push(aGold); }
  if (bItems !== undefined) { sets.push('b_items = ?'); vals.push(JSON.stringify(bItems)); }
  if (bGold !== undefined) { sets.push('b_gold = ?'); vals.push(bGold); }
  if (!sets.length) return;
  vals.push(id);
  db.prepare(`UPDATE escrows SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
}

export function setEscrowState(id, state, extra = {}) {
  const fields = ['state = ?'];
  const vals = [state];
  if (extra.lockedAt) { fields.push('locked_at = ?'); vals.push(extra.lockedAt); }
  if (extra.completedAt) { fields.push('completed_at = ?'); vals.push(extra.completedAt); }
  if (extra.cancelledAt) { fields.push('cancelled_at = ?'); vals.push(extra.cancelledAt); }
  if (extra.cancelReason) { fields.push('cancel_reason = ?'); vals.push(extra.cancelReason); }
  if (extra.feeCollected !== undefined) { fields.push('fee_collected = ?'); vals.push(extra.feeCollected); }
  vals.push(id);
  db.prepare(`UPDATE escrows SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
}

export function closeEscrow(id, reason) {
  db.prepare(`UPDATE escrows SET state = 'cancelled', cancelled_at = unixepoch(), cancel_reason = ? WHERE id = ?`).run(reason || '', id);
}

export function playerEscrows(ck, opts = {}) {
  const states = opts.states || [];
  let sql = 'SELECT * FROM escrows WHERE a_ck = ? OR b_ck = ?';
  const args = [ck, ck];
  if (states.length) { sql += ` AND state IN (${states.map(() => '?').join(',')})`; args.push(...states); }
  sql += ' ORDER BY created_at DESC';
  if (opts.limit) { sql += ' LIMIT ?'; args.push(opts.limit); }
  return db.prepare(sql).all(...args).map((r) => ({ ...r, a_items: JSON.parse(r.a_items), b_items: JSON.parse(r.b_items) }));
}

export function recordFee(fee) {
  db.prepare('UPDATE treasury SET total_fees = total_fees + ?, total_trades = total_trades + 1, updated_at = unixepoch() WHERE id = 1').run(fee | 0);
}

export function treasuryStats() {
  return db.prepare('SELECT total_fees, total_trades, updated_at FROM treasury WHERE id = 1').get();
}

// Wallet binding helpers
export function bindWallet(playerId, address, chain = 'solana') {
  try {
    const ins = db.prepare('INSERT INTO wallets (player_id, chain, address) VALUES (?, ?, ?)');
    ins.run(playerId, chain, address);
    return { ok: true };
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint failed')) return { ok: false, error: 'already_bound' };
    return { ok: false, error: e.message };
  }
}

export function getWalletByAddress(address, chain = 'solana') {
  return db.prepare('SELECT w.*, p.device_key FROM wallets w JOIN players p ON p.id = w.player_id WHERE w.address = ? AND w.chain = ?').get(address, chain) || null;
}

export function getWalletsByPlayer(playerId) {
  return db.prepare('SELECT * FROM wallets WHERE player_id = ?').all(playerId);
}

// ─── token-bridge helpers (used by server/economy.js) ────────────────────
// Every helper tolerates a null db handle (initDb never ran: file mode without
// USE_SQLITE) and returns a safe empty value instead of throwing, so the
// bridge degrades honestly rather than crashing the relay.
const noDb = () => !db;

// Resolve (creating if needed) the players row for a device token.
export function playerIdForToken(token) {
  if (noDb() || !token) return null;
  try { return getPlayerId(deviceKey(token)); } catch { return null; }
}

// Bind an address for a device token. Idempotent for the same address; refuses
// an address already claimed by a DIFFERENT player (one wallet = one account).
export function bindWalletForToken(token, address, chain = 'solana') {
  if (noDb()) return { ok: false, error: 'db_unavailable' };
  const pid = playerIdForToken(token);
  if (!pid) return { ok: false, error: 'no_player' };
  const mine = db.prepare('SELECT * FROM wallets WHERE player_id = ? AND chain = ? LIMIT 1').get(pid, chain);
  if (mine) return mine.address === address ? { ok: true, address } : { ok: false, error: 'already_bound', address: mine.address };
  const other = getWalletByAddress(address, chain);
  if (other) return { ok: false, error: 'address_taken' };
  const r = bindWallet(pid, address, chain);
  return r.ok ? { ok: true, address } : r;
}

export function getWalletForToken(token, chain = 'solana') {
  if (noDb() || !token) return null;
  const pid = playerIdForToken(token);
  if (!pid) return null;
  return db.prepare('SELECT * FROM wallets WHERE player_id = ? AND chain = ? LIMIT 1').get(pid, chain) || null;
}

export function insertBridgeWithdrawal({ ck, address, amount, fee, net, status, signature = null, reason = null }) {
  if (noDb()) return false;
  const info = db.prepare(`INSERT INTO bridge_withdrawals (ck, address, amount, fee, net, status, signature, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, unixepoch())`).run(ck, address, amount | 0, fee | 0, net | 0, status, signature, reason);
  return Number(info.lastInsertRowid) || true; // row id: callers update this row after the mint
}

// Net whole tokens withdrawn to `address` since 00:00 UTC today, across every
// character bound to it (rows in any status except 'failed' count: a pending
// or in-flight mint may still land).
export function walletWithdrawnToday(address) {
  if (noDb() || !address) return 0;
  const day0 = Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) / 1000);
  const row = db.prepare("SELECT COALESCE(SUM(net), 0) AS n FROM bridge_withdrawals WHERE address = ? AND created_at >= ? AND status <> 'failed'").get(address, day0);
  return row?.n | 0;
}

export function updateBridgeWithdrawal(id, { status, signature = null, reason = null }) {
  if (noDb()) return false;
  db.prepare('UPDATE bridge_withdrawals SET status = ?, signature = ?, reason = ? WHERE id = ?').run(status, signature, reason, id);
  return true;
}

export function listBridgeWithdrawals(ck, limit = 10) {
  if (noDb()) return [];
  return db.prepare('SELECT * FROM bridge_withdrawals WHERE ck = ? ORDER BY id DESC LIMIT ?').all(ck, limit);
}

// Replay guard for deposits: returns false when the signature was already used.
export function insertBridgeDeposit({ signature, ck, address = null, amount, status = 'confirmed' }) {
  if (noDb()) return false;
  try {
    db.prepare('INSERT INTO bridge_deposits (signature, ck, address, amount, status, confirmed_at) VALUES (?, ?, ?, ?, ?, unixepoch())')
      .run(signature, ck, address, amount | 0, status);
    return true;
  } catch (e) {
    if (e.message?.includes('UNIQUE constraint failed')) return false;
    throw e;
  }
}

export function getBridgeDeposit(signature) {
  if (noDb()) return null;
  return db.prepare('SELECT * FROM bridge_deposits WHERE signature = ?').get(signature) || null;
}

export function listBridgeDeposits(ck, limit = 10) {
  if (noDb()) return [];
  return db.prepare('SELECT * FROM bridge_deposits WHERE ck = ? ORDER BY confirmed_at DESC LIMIT ?').all(ck, limit);
}
