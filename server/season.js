/**
 * season.js — Server-side season pass progress tracking for Wayfarer Online.
 * Authoritative XP ledger, daily anti-farm caps, reward claiming, and gold
 * premium upgrade. Wire into the Colyseus room onMessage handlers.
 */

import {
  SEASON_CONFIG,
  SEASON_TIERS,
  REWARD_TYPES,
  tierForXp,
  getProgressToNextTier,
  getRewardsForTier,
} from '../src/data/seasons.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function todayString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function clampXpSource(state, source, amount) {
  const config = SEASON_CONFIG.sources[source];
  const cap = SEASON_CONFIG.sourceCaps[source];
  if (!config || !cap) return 0;

  const today = todayString();
  if (state.lastDay !== today) {
    state.dailyXp = 0;
    state.sourceXp = {};
    state.lastDay = today;
  }
  state.sourceXp[source] = (state.sourceXp[source] || 0) + amount;

  const sourceOverage = Math.max(0, state.sourceXp[source] - cap);
  if (sourceOverage > 0) {
    const applied = Math.max(0, amount - sourceOverage);
    state.sourceXp[source] -= sourceOverage;
    amount = applied;
  }

  const dailyRemaining = Math.max(0, SEASON_CONFIG.dailyXpCap - state.dailyXp);
  amount = Math.min(amount, dailyRemaining);
  return Math.max(0, amount);
}

function createSeasonState() {
  return {
    xp: 0,
    premium: false,
    claimedFree: new Set(),
    claimedPremium: new Set(),
    dailyXp: 0,
    lastDay: todayString(),
    sourceXp: {},
  };
}

function serializeState(state) {
  return {
    xp: state.xp,
    premium: state.premium,
    claimedFree: Array.from(state.claimedFree),
    claimedPremium: Array.from(state.claimedPremium),
    dailyXp: state.dailyXp,
    lastDay: state.lastDay,
    sourceXp: { ...state.sourceXp },
    tier: tierForXp(state.xp),
    progress: getProgressToNextTier(state.xp),
  };
}

function mergeSerialized(state, data) {
  if (data.xp != null) state.xp = Math.max(0, Math.floor(data.xp));
  if (data.premium != null) state.premium = Boolean(data.premium);
  if (data.dailyXp != null) state.dailyXp = Math.max(0, Math.floor(data.dailyXp));
  if (data.lastDay != null) state.lastDay = String(data.lastDay);
  if (Array.isArray(data.claimedFree)) state.claimedFree = new Set(data.claimedFree.map((t) => Number(t)));
  if (Array.isArray(data.claimedPremium)) state.claimedPremium = new Set(data.claimedPremium.map((t) => Number(t)));
  if (data.sourceXp && typeof data.sourceXp === 'object') state.sourceXp = { ...data.sourceXp };

  // Daily rollover check
  const today = todayString();
  if (state.lastDay !== today) {
    state.dailyXp = 0;
    state.sourceXp = {};
    state.lastDay = today;
  }
}

export class SeasonService {
  constructor(options = {}) {
    this.getPlayerGold = options.getPlayerGold || (() => 0);
    this.deductPlayerGold = options.deductPlayerGold || (() => false);
    this.awardReward = options.awardReward || (() => {});
    this.logger = options.logger || console;
    this.states = new Map(); // playerId -> season state
  }

  getState(playerId) {
    let state = this.states.get(playerId);
    if (!state) {
      state = createSeasonState();
      this.states.set(playerId, state);
    }
    return state;
  }

  loadPlayerState(playerId, data) {
    const state = createSeasonState();
    if (data) mergeSerialized(state, data);
    this.states.set(playerId, state);
    return state;
  }

  earnXp(playerId, source, amount) {
    const state = this.getState(playerId);
    const baseAmount = Math.max(0, Math.floor(Number(amount) || 0));
    if (baseAmount <= 0) return { granted: 0, state: serializeState(state) };

    const actual = clampXpSource(state, source, baseAmount);
    if (actual <= 0) {
      this.logger.log(`[Season] ${playerId} hit daily/source cap for ${source}`);
      return { granted: 0, state: serializeState(state) };
    }

    state.xp += actual;
    state.dailyXp += actual;
    const tier = tierForXp(state.xp);

    this.logger.log(`[Season] ${playerId} +${actual} XP from ${source} (tier ${tier})`);
    return { granted: actual, state: serializeState(state) };
  }

  claimRewards(playerId, tier, track) {
    const state = this.getState(playerId);
    const currentTier = tierForXp(state.xp);
    if (tier < 1 || tier > currentTier) {
      return { ok: false, reason: 'tier_not_unlocked' };
    }

    const setName = track === 'premium' ? 'claimedPremium' : 'claimedFree';
    if (track === 'premium' && !state.premium) {
      return { ok: false, reason: 'premium_required' };
    }
    if (state[setName].has(tier)) {
      return { ok: false, reason: 'already_claimed' };
    }

    state[setName].add(tier);
    const rewards = getRewardsForTier(tier, track === 'premium');
    for (const reward of rewards) {
      if (track === 'premium' && reward.type === REWARD_TYPES.COSMETIC) {
        // premium tier 50 duplicates free title; deliver once.
        const freeSet = track === 'premium' ? state.claimedFree : null;
        if (freeSet && reward.type === REWARD_TYPES.COSMETIC && freeSet.has(tier)) continue;
      }
      this.awardReward(playerId, reward);
    }

    return { ok: true, state: serializeState(state), rewards };
  }

  upgradePremium(playerId) {
    const state = this.getState(playerId);
    if (state.premium) return { ok: false, reason: 'already_premium' };

    const gold = this.getPlayerGold(playerId);
    if (gold < SEASON_CONFIG.premiumCostGold) {
      return { ok: false, reason: 'insufficient_gold' };
    }

    const deducted = this.deductPlayerGold(playerId, SEASON_CONFIG.premiumCostGold);
    if (!deducted) return { ok: false, reason: 'deduction_failed' };

    state.premium = true;
    this.logger.log(`[Season] ${playerId} upgraded to premium`);
    return { ok: true, state: serializeState(state) };
  }

  bindToRoom(room) {
    room.onMessage('season:getState', (client) => {
      const state = this.getState(client.sessionId);
      client.send('season:state', serializeState(state));
    });

    room.onMessage('season:earnXp', (client, msg) => {
      const result = this.earnXp(client.sessionId, msg?.source, msg?.amount);
      client.send('season:xp', {
        source: msg?.source,
        amount: result.granted,
        ...result.state,
      });
    });

    room.onMessage('season:claim', (client, msg) => {
      const result = this.claimRewards(client.sessionId, msg?.tier, msg?.track);
      if (!result.ok) {
        client.send('season:error', { reason: result.reason });
        return;
      }
      client.send('season:claimed', {
        tier: msg?.tier,
        track: msg?.track,
        ...result.state,
      });
    });

    room.onMessage('season:upgradePremium', (client) => {
      const result = this.upgradePremium(client.sessionId);
      if (!result.ok) {
        client.send('season:error', { reason: result.reason });
        return;
      }
      client.send('season:premium', { ...result.state });
    });
  }
}

export { serializeState, createSeasonState, todayString };
export default SeasonService;
