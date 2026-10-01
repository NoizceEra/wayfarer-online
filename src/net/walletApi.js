import { CONFIG } from '../config.js';
import { net } from './NetworkManager.js';
import { wallet } from '../core/wallet.js';

// HTTP client for the optional SIWS-style wallet link (server/wallet.js).
// signMessage only — the client never builds, signs or sends a transaction.

const httpBase = () => CONFIG.serverUrl.replace(/^ws/, 'http');

async function post(path, body) {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), 12_000);
  let r, j;
  try {
    r = await fetch(`${httpBase()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      signal: ctl.signal,
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Wallet server timed out.');
    throw new Error('Could not reach the relay (try Solo — wallet link is optional).');
  } finally { clearTimeout(to); }
  if (!r.ok || j.ok === false) {
    const err = new Error(friendly(j.error) || j.message || `Wallet request failed (${r.status}).`);
    err.code = j.error || String(r.status);
    err.status = r.status;
    throw err;
  }
  return j;
}

export function friendly(code) {
  return ({
    rate_limited: 'Slow down a little.',
    wallet_link_disabled: 'Wallet linking is turned off on this relay.',
    bad_token: 'This browser has no saved device profile (is local storage blocked?).',
    bad_address: 'That does not look like a Solana address.',
    bad_action: 'Unknown link action.',
    bad_origin: 'This page is not an allowed origin for wallet link.',
    already_linked: 'This device is already linked to that wallet.',
    device_has_wallet: 'This device already has a linked wallet. Unlink it first to use another.',
    wallet_linked_elsewhere: 'That wallet is linked to another device. Relink (fresh signature) to move it here.',
    nothing_to_relink: 'That wallet is not linked anywhere, so there is nothing to relink.',
    relink_cooldown: 'That wallet was moved recently. Try again later.',
    too_many_pending: 'Too many unsigned link requests. Wait a minute and try once.',
    unknown_nonce: 'That link request expired or was already used. Ask for a new one.',
    nonce_expired: 'That link request expired. Ask for a new one.',
    nonce_device_mismatch: 'That link request belongs to another device.',
    bad_signature: 'Signature did not match. Is the same wallet still selected?',
    bad_signature_format: 'The wallet returned a signature this game could not read.',
    not_enabled: 'Claims are not enabled. Marks and badges are off-chain cosmetics only.',
    leaderboard_disabled: 'The Marks board is turned off on this relay.',
  })[code] || null;
}

export async function walletConfig() {
  try {
    const r = await fetch(`${httpBase()}/wallet/config`, { cache: 'no-store' });
    return await r.json();
  } catch { return { ok: false }; }
}

export async function walletStatus() {
  if (!net.token) return { ok: false, linked: false, error: 'bad_token' };
  return post('/wallet/status', { token: net.token });
}

export async function unlinkWallet() {
  if (!net.token) throw new Error('No device profile.');
  const j = await post('/wallet/unlink', { token: net.token });
  wallet.setLinked(false);
  return j;
}

// Connect (if needed), request a single-use nonce, sign the server-issued
// human-readable message, POST the signature. action 'link' | 'relink'.
export async function linkWallet(action = 'link') {
  if (!net.token) throw new Error('No device profile. Play once (even Solo) so this browser has a saved device.');
  if (!wallet.state.connected) await wallet.connect();
  const address = wallet.state.address;
  if (!address) throw new Error('Connect a wallet first.');
  const ch = await post('/wallet/challenge', { token: net.token, address, action });
  const signature = await wallet.signMessage(ch.message);
  const j = await post('/wallet/link', { token: net.token, nonce: ch.nonce, signature });
  wallet.rememberChoice(true);
  wallet.setLinked(true);
  return j;
}

export async function claimStub() {
  if (!net.token) throw new Error('No device profile.');
  return post('/wallet/claim', { token: net.token });
}
