import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { loadProgress, saveProgress, BAG_SIZE } from '../core/save.js';
import { gearById } from '../data/gear.js';
import ITEM_IDS from '../data/item_ids.json'; // copy of server/shared/item_ids.json (Vercel doesn't upload server/); see tools/export_item_ids.mjs

// Client side of the player economy (server/economy.js): trade, market board,
// mail, persisted guilds. The server's copy of the character is authoritative
// for every economy operation; the client applies the results it is sent.
//
// Revision protocol: the server bumps a per-character `rev` on each economy
// mutation. We remember the last rev we applied (localStorage, per hero) and
// quote it on every economy op AND on every save upload (net.econRev ->
// NetworkManager.flushSave). A save with an old rev is refused by the server
// (it could resurrect items already traded away) and answered with
// econ-sync {stale}. On (re)join we send econ-hello {rev}; if the server's
// rev differs from ours we missed a result while offline and adopt the
// server's gold + bag wholesale.
//
// Results carry a delta {gold, add[], remove[]} which is applied to the live
// hero, so loot picked up while a request was in flight is never lost.
//
// Events (econ.on(evt, fn)): state, sync, msg, error, trade-request,
// trade-open, trade-update, trade-result, trade-closed, market-page,
// mail-box, mail-unread, guild-info, guild-invite, status, wallet-bound,
// wallet-bind-challenge, token-withdraw-result, token-deposit-result,
// token-bridge-state.
export const GEAR_WHITELIST = ITEM_IDS.gear || {};
export const isTradable = (id) => typeof id === 'string' && Object.prototype.hasOwnProperty.call(GEAR_WHITELIST, id) && !!gearById(id);
const REV_KEY = 'wayfarer.econrev.v1.';

class EconNet {
  constructor() {
    this.handlers = new Map();
    this.rev = null;
    this.ready = false;       // econ-state received for this connection
    this.hasSave = false;
    this.mailUnread = 0;
    this.guildTag = '';
    this.guild = null;        // last guild-info payload
    this.cfg = { bag: BAG_SIZE, tradeItems: 8, tax: 0.05, hours: [2, 8, 24, 48], postage: 5, mailItems: 5, priceMax: 1_000_000, tokenWithdrawDailyCap: 500 };
    this.sinksState = { dailyClaimed: 0, stashTabs: 0 };
    this.bridge = null;       // last token-bridge-state payload (wallet link + withdraw/deposit)
    this.worldFn = null;
    if (typeof window === 'undefined') return;
    net.onAttach((room) => this.attach(room));
    // a brand-new character has no server copy at hello time: ask again after its first save
    net.on('saved', () => { if (this.online && this.ready && !this.hasSave) net.send('econ-hello', { rev: this.localRev() }); });
    bus.on(Events.NET_DISCONNECTED, () => { this.ready = false; this.guild = null; this.emit('status', { online: false }); });
    bus.on(Events.NET_STATUS, (s) => { if (s?.status !== 'online') { this.ready = false; } this.emit('status', { online: this.online }); });
  }

  get online() { return net.connected; }
  get usable() { return this.online && this.ready && this.hasSave; }
  setWorld(fn) { this.worldFn = fn; }
  world() { try { return this.worldFn?.() || null; } catch { return null; } }
  player() { return this.world()?.player || null; }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt)?.delete(fn);
  }
  emit(evt, m) { this.handlers.get(evt)?.forEach((fn) => { try { fn(m); } catch (e) { console.error(`[econ] ${evt}`, e); } }); }

  // ── revision bookkeeping ──
  revKey() { return REV_KEY + String(net.name || 'wayfarer').toLowerCase(); }
  localRev() { try { const v = localStorage.getItem(this.revKey()); return v === null ? null : Number(v); } catch { return null; } }
  setRev(r) {
    if (!Number.isInteger(r)) return;
    this.rev = r; net.econRev = r;
    try { localStorage.setItem(this.revKey(), String(r)); } catch { /* private mode */ }
  }

  attach(room) {
    this.ready = false;
    const on = (type, fn) => room.onMessage(type, (m) => {
      if (m && typeof m === 'object' && m.sessionId !== undefined) return; // relayed by a peer: never trust
      try { fn(m || {}); } catch (e) { console.error(`[econ] ${type}`, e); }
    });
    on('econ-state', (m) => this.onState(m));
    on('econ-sync', (m) => this.onSync(m));
    on('token-spend-ok', (m) => this.onTokenSpendOk(m));
    on('wallet-bind-challenge', (m) => this.emit('wallet-bind-challenge', m));
    on('wallet-bound', (m) => {
      this.bridge = { ...(this.bridge || {}), address: m.address || '' };
      bus.emit(Events.SYSTEM, `Wallet linked: ${String(m.address || '').slice(0, 4)}...`);
      this.emit('wallet-bound', m);
      this.getBridgeState();
    });
    on('token-withdraw-result', (m) => this.emit('token-withdraw-result', m));
    on('token-deposit-result', (m) => this.emit('token-deposit-result', m));
    on('token-bridge-state', (m) => { this.bridge = m; this.emit('token-bridge-state', m); });
    on('econ-msg', (m) => { bus.emit(Events.SYSTEM, m.text); this.emit('msg', m); });
    on('econ-error', (m) => { bus.emit(Events.SYSTEM, m.msg || 'That did not work.'); this.emit('error', m); });
    on('trade-result', (m) => {
      if (m.ok) { this.applyDelta(m.delta, `Trade with ${m.partner} complete.`); this.setRev(m.rev); }
      this.emit('trade-result', m);
    });
    for (const t of ['trade-request', 'trade-open', 'trade-update', 'trade-closed', 'market-page', 'guild-invite']) on(t, (m) => this.emit(t, m));
    on('mail-box', (m) => { this.mailUnread = m.unread | 0; this.emit('mail-box', m); this.emit('mail-unread', { n: this.mailUnread }); });
    on('mail-unread', (m) => {
      this.mailUnread = m.n | 0;
      if (m.subject) bus.emit(Events.SYSTEM, `New mail from ${m.from}: ${m.subject}`);
      this.emit('mail-unread', m);
    });
    on('guild-info', (m) => {
      this.guild = m.tag ? m : null; this.guildTag = m.tag || '';
      this.emit('guild-info', this.guild);
      bus.emit(Events.SOCIAL_ROSTER, null); // SocialPanels re-renders its list (guild tab)
    });
    try { room.send('econ-hello', { rev: this.localRev() }); } catch { /* not joined yet */ }
  }

  onState(m) {
    this.hasSave = !!m.hasSave;
    if (m.cfg) this.cfg = { ...this.cfg, ...m.cfg };
    if (m.sinksState) this.sinksState = { ...this.sinksState, ...m.sinksState };
    this.mailUnread = m.mailUnread | 0;
    this.guildTag = m.guild || '';
    if (m.hasSave) {
      const local = this.localRev();
      if ((local === null && m.rev > 0) || (local !== null && local !== m.rev)) {
        this.replaceFrom(m, 'Your bag was synced with the server (economy).');
      }
      this.setRev(m.rev);
    } else if (this.rev === null) this.setRev(0);
    this.ready = true;
    this.emit('state', m);
    this.emit('mail-unread', { n: this.mailUnread });
    if (this.guildTag) net.send('guild-info', {});
  }

  onSync(m) {
    if (m.delta) { this.applyDelta(m.delta); this.setRev(m.rev); }
    else if (m.rev !== this.rev) { this.replaceFrom(m, m.stale ? 'Bag re-synced with the server.' : null); this.setRev(m.rev); }
    else if (m.stale) this.world()?.saveNow?.(); // our state is current: re-upload progress
    if (m.sinksState) this.sinksState = { ...this.sinksState, ...m.sinksState };
    this.emit('sync', m);
  }

  // ── applying server results to the hero ──
  applyDelta(d, note) {
    if (!d) return;
    const p = this.player();
    if (p) {
      p.gold = Math.max(0, (p.gold | 0) + (d.gold | 0));
      if (d.tokenPoints !== undefined) p.tokenPoints = Math.max(0, (p.tokenPoints | 0) + d.tokenPoints);
      if (d.wayfarerTokens !== undefined) p.wayfarerTokens = Math.max(0, (p.wayfarerTokens | 0) + d.wayfarerTokens);
      if (d.stake) { p.ext ||= {}; p.ext.stake = d.stake; }
      for (const id of d.remove || []) {
        const i = p.inventory.indexOf(id);
        if (i >= 0) { p.inventory.splice(i, 1); continue; }
        const slot = Object.keys(p.equipped || {}).find((k) => p.equipped[k] === id);
        if (slot) { if (p.unequip) { p.unequip(slot); const j = p.inventory.indexOf(id); if (j >= 0) p.inventory.splice(j, 1); } else p.equipped[slot] = null; }
      }
      for (const id of d.add || []) if (gearById(id)) p.inventory.push(id);
      this.afterChange();
    } else {
      this.patchStored((pr) => {
        pr.gold = Math.max(0, (pr.gold | 0) + (d.gold | 0));
        if (d.tokenPoints !== undefined) pr.tokenPoints = Math.max(0, (pr.tokenPoints | 0) + d.tokenPoints);
        if (d.wayfarerTokens !== undefined) pr.wayfarerTokens = Math.max(0, (pr.wayfarerTokens | 0) + d.wayfarerTokens);
        if (d.stake) { pr.ext ||= {}; pr.ext.stake = d.stake; }
        for (const id of d.remove || []) { const i = pr.inventory.indexOf(id); if (i >= 0) pr.inventory.splice(i, 1); }
        for (const id of d.add || []) pr.inventory.push(id);
      });
    }
    if (note) bus.emit(Events.SYSTEM, note);
  }
  replaceFrom(m, note) {
    if (!Array.isArray(m.inventory)) return;
    const inv = m.inventory.filter((id) => gearById(id)).slice(0, BAG_SIZE);
    const p = this.player();
    if (p) {
      p.gold = m.gold | 0; p.inventory = inv;
      if (m.tokenPoints !== undefined) p.tokenPoints = m.tokenPoints | 0;
      if (m.wayfarerTokens !== undefined) p.wayfarerTokens = m.wayfarerTokens | 0;
      this.afterChange();
    } else this.patchStored((pr) => {
      pr.gold = m.gold | 0; pr.inventory = inv;
      if (m.tokenPoints !== undefined) pr.tokenPoints = m.tokenPoints | 0;
      if (m.wayfarerTokens !== undefined) pr.wayfarerTokens = m.wayfarerTokens | 0;
    });
    if (note) bus.emit(Events.SYSTEM, note);
  }
  afterChange() {
    const w = this.world();
    bus.emit(Events.GEAR, { changed: true });
    if (w?.hpPayload) bus.emit(Events.PLAYER_HP, w.hpPayload());
    w?.saveNow?.();
  }
  patchStored(fn) {
    if (!net.name) return;
    const pr = loadProgress(net.name);
    if (!pr) return;
    pr.inventory = [...(pr.inventory || [])];
    fn(pr);
    saveProgress(net.name, pr, { silent: true, savedAt: Date.now() });
  }

  // Push the hero's current state to the server copy before an op that is
  // validated against it (messages are ordered, so the save lands first).
  syncSave() {
    const w = this.world();
    if (!w?.player || !this.online) return;
    w.saveNow?.();
    net.flushSave?.(true);
  }

  // Send an economy op; `rev` ops quote our current revision.
  send(type, payload = {}, { rev = false, sync = false } = {}) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to use the market, mail and trading.'); return false; }
    if (sync) this.syncSave();
    return net.send(type, rev ? { ...payload, rev: this.rev ?? 0 } : payload);
  }

  spendTokens(type, amount, meta = {}) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to spend Wayfarer Tokens.'); return false; }
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (n <= 0) { bus.emit(Events.SYSTEM, 'Enter a positive token amount.'); return false; }
    return this.send('token-spend', { type, amount: n, ...meta }, { rev: true, sync: true });
  }

  // ── token bridge (wallet link + withdraw/deposit) ──
  walletChallenge(address) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to link a wallet.'); return false; }
    if (!address) { bus.emit(Events.SYSTEM, 'Connect a Solana wallet first.'); return false; }
    return net.send('wallet-bind-challenge', { address });
  }
  walletBind(address, signature) {
    if (!this.online) return false;
    return net.send('wallet-bind', { address, signature });
  }
  requestWithdraw(amount) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to withdraw tokens.'); return false; }
    const n = Math.max(0, Math.floor(Number(amount) || 0));
    if (n <= 0) { bus.emit(Events.SYSTEM, 'Enter a positive token amount.'); return false; }
    return this.send('token-withdraw', { amount: n }, { rev: true, sync: true });
  }
  requestDeposit(signature) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to deposit tokens.'); return false; }
    const sig = String(signature || '').trim();
    if (!sig) { bus.emit(Events.SYSTEM, 'Paste a Solana transaction signature.'); return false; }
    return net.send('token-deposit', { signature: sig });
  }
  getBridgeState() {
    if (!this.online) return false;
    return net.send('token-bridge-state', {});
  }

  onTokenSpendOk(m) {
    if (!m || !m.type) return;
    const p = this.player();
    if (m.wayfarerTokens !== undefined) {
      if (p) p.wayfarerTokens = Math.max(0, m.wayfarerTokens | 0);
      else this.patchStored((pr) => { pr.wayfarerTokens = Math.max(0, m.wayfarerTokens | 0); });
    }
    if (m.sinksState) this.sinksState = { ...this.sinksState, ...m.sinksState };
    this.afterChange();
    // Let feature modules react (revive, pet rename, stash expansion).
    bus.emit(Events.SYSTEM, `Spent ${m.amount} token${m.amount !== 1 ? 's' : ''} on ${m.type}.`);
    if (m.type === 'pet-rename') {
      const panel = window.__socialUI?.petPanel;
      if (panel?.renameWithToken && m.petId && m.name) {
        const roster = panel.roster;
        const pet = roster.find((x) => x.id === m.petId || x.slot === m.petId);
        if (pet) panel.renameWithToken(pet, m.name);
      }
    }
    if (m.type === 'stash-tab') {
      this.patchStored((pr) => { pr.ext = pr.ext || {}; pr.ext.stashTabs = Math.max(0, m.sinksState?.stashTabs | 0); });
    }
    if (m.type === 'orb-upgrade' && m.item) {
      this.patchStored((pr) => { pr.ext = pr.ext || {}; pr.ext[m.item] = (pr.ext[m.item] || 0) + 1; });
    }
  }
}

export function stakeTokens(tier, amount) {
  if (!econ.usable) { bus.emit(Events.SYSTEM, 'Play Online to stake tokens.'); return false; }
  return econ.send('token-stake', { tier, amount }, { rev: true, sync: true });
}

export function getStakeTierMeta() {
  return econ.cfg?.stakeTiers || {
    bronze: { amount: 100, days: 7, dropRate: 0.05 },
    silver: { amount: 500, days: 14, dropRate: 0.10 },
    gold: { amount: 2000, days: 30, dropRate: 0.15 },
  };
}

export const econ = new EconNet();
if (typeof window !== 'undefined') window.__econ = econ; // debug / automated tests
