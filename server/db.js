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
  `);
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
    SELECT c.hero, c.progress, c.saved_at, e.gold, e.inventory, e.equipped
    FROM characters c
    LEFT JOIN economy e ON e.char_id = c.id
    JOIN players p ON p.id = c.player_id
    WHERE p.device_key = ? AND c.name_lower = ?
  `).get(dkey, String(name).toLowerCase());
  if (!row) return null;
  const rec = { name, hero: JSON.parse(row.hero), progress: JSON.parse(row.progress), savedAt: row.saved_at };
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
    INSERT INTO characters (player_id, name, name_lower, hero, progress, saved_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(player_id, name_lower) DO UPDATE SET
      hero=excluded.hero, progress=excluded.progress, saved_at=excluded.saved_at
  `);
  const info = upsert.run(playerId, name, lower, hero, progress, savedAt);
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
