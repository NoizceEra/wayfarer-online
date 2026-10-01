import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CFG } from './config.js';
import { log } from './log.js';
import { normalizeDoc, newDoc } from './shared/marksRules.js';
import { solAddress } from './validate.js';

// Persistence + feature flags for the optional wallet / Marks layer
// (server/wallet.js, server/marks.js). Plain JSON files, no DB:
//
//   DATA_DIR/wallets/links.json   {byDevice: {dk: {addr, at}}, byAddr: {addr: {dk, at, relinkAt, attest: [...]}}}
//   DATA_DIR/wallets/audit.jsonl  append-only audit log (link / unlink / relink / reject), rotated at 5 MB
//   DATA_DIR/marks/<dk>.json      {marks: <marksRules doc>, board: {show, name, showAddr}}
//   DATA_DIR/marks/board.json     {season, rows: {dk: {name, earned, at}}}   (opted-in rows only)
//
// dk = store.deviceKey(token) (sha256 prefix); raw device tokens never touch
// disk. Every write is tmp file + fsync + rename (atomic). Link changes are
// written immediately; Marks docs and the board are write-behind
// (SAVE_FLUSH_MS) and flushed on shutdown.

const flag = (name, def) => {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return /^(1|true|on|yes)$/i.test(v);
};
const num = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : def; };

// Feature flags. Cosmetic / non-value features default ON; anything that
// could become value-bearing defaults OFF (and is a stub in this build).
export const WCFG = {
  WALLET_LINK: flag('FEATURE_WALLET_LINK', true),          // optional wallet <-> device link (signMessage only)
  MARKS: flag('FEATURE_MARKS', true),                      // off-chain cosmetic progress currency
  LEADERBOARD: flag('FEATURE_LEADERBOARD', true),          // seasonal Marks ranking (opt-in display name)
  FOUNDER_BADGE: flag('FEATURE_FOUNDER_BADGE', true),      // cosmetic frame for wallets linked before FOUNDER_CUTOFF
  SEASON_BADGE: flag('FEATURE_SEASON_BADGE', true),        // cosmetic frame for linked wallets with SEASON_BADGE_MARKS this season
  REDEEMABLE_REWARDS: flag('FEATURE_REDEEMABLE_REWARDS', false), // NOT IMPLEMENTED: must stay off (see docs/EARN_AND_COMPLIANCE.md)
  ONCHAIN_CLAIM: flag('FEATURE_ONCHAIN_CLAIM', false),     // NOT IMPLEMENTED: /wallet/claim always answers not_enabled
  SEASON: (process.env.MARKS_SEASON || 's1').replace(/[^a-z0-9_-]/gi, '').slice(0, 16) || 's1',
  FOUNDER_CUTOFF: Date.parse(process.env.FOUNDER_CUTOFF || '2027-01-01T00:00:00Z') || 0,
  SEASON_BADGE_MARKS: num('SEASON_BADGE_MARKS', 500),
  NONCE_TTL_MS: num('WALLET_NONCE_TTL_S', 300) * 1000,
  RELINK_COOLDOWN_MS: num('WALLET_RELINK_COOLDOWN_H', 24) * 3600_000,
  DOMAINS: (process.env.WALLET_DOMAIN || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  MINUTE_MS: num('MARKS_MINUTE_MS', 60_000) || 60_000,     // activity sampling period (tests shorten it)
};

const WDIR = path.join(CFG.DATA_DIR, 'wallets');
const MDIR = path.join(CFG.DATA_DIR, 'marks');
const LINKS = path.join(WDIR, 'links.json');
const AUDIT = path.join(WDIR, 'audit.jsonl');
const BOARD = path.join(MDIR, 'board.json');
const DK_RE = /^[0-9a-f]{32}$/;

let seq = 0;
export function writeAtomicSync(file, data) {
  const tmp = `${file}.${process.pid}-${Date.now().toString(36)}-${seq++}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}
function readJson(file, def) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' ? j : def; } catch (e) {
    if (e.code !== 'ENOENT') log.error('walletStore: unreadable file (starting empty)', { file, err: e.message });
    return def;
  }
}

export const links = { byDevice: {}, byAddr: {} };
export let board = { season: WCFG.SEASON, rows: {} };
const marksCache = new Map(); // dk -> {marks, board}
const dirty = new Set();      // dk | '#board'
let timer = null;

export function initWalletStore() {
  marksCache.clear();
  dirty.clear();
  fs.mkdirSync(WDIR, { recursive: true });
  fs.mkdirSync(MDIR, { recursive: true });
  for (const dir of [WDIR, MDIR]) for (const f of fs.readdirSync(dir)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ } }
  const l = readJson(LINKS, {});
  links.byDevice = l.byDevice && typeof l.byDevice === 'object' ? l.byDevice : {};
  links.byAddr = l.byAddr && typeof l.byAddr === 'object' ? l.byAddr : {};
  const b = readJson(BOARD, {});
  board = { season: WCFG.SEASON, rows: b.season === WCFG.SEASON && b.rows && typeof b.rows === 'object' ? b.rows : {} };
  timer = setInterval(() => { try { flushWalletStore(); } catch (e) { log.error('walletStore flush failed', { err: e.message }); } }, CFG.SAVE_FLUSH_MS);
  timer.unref?.();
  log.info('wallet store ready', { links: Object.keys(links.byDevice).length, season: WCFG.SEASON, flags: flagsPublic() });
}

export function saveLinks() {
  fs.mkdirSync(WDIR, { recursive: true });     // a link recorded outside init() must still persist
  writeAtomicSync(LINKS, JSON.stringify(links));
}

export function flushWalletStore() {
  for (const k of [...dirty]) {
    dirty.delete(k);
    try {
      if (k === '#board') writeAtomicSync(BOARD, JSON.stringify(board));
      else writeAtomicSync(path.join(MDIR, `${k}.json`), JSON.stringify(marksCache.get(k)));
    } catch (e) { dirty.add(k); log.error('walletStore write failed', { k, err: e.message }); }
  }
}
export function stopWalletStore() { if (timer) clearInterval(timer); timer = null; flushWalletStore(); }

// Marks record for a device (created on first use).
export function marksRec(dk) {
  if (!DK_RE.test(dk)) return null;
  let r = marksCache.get(dk);
  if (r) return r;
  const raw = readJson(path.join(MDIR, `${dk}.json`), null);
  r = { marks: raw ? normalizeDoc(raw.marks) : newDoc(), board: { show: false, name: '', showAddr: false } };
  if (raw?.board && typeof raw.board === 'object') r.board = { show: !!raw.board.show, name: String(raw.board.name || '').slice(0, 16), showAddr: !!raw.board.showAddr };
  marksCache.set(dk, r);
  return r;
}
export const markMarksDirty = (dk) => dirty.add(dk);
export const markBoardDirty = () => dirty.add('#board');
export function dropMarksCache() { marksCache.clear(); }

const ipSalt = crypto.randomBytes(16); // per-process: audit IPs are unlinkable across restarts
export const ipTag = (ip) => crypto.createHash('sha256').update(ipSalt).update(String(ip || '')).digest('hex').slice(0, 12);

export function audit(entry) {
  try {
    const st = fs.statSync(AUDIT, { throwIfNoEntry: false });
    if (st && st.size > 5 * 1048576) fs.renameSync(AUDIT, `${AUDIT}.1`);
    fs.appendFileSync(AUDIT, `${JSON.stringify({ t: new Date().toISOString(), ...entry })}\n`);
  } catch (e) { log.warn('wallet audit write failed', { err: e.message }); }
}

export function flagsPublic() {
  return {
    walletLink: WCFG.WALLET_LINK, marks: WCFG.MARKS, leaderboard: WCFG.LEADERBOARD,
    founderBadge: WCFG.FOUNDER_BADGE, seasonBadge: WCFG.SEASON_BADGE,
    redeemableRewards: false, onchainClaim: false, // hard-off in this build regardless of env
    season: WCFG.SEASON,
  };
}

// Badges a device can wear right now (derived from its wallet link attestations).
export function badgesFor(dk, rec) {
  const out = [];
  const l = links.byDevice[dk];
  if (!l) return out;
  const a = links.byAddr[l.addr];
  const att = Array.isArray(a?.attest) ? a.attest : [];
  if (WCFG.FOUNDER_BADGE && att.some((x) => x.id === 'founder')) out.push('b_founder');
  if (WCFG.SEASON_BADGE && att.some((x) => x.id === `season:${WCFG.SEASON}`)) out.push(WCFG.SEASON === 's1' ? 'b_season1' : `b_${WCFG.SEASON}`);
  return out;
}

// Off-chain attestation on a wallet record. Ids are stable strings
// ('founder', 'season:s1') so a future signed voucher / collectible claim can
// attest exactly the same ids (format: docs/EARN_AND_COMPLIANCE.md).
// Returns true when newly added (caller persists with saveLinks()).
export function attest(addr, id, extra = {}) {
  const a = links.byAddr[addr];
  if (!a) return false;
  a.attest = Array.isArray(a.attest) ? a.attest : [];
  if (a.attest.some((x) => x.id === id)) return false;
  a.attest.push({ id, at: Date.now(), ...extra });
  return true;
}
// Season badge: linked wallet + SEASON_BADGE_MARKS earned in season s1.
export function maybeSeasonAttest(dk, rec) {
  const l = links.byDevice[dk];
  if (!l || !WCFG.SEASON_BADGE) return false;
  if (rec.marks.season.id !== WCFG.SEASON || rec.marks.season.earned < WCFG.SEASON_BADGE_MARKS) return false;
  const id = `season:${WCFG.SEASON}`;
  if (!attest(l.addr, id, { season: WCFG.SEASON })) return false;
  saveLinks();
  audit({ ev: 'attest', id, dk, addr: l.addr });
  return true;
}

// ─── THE single verified-wallet authority ────────────────────────────────────
// Two wallet-link implementations arrived with the merge: the shipped `/wallet/*`
// routes (wallet.js, the client codes against them) and the WIP `/identity/*` routes.
// This module is the ONE source of truth for "is this device's wallet
// signature-verified", so a payout can never trust a link that the login path would
// refuse, and a login can never trust a link a payout would refuse.
//
// The rule:
//   * a link exists ONLY because a link route verified an Ed25519 signature over a
//     relay-issued, single-use, expiring challenge (wallet.js `/wallet/link`, or
//     identity.js `/identity/link` for kind `solana`, which routes through
//     `linkVerifiedWallet` below — it keeps no copy of its own);
//   * a record is trusted ONLY when it carries `verified:true` on BOTH the device
//     side and the address side. A record written by an older build — which stored a
//     public address with no proof of key control — FAILS CLOSED: it is never a
//     payout destination and never a login credential, so it can never be a takeover
//     payload (see server/chain/README.md).

const isVerifiedRecord = (rec) => !!rec && rec.verified === true;

/**
 * The signature-verified Solana address for this device key, or null.
 * **This is the authority**: payouts resolve their destination through it, and
 * identity resolves its `solana` kind through it.
 */
export function verifiedWalletFor(dk) {
  if (!DK_RE.test(String(dk || ''))) return null;
  const mine = links.byDevice[dk];
  if (!isVerifiedRecord(mine) || typeof mine.addr !== 'string') return null;
  const byAddr = links.byAddr[mine.addr];
  // Both sides must agree, and the wallet must still point back at this device. Any
  // disagreement fails closed rather than guessing which side is right.
  if (!isVerifiedRecord(byAddr) || byAddr.dk !== dk) return null;
  return mine.addr;
}

/** The verified link record for a device key: { address, addedAt, verified } | null. */
export function verifiedWalletRecordFor(dk) {
  const address = verifiedWalletFor(dk);
  if (!address) return null;
  return { address, addedAt: links.byDevice[dk].at || 0, verified: true };
}

/** The device key that owns a signature-verified link to `address`, or null. */
export function deviceWithVerifiedWallet(address) {
  const addr = String(address || '').trim();
  const byAddr = links.byAddr[addr];
  if (!isVerifiedRecord(byAddr) || typeof byAddr.dk !== 'string' || !DK_RE.test(byAddr.dk)) return null;
  const mine = links.byDevice[byAddr.dk];
  if (!isVerifiedRecord(mine) || mine.addr !== addr) return null;
  return byAddr.dk;
}

/**
 * Record a SIGNATURE-VERIFIED wallet link. The one write path for wallet links:
 * wallet.js `/wallet/link` and identity.js `/identity/link` (kind `solana`) both call
 * it AFTER verifying the signature, so there is exactly one place the link can exist
 * and exactly one place the one-wallet-per-device / one-device-per-wallet rules live.
 *
 * A pre-existing link WITHOUT the verified flag (legacy on-disk state) is treated as
 * absent here: the honest owner can simply re-link with a signature, and the legacy
 * record is never usable in the meantime.
 *
 * @returns {{ok:boolean, error?:string, relinked?:boolean, oldDk?:string}}
 */
export function linkVerifiedWallet(dk, address, { action = 'link', now = Date.now(), save = true } = {}) {
  if (!DK_RE.test(String(dk || ''))) return { ok: false, error: 'bad_device' };
  if (!solAddress(String(address || '').trim())) return { ok: false, error: 'bad_address' };
  const addr = String(address).trim();

  const mine = links.byDevice[dk];
  if (isVerifiedRecord(mine)) {
    return mine.addr === addr ? { ok: false, error: 'already_linked' } : { ok: false, error: 'device_has_wallet' };
  }
  // Unverified legacy entry for this device: drop it so it can never shadow the real
  // link, and clear its back-reference if it still points here.
  if (mine && mine.addr && links.byAddr[mine.addr]?.dk === dk) links.byAddr[mine.addr].dk = null;
  delete links.byDevice[dk];

  const other = links.byAddr[addr];
  let relinked = false;
  let oldDk = null;
  if (other && other.dk && other.dk !== dk) {
    if (action !== 'relink') return { ok: false, error: 'wallet_linked_elsewhere' };
    if (other.relinkAt && now - other.relinkAt < WCFG.RELINK_COOLDOWN_MS) return { ok: false, error: 'relink_cooldown' };
    oldDk = other.dk;
    delete links.byDevice[oldDk];
    relinked = true;
  }

  links.byDevice[dk] = { addr, at: now, verified: true };
  const a = other || { attest: [] };
  links.byAddr[addr] = { ...a, dk, at: a.at || now, relinkAt: relinked ? now : a.relinkAt, verified: true };
  if (save) saveLinks();
  return { ok: true, relinked, oldDk };
}

/**
 * Remove a device's wallet link (any time, no signature needed — losing a link is
 * always safe). Keeps the wallet record itself (attestations, relink cooldown).
 */
export function unlinkVerifiedWallet(dk) {
  const mine = links.byDevice[dk];
  if (!mine) return { ok: true, linked: false };
  delete links.byDevice[dk];
  const a = mine.addr ? links.byAddr[mine.addr] : null;
  if (a && a.dk === dk) { a.dk = null; delete a.verified; }
  return { ok: true, linked: true, address: mine.addr };
}
