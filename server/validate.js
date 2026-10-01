import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Light anti-cheat for uploaded character saves. Not a full authority: the
// client simulates combat, so we bound what a save can claim instead.
//  - shape/size limits on every field (junk never reaches disk)
//  - progression rate caps vs the previous server copy (level, gold)
// Returns { rec, clamped: string[] }.
const int = (v, lo, hi, d) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const jsonSize = (o) => { try { return JSON.stringify(o).length; } catch { return Infinity; } };
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

export const CAPS = {
  LEVEL_MAX: 99,
  GOLD_MAX: 9_999_999,
  // Gold a brand-new character may already hold on its FIRST upload. The clamp
  // below treats a missing previous record as this baseline instead of trusting
  // the save, so a first upload cannot set its own level and gold.
  freshGold: 0,
  // a level every 20s of wall time + 1 is far above any legit pace
  levelPerSec: 1 / 20,
  // generous: quest rewards / boss / selling a bag of epics
  goldBase: 1500, goldPerSec: 60,
};

export function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null;
  const out = {
    job: str(p.job, 24) || 'wayfarer',
    level: int(p.level, 1, CAPS.LEVEL_MAX, 1),
    xp: int(p.xp, 0, 1e9, 0),
    xpNext: int(p.xpNext, 1, 1e9, 100),
    gold: int(p.gold, 0, CAPS.GOLD_MAX, 0),
    potions: int(p.potions, 0, 99, 0),
    maxHp: int(p.maxHp, 1, 1e6, 100), maxMp: int(p.maxMp, 0, 1e6, 30), atk: int(p.atk, 0, 1e6, 10),
    x: int(p.x, -20000, 40000, 0), y: int(p.y, -20000, 40000, 0),
    inventory: (Array.isArray(p.inventory) ? p.inventory : []).filter((s) => typeof s === 'string' && s.length <= 48).slice(0, 40),
    equipped: {}, dyes: {},
    quest: p.quest && typeof p.quest === 'object' && jsonSize(p.quest) < 24_000 ? p.quest : { idx: 0, kills: {} },
    prog: p.prog && typeof p.prog === 'object' && jsonSize(p.prog) < 12_000 ? p.prog : null,
    savedAt: int(p.savedAt, 0, 9e15, Date.now()),
  };
  if (p.equipped && typeof p.equipped === 'object') {
    for (const [k, v] of Object.entries(p.equipped).slice(0, 16)) if (typeof k === 'string' && k.length < 16 && (v === null || (typeof v === 'string' && v.length <= 48))) out.equipped[k] = v;
  }
  if (p.dyes && typeof p.dyes === 'object') {
    for (const [k, v] of Object.entries(p.dyes).slice(0, 48)) if (k.length <= 48 && typeof v === 'string' && v.length <= 24) out.dyes[k] = v;
  }
  return out;
}

export function sanitizeHero(h) {
  if (!h || typeof h !== 'object' || jsonSize(h) > 6000) return null;
  return h;
}

// prev: last accepted server record ({progress, savedAt}) or null
export function validateSave(prev, progress, now = Date.now()) {
  const clamped = [];
  const p = sanitizeProgress(progress);
  if (!p) return { rec: null, clamped: ['invalid'] };
  // A MISSING previous record must not be a licence to claim anything. Treat a
  // first save as a fresh character at the baseline allowance and apply the SAME
  // rate clamp; previously `if (pp)` skipped clamping entirely, so a fresh device
  // could upload level 99 / 100k gold verbatim, and because one device may hold 12
  // characters that mint was repeatable (docs/audit/validation.md:
  // forged-first-save, mint-per-character). Clamping is deliberately the response
  // rather than a rejection, so an honest client resyncs instead of losing the
  // character; `clamped` is reported to the caller either way.
  const pp = prev?.progress;
  const base = pp
    ? { level: pp.level, gold: pp.gold, savedAt: prev.savedAt || now }
    : { level: 1, gold: CAPS.freshGold, savedAt: now };
  const dt = Math.max(0, (now - (base.savedAt || now)) / 1000);
  const maxLevel = base.level + 1 + Math.floor(dt * CAPS.levelPerSec);
  if (p.level > maxLevel) { clamped.push(`level ${p.level}>${maxLevel}`); p.level = maxLevel; }
  const maxGold = base.gold + CAPS.goldBase + Math.floor(dt * CAPS.goldPerSec);
  if (p.gold > maxGold) { clamped.push(`gold ${p.gold}>${maxGold}`); p.gold = maxGold; }
  return { rec: p, clamped };
}

// ─── economy (trade / market / mail / guild bank) ─────────────────────
// Item ids come from server/shared/item_ids.json, generated from the client
// catalogues by tools/export_item_ids.mjs (the client imports the same file).
// Only bag gear (progress.inventory) is tradable; ids outside the whitelist are
// rejected by every economy handler. Saves are NOT filtered by it (a stale
// whitelist must never delete items from a character).
let ITEM_DB = { gear: {}, items: [], mats: [] };
try {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shared', 'item_ids.json');
  ITEM_DB = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (e) { console.error(`item_ids.json missing or invalid (${e.message}): economy rejects every item`); }
export const GEAR_META = ITEM_DB.gear || {};

export const ECON = {
  BAG_SIZE: 30,              // client BAG_SIZE (src/core/save.js)
  TRADE_ITEMS: 8,            // per side
  GOLD_MAX: CAPS.GOLD_MAX,
  PRICE_MAX: 1_000_000,
  MARKET_TAX: 0.05,          // listing fee (gold sink), paid up front, not refunded
  MARKET_HOURS: [2, 8, 24, 48],
  MARKET_MAX_PER_SELLER: 10,
  MAIL_ITEMS: 5,
  MAIL_POSTAGE: 5,           // gold sink per player mail
  MAIL_BOX_MAX: 50,          // player mail refused beyond this (system mail always delivers)
  TEXT_MAX: 200,
  SUBJECT_MAX: 40,
  MOTD_MAX: 120,
};

export const isGearId = (id) => typeof id === 'string' && id.length <= 48 && Object.prototype.hasOwnProperty.call(GEAR_META, id);
// whole gold amount in [0, max] or null (no floats, no strings, no negatives)
export function goldAmount(v, max = ECON.GOLD_MAX) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > max) return null;
  return v;
}
// array of whitelisted gear ids, at most `max`, or null if anything is off
export function itemList(v, max) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max) return null;
  for (const id of v) if (!isGearId(id)) return null;
  return v.slice();
}
export const cleanLine = (t, max) => String(t ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanCharName = (t) => String(t ?? '').replace(/[^\w \-']/g, '').trim().slice(0, 14);
export const revOf = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
// multiset check: does `inv` contain every id of `want` (with multiplicity)?
export function hasItems(inv, want) {
  const n = new Map();
  for (const id of inv || []) n.set(id, (n.get(id) || 0) + 1);
  for (const id of want) { const c = n.get(id) || 0; if (c < 1) return false; n.set(id, c - 1); }
  return true;
}
// copy of `inv` with one occurrence of each id of `take` removed
export function withoutItems(inv, take) {
  const out = (inv || []).slice();
  for (const id of take) { const i = out.indexOf(id); if (i >= 0) out.splice(i, 1); }
  return out;
}

// ─── wallet link + Marks (server/wallet.js, server/marks.js) ─────────
// Solana addresses are base58 ed25519 public keys (32 bytes); signatures are
// base58 ed25519 signatures (64 bytes). Strict: anything else is rejected.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));
export function b58decode(s) {
  if (typeof s !== 'string' || !s.length || s.length > 128) return null;
  let n = 0n;
  for (const ch of s) { const v = B58_MAP[ch]; if (v === undefined) return null; n = n * 58n + BigInt(v); }
  const bytes = [];
  while (n > 0n) { bytes.push(Number(n & 0xffn)); n >>= 8n; }
  for (const ch of s) { if (ch === '1') bytes.push(0); else break; }
  return Buffer.from(bytes.reverse());
}
export function b58encode(buf) {
  const b = Buffer.from(buf);
  let n = 0n;
  for (const x of b) n = (n << 8n) + BigInt(x);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of b) { if (x === 0) out = `1${out}`; else break; }
  return out;
}
// -> 32-byte Buffer or null (canonical encoding only)
export function solAddress(v) {
  if (typeof v !== 'string' || v.length < 32 || v.length > 44) return null;
  const b = b58decode(v);
  return b && b.length === 32 && b58encode(b) === v ? b : null;
}
// -> 64-byte Buffer or null
export function solSignature(v) {
  if (typeof v !== 'string' || v.length < 64 || v.length > 90) return null;
  const b = b58decode(v);
  return b && b.length === 64 ? b : null;
}
export const NONCE_RE = /^[A-Za-z0-9]{24,48}$/;
export const WALLET_ACTIONS = new Set(['link', 'relink']);
// leaderboard display name: letters, digits, space, - ' _ ; 2..16 chars
export function displayName(v) {
  const s = String(v ?? '').replace(/[^\p{L}\p{N} \-'_]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return s.length >= 2 ? s : null;
}
export const shortAddr = (a) => (typeof a === 'string' && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : '');
