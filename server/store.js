import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { CFG } from './config.js';
import { log } from './log.js';

// File-backed character store (no DB). One JSON file per anonymous device:
//   DATA_DIR/players/<sha256(token)[0:32]>.json = { chars: { [nameLower]: record } }
// A doc MAY also carry `links: [{ kind, idHash, addedAt }]` (identity feature);
// a doc without it is valid and stays valid forever.
//
// MULTI-DEVICE INDIRECTION (identity feature — additive, no migration):
//   a token hash normally IS the doc key. If DATA_DIR/aliases/<tokenHash>.json
//   exists ({ primaryKey }), that token hash resolves to `primaryKey` instead.
//   Every pre-existing player file has no alias file, so it keeps working
//   untouched and under its own name.
//
// Raw device tokens are never written to disk (only the hash), and the doc key
// is never rewritten: linking a code adds to the doc's `links` array only.
// Writes are atomic (tmp file + rename) and write-behind: dirty docs flush every
// SAVE_FLUSH_MS and on graceful shutdown via flushAll().
const DIR = path.join(CFG.DATA_DIR, 'players');
const ALIAS_DIR = path.join(CFG.DATA_DIR, 'aliases');
const cache = new Map();     // docKey -> doc
const dirty = new Set();     // docKey
const aliases = new Map();   // tokenHash -> primaryKey | null (null = no alias on disk)
let timer = null;

export const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export function deviceKey(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
}
const fileFor = (key) => path.join(DIR, `${key}.json`);
const aliasFileFor = (tokenHash) => path.join(ALIAS_DIR, `${tokenHash}.json`);

export function initStore() {
  fs.mkdirSync(DIR, { recursive: true });
  fs.mkdirSync(ALIAS_DIR, { recursive: true });
  // sweep tmp files left by a crash mid-write
  for (const d of [DIR, ALIAS_DIR]) {
    for (const f of fs.readdirSync(d)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(d, f)); } catch { /* ignore */ } }
  }
  timer = setInterval(() => { flushAll().catch((e) => log.error('store flush failed', { err: e.message })); }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('store ready', { dir: DIR, devices: fs.readdirSync(DIR).length, aliases: fs.readdirSync(ALIAS_DIR).length });
}

// ─── alias indirection (one level only: token hash -> doc key) ───────────────
// Returns the primaryKey for a token hash, or null when no alias exists.
export function aliasFor(tokenHash) {
  const h = String(tokenHash);
  if (aliases.has(h)) return aliases.get(h);
  let primary = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(aliasFileFor(h), 'utf8'));
    if (parsed && typeof parsed.primaryKey === 'string' && KEY_RE.test(parsed.primaryKey)) primary = parsed.primaryKey;
    else log.warn('alias file unusable (ignored)', { hash: h.slice(0, 12) });
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('alias read failed (ignored)', { hash: h.slice(0, 12), err: e.message });
  }
  aliases.set(h, primary);
  return primary;
}

// THE RESOLUTION RULE: an alias if one exists, otherwise the token hash itself.
export function resolveKey(tokenHash) {
  const h = String(tokenHash);
  return aliasFor(h) || h;
}

// token -> doc key (null when the token is not shape-valid).
export function docKeyFor(token) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  return resolveKey(deviceKey(token));
}

export async function setAlias(tokenHash, primaryKey) {
  const h = String(tokenHash);
  const p = String(primaryKey);
  if (!KEY_RE.test(h) || !KEY_RE.test(p)) return false;
  await fsp.mkdir(ALIAS_DIR, { recursive: true });
  await writeAtomic(aliasFileFor(h), JSON.stringify({ primaryKey: p }));
  aliases.set(h, p);
  return true;
}

export function aliasCount() { return aliases.size; }

// ─── docs ────────────────────────────────────────────────────────────────────
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

// Live doc for a RESOLVED doc key. Never creates a file; unknown keys yield a
// fresh empty doc that is only persisted if something marks it dirty.
export function getDocByKey(key) {
  if (!KEY_RE.test(String(key || ''))) return null;
  return readDoc(String(key));
}

// Live doc for a device token (alias-resolved). Null when the token is malformed.
export function getDocByToken(token) {
  const key = docKeyFor(token);
  return key ? readDoc(key) : null;
}

export function markDirty(key) { if (cache.has(key)) dirty.add(key); }

export function hasDoc(key) {
  return cache.has(String(key)) || fs.existsSync(fileFor(String(key)));
}

export function loadChar(token, name) {
  if (!TOKEN_RE.test(String(token || ''))) return null;
  const doc = readDoc(resolveKey(deviceKey(token)));
  return doc.chars[String(name || '').toLowerCase()] || null;
}

export function saveChar(token, name, rec) {
  if (!TOKEN_RE.test(String(token || ''))) return false;
  const key = resolveKey(deviceKey(token));
  const doc = readDoc(key);
  const names = Object.keys(doc.chars);
  const lower = String(name || '').toLowerCase();
  if (!doc.chars[lower] && names.length >= 12) return false; // per-device character cap
  doc.chars[lower] = rec;
  dirty.add(key);
  return true;
}

export async function writeAtomic(file, data) {
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
  let files = 0; let aliasFiles = 0;
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).length; } catch { /* ignore */ }
  try { aliasFiles = fs.readdirSync(ALIAS_DIR).filter((f) => f.endsWith('.json')).length; } catch { /* ignore */ }
  return { devices: files, aliases: aliasFiles, cached: cache.size, dirty: dirty.size };
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
