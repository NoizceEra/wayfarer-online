import crypto from 'crypto';
import express from 'express';
import { log } from './log.js';
import { deviceKey, TOKEN_RE } from './store.js';
import { solAddress, solSignature, NONCE_RE, WALLET_ACTIONS, shortAddr } from './validate.js';
import {
  WCFG, links, initWalletStore, stopWalletStore, flushWalletStore, saveLinks, audit, ipTag, flagsPublic, badgesFor,
  marksRec, attest,
} from './walletStore.js';
import * as marks from './marks.js';

// OPTIONAL wallet link + Wayfarer Marks module. Loaded by index.js like
// economy.js (addRoomModule): the game is fully playable without it, without
// an account and without a wallet. Linking a wallet never changes gameplay,
// saves, gold, items or stats.
//
// SAFETY: the server never holds keys and never builds, signs or sends a
// transaction. The ONLY thing a wallet ever signs is the human-readable,
// off-chain link message below (wallet signMessage). Value-bearing features
// (redeemable rewards, on-chain claims) are not implemented; their flags are
// hard-off and /wallet/claim always answers not_enabled.
//
// Link flow (Sign-In-With-Solana style), HTTP so it also works from the title
// screen before joining a room:
//   POST /wallet/challenge {token, address, action:'link'|'relink'}
//        -> {ok, nonce, message, expiresAt}       single-use nonce, NONCE_TTL
//   (client: wallet.signMessage(utf8(message)) -> 64-byte ed25519 signature)
//   POST /wallet/link {token, nonce, signature(base58)}
//        -> {ok, linked, address, short, founder, relinked}
//   POST /wallet/unlink {token}            -> {ok, linked:false}   (any time, no signature needed)
//   POST /wallet/status {token}            -> {ok, linked, address, short, badges}
//   POST /wallet/claim {token}             -> 403 {ok:false, error:'not_enabled'}  (stub, by design)
//   GET  /wallet/config                    -> {ok, flags, statement}
//   GET  /marks/leaderboard                -> {ok, season, rows:[{rank,name,marks,founder?,addr?}]}
//
// Rules: one wallet per device and one device per wallet. A device that has a
// wallet must unlink before linking another. A wallet already linked to
// another device is refused (wallet_linked_elsewhere) unless the request is a
// 'relink' signed by that wallet: the link then MOVES to the new device (the
// old device loses it), at most once per WALLET_RELINK_COOLDOWN_H.
//
// The server verifies the signature over the exact message IT issued (stored
// with the nonce), with Node crypto only: base58 pubkey -> SPKI DER
// (302a300506032b6570032100 || key) -> createPublicKey -> crypto.verify(null).
// Nonces: random, single-use (burned on ANY verify attempt, success or not),
// expire after NONCE_TTL, max 3 outstanding per device. Rate limits per IP and
// per device. Every outcome is written to DATA_DIR/wallets/audit.jsonl.

export const STATEMENT = 'This signature links your wallet to your Wayfarer character. It does not cost anything and cannot move funds.';
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const NONCES = new Map(); // nonce -> {dk, addr, action, message, exp}
const MAX_NONCES = 20_000;

class Tok {
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.t = Date.now(); this.n = burst; }
  take() { const now = Date.now(); this.n = Math.min(this.burst, this.n + ((now - this.t) / 1000) * this.rate); this.t = now; if (this.n < 1) return false; this.n -= 1; return true; }
}
const BUCKETS = new Map(); // `${kind}|${key}` -> Tok
const envNum = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n >= 0 ? n : def; };
const LIMITS = {
  ip: [envNum('WALLET_IP_RATE', 0.5), envNum('WALLET_IP_BURST', 12)],             // any wallet route: 30/min, burst 12, per IP
  challenge: [envNum('WALLET_CHALLENGE_RATE', 0.1), envNum('WALLET_CHALLENGE_BURST', 5)], // per device: 6/min, burst 5
  link: [envNum('WALLET_LINK_RATE', 0.1), envNum('WALLET_LINK_BURST', 5)],         // per device verify attempts
};
function limited(kind, key) {
  const k = `${kind}|${key}`;
  let b = BUCKETS.get(k);
  if (!b) { const [r, burst] = LIMITS[kind]; b = new Tok(r, burst); BUCKETS.set(k, b); }
  return !b.take();
}

export function verifyEd25519(pub32, message, sig64) {
  try {
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, pub32]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig64);
  } catch { return false; }
}

// client IP: Railway's edge appends the real client address as the LAST
// X-Forwarded-For hop (earlier hops are client-controlled).
function ipOf(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : req.socket?.remoteAddress || '';
}
function originOf(req) {
  const o = String(req.headers.origin || '');
  const m = /^(https?):\/\/([a-z0-9.-]+(?::\d{1,5})?)$/i.exec(o);
  return m ? { uri: `${m[1].toLowerCase()}://${m[2].toLowerCase()}`, host: m[2].toLowerCase() } : null;
}

export function buildMessage({ domain, uri, address, dk, action, nonce, issuedAt, exp }) {
  return [
    `${domain} wants you to link your Solana wallet to your Wayfarer character.`,
    '',
    STATEMENT,
    '',
    `URI: ${uri}`,
    `Wallet: ${address}`,
    `Device: ${dk.slice(0, 16)}`,
    `Action: ${action}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date(issuedAt).toISOString()}`,
    `Expiration Time: ${new Date(exp).toISOString()}`,
  ].join('\n');
}

function sweepNonces() {
  const now = Date.now();
  for (const [n, r] of NONCES) if (r.exp < now) NONCES.delete(n);
  for (const [k, b] of BUCKETS) if (b.n >= b.burst && now - b.t > 600_000) BUCKETS.delete(k);
}

// ─── lifecycle (index.js) ─────────────────────────────────────────────
let timer = null;
export function init() {
  initWalletStore();
  timer = setInterval(sweepNonces, 30_000);
  timer.unref?.();
}
export function flush() { flushWalletStore(); }
export function stop() { if (timer) clearInterval(timer); stopWalletStore(); }

// room hooks: Marks lives in server/marks.js
export const install = (room) => marks.install(room);
export const onJoin = (room, client, p) => marks.onJoin(room, client, p);
export const onLeave = (room, client, p) => marks.onLeave(room, client, p);
export const afterSave = (room, client, p, info) => marks.afterSave(room, client, p, info);

// ─── HTTP ─────────────────────────────────────────────────────────────
export function routes(app) {
  const json = express.json({ limit: '4kb', strict: true });
  const fail = (res, status, error, extra) => res.status(status).json({ ok: false, error, ...extra });
  // common preamble: IP rate limit, JSON body, valid device token
  const pre = (req, res, needToken = true) => {
    const ip = ipOf(req);
    if (limited('ip', ip)) { fail(res, 429, 'rate_limited'); return null; }
    if (!WCFG.WALLET_LINK) { fail(res, 403, 'wallet_link_disabled'); return null; }
    const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    if (!needToken) return { ip, b };
    if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) { fail(res, 400, 'bad_token'); return null; }
    return { ip, b, dk: deviceKey(b.token) };
  };
  const reject = (res, ctx, status, error, extra = {}) => {
    audit({ ev: 'reject', error, dk: ctx.dk, ip: ipTag(ctx.ip), ...extra });
    return fail(res, status, error);
  };

  app.get('/wallet/config', (req, res) => {
    res.json({ ok: true, flags: flagsPublic(), statement: STATEMENT, nonceTtlS: Math.round(WCFG.NONCE_TTL_MS / 1000) });
  });

  app.post('/wallet/challenge', json, (req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    const { b, dk } = ctx;
    if (limited('challenge', dk)) return fail(res, 429, 'rate_limited');
    const action = WALLET_ACTIONS.has(b.action) ? b.action : (b.action === undefined ? 'link' : null);
    if (!action) return fail(res, 400, 'bad_action');
    if (!solAddress(b.address)) return fail(res, 400, 'bad_address');
    const origin = originOf(req);
    if (WCFG.DOMAINS.length && (!origin || !WCFG.DOMAINS.includes(origin.host))) return reject(res, ctx, 403, 'bad_origin', { origin: origin?.host || null });
    // pre-checks (re-checked at verify time) so the user is not asked to sign for nothing
    const mine = links.byDevice[dk];
    if (mine && mine.addr === b.address) return fail(res, 409, 'already_linked');
    if (mine) return fail(res, 409, 'device_has_wallet');
    const other = links.byAddr[b.address];
    if (other?.dk && other.dk !== dk && action !== 'relink') return fail(res, 409, 'wallet_linked_elsewhere');
    if (action === 'relink' && (!other?.dk || other.dk === dk)) return fail(res, 409, 'nothing_to_relink');
    if (action === 'relink' && other.relinkAt && Date.now() - other.relinkAt < WCFG.RELINK_COOLDOWN_MS) return fail(res, 429, 'relink_cooldown');
    let mineN = 0;
    for (const r of NONCES.values()) if (r.dk === dk && r.exp > Date.now()) mineN++;
    if (mineN >= 3) return fail(res, 429, 'too_many_pending');
    if (NONCES.size >= MAX_NONCES) { sweepNonces(); if (NONCES.size >= MAX_NONCES) return fail(res, 503, 'busy'); }
    const nonce = crypto.randomBytes(18).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 24).padEnd(24, 'x');
    const now = Date.now(); const exp = now + WCFG.NONCE_TTL_MS;
    const domain = origin?.host || WCFG.DOMAINS[0] || 'wayfarer.online';
    const message = buildMessage({ domain, uri: origin?.uri || `https://${domain}`, address: b.address, dk, action, nonce, issuedAt: now, exp });
    NONCES.set(nonce, { dk, addr: b.address, action, message, exp });
    res.json({ ok: true, nonce, message, expiresAt: exp });
  });

  app.post('/wallet/link', json, (req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    const { b, dk } = ctx;
    if (limited('link', dk)) return fail(res, 429, 'rate_limited');
    if (typeof b.nonce !== 'string' || !NONCE_RE.test(b.nonce)) return fail(res, 400, 'bad_nonce');
    const sig = solSignature(b.signature);
    if (!sig) return fail(res, 400, 'bad_signature_format');
    const n = NONCES.get(b.nonce);
    if (!n) return reject(res, ctx, 400, 'unknown_nonce'); // never issued, already used (replay) or swept
    NONCES.delete(b.nonce); // single use: burned on any attempt
    if (n.dk !== dk) return reject(res, ctx, 403, 'nonce_device_mismatch');
    if (n.exp < Date.now()) return reject(res, ctx, 400, 'nonce_expired', { addr: n.addr });
    if (!verifyEd25519(solAddress(n.addr), n.message, sig)) return reject(res, ctx, 401, 'bad_signature', { addr: n.addr });
    // re-check the link rules now (state may have changed since the challenge)
    const mine = links.byDevice[dk];
    if (mine) return reject(res, ctx, 409, mine.addr === n.addr ? 'already_linked' : 'device_has_wallet', { addr: n.addr });
    const other = links.byAddr[n.addr];
    let relinked = false;
    if (other?.dk && other.dk !== dk) {
      if (n.action !== 'relink') return reject(res, ctx, 409, 'wallet_linked_elsewhere', { addr: n.addr });
      if (other.relinkAt && Date.now() - other.relinkAt < WCFG.RELINK_COOLDOWN_MS) return reject(res, ctx, 429, 'relink_cooldown', { addr: n.addr });
      const oldDk = other.dk;
      delete links.byDevice[oldDk];
      relinked = true;
      audit({ ev: 'relink-out', dk: oldDk, addr: n.addr, to: dk });
      setImmediate(() => marks.pushState(oldDk));
    }
    const now = Date.now();
    links.byDevice[dk] = { addr: n.addr, at: now };
    const a = links.byAddr[n.addr] || { attest: [] };
    links.byAddr[n.addr] = { ...a, dk, at: a.at || now, relinkAt: relinked ? now : a.relinkAt };
    // founder attestation: first link of this wallet before FOUNDER_CUTOFF (stays with the wallet)
    if (WCFG.FOUNDER_BADGE && now < WCFG.FOUNDER_CUTOFF) attest(n.addr, 'founder', { season: WCFG.SEASON });
    try { saveLinks(); } catch (e) {
      log.error('wallet: links write failed', { err: e.message });
      return fail(res, 500, 'store_failed');
    }
    audit({ ev: relinked ? 'relink' : 'link', dk, addr: n.addr, ip: ipTag(ctx.ip) });
    log.info('wallet linked', { dk: dk.slice(0, 8), addr: shortAddr(n.addr), relinked });
    marks.pushState(dk);
    const founder = !!links.byAddr[n.addr].attest?.some((x) => x.id === 'founder');
    res.json({ ok: true, linked: true, address: n.addr, short: shortAddr(n.addr), founder, relinked });
  });

  app.post('/wallet/unlink', json, (req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    const { dk } = ctx;
    const mine = links.byDevice[dk];
    if (!mine) return res.json({ ok: true, linked: false });
    delete links.byDevice[dk];
    const a = links.byAddr[mine.addr];
    if (a && a.dk === dk) a.dk = null; // keep the wallet record (attestations, relink cooldown)
    try { saveLinks(); } catch (e) { log.error('wallet: links write failed', { err: e.message }); return fail(res, 500, 'store_failed'); }
    audit({ ev: 'unlink', dk, addr: mine.addr, ip: ipTag(ctx.ip) });
    marks.pushState(dk);
    res.json({ ok: true, linked: false });
  });

  app.post('/wallet/status', json, (req, res) => {
    const ctx = pre(req, res); if (!ctx) return;
    const { dk } = ctx;
    const mine = links.byDevice[dk];
    res.json({ ok: true, linked: !!mine, address: mine?.addr || null, short: mine ? shortAddr(mine.addr) : '', badges: badgesFor(dk, marksRec(dk)) });
  });

  // Stub, by design: no redeemable rewards, no minting, no on-chain anything in this build.
  app.post('/wallet/claim', json, (req, res) => {
    const ip = ipOf(req);
    if (limited('ip', ip)) return fail(res, 429, 'rate_limited');
    fail(res, 403, 'not_enabled', { message: 'Claims are not enabled. Marks and badges are off-chain cosmetics only.' });
  });

  app.get('/marks/leaderboard', (req, res) => {
    if (limited('ip', ipOf(req))) return fail(res, 429, 'rate_limited');
    if (!WCFG.MARKS || !WCFG.LEADERBOARD) return fail(res, 403, 'leaderboard_disabled');
    res.json({ ok: true, ...marks.leaderboard(50) });
  });
}
