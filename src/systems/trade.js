import { bus, Events } from '../core/events.js';
import { net } from '../net/NetworkManager.js';
import { econ, isTradable } from '../net/economyNet.js';
import { gearById } from '../data/gear.js';

// Direct player-to-player trade (client state machine). The relay owns the
// session and does the swap atomically against both server-side saves
// (server/economy.js); this only mirrors it for the UI and sanity-checks
// offers against the local bag so honest players get instant feedback.
//
//   request(target)   target = sessionId or player name (same room)
//   respond(accept)   answer the pending incoming request
//   offer(items, gold) / lock() / unlock() / confirm() / cancel()
//
// Flow: both sides edit offers -> both LOCK (offer frozen; any change unlocks
// both) -> both CONFIRM -> server validates + swaps -> trade-result.
// Listeners: trade.on(fn) gets {kind: 'request'|'open'|'update'|'result'|'closed', ...}.
class TradeSystem {
  constructor() {
    this.session = null;   // {id, partner:{sid,name}, me:{items,gold,locked,confirmed}, them:{...}}
    this.request = null;   // incoming {from, fromName, at}
    this.listeners = new Set();
    this._offerT = 0;

    // escrow session (secure trade with 2.5% fee)
    this.escrowSession = null;
    this.escrowRequest = null;
    this._escrowOfferT = 0;

    econ.on('trade-request', (m) => {
      this.request = { from: m.from, fromName: m.fromName, at: Date.now() };
      bus.emit(Events.SYSTEM, `${m.fromName} wants to trade. /trade accept or /trade decline`);
      this.emit({ kind: 'request', request: this.request });
      clearTimeout(this._reqT);
      this._reqT = setTimeout(() => { if (this.request?.from === m.from) { this.request = null; this.emit({ kind: 'request', request: null }); } }, 30_000);
    });
    econ.on('trade-open', (m) => {
      const blank = () => ({ items: [], gold: 0, locked: false, confirmed: false });
      this._pending = null; clearTimeout(this._offerT);
      this.session = { id: m.id, partner: m.partner, me: blank(), them: blank() };
      this.request = null;
      econ.syncSave(); // server copy = current bag before any offer
      this.emit({ kind: 'open', session: this.session });
    });
    econ.on('trade-update', (m) => {
      if (!this.session || m.id !== this.session.id) return;
      this.session.me = m.me; this.session.them = m.them;
      if (this._pending) Object.assign(this.session.me, { items: [...this._pending.items], gold: this._pending.gold, locked: false, confirmed: false });
      this.emit({ kind: 'update', session: this.session });
    });
    econ.on('trade-result', (m) => {
      if (!this.session || m.id !== this.session.id) return;
      if (m.ok) {
        const s = this.session; this.session = null;
        const got = s.them.items.map((id) => gearById(id)?.name || id);
        bus.emit(Events.SYSTEM, `Received: ${[...got, s.them.gold ? `${s.them.gold}g` : ''].filter(Boolean).join(', ') || 'nothing'}.`);
        this.emit({ kind: 'result', ok: true, session: s });
      } else {
        bus.emit(Events.SYSTEM, `Trade failed: ${m.reason}`);
        this.emit({ kind: 'result', ok: false, reason: m.reason, session: this.session });
      }
    });
    econ.on('trade-closed', (m) => {
      if (this.session && m.id === this.session.id) {
        this.session = null;
        bus.emit(Events.SYSTEM, `Trade closed: ${m.reason}`);
        this.emit({ kind: 'closed', reason: m.reason });
      }
    });

    // escrow events
    econ.on('escrow-request', (m) => {
      this.escrowRequest = { from: m.from, fromName: m.fromName, at: Date.now() };
      bus.emit(Events.SYSTEM, `${m.fromName} wants to escrow trade. /escrow accept or /escrow decline`);
      this.emit({ kind: 'escrow-request', request: this.escrowRequest });
      clearTimeout(this._escrowReqT);
      this._escrowReqT = setTimeout(() => { if (this.escrowRequest?.from === m.from) { this.escrowRequest = null; this.emit({ kind: 'escrow-request', request: null }); } }, 30_000);
    });
    econ.on('escrow-open', (m) => {
      const blank = () => ({ items: [], gold: 0, locked: false, confirmed: false });
      this._escrowPending = null; clearTimeout(this._escrowOfferT);
      this.escrowSession = { id: m.id, partner: m.partner, me: blank(), them: blank() };
      this.escrowRequest = null;
      econ.syncSave();
      this.emit({ kind: 'escrow-open', session: this.escrowSession });
    });
    econ.on('escrow-update', (m) => {
      if (!this.escrowSession || m.id !== this.escrowSession.id) return;
      this.escrowSession.me = m.me; this.escrowSession.them = m.them;
      this.escrowSession.fee = m.fee;
      if (this._escrowPending) Object.assign(this.escrowSession.me, { items: [...this._escrowPending.items], gold: this._escrowPending.gold, locked: false, confirmed: false });
      this.emit({ kind: 'escrow-update', session: this.escrowSession });
    });
    econ.on('escrow-result', (m) => {
      if (!this.escrowSession || m.id !== this.escrowSession.id) return;
      if (m.ok) {
        const s = this.escrowSession; this.escrowSession = null;
        const got = s.them.items.map((id) => gearById(id)?.name || id);
        bus.emit(Events.SYSTEM, `Escrow complete: received ${[...got, s.them.gold ? `${s.them.gold}g` : ''].filter(Boolean).join(', ') || 'nothing'} (fee ${m.fee || 0}g).`);
        this.emit({ kind: 'escrow-result', ok: true, session: s, fee: m.fee });
      } else {
        bus.emit(Events.SYSTEM, `Escrow failed: ${m.reason}`);
        this.emit({ kind: 'escrow-result', ok: false, reason: m.reason, session: this.escrowSession });
      }
    });
    econ.on('escrow-closed', (m) => {
      if (this.escrowSession && m.id === this.escrowSession.id) {
        this.escrowSession = null;
        bus.emit(Events.SYSTEM, `Escrow closed: ${m.reason}`);
        this.emit({ kind: 'escrow-closed', reason: m.reason });
      }
    });

    bus.on(Events.NET_DISCONNECTED, () => {
      if (this.session) { this.session = null; this.emit({ kind: 'closed', reason: 'Disconnected.' }); }
      if (this.escrowSession) { this.escrowSession = null; this.emit({ kind: 'escrow-closed', reason: 'Disconnected.' }); }
      this.request = null; this.escrowRequest = null;
    });
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(ev) { this.listeners.forEach((fn) => { try { fn(ev); } catch (e) { console.error('[trade]', e); } }); }
  get active() { return !!this.session; }
  get escrowActive() { return !!this.escrowSession; }

  resolve(target) {
    if (!target) return null;
    if (net.peers.has(target)) return { sid: target, name: net.peers.get(target).name };
    const n = String(target).toLowerCase();
    for (const [sid, p] of net.peers) if (p.name?.toLowerCase() === n && !p.dc) return { sid, name: p.name };
    return null;
  }
  requestTrade(target) {
    if (!econ.online) { bus.emit(Events.SYSTEM, 'Play Online to trade with other players.'); return false; }
    if (this.session) { bus.emit(Events.SYSTEM, 'Finish your current trade first.'); return false; }
    const t = this.resolve(target);
    if (!t) { bus.emit(Events.SYSTEM, `No player "${String(target || '').slice(0, 14)}" in this world.`); return false; }
    return econ.send('trade-request', { to: t.sid });
  }
  respond(accept) {
    const r = this.request;
    if (!r) { bus.emit(Events.SYSTEM, 'No pending trade request.'); return; }
    this.request = null;
    this.emit({ kind: 'request', request: null });
    if (accept) econ.syncSave();
    econ.send('trade-respond', { from: r.from, accept: !!accept });
  }

  // Local sanity check (the server re-checks against its copy).
  validOffer(items, gold) {
    const p = econ.player();
    if (!p) return 'No hero loaded.';
    if (items.length > econ.cfg.tradeItems) return `At most ${econ.cfg.tradeItems} items per trade.`;
    const bag = [...p.inventory];
    for (const id of items) {
      if (!isTradable(id)) return `${gearById(id)?.name || id} cannot be traded.`;
      const i = bag.indexOf(id);
      if (i < 0) return 'That item is not in your bag (unequip it first).';
      bag.splice(i, 1);
    }
    if (!Number.isInteger(gold) || gold < 0) return 'Gold must be a whole number.';
    if (gold > (p.gold | 0)) return 'You do not have that much gold.';
    return null;
  }
  offer(items, gold) {
    if (!this.session) return false;
    const bad = this.validOffer(items, gold);
    if (bad) { bus.emit(Events.SYSTEM, bad); return false; }
    // optimistic: show it right away (and drop our locks, like the server will)
    Object.assign(this.session.me, { items: [...items], gold, locked: false, confirmed: false });
    this.session.them.locked = false; this.session.them.confirmed = false;
    this.emit({ kind: 'update', session: this.session });
    this._pending = { items: [...items], gold };
    clearTimeout(this._offerT);
    this._offerT = setTimeout(() => this.flushOffer(), 250);
    return true;
  }
  // send the pending offer (kept apart from session.me, which trade-update overwrites)
  flushOffer() {
    clearTimeout(this._offerT); this._offerT = 0;
    const p = this._pending; this._pending = null;
    if (!p || !this.session) return;
    econ.send('trade-offer', { id: this.session.id, items: p.items, gold: p.gold }, { sync: true });
  }
  lock() { if (!this.session) return; this.flushOffer(); econ.send('trade-lock', { id: this.session.id }, { rev: true, sync: true }); }
  unlock() { if (this.session) econ.send('trade-unlock', { id: this.session.id }); }
  confirm() { if (this.session) econ.send('trade-confirm', { id: this.session.id }); }
  cancel() {
    if (this.session) econ.send('trade-cancel', { id: this.session.id });
    else if (this.request) this.respond(false);
  }

  // ── escrow trade methods (secure, 2.5% fee) ──
  requestEscrow(target) {
    if (!econ.online) { bus.emit(Events.SYSTEM, 'Play Online to use escrow trading.'); return false; }
    if (this.escrowSession) { bus.emit(Events.SYSTEM, 'Finish your current escrow first.'); return false; }
    const t = this.resolve(target);
    if (!t) { bus.emit(Events.SYSTEM, `No player "${String(target || '').slice(0, 14)}" in this world.`); return false; }
    return econ.send('escrow-request', { to: t.sid });
  }
  respondEscrow(accept) {
    const r = this.escrowRequest;
    if (!r) { bus.emit(Events.SYSTEM, 'No pending escrow request.'); return; }
    this.escrowRequest = null;
    this.emit({ kind: 'escrow-request', request: null });
    if (accept) econ.syncSave();
    econ.send('escrow-respond', { from: r.from, accept: !!accept });
  }
  validEscrowOffer(items, gold) {
    const p = econ.player();
    if (!p) return 'No hero loaded.';
    if (items.length > econ.cfg.tradeItems) return `At most ${econ.cfg.tradeItems} items per trade.`;
    const bag = [...p.inventory];
    for (const id of items) {
      if (!isTradable(id)) return `${gearById(id)?.name || id} cannot be traded.`;
      const i = bag.indexOf(id);
      if (i < 0) return 'That item is not in your bag (unequip it first).';
      bag.splice(i, 1);
    }
    if (!Number.isInteger(gold) || gold < 0) return 'Gold must be a whole number.';
    if (gold > (p.gold | 0)) return 'You do not have that much gold.';
    return null;
  }
  offerEscrow(items, gold) {
    if (!this.escrowSession) return false;
    const bad = this.validEscrowOffer(items, gold);
    if (bad) { bus.emit(Events.SYSTEM, bad); return false; }
    Object.assign(this.escrowSession.me, { items: [...items], gold, locked: false, confirmed: false });
    this.escrowSession.them.locked = false; this.escrowSession.them.confirmed = false;
    this.emit({ kind: 'escrow-update', session: this.escrowSession });
    this._escrowPending = { items: [...items], gold };
    clearTimeout(this._escrowOfferT);
    this._escrowOfferT = setTimeout(() => this.flushEscrowOffer(), 250);
    return true;
  }
  flushEscrowOffer() {
    clearTimeout(this._escrowOfferT); this._escrowOfferT = 0;
    const p = this._escrowPending; this._escrowPending = null;
    if (!p || !this.escrowSession) return;
    econ.send('escrow-offer', { id: this.escrowSession.id, items: p.items, gold: p.gold }, { sync: true });
  }
  lockEscrow() { if (!this.escrowSession) return; this.flushEscrowOffer(); econ.send('escrow-lock', { id: this.escrowSession.id }, { rev: true, sync: true }); }
  unlockEscrow() { if (this.escrowSession) econ.send('escrow-unlock', { id: this.escrowSession.id }); }
  confirmEscrow() { if (this.escrowSession) econ.send('escrow-confirm', { id: this.escrowSession.id }); }
  cancelEscrow() {
    if (this.escrowSession) econ.send('escrow-cancel', { id: this.escrowSession.id });
    else if (this.escrowRequest) this.respondEscrow(false);
  }
}

export const trade = new TradeSystem();
if (typeof window !== 'undefined') window.__trade = trade; // debug / automated tests
