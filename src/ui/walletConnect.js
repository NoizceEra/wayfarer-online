// Shared Solana wallet plumbing for Wayfarer Online (ui/walletConnect.js).
//
// ONE implementation of the provider lookup, the connect flow and the persisted
// wallet record, used by BOTH wallet surfaces:
//   * src/ui/WalletPanel.js  — the in-game HUD panel (UIScene)
//   * src/ui/LoginWallet.js  — the [Connect Wallet] button on the login screen
// They read and write the same storage key, so a player who connects on the
// login screen is already connected when the HUD panel mounts, and vice versa.
//
// SECURITY: public addresses only. Nothing here ever reads, requests, stores or
// logs a private key, and no full address is written to the console — callers
// render a truncated form (truncateAddress).

export const WALLET_STORAGE_KEY = 'wayfarer.wallet.v1';

// The provider lookup WalletPanel has always used: Phantom first (its injected
// provider may also be exposed as window.solana), then Solflare.
export function getProvider() {
  if (typeof window === 'undefined') return null;
  const p = window.phantom?.solana || window.solflare || window.solana;
  if (p?.isPhantom || p?.isSolflare) return p;
  return null;
}

export function providerKind(provider) {
  return provider?.isPhantom ? 'phantom' : 'solflare';
}

export function loadWallet() {
  try { return JSON.parse(localStorage.getItem(WALLET_STORAGE_KEY)) || null; } catch { return null; }
}
export function saveWallet(w) {
  try { localStorage.setItem(WALLET_STORAGE_KEY, JSON.stringify(w)); } catch { /* storage blocked: ignore */ }
}
export function clearWallet() {
  try { localStorage.removeItem(WALLET_STORAGE_KEY); } catch { /* storage blocked: ignore */ }
}

// Truncate a base58 public address for display. NEVER pass a secret here.
export function truncateAddress(addr, head = 6, tail = 4, sep = '...') {
  if (!addr || typeof addr !== 'string') return '';
  if (addr.length <= head + tail + sep.length) return addr;
  return addr.slice(0, head) + sep + addr.slice(-tail);
}

// Distinguishes "no wallet extension installed" from "user declined", so each
// surface can show the right non-blocking hint.
export const NO_PROVIDER = 'no-provider';
export function noProviderError() {
  const e = new Error('No Solana wallet found');
  e.code = NO_PROVIDER;
  return e;
}

// Connect through the injected provider and resolve the PUBLIC address only.
// Rejects with e.code === NO_PROVIDER when nothing is injected, or with the
// provider's own rejection when the user declines.
export async function connectWallet(provider = getProvider()) {
  if (!provider) throw noProviderError();
  const resp = await provider.connect();
  const addr = resp?.publicKey?.toString();
  if (!addr) throw new Error('Wallet did not return a public key');
  return { addr, provider: providerKind(provider) };
}

// Best-effort disconnect of the injected provider (never throws).
export function disconnectProvider(provider = getProvider()) {
  try {
    const r = provider?.disconnect?.();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch { /* ignore */ }
}
