/**
 * seasonSystem.js — Client-side season pass coordinator for Wayfarer Online.
 * Tracks local season state, reports XP to the server, and emits UI events.
 */

import SeasonNet from '../net/seasonNet.js';
import { SEASON_CONFIG } from '../data/seasons.js';

export const SEASON_EVENTS = Object.freeze({
  STATE_UPDATED: 'season:stateUpdated',
  XP_EARNED: 'season:xpEarned',
  REWARDS_CLAIMED: 'season:rewardsClaimed',
  PREMIUM_ACTIVATED: 'season:premiumActivated',
  ERROR: 'season:error',
});

export default class SeasonSystem extends Phaser.Events.EventEmitter {
  constructor(scene, options = {}) {
    super();
    this.scene = scene;
    this.net = new SeasonNet(scene);
    this.playerId = options.playerId || this.loadPlayerId();

    if (options.send && options.onBroadcast) {
      this.net.bindTransport(options.send, options.onBroadcast);
    }

    this.net.on('season:state', (payload) => this.handleState(payload));
    this.net.on('season:xp', (payload) => this.handleXp(payload));
    this.net.on('season:claimed', (payload) => this.handleClaimed(payload));
    this.net.on('season:premium', (payload) => this.handlePremium(payload));
    this.net.on('season:error', (payload) => this.emit(SEASON_EVENTS.ERROR, payload));

    this.localState = {
      xp: 0,
      tier: 0,
      premium: false,
      claimedFree: new Set(),
      claimedPremium: new Set(),
      dailyXp: 0,
      lastDay: null,
    };
  }

  loadPlayerId() {
    try {
      const saved = localStorage.getItem('wayfarer.playerId');
      if (saved) return saved;
    } catch (e) { /* ignore */ }
    const generated = `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    try {
      localStorage.setItem('wayfarer.playerId', generated);
    } catch (e) { /* ignore */ }
    return generated;
  }

  handleState(payload) {
    this.localState = {
      xp: payload.xp ?? this.localState.xp,
      tier: payload.tier ?? this.localState.tier,
      premium: payload.premium ?? this.localState.premium,
      claimedFree: new Set(payload.claimedFree || []),
      claimedPremium: new Set(payload.claimedPremium || []),
      dailyXp: payload.dailyXp ?? this.localState.dailyXp,
      lastDay: payload.lastDay ?? this.localState.lastDay,
    };
    this.emit(SEASON_EVENTS.STATE_UPDATED, this.getState());
  }

  handleXp(payload) {
    this.localState.xp = payload.xp ?? this.localState.xp;
    this.localState.tier = payload.tier ?? this.localState.tier;
    this.localState.dailyXp = payload.dailyXp ?? this.localState.dailyXp;
    this.localState.lastDay = payload.lastDay ?? this.localState.lastDay;
    this.emit(SEASON_EVENTS.XP_EARNED, {
      source: payload.source,
      amount: payload.amount,
      totalXp: this.localState.xp,
      tier: this.localState.tier,
    });
  }

  handleClaimed(payload) {
    const set = payload.track === 'premium' ? 'claimedPremium' : 'claimedFree';
    this.localState[set].add(payload.tier);
    this.emit(SEASON_EVENTS.REWARDS_CLAIMED, payload);
  }

  handlePremium(payload) {
    this.localState.premium = true;
    this.emit(SEASON_EVENTS.PREMIUM_ACTIVATED, payload);
  }

  requestState() {
    this.net.sendStateRequest();
  }

  earnXp(source, amount) {
    this.net.sendXp(source, amount);
  }

  claim(tier, track) {
    this.net.sendClaim(tier, track);
  }

  upgradePremium() {
    this.net.sendUpgradePremium();
  }

  getState() {
    return {
      ...this.localState,
      claimedFree: Array.from(this.localState.claimedFree),
      claimedPremium: Array.from(this.localState.claimedPremium),
    };
  }

  canClaim(tier, track) {
    const claimed = track === 'premium'
      ? this.localState.claimedPremium
      : this.localState.claimedFree;
    if (claimed.has(tier)) return false;
    if (tier > this.localState.tier) return false;
    if (track === 'premium' && !this.localState.premium) return false;
    return true;
  }

  isPremium() {
    return this.localState.premium;
  }

  getDailyXpCap() {
    return SEASON_CONFIG.dailyXpCap;
  }

  destroy() {
    this.net.destroy();
    this.removeAllListeners();
  }
}
