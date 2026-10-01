// server/econ/state.js — the token-economy's own small persistent document.
//
// WHY THIS FILE EXISTS. server/economy/ledger.js owns player BALANCES and is the single
// writer of money; it deliberately knows nothing about stakes or emission. But three
// pieces of economy state are not balances and must still survive a restart:
//
//   * the EMISSION budget consumed so far — stakeMath.returnFor() takes the remaining
//     budget as an argument and enforces it as a hard ceiling, so "remaining" has to be
//     durable or a restart would hand the programme a fresh 5% of supply each time;
//   * the STAKES (tier, principal, when it was locked) — without them a restart would
//     strand a player's locked principal with no way to release it;
//   * the per-type kill counts ALREADY CREDITED to the ledger — the credit is computed as
//     a delta from the character save's lifetime counters (see ops.creditKills), and a
//     replay of an old save must compute a delta of zero, not pay the boss again.
//
//   DATA_DIR/econ/state.json
//     { version, budgetSpentRaw, stakes: { <playerKey>: {...} }, combat: { <playerKey>: {...} } }
//
// Writes are atomic (tmp + fsync + rename) and write-behind on CFG.SAVE_FLUSH_MS, matching
// store.js / ledger.js, and flushed synchronously on stop(). playerKey is the sha256
// prefix of the device token (store.deviceKey) — the raw token never touches disk.

import fs from 'fs';
import path from 'path';
import { CFG } from '../config.js';
import { log } from '../log.js';

const DIR = path.join(CFG.DATA_DIR, 'econ');
const FILE = path.join(DIR, 'state.json');
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const VERSION = 1;

let doc = null;
let dirty = false;
let timer = null;
let seq = 0;

const blank = () => ({ version: VERSION, budgetSpentRaw: 0, stakes: {}, combat: {} });
const intOr0 = (v) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);

function readFile() {
  const d = blank();
  let parsed = null;
  try { parsed = JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') log.warn('econ state unreadable, starting empty', { err: e.message }); }
  if (!parsed || typeof parsed !== 'object') return d;
  d.budgetSpentRaw = intOr0(parsed.budgetSpentRaw);
  for (const [k, v] of Object.entries(parsed.stakes && typeof parsed.stakes === 'object' ? parsed.stakes : {})) {
    if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue;
    if (!Number.isSafeInteger(v.amountRaw) || v.amountRaw < 0) continue;
    if (!Number.isSafeInteger(v.lockedAtMs)) continue;
    d.stakes[k] = {
      tierId: String(v.tierId || 'none'), amountRaw: v.amountRaw,
      lockedAtMs: v.lockedAtMs, lockUntilMs: Number.isSafeInteger(v.lockUntilMs) ? v.lockUntilMs : 0,
    };
  }
  for (const [k, v] of Object.entries(parsed.combat && typeof parsed.combat === 'object' ? parsed.combat : {})) {
    if (!KEY_RE.test(k) || !v || typeof v !== 'object') continue;
    const credited = {};
    for (const [t, n] of Object.entries(v.credited && typeof v.credited === 'object' ? v.credited : {})) {
      if (/^[A-Za-z0-9_]{1,32}$/.test(t) && Number.isSafeInteger(n) && n >= 0) credited[t] = n;
    }
    d.combat[k] = { credited, savedAtMs: Number.isSafeInteger(v.savedAtMs) ? v.savedAtMs : 0 };
  }
  return d;
}

function ensure() {
  if (!doc) doc = readFile();
  return doc;
}

function writeSync() {
  const tmp = `${FILE}.${process.pid}.${seq++}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, JSON.stringify(doc)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
}

export function initState() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* ignore */ } }
  doc = readFile();
  dirty = false;
  timer = setInterval(() => { try { flushState(); } catch (e) { log.error('econ state flush failed', { err: e.message }); } }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('econ state ready', { dir: DIR, stakes: Object.keys(doc.stakes).length, budgetSpentRaw: doc.budgetSpentRaw });
}

/** Write the document if it changed. Returns 1 when written, 0 when nothing to do. */
export function flushState() {
  if (!doc || !dirty) return 0;
  dirty = false;
  try { writeSync(); return 1; }
  catch (e) { dirty = true; log.error('econ state write failed', { err: e.message }); return 0; }
}

export function stopState() {
  if (timer) clearInterval(timer);
  timer = null;
  flushState();
}

// ── emission budget ─────────────────────────────────────────────────────────
export function budgetSpentRaw() { return ensure().budgetSpentRaw; }
export function spendBudget(raw) {
  if (!Number.isSafeInteger(raw) || raw < 0) throw new TypeError(`state: budget amount must be a non-negative safe integer, got ${JSON.stringify(raw)}`);
  const d = ensure();
  d.budgetSpentRaw = d.budgetSpentRaw + raw;
  dirty = true;
  return d.budgetSpentRaw;
}

// ── stakes (one per player; release before re-locking) ──────────────────────
export function stakeOf(playerKey) {
  if (!KEY_RE.test(String(playerKey || ''))) return null;
  const s = ensure().stakes[String(playerKey)];
  return s ? { ...s } : null;
}
export function putStake(playerKey, stake) {
  const d = ensure();
  d.stakes[String(playerKey)] = { ...stake };
  dirty = true;
}
export function dropStake(playerKey) {
  const d = ensure();
  const had = Boolean(d.stakes[String(playerKey)]);
  if (had) { delete d.stakes[String(playerKey)]; dirty = true; }
  return had;
}

// ── per-type kill counts already credited to the ledger ─────────────────────
export function combatOf(playerKey) {
  if (!KEY_RE.test(String(playerKey || ''))) return { credited: {}, savedAtMs: 0 };
  const c = ensure().combat[String(playerKey)];
  return c ? { credited: { ...c.credited }, savedAtMs: c.savedAtMs } : { credited: {}, savedAtMs: 0 };
}
export function putCombat(playerKey, rec) {
  const d = ensure();
  d.combat[String(playerKey)] = { credited: { ...(rec.credited || {}) }, savedAtMs: intOr0(rec.savedAtMs) };
  dirty = true;
}

export function stateStats() {
  const d = ensure();
  return { stakes: Object.keys(d.stakes).length, tracked: Object.keys(d.combat).length, budgetSpentRaw: d.budgetSpentRaw, dirty };
}

/** Test-only: drop in-memory state so a fresh process is simulated. */
export function _resetState() { doc = null; dirty = false; }
