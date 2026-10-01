// Optional Solana wallet adapter. Zero extra deps: talks to whatever injected
// provider is on window (Phantom, Backpack, Solflare, or a generic window.solana).
//
// TitleScene / WalletPanel code against this surface:
//   wallet.available()            injected provider detected
//   wallet.state                  {connected, address, provider, linked}
//   await wallet.connect()        rejects politely if declined / missing
//   await wallet.disconnect()
//   wallet.shortAddress()         'Ab3k…9xQz'
//   wallet.on('change', fn) -> off
//   await wallet.signMessage(str)  utf8 signMessage only — never a transaction
//
// Persist only "user chose to link" (WANT_KEY). Never auto-connect without it.
// Fully usable with no wallet installed: available() is false, connect() rejects.

const WANT_KEY = 'wayfarer.wallet.wantLink.v1';
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export const MOBILE_HINT = 'On a phone, open this page from inside Phantom, Backpack or Solflare (the in-app browser). A regular mobile browser cannot deep-link a signature.';

function wantLink() {
  try { return localStorage.getItem(WANT_KEY) === '1'; } catch { return false; }
}
function setWantLink(v) {
  try { if (v) localStorage.setItem(WANT_KEY, '1'); else localStorage.removeItem(WANT_KEY); } catch { /* private mode */ }
}

export function b58encode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let n = 0n;
  for (const x of b) n = (n << 8n) + BigInt(x);
  let out = '';
  while (n > 0n) { out = B58[Number(n % 58n)] + out; n /= 58n; }
  for (const x of b) { if (x === 0) out = `1${out}`; else break; }
  return out || '1';
}

export function shortAddr(a) {
  return typeof a === 'string' && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
}

function detect() {
  if (typeof window === 'undefined') return null;
  const phantom = window.phantom?.solana;
  if (phantom && (phantom.isPhantom || phantom.connect)) return { name: 'phantom', provider: phantom };
  const sol = window.solana;
  if (sol?.isPhantom) return { name: 'phantom', provider: sol };
  if (sol?.isBackpack) return { name: 'backpack', provider: sol };
  if (sol?.isSolflare) return { name: 'solflare', provider: sol };
  const bp = window.backpack?.solana || (window.backpack?.connect ? window.backpack : null);
  if (bp) return { name: 'backpack', provider: bp };
  if (window.solflare?.connect) return { name: 'solflare', provider: window.solflare };
  if (sol?.connect) return { name: 'solana', provider: sol };
  return null;
}

function addrOf(provider) {
  const pk = provider?.publicKey;
  if (!pk) return null;
  if (typeof pk.toBase58 === 'function') return pk.toBase58();
  if (typeof pk.toString === 'function') {
    const s = pk.toString();
    if (s && s !== '[object Object]') return s;
  }
  if (pk.toBytes) return b58encode(pk.toBytes());
  return null;
}

function polite(e, fallback) {
  const code = e?.code;
  const msg = String(e?.message || e || '');
  if (code === 4001 || /4001|rejected|denied|cancel/i.test(msg)) {
    const err = new Error('Wallet request declined.');
    err.code = 'declined';
    return err;
  }
  const err = new Error(fallback || msg || 'Wallet request failed.');
  err.code = e?.code || 'wallet';
  return err;
}

function toBytes(sig) {
  if (!sig) return null;
  if (sig instanceof Uint8Array) return sig;
  if (sig instanceof ArrayBuffer) return new Uint8Array(sig);
  if (Array.isArray(sig)) return Uint8Array.from(sig);
  if (sig.signature) return toBytes(sig.signature);
  if (sig.data) return toBytes(sig.data);
  return null;
}

class Wallet {
  constructor() {
    this.state = { connected: false, address: null, provider: null, linked: false };
    this._on = new Set();
    this._bound = false;
    this._prov = null;
  }

  available() { return !!detect(); }

  on(ev, fn) {
    if (ev !== 'change' || typeof fn !== 'function') return () => {};
    this._on.add(fn);
    return () => this._on.delete(fn);
  }
  _emit() { for (const fn of this._on) { try { fn(this.state); } catch { /* ignore */ } } }

  shortAddress() { return shortAddr(this.state.address); }

  setLinked(v) {
    const linked = !!v;
    if (this.state.linked === linked) return;
    this.state = { ...this.state, linked };
    this._emit();
  }

  choseToLink() { return wantLink(); }
  rememberChoice(v) { setWantLink(!!v); }

  _apply(providerName, provider, address) {
    this._listen(provider);
    this.state = {
      connected: !!address,
      address: address || null,
      provider: address ? providerName : null,
      linked: this.state.linked,
    };
    this._emit();
  }

  _listen(provider) {
    if (this._prov === provider) return;
    this._unlisten();
    this._prov = provider;
    if (!provider) return;
    this._onAccount = (pk) => {
      if (!pk) { this._apply(this.state.provider, provider, null); return; }
      const addr = typeof pk === 'string' ? pk : addrOf({ publicKey: pk }) || addrOf(provider);
      this._apply(detect()?.name || this.state.provider, provider, addr);
    };
    this._onDisc = () => this._apply(this.state.provider, provider, null);
    try {
      if (typeof provider.on === 'function') {
        provider.on('accountChanged', this._onAccount);
        provider.on('disconnect', this._onDisc);
      } else if (typeof provider.addEventListener === 'function') {
        provider.addEventListener('accountChanged', this._onAccount);
        provider.addEventListener('disconnect', this._onDisc);
      }
    } catch { /* some injected providers are frozen */ }
  }
  _unlisten() {
    const p = this._prov;
    if (!p) return;
    try {
      p.removeListener?.('accountChanged', this._onAccount);
      p.removeListener?.('disconnect', this._onDisc);
      p.off?.('accountChanged', this._onAccount);
      p.off?.('disconnect', this._onDisc);
      p.removeEventListener?.('accountChanged', this._onAccount);
      p.removeEventListener?.('disconnect', this._onDisc);
    } catch { /* ignore */ }
    this._prov = null;
  }

  async connect({ onlyIfTrusted = false } = {}) {
    const d = detect();
    if (!d) {
      const err = new Error(typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
        ? MOBILE_HINT
        : 'No Solana wallet found. Install Phantom, Backpack or Solflare (optional — you can play without one).');
      err.code = 'missing';
      throw err;
    }
    try {
      const res = await d.provider.connect(onlyIfTrusted ? { onlyIfTrusted: true } : undefined);
      const address = addrOf(d.provider) || addrOf({ publicKey: res?.publicKey }) || (typeof res?.publicKey === 'string' ? res.publicKey : null);
      if (!address) throw new Error('Wallet connected but published no address.');
      if (!onlyIfTrusted) setWantLink(true);
      this._apply(d.name, d.provider, address);
      return this.state;
    } catch (e) {
      throw polite(e, 'Could not connect the wallet.');
    }
  }

  async disconnect() {
    const p = this._prov || detect()?.provider;
    try { await p?.disconnect?.(); } catch { /* ignore */ }
    this._unlisten();
    this.state = { connected: false, address: null, provider: null, linked: this.state.linked };
    this._emit();
  }

  async signMessage(text) {
    if (!this.state.connected) await this.connect();
    const p = this._prov || detect()?.provider;
    if (!p?.signMessage) {
      const err = new Error('This wallet cannot sign a message.');
      err.code = 'unsupported';
      throw err;
    }
    try {
      const bytes = new TextEncoder().encode(String(text));
      const signed = await p.signMessage(bytes, 'utf8');
      const sig = toBytes(signed);
      if (!sig || sig.length !== 64) throw new Error('Wallet returned an unexpected signature.');
      return b58encode(sig);
    } catch (e) {
      throw polite(e, 'Could not sign the link message.');
    }
  }

  // Silent restore: only if the user previously chose to link. never pops a prompt
  // when the provider is missing or has not trusted this origin.
  async restore() {
    if (!wantLink() || !this.available()) return this.state;
    try { await this.connect({ onlyIfTrusted: true }); } catch { /* not trusted / missing — stay quiet */ }
    return this.state;
  }
}

export const wallet = new Wallet();
if (typeof window !== 'undefined') window.__wallet = wallet;
