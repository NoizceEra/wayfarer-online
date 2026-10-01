import { CONFIG } from '../config.js';
import { DEVICE_KEY, FRESH_KEY } from './NetworkManager.js';

// Identity API (client side of the guest-first / link-later feature).
//
// An anonymous wayfarer's identity is the 18-byte device token in localStorage
// (DEVICE_KEY, minted by NetworkManager). That token is unrecoverable if the
// browser storage is cleared, the phone changes, or another browser is used.
// A RECOVERY CODE fixes that without any account, email or backend service:
//   * the code is generated HERE (crypto.getRandomValues), stored locally and
//     registered with POST /identity/link (the server keeps only its hash);
//   * on another device, POST /identity/continue exchanges the code for a
//     BRAND-NEW device token; the next normal join restores the characters.
// Note: identity is 'anon' | 'linked'. This is unrelated to the transport-level
// 'guest' mode used by co-op joins in TitleScene — do not conflate them.

const CODE_KEY = 'wayfarer.recovery.code.v1';   // this device's own code (never sent anywhere else)
const ACK_KEY = 'wayfarer.recovery.acked.v1';   // player confirmed they saved the code

// Unambiguous alphabet: no 0/O, no 1/I, no L — 31 symbols. Random bytes are
// drawn by rejection sampling (accept < 248 = 31*8, then % 31) so every symbol
// is uniformly likely: 20 chars ≈ 99 bits of entropy.
export const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REJECT_AT = 248;             // largest multiple of 31 that fits in a byte
export const CODE_GROUPS = 5;
export const CODE_GROUP_LEN = 4;
export const CODE_LEN = CODE_GROUPS * CODE_GROUP_LEN;    // 20 chars / ~99 bits
export const CODE_DISPLAY_MAX = CODE_LEN + CODE_GROUPS - 1; // 24 with dashes

const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');
const ls = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }, del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } } };
const rnd = () => globalThis.crypto || (typeof window !== 'undefined' ? window.crypto : null);

// ABCD-EFGH-JKLM-NPQR-STVW
export function groupCode(body) {
  const s = String(body || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, CODE_LEN);
  return s.match(new RegExp(`.{1,${CODE_GROUP_LEN}}`, 'g'))?.join('-') || '';
}

export function generateRecoveryCode() {
  const c = rnd();
  if (!c?.getRandomValues) throw new Error('no crypto.getRandomValues available');
  const bytes = new Uint8Array(64);
  let body = '';
  while (body.length < CODE_LEN) {
    c.getRandomValues(bytes);
    for (const b of bytes) {
      if (b >= REJECT_AT) continue;            // rejection sampling: no modulo bias
      body += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
      if (body.length === CODE_LEN) break;
    }
  }
  return groupCode(body);
}

// Same normalisation the server applies (strip separators, uppercase) so the
// code can be typed with or without dashes and in any case.
export function normalizeRecoveryCode(code) { return String(code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase(); }
export function isPlausibleCode(code) { const n = normalizeRecoveryCode(code); return n.length >= 20 && n.length <= 64; }

export function savedRecoveryCode() { return ls.get(CODE_KEY); }
export function rememberRecoveryCode(code) { ls.set(CODE_KEY, groupCode(code)); return groupCode(code); }
export function isFreshDevice() { return ls.get(FRESH_KEY) === '1'; }
export function isRecoveryAcked() { return ls.get(ACK_KEY) === '1'; }
export function ackRecovery() { ls.set(ACK_KEY, '1'); ls.del(FRESH_KEY); }
export function localDeviceToken() { return ls.get(DEVICE_KEY); }

async function postJson(path, body) {
  const res = await fetch(`${httpBase()}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !data?.ok) {
    const e = new Error(data?.error || `request_failed_${res.status}`);
    e.code = data?.error || 'request_failed';
    e.status = res.status;
    throw e;
  }
  return data;
}

// POST /identity/link — idempotent; the server rejects a code bound elsewhere.
export async function linkRecovery(token, code) {
  if (!token) throw new Error('no_token');
  return postJson('/identity/link', { token, kind: 'recovery', id: normalizeRecoveryCode(code) });
}

// POST /identity/continue — returns a NEW token (never an existing one).
export async function continueWithCode(code) {
  const data = await postJson('/identity/continue', { kind: 'recovery', id: normalizeRecoveryCode(code) });
  if (!data?.token) throw new Error('no_token_returned');
  return data.token;
}

// GET /identity/status — links registered for the token + its character names.
export async function fetchStatus(token) {
  const res = await fetch(`${httpBase()}/identity/status?token=${encodeURIComponent(String(token || ''))}`);
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const e = new Error(data?.error || `request_failed_${res.status}`);
    e.code = data?.error || 'request_failed';
    throw e;
  }
  return data;
}

// This device's code: reuse the saved one, else mint + remember it, then make
// sure the server has it linked (linking an already-linked code is a no-op).
// Returns { code, linked } — `linked:false` means the relay was unreachable.
export async function ensureRecoveryCode(token) {
  let code = savedRecoveryCode();
  if (!code || !isPlausibleCode(code)) code = rememberRecoveryCode(generateRecoveryCode());
  try {
    const r = await linkRecovery(token, code);
    return { code, linked: true, links: r.links || [] };
  } catch (e) {
    return { code, linked: false, error: e.code || e.message };
  }
}

// ─── Solana badge: SIGNATURE-REQUIRED ────────────────────────────────────────
// A wallet address is PUBLIC, so the relay refuses to link one without proof. The
// client must fetch a single-use challenge and return a signature over it, which
// requires a wallet provider (Phantom or similar) — deliberately NOT installed, so
// the game ships no wallet dependency. These two helpers are the complete contract
// the UI will call once a provider is wired; until then, an unsigned link is a
// 401 by design and the badge stays optional (never a requirement to play).
const SOLANA_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function isSolanaAddress(address) { return SOLANA_RE.test(String(address || '').trim()); }

// Step 1: the exact message the wallet must sign. Single-use, 5-minute TTL.
export async function requestWalletChallenge(address) {
  const addr = String(address || '').trim();
  if (!isSolanaAddress(addr)) { const e = new Error('bad_address'); e.code = 'bad_address'; throw e; }
  return postJson('/identity/wallet-challenge', { wallet: addr });
}

// Step 2: link the wallet using the provider's signature over that message.
export async function linkSolana(token, address, { message, signature } = {}) {
  if (!token) throw new Error('no_token');
  const addr = String(address || '').trim();
  if (!isSolanaAddress(addr)) { const e = new Error('bad_address'); e.code = 'bad_address'; throw e; }
  if (!message || !signature) {
    const e = new Error('wallet_signature_required');
    e.code = 'wallet_signature_required';
    throw e;                       // never send an unsigned link: the relay rejects it
  }
  return postJson('/identity/link', { token, kind: 'solana', id: addr, message, signature });
}
