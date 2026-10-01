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

// Identity: guest-first, link-later, wallet-as-a-badge.
// No backend service, no database: the same file-backed store plus one small
// reverse index so a recovery code (or a wallet address) can find its account.
//   DATA_DIR/links/<sha256(kind + ':' + id)[0:32]>.json = { primaryKey, kind, idHash, addedAt }
//
// SECURITY INVARIANTS
//  * Raw recovery codes and wallet addresses are NEVER written to disk — only
//    sha256(kind + ':' + id)[0:32] (idHash). Raw device tokens were already never
//    written (see store.js); this module does not change that.
//  * POST /identity/continue MINTS a brand-new random device token and returns it.
//    It never returns, echoes or logs an existing token — the existing account
//    credential does not exist on disk, so it cannot be leaked from here.
//  * Logs carry hashes/counts only: never a token, a recovery code or an address.

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
// POST /identity/link { token, kind, id } — attach a recovery code / wallet to
// the account `token` owns. Idempotent; never steals an id bound elsewhere.
async function postLink(req, res) {
  const { token, kind, id } = req.body || {};
  if (!TOKEN_RE.test(String(token || ''))) return fail(res, 400, 'bad_token');
  if (!KINDS.has(kind)) return fail(res, 400, 'bad_kind');
  const norm = normalizeId(kind, id);
  if (!norm) return fail(res, 400, 'bad_id');
  const docKey = docKeyFor(token);
  if (!docKey) return fail(res, 400, 'bad_token');
  const idHash = linkIdHash(kind, norm);

  // A wallet ADDRESS is public — it is on-chain and in every marketplace UI — so
  // presenting one proves nothing about ownership. Linking a wallet is therefore an
  // authentication step: it must carry a signature over a challenge WE issued.
  // Without this, /identity/continue would turn a public address into a login
  // credential and anyone could mint a token into a player's account.
  let verified = false;
  if (kind === 'solana') {
    const { message, signature } = req.body || {};
    if (typeof message !== 'string' || typeof signature !== 'string') {
      return fail(res, 401, 'wallet_signature_required');
    }
    try {
      verifyWalletLink(norm, message, signature);
      verified = true;
    } catch {
      // Deliberately one generic error: never tell a caller which half failed.
      return fail(res, 401, 'wallet_not_proven');
    }
  }

  const existing = await readLink(idHash);
  if (existing && existing.primaryKey !== docKey) return fail(res, 409, 'link_taken');

  const doc = getDocByKey(docKey);
  if (!doc) return fail(res, 400, 'bad_token');
  const links = Array.isArray(doc.links) ? doc.links : (doc.links = []);
  if (!links.some((l) => l && l.kind === kind && l.idHash === idHash)) {
    const addedAt = Date.now();
    const entry = { kind, idHash, addedAt };
    if (verified) entry.verified = true;
    links.push(entry);
    markDirty(docKey);
    await writeLink(idHash, { primaryKey: docKey, kind, idHash, addedAt, verified });
    log.info('identity link added', { kind, key: docKey.slice(0, 8), idHash: idHash.slice(0, 8) });
  }
  res.json({ ok: true, links: publicLinks(doc) });
}

// POST /identity/continue { kind, id } — recover an account on a new device.
// MINTS A NEW TOKEN: never returns the account's existing one.
async function postContinue(req, res) {
  const { kind, id } = req.body || {};
  if (!KINDS.has(kind)) return fail(res, 400, 'bad_kind');
  const norm = normalizeId(kind, id);
  if (!norm) return fail(res, 400, 'bad_id');

  const rec = await readLink(linkIdHash(kind, norm));
  if (!rec || !hasDoc(String(rec.primaryKey))) return fail(res, 404, 'code_unknown');

  // WHY THIS GATE EXISTS: a recovery code is a SECRET, so presenting it is itself the
  // proof of possession. A wallet address is PUBLIC, so it is only ever a credential
  // if the link was established with a signature. Links written before this rule
  // (verified !== true) are treated as unproven and cannot mint a token — fail closed.
  if (kind === 'solana' && rec.verified !== true) return fail(res, 403, 'wallet_not_verified');
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

// Is `address` a SIGNATURE-VERIFIED wallet linked to `playerKey`?
// This is the gate every payout passes through. It checks BOTH the player's own link
// list and the reverse index, and requires `verified` on each: for a bad/unverified
// state any one of the two disagreeing must refuse, so it fails closed.
export async function isWalletVerifiedFor(playerKey, address) {
  const doc = getDocByKey(String(playerKey || ''));
  if (!doc) return false;                       // invalid key or unknown player
  const norm = normSolana(address);
  if (!norm) return false;
  const idHash = linkIdHash('solana', norm);
  const inDoc = Array.isArray(doc.links)
    && doc.links.some((l) => l && l.kind === 'solana' && l.idHash === idHash && l.verified === true);
  if (!inDoc) return false;
  const rec = await readLink(idHash);
  return Boolean(rec && rec.primaryKey === String(playerKey) && rec.verified === true);
}

// GET /identity/status?token=... — what this token owns (never mints, never writes).
function getStatus(req, res) {
  const token = String(req.query.token || '');
  if (!TOKEN_RE.test(token)) return fail(res, 400, 'bad_token');
  const doc = getDocByKey(docKeyFor(token));
  const chars = doc
    ? Object.entries(doc.chars).map(([lower, rec]) => (rec && typeof rec.name === 'string' && rec.name) || lower)
    : [];
  res.json({ ok: true, links: publicLinks(doc), chars });
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
