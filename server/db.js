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
  `);
  log.info('db ready', { path: DB_PATH });
}

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
  const charId = info.lastInsertRowid || db.prepare('SELECT id FROM characters WHERE player_id=? AND name_lower=?').get(playerId, lower).id;
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
