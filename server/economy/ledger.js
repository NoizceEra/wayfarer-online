/**
 * ledger.js — the server-authoritative balance ledger (gold + wayfarer).
 *
 * MONEY CORE. Deliberately NOT delegated: this is the single writer of player balances,
 * and every payout, fee and stake resolves against it. A wrong debit here cannot be
 * rolled back the way a game save can.
 *
 * DESIGN
 *   * One file per player:  DATA_DIR/economy/<playerKey>.json
 *       { balances: { gold, wayfarer }, seq, entries: [...], appliedIds: [...] }
 *   * Append-only journal + derived balances. Balances are the source of truth for reads;
 *     the journal is the audit trail. Both are written together under one atomic rename.
 *   * IDEMPOTENT BY ENTRY ID. Applying the same `id` twice is a no-op that returns the
 *     original outcome. This is what makes a retried payout safe: a claim that times out
 *     mid-flight is retried, and the player is not paid twice for it.
 *   * INTEGERS ONLY. Balances are integer base units. There is no float arithmetic on
 *     money anywhere in this file; a fractional amount is rejected, not rounded.
 *   * NO OVERDRAFT. A debit that would take a balance below zero is REFUSED, not clamped.
 *     Clamping to zero silently creates or destroys value and hides the bug that caused it.
 *   * Atomic writes (tmp + rename) and write-behind flushing, matching store.js so the two
 *     share one durability model and one shutdown path.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { CFG } from '../config.js';
import { log } from '../log.js';

// ── pinned identifiers ───────────────────────────────────────────────────────
// These MUST match server/economy/CONTRACT.md. The integration test parses the contract
// and asserts agreement, so a drift here fails loudly instead of quietly paying the
// wrong resource.
export const RESOURCE_KINDS = ['gold', 'wayfarer'];

export const LEDGER_REASONS = [
  'idle', 'quest', 'harvest', 'combat', 'fee',
  'stake_lock', 'stake_unlock', 'stake_return', 'claim', 'admin',
];

/** Reasons that may only ever DEBIT. A credit with one of these is a bug. */
const DEBIT_ONLY = new Set(['fee', 'stake_lock', 'claim']);
/** Reasons that may only ever CREDIT. */
const CREDIT_ONLY = new Set(['idle', 'quest', 'harvest', 'combat', 'stake_unlock', 'stake_return']);

const DIR = path.join(CFG.DATA_DIR, 'economy');
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;
const ID_RE = /^[A-Za-z0-9_:.-]{6,160}$/;

const cache = new Map();     // playerKey -> doc
const dirty = new Set();
let timer = null;

const fileFor = (key) => path.join(DIR, `${key}.json`);

export function initLedger() {
  fs.mkdirSync(DIR, { recursive: true });
  for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* ignore */ } }
  }
  timer = setInterval(() => { flushAll().catch((e) => log.error('ledger flush failed', { err: e.message })); }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('ledger ready', { dir: DIR, players: fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).length });
}

function readDoc(key) {
  if (cache.has(key)) return cache.get(key);
  let doc = { balances: { gold: 0, wayfarer: 0 }, seq: 0, entries: [], appliedIds: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(fileFor(key), 'utf8'));
    if (parsed && typeof parsed === 'object') {
      doc = {
        balances: {
          gold: Number.isSafeInteger(parsed.balances?.gold) ? parsed.balances.gold : 0,
          wayfarer: Number.isSafeInteger(parsed.balances?.wayfarer) ? parsed.balances.wayfarer : 0,
        },
        seq: Number.isSafeInteger(parsed.seq) ? parsed.seq : 0,
        entries: Array.isArray(parsed.entries) ? parsed.entries : [],
        appliedIds: Array.isArray(parsed.appliedIds) ? parsed.appliedIds : [],
      };
    }
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('ledger doc unreadable, starting empty', { key: key.slice(0, 8), err: e.message });
  }
  cache.set(key, doc);
  return doc;
}

export async function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fh = await fsp.open(tmp, 'w');
  try { await fh.writeFile(data); await fh.sync(); } finally { await fh.close(); }
  await fsp.rename(tmp, file);
}

const JOURNAL_MAX = 500;      // keep the file bounded; balances are authoritative

/** Balances for a player. Never creates a file — an unknown player is simply zero. */
export function balancesOf(playerKey) {
  if (!KEY_RE.test(String(playerKey || ''))) return null;
  const doc = readDoc(String(playerKey));
  return { ...doc.balances };
}

/**
 * Apply one entry, exactly once.
 *
 * @returns {{applied:boolean, reason?:string, balances:object, entry?:object}}
 *   applied:false with a reason means the entry was REFUSED (bad input, overdraft,
 *   duplicate id) — callers must treat that as "no value moved".
 */
export function apply(playerKey, { id, reason, resource, amount, meta = null } = {}) {
  const key = String(playerKey || '');
  if (!KEY_RE.test(key)) return { applied: false, reason: 'bad_player', balances: null };
  if (typeof id !== 'string' || !ID_RE.test(id)) return { applied: false, reason: 'bad_id', balances: balancesOf(key) };
  if (!LEDGER_REASONS.includes(reason)) return { applied: false, reason: 'bad_reason', balances: balancesOf(key) };
  if (!RESOURCE_KINDS.includes(resource)) return { applied: false, reason: 'bad_resource', balances: balancesOf(key) };
  if (!Number.isSafeInteger(amount) || amount === 0) return { applied: false, reason: 'bad_amount', balances: balancesOf(key) };

  const debit = amount < 0;
  if (debit && CREDIT_ONLY.has(reason)) return { applied: false, reason: 'reason_is_credit_only', balances: balancesOf(key) };
  if (!debit && DEBIT_ONLY.has(reason)) return { applied: false, reason: 'reason_is_debit_only', balances: balancesOf(key) };

  const doc = readDoc(key);

  // IDEMPOTENCY: a retried entry must not move value a second time. Return the outcome
  // of the original application so a retry is indistinguishable from the first call.
  if (doc.appliedIds.includes(id)) {
    const prior = doc.entries.find((e) => e.id === id) || null;
    return { applied: false, reason: 'duplicate', balances: { ...doc.balances }, entry: prior };
  }

  const next = doc.balances[resource] + amount;
  if (next < 0) {
    // Refuse rather than clamp: clamping would invent value and mask the caller's bug.
    return { applied: false, reason: 'insufficient', balances: { ...doc.balances } };
  }
  if (!Number.isSafeInteger(next)) return { applied: false, reason: 'overflow', balances: { ...doc.balances } };

  const entry = { id, reason, resource, amount, at: Date.now(), meta };
  doc.balances[resource] = next;
  doc.seq += 1;
  entry.seq = doc.seq;
  entry.balanceAfter = next;
  doc.entries.push(entry);
  doc.appliedIds.push(id);
  if (doc.entries.length > JOURNAL_MAX) doc.entries = doc.entries.slice(-JOURNAL_MAX);
  if (doc.appliedIds.length > JOURNAL_MAX * 2) doc.appliedIds = doc.appliedIds.slice(-JOURNAL_MAX * 2);

  dirty.add(key);
  return { applied: true, balances: { ...doc.balances }, entry };
}

/** Recent journal entries, newest first. */
export function history(playerKey, limit = 50) {
  if (!KEY_RE.test(String(playerKey || ''))) return null;
  const doc = readDoc(String(playerKey));
  return doc.entries.slice(-Math.min(limit, JOURNAL_MAX)).reverse();
}

export function hasApplied(playerKey, id) {
  const doc = readDoc(String(playerKey));
  return doc.appliedIds.includes(id);
}

export async function flushAll() {
  const keys = [...dirty];
  dirty.clear();
  let written = 0;
  for (const key of keys) {
    const doc = cache.get(key);
    if (!doc) continue;
    try {
      await fsp.mkdir(DIR, { recursive: true });
      await writeAtomic(fileFor(key), JSON.stringify(doc));
      written++;
    } catch (e) {
      dirty.add(key);                      // keep it dirty: losing a balance write is not acceptable
      log.error('ledger write failed', { key: key.slice(0, 8), err: e.message });
    }
  }
  return written;
}

export function ledgerStats() {
  let files = 0;
  try { files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).length; } catch { /* ignore */ }
  return { players: files, cached: cache.size, dirty: dirty.size };
}

export function stopLedger() { if (timer) clearInterval(timer); timer = null; }

/** Test-only: drop in-memory state so a fresh process is simulated. */
export function _resetCache() { cache.clear(); dirty.clear(); }
