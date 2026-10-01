/**
 * walletAuth.js — Solana wallet link for Wayfarer Online.
 *
 * GRAFTED from FOMMO (Forgers Online) `services/WalletAuthService.js`, adapted to
 * Wayfarer's architecture. What changed and why:
 *
 *   1. tweetnacl -> node:crypto. FOMMO verified Ed25519 via `tweetnacl`; Node 18+
 *      has Ed25519 in the stdlib, so this graft adds ZERO dependencies.
 *   2. @solana/web3.js PublicKey -> a local base58 decoder. FOMMO used PublicKey
 *      purely to (a) validate an address and (b) get raw pubkey bytes. Both are
 *      20 lines of base58, which means the relay never needs the Solana SDK just
 *      to verify a login signature.
 *   3. Math.random() nonce -> crypto.randomBytes. FOMMO's login nonce was
 *      predictable; a guessable nonce lets an attacker pre-compute a signature
 *      challenge. Nonces are now 32 bytes from the CSPRNG.
 *   4. In-memory Map -> file-backed store under DATA_DIR. FOMMO's Map died on
 *      restart and broke on a second instance. Wayfarer's relay already owns a
 *      DATA_DIR with atomic tmp+rename writes; nonces follow the same discipline
 *      so "continue on another device" survives a deploy.
 *   5. jwt -> HMAC-signed session token. FOMMO signed a JWT with `jsonwebtoken`;
 *      the relay does not carry that dep. A timing-safe HMAC-SHA256 token over a
 *      base64url payload is the same security property with no new package.
 *
 * SECURITY MODEL. A wallet link proves one thing only: whoever is talking to the
 * relay controls the private key for that address. It is an AUTHENTICATION of a
 * public key, never an AUTHORISATION to spend. Nothing here moves funds, and a
 * proven wallet is a link on the player's account — never the account itself, and
 * never a stat-bearing asset. See `server/chain/README.md`.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from '../config.js';

// ── base58 (Solana uses the Bitcoin alphabet) ────────────────────────────────
const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Decode base58 to bytes. Throws on any character outside the alphabet. */
export function b58decode(str) {
  if (typeof str !== 'string' || str.length === 0) throw new Error('base58: empty input');
  if (str.length > 44) throw new Error('base58: too long for a 32-byte key');
  let num = 0n;
  for (const ch of str) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`base58: invalid character "${ch}"`);
    num = num * 58n + BigInt(idx);
  }
  let zeros = 0;
  for (const ch of str) { if (ch === '1') zeros++; else break; }
  let hex = num === 0n ? '' : num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.concat([Buffer.alloc(zeros), Buffer.from(hex, 'hex')]);
}

/** True when `address` is a syntactically valid base58 Solana public key. */
export function isSolanaAddress(address) {
  try { return b58decode(address).length === 32; } catch { return false; }
}

// ── nonce store: one pending challenge per wallet, file-backed ───────────────
const NONCE_TTL_MS = 5 * 60 * 1000;
const NONCE_FILE = path.join(CFG.DATA_DIR, 'chain-nonces.json');

function readNonces() {
  try { return JSON.parse(fs.readFileSync(NONCE_FILE, 'utf8')) || {}; } catch { return {}; }
}

function writeNonces(all) {
  try {
    fs.mkdirSync(path.dirname(NONCE_FILE), { recursive: true });
    const tmp = `${NONCE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all));
    fs.renameSync(tmp, NONCE_FILE);          // atomic, same discipline as store.js
  } catch (err) {
    // A nonce we cannot persist is a nonce we cannot verify; fail the request
    // rather than silently degrade to in-memory state.
    throw new Error(`walletAuth: cannot persist nonce store (${err.message})`);
  }
}

/** A fresh sign-in message. This exact string is what the wallet displays. */
export function buildNonceMessage(walletAddress, nonce, issuedAt = Date.now()) {
  return [
    'Welcome to Wayfarer Online!',
    '',
    'Sign this message to link your wallet.',
    'This request will not trigger a transaction or cost any fees.',
    '',
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
  ].join('\n');
}

/** Issue (and persist) a one-time challenge for `walletAddress`. */
export function issueNonce(walletAddress, now = Date.now()) {
  if (!isSolanaAddress(walletAddress)) throw new Error('invalid Solana wallet address');
  const nonce = crypto.randomBytes(32).toString('base64url');
  const message = buildNonceMessage(walletAddress, nonce, now);
  const all = readNonces();
  const cutoff = now - NONCE_TTL_MS;
  for (const [k, v] of Object.entries(all)) if (!v || v.expiresAt < cutoff) delete all[k];
  all[walletAddress] = { nonce, message, expiresAt: now + NONCE_TTL_MS };
  writeNonces(all);
  return { nonce, message, expiresAt: now + NONCE_TTL_MS };
}

/** Verify an Ed25519 signature over `message` by the key behind `walletAddress`. */
export function verifyWalletSignature(walletAddress, message, signatureBase64) {
  if (!isSolanaAddress(walletAddress)) return false;
  if (typeof message !== 'string' || !message.length) return false;
  if (typeof signatureBase64 !== 'string') return false;

  let sig;
  try { sig = Buffer.from(signatureBase64, 'base64'); } catch { return false; }
  if (sig.length !== 64) return false;                    // Ed25519 signatures are 64 bytes

  const rawPub = b58decode(walletAddress);
  const key = crypto.createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rawPub.toString('base64url') },
    format: 'jwk',
  });
  try {
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, sig);
  } catch {
    return false;
  }
}

/**
 * Verify a wallet link end-to-end: the signature must be over the exact challenge
 * we issued for this wallet, that challenge must be unexpired, and it is consumed
 * on success so the same signature can never be replayed.
 */
export function verifyWalletLink(walletAddress, message, signatureBase64, now = Date.now()) {
  if (!isSolanaAddress(walletAddress)) throw new Error('invalid Solana wallet address');
  const all = readNonces();
  const pending = all[walletAddress];
  if (!pending) throw new Error('no pending challenge for this wallet; request a new one');
  if (now > pending.expiresAt) {
    delete all[walletAddress];
    writeNonces(all);
    throw new Error('challenge expired; request a new one');
  }
  if (message !== pending.message) throw new Error('challenge mismatch');
  if (!verifyWalletSignature(walletAddress, message, signatureBase64)) {
    throw new Error('signature verification failed');
  }
  delete all[walletAddress];                              // single-use
  writeNonces(all);
  return true;
}

// ── session token: HMAC-SHA256, no JWT dependency ────────────────────────────
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function chainSessionsEnabled() {
  return typeof process.env.CHAIN_SESSION_SECRET === 'string'
    && process.env.CHAIN_SESSION_SECRET.length >= 16;
}

function secret() {
  const s = process.env.CHAIN_SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('CHAIN_SESSION_SECRET must be set (>=16 chars) to issue chain sessions');
  }
  return s;
}

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payloadB64) =>
  crypto.createHmac('sha256', secret()).update(payloadB64).digest();

/** Issue a signed session token binding a wallet to a player id. */
export function issueSession(walletAddress, { playerId, name = null, now = Date.now() } = {}) {
  if (!isSolanaAddress(walletAddress)) throw new Error('invalid Solana wallet address');
  if (!playerId) throw new Error('playerId is required');
  const payload = b64u(JSON.stringify({
    w: walletAddress, p: playerId, n: name, exp: now + SESSION_TTL_MS,
  }));
  return `${payload}.${b64u(sign(payload))}`;
}

/** Verify a session token. Returns its claims, or throws. */
export function verifySession(token, now = Date.now()) {
  if (typeof token !== 'string') throw new Error('malformed token');
  const parts = token.split('.');
  if (parts.length !== 2) throw new Error('malformed token');
  const [payload, mac] = parts;
  const expected = sign(payload);
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new Error('bad token signature');
  }
  let claims;
  try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); }
  catch { throw new Error('malformed token payload'); }
  if (!claims || typeof claims.exp !== 'number') throw new Error('malformed token claims');
  if (now > claims.exp) throw new Error('token expired');
  return claims;
}
