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
  // a level every 20s of wall time + 1 is far above any legit pace
  levelPerSec: 1 / 20,
  // generous starting/earned gold cap per save (no per-second compounding)
  goldBase: 1500, goldPerSec: 0,
};

export function sanitizeProgress(p) {
  if (!p || typeof p !== 'object') return null;
  const ext = sanitizeExtras(p.ext);
  const out = {
    job: str(p.job, 24) || 'wayfarer',
    level: int(p.level, 1, CAPS.LEVEL_MAX, 1),
    xp: int(p.xp, 0, 1e9, 0),
    xpNext: int(p.xpNext, 1, 1e9, 100),
    gold: int(p.gold, 0, CAPS.GOLD_MAX, 0),
    tokenPoints: int(p.tokenPoints, 0, 1e9, 0),
    wayfarerTokens: int(p.wayfarerTokens, 0, 1e9, 0),
    potions: int(p.potions, 0, 99, 0),
    maxHp: int(p.maxHp, 1, 1e6, 100), maxMp: int(p.maxMp, 0, 1e6, 30), atk: int(p.atk, 0, 1e6, 10),
    x: int(p.x, -20000, 40000, 0), y: int(p.y, -20000, 40000, 0),
    inventory: (Array.isArray(p.inventory) ? p.inventory : []).filter((s) => typeof s === 'string' && s.length <= 48).slice(0, 40),
    equipped: {}, dyes: {},
    quest: p.quest && typeof p.quest === 'object' && jsonSize(p.quest) < 24_000 ? p.quest : { idx: 0, kills: {} },
    prog: p.prog && typeof p.prog === 'object' && jsonSize(p.prog) < 12_000 ? p.prog : null,
    savedAt: int(p.savedAt, 0, 9e15, Date.now()),
    ext,
  };
  if (p.equipped && typeof p.equipped === 'object') {
    for (const [k, v] of Object.entries(p.equipped).slice(0, 16)) if (typeof k === 'string' && k.length < 16 && (v === null || (typeof v === 'string' && v.length <= 48))) out.equipped[k] = v;
  }
  if (p.dyes && typeof p.dyes === 'object') {
    for (const [k, v] of Object.entries(p.dyes).slice(0, 48)) if (k.length <= 48 && typeof v === 'string' && v.length <= 24) out.dyes[k] = v;
  }
  // sanitize token-sink progress fields inside ext
  if (out.ext && typeof out.ext === 'object') {
    out.ext.stashTabs = Math.max(0, Math.min(5, Math.floor(Number(out.ext.stashTabs)) || 0));
    if (!out.ext.bridgeDailyClaimed || typeof out.ext.bridgeDailyClaimed !== 'object') {
      out.ext.bridgeDailyClaimed = { date: '', amount: 0 };
    } else {
      out.ext.bridgeDailyClaimed = {
        date: String(out.ext.bridgeDailyClaimed.date || '').slice(0, 10),
        amount: Math.max(0, Math.floor(Number(out.ext.bridgeDailyClaimed.amount)) || 0),
      };
    }
  }
  return out;
}

function sanitizeExtras(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (jsonSize(raw) > 48_000) return null;
  return raw;
}

export function sanitizeHero(h) {
  if (!h || typeof h !== 'object' || jsonSize(h) > 8000) return null;
  return h;
}

// prev: last accepted server record ({progress, savedAt}) or null
export function validateSave(prev, progress, now = Date.now()) {
  const clamped = [];
  const p = sanitizeProgress(progress);
  if (!p) return { rec: null, clamped: ['invalid'] };
  const pp = prev?.progress;
  if (pp) {
    const dt = Math.max(0, (now - (prev.savedAt || now)) / 1000);
    const maxLevel = pp.level + 1 + Math.floor(dt * CAPS.levelPerSec);
    if (p.level > maxLevel) { clamped.push(`level ${p.level}>${maxLevel}`); p.level = maxLevel; }
    // Subsequent saves: gold can only grow by time-based earnings (no flat per-save bonus)
    const maxGold = Math.min(CAPS.GOLD_MAX, pp.gold + Math.floor(dt * CAPS.goldPerSec));
    if (p.gold > maxGold) { clamped.push(`gold ${p.gold}>${maxGold}`); p.gold = maxGold; }
  } else {
    // First save: hard clamp to starter values
    if (p.gold > CAPS.goldBase) { clamped.push(`first-gold ${p.gold}>${CAPS.goldBase}`); p.gold = CAPS.goldBase; }
    if (p.level > 1) { clamped.push(`first-level ${p.level}>1`); p.level = 1; }
    const starter = p.inventory.filter(isGearId).slice(0, 3);
    if (p.inventory.length !== starter.length) { clamped.push(`first-inv ${p.inventory.length}>${starter.length}`); p.inventory = starter; }
  }
  const invBefore = p.inventory.length;
  p.inventory = p.inventory.filter(isGearId);
  if (p.inventory.length !== invBefore) clamped.push(`inventory ${invBefore}->${p.inventory.length} non-gear removed`);
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
  TOKEN_CLAIM_FEE: 0.05,     // platform fee on token claims (gold sink)
  TOKEN_WITHDRAW_FEE: 0.075, // platform fee on bridge withdrawals (in-game -> on-chain)
  TOKEN_WITHDRAW_DAILY_CAP: 500, // max Wayfarer Tokens claimable/withdrawable per wallet per day
  TOKEN_SINK_TYPES: new Set(['orb-upgrade', 'revive', 'pet-rename', 'stash-tab']),
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
export const cleanPetName = (t) => String(t ?? '').replace(/[^\w \-']/g, '').trim().slice(0, 24);
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
