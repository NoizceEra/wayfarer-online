import { net } from './NetworkManager.js';
import { bus, Events } from '../core/events.js';

// Client side of the referral rewards system (server/referrals.js).
// Wire contract (server/referrals.js owns both sides):
//   client->server referral-info {}                -> referral-state
//   client->server referral-apply {code}           -> referral-state | econ-error
//   (to the receiver of a payout)                   referral-paid {milestone, gold}
//   (to the receiver of a payout)                   econ-sync {why:'referral', delta:{gold}}
// referral-state { code:'ABC123', invited, goldPaid, boundTo: name|null, treasuryGold }
//
// referral-state also arrives unsolicited right after onJoin (the server may
// send it before this module attaches its handlers - net.on handlers are
// registered up front and survive reconnects, so nothing is lost). The panel
// pulls a fresh state on open; REFRESH re-asks.
class ReferralNet {
  constructor() {
    this.state = null; // last referral-state payload
    this.handlers = new Map();
    if (typeof window === 'undefined') return;
    net.on('referral-state', (m) => this.onState(m));
    net.on('referral-paid', (m) => this.onPaid(m));
    bus.on(Events.NET_DISCONNECTED, () => this.emit('status', { online: false }));
    bus.on(Events.NET_STATUS, (s) => this.emit('status', { online: s?.status === 'online' }));
  }

  get online() { return net.connected; }

  on(evt, fn) {
    if (!this.handlers.has(evt)) this.handlers.set(evt, new Set());
    this.handlers.get(evt).add(fn);
    return () => this.handlers.get(evt)?.delete(fn);
  }
  emit(evt, m) { this.handlers.get(evt)?.forEach((fn) => { try { fn(m); } catch (e) { console.error(`[referral] ${evt}`, e); } }); }

  // The gold itself lands via econ-sync {delta} (server bumps the character's
  // rev); here we only cache state and raise the bus events + toast.
  onState(m) {
    if (!m || typeof m !== 'object') return;
    this.state = {
      code: String(m.code || ''),
      invited: m.invited | 0,
      goldPaid: m.goldPaid | 0,
      boundTo: m.boundTo == null ? null : String(m.boundTo),
      treasuryGold: m.treasuryGold | 0,
    };
    bus.emit(Events.REFERRAL_STATE, this.state);
    this.emit('state', this.state);
  }

  onPaid(m) {
    if (!m || typeof m !== 'object') return;
    const paid = { milestone: String(m.milestone || ''), gold: m.gold | 0 };
    bus.emit(Events.REFERRAL_PAID, paid);
    this.emit('paid', paid);
    if (paid.gold > 0) {
      bus.emit(Events.TOAST, { title: 'Referral reward', text: `+${paid.gold} gold`, sub: paid.milestone === 'welcome' ? 'Welcome bonus' : `Your invitee reached ${paid.milestone.replace('lv', 'level ')}`, color: '#14F195' });
    }
  }

  info() { return this.online ? net.send('referral-info', {}) : false; }
  apply(code) {
    if (!this.online) { bus.emit(Events.SYSTEM, 'Play Online to use referral codes.'); return false; }
    return net.send('referral-apply', { code: String(code || '').trim().toUpperCase() });
  }
}

export const referral = new ReferralNet();
if (typeof window !== 'undefined') window.__referral = referral; // debug / automated tests
