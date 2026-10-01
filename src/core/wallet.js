// Optional wallet link. A later agent may replace this stub; the title screen
// always guards on wallet.available() and never auto-prompts.
class Wallet {
  constructor() {
    this.state = { connected: false, address: null, provider: null, linked: false };
    this._fns = new Set();
  }
  available() { return false; }
  async connect() { return this.state; }
  async disconnect() {
    this.state = { connected: false, address: null, provider: null, linked: false };
    this._emit();
  }
  shortAddress() {
    const a = this.state.address;
    if (!a) return '';
    return a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a;
  }
  on(ev, fn) {
    if (ev !== 'change' || typeof fn !== 'function') return () => {};
    this._fns.add(fn);
    return () => this._fns.delete(fn);
  }
  _emit() { this._fns.forEach((fn) => { try { fn(this.state); } catch { /* ignore */ } }); }
}

export const wallet = new Wallet();
