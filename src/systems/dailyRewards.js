// Daily login rewards + streak system.
// Server-authoritative UTC calendar day is recorded on the player's server-side
// progress save (progress.lastSavedAt / saveProgress(savedAt)). The client uses
// that to decide eligibility, so changing the device clock does not grant extra
// claims. All state is stored under scene.meta.daily.
import { bus, Events } from '../core/events.js';
import { audio } from './audio.js';
import { saveProgress } from '../core/save.js';

const DAY_MS = 86400000;
const REWARDS = [
  { day: 1, gold: 50, tokens: 0 },
  { day: 2, gold: 75, tokens: 0 },
  { day: 3, gold: 100, tokens: 0 },
  { day: 4, gold: 150, tokens: 0 },
  { day: 5, gold: 200, tokens: 0 },
  { day: 6, gold: 250, tokens: 0 },
  { day: 7, gold: 500, tokens: 5 },
];

function fmtUTCDate(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function parseUTCDate(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() + 1 !== +m[2] || d.getUTCDate() !== +m[3]) return null;
  return d;
}

function daysBetween(a, b) {
  const ta = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const tb = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((tb - ta) / DAY_MS);
}

export function rewardForStreak(streak) {
  const idx = Math.max(0, Math.min(streak - 1, REWARDS.length - 1));
  return REWARDS[idx];
}

export class DailyRewards {
  constructor(scene) {
    this.scene = scene;
    this.autoOpened = false;
    this.bootChecked = false;
    this._ensureState();

    // Check eligibility after a short delay so the world is fully ready.
    this.scene.time.delayedCall(1200, () => this.bootCheck());
  }

  get meta() { return this.scene.meta; }
  get daily() { return this.scene.meta.daily; }

  _ensureState() {
    if (!this.meta) this.scene.meta = {};
    // Initialize meta.counters if missing so achievement-style patterns work elsewhere.
    if (!this.meta.counters || typeof this.meta.counters !== 'object') this.meta.counters = {};
    if (!this.meta.daily || typeof this.meta.daily !== 'object') {
      this.meta.daily = { lastDay: null, streak: 0, claimedDays: {}, totalClaimed: 0 };
    }
    if (!this.meta.daily.claimedDays || typeof this.meta.daily.claimedDays !== 'object') {
      this.meta.daily.claimedDays = {};
    }
    if (!Number.isFinite(this.meta.daily.streak)) this.meta.daily.streak = 0;
    if (!Number.isFinite(this.meta.daily.totalClaimed)) this.meta.daily.totalClaimed = 0;
  }

  _isWorldScene() {
    return this.scene?.scene?.key === 'world';
  }

  _serverDay() {
    // Prefer the authoritative server timestamp from the last progress save.
    // WorldScene.saveNow sets savedAt via saveProgress(..., { savedAt: Date.now() }).
    const key = `wayfarer.progress.v1.${String(this.scene.pname || 'Wayfarer').toLowerCase()}`;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const rec = JSON.parse(raw);
        if (rec?.savedAt) return fmtUTCDate(new Date(rec.savedAt));
      }
    } catch { /* ignore */ }
    // Fallback to device time only if no server save exists yet (new heroes).
    return fmtUTCDate(new Date());
  }

  bootCheck() {
    if (this.bootChecked) return;
    this.bootChecked = true;
    if (!this._isWorldScene()) return;
    if (this._shouldDeferOnboarding()) return;
    if (!this.isClaimableToday()) return;
    this.autoOpened = true;
    bus.emit(Events.DAILY_REWARD, { open: true, auto: true });
  }

  _shouldDeferOnboarding() {
    // No explicit onboarding flag exists in this codebase yet; return false
    // so the panel opens automatically. If an onboarding system is added later,
    // gate on it here and return true while onboarding is active.
    return false;
  }

  _today() {
    return this._serverDay();
  }

  _yesterday() {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return fmtUTCDate(d);
  }

  isClaimableToday() {
    this._ensureState();
    const today = this._today();
    if (this.daily.claimedDays[today]) return false;
    return true;
  }

  claimToday() {
    this._ensureState();
    if (!this.isClaimableToday()) return null;

    const today = this._today();
    const yesterday = this._yesterday();
    const lastDay = this.daily.lastDay;
    let streak = this.daily.streak || 0;

    if (!lastDay) {
      streak = 1;
    } else {
      const diff = daysBetween(parseUTCDate(lastDay) || new Date(Date.UTC(2000, 0, 1)), parseUTCDate(today) || new Date());
      if (diff <= 1) {
        streak = Math.max(1, streak + 1);
      } else {
        streak = 1;
      }
    }

    const reward = rewardForStreak(streak);
    const p = this.scene.player;
    if (!p) return null;

    p.gold = (p.gold || 0) + reward.gold;
    if (reward.tokens > 0) {
      if (typeof p.tokenPoints === 'number') {
        p.tokenPoints = (p.tokenPoints || 0) + reward.tokens;
      }
    }

    this.daily.lastDay = today;
    this.daily.streak = streak;
    this.daily.claimedDays[today] = true;
    this.daily.totalClaimed = (this.daily.totalClaimed || 0) + 1;

    // Persist immediately. WorldScene.saveNow writes player state + meta.ext.
    this.scene.saveNow?.();

    audio.play('level', 0.7);
    bus.emit(Events.PLAYER_HP, this.scene.hpPayload?.() || { gold: p.gold });
    if (reward.tokens > 0 && typeof p.tokenPoints === 'number') {
      bus.emit(Events.TOAST, {
        title: 'Daily Reward',
        text: `+${reward.tokens} Token Points`,
        sub: `${reward.gold}g · ${streak} day streak`,
        color: '#03e1ff',
        icon: '⭐',
      });
    } else {
      bus.emit(Events.TOAST, {
        title: 'Daily Reward',
        text: `+${reward.gold}g`,
        sub: `${streak} day streak`,
        color: '#ffd84a',
        icon: '🎁',
      });
    }
    bus.emit(Events.DAILY_REWARD, { claimed: true, day: streak, gold: reward.gold, tokens: reward.tokens });

    return { day: streak, gold: reward.gold, tokens: reward.tokens };
  }

  preview() {
    this._ensureState();
    const today = this._today();
    const claimed = !!this.daily.claimedDays[today];
    const currentStreak = this.daily.streak || 0;
    return { today, claimed, streak: currentStreak, rewards: REWARDS };
  }

  destroy() {
    // No external listeners; state lives in scene.meta.
  }
}
