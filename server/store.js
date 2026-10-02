import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { CFG } from './config.js';
import { log } from './log.js';

// File-backed character store (no DB). One JSON file per anonymous device:
//   DATA_DIR/players/<sha256(token)[0:32]>.json = { chars: { [nameLower]: {name, hero, progress, savedAt, clamped?} } }
// Raw device tokens are never written to disk. Writes are atomic (tmp file +
// rename) and write-behind: dirty devices flush every SAVE_FLUSH_MS and on
// graceful shutdown via flushAll().
const DIR = path.join(CFG.DATA_DIR, 'players');
const cache = new Map(); // key -> doc
const dirty = new Set();
let timer = null;

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
export function deviceKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}
const fileFor = (key) => path.join(DIR, `${key}.json`);

export function initStore() {
  fs.mkdirSync(DIR, { recursive: true });
  // sweep tmp files left by a crash mid-write
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* ignore */ } }
  timer = setInterval(() => { flushAll().catch((e) => log.error('store flush failed', { err: e.message })); }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('store ready', { dir: DIR, devices: fs.readdirSync(DIR).length });
}

function readDoc(key) {
  if (cache.has(key)) return cache.get(key);
  let doc = { chars: {} };
  try {
    const raw = fs.readFileSync(fileFor(key), 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.chars === 'object') doc = parsed;
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('store read failed (starting fresh)', { key, err: e.message });
  }
  cache.set(key, doc);
  return doc;
}

export function loadChar(token, name) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  if (_db) { const { loadCharDb } = require('./db.js'); return loadCharDb(token, name); }
  const doc = readDoc(deviceKey(token));
  return doc.chars[String(name || '').toLowerCase()] || null;
}

export function saveChar(token, name, rec) {
  if (!TOKEN_RE.test(String(token || ''))) return false;
  if (_db) { const { saveCharDb } = require('./db.js'); return saveCharDb(token, name, rec); }
  const key = deviceKey(token);
  const doc = readDoc(key);
  const names = Object.keys(doc.chars);
  const lower = String(name || '').toLowerCase();
  if (!doc.chars[lower] && names.length >= 12) return false;
  doc.chars[lower] = rec;
  dirty.add(key);
  return true;
}

async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, file);
}

let flushing = null;
export async function flushAll() {
  if (flushing) return flushing;
  flushing = (async () => {
    const keys = [...dirty]; dirty.clear();
    for (const key of keys) {
      try { await writeAtomic(fileFor(key), JSON.stringify(cache.get(key))); }
      catch (e) { dirty.add(key); log.error('store write failed', { key, err: e.message }); }
    }
    if (keys.length) log.debug('store flushed', { n: keys.length });
  })();
  try { await flushing; } finally { flushing = null; }
}

export function storeStats() {
  let files = 0;
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).length; } catch { /* ignore */ }
  return { devices: files, cached: cache.size, dirty: dirty.size };
}


// --- SQLite bridge (opt-in via USE_SQLITE env) ---
let _db = null;
export async function initSqlite() {
  if (!process.env.USE_SQLITE) return false;
  const { initDb } = await import('./db.js');
  initDb();
  _db = true;
  log.info('sqlite store active');
  return true;
}
export function stopStore() { if (timer) clearInterval(timer); timer = null; }

// ─── hooks for server/econStore.js (multi-file atomic commits) ──────────
// The economy writes the affected device files itself, inside one
// transaction, right after a trade / purchase. It waits for any in-flight
// write-behind flush first so an older snapshot can never land on top.
export const charFile = (key) => fileFor(key);
export const charDocJson = (key) => JSON.stringify(readDoc(key));
export const storeIdle = () => flushing || Promise.resolve();
export const storeDir = () => DIR;
