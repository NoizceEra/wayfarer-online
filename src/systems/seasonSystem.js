/**
 * seasonSystem.js — Client-side season pass coordinator for Wayfarer Online.
 * Tracks local season state, reports XP to the server, and emits UI events.
 */

import SeasonNet from '../net/seasonNet.js';
import { SEASON_CONFIG } from '../data/seasons.js';
import { bus, Events } from '../core/events.js';

export const SEASON_EVENTS = Object.freeze({
  STATE_UPDATED: 'season:stateUpdated',
  XP_EARNED: 'season:xpEarned',
  REWARDS_CLAIMED: 'season:rewardsClaimed',
  PREMIUM_ACTIVATED: 'season:premiumActivated',
  ERROR: 'season:error',
});

// Season-XP awards for legitimate gameplay sources. Amounts derive from
// SEASON_CONFIG (src/data/seasons.js) so they stay in sync with the reward
// track; enforcement (per-source + daily caps) is server-side in
// server/season.js (clampXpSource) — earnXp here only requests, never grants.
// World-boss participation has no dedicated config source, so it shares the
// 'kill' budget at 20x the grind-kill base (rare spawn, server-broadcast).
const _KILL_BASE = SEASON_CONFIG.sources.kill?.base ?? 25;
export const SEASON_XP_AWARDS = Object.freeze({
  dungeonClear: { source: 'dungeonClear', amount: SEASON_CONFIG.sources.dungeonClear?.base ?? 1200 },
  worldBoss: { source: 'kill', amount: _KILL_BASE * 20 },
  arenaWin: { source: 'pvpDuel', amount: SEASON_CONFIG.sources.pvpDuel?.base ?? 300 },
  quest: { source: 'quest', amount: SEASON_CONFIG.sources.quest?.base ?? 400 },
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

  /**
   * Subscribe season-XP awards to the client's real completion signals.
   * All awards go through earnXp (server applies per-source + daily caps).
   * The parent (e.g. UIScene) should call this once with live instances:
   *   seasonSystem.attachGameSources({ dungeons: this.dungeonSystem, arena: arenaNet, playerName });
   * Idempotent — re-attaching first detaches previous subscriptions.
   *
   * Real signals used (no new engine APIs):
   * - DungeonSystem 'dungeon:complete' (DUNGEON_EVENTS.COMPLETE)
   * - bus Events.WORLDBOSS_SLAIN (relayed by worldBossNet from server)
   * - arenaNet.onResult with you.delta > 0 (winner-only; loser delta is negative)
   * - bus Events.ACH_EVENT { k:'quest' } (emitted by questSystem.complete on turn-in)
   */
  attachGameSources({ dungeons = null, arena = null, playerName = null } = {}) {
    this.detachGameSources();
    const offs = [];
    const award = (key) => {
      const a = SEASON_XP_AWARDS[key];
      if (a) this.earnXp(a.source, a.amount);
    };
    if (dungeons && typeof dungeons.on === 'function') {
      const onDungeonComplete = () => award('dungeonClear');
      dungeons.on('dungeon:complete', onDungeonComplete);
      offs.push(() => dungeons.off?.('dungeon:complete', onDungeonComplete));
    }
    offs.push(bus.on(Events.WORLDBOSS_SLAIN, (m) => {
      const names = (m?.contributors || []).map((c) => c?.name ?? c).filter(Boolean);
      if (playerName && names.length > 0 && !names.includes(playerName)) return;
      award('worldBoss');
    }));
    if (arena && typeof arena.onResult === 'function') {
      const off = arena.onResult((m) => {
        if (Number(m?.you?.delta) > 0) award('arenaWin');
      });
      if (typeof off === 'function') offs.push(off);
    }
    offs.push(bus.on(Events.ACH_EVENT, (e) => {
      if (e?.k === 'quest') award('quest');
    }));
    this._seasonSourceOffs = offs;
    return () => this.detachGameSources();
  }

  detachGameSources() {
    const offs = this._seasonSourceOffs || [];
    this._seasonSourceOffs = [];
    for (const off of offs) {
      try { off?.(); } catch { /* ignore */ }
    }
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
    this.detachGameSources();
    this.net.destroy();
    this.removeAllListeners();
  }
}
