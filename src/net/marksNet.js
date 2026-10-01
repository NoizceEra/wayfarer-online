import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';
import { onProgressSaved, loadProgress } from '../core/save.js';
import { wallet } from '../core/wallet.js';
import { walletStatus } from './walletApi.js';
import {
  newDoc, normalizeDoc, evaluate, cleanClaim, awardDaily, tickActive, buy, equip, lookOf, todayOf,
  MARKS_VERSION, COSMETICS, COSMETIC_BY_ID,
} from '../data/marksRules.js';

// Client of the Wayfarer Marks layer (server/marks.js). Offline: the same
// rules engine runs locally so solo players see Marks accrue; the server
// recomputes from milestones when they come online and is the authority for
// balance, shop entitlements and the leaderboard.

const LS = 'wayfarer.marks.v1';
const SEASON = 's1';

function loadLocal() {
  try { return normalizeDoc(JSON.parse(localStorage.getItem(LS))); } catch { return newDoc(); }
}
function saveLocal(doc) {
  try { localStorage.setItem(LS, JSON.stringify(doc)); } catch { /* quota / private */ }
}

function emptyState(doc) {
  const d = doc || newDoc();
  return {
    v: MARKS_VERSION, enabled: true,
    flags: { walletLink: true, marks: true, leaderboard: true, founderBadge: true, seasonBadge: true, redeemableRewards: false, onchainClaim: false, season: SEASON },
    balance: d.balance, earned: d.earned, spent: d.spent,
    season: { id: d.season.id || SEASON, earned: d.season.earned || 0 },
    today: todayOf(d), history: d.history.slice(0, 25),
    owned: d.owned, badges: d.badges, equipped: d.equipped, look: lookOf(d),
    board: { show: false, name: '', showAddr: false },
    wallet: { linked: !!wallet.state.linked, short: wallet.shortAddress() },
    online: false,
  };
}

class MarksNet {
  constructor() {
    this.doc = loadLocal();
    this.state = emptyState(this.doc);
    this.handlers = new Map();
    this.looks = new Map(); // sid -> look
    this.board = null;
    this.worldFn = null;
    this.lastPos = null;
    this.lastTick = 0;
    if (typeof window === 'undefined') return;
    net.onAttach((room) => this.attach(room));
    onProgressSaved((name, rec) => this.onSave(name, rec));
    bus.on(Events.NET_DISCONNECTED, () => {
      this.state = { ...this.state, online: false };
      this.emit('status', this.state);
    });
    bus.on(Events.NET_CONNECTED, () => { this.refreshWallet(); });
    wallet.on('change', () => {
      this.state = { ...this.state, wallet: { linked: !!wallet.state.linked, short: wallet.shortAddress() } };
      this.emit('state', this.state);
    });
  }

  setWorld(fn) { this.worldFn = fn; }
  world() { try { return this.worldFn?.() || null; } catch { return null; } }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt)?.delete(fn);
  }
  emit(evt, m) { this.handlers.get(evt)?.forEach((fn) => { try { fn(m); } catch (e) { console.error(`[marks] ${evt}`, e); } }); }

  attach(room) {
    const on = (type, fn) => room.onMessage(type, (m) => {
      // generic passthrough adds sessionId when a peer forged the type; server
      // also swallows those, but never apply a peer-shaped Marks payload.
      if (type !== 'marks-look' && m && typeof m === 'object' && m.sessionId !== undefined && m.balance === undefined && m.awards === undefined) return;
      try { fn(m || {}); } catch (e) { console.error(`[marks] ${type}`, e); }
    });
    on('marks-state', (m) => this.onState(m));
    on('marks-award', (m) => this.onAward(m));
    on('marks-board', (m) => { this.board = m; this.emit('board', m); });
    on('marks-look', (m) => this.onLook(m));
    on('marks-error', (m) => { bus.emit(Events.SYSTEM, m.msg || 'That did not work.'); this.emit('error', m); });
    on('marks-msg', (m) => { bus.emit(Events.SYSTEM, m.text); this.emit('msg', m); });
    net.send('marks-hello', {});
    this.refreshWallet();
  }

  async refreshWallet() {
    if (!net.token) return;
    try {
      const s = await walletStatus();
      wallet.setLinked(!!s.linked);
      if (s.linked && s.address && wallet.state.address && s.address !== wallet.state.address) {
        // connected a different account than the one linked to this device
        wallet.setLinked(true);
      }
      this.state = { ...this.state, wallet: { linked: !!s.linked, short: s.short || wallet.shortAddress() } };
      this.emit('state', this.state);
    } catch { /* relay down: Marks still work locally */ }
  }

  onState(m) {
    if (!m || typeof m !== 'object') return;
    this.applyServer(m);
    this.emit('state', this.state);
  }
  applyServer(m) {
    this.doc.balance = m.balance | 0;
    this.doc.earned = m.earned | 0;
    this.doc.spent = m.spent | 0;
    if (Array.isArray(m.owned)) this.doc.owned = m.owned;
    if (Array.isArray(m.badges)) this.doc.badges = m.badges;
    if (m.equipped && typeof m.equipped === 'object') this.doc.equipped = m.equipped;
    if (Array.isArray(m.history)) this.doc.history = m.history;
    if (m.season) this.doc.season = { id: m.season.id || SEASON, earned: m.season.earned | 0 };
    saveLocal(this.doc);
    this.state = { ...emptyState(this.doc), ...m, look: m.look || lookOf(this.doc), online: true, enabled: m.enabled !== false };
    if (m.look) this.applyLook(net.sessionId, m.look);
  }

  onAward(m) {
    if (typeof m.balance === 'number') this.doc.balance = m.balance;
    const awards = Array.isArray(m.awards) ? m.awards : [];
    if (awards.length) {
      for (const a of awards) this.doc.history.unshift({ t: Date.now(), src: a.src, n: a.n, label: a.label });
      this.doc.history.length = Math.min(this.doc.history.length, 40);
      const n = awards.reduce((s, a) => s + (a.n | 0), 0);
      const label = awards.length === 1 ? awards[0].label : `${awards.length} feats`;
      bus.emit(Events.TOAST, { title: 'Wayfarer Marks', text: `+${n}  ${label}`, color: '#9bbc0f' });
    }
    saveLocal(this.doc);
    this.state = { ...this.state, balance: this.doc.balance, history: this.doc.history.slice(0, 25), today: todayOf(this.doc) };
    this.emit('award', m);
    this.emit('state', this.state);
  }

  onLook(m) {
    const sid = m.sid || m.sessionId;
    if (!sid || !m.look) return;
    this.applyLook(sid, m.look);
  }
  applyLook(sid, look) {
    this.looks.set(sid, look);
    const w = this.world();
    if (!w) return;
    if (sid === net.sessionId) { w.myMarksLook = look; return; }
    const r = w.sync?.remotes?.get(sid);
    if (r?.applyLook) r.applyLook(look);
  }

  // Offline evaluate from a character save. Online the server is authoritative.
  onSave(name, rec) {
    if (!rec || this.state.online || net.connected) return;
    const claim = cleanClaim(rec.ext);
    const { awards } = evaluate(this.doc, {
      char: name, level: rec.level, gold: rec.gold, claim, now: Date.now(), season: this.state.flags?.season || SEASON,
    });
    saveLocal(this.doc);
    this.state = { ...emptyState(this.doc), flags: this.state.flags, wallet: this.state.wallet, online: false };
    if (awards.length) this.onAward({ awards, balance: this.doc.balance });
    else this.emit('state', this.state);
  }

  // Count an active minute when the local player actually moved (solo daily login).
  pulse(x, y) {
    if (this.state.online) return;
    const now = Date.now();
    const last = this.lastPos;
    this.lastPos = { x, y };
    if (!last || Math.hypot(x - last.x, y - last.y) < 8) return;
    if (now - this.lastTick < 60_000) return;
    this.lastTick = now;
    if (!tickActive(this.doc, now)) { saveLocal(this.doc); return; }
    const awards = awardDaily(this.doc, now, this.state.flags?.season || SEASON);
    saveLocal(this.doc);
    if (awards.length) this.onAward({ awards, balance: this.doc.balance });
  }

  send(type, payload) {
    if (this.state.online) return net.send(type, payload);
    return this.localOp(type, payload);
  }

  localOp(type, payload) {
    if (type === 'marks-buy') {
      const r = buy(this.doc, payload?.id);
      if (!r.ok) {
        const why = { unknown: 'That item is not in the shop.', badge: 'Badges cannot be bought.', owned: 'You already own that.', balance: 'Not enough Marks yet — keep playing!' }[r.reason] || 'Cannot buy that.';
        bus.emit(Events.SYSTEM, why); this.emit('error', { msg: why, code: r.reason }); return false;
      }
      saveLocal(this.doc);
      bus.emit(Events.SYSTEM, `Unlocked ${COSMETIC_BY_ID[payload.id]?.name || payload.id}.`);
      this.state = emptyState(this.doc);
      this.state.flags = this.state.flags; this.emit('state', this.state); return true;
    }
    if (type === 'marks-equip') {
      const r = equip(this.doc, String(payload?.kind || ''), payload?.id === null ? null : String(payload?.id || ''));
      if (!r.ok) { bus.emit(Events.SYSTEM, r.reason === 'locked' ? 'Unlock it in the Marks shop first.' : 'Cannot equip that.'); return false; }
      saveLocal(this.doc);
      this.state = { ...emptyState(this.doc), flags: this.state.flags, wallet: this.state.wallet };
      this.emit('state', this.state); return true;
    }
    if (type === 'marks-board') { this.emit('board', { season: SEASON, rows: [], me: null, disabled: true, offline: true }); return true; }
    if (type === 'marks-hello') { this.emit('state', this.state); return true; }
    return false;
  }

  // Seed from the current character if we have never evaluated (first load in world).
  seed(name) {
    const rec = loadProgress(name);
    if (rec) this.onSave(name, rec);
    else this.emit('state', this.state);
  }
}

export const marks = new MarksNet();
export { COSMETICS, COSMETIC_BY_ID };
if (typeof window !== 'undefined') window.__marks = marks;
