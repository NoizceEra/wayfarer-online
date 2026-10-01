import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { CFG } from './config.js';
import { log } from './log.js';
import {
  TOKEN_RE, deviceKey, docKeyFor, getDocByKey, markDirty, writeAtomic, setAlias, hasDoc,
} from './store.js';
import { issueNonce, verifyWalletLink, isSolanaAddress } from './chain/walletAuth.js';
import {
  WCFG, saveLinks, linkVerifiedWallet, verifiedWalletRecordFor, deviceWithVerifiedWallet,
} from './walletStore.js';

// Identity: guest-first, link-later, wallet-as-a-badge.
// No backend service, no database: the same file-backed store plus one small
// reverse index so a recovery code (or a wallet address) can find its account.
//   DATA_DIR/links/<sha256(kind + ':' + id)[0:32]>.json = { primaryKey, kind, idHash, addedAt }
//
// SECURITY INVARIANTS
//  * Raw recovery codes are NEVER written to disk — only sha256(kind + ':' + id)[0:32]
//    (idHash). Raw device tokens were already never written (see store.js).
//  * THIS MODULE KEEPS NO WALLET LINK OF ITS OWN. Two wallet-link implementations
//    arrived with the merge and this was the duplicate one. Kind `solana` now resolves
//    through the single signature-verified authority in `server/walletStore.js`: this
//    module verifies the signature and then hands the link to that authority, and it
//    reads the link back from that authority. A wallet address is public, so it is a
//    credential only while the authority holds a signature-verified link for it; a
//    legacy on-disk record fails closed and can never mint a token.
//  * POST /identity/continue MINTS a brand-new random device token and returns it.
//    It never returns, echoes or logs an existing token — the existing account
//    credential does not exist on disk, so it cannot be leaked from here.
//  * Logs carry hashes/counts only: never a token, a recovery code or an address.
//
// NOTE: the authority stores the wallet ADDRESS in the clear (DATA_DIR/wallets/
// links.json) — it must, because that is the payout destination. This module never
// writes an address to its own links dir.

const KINDS = new Set(['recovery', 'solana']);
const LINK_DIR = path.join(CFG.DATA_DIR, 'links');
const MAX_BODY = '2kb';                       // tiny JSON bodies only

const linkIdHash = (kind, id) => crypto.createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 32);
const linkFileFor = (h) => path.join(LINK_DIR, `${h}.json`);
const publicLinks = (doc) => (Array.isArray(doc?.links) ? doc.links : [])
  .filter((l) => l && typeof l.kind === 'string')
  .map((l) => ({ kind: l.kind, addedAt: l.addedAt || 0, verified: l.verified === true }));

// ─── shape validation / normalisation ────────────────────────────────────────
// Recovery code: 20+ chars of [A-Za-z0-9-_] and/or grouping dashes. Any case is
// accepted and separators are stripped, then it is uppercased, so the same code
// typed with or without dashes (or in lower case) is the same link.
function normRecovery(id) {
  const raw = String(id || '');
  if (raw.length > 80) return null;
  const body = raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  if (body.length < 20 || body.length > 64) return null;
  return body;
}
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;   // base58, case sensitive
function normSolana(id) {
  const s = String(id || '').trim();
  return SOLANA_RE.test(s) ? s : null;
}
function normalizeId(kind, id) {
  if (kind === 'recovery') return normRecovery(id);
  if (kind === 'solana') return normSolana(id);
  return null;
}

// ─── reverse index (same atomic tmp+rename write style as the player files) ──
async function readLink(idHash) {
  try {
    const p = JSON.parse(await fsp.readFile(linkFileFor(idHash), 'utf8'));
    return p && typeof p.primaryKey === 'string' ? p : null;
  } catch (e) {
    if (e.code !== 'ENOENT') log.warn('link index read failed', { h: String(idHash).slice(0, 12), err: e.message });
    return null;
  }
}
async function writeLink(idHash, rec) {
  await fsp.mkdir(LINK_DIR, { recursive: true });
  await writeAtomic(linkFileFor(idHash), JSON.stringify(rec));
}

// ─── rate limit (in-memory token bucket per IP, same pattern as social.js) ───
// One bucket map per mounted app, so mounting cannot share counters.
const DEFAULT_RATE = { burst: 10, perMs: 1500 };   // 10 burst, ~1 req / 1.5s sustained
const clientIp = (req) => String(req.ip || req.socket?.remoteAddress || 'unknown');

function makeRateGate(rate) {
  const buckets = new Map();                      // ip -> { tokens, t }
  return (req, res, next) => {
    const ip = clientIp(req);
    const now = Date.now();
    const b = buckets.get(ip) || { tokens: rate.burst, t: now };
    b.tokens = Math.min(rate.burst, b.tokens + (now - b.t) / rate.perMs);
    b.t = now;
    buckets.set(ip, b);
    if (buckets.size > 5000) { for (const [k, v] of buckets) if (now - v.t > 600000) buckets.delete(k); }
    if (b.tokens < 1) { res.status(429).json({ ok: false, error: 'rate_limited' }); return; }
    b.tokens -= 1;
    next();
  };
}
const fail = (res, status, error) => res.status(status).json({ ok: false, error });
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  log.error('identity route failed', { err: e.message });           // message only: no ids, no tokens
  if (!res.headersSent) res.status(500).json({ ok: false, error: 'internal' });
});

// ─── handlers ────────────────────────────────────────────────────────────────
// The links reported for a device: the identity links on the player document
// (recovery codes) plus, read back from the ONE authority, its signature-verified
// wallet link. identity keeps no wallet link of its own.
async function linksFor(docKey, dk) {
  const out = publicLinks(getDocByKey(docKey));
  const rec = verifiedWalletRecordFor(dk);
  if (rec) out.push({ kind: 'solana', addedAt: rec.addedAt, verified: true });
  return out;
}

// POST /identity/link, kind 'solana' — prove the key, then hand the link to the
// authority. Nothing is stored here: `linkVerifiedWallet` is the single write path.
async function postWalletLink(req, res, { token, addr, docKey }) {
  if (!WCFG.WALLET_LINK) return fail(res, 403, 'wallet_link_disabled');
  const { message, signature } = req.body || {};
  // A wallet ADDRESS is public — it is on-chain and in every marketplace UI — so
  // presenting one proves nothing about ownership. Linking a wallet is therefore an
  // authentication step: it must carry a signature over a challenge WE issued.
  // Without this, a public address becomes a login credential and anyone could mint
  // a token into a player's account.
  if (typeof message !== 'string' || typeof signature !== 'string') {
    return fail(res, 401, 'wallet_signature_required');
  }
  try {
    verifyWalletLink(addr, message, signature);
  } catch {
    // Deliberately one generic error: never tell a caller which half failed.
    return fail(res, 401, 'wallet_not_proven');
  }

  const dk = deviceKey(token);
  const r = linkVerifiedWallet(dk, addr, { action: 'link', save: false });
  if (!r.ok) {
    if (r.error === 'already_linked') return res.json({ ok: true, links: await linksFor(docKey, dk) });
    if (r.error === 'relink_cooldown') return fail(res, 429, 'relink_cooldown');
    if (r.error === 'device_has_wallet') return fail(res, 409, 'device_has_wallet');
    if (r.error === 'wallet_linked_elsewhere') return fail(res, 409, 'link_taken');
    return fail(res, 400, r.error);
  }
  try { saveLinks(); } catch (e) {
    log.error('identity: wallet link persist failed', { err: e.message });
    return fail(res, 500, 'store_failed');
  }
  log.info('identity: wallet link recorded in the single authority', { key: dk.slice(0, 8) });
  res.json({ ok: true, links: await linksFor(docKey, dk) });
}

// POST /identity/link { token, kind, id } — attach a recovery code to the account
// `token` owns (kind 'solana' is routed to the authority above). Idempotent; never
// steals an id bound elsewhere.
async function postLink(req, res) {
  const { token, kind, id } = req.body || {};
  if (!TOKEN_RE.test(String(token || ''))) return fail(res, 400, 'bad_token');
  if (!KINDS.has(kind)) return fail(res, 400, 'bad_kind');
  const norm = normalizeId(kind, id);
  if (!norm) return fail(res, 400, 'bad_id');
  const docKey = docKeyFor(token);
  if (!docKey) return fail(res, 400, 'bad_token');

  if (kind === 'solana') return postWalletLink(req, res, { token, addr: norm, docKey });

  const idHash = linkIdHash(kind, norm);
  const existing = await readLink(idHash);
  if (existing && existing.primaryKey !== docKey) return fail(res, 409, 'link_taken');

  const doc = getDocByKey(docKey);
  if (!doc) return fail(res, 400, 'bad_token');
  const docLinks = Array.isArray(doc.links) ? doc.links : (doc.links = []);
  if (!docLinks.some((l) => l && l.kind === kind && l.idHash === idHash)) {
    const addedAt = Date.now();
    docLinks.push({ kind, idHash, addedAt });
    markDirty(docKey);
    await writeLink(idHash, { primaryKey: docKey, kind, idHash, addedAt, verified: false });
    log.info('identity link added', { kind, key: docKey.slice(0, 8), idHash: idHash.slice(0, 8) });
  }
  res.json({ ok: true, links: await linksFor(docKey, deviceKey(token)) });
}

// POST /identity/continue { kind, id } — recover an account on a new device.
// MINTS A NEW TOKEN: never returns the account's existing one.
async function postContinue(req, res) {
  const { kind, id } = req.body || {};
  if (!KINDS.has(kind)) return fail(res, 400, 'bad_kind');
  const norm = normalizeId(kind, id);
  if (!norm) return fail(res, 400, 'bad_id');

  if (kind === 'solana') {
    // Kind 'solana' RESOLVES THROUGH THE ONE AUTHORITY (server/walletStore.js). The
    // address is public, so it is a credential only while the authority holds a
    // signature-verified link for it — and the account is the device that holds that
    // link. Everything the old duplicate identity link dir holds is, by definition,
    // not the authority's answer, so it fails closed and mints nothing.
    const dk = deviceWithVerifiedWallet(norm);
    if (!dk) {
      const legacy = await readLink(linkIdHash('solana', norm));
      return fail(res, 403, legacy ? 'wallet_not_verified' : 'code_unknown');
    }
    if (!hasDoc(dk)) return fail(res, 404, 'code_unknown');
    const newToken = crypto.randomBytes(18).toString('base64url');    // 24 chars, matches TOKEN_RE
    const ok = await setAlias(deviceKey(newToken), dk);
    if (!ok) return fail(res, 500, 'alias_failed');
    log.info('identity continue: alias minted via the verified-wallet authority', { key: dk.slice(0, 8) });
    return res.json({ ok: true, token: newToken });
  }

  const rec = await readLink(linkIdHash(kind, norm));
  if (!rec || !hasDoc(String(rec.primaryKey))) return fail(res, 404, 'code_unknown');

  // WHY THIS GATE EXISTS: a recovery code is a SECRET, so presenting it is itself the
  // proof of possession. A wallet address is PUBLIC and never reaches this branch.
  const primaryKey = String(rec.primaryKey);
  const newToken = crypto.randomBytes(18).toString('base64url');    // 24 chars, matches TOKEN_RE
  const ok = await setAlias(deviceKey(newToken), primaryKey);
  if (!ok) return fail(res, 500, 'alias_failed');
  log.info('identity continue: alias minted', { kind, key: primaryKey.slice(0, 8) }); // counts/hashes only
  res.json({ ok: true, token: newToken });
}

// POST /identity/wallet-challenge { wallet } — the exact message a wallet must sign
// before its address can be linked. Single-use, 5-minute TTL, one pending per wallet.
function postWalletChallenge(req, res) {
  const wallet = String((req.body || {}).wallet || '').trim();
  if (!isSolanaAddress(wallet)) return fail(res, 400, 'bad_address');
  const { message, expiresAt } = issueNonce(wallet);
  res.json({ ok: true, message, expiresAt });           // no secret is returned: the
}                                                       // challenge is meant to be public

// GET /identity/status?token=... — what this token owns (never mints, never writes).
// The wallet half is read back from the ONE authority (server/walletStore.js); this
// module keeps no copy of a wallet link, so there is nothing here to drift.
function getStatus(req, res) {
  const token = String(req.query.token || '');
  if (!TOKEN_RE.test(token)) return fail(res, 400, 'bad_token');
  const doc = getDocByKey(docKeyFor(token));
  const links = publicLinks(doc);
  const rec = verifiedWalletRecordFor(deviceKey(token));
  if (rec) links.push({ kind: 'solana', addedAt: rec.addedAt, verified: true });
  const chars = doc
    ? Object.entries(doc.chars).map(([lower, rec2]) => (rec2 && typeof rec2.name === 'string' && rec2.name) || lower)
    : [];
  res.json({ ok: true, links, chars });
}

// Sweep tmp files a crash may have left in the link index dir.
try {
  fs.mkdirSync(LINK_DIR, { recursive: true });
  for (const f of fs.readdirSync(LINK_DIR)) if (f.endsWith('.tmp')) { try { fs.unlinkSync(path.join(LINK_DIR, f)); } catch { /* ignore */ } }
} catch (e) { log.warn('link dir init failed', { err: e.message }); }

// Mounted from server/index.js next to the social hook: `identity.routes(app)`.
// opts.rate exists ONLY so a test can drive many requests from one IP without
// tripping the limiter; the relay (server/index.js) always uses the defaults.
export function routes(app, opts = {}) {
  if (!app || typeof app.post !== 'function' || typeof app.get !== 'function') {
    throw new Error('identity.routes(app): express app required');
  }
  const rateGate = makeRateGate({ ...DEFAULT_RATE, ...(opts.rate || {}) });
  const json = express.json({ limit: MAX_BODY });
  app.post('/identity/link', json, rateGate, wrap(postLink));
  app.post('/identity/continue', json, rateGate, wrap(postContinue));
  app.post('/identity/wallet-challenge', json, rateGate, wrap(postWalletChallenge));
  app.get('/identity/status', rateGate, wrap(getStatus));
  log.info('identity routes ready', { kinds: [...KINDS], dir: LINK_DIR });
}

// Self-contained app embedding the same routes (self-test / standalone use).
export function createApp(opts = {}) {
  const app = express();
  routes(app, opts);
  return app;
}
